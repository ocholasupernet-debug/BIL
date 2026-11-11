import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { runVpsScript, vpsSshConfigured } from "./vps-ssh.js";

export interface RadiusDiscovery {
  vpsHost: string;
  detectedVpsIp: string | null;
  managementVpnHost: string | null;
  configRoot: "/etc/freeradius/3.0" | "/etc/freeradius" | "/etc/raddb" | null;
  installed: boolean;
  running: boolean;
  configurationValid: boolean;
  authenticationPort: number | null;
  accountingPort: number | null;
  authenticationListening: boolean;
  accountingListening: boolean;
  endpointVerified: boolean;
  radiusHost: string | null;
  secretSynchronized: boolean | null;
  routerSync: Array<{
    routerId: number;
    status: "added" | "already-synced" | "conflict" | "failed";
    vpnIp: string;
    error?: string;
    checkedAt: string;
  }>;
  checkedAt: string;
  error?: string;
}

export interface RadiusProbeOutput {
  installed: boolean;
  running: boolean;
  configurationValid: boolean;
  authenticationPort: number | null;
  accountingPort: number | null;
  authenticationListening: boolean;
  accountingListening: boolean;
  managementVpnHost: string | null;
  configRoot: RadiusDiscovery["configRoot"];
}

export const RADIUS_PROBE_SCRIPT = String.raw`set +e
bin=""
command -v freeradius >/dev/null 2>&1 && bin="freeradius"
command -v radiusd >/dev/null 2>&1 && [ -z "$bin" ] && bin="radiusd"
if [ -z "$bin" ]; then
  printf 'installed=false\nrunning=false\nconfigurationValid=false\nauthenticationPort=\naccountingPort=\nauthenticationListening=false\naccountingListening=false\n'
  exit 0
fi
service="freeradius"
systemctl list-unit-files freeradius.service 2>/dev/null | grep -q freeradius.service || service="radiusd"
systemctl is-active --quiet "$service" 2>/dev/null
running=$?
"$bin" -XC >/dev/null 2>&1
config=$?
config_root=""
for dir in /etc/freeradius/3.0 /etc/freeradius /etc/raddb; do
  [ -r "$dir/radiusd.conf" ] || continue
  config_root="$dir"
  break
done
auth=1812
acct=1813
management_vpn_host=$(ip -o -4 addr show dev tun-router 2>/dev/null | awk '$4 == "10.8.5.1" || $4 ~ /^10\.8\.5\.1\// { sub(/\/.*/, "", $4); print $4; exit }')
for file in /etc/freeradius/3.0/sites-enabled/default /etc/freeradius/sites-enabled/default /etc/raddb/sites-enabled/default; do
  [ -r "$file" ] || continue
  parsed=$(awk '
    /^[[:space:]]*listen[[:space:]]*\{/ { inlisten=1; type=""; port="" }
    inlisten && /^[[:space:]]*type[[:space:]]*=/ { type=$3 }
    inlisten && /^[[:space:]]*port[[:space:]]*=/ { port=$3 }
    inlisten && /^[[:space:]]*\}/ {
      if (type == "auth" && port ~ /^[0-9]+$/ && port != 0) print "authenticationPort=" port
      if (type == "acct" && port ~ /^[0-9]+$/ && port != 0) print "accountingPort=" port
      inlisten=0
    }
  ' "$file")
  auth=$(printf '%s\n' "$parsed" | sed -n 's/^authenticationPort=//p' | head -n 1)
  acct=$(printf '%s\n' "$parsed" | sed -n 's/^accountingPort=//p' | head -n 1)
  [ -n "$auth" ] || auth=1812
  [ -n "$acct" ] || acct=1813
  break
done
listeners=$(ss -H -lun 2>/dev/null | awk '{print $4}')
printf '%s\n' "$listeners" | grep -Eq "(:|\\])$auth$"; auth_listening=$?
printf '%s\n' "$listeners" | grep -Eq "(:|\\])$acct$"; acct_listening=$?
printf 'installed=true\nrunning=%s\nconfigurationValid=%s\nauthenticationPort=%s\naccountingPort=%s\nauthenticationListening=%s\naccountingListening=%s\nmanagementVpnHost=%s\nconfigRoot=%s\n' \
  "$([ "$running" -eq 0 ] && echo true || echo false)" \
  "$([ "$config" -eq 0 ] && echo true || echo false)" \
  "$auth" "$acct" \
  "$([ "$auth_listening" -eq 0 ] && echo true || echo false)" \
  "$([ "$acct_listening" -eq 0 ] && echo true || echo false)" \
  "$management_vpn_host" \
  "$config_root"
`;

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

