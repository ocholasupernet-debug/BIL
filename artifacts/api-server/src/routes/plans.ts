import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/plans", async (req, res): Promise<void> => {
  const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
  const plans = await db.select().from(plansTable).where(eq(plansTable.ispId, ispId));
  res.json(plans);
});

router.post("/plans", async (req, res): Promise<void> => {
  const { ispId = 1, name, type, speed, price, durationDays, description } = req.body;
  if (!name || !speed || price === undefined) {
    res.status(400).json({ error: "name, speed, and price are required" });
    return;
  }
  const [plan] = await db.insert(plansTable).values({ ispId, name, type: type || "hotspot", speed, price, durationDays: durationDays || 30, description }).returning();
  res.status(201).json(plan);
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { name, type, speed, price, durationDays, description, isActive } = req.body;
  const [plan] = await db.update(plansTable).set({ name, type, speed, price, durationDays, description, isActive, updatedAt: new Date() }).where(eq(plansTable.id, id)).returning();
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(plan);
});

router.delete("/plans/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [plan] = await db.delete(plansTable).where(eq(plansTable.id, id)).returning();
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  res.sendStatus(204);
});

export default router;
