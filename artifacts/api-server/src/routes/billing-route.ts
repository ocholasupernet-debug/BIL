import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { renewalVoucherError } from "../lib/admin-renewal-voucher-policy.js";
import {
  authenticatedAccount,
  requireAdmin,
} from "../lib/api-auth.js";
import {
  sbSelectStrict,
  supabaseServiceRoleConfigured,
} from "../lib/supabase-client.js";
import {
  billingEligibleSalesSummary,
  billingCreateInvoice,
  billingMonthlyRevenueSummary,
  billingRouterRevenueSummary,
  billingRevenueSummary,
  billingSelect,
  billingUpdateInvoice,
  billingRpc,
  platformSecureSettingsConfigured,
} from "../lib/platform-billing-store.js";

const router: IRouter = Router();

type BillingConfig = {
  due_day: number;
  sales_threshold: number;
  low_sales_fee: number;
  high_sales_fee: number;
};

type AccountRow = {
  id: number;
  parent_id: number | null;
  role: string;
  name: string | null;
  phone: string | null;
  payment_phone: string | null;
  created_at: string | null;
};

function renewalVoucherHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}

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

function eligibleForRenewalBanner(createdAt: string | null, billingPeriod: string): boolean {
  const created = createdAt ? new Date(createdAt) : null;
  const period = new Date(`${billingPeriod}T00:00:00.000Z`);
  if (!created || !Number.isFinite(created.getTime()) || !Number.isFinite(period.getTime())) return false;

  const cutoff = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 1, 25))
    .toISOString().slice(0, 10);
  const localDateParts = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(created).map(({ type, value }) => [type, value]));
  const createdDate = `${localDateParts.get("year")}-${localDateParts.get("month")}-${localDateParts.get("day")}`;
  return createdDate < cutoff;
}

async function billingConfig(): Promise<BillingConfig> {
  const rows = await billingSelect<BillingConfig>(
    "platform_billing_config",
    "id=eq.1&select=due_day,sales_threshold,low_sales_fee,high_sales_fee&limit=1",
  );
  if (!rows[0]) throw new Error("Platform billing configuration is not available.");
  return rows[0];
}

