import { validateGeneratedRouterScript } from "./router-script-validation.js";
import {
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT,
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME,
  ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP,
} from "./router-management-vpn.js";

export type ScriptProfile = "greenfield" | "brownfield";

export interface CoreBootstrapOptions {
  vpsVpnEndpoint: string;
  routerUniqueUser: string;
  routerUniquePassword: string;
  secureGeneratedApiPassword: string;
  routerUniqueName: string;
  websiteDomain: string;
  routerOsMajor?: 6 | 7;
  vpnPort?: number;
  apiUserName?: string;
  hotspotBridgeName?: string;
  allowedApiSubnets?: string[];
}

export interface DualServiceOptions {
  /** Physical interface that carries both the hotspot and PPPoE services. */
  portName: string;
  /** Optional service label. Defaults to the sanitized interface name. */
  serviceName?: string;
  /** IP address that receives unpaid/suspended HTTP redirects. */
  billingAddress: string;
  /** Port on the billing landing service. */
  billingPort?: number;
}

export interface ClientQueueOptions {
  user: string;
  clientIp: string;
  speedMbps: number;
}

export interface ResellerQueueOptions {
  portName: string;
  limitMbps: number;
  clients?: ClientQueueOptions[];
}

export interface RouterScriptCompilerOptions {
  bridgeName?: string;
  bridgeAddress?: string;
  radiusAddress: string;
  radiusSecret: string;
  radiusIncomingPort?: number;
  dualServices?: DualServiceOptions[];
  resellerQueues?: ResellerQueueOptions[];
}

const DEFAULT_BRIDGE_NAME = "br-billing";
const DEFAULT_BRIDGE_ADDRESS = "192.168.88.1/24";
const DEFAULT_RADIUS_INCOMING_PORT = 3799;
const MAX_SCRIPT_LENGTH = 512 * 1024;

function rosString(value: string): string {
  return `"${value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

function assertRouterName(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 63 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error(`${label} must be 1-63 characters and contain only letters, numbers, dot, underscore, or hyphen.`);
  }
  return normalized;
}

function assertIpv4(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}$/.exec(normalized);
  if (!match || normalized.split(".").some(part => Number(part) > 255)) {
    throw new Error(`${label} must be an IPv4 address.`);
  }
  return normalized;
}

function assertCidr(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  const [address, prefix] = normalized.split("/");
  const prefixNumber = Number(prefix);
  if (!address || !Number.isInteger(prefixNumber) || prefixNumber < 0 || prefixNumber > 32) {
    throw new Error(`${label} must be an IPv4 CIDR.`);
  }
  assertIpv4(address, label);
  return normalized;
}

function assertPort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return value;
}

function assertHost(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 255 || !/^[A-Za-z0-9:._-]+$/.test(normalized)) {
    throw new Error(`${label} must be a hostname or IP address.`);
  }
  return normalized;
}

function assertCredential(value: string, label: string): string {
  const normalized = String(value ?? "");
  if (!normalized || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error(`${label} must be non-empty and must not contain control characters.`);
  }
  return normalized;
}

function assertHttpsOrigin(value: string, label: string): string {
  const raw = String(value ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${label} must use HTTPS without credentials or a path.`);
  }
  return url.origin;
}

function assertSpeed(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new Error(`${label} must be a positive bandwidth value.`);
  }
  return value;
}

function command(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith(";") || trimmed.endsWith("{")) return trimmed;
  return `${trimmed};`;
}

function addPhase(lines: string[], label: string, commands: string[]): void {
  lines.push(`:put ${rosString(`OCHOLASUPERNET: ${label}`)};`);
  for (const entry of commands) lines.push(command(entry));
  /* RouterOS imports can overrun on slower hardware when a long block is
     parsed without yielding. Keep the delay in the generated script rather
     than relying on network chunking or response flushing. */
  lines.push(":delay 2s;");
}

function safeServiceName(portName: string, serviceName?: string): string {
  return assertRouterName(serviceName?.trim() || `ochola-${portName}`, "Service name");
}

