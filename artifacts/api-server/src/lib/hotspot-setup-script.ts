import { ipv4AddressNumber, ipv4RangesOverlap, parseIpv4Ranges } from "./ipv4-range-safety.js";

export type HotspotSetupScriptInput = {
  routerId: number;
  bridgeName: string;
  gatewayCidr: string;
  dhcpPoolName: string;
  dhcpPoolRange: string;
  pppoePoolRanges: string[];
  dhcpServerExists: boolean;
  dhcpNetworkExists: boolean;
  dhcpDnsServers: string[];
  hotspotServerName?: string;
  hotspotProfileName?: string;
  hotspotNatExists: boolean;
  radiusReady: boolean;
  allowlist: Array<{ host: string; source: string; kind?: "host" | "address" }>;
};

const MANAGED_PREFIX = "BIL-HOTSPOTSETUP:";
const FORBIDDEN_HOSTS = /(?:ispledger|ocholanet\.com|paystack|opay)/i;
const PAYMENT_HOSTS: Record<string, string[]> = {
  mpesa_paybill: ["api.safaricom.co.ke"],
  mpesa_till_push: ["api.safaricom.co.ke"],
  bank_stk_push: ["api.safaricom.co.ke"],
  airtel: ["openapi.airtel.africa"],
  azampay: ["api.azampay.co.tz", "checkout.azampay.co.tz"],
  dpo_payments: ["secure.3gdirectpay.com", "pay.dpo-group.com"],
  flutterwave: ["api.flutterwave.com", "checkout.flutterwave.com"],
  intasend: ["api.intasend.com", "payment.intasend.com"],
  pesapal: ["pay.pesapal.com", "www.pesapal.com"],
  stripe: ["api.stripe.com", "checkout.stripe.com", "js.stripe.com"],
  paypal: ["api-m.paypal.com", "www.paypal.com", "www.paypalobjects.com"],
  tigopesa: ["api.tigo.co.tz"],
  xendit: ["api.xendit.co", "checkout.xendit.co"],
};

export function configuredHotspotPaymentHosts(gatewayId: string, config: unknown): Array<{ host: string; source: string }> {
  const hosts = PAYMENT_HOSTS[gatewayId];
  if (!hosts) return [];
  let value = config;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const hasConfiguredField = Object.values(value as Record<string, unknown>)
    .some(field => typeof field === "string" ? field.trim().length > 0 : field === true || (typeof field === "number" && Number.isFinite(field)));
  return hasConfiguredField
    ? hosts.map(host => ({ host, source: `Configured payment provider: ${gatewayId}` }))
    : [];
}

export function resolveHotspotSetupAdminId(authenticatedUid: unknown, requestedAdminId: unknown): number {
  const requested = Number(requestedAdminId);
  if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
  if (authenticatedUid === "superadmin") return requested;
  const authenticated = Number(authenticatedUid);
  return Number.isSafeInteger(authenticated) && authenticated > 0 && authenticated === requested
    ? authenticated
    : 0;
}

function rosQuote(value: string): string {
  if (!value || /[\r\n;]/.test(value)) throw new Error("Invalid RouterOS value.");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function validateHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || FORBIDDEN_HOSTS.test(normalized)) {
    throw new Error("An allowlist hostname is invalid or not configured for BIL.");
  }
  if (ipv4AddressNumber(normalized) !== null) return normalized;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(normalized)) {
    throw new Error("An allowlist hostname is invalid.");
  }
  return normalized;
}

function validateNetwork(input: HotspotSetupScriptInput): { gateway: string; subnet: string } {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(input.gatewayCidr.trim());
  if (!match) throw new Error("Router inventory must provide a verified gateway CIDR.");
  const gatewayNum = ipv4AddressNumber(match[1]);
  const prefix = Number(match[2]);
  if (gatewayNum === null || prefix < 1 || prefix > 30) throw new Error("The router gateway CIDR is invalid.");
  const size = 2 ** (32 - prefix);
  const start = Math.floor(gatewayNum / size) * size;
  const end = start + size - 1;
  if (gatewayNum <= start || gatewayNum >= end) throw new Error("The gateway cannot be a subnet network or broadcast address.");
  const subnet = `${Math.floor(start / 16777216)}.${Math.floor(start / 65536) % 256}.${Math.floor(start / 256) % 256}.${start % 256}/${prefix}`;
  const hotspotRanges = parseIpv4Ranges(input.dhcpPoolRange);
  if (!hotspotRanges.length) throw new Error("A verified Hotspot DHCP pool range is required.");
  for (const range of hotspotRanges) {
    if (range.start < start || range.end > end) throw new Error("The Hotspot DHCP pool is outside the configured bridge subnet.");
    if (gatewayNum >= range.start && gatewayNum <= range.end) throw new Error("The Hotspot DHCP pool overlaps the gateway address.");
    for (const pppoeRange of input.pppoePoolRanges) {
      if (parseIpv4Ranges(pppoeRange).some(pppoe => ipv4RangesOverlap(range, pppoe))) {
        throw new Error(`Hotspot DHCP pool ${input.dhcpPoolRange} overlaps PPPoE pool ${pppoeRange}.`);
      }
    }
  }
  return { gateway: match[1], subnet };
}