async function currentAccount(req: Request): Promise<AccountRow | null> {
  const account = await authenticatedAccount(req);
  if (!account) return null;
  const rows = await sbSelectStrict<AccountRow>(
    "isp_admins",
    `id=eq.${encodeURIComponent(account.id)}&is_active=is.true&select=id,parent_id,role,name,phone,payment_phone,created_at&limit=1`,
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
  const salesStart = previousMonthStart(period);
  const [salesSummary] = await billingEligibleSalesSummary<{
    sales_period_start: string;
    sales_period_end: string;
    sales_total: number | string;
    payment_count: number | string;
  }>(account.id, period);
  if (!salesSummary) throw new Error("Previous-month eligible sales are unavailable.");
  const resolvedSalesStart = salesSummary.sales_period_start || salesStart;
  const salesTotal = Number(salesSummary.sales_total ?? 0);
  if (existing[0]) {
    return {
      invoice: {
        ...existing[0],
        sales_period_start: resolvedSalesStart,
        sales_period_end: salesSummary.sales_period_end || period,
        sales_total: salesTotal,
        sales_threshold: config.sales_threshold,
      },
      config,
    };
  }
  const amountDue = salesTotal > Number(config.sales_threshold)
    ? Number(config.high_sales_fee)
    : Number(config.low_sales_fee);
  const payload = {
    account_id: account.id,
    tenant_id: account.parent_id ?? account.id,
    billing_period: period,
    sales_period_start: resolvedSalesStart,
    sales_period_end: salesSummary.sales_period_end || period,
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

export function activeBillingStatus(invoice: Record<string, unknown>, now = new Date()): string {
  const status = String(invoice.status ?? "");
  if (status === "paid") return status;

  const dueDate = typeof invoice.due_date === "string" ? invoice.due_date : "";
  const parsedDueDate = new Date(`${dueDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
    !Number.isFinite(parsedDueDate.getTime()) ||
    parsedDueDate.toISOString().slice(0, 10) !== dueDate
  ) {
    return status;
  }

  const dateParts = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const todayInNairobi = `${dateParts.get("year")}-${dateParts.get("month")}-${dateParts.get("day")}`;
  return todayInNairobi >= dueDate ? "expired" : status;
}

export async function platformBillingAccessRestricted(adminId: number, now = new Date()): Promise<boolean> {
  const accounts = await sbSelectStrict<AccountRow>(
    "isp_admins",
    `id=eq.${encodeURIComponent(String(adminId))}&select=id,parent_id,role,name,phone,payment_phone,created_at&limit=1`,
  );
  const account = accounts[0];
  if (!account || !["isp_admin", "reseller"].includes(account.role)) return false;

  const result = await currentInvoice(account);
  if (!result.invoice) return false;
  const billingPeriod = String(result.invoice.billing_period ?? utcMonthStart());
  const invoice = { ...result.invoice, status: activeBillingStatus(result.invoice, now) };
  if (!eligibleForRenewalBanner(account.created_at, billingPeriod)) return false;
  return invoice.status === "expired" || invoice.status === "failed";
}

router.get("/billing/current", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "Only ISP admin and reseller accounts have platform billing." });
      return;
    }
    const result = await currentInvoice(account);
    const billingPeriod = String(result.invoice?.billing_period ?? utcMonthStart());
    const invoice = result.invoice
      ? { ...result.invoice, status: activeBillingStatus(result.invoice) }
      : null;
    const eligible = !!invoice && eligibleForRenewalBanner(account.created_at, billingPeriod);
    res.json({
      ok: true,
      eligible,
      accessRestricted: eligible && !!invoice && (invoice.status === "expired" || invoice.status === "failed"),
      paymentsAvailable: supabaseServiceRoleConfigured,
      renewalVouchersAvailable: platformSecureSettingsConfigured(),
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
    const rawRouterId = req.query.routerId;
    let summaryRows: {
      income_today: number | string;
      income_month: number | string;
      total_revenue: number | string;
      total_transactions: number | string;
    }[];
    if (rawRouterId !== undefined) {
      const routerId = typeof rawRouterId === "string" ? Number(rawRouterId) : Number.NaN;
      if (!Number.isSafeInteger(routerId) || routerId < 1) {
        res.status(400).json({ ok: false, error: "Choose a valid router." });
        return;
      }

      const ownedRouter = account.role === "isp_admin"
        ? await sbSelectStrict<{ id: number }>(
          "isp_routers",
          `id=eq.${routerId}&admin_id=eq.${account.id}&select=id&limit=1`,
        )
        : [];
      const assignedResellerRouter = account.role === "reseller" && Number.isSafeInteger(Number(account.parent_id))
        ? await sbSelectStrict<{ id: number }>(
          "isp_reseller_ports",
          `admin_id=eq.${Number(account.parent_id)}&assigned_reseller_id=eq.${account.id}&router_id=eq.${routerId}&status=neq.disabled&select=id&limit=1`,
        )
        : [];
      if (!ownedRouter.length && !assignedResellerRouter.length) {
        res.status(404).json({ ok: false, error: "That router is not available in this account." });
        return;
      }
      summaryRows = await billingRouterRevenueSummary<{
        income_today: number | string;
        income_month: number | string;
        total_revenue: number | string;
        total_transactions: number | string;
      }>(account.id, routerId);
    } else {
      summaryRows = await billingRevenueSummary<{
        income_today: number | string;
        income_month: number | string;
        total_revenue: number | string;
        total_transactions: number | string;
      }>(account.id);
    }
    const summary = summaryRows[0];
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

router.get("/billing/monthly-revenue", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "An active account is required." });
      return;
    }
    const rows = await billingMonthlyRevenueSummary<{
      month_start: string;
      income: number | string;
      payment_count: number | string;
    }>(account.id);
    res.json({
      ok: true,
      months: rows.map(row => ({
        monthStart: row.month_start,
        income: Number(row.income ?? 0),
        paymentCount: Number(row.payment_count ?? 0),
      })),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load monthly income from the payment ledger." });
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

router.post("/billing/vouchers/validate", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!account || !["isp_admin", "reseller"].includes(account.role)) {
      res.status(403).json({ ok: false, error: "Only eligible admin accounts can use renewal vouchers." });
      return;
    }
    if (code.length < 12 || code.length > 80) {
      res.status(400).json({ ok: false, error: "Enter a valid admin renewal voucher code." });
      return;
    }
    const hash = renewalVoucherHash(code);
    const vouchers = await billingSelect<{
      id: number; benefit_type: string; target_admin_id: number | null;
      status: string; expires_at: string | null; max_uses: number;
    }>("admin_renewal_vouchers",
      `code_hash=eq.${hash}&select=id,benefit_type,target_admin_id,status,expires_at,max_uses&limit=1`);
    const voucher = vouchers[0];
    if (!voucher || voucher.status !== "active") {
      res.status(400).json({ ok: false, error: "This renewal voucher is invalid or unavailable." });
      return;
    }
    if (voucher.expires_at && Date.parse(voucher.expires_at) <= Date.now()) {
      res.status(400).json({ ok: false, error: "This renewal voucher has expired." });
      return;
    }
    if (voucher.target_admin_id != null && voucher.target_admin_id !== account.id) {
      res.status(400).json({ ok: false, error: "This voucher is not available for this admin account." });
      return;
    }
    const { invoice } = await currentInvoice(account, true);
    if (!invoice || invoice.status === "paid") {
      res.status(409).json({ ok: false, error: "There is no unpaid monthly renewal invoice to apply this voucher to." });
      return;
    }
    const redemptions = await billingSelect<{ id: number; billing_invoice_id: number }>(
      "admin_renewal_voucher_redemptions",
      `voucher_id=eq.${voucher.id}&select=id,billing_invoice_id&limit=${Number(voucher.max_uses)}`,
    );
    const policyError = renewalVoucherError({
      status: voucher.status,
      targetAdminId: voucher.target_admin_id,
      expiresAt: voucher.expires_at,
      maxUses: Number(voucher.max_uses),
      redemptionCount: redemptions.length,
      redeemedInvoiceIds: redemptions.map(row => Number(row.billing_invoice_id)),
    }, account.id, Number(invoice.id));
    if (policyError) {
      const errors: Record<string, string> = {
        revoked: "This renewal voucher has been revoked.",
        expired: "This renewal voucher has expired.",
        not_for_account: "This voucher is not available for this admin account.",
        usage_limit: "This renewal voucher has reached its use limit.",
        already_redeemed: "This invoice has already used a renewal voucher.",
      };
      res.status(409).json({ ok: false, error: errors[policyError] });
      return;
    }
    res.json({
      ok: true,
      preview: {
        benefit: "Covers one monthly platform renewal invoice",
        billingPeriod: invoice.billing_period,
        amountCovered: Number(invoice.amount_due),
        dueDate: invoice.due_date,
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "Renewal voucher validation is temporarily unavailable." });
  }
});

router.post("/billing/vouchers/redeem", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!account || !["isp_admin", "reseller"].includes(account.role) || code.length < 12 || code.length > 80) {
      res.status(400).json({ ok: false, error: "Enter a valid admin renewal voucher code." });
      return;
    }
    const { invoice } = await currentInvoice(account, true);
    if (!invoice || !Number.isSafeInteger(Number(invoice.id))) {
      res.status(409).json({ ok: false, error: "There is no current renewal invoice to apply this voucher to." });
      return;
    }
    const result = await billingRpc<Array<{
      result: string; redemption_id: number | null; renewal_period: string | null;
      renewal_applied: number | string | null;
    }>>("redeem_admin_renewal_voucher", {
      p_code_hash: renewalVoucherHash(code),
      p_account_id: account.id,
      p_invoice_id: Number(invoice.id),
    });
    const redemption = Array.isArray(result) ? result[0] : undefined;
    if (redemption?.result !== "redeemed") {
      const errors: Record<string, string> = {
        invalid_code: "This renewal voucher is invalid.",
        revoked: "This renewal voucher has been revoked.",
        expired: "This renewal voucher has expired.",
        not_for_account: "This voucher is not available for this admin account.",
        usage_limit: "This renewal voucher has reached its use limit.",
        already_paid: "This renewal invoice has already been paid.",
        already_redeemed: "This invoice has already used a renewal voucher.",
        invoice_unavailable: "This renewal invoice is not available for this account.",
        invoice_not_current: "Only the current monthly renewal invoice can use a voucher.",
        ineligible_account: "Only eligible admin accounts can use renewal vouchers.",
      };
      res.status(409).json({ ok: false, error: errors[redemption?.result ?? ""] ?? "This voucher could not be redeemed." });
      return;
    }
    res.json({
      ok: true,
      redemption: {
        billingPeriod: redemption.renewal_period,
        amountCovered: Number(redemption.renewal_applied),
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "Renewal voucher redemption is temporarily unavailable. Refresh and check billing status." });
  }
});

export default router;