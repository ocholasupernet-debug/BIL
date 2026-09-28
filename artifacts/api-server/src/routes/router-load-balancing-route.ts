import { createHmac, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import {
  buildLoadBalancingScript,
  redactLoadBalancingScript,
  validateLoadBalancingConfig,
  type LoadBalancingConfig,
  type LoadBalancingWan,
} from "../lib/router-load-balancing.js";
import {
  deployRouterFile,
  fetchRouterLoadBalancingInventory,
  fetchRouterSecurityState,
  removeRouterFile,
  runRouterScript,
  type RouterCredentials,
  type RouterLoadBalancingInventory,
} from "../lib/mikrotik.js";
import { decryptVpnSecret, encryptVpnSecret } from "../lib/vpn-crypto.js";
import {
  sbDeleteStrict,
  sbRpc,
  sbSelectStrict,
  sbUpsertStrict,
} from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { getRouterCreds } from "./mikrotik-route.js";

const router: IRouter = Router();
const SCRIPT_SOURCE_TTL_MS = 2 * 60 * 1000;
const RECOVERY_TTL_MS = 60 * 60 * 1000;
const scriptSources = new Map<string, { content: string; expiresAt: number }>();
const activeOperations = new Set<string>();

type AdminRow = { id: number; parent_id: number | null; is_active: boolean };
type RouterRow = { id: number; admin_id: number; name: string };
type ConfigRow = {
  id: number;
  admin_id: number;
  router_id: number;
  enabled: boolean;
  lan_interface: string;
  router_os_version: "auto" | "6" | "7";
  mode: "weighted" | "failover";
  allow_bridge_firewall: boolean;
  bridge_firewall_original: boolean | null;
};
type WanRow = {
  id: number;
  admin_id: number;
  load_balancing_id: number;
  name: string;
  interface_name: string;
  gateway: string | null;
  weight: number;
  health_check_ip: string;
  enabled: boolean;
  position: number;
  connection_type: "static" | "pppoe";
  static_address_cidr: string | null;
  pppoe_username: string | null;
  pppoe_secret_ciphertext: string | null;
  pppoe_secret_iv: string | null;
  pppoe_secret_auth_tag: string | null;
  reassign_from_bridge: boolean;
  bridge_name: string | null;
};
type LanRow = {
  interface_name: string;
  wan_id: number;
  max_mbps: number;
  position: number;
};
type RecoveryRow = {
  script_ciphertext: string;
  script_iv: string;
  script_auth_tag: string;
  previous_config: Record<string, unknown>;
  expires_at: string;
};
type Profile = {
  parent: ConfigRow | null;
  wans: WanRow[];
  lans: LanRow[];
  publicConfig: Record<string, unknown>;
  rpcPayload: Record<string, unknown>;
};
type Scope = {
  adminId: number;
  routerId: number;
  routerName: string;
  creds: RouterCredentials;
};
type ClientConfig = {
  routerId: number;
  enabled: boolean;
  lanInterface: string;
  routerOsVersion: "auto" | "6" | "7";
  mode: "weighted" | "failover";
  allowBridgeFirewall: boolean;
  wans: Array<Record<string, unknown>>;
  lanLinks: Array<Record<string, unknown>>;
};
type Prepared = {
  internal: LoadBalancingConfig;
  script: string;
  previewHash: string;
  errors: string[];
  warnings: string[];
  changes: string[];
  inventory: RouterLoadBalancingInventory;
};

function requestOrigin(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = String(forwarded ?? req.protocol).split(",")[0].trim().toLowerCase();
  const host = req.get("host")?.trim();
  if (!host || host.length > 255 || /[\s/\\@]/.test(host) || (protocol !== "https" && protocol !== "http")) {
    throw new Error("A valid public API origin is required to transfer the RouterOS script.");
  }
  return `${protocol}://${host}`;
}

function previewHash(script: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("A server secret is required to bind the preview to its apply request.");
  return createHmac("sha256", secret)
    .update("ochola-multi-wan-preview\0")
    .update(script)
    .digest("hex");
}

function requestAdminId(req: Request): number | null {
  const value = Number(req.authUser?.uid);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function resolveScope(req: Request, res: Response): Promise<Scope | null> {
  const routerId = Number(req.params.id);
  const adminId = requestAdminId(req);
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    res.status(400).json({ ok: false, error: "Invalid router ID." });
    return null;
  }
  if (!adminId) {
    res.status(403).json({ ok: false, error: "This ISP-only feature requires an ISP admin session." });
    return null;
  }

  const adminRows = await sbSelectStrict<AdminRow>(
    "isp_admins",
    `id=eq.${adminId}&is_active=is.true&select=id,parent_id,is_active&limit=1`,
  );
  const admin = adminRows[0];
  if (!admin || admin.parent_id !== null) {
    res.status(403).json({ ok: false, error: "Multi-WAN settings are available to ISP administrators only." });
    return null;
  }

  const routerRows = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name&limit=1`,
  );
  const routerRow = routerRows[0];
  if (!routerRow) {
    res.status(404).json({ ok: false, error: "Router was not found in this ISP account." });
    return null;
  }
  const found = await getRouterCreds(routerId, adminId);
  if (!found) {
    res.status(404).json({ ok: false, error: "Router has no reachable management connection." });
    return null;
  }
  return { adminId, routerId, routerName: routerRow.name, creds: found.creds };
}

function clientConfig(value: unknown, scope: Scope): ClientConfig | null {
  const wrapper = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = wrapper.config && typeof wrapper.config === "object"
    ? wrapper.config as Record<string, unknown>
    : wrapper;
  const rawRouterId = Number(raw.routerId);
  if (Number.isFinite(rawRouterId) && rawRouterId !== scope.routerId) return null;
  const wans = Array.isArray(raw.wans) ? raw.wans : [];
  const lanLinks = Array.isArray(raw.lanLinks) ? raw.lanLinks : [];
  return {
    routerId: scope.routerId,
    enabled: raw.enabled === true,
    lanInterface: String(raw.lanInterface ?? "bridge"),
    routerOsVersion: raw.routerOsVersion === "6" || raw.routerOsVersion === "7" ? raw.routerOsVersion : "auto",
    mode: raw.mode === "failover" ? "failover" : "weighted",
    allowBridgeFirewall: raw.allowBridgeFirewall === true,
    wans: wans.slice(0, 5).map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {}),
    lanLinks: lanLinks.slice(0, 33).map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {}),
  };
}

function dbProfilePayload(parent: ConfigRow | null, wans: WanRow[], lans: LanRow[]): Record<string, unknown> {
  const positionByWanId = new Map(wans.map(wan => [wan.id, wan.position]));
  return {
    enabled: parent?.enabled ?? false,
    lanInterface: parent?.lan_interface ?? "bridge",
    routerOsVersion: parent?.router_os_version ?? "auto",
    mode: parent?.mode ?? "weighted",
    allowBridgeFirewall: parent?.allow_bridge_firewall ?? false,
    bridgeFirewallOriginal: parent?.bridge_firewall_original ?? null,
    wans: wans.map(wan => ({
      name: wan.name,
      interfaceName: wan.interface_name,
      gateway: wan.gateway ?? "",
      weight: wan.weight,
      healthCheckIp: wan.health_check_ip,
      enabled: wan.enabled,
      position: wan.position,
      connectionType: wan.connection_type,
      staticAddressCidr: wan.static_address_cidr ?? "",
      pppoeUsername: wan.pppoe_username ?? "",
      pppoeSecretCiphertext: wan.pppoe_secret_ciphertext ?? "",
      pppoeSecretIv: wan.pppoe_secret_iv ?? "",
      pppoeSecretAuthTag: wan.pppoe_secret_auth_tag ?? "",
      reassignFromBridge: wan.reassign_from_bridge,
      bridgeName: wan.bridge_name ?? "",
    })),
    lanLinks: lans.map(lan => ({
      interfaceName: lan.interface_name,
      wanPosition: positionByWanId.get(lan.wan_id) ?? 0,
      maxMbps: lan.max_mbps,
      position: lan.position,
    })),
  };
}

async function loadProfile(adminId: number, routerId: number): Promise<Profile> {
  const parents = await sbSelectStrict<ConfigRow>(
    "isp_router_load_balancing",
    `admin_id=eq.${adminId}&router_id=eq.${routerId}&select=id,admin_id,router_id,enabled,lan_interface,router_os_version,mode,allow_bridge_firewall,bridge_firewall_original&limit=1`,
  );
  const parent = parents[0] ?? null;
  if (!parent) {
    const rpcPayload = {
      enabled: false,
      lanInterface: "bridge",
      routerOsVersion: "auto",
      mode: "weighted",
      allowBridgeFirewall: false,
      bridgeFirewallOriginal: null,
      wans: [],
      lanLinks: [],
    };
    return { parent: null, wans: [], lans: [], publicConfig: rpcPayload, rpcPayload };
  }
  const [wans, lans] = await Promise.all([
    sbSelectStrict<WanRow>(
      "isp_router_load_balancing_wans",
      `admin_id=eq.${adminId}&load_balancing_id=eq.${parent.id}&select=id,admin_id,load_balancing_id,name,interface_name,gateway,weight,health_check_ip,enabled,position,connection_type,static_address_cidr,pppoe_username,pppoe_secret_ciphertext,pppoe_secret_iv,pppoe_secret_auth_tag,reassign_from_bridge,bridge_name&order=position.asc`,
    ),
    sbSelectStrict<LanRow>(
      "isp_router_load_balancing_lans",
      `admin_id=eq.${adminId}&load_balancing_id=eq.${parent.id}&select=interface_name,wan_id,max_mbps,position&order=position.asc`,
    ),
  ]);
  const rpcPayload = dbProfilePayload(parent, wans, lans);
  const userWans = wans.map(wan => ({
    name: wan.name,
    interfaceName: wan.interface_name,
    connectionType: wan.connection_type,
    staticAddressCidr: wan.static_address_cidr ?? "",
    gateway: wan.gateway ?? "",
    weight: wan.weight,
    healthCheckIp: wan.health_check_ip,
    enabled: wan.enabled,
    position: wan.position + 1,
    pppoeUsername: wan.pppoe_username ?? "",
    pppoePassword: "",
    pppoeSecretConfigured: Boolean(wan.pppoe_secret_ciphertext && wan.pppoe_secret_iv && wan.pppoe_secret_auth_tag),
    reassignFromBridge: wan.reassign_from_bridge,
    bridgeName: wan.bridge_name ?? "",
  }));
  const wanPositionById = new Map(wans.map(wan => [wan.id, wan.position + 1]));
  const publicConfig = {
    routerId,
    enabled: parent.enabled,
    lanInterface: parent.lan_interface,
    routerOsVersion: parent.router_os_version,
    mode: parent.mode,
    allowBridgeFirewall: parent.allow_bridge_firewall,
    wans: userWans,
    lanLinks: lans.map(lan => ({
      interfaceName: lan.interface_name,
      wanPosition: wanPositionById.get(lan.wan_id) ?? 1,
      maxMbps: lan.max_mbps,
    })),
  };
  return { parent, wans, lans, publicConfig, rpcPayload };
}

async function internalConfig(
  client: ClientConfig,
  scope: Scope,
  previous: Profile,
): Promise<LoadBalancingConfig> {
  const oldByInterface = new Map(previous.wans.map(wan => [wan.interface_name, wan]));
  const wans: LoadBalancingWan[] = [];
  for (const [index, raw] of client.wans.entries()) {
    const old = oldByInterface.get(String(raw.interfaceName ?? ""));
    const preservePreviousPromotion = client.enabled
      && raw.enabled !== false
      && old?.reassign_from_bridge === true
      && Boolean(old.bridge_name);
    let pppoePassword = String(raw.pppoePassword ?? "");
    let pppoeSecretConfigured = raw.pppoeSecretConfigured === true;
    if (!pppoePassword && old?.pppoe_secret_ciphertext && old.pppoe_secret_iv && old.pppoe_secret_auth_tag) {
      pppoePassword = decryptVpnSecret({
        ciphertext: old.pppoe_secret_ciphertext,
        iv: old.pppoe_secret_iv,
        auth_tag: old.pppoe_secret_auth_tag,
      });
      pppoeSecretConfigured = true;
    }
    wans.push({
      name: String(raw.name ?? `WAN ${index + 1}`),
      interfaceName: String(raw.interfaceName ?? ""),
      connectionType: raw.connectionType === "pppoe" ? "pppoe" : "static",
      staticAddressCidr: String(raw.staticAddressCidr ?? ""),
      gateway: String(raw.gateway ?? ""),
      weight: Number(raw.weight ?? 1),
      healthCheckIp: String(raw.healthCheckIp ?? ""),
      enabled: raw.enabled !== false,
      position: index,
      pppoeUsername: String(raw.pppoeUsername ?? ""),
      pppoePassword,
      pppoeSecretConfigured,
      reassignFromBridge: raw.reassignFromBridge === true || preservePreviousPromotion,
      bridgeName: String(raw.bridgeName || (preservePreviousPromotion ? old?.bridge_name : "") || ""),
    });
  }
  const activeInterfaces = new Set(client.enabled
    ? wans.filter(wan => wan.enabled).map(wan => wan.interfaceName)
    : []);
  const restoreBridgePorts = previous.wans
    .filter(wan => wan.reassign_from_bridge && wan.bridge_name && !activeInterfaces.has(wan.interface_name))
    .map(wan => ({ bridgeName: wan.bridge_name!, interfaceName: wan.interface_name }));
  return {
    routerId: scope.routerId,
    adminId: scope.adminId,
    enabled: client.enabled,
    lanInterface: client.lanInterface,
    routerOsVersion: client.routerOsVersion,
    mode: client.mode,
    allowBridgeFirewall: client.allowBridgeFirewall,
    ...(typeof previous.parent?.bridge_firewall_original === "boolean"
      ? { bridgeFirewallOriginal: previous.parent.bridge_firewall_original }
      : {}),
    restoreBridgePorts,
    wans,
    lanLinks: client.lanLinks.map(row => ({
      lanInterface: String(row.interfaceName ?? row.lanInterface ?? ""),
      wanPosition: Number(row.wanPosition ?? 1) - 1,
      maxMbps: Number(row.maxMbps ?? 0),
    })),
  };
}

function simpleBridgePort(settings: Record<string, string> | undefined): boolean {
  if (!settings) return false;
  const defaults: Record<string, Set<string>> = {
    pvid: new Set(["1"]),
    priority: new Set(["0x80", "128"]),
    "path-cost": new Set(["10"]),
    "internal-path-cost": new Set(["10"]),
    horizon: new Set(["none"]),
    edge: new Set(["auto"]),
    "point-to-point": new Set(["auto"]),
    "ingress-filtering": new Set(["no", "false"]),
    "frame-types": new Set(["admit-all"]),
    "unknown-unicast-flood": new Set(["yes", "true"]),
    "unknown-multicast-flood": new Set(["yes", "true"]),
    "broadcast-flood": new Set(["yes", "true"]),
    "fast-leave": new Set(["no", "false"]),
    "bpdu-guard": new Set(["no", "false"]),
    trusted: new Set(["no", "false"]),
    "tag-stacking": new Set(["no", "false"]),
    hw: new Set(["yes", "true"]),
    disabled: new Set(["no", "false"]),
  };
  const identity = new Set([".id", "bridge", "interface", "comment", "dynamic", "running", "flags"]);
  for (const [key, raw] of Object.entries(settings)) {
    if (identity.has(key) || raw === "") continue;
    if (!defaults[key]?.has(String(raw).toLowerCase())) return false;
  }
  return !String(settings.comment ?? "").trim();
}

async function livePreflight(config: LoadBalancingConfig, inventory: RouterLoadBalancingInventory, previous: Profile): Promise<{ errors: string[]; warnings: string[]; changes: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const changes: string[] = [
    "Remove and recreate only RouterOS objects tagged ISPlatty-LB; unmarked routes, firewall rules, addresses, and queues are left in place.",
  ];
  if (!config.enabled) {
    changes.push("Disable multi-WAN, remove only ISPlatty-LB resources, restore promoted ports, and restore the saved bridge-firewall setting.");
    return { errors, warnings, changes };
  }
  const interfaceByName = new Map(inventory.interfaces.map(item => [item.name, item]));
  const active = config.wans.filter(wan => wan.enabled);
  const selectedWanNames = new Set(active.map(wan => wan.interfaceName));
  const previouslyPromoted = new Map(previous.wans
    .filter(wan => wan.reassign_from_bridge && wan.bridge_name)
    .map(wan => [wan.interface_name, wan.bridge_name!]));
  if (!inventory.bridges.some(bridge => bridge.name === config.lanInterface)) {
    errors.push(`Customer LAN bridge ${config.lanInterface} was not found on the selected router.`);
  }

  for (const wan of active) {
    const iface = interfaceByName.get(wan.interfaceName);
    const physical = iface && (
      iface.type.toLowerCase().includes("ether")
      || iface.type.toLowerCase().includes("sfp")
      || /^(ether|sfp|combo)/i.test(iface.name)
    );
    if (!physical || iface?.disabled) {
      errors.push(`${wan.name}: select an enabled Ethernet or SFP/SFP+ interface from this router.`);
      continue;
    }
    const memberships = inventory.bridgePorts.filter(port => port.interface === wan.interfaceName);
    if (memberships.length > 0) {
      if (!wan.reassignFromBridge) {
        errors.push(`${wan.name}: ${wan.interfaceName} is still a LAN bridge port. Enable the explicit bridge-port promotion option or select another interface.`);
      } else if (memberships.length !== 1 || memberships[0].bridge !== wan.bridgeName) {
        errors.push(`${wan.name}: the selected bridge does not match the live membership for ${wan.interfaceName}.`);
      } else {
        const bridgePort = memberships[0];
        const remaining = inventory.bridgePorts.filter(port => port.bridge === bridgePort.bridge && port.interface !== wan.interfaceName).length;
        if (remaining < 1) errors.push(`${wan.name}: cannot remove the last interface from bridge ${bridgePort.bridge}.`);
        if (!simpleBridgePort(bridgePort.settings)) errors.push(`${wan.name}: ${wan.interfaceName} has custom bridge-port settings. Detach it manually before using it as WAN so its VLAN and forwarding settings are preserved.`);
        changes.push(`Remove ${wan.interfaceName} from bridge ${bridgePort.bridge}; its devices will no longer use the LAN on that physical port.`);
        warnings.push(`Promoting ${wan.interfaceName} to WAN interrupts LAN service for devices on that port. A recovery script will restore its previous bridge membership.`);
      }
    } else if (wan.reassignFromBridge && previouslyPromoted.get(wan.interfaceName) !== wan.bridgeName) {
      errors.push(`${wan.name}: ${wan.interfaceName} is not currently a bridge port, so the promotion option is stale.`);
    }
    if (memberships.length > 0 || wan.reassignFromBridge) {
      const assigned = await awaitAssignmentCheck(config, wan);
      if (assigned) errors.push(`${wan.name}: ${wan.interfaceName} has an ISP service assignment. Release that service assignment before promoting the port.`);
    }
    if (wan.connectionType === "static") {
      const address = (wan.staticAddressCidr ?? "").trim();
      const existing = inventory.addresses.filter(item => item.interface === wan.interfaceName && !item.dynamic);
      if (!address && existing.length === 0) errors.push(`${wan.name}: enter a static address or configure a static address on ${wan.interfaceName} first.`);
      if (address) {
        const duplicate = inventory.addresses.find(item => item.address === address && item.interface !== wan.interfaceName);
        if (duplicate) errors.push(`${wan.name}: ${address} is already assigned to ${duplicate.interface}.`);
        const existingSame = inventory.addresses.find(item => item.address === address && item.interface === wan.interfaceName);
        if (existingSame && !existingSame.comment.startsWith("ISPlatty-LB ")) {
          errors.push(`${wan.name}: ${address} already exists on ${wan.interfaceName}; leave Address / CIDR blank to reuse it.`);
        }
      }
    }
    if (wan.connectionType === "pppoe") {
      const expectedName = `isplatty-pppoe${wan.position + 1}`;
      const collision = inventory.pppoeClients.find(item => item.name === expectedName && !item.comment.startsWith("ISPlatty-LB "));
      if (collision) errors.push(`${wan.name}: RouterOS already has an unrelated PPPoE client named ${expectedName}.`);
      changes.push(`Configure a PPPoE client on ${wan.interfaceName}; its password remains encrypted in the ISP database.`);
    } else {
      if (wan.staticAddressCidr) changes.push(`Set ${wan.staticAddressCidr} on ${wan.interfaceName} and route through ${wan.gateway}.`);
      else changes.push(`Reuse the existing static address on ${wan.interfaceName} and route through ${wan.gateway}.`);
    }
  }

  const lanSeen = new Set<string>();
  for (const link of config.lanLinks ?? []) {
    if (lanSeen.has(link.lanInterface)) errors.push(`LAN interface ${link.lanInterface} is listed more than once.`);
    lanSeen.add(link.lanInterface);
    if (selectedWanNames.has(link.lanInterface)) errors.push(`${link.lanInterface} cannot be both a WAN and a pinned LAN interface.`);
    if (!interfaceByName.has(link.lanInterface)) errors.push(`LAN interface ${link.lanInterface} was not found on the selected router.`);
    const selectedWan = active.find(wan => wan.position === link.wanPosition);
    if (!selectedWan) errors.push(`LAN interface ${link.lanInterface} must be pinned to an enabled WAN.`);
    const bridgeMembership = inventory.bridgePorts.find(port =>
      port.interface === link.lanInterface && port.bridge === config.lanInterface,
    );
    if (!bridgeMembership) errors.push(`${link.lanInterface} is not a member of the selected customer LAN bridge ${config.lanInterface}.`);
    else if (!config.allowBridgeFirewall) {
      errors.push(`LAN pinning on bridge port ${link.lanInterface} requires explicit bridge firewall handling.`);
    }
    if (link.maxMbps < 1 || link.maxMbps > 100000) errors.push(`${link.lanInterface}: capacity must be between 1 and 100000 Mbps.`);
    changes.push(`Pin ${link.lanInterface} to ${selectedWan?.name ?? "the selected WAN"} and cap upload/download at ${link.maxMbps} Mbps.`);
  }
  if ((config.lanLinks?.length ?? 0) > 0 && config.allowBridgeFirewall) {
    warnings.push("Bridge firewall handling can reduce hardware offload performance on some MikroTik models.");
    changes.push("Enable bridge firewall handling for exact per-port traffic policy.");
  }
  if (config.enabled && active.length >= 2) {
    changes.push(config.mode === "weighted"
      ? `Distribute new connections across ${active.length} WAN links by weight and use health-checked failover.`
      : `Use WAN position as failover priority across ${active.length} links.`);
  }
  return { errors, warnings, changes };
}

async function awaitAssignmentCheck(config: LoadBalancingConfig, wan: LoadBalancingWan): Promise<boolean> {
  const rows = await sbSelectStrict<{ id: number; status: string }>(
    "isp_reseller_ports",
    `admin_id=eq.${config.adminId}&router_id=eq.${config.routerId}&interface_name=eq.${encodeURIComponent(wan.interfaceName)}&select=id,status&limit=10`,
  );
  return rows.some(row => row.status !== "failed" && row.status !== "disabled");
}

async function prepare(scope: Scope, value: unknown): Promise<Prepared> {
  const client = clientConfig(value, scope);
  if (!client) {
    return {
      internal: {} as LoadBalancingConfig,
      script: "",
      previewHash: "",
      errors: ["Router ID in the request does not match the selected router."],
      warnings: [],
      changes: [],
      inventory: await fetchRouterLoadBalancingInventory(scope.creds),
    };
  }
  const previous = await loadProfile(scope.adminId, scope.routerId);
  const internal = await internalConfig(client, scope, previous);
  const validation = validateLoadBalancingConfig(internal, scope.routerId, scope.adminId);
  if (validation.errors.length || !validation.config) {
    return {
      internal,
      script: "",
      previewHash: "",
      errors: validation.errors,
      warnings: [],
      changes: [],
      inventory: await fetchRouterLoadBalancingInventory(scope.creds),
    };
  }
  const inventory = await fetchRouterLoadBalancingInventory(scope.creds);
  const effective = validation.config;
  if (effective.allowBridgeFirewall && (effective.lanPortPins?.length ?? 0) > 0 && effective.bridgeFirewallOriginal === undefined) {
    effective.bridgeFirewallOriginal = inventory.bridgeUseIpFirewall;
  }
  const safety = await livePreflight(effective, inventory, previous);
  let script = "";
  try {
    script = buildLoadBalancingScript(effective, inventory.routerVersion).script;
  } catch (error) {
    safety.errors.push(error instanceof Error ? error.message : "RouterOS script could not be generated.");
  }
  return {
    internal: effective,
    script,
    previewHash: script ? previewHash(script) : "",
    errors: safety.errors,
    warnings: safety.warnings,
    changes: safety.changes,
    inventory,
  };
}

function previousProfileBridgeRestoreScript(
  next: LoadBalancingConfig,
  inventory: RouterLoadBalancingInventory,
): string {
  const selected = new Set(next.enabled
    ? next.wans.filter(wan => wan.enabled && wan.reassignFromBridge).map(wan => wan.interfaceName)
    : []);
  const restore = inventory.bridgePorts
    .filter(port => selected.has(port.interface))
    .map(port => `:if ([:len [/interface bridge port find where bridge="${port.bridge.replaceAll('"', '\\"')}" and interface="${port.interface.replaceAll('"', '\\"')}"]] = 0) do={ /interface bridge port add bridge="${port.bridge.replaceAll('"', '\\"')}" interface="${port.interface.replaceAll('"', '\\"')}" }`);
  restore.push(`/interface bridge settings set use-ip-firewall=${inventory.bridgeUseIpFirewall ? "yes" : "no"}`);
  return `\n# Restore prior simple bridge-port memberships and global bridge firewall value\n${restore.join("\n")}\n`;
}

function previousInternalConfig(scope: Scope, previous: Profile): LoadBalancingConfig {
  const payload = previous.rpcPayload as Record<string, unknown>;
  const wans = Array.isArray(payload.wans) ? payload.wans as Array<Record<string, unknown>> : [];
  const lanLinks = Array.isArray(payload.lanLinks) ? payload.lanLinks as Array<Record<string, unknown>> : [];
  return {
    routerId: scope.routerId,
    adminId: scope.adminId,
    enabled: payload.enabled === true,
    lanInterface: String(payload.lanInterface ?? "bridge"),
    routerOsVersion: payload.routerOsVersion === "6" || payload.routerOsVersion === "7" ? payload.routerOsVersion : "auto",
    mode: payload.mode === "failover" ? "failover" : "weighted",
    allowBridgeFirewall: payload.allowBridgeFirewall === true,
    ...(typeof payload.bridgeFirewallOriginal === "boolean"
      ? { bridgeFirewallOriginal: payload.bridgeFirewallOriginal }
      : {}),
    wans: wans.map((row, index) => ({
      name: String(row.name ?? `WAN ${index + 1}`),
      interfaceName: String(row.interfaceName ?? ""),
      gateway: String(row.gateway ?? ""),
      weight: Number(row.weight ?? 1),
      healthCheckIp: String(row.healthCheckIp ?? ""),
      enabled: row.enabled !== false,
      position: index,
      connectionType: row.connectionType === "pppoe" ? "pppoe" : "static",
      staticAddressCidr: String(row.staticAddressCidr ?? ""),
      pppoeUsername: String(row.pppoeUsername ?? ""),
      pppoePassword: row.pppoeSecretCiphertext && row.pppoeSecretIv && row.pppoeSecretAuthTag
        ? decryptVpnSecret({
            ciphertext: String(row.pppoeSecretCiphertext),
            iv: String(row.pppoeSecretIv),
            auth_tag: String(row.pppoeSecretAuthTag),
          })
        : "",
      pppoeSecretConfigured: Boolean(row.pppoeSecretCiphertext),
      reassignFromBridge: row.reassignFromBridge === true,
      bridgeName: String(row.bridgeName ?? ""),
    })),
    lanLinks: lanLinks.map(row => ({
      lanInterface: String(row.interfaceName ?? ""),
      wanPosition: Number(row.wanPosition ?? 0),
      maxMbps: Number(row.maxMbps ?? 0),
    })),
  };
}

async function saveConfig(scope: Scope, config: LoadBalancingConfig, previous: Profile): Promise<Record<string, unknown>> {
  const oldByInterface = new Map(previous.wans.map(wan => [wan.interface_name, wan]));
  const wans = [];
  for (const [index, wan] of config.wans.entries()) {
    const old = oldByInterface.get(wan.interfaceName);
    let encrypted = {
      pppoeSecretCiphertext: "",
      pppoeSecretIv: "",
      pppoeSecretAuthTag: "",
    };
    if (wan.connectionType === "pppoe") {
      if (wan.pppoePassword) {
        const value = encryptVpnSecret(wan.pppoePassword);
        encrypted = {
          pppoeSecretCiphertext: value.ciphertext,
          pppoeSecretIv: value.iv,
          pppoeSecretAuthTag: value.auth_tag,
        };
      } else if (old?.pppoe_secret_ciphertext && old.pppoe_secret_iv && old.pppoe_secret_auth_tag) {
        encrypted = {
          pppoeSecretCiphertext: old.pppoe_secret_ciphertext,
          pppoeSecretIv: old.pppoe_secret_iv,
          pppoeSecretAuthTag: old.pppoe_secret_auth_tag,
        };
      } else if (wan.pppoeSecretConfigured) {
        throw new Error(`${wan.name}: the stored PPPoE secret is unavailable. Enter it again before saving.`);
      }
    }
    wans.push({
      name: wan.name,
      interfaceName: wan.interfaceName,
      gateway: wan.gateway,
      weight: wan.weight,
      healthCheckIp: wan.healthCheckIp,
      enabled: wan.enabled,
      position: index,
      connectionType: wan.connectionType ?? "static",
      staticAddressCidr: wan.staticAddressCidr ?? "",
      pppoeUsername: wan.pppoeUsername ?? "",
      ...encrypted,
      reassignFromBridge: wan.reassignFromBridge ?? false,
      bridgeName: wan.bridgeName ?? "",
    });
  }
  const payload = {
    enabled: config.enabled,
    lanInterface: config.lanInterface,
    routerOsVersion: config.routerOsVersion,
    mode: config.mode ?? "weighted",
    allowBridgeFirewall: config.allowBridgeFirewall ?? false,
    bridgeFirewallOriginal: config.enabled
      && config.allowBridgeFirewall
      && (config.lanPortPins?.length ?? 0) > 0
      ? (previous.parent?.bridge_firewall_original ?? config.bridgeFirewallOriginal ?? null)
      : null,
    wans,
    lanLinks: (config.lanLinks ?? []).map((link, index) => ({
      interfaceName: link.lanInterface,
      wanPosition: link.wanPosition,
      maxMbps: link.maxMbps,
      position: index,
    })),
  };
  const result = await sbRpc<{ id: number }>("save_isp_router_load_balancing", {
    p_admin_id: scope.adminId,
    p_router_id: scope.routerId,
    p_payload: payload,
  });
  if (!result?.[0]?.id) throw new Error("The multi-WAN settings were not saved.");
  return payload;
}

function registerSource(content: string): { token: string; fileName: string } {
  const now = Date.now();
  for (const [token, entry] of scriptSources) {
    if (entry.expiresAt <= now) scriptSources.delete(token);
  }
  const token = randomBytes(24).toString("hex");
  scriptSources.set(token, { content, expiresAt: now + SCRIPT_SOURCE_TTL_MS });
  return { token, fileName: `ochola-lb-${token}.rsc` };
}

async function transferAndRun(scope: Scope, req: Request, script: string): Promise<void> {
  const origin = requestOrigin(req);
  if (!origin.startsWith("https://")) {
    throw new Error("RouterOS script transfer requires a publicly trusted HTTPS API origin.");
  }
  const source = registerSource(script);
  const destinationPath = source.fileName;
  const sourceUrl = `${origin}/api/router-load-balancing-source/${source.token}`;
  await deployRouterFile(scope.creds, { sourceUrl, destinationPath, overwrite: false, uploadId: source.token.slice(0, 16) });
  try {
    await runRouterScript(scope.creds, destinationPath);
  } finally {
    await removeRouterFile(scope.creds, destinationPath).catch(() => undefined);
    scriptSources.delete(source.token);
  }
}

function verifyApplied(
  internal: LoadBalancingConfig,
  inventory: RouterLoadBalancingInventory,
  security: Awaited<ReturnType<typeof fetchRouterSecurityState>>,
): string[] {
  const errors: string[] = [];
  const owns = (row: Record<string, string>) => String(row.comment ?? "").startsWith("ISPlatty-LB ");
  const ownedMangle = security.firewallMangle.filter(owns);
  const ownedNat = security.firewallNat.filter(owns);
  const ownedRoutes = security.routes.filter(owns);
  if (!internal.enabled) {
    if (ownedMangle.length || ownedNat.length || ownedRoutes.length) errors.push("RouterOS still reports active ISPlatty-LB routing or firewall rules.");
    if (inventory.pppoeClients.some(client => client.comment.startsWith("ISPlatty-LB PPPoE "))
      || inventory.addresses.some(address => address.comment.startsWith("ISPlatty-LB "))) {
      errors.push("RouterOS still reports active ISPlatty-LB WAN interface resources.");
    }
    if (typeof internal.bridgeFirewallOriginal === "boolean"
      && inventory.bridgeUseIpFirewall !== internal.bridgeFirewallOriginal) {
      errors.push("RouterOS did not restore the previous bridge-firewall setting.");
    }
    for (const port of internal.restoreBridgePorts ?? []) {
      if (!inventory.bridgePorts.some(current => current.bridge === port.bridgeName && current.interface === port.interfaceName)) {
        errors.push(`RouterOS did not restore ${port.interfaceName} to bridge ${port.bridgeName}.`);
      }
    }
    return errors;
  }
  const needsBridgeFirewall = internal.allowBridgeFirewall && (internal.lanPortPins?.length ?? 0) > 0;
  if (needsBridgeFirewall && !inventory.bridgeUseIpFirewall) {
    errors.push("RouterOS did not enable bridge firewall handling for LAN port policies.");
  }
  if (!needsBridgeFirewall && typeof internal.bridgeFirewallOriginal === "boolean"
    && inventory.bridgeUseIpFirewall !== internal.bridgeFirewallOriginal) {
    errors.push("RouterOS did not restore the previous bridge-firewall setting.");
  }
  for (const port of internal.restoreBridgePorts ?? []) {
    if (!inventory.bridgePorts.some(current => current.bridge === port.bridgeName && current.interface === port.interfaceName)) {
      errors.push(`RouterOS did not restore ${port.interfaceName} to bridge ${port.bridgeName}.`);
    }
  }
  for (const wan of internal.wans.filter(item => item.enabled && item.reassignFromBridge && item.bridgeName)) {
    if (inventory.bridgePorts.some(current => current.bridge === wan.bridgeName && current.interface === wan.interfaceName)) {
      errors.push(`${wan.name}: RouterOS still lists ${wan.interfaceName} in bridge ${wan.bridgeName}.`);
    }
  }
  if (internal.enabled && internal.wans.some(wan => wan.enabled)) {
    const markedRoutes = ownedRoutes;
    const markedMangle = ownedMangle;
    if (!markedRoutes.length || !markedMangle.length) errors.push("RouterOS did not report the new marked routes and firewall rules.");
  }
  for (const wan of internal.wans.filter(item => item.enabled && internal.enabled)) {
    if (wan.connectionType === "pppoe") {
      const name = `isplatty-pppoe${wan.position + 1}`;
      if (!inventory.pppoeClients.some(client => client.name === name && client.comment.startsWith("ISPlatty-LB "))) {
        errors.push(`${wan.name}: the generated PPPoE client is missing after apply.`);
      }
    }
    if (wan.connectionType === "static" && wan.staticAddressCidr) {
      if (!inventory.addresses.some(address =>
        address.interface === wan.interfaceName && address.address === wan.staticAddressCidr,
      )) errors.push(`${wan.name}: the static address is missing after apply.`);
    }
  }
  return errors;
}

async function getRecovery(scope: Scope): Promise<RecoveryRow | null> {
  const rows = await sbSelectStrict<RecoveryRow>(
    "isp_router_load_balancing_recovery",
    `admin_id=eq.${scope.adminId}&router_id=eq.${scope.routerId}&select=script_ciphertext,script_iv,script_auth_tag,previous_config,expires_at&limit=1`,
  );
  return rows[0] ?? null;
}

async function saveRecovery(scope: Scope, script: string, previousConfig: Record<string, unknown>, bridgeFirewallState: boolean): Promise<void> {
  const encrypted = encryptVpnSecret(script);
  await sbUpsertStrict("isp_router_load_balancing_recovery", "admin_id,router_id", {
    admin_id: scope.adminId,
    router_id: scope.routerId,
    script_ciphertext: encrypted.ciphertext,
    script_iv: encrypted.iv,
    script_auth_tag: encrypted.auth_tag,
    previous_config: { ...previousConfig, recoveryBridgeFirewall: bridgeFirewallState },
    expires_at: new Date(Date.now() + RECOVERY_TTL_MS).toISOString(),
  });
}

function safeInternalFromPayload(scope: Scope, payload: Record<string, unknown>): LoadBalancingConfig {
  const normalized = previousInternalConfig(scope, {
    parent: null,
    wans: [],
    lans: [],
    publicConfig: payload,
    rpcPayload: payload,
  });
  return normalized;
}

async function restoreFromRecovery(scope: Scope, req: Request, recovery: RecoveryRow): Promise<void> {
  const script = decryptVpnSecret({
    ciphertext: recovery.script_ciphertext,
    iv: recovery.script_iv,
    auth_tag: recovery.script_auth_tag,
  });
  await transferAndRun(scope, req, script);
  const previous = safeInternalFromPayload(scope, recovery.previous_config);
  const [inventory, security] = await Promise.all([
    fetchRouterLoadBalancingInventory(scope.creds),
    fetchRouterSecurityState(scope.creds),
  ]);
  const verifyErrors = verifyApplied(previous, inventory, security);
  if (verifyErrors.length
    || (typeof recovery.previous_config.recoveryBridgeFirewall === "boolean"
      && inventory.bridgeUseIpFirewall !== recovery.previous_config.recoveryBridgeFirewall)) {
    throw new Error("RouterOS could not confirm the saved recovery state.");
  }
  await sbRpc<{ id: number }>("save_isp_router_load_balancing", {
    p_admin_id: scope.adminId,
    p_router_id: scope.routerId,
    p_payload: recovery.previous_config,
  });
}

router.get("/router-load-balancing-source/:token", (req, res): void => {
  const token = req.params.token;
  if (!/^[a-f0-9]{48}$/i.test(token)) {
    res.status(404).end();
    return;
  }
  const entry = scriptSources.get(token);
  scriptSources.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.type("text/plain").send(entry.content);
});

router.get("/router/:id/load-balancing", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const [profile, recovery] = await Promise.all([
      loadProfile(scope.adminId, scope.routerId),
      getRecovery(scope),
    ]);
    res.json({
      ok: true,
      config: profile.parent ? profile.publicConfig : null,
      routerName: scope.routerName,
      recoveryAvailable: Boolean(recovery && new Date(recovery.expires_at).getTime() > Date.now()),
      recoveryExpiresAt: recovery?.expires_at ?? null,
    });
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN settings could not be loaded");
    res.status(500).json({ ok: false, error: "Multi-WAN settings could not be loaded." });
  }
});