function renderDualService(options: DualServiceOptions): string[] {
  const portName = assertRouterName(options.portName, "Port name");
  const serviceName = safeServiceName(portName, options.serviceName);
  const billingAddress = assertIpv4(options.billingAddress, "Billing address");
  const billingPort = assertPort(options.billingPort ?? 80, "Billing port");
  const hotspotProfile = `${serviceName}-hotspot`;
  const hotspotServer = `${serviceName}-hs`;
  const suspendedList = `${serviceName}-suspended`;
  const pppoeProfile = `${serviceName}-pppoe-profile`;
  const pppoeServer = `${serviceName}-pppoe`;
  const portalDirectory = `flash/hotspot/hs_${portName}`;
  const natComment = `OcholaSuperNet ${serviceName} suspended PPPoE billing redirect`;

  return [
    ":do {",
    `:local dualPort ${rosString(portName)}`,
    `:local hotspotProfile ${rosString(hotspotProfile)}`,
    `:local hotspotServer ${rosString(hotspotServer)}`,
    `:local pppoeProfile ${rosString(pppoeProfile)}`,
    `:local pppoeServer ${rosString(pppoeServer)}`,
    `:local suspendedList ${rosString(suspendedList)}`,
    `:if ([:len [/ip hotspot profile find where name=$hotspotProfile]] = 0) do={ /ip hotspot profile add name=$hotspotProfile html-directory=${rosString(portalDirectory)} comment="OcholaSuperNet dual service"; }`,
    `:if ([:len [/ip hotspot find where name=$hotspotServer]] = 0) do={ /ip hotspot add name=$hotspotServer interface=$dualPort profile=$hotspotProfile disabled=no comment="OcholaSuperNet dual service"; }`,
    `:if ([:len [/ip hotspot find where name=$hotspotServer]] > 0) do={ /ip hotspot enable [find where name=$hotspotServer]; }`,
    `:if ([:len [/ppp profile find where name=$pppoeProfile]] = 0) do={ /ppp profile add name=$pppoeProfile only-one=yes comment="OcholaSuperNet dual service"; }`,
    `:if ([:len [/interface pppoe-server server find where name=$pppoeServer]] = 0) do={ /interface pppoe-server server add name=$pppoeServer interface=$dualPort service-name=$pppoeServer default-profile=$pppoeProfile max-mtu=1492 max-mru=1492 disabled=no comment="OcholaSuperNet dual service"; }`,
    `:if ([:len [/interface pppoe-server server find where name=$pppoeServer]] > 0) do={ /interface pppoe-server server set [find where name=$pppoeServer] interface=$dualPort default-profile=$pppoeProfile max-mtu=1492 max-mru=1492 disabled=no; }`,
    `:if ([:len [/ip firewall nat find where comment=${rosString(natComment)}]] = 0) do={ /ip firewall nat add chain=dstnat protocol=tcp dst-port=80 src-address-list=$suspendedList action=dst-nat to-addresses=${rosString(billingAddress)} to-ports=${billingPort} comment=${rosString(natComment)}; }`,
    `:put ${rosString(`Dual service ready on ${portName}; suspended PPPoE sessions use ${billingAddress}:${billingPort}.`)}`,
    `} on-error={ :put ${rosString(`Dual service failed on ${portName}.`) }; }`,
  ];
}

function renderQueue(options: ResellerQueueOptions): string[] {
  const portName = assertRouterName(options.portName, "Queue port name");
  const limitMbps = assertSpeed(options.limitMbps, "Reseller queue limit");
  const parentName = `RESELLER_ROOT_${portName}`;
  const commands = [
    `/queue simple add name=${rosString(parentName)} target=${rosString(portName)} max-limit=${limitMbps}M/${limitMbps}M priority=2/2 comment="OcholaSuperNet reseller parent"`,
  ];

  for (const client of options.clients ?? []) {
    const user = assertRouterName(client.user, "Queue client");
    const clientIp = assertIpv4(client.clientIp, "Queue client IP");
    const speedMbps = assertSpeed(client.speedMbps, "Queue client speed");
    commands.push(
      `/queue simple add name=${rosString(`CLIENT_${user}`)} target=${rosString(clientIp)} parent=${rosString(parentName)} max-limit=${speedMbps}M/${speedMbps}M comment="OcholaSuperNet client child"`,
    );
  }
  return commands;
}

