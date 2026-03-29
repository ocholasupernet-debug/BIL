import { Router, type IRouter } from "express";
import {
  fetchHotspotUsers,
  fetchPPPoEActive,
  fetchInterfaces,
  fetchTraffic,
  fetchRouterLiveData,
  testConnection,
  generateFirewallScript,
  getEnvCredentials,
  isPrivateIp,
  type RouterCredentials,
} from "../lib/mikrotik";
import { sbSelect, supabaseConfigured } from "../lib/supabase-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* ── Supabase isp_routers row shape ─────────────────────────────────────── */
interface SbRouter {
  id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
  status: string;
}

/* ─── Build MikroTik credentials from a Supabase row ────────────────────── */
/**
 * Maps a Supabase isp_routers row to RouterCredentials.
 *
 * Connection strategy (priority order):
 *   1. creds.host    — should be public IP or VPN-reachable hostname
 *   2. creds.bridgeIp — VPN tunnel IP, used as automatic fallback
 *
 * Port / SSL:
 *   - Default: 8728 (plain API)
 *   - Set api_ssl=true in Supabase (future column) or use port 8729 prefix in host
 *   - Remote connections should use 8729 SSL when possible
 */
function rowToCreds(row: SbRouter): RouterCredentials {
  /* Prefer host (should be public IP); bridge_ip is VPN fallback */
  const primaryHost = row.host?.trim() || "";
  const vpnFallback = row.bridge_ip?.trim() || undefined;

  /* Auto-detect SSL: if host contains :8729 pattern or is explicitly set */
  const useSSL = false; /* Can be extended via Supabase column later */
  const port   = useSSL ? 8729 : 8728;

  return {
    host:     primaryHost,
    port,
    username: row.router_username || "admin",
    password: row.router_secret   || "",
    useSSL,
    bridgeIp: vpnFallback,
  };
}

/* ─── Load credentials by Supabase isp_routers.id ───────────────────────── */
async function getRouterCreds(id: number): Promise<{ creds: RouterCredentials; row: SbRouter } | null> {
  if (!supabaseConfigured) return null;
  const rows = await sbSelect<SbRouter>(
    "isp_routers",
    `id=eq.${id}&select=id,name,host,bridge_ip,router_username,router_secret,status&limit=1`,
  );
  const row = rows[0];
  if (!row || (!row.host?.trim() && !row.bridge_ip?.trim())) return null;
  return { creds: rowToCreds(row), row };
}

