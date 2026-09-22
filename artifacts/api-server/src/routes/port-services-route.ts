import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { authenticatedAccount, authenticatedTenantAdminId, requireAdmin } from "../lib/api-auth.js";
import { encryptVpnSecret } from "../lib/vpn-crypto.js";
import { deployRouterFile, runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { logger } from "../lib/logger.js";
import { sbDeleteStrict, sbInsertStrict, sbSelectStrict, sbUpdateStrict, sbUpsertStrict } from "../lib/supabase-client.js";
import { getDeployableSource } from "../lib/portal-assets.js";
import { PAYMENT_WALLED_GARDEN_HOSTNAMES } from "../lib/payment-walled-garden.js";
import { portServiceResourceNames, type PortServiceResourceNames } from "../lib/port-service-resources.js";
import { getRouterCreds } from "./mikrotik-route.js";
import { validatePortAccess } from "./reseller-route.js";

const router: IRouter = Router();

type PortServiceRow = {
  id: number;
  admin_id: number;
  reseller_id: number | null;
  assigned_reseller_id: number | null;
  router_id: number;
  interface_name: string;
  bridge_name: string | null;
  hotspot_enabled: boolean;
  hotspot_template_path: string | null;
  hotspot_folder_path: string | null;
  hotspot_dns_name: string | null;
  pppoe_enabled: boolean;
  pppoe_folder_path: string | null;
  pppoe_dns_name: string | null;
  reseller_bandwidth_cap: number | null;
  bandwidth_cap_mbps: number;
  subnet_range: string | null;
  vlan_tag?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  status: string;
};

type SourceEntry = { content: Buffer; contentType: string; fileName: string; expiresAt: number };
const sourceEntries = new Map<string, SourceEntry>();
const SOURCE_TTL_MS = 5 * 60 * 1000;

function requestOrigin(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(clean)) return null;
  return clean;
}

function validInterface(value: unknown): value is string {
  return typeof value === "string"
    && /^(ether|sfp|combo|wlan|lte|bridge|vlan)[a-zA-Z0-9._-]*$/i.test(value.trim())
    && value.trim().length <= 64;
}

function safeSegment(value: string, fallback: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return result.slice(0, 48) || fallback;
}

function normalizeSubnet(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
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
    return null;
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

type PortServiceNetwork = {
  bridgeName: string;
  network: string;
  gateway: string;
  poolRange: string;
};

function portServiceNetwork(port: PortServiceRow, resources: PortServiceResourceNames): PortServiceNetwork {
  const bridgeName = resources.bridgeName;
  const fallbackOctet = 180 + ((Math.max(1, port.id) - 1) % 4);
  const rawNetwork = port.subnet_range?.trim() || `192.168.${fallbackOctet}.0/24`;
  const [rawAddress, rawPrefix] = rawNetwork.split("/");
  const octets = rawAddress?.split(".").map(Number) ?? [];
  const prefix = Number(rawPrefix);
  const privateNetwork = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (
    !privateNetwork
    || octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    || prefix !== 24
    || octets[3] !== 0
  ) {
    throw new Error(`Port ${port.interface_name} requires a private network address ending in .0/24.`);
  }
  const network = `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  const gateway = `${octets[0]}.${octets[1]}.${octets[2]}.1`;
  return {
    bridgeName,
    network,
    gateway,
    poolRange: `${octets[0]}.${octets[1]}.${octets[2]}.10-${octets[0]}.${octets[1]}.${octets[2]}.254`,
  };
}

function validPortalHostname(value: string | undefined): string | null {
  const hostname = String(value ?? "").trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname)
    || hostname.includes("..")
    || hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return null;
  }
  return hostname;
}

function optionalPortalHostname(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return validPortalHostname(value);
}

async function resourceIdentityForPort(port: Pick<PortServiceRow, "admin_id" | "router_id" | "assigned_reseller_id" | "reseller_id">): Promise<{
  companyName: string | null;
  routerName: string | null;
  resellerUsername: string | null;
}> {
  const [adminRows, routerRows] = await Promise.all([
    sbSelectStrict<{ name: string | null; company_name: string | null }>(
      "isp_admins",
      `id=eq.${port.admin_id}&select=name,company_name&limit=1`,
    ),
    sbSelectStrict<{ name: string | null }>(
      "isp_routers",
      `id=eq.${port.router_id}&admin_id=eq.${port.admin_id}&select=name&limit=1`,
    ),
  ]);
  const resellerId = port.assigned_reseller_id ?? port.reseller_id;
  const resellerRows = resellerId
    ? await sbSelectStrict<{ username: string | null; company_name: string | null }>(
      "isp_admins",
      `id=eq.${resellerId}&parent_id=eq.${port.admin_id}&role=eq.reseller&select=username,company_name&limit=1`,
    )
    : [];
  return {
    companyName: resellerRows[0]?.company_name ?? resellerRows[0]?.username ?? adminRows[0]?.company_name ?? adminRows[0]?.name ?? null,
    routerName: routerRows[0]?.name ?? null,
    resellerUsername: resellerRows[0]?.username ?? null,
  };
}

function nextAvailableSubnet(rows: Array<{ subnet_range: string | null }>): string {
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

function savedSubnetConflict(
  rows: Array<{ subnet_range: string | null }>,
  requested: string | null,
): boolean {
  return Boolean(requested) && rows.some((row) => row.subnet_range?.trim() === requested);
}

type PortDnsRow = {
  id?: number;
  hotspot_dns_name: string | null;
  pppoe_dns_name: string | null;
};

function nextAvailableCompanyDns(baseName: string, rows: PortDnsRow[]): string {
  const used = new Set(
    rows.flatMap((row) => [row.hotspot_dns_name, row.pppoe_dns_name])
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase()),
  );
  if (!used.has(baseName.toLowerCase())) return baseName;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = baseName.replace(/\.com$/i, `-${suffix}.com`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("No short company DNS name remains for this router.");
}

function portFromLocals(res: { locals: Record<string, unknown> }): PortServiceRow {
  return res.locals.resellerPort as PortServiceRow;
}

function activeResellerId(port: PortServiceRow): number | null {
  return port.assigned_reseller_id ?? port.reseller_id;
}

type PortProvisioningStatus = "pending" | "provisioning" | "active" | "failed";

async function updatePortProvisioningState(
  port: Pick<PortServiceRow, "id" | "admin_id">,
  status: PortProvisioningStatus,
  error: string | null = null,
): Promise<void> {
  await sbUpdateStrict(
    "isp_reseller_ports",
    `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
    {
      status,
      provisioning_error: error ? error.slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    },
  );
}