router.get("/router/:id/load-balancing/interfaces", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const inventory = await fetchRouterLoadBalancingInventory(scope.creds);
    res.json({
      ok: true,
      interfaces: {
        interfaces: inventory.interfaces.map(({ name, type, running, disabled }) => ({ name, type, running, disabled })),
        bridges: inventory.bridges,
        bridgePorts: inventory.bridgePorts.map(({ bridge, interface: interfaceName }) => ({ bridge, interface: interfaceName })),
        addresses: inventory.addresses.map(({ interface: interfaceName, address }) => ({ interface: interfaceName, address })),
        connectedVia: inventory.connectedVia,
      },
    });
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN interface inventory failed");
    res.status(502).json({ ok: false, error: "Live router interfaces could not be read." });
  }
});

router.put("/router/:id/load-balancing", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const client = clientConfig(req.body, scope);
    if (!client) {
      res.status(400).json({ ok: false, error: "Router ID in the request does not match the selected router." });
      return;
    }
    const previous = await loadProfile(scope.adminId, scope.routerId);
    const internal = await internalConfig(client, scope, previous);
    const validation = validateLoadBalancingConfig(internal, scope.routerId, scope.adminId);
    if (validation.errors.length || !validation.config) {
      res.status(400).json({ ok: false, errors: validation.errors });
      return;
    }
    await saveConfig(scope, validation.config, previous);
    const saved = await loadProfile(scope.adminId, scope.routerId);
    res.json({ ok: true, config: saved.publicConfig });
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN draft could not be saved");
    res.status(500).json({ ok: false, error: "Multi-WAN settings could not be saved." });
  }
});

