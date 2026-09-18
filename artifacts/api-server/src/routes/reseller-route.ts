import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
  sbUpsertStrict,
  sbRpc,
} from "../lib/supabase-client.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { logger } from "../lib/logger.js";
import { encryptVpnSecret } from "../lib/vpn-crypto.js";

const router: IRouter = Router();

type RouterRow = {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  vpn_ip: string | null;
  router_username: string;
  router_secret: string | null;
  api_port: number;
  api_use_ssl: boolean;
};

type ResellerPortRow = {
  id: number;
  admin_id: number;
  reseller_id: number;
  router_id: number;
  interface_name: string;
  bridge_name: string | null;
  hotspot_enabled: boolean;
  hotspot_template_path: string | null;
  pppoe_enabled: boolean;
  subnet_range: string | null;
  bandwidth_cap_mbps: number;
  status: string;
  provisioning_error: string | null;
  router?: { id: number; name: string; host: string; vpn_ip: string | null };
};

function safeSegment(value: string, fallback: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return result.slice(0, 55) || fallback;
}

function validInterface(value: unknown): value is string {
  return typeof value === "string"
    && /^(ether|sfp|combo|wlan|lte|bridge|vlan)[a-zA-Z0-9._-]*$/i.test(value.trim())
    && value.trim().length <= 64;
}

function routerCredentials(row: RouterRow): RouterCredentials {
  return {
    host: row.vpn_ip?.trim() || row.host,
    bridgeIp: row.vpn_ip?.trim() || undefined,
    port: Number(row.api_port) || 8728,
    useSSL: row.api_use_ssl === true,
    username: row.router_username || "admin",
    password: row.router_secret || "",
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 20_000,
  };
}

async function currentAccount(req: Request) {
  const account = await authenticatedAccount(req);
  if (!account) throw new Error("Signed-in account was not found.");
  return account;
}

async function tenantRouter(adminId: number, routerId: number): Promise<RouterRow> {
  const rows = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,vpn_ip,router_username,router_secret,api_port,api_use_ssl&limit=1`,
  );
  if (!rows[0]) throw new Error("Router not found for this ISP account.");
  return rows[0];
}

async function ownedPort(req: Request, portId: number): Promise<ResellerPortRow> {
  const account = await currentAccount(req);
  const tier = account.account_tier ?? (account.role === "reseller" ? "reseller" : account.role === "system_admin" ? "system_admin" : "isp_admin");
  if (!["system_admin", "isp_admin", "reseller"].includes(tier)) {
    throw new Error("This account role cannot access physical port resources.");
  }
  const tenantId = account.parent_id ?? account.id;
  const resellerFilter = account.role === "reseller" ? `&assigned_reseller_id=eq.${account.id}` : "";
  const tenantFilter = tier === "system_admin" && req.query.adminId && /^\d+$/.test(String(req.query.adminId))
    ? `&admin_id=eq.${Number(req.query.adminId)}`
    : `&admin_id=eq.${tenantId}`;
  const rows = await sbSelectStrict<ResellerPortRow>(
    "isp_reseller_ports",
    `id=eq.${portId}${tenantFilter}${resellerFilter}&select=*&limit=1`,
  );
  if (!rows[0]) throw new Error("This port is not assigned to your account.");
  return rows[0];
}

/** Reusable ownership middleware for every reseller-port mutation. */
export async function validatePortAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const portId = Number(req.params.portId ?? req.params.id);
  if (!Number.isSafeInteger(portId) || portId <= 0) {
    res.status(400).json({ ok: false, error: "A valid reseller port id is required." });
    return;
  }
  try {
    const account = await currentAccount(req);
    const tier = account.account_tier ?? (account.role === "reseller" ? "reseller" : account.role === "system_admin" ? "system_admin" : account.role === "isp_admin" ? "isp_admin" : "");
    if (!["system_admin", "isp_admin", "reseller"].includes(tier)) {
      res.status(403).json({ ok: false, error: "Only system administrators, ISP administrators, or the assigned reseller may access this port." });
      return;
    }
    const port = await ownedPort(req, portId);
    res.locals.resellerPort = port;
    next();
  } catch (error) {
    res.status(403).json({ ok: false, error: error instanceof Error ? error.message : "Port access denied." });
  }
}

router.get("/admin/resellers", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot manage other resellers." });
      return;
    }
    const rows = await sbSelectStrict(
      "isp_admins",
      `parent_id=eq.${account.id}&role=eq.reseller&select=id,name,company_name,username,email,phone,is_active,status,earnings_balance,created_at&order=created_at.desc`,
    );
    const ports = await sbSelectStrict(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&select=id,reseller_id,router_id,interface_name,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,status,provisioning_error&order=created_at.desc`,
    );
    res.json({ ok: true, resellers: rows, ports });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load resellers." });
  }
});