/* ─── Load credentials by host IP ───────────────────────────────────────── */
async function getRouterCredsByHost(host: string): Promise<RouterCredentials | null> {
  if (!supabaseConfigured) return null;
  const rows = await sbSelect<SbRouter>(
    "isp_routers",
    `host=eq.${encodeURIComponent(host)}&select=id,name,host,bridge_ip,router_username,router_secret,status&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  return rowToCreds(row);
}

/* ─── Graceful offline error ─────────────────────────────────────────────── */
function routerErrorResponse(res: import("express").Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const isOffline =
    msg.includes("timed out") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EHOSTUNREACH") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("Cannot reach router");
  logger.warn({ err: msg }, "MikroTik API error");
  if (isOffline) {
    res.status(503).json({
      error:    "Router is offline or unreachable",
      detail:   msg,
      hint:     "Ensure the router's public IP is set, API port 8728/8729 is open, " +
                "and the VPS IP is allowed in the router's firewall. " +
                "If behind NAT, configure VPN tunnel and set bridge_ip.",
    });
  } else {
    res.status(500).json({ error: "MikroTik API error", detail: msg });
  }
}

/* ─── GET /api/router/env/live ──────────────────────────────────────────── */
router.get("/router/env/live", async (_req, res): Promise<void> => {
  const creds = getEnvCredentials();
  if (!creds) {
    res.status(503).json({
      error:  "Default router not configured",
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
router.get("/router/live-by-host", async (req, res): Promise<void> => {
  const host = String(req.query.host ?? "").trim();
  if (!host) { res.status(400).json({ error: "host query param is required" }); return; }

  const dbCreds = await getRouterCredsByHost(host);
  if (dbCreds) {
    try {
      const data = await fetchRouterLiveData(dbCreds);
      res.json({ host, source: "supabase", ...data });
    } catch (err) {
      routerErrorResponse(res, err);
    }
    return;
  }

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
    error:  "Router not found",
    detail: `No credentials stored for host "${host}". Add the router in the Routers page first.`,
  });
});

/* ─── GET /api/router/:id/test ──────────────────────────────────────────── */
/**
 * Quick connectivity test — does NOT fetch live data, just attempts to connect.
 * Returns latency, SSL status, whether VPN fallback was used, and any warnings.
 */
router.get("/router/:id/test", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP configured" }); return; }

  const { creds, row } = found;
  const warnings: string[] = [];

  if (row.host && isPrivateIp(row.host)) {
    warnings.push(
      `Host ${row.host} is a private/local IP. The cloud API server cannot ` +
      `reach this address unless it is on the same network. ` +
      `Set the router's public IP or enable VPN and use bridge_ip as a tunnel address.`
    );
  }
  if (!row.host && row.bridge_ip) {
    warnings.push(
      `No public host configured — connecting via VPN tunnel IP ${row.bridge_ip}. ` +
      `For reliable remote access, set the router's public IP as the primary host.`
    );
  }

  const result = await testConnection(creds);
  res.status(result.ok ? 200 : 503).json({
    routerId: id,
    routerName: row.name,
    configuredHost: row.host,
    vpnFallbackIp: row.bridge_ip,
    warnings: [...warnings, ...result.warnings],
    ...result,
  });
});

/* ─── GET /api/router/:id/firewall-script?vpsIp=x.x.x.x ────────────────── */
/**
 * Generates a MikroTik RouterOS firewall script that restricts API access
 * to the VPS IP only. Download and paste into the router terminal.
 *
 * Query params:
 *   vpsIp  — IP of the VPS/server that runs this backend (required)
 *   ssl    — "true" to include port 8729 (API-SSL) rules (default: true)
 */
router.get("/router/:id/firewall-script", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const vpsIp = String(req.query.vpsIp ?? "").trim();
  if (!vpsIp) {
    res.status(400).json({
      error:  "vpsIp query parameter is required",
      detail: "Pass the public IP of your VPS server, e.g. ?vpsIp=203.0.113.42",
    });
    return;
  }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const enableApiSsl = req.query.ssl !== "false";
  const script = generateFirewallScript(vpsIp, {
    enableApiSsl,
    comment: `ISP-${id}`,
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="mikrotik-firewall-router${id}.rsc"`
  );
  res.send(script);
});

/* ─── GET /api/router/:id/hotspot ──────────────────────────────────────── */
router.get("/router/:id/hotspot", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const users = await fetchHotspotUsers(found.creds);
    res.json({ routerId: id, users, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/pppoe ─────────────────────────────────────────── */
router.get("/router/:id/pppoe", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const sessions = await fetchPPPoEActive(found.creds);
    res.json({ routerId: id, sessions, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/interfaces ──────────────────────────────────── */
router.get("/router/:id/interfaces", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const interfaces = await fetchInterfaces(found.creds);
    res.json({ routerId: id, interfaces, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/traffic ──────────────────────────────────────── */
router.get("/router/:id/traffic", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const ifaces = req.query.ifaces ? String(req.query.ifaces).split(",").filter(Boolean) : [];
    const traffic = await fetchTraffic(found.creds, ifaces);
    res.json({ routerId: id, traffic, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/live ─────────────────────────────────────────── */
router.get("/router/:id/live", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const data = await fetchRouterLiveData(found.creds);
    res.json({ routerId: id, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

export default router;