router.post("/router/:id/load-balancing/preview", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const prepared = await prepare(scope, req.body);
    const scriptPreview = prepared.script ? redactLoadBalancingScript(prepared.script) : "";
    res.json({
      ok: prepared.errors.length === 0,
      errors: prepared.errors,
      warnings: prepared.warnings,
      changes: prepared.changes,
      scriptPreview,
      previewHash: prepared.previewHash,
      enabledWanCount: prepared.internal.wans?.filter(wan => wan.enabled).length ?? 0,
    });
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN preview failed");
    res.status(502).json({ ok: false, errors: ["Live router validation failed. No changes were applied."], warnings: [], changes: [], scriptPreview: "", previewHash: "", enabledWanCount: 0 });
  }
});

router.post("/router/:id/load-balancing/apply", requireAdmin(), async (req, res): Promise<void> => {
  const lockKey = `${req.authUser?.uid}:${req.params.id}`;
  if (activeOperations.has(lockKey)) {
    res.status(409).json({ ok: false, error: "A multi-WAN operation is already running for this router." });
    return;
  }
  activeOperations.add(lockKey);
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const prepared = await prepare(scope, req.body);
    if (prepared.errors.length) {
      res.status(400).json({ ok: false, error: prepared.errors[0], errors: prepared.errors, warnings: prepared.warnings });
      return;
    }
    const confirmationName = String(req.body?.confirmationName ?? "").trim();
    if (confirmationName !== scope.routerName.trim()) {
      res.status(400).json({ ok: false, error: "Router name confirmation does not match." });
      return;
    }
    if (typeof req.body?.previewHash !== "string" || req.body.previewHash !== prepared.previewHash) {
      res.status(409).json({ ok: false, error: "Router state or configuration changed after preview. Generate a new preview before applying." });
      return;
    }

    const previous = await loadProfile(scope.adminId, scope.routerId);
    const oldInternal = previousInternalConfig(scope, previous);
    const oldScript = buildLoadBalancingScript(oldInternal, prepared.inventory.routerVersion).script;
    const bridgeRestore = previousProfileBridgeRestoreScript(prepared.internal, prepared.inventory);
    const recoveryScript = `${oldScript}${bridgeRestore}`;
    await saveRecovery(scope, recoveryScript, previous.rpcPayload, prepared.inventory.bridgeUseIpFirewall);

    try {
      await transferAndRun(scope, req, prepared.script);
      const [inventory, security] = await Promise.all([
        fetchRouterLoadBalancingInventory(scope.creds),
        fetchRouterSecurityState(scope.creds),
      ]);
      const verifyErrors = verifyApplied(prepared.internal, inventory, security);
      if (verifyErrors.length) throw new Error("RouterOS verification failed.");
      await saveConfig(scope, prepared.internal, previous);
      res.json({ ok: true, recoveryAvailable: true, appliedAt: new Date().toISOString() });
    } catch (error) {
      let rollbackOk = false;
      try {
        await transferAndRun(scope, req, recoveryScript);
        const [restoredInventory, restoredSecurity] = await Promise.all([
          fetchRouterLoadBalancingInventory(scope.creds),
          fetchRouterSecurityState(scope.creds),
        ]);
        if (verifyApplied(oldInternal, restoredInventory, restoredSecurity).length
          || restoredInventory.bridgeUseIpFirewall !== prepared.inventory.bridgeUseIpFirewall) {
          throw new Error("The previous RouterOS state could not be verified.");
        }
        if (previous.parent) {
          await sbRpc<{ id: number }>("save_isp_router_load_balancing", {
            p_admin_id: scope.adminId,
            p_router_id: scope.routerId,
            p_payload: previous.rpcPayload,
          });
        }
        rollbackOk = true;
      } catch {
        rollbackOk = false;
      }
      if (rollbackOk) {
        await sbDeleteStrict("isp_router_load_balancing_recovery", `admin_id=eq.${scope.adminId}&router_id=eq.${scope.routerId}`);
      }
      logger.error({ routerId: scope.routerId, recoveryAvailable: !rollbackOk }, "Multi-WAN apply failed");
      res.status(502).json({
        ok: false,
        error: rollbackOk
          ? "RouterOS rejected the change. The previous multi-WAN state was restored."
          : "RouterOS apply or verification failed. The encrypted recovery point is available; reconnect and use Rollback last apply.",
        recoveryAvailable: !rollbackOk,
      });
    }
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN apply could not be started");
    res.status(500).json({ ok: false, error: "Multi-WAN apply could not be started. No successful apply was confirmed." });
  } finally {
    activeOperations.delete(lockKey);
  }
});

