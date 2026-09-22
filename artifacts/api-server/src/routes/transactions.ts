import { Router, type IRouter } from "express";
import { sbSelect, sbInsert } from "../lib/supabase-client";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();

/*
 * /api/transactions — Supabase isp_transactions proxy.
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/transactions", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.query.adminId ?? req.query.ispId);
  if (!adminId) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return;
  }
  const rows = await sbSelect("isp_transactions", `admin_id=eq.${adminId}&select=*&order=created_at.desc`);
  res.json(rows);
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
