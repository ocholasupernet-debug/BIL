import { Router, type IRouter } from "express";
import { eq, or, ilike } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
import {
  fetchHotspotUsers,
  fetchPPPoEActive,
  fetchInterfaces,
  fetchTraffic,
  fetchRouterLiveData,
  getEnvCredentials,
  type RouterCredentials,
} from "../lib/mikrotik";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* ─── Helper: build credentials from a DB row ────────────────────────────── */
function rowToCreds(row: typeof routersTable.$inferSelect): RouterCredentials {
  const port   = row.apiPort  ?? 8728;
  const useSSL = row.apiUseSSL ?? (port === 8729);
  return {
    host:     row.ipAddress,
    port,
    username: row.apiUsername ?? "admin",
    password: row.apiPassword ?? "",
    useSSL,
  };
}

/* ─── Helper: load credentials by local DB id ────────────────────────────── */
async function getRouterCreds(id: number): Promise<RouterCredentials | null> {
  if (!db) return null;
  const rows = await db.select().from(routersTable).where(eq(routersTable.id, id));
  const row = rows[0];
  if (!row) return null;
  return rowToCreds(row);
}

/* ─── Helper: load credentials by host / IP ─────────────────────────────── */
async function getRouterCredsByHost(host: string): Promise<RouterCredentials | null> {
  if (!db) return null;
  const rows = await db.select().from(routersTable).where(
    or(eq(routersTable.ipAddress, host), ilike(routersTable.name, host))
  );
  const row = rows[0];
  if (!row) return null;
  return rowToCreds(row);
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

/* ─── GET /api/router/env/live ── uses MIKROTIK_* environment variables ──── */
router.get("/router/env/live", async (_req, res): Promise<void> => {
  const creds = getEnvCredentials();

  if (!creds) {
    res.status(503).json({
      error: "Default router not configured",
      detail: "Set MIKROTIK_HOST and MIKROTIK_PASSWORD environment variables to enable this endpoint.",
    });
    return;
  }

  try {
    const data = await fetchRouterLiveData(creds);
    res.json({ source: "env", host: creds.host, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/live-by-host?host=x.x.x.x ─────────────────────────── */
/* Credentials come from the local DB. Falls back to env-var credentials       */
/* when the host is not in the DB. Password is never accepted from the client. */
router.get("/router/live-by-host", async (req, res): Promise<void> => {
  const host = String(req.query.host ?? "").trim();
  if (!host) { res.status(400).json({ error: "host query param is required" }); return; }

  const dbCreds = await getRouterCredsByHost(host);

  if (dbCreds) {
    /* DB credentials take priority — password stays server-side */
    try {
      const data = await fetchRouterLiveData(dbCreds);
      res.json({ host, source: "db", ...data });
    } catch (err) {
      routerErrorResponse(res, err);
    }
    return;
  }

  /* Fall back to env-var credentials if the IP matches MIKROTIK_HOST */
  const envCreds = getEnvCredentials();
  if (envCreds && envCreds.host === host) {
    try {
      const data = await fetchRouterLiveData(envCreds);
      res.json({ host, source: "env", ...data });
    } catch (err) {
      routerErrorResponse(res, err);
    }
    return;
  }

  res.status(404).json({
    error: "Router not found",
    detail: `No credentials stored for host "${host}". Add the router in the Routers page first.`,
  });
});

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
    res.json({ routerId: id, interfaces, fetchedAt: new Date().toISOString() });
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
    res.json({ routerId: id, traffic, fetchedAt: new Date().toISOString() });
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

export default router;
