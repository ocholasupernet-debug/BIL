import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/routers", async (req, res): Promise<void> => {
  if (!db) { res.json([]); return; }
  try {
    const ispId = req.query.ispId ? parseInt(req.query.ispId as string, 10) : 1;
    const routers = await db.select().from(routersTable).where(eq(routersTable.ispId, ispId));
    res.json(routers);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable", routers: [] });
  }
});

router.post("/routers", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const { ispId = 1, name, ipAddress, model, rosVersion, apiPort, apiUsername, apiPassword } = req.body;
    if (!name || !ipAddress) {
      res.status(400).json({ error: "name and ipAddress are required" });
      return;
    }
    const [r] = await db.insert(routersTable).values({ ispId, name, ipAddress, model, rosVersion, apiPort: apiPort || 8728, apiUsername, apiPassword, status: "online" }).returning();
    res.status(201).json(r);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.patch("/routers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    const { name, ipAddress, model, rosVersion, status } = req.body;
    const [r] = await db.update(routersTable).set({ name, ipAddress, model, rosVersion, status, updatedAt: new Date() }).where(eq(routersTable.id, id)).returning();
    if (!r) { res.status(404).json({ error: "Router not found" }); return; }
    res.json(r);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    const [r] = await db.delete(routersTable).where(eq(routersTable.id, id)).returning();
    if (!r) { res.status(404).json({ error: "Router not found" }); return; }
    res.sendStatus(204);
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
  }
});

export default router;
