import * as net from "net";
import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect, sbUpdate, sbDelete, sbInsert } from "../lib/supabase-client.js";
import { pingRouter, detectBridgeInterfaces, fetchBridgePortLayout } from "../lib/mikrotik.js";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activity-log.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";

/* ── TCP reachability probe — tries common MikroTik ports ───────────────────
 * Returns the first port that responds, or null if all fail.
 * Used as a fallback when the RouterOS API (8728) is unavailable.
 * ─────────────────────────────────────────────────────────────────────────── */
const PROBE_PORTS = [8291, 22, 80, 443, 21];   /* Winbox, SSH, HTTP, HTTPS, FTP */
const PROBE_TIMEOUT_MS = 4_000;

async function tcpProbe(host: string): Promise<number | null> {
  if (!host) return null;
  const results = await Promise.allSettled(
    PROBE_PORTS.map(port =>
      new Promise<number>((resolve, reject) => {
        const sock = new net.Socket();
        const timer = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, PROBE_TIMEOUT_MS);
        sock.connect(port, host, () => {
          clearTimeout(timer);
          sock.destroy();
          resolve(port);
        });
        sock.on("error", (e) => { clearTimeout(timer); reject(e); });
      })
    )
  );
  for (const r of results) {
    if (r.status === "fulfilled") return r.value;
  }
  return null;
}

const router: IRouter = Router();

function isPendingSetup(status: string | null | undefined): boolean {
  return status === "setup"
    || status === "awaiting_ports"
    || status === "awaiting_sync"
    || status === "awaiting_connection";
}

function cleanRouterHost(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+\((?:VPN tunnel|⚠ LAN IP — only reachable on local network)\)\s*$/u, "");
}

function discoverVpnIp(
  name: string,
  host: string,
  configuredIp: string | null | undefined,
  configuredVpnIp?: string | null,
): string | undefined {
  const clients = readVpnClients();
  const managementIp = (value: string | null | undefined): string | undefined => {
    const ip = value?.trim() ?? "";
    return /^10\.8\.5\.\d+$/.test(ip) ? ip : undefined;
  };
  /* The persisted management address is authoritative. A live status-file
     match is useful for older records, but must not replace a configured
     10.8.5.x address with a legacy/customer tunnel address or LAN gateway. */
  return managementIp(configuredVpnIp)
    || managementIp(vpnIpFor(name, clients))
    || managementIp(vpnIpFor(cleanRouterHost(host), clients))
    || managementIp(configuredIp)
    || undefined;
}

/*
 * /api/routers — thin proxy to Supabase isp_routers.
 * The frontend Routers.tsx page writes to Supabase directly; this route is
 * used by server-side flows (e.g. BridgePorts credential lookup) and any
 * integrations that prefer the REST API over the Supabase JS SDK.
 *
 * Query param:  adminId (preferred) or ispId (alias) — filters by admin_id
 */

router.get("/routers", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.query.adminId ?? req.query.ispId);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "The requested ISP account does not match the signed-in admin session." });
    return;
  }
  const rows = await sbSelect(
    "isp_routers",
    `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,proxy_ip,bridge_interface,router_username,status,last_seen,last_connected_host,model,ros_version,ip_address`,
  );
  res.json(rows);
});

type InstallRouter = {
  id: number;
  admin_id: number;
  name: string;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
  status: string;
  last_seen: string | null;
  model: string | null;
  ros_version: string | null;
  last_connected_host: string | null;
};

function managementVpnIp(row: InstallRouter): string | null {
  const discovered = vpnIpFor(row.name, readVpnClients());
  const candidates = [row.vpn_ip, discovered].filter((value): value is string => Boolean(value?.trim()));
  return candidates.find(value => /^10\.8\.5\.\d+$/.test(value.trim()))?.trim() ?? null;
}

