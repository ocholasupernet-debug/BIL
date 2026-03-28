import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/transactions", async (req, res): Promise<void> => {
  if (!db) { res.json([]); return; }
  try {
    const customerId = req.query.customerId ? parseInt(req.query.customerId as string, 10) : undefined;
    let rows;
    if (customerId) {
      rows = await db.select().from(transactionsTable).where(eq(transactionsTable.customerId, customerId));
    } else {
      rows = await db.select().from(transactionsTable);
    }
    res.json(rows);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.post("/transactions", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const { customerId, planId, amount, paymentMethod, reference, status, notes } = req.body;
    if (!amount) {
      res.status(400).json({ error: "amount is required" });
      return;
    }
    const [tx] = await db.insert(transactionsTable).values({
      customerId: customerId ? Number(customerId) : undefined,
      planId: planId ? Number(planId) : undefined,
      amount: Number(amount),
      paymentMethod: paymentMethod || "cash",
      reference, status: status || "completed", notes
    }).returning();
    res.status(201).json(tx);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

export default router;
