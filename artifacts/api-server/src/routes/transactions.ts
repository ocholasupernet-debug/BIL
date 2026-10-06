import { Router, type IRouter, type Request, type Response } from "express";
import { sbInsert, sbSelectStrict } from "../lib/supabase-client.js";
import { authenticatedAccount, authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { transactionOwnerFilter } from "../lib/transaction-account-scope.js";

const router: IRouter = Router();
const PLATFORM_PAYMENT_METHODS = "mpesa_registration,manual_registration,mpesa_platform_billing";
const TRANSACTION_COLUMNS = "id,customer_id,plan_id,amount,payment_method,reference,mpesa_receipt,status,notes,created_at";
const HIDDEN_ROUTER_STATUSES = "setup,awaiting_ports,awaiting_sync,awaiting_connection";

type TransactionAccount = NonNullable<Awaited<ReturnType<typeof authenticatedAccount>>>;
type TransactionRow = {
  id: number;
  customer_id: number | null;
  plan_id: number | null;
  amount: number | string;
  payment_method: string;
  reference: string | null;
  mpesa_receipt: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};
type OverviewPlanRow = { id: number; router_id: number | null };
type OverviewRouterRow = { id: number; name: string };

async function resolveTransactionAccount(
  req: Request,
  res: Response,
): Promise<TransactionAccount | null> {
  const account = await authenticatedAccount(req);
  if (!account || !["isp_admin", "reseller"].includes(account.role)) {
    res.status(403).json({ error: "An active ISP or reseller account is required." });
    return null;
  }

  const requestedId = req.query.adminId ?? req.query.ispId;
  if (authenticatedAdminId(req, requestedId) !== account.id) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return null;
  }
  return account;
}

async function readScopedTransactions(account: TransactionAccount): Promise<TransactionRow[]> {
  const ownerFilter = transactionOwnerFilter(account);
  if (!ownerFilter) throw new Error("The signed-in account has no valid transaction scope.");
  const rows = await sbSelectStrict<TransactionRow>(
    "isp_transactions",
    `${ownerFilter}&payment_method=not.in.(${PLATFORM_PAYMENT_METHODS})&select=${TRANSACTION_COLUMNS}&order=created_at.desc&limit=10000`,
  );
  return rows.map(row => ({ ...row, amount: Number(row.amount) }));
}

async function readScopedPlanRouterContext(account: TransactionAccount): Promise<{
  plans: OverviewPlanRow[];
  routers: OverviewRouterRow[];
}> {
  if (account.role === "isp_admin") {
    const [plans, routers] = await Promise.all([
      sbSelectStrict<OverviewPlanRow>(
        "isp_plans",
        `admin_id=eq.${account.id}&owner_reseller_id=is.null&select=id,router_id&limit=10000`,
      ),
      sbSelectStrict<OverviewRouterRow>(
        "isp_routers",
        `admin_id=eq.${account.id}&status=not.in.(${HIDDEN_ROUTER_STATUSES})&select=id,name&limit=1000`,
      ),
    ]);
    return { plans, routers };
  }

  const tenantId = Number(account.parent_id);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) {
    throw new Error("The reseller account has no valid parent ISP scope.");
  }
  const ports = await sbSelectStrict<{ router_id: number }>(
    "isp_reseller_ports",
    `admin_id=eq.${tenantId}&assigned_reseller_id=eq.${account.id}&status=neq.disabled&select=router_id&limit=1000`,
  );
  const routerIds = [...new Set(
    ports
      .map(port => Number(port.router_id))
      .filter(id => Number.isSafeInteger(id) && id > 0),
  )];
  if (routerIds.length === 0) return { plans: [], routers: [] };

  const routerFilter = `in.(${routerIds.join(",")})`;
  const [plans, routers] = await Promise.all([
    sbSelectStrict<OverviewPlanRow>(
      "isp_plans",
      `admin_id=eq.${tenantId}&owner_reseller_id=eq.${account.id}&router_id=${routerFilter}&select=id,router_id&limit=10000`,
    ),
    sbSelectStrict<OverviewRouterRow>(
      "isp_routers",
      `admin_id=eq.${tenantId}&id=${routerFilter}&status=not.in.(${HIDDEN_ROUTER_STATUSES})&select=id,name&limit=1000`,
    ),
  ]);
  return { plans, routers };
}

router.get("/transactions/overview", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await resolveTransactionAccount(req, res);
    if (!account) return;
    const [transactions, context] = await Promise.all([
      readScopedTransactions(account),
      readScopedPlanRouterContext(account),
    ]);
    res.json({ transactions, ...context });
  } catch {
    res.status(503).json({ error: "The transaction overview could not be loaded." });
  }
});

router.get("/transactions", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await resolveTransactionAccount(req, res);
    if (!account) return;
    const rows = await readScopedTransactions(account);
    res.json(rows);
  } catch {
    res.status(503).json({ error: "Transactions could not be loaded." });
  }
});

router.post("/transactions", requireAdmin(), async (req, res): Promise<void> => {
  const { adminId = 1, ispId, customerId, amount, paymentMethod, method, reference, mpesaRef, status, notes } = req.body;
  if (!amount) {
    res.status(400).json({ error: "amount is required" });
    return;
  }
  const effectiveAdminId = authenticatedAdminId(req, adminId || ispId);
  if (!effectiveAdminId) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return;
  }
  const [row] = await sbInsert<Record<string, unknown>>("isp_transactions", {
    admin_id:       effectiveAdminId,
    customer_id:    customerId ?? null,
    amount:         Number(amount),
    payment_method: paymentMethod || method || "mpesa",
    reference:      reference || mpesaRef || `TXN-${Date.now()}`,
    status:         status ?? "completed",
    notes:          notes ?? null,
  });
  if (!row) { res.status(500).json({ error: "Failed to create transaction" }); return; }
  res.status(201).json(row);
});

export default router;
