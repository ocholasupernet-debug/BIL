import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbRpc,
  sbUpdateStrict,
  sbUpsertStrict,
} from "../lib/supabase-client.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { reconcilePppoeUserAccess, runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { deployRouterFile } from "../lib/mikrotik.js";
import { getDeployableSource } from "../lib/portal-assets.js";
import { logger } from "../lib/logger.js";
import { portServiceResourceNames, vlanServicePoolRanges } from "../lib/port-service-resources.js";
import { RESERVED_SUBDOMAINS, TENANT_BASE_DOMAIN } from "../lib/tenant-host.js";
import {
  cleanGatewayConfig,
  decryptGatewayConfig,
  encryptGatewayConfig,
  gatewayConfigPreview,
  bankBusinessNumberFor,
  isResellerGatewayId,
  resolveResellerGatewayRoute,
  resellerGatewayScope,
  type ResellerGatewayRouteRow,
} from "../lib/reseller-payment-gateway.js";
import {
  compileResellerActivation,
  compileResellerPaymentNoticeNatComment,
  compileResellerSuspension,
} from "../services/scriptCompiler.js";

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
  ros_version?: string | number | null;
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
  hotspot_dns_name?: string | null;
  pppoe_enabled: boolean;
  pppoe_dns_name?: string | null;
  subnet_range: string | null;
  bandwidth_cap_mbps: number;
  reseller_bandwidth_cap?: number | null;
  assigned_reseller_id?: number | null;
  link_status?: "pending" | "active" | "suspended" | null;
  vlan_tag?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  handoff_type?: "physical" | "vlan" | null;
  xpon_identifier?: string | null;
  link_detected?: boolean | null;
  last_link_checked_at?: string | null;
  link_detection_error?: string | null;
  link_provisioning_error?: string | null;
  status: string;
  provisioning_error: string | null;
  router?: { id: number; name: string; host: string; vpn_ip: string | null };
};

type ResellerCustomerMetricRow = {
  id: number;
  type: string | null;
  status: string | null;
  expires_at: string | null;
  created_at: string;
  name: string | null;
  username: string | null;
  data_used_mb: number | string | null;
  data_used_bytes: number | string | null;
};

type ResellerAccountRow = {
  id: number;
  name: string;
  company_name?: string | null;
  username: string;
  email?: string | null;
  phone?: string | null;
  subdomain?: string | null;
  status?: string | null;
  is_active: boolean;
  created_at: string;
};

type ResellerConnectionRequestRow = {
  id: number;
  reseller_id: number;
  isp_admin_id: number;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

type ResellerPortalSourceEntry = {
  content: Buffer;
  expiresAt: number;
};

const resellerPortalSourceEntries = new Map<string, ResellerPortalSourceEntry>();
const RESELLER_PORTAL_SOURCE_TTL_MS = 5 * 60 * 1000;

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
      .map((row) => row.subnet_range?.match(/^192\.168\.(18[4-7])\.0\/24$/)?.[1])
      .filter((octet): octet is string => Boolean(octet))
      .map(Number),
  );
  // The legacy service bridge owns 192.168.180.0/22. VLAN services must
  // be allocated outside that aggregate or they will share the gateway.
  for (let octet = 184; octet <= 187; octet += 1) {
    if (!used.has(octet)) return `192.168.${octet}.0/24`;
  }
  throw new Error("No isolated /24 network remains inside 192.168.184.0/22 for this router.");
}

function requestHostname(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  return new URL(`${protocol}://${req.get("host")}`).hostname;
}

function requestOrigin(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function resellerSubdomainBase(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  return !base || RESERVED_SUBDOMAINS.has(base) ? "reseller" : base;
}

async function nextResellerSubdomain(values: string[]): Promise<string> {
  const rows = await sbSelectStrict<{ subdomain: string | null }>(
    "isp_admins",
    "subdomain=not.is.null&select=subdomain&limit=5000",
  );
  const used = new Set(rows.map((row) => String(row.subdomain ?? "").trim().toLowerCase()).filter(Boolean));
  const base = resellerSubdomainBase(values.find((value) => value.trim()) ?? "reseller");
  let candidate = base;
  for (let suffix = 2; used.has(candidate) || RESERVED_SUBDOMAINS.has(candidate); suffix += 1) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 63 - suffixText.length)}${suffixText}`;
  }
  return candidate;
}

function resellerTenantOrigin(subdomain: string | null | undefined): string | null {
  const value = String(subdomain ?? "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) || RESERVED_SUBDOMAINS.has(value)) {
    return null;
  }
  return `https://${value}.${TENANT_BASE_DOMAIN}`;
}

function validPortalHostname(value: unknown): string | null {
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

function validInterface(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.trim())
    && value.trim().length <= 64;
}

function validRouterResourceName(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.trim());
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

function vlanServiceSegment(port: Pick<ResellerPortRow, "reseller_id" | "vlan_tag">): string {
  return safeSegment(`RS${port.reseller_id}_VLAN${port.vlan_tag ?? "0"}`, `RS${port.reseller_id}_VLAN`);
}

function vlanServiceInterfaceName(port: Pick<ResellerPortRow, "reseller_id" | "vlan_tag"> & { username?: string | null }): string {
  const fallback = `OCHOLA_RS${port.reseller_id}_VLAN${port.vlan_tag ?? "0"}`;
  return safeSegment(port.username?.trim() || fallback, safeSegment(fallback, "OCHOLA_RESELLER_VLAN"));
}

function vlanServiceResources(port: Pick<ResellerPortRow, "interface_name" | "bridge_name" | "reseller_id" | "vlan_tag">) {
  const legacyRecord = Boolean(port.bridge_name?.startsWith("OCHOLA_RS")) && !port.interface_name.startsWith("OCHOLA_RS");
  return {
    parentBridge: (legacyRecord ? port.interface_name : port.bridge_name) || "",
    vlanInterface: legacyRecord
      ? port.bridge_name || vlanServiceInterfaceName(port)
      : port.interface_name || vlanServiceInterfaceName(port),
  };
}

function routerScriptValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function deployDefaultResellerPortalFile(
  creds: RouterCredentials,
  sourceOrigin: string,
  apiOrigin: string,
  sourceName: "login.html" | "rlogin.html",
  destinationPath: string,
  scope?: {
    adminId: number;
    routerId: number;
    portId: number;
    plans: Array<{
      id: number;
      name: string;
      price: number | string;
      validity: number;
      validity_unit: string;
    }>;
  },
): Promise<void> {
  const source = getDeployableSource("hotspot", sourceName);
  if (!source) throw new Error(`The default reseller portal asset "${sourceName}" is unavailable.`);
  let content = source.content;
  if (scope && sourceName === "login.html") {
    const config = JSON.stringify({
      apiBase: apiOrigin,
      adminId: scope.adminId,
      routerId: scope.routerId,
      portId: scope.portId,
      plans: scope.plans,
    }).replace(/</g, "\\u003c");
    const bootstrap = `<script>window.__HOTSPOT_CONFIG__=${config};</script>`;
    const html = source.content.toString("utf8");
    const existingConfig = /<script>window\.__HOTSPOT_CONFIG__\s*=[\s\S]*?<\/script>/;
    content = Buffer.from(
      existingConfig.test(html)
        ? html.replace(existingConfig, bootstrap)
        : html.replace("</head>", `${bootstrap}\n</head>`),
      "utf8",
    );
  }
  const token = randomBytes(24).toString("hex");
  resellerPortalSourceEntries.set(token, {
    content,
    expiresAt: Date.now() + RESELLER_PORTAL_SOURCE_TTL_MS,
  });
  try {
    await deployRouterFile(creds, {
      destinationPath,
      sourceUrl: `${sourceOrigin}/api/reseller-portal-source/${token}`,
      overwrite: true,
      uploadId: token.slice(0, 16),
    });
  } finally {
    resellerPortalSourceEntries.delete(token);
  }
}

router.get("/reseller-portal-source/:token", (req, res): void => {
  const token = String(req.params.token);
  const entry = resellerPortalSourceEntries.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    resellerPortalSourceEntries.delete(token);
    res.status(404).end();
    return;
  }
  resellerPortalSourceEntries.delete(token);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", String(entry.content.length));
  res.setHeader("Cache-Control", "no-store");
  res.send(entry.content);
});

function buildVlanInterfaceScript(
  port: Pick<ResellerPortRow, "interface_name" | "bridge_name" | "reseller_id" | "vlan_tag">,
): string {
  const resources = vlanServiceResources(port);
  const vlanTag = Number(port.vlan_tag);
  if (!validInterface(resources.parentBridge) || !validRouterResourceName(resources.vlanInterface) || !Number.isSafeInteger(vlanTag) || vlanTag < 1 || vlanTag > 4094) {
    throw new Error("This VLAN assignment does not have valid RouterOS interface details.");
  }
  return [
    "# OcholaSupernet reseller VLAN interface",
    "# Run on the ISP MikroTik. The service itself remains controlled by the ISP account.",
    `:local parentBridge "${routerScriptValue(resources.parentBridge)}";`,
    `:local vlanName "${routerScriptValue(resources.vlanInterface)}";`,
    `:local vlanId ${vlanTag};`,
    `:if ([:len [/interface vlan find where name=$vlanName]] = 0) do={`,
    "  /interface vlan add name=$vlanName vlan-id=$vlanId interface=$parentBridge comment=\"OcholaSupernet reseller VLAN\";",
    "} else={",
    "  :local vlanRef [/interface vlan find where name=$vlanName];",
    "  /interface vlan set $vlanRef vlan-id=$vlanId interface=$parentBridge disabled=no;",
    "}",
    ":put (\"Ready: \" . $vlanName . \" on \" . $parentBridge . \" with VLAN \" . $vlanId);",
    "",
  ].join("\n");
}

