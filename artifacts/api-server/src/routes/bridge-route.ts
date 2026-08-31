/**
 * Bridge Port Management Routes
 *
 * POST /api/admin/router/ports
 *   Connects to a MikroTik router and returns its interfaces, bridge
 *   objects, and current bridge-port memberships.
 *   Body: { host, username, password, bridgeIp?, routerId?, routerCn? }
 *
 * POST /api/admin/router/bridge-assign
 *   Adds or removes interfaces from a named bridge on the router.
 *   Body: { host, username, password, bridge, addPorts, removePorts, bridgeIp? }
 *
 * POST /api/admin/router/bridge-create
 *   Creates a new bridge on the router (idempotent — skips if it already exists).
 *   Body: { host, username, password, bridgeName, bridgeIp?, port? }
 */

import { Router, type IRouter } from "express";
import {
  fetchBridgePortLayout,
  assignBridgePorts,
  createBridge,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import { sbSelect } from "../lib/supabase-client.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();

function buildCreds(body: {
  host: string;
  username: string;
  password: string;
  port?: number;
  bridgeIp?: string;
}): RouterCredentials {
  const port = body.port ?? 8728;
  return {
    host:     body.host.trim(),
    port,
    username: body.username.trim(),
    password: body.password ?? "",
    useSSL:   port === 8729,
    bridgeIp: body.bridgeIp?.trim() || undefined,
  };
}

type StoredRouter = {
  id: number;
  admin_id: number;
  name: string;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
  status: string;
};

function coexistenceBridgeName(routerId: number): string {
  return "co-hotspot-bridge";
}

async function storedRouterCredentials(
  routerId: number,
  adminId: number | undefined,
): Promise<{ router: StoredRouter; creds: RouterCredentials }> {
  if (!Number.isInteger(routerId) || routerId <= 0) {
    throw new Error("A valid routerId is required");
  }
  if (!Number.isInteger(adminId) || !adminId || adminId <= 0) {
    throw new Error("adminId is required when using routerId");
  }

  const rows = await sbSelect<StoredRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,vpn_ip,router_username,router_secret,status&limit=1`,
  );
  const stored = rows[0];
  if (!stored) throw new Error("Router not found for this ISP account");

  const vpnIp = stored.vpn_ip?.trim() || vpnIpFor(stored.name, readVpnClients()) || undefined;
  const host = vpnIp || stored.host?.trim() || stored.bridge_ip?.trim() || "";
  if (!host) throw new Error("This router has no reachable VPN or host address yet");

  const setupPending = ["setup", "awaiting_connection", "awaiting_ports", "awaiting_sync"]
    .includes(stored.status);
  if (setupPending && !vpnIp) {
    throw new Error("The router-management VPN is not connected yet. Re-run the installer and wait for the tunnel.");
  }

  return {
    router: stored,
    creds: {
      host,
      port: 8728,
      username: stored.router_username || "admin",
      password: stored.router_secret || "",
      bridgeIp: vpnIp || stored.bridge_ip?.trim() || undefined,
      connectTimeoutMs: 10_000,
      requestTimeoutMs: 12_000,
    },
  };
}

async function resolveRequestCredentials(body: {
  host?: string;
  username?: string;
  password?: string;
  port?: number;
  bridgeIp?: string;
  routerId?: number;
  adminId?: number;
}): Promise<{ creds: RouterCredentials; router?: StoredRouter }> {
  if (body.routerId !== undefined && body.routerId !== null) {
    return storedRouterCredentials(Number(body.routerId), Number(body.adminId));
  }
  if (!body.host || !body.username) throw new Error("host and username are required");
  return { creds: buildCreds({
    host: body.host,
    username: body.username,
    password: body.password ?? "",
    port: body.port,
    bridgeIp: body.bridgeIp,
  }) };
}

/* ─── POST /api/admin/router/ports ─────────────────────────────────────── */
router.post("/admin/router/self-install/ports", requireAdmin(), async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp, port, installationMode, routerId, adminId } = req.body as {
    host: string;
    username: string;
    password: string;
    bridgeIp?: string;
    port?: number;
    routerId?: number;
    adminId?: number;
    installationMode?: "coexist" | "takeover";
  };

  try {
    const { creds } = await resolveRequestCredentials({
      host, username, password, bridgeIp, port,
       routerId,
       adminId: authenticatedAdminId(req, adminId),
    });
    const layout = await fetchBridgePortLayout(creds);
    const coexistenceBridge = installationMode === "coexist" && routerId
      ? coexistenceBridgeName(Number(routerId))
      : null;
    res.json({ ok: true, ...layout, coexistenceBridge });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      ok: false,
      error: msg,
      interfaces: [],
      bridges: [],
      bridgePorts: [],
    });
  }
});

/* ─── POST /api/admin/router/bridge-assign ──────────────────────────────── */
router.post("/admin/router/self-install/bridge-assign", requireAdmin(), async (req, res): Promise<void> => {
  const { host, username, password, bridge, addPorts, removePorts, desiredPorts, bridgeIp, port, routerId, adminId, installationMode } = req.body as {
    host: string;
    username: string;
    password: string;
    bridge: string;
    addPorts?: string[];
    removePorts?: string[];
    desiredPorts?: string[];
    bridgeIp?: string;
    port?: number;
    routerId?: number;
    adminId?: number;
    installationMode?: "coexist" | "takeover";
  };

  if (!bridge) {
    res.status(400).json({ ok: false, error: "bridge is required" });
    return;
  }

  let resolved: { creds: RouterCredentials; router?: StoredRouter };
  try {
      resolved = await resolveRequestCredentials({
      host, username, password, bridgeIp, port, routerId,
      adminId: authenticatedAdminId(req, adminId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, error: message, logs: [`❌ ${message}`] });
    return;
  }
  const creds = resolved.creds;
  const add = Array.isArray(addPorts) ? addPorts : [];
  const remove = Array.isArray(removePorts) ? removePorts : [];
  if (installationMode === "coexist") {
    if (!routerId) {
      res.status(400).json({ ok: false, error: "Coexistence port changes require a router-scoped request.", logs: ["❌ Router-scoped coexistence request required"] });
      return;
    }
    const expectedBridge = coexistenceBridgeName(Number(routerId));
    if (bridge !== expectedBridge) {
      res.status(400).json({
        ok: false,
        error: `Coexistence can only use the isolated Ochola bridge "${expectedBridge}".`,
        logs: [`❌ Use isolated bridge ${expectedBridge}; existing billing bridges are protected.`],
      });
      return;
    }
    try {
      const before = await fetchBridgePortLayout(creds);
      if (!before.bridges.some(item => item.name === expectedBridge)) {
        res.status(409).json({
          ok: false,
          error: `The isolated Ochola bridge "${expectedBridge}" is not present yet. Re-run the Coexistence installer before assigning ports.`,
          logs: [`❌ Missing isolated bridge ${expectedBridge}; no port was changed.`],
        });
        return;
      }
      const conflicts = add
        .map(portName => before.bridgePorts.find(item => item.interface === portName))
        .filter((item): item is { bridge: string; interface: string; id: string } => !!item && item.bridge !== expectedBridge)
        .map(item => `${item.interface} (currently on ${item.bridge})`);
      if (conflicts.length) {
        res.status(409).json({
          ok: false,
          error: `Coexistence will not move ports already assigned to another billing bridge: ${conflicts.join(", ")}.`,
          logs: [`❌ Existing billing port assignment preserved: ${conflicts.join(", ")}`],
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: `Could not verify existing bridge ownership: ${message}`, logs: [`❌ No port was changed: ${message}`] });
      return;
    }
  }
  const protectedNames = new Set(["ether1", "corebillingvpn", "coreispbilling", "ocholasupernet", "ocholasuperproxy"]);
  const safePort = (value: unknown): value is string => {
    if (typeof value !== "string" || !value.trim()) return false;
    const name = value.trim();
    if (protectedNames.has(name) || name.toLowerCase().includes("ovpn")) return false;
    return /^(ether|wlan|wifi|sfp|combo|lte|bond|bridge)/i.test(name);
  };
  if (add.some(portName => !safePort(portName)) || remove.some(portName => !safePort(portName))) {
    res.status(400).json({
      ok: false,
      error: "WAN and management interfaces cannot be changed from this setup flow",
      logs: ["❌ WAN and management interfaces cannot be changed from this setup flow"],
    });
    return;
  }

  try {
    const logs = await assignBridgePorts(creds, bridge, add, remove);
    const failedWrite = logs.some(line => /^\s*[✗❌]/.test(line));
    if (failedWrite) {
      res.status(502).json({ ok: false, error: "RouterOS reported a bridge change failure", logs });
      return;
    }

    /* Read the membership back through the same management path. This makes
       the per-click UI state trustworthy even when RouterOS accepts a write
       but rejects one item internally. */
    const verified = await fetchBridgePortLayout(creds);
    const members = new Set(
      verified.bridgePorts.filter(item => item.bridge === bridge).map(item => item.interface),
    );
    const missing = add.filter(name => !members.has(name));
    const stillPresent = remove.filter(name => members.has(name));
    const desiredMissing = Array.isArray(desiredPorts)
      ? desiredPorts.filter(name => !members.has(name))
      : [];
    if (missing.length || stillPresent.length || desiredMissing.length) {
      const detail = [
        missing.length ? `not added: ${missing.join(", ")}` : "",
        stillPresent.length ? `not removed: ${stillPresent.join(", ")}` : "",
        desiredMissing.length ? `desired membership missing: ${desiredMissing.join(", ")}` : "",
      ].filter(Boolean).join("; ");
      res.status(502).json({ ok: false, error: `Bridge verification failed (${detail})`, logs });
      return;
    }
    res.json({ ok: true, logs, verified: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: msg, logs: [`✗ ${msg}`] });
  }
});

/* ─── POST /api/admin/router/bridge-create ─────────────────────────────── */
router.post("/admin/router/bridge-create", async (req, res): Promise<void> => {
  const { host, username, password, bridgeName, bridgeIp, port } = req.body as {
    host: string;
    username: string;
    password: string;
    bridgeName: string;
    bridgeIp?: string;
    port?: number;
  };

  const name = bridgeName?.trim();
  if (!host || !username || !name) {
    res.status(400).json({ ok: false, error: "host, username, and bridgeName are required" });
    return;
  }

  const creds = buildCreds({ host, username, password, bridgeIp, port });

  try {
    const result = await createBridge(creds, name);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: msg, created: false, message: msg });
  }
});

export default router;
