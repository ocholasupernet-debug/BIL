export type LoadBalancingRouterOs = "auto" | "6" | "7";

export interface LoadBalancingWan {
  id?: number;
  name: string;
  interfaceName: string;
  gateway: string;
  weight: number;
  healthCheckIp: string;
  enabled: boolean;
  position: number;
}

export interface LoadBalancingConfig {
  routerId: number;
  adminId: number;
  enabled: boolean;
  lanInterface: string;
  routerOsVersion: LoadBalancingRouterOs;
  wans: LoadBalancingWan[];
}

export interface LoadBalancingValidation {
  config?: LoadBalancingConfig;
  errors: string[];
}

const IPV4_PART = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${IPV4_PART}(?:\\.${IPV4_PART}){3}$`);
const INTERFACE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ROUTEROS_RE = /(?:^|[^0-9])([67])(?:[^0-9]|$)/;

export const DEFAULT_LOAD_BALANCING_CONFIG = {
  enabled: false,
  lanInterface: "bridge",
  routerOsVersion: "auto" as const,
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function ipv4(value: unknown): string {
  return cleanText(value, 15);
}

function safeRouterOs(value: unknown): LoadBalancingRouterOs {
  return value === "6" || value === "7" || value === "auto" ? value : "auto";
}

export function resolveRouterOsMajor(
  configured: LoadBalancingRouterOs,
  routerVersion?: string | null,
): "6" | "7" {
  if (configured === "6" || configured === "7") return configured;
  const match = String(routerVersion ?? "").match(ROUTEROS_RE);
  return match?.[1] === "6" ? "6" : "7";
}

export function validateLoadBalancingConfig(
  input: unknown,
  routerId: number,
  adminId: number,
): LoadBalancingValidation {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawWans = Array.isArray(source.wans) ? source.wans : [];
  const errors: string[] = [];
  const wans: LoadBalancingWan[] = rawWans.slice(0, 4).map((raw, index) => {
    const wan = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const weight = Number( wan.weight);
    return {
      id: typeof wan.id === "number" ? wan.id : undefined,
      name: cleanText(wan.name || `WAN ${index + 1}`, 40),
      interfaceName: cleanText(wan.interfaceName, 64),
      gateway: ipv4(wan.gateway),
      weight: Number.isInteger(weight) ? weight : 1,
      healthCheckIp: ipv4(wan.healthCheckIp),
      enabled: bool(wan.enabled, true),
      position: index,
    };
  });

  if (rawWans.length > 4) errors.push("A maximum of four WAN links is supported.");
  const lanInterface = cleanText(source.lanInterface || DEFAULT_LOAD_BALANCING_CONFIG.lanInterface, 64);
  if (!INTERFACE_RE.test(lanInterface)) {
    errors.push("LAN interface may contain only letters, numbers, dots, underscores, and hyphens.");
  }

  const routerOsVersion = safeRouterOs(source.routerOsVersion);
  const interfaces = new Set<string>();
  const healthTargets = new Set<string>();
  for (const [index, wan] of wans.entries()) {
    const label = wan.name || `WAN ${index + 1}`;
    if (!wan.interfaceName || !INTERFACE_RE.test(wan.interfaceName)) {
      errors.push(`${label}: enter a valid interface name.`);
    }
    if (wan.interfaceName === lanInterface) {
      errors.push(`${label}: WAN interface must be different from the LAN interface.`);
    }
    if (interfaces.has(wan.interfaceName)) errors.push(`${label}: interface is duplicated.`);
    interfaces.add(wan.interfaceName);
    if (!IPV4_RE.test(wan.gateway)) errors.push(`${label}: gateway must be a valid IPv4 address.`);
    if (!IPV4_RE.test(wan.healthCheckIp)) errors.push(`${label}: health-check target must be a valid IPv4 address.`);
    if (wan.healthCheckIp && healthTargets.has(wan.healthCheckIp)) {
      errors.push(`${label}: health-check targets must be unique.`);
    }
    healthTargets.add(wan.healthCheckIp);
    if (!Number.isInteger(wan.weight) || wan.weight < 1 || wan.weight > 100) {
      errors.push(`${label}: weight must be an integer from 1 to 100.`);
    }
  }

  const activeWans = wans.filter(wan => wan.enabled);
  if (source.enabled === true && activeWans.length < 2) {
    errors.push("Enable at least two WAN links before turning on load balancing.");
  }

  if (errors.length) return { errors };
  return {
    errors: [],
    config: {
      routerId,
      adminId,
      enabled: bool(source.enabled, false),
      lanInterface,
      routerOsVersion,
      wans,
    },
  };
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function slug(value: string, fallback: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return result || fallback;
}

function routeOption(version: "6" | "7", table: string): string {
  return version === "7" ? `routing-table=${quote(table)}` : `routing-mark=${quote(table)}`;
}

function routeTableName(index: number): string {
  return `isp_lb_wan${index + 1}`;
}

function connectionMark(index: number): string {
  return `ISP_LB_WAN${index + 1}_CONN`;
}

function comment(section: string): string {
  return `ISPlatty-LB ${section}`;
}

export function buildLoadBalancingScript(
  config: LoadBalancingConfig,
  routerVersion?: string | null,
): { script: string; effectiveVersion: "6" | "7"; activeWanCount: number; totalWeight: number } {
  const validation = validateLoadBalancingConfig(config, config.routerId, config.adminId);
  if (validation.errors.length || !validation.config) {
    throw new Error(validation.errors.join(" ") || "Invalid load-balancing configuration.");
  }
  const normalized = validation.config;
  const effectiveVersion = resolveRouterOsMajor(normalized.routerOsVersion, routerVersion);
  const activeWans = normalized.wans.filter(wan => wan.enabled);
  const totalWeight = activeWans.reduce((sum, wan) => sum + wan.weight, 0);
  const stamp = new Date().toISOString();
  const lines: string[] = [
    "# ═══════════════════════════════════════════════════════════════════════════",
    "# ISPlatty — Multi-WAN connection load balancing",
    `# Generated: ${stamp}`,
    `# RouterOS syntax: ${effectiveVersion}`,
    `# LAN interface: ${normalized.lanInterface}`,
    "# PCC balances new connections; it does not bond one TCP connection.",
    "# This file owns only resources tagged with the ISPlatty-LB marker.",
    "# ═══════════════════════════════════════════════════════════════════════════",
    "",
    "# Remove only the previous ISPlatty load-balancing configuration.",
    "/ip firewall mangle remove [find where comment~\"ISPlatty-LB\"]",
    "/ip firewall nat remove [find where comment~\"ISPlatty-LB\"]",
    "/ip firewall address-list remove [find where list=\"ISPLATTY-LB-LOCAL\"]",
    "/ip route remove [find where comment~\"ISPlatty-LB\"]",
    ...(effectiveVersion === "7"
      ? ["/routing table remove [find where comment~\"ISPlatty-LB\"]"]
      : []),
    "",
  ];

  if (!normalized.enabled || activeWans.length < 2) {
    lines.push(
      "# Load balancing is disabled or does not have two active WAN links.",
      "# No traffic rules were installed. Save at least two enabled WAN links and re-apply.",
    );
    return { script: lines.join("\n") + "\n", effectiveVersion, activeWanCount: activeWans.length, totalWeight };
  }

  lines.push(
    "# Private and control-plane destinations must never be PCC-marked.",
    ...[
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "169.254.0.0/16",
      "127.0.0.0/8",
    ].map(address =>
      `/ip firewall address-list add list="ISPLATTY-LB-LOCAL" address=${quote(address)} comment=${quote(comment("local exclusion"))}`,
    ),
    "",
  );

  if (effectiveVersion === "7") {
    lines.push(
      "# RouterOS 7 policy-routing tables.",
      ...activeWans.map((_, index) =>
        `/routing table add name=${quote(routeTableName(index))} fib=yes comment=${quote(comment(`table WAN ${index + 1}`))}`,
      ),
      "",
    );
  }

  lines.push(
    "/ip firewall mangle",
    "# Preserve the WAN that accepted an inbound connection for its replies.",
    ...activeWans.map((wan, index) =>
      `add chain=prerouting in-interface=${quote(wan.interfaceName)} connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=${quote(connectionMark(index))} passthrough=yes comment=${quote(comment(`inbound WAN ${index + 1}`))}`,
    ),
    `add chain=prerouting dst-address-list="ISPLATTY-LB-LOCAL" action=accept comment=${quote(comment("exclude local transit"))}`,
    `add chain=output dst-address-list="ISPLATTY-LB-LOCAL" action=accept comment=${quote(comment("exclude local output"))}`,
  );

  let bucket = 0;
  for (const [index, wan] of activeWans.entries()) {
    for (let offset = 0; offset < wan.weight; offset += 1) {
      lines.push(
        `add chain=prerouting in-interface=${quote(normalized.lanInterface)} connection-state=new connection-mark=no-mark dst-address-type=!local per-connection-classifier=both-addresses-and-ports:${totalWeight}/${bucket} action=mark-connection new-connection-mark=${quote(connectionMark(index))} passthrough=yes comment=${quote(comment(`PCC WAN ${index + 1} bucket ${bucket + 1}`))}`,
      );
      bucket += 1;
    }
  }
  for (const [index] of activeWans.entries()) {
    lines.push(
      `add chain=prerouting in-interface=${quote(normalized.lanInterface)} connection-mark=${quote(connectionMark(index))} action=mark-routing new-routing-mark=${quote(routeTableName(index))} passthrough=no comment=${quote(comment(`route LAN WAN ${index + 1}`))}`,
      `add chain=output connection-mark=${quote(connectionMark(index))} dst-address-type=!local action=mark-routing new-routing-mark=${quote(routeTableName(index))} passthrough=no comment=${quote(comment(`route output WAN ${index + 1}`))}`,
    );
  }
  lines.push("");

  lines.push("# Recursive health routes and per-WAN policy routes.");
  for (const [wanIndex, wan] of activeWans.entries()) {
    const health = `${wan.healthCheckIp}/32`;
    const gateway = `${wan.gateway}%${wan.interfaceName}`;
    lines.push(
      `/ip route add dst-address=${quote(health)} gateway=${quote(gateway)} scope=10 check-gateway=ping comment=${quote(comment(`health WAN ${wanIndex + 1} main`))}`,
      ...activeWans.map((_, tableIndex) =>
        `/ip route add dst-address=${quote(health)} gateway=${quote(gateway)} scope=10 check-gateway=ping ${routeOption(effectiveVersion, routeTableName(tableIndex))} comment=${quote(comment(`health WAN ${wanIndex + 1} table ${tableIndex + 1}`))}`,
      ),
    );
  }
  for (const [tableIndex] of activeWans.entries()) {
    for (const [wanIndex, wan] of activeWans.entries()) {
      const distance = wanIndex === tableIndex ? 1 : 20 + wanIndex;
      lines.push(
        `/ip route add dst-address="0.0.0.0/0" gateway=${quote(wan.healthCheckIp)} target-scope=11 check-gateway=ping distance=${distance} ${routeOption(effectiveVersion, routeTableName(tableIndex))} comment=${quote(comment(`policy WAN ${tableIndex + 1} via ${wanIndex + 1}`))}`,
      );
    }
  }
  for (const [wanIndex, wan] of activeWans.entries()) {
    lines.push(
      `/ip route add dst-address="0.0.0.0/0" gateway=${quote(wan.healthCheckIp)} target-scope=11 check-gateway=ping distance=${10 + wanIndex} comment=${quote(comment(`main WAN ${wanIndex + 1}`))}`,
      `/ip firewall nat add chain=srcnat out-interface=${quote(wan.interfaceName)} action=masquerade comment=${quote(comment(`NAT WAN ${wanIndex + 1}`))}`,
    );
  }
  lines.push(
    "",
    "# Existing sessions keep their marks. New sessions use the weighted PCC buckets above.",
    `:log info ${quote(`ISPlatty-LB applied: ${activeWans.length} WANs, total weight ${totalWeight}, RouterOS ${effectiveVersion}`)}`,
    "",
  );
  return { script: lines.join("\n") + "\n", effectiveVersion, activeWanCount: activeWans.length, totalWeight };
}
