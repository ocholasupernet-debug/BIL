import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client";

const router: IRouter = Router();

/*
 * /api/customers — Supabase isp_customers proxy.
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/customers", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const rows = await sbSelect("isp_customers", `admin_id=eq.${adminId}&select=*`);
  res.json(rows);
});

router.post("/customers", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, name, phone, email, planId, type, ipAddress, macAddress, status, expiryDate, pppoeUsername } = req.body;
  if (!name || !phone) {
    res.status(400).json({ error: "name and phone are required" });
    return;
  }
  const [row] = await sbInsert<Record<string, unknown>>("isp_customers", {
    admin_id:       adminId || ispId || 1,
    name,
    phone,
    email:          email    ?? null,
    plan_id:        planId   ?? null,
    type:           type     ?? "hotspot",
    ip_address:     ipAddress ?? null,
    mac_address:    macAddress ?? null,
    status:         status   ?? "active",
    expires_at:     expiryDate ? new Date(expiryDate).toISOString() : null,
    pppoe_username: pppoeUsername ?? null,
  });
  if (!row) { res.status(500).json({ error: "Failed to create customer" }); return; }
  res.status(201).json(row);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { name, phone, email, planId, type, ipAddress, status, expiryDate } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name       !== undefined) updates.name       = name;
  if (phone      !== undefined) updates.phone      = phone;
  if (email      !== undefined) updates.email      = email;
  if (planId     !== undefined) updates.plan_id    = planId;
  if (type       !== undefined) updates.type       = type;
  if (ipAddress  !== undefined) updates.ip_address = ipAddress;
  if (status     !== undefined) updates.status     = status;
  if (expiryDate !== undefined) updates.expires_at = new Date(expiryDate).toISOString();
  const [row] = await sbUpdate<Record<string, unknown>>("isp_customers", `id=eq.${id}`, updates);
  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(row);
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  await sbDelete("isp_customers", `id=eq.${req.params.id}`);
  res.sendStatus(204);
});

export default router;
