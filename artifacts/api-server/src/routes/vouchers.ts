import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client";
import crypto from "crypto";

const router: IRouter = Router();

/*
 * /api/vouchers — Supabase isp_vouchers proxy.
 *
 * Note: Hotspot vouchers in this system use the FreeRADIUS tables
 * (radcheck / radusergroup). This route manages a separate "isp_vouchers"
 * table used for prepaid card / PIN code vouchers if present.
 * If the table doesn't exist in Supabase the calls return [] gracefully.
 *
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/vouchers", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const rows = await sbSelect("isp_vouchers", `admin_id=eq.${adminId}&select=*&order=created_at.desc`);
  res.json(rows);
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, planId, planName, duration, price, quantity = 10, batchName } = req.body;
  if (!quantity || quantity < 1 || quantity > 500) {
    res.status(400).json({ error: "quantity must be between 1 and 500" });
    return;
  }
  const effectiveAdminId = adminId || ispId || 1;
  const vouchers = Array.from({ length: Number(quantity) }, () => ({
    admin_id:   effectiveAdminId,
    plan_id:    planId   ? Number(planId) : null,
    code:       crypto.randomBytes(4).toString("hex").toUpperCase(),
    batch_name: batchName || `Batch-${Date.now()}`,
    plan_name:  planName  ?? null,
    duration:   duration  ?? null,
    price:      price ? Number(price) : null,
    status:     "unused",
  }));
  const inserted = await sbInsert<Record<string, unknown>>("isp_vouchers", vouchers);
  res.status(201).json(inserted);
});

router.patch("/vouchers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { status, usedBy } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status   = status;
  if (usedBy !== undefined) updates.used_by  = usedBy;
  if (status === "used")    updates.used_at  = new Date().toISOString();
  const [row] = await sbUpdate<Record<string, unknown>>("isp_vouchers", `id=eq.${id}`, updates);
  if (!row) { res.status(404).json({ error: "Voucher not found" }); return; }
  res.json(row);
});

/*
 * POST /api/vouchers/redeem
 * Looks up a voucher by code, validates it is unused, marks it used.
 * Body: { code, adminId?, usedBy? }
 */
router.post("/vouchers/redeem", async (req, res): Promise<void> => {
  const { code, adminId, usedBy } = req.body ?? {};
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const idFilter = adminId ? `admin_id=eq.${adminId}&` : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_vouchers",
    `${idFilter}code=eq.${encodeURIComponent(String(code).toUpperCase())}&select=*&limit=1`,
  );
  const voucher = rows[0];
  if (!voucher) {
    res.status(404).json({ error: "Voucher not found. Check the code and try again." });
    return;
  }
  if (voucher.status === "used") {
    res.status(409).json({ error: "This voucher has already been used." });
    return;
  }
  if (voucher.status === "expired") {
    res.status(410).json({ error: "This voucher has expired." });
    return;
  }
  const updates: Record<string, unknown> = {
    status:     "used",
    used_at:    new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (usedBy) updates.used_by = usedBy;
  const [updated] = await sbUpdate<Record<string, unknown>>("isp_vouchers", `id=eq.${voucher.id}`, updates);
  res.json({ ok: true, voucher: updated ?? { ...voucher, ...updates } });
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  await sbDelete("isp_vouchers", `id=eq.${req.params.id}`);
  res.sendStatus(204);
});

export default router;
