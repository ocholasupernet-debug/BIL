/**
 * POST /api/admin/router/manual
 *
 * Save a router that has already been configured by an administrator. Manual
 * entries intentionally start offline: saving connection details is not proof
 * that RouterOS accepted them or that the management VPN is working.
 */

import { Router, type IRouter } from "express";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { logActivity } from "../lib/activity-log.js";
import { sbInsertStrict, sbSelectStrict } from "../lib/supabase-client.js";

const router: IRouter = Router();
const MAX_TEXT_LENGTH = 160;
const MAX_SECRET_LENGTH = 512;

type RouterRow = {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  ip_address: string | null;
  vpn_ip: string | null;
  bridge_ip: string | null;
  bridge_interface: string | null;
  model: string | null;
  ros_version: string | null;
  router_username: string | null;
  router_secret: string | null;
  status: string;
};

function text(value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  }
  return normalized || null;
}

function secret(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
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
    vpn_ip: row.vpn_ip,
    bridge_ip: row.bridge_ip,
    bridge_interface: row.bridge_interface,
    model: row.model,
    ros_version: row.ros_version,
    router_username: row.router_username,
    has_password: Boolean(row.router_secret),
    status: row.status,
  };
}

router.post("/api/admin/router/manual", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const adminId = authenticatedAdminId(req, req.body?.adminId);
    if (!adminId) {
      res.status(403).json({ ok: false, error: "This router must belong to the signed-in ISP account." });
      return;
    }

    const name = text(req.body?.name, "Router name", true)!;
    const host = text(req.body?.host, "Management host or IP address", true)!;
    const username = text(req.body?.username, "Router username", true)!;
    const password = secret(req.body?.password, "Router password");
    const ipAddress = text(req.body?.ipAddress, "WAN or public IP");
    const vpnIp = text(req.body?.vpnIp, "Management VPN IP");
    const bridgeIp = text(req.body?.bridgeIp, "Bridge IP");
    const bridgeInterface = text(req.body?.bridgeInterface, "Bridge interface") ?? "hotspot-bridge";
    const model = text(req.body?.model, "Model");
    const rosVersion = text(req.body?.rosVersion, "RouterOS version");

    const [admins, existing, vpnOwners] = await Promise.all([
      sbSelectStrict<{ id: number }>("isp_admins", `id=eq.${adminId}&select=id&limit=1`),
      sbSelectStrict<{ id: number }>(
        "isp_routers",
        `admin_id=eq.${adminId}&name=eq.${encodeURIComponent(name)}&select=id&limit=1`,
      ),
      vpnIp
        ? sbSelectStrict<{ id: number; admin_id: number }>(
          "isp_routers",
          `vpn_ip=eq.${encodeURIComponent(vpnIp)}&select=id,admin_id&limit=1`,
        )
        : Promise.resolve([] as Array<{ id: number; admin_id: number }>),
    ]);

    if (!admins[0]) {
      res.status(404).json({ ok: false, error: "The signed-in ISP account was not found." });
      return;
    }
    if (existing[0]) {
      res.status(409).json({ ok: false, error: `A router named "${name}" already exists for this ISP account.` });
      return;
    }
    if (vpnOwners[0]) {
      res.status(409).json({ ok: false, error: "That management VPN IP is already assigned to another router." });
      return;
    }

    const inserted = await sbInsertStrict<RouterRow>("isp_routers", {
      admin_id: adminId,
      name,
      host,
      ip_address: ipAddress,
      vpn_ip: vpnIp,
      bridge_ip: bridgeIp,
      bridge_interface: bridgeInterface,
      model,
      ros_version: rosVersion,
      router_username: username,
      router_secret: password,
      status: "offline",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const created = inserted[0];
    if (!created) {
      res.status(503).json({ ok: false, error: "The manual router configuration could not be saved." });
      return;
    }

    void logActivity({
      adminId,
      type: "router",
      action: "added",
      subject: name,
      details: {
        source: "manual_configuration",
        fields: ["name", "host", "credentials", "network", "metadata"],
        credentialsChanged: true,
      },
    });

    res.status(201).json({ ok: true, router: publicRouter(created) });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid manual router details.",
    });
  }
});

export default router;