async function provisionVlanResellerServices(
  target: RouterRow,
  port: ResellerPortRow,
  warningHostname: string,
  sourceOrigin: string,
): Promise<void> {
  const tag = Number(port.vlan_tag);
  if (!Number.isSafeInteger(tag) || tag < 1 || tag > 4094) {
    throw new Error("A VLAN service assignment requires a VLAN ID between 1 and 4094.");
  }
  const { parentBridge: bridge, vlanInterface } = vlanServiceResources(port);
  if (!validInterface(bridge)) {
    throw new Error("The VLAN assignment is missing its parent ISP Hotspot bridge.");
  }
  const segment = vlanServiceSegment(port);
  const resellerRows = await sbSelectStrict<{ subdomain: string | null }>(
    "isp_admins",
    `id=eq.${port.assigned_reseller_id ?? port.reseller_id}&parent_id=eq.${port.admin_id}&role=eq.reseller&select=subdomain&limit=1`,
  );
  const apiOrigin = resellerTenantOrigin(resellerRows[0]?.subdomain) ?? sourceOrigin;
  const network = portServiceNetwork(port.id, port.subnet_range || "");
  const resources = portServiceResourceNames({
    id: port.id,
    router_id: port.router_id,
    interface_name: port.interface_name,
    bridge_name: port.bridge_name,
    handoff_mode: "vlan_services",
    reseller_id: port.reseller_id,
    assigned_reseller_id: port.assigned_reseller_id,
    vlan_tag: port.vlan_tag,
  });
  const hotspotDnsName = validPortalHostname(port.hotspot_dns_name) ?? resources.defaultDnsName;
  const defaults = vlanServicePoolRanges(port.subnet_range);
  const poolRows = await sbSelectStrict<{ name: string; range_start: string; range_end: string }>(
    "isp_ip_pools",
    `admin_id=eq.${port.admin_id}&router_id=eq.${port.router_id}&port_id=eq.${port.id}&name=in.(${encodeURIComponent(resources.hotspotPool)},${encodeURIComponent(resources.pppoePool)})&select=name,range_start,range_end`,
  );
  const pools = new Map(poolRows.map(row => [row.name, `${row.range_start}-${row.range_end}`]));
  const hotspotPool = pools.get(resources.hotspotPool) || defaults.hotspot;
  const pppoePool = pools.get(resources.pppoePool) || defaults.pppoe;
  for (const [name, range] of [[resources.hotspotPool, hotspotPool], [resources.pppoePool, pppoePool]] as const) {
    if (!pools.has(name)) {
      const [rangeStart, rangeEnd] = range.split("-");
      await sbInsertStrict("isp_ip_pools", {
        admin_id: port.admin_id,
        router_id: port.router_id,
        port_id: port.id,
        name,
        range_start: rangeStart,
        range_end: rangeEnd,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }
  const creds = routerCredentials(target);
  const commentPrefix = `OcholaSupernet_${segment}`;
  const existingInterfaces = await runRouterCommand(creds, [
    "/interface/print",
    "=.proplist=name,type",
    `?name=${bridge}`,
  ]);
  const bridgeRow = Array.isArray(existingInterfaces)
    ? existingInterfaces.find((row) => String((row as Record<string, unknown>).name ?? "") === bridge)
    : undefined;
  if (!bridgeRow || String((bridgeRow as Record<string, unknown>).type ?? "").toLowerCase() !== "bridge") {
    throw new Error("Choose an existing ISP Hotspot bridge for the reseller VLAN service.");
  }

  const vlanRows = await runRouterCommand(creds, [
    "/interface/vlan/print",
    "=.proplist=.id,name,vlan-id,interface",
    `?name=${vlanInterface}`,
  ]);
  const vlanRow = Array.isArray(vlanRows) ? vlanRows[0] as Record<string, unknown> | undefined : undefined;
  if (vlanRow) {
    if (String(vlanRow["vlan-id"] ?? "") !== String(tag) || String(vlanRow.interface ?? "") !== bridge) {
      throw new Error(`VLAN interface ${vlanInterface} already belongs to another VLAN or bridge.`);
    }
  } else {
    await runRouterCommand(creds, [
      "/interface/vlan/add",
      `=name=${vlanInterface}`,
      `=vlan-id=${tag}`,
      `=interface=${bridge}`,
      `=comment=${commentPrefix}_vlan`,
    ]);
  }

  const ensureNamed = async (
    printPath: string,
    name: string,
    addCommand: string[],
  ): Promise<void> => {
    const rows = await runRouterCommand(creds, [printPath, "=.proplist=.id,name", `?name=${name}`]);
    if (!Array.isArray(rows) || !rows.some((row) => String((row as Record<string, unknown>).name ?? "") === name)) {
      await runRouterCommand(creds, addCommand);
    }
  };

  const gateway = network.gateway;
  const addressRows = await runRouterCommand(creds, [
    "/ip/address/print",
    "=.proplist=.id,address,interface,comment",
    `?comment=${commentPrefix}_gateway`,
  ]);
  const gatewayAddress = `${gateway}/24`;
  const existingGatewayRows = await runRouterCommand(creds, [
    "/ip/address/print",
    "=.proplist=.id,address,interface,comment",
    `?address=${gatewayAddress}`,
  ]);
  const existingGateway = Array.isArray(existingGatewayRows)
    ? existingGatewayRows.find((row) => String((row as Record<string, unknown>).address ?? "") === gatewayAddress) as Record<string, unknown> | undefined
    : undefined;
  if (existingGateway && String(existingGateway.interface ?? "") !== vlanInterface) {
    throw new Error(`The reseller gateway ${gatewayAddress} already belongs to interface ${String(existingGateway.interface ?? "another interface")}, not ${vlanInterface}.`);
  }
  if (!existingGateway && (!Array.isArray(addressRows) || !addressRows.length)) {
    await runRouterCommand(creds, [
      "/ip/address/add",
      `=address=${gatewayAddress}`,
      `=interface=${vlanInterface}`,
      `=comment=${commentPrefix}_gateway`,
    ]);
  } else if (existingGateway?.[".id"] && String(existingGateway.comment ?? "") !== `${commentPrefix}_gateway`) {
    await runRouterCommand(creds, [
      "/ip/address/set",
      `=.id=${existingGateway[".id"]}`,
      `=comment=${commentPrefix}_gateway`,
    ]);
  }
  await ensureNamed("/ip/pool/print", resources.hotspotPool, [
    "/ip/pool/add",
    `=name=${resources.hotspotPool}`,
    `=ranges=${hotspotPool}`,
    `=comment=${commentPrefix}_hotspot_pool`,
  ]);
  await ensureNamed("/ip/pool/print", resources.pppoePool, [
    "/ip/pool/add",
    `=name=${resources.pppoePool}`,
    `=ranges=${pppoePool}`,
    `=comment=${commentPrefix}_pppoe_pool`,
  ]);
  const dhcpNetworkRows = await runRouterCommand(creds, [
    "/ip/dhcp-server/network/print",
    "=.proplist=.id,address",
    `?address=${network.network}`,
  ]);
  if (!Array.isArray(dhcpNetworkRows) || !dhcpNetworkRows.length) {
    await runRouterCommand(creds, [
      "/ip/dhcp-server/network/add",
      `=address=${network.network}`,
      `=gateway=${gateway}`,
      `=dns-server=${gateway}`,
      `=comment=${commentPrefix}_hotspot_network`,
    ]);
  }
  await runRouterCommand(creds, [
    "/file/make-dir",
    `=dir-name=${resources.hotspotDirectory}`,
  ]).catch(() => undefined);
  for (const sourceName of ["login.html", "rlogin.html"] as const) {
    const destinationPath = `${resources.hotspotDirectory}/${sourceName}`;
    await deployDefaultResellerPortalFile(
      creds,
      sourceOrigin,
      apiOrigin,
      sourceName,
      destinationPath,
      sourceName === "login.html"
        ? {
          adminId: port.admin_id,
          routerId: port.router_id,
          portId: port.id,
          plans: (await sbSelectStrict<{
            id: number;
            name: string;
            price: number | string;
            validity: number;
            validity_unit: string;
          }>(
            "isp_plans",
            `admin_id=eq.${port.admin_id}&router_id=eq.${port.router_id}&port_id=eq.${port.id}&type=in.(hotspot,trials,trial)&is_active=is.true&client_can_purchase=is.true&select=id,name,price,validity,validity_unit&order=price.asc,name.asc`,
          )).map(plan => ({
            ...plan,
            price: Number(plan.price),
          })),
        }
        : undefined,
    );
  }
  await ensureNamed("/ip/dhcp-server/print", resources.hotspotDhcp, [
    "/ip/dhcp-server/add",
    `=name=${resources.hotspotDhcp}`,
    `=interface=${vlanInterface}`,
    `=address-pool=${resources.hotspotPool}`,
    "=disabled=no",
  ]);
  await ensureNamed("/ip/hotspot/profile/print", resources.hotspotProfile, [
    "/ip/hotspot/profile/add",
    `=name=${resources.hotspotProfile}`,
    `=hotspot-address=${gateway}`,
    `=html-directory=${resources.hotspotDirectory}`,
    `=dns-name=${hotspotDnsName}`,
    "=login-by=http-chap,http-pap,cookie",
  ]);
  await ensureNamed("/ip/dns/static/print", hotspotDnsName, [
    "/ip/dns/static/add",
    `=name=${hotspotDnsName}`,
    `=address=${gateway}`,
    `=comment=${commentPrefix}_hotspot_dns`,
  ]);
  await ensureNamed("/ip/hotspot/print", resources.hotspotServer, [
    "/ip/hotspot/add",
    `=name=${resources.hotspotServer}`,
    `=interface=${vlanInterface}`,
    `=profile=${resources.hotspotProfile}`,
    `=address-pool=${resources.hotspotPool}`,
    "=disabled=no",
  ]);
  const gardenRows = await runRouterCommand(creds, [
    "/ip/hotspot/walled-garden/ip/print",
    "=.proplist=comment",
  ]);
  for (const [hostname, suffix] of [
    [warningHostname, "walled_garden"],
    [hotspotDnsName, "hotspot_dns_walled_garden"],
  ] as const) {
    if (hostname && (!Array.isArray(gardenRows) || !gardenRows.some((row) => String((row as Record<string, unknown>).comment ?? "") === `${commentPrefix}_${suffix}`))) {
      await runRouterCommand(creds, [
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${hostname}`,
        "=action=accept",
        `=comment=${commentPrefix}_${suffix}`,
      ]);
    }
  }
  const natRows = await runRouterCommand(creds, [
    "/ip/firewall/nat/print",
    "=.proplist=comment",
    `?comment=${commentPrefix}_hotspot_nat`,
  ]);
  if (!Array.isArray(natRows) || !natRows.length) {
    await runRouterCommand(creds, [
      "/ip/firewall/nat/add",
      "=chain=srcnat",
      "=action=masquerade",
      `=src-address=${network.network}`,
      "=out-interface-list=WAN",
      `=comment=${commentPrefix}_hotspot_nat`,
    ]);
  }
  await ensureNamed("/ppp/profile/print", resources.pppoeProfile, [
    "/ppp/profile/add",
    `=name=${resources.pppoeProfile}`,
    `=local-address=${gateway}`,
    `=remote-address=${resources.pppoePool}`,
    `=dns-server=${gateway},8.8.8.8`,
    "=only-one=yes",
    "=change-tcp-mss=yes",
    `=comment=${commentPrefix}_pppoe_profile`,
  ]);
  const pppoeRows = await runRouterCommand(creds, [
    "/interface/pppoe-server/server/print",
    "=.proplist=.id,service-name",
    `?service-name=${resources.pppoeService}`,
  ]);
  const pppoeRow = Array.isArray(pppoeRows) ? pppoeRows[0] as Record<string, unknown> | undefined : undefined;
  const pppoeFields = [
    `=interface=${vlanInterface}`,
    `=default-profile=${resources.pppoeProfile}`,
    "=one-session-per-host=yes",
    "=disabled=no",
  ];
  if (pppoeRow?.[".id"]) {
    await runRouterCommand(creds, ["/interface/pppoe-server/server/set", `=.id=${pppoeRow[".id"]}`, ...pppoeFields]);
  } else {
    await runRouterCommand(creds, [
      "/interface/pppoe-server/server/add",
      `=service-name=${resources.pppoeService}`,
      ...pppoeFields,
      /* RouterOS 6 has no comment property on PPPoE server entries. */
    ]);
  }
  await runRouterCommand(creds, [
    "/queue/simple/add",
    `=name=${resources.parentQueue}`,
    `=target=${vlanInterface}`,
    `=max-limit=${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M/${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M`,
    "=priority=2/2",
    `=comment=${commentPrefix}_root_queue`,
  ]).catch(async (error) => {
    const rows = await runRouterCommand(creds, ["/queue/simple/print", "=.proplist=.id", `?name=${resources.parentQueue}`]);
    const id = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined)?.[".id"] : undefined;
    if (id) await runRouterCommand(creds, ["/queue/simple/set", `=.id=${id}`, `=target=${vlanInterface}`, `=max-limit=${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M/${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M`, "=disabled=no"]);
    else throw error;
  });
}

async function currentAccount(req: Request) {
  const account = await authenticatedAccount(req);
  if (!account) throw new Error("Signed-in account was not found.");
  return account;
}

async function tenantRouter(adminId: number, routerId: number): Promise<RouterRow> {
  const rows = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,vpn_ip,router_username,router_secret,api_port,api_use_ssl,ros_version&limit=1`,
  );
  if (!rows[0]) throw new Error("Router not found for this ISP account.");
  return rows[0];
}

async function resellerCanUseIsp(
  resellerId: number,
  parentId: number | null | undefined,
  ispAdminId: number,
): Promise<boolean> {
  if (parentId === ispAdminId) return true;
  const approved = await sbSelectStrict<{ id: number }>(
    "isp_reseller_connection_requests",
    `reseller_id=eq.${resellerId}&isp_admin_id=eq.${ispAdminId}&status=eq.approved&select=id&limit=1`,
  );
  return Boolean(approved[0]);
}

async function detectRouterInterfaceLink(
  target: RouterRow,
  interfaceName: string,
): Promise<{ exists: boolean; running: boolean; disabled: boolean; type: string; macAddress: string; error: string | null }> {
  try {
    const rows = await runRouterCommand(routerCredentials(target), [
      "/interface/print",
      "=.proplist=name,type,running,disabled,mac-address",
      `?name=${interfaceName}`,
    ]);
    const row = Array.isArray(rows)
      ? rows.find((item) => String((item as Record<string, unknown>).name ?? "") === interfaceName) as Record<string, unknown> | undefined
      : undefined;
    if (!row) {
      return { exists: false, running: false, disabled: false, type: "", macAddress: "", error: "The selected interface was not found on the ISP router." };
    }
    return {
      exists: true,
      running: String(row.running ?? "").toLowerCase() === "true",
      disabled: String(row.disabled ?? "").toLowerCase() === "true",
      type: String(row.type ?? ""),
      macAddress: String(row["mac-address"] ?? ""),
      error: null,
    };
  } catch (error) {
    return {
      exists: false,
      running: false,
      disabled: false,
      type: "",
      macAddress: "",
      error: error instanceof Error ? error.message.slice(0, 500) : "The ISP router link could not be checked.",
    };
  }
}

function routerResourceId(row: Record<string, unknown>): string {
  return typeof row[".id"] === "string" ? row[".id"] : "";
}

type RouterResourceRow = Record<string, string>;

async function removeVlanResourceRows(
  creds: RouterCredentials,
  printPath: string,
  proplist: string,
  matches: (row: RouterResourceRow) => boolean,
): Promise<void> {
  const rows = await runRouterCommand(creds, [printPath, `=.proplist=${proplist}`]);
  const removePath = printPath.replace(/\/print$/, "/remove");
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row[".id"] && matches(row as RouterResourceRow)) {
      await runRouterCommand(creds, [removePath, `=.id=${row[".id"]}`]);
    }
  }
}

async function removeVlanResellerServices(
  target: RouterRow,
  port: ResellerPortRow,
): Promise<void> {
  const resources = portServiceResourceNames({
    id: port.id,
    router_id: port.router_id,
    interface_name: port.interface_name,
    bridge_name: port.bridge_name,
    handoff_mode: "vlan_services",
    reseller_id: port.reseller_id,
    assigned_reseller_id: port.assigned_reseller_id,
    vlan_tag: port.vlan_tag,
  });
  const vlanInterface = vlanServiceResources(port).vlanInterface;
  const ownedComment = (row: RouterResourceRow) =>
    String(row.comment ?? "").startsWith(`${resources.commentPrefix}_`);
  const creds = routerCredentials(target);

  // Remove dependants first. Never remove the ISP-owned parent bridge.
  await removeVlanResourceRows(creds, "/interface/pppoe-server/server/print", ".id,service-name,comment", row =>
    row["service-name"] === resources.pppoeService && ownedComment(row));
  await removeVlanResourceRows(creds, "/ip/hotspot/print", ".id,name,comment", row =>
    row.name === resources.hotspotServer && ownedComment(row));
  await removeVlanResourceRows(creds, "/ip/dhcp-server/print", ".id,name,interface,comment", row =>
    row.name === resources.hotspotDhcp && row.interface === vlanInterface && (ownedComment(row) || !row.comment));
  await removeVlanResourceRows(creds, "/queue/simple/print", ".id,name,comment", ownedComment);
  await removeVlanResourceRows(creds, "/ip/firewall/nat/print", ".id,comment", ownedComment);
  await removeVlanResourceRows(creds, "/ip/hotspot/walled-garden/ip/print", ".id,comment", ownedComment);
  await removeVlanResourceRows(creds, "/ip/hotspot/profile/print", ".id,name,comment", row =>
    [resources.hotspotProfile, resources.pppoeProfile].includes(row.name) && (ownedComment(row) || !row.comment));
  await removeVlanResourceRows(creds, "/ip/address/print", ".id,comment", ownedComment);
  await removeVlanResourceRows(creds, "/ip/dhcp-server/network/print", ".id,comment", ownedComment);
  await removeVlanResourceRows(creds, "/ip/pool/print", ".id,name,comment", row =>
    [resources.hotspotPool, resources.pppoePool].includes(row.name) && (ownedComment(row) || !row.comment));
  await removeVlanResourceRows(creds, "/interface/vlan/print", ".id,name,comment", row =>
    row.name === vlanInterface && (ownedComment(row) || !row.comment));
}

async function deployServicesProvisionLayer(
  router: RouterRow,
  port: ResellerPortRow,
  linkStatus: "active" | "suspended",
  capMbps: number,
  warningHostname: string,
): Promise<void> {
  const creds = routerCredentials(router);
  const portSegment = port.handoff_mode === "vlan_services"
    ? vlanServiceSegment(port)
    : safeSegment(port.interface_name, `PORT_${port.id}`);
  const parentQueue = `RESELLER_ROOT_${portSegment}`;
  const queueRows = await runRouterCommand(creds, [
    "/queue/simple/print",
    "=.proplist=.id,name,comment",
    `?name=${parentQueue}`,
  ]);
  const queueId = Array.isArray(queueRows)
    ? routerResourceId((queueRows[0] ?? {}) as Record<string, unknown>)
    : "";
  if (queueId) {
    await runRouterCommand(creds, ["/queue/simple/remove", `=.id=${queueId}`]);
  }

  const targetName = port.handoff_mode === "vlan_services"
    ? vlanServiceResources(port).vlanInterface
    : port.bridge_name || port.interface_name;
  const scriptBlock = linkStatus === "active"
    ? compileResellerActivation(
      port.interface_name,
      Math.round(capMbps),
      router.ros_version,
      targetName,
    )
    : compileResellerSuspension(port.interface_name, router.ros_version, targetName);

  const noticeComment = compileResellerPaymentNoticeNatComment(port.interface_name);
  const natRows = await runRouterCommand(creds, [
    "/ip/firewall/nat/print",
    "=.proplist=.id,comment",
    `?comment=${noticeComment}`,
  ]);
  for (const row of Array.isArray(natRows) ? natRows : []) {
    const id = routerResourceId(row);
    if (id) {
      await runRouterCommand(creds, ["/ip/firewall/nat/remove", `=.id=${id}`]);
    }
  }

  for (const command of scriptBlock.commands) {
    await runRouterCommand(creds, command);
  }

  if (port.hotspot_enabled) {
    const hotspotName = port.handoff_mode === "vlan_services"
      ? `HS_${portSegment}`
      : `reseller_${port.reseller_id}_${portSegment}`;
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
  const tenantFilter = account.role === "reseller"
    ? ""
    : tier === "system_admin" && req.query.adminId && /^\d+$/.test(String(req.query.adminId))
    ? `&admin_id=eq.${Number(req.query.adminId)}`
    : `&admin_id=eq.${tenantId}`;
  const rows = await sbSelectStrict<ResellerPortRow>(
    "isp_reseller_ports",
    `id=eq.${portId}${tenantFilter}${resellerFilter}&select=*&limit=1`,
  );
  if (!rows[0]) throw new Error("This port is not assigned to your account.");
  if (account.role === "reseller" && !(await resellerCanUseIsp(account.id, account.parent_id, rows[0].admin_id))) {
    throw new Error("This port belongs to an ISP connection that has not approved your reseller account.");
  }
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
      `parent_id=eq.${account.id}&role=eq.reseller&select=id,name,company_name,username,email,phone,subdomain,is_active,status,earnings_balance,created_at&order=created_at.desc`,
    );
    const ports = await sbSelectStrict(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&select=id,reseller_id,assigned_reseller_id,router_id,interface_name,vlan_tag,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,reseller_bandwidth_cap,status,link_status,handoff_mode,handoff_type,xpon_identifier,link_detected,last_link_checked_at,link_detection_error,provisioning_error,link_provisioning_error&order=created_at.desc`,
    );
    res.json({ ok: true, resellers: rows, ports });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load resellers." });
  }
});

router.get("/admin/dashboard/reseller-summary", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot view ISP reseller totals." });
      return;
    }
    const [resellers, ports] = await Promise.all([
      sbSelectStrict<{ id: number; is_active: boolean; status: string | null }>(
        "isp_admins",
        `parent_id=eq.${account.id}&role=eq.reseller&select=id,is_active,status&limit=1000`,
      ),
      sbSelectStrict<Pick<ResellerPortRow, "assigned_reseller_id" | "reseller_id" | "status" | "link_status" | "link_detected">>(
        "isp_reseller_ports",
        `admin_id=eq.${account.id}&status=neq.disabled&select=assigned_reseller_id,reseller_id,status,link_status,link_detected&limit=1000`,
      ),
    ]);
    const activeIds = new Set(
      resellers
        .filter((reseller) => reseller.is_active && String(reseller.status ?? "").toLowerCase() === "active")
        .map((reseller) => reseller.id),
    );
    const onlineIds = new Set(
      ports
        .filter((port) => {
          const resellerId = port.assigned_reseller_id ?? port.reseller_id;
          return resellerId && activeIds.has(resellerId)
            && port.status === "active"
            && port.link_status === "active"
            && port.link_detected === true;
        })
        .map((port) => port.assigned_reseller_id ?? port.reseller_id)
        .filter((id): id is number => Number.isSafeInteger(id)),
    );
    res.json({
      ok: true,
      totalResellers: resellers.length,
      activeResellers: activeIds.size,
      onlineResellers: onlineIds.size,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load reseller dashboard totals." });
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

    const child = await sbSelectStrict<{ id: number; status?: string }>(
      "isp_admins",
      `id=eq.${resellerId}&parent_id=eq.${account.id}&role=eq.reseller&is_active=is.true&select=id,status&limit=1`,
    );
    if (!child[0]) {
      res.status(404).json({ ok: false, error: "The reseller does not belong to this ISP account." });
      return;
    }

    const ports = await sbSelectStrict<ResellerPortRow>(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&assigned_reseller_id=eq.${resellerId}&select=*&limit=1000`,
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
    if (port.handoff_mode === "isp_router") {
      const link = await detectRouterInterfaceLink(targetRouter, port.interface_name);
      const checkedAt = new Date().toISOString();
      const effectiveLinkStatus = requestedState === "suspended"
        ? "suspended"
        : link.running ? "active" : "pending";
      const updated = await sbUpdateStrict<ResellerPortRow>(
        "isp_reseller_ports",
        `id=eq.${port.id}&admin_id=eq.${account.id}&assigned_reseller_id=eq.${resellerId}`,
        {
          link_status: effectiveLinkStatus,
          bandwidth_cap_mbps: cap,
          reseller_bandwidth_cap: cap,
          link_detected: link.running,
          last_link_checked_at: checkedAt,
          link_detection_error: link.error,
          link_provisioning_error: null,
          updated_at: checkedAt,
        },
      );
      if (!updated[0]) throw new Error("The ISP router handoff state could not be saved.");
      await sbUpdateStrict(
        "isp_admins",
        `id=eq.${resellerId}&parent_id=eq.${account.id}&role=eq.reseller`,
        {
          status: requestedState === "suspended" ? "suspended_payment_pending" : "active",
          updated_at: checkedAt,
        },
      );
      res.json({
        ok: true,
        link: { ...(updated[0] ?? {}), link_status: effectiveLinkStatus, link_detected: link.running, last_link_checked_at: checkedAt },
        handoffMode: "isp_router",
        message: requestedState === "suspended"
          ? "ISP router handoff suspended."
          : link.running
            ? "ISP router handoff is active and the XPON link is detected."
            : "Handoff is waiting for the XPON router link. Connect the XPON router, then refresh link status.",
      });
      return;
    }
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
    await sbUpdateStrict(
      "isp_admins",
      `id=eq.${resellerId}&parent_id=eq.${account.id}&role=eq.reseller`,
      {
        status: requestedState === "suspended" ? "suspended_payment_pending" : "active",
        updated_at: new Date().toISOString(),
      },
    );

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
      await sbUpdateStrict(
        "isp_admins",
        `id=eq.${resellerId}&parent_id=eq.${account.id}&role=eq.reseller`,
        {
          status: child[0].status || "active",
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
      resellerStatus: requestedState === "suspended" ? "suspended_payment_pending" : "active",
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to update reseller link." });
  }
}

router.post("/admin/reseller-links", requireAdmin(), updateResellerLink);
router.post("/admin/approve-reseller-link", requireAdmin(), updateResellerLink);

/**
 * Carrier-management aliases used by the ISP approval view. Keep these
 * tenant-scoped and route them through the same ownership and RouterOS
 * management-VPN path as the existing reseller controls.
 */
router.get("/isp/pending-resellers", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot approve reseller links." });
      return;
    }

    const [resellers, ports, routers] = await Promise.all([
      sbSelectStrict<ResellerAccountRow>(
        "isp_admins",
        `parent_id=eq.${account.id}&role=eq.reseller&select=id,name,company_name,username,email,status,is_active,created_at&order=created_at.desc`,
      ),
      sbSelectStrict<ResellerPortRow>(
        "isp_reseller_ports",
      `admin_id=eq.${account.id}&select=id,reseller_id,assigned_reseller_id,router_id,interface_name,vlan_tag,bridge_name,bandwidth_cap_mbps,reseller_bandwidth_cap,status,link_status,handoff_mode,handoff_type,xpon_identifier,link_detected,last_link_checked_at,link_detection_error,link_provisioning_error&order=created_at.desc`,
      ),
      sbSelectStrict<{ id: number; name: string; status: string }>(
        "isp_routers",
        `admin_id=eq.${account.id}&select=id,name,status&order=name.asc`,
      ),
    ]);
    const pendingStatuses = new Set(["pending", "awaiting_connection", "awaiting_sync", "awaiting_ports"]);
    const pendingResellers = resellers.filter((reseller) => {
      const assignedPort = ports.find((port) =>
        (port.assigned_reseller_id ?? port.reseller_id) === reseller.id,
      );
      return pendingStatuses.has(String(reseller.status ?? "").toLowerCase())
        || !assignedPort
        || assignedPort.link_status !== "active";
    });
    res.json({
      ok: true,
      resellers,
      pendingResellers,
      ports,
      routers,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load pending reseller links." });
  }
});

router.get("/reseller/connection-options", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "This endpoint is for reseller accounts." });
      return;
    }
    const [isps, requests] = await Promise.all([
      sbSelectStrict<{ id: number; name: string; company_name: string | null; subdomain: string | null }>(
        "isp_admins",
        "role=eq.isp_admin&is_active=is.true&parent_id=is.null&select=id,name,company_name,subdomain&order=company_name.asc,name.asc&limit=500",
      ),
      sbSelectStrict<ResellerConnectionRequestRow>(
        "isp_reseller_connection_requests",
        `reseller_id=eq.${account.id}&select=id,reseller_id,isp_admin_id,note,status,responded_at,created_at,updated_at&order=created_at.desc&limit=50`,
      ),
    ]);
    const connectedIspIds = requests
      .filter((request) => request.status === "approved")
      .map((request) => request.isp_admin_id);
    if (account.parent_id && !connectedIspIds.includes(account.parent_id)) connectedIspIds.push(account.parent_id);
    const connectedIspId = connectedIspIds[0] ?? null;
    res.json({ ok: true, isps, requests, connectedIspId, connectedIspIds });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load ISP connection options." });
  }
});

router.post("/reseller/connection-requests", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can request an ISP connection." });
      return;
    }
    const requestedCompanyName = typeof req.body?.companyName === "string"
      ? req.body.companyName.trim().slice(0, 160)
      : "";
    const ispAdminId = Number(req.body?.ispAdminId);
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
    if ((!Number.isSafeInteger(ispAdminId) || ispAdminId <= 0) && !requestedCompanyName) {
      res.status(400).json({ ok: false, error: "Enter the ISP company name or choose a valid ISP account." });
      return;
    }
    const availableIsps = await sbSelectStrict<{ id: number; name: string; company_name: string | null }>(
      "isp_admins",
      "role=eq.isp_admin&is_active=is.true&parent_id=is.null&select=id,name,company_name&order=company_name.asc,name.asc&limit=500",
    );
    const normalizedCompanyName = requestedCompanyName.toLocaleLowerCase().replace(/\s+/g, " ").trim();
    const ispRows = Number.isSafeInteger(ispAdminId) && ispAdminId > 0
      ? availableIsps.filter((isp) => isp.id === ispAdminId)
      : availableIsps.filter((isp) => {
        const company = String(isp.company_name || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
        const name = String(isp.name || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
        return company === normalizedCompanyName || name === normalizedCompanyName;
      });
    if (!ispRows[0]) {
      res.status(404).json({ ok: false, error: "No active ISP administrator matched that company name." });
      return;
    }
    const selectedIspAdminId = ispRows[0].id;
    const inserted = await sbInsertStrict<ResellerConnectionRequestRow>("isp_reseller_connection_requests", {
      reseller_id: account.id,
      isp_admin_id: selectedIspAdminId,
      note: note || null,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.status(201).json({ ok: true, request: inserted[0] ?? null, isp: ispRows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to send the ISP connection request." });
  }
});

router.get("/isp/reseller-connection-requests", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot review ISP connection requests." });
      return;
    }
    const requests = await sbSelectStrict<ResellerConnectionRequestRow>(
      "isp_reseller_connection_requests",
      `isp_admin_id=eq.${account.id}&select=id,reseller_id,isp_admin_id,note,status,responded_at,created_at,updated_at&order=created_at.desc&limit=100`,
    );
    const resellerIds = [...new Set(requests.map((request) => request.reseller_id))];
    const resellers = resellerIds.length
      ? await sbSelectStrict<ResellerAccountRow>(
        "isp_admins",
        `id=in.(${resellerIds.join(",")})&role=eq.reseller&select=id,name,company_name,username,email,phone,status,is_active,created_at`,
      )
      : [];
    res.json({ ok: true, requests, resellers });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load reseller connection requests." });
  }
});

router.post("/isp/reseller-connection-requests/:requestId", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot approve connection requests." });
      return;
    }
    const requestId = Number(req.params.requestId);
    const action = req.body?.action === "reject" ? "rejected" : req.body?.action === "approve" ? "approved" : "";
    if (!Number.isSafeInteger(requestId) || requestId <= 0 || !action) {
      res.status(400).json({ ok: false, error: "Provide a valid request and choose approve or reject." });
      return;
    }
    if (action === "approved") {
      res.status(409).json({
        ok: false,
        error: "Assign and successfully provision the reseller VLAN before approving this connection.",
      });
      return;
    }
    const requestRows = await sbSelectStrict<ResellerConnectionRequestRow>(
      "isp_reseller_connection_requests",
      `id=eq.${requestId}&isp_admin_id=eq.${account.id}&status=eq.pending&select=id,reseller_id,isp_admin_id,note,status,responded_at,created_at,updated_at&limit=1`,
    );
    const request = requestRows[0];
    if (!request) {
      res.status(404).json({ ok: false, error: "This pending connection request was not found." });
      return;
    }
    const resellerRows = await sbSelectStrict<{
      id: number;
      parent_id: number | null;
      role: string;
      name: string;
      company_name: string | null;
      username: string;
      email: string | null;
      is_active: boolean;
    }>(
      "isp_admins",
      `id=eq.${request.reseller_id}&role=eq.reseller&select=id,parent_id,role,name,company_name,username,email,is_active&limit=1`,
    );
    const reseller = resellerRows[0];
    if (!reseller) {
      res.status(404).json({ ok: false, error: "The requesting reseller account no longer exists." });
      return;
    }
    const now = new Date().toISOString();
    const updated = await sbUpdateStrict<ResellerConnectionRequestRow>(
      "isp_reseller_connection_requests",
      `id=eq.${request.id}&isp_admin_id=eq.${account.id}&status=eq.pending`,
      { status: action, responded_at: now, updated_at: now },
    );
    res.json({
      ok: true,
      request: updated[0] ?? { ...request, status: action, responded_at: now, updated_at: now },
      reseller,
      message: "Reseller connection request rejected.",
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to update the reseller connection request." });
  }
});

/**
 * Attach an approved reseller to an ISP-managed router/XPON handoff. This
 * intentionally does not install RouterOS services, queues, or packages:
 * the ISP router remains responsible for DHCP/PPPoE/NAT and the reseller
 * only connects their XPON/router to the assigned handoff.
 */
router.post("/isp/reseller-connection-requests/:requestId/handoff", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot provision ISP router handoffs." });
      return;
    }
    const requestId = Number(req.params.requestId);
    const routerId = Number(req.body?.routerId);
    const interfaceName = typeof req.body?.interfaceName === "string" ? req.body.interfaceName.trim() : "";
    const bridgeName = typeof req.body?.bridgeName === "string" ? req.body.bridgeName.trim() : "";
    const handoffType = req.body?.handoffType === "vlan" ? "vlan" : "physical";
    const handoffMode = req.body?.handoffMode === "vlan_services" ? "vlan_services" : "isp_router";
    const vlanTag = typeof req.body?.vlanTag === "string" ? req.body.vlanTag.trim() : "";
    const requestedUsername = typeof req.body?.resellerUsername === "string"
      ? req.body.resellerUsername.trim()
      : "";
    const xponIdentifier = typeof req.body?.xponIdentifier === "string"
      ? req.body.xponIdentifier.trim().slice(0, 120)
      : "";
    const cap = Number(req.body?.bandwidthCapMbps);
    if (!Number.isSafeInteger(requestId) || requestId <= 0 || !Number.isSafeInteger(routerId) || routerId <= 0) {
      res.status(400).json({ ok: false, error: "Choose a valid ISP router." });
      return;
    }
    if (handoffMode === "isp_router" && !validInterface(interfaceName)) {
      res.status(400).json({ ok: false, error: "Choose a valid XPON-facing interface." });
      return;
    }
    if (handoffMode === "vlan_services" && !validInterface(bridgeName)) {
      res.status(400).json({ ok: false, error: "Choose a valid ISP Hotspot bridge for the VLAN service." });
      return;
    }
    if (handoffType === "vlan" && (!/^\d{1,4}$/.test(vlanTag) || Number(vlanTag) < 1 || Number(vlanTag) > 4094)) {
      res.status(400).json({ ok: false, error: "Enter a VLAN ID between 1 and 4094 for this handoff." });
      return;
    }
    if (handoffMode === "vlan_services" && handoffType !== "vlan") {
      res.status(400).json({ ok: false, error: "VLAN Hotspot services require a tagged VLAN handoff." });
      return;
    }
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100000) {
      res.status(400).json({ ok: false, error: "The bandwidth cap must be between 1 and 100000 Mbps." });
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(requestedUsername)) {
      res.status(400).json({ ok: false, error: "Use a reseller username with 3-64 letters, numbers, dots, underscores, or hyphens." });
      return;
    }

    const requests = await sbSelectStrict<ResellerConnectionRequestRow>(
      "isp_reseller_connection_requests",
      `id=eq.${requestId}&isp_admin_id=eq.${account.id}&status=in.(pending,approved)&select=id,reseller_id,isp_admin_id,status&limit=1`,
    );
    const request = requests[0];
    if (!request) {
       res.status(404).json({ ok: false, error: "This reseller connection request was not found or is no longer assignable." });
      return;
    }
    const resellerRows = await sbSelectStrict<{ id: number; parent_id: number | null; role: string; company_name: string | null; username: string }>(
      "isp_admins",
      `id=eq.${request.reseller_id}&role=eq.reseller&is_active=is.true&select=id,parent_id,role,company_name,username&limit=1`,
    );
    if (!resellerRows[0]) {
      res.status(409).json({ ok: false, error: "The reseller is no longer connected to this ISP account." });
      return;
    }
    if (request.status === "approved" && !(await resellerCanUseIsp(request.reseller_id, resellerRows[0].parent_id, account.id))) {
      res.status(409).json({ ok: false, error: "Approve the reseller connection before assigning an ISP router handoff." });
      return;
    }
    if (request.status === "pending" && handoffMode !== "vlan_services") {
      res.status(409).json({ ok: false, error: "A pending connection must be approved through successful VLAN service provisioning." });
      return;
    }
    const duplicateUsername = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `id=neq.${request.reseller_id}&parent_id=eq.${account.id}&role=eq.reseller&username=eq.${encodeURIComponent(requestedUsername)}&select=id&limit=1`,
    );
    if (duplicateUsername[0]) {
      res.status(409).json({ ok: false, error: "That reseller username is already in use in this ISP account." });
      return;
    }

    const target = await tenantRouter(account.id, routerId);
    const parentInterface = handoffMode === "vlan_services" ? bridgeName : interfaceName;
    const link = handoffMode === "vlan_services"
      ? await (async () => {
        const interfaces = await runRouterCommand(routerCredentials(target), [
          "/interface/print",
          "=.proplist=name,type,disabled",
          `?name=${parentInterface}`,
        ]);
        const row = Array.isArray(interfaces)
          ? interfaces.find((item) => String((item as Record<string, unknown>).name ?? "") === parentInterface) as Record<string, unknown> | undefined
          : undefined;
        const isBridge = String(row?.type ?? "").toLowerCase() === "bridge";
        return {
          exists: Boolean(row),
          running: isBridge,
          disabled: String(row?.disabled ?? "").toLowerCase() === "true",
          type: String(row?.type ?? ""),
          macAddress: String(row?.["mac-address"] ?? ""),
          error: isBridge ? null : "Choose an existing ISP Hotspot bridge.",
        };
      })()
      : await detectRouterInterfaceLink(target, parentInterface);
    if (!link.exists || link.disabled || (handoffMode === "vlan_services" && link.type.toLowerCase() !== "bridge")) {
      res.status(409).json({ ok: false, error: link.error || "The selected interface is unavailable on the ISP router." });
      return;
    }
    const collisionFilter = handoffType === "vlan"
      ? `&vlan_tag=eq.${encodeURIComponent(vlanTag)}`
      : "&vlan_tag=is.null";
    const collisions = await sbSelectStrict<{ id: number }>(
      "isp_reseller_ports",
      `admin_id=eq.${account.id}&router_id=eq.${routerId}&${handoffMode === "vlan_services" ? `bridge_name=eq.${encodeURIComponent(bridgeName)}&` : `interface_name=eq.${encodeURIComponent(interfaceName)}&`}status=neq.disabled${collisionFilter}&select=id&limit=1`,
    );
    if (collisions[0]) {
      res.status(409).json({ ok: false, error: handoffType === "vlan" ? "That router interface and VLAN is already assigned." : "That physical router interface is already assigned." });
      return;
    }

    const now = new Date().toISOString();
    const provisionalPort = {
      // The real row id is assigned by Postgres after insert. VLAN services
      // already have an allocated /24 here, so provisioning does not need a
      // guessed id for resource identity or subnet selection.
      id: 0,
      admin_id: account.id,
      reseller_id: request.reseller_id,
      assigned_reseller_id: request.reseller_id,
      router_id: routerId,
      interface_name: handoffMode === "vlan_services"
         ? vlanServiceInterfaceName({ reseller_id: request.reseller_id, vlan_tag: vlanTag, username: requestedUsername })
        : interfaceName,
      vlan_tag: handoffType === "vlan" ? vlanTag : null,
      bridge_name: handoffMode === "vlan_services" ? bridgeName : null,
      hotspot_enabled: handoffMode === "vlan_services",
       hotspot_template_path: handoffMode === "vlan_services" ? "login.html" : null,
      pppoe_enabled: handoffMode === "vlan_services",
      subnet_range: handoffMode === "vlan_services"
        ? nextAvailablePortSubnet(await sbSelectStrict<{ subnet_range: string | null }>(
          "isp_reseller_ports",
          `admin_id=eq.${account.id}&router_id=eq.${routerId}&status=neq.disabled&select=subnet_range`,
        ))
        : null,
      bandwidth_cap_mbps: cap,
      reseller_bandwidth_cap: cap,
      status: handoffMode === "vlan_services" ? "pending" : "active",
      provisioning_error: null,
      link_status: "pending" as const,
      handoff_mode: handoffMode as "isp_router" | "vlan_services",
      handoff_type: handoffType as "physical" | "vlan",
      xpon_identifier: xponIdentifier || null,
      link_detected: handoffMode === "vlan_services" ? true : link.running,
      last_link_checked_at: now,
      link_detection_error: null,
      link_provisioning_error: null,
    };
    const inserted = await sbInsertStrict<ResellerPortRow>("isp_reseller_ports", {
      admin_id: account.id,
      reseller_id: request.reseller_id,
      assigned_reseller_id: request.reseller_id,
      router_id: routerId,
      interface_name: provisionalPort.interface_name,
      vlan_tag: handoffType === "vlan" ? vlanTag : null,
      bridge_name: provisionalPort.bridge_name,
      hotspot_enabled: provisionalPort.hotspot_enabled,
      hotspot_template_path: provisionalPort.hotspot_template_path,
      pppoe_enabled: provisionalPort.pppoe_enabled,
      subnet_range: provisionalPort.subnet_range,
      bandwidth_cap_mbps: cap,
      reseller_bandwidth_cap: cap,
      status: provisionalPort.status,
      provisioning_error: null,
      link_status: handoffMode === "vlan_services" ? "active" : link.running ? "active" : "pending",
      link_provisioning_error: null,
      handoff_mode: handoffMode,
      handoff_type: handoffType,
      xpon_identifier: xponIdentifier || null,
      link_detected: handoffMode === "vlan_services" ? true : link.running,
      last_link_checked_at: now,
      link_detection_error: null,
      created_at: now,
      updated_at: now,
    });
    const assignment = inserted[0];
    if (handoffMode === "vlan_services" && assignment) {
      try {
        await provisionVlanResellerServices(target, assignment, requestHostname(req), requestOrigin(req));
      } catch (error) {
        const message = error instanceof Error ? error.message : "VLAN Hotspot service provisioning failed.";
        await sbUpdateStrict("isp_reseller_ports", `id=eq.${assignment.id}&admin_id=eq.${account.id}`, {
          status: "failed",
          link_status: "pending",
          provisioning_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).catch(() => undefined);
        res.status(502).json({ ok: false, error: `The VLAN assignment was saved, but RouterOS services were not applied: ${message}` });
        return;
      }
      try {
        await sbUpdateStrict("isp_reseller_ports", `id=eq.${assignment.id}&admin_id=eq.${account.id}`, {
          status: "active",
          link_status: "active",
          link_provisioning_error: null,
          provisioning_error: null,
          updated_at: new Date().toISOString(),
        });
        const updatedAt = new Date().toISOString();
        await sbUpdateStrict(
          "isp_admins",
          `id=eq.${request.reseller_id}&role=eq.reseller`,
          {
            username: requestedUsername,
            parent_id: account.id,
            status: "active",
            updated_at: updatedAt,
          },
        );
        await sbUpdateStrict(
          "isp_reseller_connection_requests",
          `id=eq.${request.id}&isp_admin_id=eq.${account.id}&status=eq.pending`,
          { status: "approved", responded_at: updatedAt, updated_at: updatedAt },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "VLAN Hotspot service provisioning failed.";
        res.status(502).json({ ok: false, error: `VLAN services were applied, but the approval record could not be finalized: ${message}` });
        return;
      }
    }
    res.status(201).json({
      ok: true,
      handoff: assignment ?? null,
      link: {
        detected: link.running,
         interfaceName: parentInterface,
        interfaceType: link.type,
        macAddress: link.macAddress,
        checkedAt: now,
      },
      message: handoffMode === "vlan_services"
         ? request.status === "pending"
           ? `VLAN ${vlanTag} was pushed directly to the MikroTik with Hotspot and PPPoE services. The reseller connection is now approved.`
           : `VLAN ${vlanTag} was added directly to the MikroTik with Hotspot and PPPoE services.`
        : link.running
          ? "ISP router handoff assigned and the XPON link is detected."
          : "ISP router handoff assigned. Connect the XPON router, then refresh link status.",
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to assign the ISP router handoff." });
  }
});

router.get("/admin/reseller-handoffs/:portId/vlan-script", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Only the ISP administrator can download VLAN setup scripts." });
      return;
    }
    const portId = Number(req.params.portId);
    if (!Number.isSafeInteger(portId) || portId <= 0) {
      res.status(400).json({ ok: false, error: "Choose a valid VLAN assignment." });
      return;
    }
    const rows = await sbSelectStrict<ResellerPortRow>(
      "isp_reseller_ports",
      `id=eq.${portId}&admin_id=eq.${account.id}&handoff_mode=eq.vlan_services&select=id,interface_name,bridge_name,reseller_id,vlan_tag`,
    );
    const port = rows[0];
    if (!port) {
      res.status(404).json({ ok: false, error: "VLAN service assignment not found for this ISP account." });
      return;
    }
    const script = buildVlanInterfaceScript(port);
    const filename = `${vlanServiceResources(port).vlanInterface.toLowerCase()}-interface.rsc`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(script);
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to generate the VLAN interface script." });
  }
});

