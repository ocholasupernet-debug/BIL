import { Router, type IRouter, type Request, type Response } from "express";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";

const router: IRouter = Router();
const MAX_TEXT_LENGTH = 160;
const MAX_SECRET_LENGTH = 512;
const ROUTER_STATUSES = new Set([
  "offline",
  "online",
  "active",
  "setup",
  "awaiting_ports",
  "awaiting_sync",
  "awaiting_connection",
]);

type RouterRow = {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  ip_address: string | null;
  bridge_ip: string | null;
  proxy_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
  status: string | null;
  model: string | null;
  ros_version: string | null;
  created_at: string;
  last_seen: string | null;
};

type AdminRow = {
  id: number;
  name: string;
  username: string | null;
  subdomain: string | null;
  is_active: boolean;
};

function superAdminToken(req: Request): string {
  const raw = req.headers["x-sa-token"];
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}

function requireSuperAdmin(req: Request, res: Response): boolean {
  if (!isActiveSuperAdminToken(superAdminToken(req))) {
    res.status(401).json({ ok: false, error: "Your Super Admin session is invalid or has expired." });
    return false;
  }
  return true;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > MAX_TEXT_LENGTH) throw new Error(`${label} must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  return normalized || null;
}

function secret(value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  if (required && !value) throw new Error(`${label} is required.`);
  if (value.length > MAX_SECRET_LENGTH) throw new Error(`${label} is too long.`);
  return value;
}

function publicRouter(row: RouterRow) {
  return {
    id: row.id,
    admin_id: row.admin_id,
    name: row.name,
    host: row.host,
    ip_address: row.ip_address,
    bridge_ip: row.bridge_ip,
    proxy_ip: row.proxy_ip,
    router_username: row.router_username,
    has_password: Boolean(row.router_secret),
    status: row.status,
    model: row.model,
    ros_version: row.ros_version,
    created_at: row.created_at,
    last_seen: row.last_seen,
  };
}

function publicAdmin(row: AdminRow) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    subdomain: row.subdomain,
    is_active: row.is_active,
  };
}

function safeDetails(input: {
  adminId: number;
  fields: string[];
  credentialsChanged?: boolean;
}): Record<string, unknown> {
  return {
    source: "super_admin",
    admin_id: input.adminId,
    fields: input.fields,
    ...(input.credentialsChanged ? { credentials_changed: true } : {}),
  };
}

router.get("/super-admin/routers", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const [routers, admins] = await Promise.all([
      sbSelectStrict<RouterRow>(
        "isp_routers",
        "select=id,admin_id,name,host,ip_address,bridge_ip,proxy_ip,router_username,router_secret,status,model,ros_version,created_at,last_seen&order=admin_id.asc,id.asc",
      ),
      sbSelectStrict<AdminRow>(
        "isp_admins",
        "select=id,name,username,subdomain,is_active&order=name.asc,id.asc",
      ),
    ]);
    res.set("Cache-Control", "no-store").json({
      ok: true,
      routers: routers.map(publicRouter),
      admins: admins.map(publicAdmin),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Routers could not be loaded. Confirm the database is available." });
  }
});

router.post("/super-admin/routers", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const adminId = positiveId(req.body?.adminId);
    if (!adminId) {
      res.status(400).json({ ok: false, error: "Select an ISP account for this router." });
      return;
    }
    const name = text(req.body?.name, "Router name", true)!;
    const host = text(req.body?.host, "Host or IP address", true)!;
    const username = text(req.body?.username, "Router username", true)!;
    const password = secret(req.body?.password, "Router password", true)!;
    const model = text(req.body?.model, "Model");
    const rosVersion = text(req.body?.rosVersion, "RouterOS version");
    const ipAddress = text(req.body?.ipAddress, "IP address");
    const bridgeIp = text(req.body?.bridgeIp, "Bridge IP");
    const proxyIp = text(req.body?.proxyIp, "Proxy IP");
    const status = text(req.body?.status, "Status") ?? "offline";
    if (!ROUTER_STATUSES.has(status)) {
      res.status(400).json({ ok: false, error: "Choose a valid router status." });
      return;
    }

    const admins = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `id=eq.${adminId}&select=id&limit=1`,
    );
    if (!admins[0]) {
      res.status(404).json({ ok: false, error: "The selected ISP account was not found." });
      return;
    }

    const inserted = await sbInsertStrict<RouterRow>("isp_routers", {
      admin_id: adminId,
      name,
      host,
      ip_address: ipAddress,
      bridge_ip: bridgeIp,
      proxy_ip: proxyIp,
      model,
      ros_version: rosVersion,
      router_username: username,
      router_secret: password,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const created = inserted[0];
    if (!created) {
      res.status(503).json({ ok: false, error: "The router could not be saved." });
      return;
    }

    void logActivity({
      adminId,
      type: "router",
      action: "added",
      subject: name,
      details: safeDetails({
        adminId,
        fields: ["name", "host", "credentials", "network", "status"],
        credentialsChanged: true,
      }),
    });
    res.status(201).json({ ok: true, router: publicRouter(created) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid router details." });
  }
});

router.patch("/super-admin/routers/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  const routerId = positiveId(req.params.id);
  if (!routerId) {
    res.status(400).json({ ok: false, error: "Invalid router id." });
    return;
  }

  try {
    const existing = await sbSelectStrict<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}&select=id,admin_id,name,host,ip_address,bridge_ip,proxy_ip,router_username,router_secret,status,model,ros_version,created_at,last_seen&limit=1`,
    );
    const current = existing[0];
    if (!current) {
      res.status(404).json({ ok: false, error: "Router not found." });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const fields: string[] = [];
    const adminId = req.body?.adminId === undefined ? current.admin_id : positiveId(req.body.adminId);
    if (!adminId) {
      res.status(400).json({ ok: false, error: "Select a valid ISP account for this router." });
      return;
    }
    if (adminId !== current.admin_id) {
      const admins = await sbSelectStrict<{ id: number }>(
        "isp_admins",
        `id=eq.${adminId}&select=id&limit=1`,
      );
      if (!admins[0]) {
        res.status(404).json({ ok: false, error: "The selected ISP account was not found." });
        return;
      }
      updates.admin_id = adminId;
      fields.push("admin_id");
    }

    const textFields: Array<[string, string, string]> = [
      ["name", "name", "Router name"],
      ["host", "host", "Host or IP address"],
      ["ipAddress", "ip_address", "IP address"],
      ["bridgeIp", "bridge_ip", "Bridge IP"],
      ["proxyIp", "proxy_ip", "Proxy IP"],
      ["model", "model", "Model"],
      ["rosVersion", "ros_version", "RouterOS version"],
    ];
    for (const [bodyKey, dbKey, label] of textFields) {
      if (req.body?.[bodyKey] !== undefined) {
        updates[dbKey] = text(req.body[bodyKey], label);
        fields.push(dbKey);
      }
    }
    if (req.body?.status !== undefined) {
      const status = text(req.body.status, "Status") ?? "offline";
      if (!ROUTER_STATUSES.has(status)) {
        res.status(400).json({ ok: false, error: "Choose a valid router status." });
        return;
      }
      updates.status = status;
      fields.push("status");
    }
    if (req.body?.username !== undefined) {
      updates.router_username = text(req.body.username, "Router username", true);
      fields.push("router_username");
    }
    let credentialsChanged = false;
    if (req.body?.password !== undefined && req.body.password !== "") {
      updates.router_secret = secret(req.body.password, "Router password", true);
      fields.push("router_secret");
      credentialsChanged = true;
    }

    const updated = await sbUpdateStrict<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}`,
      updates,
    );
    const saved = updated[0];
    if (!saved) {
      res.status(404).json({ ok: false, error: "Router not found." });
      return;
    }

    void logActivity({
      adminId: Number(saved.admin_id),
      type: "router",
      action: "updated",
      subject: saved.name,
      details: safeDetails({ adminId: Number(saved.admin_id), fields, credentialsChanged }),
    });
    res.json({ ok: true, router: publicRouter(saved) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid router details." });
  }
});

router.delete("/super-admin/routers/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  const routerId = positiveId(req.params.id);
  if (!routerId) {
    res.status(400).json({ ok: false, error: "Invalid router id." });
    return;
  }

  try {
    const rows = await sbSelectStrict<{ id: number; admin_id: number; name: string }>(
      "isp_routers",
      `id=eq.${routerId}&select=id,admin_id,name&limit=1`,
    );
    const current = rows[0];
    if (!current) {
      res.status(404).json({ ok: false, error: "Router not found." });
      return;
    }

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
    for (const table of childTables) {
      try {
        await sbDeleteStrict(table, `router_id=eq.${routerId}`);
      } catch {
        /* Optional child tables may not exist in every deployment. */
      }
    }

    await sbDeleteStrict("isp_routers", `id=eq.${routerId}`);
    const remaining = await sbSelectStrict<{ id: number }>(
      "isp_routers",
      `id=eq.${routerId}&select=id&limit=1`,
    );
    if (remaining.length > 0) {
      res.status(409).json({
        ok: false,
        error: "Router could not be deleted because related records still reference it.",
      });
      return;
    }

    void logActivity({
      adminId: current.admin_id,
      type: "router",
      action: "deleted",
      subject: current.name,
      details: { source: "super_admin", admin_id: current.admin_id },
    });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Router deletion failed.",
    });
  }
});

export default router;