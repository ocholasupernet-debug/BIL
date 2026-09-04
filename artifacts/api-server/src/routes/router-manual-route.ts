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
import { encryptVpnSecret } from "../lib/vpn-crypto.js";
import { sbInsertStrict, sbSelectStrict } from "../lib/supabase-client.js";
import { readClientCertificate } from "./vpn-route.js";

const router: IRouter = Router();
const MAX_TEXT_LENGTH = 160;
const MAX_SECRET_LENGTH = 512;
const VPN_MODES = new Set(["ip", "ethernet"]);

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
  manual_vpn_config: Record<string, unknown> | null;
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

function port(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("OpenVPN port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function vpnMode(value: unknown): "ip" | "ethernet" {
  const mode = text(value, "OpenVPN mode", true)!;
  if (!VPN_MODES.has(mode)) throw new Error("OpenVPN mode must be ip or ethernet.");
  return mode as "ip" | "ethernet";
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
    const connectTo = text(req.body?.connectTo, "OpenVPN connect-to address", true)!;
    const vpnPort = port(req.body?.vpnPort);
    const mode = vpnMode(req.body?.mode);
    const vpnUser = text(req.body?.vpnUser, "OpenVPN user", true)!;
    const vpnPassword = secret(req.body?.vpnPassword, "OpenVPN password");
    const profile = text(req.body?.profile, "OpenVPN profile", true)!;
    const certificate = text(req.body?.certificate, "OpenVPN certificate", true)!;
    const cipher = text(req.body?.cipher, "OpenVPN cipher", true)!;
    const auth = text(req.body?.auth, "OpenVPN auth", true)!;
    const routeNoPull = Boolean(req.body?.routeNoPull);

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
      manual_vpn_config: {
        connect_to: connectTo,
        port: vpnPort,
        mode,
        user: vpnUser,
        password: encryptVpnSecret(vpnPassword),
        profile,
        certificate,
        cipher,
        auth,
        route_nopull: routeNoPull,
      },
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

router.get("/api/admin/router/manual/:id/certificate", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const adminId = authenticatedAdminId(req);
    const routerId = Number(req.params.id);
    if (!adminId || !Number.isSafeInteger(routerId) || routerId <= 0) {
      res.status(400).json({ ok: false, error: "Invalid router." });
      return;
    }
    const rows = await sbSelectStrict<{ id: number; name: string }>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name&limit=1`,
    );
    const target = rows[0];
    if (!target) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    const certificate = readClientCertificate(target.name);
    if (!certificate) {
      res.status(503).json({ ok: false, error: "The client certificate is not available on the VPN server." });
      return;
    }
    const filename = `${target.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}.crt`;
    res.set("Content-Type", "application/x-x509-ca-cert");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.set("Cache-Control", "no-store");
    res.send(certificate);
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Certificate download failed." });
  }
});

export default router;