router.post("/isp/reseller-connection-requests/:requestId/vlan-script", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Only the ISP administrator can generate VLAN setup scripts." });
      return;
    }
    const requestId = Number(req.params.requestId);
    const routerId = Number(req.body?.routerId);
    const bridgeName = typeof req.body?.bridgeName === "string" ? req.body.bridgeName.trim() : "";
    const vlanTag = typeof req.body?.vlanTag === "string" ? req.body.vlanTag.trim() : "";
    const requestedUsername = typeof req.body?.resellerUsername === "string"
      ? req.body.resellerUsername.trim()
      : "";
    if (!Number.isSafeInteger(requestId) || requestId <= 0 || !Number.isSafeInteger(routerId) || routerId <= 0 || !validInterface(bridgeName)) {
      res.status(400).json({ ok: false, error: "Choose a valid router and ISP Hotspot bridge." });
      return;
    }
    if (!/^\d{1,4}$/.test(vlanTag) || Number(vlanTag) < 1 || Number(vlanTag) > 4094) {
      res.status(400).json({ ok: false, error: "Enter a VLAN ID between 1 and 4094." });
      return;
    }
    if (requestedUsername && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(requestedUsername)) {
      res.status(400).json({ ok: false, error: "Use a reseller username with 3-64 letters, numbers, dots, underscores, or hyphens." });
      return;
    }
    const requests = await sbSelectStrict<ResellerConnectionRequestRow>(
      "isp_reseller_connection_requests",
      `id=eq.${requestId}&isp_admin_id=eq.${account.id}&status=in.(pending,approved)&select=id,reseller_id&limit=1`,
    );
    const request = requests[0];
    if (!request) {
      res.status(404).json({ ok: false, error: "This reseller connection request was not found or is no longer assignable." });
      return;
    }
    const resellerRows = await sbSelectStrict<{ id: number; username: string }>(
      "isp_admins",
      `id=eq.${request.reseller_id}&role=eq.reseller&is_active=is.true&select=id,username&limit=1`,
    );
    if (!resellerRows[0]) {
      res.status(409).json({ ok: false, error: "The reseller is no longer connected to this ISP account." });
      return;
    }
    await tenantRouter(account.id, routerId);
    const effectiveUsername = requestedUsername || resellerRows[0].username;
    const script = buildVlanInterfaceScript({
      interface_name: vlanServiceInterfaceName({ reseller_id: request.reseller_id, vlan_tag: vlanTag, username: effectiveUsername }),
      bridge_name: bridgeName,
      reseller_id: request.reseller_id,
      vlan_tag: vlanTag,
    });
    const filename = `${vlanServiceInterfaceName({ reseller_id: request.reseller_id, vlan_tag: vlanTag, username: effectiveUsername }).toLowerCase()}-interface.rsc`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(script);
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to generate the VLAN interface script." });
  }
});

