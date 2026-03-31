import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";

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
  const effectiveAdminId = adminId || ispId || 1;
  const [row] = await sbInsert<Record<string, unknown>>("isp_customers", {
    admin_id:       effectiveAdminId,
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
  void logActivity({ adminId: Number(effectiveAdminId), type: "customer", action: "added", subject: name, details: { phone, type: type ?? "hotspot" } });
  res.status(201).json(row);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { adminId = 1, ispId, name, phone, email, planId, type, ipAddress, status, expiryDate } = req.body;
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
  const effectiveAdminId = adminId || ispId || 1;
  void logActivity({ adminId: Number(effectiveAdminId), type: "customer", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(row);
});

/*
 * POST /api/customers/hotspot-login
 * Validates a hotspot customer's username + password.
 * Returns the customer row (without password) on success.
 */
router.post("/customers/hotspot-login", async (req, res): Promise<void> => {
  const { adminId, username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const idFilter = adminId ? `admin_id=eq.${adminId}&` : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `${idFilter}username=eq.${encodeURIComponent(String(username))}&select=*&limit=1`,
  );
  const customer = rows[0];
  if (!customer) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (customer.password !== String(password)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (customer.status === "suspended") {
    res.status(403).json({ error: "Account is suspended. Contact support." });
    return;
  }
  if (customer.status === "expired") {
    res.status(403).json({ error: "Account has expired. Please renew your plan." });
    return;
  }
  // Return customer without exposing password
  const { password: _pw, ...safe } = customer;
  res.json({ ok: true, customer: safe });
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const rows = await sbSelect<{ name: string; admin_id: number }>("isp_customers", `id=eq.${req.params.id}&select=name,admin_id&limit=1`);
  const row = rows[0];
  await sbDelete("isp_customers", `id=eq.${req.params.id}`);
  if (row) void logActivity({ adminId: row.admin_id, type: "customer", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

export default router;