router.get("/admin/resellers/port-options", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot inspect unassigned ports." });
      return;
    }
    const routerId = Number(req.query.routerId);
    if (!Number.isSafeInteger(routerId) || routerId <= 0) {
      res.status(400).json({ ok: false, error: "Choose a router first." });
      return;
    }
    const target = await tenantRouter(account.id, routerId);
    const [interfaces, assignments] = await Promise.all([
      runRouterCommand(routerCredentials(target), [
        "/interface/print",
        "=.proplist=name,type,running,disabled,mac-address,comment",
      ]),
      sbSelectStrict<{ interface_name: string; status: string }>(
        "isp_reseller_ports",
        `admin_id=eq.${account.id}&router_id=eq.${routerId}&select=interface_name,status`,
      ),
    ]);
    const assigned = new Set(assignments.filter((row) => row.status !== "disabled").map((row) => row.interface_name));
    res.json({
      ok: true,
      router: { id: target.id, name: target.name },
      interfaces: interfaces
        .map((row) => ({
          name: row.name,
          type: row.type || "ether",
          running: row.running === "true",
          disabled: row.disabled === "true",
          macAddress: row["mac-address"] || "",
          comment: row.comment || "",
          assigned: assigned.has(row.name),
        }))
        .filter((row) => validInterface(row.name) && !row.disabled && !assigned.has(row.name)),
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load router ports." });
  }
});