function sourceNameFromPath(path: string): string {
  return path.split("/").pop() ?? path;
}

async function deployApprovedSource(
  creds: RouterCredentials,
  req: Request,
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = getDeployableSource("hotspot", sourcePath);
  if (!source) throw new Error(`Approved asset "${sourcePath}" could not be found.`);
  const token = randomBytes(24).toString("hex");
  sourceEntries.set(token, {
    content: source.content,
    contentType: "text/html; charset=utf-8",
    fileName: sourceNameFromPath(source.source.name),
    expiresAt: Date.now() + SOURCE_TTL_MS,
  });
  try {
    await deployRouterFile(creds, {
      destinationPath,
      sourceUrl: `${requestOrigin(req)}/api/port-service-source/${token}`,
      overwrite: true,
      uploadId: token.slice(0, 16),
    });
  } finally {
    sourceEntries.delete(token);
  }
}

export function buildDualServiceCommands(
  port: PortServiceRow,
  hotspotPath: string | null,
  pppoePath: string | null,
  routerAddress: string,
  options: {
    portalHostname?: string;
    hotspotDnsName?: string | null;
    pppoeDnsName?: string | null;
    companyName?: string | null;
    routerName?: string | null;
    paymentHostnames?: string[];
  } = {},
): string[][] {
  const validAssignedInterface = port.handoff_mode === "vlan_services"
    ? /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(port.interface_name.trim())
    : /^(ether|sfp|combo|wlan|lte|bridge|vlan)[a-zA-Z0-9._-]*$/i.test(port.interface_name.trim());
  if (!validAssignedInterface) {
    throw new Error(`The assigned interface "${port.interface_name}" is not a valid RouterOS interface.`);
  }
  const resources = portServiceResourceNames(port, options);
  if (port.handoff_mode === "vlan_services") {
    return buildVlanServiceCommands(port, resources, hotspotPath, pppoePath, routerAddress, options);
  }
  const portName = resources.portName;
  const network = portServiceNetwork(port, resources);
  const hotspotProfile = resources.hotspotProfile;
  const pppoeLandingProfile = resources.pppoeProfile;
  const pppoeService = resources.pppoeService;
  const parentQueue = resources.parentQueue;
  const cap = port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps;
  const hotspotDnsName = validPortalHostname(options.hotspotDnsName ?? undefined)
    ?? resources.defaultDnsName;
  const pppoeDnsName = validPortalHostname(options.pppoeDnsName ?? undefined)
    ?? resources.defaultDnsName;
  const comment = (suffix: string) => `${resources.commentPrefix}_${suffix}`;
  const commands: string[][] = [];

  /* A Hotspot server is bound to an interface. Give every assigned port its
     own bridge so two ports on one router can have different captive pages
     and cannot leak users into each other's service network. */
  commands.push(
    ["/interface/bridge/add", `=name=${network.bridgeName}`, `=comment=${comment("bridge")}`],
    ["/interface/bridge/port/add", `=bridge=${network.bridgeName}`, `=interface=${port.interface_name}`, `=comment=${comment("port")}`],
  );

  if (hotspotPath) {
    commands.push(
      ["/ip/address/add", `=address=${network.gateway}/24`, `=interface=${network.bridgeName}`, `=comment=${comment("hotspot_gateway")}`],
      ["/ip/pool/add", `=name=${resources.hotspotPool}`, `=ranges=${network.poolRange}`, `=comment=${comment("hotspot_pool")}`],
      ["/ip/dhcp-server/network/add", `=address=${network.network}`, `=gateway=${network.gateway}`, `=dns-server=${network.gateway},8.8.8.8`, `=comment=${comment("hotspot_network")}`],
      ["/ip/dhcp-server/add", `=name=${resources.hotspotDhcp}`, `=interface=${network.bridgeName}`, `=address-pool=${resources.hotspotPool}`, "=disabled=no"],
      ["/ip/hotspot/profile/add", `=name=${hotspotProfile}`, `=html-directory=${hotspotPath}`, "=login-by=http-chap,http-pap", `=dns-name=${hotspotDnsName}`, `=comment=${comment("hotspot_profile")}`],
      ["/ip/hotspot/add", `=name=${resources.hotspotServer}`, `=interface=${network.bridgeName}`, `=profile=${hotspotProfile}`, `=address-pool=${resources.hotspotPool}`, "=disabled=no", `=comment=${comment("hotspot")}`],
      ["/ip/dns/static/add", `=name=${hotspotDnsName}`, `=address=${network.gateway}`, `=comment=${comment("hotspot_dns")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${network.bridgeName}`, "=protocol=udp", "=dst-port=67", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dhcp")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${network.bridgeName}`, "=protocol=udp", "=dst-port=53", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dns_udp")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${network.bridgeName}`, "=protocol=tcp", "=dst-port=53", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dns_tcp")}`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=${comment("hotspot_nat")}`],
    );
    const gardenHostnames = [...new Set([
      validPortalHostname(options.portalHostname),
      hotspotDnsName,
      ...(options.paymentHostnames ?? PAYMENT_WALLED_GARDEN_HOSTNAMES)
        .map(hostname => validPortalHostname(hostname))
        .filter((hostname): hostname is string => Boolean(hostname)),
    ].filter((hostname): hostname is string => Boolean(hostname)))];
    gardenHostnames.forEach((hostname, index) => {
      commands.push([
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${hostname}`,
        "=action=accept",
        `=comment=${comment(
          index === 0
            ? "walled_garden"
            : hostname === hotspotDnsName
              ? "hotspot_dns"
              : "payment_walled_garden",
        )}`,
      ]);
    });
  }
  if (hotspotPath || pppoePath) {
    if (hotspotPath) {
      commands.push([
        "/ip/firewall/filter/add",
        "=chain=forward",
        `=in-interface=${network.bridgeName}`,
        "=out-interface-list=WAN",
        "=action=accept",
        "=hotspot=auth",
        "=place-before=0",
        `=comment=${comment("allow_service_forward")}`,
      ]);
    } else {
      commands.push([
        "/ip/firewall/filter/add",
        "=chain=forward",
        `=src-address=${network.network}`,
        "=out-interface-list=WAN",
        "=action=accept",
        "=place-before=0",
        `=comment=${comment("allow_service_forward")}`,
      ]);
    }
    commands.push(
      ["/ip/firewall/filter/add", "=chain=input", "=in-interface-list=WAN", "=protocol=udp", "=dst-port=53", "=action=drop", "=place-before=0", `=comment=${comment("block_wan_dns_udp")}`],
      ["/ip/firewall/filter/add", "=chain=input", "=in-interface-list=WAN", "=protocol=tcp", "=dst-port=53", "=action=drop", "=place-before=0", `=comment=${comment("block_wan_dns_tcp")}`],
    );
  }
  if (hotspotPath || pppoePath) {
    commands.push([
      "/queue/simple/add",
      `=name=${parentQueue}`,
      `=target=${network.bridgeName}`,
      `=max-limit=${cap}M/${cap}M`,
      "=priority=2/2",
      `=comment=${comment("parent_queue")}`,
    ]);
  }
  if (pppoePath) {
    commands.push(
      /* RouterOS 6 does not expose comment on PPPoE server entries. Keep
         ownership in the service name/profile instead of sending an
         unsupported property that aborts the whole deployment. */
      ["/interface/pppoe-server/server/add", `=service-name=${pppoeService}`, `=interface=${network.bridgeName}`, `=disabled=no`, "=one-session-per-host=yes"],
      ["/ip/hotspot/profile/add", `=name=${pppoeLandingProfile}`, `=html-directory=${pppoePath}`, "=login-by=http-chap,http-pap", `=dns-name=${pppoeDnsName}`, `=comment=${comment("pppoe_landing")}`],
      ["/ip/dns/static/add", `=name=${pppoeDnsName}`, `=address=${network.gateway}`, `=comment=${comment("pppoe_dns")}`],
      ["/queue/simple/add", `=name=PPPOE_PREMIUM_${resources.resourceName}`, `=target=${network.bridgeName}`, `=parent=${parentQueue}`, `=max-limit=${cap}M/${cap}M`, "=priority=1/1", `=comment=${comment("pppoe_premium")}`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=${comment("pppoe_nat")}`],
      ["/ip/firewall/nat/add", "=chain=dstnat", `=in-interface=${network.bridgeName}`, "=protocol=tcp", "=dst-port=80", "=action=dst-nat", `=to-addresses=${network.gateway || routerAddress}`, "=to-ports=80", `=comment=${comment("pppoe_billing_redirect")}`],
    );
  }
  if (hotspotPath) {
    commands.push([
      "/queue/simple/add",
      `=name=HOTSPOT_TRANSIT_${resources.resourceName}`,
      `=target=${network.network}`,
      `=parent=${parentQueue}`,
      `=max-limit=${cap}M/${cap}M`,
      "=priority=8/8",
      `=comment=${comment("hotspot_transit")}`,
    ]);
  }
  return commands;
}

function buildVlanServiceCommands(
  port: PortServiceRow,
  resources: PortServiceResourceNames,
  hotspotPath: string | null,
  pppoePath: string | null,
  routerAddress: string,
  options: {
    portalHostname?: string;
    hotspotDnsName?: string | null;
    pppoeDnsName?: string | null;
    paymentHostnames?: string[];
  },
): string[][] {
  const vlanInterface = port.interface_name.trim();
  const bridge = port.bridge_name?.trim() || "";
  const tag = Number(port.vlan_tag);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(vlanInterface)
    || !validInterface(bridge)
    || !Number.isSafeInteger(tag)
    || tag < 1
    || tag > 4094) {
    throw new Error("The VLAN service is missing a valid VLAN interface, parent bridge, or VLAN tag.");
  }
  const network = portServiceNetwork(port, { ...resources, bridgeName: vlanInterface });
  const hotspotDnsName = validPortalHostname(options.hotspotDnsName ?? undefined) ?? resources.defaultDnsName;
  const pppoeDnsName = validPortalHostname(options.pppoeDnsName ?? undefined) ?? resources.defaultDnsName;
  const comment = (suffix: string) => `${resources.commentPrefix}_${suffix}`;
  const commands: string[][] = [
    ["/interface/vlan/add", `=name=${vlanInterface}`, `=vlan-id=${tag}`, `=interface=${bridge}`, `=comment=${comment("vlan")}`],
  ];
  if (hotspotPath) {
    commands.push(
      ["/ip/address/add", `=address=${network.gateway}/24`, `=interface=${vlanInterface}`, `=comment=${comment("hotspot_gateway")}`],
      ["/ip/pool/add", `=name=${resources.hotspotPool}`, `=ranges=${network.poolRange}`, `=comment=${comment("hotspot_pool")}`],
      ["/ip/dhcp-server/network/add", `=address=${network.network}`, `=gateway=${network.gateway}`, `=dns-server=${network.gateway},8.8.8.8`, `=comment=${comment("hotspot_network")}`],
      ["/ip/dhcp-server/add", `=name=${resources.hotspotDhcp}`, `=interface=${vlanInterface}`, `=address-pool=${resources.hotspotPool}`, "=disabled=no"],
      ["/ip/hotspot/profile/add", `=name=${resources.hotspotProfile}`, `=hotspot-address=${network.gateway}`, `=html-directory=${hotspotPath}`, "=login-by=http-chap,http-pap,cookie", `=dns-name=${hotspotDnsName}`, `=comment=${comment("hotspot_profile")}`],
      ["/ip/hotspot/add", `=name=${resources.hotspotServer}`, `=interface=${vlanInterface}`, `=profile=${resources.hotspotProfile}`, `=address-pool=${resources.hotspotPool}`, "=disabled=no"],
      ["/ip/dns/static/add", `=name=${hotspotDnsName}`, `=address=${network.gateway}`, `=comment=${comment("hotspot_dns")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${vlanInterface}`, "=protocol=udp", "=dst-port=67", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dhcp")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${vlanInterface}`, "=protocol=udp", "=dst-port=53", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dns_udp")}`],
      ["/ip/firewall/filter/add", "=chain=input", `=in-interface=${vlanInterface}`, "=protocol=tcp", "=dst-port=53", "=action=accept", "=place-before=0", `=comment=${comment("allow_service_dns_tcp")}`],
      ["/ip/firewall/filter/add", "=chain=forward", `=in-interface=${vlanInterface}`, "=out-interface-list=WAN", "=action=accept", "=hotspot=auth", "=place-before=0", `=comment=${comment("allow_service_forward")}`],
      ["/ip/firewall/filter/add", "=chain=input", "=in-interface-list=WAN", "=protocol=udp", "=dst-port=53", "=action=drop", "=place-before=0", `=comment=${comment("block_wan_dns_udp")}`],
      ["/ip/firewall/filter/add", "=chain=input", "=in-interface-list=WAN", "=protocol=tcp", "=dst-port=53", "=action=drop", "=place-before=0", `=comment=${comment("block_wan_dns_tcp")}`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=${comment("hotspot_nat")}`],
    );
    for (const hostname of [...new Set([
      validPortalHostname(options.portalHostname),
      hotspotDnsName,
      ...(options.paymentHostnames ?? PAYMENT_WALLED_GARDEN_HOSTNAMES).map(validPortalHostname).filter((value): value is string => Boolean(value)),
    ].filter((value): value is string => Boolean(value)))]) {
      commands.push(["/ip/hotspot/walled-garden/ip/add", `=dst-host=${hostname}`, "=action=accept", `=comment=${comment("walled_garden")}`]);
    }
  }
  if (hotspotPath || pppoePath) {
    commands.push([
      "/queue/simple/add",
      `=name=${resources.parentQueue}`,
      `=target=${vlanInterface}`,
      `=max-limit=${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M/${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M`,
      "=priority=2/2",
      `=comment=${comment("parent_queue")}`,
    ]);
  }
  if (pppoePath) {
    const pppoePool = `${network.network.split(".").slice(0, 3).join(".")}.200-${network.network.split(".").slice(0, 3).join(".")}.254`;
    commands.push(
      ["/ip/pool/add", `=name=PPPOE_POOL_${resources.resourceName}`, `=ranges=${pppoePool}`, `=comment=${comment("pppoe_pool")}`],
      ["/ppp/profile/add", `=name=${resources.pppoeProfile}`, `=local-address=${network.gateway}`, `=remote-address=PPPOE_POOL_${resources.resourceName}`, `=dns-server=${network.gateway},8.8.8.8`, "=only-one=yes", `=comment=${comment("pppoe_profile")}`],
      ["/interface/pppoe-server/server/add", `=service-name=${resources.pppoeService}`, `=interface=${vlanInterface}`, `=default-profile=${resources.pppoeProfile}`, "=disabled=no", "=one-session-per-host=yes"],
      ["/ip/dns/static/add", `=name=${pppoeDnsName}`, `=address=${network.gateway}`, `=comment=${comment("pppoe_dns")}`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=${comment("pppoe_nat")}`],
    );
  }
  return commands;
}

async function executeIdempotentRouterCommand(creds: RouterCredentials, command: string[]): Promise<void> {
  const addPath = command[0];
  const propertyByPath: Record<string, string> = {
    "/interface/bridge/add": "name",
    "/interface/vlan/add": "name",
    "/ip/hotspot/profile/add": "name",
    "/ip/hotspot/add": "name",
    "/interface/pppoe-server/server/add": "service-name",
    "/ip/address/add": "address",
    "/ip/pool/add": "name",
    "/ip/dhcp-server/network/add": "address",
    "/ip/dhcp-server/add": "name",
    "/ip/dns/static/add": "name",
    "/queue/simple/add": "name",
    "/ip/firewall/filter/add": "comment",
    "/ip/hotspot/walled-garden/ip/add": "comment",
    "/ip/firewall/nat/add": "comment",
  };

  if (addPath === "/interface/bridge/port/add") {
    const bridgeArg = command.find((arg) => arg.startsWith("=bridge="));
    const interfaceArg = command.find((arg) => arg.startsWith("=interface="));
    const bridgeName = bridgeArg?.slice("=bridge=".length);
    const interfaceName = interfaceArg?.slice("=interface=".length);
    if (!bridgeName || !interfaceName) throw new Error("A port-service bridge binding is incomplete.");
    const rows = await runRouterCommand(creds, [
      "/interface/bridge/port/print",
      "=.proplist=.id,bridge,interface",
      `?interface=${interfaceName}`,
    ]);
    const existing = rows.find((row) => row.interface === interfaceName);
    if (existing) {
      if (existing.bridge !== bridgeName) {
        throw new Error(`Interface ${interfaceName} is already assigned to foreign bridge ${existing.bridge}.`);
      }
      return;
    }
    await runRouterCommand(creds, command);
    return;
  }

  if (addPath === "/interface/vlan/add") {
    const name = command.find((arg) => arg.startsWith("=name="))?.slice("=name=".length);
    if (!name) {
      await runRouterCommand(creds, command);
      return;
    }
    const rows = await runRouterCommand(creds, [
      "/interface/vlan/print",
      "=.proplist=.id,name,vlan-id,interface",
      `?name=${name}`,
    ]);
    const existing = rows.find((row) => row.name === name);
    if (existing?.[".id"]) {
      const requestedTag = command.find((arg) => arg.startsWith("=vlan-id="))?.slice("=vlan-id=".length);
      const requestedParent = command.find((arg) => arg.startsWith("=interface="))?.slice("=interface=".length);
      if (String(existing["vlan-id"] ?? "") !== String(requestedTag ?? "")
        || String(existing.interface ?? "") !== String(requestedParent ?? "")) {
        throw new Error(`VLAN interface ${name} already belongs to another VLAN or parent interface.`);
      }
      return;
    }
    await runRouterCommand(creds, command);
    return;
  }

  const property = propertyByPath[addPath];
  const propertyArg = command.find((arg) => arg.startsWith(`=${property}=`));
  if (!property || !propertyArg) {
    await runRouterCommand(creds, command);
    return;
  }
  const printPath = addPath.replace(/\/add$/, "/print");
  const proplist = addPath === "/ip/address/add"
    ? "=.proplist=.id,address,interface"
    : `=.proplist=.id,${property}`;
  const rows = await runRouterCommand(creds, [printPath, proplist]).catch(() => []);
  const existing = rows.find((row) => row[property] === propertyArg.slice(property.length + 2));
  if (existing?.[".id"]) {
    if (
      addPath === "/ip/address/add"
      && existing.interface
      && existing.interface !== command.find((arg) => arg.startsWith("=interface="))?.slice("=interface=".length)
    ) {
      throw new Error(`Address ${propertyArg.slice(property.length + 2)} is already assigned to foreign interface ${existing.interface}.`);
    }
    await runRouterCommand(creds, [
      addPath.replace(/\/add$/, "/set"),
      `=.id=${existing[".id"]}`,
      ...command.slice(1).filter((arg) => !arg.startsWith(`=${property}=`)),
    ]);
    return;
  }
  await runRouterCommand(creds, command);
}

type RouterResourceRow = Record<string, string>;

async function removeRouterResourceRows(
  creds: RouterCredentials,
  printPath: string,
  proplist: string,
  matches: (row: RouterResourceRow) => boolean,
): Promise<void> {
  const rows = await runRouterCommand(creds, [printPath, `=.proplist=${proplist}`]);
  const removePath = printPath.replace(/\/print$/, "/remove");
  for (const row of rows) {
    if (row[".id"] && matches(row)) {
      await runRouterCommand(creds, [removePath, `=.id=${row[".id"]}`]);
    }
  }
}

function isPortServiceComment(resources: PortServiceResourceNames, row: RouterResourceRow): boolean {
  return String(row.comment ?? "").startsWith(`${resources.commentPrefix}_`);
}

async function removePortServiceFiles(
  creds: RouterCredentials,
  resources: PortServiceResourceNames,
): Promise<void> {
  const directories = [resources.hotspotDirectory, resources.pppoeDirectory];
  const rows = await runRouterCommand(creds, ["/file/print", "=.proplist=.id,name"]);
  const ownedRows = rows
    .filter(row => row[".id"] && directories.some(directory =>
      row.name === directory || row.name.startsWith(`${directory}/`),
    ))
    .sort((left, right) => right.name.length - left.name.length);
  for (const row of ownedRows) {
    await runRouterCommand(creds, ["/file/remove", `=.id=${row[".id"]}`]);
  }
}

/**
 * Remove only the RouterOS resources created for one isolated port service.
 * The comment prefix is the primary ownership boundary; generated names are
 * used only for resources whose deployment command did not set a comment.
 */
export async function removePortServiceResources(
  creds: RouterCredentials,
  port: PortServiceRow,
  resources: PortServiceResourceNames,
): Promise<void> {
  const ownedComment = (row: RouterResourceRow) => isPortServiceComment(resources, row);
  const exactName = (name: string, requireBridge?: string) => (row: RouterResourceRow) =>
    row.name === name
    && (!requireBridge || row.interface === requireBridge)
    && (ownedComment(row) || !row.comment);

  /* Remove dependants before profiles, pools, and the bridge they reference. */
  await removeRouterResourceRows(
    creds,
    "/interface/pppoe-server/server/print",
    ".id,service-name,interface,comment",
    row => row["service-name"] === resources.pppoeService && ownedComment(row),
  );
  await removeRouterResourceRows(
    creds,
    "/ip/hotspot/print",
    ".id,name,interface,comment",
    row => row.name === resources.hotspotServer && ownedComment(row),
  );
  await removeRouterResourceRows(
    creds,
    "/ip/dhcp-server/print",
    ".id,name,interface,comment",
    exactName(resources.hotspotDhcp, resources.bridgeName),
  );
  await removeRouterResourceRows(
    creds,
    "/queue/simple/print",
    ".id,name,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/firewall/nat/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/firewall/filter/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/hotspot/walled-garden/ip/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/dns/static/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/hotspot/profile/print",
    ".id,name,comment",
    row => [resources.hotspotProfile, resources.pppoeProfile].includes(row.name) && ownedComment(row),
  );
  await removeRouterResourceRows(
    creds,
    "/ip/address/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/dhcp-server/network/print",
    ".id,comment",
    ownedComment,
  );
  await removeRouterResourceRows(
    creds,
    "/ip/pool/print",
    ".id,name,comment",
    row => [resources.hotspotPool].includes(row.name) && ownedComment(row),
  );
  await removeRouterResourceRows(
    creds,
    "/interface/bridge/port/print",
    ".id,bridge,interface,comment",
    row => row.bridge === resources.bridgeName && ownedComment(row),
  );
  await removeRouterResourceRows(
    creds,
    "/interface/bridge/print",
    ".id,name,comment",
    row => row.name === resources.bridgeName && ownedComment(row),
  );
  if (port.handoff_mode === "vlan_services") {
    await removeRouterResourceRows(
      creds,
      "/interface/vlan/print",
      ".id,name,comment",
      row => row.name === port.interface_name && ownedComment(row),
    );
  }
  await removePortServiceFiles(creds, resources);

  logger.info(
    { portId: port.id, routerId: port.router_id, interfaceName: port.interface_name },
    "[port-services] removed isolated port resources",
  );
}

router.get("/port-service-source/:token", (req, res): void => {
  const entry = sourceEntries.get(String(req.params.token));
  if (!entry || entry.expiresAt < Date.now()) {
    sourceEntries.delete(String(req.params.token));
    res.status(404).end();
    return;
  }
  sourceEntries.delete(String(req.params.token));
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Content-Length", String(entry.content.length));
  res.setHeader("Cache-Control", "no-store");
  res.send(entry.content);
});

router.get("/admin/port-services", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const tenantId = await authenticatedTenantAdminId(req);
    const account = await authenticatedAccount(req);
    if (!tenantId || !account) {
      res.status(403).json({ ok: false, error: "A valid signed-in ISP account is required." });
      return;
    }
    const routerId = String(req.query.routerId ?? "").trim();
    const rows = await sbSelectStrict<PortServiceRow>(
      "isp_reseller_ports",
      `admin_id=eq.${tenantId}${routerId && /^\d+$/.test(routerId) ? `&router_id=eq.${routerId}` : ""}&select=*&order=interface_name.asc`,
    );
    const visible = account.role === "reseller"
      ? rows.filter((row) => activeResellerId(row) === account.id)
      : rows;
    res.json({ ok: true, ports: visible });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load port services." });
  }
});

router.post("/admin/port-services", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await authenticatedAccount(req);
    const tenantId = await authenticatedTenantAdminId(req);
    if (!account || !tenantId || account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Only the signed-in ISP administrator can assign multiport services." });
      return;
    }
    const routerId = Number(req.body?.routerId);
    const interfaceName = typeof req.body?.interfaceName === "string" ? req.body.interfaceName.trim() : "";
    const cap = Number(req.body?.bandwidthCapMbps);
    if (!Number.isSafeInteger(routerId) || routerId <= 0 || !validInterface(interfaceName)) {
      res.status(400).json({ ok: false, error: "Choose a router and a valid physical interface." });
      return;
    }
    if (!Number.isFinite(cap) || cap <= 0 || cap > 100000) {
      res.status(400).json({ ok: false, error: "Bandwidth must be between 1 and 100,000 Mbps." });
      return;
    }
    const subnetRange = normalizeSubnet(req.body?.subnetRange);
    if (req.body?.subnetRange && !subnetRange) {
      res.status(400).json({ ok: false, error: "The service subnet must be a private network ending in .0/24." });
      return;
    }
    const routerRows = await sbSelectStrict<{ id: number; name: string | null }>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${tenantId}&select=id,name&limit=1`,
    );
    if (!routerRows[0]) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    const conflicts = await sbSelectStrict<{ id: number }>(
      "isp_reseller_ports",
      `router_id=eq.${routerId}&interface_name=eq.${encodeURIComponent(interfaceName)}&status=neq.disabled&select=id&limit=1`,
    );
    if (conflicts[0]) {
      res.status(409).json({ ok: false, error: "That physical port is already assigned." });
      return;
    }
    const hotspotEnabled = req.body?.hotspotEnabled === true;
    const pppoeEnabled = req.body?.pppoeEnabled === true;
    const identity = await resourceIdentityForPort({
      admin_id: tenantId,
      router_id: routerId,
      reseller_id: null,
      assigned_reseller_id: null,
    });
    const defaultResources = portServiceResourceNames({
      id: 0,
      router_id: routerId,
      interface_name: interfaceName,
    }, {
      companyName: identity.companyName,
      routerName: routerRows[0]?.name,
    });
    const hotspotFolderPath = req.body?.hotspotFolderPath === "" ? null : cleanPath(req.body?.hotspotFolderPath);
    const pppoeFolderPath = req.body?.pppoeFolderPath === "" ? null : cleanPath(req.body?.pppoeFolderPath);
    const requestedHotspotDnsName = optionalPortalHostname(req.body?.hotspotDnsName);
    const requestedPppoeDnsName = optionalPortalHostname(req.body?.pppoeDnsName);
    if ((req.body?.hotspotDnsName && !requestedHotspotDnsName) || (req.body?.pppoeDnsName && !requestedPppoeDnsName)) {
      res.status(400).json({ ok: false, error: "DNS names must be valid hostnames without http://, paths, or spaces." });
      return;
    }
    if (hotspotEnabled && !hotspotFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved Hotspot asset before enabling the Hotspot portal." });
      return;
    }
    if (pppoeEnabled && !pppoeFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved PPPoE landing asset before enabling the PPPoE landing page." });
      return;
    }
    const bridgeName = safeSegment(
      typeof req.body?.bridgeName === "string" && req.body.bridgeName.trim()
        ? req.body.bridgeName.trim()
        : defaultResources.bridgeName,
      defaultResources.bridgeName,
    );
    const existingPorts = await sbSelectStrict<PortDnsRow & { subnet_range: string | null }>(
      "isp_reseller_ports",
      `admin_id=eq.${tenantId}&router_id=eq.${routerId}&status=neq.disabled&select=subnet_range,hotspot_dns_name,pppoe_dns_name`,
    );
    if (savedSubnetConflict(existingPorts, subnetRange)) {
      res.status(409).json({ ok: false, error: "That service subnet is already assigned to another active port on this router." });
      return;
    }
    const savedSubnet = subnetRange ?? nextAvailableSubnet(existingPorts);
    const defaultDnsName = nextAvailableCompanyDns(defaultResources.defaultDnsName, existingPorts);
    const sharedDnsName = requestedHotspotDnsName ?? requestedPppoeDnsName ?? defaultDnsName;
    const hotspotDnsName = hotspotEnabled ? (requestedHotspotDnsName ?? sharedDnsName) : requestedHotspotDnsName;
    const pppoeDnsName = pppoeEnabled ? (requestedPppoeDnsName ?? sharedDnsName) : requestedPppoeDnsName;
    const inserted = await sbInsertStrict<PortServiceRow>("isp_reseller_ports", {
      admin_id: tenantId,
      // The legacy schema requires reseller_id. For ISP-owned multiport services
      // the tenant is the owner and assigned_reseller_id remains null.
      reseller_id: tenantId,
      assigned_reseller_id: null,
      router_id: routerId,
      interface_name: interfaceName,
      bridge_name: bridgeName,
      hotspot_enabled: hotspotEnabled,
      hotspot_template_path: hotspotFolderPath,
      hotspot_folder_path: hotspotFolderPath,
      hotspot_dns_name: hotspotDnsName,
      pppoe_enabled: pppoeEnabled,
      pppoe_folder_path: pppoeFolderPath,
      pppoe_dns_name: pppoeDnsName,
      subnet_range: savedSubnet,
      bandwidth_cap_mbps: Math.round(cap),
      reseller_bandwidth_cap: Math.round(cap),
      status: "pending",
      provisioning_error: null,
      updated_at: new Date().toISOString(),
    });
    res.status(201).json({ ok: true, port: inserted[0] ?? null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to assign the physical port." });
  }
});

router.put("/admin/port-services/:portId", requireAdmin(), validatePortAccess, async (req, res): Promise<void> => {
  try {
    const port = portFromLocals(res);
    const identity = await resourceIdentityForPort(port);
    const defaultResources = portServiceResourceNames(port, identity);
    const hotspotFolderPath = req.body?.hotspotFolderPath === "" ? null : cleanPath(req.body?.hotspotFolderPath);
    const pppoeFolderPath = req.body?.pppoeFolderPath === "" ? null : cleanPath(req.body?.pppoeFolderPath);
    const hotspotEnabled = req.body?.hotspotEnabled === true;
    const pppoeEnabled = req.body?.pppoeEnabled === true;
    const requestedHotspotDnsName = req.body?.hotspotDnsName === undefined
      ? port.hotspot_dns_name
      : optionalPortalHostname(req.body.hotspotDnsName);
    const requestedPppoeDnsName = req.body?.pppoeDnsName === undefined
      ? port.pppoe_dns_name
      : optionalPortalHostname(req.body.pppoeDnsName);
    if (
      (req.body?.hotspotDnsName && !requestedHotspotDnsName)
      || (req.body?.pppoeDnsName && !requestedPppoeDnsName)
    ) {
      res.status(400).json({ ok: false, error: "DNS names must be valid hostnames without http://, paths, or spaces." });
      return;
    }
    const bandwidth = req.body?.bandwidthCapMbps === undefined
      ? Number(port.bandwidth_cap_mbps)
      : Number(req.body.bandwidthCapMbps);
    const subnetRange = req.body?.subnetRange === undefined
      ? port.subnet_range
      : normalizeSubnet(req.body.subnetRange);
    const existingPorts = await sbSelectStrict<PortDnsRow & { subnet_range: string | null }>(
      "isp_reseller_ports",
      `admin_id=eq.${port.admin_id}&router_id=eq.${port.router_id}&id=neq.${port.id}&status=neq.disabled&select=subnet_range,hotspot_dns_name,pppoe_dns_name`,
    );
    if (savedSubnetConflict(existingPorts, subnetRange)) {
      res.status(409).json({ ok: false, error: "That service subnet is already assigned to another active port on this router." });
      return;
    }
    const savedSubnet = subnetRange ?? nextAvailableSubnet(existingPorts);
    const defaultDnsName = nextAvailableCompanyDns(defaultResources.defaultDnsName, existingPorts);
    const sharedDnsName = requestedHotspotDnsName ?? requestedPppoeDnsName ?? defaultDnsName;
    const hotspotDnsName = hotspotEnabled ? (requestedHotspotDnsName ?? sharedDnsName) : requestedHotspotDnsName;
    const pppoeDnsName = pppoeEnabled ? (requestedPppoeDnsName ?? sharedDnsName) : requestedPppoeDnsName;
    const bridgeName = req.body?.bridgeName === undefined
      ? (port.bridge_name ?? defaultResources.bridgeName)
      : safeSegment(String(req.body.bridgeName ?? "").trim(), defaultResources.bridgeName);
    if (!Number.isFinite(bandwidth) || bandwidth <= 0 || bandwidth > 100000) {
      res.status(400).json({ ok: false, error: "Bandwidth must be between 1 and 100,000 Mbps." });
      return;
    }
    if (req.body?.subnetRange && !subnetRange) {
      res.status(400).json({ ok: false, error: "The service subnet must be a private network ending in .0/24." });
      return;
    }
    if (hotspotEnabled && !hotspotFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved Hotspot asset before enabling the Hotspot portal." });
      return;
    }
    if (pppoeEnabled && !pppoeFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved PPPoE landing asset before enabling the PPPoE landing page." });
      return;
    }
    const updated = await sbUpdateStrict<PortServiceRow>(
      "isp_reseller_ports",
      `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
      {
        hotspot_enabled: hotspotEnabled,
        hotspot_folder_path: hotspotFolderPath,
        hotspot_template_path: hotspotFolderPath,
        hotspot_dns_name: hotspotDnsName,
        pppoe_enabled: pppoeEnabled,
        pppoe_folder_path: pppoeFolderPath,
        pppoe_dns_name: pppoeDnsName,
        bridge_name: bridgeName,
        subnet_range: savedSubnet,
        bandwidth_cap_mbps: Math.round(bandwidth),
        reseller_bandwidth_cap: Math.round(bandwidth),
        updated_at: new Date().toISOString(),
      },
    );
    res.json({ ok: true, port: updated[0] ?? null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save port service bindings." });
  }
});