router.get("/admin/reseller-handoffs/:portId/link", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const portId = Number(req.params.portId);
    const port = await ownedPort(req, portId);
    if (port.handoff_mode !== "isp_router") {
      res.status(409).json({ ok: false, error: "This assignment is not an ISP router handoff." });
      return;
    }
    const target = await tenantRouter(port.admin_id, port.router_id);
    const link = await detectRouterInterfaceLink(target, port.interface_name);
    const checkedAt = new Date().toISOString();
    await sbUpdateStrict(
      "isp_reseller_ports",
      `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
      {
        link_detected: link.running,
        last_link_checked_at: checkedAt,
        link_detection_error: link.error,
        updated_at: checkedAt,
      },
    );
    res.json({
      ok: true,
      link: {
        detected: link.running,
        exists: link.exists,
        disabled: link.disabled,
        interfaceName: port.interface_name,
        interfaceType: link.type,
        macAddress: link.macAddress,
        checkedAt,
        error: link.error,
      },
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to detect the XPON link." });
  }
});

router.post("/admin/reseller-handoffs/:portId/push", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const portId = Number(req.params.portId);
    const port = await ownedPort(req, portId);
    if (port.handoff_mode !== "vlan_services") {
      res.status(409).json({ ok: false, error: "Only VLAN service assignments can be pushed to the MikroTik." });
      return;
    }
    const target = await tenantRouter(port.admin_id, port.router_id);
    try {
      await provisionVlanResellerServices(target, port, requestHostname(req), requestOrigin(req));
      const updated = await sbUpdateStrict<ResellerPortRow>(
        "isp_reseller_ports",
        `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
        {
          status: "active",
          link_status: "active",
          link_detected: true,
          link_provisioning_error: null,
          provisioning_error: null,
          updated_at: new Date().toISOString(),
        },
      );
      const pendingRequests = await sbSelectStrict<{ id: number; reseller_id: number }>(
        "isp_reseller_connection_requests",
        `reseller_id=eq.${port.assigned_reseller_id ?? port.reseller_id}&isp_admin_id=eq.${port.admin_id}&status=eq.pending&select=id,reseller_id&limit=1`,
      );
      if (pendingRequests[0]) {
        const finalizedAt = new Date().toISOString();
        await sbUpdateStrict(
          "isp_admins",
          `id=eq.${pendingRequests[0].reseller_id}&role=eq.reseller`,
          {
            username: port.interface_name,
            parent_id: port.admin_id,
            status: "active",
            updated_at: finalizedAt,
          },
        );
        await sbUpdateStrict(
          "isp_reseller_connection_requests",
          `id=eq.${pendingRequests[0].id}&isp_admin_id=eq.${port.admin_id}&status=eq.pending`,
          { status: "approved", responded_at: finalizedAt, updated_at: finalizedAt },
        );
      }
      let liveState: Record<string, unknown> | undefined;
      if (port.id === 7) {
        const resources = portServiceResourceNames({
          id: port.id,
          router_id: port.router_id,
          interface_name: port.interface_name,
          bridge_name: port.bridge_name,
          handoff_mode: "vlan_services",
          reseller_id: port.reseller_id,
          assigned_reseller_id: port.assigned_reseller_id,
          vlan_tag: port.vlan_tag,
        });
        const { vlanInterface } = vlanServiceResources(port);
        const creds = routerCredentials(target);
        const read = async (command: string[]): Promise<Record<string, string>[]> => {
          const rows = await runRouterCommand(creds, command);
          return Array.isArray(rows) ? rows : [];
        };
        const hotspotServers = await read(["/ip/hotspot/print", "=.proplist=.id,name,interface,profile,address-pool,disabled,invalid", `?name=${resources.hotspotServer}`]);
        const hotspotProfiles = await read(["/ip/hotspot/profile/print", "=.proplist=.id,name,html-directory,dns-name,login-by,hotspot-address", `?name=${resources.hotspotProfile}`]);
        const hotspotActive = await read(["/ip/hotspot/active/print", "=.proplist=.id,address,mac-address,user,server,login-by,uptime", `?server=${resources.hotspotServer}`]);
        const hotspotHosts = await read(["/ip/hotspot/host/print", "=.proplist=.id,address,mac-address,server,bridge-port,uptime,authorized,bypassed,blocked", `?server=${resources.hotspotServer}`]);
        const dnsStatic = await read(["/ip/dns/static/print", "=.proplist=.id,name,address,type,disabled,comment"]);
        liveState = {
          hotspotActive,
          hotspotServers,
          hotspotProfiles,
          hotspotHosts,
          dnsStatic,
        };
      }
      res.json({
        ok: true,
        handoff: updated[0] ?? port,
        // Temporary response-only field for the one-time live port 7 diagnosis.
        assignment: liveState ? { id: port.id, status: JSON.stringify(liveState) } : undefined,
        message: `VLAN service ${port.interface_name} was pushed to the MikroTik.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "RouterOS VLAN service provisioning failed.";
      await sbUpdateStrict(
        "isp_reseller_ports",
        `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
        { status: "failed", link_status: "pending", provisioning_error: message.slice(0, 500), updated_at: new Date().toISOString() },
      ).catch(() => undefined);
      res.status(502).json({ ok: false, error: `RouterOS did not apply the VLAN service: ${message}` });
    }
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to push the VLAN service to the MikroTik." });
  }
});

