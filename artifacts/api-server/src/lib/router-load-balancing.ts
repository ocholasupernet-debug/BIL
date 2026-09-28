export type LoadBalancingRouterOs = "auto" | "6" | "7";
export type LoadBalancingMode = "weighted" | "failover";
export type WanConnectionType = "static" | "pppoe";

export interface LoadBalancingWan {
  id?: number;
  name: string;
  interfaceName: string;
  connectionType?: WanConnectionType;
  staticAddressCidr?: string;
  gateway: string;
  weight: number;
  healthCheckIp: string;
  enabled: boolean;
  position: number;
  pppoeUsername?: string;
  pppoePassword?: string;
  pppoeServiceName?: string;
  pppoeSecretConfigured?: boolean;
  reassignFromBridge?: boolean;
  bridgeName?: string;
}

export interface LanWanPin {
  lanInterface: string;
  wanPosition: number;
}

export interface LanBandwidthLimit {
  lanInterface: string;
  maxMbps: number;
}

export interface LoadBalancingConfig {
  routerId: number;
  adminId: number;
  enabled: boolean;
  lanInterface: string;
  routerOsVersion: LoadBalancingRouterOs;
  mode?: LoadBalancingMode;
  allowBridgeFirewall?: boolean;
  wans: LoadBalancingWan[];
  lanPortPins?: LanWanPin[];
  /** Alias accepted by API callers that call these assignments rather than pins. */
  lanPortAssignments?: LanWanPin[];
  lanBandwidthLimits?: LanBandwidthLimit[];
  /** Alias for integrations that model each LAN link as a capacity record. */
  lanLinks?: Array<LanBandwidthLimit & Partial<LanWanPin>>;
  promoteLanInterfaces?: string[];
  /** Explicit opt-in for promoting physical LAN ports into the selected bridge. */
  bridgePromotion?: { interfaces: string[] };
  /** Original RouterOS bridge-firewall value, retained while the feature owns the setting. */
  bridgeFirewallOriginal?: boolean;
  /** Previously promoted interfaces that should be restored to their bridge. */
  restoreBridgePorts?: Array<{ bridgeName: string; interfaceName: string }>;
}

export interface LoadBalancingValidation {
  config?: LoadBalancingConfig;
  errors: string[];
}

export const DEFAULT_LOAD_BALANCING_CONFIG = {
  enabled: false,
  lanInterface: "bridge",
  routerOsVersion: "auto" as const,
  mode: "weighted" as const,
};

const IPV4_PART = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${IPV4_PART}(?:\\.${IPV4_PART}){3}$`);
const INTERFACE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ROUTEROS_RE = /(?:^|[^0-9])([67])(?:[^0-9]|$)/;
const secretKeys = /^(?:pppoePassword|password|secret)$/i;

const text = (value: unknown, max = 64) => String(value ?? "").trim().slice(0, max);
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const quote = (value: unknown): string =>
  `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "").replaceAll("\n", "")}"`;
const validInt = (value: unknown) => Number.isInteger(Number(value)) ? Number(value) : NaN;

export function resolveRouterOsMajor(configured: LoadBalancingRouterOs, routerVersion?: string | null): "6" | "7" {
  if (configured === "6" || configured === "7") return configured;
  return String(routerVersion ?? "").match(ROUTEROS_RE)?.[1] === "6" ? "6" : "7";
}