router.post("/router/:id/load-balancing/rollback", requireAdmin(), async (req, res): Promise<void> => {
  const lockKey = `${req.authUser?.uid}:${req.params.id}`;
  if (activeOperations.has(lockKey)) {
    res.status(409).json({ ok: false, error: "A multi-WAN operation is already running for this router." });
    return;
  }
  activeOperations.add(lockKey);
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    const recovery = await getRecovery(scope);
    if (!recovery) {
      res.status(404).json({ ok: false, error: "No recovery point is available for this router." });
      return;
    }
    if (new Date(recovery.expires_at).getTime() <= Date.now()) {
      await sbDeleteStrict("isp_router_load_balancing_recovery", `admin_id=eq.${scope.adminId}&router_id=eq.${scope.routerId}`);
      res.status(410).json({ ok: false, error: "The recovery point expired. Create a fresh preview before applying again." });
      return;
    }
    try {
      await restoreFromRecovery(scope, req, recovery);
      await sbDeleteStrict("isp_router_load_balancing_recovery", `admin_id=eq.${scope.adminId}&router_id=eq.${scope.routerId}`);
      res.json({ ok: true, restoredAt: new Date().toISOString() });
    } catch {
      logger.error({ routerId: scope.routerId }, "Multi-WAN recovery failed");
      res.status(502).json({ ok: false, error: "Recovery could not be confirmed. The encrypted recovery point remains available for retry." });
    }
  } catch (error) {
    logger.error({ routerId: req.params.id }, "Multi-WAN recovery could not be started");
    res.status(500).json({ ok: false, error: "Recovery could not be started." });
  } finally {
    activeOperations.delete(lockKey);
  }
});

export default router;