import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import {
  buildLoadBalancingScript,
  redactLoadBalancingScript,
  resolveRouterOsMajor,
  validateLoadBalancingConfig,
  type LoadBalancingConfig,
  type LoadBalancingWan,
} from "../lib/router-load-balancing.js";
import {
  buildOpenVpnProviderProfile,
  hasActiveCustomerOvpnClient,
  isProtectedManagementOvpn,
} from "../lib/openvpn-profile.js";
import {
  deployRouterFile,
  configureRouterOvpnWanClient,
  fetchRouterLoadBalancingInventory,
  fetchRouterSecurityState,
  removeRouterFile,
  removeRouterOvpnWanClient,
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
  connection_type: "static" | "pppoe" | "dhcp" | "existing" | "ovpn";
  static_address_cidr: string | null;
  vlan_id: number | null;
  underlay_wan_position: number | null;
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
type OpenVpnProfile = {
  profileText: string;
  username: string;
  password: string;
  keyPassphrase: string;
  remoteHost?: string;
  remotePort?: number;
  protocol?: "udp" | "tcp";
  caCertificate?: string;
  clientCertificate?: string;
  clientKey?: string;
};
type OpenVpnProfileRow = {
  admin_id: number;
  profile_ciphertext: string;
  profile_iv: string;
  profile_auth_tag: string;
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
  openVpnProfile?: OpenVpnProfile;
  openVpnProfileHash?: string;
  openVpnRemoteAddresses?: string[];
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

async function requireRootAdmin(req: Request, res: Response): Promise<number | null> {
  const adminId = requestAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "This setting requires an ISP admin session." });
    return null;
  }
  const rows = await sbSelectStrict<AdminRow>(
    "isp_admins",
    `id=eq.${adminId}&is_active=is.true&select=id,parent_id,is_active&limit=1`,
  );
  if (!rows[0] || rows[0].parent_id !== null) {
    res.status(403).json({ ok: false, error: "Only the ISP owner can manage the shared OpenVPN profile." });
    return null;
  }
  return adminId;
}