router.get("/admin/reseller-handoffs/:portId/diagnostics", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const portId = Number(req.params.portId);
    const port = await ownedPort(req, portId);
    if (port.handoff_mode !== "vlan_services") {
      res.status(409).json({ ok: false, error: "Only VLAN service assignments can be inspected." });
      return;
    }
    const target = await tenantRouter(port.admin_id, port.router_id);
    const resources = portServiceResourceNames({
      id: port.id,
      router_id: port.router_id,
      interface_name: port.interface_name,
      bridge_name: port.bridge_name,
      handoff_mode: "vlan_services",
      reseller_id: port.reseller_id,
      assigned_reseller_id: port.assigned_reseller_id,
      vlan_tag: port.vlan_tag,
    });
    const { parentBridge, vlanInterface } = vlanServiceResources(port);
    const network = portServiceNetwork(port.id, port.subnet_range || "");
    const creds = routerCredentials(target);
    const read = async (command: string[]): Promise<Record<string, string>[]> => {
      const rows = await runRouterCommand(creds, command);
      return Array.isArray(rows) ? rows : [];
    };
    const [
      bridgeRows,
      bridgePortRows,
      bridgeVlanRows,
      vlanRows,
      addressRows,
      dhcpRows,
      dhcpNetworkRows,
      leaseRows,
      hotspotHostRows,
      arpRows,
    ] = await Promise.all([
      read(["/interface/bridge/print", "=.proplist=.id,name,disabled,running,vlan-filtering,frame-types,ingress-filtering", `?name=${parentBridge}`]),
      read(["/interface/bridge/port/print", "=.proplist=.id,interface,bridge,disabled,running,hw,edge,point-to-point", `?bridge=${parentBridge}`]),
      read(["/interface/bridge/vlan/print", "=.proplist=.id,bridge,vlan-ids,tagged,untagged", `?bridge=${parentBridge}`]),
      read(["/interface/vlan/print", "=.proplist=.id,name,vlan-id,interface,disabled,running", `?name=${vlanInterface}`]),
      read(["/ip/address/print", "=.proplist=.id,address,interface,disabled,comment", `?interface=${vlanInterface}`]),
      read(["/ip/dhcp-server/print", "=.proplist=.id,name,interface,address-pool,disabled,running", `?name=${resources.hotspotDhcp}`]),
      read(["/ip/dhcp-server/network/print", "=.proplist=.id,address,gateway,dns-server,comment", `?address=${network.network}`]),
      read(["/ip/dhcp-server/lease/print", "=.proplist=.id,address,mac-address,host-name,status,server,active-address,active-mac-address,expires-after", `?server=${resources.hotspotDhcp}`]),
      read(["/ip/hotspot/host/print", "=.proplist=.id,address,mac-address,server,bridge-port,uptime", `?server=${resources.hotspotServer}`]),
      read(["/ip/arp/print", "=.proplist=.id,address,mac-address,interface,complete,disabled", `?interface=${vlanInterface}`]),
    ]);
    res.json({
      ok: true,
      assignment: {
        id: port.id,
        routerId: port.router_id,
        parentBridge,
        vlanInterface,
        vlanTag: port.vlan_tag,
        subnet: network.network,
        gateway: network.gateway,
        hotspotServer: resources.hotspotServer,
        hotspotDhcp: resources.hotspotDhcp,
      },
      router: {
        name: target.name,
        vpnIp: target.vpn_ip,
      },
      bridge: bridgeRows,
      bridgePorts: bridgePortRows,
      bridgeVlans: bridgeVlanRows,
      vlanInterfaces: vlanRows,
      addresses: addressRows,
      dhcpServers: dhcpRows,
      dhcpNetworks: dhcpNetworkRows,
      leases: leaseRows,
      hotspotHosts: hotspotHostRows,
      arp: arpRows,
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to inspect the live VLAN service." });
  }
});

