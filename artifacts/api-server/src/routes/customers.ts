import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  if (!db) { res.json([]); return; }
  try {
    const adminId = req.query.adminId ? parseInt(req.query.adminId as string, 10) : undefined;
    let rows;
    if (adminId) {
      rows = await db.select().from(customersTable).where(eq(customersTable.adminId, adminId));
    } else {
      rows = await db.select().from(customersTable);
    }
    res.json(rows);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.post("/customers", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const { name, username, password, email, phone, type, planId, adminId, status, ipAddress, macAddress, pppoeUsername, expiresAt } = req.body;
    if (!name || !username || !password || !type) {
      res.status(400).json({ error: "name, username, password, and type are required" });
      return;
    }
    const [customer] = await db.insert(customersTable).values({
      name, username, password, email, phone, type,
      planId: planId ? Number(planId) : undefined,
      adminId: adminId ? Number(adminId) : undefined,
      status: status || "active", ipAddress, macAddress, pppoeUsername,
      expiresAt: expiresAt || undefined,
    }).returning();
    res.status(201).json(customer);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const id = parseInt(req.params.id as string, 10);
    const { name, phone, email, planId, ipAddress, status, expiresAt } = req.body;
    const [customer] = await db.update(customersTable)
      .set({ name, phone, email, planId, ipAddress, status, expiresAt: expiresAt || undefined })
      .where(eq(customersTable.id, id))
      .returning();
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(customer);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const id = parseInt(req.params.id as string, 10);
    const [customer] = await db.delete(customersTable).where(eq(customersTable.id, id)).returning();
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(503).json({ error: "Database unavailable", detail: err?.message });
  }
});

export default router;