async function probeInstallRouter(row: InstallRouter): Promise<{
  router: InstallRouter;
  vpnIp: string | null;
  connected: boolean;
  via: string | null;
  probe?: import("../lib/mikrotik.js").RouterPingResult;
  error?: string;
}> {
  const vpnIp = managementVpnIp(row);
  if (!vpnIp) {
    return {
      router: row,
      vpnIp: null,
      connected: false,
      via: null,
      error: "Waiting for the router-management VPN tunnel (10.8.5.x) to connect.",
    };
  }

  try {
    const probe = await pingRouter({
      host: vpnIp,
      port: 8728,
      username: row.router_username || "admin",
      password: row.router_secret || "",
      bridgeIp: vpnIp,
      connectTimeoutMs: 8_000,
      requestTimeoutMs: 8_000,
    });
    return { router: row, vpnIp, connected: probe.connectedHost === vpnIp, via: probe.connectedHost, probe };
  } catch (error) {
    return {
      router: row,
      vpnIp,
      connected: false,
      via: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* Self-install readiness probe. It intentionally uses only the isolated
 * management VPN and never falls back to a public or LAN address. */
router.get("/admin/router/install-status/:id", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = authenticatedAdminId(req, req.query.adminId);
  const installationMode = String(req.query.mode ?? "").trim().toLowerCase() === "coexist" ? "coexist" : "takeover";
  if (!Number.isInteger(routerId) || routerId <= 0 || !Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required" });
    return;
  }

  const rows = await sbSelect<InstallRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,vpn_ip,router_username,router_secret,status,last_seen,model,ros_version,last_connected_host&limit=1`,
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ ok: false, error: "Router not found for this ISP account" });
    return;
  }

  const result = await probeInstallRouter(row);
  const heartbeatAgeMs = row.last_seen ? Date.now() - new Date(row.last_seen).getTime() : Number.POSITIVE_INFINITY;
  const heartbeatRecent = heartbeatAgeMs >= 0 && heartbeatAgeMs < 15 * 60 * 1000;
  const scriptComplete = installationMode === "coexist" || !["setup", "awaiting_connection"].includes(row.status);
  const ready = result.connected && !!result.probe?.identity && !!result.probe?.version
    && scriptComplete && (row.status !== "awaiting_ports" || heartbeatRecent);
  if (result.connected && result.probe) {
    await sbUpdate("isp_routers", `id=eq.${routerId}&admin_id=eq.${adminId}`, {
      host: result.vpnIp,
      last_connected_host: result.vpnIp,
      model: result.probe.board || row.model,
      ros_version: result.probe.version || row.ros_version,
      updated_at: result.probe.connectedAt,
    });
  }

  res.json({
    ok: true,
    ready,
    scriptComplete,
    connected: result.connected,
    vpnConnected: !!result.vpnIp,
    vpnIp: result.vpnIp,
    via: result.via,
    heartbeat: { recent: heartbeatRecent, lastSeen: row.last_seen },
    router: {
      id: row.id,
      name: row.name,
      status: row.status,
      model: result.probe?.board || row.model || "MikroTik",
      rosVersion: result.probe?.version || row.ros_version || "",
      identity: result.probe?.identity || "",
      uptime: result.probe?.uptime || "",
    },
    error: result.error,
  });
});

/* Final installation gate. Re-probes through the management VPN before
 * promoting a setup record into the normal online router list. */
router.post("/admin/router/install-complete", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.body?.routerId);
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  const bridgeName = typeof req.body?.bridge === "string" ? req.body.bridge.trim() : "";
  const installationMode = req.body?.installationMode === "coexist" ? "coexist" : "takeover";
  const desiredPorts = Array.isArray(req.body?.ports)
    ? req.body.ports.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (!Number.isInteger(routerId) || routerId <= 0 || !Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required" });
    return;
  }
  if (installationMode === "coexist" && desiredPorts.length === 0) {
    res.status(400).json({
      ok: false,
      error: "Coexistence requires at least one physical port assigned to the isolated Ochola bridge.",
    });
    return;
  }

  const rows = await sbSelect<InstallRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,vpn_ip,router_username,router_secret,status,last_seen,model,ros_version,last_connected_host&limit=1`,
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ ok: false, error: "Router not found for this ISP account" });
    return;
  }
  const result = await probeInstallRouter(row);
  if (!result.connected || !result.probe?.identity || !result.probe.version) {
    res.status(409).json({
      ok: false,
      error: result.error || "The router is not ready through the management VPN yet.",
      vpnIp: result.vpnIp,
    });
    return;
  }

  if (bridgeName) {
    try {
      const layout = await fetchBridgePortLayout({
        host: result.vpnIp!,
        port: 8728,
        username: row.router_username || "admin",
        password: row.router_secret || "",
        bridgeIp: result.vpnIp!,
        connectTimeoutMs: 8_000,
        requestTimeoutMs: 8_000,
      });
      if (!layout.bridges.some(bridge => bridge.name === bridgeName)) {
        res.status(409).json({ ok: false, error: `Bridge "${bridgeName}" could not be verified on the router.` });
        return;
      }
      if (installationMode === "coexist") {
        const expectedBridge = `ochola-hs-${routerId}`;
        if (bridgeName !== expectedBridge) {
          res.status(400).json({
            ok: false,
            error: `Coexistence must finish against the isolated Ochola bridge "${expectedBridge}".`,
          });
          return;
        }
        const foreignAssignments = layout.bridgePorts
          .filter(port => desiredPorts.includes(port.interface) && port.bridge !== expectedBridge)
          .map(port => `${port.interface} (${port.bridge})`);
        if (foreignAssignments.length) {
          res.status(409).json({
            ok: false,
            error: `Coexistence will not claim ports already assigned to another billing bridge: ${foreignAssignments.join(", ")}.`,
          });
          return;
        }
      }
      const members = new Set(
        layout.bridgePorts.filter(port => port.bridge === bridgeName).map(port => port.interface),
      );
      const missing = desiredPorts.filter((port: string) => !members.has(port));
      if (missing.length) {
        res.status(409).json({
          ok: false,
          error: `Bridge membership could not be verified for: ${missing.join(", ")}`,
        });
        return;
      }
    } catch (error) {
      res.status(409).json({
        ok: false,
        error: `The router connected, but bridge membership could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  }

  const updated = await sbUpdate<InstallRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}`,
    {
      status: "online",
      host: result.vpnIp,
      ...(bridgeName ? { bridge_interface: bridgeName } : {}),
      last_seen: result.probe.connectedAt,
      last_connected_host: result.vpnIp,
      model: result.probe.board || row.model,
      ros_version: result.probe.version || row.ros_version,
      updated_at: result.probe.connectedAt,
    },
  );
  if (!updated[0]) {
    res.status(503).json({ ok: false, error: "The router connected, but its installation status could not be saved." });
    return;
  }
  res.json({
    ok: true,
    router: {
      id: routerId,
      name: row.name,
      model: result.probe.board || row.model || "MikroTik",
      rosVersion: result.probe.version,
      vpnIp: result.vpnIp,
      identity: result.probe.identity,
      uptime: result.probe.uptime,
    },
  });
});

router.post("/routers", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, name, host, ipAddress, model, rosVersion, apiPort, router_username, apiUsername, router_secret, apiPassword, bridge_ip, status } = req.body;
  const effectiveAdminId = adminId || ispId || 1;
  if (!name || !host) {
    res.status(400).json({ error: "name and host are required" });
    return;
  }
  const [r] = await sbInsert<Record<string, unknown>>("isp_routers", {
    admin_id:         effectiveAdminId,
    name,
    host:             host || ipAddress || "",
    model:            model ?? null,
    ros_version:      rosVersion ?? null,
    router_username:  router_username || apiUsername || "admin",
    router_secret:    router_secret  || apiPassword  || null,
    bridge_ip:        bridge_ip ?? null,
    status:           status ?? "offline",
  });
  if (!r) { res.status(500).json({ error: "Failed to create router" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "router", action: "added", subject: name, details: { host: host || ipAddress } });
  res.status(201).json(r);
});

router.patch("/routers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { name, host, ipAddress, model, rosVersion, status, router_username, apiUsername, router_secret, apiPassword, bridge_ip, proxy_ip } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name           !== undefined) updates.name            = name;
  if (host           !== undefined) updates.host            = host;
  if (ipAddress      !== undefined) updates.host            = ipAddress;
  if (model          !== undefined) updates.model           = model;
  if (rosVersion     !== undefined) updates.ros_version     = rosVersion;
  if (status         !== undefined) updates.status          = status;
  if (router_username !== undefined) updates.router_username = router_username;
  if (apiUsername    !== undefined) updates.router_username = apiUsername;
  if (router_secret  !== undefined) updates.router_secret   = router_secret;
  if (apiPassword    !== undefined) updates.router_secret   = apiPassword;
  if (bridge_ip      !== undefined) updates.bridge_ip       = bridge_ip;
  if (proxy_ip       !== undefined) updates.proxy_ip        = proxy_ip;
  const [r] = await sbUpdate<Record<string, unknown>>("isp_routers", `id=eq.${id}`, updates);
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const adminIdForLog = req.body?.adminId ?? req.query.adminId ?? 1;
  void logActivity({ adminId: Number(adminIdForLog), type: "router", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(r);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const adminId = parseInt(String(req.query.adminId ?? req.body?.adminId ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  if (!Number.isInteger(adminId) || adminId < 1) {
    res.status(400).json({ error: "adminId query param is required" });
    return;
  }

  const rows = await sbSelect<{ name: string; admin_id: number }>(
    "isp_routers",
    `id=eq.${id}&admin_id=eq.${adminId}&select=name,admin_id&limit=1`,
  );
  const row = rows[0];
  if (!row) { res.status(404).json({ error: "Router not found or not assigned to this administrator" }); return; }

  /* ── Best-effort cascade clean-up of child records that may have a
     foreign-key constraint on isp_routers(id). Each delete is wrapped
     so a missing table or absent FK never aborts the whole operation. */
  const childTables = [
    "isp_ip_pools",
    "isp_ppp_secrets",
    "isp_pppoe_users",
    "isp_hotspot_users",
    "isp_bridge_ports",
    "isp_router_history",
    "isp_router_sessions",
    "isp_active_sessions",
    "isp_router_pings",
    "isp_router_metrics",
  ];
  for (const t of childTables) {
    try { await sbDelete(t, `router_id=eq.${id}`); } catch { /* ignore */ }
  }

  /* ── Now delete the router itself. If it still fails (e.g. an unknown
     FK), report the error so the UI can show it instead of silently
     leaving the row in place. */
  try {
    await sbDelete("isp_routers", `id=eq.${id}`);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Delete failed" });
    return;
  }

  /* Confirm the row is actually gone — sbDelete swallows non-2xx responses */
  const verify = await sbSelect<{ id: number }>("isp_routers", `id=eq.${id}&admin_id=eq.${adminId}&select=id&limit=1`);
  if (verify.length > 0) {
    res.status(500).json({
      error: "Router could not be deleted — it may still be referenced by other records. Remove related VPN users, IP pools, or sessions first.",
    });
    return;
  }

  void logActivity({ adminId: row.admin_id, type: "router", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

/* ══ POST /api/routers/:id/ping ═════════════════════════════════════════════
 * Tries to connect to the router via RouterOS API.
 * Updates status + last_seen in Supabase and returns the result.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/routers/:id/ping", async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;

  const rows = await sbSelect<{
    id: number; name: string; host: string; bridge_ip: string | null; vpn_ip: string | null;
    router_username: string; router_secret: string | null; status: string;
  }>("isp_routers", `id=eq.${id}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret,status&limit=1`);

  const row = rows[0];
  if (!row) { res.status(404).json({ ok: false, error: "Router not found" }); return; }

  const host = cleanRouterHost(row.host);
  const discoveredVpnIp = discoverVpnIp(row.name, host, row.bridge_ip, row.vpn_ip);
  const creds = {
    host:     host || discoveredVpnIp || "",
    port:     8728,
    username: row.router_username   || "admin",
    password: row.router_secret     || "",
    useSSL:   false,
    bridgeIp: discoveredVpnIp,
    connectTimeoutMs:  8000,
    requestTimeoutMs:  8000,
  };

  try {
    const result = await pingRouter(creds);
    const now = result.connectedAt;
    await sbUpdate("isp_routers", `id=eq.${id}`, {
      ...(!isPendingSetup(row.status) ? { status: "online", last_seen: now } : {}),
      ...(discoveredVpnIp && discoveredVpnIp !== row.vpn_ip ? { vpn_ip: discoveredVpnIp } : {}),
      last_connected_host: result.connectedHost,
      model: result.board || undefined, ros_version: result.version || undefined,
      updated_at: now,
      ...(result.uptime ? { router_uptime: result.uptime, uptime_at: now } : {}),
    });
    logger.info({ routerId: id, identity: result.identity }, "[router/ping] online via API");
    res.json({ ok: true, via: result.connectedHost === discoveredVpnIp ? "vpn" : "direct", ...result });
  } catch (apiErr) {
    /* API failed — try TCP fallback on common ports */
    const openPort = await tcpProbe(host || discoveredVpnIp || "");
    if (openPort !== null) {
      const now = new Date().toISOString();
      await sbUpdate("isp_routers", `id=eq.${id}`, {
        ...(!isPendingSetup(row.status) ? { status: "offline" } : {}),
        updated_at: now,
      });
      logger.warn({ routerId: id, host, port: openPort }, "[router/ping] TCP reachable but RouterOS API unavailable");
      res.json({ ok: false, online: false, apiOnline: false, via: `tcp:${openPort}`, error: `Router TCP port ${openPort} is reachable, but RouterOS API authentication or port 8728 is unavailable. Migration and export remain blocked until the API succeeds.`, details: (apiErr as Error).message });
    } else {
      const error = (apiErr as Error).message;
      await sbUpdate("isp_routers", `id=eq.${id}`, {
        ...(!isPendingSetup(row.status) ? { status: "offline" } : {}),
        updated_at: new Date().toISOString(),
      });
      logger.warn({ routerId: id, error }, "[router/ping] offline");
      res.json({ ok: false, online: false, error });
    }
  }
});

/* ══ POST /api/routers/ping-all ═════════════════════════════════════════════
 * Pings every router for an admin and returns a summary.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/routers/ping-all", async (req: Request, res: Response): Promise<void> => {
  const adminId = req.body?.adminId ?? req.query.adminId ?? "1";

  const routers = await sbSelect<{
    id: number; name: string; host: string; bridge_ip: string | null; vpn_ip: string | null;
    router_username: string; router_secret: string | null; status: string;
  }>("isp_routers", `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret,status`);

  if (!routers.length) { res.json({ ok: true, results: [], total: 0 }); return; }

  const results = await Promise.allSettled(
    routers.map(async (row) => {
      const host = cleanRouterHost(row.host);
      const discoveredVpnIp = discoverVpnIp(row.name, host, row.bridge_ip, row.vpn_ip);
      const creds = {
        host:     host || discoveredVpnIp || "",
        port:     8728,
        username: row.router_username   || "admin",
        password: row.router_secret     || "",
        useSSL:   false,
        bridgeIp: discoveredVpnIp,
        connectTimeoutMs: 8000,
        requestTimeoutMs: 8000,
      };
      try {
        const r = await pingRouter(creds);
        await sbUpdate("isp_routers", `id=eq.${row.id}`, {
          ...(!isPendingSetup(row.status) ? { status: "online", last_seen: r.connectedAt } : {}),
          ...(discoveredVpnIp && discoveredVpnIp !== row.vpn_ip ? { vpn_ip: discoveredVpnIp } : {}),
          last_connected_host: r.connectedHost,
          model: r.board || undefined, ros_version: r.version || undefined,
          updated_at: r.connectedAt,
          ...(r.uptime ? { router_uptime: r.uptime, uptime_at: r.connectedAt } : {}),
        });
        return { id: row.id, name: row.name, online: true, identity: r.identity, uptime: r.uptime };
      } catch (err) {
        /* Only write "offline" in production — in dev the VPS is the source of truth */
        if (process.env.NODE_ENV === "production" && !isPendingSetup(row.status)) {
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status: "offline", updated_at: new Date().toISOString(),
          });
        }
        return { id: row.id, name: row.name, online: false, error: (err as Error).message };
      }
    })
  );

  const mapped = results.map(r => r.status === "fulfilled" ? r.value : { online: false, error: "unexpected" });
  const online  = mapped.filter(r => r.online).length;
  const offline = mapped.length - online;

  logger.info({ online, offline }, "[router/ping-all] sweep complete");
  res.json({ ok: true, results: mapped, total: mapped.length, online, offline });
});