router.post("/admin/resellers", requireAdmin(), async (req, res): Promise<void> => {
  let resellerId = 0;
  let assignmentId = 0;
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot create resellers." });
      return;
    }
    const {
      name,
      companyName,
      username,
      email,
      phone,
      password,
      routerId,
      interfaceName,
      bandwidthCapMbps,
      bridgeName,
      hotspotEnabled,
      pppoeEnabled,
      subnetRange,
      hotspotTemplatePath,
    } = req.body as Record<string, unknown>;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanCompany = typeof companyName === "string" ? companyName.trim() : "";
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanPassword = typeof password === "string" ? password : "";
    const cleanInterface = typeof interfaceName === "string" ? interfaceName.trim() : "";
    const cap = Number(bandwidthCapMbps);
    const routerNumber = Number(routerId);
    if (cleanName.length < 2 || cleanUsername.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(cleanUsername)) {
      res.status(400).json({ ok: false, error: "Enter a valid reseller name and username." });
      return;
    }
    if (cleanPassword.length < 10) {
      res.status(400).json({ ok: false, error: "The reseller password must be at least 10 characters." });
      return;
    }
    if (!Number.isSafeInteger(routerNumber) || routerNumber <= 0 || !validInterface(cleanInterface) || !Number.isFinite(cap) || cap <= 0 || cap > 100000) {
      res.status(400).json({ ok: false, error: "Choose a router, a valid physical interface, and a bandwidth cap." });
      return;
    }
    const target = await tenantRouter(account.id, routerNumber);
    const conflict = await sbSelectStrict(
      "isp_reseller_ports",
      `router_id=eq.${routerNumber}&interface_name=eq.${encodeURIComponent(cleanInterface)}&status=neq.disabled&select=id&limit=1`,
    );
    if (conflict[0]) {
      res.status(409).json({ ok: false, error: "That physical port is already assigned." });
      return;
    }
    const duplicate = await sbSelectStrict(
      "isp_admins",
      `or=(and(parent_id.eq.${account.id},username.eq.${encodeURIComponent(cleanUsername)}),and(parent_id.eq.${account.id},email.eq.${encodeURIComponent(cleanEmail)}))&select=id&limit=1`,
    );
    if (duplicate[0]) {
      res.status(409).json({ ok: false, error: "That reseller username or email is already in use." });
      return;
    }
    const resellerRows = await sbInsertStrict<{ id: number }>("isp_admins", {
      name: cleanName,
      company_name: cleanCompany || cleanName,
      username: cleanUsername,
      email: cleanEmail || null,
      phone: typeof phone === "string" ? phone.trim() || null : null,
      password: await hashIspAdminPassword(cleanPassword),
      parent_id: account.id,
      role: "reseller",
      subdomain: null,
      is_active: true,
      status: "active",
      earnings_balance: 0,
      must_change_password: false,
    });
    resellerId = Number(resellerRows[0]?.id);
    if (!resellerId) throw new Error("The reseller account could not be created.");
    const assignmentRows = await sbInsertStrict<{ id: number }>("isp_reseller_ports", {
      admin_id: account.id,
      reseller_id: resellerId,
        assigned_reseller_id: resellerId,
      router_id: routerNumber,
      interface_name: cleanInterface,
      bridge_name: typeof bridgeName === "string" ? bridgeName.trim() || null : null,
      hotspot_enabled: hotspotEnabled === true,
      hotspot_template_path: typeof hotspotTemplatePath === "string" ? hotspotTemplatePath.trim() || null : null,
      pppoe_enabled: pppoeEnabled === true,
      subnet_range: typeof subnetRange === "string" ? subnetRange.trim() || null : null,
      bandwidth_cap_mbps: Math.round(cap),
        reseller_bandwidth_cap: Math.round(cap),
      status: "pending",
    });
    assignmentId = Number(assignmentRows[0]?.id);
    if (!assignmentId) throw new Error("The reseller port assignment could not be created.");

    const queueName = `RESELLER_ROOT_${safeSegment(cleanInterface, `PORT_${assignmentId}`)}`;
    await runRouterCommand(routerCredentials(target), [
      "/queue/simple/add",
      `=name=${queueName}`,
      `=target=${cleanInterface}`,
      `=max-limit=${Math.round(cap)}M/${Math.round(cap)}M`,
      "=priority=2/2",
      "=comment=OcholaSupernet reseller port",
    ]);
    if (hotspotEnabled === true) {
      const hotspotProfile = `reseller_${resellerId}_${safeSegment(cleanInterface, `port_${assignmentId}`)}_profile`;
      const portalDirectory = typeof hotspotTemplatePath === "string" && hotspotTemplatePath.trim()
        ? hotspotTemplatePath.trim().replace(/^\/+|\/+$/g, "").slice(0, 120)
        : `hotspot/reseller_${safeSegment(cleanInterface, `port_${assignmentId}`)}_page`;
      if (!/^[a-zA-Z0-9_./-]+$/.test(portalDirectory)) {
        throw new Error("The hotspot template path contains unsupported characters.");
      }
      await runRouterCommand(routerCredentials(target), [
        "/ip/hotspot/profile/add",
        `=name=${hotspotProfile}`,
        `=html-directory=${portalDirectory}`,
        "=login-by=http-chap,http-pap",
        "=comment=OcholaSupernet reseller hotspot profile",
      ]);
      await runRouterCommand(routerCredentials(target), [
        "/ip/hotspot/add",
        `=name=${safeSegment(`reseller_${resellerId}_${cleanInterface}`, `reseller_${resellerId}`)}`,
        `=interface=${cleanInterface}`,
        `=profile=${hotspotProfile}`,
        "=disabled=no",
        "=comment=OcholaSupernet reseller hotspot",
      ]);
    }
    if (pppoeEnabled === true) {
      await runRouterCommand(routerCredentials(target), [
        "/interface/pppoe-server/server/add",
        `=service-name=${safeSegment(`reseller_${resellerId}`, `reseller_${resellerId}`)}`,
        `=interface=${cleanInterface}`,
        "=disabled=no",
        "=one-session-per-host=yes",
      ]);
    }
    const updated = await sbUpdateStrict("isp_reseller_ports", `id=eq.${assignmentId}&admin_id=eq.${account.id}`, {
      status: "active",
      provisioning_error: null,
      updated_at: new Date().toISOString(),
    });
    res.status(201).json({ ok: true, resellerId, assignment: updated[0] ?? assignmentRows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reseller provisioning failed.";
    if (assignmentId) {
      await sbUpdateStrict("isp_reseller_ports", `id=eq.${assignmentId}`, {
        status: "failed",
        provisioning_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).catch(() => undefined);
    }
    if (resellerId && !assignmentId) {
      await sbDeleteStrict("isp_admins", `id=eq.${resellerId}`).catch(() => undefined);
    }
    logger.error({ resellerId, assignmentId, error: message }, "Reseller port provisioning failed");
    res.status(502).json({ ok: false, resellerId: resellerId || undefined, assignmentId: assignmentId || undefined, error: message });
  }
});

router.get("/reseller/me", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "This endpoint is for reseller accounts." });
      return;
    }
    const tenantId = account.parent_id ?? account.id;
    const [users, ports, gateways, sales] = await Promise.all([
      sbSelectStrict("isp_admins", `id=eq.${account.id}&select=id,name,company_name,username,email,phone,earnings_balance,created_at&limit=1`),
      sbSelectStrict("isp_reseller_ports", `admin_id=eq.${tenantId}&reseller_id=eq.${account.id}&select=id,router_id,interface_name,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,status,provisioning_error&limit=50`),
      sbSelectStrict("isp_reseller_gateways", `admin_id=eq.${tenantId}&reseller_id=eq.${account.id}&select=id,gateway_type,is_active,created_at,updated_at&order=updated_at.desc`),
      sbSelectStrict("isp_reseller_sales", `admin_id=eq.${tenantId}&reseller_id=eq.${account.id}&select=id,reseller_port_id,client_reference,client_ip,amount,gateway_type,payment_reference,status,created_at&order=created_at.desc&limit=50`),
    ]);
    res.json({ ok: true, account: users[0] ?? null, ports, gateways, sales });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load reseller dashboard." });
  }
});

