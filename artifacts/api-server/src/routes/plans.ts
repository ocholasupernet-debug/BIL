import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client";

const router: IRouter = Router();

/*
 * /api/plans — Supabase isp_plans proxy.
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/plans", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const rows = await sbSelect("isp_plans", `admin_id=eq.${adminId}&select=*&order=price.asc`);
  res.json(rows);
});

router.post("/plans", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, name, type, speed, speedDown, speedUp, price, durationDays, validity, description } = req.body;
  if (!name || price === undefined) {
    res.status(400).json({ error: "name and price are required" });
    return;
  }
  const [row] = await sbInsert<Record<string, unknown>>("isp_plans", {
    admin_id:     adminId || ispId || 1,
    name,
    type:         type ?? "hotspot",
    speed_down:   speedDown ?? speed ?? 10,
    speed_up:     speedUp   ?? speed ?? 10,
    price:        Number(price),
    validity:     durationDays ?? validity ?? 30,
    validity_unit: "days",
    validity_days: durationDays ?? validity ?? 30,
    description:  description ?? null,
    is_active:    true,
  });
  if (!row) { res.status(500).json({ error: "Failed to create plan" }); return; }
  res.status(201).json(row);
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { name, type, speed, speedDown, speedUp, price, durationDays, validity, description, isActive } = req.body;
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
  res.json(row);
});

router.delete("/plans/:id", async (req, res): Promise<void> => {
  await sbDelete("isp_plans", `id=eq.${req.params.id}`);
  res.sendStatus(204);
});

export default router;