/* ══ GET /api/routers/:id/detect-bridge ════════════════════════════════════
 * Connects to the router, fetches all /interface/bridge names, picks the
 * best candidate, saves it to bridge_interface in the DB, and returns the
 * full list + chosen value. No-op if the router can't be reached.
 * ══════════════════════════════════════════════════════════════════════════ */
router.get("/routers/:id/detect-bridge", async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;

  const rows = await sbSelect<{
    id: number; host: string; bridge_ip: string | null; vpn_ip: string | null;
    router_username: string; router_secret: string | null;
  }>("isp_routers", `id=eq.${id}&select=id,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`);

  const row = rows[0];
  if (!row) { res.status(404).json({ ok: false, error: "Router not found" }); return; }

  const creds = {
    host:     row.vpn_ip?.trim()    || row.host?.trim() || "",
    port:     8728,
    username: row.router_username   || "admin",
    password: row.router_secret     || "",
    useSSL:   false,
    bridgeIp: row.vpn_ip?.trim()   || row.bridge_ip?.trim() || undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 8_000,
  };

  try {
    const { bridgeInterfaces, detectedBridgeInterface } = await detectBridgeInterfaces(creds);

    if (detectedBridgeInterface) {
      await sbUpdate("isp_routers", `id=eq.${id}`, {
        bridge_interface: detectedBridgeInterface,
        updated_at:       new Date().toISOString(),
      });
      logger.info({ routerId: id, detectedBridgeInterface, all: bridgeInterfaces }, "[detect-bridge] saved");
    }

    res.json({ ok: true, bridgeInterfaces, detectedBridgeInterface: detectedBridgeInterface ?? null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ routerId: id, error }, "[detect-bridge] failed");
    res.status(503).json({ ok: false, error });
  }
});

