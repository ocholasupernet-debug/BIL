import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
  const customers = await db.select().from(customersTable).where(eq(customersTable.ispId, ispId));
  res.json(customers);
});

router.post("/customers", async (req, res): Promise<void> => {
  const { ispId = 1, name, phone, email, planId, planName, ipAddress, macAddress, status, expiryDate, amountPaid, pppoeUsername } = req.body;
  if (!name || !phone) {
    res.status(400).json({ error: "name and phone are required" });
    return;
  }
  const [customer] = await db.insert(customersTable).values({
    ispId, name, phone, email, planId, planName, ipAddress, macAddress,
    status: status || "active", expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    amountPaid: amountPaid || 0, pppoeUsername
  }).returning();
  res.status(201).json(customer);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { name, phone, email, planId, planName, ipAddress, status, expiryDate, amountPaid } = req.body;
  const [customer] = await db.update(customersTable)
    .set({ name, phone, email, planId, planName, ipAddress, status, expiryDate: expiryDate ? new Date(expiryDate) : undefined, amountPaid, updatedAt: new Date() })
    .where(eq(customersTable.id, id))
    .returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(customer);
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [customer] = await db.delete(customersTable).where(eq(customersTable.id, id)).returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.sendStatus(204);
});

export default router;
