import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
  sbUpsertStrict,
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
  reseller_bandwidth_cap?: number | null;
  assigned_reseller_id?: number | null;
  link_status?: "pending" | "active" | "suspended" | null;
  vlan_tag?: string | null;
  link_provisioning_error?: string | null;
  status: string;
  provisioning_error: string | null;
  router?: { id: number; name: string; host: string; vpn_ip: string | null };
};

function safeSegment(value: string, fallback: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return result.slice(0, 55) || fallback;
}

function cleanServicePath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const clean = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(clean) || clean.includes("..")) {
    throw new Error("The service portal folder contains unsupported characters.");
  }
  return clean;
}

function portServiceNetwork(portId: number, requested: string): {
  network: string;
  gateway: string;
  poolRange: string;
} {
  const fallbackOctet = 180 + ((Math.max(1, portId) - 1) % 4);
  const raw = requested.trim() || `192.168.${fallbackOctet}.0/24`;
  const [rawAddress, rawPrefix] = raw.split("/");
  const octets = rawAddress?.split(".").map(Number) ?? [];
  const privateNetwork = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (
    !privateNetwork
    || octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    || Number(rawPrefix) !== 24
    || octets[3] !== 0
  ) {
    throw new Error("The port service subnet must be a private network address ending in .0/24.");
  }
  return {
    network: `${octets[0]}.${octets[1]}.${octets[2]}.0/24`,
    gateway: `${octets[0]}.${octets[1]}.${octets[2]}.1`,
    poolRange: `${octets[0]}.${octets[1]}.${octets[2]}.10-${octets[0]}.${octets[1]}.${octets[2]}.254`,
  };
}

function nextAvailablePortSubnet(rows: Array<{ subnet_range: string | null }>): string {
  const used = new Set(
    rows
      .map((row) => row.subnet_range?.match(/^192\.168\.(18[0-3])\.0\/24$/)?.[1])
      .filter((octet): octet is string => Boolean(octet))
      .map(Number),
  );
  for (let octet = 180; octet <= 183; octet += 1) {
    if (!used.has(octet)) return `192.168.${octet}.0/24`;
  }
  throw new Error("No isolated /24 network remains inside 192.168.180.0/22 for this router.");
}