/* ── Hysteresis: only write "offline" after OFFLINE_THRESHOLD consecutive failures ── */
const OFFLINE_THRESHOLD = 2;
const failureCount = new Map<number, number>();

/* ══ Exported helper for background monitor ════════════════════════════════ */
export async function sweepAllRouters(): Promise<void> {
  try {
    const routers = await sbSelect<{
      id: number; name: string; host: string; bridge_ip: string | null; vpn_ip: string | null;
      router_username: string; router_secret: string | null;
    }>("isp_routers", "status=not.in.(setup,awaiting_ports,awaiting_sync,awaiting_connection)&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret");

    if (!routers.length) return;

    await Promise.allSettled(
      routers.map(async (row) => {
        const host = cleanRouterHost(row.host);
        const discoveredVpnIp = discoverVpnIp(row.name, host, row.bridge_ip, row.vpn_ip);
        const creds = {
          host:     host || discoveredVpnIp || "",
          port:     8728,
          username: row.router_username   || "admin",
          password: row.router_secret     || "",
          useSSL:   false,
          bridgeIp: discoveredVpnIp,
          connectTimeoutMs: 10_000,
          requestTimeoutMs: 10_000,
        };
        try {
          const r = await pingRouter(creds);
          /* Reset failure counter on success */
          failureCount.set(row.id, 0);
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status: "online", last_seen: r.connectedAt,
            last_connected_host: r.connectedHost,
            ...(discoveredVpnIp && discoveredVpnIp !== row.vpn_ip ? { vpn_ip: discoveredVpnIp } : {}),
            model: r.board || undefined, ros_version: r.version || undefined,
            updated_at: r.connectedAt,
            ...(r.uptime ? { router_uptime: r.uptime, uptime_at: r.connectedAt } : {}),
          });
          logger.info({ id: row.id, name: row.name, identity: r.identity }, "[monitor] router online via API");
        } catch (apiErr) {
          /* API failed — try TCP fallback on common ports before counting as failure */
          const host = row.vpn_ip?.trim() || row.host?.trim() || row.bridge_ip?.trim() || "";
          const openPort = await tcpProbe(host);
          if (openPort !== null) {
            /* Host is reachable — reset failures, mark online */
            failureCount.set(row.id, 0);
            const now = new Date().toISOString();
            await sbUpdate("isp_routers", `id=eq.${row.id}`, {
              status: "online", last_seen: now, updated_at: now,
            });
            logger.info({ id: row.id, name: row.name, port: openPort }, "[monitor] router online via TCP fallback");
          } else {
            const prev = failureCount.get(row.id) ?? 0;
            const next = prev + 1;
            failureCount.set(row.id, next);
            logger.warn({ id: row.id, name: row.name, failures: next, err: (apiErr as Error).message }, "[monitor] router unreachable");

            /* Only write "offline" after OFFLINE_THRESHOLD consecutive failures.
               In dev mode skip entirely — dev server can't reach VPN IPs. */
            if (process.env.NODE_ENV === "production" && next >= OFFLINE_THRESHOLD) {
              await sbUpdate("isp_routers", `id=eq.${row.id}`, {
                status: "offline", updated_at: new Date().toISOString(),
              });
              logger.warn({ id: row.id, name: row.name }, "[monitor] router marked offline");
            }
          }
        }
      })
    );
  } catch (err) {
    logger.error({ err }, "[monitor] sweep error");
  }
}

export default router;