/** Builds a standalone, repeatable Hotspot-only script from verified live router inventory. */
export function generateHotspotSetupScript(input: HotspotSetupScriptInput): string {
  if (!Number.isSafeInteger(input.routerId) || input.routerId < 1) throw new Error("A valid router id is required.");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(input.bridgeName)) throw new Error("A verified bridge name is required.");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(input.dhcpPoolName)) throw new Error("A verified DHCP pool name is required.");
  const { gateway, subnet } = validateNetwork(input);
  const allowed = input.allowlist.map(item => ({ ...item, host: validateHost(item.host), source: item.source.trim() }));
  if (!allowed.length) throw new Error("At least one configured BIL portal or server host is required.");
  if (allowed.some(item => !item.source || /[\r\n;]/.test(item.source))) throw new Error("Allowlist source labels are required.");
  const tag = `${MANAGED_PREFIX}${input.routerId}:`;
  const serverName = input.hotspotServerName?.trim() || `bil-hotspot-${input.routerId}`;
  const profileName = input.hotspotProfileName?.trim() || `bil-hotspot-${input.routerId}`;
  if (![serverName, profileName].every(value => /^[A-Za-z0-9_.-]{1,64}$/.test(value))) {
    throw new Error("Router inventory contains an invalid Hotspot server or profile name.");
  }
  const hosts = allowed.map(item => item.host);
  const dnsServers = input.dhcpDnsServers.map(value => value.trim()).filter(Boolean);
  if (!input.dhcpNetworkExists && !dnsServers.length) {
    throw new Error("The router has no verified DNS resolver for a new DHCP network.");
  }
  if (dnsServers.some(value => ipv4AddressNumber(value) === null)) {
    throw new Error("The router's configured DHCP DNS resolver is invalid.");
  }
  const dnsList = dnsServers.map(rosQuote).join(",");
  const walledGarden = allowed.map(item => {
    const comment = `${tag}allow:${item.source}`;
    const addressEntry = item.kind === "address" || ipv4AddressNumber(item.host) !== null;
    const match = addressEntry ? `dst-address=${rosQuote(item.host)}` : `dst-host=${rosQuote(item.host)}`;
    return `:if ([:len [/ip hotspot walled-garden ip find where comment=${rosQuote(comment)}]] = 0) do={ /ip hotspot walled-garden ip add action=accept ${match} protocol=tcp dst-port=443 comment=${rosQuote(comment)} }`;
  }).join("\n");
  const staleEntryCleanup = `:foreach entry in=[/ip hotspot walled-garden ip find where comment~${rosQuote(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}allow:`)}] do={ :local host [/ip hotspot walled-garden ip get $entry dst-host]; :if ([:len $host] = 0) do={ :set host [/ip hotspot walled-garden ip get $entry dst-address] }; :local keep false; :foreach allowedHost in=${hosts.map(rosQuote).join(",")} do={ :if ($host=$allowedHost) do={ :set keep true } }; :if (!$keep) do={ /ip hotspot walled-garden ip remove $entry } }`;
  return [
    "# BIL standalone Hotspot setup; generated from read-only RouterOS inventory.",
    "# Preview/dry run: inspect this file and its source comments before importing; generation never changes router state.",
    "# Backup first: /system backup save name=before-bil-hotspotsetup",
    `# Rollback only this router's managed items: /ip hotspot remove [find where comment~"^${tag}"]; /ip hotspot profile remove [find where comment~"^${tag}"]; /ip dhcp-server remove [find where comment~"^${tag}"]; /ip dhcp-server network remove [find where comment~"^${tag}"]; /ip firewall nat remove [find where comment~"^${tag}"]; /ip firewall mangle remove [find where comment~"^${tag}"]; /ip hotspot walled-garden ip remove [find where comment~"^${tag}"]`,
    "# RouterOS 6.48+ is required. No credentials, payment polling, or RADIUS secret is embedded.",
    `:local bilTag ${rosQuote(tag)}`,
    `:local version [/system resource get version]`,
    `:if ([:pick $version 0 1] != "6" && [:pick $version 0 1] != "7") do={ :error "Unsupported RouterOS version" }`,
    `:if ([:pick $version 0 1] = "6" && [:tonum [:pick $version 2 4]] < 48) do={ :error "RouterOS 6.48 or newer is required" }`,
    `:local bridge ${rosQuote(input.bridgeName)}`,
    `:local gateway ${rosQuote(gateway)}`,
    `:local subnet ${rosQuote(subnet)}`,
    "# Existing bridge, bridge ports, bridge address, PPPoE services, pools and customer sessions are preserved.",
    input.dhcpServerExists
      ? "# Existing DHCP service is preserved; no DHCP server or lease is changed."
      : `:if ([:len [/ip dhcp-server find where comment=${rosQuote(`${tag}dhcp`)}]] = 0) do={ /ip dhcp-server add name=${rosQuote(`bil-hotspot-dhcp-${input.routerId}`)} interface=$bridge address-pool=${rosQuote(input.dhcpPoolName)} lease-time=1h disabled=no comment=${rosQuote(`${tag}dhcp`)} }`,
    input.dhcpNetworkExists
      ? "# Existing DHCP network is preserved."
      : `:if ([:len [/ip dhcp-server network find where address=${rosQuote(subnet)}]] = 0) do={ /ip dhcp-server network add address=${rosQuote(subnet)} gateway=$gateway dns-server=${dnsList} comment=${rosQuote(`${tag}dhcp-network`)} }`,
    input.hotspotServerName
      ? "# Existing Hotspot server and profile are preserved."
      : `:if ([:len [/ip hotspot profile find where comment=${rosQuote(`${tag}profile`)}]] = 0) do={ /ip hotspot profile add name=${rosQuote(profileName)} hotspot-address=$gateway${input.radiusReady ? " use-radius=yes" : ""} comment=${rosQuote(`${tag}profile`)} }\n:if ([:len [/ip hotspot find where comment=${rosQuote(`${tag}server`)}]] = 0) do={ /ip hotspot add name=${rosQuote(serverName)} interface=$bridge profile=${rosQuote(profileName)} disabled=no comment=${rosQuote(`${tag}server`)} }`,
    input.radiusReady && input.hotspotProfileName
      ? `:local verifiedProfile [/ip hotspot profile find where name=${rosQuote(input.hotspotProfileName)}]; :if ([:len $verifiedProfile] = 1) do={ /ip hotspot profile set $verifiedProfile use-radius=yes }`
      : "",
    input.hotspotNatExists
      ? "# Existing Hotspot NAT is preserved."
      : `:if ([:len [/ip firewall nat find where comment=${rosQuote(`${tag}nat`)}]] = 0) do={ /ip firewall nat add chain=srcnat src-address=${rosQuote(subnet)} action=masquerade comment=${rosQuote(`${tag}nat`)} }`,
    "# Managed walled-garden entries are reconciled by exact BIL tag; manual and PPPoE entries are untouched.",
    staleEntryCleanup,
    walledGarden,
    "# Optional anti-sharing TTL rules are intentionally disabled; no global prerouting TTL rule is added.",
    ":local enableHotspotTtlAntiSharing false",
    ":if ($enableHotspotTtlAntiSharing) do={",
    `  :if ([:len [/ip firewall mangle find where comment=${rosQuote(`${tag}ttl`)}]] = 0) do={ /ip firewall mangle add chain=postrouting out-interface=$bridge action=change-ttl new-ttl=set:1 comment=${rosQuote(`${tag}ttl`)} }`,
    "}",
    input.radiusReady
      ? "# RADIUS is already verified and provisioned for this router; no shared secret is embedded or changed."
      : "# RADIUS was not verified and assigned to this router; no RADIUS entry is added and local authentication remains the generated default.",
    "# Payment activation is handled by BIL's existing server-side callbacks, never by this script.",
    "# Source allowlist:",
    ...allowed.map(item => `# ${item.source}: ${item.host} (HTTPS only)`),
    "",
  ].join("\n");
}