function requestHostname(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  return new URL(`${protocol}://${req.get("host")}`).hostname;
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

function routerResourceId(row: Record<string, unknown>): string {
  return typeof row[".id"] === "string" ? row[".id"] : "";
}

async function deployServicesProvisionLayer(
  router: RouterRow,
  port: ResellerPortRow,
  linkStatus: "active" | "suspended",
  capMbps: number,
  warningHostname: string,
): Promise<void> {
  const creds = routerCredentials(router);
  const portSegment = safeSegment(port.interface_name, `PORT_${port.id}`);
  const parentQueue = `RESELLER_ROOT_${portSegment}`;
  const queueRows = await runRouterCommand(creds, [
    "/queue/simple/print",
    "=.proplist=.id,name,comment",
    `?name=${parentQueue}`,
  ]);
  const queueId = Array.isArray(queueRows)
    ? routerResourceId((queueRows[0] ?? {}) as Record<string, unknown>)
    : "";
  const maxLimit = `${Math.round(capMbps)}M/${Math.round(capMbps)}M`;
  if (queueId) {
    await runRouterCommand(creds, [
      "/queue/simple/set",
      `=.id=${queueId}`,
      `=max-limit=${maxLimit}`,
      `=disabled=${linkStatus === "active" ? "no" : "yes"}`,
    ]);
  } else {
    await runRouterCommand(creds, [
      "/queue/simple/add",
      `=name=${parentQueue}`,
      `=target=${port.bridge_name || port.interface_name}`,
      `=max-limit=${maxLimit}`,
      `=priority=2/2`,
      `=disabled=${linkStatus === "active" ? "no" : "yes"}`,
      `=comment=OcholaSupernet_${portSegment}_parent_queue`,
    ]);
  }

  if (port.hotspot_enabled) {
    const hotspotName = `reseller_${port.reseller_id}_${portSegment}`;
    const hotspotRows = await runRouterCommand(creds, [
      "/ip/hotspot/print",
      "=.proplist=.id,name",
      `?name=${hotspotName}`,
    ]);
    const hotspotId = Array.isArray(hotspotRows)
      ? routerResourceId((hotspotRows[0] ?? {}) as Record<string, unknown>)
      : "";
    if (hotspotId) {
      // Keep the Hotspot server available while suspended so the approved
      // warning/walled-garden page can still be shown to the client.
      await runRouterCommand(creds, [
        "/ip/hotspot/set",
        `=.id=${hotspotId}`,
        "=disabled=no",
      ]);
    }
    const gardenRows = await runRouterCommand(creds, [
      "/ip/hotspot/walled-garden/ip/print",
      "=.proplist=.id,dst-host,comment",
    ]);
    const hasWarningGarden = Array.isArray(gardenRows) && gardenRows.some(row =>
      String((row as Record<string, unknown>).comment ?? "") === `OcholaSupernet_${portSegment}_wholesale_walled_garden`,
    );
    if (!hasWarningGarden && warningHostname) {
      await runRouterCommand(creds, [
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${warningHostname}`,
        "=action=accept",
        `=comment=OcholaSupernet_${portSegment}_wholesale_walled_garden`,
      ]);
    }
  }

  if (port.pppoe_enabled) {
    const serviceName = `PPPoE_${portSegment}`;
    const pppoeRows = await runRouterCommand(creds, [
      "/interface/pppoe-server/server/print",
      "=.proplist=.id,service-name",
      `?service-name=${serviceName}`,
    ]);
    const pppoeId = Array.isArray(pppoeRows)
      ? routerResourceId((pppoeRows[0] ?? {}) as Record<string, unknown>)
      : "";
    if (pppoeId) {
      await runRouterCommand(creds, [
        "/interface/pppoe-server/server/set",
        `=.id=${pppoeId}`,
        `=disabled=${linkStatus === "active" ? "no" : "yes"}`,
      ]);
    }
  }
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
      `admin_id=eq.${account.id}&select=id,reseller_id,assigned_reseller_id,router_id,interface_name,vlan_tag,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,reseller_bandwidth_cap,status,link_status,provisioning_error,link_provisioning_error&order=created_at.desc`,
    );
    res.json({ ok: true, resellers: rows, ports });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load resellers." });
  }
});

async function updateResellerLink(req: Request, res: Response): Promise<void> {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Only the ISP administrator can change reseller link state." });
      return;
    }

    const resellerId = Number(req.body?.resellerId);
    const requestedState = req.body?.linkStatus === "suspended" ? "suspended" : "active";
    const targetPortName = typeof req.body?.targetPortName === "string"
      ? req.body.targetPortName.trim()
      : "";
    const vlanTag = typeof req.body?.vlanTag === "string" ? req.body.vlanTag.trim() : "";
    const requestedCap = Number(req.body?.maxBandwidthCap);
    if (!Number.isSafeInteger(resellerId) || resellerId <= 0 || (!targetPortName && !vlanTag)) {
      res.status(400).json({ ok: false, error: "Provide a reseller and either the target port name or VLAN tag." });
      return;
    }
    if ((targetPortName && !validInterface(targetPortName)) || (vlanTag && !/^[A-Za-z0-9._-]{1,64}$/.test(vlanTag))) {
      res.status(400).json({ ok: false, error: "The target port name or VLAN tag is invalid." });
      return;
    }
    if (req.body?.maxBandwidthCap !== undefined && (!Number.isSafeInteger(requestedCap) || requestedCap < 1 || requestedCap > 100000)) {
      res.status(400).json({ ok: false, error: "The maximum bandwidth cap must be between 1 and 100000 Mbps." });
      return;
    }

    const child = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `id=eq.${resellerId}&parent_id=eq.${account.id}&role=eq.reseller&is_active=is.true&select=id&limit=1`,
    );
    if (!child[0]) {
      res.status(404).json({ ok: false, error: "The reseller does not belong to this ISP account." });
      return;
    }

    const ports = await sbSelectStrict<ResellerPortRow>(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&assigned_reseller_id=eq.${resellerId}&select=*&limit=100`,
    );
    const port = ports.find(row => (targetPortName && row.interface_name === targetPortName) || (vlanTag && row.vlan_tag === vlanTag));
    if (!port) {
      res.status(404).json({ ok: false, error: "The requested physical port is not assigned to this reseller." });
      return;
    }
    if (port.status === "disabled") {
      res.status(409).json({ ok: false, error: "A disabled port must be redeployed before its wholesale link can be activated." });
      return;
    }

    const cap = requestedCap || Number(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100000) {
      res.status(409).json({ ok: false, error: "This port does not have a valid wholesale bandwidth cap." });
      return;
    }
    const targetRouter = await tenantRouter(account.id, port.router_id);
    const updated = await sbUpdateStrict<ResellerPortRow>(`isp_reseller_ports`,
      `id=eq.${port.id}&admin_id=eq.${account.id}&assigned_reseller_id=eq.${resellerId}`,
      {
        link_status: requestedState,
        bandwidth_cap_mbps: cap,
        reseller_bandwidth_cap: cap,
        link_provisioning_error: null,
        updated_at: new Date().toISOString(),
      },
    );
    if (!updated[0]) throw new Error("The reseller link state could not be saved.");

    try {
      await deployServicesProvisionLayer(targetRouter, { ...port, ...updated[0] }, requestedState, cap, requestHostname(req));
    } catch (error) {
      const message = error instanceof Error ? error.message : "RouterOS services provisioning failed.";
      await sbUpdateStrict(
        "isp_reseller_ports",
        `id=eq.${port.id}&admin_id=eq.${account.id}`,
        {
          link_status: requestedState === "suspended" ? "suspended" : "pending",
          link_provisioning_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        },
      ).catch(() => undefined);
      res.status(502).json({ ok: false, error: `The database state was saved, but RouterOS did not apply it: ${message}` });
      return;
    }

    res.json({
      ok: true,
      link: {
        ...(updated[0] ?? {}),
        link_status: requestedState,
        bandwidth_cap_mbps: cap,
        reseller_bandwidth_cap: cap,
        link_provisioning_error: null,
      },
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to update reseller link." });
  }
}

router.post("/admin/reseller-links", requireAdmin(), updateResellerLink);
router.post("/admin/approve-reseller-link", requireAdmin(), updateResellerLink);

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
      pppoeFolderPath,
    } = req.body as Record<string, unknown>;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanCompany = typeof companyName === "string" ? companyName.trim() : "";
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanPassword = typeof password === "string" ? password : "";
    const cleanInterface = typeof interfaceName === "string" ? interfaceName.trim() : "";
    const requestedSubnet = typeof subnetRange === "string" ? subnetRange.trim() : "";
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
    const existingNetworkRows = await sbSelectStrict<{ subnet_range: string | null }>(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&router_id=eq.${routerNumber}&status=neq.disabled&select=subnet_range`,
    );
    if (requestedSubnet && existingNetworkRows.some((row) => row.subnet_range?.trim() === requestedSubnet)) {
      res.status(409).json({ ok: false, error: "That service subnet is already assigned to another active port on this router." });
      return;
    }
    const serviceNetwork = portServiceNetwork(
      routerNumber,
      requestedSubnet || nextAvailablePortSubnet(existingNetworkRows),
    );
    const servicePortName = safeSegment(cleanInterface, `port_${routerNumber}`);
    const serviceBridgeName = safeSegment(
      typeof bridgeName === "string" && bridgeName.trim()
        ? bridgeName
        : `ochola-port-${servicePortName}`,
      `ochola-port-${servicePortName}`,
    );
    const hotspotPath = hotspotEnabled === true
      ? cleanServicePath(hotspotTemplatePath, `hotspot/reseller_${servicePortName}_page`)
      : null;
    const pppoePath = pppoeEnabled === true
      ? cleanServicePath(pppoeFolderPath, `hotspot/pppoe_${servicePortName}_page`)
      : null;
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
      bridge_name: serviceBridgeName,
      hotspot_enabled: hotspotEnabled === true,
      hotspot_template_path: hotspotPath,
      hotspot_folder_path: hotspotPath,
      pppoe_enabled: pppoeEnabled === true,
      pppoe_folder_path: pppoePath,
      subnet_range: serviceNetwork.network,
      bandwidth_cap_mbps: Math.round(cap),
        reseller_bandwidth_cap: Math.round(cap),
      status: "pending",
    });
    assignmentId = Number(assignmentRows[0]?.id);
    if (!assignmentId) throw new Error("The reseller port assignment could not be created.");

    const creds = routerCredentials(target);
    const bridgeRows = await runRouterCommand(creds, [
      "/interface/bridge/print",
      "=.proplist=name",
      `?name=${serviceBridgeName}`,
    ]);
    if (!bridgeRows.some((row) => row.name === serviceBridgeName)) {
      await runRouterCommand(creds, [
        "/interface/bridge/add",
        `=name=${serviceBridgeName}`,
        `=comment=OcholaSupernet_${servicePortName}_service_bridge`,
      ]);
    }
    const bridgePortRows = await runRouterCommand(creds, [
      "/interface/bridge/port/print",
      "=.proplist=.id,bridge,interface",
      `?interface=${cleanInterface}`,
    ]);
    const existingBridgePort = bridgePortRows.find((row) => row.interface === cleanInterface);
    if (existingBridgePort && existingBridgePort.bridge !== serviceBridgeName) {
      throw new Error(`Interface ${cleanInterface} is already assigned to foreign bridge ${existingBridgePort.bridge}.`);
    }
    if (!existingBridgePort) {
      await runRouterCommand(creds, [
        "/interface/bridge/port/add",
        `=bridge=${serviceBridgeName}`,
        `=interface=${cleanInterface}`,
        `=comment=OcholaSupernet_${servicePortName}_service_port`,
      ]);
    }

    const hotspotProfile = `reseller_${resellerId}_${servicePortName}_profile`;
    const hotspotServer = `reseller_${resellerId}_${servicePortName}`;
    const parentQueue = `RESELLER_ROOT_${servicePortName}`;
    if (hotspotPath) {
      await runRouterCommand(creds, [
        "/ip/address/add",
        `=address=${serviceNetwork.gateway}/24`,
        `=interface=${serviceBridgeName}`,
        `=comment=OcholaSupernet_${servicePortName}_hotspot_gateway`,
      ]);
      await runRouterCommand(creds, [
        "/ip/pool/add",
        `=name=HS_POOL_${servicePortName}`,
        `=ranges=${serviceNetwork.poolRange}`,
        `=comment=OcholaSupernet_${servicePortName}_hotspot_pool`,
      ]);
      await runRouterCommand(creds, [
        "/ip/dhcp-server/network/add",
        `=address=${serviceNetwork.network}`,
        `=gateway=${serviceNetwork.gateway}`,
        `=dns-server=${serviceNetwork.gateway},8.8.8.8`,
        `=comment=OcholaSupernet_${servicePortName}_hotspot_network`,
      ]);
      await runRouterCommand(creds, [
        "/ip/dhcp-server/add",
        `=name=HS_DHCP_${servicePortName}`,
        `=interface=${serviceBridgeName}`,
        `=address-pool=HS_POOL_${servicePortName}`,
        "=disabled=no",
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/profile/add",
        `=name=${hotspotProfile}`,
        `=hotspot-address=${serviceNetwork.gateway}`,
        `=html-directory=${hotspotPath}`,
        "=login-by=http-chap,http-pap",
        `=comment=OcholaSupernet_${servicePortName}_hotspot_profile`,
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/add",
        `=name=${hotspotServer}`,
        `=interface=${serviceBridgeName}`,
        `=profile=${hotspotProfile}`,
        `=address-pool=HS_POOL_${servicePortName}`,
        "=disabled=no",
        `=comment=OcholaSupernet_${servicePortName}_hotspot`,
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${requestHostname(req)}`,
        "=action=accept",
        `=comment=OcholaSupernet_${servicePortName}_walled_garden`,
      ]);
      await runRouterCommand(creds, [
        "/ip/firewall/nat/add",
        "=chain=srcnat",
        "=action=masquerade",
        `=src-address=${serviceNetwork.network}`,
        "=out-interface-list=WAN",
        `=comment=OcholaSupernet_${servicePortName}_hotspot_nat`,
      ]);
    }
    if (hotspotPath || pppoePath) {
      await runRouterCommand(creds, [
        "/queue/simple/add",
        `=name=${parentQueue}`,
        `=target=${serviceBridgeName}`,
        `=max-limit=${Math.round(cap)}M/${Math.round(cap)}M`,
        "=priority=2/2",
        `=comment=OcholaSupernet_${servicePortName}_parent_queue`,
      ]);
    }
    if (pppoePath) {
      await runRouterCommand(creds, [
        "/interface/pppoe-server/server/add",
        `=service-name=PPPoE_${servicePortName}`,
        `=interface=${serviceBridgeName}`,
        "=disabled=no",
        "=one-session-per-host=yes",
        `=comment=OcholaSupernet_${servicePortName}_pppoe`,
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/profile/add",
        `=name=PPPOE_ALERT_${servicePortName}`,
        `=html-directory=${pppoePath}`,
        "=login-by=http-chap,http-pap",
        `=comment=OcholaSupernet_${servicePortName}_pppoe_landing`,
      ]);
      await runRouterCommand(creds, [
        "/queue/simple/add",
        `=name=PPPOE_PREMIUM_${servicePortName}`,
        `=target=${serviceBridgeName}`,
        `=parent=${parentQueue}`,
        `=max-limit=${Math.round(cap)}M/${Math.round(cap)}M`,
        "=priority=1/1",
        `=comment=OcholaSupernet_${servicePortName}_pppoe_premium`,
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
      sbSelectStrict("isp_reseller_ports", `admin_id=eq.${tenantId}&assigned_reseller_id=eq.${account.id}&select=id,reseller_id,assigned_reseller_id,router_id,interface_name,vlan_tag,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,reseller_bandwidth_cap,status,link_status,provisioning_error,link_provisioning_error&limit=50`),
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
    if (port.status !== "active" || port.link_status !== "active") {
      res.status(409).json({ ok: false, error: "This reseller link is not active." });
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