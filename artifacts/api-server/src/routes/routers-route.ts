import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/routers", async (req, res): Promise<void> => {
  const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
  const routers = await db.select().from(routersTable).where(eq(routersTable.ispId, ispId));
  res.json(routers);
});

router.post("/routers", async (req, res): Promise<void> => {
  const { ispId = 1, name, ipAddress, model, rosVersion, apiPort, apiUsername, apiPassword, apiUseSSL } = req.body;
  if (!name || !ipAddress) {
    res.status(400).json({ error: "name and ipAddress are required" });
    return;
  }
  const port = apiPort || 8728;
  const useSSL = apiUseSSL === true || apiUseSSL === "true" || port === 8729;
  const [r] = await db.insert(routersTable).values({
    ispId, name, ipAddress, model, rosVersion,
    apiPort: port, apiUsername, apiPassword,
    apiUseSSL: useSSL,
    status: "online",
  }).returning();
  res.status(201).json(r);
});

router.patch("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { name, ipAddress, model, rosVersion, status, apiPort, apiUsername, apiPassword, apiUseSSL } = req.body;
  const updates: Partial<typeof routersTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
  if (name        !== undefined) updates.name        = name;
  if (ipAddress   !== undefined) updates.ipAddress   = ipAddress;
  if (model       !== undefined) updates.model       = model;
  if (rosVersion  !== undefined) updates.rosVersion  = rosVersion;
  if (status      !== undefined) updates.status      = status;
  if (apiPort     !== undefined) updates.apiPort     = apiPort;
  if (apiUsername !== undefined) updates.apiUsername = apiUsername;
  if (apiPassword !== undefined) updates.apiPassword = apiPassword;
  if (apiUseSSL   !== undefined) updates.apiUseSSL   = apiUseSSL === true || apiUseSSL === "true" || apiPort === 8729;
  const [r] = await db.update(routersTable).set(updates).where(eq(routersTable.id, id)).returning();
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  res.json(r);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [r] = await db.delete(routersTable).where(eq(routersTable.id, id)).returning();
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  res.sendStatus(204);
});

export default router;
