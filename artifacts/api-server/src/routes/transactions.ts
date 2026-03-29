import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/transactions", async (req, res): Promise<void> => {
  const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
  const transactions = await db.select().from(transactionsTable).where(eq(transactionsTable.ispId, ispId));
  res.json(transactions);
});

router.post("/transactions", async (req, res): Promise<void> => {
  const { ispId = 1, customerId, customerName, phone, amount, method, planName, mpesaRef, status } = req.body;
  if (!amount || !phone) {
    res.status(400).json({ error: "amount and phone are required" });
    return;
  }
  const [tx] = await db.insert(transactionsTable).values({
    ispId, customerId, customerName, phone, amount: Number(amount),
    method: method || "mpesa", planName, mpesaRef, status: status || "completed"
  }).returning();
  res.status(201).json(tx);
});

export default router;