export class RouterScriptCompiler {
  private readonly options: Required<Pick<RouterScriptCompilerOptions, "bridgeName" | "bridgeAddress" | "radiusIncomingPort">>
    & Omit<RouterScriptCompilerOptions, "bridgeName" | "bridgeAddress" | "radiusIncomingPort">;

  constructor(options: RouterScriptCompilerOptions) {
    this.options = {
      bridgeName: assertRouterName(options.bridgeName ?? DEFAULT_BRIDGE_NAME, "Bridge name"),
      bridgeAddress: assertCidr(options.bridgeAddress ?? DEFAULT_BRIDGE_ADDRESS, "Bridge address"),
      radiusAddress: assertIpv4(options.radiusAddress, "RADIUS address"),
      radiusSecret: String(options.radiusSecret ?? ""),
      radiusIncomingPort: assertPort(options.radiusIncomingPort ?? DEFAULT_RADIUS_INCOMING_PORT, "RADIUS incoming port"),
      dualServices: options.dualServices ?? [],
      resellerQueues: options.resellerQueues ?? [],
    };
    if (!this.options.radiusSecret || /[\u0000-\u001F\u007F]/.test(this.options.radiusSecret)) {
      throw new Error("RADIUS secret must be non-empty and must not contain control characters.");
    }
  }

  compile(profile: ScriptProfile): string {
    const lines: string[] = [
      "# OcholaSuperNet unified RouterOS compiler",
      `# Profile: ${profile}`,
      "# Every phase is explicitly terminated and yields for two seconds.",
      ":put \"OCHOLASUPERNET: compiler start\";",
      ":delay 2s;",
    ];

    if (profile === "greenfield") {
      addPhase(lines, "greenfield bridge and management", [
        `:if ([:len [/interface bridge find where name=${rosString(this.options.bridgeName)}]] = 0) do={ /interface bridge add name=${rosString(this.options.bridgeName)} comment="OcholaSuperNet billing bridge"; }`,
        `:if ([:len [/ip address find where address=${rosString(this.options.bridgeAddress)} && interface=${rosString(this.options.bridgeName)}]] = 0) do={ /ip address add address=${rosString(this.options.bridgeAddress)} interface=${rosString(this.options.bridgeName)} comment="OcholaSuperNet billing gateway"; }`,
      ]);
    } else if (profile === "brownfield") {
      addPhase(lines, "brownfield-safe management overlay", [
        `:if ([:len [/interface bridge find where name=${rosString(this.options.bridgeName)}]] = 0) do={ /interface bridge add name=${rosString(this.options.bridgeName)} comment="OcholaSuperNet billing bridge"; }`,
        `:if ([:len [/ip address find where address=${rosString(this.options.bridgeAddress)} && interface=${rosString(this.options.bridgeName)}]] = 0) do={ :put "Existing bridge/address preserved; no replacement performed."; }`,
      ]);
    } else {
      throw new Error(`Unsupported script profile: ${String(profile)}`);
    }

    addPhase(lines, "RADIUS", [
      `:if ([:len [/radius find where address=${rosString(this.options.radiusAddress)}]] = 0) do={ /radius add service=hotspot,ppp address=${rosString(this.options.radiusAddress)} secret=${rosString(this.options.radiusSecret)} timeout=3000ms comment="OcholaSuperNet RADIUS"; }`,
      `/radius incoming set accept=yes port=${this.options.radiusIncomingPort}`,
    ]);

    for (const dualService of this.options.dualServices ?? []) {
      addPhase(lines, `dual service ${dualService.portName}`, renderDualService(dualService));
    }
    for (const queue of this.options.resellerQueues ?? []) {
      addPhase(lines, `queues ${queue.portName}`, renderQueue(queue));
    }

    lines.push(":put \"OCHOLASUPERNET: compiler complete\";", ":delay 2s;");
    const script = `${lines.map(command).join("\r\n")}\r\n`;
    if (script.length > MAX_SCRIPT_LENGTH) throw new Error("Generated RouterOS script exceeds the 512 KiB safety limit.");
    const validated = validateGeneratedRouterScript(script);
    return `${validated.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n")}`;
  }
}