router.delete("/admin/reseller-handoffs/:portId", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot delete ISP-managed VLAN assignments." });
      return;
    }
    const portId = Number(req.params.portId);
    if (!Number.isSafeInteger(portId) || portId <= 0) {
      res.status(400).json({ ok: false, error: "Choose a valid reseller assignment." });
      return;
    }
    const portRows = await sbSelectStrict<ResellerPortRow>(
      "isp_reseller_ports",
      `id=eq.${portId}&admin_id=eq.${account.id}&select=*&limit=1`,
    );
    const port = portRows[0];
    if (!port) {
      res.status(404).json({ ok: false, error: "This reseller assignment was not found for your ISP account." });
      return;
    }
    const target = await tenantRouter(account.id, port.router_id);
    if (port.handoff_mode === "vlan_services") {
      await removeVlanResellerServices(target, port);
    }

    const sales = await sbSelectStrict<{ id: number }>(
      "isp_reseller_sales",
      `reseller_port_id=eq.${port.id}&select=id&limit=1`,
    );
    if (sales[0]) {
      await sbUpdateStrict(
        "isp_reseller_ports",
        `id=eq.${port.id}&admin_id=eq.${account.id}`,
        {
          status: "disabled",
          link_status: "suspended",
          assigned_reseller_id: null,
          provisioning_error: null,
          link_provisioning_error: null,
          updated_at: new Date().toISOString(),
        },
      );
    } else {
      await sbDeleteStrict("isp_reseller_ports", `id=eq.${port.id}&admin_id=eq.${account.id}`);
    }

    const otherAssignments = await sbSelectStrict<{ id: number }>(
      "isp_reseller_ports",
      `id=neq.${port.id}&admin_id=eq.${account.id}&assigned_reseller_id=eq.${port.assigned_reseller_id ?? port.reseller_id}&status=neq.disabled&select=id&limit=1`,
    );
    if (!otherAssignments[0]) {
      const now = new Date().toISOString();
      await sbUpdateStrict(
        "isp_admins",
        `id=eq.${port.assigned_reseller_id ?? port.reseller_id}&parent_id=eq.${account.id}&role=eq.reseller`,
        { parent_id: null, status: "pending", updated_at: now },
      );
      await sbUpdateStrict(
        "isp_reseller_connection_requests",
        `reseller_id=eq.${port.assigned_reseller_id ?? port.reseller_id}&isp_admin_id=eq.${account.id}&status=eq.approved`,
        { status: "pending", responded_at: null, updated_at: now },
      );
    }

    res.json({
      ok: true,
      retainedForSales: Boolean(sales[0]),
      message: sales[0]
        ? "The VLAN service was removed and the assignment was disabled because it has recorded sales."
        : "The VLAN service and reseller assignment were deleted. The reseller can be provisioned again.",
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error
        ? `The VLAN cleanup failed; the assignment was kept so it can be retried: ${error.message}`
        : "The VLAN cleanup failed; the assignment was kept so it can be retried.",
    });
  }
});

router.post("/isp/toggle-reseller-pipe", requireAdmin(), async (req, res): Promise<void> => {
  const action = req.body?.action;
  if (action !== "activate" && action !== "suspend") {
    res.status(400).json({ ok: false, error: "Action must be activate or suspend." });
    return;
  }
  req.body = {
    ...req.body,
    targetPortName: req.body?.portName,
    linkStatus: action === "activate" ? "active" : "suspended",
  };
  await updateResellerLink(req, res);
});

router.get("/admin/resellers/port-options", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role === "reseller") {
      res.status(403).json({ ok: false, error: "Reseller accounts cannot inspect unassigned ports." });
      return;
    }
    const routerId = Number(req.query.routerId);
    const handoffType = req.query.handoffType === "vlan" ? "vlan" : "physical";
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
         .filter((row) => validInterface(row.name) && !row.disabled && (handoffType === "vlan" || !assigned.has(row.name))),
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load router ports." });
  }
});

