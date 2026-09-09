import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";

const router: IRouter = Router();

/*
 * /api/plans — Supabase isp_plans proxy.
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/plans", async (req, res): Promise<void> => {
  const requestedAdminId = req.query.adminId ?? req.query.ispId;
  let adminId = typeof requestedAdminId === "string" ? requestedAdminId : undefined;
  if (!adminId) {
    const subdomain = getTenantSubdomainFromRequest(req);
    if (subdomain) {
      const admins = await sbSelect<{ id: number }>(
        "isp_admins",
        `subdomain=eq.${subdomain}&is_active=is.true&select=id&limit=1`,
      );
      if (admins[0]?.id) adminId = String(admins[0].id);
    }
  }

  const requestedType = typeof req.query.type === "string" ? req.query.type : "";
  const typeFilter = requestedType === "hotspot" || requestedType === "pppoe"
    ? `&type=eq.${requestedType}`
    : "";
  const rows = adminId
    ? await sbSelect("isp_plans", `admin_id=eq.${adminId}${typeFilter}&select=*&order=price.asc`)
    : [];
  res.json(rows);
});

router.post("/plans", async (req, res): Promise<void> => {
  const {
    adminId = 1,
    ispId,
    name,
    type,
    speed,
    speedDown,
    speedUp,
    price,
    durationDays,
    validity,
    description,
    sharedUsers,
    routerId,
    dataLimitMb,
    isActive,
  } = req.body;
  if (!name || price === undefined) {
    res.status(400).json({ error: "name and price are required" });
    return;
  }
  const effectiveAdminId = adminId || ispId || 1;
  const [row] = await sbInsert<Record<string, unknown>>("isp_plans", {
    admin_id:     effectiveAdminId,
    name,
    type:         type ?? "hotspot",
    speed_down:   speedDown ?? speed ?? 10,
    speed_up:     speedUp   ?? speed ?? 10,
    price:        Number(price),
    validity:     durationDays ?? validity ?? 30,
    validity_unit: "days",
    validity_days: durationDays ?? validity ?? 30,
    shared_users:  sharedUsers ?? 1,
    router_id:     routerId ?? null,
    data_limit_mb: dataLimitMb ?? null,
    is_active:     isActive ?? true,
    description:  description ?? null,
  });
  if (!row) { res.status(500).json({ error: "Failed to create plan" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "plan", action: "added", subject: name, details: { price: Number(price), type: type ?? "hotspot" } });
  res.status(201).json(row);
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { adminId = 1, ispId, name, type, speed, speedDown, speedUp, price, durationDays, validity, description, isActive } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name        !== undefined) updates.name        = name;
  if (type        !== undefined) updates.type        = type;
  if (speedDown   !== undefined) updates.speed_down  = speedDown;
  if (speedUp     !== undefined) updates.speed_up    = speedUp;
  if (speed       !== undefined) { updates.speed_down = speed; updates.speed_up = speed; }
  if (price       !== undefined) updates.price       = Number(price);
  if (durationDays !== undefined || validity !== undefined) {
    const d = durationDays ?? validity;
    updates.validity      = d;
    updates.validity_days = d;
  }
  if (description !== undefined) updates.description = description;
  if (isActive    !== undefined) updates.is_active   = isActive;
  const [row] = await sbUpdate<Record<string, unknown>>("isp_plans", `id=eq.${id}`, updates);
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  const effectiveAdminId = adminId || ispId || 1;
  void logActivity({ adminId: Number(effectiveAdminId), type: "plan", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(row);
});

router.delete("/plans/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const rows = await sbSelect<{ name: string; admin_id: number }>("isp_plans", `id=eq.${id}&select=name,admin_id&limit=1`);
  const row = rows[0];
  await sbDelete("isp_plans", `id=eq.${id}`);
  if (row) void logActivity({ adminId: row.admin_id, type: "plan", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

export default router;