router.delete("/admin/port-services/:portId", requireAdmin(), validatePortAccess, async (req, res): Promise<void> => {
  const port = portFromLocals(res);
  try {
    const found = await getRouterCreds(port.router_id, port.admin_id);
    if (!found) {
      const errorMessage = "Router credentials are unavailable. The assignment was kept so cleanup can be retried.";
      await updatePortProvisioningState(port, "failed", errorMessage);
      res.status(404).json({ ok: false, error: errorMessage });
      return;
    }
    const identity = await resourceIdentityForPort(port);
    const resources = portServiceResourceNames(port, identity);
    await removePortServiceResources(found.creds, port, resources);
    await sbDeleteStrict(
      "isp_reseller_ports",
      `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
    );
    res.json({ ok: true, interfaceName: port.interface_name });
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "The router cleanup failed. The assignment was kept so it can be retried.";
    try {
      await updatePortProvisioningState(port, "failed", errorMessage);
    } catch (stateError) {
      logger.error({ err: stateError, portId: port.id, cleanupError: errorMessage }, "[port-services] failed to persist cleanup error");
    }
    res.status(502).json({ ok: false, error: `Router cleanup failed; the assignment was kept for retry. ${errorMessage}` });
  }
});

router.post("/admin/port-services/:portId/deploy", requireAdmin(), validatePortAccess, async (req, res): Promise<void> => {
  try {
    const port = portFromLocals(res);
    if (!port.hotspot_enabled && !port.pppoe_enabled) {
      res.status(400).json({ ok: false, error: "Enable at least one service before deploying this port." });
      return;
    }
    const hotspotSource = port.hotspot_enabled ? cleanPath(port.hotspot_folder_path ?? port.hotspot_template_path) : null;
    const pppoeSource = port.pppoe_enabled ? cleanPath(port.pppoe_folder_path) : null;
    if ((port.hotspot_enabled && !hotspotSource) || (port.pppoe_enabled && !pppoeSource)) {
      res.status(409).json({ ok: false, error: "Both enabled services must have an approved asset binding." });
      return;
    }
    await updatePortProvisioningState(port, "provisioning");
    const found = await getRouterCreds(port.router_id, port.admin_id);
    if (!found) {
      const errorMessage = "Router credentials are unavailable for this port.";
      await updatePortProvisioningState(port, "failed", errorMessage);
      res.status(404).json({ ok: false, error: errorMessage });
      return;
    }
    const identity = await resourceIdentityForPort(port);
    const resources = portServiceResourceNames(port, identity);
    const needsDefaultDns = (port.hotspot_enabled && !port.hotspot_dns_name)
      || (port.pppoe_enabled && !port.pppoe_dns_name);
    const peers = !port.subnet_range || needsDefaultDns
      ? await sbSelectStrict<PortDnsRow & { subnet_range: string | null }>(
        "isp_reseller_ports",
        `admin_id=eq.${port.admin_id}&router_id=eq.${port.router_id}&id=neq.${port.id}&status=neq.disabled&select=subnet_range,hotspot_dns_name,pppoe_dns_name`,
      )
      : [];
    const defaultDnsName = nextAvailableCompanyDns(resources.defaultDnsName, peers);
    const sharedDnsName = port.hotspot_dns_name ?? port.pppoe_dns_name ?? defaultDnsName;
    const deploymentPort: PortServiceRow = {
      ...port,
      bridge_name: port.bridge_name ?? resources.bridgeName,
      subnet_range: port.subnet_range ?? nextAvailableSubnet(peers),
      hotspot_dns_name: port.hotspot_dns_name ?? (port.hotspot_enabled ? sharedDnsName : null),
      pppoe_dns_name: port.pppoe_dns_name ?? (port.pppoe_enabled ? sharedDnsName : null),
    };
    if (
      deploymentPort.bridge_name !== port.bridge_name
      || deploymentPort.subnet_range !== port.subnet_range
      || deploymentPort.hotspot_dns_name !== port.hotspot_dns_name
      || deploymentPort.pppoe_dns_name !== port.pppoe_dns_name
    ) {
      await sbUpdateStrict("isp_reseller_ports", `id=eq.${port.id}&admin_id=eq.${port.admin_id}`, {
        bridge_name: deploymentPort.bridge_name,
        subnet_range: deploymentPort.subnet_range,
        hotspot_dns_name: deploymentPort.hotspot_dns_name,
        pppoe_dns_name: deploymentPort.pppoe_dns_name,
        updated_at: new Date().toISOString(),
      });
    }
    const hotspotDestination = hotspotSource ? `${resources.hotspotDirectory}/${sourceNameFromPath(hotspotSource)}` : null;
    const pppoeDestination = pppoeSource ? `${resources.pppoeDirectory}/${sourceNameFromPath(pppoeSource)}` : null;
    for (const directory of [resources.hotspotDirectory, resources.pppoeDirectory]) {
      await runRouterCommand(found.creds, ["/file/make-dir", `=dir-name=${directory}`]).catch(() => undefined);
    }
    if (hotspotSource && hotspotDestination) {
      await deployApprovedSource(found.creds, req, hotspotSource, hotspotDestination);
      const selectedHotspotName = sourceNameFromPath(hotspotSource);
      const companionPortal = selectedHotspotName === "rlogin.html"
        ? getDeployableSource("hotspot", "login.html")
        : getDeployableSource("hotspot", "rlogin.html");
      if (companionPortal) {
        await deployApprovedSource(
          found.creds,
          req,
          companionPortal.source.name,
          `${resources.hotspotDirectory}/${sourceNameFromPath(companionPortal.source.name)}`,
        );
      }
    }
    if (pppoeSource && pppoeDestination) await deployApprovedSource(found.creds, req, pppoeSource, pppoeDestination);
    const hotspotPath = hotspotDestination ? resources.hotspotDirectory : null;
    const pppoePath = pppoeDestination ? resources.pppoeDirectory : null;
    const portalHostname = new URL(requestOrigin(req)).hostname;
    const commands = buildDualServiceCommands(
      deploymentPort,
      hotspotPath,
      pppoePath,
      found.row.bridge_ip || found.row.vpn_ip || "127.0.0.1",
      {
        portalHostname,
        hotspotDnsName: deploymentPort.hotspot_dns_name,
        pppoeDnsName: deploymentPort.pppoe_dns_name,
        companyName: identity.companyName,
        routerName: identity.routerName,
        paymentHostnames: [...PAYMENT_WALLED_GARDEN_HOSTNAMES],
      },
    );
    for (const command of commands) await executeIdempotentRouterCommand(found.creds, command);
    const scriptPayload = [
      `# ${resources.resourceName} dual-service deployment for ${port.interface_name}`,
      ...commands.map(([path, ...args]) => `${path.replaceAll("/", " ")} ${args.join(" ")}`),
    ].join("\n");
    await updatePortProvisioningState(port, "active");
    res.status(201).json({ ok: true, portId: port.id, hotspotDestination, pppoeDestination, scriptPayload });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Dual-service deployment failed.";
    const port = res.locals.resellerPort as PortServiceRow | undefined;
    if (port) {
      try {
        await updatePortProvisioningState(port, "failed", errorMessage);
      } catch (stateError) {
        logger.error({ err: stateError, portId: port.id, deploymentError: errorMessage }, "[port-services] failed to persist provisioning error");
      }
    }
    res.status(502).json({ ok: false, error: errorMessage });
  }
});