router.post("/admin/resellers", requireAdmin(), async (req, res): Promise<void> => {
  let resellerId = 0;
  let resellerSubdomain = "";
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
    const resellerRows = await sbInsertStrict<{ id: number; subdomain: string }>("isp_admins", {
      name: cleanName,
      company_name: cleanCompany || cleanName,
      username: cleanUsername,
      email: cleanEmail || null,
      phone: typeof phone === "string" ? phone.trim() || null : null,
      password: await hashIspAdminPassword(cleanPassword),
      parent_id: account.id,
      role: "reseller",
      subdomain: await nextResellerSubdomain([cleanCompany, cleanName, cleanUsername]),
      is_active: true,
      status: "active",
      earnings_balance: 0,
      must_change_password: false,
    });
    resellerId = Number(resellerRows[0]?.id);
    resellerSubdomain = String(resellerRows[0]?.subdomain ?? "").trim().toLowerCase();
    if (!resellerId || !resellerSubdomain) throw new Error("The reseller account could not be created.");
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
    const hotspotDnsName = `${resellerSubdomain}.${TENANT_BASE_DOMAIN}`;
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
        `=dns-name=${hotspotDnsName}`,
        "=login-by=http-chap,http-pap",
      ]);
      await runRouterCommand(creds, [
        "/ip/dns/static/add",
        `=name=${hotspotDnsName}`,
        `=address=${serviceNetwork.gateway}`,
        `=comment=OcholaSupernet_${servicePortName}_hotspot_dns`,
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/add",
        `=name=${hotspotServer}`,
        `=interface=${serviceBridgeName}`,
        `=profile=${hotspotProfile}`,
        `=address-pool=HS_POOL_${servicePortName}`,
        "=disabled=no",
      ]);
      await runRouterCommand(creds, [
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${hotspotDnsName}`,
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
    const [users, portRows, gateways, sales, customers, revenueRows] = await Promise.all([
      sbSelectStrict("isp_admins", `id=eq.${account.id}&select=id,name,company_name,username,email,phone,earnings_balance,created_at&limit=1`),
      sbSelectStrict<ResellerPortRow>("isp_reseller_ports", `assigned_reseller_id=eq.${account.id}&select=id,admin_id,reseller_id,assigned_reseller_id,router_id,interface_name,vlan_tag,bridge_name,hotspot_enabled,pppoe_enabled,subnet_range,bandwidth_cap_mbps,reseller_bandwidth_cap,status,link_status,handoff_mode,handoff_type,xpon_identifier,link_detected,last_link_checked_at,link_detection_error,provisioning_error,link_provisioning_error&limit=1000`),
      sbSelectStrict("reseller_payment_gateway_routes", `admin_id=eq.${tenantId}&reseller_id=eq.${account.id}&select=id,gateway_type,router_id,port_id,is_active,created_at,updated_at&order=updated_at.desc`),
      sbSelectStrict("isp_reseller_sales", `reseller_id=eq.${account.id}&select=id,admin_id,reseller_port_id,client_reference,client_ip,amount,gateway_type,payment_reference,status,created_at&order=created_at.desc&limit=100`),
      sbSelectStrict<ResellerCustomerMetricRow>("isp_customers", `admin_id=eq.${account.id}&select=id,type,status,expires_at,created_at,name,username,data_used_mb,data_used_bytes&limit=5000`),
      sbRpc<{
        income_today: number | string;
        income_month: number | string;
        total_revenue: number | string;
        total_transactions: number | string;
      }>("get_revenue_summary", { p_account_id: account.id }),
    ]);
    const routerIds = [...new Set(portRows.map((port) => Number(port.router_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
    const routers = routerIds.length
      ? await sbSelectStrict<{ id: number; name: string; status: string }>(
        "isp_routers",
        `id=in.(${routerIds.join(",")})&select=id,name,status`,
      )
      : [];
    const routerMap = new Map(routers.map((router) => [router.id, router]));
    const ports = portRows.map((port) => ({ ...port, router: routerMap.get(Number(port.router_id)) ?? null }));
    const now = Date.now();
    const activeCustomers = customers.filter((customer) => {
      const expiry = customer.expires_at ? Date.parse(customer.expires_at) : NaN;
      return customer.status === "active" && (!Number.isFinite(expiry) || expiry > now);
    }).length;
    const expiredCustomers = customers.filter((customer) => {
      const expiry = customer.expires_at ? Date.parse(customer.expires_at) : NaN;
      return customer.status === "expired" || (Number.isFinite(expiry) && expiry <= now);
    }).length;
    const monthKeys = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      return date.toISOString().slice(0, 7);
    });
    const monthLabels = monthKeys.map((key) => new Intl.DateTimeFormat("en-KE", { month: "short" }).format(new Date(`${key}-01T00:00:00Z`)));
    const registeredCustomersByMonth = monthKeys.map((key, index) => ({
      month: key,
      label: monthLabels[index],
      count: customers.filter((customer) => customer.created_at?.slice(0, 7) === key).length,
    }));
    const consumptionByMonth = monthKeys.map((key, index) => ({
      month: key,
      label: monthLabels[index],
      dataUsedMb: customers
        .filter((customer) => customer.created_at?.slice(0, 7) === key)
        .reduce((sum, customer) => sum + (Number(customer.data_used_bytes) > 0
          ? Number(customer.data_used_bytes) / 1_000_000
          : Math.max(0, Number(customer.data_used_mb) || 0)), 0),
    }));
    const topConsumers = customers
      .map((customer) => ({
        id: customer.id,
        name: customer.name || customer.username || `Customer #${customer.id}`,
        type: customer.type || "unknown",
        dataUsedMb: Number(customer.data_used_bytes) > 0
          ? Number(customer.data_used_bytes) / 1_000_000
          : Math.max(0, Number(customer.data_used_mb) || 0),
      }))
      .sort((a, b) => b.dataUsedMb - a.dataUsedMb)
      .slice(0, 5);
    const [revenue] = revenueRows;
    res.json({
      ok: true,
      account: users[0] ?? null,
      ports,
      gateways,
      sales,
      metrics: {
        revenue: {
          incomeToday: Number(revenue?.income_today ?? 0),
          incomeMonth: Number(revenue?.income_month ?? 0),
          totalRevenue: Number(revenue?.total_revenue ?? 0),
          totalTransactions: Number(revenue?.total_transactions ?? 0),
        },
        users: {
          total: customers.length,
          active: activeCustomers,
          expired: expiredCustomers,
          hotspot: customers.filter((customer) => customer.type === "hotspot").length,
          pppoe: customers.filter((customer) => customer.type === "pppoe").length,
          static: customers.filter((customer) => customer.type === "static").length,
        },
        analytics: {
          registeredCustomersByMonth,
          consumptionByMonth,
          topConsumers,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load reseller dashboard." });
  }
});

router.post("/reseller/pppoe-clients", requireAdmin(), async (req, res): Promise<void> => {
  let customerId = 0;
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "This endpoint is for reseller accounts." });
      return;
    }
    const portId = Number(req.body?.portId);
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim().slice(0, 40) : "";
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!Number.isSafeInteger(portId) || portId <= 0 || name.length < 2 || !phone || !/^[A-Za-z0-9._-]{3,64}$/.test(username) || password.length < 8) {
      res.status(400).json({ ok: false, error: "Provide a client name, phone, valid PPPoE username, and a password of at least 8 characters." });
      return;
    }
    const port = await ownedPort(req, portId);
    if (port.handoff_mode !== "vlan_services" || !port.pppoe_enabled) {
      res.status(409).json({ ok: false, error: "PPPoE client assignment is available only on an active VLAN Hotspot service." });
      return;
    }
    if (port.status !== "active" || port.link_status !== "active") {
      res.status(409).json({ ok: false, error: "Activate the reseller VLAN service before assigning PPPoE clients." });
      return;
    }
    const [byUsername, byPppoeUsername] = await Promise.all([
      sbSelectStrict<{ id: number }>("isp_customers", `admin_id=eq.${account.id}&username=eq.${encodeURIComponent(username)}&select=id&limit=1`),
      sbSelectStrict<{ id: number }>("isp_customers", `admin_id=eq.${account.id}&pppoe_username=eq.${encodeURIComponent(username)}&select=id&limit=1`),
    ]);
    if (byUsername[0] || byPppoeUsername[0]) {
      res.status(409).json({ ok: false, error: "That PPPoE username is already assigned in your reseller account." });
      return;
    }
    const inserted = await sbInsertStrict<{ id: number; name: string; username: string; pppoe_username: string; type: string; status: string }>(
      "isp_customers",
      {
        admin_id: account.id,
        name,
        phone,
        username,
        pppoe_username: username,
        password,
        type: "pppoe",
        router_id: port.router_id,
        plan_id: null,
        status: "active",
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
    customerId = Number(inserted[0]?.id);
    if (!customerId) throw new Error("The PPPoE client record could not be created.");
    const target = await tenantRouter(port.admin_id, port.router_id);
    await reconcilePppoeUserAccess(routerCredentials(target), {
      name: username,
      password,
      profile: `PPPOE_PROFILE_${vlanServiceSegment(port)}`,
      comment: `Reseller ${account.id} · ${name}`,
      enabled: true,
      expiresAt: null,
    });
    res.status(201).json({
      ok: true,
      customer: { id: customerId, name, phone, username, pppoe_username: username, type: "pppoe", status: "active" },
      message: "PPPoE client assigned to the reseller VLAN service.",
    });
  } catch (error) {
    if (customerId) {
      await sbDeleteStrict("isp_customers", `id=eq.${customerId}`).catch(() => undefined);
    }
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to assign the PPPoE client." });
  }
});

router.post("/reseller/static-clients", requireAdmin(), async (req, res): Promise<void> => {
  let customerId = 0;
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "This endpoint is for reseller accounts." });
      return;
    }
    const portId = Number(req.body?.portId);
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim().slice(0, 40) : "";
    const ipAddress = typeof req.body?.ipAddress === "string" ? req.body.ipAddress.trim() : "";
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (
      !Number.isSafeInteger(portId)
      || portId <= 0
      || name.length < 2
      || !phone
      || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ipAddress)
      || ipAddress.split(".").some((part: string) => Number(part) < 0 || Number(part) > 255)
      || (username && !/^[A-Za-z0-9._-]{3,64}$/.test(username))
      || (password && password.length < 8)
    ) {
      res.status(400).json({ ok: false, error: "Provide a client name, phone, valid IPv4 address, and optional valid login credentials." });
      return;
    }
    const port = await ownedPort(req, portId);
    if (port.handoff_mode !== "vlan_services" || port.status !== "active" || port.link_status !== "active") {
      res.status(409).json({ ok: false, error: "Static service assignment is available only on an active VLAN service." });
      return;
    }
    const duplicate = await sbSelectStrict<{ id: number }>(
      "isp_customers",
      `admin_id=eq.${account.id}&ip_address=eq.${encodeURIComponent(ipAddress)}&select=id&limit=1`,
    );
    if (duplicate[0]) {
      res.status(409).json({ ok: false, error: "That static IP is already assigned in your reseller account." });
      return;
    }
    const staticUsername = username || `static_${safeSegment(name, `client_${Date.now()}`)}`.slice(0, 64);
    const inserted = await sbInsertStrict<{ id: number; name: string; phone: string; username: string; ip_address: string; type: string; status: string }>(
      "isp_customers",
      {
        admin_id: account.id,
        name,
        phone,
        username: staticUsername,
        password: password || null,
        type: "static",
        router_id: port.router_id,
        plan_id: null,
        ip_address: ipAddress,
        status: "active",
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
    customerId = Number(inserted[0]?.id);
    if (!customerId) throw new Error("The static customer record could not be created.");

    const target = await tenantRouter(port.admin_id, port.router_id);
    const resources = vlanServiceResources(port);
    const comment = `OcholaSupernet_RS${account.id}_static_${customerId}`;
    const creds = routerCredentials(target);
    await runRouterCommand(creds, [
      "/queue/simple/add",
      `=name=STATIC_${account.id}_${customerId}`,
      `=target=${ipAddress}/32`,
      `=max-limit=${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M/${Math.round(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)}M`,
      `=comment=${comment}`,
    ]);
    if (port.hotspot_enabled && validRouterResourceName(resources.vlanInterface)) {
      await runRouterCommand(creds, [
        "/ip/hotspot/ip-binding/add",
        `=address=${ipAddress}`,
        "=type=bypassed",
        `=server=all`,
        `=comment=${comment}`,
      ]);
    }
    res.status(201).json({
      ok: true,
      customer: inserted[0] ?? { id: customerId, name, phone, username: staticUsername, ip_address: ipAddress, type: "static", status: "active" },
      message: "Static customer assigned and synchronized to the reseller service.",
    });
  } catch (error) {
    if (customerId) {
      await sbDeleteStrict("isp_customers", `id=eq.${customerId}`).catch(() => undefined);
    }
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Unable to assign the static customer." });
  }
});

function cleanGatewayIdentifier(value: unknown, label: string, required: boolean): string {
  const identifier = typeof value === "string" ? value.trim().slice(0, 120) : "";
  if (required && !identifier) throw new Error(`${label} is required when this gateway is enabled.`);
  return identifier;
}

