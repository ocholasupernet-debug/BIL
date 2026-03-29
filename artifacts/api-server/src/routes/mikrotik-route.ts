import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
import {
  fetchHotspotUsers,
  fetchPPPoEActive,
  fetchInterfaces,
  fetchTraffic,
  fetchRouterLiveData,
  type RouterCredentials,
} from "../lib/mikrotik";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* ─── Helper: load router credentials from DB by ID ──────────────────────── */
async function getRouterCreds(id: number): Promise<RouterCredentials | null> {
  if (!db) return null;
  const rows = await db.select().from(routersTable).where(eq(routersTable.id, id));
  const row = rows[0];
  if (!row) return null;
  return {
    host: row.ipAddress,
    port: row.apiPort ?? 8728,
    username: row.apiUsername ?? "admin",
    password: row.apiPassword ?? "",
  };
}

/* ─── Helper: load router credentials from DB by host/IP ─────────────────── */
async function getRouterCredsByHost(host: string): Promise<RouterCredentials | null> {
  if (!db) return null;
  const { eq: eqOp, or, ilike } = await import("drizzle-orm");
  const rows = await db.select().from(routersTable).where(
    or(
      eqOp(routersTable.ipAddress, host),
      ilike(routersTable.name, host),
    )
  );
  const row = rows[0];
  if (!row) return null;
  return {
    host: row.ipAddress,
    port: row.apiPort ?? 8728,
    username: row.apiUsername ?? "admin",
    password: row.apiPassword ?? "",
  };
}

/* ─── Helper: handle offline routers gracefully ─────────────────────────── */
function routerErrorResponse(res: import("express").Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const isOffline =
    msg.includes("timed out") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EHOSTUNREACH") ||
    msg.includes("ENOTFOUND");

  logger.warn({ err: msg }, "MikroTik API error");

  if (isOffline) {
    res.status(503).json({ error: "Router is offline or unreachable", detail: msg });
  } else {
    res.status(500).json({ error: "MikroTik API error", detail: msg });
  }
}

/* ─── GET /api/router/:id/active-users ──────────────────────────────────── */
router.get("/router/:id/active-users", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const creds = await getRouterCreds(id);
  if (!creds) { res.status(404).json({ error: "Router not found" }); return; }

  try {
    const [hotspot, pppoe] = await Promise.all([
      fetchHotspotUsers(creds),
      fetchPPPoEActive(creds),
    ]);
    res.json({
      routerId: id,
      hotspot,
      pppoe,
      totalActive: hotspot.length + pppoe.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/interfaces ────────────────────────────────────── */
router.get("/router/:id/interfaces", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const creds = await getRouterCreds(id);
  if (!creds) { res.status(404).json({ error: "Router not found" }); return; }

  try {
    const interfaces = await fetchInterfaces(creds);
    res.json({
      routerId: id,
      interfaces,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/traffic ───────────────────────────────────────── */
router.get("/router/:id/traffic", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const creds = await getRouterCreds(id);
  if (!creds) { res.status(404).json({ error: "Router not found" }); return; }

  try {
    const ifaces = req.query.ifaces
      ? String(req.query.ifaces).split(",").filter(Boolean)
      : [];
    const traffic = await fetchTraffic(creds, ifaces);
    res.json({
      routerId: id,
      traffic,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/live ── all data in one request ───────────────── */
router.get("/router/:id/live", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const creds = await getRouterCreds(id);
  if (!creds) { res.status(404).json({ error: "Router not found" }); return; }

  try {
    const data = await fetchRouterLiveData(creds);
    res.json({ routerId: id, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/live-by-host?host=x.x.x.x ─────────────────────────── */
/* Looks up credentials from local DB by IP address.                           */
/* Accepts ?username=… ?port=… as optional overrides.                          */
router.get("/router/live-by-host", async (req, res): Promise<void> => {
  const host = String(req.query.host ?? "").trim();
  if (!host) { res.status(400).json({ error: "host query param is required" }); return; }

  let creds = await getRouterCredsByHost(host);

  /* If not in local DB, fall back to supplied query params (no password = try empty) */
  if (!creds) {
    const portRaw = parseInt(String(req.query.port ?? "8728"), 10);
    creds = {
      host,
      port: isNaN(portRaw) ? 8728 : portRaw,
      username: String(req.query.username ?? "admin"),
      password: "",
    };
  }

  try {
    const data = await fetchRouterLiveData(creds);
    res.json({ host, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

export default router;