router.get("/admin/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await authenticatedAccount(req);
    if (!account) {
      res.status(403).json({ ok: false, error: "A valid signed-in account is required." });
      return;
    }
    const rows = await sbSelectStrict<{ id: number; gateway_type: string; is_active: boolean; updated_at: string }>(
      "payment_gateways",
      `user_id=eq.${account.id}&select=id,gateway_type,is_active,updated_at&order=gateway_type.asc`,
    );
    res.json({ ok: true, gateways: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load payment gateways." });
  }
});

router.put("/admin/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await authenticatedAccount(req);
    const gatewayType = typeof req.body?.gatewayType === "string" ? req.body.gatewayType.trim().toLowerCase() : "";
    const config = req.body?.config;
    if (!account || !["stripe", "paypal", "mpesa"].includes(gatewayType) || !config || typeof config !== "object" || Array.isArray(config)) {
      res.status(400).json({ ok: false, error: "Choose Stripe, PayPal, or M-Pesa and provide gateway credentials." });
      return;
    }
    const cleanConfig = Object.fromEntries(Object.entries(config as Record<string, unknown>)
      .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && typeof value === "string")
      .map(([key, value]) => [key, String(value).slice(0, 500)]));
    await sbUpsertStrict("payment_gateways", "user_id,gateway_type", {
      user_id: account.id,
      gateway_type: gatewayType,
      api_keys_json: JSON.stringify(encryptVpnSecret(JSON.stringify(cleanConfig))),
      is_active: req.body?.isActive !== false,
      updated_at: new Date().toISOString(),
    });
    res.json({ ok: true, gateway: { gatewayType, isActive: req.body?.isActive !== false } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save payment gateway." });
  }
});

export default router;