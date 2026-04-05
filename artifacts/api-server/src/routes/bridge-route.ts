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

/* ─── POST /api/admin/router/ports ─────────────────────────────────────── */
router.post("/admin/router/ports", async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp, port } = req.body as {
    host: string;
    username: string;
    password: string;
    bridgeIp?: string;
    port?: number;
  };

  if (!host || !username) {
    res.status(400).json({ ok: false, error: "host and username are required" });
    return;
  }

  const creds = buildCreds({ host, username, password, bridgeIp, port });

  try {
    const layout = await fetchBridgePortLayout(creds);
    res.json({ ok: true, ...layout });
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
router.post("/admin/router/bridge-assign", async (req, res): Promise<void> => {
  const { host, username, password, bridge, addPorts, removePorts, bridgeIp, port } = req.body as {
    host: string;
    username: string;
    password: string;
    bridge: string;
    addPorts: string[];
    removePorts: string[];
    bridgeIp?: string;
    port?: number;
  };

  if (!host || !username || !bridge) {
    res.status(400).json({ ok: false, error: "host, username, and bridge are required" });
    return;
  }

  const creds = buildCreds({ host, username, password, bridgeIp, port });
  const add    = Array.isArray(addPorts)    ? addPorts    : [];
  const remove = Array.isArray(removePorts) ? removePorts : [];

  try {
    const logs = await assignBridgePorts(creds, bridge, add, remove);
    res.json({ ok: true, logs });
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