router.put("/reseller/gateway", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can configure this gateway." });
      return;
    }
    const gatewayType = typeof req.body?.gatewayType === "string" ? req.body.gatewayType.trim().toLowerCase() : "";
    const config = req.body?.config;
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(gatewayType) || !config || typeof config !== "object" || Array.isArray(config)) {
      res.status(400).json({ ok: false, error: "A valid gateway type and configuration are required." });
      return;
    }
    const cleanConfig = Object.fromEntries(
      Object.entries(config as Record<string, unknown>)
        .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && typeof value === "string")
        .map(([key, value]) => [key, String(value).slice(0, 500)]),
    );
    const rows = await sbUpsertStrict("isp_reseller_gateways", "reseller_id,gateway_type", {
      admin_id: account.parent_id ?? account.id,
      reseller_id: account.id,
      gateway_type: gatewayType,
      config_json: { encrypted: encryptVpnSecret(JSON.stringify(cleanConfig)) },
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    const paymentGatewayType = gatewayType === "mpesa_paybill" || gatewayType === "mpesa_till_push" ? "mpesa" : gatewayType;
    if (["stripe", "paypal", "mpesa"].includes(paymentGatewayType)) {
      await sbUpsertStrict("payment_gateways", "user_id,gateway_type", {
        user_id: account.id,
        gateway_type: paymentGatewayType,
      api_keys_json: JSON.stringify(encryptVpnSecret(JSON.stringify(cleanConfig))),
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ ok: true, gateway: rows[0] ? { ...rows[0], config_json: undefined } : null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save gateway settings." });
  }
});

router.post("/reseller/checkout", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can use this checkout route." });
      return;
    }
    const portId = Number(req.body?.portId);
    const port = await ownedPort(req, portId);
    if (port.status !== "active") {
      res.status(409).json({ ok: false, error: "This reseller port is not active." });
      return;
    }
    const clientReference = typeof req.body?.clientReference === "string" ? req.body.clientReference.trim() : "";
    const clientIp = typeof req.body?.clientIp === "string" ? req.body.clientIp.trim() : "";
    const paymentReference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : "";
    const gatewayType = typeof req.body?.gatewayType === "string" ? req.body.gatewayType.trim().toLowerCase() : "";
    const amount = Number(req.body?.amount);
    const maxLimit = Number(req.body?.maxLimitMbps ?? port.bandwidth_cap_mbps);
    if (!clientReference || !paymentReference || !gatewayType || !Number.isFinite(amount) || amount < 0 || !/^(\d{1,3}\.){3}\d{1,3}$/.test(clientIp) || !Number.isFinite(maxLimit) || maxLimit <= 0 || maxLimit > port.bandwidth_cap_mbps) {
      res.status(400).json({ ok: false, error: "Provide a client reference, IPv4 address, payment reference, gateway, amount, and valid speed." });
      return;
    }
    const tenantId = account.parent_id ?? account.id;
    const normalizedGatewayType = gatewayType === "mpesa_paybill" || gatewayType === "mpesa_till_push" ? "mpesa" : gatewayType;
    const [gatewayRows, paymentGatewayRows] = await Promise.all([
      sbSelectStrict<{ id: number }>(
        "isp_reseller_gateways",
        `admin_id=eq.${tenantId}&reseller_id=eq.${account.id}&gateway_type=eq.${encodeURIComponent(gatewayType)}&is_active=is.true&select=id&limit=1`,
      ),
      sbSelectStrict<{ id: number }>(
        "payment_gateways",
        `user_id=eq.${account.id}&gateway_type=eq.${encodeURIComponent(normalizedGatewayType)}&is_active=is.true&select=id&limit=1`,
      ),
    ]);
    if (!gatewayRows[0] && !paymentGatewayRows[0]) {
      res.status(409).json({ ok: false, error: "Configure and enable this payment gateway before recording a checkout." });
      return;
    }
    const saleRows = await sbInsertStrict<{ id: number }>("isp_reseller_sales", {
      admin_id: tenantId,
      reseller_id: account.id,
      reseller_port_id: port.id,
      client_reference: clientReference.slice(0, 120),
      client_ip: clientIp,
      amount,
      gateway_type: gatewayType.slice(0, 32),
      payment_reference: paymentReference.slice(0, 160),
      status: "pending",
    });
    const saleId = Number(saleRows[0]?.id);
    const target = await tenantRouter(tenantId, port.router_id);
    const queueName = `CLIENT_${safeSegment(clientReference, `SALE_${saleId}`)}`;
    try {
      await runRouterCommand(routerCredentials(target), [
        "/queue/simple/add",
        `=name=${queueName}`,
        `=target=${clientIp}`,
        `=parent=RESELLER_ROOT_${safeSegment(port.interface_name, `PORT_${port.id}`)}`,
        `=max-limit=${maxLimit}M/${maxLimit}M`,
        "=comment=OcholaSupernet reseller checkout",
      ]);
      await sbUpdateStrict("isp_reseller_sales", `id=eq.${saleId}&admin_id=eq.${tenantId}`, { status: "completed" });
      await sbRpc("add_reseller_earnings", {
        p_admin_id: tenantId,
        p_reseller_id: account.id,
        p_amount: amount,
      });
      res.status(201).json({ ok: true, saleId, queueName, status: "completed" });
    } catch (error) {
      await sbUpdateStrict("isp_reseller_sales", `id=eq.${saleId}&admin_id=eq.${tenantId}`, { status: "failed" }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Checkout provisioning failed." });
  }
});

export default router;