function coreCipher(routerOsMajor: 6 | 7): string {
  /* RouterOS parses unsupported properties before on-error can recover.
     Keep the requested AES-256 strength while using each major version's
     accepted spelling. */
  return routerOsMajor >= 7 ? "aes256-cbc" : "aes256";
}

export function compileCoreBootstrap(options: CoreBootstrapOptions): string {
  const routerOsMajor = options.routerOsMajor ?? 6;
  const vpnPort = assertPort(
    options.vpnPort ?? ROUTER_MANAGEMENT_VPN.port,
    "Management VPN port",
  );
  const endpoint = assertHost(options.vpsVpnEndpoint, "VPS VPN endpoint");
  const routerUser = assertCredential(options.routerUniqueUser, "Router VPN username");
  const routerPassword = assertCredential(options.routerUniquePassword, "Router VPN password");
  const apiPassword = assertCredential(options.secureGeneratedApiPassword, "API password");
  const routerName = assertRouterName(options.routerUniqueName, "Router name");
  const apiUserName = assertRouterName(options.apiUserName ?? "ocholasupernet_api", "API username");
  const bridgeName = assertRouterName(options.hotspotBridgeName ?? "br-hotspot", "Hotspot bridge name");
  const websiteOrigin = assertHttpsOrigin(options.websiteDomain, "Website domain");
  const heartbeatUrl = `${websiteOrigin}/api/isp/router/heartbeat?rname=${encodeURIComponent(routerName)}`;
  const allowedSubnets = (options.allowedApiSubnets ?? [
    ROUTER_MANAGEMENT_VPN.network,
    ROUTER_MANAGEMENT_VPN_BACKUP.network,
    "127.0.0.1/32",
  ]).map((value, index) => {
    const normalized = value.trim();
    if (normalized === "127.0.0.1") return "127.0.0.1/32";
    return assertCidr(normalized, `Allowed API subnet ${index + 1}`);
  });
  if (!allowedSubnets.length) throw new Error("At least one allowed API subnet is required.");
  const allowedSources = allowedSubnets.join(",");
  const cipher = coreCipher(routerOsMajor);
  const lines: string[] = [
    "# OcholaSuperNet Script 1 — Core Bootstrap",
    `# RouterOS major-version path: ${routerOsMajor}`,
    "# The complete document is buffered and validated before delivery.",
    `:log info ${rosString("Initializing OcholaSupernet Core Bootstrap Engine...")}`,
    ":delay 3s",
    ":do {",
    `  :local ovpnIds [/interface ovpn-client find where name=${rosString(ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME)}]`,
    "  :if ([:len $ovpnIds] = 0) do={",
    `    /interface ovpn-client add name=${rosString(ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME)} connect-to=${rosString(endpoint)} port=${vpnPort} protocol=tcp user=${rosString(routerUser)} password=${rosString(routerPassword)} profile=default cipher=${cipher} mode=ip comment=${rosString(ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT)} disabled=no`,
    "  } else={",
    `    /interface ovpn-client set [:pick $ovpnIds 0] connect-to=${rosString(endpoint)} port=${vpnPort} protocol=tcp user=${rosString(routerUser)} password=${rosString(routerPassword)} profile=default cipher=${cipher} mode=ip comment=${rosString(ROUTER_MANAGEMENT_CLIENT_COMMENT)} disabled=no`,
    "  }",
    "} on-error={ :log warning \"OcholaSuperNet management OpenVPN client could not be created or updated.\" }",
    ":delay 3s",
    `:if ([:len [/interface bridge find where name=${rosString(bridgeName)}]] = 0) do={`,
    `  /interface bridge add name=${rosString(bridgeName)} comment=${rosString("Core Billing Hotspot Bridge Routing Plane")}`,
    "}",
    ":delay 3s",
    `:local apiAllowed ${rosString(allowedSources)}`,
    `:if ([:len [/user find where name=${rosString(apiUserName)}]] = 0) do={`,
    `  /user add name=${rosString(apiUserName)} password=${rosString(apiPassword)} group=full allowed-address=$apiAllowed comment=${rosString("do not delete")} disabled=no`,
    "} else={",
    `  /user set [find where name=${rosString(apiUserName)}] password=${rosString(apiPassword)} group=full allowed-address=$apiAllowed comment=${rosString("do not delete")} disabled=no`,
    "}",
    ":delay 3s",
    `:if ([:len [/ip firewall filter find where comment=${rosString("OcholaSupernet: Allow API Access over Secure Management VPN Tunnel")}]] = 0) do={`,
    `  /ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728,8729 src-address=$apiAllowed comment=${rosString("OcholaSupernet: Allow API Access over Secure Management VPN Tunnel")} place-before=0`,
    "}",
    `:if ([:len [/ip firewall filter find where comment=${rosString("OcholaSupernet: Allow HTTP/S Core Webhooks from Server Platform")}]] = 0) do={`,
    `  /ip firewall filter add chain=input action=accept protocol=tcp dst-port=80,443 src-address=$apiAllowed comment=${rosString("OcholaSupernet: Allow HTTP/S Core Webhooks from Server Platform")} place-before=0`,
    "}",
    `:if ([:len [/ip firewall filter find where comment=${rosString("OcholaSupernet: Allow Inbound RADIUS CoA Disconnect Messages")}]] = 0) do={`,
    `  /ip firewall filter add chain=input action=accept protocol=udp dst-port=3799 src-address=$apiAllowed comment=${rosString("OcholaSupernet: Allow Inbound RADIUS CoA Disconnect Messages")} place-before=0`,
    "}",
    ":delay 3s",
    `:local heartbeatEvent ${rosString(`/tool fetch url="${heartbeatUrl}" keep-result=no mode=https`)}`,
    `:if ([:len [/system script find where name=${rosString("ochola_heartbeat_daemon")}]] = 0) do={`,
    `  /system script add name=${rosString("ochola_heartbeat_daemon")} policy=read,test source=$heartbeatEvent comment=${rosString("Core Platform Keepalive Link Monitor")}`,
    "} else={",
    `  /system script set [find where name=${rosString("ochola_heartbeat_daemon")}] policy=read,test source=$heartbeatEvent comment=${rosString("Core Platform Keepalive Link Monitor")}`,
    "}",
    `:if ([:len [/system scheduler find where name=${rosString("ochola_heartbeat_daemon")}]] = 0) do={`,
    `  /system scheduler add name=${rosString("ochola_heartbeat_daemon")} interval=1m start-time=startup on-event=${rosString("/system script run ochola_heartbeat_daemon")} comment=${rosString("Core Platform Keepalive Link Monitor")}`,
    "} else={",
    `  /system scheduler set [find where name=${rosString("ochola_heartbeat_daemon")}] interval=1m start-time=startup on-event=${rosString("/system script run ochola_heartbeat_daemon")} comment=${rosString("Core Platform Keepalive Link Monitor")} disabled=no`,
    "}",
    ":delay 3s",
    `:log info ${rosString("OcholaSupernet Core Bootstrap completed successfully. Router is now linking to website portal.")}`,
  ];
  const script = `${lines.map(command).join("\r\n")}\r\n`;
  if (script.length > MAX_SCRIPT_LENGTH) throw new Error("Generated RouterOS script exceeds the 512 KiB safety limit.");
  const validated = validateGeneratedRouterScript(script);
  return `${validated.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n")}`;
}

export function compileRouterScript(profile: ScriptProfile, options: RouterScriptCompilerOptions): string {
  return new RouterScriptCompiler(options).compile(profile);
}