async function resellerGatewayResources(account: { id: number; parent_id: number | null }) {
  const ports = await sbSelectStrict<{
    id: number;
    router_id: number;
    interface_name: string;
    vlan_tag: string | null;
    status: string;
    link_status: string | null;
  }>(
    "isp_reseller_ports",
    `assigned_reseller_id=eq.${account.id}&status=eq.active&select=id,router_id,interface_name,vlan_tag,status,link_status&order=router_id.asc,id.asc`,
  );
  const routerIds = [...new Set(ports.map((port) => Number(port.router_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const routers = routerIds.length
    ? await sbSelectStrict<{ id: number; name: string; status: string }>(
      "isp_routers",
      `id=in.(${routerIds.join(",")})&admin_id=eq.${account.parent_id ?? 0}&select=id,name,status&order=name.asc`,
    )
    : [];
  return { ports, routers };
}

router.get("/reseller/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can configure payment gateways." });
      return;
    }
    const [{ ports, routers }, routes] = await Promise.all([
      resellerGatewayResources(account),
      sbSelectStrict<ResellerGatewayRouteRow>(
        "reseller_payment_gateway_routes",
        `admin_id=eq.${account.parent_id ?? 0}&reseller_id=eq.${account.id}&select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_ciphertext,config_preview,is_active&order=updated_at.desc`,
      ),
    ]);
    const routerNames = new Map(routers.map((router) => [Number(router.id), router.name]));
    const portLabels = new Map(ports.map((port) => [
      Number(port.id),
      `${routerNames.get(Number(port.router_id)) ?? "Router"} · ${port.interface_name}${port.vlan_tag ? ` · VLAN ${port.vlan_tag}` : ""}`,
    ]));
    res.json({
      ok: true,
      scopes: {
        routers: routers.map((router) => ({ id: router.id, name: router.name, status: router.status })),
        ports: ports.map((port) => ({ id: port.id, routerId: port.router_id, label: portLabels.get(Number(port.id)) })),
      },
      routes: routes.map((route) => ({
        id: route.id,
        gatewayType: route.gateway_type,
        routerId: route.router_id,
        portId: route.port_id,
        scopeType: resellerGatewayScope(route.router_id, route.port_id),
        scopeLabel: route.port_id
          ? portLabels.get(Number(route.port_id)) ?? "Assigned VLAN port"
          : route.router_id
            ? `Router · ${routerNames.get(Number(route.router_id)) ?? "Assigned router"}`
            : "Reseller default",
        config: route.config_preview ?? {},
        hasStoredSecrets: Boolean(route.config_ciphertext),
        isActive: route.is_active,
      })),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load reseller payment gateways." });
  }
});

router.put("/reseller/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can configure payment gateways." });
      return;
    }
    const gatewayType = typeof req.body?.gatewayType === "string" ? req.body.gatewayType.trim().toLowerCase() : "";
    if (!isResellerGatewayId(gatewayType)) {
      res.status(400).json({ ok: false, error: "Choose a supported payment gateway." });
      return;
    }
    const scopeType = req.body?.scopeType === "port" || req.body?.scopeType === "router"
      ? req.body.scopeType
      : "default";
    const requestedRouterId = Number(req.body?.routerId);
    const portId = Number(req.body?.portId);
    const { ports, routers } = await resellerGatewayResources(account);
    const routerAllowed = routers.some((router) => Number(router.id) === requestedRouterId);
    const port = ports.find((item) => Number(item.id) === portId);
    if (scopeType === "router" && !routerAllowed) {
      res.status(403).json({ ok: false, error: "That router is not assigned to your reseller account." });
      return;
    }
    if (scopeType === "port" && !port) {
      res.status(403).json({ ok: false, error: "That VLAN port is not assigned to your reseller account." });
      return;
    }
    // The selected assigned port owns its router relationship. Do not trust a
    // stale or missing browser routerId when saving a port-scoped route.
    const scopedRouterId = scopeType === "default"
      ? null
      : scopeType === "port"
        ? Number(port?.router_id)
        : requestedRouterId;
    if (scopeType !== "default" && (typeof scopedRouterId !== "number" || !Number.isSafeInteger(scopedRouterId) || scopedRouterId <= 0)) {
      res.status(400).json({ ok: false, error: "Choose a valid assigned router or VLAN port." });
      return;
    }
    const scopedPortId = scopeType === "port" ? portId : null;
    const existingRows = await sbSelectStrict<ResellerGatewayRouteRow>(
      "reseller_payment_gateway_routes",
      `admin_id=eq.${account.parent_id ?? 0}&reseller_id=eq.${account.id}&${scopedPortId ? `port_id=eq.${scopedPortId}` : scopedRouterId ? `router_id=eq.${scopedRouterId}&port_id=is.null` : "router_id=is.null&port_id=is.null"}&select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_ciphertext,config_preview,is_active&limit=1`,
    );
    const existing = existingRows[0];
    const submitted = cleanGatewayConfig(req.body?.config);
    let previous: Record<string, string> = {};
    if (existing) previous = decryptGatewayConfig(existing.config_ciphertext);
    const config = { ...previous, ...submitted };
    if (req.body?.isActive !== false && Object.keys(config).length === 0) {
      res.status(400).json({ ok: false, error: "Add at least one collection account or gateway credential before activating this route." });
      return;
    }
    const payload = {
      admin_id: account.parent_id ?? 0,
      reseller_id: account.id,
      router_id: scopedRouterId,
      port_id: scopedPortId,
      gateway_type: gatewayType,
      config_ciphertext: encryptGatewayConfig(config),
      config_preview: gatewayConfigPreview(gatewayType, config),
      is_active: req.body?.isActive !== false,
      updated_at: new Date().toISOString(),
    };
    const saved = existing
      ? await sbUpdateStrict<{ id: number }>("reseller_payment_gateway_routes", `id=eq.${existing.id}&reseller_id=eq.${account.id}`, payload)
      : await sbInsertStrict<{ id: number }>("reseller_payment_gateway_routes", { ...payload, created_at: new Date().toISOString() });
    res.json({ ok: true, route: saved[0] ? { id: saved[0].id ?? existing?.id } : { id: existing?.id } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save reseller payment gateway." });
  }
});

router.delete("/reseller/payment-gateways/:routeId", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can remove payment gateways." });
      return;
    }
    const routeId = Number(req.params.routeId);
    if (!Number.isSafeInteger(routeId) || routeId <= 0) {
      res.status(400).json({ ok: false, error: "Invalid payment gateway route." });
      return;
    }
    await sbDeleteStrict("reseller_payment_gateway_routes", `id=eq.${routeId}&reseller_id=eq.${account.id}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to remove reseller payment gateway." });
  }
});

function resellerPaymentSettings(rows: Array<{
  gateway_type: string;
  merchant_identifier: string | null;
  account_reference: string | null;
  config_json: unknown;
  is_active: boolean;
}>, paymentGateway = "mpesa_paybill"): {
  paymentGateway: string;
  mpesa: { enabled: boolean; merchantIdentifier: string; accountReference: string; destinationType: "till" | "paybill" };
  bank: { enabled: boolean; merchantIdentifier: string; accountReference: string; bankName: string };
} {
  const readMpesa = () => {
    const row = rows.find(item => item.gateway_type === "mpesa");
    const config = row?.config_json && typeof row.config_json === "object" && !Array.isArray(row.config_json)
      ? row.config_json as Record<string, unknown>
      : {};
    return {
      enabled: row?.is_active === true,
      merchantIdentifier: row?.merchant_identifier ?? "",
      accountReference: row?.account_reference ?? "",
      destinationType: config.destinationType === "till" ? "till" as const : "paybill" as const,
    };
  };
  const readBank = () => {
    const row = rows.find(item => item.gateway_type === "bank");
    const config = row?.config_json && typeof row.config_json === "object" && !Array.isArray(row.config_json)
      ? row.config_json as Record<string, unknown>
      : {};
    return {
      enabled: row?.is_active === true,
      merchantIdentifier: row?.merchant_identifier ?? "",
      accountReference: row?.account_reference ?? "",
      bankName: typeof config.bankName === "string" ? config.bankName : "",
    };
  };
  return { paymentGateway, mpesa: readMpesa(), bank: readBank() };
}

async function saveResellerPaymentSettings(account: { id: number; parent_id: number | null }, body: any) {
  const mpesa = body?.mpesa && typeof body.mpesa === "object" ? body.mpesa : {};
  const bank = body?.bank && typeof body.bank === "object" ? body.bank : {};
  const mpesaEnabled = mpesa.enabled === true;
  const bankEnabled = bank.enabled === true;
  const mpesaDestinationType = mpesa.destinationType === "till" ? "till" : "paybill";
  const mpesaMerchant = cleanGatewayIdentifier(mpesa.merchantIdentifier, "M-Pesa Till / PayBill number", mpesaEnabled);
  const mpesaAccount = cleanGatewayIdentifier(mpesa.accountReference, "M-Pesa account reference", mpesaEnabled && mpesaDestinationType === "paybill");
  const bankName = cleanGatewayIdentifier(bank.bankName, "Bank name", bankEnabled);
  const bankMerchant = cleanGatewayIdentifier(
    bank.merchantIdentifier || bankBusinessNumberFor(bankName),
    "Bank merchant number",
    bankEnabled,
  );
  const bankAccount = cleanGatewayIdentifier(bank.accountReference, "Bank account number", bankEnabled);
  const allowedPaymentGateways = new Set([
    "mpesa_paybill", "mpesa_till_push", "bank_stk_push", "airtel", "azampay",
    "custom_paybill", "dpo_payments", "flutterwave", "intasend", "pesapal",
    "stripe", "paypal", "tigopesa", "xendit", "manual",
  ]);
  const paymentGateway = allowedPaymentGateways.has(String(body?.paymentGateway))
    ? String(body.paymentGateway)
    : "mpesa_paybill";
  const now = new Date().toISOString();

  await Promise.all([
    sbUpdateStrict("isp_admins", `id=eq.${account.id}&role=eq.reseller`, {
      payment_gateway: paymentGateway,
      updated_at: now,
    }),
    sbUpsertStrict("payment_gateways", "user_id,gateway_type", {
      user_id: account.id,
      gateway_type: "mpesa",
      merchant_identifier: mpesaMerchant,
      account_reference: mpesaAccount,
      config_json: { destinationType: mpesaDestinationType },
      is_active: mpesaEnabled,
      updated_at: now,
    }),
    sbUpsertStrict("payment_gateways", "user_id,gateway_type", {
      user_id: account.id,
      gateway_type: "bank",
      merchant_identifier: bankMerchant,
      account_reference: bankAccount,
      config_json: { bankName },
      is_active: bankEnabled,
      updated_at: now,
    }),
  ]);
}

router.get("/reseller/payment-settings", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can configure payment settings." });
      return;
    }
    const [rows, accountRows] = await Promise.all([
      sbSelectStrict<{
      gateway_type: string;
      merchant_identifier: string | null;
      account_reference: string | null;
      config_json: unknown;
      is_active: boolean;
      }>(
        "payment_gateways",
        `user_id=eq.${account.id}&gateway_type=in.(mpesa,bank)&select=gateway_type,merchant_identifier,account_reference,config_json,is_active`,
      ),
      sbSelectStrict<{ payment_gateway: string | null }>(
        "isp_admins",
        `id=eq.${account.id}&role=eq.reseller&select=payment_gateway&limit=1`,
      ),
    ]);
    res.json({ ok: true, settings: resellerPaymentSettings(rows, accountRows[0]?.payment_gateway || "mpesa_paybill") });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load payment settings." });
  }
});

router.put("/reseller/payment-settings", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await currentAccount(req);
    if (account.role !== "reseller") {
      res.status(403).json({ ok: false, error: "Only reseller accounts can configure payment settings." });
      return;
    }
    await saveResellerPaymentSettings(account, req.body);
    res.json({ ok: true });
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
    const selectedRoute = await resolveResellerGatewayRoute(
      port.admin_id,
      account.id,
      port.router_id,
      port.id,
    );
    if (!selectedRoute) {
      res.status(409).json({ ok: false, error: "Configure a reseller payment gateway for this VLAN port, router, or your default route before recording payments." });
      return;
    }
    const clientReference = typeof req.body?.clientReference === "string" ? req.body.clientReference.trim() : "";
    const clientIp = typeof req.body?.clientIp === "string" ? req.body.clientIp.trim() : "";
    const paymentReference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : "";
    const gatewayType = selectedRoute.gateway_type;
    const amount = Number(req.body?.amount);
    const maxLimit = Number(req.body?.maxLimitMbps ?? port.bandwidth_cap_mbps);
    if (!clientReference || !paymentReference || !gatewayType || !Number.isFinite(amount) || amount < 0 || !/^(\d{1,3}\.){3}\d{1,3}$/.test(clientIp) || !Number.isFinite(maxLimit) || maxLimit <= 0 || maxLimit > port.bandwidth_cap_mbps) {
      res.status(400).json({ ok: false, error: "Provide a client reference, IPv4 address, payment reference, gateway, amount, and valid speed." });
      return;
    }
    const tenantId = port.admin_id;
    const saleRows = await sbInsertStrict<{ id: number }>("isp_reseller_sales", {
      admin_id: tenantId,
      reseller_id: account.id,
      reseller_port_id: port.id,
      client_reference: clientReference.slice(0, 120),
      client_ip: clientIp,
      amount,
      gateway_type: gatewayType.slice(0, 32),
      payment_reference: paymentReference.slice(0, 160),
      status: port.handoff_mode === "isp_router" ? "completed" : "pending",
    });
    const saleId = Number(saleRows[0]?.id);
    if (port.handoff_mode === "isp_router") {
      res.status(201).json({ ok: true, saleId, queueName: null, status: "completed" });
      return;
    }
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