export function validateLoadBalancingConfig(
  input: unknown,
  expectedRouterId?: number,
  expectedAdminId?: number,
): LoadBalancingValidation {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const errors: string[] = [];
  const routerId = validInt(source.routerId);
  const adminId = validInt(source.adminId);
  if (!Number.isSafeInteger(routerId) || routerId < 1) errors.push("routerId must be a positive integer.");
  if (!Number.isSafeInteger(adminId) || adminId < 1) errors.push("adminId must be a positive integer.");
  if (expectedRouterId !== undefined && routerId !== expectedRouterId) errors.push("routerId does not match the authenticated router.");
  if (expectedAdminId !== undefined && adminId !== expectedAdminId) errors.push("adminId does not match the authenticated ISP.");

  const rawWans = Array.isArray(source.wans) ? source.wans : [];
  if (rawWans.length > 4) errors.push("A maximum of four WAN links is supported.");
  const lanInterface = text(source.lanInterface || DEFAULT_LOAD_BALANCING_CONFIG.lanInterface);
  if (!INTERFACE_RE.test(lanInterface)) errors.push("LAN interface is invalid.");
  const mode: LoadBalancingMode = source.mode === "failover" || source.mode === "failover-only" ? "failover" : "weighted";
  const routerOsVersion: LoadBalancingRouterOs = source.routerOsVersion === "6" || source.routerOsVersion === "7" ? source.routerOsVersion : "auto";
  const interfaces = new Set<string>();
  const healthTargets = new Set<string>();
  const wans: LoadBalancingWan[] = rawWans.slice(0, 4).map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const connectionType: WanConnectionType = item.connectionType === "pppoe" ? "pppoe" : "static";
    return {
      id: typeof item.id === "number" ? item.id : undefined,
      name: text(item.name || `WAN ${index + 1}`, 40),
      interfaceName: text(item.interfaceName),
      connectionType,
      staticAddressCidr: text(item.staticAddressCidr, 32),
      gateway: text(item.gateway, 15),
      weight: validInt(item.weight) || 1,
      healthCheckIp: text(item.healthCheckIp, 15),
      enabled: bool(item.enabled, true),
      position: index,
      pppoeUsername: text(item.pppoeUsername, 128),
      pppoePassword: text(item.pppoePassword, 256),
      pppoeServiceName: text(item.pppoeServiceName, 128),
      pppoeSecretConfigured: bool(item.pppoeSecretConfigured, false),
      reassignFromBridge: bool(item.reassignFromBridge, false),
      bridgeName: text(item.bridgeName, 64),
    };
  });
  for (const [index, wan] of wans.entries()) {
    const label = wan.name || `WAN ${index + 1}`;
    /* Disabled rows are drafts: preserve them for the editor, but do not
       reject an intentionally incomplete future uplink. */
    if (!wan.enabled && !wan.interfaceName && !wan.gateway && !wan.healthCheckIp) continue;
    if (!wan.interfaceName || !INTERFACE_RE.test(wan.interfaceName)) errors.push(`${label}: enter a valid physical interface.`);
    if (wan.interfaceName === lanInterface) errors.push(`${label}: WAN interface must differ from the LAN interface.`);
    if (interfaces.has(wan.interfaceName)) errors.push(`${label}: interface is duplicated.`);
    interfaces.add(wan.interfaceName);
    if (wan.connectionType === "static" && wan.staticAddressCidr && !new RegExp(`^${IPV4_PART}\\/(?:[0-9]|[12][0-9]|3[0-2])$`).test(wan.staticAddressCidr)) errors.push(`${label}: static address must be IPv4 CIDR.`);
    if (wan.connectionType === "static" && !IPV4_RE.test(wan.gateway) && wan.enabled) errors.push(`${label}: gateway must be a valid IPv4 address.`);
    if (!IPV4_RE.test(wan.healthCheckIp) && wan.enabled) errors.push(`${label}: health-check target must be a valid IPv4 address.`);
    if (wan.healthCheckIp && healthTargets.has(wan.healthCheckIp)) errors.push(`${label}: health-check targets must be unique.`);
    if (wan.healthCheckIp) healthTargets.add(wan.healthCheckIp);
    if (!Number.isInteger(wan.weight) || wan.weight < 1 || wan.weight > 100) errors.push(`${label}: weight must be an integer from 1 to 100.`);
    if (wan.enabled && wan.connectionType === "pppoe" && (!wan.pppoeUsername || (!wan.pppoePassword && !wan.pppoeSecretConfigured))) errors.push(`${label}: PPPoE username and password are required (or configure a stored secret).`);
  }
  const active = wans.filter(wan => wan.enabled);
  if (source.enabled === true && active.length < 2) errors.push("Enable at least two WAN links before turning on load balancing.");
  if (mode === "failover" && active.length < 2 && source.enabled === true) errors.push("Failover mode requires at least two enabled WAN links.");

  const linkRows = Array.isArray(source.lanLinks) ? source.lanLinks : [];
  const pins = [
    ...(Array.isArray(source.lanPortPins) ? source.lanPortPins :
      (Array.isArray(source.lanPortAssignments) ? source.lanPortAssignments : [])),
    ...linkRows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && row.wanPosition !== undefined),
  ];
  const normalizedPins: LanWanPin[] = [];
  const pinInterfaces = new Set<string>();
  for (const raw of pins) {
    const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const pin = { lanInterface: text(p.lanInterface || p.interfaceName), wanPosition: validInt(p.wanPosition ?? p.wanIndex) };
    if (!INTERFACE_RE.test(pin.lanInterface) || !Number.isInteger(pin.wanPosition) || pin.wanPosition < 0 || pin.wanPosition > 3) errors.push("LAN port pins must contain a valid interface and WAN position.");
    else if (pinInterfaces.has(pin.lanInterface)) errors.push(`LAN interface ${pin.lanInterface} is pinned more than once.`);
    else {
      if (source.enabled === true && !wans.some(wan => wan.enabled && wan.position === pin.wanPosition)) errors.push(`LAN interface ${pin.lanInterface} must be pinned to an enabled WAN.`);
      pinInterfaces.add(pin.lanInterface);
      normalizedPins.push(pin);
    }
  }
  const limits = Array.isArray(source.lanBandwidthLimits) ? source.lanBandwidthLimits :
    (Array.isArray(source.lanLinks) ? source.lanLinks : []);
  const normalizedLimits: LanBandwidthLimit[] = [];
  const limitInterfaces = new Set<string>();
  for (const raw of limits) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const limit = { lanInterface: text(item.lanInterface || item.interfaceName), maxMbps: Number(item.maxMbps ?? item.mbps) };
    if (!INTERFACE_RE.test(limit.lanInterface) || !Number.isFinite(limit.maxMbps) || limit.maxMbps <= 0 || limit.maxMbps > 1000000) errors.push("LAN bandwidth limits must contain a valid interface and Mbps value.");
    else if (limitInterfaces.has(limit.lanInterface)) errors.push(`LAN interface ${limit.lanInterface} has more than one bandwidth limit.`);
    else {
      limitInterfaces.add(limit.lanInterface);
      normalizedLimits.push(limit);
    }
  }
  const bridgePromotion = source.bridgePromotion && typeof source.bridgePromotion === "object"
    ? source.bridgePromotion as Record<string, unknown> : {};
  const promotionsRaw = Array.isArray(source.promoteLanInterfaces) ? source.promoteLanInterfaces :
    (Array.isArray(bridgePromotion.interfaces) ? bridgePromotion.interfaces : []);
  const promoteLanInterfaces = promotionsRaw.map(value => text(value)).filter(Boolean);
  if (promoteLanInterfaces.some(value => !INTERFACE_RE.test(value))) errors.push("Promoted LAN interfaces contain an invalid interface name.");
  const bridgeFirewallOriginal = typeof source.bridgeFirewallOriginal === "boolean" ? source.bridgeFirewallOriginal : undefined;
  const restoreBridgePorts = (Array.isArray(source.restoreBridgePorts) ? source.restoreBridgePorts : [])
    .map(raw => raw && typeof raw === "object" ? raw as Record<string, unknown> : {})
    .map(item => ({ bridgeName: text(item.bridgeName), interfaceName: text(item.interfaceName) }));
  if (restoreBridgePorts.some(port => !INTERFACE_RE.test(port.bridgeName) || !INTERFACE_RE.test(port.interfaceName))) errors.push("Bridge restorations contain an invalid bridge or interface name.");
  if (errors.length) return { errors };
  return { errors: [], config: { routerId, adminId, enabled: bool(source.enabled, false), lanInterface, routerOsVersion, mode, allowBridgeFirewall: bool(source.allowBridgeFirewall, false), wans, lanPortPins: normalizedPins, lanPortAssignments: normalizedPins, lanBandwidthLimits: normalizedLimits, lanLinks: normalizedLimits, promoteLanInterfaces, bridgePromotion: { interfaces: promoteLanInterfaces }, ...(bridgeFirewallOriginal !== undefined ? { bridgeFirewallOriginal } : {}), restoreBridgePorts } };
}

