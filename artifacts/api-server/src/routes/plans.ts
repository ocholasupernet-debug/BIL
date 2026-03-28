import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/plans", async (req, res): Promise<void> => {
  if (!db) { res.json([]); return; }
  try {
    const adminId = req.query.adminId ? parseInt(req.query.adminId as string, 10) : undefined;
    const type = req.query.type as string | undefined;

    let query = db.select().from(plansTable).$dynamic();
    const conditions = [];
    if (adminId) conditions.push(eq(plansTable.adminId, adminId));
    if (type) conditions.push(eq(plansTable.type, type));
    if (conditions.length > 0) query = query.where(and(...conditions));

    const plans = await query;
    res.json(plans);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message, plans: [] });
  }
});

router.post("/plans", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const { adminId, name, type, speedDown, speedUp, price, validityDays, description } = req.body;
    if (!name || !type || speedDown === undefined || speedUp === undefined || price === undefined) {
      res.status(400).json({ error: "name, type, speedDown, speedUp, and price are required" });
      return;
    }
    const [plan] = await db.insert(plansTable).values({
      adminId, name, type, speedDown: Number(speedDown), speedUp: Number(speedUp),
      price: Number(price), validityDays: validityDays || 30, description
    }).returning();
    res.status(201).json(plan);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const id = parseInt(req.params.id as string, 10);
    const { name, type, speedDown, speedUp, price, validityDays, description, isActive } = req.body;
    const [plan] = await db.update(plansTable)
      .set({ name, type, speedDown, speedUp, price, validityDays, description, isActive })
      .where(eq(plansTable.id, id)).returning();
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
    res.json(plan);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.delete("/plans/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const id = parseInt(req.params.id as string, 10);
    const [plan] = await db.delete(plansTable).where(eq(plansTable.id, id)).returning();
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

export default router;