export function parseRadiusProbeOutput(stdout: string): RadiusProbeOutput {
  const fields = new Map(
    stdout.split(/\r?\n/u).map(line => {
      const separator = line.indexOf("=");
      return separator < 0 ? ["", ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  const port = (name: string): number | null => {
    const value = Number(fields.get(name));
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
  };
  return {
    installed: parseBoolean(fields.get("installed")),
    running: parseBoolean(fields.get("running")),
    configurationValid: parseBoolean(fields.get("configurationValid")),
    authenticationPort: port("authenticationPort"),
    accountingPort: port("accountingPort"),
    authenticationListening: parseBoolean(fields.get("authenticationListening")),
    accountingListening: parseBoolean(fields.get("accountingListening")),
    managementVpnHost: fields.get("managementVpnHost") === "10.8.5.1" ? "10.8.5.1" : null,
    configRoot: isConfigRoot(fields.get("configRoot")) ? fields.get("configRoot") as RadiusDiscovery["configRoot"] : null,
  };
}

function isConfigRoot(value: string | undefined): value is NonNullable<RadiusDiscovery["configRoot"]> {
  return value === "/etc/freeradius/3.0" || value === "/etc/freeradius" || value === "/etc/raddb";
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127
      && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && b === 168)
      && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 192 && b === 0)
      && !(a === 192 && b === 88 && Number(address.split(".")[2]) === 99)
      && !(a === 198 && (b === 18 || b === 19 || b === 51))
      && !(a === 203 && b === 0 && Number(address.split(".")[2]) === 113)
      && !(a >= 224);
  }
  return false;
}

async function configuredPublicIp(host: string): Promise<string | null> {
  if (isPublicAddress(host)) return host;
  if (isIP(host)) return null;
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    return results.find(result => isPublicAddress(result.address))?.address ?? null;
  } catch {
    return null;
  }
}

export async function discoverConfiguredVpsRadius(
  options: {
    host?: string;
    sshConfigured?: boolean;
    execute?: typeof runVpsScript;
    resolveIp?: (host: string) => Promise<string | null>;
    now?: () => Date;
  } = {},
): Promise<RadiusDiscovery> {
  const host = options.host ?? process.env.VPS_HOST?.trim() ?? "";
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const base: RadiusDiscovery = {
    vpsHost: host,
    detectedVpsIp: null,
    managementVpnHost: null,
    configRoot: null,
    installed: false,
    running: false,
    configurationValid: false,
    authenticationPort: null,
    accountingPort: null,
    authenticationListening: false,
    accountingListening: false,
    endpointVerified: false,
    radiusHost: null,
    secretSynchronized: null,
    routerSync: [],
    checkedAt,
  };
  if (!host || !(options.sshConfigured ?? vpsSshConfigured())) {
    return { ...base, error: "Configured VPS SSH access is unavailable." };
  }
  const detectedVpsIp = await (options.resolveIp ?? configuredPublicIp)(host);
  let result;
  try {
    result = await (options.execute ?? runVpsScript)(RADIUS_PROBE_SCRIPT, { timeoutMs: 30_000 });
  } catch {
    return { ...base, detectedVpsIp, error: "The configured VPS could not be checked over SSH." };
  }
  if (!result.ok) {
    return {
      ...base,
      detectedVpsIp,
      error: "The configured VPS is offline or its secure check failed.",
    };
  }
  const probe = parseRadiusProbeOutput(result.stdout);
  const endpointVerified = Boolean(
    detectedVpsIp
    && probe.installed
    && probe.running
    && probe.configurationValid
    && probe.configRoot
    && probe.managementVpnHost
    && probe.authenticationPort
    && probe.accountingPort
    && probe.authenticationListening
    && probe.accountingListening,
  );
  return {
    ...base,
    ...probe,
    detectedVpsIp,
    endpointVerified,
    managementVpnHost: probe.managementVpnHost,
    radiusHost: endpointVerified ? probe.managementVpnHost : null,
    ...(!detectedVpsIp ? { error: "The configured VPS host did not resolve to a public IP address." } : {}),
    ...(!probe.installed ? { error: "FreeRADIUS is not installed on the configured VPS." } : {}),
    ...(probe.installed && !probe.configurationValid ? { error: "FreeRADIUS configuration is missing or invalid." } : {}),
    ...(probe.installed && probe.configurationValid && !probe.running ? { error: "FreeRADIUS is installed but not running." } : {}),
    ...(probe.installed && probe.running && !probe.managementVpnHost
      ? { error: "The configured VPS management VPN endpoint 10.8.5.1 is unavailable." }
      : {}),
    ...(probe.running && (!probe.authenticationListening || !probe.accountingListening)
      ? { error: "FreeRADIUS is not listening on both verified RADIUS UDP ports." }
      : {}),
  };
}
