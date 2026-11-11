import { RESERVED_SUBDOMAINS } from "../lib/tenant-host.js";

export const ROUTEROS_INSTALLER_V2_VERSION = "2.0.0";

/**
 * The same-local-address PPPoE design has not been exercised on a
 * non-production router yet. Keep every configuration/apply module gated.
 */
export const ROUTEROS_INSTALLER_V2_APPLY_ENABLED = false;

export type RouterOsRelease = {
  major: 6 | 7;
  minor: number;
  patch: number;
  raw: string;
};

export function parseSupportedRouterOsRelease(value: unknown): RouterOsRelease | null {
  const raw = String(value ?? "").trim();
  const match = /^(6|7)\.(\d+)(?:\.(\d+))?(?:[-+][A-Za-z0-9.-]+)?(?:\s+\([A-Za-z0-9 ._-]+\))?$/.exec(raw);
  if (!match) return null;
  const major = Number(match[1]) as 6 | 7;
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (major === 6 && minor < 48) return null;
  return { major, minor, patch, raw };
}

export type RouterInstallerV2PoolPlan = {
  active: string[];
  expired: string[];
};

/**
 * Split the requested contiguous ranges at /24 boundaries. Each range omits
 * the .0 network and .255 broadcast addresses.
 */
export const ROUTEROS_INSTALLER_V2_POOL_PLAN: RouterInstallerV2PoolPlan = {
  active: [
    "192.168.185.5-192.168.185.254",
    "192.168.186.1-192.168.186.254",
    "192.168.187.1-192.168.187.254",
  ],
  expired: [
    "192.168.188.5-192.168.188.254",
    "192.168.189.1-192.168.189.254",
    "192.168.190.1-192.168.190.254",
  ],
};

const SAFE_PUBLIC_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i;
const SAFE_TENANT_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Require an explicitly configured HTTPS origin. Do not trust request
 * Host/forwarded-host headers for router-served installer URLs.
 */
export function validateInstallerV2PublicOrigin(value: unknown): string | null {
  const origin = String(value ?? "").trim().replace(/\/+$/, "");
  if (!SAFE_PUBLIC_ORIGIN.test(origin)) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildInstallerV2EntryUrl(publicOrigin: unknown, tenantSubdomain?: unknown): string | null {
  const origin = validateInstallerV2PublicOrigin(publicOrigin);
  if (!origin) return null;

  let entryOrigin = origin;
  if (tenantSubdomain !== undefined) {
    const subdomain = String(tenantSubdomain ?? "").trim().toLowerCase();
    const parsed = new URL(origin);
    if (
      !SAFE_TENANT_SUBDOMAIN.test(subdomain) ||
      parsed.hostname !== "isplatty.com" ||
      RESERVED_SUBDOMAINS.has(subdomain)
    ) return null;
    entryOrigin = `https://${subdomain}.isplatty.com`;
  }
  return `${entryOrigin}/scripts/v2/mainhotspot.rsc`;
}

/**
 * Safe first-stage package. It inventories and backs up only; apply modules
 * remain unavailable until non-production RouterOS validation is completed.
 */
export function buildInstallerV2PreflightScript(): string {
  return `# OCHOLASUPERNET RouterOS installer v${ROUTEROS_INSTALLER_V2_VERSION} — PRE-FLIGHT ONLY
# This release does not alter WAN, bridges, Hotspot, PPPoE, VPN, users or firewall.
# Keep the output private; RouterOS backups contain configuration secrets.
:local rosVersion [/system resource get version]
:local rosMajor [:pick $rosVersion 0 1]
:local rosMinor [:tonum [:pick $rosVersion 2 4]]
:if (($rosMajor != "6") && ($rosMajor != "7")) do={ :error ("Unsupported RouterOS version: " . $rosVersion) }
:if (($rosMajor = "6") && ($rosMinor < 48)) do={ :error ("OCHOLASUPERNET v2 requires RouterOS 6.48 or later; found " . $rosVersion) }
:put ("OCHOLASUPERNET v2 preflight: RouterOS " . $rosVersion)
:put ("Board: " . [/system resource get board-name])
:put ("Identity: " . [/system identity get name])
:put "Creating a local backup and default RouterOS export; no configuration will be applied."
:put "The backup file contains configuration secrets; keep both files private."
:if ([:len [/file find where name="ocholasupernet-v2-preflight.backup"]] > 0) do={ :error "ocholasupernet-v2-preflight.backup already exists; rename it before retrying so the previous checkpoint is preserved." }
:if ([:len [/file find where name="ocholasupernet-v2-preflight.rsc"]] > 0) do={ :error "ocholasupernet-v2-preflight.rsc already exists; rename it before retrying so the previous export is preserved." }
/system backup save name="ocholasupernet-v2-preflight"
:delay 2s
/export file="ocholasupernet-v2-preflight"
:delay 2s
:if ([:len [/file find where name="ocholasupernet-v2-preflight.backup"]] = 0) do={ :error "The RouterOS backup was not verified; no configuration changes were made." }
:if ([:len [/file find where name="ocholasupernet-v2-preflight.rsc"]] = 0) do={ :error "The RouterOS export was not verified; no configuration changes were made." }
:put "DISCOVERY: interfaces"
/interface print
:put "DISCOVERY: bridge and bridge ports"
/interface bridge print
/interface bridge port print
:put "DISCOVERY: VLAN and IP addressing"
/interface vlan print
/ip address print
:put "DISCOVERY: routes and DHCP"
/ip route print
/ip dhcp-server print
:put "DISCOVERY: Hotspot and PPPoE servers"
/ip hotspot print
/ip hotspot profile print
/interface pppoe-server server print
:put "PPP client and VPN interface names/status are included in the interface inventory above; credential detail is intentionally not printed."
:put "DISCOVERY: firewall, NAT and management service restrictions"
/ip firewall filter print
/ip firewall nat print
/ip service print
:put "OCHOLASUPERNET v2 preflight finished. No service configuration was applied."
:put "The v2 apply gate is closed pending non-production RouterOS 6/7 validation.";
`;
}