async function loadOpenVpnProfile(adminId: number): Promise<OpenVpnProfile | null> {
  const rows = await sbSelectStrict<OpenVpnProfileRow>(
    "isp_admin_openvpn_wan_profiles",
    `admin_id=eq.${adminId}&select=admin_id,profile_ciphertext,profile_iv,profile_auth_tag&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  const decoded = decryptVpnSecret({
    ciphertext: row.profile_ciphertext,
    iv: row.profile_iv,
    auth_tag: row.profile_auth_tag,
  });
  const value = JSON.parse(decoded) as Partial<OpenVpnProfile>;
  if (
    typeof value.profileText !== "string"
    || typeof value.username !== "string"
    || typeof value.password !== "string"
    || typeof value.keyPassphrase !== "string"
  ) throw new Error("The stored OpenVPN profile is invalid.");
  return value as OpenVpnProfile;
}

function openVpnProfileHash(profile: OpenVpnProfile): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("A server secret is required to identify the shared OpenVPN profile.");
  return createHmac("sha256", secret)
    .update("ochola-shared-openvpn-profile\0")
    .update(profile.profileText)
    .update("\0")
    .update(profile.username)
    .update("\0")
    .update(profile.password)
    .update("\0")
    .update(profile.keyPassphrase)
    .digest("hex");
}

function publicOpenVpnProfileInfo(profile: OpenVpnProfile | null) {
  const providerGenerated = Boolean(profile?.remoteHost && profile.remotePort && profile.caCertificate);
  return {
    configured: Boolean(profile),
    username: profile?.username ?? "",
    source: providerGenerated ? "provider" : profile ? "legacy" : "none",
    remoteHost: profile?.remoteHost ?? "",
    remotePort: profile?.remotePort ?? null,
    protocol: profile?.protocol ?? "",
    caCertificateConfigured: Boolean(profile?.caCertificate),
    clientCertificateConfigured: Boolean(profile?.clientCertificate && profile?.clientKey),
  };
}

async function openVpnRemoteAddresses(profileText: string): Promise<string[]> {
  const remotes = new Set<string>();
  for (const rawLine of profileText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (/^redirect-gateway\b/i.test(line)) {
      throw new Error("The shared OpenVPN profile must not contain redirect-gateway; multi-WAN manages routing.");
    }
    const match = line.match(/^remote\s+([^\s]+)(?:\s+([0-9]+))?(?:\s+(?:tcp|udp)(?:-client)?)?/i);
    if (!match) continue;
    const host = match[1].replace(/^\[|\]$/g, "");
    if (/^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(host)) {
      remotes.add(host);
      continue;
    }
    const resolved = await lookup(host, { all: true, family: 4 });
    for (const address of resolved) remotes.add(address.address);
  }
  if (!remotes.size) throw new Error("The shared OpenVPN profile must contain at least one resolvable IPv4 remote endpoint.");
  return [...remotes].sort();
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
      vlanId: wan.vlan_id ?? undefined,
      underlayWanPosition: wan.underlay_wan_position ?? undefined,
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
      `admin_id=eq.${adminId}&load_balancing_id=eq.${parent.id}&select=id,admin_id,load_balancing_id,name,interface_name,gateway,weight,health_check_ip,enabled,position,connection_type,static_address_cidr,vlan_id,underlay_wan_position,pppoe_username,pppoe_secret_ciphertext,pppoe_secret_iv,pppoe_secret_auth_tag,reassign_from_bridge,bridge_name&order=position.asc`,
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
    vlanId: wan.vlan_id ?? "",
    underlayWanPosition: wan.underlay_wan_position == null ? "" : wan.underlay_wan_position + 1,
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
      interfaceName: raw.connectionType === "ovpn"
        ? `isplatty-ovpn-wan${index + 1}`
        : String(raw.interfaceName ?? ""),
      connectionType: String(raw.connectionType ?? "static") as LoadBalancingWan["connectionType"],
      vlanId: raw.vlanId === "" || raw.vlanId == null ? undefined : Number(raw.vlanId),
      underlayWanPosition: raw.underlayWanPosition === "" || raw.underlayWanPosition == null
        ? undefined
        : Number(raw.underlayWanPosition) - 1,
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

async function livePreflight(
  config: LoadBalancingConfig,
  inventory: RouterLoadBalancingInventory,
  previous: Profile,
  profileHash?: string,
): Promise<{ errors: string[]; warnings: string[]; changes: string[] }> {
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
    if (wan.connectionType === "ovpn") {
      if (resolveRouterOsMajor(config.routerOsVersion, inventory.routerVersion) !== "7") {
        errors.push(`${wan.name}: managed OVPN profile import requires RouterOS 7; use a preconfigured tunnel on RouterOS 6.`);
      } else {
        warnings.push(`${wan.name}: MikroTik documents .ovpn import for RouterOS 7 but does not specify the first supporting 7.x release. Confirm the installed build supports /interface/ovpn-client/import-ovpn-configuration.`);
      }
      const externalClients = inventory.ovpnClients.filter(client =>
        !client.comment.startsWith("ISPlatty-LB OVPN WAN ")
        && !isProtectedManagementOvpn(client.name, client.comment),
      );
      if (externalClients.length) {
        errors.push(`${wan.name}: an unrelated OVPN client already exists. Select that interface as an existing WAN instead of creating another tunnel.`);
      }
      const targetName = `isplatty-ovpn-wan${wan.position + 1}`;
      const unrelatedName = inventory.interfaces.find(item =>
        item.name === targetName && !item.type.toLowerCase().includes("ovpn"),
      );
      if (unrelatedName) errors.push(`${wan.name}: RouterOS already uses the managed tunnel name ${targetName} for another interface.`);
      const existingManaged = inventory.ovpnClients.find(client =>
        client.name === targetName && client.comment.startsWith(`ISPlatty-LB OVPN WAN ${wan.position + 1} `),
      );
      if (existingManaged && profileHash
        && existingManaged.comment !== `ISPlatty-LB OVPN WAN ${wan.position + 1} profile-sha256=${profileHash}`) {
        errors.push(`${wan.name}: the saved tunnel uses a different profile. Disable and remove it before replacing the shared profile.`);
      }
      changes.push(`${wan.name}: create or reuse the dedicated OpenVPN WAN interface; keep the router-management VPN separate.`);
      continue;
    }

    const physicalMode = wan.connectionType === "static" || wan.connectionType === "pppoe" || wan.connectionType === "dhcp";
    const physical = iface && (
      iface.type.toLowerCase().includes("ether")
      || iface.type.toLowerCase().includes("sfp")
      || /^(ether|sfp|combo)/i.test(iface.name)
    );
    if (wan.connectionType === "existing") {
      if (!iface || iface.disabled) {
        errors.push(`${wan.name}: select an enabled existing router interface.`);
        continue;
      }
      if (iface.type.toLowerCase().includes("bridge")) {
        errors.push(`${wan.name}: select a tunnel, LTE, VLAN, or other routed interface, not a bridge.`);
        continue;
      }
      if (isProtectedManagementOvpn(iface.name, iface.comment)) {
        errors.push(`${wan.name}: the router-management VPN cannot be used as a customer WAN.`);
        continue;
      }
      if (inventory.bridgePorts.some(port => port.interface === wan.interfaceName)) {
        errors.push(`${wan.name}: an interface that is still a LAN bridge port cannot be used as an existing WAN.`);
        continue;
      }
      changes.push(`Use the preconfigured ${iface.type} interface ${wan.interfaceName}; its tunnel or LTE settings will not be changed.`);
      continue;
    }
    if (!physicalMode || !physical || iface?.disabled) {
      errors.push(`${wan.name}: select an enabled Ethernet or SFP/SFP+ interface for this connection type.`);
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
    if (wan.vlanId !== undefined) {
      const vlanName = `isplatty-vlan${wan.position + 1}`;
      const collision = inventory.vlans.find(item => item.name === vlanName && !item.comment.startsWith("ISPlatty-LB "));
      const duplicateTag = inventory.vlans.find(item =>
        item.interface === wan.interfaceName
        && item.vlanId === wan.vlanId
        && !(item.name === vlanName && item.comment.startsWith("ISPlatty-LB ")),
      );
      if (collision) errors.push(`${wan.name}: RouterOS already has an unrelated VLAN interface named ${vlanName}.`);
      if (duplicateTag) errors.push(`${wan.name}: VLAN ${wan.vlanId} already exists on ${wan.interfaceName} as ${duplicateTag.name}; select that interface as an existing WAN instead.`);
      changes.push(`Create VLAN ${wan.vlanId} on ${wan.interfaceName} before configuring the WAN service.`);
    }
    if (wan.connectionType === "static") {
      const address = (wan.staticAddressCidr ?? "").trim();
      const logicalInterface = wan.vlanId === undefined ? wan.interfaceName : `isplatty-vlan${wan.position + 1}`;
      const existing = inventory.addresses.filter(item => item.interface === logicalInterface && !item.dynamic);
      if (!address && existing.length === 0) errors.push(`${wan.name}: enter a static address or configure a static address on ${wan.interfaceName} first.`);
      if (address) {
        const duplicate = inventory.addresses.find(item => item.address === address && item.interface !== logicalInterface);
        if (duplicate) errors.push(`${wan.name}: ${address} is already assigned to ${duplicate.interface}.`);
        const existingSame = inventory.addresses.find(item => item.address === address && item.interface === logicalInterface);
        if (existingSame && !existingSame.comment.startsWith("ISPlatty-LB ")) {
          errors.push(`${wan.name}: ${address} already exists on ${logicalInterface}; leave Address / CIDR blank to reuse it.`);
        }
      }
    }
    if (wan.connectionType === "pppoe") {
      const expectedName = `isplatty-pppoe${wan.position + 1}`;
      const collision = inventory.pppoeClients.find(item => item.name === expectedName && !item.comment.startsWith("ISPlatty-LB "));
      if (collision) errors.push(`${wan.name}: RouterOS already has an unrelated PPPoE client named ${expectedName}.`);
      changes.push(`Configure a PPPoE client on ${wan.vlanId === undefined ? wan.interfaceName : `VLAN ${wan.vlanId}`}; its password remains encrypted in the ISP database.`);
    } else if (wan.connectionType === "dhcp") {
      const logicalInterface = wan.vlanId === undefined ? wan.interfaceName : `isplatty-vlan${wan.position + 1}`;
      const existing = inventory.dhcpClients.find(client =>
        client.interface === logicalInterface && !client.comment.startsWith("ISPlatty-LB DHCP "),
      );
      if (existing) errors.push(`${wan.name}: an unrelated DHCP client already runs on ${logicalInterface}; select its routed interface as an existing WAN instead.`);
      changes.push(`Create a DHCP client on ${wan.vlanId === undefined ? wan.interfaceName : `VLAN ${wan.vlanId}`} and use its lease gateway for health-checked routing.`);
    } else if (wan.connectionType === "static") {
      if (wan.staticAddressCidr) changes.push(`Set ${wan.staticAddressCidr} on ${wan.vlanId === undefined ? wan.interfaceName : `VLAN ${wan.vlanId}`} and route through ${wan.gateway}.`);
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
  let openVpnProfile: OpenVpnProfile | undefined;
  let openVpnProfileHashValue: string | undefined;
  let remoteAddresses: string[] = [];
  let openVpnProfileError = "";
  if (internal.enabled && internal.wans.some(wan => wan.enabled && wan.connectionType === "ovpn")) {
    try {
      const profile = await loadOpenVpnProfile(scope.adminId);
      if (!profile) {
        openVpnProfileError = "Generate and save the provider profile before enabling a managed OVPN WAN.";
      } else {
        openVpnProfile = profile;
        openVpnProfileHashValue = openVpnProfileHash(profile);
        remoteAddresses = await openVpnRemoteAddresses(profile.profileText);
        for (const wan of internal.wans) {
          if (wan.connectionType === "ovpn") wan.ovpnRemoteAddresses = remoteAddresses;
        }
      }
    } catch (error) {
      openVpnProfileError = error instanceof Error
        ? error.message
        : "The shared OpenVPN profile could not be read.";
    }
  }
  const validation = validateLoadBalancingConfig(internal, scope.routerId, scope.adminId);
  if (validation.errors.length || !validation.config) {
    return {
      internal,
      script: "",
      previewHash: "",
      errors: [...validation.errors, ...(openVpnProfileError ? [openVpnProfileError] : [])],
      warnings: [],
      changes: [],
      inventory: await fetchRouterLoadBalancingInventory(scope.creds),
      ...(openVpnProfile ? { openVpnProfile } : {}),
      ...(openVpnProfileHashValue ? { openVpnProfileHash: openVpnProfileHashValue } : {}),
      openVpnRemoteAddresses: remoteAddresses,
    };
  }
  const inventory = await fetchRouterLoadBalancingInventory(scope.creds);
  const effective = validation.config;
  if (openVpnProfileError) {
    return {
      internal: effective,
      script: "",
      previewHash: "",
      errors: [openVpnProfileError],
      warnings: [],
      changes: [],
      inventory,
    };
  }
  if (effective.allowBridgeFirewall && (effective.lanPortPins?.length ?? 0) > 0 && effective.bridgeFirewallOriginal === undefined) {
    effective.bridgeFirewallOriginal = inventory.bridgeUseIpFirewall;
  }
  const safety = await livePreflight(effective, inventory, previous, openVpnProfileHashValue);
  let script = "";
  try {
    const ovpnPosition = effective.wans.find(wan => wan.enabled && wan.connectionType === "ovpn")?.position;
    script = buildLoadBalancingScript(effective, inventory.routerVersion, {
      ...(ovpnPosition !== undefined && openVpnProfile
        ? {
            ovpnProfileFileName: `isplatty-ovpn-wan${ovpnPosition + 1}.ovpn`,
            ovpnProfileHash: openVpnProfileHashValue,
            ovpnUsername: openVpnProfile.username,
            ovpnPassword: openVpnProfile.password,
            ovpnKeyPassphrase: openVpnProfile.keyPassphrase,
          }
        : {}),
    }).script;
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
    ...(openVpnProfile ? { openVpnProfile } : {}),
    ...(openVpnProfileHashValue ? { openVpnProfileHash: openVpnProfileHashValue } : {}),
    openVpnRemoteAddresses: remoteAddresses,
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
      connectionType: String(row.connectionType ?? "static") as LoadBalancingWan["connectionType"],
      vlanId: row.vlanId == null || row.vlanId === "" ? undefined : Number(row.vlanId),
      underlayWanPosition: row.underlayWanPosition == null || row.underlayWanPosition === ""
        ? undefined
        : Number(row.underlayWanPosition),
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
      vlanId: wan.vlanId ?? null,
      underlayWanPosition: wan.underlayWanPosition ?? null,
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

async function uploadTemporaryRouterFile(
  scope: Scope,
  req: Request,
  content: string,
  destinationPath: string,
): Promise<{ token: string; path: string }> {
  const origin = requestOrigin(req);
  if (!origin.startsWith("https://")) {
    throw new Error("OpenVPN profile transfer requires a publicly trusted HTTPS API origin.");
  }
  await removeRouterFile(scope.creds, destinationPath).catch(() => undefined);
  const source = registerSource(content);
  const sourceUrl = `${origin}/api/router-load-balancing-source/${source.token}`;
  try {
    await deployRouterFile(scope.creds, {
      sourceUrl,
      destinationPath,
      overwrite: false,
      uploadId: source.token.slice(0, 16),
    });
    return { token: source.token, path: destinationPath };
  } catch (error) {
    scriptSources.delete(source.token);
    throw error;
  }
}

async function cleanupTemporaryRouterFile(
  scope: Scope,
  file: { token: string; path: string },
): Promise<void> {
  await removeRouterFile(scope.creds, file.path).catch(() => undefined);
  scriptSources.delete(file.token);
}

function routerOsQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("\r", "").replaceAll("\n", "")}"`;
}

async function ensureOpenVpnWan(
  scope: Scope,
  req: Request,
  config: LoadBalancingConfig,
  profile: OpenVpnProfile,
): Promise<string[]> {
  const wan = config.enabled ? config.wans.find(row => row.enabled && row.connectionType === "ovpn") : undefined;
  if (!wan) return [];
  const name = `isplatty-ovpn-wan${wan.position + 1}`;
  const hash = openVpnProfileHash(profile);
  const managedComment = `ISPlatty-LB OVPN WAN ${wan.position + 1} profile-sha256=${hash}`;
  const before = await fetchRouterLoadBalancingInventory(scope.creds);
  const existingManaged = before.ovpnClients.find(client =>
    client.name === name && client.comment.startsWith(`ISPlatty-LB OVPN WAN ${wan.position + 1} `),
  );
  if (existingManaged?.comment === managedComment) return [];
  if (existingManaged) {
    throw new Error("The managed OpenVPN profile differs from the active tunnel. Disable that WAN before replacing the shared profile.");
  }
  const unrelated = before.ovpnClients.filter(client =>
    !client.comment.startsWith("ISPlatty-LB OVPN WAN ")
    && !isProtectedManagementOvpn(client.name, client.comment),
  );
  if (unrelated.length) {
    throw new Error("An unrelated OVPN client exists on this router; it was not modified. Select it as an existing WAN instead.");
  }

  const profileFileName = `isplatty-ovpn-wan${wan.position + 1}.ovpn`;
  const uploaded = await uploadTemporaryRouterFile(scope, req, profile.profileText, profileFileName);
  const beforeIds = new Set(before.ovpnClients.map(client => client.id));
  const keyPassphrase = profile.keyPassphrase
    ? ` key-passphrase=${routerOsQuote(profile.keyPassphrase)}`
    : "";
  const importScript = [
    "# Import the shared ISP-managed OVPN profile.",
    `/interface/ovpn-client/import-ovpn-configuration file-name=${routerOsQuote(profileFileName)} skip-cert-import=no ovpn-user=${routerOsQuote(profile.username)} ovpn-password=${routerOsQuote(profile.password)}${keyPassphrase}`,
  ].join("\n");
  let createdIds: string[] = [];
  try {
    await transferAndRun(scope, req, importScript);
    const after = await fetchRouterLoadBalancingInventory(scope.creds);
    const created = after.ovpnClients.filter(client => client.id && !beforeIds.has(client.id));
    createdIds = created.map(client => client.id);
    if (created.length !== 1) {
      throw new Error("RouterOS did not create exactly one OpenVPN WAN client from the shared profile.");
    }
    await configureRouterOvpnWanClient(scope.creds, created[0].id, name, managedComment);
    const verified = await fetchRouterLoadBalancingInventory(scope.creds);
    if (!verified.ovpnClients.some(client => client.name === name && client.comment === managedComment)) {
      await removeRouterOvpnWanClient(scope.creds, created[0].id).catch(() => undefined);
      throw new Error("RouterOS did not confirm the managed OpenVPN WAN interface.");
    }
    return [created[0].id];
  } catch (error) {
    if (!createdIds.length) {
      const after = await fetchRouterLoadBalancingInventory(scope.creds).catch(() => null);
      createdIds = after?.ovpnClients
        .filter(client => client.id && !beforeIds.has(client.id))
        .map(client => client.id) ?? [];
    }
    await Promise.all(createdIds.map(id => removeRouterOvpnWanClient(scope.creds, id).catch(() => undefined)));
    throw error;
  } finally {
    await cleanupTemporaryRouterFile(scope, uploaded);
  }
}

function encryptedRecoveryOpenVpnProfile(profile?: OpenVpnProfile | null): Record<string, string> | undefined {
  if (!profile) return undefined;
  const encrypted = encryptVpnSecret(JSON.stringify(profile));
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.auth_tag,
  };
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
      || inventory.dhcpClients.some(client => client.comment.startsWith("ISPlatty-LB DHCP "))
      || inventory.vlans.some(vlan => vlan.comment.startsWith("ISPlatty-LB VLAN "))
      || inventory.ovpnClients.some(client => client.comment.startsWith("ISPlatty-LB OVPN WAN "))
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
    if (wan.connectionType === "dhcp") {
      if (!inventory.dhcpClients.some(client =>
        client.interface === (wan.vlanId === undefined ? wan.interfaceName : `isplatty-vlan${wan.position + 1}`)
        && client.comment === `ISPlatty-LB DHCP WAN ${wan.position + 1}`,
      )) errors.push(`${wan.name}: the managed DHCP client is missing after apply.`);
    }
    if (wan.vlanId !== undefined) {
      if (!inventory.vlans.some(vlan =>
        vlan.name === `isplatty-vlan${wan.position + 1}`
        && vlan.vlanId === wan.vlanId
        && vlan.comment.startsWith("ISPlatty-LB VLAN "),
      )) errors.push(`${wan.name}: the tagged VLAN interface is missing after apply.`);
    }
    if (wan.connectionType === "ovpn") {
      const name = `isplatty-ovpn-wan${wan.position + 1}`;
      if (!inventory.ovpnClients.some(client =>
        client.name === name && client.comment.startsWith(`ISPlatty-LB OVPN WAN ${wan.position + 1} `),
      )) errors.push(`${wan.name}: the managed OpenVPN WAN interface is missing after apply.`);
    }
    if (wan.connectionType === "static" && wan.staticAddressCidr) {
      const logicalInterface = wan.vlanId === undefined ? wan.interfaceName : `isplatty-vlan${wan.position + 1}`;
      if (!inventory.addresses.some(address =>
        address.interface === logicalInterface && address.address === wan.staticAddressCidr,
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

async function saveRecovery(
  scope: Scope,
  script: string,
  previousConfig: Record<string, unknown>,
  bridgeFirewallState: boolean,
  previousOpenVpnProfile?: OpenVpnProfile | null,
): Promise<void> {
  const encrypted = encryptVpnSecret(script);
  const recoveryProfile = encryptedRecoveryOpenVpnProfile(previousOpenVpnProfile);
  await sbUpsertStrict("isp_router_load_balancing_recovery", "admin_id,router_id", {
    admin_id: scope.adminId,
    router_id: scope.routerId,
    script_ciphertext: encrypted.ciphertext,
    script_iv: encrypted.iv,
    script_auth_tag: encrypted.auth_tag,
    previous_config: {
      ...previousConfig,
      recoveryBridgeFirewall: bridgeFirewallState,
      ...(recoveryProfile ? { recoveryOpenVpnProfile: recoveryProfile } : {}),
    },
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
  const previous = safeInternalFromPayload(scope, recovery.previous_config);
  if (previous.enabled && previous.wans.some(wan => wan.enabled && wan.connectionType === "ovpn")) {
    const encryptedProfile = recovery.previous_config.recoveryOpenVpnProfile;
    if (!encryptedProfile || typeof encryptedProfile !== "object") {
      throw new Error("The encrypted OpenVPN recovery profile is missing.");
    }
    const record = encryptedProfile as Record<string, unknown>;
    const decoded = decryptVpnSecret({
      ciphertext: String(record.ciphertext ?? ""),
      iv: String(record.iv ?? ""),
      auth_tag: String(record.auth_tag ?? ""),
    });
    const profile = JSON.parse(decoded) as OpenVpnProfile;
    await ensureOpenVpnWan(scope, req, previous, profile);
  }
  await transferAndRun(scope, req, script);
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
  const previousPayload = { ...recovery.previous_config };
  delete previousPayload.recoveryBridgeFirewall;
  delete previousPayload.recoveryOpenVpnProfile;
  await sbRpc<{ id: number }>("save_isp_router_load_balancing", {
    p_admin_id: scope.adminId,
    p_router_id: scope.routerId,
    p_payload: previousPayload,
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

router.get("/load-balancing/openvpn-profile", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const adminId = await requireRootAdmin(req, res);
    if (!adminId) return;
    const profile = await loadOpenVpnProfile(adminId);
    res.json({
      ok: true,
      ...publicOpenVpnProfileInfo(profile),
    });
  } catch (error) {
    logger.error("Shared OpenVPN profile could not be loaded");
    res.status(500).json({ ok: false, error: "The shared OpenVPN profile could not be loaded." });
  }
});

router.put("/load-balancing/openvpn-profile", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const adminId = await requireRootAdmin(req, res);
    if (!adminId) return;
    const current = await loadOpenVpnProfile(adminId);
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const suppliedText = typeof body.profileText === "string" ? body.profileText : "";
    const username = String(body.username ?? current?.username ?? "").trim().slice(0, 128);
    const suppliedPassword = String(body.password ?? "");
    const suppliedKeyPassphrase = String(body.keyPassphrase ?? "");
    const password = suppliedPassword.length ? suppliedPassword : current?.password || "";
    const keyPassphrase = suppliedKeyPassphrase.length ? suppliedKeyPassphrase : current?.keyPassphrase || "";
    if (!username || !password) {
      res.status(400).json({ ok: false, error: "OpenVPN username and password are required." });
      return;
    }
    if (password.length > 256 || keyPassphrase.length > 256) {
      res.status(400).json({ ok: false, error: "OpenVPN passwords must be 256 characters or fewer." });
      return;
    }
    let next: OpenVpnProfile;
    if (suppliedText.trim()) {
      // Preserve compatibility with previously deployed clients that submit
      // provider-supplied profiles directly.
      const profileText = suppliedText.trim();
      if (Buffer.byteLength(profileText, "utf8") > 300_000) {
        res.status(413).json({ ok: false, error: "The .ovpn profile is too large (maximum 300 KB)." });
        return;
      }
      next = { profileText, username, password, keyPassphrase };
    } else {
      const suppliedClientCertificate = String(body.clientCertificate ?? "").trim();
      const suppliedClientKey = String(body.clientKey ?? "").trim();
      if (Boolean(suppliedClientCertificate) !== Boolean(suppliedClientKey)) {
        res.status(400).json({ ok: false, error: "A new client certificate and private key must be provided together." });
        return;
      }
      const clearClientCertificate = body.clearClientCertificate === true
        && !suppliedClientCertificate
        && !suppliedClientKey;
      const caCertificate = String(body.caCertificate ?? "").trim() || current?.caCertificate || "";
      const clientCertificate = suppliedClientCertificate
        || (clearClientCertificate ? "" : current?.clientCertificate || "");
      const clientKey = suppliedClientKey
        || (clearClientCertificate ? "" : current?.clientKey || "");
      const profileKeyPassphrase = clientKey
        ? suppliedClientKey
          ? suppliedKeyPassphrase
          : keyPassphrase
        : "";
      try {
        const generated = buildOpenVpnProviderProfile({
          server: body.remoteHost ?? current?.remoteHost,
          port: body.remotePort ?? current?.remotePort,
          protocol: body.protocol ?? current?.protocol,
          caCertificate,
          clientCertificate,
          clientKey,
          keyPassphrase: profileKeyPassphrase,
        });
        next = {
          profileText: generated.profileText,
          username,
          password,
          keyPassphrase: profileKeyPassphrase,
          remoteHost: generated.server,
          remotePort: generated.port,
          protocol: generated.protocol,
          caCertificate: generated.caCertificate,
          clientCertificate: generated.clientCertificate,
          clientKey: generated.clientKey,
        };
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: error instanceof Error ? error.message : "Provider settings could not be converted to an OpenVPN profile.",
        });
        return;
      }
    }
    try {
      await openVpnRemoteAddresses(next.profileText);
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "The OpenVPN profile has no usable remote endpoint.",
      });
      return;
    }
    const enabledConfigs = await sbSelectStrict<{ id: number }>(
      "isp_router_load_balancing",
      `admin_id=eq.${adminId}&enabled=is.true&select=id`,
    );
    const activeWans = enabledConfigs.length
      ? await sbSelectStrict<{ id: number }>(
          "isp_router_load_balancing_wans",
          `admin_id=eq.${adminId}&load_balancing_id=in.(${enabledConfigs.map(row => row.id).join(",")})&connection_type=eq.ovpn&enabled=is.true&select=id&limit=1`,
        )
      : [];
    if (activeWans.length && (!current || openVpnProfileHash(current) !== openVpnProfileHash(next))) {
      res.status(409).json({
        ok: false,
        error: "Disable managed OpenVPN WANs on all routers before changing the shared profile.",
      });
      return;
    }
    const encrypted = encryptVpnSecret(JSON.stringify(next));
    await sbUpsertStrict("isp_admin_openvpn_wan_profiles", "admin_id", {
      admin_id: adminId,
      profile_ciphertext: encrypted.ciphertext,
      profile_iv: encrypted.iv,
      profile_auth_tag: encrypted.auth_tag,
      updated_at: new Date().toISOString(),
    });
    res.json({ ok: true, ...publicOpenVpnProfileInfo(next) });
  } catch (error) {
    logger.error("Shared OpenVPN profile could not be saved");
    res.status(500).json({ ok: false, error: "The shared OpenVPN profile could not be saved." });
  }
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
        interfaces: inventory.interfaces.map(({ name, type, running, disabled, comment }) => ({ name, type, running, disabled, comment })),
        bridges: inventory.bridges,
        bridgePorts: inventory.bridgePorts.map(({ bridge, interface: interfaceName }) => ({ bridge, interface: interfaceName })),
        addresses: inventory.addresses.map(({ interface: interfaceName, address }) => ({ interface: interfaceName, address })),
        hasActiveCustomerOvpn: hasActiveCustomerOvpnClient(inventory.ovpnClients),
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
    if (internal.enabled && internal.wans.some(wan => wan.enabled && wan.connectionType === "ovpn")) {
      const profile = await loadOpenVpnProfile(scope.adminId);
      if (!profile) {
        res.status(400).json({ ok: false, errors: ["Generate and save the provider profile before enabling a managed OVPN WAN."] });
        return;
      }
      const remotes = await openVpnRemoteAddresses(profile.profileText);
      for (const wan of internal.wans) {
        if (wan.connectionType === "ovpn") wan.ovpnRemoteAddresses = remotes;
      }
    }
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
    const previousNeedsOvpn = oldInternal.enabled && oldInternal.wans.some(wan => wan.enabled && wan.connectionType === "ovpn");
    const previousOpenVpnProfile = previousNeedsOvpn ? await loadOpenVpnProfile(scope.adminId) : null;
    if (previousNeedsOvpn && !previousOpenVpnProfile) {
      res.status(409).json({ ok: false, error: "The existing OpenVPN WAN has no recoverable shared profile. Restore the profile before applying changes." });
      return;
    }
    await saveRecovery(
      scope,
      recoveryScript,
      previous.rpcPayload,
      prepared.inventory.bridgeUseIpFirewall,
      previousOpenVpnProfile,
    );
    const recovery = await getRecovery(scope);
    if (!recovery) throw new Error("The encrypted recovery point could not be saved.");

    try {
      if (prepared.openVpnProfile) {
        await ensureOpenVpnWan(scope, req, prepared.internal, prepared.openVpnProfile);
      }
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
        await restoreFromRecovery(scope, req, recovery);
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