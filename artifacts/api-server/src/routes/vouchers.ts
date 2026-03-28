import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";
import crypto from "crypto";

const router: IRouter = Router();

router.get("/vouchers", async (req, res): Promise<void> => {
  if (!db) { res.json([]); return; }
  try {
    const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
    const vouchers = await db.select().from(vouchersTable).where(eq(vouchersTable.ispId, ispId));
    res.json(vouchers);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable", vouchers: [] });
  }
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const { ispId = 1, planId, planName, duration, price, quantity = 10, batchName } = req.body;
    if (!quantity || quantity < 1 || quantity > 500) {
      res.status(400).json({ error: "quantity must be between 1 and 500" });
      return;
    }
    const vouchers = Array.from({ length: quantity }, () => ({
      ispId: Number(ispId),
      planId: planId ? Number(planId) : undefined,
      code: crypto.randomBytes(4).toString("hex").toUpperCase(),
      batchName: batchName || `Batch-${Date.now()}`,
      planName,
      duration,
      price: price ? Number(price) : undefined,
      status: "unused" as const,
    }));
    const inserted = await db.insert(vouchersTable).values(vouchers).returning();
    res.status(201).json(inserted);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.patch("/vouchers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    const { status, usedBy } = req.body;
    const [voucher] = await db.update(vouchersTable).set({ status, usedBy, usedAt: status === "used" ? new Date() : undefined, updatedAt: new Date() }).where(eq(vouchersTable.id, id)).returning();
    if (!voucher) { res.status(404).json({ error: "Voucher not found" }); return; }
    res.json(voucher);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    const [v] = await db.delete(vouchersTable).where(eq(vouchersTable.id, id)).returning();
    if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
    res.sendStatus(204);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

export default router;
