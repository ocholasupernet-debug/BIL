import { Router, type IRouter, type Request, type Response } from "express";
import {
  authenticatedAccount,
  requireAdmin,
} from "../lib/api-auth.js";
import {
  sbSelectStrict,
  supabaseServiceRoleConfigured,
} from "../lib/supabase-client.js";
import {
  billingCreateInvoice,
  billingRevenueSummary,
  billingSelect,
  billingUpdateInvoice,
} from "../lib/platform-billing-store.js";

const router: IRouter = Router();

type BillingConfig = {
  cutoff_day: number;
  due_day: number;
  sales_threshold: number;
  low_sales_fee: number;
  high_sales_fee: number;
};

type AccountRow = {
  id: number;
  parent_id: number | null;
  role: string;
  created_at: string;
  name: string | null;
  phone: string | null;
  payment_phone: string | null;
};

function utcMonthStart(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
}

function previousMonthStart(periodStart: string): string {
  const date = new Date(`${periodStart}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
}

function dueDate(periodStart: string, day: number): string {
  const date = new Date(`${periodStart}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day))
    .toISOString().slice(0, 10);
}

async function billingConfig(): Promise<BillingConfig> {
  const rows = await billingSelect<BillingConfig>(
    "platform_billing_config",
    "id=eq.1&select=cutoff_day,due_day,sales_threshold,low_sales_fee,high_sales_fee&limit=1",
  );
  if (!rows[0]) throw new Error("Platform billing configuration is not available.");
  return rows[0];
}

async function currentAccount(req: Request): Promise<AccountRow | null> {
  const account = await authenticatedAccount(req);
  if (!account) return null;
  const rows = await sbSelectStrict<AccountRow>(
    "isp_admins",
    `id=eq.${encodeURIComponent(account.id)}&is_active=is.true&select=id,parent_id,role,created_at,name,phone,payment_phone&limit=1`,
  );
  return rows[0] ?? null;
}

async function currentInvoice(
  account: AccountRow,
  createIfMissing = false,
): Promise<{ invoice: Record<string, unknown> | null; config: BillingConfig }> {
  const config = await billingConfig();
  const period = utcMonthStart();
  const existing = await billingSelect<Record<string, unknown>>(
    "platform_billing_invoices",
    `account_id=eq.${account.id}&billing_period=eq.${period}&select=*&limit=1`,
  );
  if (existing[0]) return { invoice: existing[0], config };

  const created = new Date(account.created_at);
  const eligible = Number.isFinite(created.getTime())
    && created < new Date(`${period}T00:00:00.000Z`)
    && created.getUTCDate() <= config.cutoff_day;
  if (!eligible) return { invoice: null, config };

  const salesStart = previousMonthStart(period);
  const ledgerRows = await billingSelect<{ amount: number | string }>(
    "revenue_ledger",
    `revenue_account_id=eq.${account.id}&occurred_at=gte.${salesStart}T00:00:00.000Z&occurred_at=lt.${period}T00:00:00.000Z&select=amount`,
  );
  const salesTotal = ledgerRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const amountDue = salesTotal > Number(config.sales_threshold)
    ? Number(config.high_sales_fee)
    : Number(config.low_sales_fee);
  const payload = {
    account_id: account.id,
    tenant_id: account.parent_id ?? account.id,
    billing_period: period,
    sales_period_start: salesStart,
    sales_period_end: period,
    sales_total: salesTotal,
    sales_threshold: config.sales_threshold,
    low_sales_fee: config.low_sales_fee,
    high_sales_fee: config.high_sales_fee,
    amount_due: amountDue,
    due_date: dueDate(period, config.due_day),
    status: "due",
    updated_at: new Date().toISOString(),
  };
  if (!createIfMissing) return { invoice: payload, config };
  const [inserted] = await billingCreateInvoice<Record<string, unknown>>(payload);
  const invoice = inserted ?? (await billingSelect<Record<string, unknown>>(
    "platform_billing_invoices",
    `account_id=eq.${account.id}&billing_period=eq.${period}&select=*&limit=1`,
  ))[0];
  if (!invoice) throw new Error("Billing invoice could not be prepared.");
  return { invoice, config };
}

function activeBillingStatus(invoice: Record<string, unknown>) {
  if (invoice.status === "paid") return invoice.status;
  const due = Date.parse(`${String(invoice.due_date)}T23:59:59.999Z`);
  return Number.isFinite(due) && Date.now() > due ? "expired" : invoice.status;
}

router.get("/billing/current", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "Only ISP admin and reseller accounts have platform billing." });
      return;
    }
    const result = await currentInvoice(account);
    const invoice = result.invoice
      ? { ...result.invoice, status: activeBillingStatus(result.invoice) }
      : null;
    res.json({
      ok: true,
      eligible: !!invoice,
      paymentsAvailable: supabaseServiceRoleConfigured,
      account: { id: account.id, role: account.role, name: account.name },
      invoice,
      config: result.config,
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: "Could not load platform billing." });
  }
});

router.get("/billing/history", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "An active account is required." });
      return;
    }
    const invoices = await billingSelect<Record<string, unknown>>(
      "platform_billing_invoices",
      `account_id=eq.${account.id}&select=*&order=billing_period.desc&limit=24`,
    );
    res.json({ ok: true, invoices });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load billing history." });
  }
});

router.get("/billing/revenue-summary", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "An active account is required." });
      return;
    }
    const [summary] = await billingRevenueSummary<{
      income_today: number | string;
      income_month: number | string;
      total_revenue: number | string;
      total_transactions: number | string;
    }>(account.id);
    res.json({
      ok: true,
      incomeToday: Number(summary?.income_today ?? 0),
      incomeMonth: Number(summary?.income_month ?? 0),
      totalRevenue: Number(summary?.total_revenue ?? 0),
      totalTransactions: Number(summary?.total_transactions ?? 0),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load immutable revenue totals." });
  }
});

router.post("/billing/renew", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    if (!account || !["isp_admin", "reseller"].includes(account.role) || !phone) {
      res.status(400).json({ ok: false, error: "Enter the phone number to receive the payment prompt." });
      return;
    }
    // M-Pesa initiation, callback intake and atomic settlement still use the
    // shared client. A billing-only credential cannot safely settle a payment.
    if (!supabaseServiceRoleConfigured) {
      res.status(503).json({ ok: false, error: "Renewal payments are unavailable in this preview." });
      return;
    }
    const { invoice } = await currentInvoice(account, true);
    if (!invoice) {
      res.status(409).json({ ok: false, error: "This account is not eligible for the current billing cycle." });
      return;
    }
    if (invoice.status === "paid") {
      res.json({ ok: true, paid: true, invoice });
      return;
    }
    const invoiceId = Number(invoice.id);
    const amount = Number(invoice.amount_due);
    if (!Number.isSafeInteger(invoiceId) || !Number.isFinite(amount) || amount <= 0) {
      res.status(503).json({ ok: false, error: "This billing invoice is incomplete." });
      return;
    }
    const updated = await billingUpdateInvoice<Record<string, unknown>>(
      `id=eq.${invoiceId}&account_id=eq.${account.id}&status=neq.paid`,
      { status: "pending", payment_phone: phone, updated_at: new Date().toISOString() },
    );
    if (!updated.length) {
      res.status(409).json({ ok: false, error: "Billing status changed; refresh before paying." });
      return;
    }
    res.json({
      ok: true,
      invoiceId,
      amount,
      phone,
      adminId: account.id,
      accountReference: `BILL-${invoiceId}`,
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: "Could not prepare the billing payment." });
  }
});

export default router;