const marker = (description: string) => `ISPlatty-LB ${description}`;
const table = (index: number) => `isplatty_lb_wan${index + 1}`;
const connMark = (index: number) => `ISPLATTY_LB_WAN${index + 1}_CONN`;
const routeOption = (version: "6" | "7", name: string) => version === "7" ? `routing-table=${quote(name)}` : `routing-mark=${quote(name)}`;

export interface LoadBalancingScriptResult {
  script: string;
  effectiveVersion: "6" | "7";
  activeWanCount: number;
  totalWeight: number;
}

export function buildLoadBalancingScript(config: LoadBalancingConfig, routerVersion?: string | null): LoadBalancingScriptResult {
  const validation = validateLoadBalancingConfig(config, config.routerId, config.adminId);
  if (validation.errors.length || !validation.config) throw new Error(validation.errors.join(" ") || "Invalid load-balancing configuration.");
  const normalized = validation.config;
  const version = resolveRouterOsMajor(normalized.routerOsVersion, routerVersion);
  const active = normalized.wans.filter(wan => wan.enabled);
  const totalWeight = active.reduce((sum, wan) => sum + wan.weight, 0);
  const lines = [
    "# OcholaSupernet multi-WAN configuration",
    `# RouterOS syntax: ${version}`,
    `# LAN interface: ${quote(normalized.lanInterface)}`,
    "# PCC balances connections, not individual packets.",
    "# Credentials are present only in the apply script; redactLoadBalancingScript removes them from previews.",
    "/ip firewall mangle remove [find where comment~\"^ISPlatty-LB \"]",
    "/ip firewall nat remove [find where comment~\"^ISPlatty-LB \"]",
    "/ip firewall address-list remove [find where comment~\"^ISPlatty-LB \"]",
    "/ip route remove [find where comment~\"^ISPlatty-LB \"]",
    "/ip address remove [find where comment~\"^ISPlatty-LB \"]",
    "/queue simple remove [find where comment~\"^ISPlatty-LB \"]",
    "/interface pppoe-client remove [find where comment~\"^ISPlatty-LB PPPoE \"]",
    ...(version === "7" ? ["/routing table remove [find where comment~\"^ISPlatty-LB \"]"] : []),
  ];
  const restoreBridgePorts = normalized.restoreBridgePorts ?? [];
  const selectedBridgePorts = normalized.enabled ? active
    .filter(wan => wan.reassignFromBridge && wan.bridgeName)
    .map(wan => ({ bridgeName: wan.bridgeName!, interfaceName: wan.interfaceName })) : [];
  const bridgePortChanges = [
    ...restoreBridgePorts.map(port => `:if ([:len [/interface bridge port find where bridge=${quote(port.bridgeName)} and interface=${quote(port.interfaceName)}]] = 0) do={ /interface bridge port add bridge=${quote(port.bridgeName)} interface=${quote(port.interfaceName)} }`),
    ...selectedBridgePorts.map(port => `/interface bridge port remove [find where bridge=${quote(port.bridgeName)} and interface=${quote(port.interfaceName)}]`),
  ];
  const bridgeFirewallChange = normalized.enabled && normalized.allowBridgeFirewall && (normalized.lanPortPins?.length ?? 0) > 0
    ? ["/interface bridge settings set use-ip-firewall=yes"]
    : (!normalized.enabled || !normalized.allowBridgeFirewall || (normalized.lanPortPins?.length ?? 0) === 0)
      && normalized.bridgeFirewallOriginal !== undefined
      ? [`/interface bridge settings set use-ip-firewall=${normalized.bridgeFirewallOriginal ? "yes" : "no"}`]
      : [];
  if (!normalized.enabled) {
    lines.push(...bridgeFirewallChange, ...bridgePortChanges);
    return { script: `${lines.join("\n")}\n`, effectiveVersion: version, activeWanCount: 0, totalWeight: 0 };
  }
  for (const wan of active.filter(item => item.connectionType === "pppoe")) {
    lines.push(`/interface pppoe-client remove [find where comment=${quote(marker(`PPPoE ${wan.position + 1}`))}]`);
    const password = wan.pppoePassword ? ` password=${quote(wan.pppoePassword)}` : "";
    lines.push(`/interface pppoe-client add name=${quote(`isplatty-pppoe${wan.position + 1}`)} interface=${quote(wan.interfaceName)} user=${quote(wan.pppoeUsername)}${password}${wan.pppoeServiceName ? ` service-name=${quote(wan.pppoeServiceName)}` : ""} disabled=no comment=${quote(marker(`PPPoE ${wan.position + 1}`))}`);
  }
  for (const wan of active.filter(item => item.connectionType === "static" && item.staticAddressCidr)) {
    lines.push(`/ip address add address=${quote(wan.staticAddressCidr)} interface=${quote(wan.interfaceName)} comment=${quote(marker(`address WAN ${wan.position + 1}`))}`);
  }
  if (active.length < 2) {
    lines.push(...bridgeFirewallChange, ...bridgePortChanges);
    return { script: `${lines.join("\n")}\n`, effectiveVersion: version, activeWanCount: active.length, totalWeight };
  }
  lines.push(...["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8"].map(ip => `/ip firewall address-list add list="ISPLATTY-LB-LOCAL" address=${quote(ip)} comment=${quote(marker("local exclusion"))}`));
  if (version === "7") lines.push(...active.map((_, i) => `/routing table add name=${quote(table(i))} fib=yes comment=${quote(marker(`table WAN ${i + 1}`))}`));
  const wanOut = (wan: LoadBalancingWan) => wan.connectionType === "pppoe" ? `isplatty-pppoe${wan.position + 1}` : wan.interfaceName;
  lines.push("/ip firewall mangle");
  active.forEach((wan, i) => lines.push(`add chain=prerouting in-interface=${quote(wanOut(wan))} connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=${quote(connMark(i))} passthrough=yes comment=${quote(marker(`inbound WAN ${i + 1}`))}`));
  lines.push(`add chain=prerouting dst-address-list=${quote("ISPLATTY-LB-LOCAL")} action=accept comment=${quote(marker("exclude local transit"))}`, `add chain=output dst-address-list=${quote("ISPLATTY-LB-LOCAL")} action=accept comment=${quote(marker("exclude local output"))}`);
  for (const pin of normalized.lanPortPins ?? []) {
    const wan = active.find(item => item.position === pin.wanPosition);
    if (wan) lines.push(`add chain=prerouting in-interface=${quote(pin.lanInterface)} connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=${quote(connMark(active.indexOf(wan)))} passthrough=yes comment=${quote(marker(`pin ${pin.lanInterface}`))}`);
  }
  if (normalized.mode !== "failover") {
    let bucket = 0;
    active.forEach((wan, i) => { for (let n = 0; n < wan.weight; n++) lines.push(`add chain=prerouting in-interface=${quote(normalized.lanInterface)} connection-state=new connection-mark=no-mark dst-address-type=!local per-connection-classifier=both-addresses-and-ports:${totalWeight}/${bucket++} action=mark-connection new-connection-mark=${quote(connMark(i))} passthrough=yes comment=${quote(marker(`PCC WAN ${i + 1}`))}`); });
  } else lines.push(`add chain=prerouting in-interface=${quote(normalized.lanInterface)} connection-state=new connection-mark=no-mark dst-address-type=!local action=mark-connection new-connection-mark=${quote(connMark(0))} passthrough=yes comment=${quote(marker("failover primary"))}`);
  active.forEach((_, i) => lines.push(`add chain=prerouting in-interface=${quote(normalized.lanInterface)} connection-mark=${quote(connMark(i))} action=mark-routing new-routing-mark=${quote(table(i))} passthrough=no comment=${quote(marker(`route LAN WAN ${i + 1}`))}`, `add chain=output connection-mark=${quote(connMark(i))} dst-address-type=!local action=mark-routing new-routing-mark=${quote(table(i))} passthrough=no comment=${quote(marker(`route output WAN ${i + 1}`))}`));
  for (const pin of normalized.lanPortPins ?? []) {
    const wan = active.find(item => item.position === pin.wanPosition);
    if (wan) lines.push(`add chain=prerouting in-interface=${quote(pin.lanInterface)} connection-mark=${quote(connMark(active.indexOf(wan)))} action=mark-routing new-routing-mark=${quote(table(active.indexOf(wan)))} passthrough=no comment=${quote(marker(`route pinned LAN ${pin.lanInterface}`))}`);
  }
  for (const [i, wan] of active.entries()) {
    const out = wanOut(wan);
    const healthGateway = wan.connectionType === "pppoe" ? out : `${wan.gateway}%${out}`;
    lines.push(`/ip route add dst-address=${quote(`${wan.healthCheckIp}/32`)} gateway=${quote(healthGateway)} scope=10 check-gateway=ping comment=${quote(marker(`health WAN ${i + 1}`))}`);
    active.forEach((candidate, j) => lines.push(`/ip route add dst-address="0.0.0.0/0" gateway=${quote(candidate.healthCheckIp)} target-scope=11 check-gateway=ping distance=${i === j ? 1 : 20 + j} ${routeOption(version, table(i))} comment=${quote(marker(`policy WAN ${i + 1} via ${j + 1}`))}`));
    lines.push(`/ip route add dst-address="0.0.0.0/0" gateway=${quote(wan.healthCheckIp)} target-scope=11 check-gateway=ping distance=${10 + i} comment=${quote(marker(`main WAN ${i + 1}`))}`, `/ip firewall nat add chain=srcnat out-interface=${quote(out)} action=masquerade comment=${quote(marker(`NAT WAN ${i + 1}`))}`);
  }
  for (const limit of normalized.lanBandwidthLimits ?? []) {
    const name = `isplatty-lb-${slug(limit.lanInterface)}-${limit.maxMbps}`;
    lines.push(`/queue simple add name=${quote(name)} target=${quote(limit.lanInterface)} max-limit=${quote(`${limit.maxMbps}M/${limit.maxMbps}M`)} comment=${quote(marker(`queue ${limit.lanInterface}`))}`);
  }
  lines.push(...bridgeFirewallChange, ...bridgePortChanges);
  return { script: `${lines.join("\n")}\n`, effectiveVersion: version, activeWanCount: active.length, totalWeight };
}

function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lan"; }

/** Remove PPPoE secrets from a script before displaying, logging, or downloading it. */
export function redactLoadBalancingScript(script: string): string {
  return script.replace(/(\b(?:password|secret)=)"(?:\\.|[^"])*"/gi, '$1"REDACTED"');
}

export const redactLoadBalancingConfig = (config: unknown): unknown => {
  if (Array.isArray(config)) return config.map(redactLoadBalancingConfig);
  if (!config || typeof config !== "object") return config;
  return Object.fromEntries(Object.entries(config as Record<string, unknown>).map(([key, value]) => [key, secretKeys.test(key) ? "REDACTED" : redactLoadBalancingConfig(value)]));
};