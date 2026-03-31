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
 */

import { Router, type IRouter } from "express";
import {
  fetchBridgePortLayout,
  assignBridgePorts,
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

export default router;
