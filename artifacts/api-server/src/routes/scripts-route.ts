import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { lookup } from "node:dns/promises";
import * as net from "node:net";
import path from "path";
import { genPPPoEVlan, parsePPPoEVlanConfig, type DbRouter as PPPoEDbRouter } from "./pppoe-script-route.js";
import { buildDomainRouterExportScript } from "../lib/router-migration-export-script.js";
import {
  generateRouterAsClientScript,
  generateRouterIpsecClientScript,
  generateRouterWireGuardClientScript,
} from "../lib/mikrotik.js";
import { allocateRouterVpnIp, isRouterVpnIp, routerVpnPeerIp, ROUTER_VPN_GATEWAY } from "../lib/router-vpn-ip.js";
import { readIppEntries } from "../lib/vpn-status.js";
import { getTenantSubdomain } from "../lib/tenant-host.js";
import {
  ROUTER_MANAGEMENT_VPN,
  routerManagementOvpnCredentials,
  routerManagementVpnPortForRouter,
  routerManagementVpnReadiness,
} from "../lib/router-management-vpn.js";
import {
  ISRG_ROOT_X1_PEM,
  ROUTER_HTTPS_CERTIFICATE_FILE,
  ROUTER_HTTPS_CERTIFICATE_NAME,
} from "../lib/router-https-trust.js";
import {
  generatedRouterVpnChildScript,
  provisionRouterManagementOpenVpn,
  routerFallbackMaterial,
} from "../lib/router-vpn-provisioning.js";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();
const TAKEOVER_CONFIRMATION = "TAKE CONTROL";
const TAKEOVER_GRANT_TTL_MS = 10 * 60 * 1000;
const TAKEOVER_PLAN = [
  "Verified RouterOS backup and text export are created before changes.",
  "Existing hotspot, PPPoE, DHCP, pool, RADIUS, firewall/NAT, VPN, user, and scheduler resources may be replaced.",
  "Existing Supabase customers, billing records, payments, and service history are never deleted.",
];

function takeoverGrantSecret(): string {
  return String(process.env.SESSION_SECRET ?? "").trim();
}

function signTakeoverGrant(payload: string): string {
  return createHmac("sha256", takeoverGrantSecret()).update(payload).digest("base64url");
}

function createTakeoverGrant(adminId: number, routerId: number): string {
  const expiresAt = Date.now() + TAKEOVER_GRANT_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${adminId}.${routerId}.${expiresAt}.${nonce}`;
  return `tko.v1.${payload}.${signTakeoverGrant(payload)}`;
}

function createInstallerGrant(adminId: number, routerId: number): string {
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${adminId}.${routerId}.${expiresAt}.${nonce}`;
  return `inst.v1.${payload}.${signTakeoverGrant(payload)}`;
}

function verifyInstallerGrant(grant: string, routerId: number): { adminId: number } | null {
  if (!takeoverGrantSecret()) return null;
  const parts = grant.split(".");
  if (parts.length !== 7 || parts[0] !== "inst" || parts[1] !== "v1") return null;
  const [, , adminRaw, routerRaw, expiresRaw, nonce, signature] = parts;
  const adminId = Number(adminRaw);
  const grantRouterId = Number(routerRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(adminId) || adminId <= 0 ||
      !Number.isSafeInteger(grantRouterId) || grantRouterId !== routerId ||
      !Number.isFinite(expiresAt) || expiresAt < Date.now() ||
      !/^[a-f0-9]{32}$/.test(nonce) || !signature) return null;
  const payload = `${adminId}.${grantRouterId}.${expiresAt}.${nonce}`;
  const expected = signTakeoverGrant(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return { adminId };
}

function verifyTakeoverGrant(grant: string, routerId: number): { adminId: number } | null {
  if (!takeoverGrantSecret()) return null;
  const parts = grant.split(".");
  if (parts.length !== 7 || parts[0] !== "tko" || parts[1] !== "v1") return null;
  const [, , adminRaw, routerRaw, expiresRaw, nonce, signature] = parts;
  const adminId = Number(adminRaw);
  const grantRouterId = Number(routerRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(adminId) || adminId <= 0 ||
      !Number.isSafeInteger(grantRouterId) || grantRouterId !== routerId ||
      !Number.isFinite(expiresAt) || expiresAt < Date.now() ||
      !/^[a-f0-9]{32}$/.test(nonce) || !signature) return null;
  const payload = `${adminId}.${grantRouterId}.${expiresAt}.${nonce}`;
  const expected = signTakeoverGrant(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return { adminId };
}

/* ── Files that administrators may publish from the server ────────────────
   Keep this allowlist rooted in the checked-in hotspot directory. The API
   never accepts an arbitrary filesystem path from the browser. */
const HOTSPOT_ROOT = [
  path.resolve(process.cwd(), "artifacts/ochola-supernet/public/hotspot"),
  path.resolve(process.cwd(), "../ochola-supernet/public/hotspot"),
  path.resolve(process.cwd(), "../../artifacts/ochola-supernet/public/hotspot"),
].find(candidate => existsSync(candidate))
  ?? path.resolve(process.cwd(), "artifacts/ochola-supernet/public/hotspot");
const DEPLOYABLE_TEXT_EXTENSIONS = new Set([
  ".css", ".html", ".js", ".json", ".svg", ".txt", ".xsd",
]);
const DEPLOYABLE_BINARY_EXTENSIONS = new Set([".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export type DeployableSourceType = "hotspot" | "script";

export interface DeployableSource {
  id: string;
  type: DeployableSourceType;
  name: string;
  label: string;
  size: number;
}

export interface DeployableSourceContent {
  source: DeployableSource;
  content: Buffer;
}

function hotspotFiles(relativeDir = ""): DeployableSource[] {
  const directory = path.resolve(HOTSPOT_ROOT, relativeDir);
  const entries: DeployableSource[] = [];

  if (!directory.startsWith(`${HOTSPOT_ROOT}${path.sep}`) && directory !== HOTSPOT_ROOT) {
    return entries;
  }

  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativeName = path.posix.join(relativeDir.replaceAll("\\", "/"), entry.name);
      const absoluteName = path.resolve(HOTSPOT_ROOT, relativeName);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        entries.push(...hotspotFiles(relativeName));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!DEPLOYABLE_TEXT_EXTENSIONS.has(extension) && !DEPLOYABLE_BINARY_EXTENSIONS.has(extension)) {
        continue;
      }

      try {
        entries.push({
          id: `hotspot:${relativeName}`,
          type: "hotspot",
          name: relativeName,
          label: `Hotspot · ${relativeName}`,
          size: statSync(absoluteName).size,
        });
      } catch {
        /* Ignore a file that disappears while the catalog is being built. */
      }
    }
  } catch {
    /* A missing local asset directory should produce an empty catalog, not a
       filesystem error visible to the browser. */
  }

  return entries;
}

function deployableScriptSources(): DeployableSource[] {
  const names = ["mainhotspot.rsc", ...Object.keys(STATIC_SUBSCRIPTS)];
  return names.map(name => ({
    id: `script:${name}`,
    type: "script" as const,
    name,
    label: `RouterOS · ${name}`,
    size: 0,
  }));
}

export function listDeployableSources(): DeployableSource[] {
  return [
    ...hotspotFiles().sort((a, b) => a.name.localeCompare(b.name)),
    ...deployableScriptSources().sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

export function getDeployableSource(
  type: DeployableSourceType,
  name: string,
  origin = "https://isplatty.org",
): DeployableSourceContent | null {
  const source = listDeployableSources().find(item => item.type === type && item.name === name);
  if (!source) return null;

  if (type === "hotspot") {
    const relativeName = name.replaceAll("\\", "/");
    const absoluteName = path.resolve(HOTSPOT_ROOT, relativeName);
    if (!absoluteName.startsWith(`${HOTSPOT_ROOT}${path.sep}`) || !existsSync(absoluteName)) return null;
    return { source: { ...source, size: statSync(absoluteName).size }, content: readFileSync(absoluteName) };
  }

  const content = name === "mainhotspot.rsc"
    ? buildMainhotspotRsc(`${origin}/api/scripts`)
    : (() => {
        const entry = STATIC_SUBSCRIPTS[name];
        return typeof entry === "function" ? entry(origin) : entry;
      })();
  if (typeof content !== "string") return null;
  return {
    source: { ...source, size: Buffer.byteLength(content, "utf8") },
    content: Buffer.from(content, "utf8"),
  };
}

/* Prefer VITE_SUPABASE_URL (the REST API base URL). SUPABASE_URL may be a bare
   DB hostname without https:// — so always fall back to VITE_ first. */
function resolveUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}
const SUPABASE_URL = resolveUrl();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY || "";

/* ── Auto-upsert an IP pool record for a router ──
   Called after script generation so pool ranges are always in the DB.
   Fire-and-forget — errors are logged but never bubble to the response. ── */
async function autoUpsertPool(
  adminId: number, routerId: number, name: string, rangeStart: string, rangeEnd: string
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const now = new Date().toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/isp_ip_pools`, {
      method: "POST",
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        Prefer:          "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        admin_id:    adminId,
        router_id:   routerId,
        name,
        range_start: rangeStart,
        range_end:   rangeEnd,
        created_at:  now,
        updated_at:  now,
      }),
    });
    console.log(`[auto-pool] upserted "${name}" (${rangeStart}-${rangeEnd}) → router ${routerId}`);
  } catch (e) {
    console.warn(`[auto-pool] upsert failed: ${e instanceof Error ? e.message : e}`);
  }
}

/* ── Supabase REST helper ── */
async function sbGet<T>(path: string): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T[]>;
}

/* ── Parse subdomain from Host header ──
   "fastnet.isplatty.org"  →  "fastnet"
   "ocholasupernet.isplatty.org" → "ocholasupernet"
   "localhost"             →  ""
── */
function parseSubdomain(host: string): string {
  return getTenantSubdomain(host) ?? "";
}

/* ── Slug ↔ name helpers ── */
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function nextAvailableRouterName(
  base: string,
  routers: Array<{ name: string }>,
): string {
  const used = new Set(routers.map(router => router.name.trim().toLowerCase()));
  for (let ordinal = 1; ordinal <= 9999; ordinal += 1) {
    const candidate = `${base}${ordinal}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error(`No available router name remains for "${base}"`);
}

/* ── Rate-limit string ── */
function toRateLimit(down: number, up: number, unit = "Mbps"): string {
  const s = unit === "Kbps" ? "k" : unit === "Gbps" ? "G" : "M";
  return `${up}${s}/${down}${s}`;
}

/* ── Session timeout string ── */
function toSessionTimeout(value: number, unit: string): string {
  const u = (unit || "Days").toLowerCase();
  if (u.startsWith("min"))   return `${value}m`;
  if (u.startsWith("hr"))    return `${value}h`;
  if (u.startsWith("day"))   return `${value}d`;
  if (u.startsWith("week"))  return `${value * 7}d`;
  if (u.startsWith("month")) return `${value * 30}d`;
  return `${value}d`;
}

/* ── Single-line RouterOS command builder ── */
function ros(cmd: string): string {
  return cmd.replace(/\s{2,}/g, " ").trim();
}

function rosString(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/* ── Safe ros: wraps a command in on-error so one failure can't abort
   the whole script. Prints a WARN line instead so the user sees it. ── */
function safeRos(cmd: string, label: string): string {
  return `:do { ${ros(cmd)} } on-error={ :put "  WARN: ${label} failed - check /log" }`;
}

/* ── OVPN add with version fallback.
   Uses TLS client certificate (certificate=) instead of username/password.
   Level 1: with verify-server-certificate=no  (ROS 6.16+)
   Level 2: without verify-server-certificate  (older ROS 6 that lacks the param)
   RouterOS cipher enum uses "aes256" — never "aes256-cbc" (that's OpenSSL format).
   Each level only runs if the one above failed. ── */
function ovpnAdd(slug: string, baseFields: string, password: string): string {
  const safePassword = rosString(password);
  /* Attempt 1: cert + password, verify-server-certificate=no (ROS 7) */
  const a1 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="${safePassword}" certificate=${slug} verify-server-certificate=no`);
  /* Attempt 2: cert + password, no verify-server-certificate (ROS 6) */
  const a2 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="${safePassword}" certificate=${slug}`);
  /* Attempt 3: password-only fallback — works even if cert import failed */
  const a3 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="${safePassword}"`);
  return [
    `:do { ${a1} } on-error={`,
    ` :do { ${a2} } on-error={`,
    `  :do { ${a3} } on-error={ :put "  WARN: VPN add failed - check /log" }`,
    ` }`,
    `}`,
  ].join("\r\n");
}

/* ── Verify a RouterOS download created a usable file.
   RouterOS can report a successful fetch even when the destination is a
   directory or an empty result. Keep this inside the fetch's :do block so the
   caller's on-error handler reports the exact destination. ── */
function verifyFetchedFile(pathExpression: string, label: string, rejectRouterVpnError = false): string {
  const routerVpnErrorCheck = rejectRouterVpnError
    ? `
 :global ocholaVpnChildError
 :local fetchedContents ""
 :do { :set fetchedContents [/file get $fetchedFile contents] } on-error={
     :set ocholaVpnChildError "downloaded ${label} could not be inspected before import"
     :error $ocholaVpnChildError
 }
 :if ([:find $fetchedContents "# OCHOLA_ROUTER_VPN_ERROR"] = 0) do={
     :set ocholaVpnChildError ("server rejected ${label}: " . $fetchedContents)
     :error $ocholaVpnChildError
 }`
    : "";
  return `:local fetchedFile [/file find name=${pathExpression}]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ${label}" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ${label}" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ${label}" }${routerVpnErrorCheck}`;
}

const ROUTER_HTTPS_FETCH_OPTIONS =
  `mode=https check-certificate=yes`;
type RouterCertificateMode = "verified" | "unverified";

function routerHttpsTrustBootstrap(scriptsBase: string): string {
  const caUrl = `${scriptsBase}/${ROUTER_HTTPS_CERTIFICATE_FILE}`;
  return `# Install the public CA used by the VPS HTTPS certificate before verified fetches.
# The CA certificate is public; no private certificate key is downloaded.
:do {
    :local caFile "${ROUTER_HTTPS_CERTIFICATE_FILE}"
    :local caCert [/certificate find name="${ROUTER_HTTPS_CERTIFICATE_NAME}"]
    :if ([:len $caCert] = 0) do={
        :do { /file remove [find name="$caFile"] } on-error={}
        /tool fetch url="${caUrl}" dst-path="$caFile" keep-result=yes mode=https check-certificate=no
        /certificate import file-name="$caFile" name="${ROUTER_HTTPS_CERTIFICATE_NAME}" trusted=yes
        :do { /file remove [find name="$caFile"] } on-error={}
    }
    :set caCert [/certificate find name="${ROUTER_HTTPS_CERTIFICATE_NAME}"]
    :if ([:len $caCert] = 0) do={ :error "public HTTPS CA certificate was not imported" }
    /certificate set $caCert trusted=yes
    :put "      HTTPS certificate trust configured for verified downloads."
} on-error={
    :put ("  WARN: HTTPS certificate trust setup failed - " . $error)
}`;
}

/* ── Safe fetch (static path): wraps /tool fetch in :do {} on-error={}.
   The destination is kept on the router and verified so a pasted installer
   leaves a visible copy in Files instead of silently discarding failures. ── */
function safeFetch(url: string, dst: string): string {
  return `:do {
    /tool fetch url="${url}" dst-path="${dst}" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"${dst}"`, dst)}
  } on-error={ :put ("  WARN: ${dst} download failed at ${dst} - " . $error) }`;
}

/* ── Portal file fetch: uses pre-computed $hsdir variable and reports
   exactly which file failed by name and resolved destination, so silent
   failures are visible. Each path variable is unique because RouterOS local
   variables share the surrounding script scope. ── */
function portalFetch(
  url: string,
  subpath: string,
  filename: string,
  fetchOptions = ROUTER_HTTPS_FETCH_OPTIONS,
): string {
  const variableName = `portalPath${filename.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return `:local ${variableName} ($hsdir . "/${subpath}")
:do {
    /tool fetch url="${url}" dst-path=$${variableName} keep-result=yes ${fetchOptions}
    ${verifyFetchedFile(`$${variableName}`, filename)}
  } on-error={ :put ("  WARN: ${filename} failed at " . $${variableName} . " - " . $error) }`;
}

/* ── Safe remove: converts "/MENU remove [find COND]" into
   ":foreach x in=[/MENU find COND] do={ /MENU remove $x }"
   The foreach body only runs when items exist, so RouterOS never
   prints "no such item" — not even as a cosmetic message.
   Falls back to :do { } on-error={} for non-standard patterns. ── */
function safeRm(cmd: string): string {
  const cleaned = ros(cmd);
  const m = cleaned.match(/^(.+?)\s+remove\s+\[find\s+(.+)\]$/);
  if (m) {
    const menu = m[1];
    const cond = m[2];
    return `:foreach x in=[${menu} find ${cond}] do={ :do { ${menu} remove $x } on-error={} }`;
  }
  return `:do { ${cleaned} } on-error={}`;
}

function coexistenceBridgeName(routerId: number): string {
  return "co-hotspot-bridge";
}

function coexistenceGateway(routerId: number): string {
  const octet = (Math.abs(routerId) % 250) || 1;
  return `10.254.${octet}.1`;
}

type CoexistenceHotspotPlan = {
  name: string;
  speed_down: number;
  speed_up: number;
  validity: number;
  validity_unit: string;
  shared_users: number;
};

/* A deliberately separate service bundle for Coexistence mode. It never
   removes or rewrites an existing bridge, DHCP server, pool, hotspot, portal,
   firewall rule, or NAT rule. Every resource is uniquely named and checked
   before it is reused, so a name collision stops the import instead of
   silently sharing another billing system's service. */
function buildCoexistenceHotspotRsc(
  origin: string,
  routerId: number,
  routerName: string,
  companyName: string,
  plans: CoexistenceHotspotPlan[],
  certificateMode: RouterCertificateMode,
): string {
  const fetchOptions = certificateMode === "unverified"
    ? "mode=https check-certificate=no"
    : ROUTER_HTTPS_FETCH_OPTIONS;
  const bridgeName = coexistenceBridgeName(routerId);
  const gateway = coexistenceGateway(routerId);
  const subnet = gateway.replace(/\.1$/, ".0/24");
  const poolName = `ochola-hs-pool-${routerId}`;
  const dhcpName = `ochola-hs-dhcp-${routerId}`;
  const profileName = `ochola-hs-profile-${routerId}`;
  const hotspotName = `ochola-hs-server-${routerId}`;
  const portalDir = `ochola-hotspot-${routerId}`;
  const poolStart = gateway.replace(/\.1$/, ".2");
  const poolEnd = gateway.replace(/\.1$/, ".254");
  const tag = `${companyName} coexistence router ${routerId}`;
  const safe = (value: string) => rosString(value);
  const portalBase = origin.replace(/\/$/, "");
  const lines: string[] = [
    `# ${safe(companyName)} — isolated Coexistence hotspot service`,
    `# Router: ${safe(routerName)} (id=${routerId})`,
    `# Existing billing bridges and ports are intentionally untouched.`,
    `# Bridge: ${bridgeName} | Gateway: ${gateway} | Subnet: ${subnet}`,
    ``,
    `:do {`,
    `:put "COEXISTENCE SERVICE — ${safe(companyName)}"`,
    `:local bridgeName "${safe(bridgeName)}"`,
    `:local legacyBridgeName "co-hotspot-bridge-${routerId}"`,
    `:local olderBridgeName "ochola-hs-${routerId}"`,
    `:local bridgeTag "${safe(tag)}"`,
    `:local gateway "${safe(gateway)}"`,
    `:local subnet "${safe(subnet)}"`,
    `:local poolName "${safe(poolName)}"`,
    `:local dhcpName "${safe(dhcpName)}"`,
    `:local profileName "${safe(profileName)}"`,
    `:local hotspotName "${safe(hotspotName)}"`,
    `:local coexistenceStep "start"`,
    `:global ocholaCoexistenceError`,
    `:set ocholaCoexistenceError ""`,
    ``,
    `# Create only Ochola's bridge. A collision with an unowned bridge is fatal.`,
    `:set coexistenceStep "bridge"`,
    `:put "COEXISTENCE STEP: bridge"`,
    `:local existingBridge [/interface bridge find name=$bridgeName]`,
    `:if ([:len $existingBridge] = 0) do={`,
    `  :local legacyBridge [/interface bridge find name=$legacyBridgeName]`,
    `  :if ([:len $legacyBridge] = 0) do={ :set legacyBridge [/interface bridge find name=$olderBridgeName] }`,
    `  :if ([:len $legacyBridge] > 0) do={`,
    `    :local legacyComment [/interface bridge get $legacyBridge comment]`,
    `    :if ([:find $legacyComment "coexistence router ${routerId}"] = nil) do={ :set ocholaCoexistenceError "Coexistence bridge name collision: $legacyBridgeName is not owned by ${safe(companyName)}."; :error $ocholaCoexistenceError }`,
    `    /interface bridge set $legacyBridge name=$bridgeName`,
    `    :set existingBridge $legacyBridge`,
    `  }`,
    `}`,
    `:if ([:len $existingBridge] = 0) do={`,
    `  /interface bridge add name=$bridgeName protocol-mode=none fast-forward=no comment=$bridgeTag`,
    `} else={`,
    `  :local existingComment [/interface bridge get $existingBridge comment]`,
    `  :if ([:find $existingComment "coexistence router ${routerId}"] = nil) do={ :set ocholaCoexistenceError "Coexistence bridge name collision: $bridgeName is not owned by ${safe(companyName)}."; :error $ocholaCoexistenceError }`,
    `  /interface bridge set $existingBridge fast-forward=no`,
    `}`,
    ``,
    `# Never replace an address on this bridge. Only the exact owned address is accepted.`,
    `:set coexistenceStep "address"`,
    `:put "COEXISTENCE STEP: address"`,
    `:local ownedAddress [/ip address find interface=$bridgeName address="${safe(gateway)}/24"]`,
    `:if ([:len $ownedAddress] = 0) do={`,
    `  :if ([:len [/ip address find interface=$bridgeName]] > 0) do={ :set ocholaCoexistenceError "Coexistence bridge already has an unowned IP address."; :error $ocholaCoexistenceError }`,
    `  /ip address add address="${safe(gateway)}/24" interface=$bridgeName comment=$bridgeTag`,
    `}`,
    ``,
    `# Dedicated pool, DHCP server, and DHCP network.`,
    `:set coexistenceStep "dhcp"`,
    `:put "COEXISTENCE STEP: dhcp"`,
    `:local existingPool [/ip pool find name=$poolName]`,
    `:if ([:len $existingPool] = 0) do={`,
    `  /ip pool add name=$poolName ranges="${safe(poolStart)}-${safe(poolEnd)}" comment=$bridgeTag`,
    `} else={`,
    `  :if ([:tostr [/ip pool get $existingPool ranges]] != "${safe(poolStart)}-${safe(poolEnd)}") do={`,
    `    :local poolComment [/ip pool get $existingPool comment]`,
    `    :if ([:find $poolComment "coexistence router ${routerId}"] = nil) do={ :set ocholaCoexistenceError "Coexistence pool collision: $poolName has another range."; :error $ocholaCoexistenceError }`,
    `    /ip pool set $existingPool ranges="${safe(poolStart)}-${safe(poolEnd)}"`,
    `    :put "COEXISTENCE repaired the owned DHCP pool range."`,
    `  }`,
    `}`,
    `:local existingDhcp [/ip dhcp-server find name=$dhcpName]`,
    `:if ([:len $existingDhcp] = 0) do={`,
    `  /ip dhcp-server add name=$dhcpName interface=$bridgeName address-pool=$poolName disabled=no comment=$bridgeTag`,
    `} else={`,
    `  :if ([/ip dhcp-server get $existingDhcp interface] != $bridgeName) do={ :set ocholaCoexistenceError "Coexistence DHCP name collision: $dhcpName is bound to another interface."; :error $ocholaCoexistenceError }`,
    `  /ip dhcp-server enable $existingDhcp`,
    `}`,
    `:local existingNetwork [/ip dhcp-server network find address=$subnet]`,
    `:if ([:len $existingNetwork] = 0) do={`,
    `  /ip dhcp-server network add address=$subnet gateway=$gateway dns-server=$gateway comment=$bridgeTag`,
    `} else={`,
    `  :local networkComment [/ip dhcp-server network get $existingNetwork comment]`,
    `  :if ([:find $networkComment "coexistence router ${routerId}"] = nil) do={ :set ocholaCoexistenceError "Coexistence subnet collision: $subnet is already owned by another service."; :error $ocholaCoexistenceError }`,
    `}`,
    ``,
    `# Dedicated hotspot profile and server. Existing hotspot services are not touched.`,
    `:set coexistenceStep "hotspot"`,
    `:put "COEXISTENCE STEP: hotspot"`,
    `:local existingProfile [/ip hotspot profile find name=$profileName]`,
    `:if ([:len $existingProfile] = 0) do={`,
    `  /ip hotspot profile add name=$profileName hotspot-address=$gateway dns-name="wifi-${routerId}.local" login-by=http-chap,http-pap html-directory="${portalDir}"`,
    `} else={`,
    `  :if ([/ip hotspot profile get $existingProfile hotspot-address] != $gateway) do={ :set ocholaCoexistenceError "Coexistence hotspot profile collision: $profileName."; :error $ocholaCoexistenceError }`,
    `}`,
    `:local existingHotspot [/ip hotspot find name=$hotspotName]`,
    `:if ([:len $existingHotspot] = 0) do={`,
    `  /ip hotspot add name=$hotspotName interface=$bridgeName profile=$profileName address-pool=$poolName idle-timeout=none disabled=no`,
    `} else={`,
    `  :if ([/ip hotspot get $existingHotspot interface] != $bridgeName) do={ :set ocholaCoexistenceError "Coexistence hotspot server collision: $hotspotName."; :error $ocholaCoexistenceError }`,
    `  /ip hotspot enable $existingHotspot`,
    `}`,
    ``,
    `# Only this subnet is masqueraded; no global HTTP/HTTPS redirects are added.`,
    `:set coexistenceStep "nat-and-dns"`,
    `:put "COEXISTENCE STEP: nat-and-dns"`,
    `:local natComment "${safe(tag)} NAT"`,
    `:if ([:len [/ip firewall nat find comment=$natComment]] = 0) do={`,
    `  /ip firewall nat add chain=srcnat src-address=$subnet action=masquerade comment=$natComment`,
    `}`,
    `# Permit DNS queries from this service subnet without changing other billing rules.`,
    `:do { /ip dns set allow-remote-requests=yes } on-error={ :put "WARN: router DNS could not be enabled" }`,
    `:local dnsUdpComment "${safe(tag)} DNS UDP"`,
    `:local dnsTcpComment "${safe(tag)} DNS TCP"`,
    `:if ([:len [/ip firewall filter find comment=$dnsUdpComment]] = 0) do={ /ip firewall filter add chain=input protocol=udp dst-port=53 src-address=$subnet action=accept comment=$dnsUdpComment }`,
    `:if ([:len [/ip firewall filter find comment=$dnsTcpComment]] = 0) do={ /ip firewall filter add chain=input protocol=tcp dst-port=53 src-address=$subnet action=accept comment=$dnsTcpComment }`,
    ``,
    `# Keep the portal in its own directory so another billing system's files are not overwritten.`,
    `:set coexistenceStep "portal"`,
    `:put "COEXISTENCE STEP: portal"`,
    `:local storage ""`,
    `:if ([:len [/file find name="disk1" type=directory]] > 0) do={ :set storage "disk1" }`,
    `:if ($storage = "") do={ :if ([:len [/file find name="flash" type=directory]] > 0) do={ :set storage "flash" } }`,
    `:local hsdir "${portalDir}"`,
    `:if ([:len $storage] > 0) do={ :set hsdir ($storage . "/${portalDir}") }`,
    `:do { /file add name=$hsdir type=directory } on-error={}`,
    `:do { /file make-dir $hsdir } on-error={}`,
    `:put ("Portal directory: " . $hsdir)`,
    portalFetch(`${portalBase}/hotspot/login.html`, "login.html", "login.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/alogin.html`, "alogin.html", "alogin.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/logout.html`, "logout.html", "logout.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/status.html`, "status.html", "status.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/rlogin.html`, "rlogin.html", "rlogin.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/redirect.html`, "redirect.html", "redirect.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/error.html`, "error.html", "error.html", fetchOptions),
    portalFetch(`${portalBase}/hotspot/md5.js`, "md5.js", "md5.js", fetchOptions),
    portalFetch(`${portalBase}/hotspot/api.json`, "api.json", "api.json", fetchOptions),
    ``,
    `# Add plan profiles only when absent; never overwrite a profile owned by another system.`,
  ];

  for (const plan of plans) {
    const profile = slugify(plan.name).slice(0, 40) || "default";
    const rateLimit = toRateLimit(plan.speed_down, plan.speed_up, "Mbps");
    const timeout = toSessionTimeout(plan.validity, plan.validity_unit || "days");
    const shared = plan.shared_users || 1;
    lines.push(
      `:if ([:len [/ip hotspot user profile find name="${safe(profile)}"]] = 0) do={ /ip hotspot user profile add name="${safe(profile)}" rate-limit="${safe(rateLimit)}" session-timeout=${safe(timeout)} shared-users=${shared} comment="${safe(tag)} plan" }`,
    );
  }
  lines.push(
    ``,
    `:put "COEXISTENCE STEP: plans"`,
    `:put "COEXISTENCE SERVICE READY — ${safe(bridgeName)} belongs to ${safe(companyName)} only."`,
    `:put "Assign only unassigned physical ports to this bridge from the admin panel."`,
    `} on-error={`,
    `  :local coexistenceError $ocholaCoexistenceError`,
    `  :if ([:len $coexistenceError] = 0) do={ :set coexistenceError ("RouterOS aborted the coexistence bundle during " . $coexistenceStep . "; inspect the saved failed bundle and RouterOS log.") }`,
    `  :put ("COEXISTENCE BUNDLE FAILED at " . $coexistenceStep . ": " . $coexistenceError)`,
    `  :error ("Coexistence hotspot bundle failed at " . $coexistenceStep . ": " . $coexistenceError)`,
    `}`,
  );
  return lines.join("\r\n");
}

/* ── Router-management VPN auth updater ──
   Keeps the dedicated username:password file in sync with router credentials.
   The dedicated OpenVPN verify script reads this file on every connection attempt,
   so no OpenVPN reload is needed — just a file write.
   No-ops when the file doesn't exist (dev / non-VPS environments). ── */
const PSW_FILE = ROUTER_MANAGEMENT_VPN.authFilePath;
function updateVpnCredentials(username: string, password: string): void {
  try {
    const existing = existsSync(PSW_FILE) ? readFileSync(PSW_FILE, "utf-8") : "";
    const lines = existing.split("\n").filter(l => l.trim() && !l.startsWith(`${username}:`));
    lines.push(`${username}:${password}`);
    writeFileSync(PSW_FILE, lines.join("\n") + "\n", { mode: 0o600 });
  } catch { /* non-root dev env — silently skip */ }
}

function updateRouterVpnAssignment(username: string, ip: string): void {
  try {
    const dir = ROUTER_MANAGEMENT_VPN.ccdPath;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, username),
      `# Persistent MikroTik management address\nifconfig-push ${ip} ${ROUTER_VPN_GATEWAY}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* The API may not share the VPS filesystem in development. */
  }
}

/* Upsert a VPN user record in Supabase (isp_vpn_users table).
   Called when a router setup script is generated so every router
   automatically gets a corresponding VPN login. */
async function ensureVpnUser(adminId: number, username: string, password: string, routerName: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/isp_vpn_users`, {
      method: "POST",
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        /* Upsert: refresh the exact credential on (admin_id, username). */
        Prefer:          "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        admin_id:  adminId,
        username,
        password,
        notes:     `Auto — router: ${routerName}`,
        is_active: true,
      }),
    });
  } catch { /* ignore — non-critical */ }
}

/* ── Resolve the base origin for the requesting ISP.
   When a router at come.isplatty.org fetches a script, the Host
   header is "come.isplatty.org" → origin = "https://come.isplatty.org".
   Falls back to the literal host when no subdomain is present (dev). ── */
function resolveOrigin(host: string): string {
  const subdomain = parseSubdomain(host);
  if (subdomain) return `https://${subdomain}.isplatty.org`;
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

function requestOrigin(req: Request): string {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    .trim();
  const requestHost = forwardedHost || req.get("host") || "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  const hostname = requestHost.split(":")[0].toLowerCase();
  const isLocalHost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0";
  const publicHost = isLocalHost && process.env.REPLIT_DEV_DOMAIN
    ? process.env.REPLIT_DEV_DOMAIN
    : requestHost;
  if (parseSubdomain(publicHost)) return resolveOrigin(publicHost);
  const protocol = forwardedProto === "https"
    || req.protocol === "https"
    || publicHost !== requestHost
    ? "https"
    : (publicHost.startsWith("localhost") || publicHost.startsWith("127.") ? "http" : "https");
  return `${protocol}://${publicHost}`;
}

function routerVpnEndpointHost(origin: string): string {
  const configured = (
    process.env.ROUTER_OPENVPN_ENDPOINT
    || process.env.VPS_HOST
    || (process.env.NODE_ENV === "production" ? "" : origin)
  ).trim();
  if (configured) {
    return configured
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .replace(/:\d+$/, "")
      .trim();
  }
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

async function routerVpnEndpointAddress(origin: string): Promise<string> {
  const host = routerVpnEndpointHost(origin);
  if (!host || net.isIP(host) === 4) return host;
  if (net.isIP(host) === 6) {
    throw new Error("The router VPN endpoint must have a public IPv4 address.");
  }
  try {
    const result = await lookup(host, { family: 4 });
    return result.address;
  } catch (error) {
    throw new Error(`Could not resolve the router VPN endpoint "${host}" to an IPv4 address: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultRouterTunnelIp(routerId: number): string {
  return `10.8.5.${2 + ((routerId - 1) % 253)}`;
}

async function ensurePersistentRouterTunnelIp(routerId: number, existingIp?: string | null): Promise<string> {
  const used = new Set<string>(readIppEntries().values());
  const currentIp = isRouterVpnIp(existingIp) ? existingIp!.trim() : "";
  try {
    const routers = await sbGet<{ id: number; vpn_ip: string | null }>(
      "isp_routers?select=id,vpn_ip&vpn_ip=not.is.null",
    );
    for (const router of routers) {
      if (router.id !== routerId && isRouterVpnIp(router.vpn_ip)) used.add(router.vpn_ip!.trim());
    }
  } catch {
    /* The deterministic fallback below still gives an existing router a
       stable address when the metadata lookup is temporarily unavailable. */
  }

  if (currentIp) {
    used.delete(currentIp);
    try {
      if (!used.has(routerVpnPeerIp(currentIp))) return currentIp;
    } catch {
      /* Reallocate an address that cannot form a valid net30 pair. */
    }
  }

  let assigned: string;
  try {
    assigned = allocateRouterVpnIp(used);
  } catch {
    assigned = defaultRouterTunnelIp(routerId);
  }

  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/isp_routers?id=eq.${routerId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ vpn_ip: assigned, updated_at: new Date().toISOString() }),
      },
    );
  } catch {
    /* The generated script remains usable; registration will retry the save. */
  }
  return assigned;
}

/* ═══════════════════════════════════════════════════════════════
   mainhotspot.rsc — dynamic entry-point orchestrator.
   Sub-script URLs use the requesting ISP's own subdomain so each
   ISP downloads from their own origin, not a hardcoded company.
═══════════════════════════════════════════════════════════════ */
function buildMainhotspotRsc(
  scriptsBase: string,
  progressUrl: string = "",
  routerName: string = "",
  companyName: string = "ISPlatty",
  registrationUrl: string = "",
  heartbeatUrl: string = "",
  installerUrl: string = "",
  routerVpnUrl: string = "",
  routerWireGuardUrl: string = "",
  routerIpsecUrl: string = "",
  routerVpnIp: string = "",
  routerVpnWarning: string = "",
  certificateMode: RouterCertificateMode = "verified",
  installationMode: "coexist" | "takeover" = "takeover",
  coexistenceHotspotUrl: string = "",
): string {
  const ROUTER_HTTPS_FETCH_OPTIONS = certificateMode === "unverified"
    ? "mode=https check-certificate=no"
    : `mode=https check-certificate=yes`;
  const httpsTrustBootstrap = certificateMode === "unverified"
    ? `# HTTPS certificate validation is disabled for this installer by administrator choice.
# Traffic remains encrypted with HTTPS, but the router will not verify the server certificate.`
    : routerHttpsTrustBootstrap(scriptsBase);
  /* When progressUrl is set, every [N/7] step posts a status update to
     /api/isp/router/install-progress/<rid> so the admin Routers page can
     render a live timeline. The function pg is a no-op when no URL was
     provided, so existing routers still get the same script. */
  /* RouterOS string-literal escape: a router name like My"Bad\Router would
     otherwise terminate the string early or break the script. We escape
     backslashes and double-quotes; control characters are stripped so a
     copy-pasted name with newlines can't inject extra script lines. */
  const rscEscape = (s: string): string =>
    s.replace(/[\u0000-\u001F\u007F]/g, "")
     .replace(/\\/g, "\\\\")
     .replace(/"/g, '\\"');
  const safeProgressUrl = rscEscape(progressUrl);
  const safeRouterName  = rscEscape(routerName);
  const safeCompanyName = rscEscape(companyName) || "ISPlatty";
  const safeRegistrationUrl = rscEscape(registrationUrl);
  const safeHeartbeatUrl = rscEscape(heartbeatUrl);
  const safeInstallerUrl = rscEscape(installerUrl);
  const safeRouterVpnUrl = rscEscape(routerVpnUrl);
  const safeRouterWireGuardUrl = rscEscape(routerWireGuardUrl);
  const safeRouterIpsecUrl = rscEscape(routerIpsecUrl);
  const safeRouterVpnIp = rscEscape(routerVpnIp);
  const safeRouterVpnWarning = rscEscape(routerVpnWarning);
  const pgDef = progressUrl
    ? `:global IPProgUrl "${safeProgressUrl}"
:global IPRname "${safeRouterName}"
:global pg do={
    :global IPProgUrl
    :global IPRname
    :local body ("step=" . [:tostr $1] . "&name=" . [:tostr $2] . "&phase=" . [:tostr $3] . "&err=" . [:tostr $4] . "&rname=" . $IPRname)
    :do {
        /tool fetch url=$IPProgUrl http-method=post http-data=$body keep-result=no ${ROUTER_HTTPS_FETCH_OPTIONS}
    } on-error={}
}`
    : `:global pg do={}`;

  const versionedUrlAssignment = (
    variableName: string,
    url: string,
    minimumMajor = 6,
  ): string => minimumMajor >= 7
    ? `:if ($majorVersion >= 7) do={ :set ${variableName} ("${url}&ros-version=" . [:tostr $majorVersion]) } else={ :set ${variableName} "" }`
    : `:set ${variableName} ("${url}&ros-version=" . [:tostr $majorVersion])`;
  const openVpnSelection = routerVpnUrl
    ? versionedUrlAssignment("openVpnUrl", safeRouterVpnUrl)
    : `:if ($majorVersion >= 7) do={ :set openVpnUrl "${scriptsBase}/vpn7.rsc" } else={ :set openVpnUrl "${scriptsBase}/vpn6.rsc" }`;
  const vpnAttempt = (protocol: string, urlVariable: string, fileName: string): string => {
    const tempFileName = `${fileName}.download`;
    const failureDiagnostics = protocol === "openvpn"
      ? `:put "  OpenVPN diagnostic state (credentials are intentionally omitted):"
         :do {
             :local ovpnIds [/interface ovpn-client find]
             :if ([:len $ovpnIds] > 0) do={
                 :foreach ovpnId in=$ovpnIds do={
                     :put ("    name=" . [/interface ovpn-client get $ovpnId name] . " running=" . [/interface ovpn-client get $ovpnId running] . " disabled=" . [/interface ovpn-client get $ovpnId disabled] . " connect-to=" . [/interface ovpn-client get $ovpnId connect-to] . " port=" . [/interface ovpn-client get $ovpnId port])
                 }
             } else={
                 :put "    no OpenVPN client interfaces were found."
             }
         } on-error={ :put "    RouterOS could not read OpenVPN interface state." }
         :put "  Recent RouterOS OpenVPN log entries (if supported):"
         :do { /log print where topics~"ovpn" } on-error={ :put "    RouterOS did not expose filtered OpenVPN logs." }`
      : "";
    return `:if (!$vpnConfigured) do={
    :do {
        :global ocholaVpnChildError
        :set ocholaVpnChildError ""
         :if ([:len $${urlVariable}] = 0) do={
             :error "${protocol}: no compatible RouterOS child script was selected"
         }
        $pg 1 "vpn-${protocol}" "downloading" ""
        :put "[1/7] Trying ${protocol.toUpperCase()} router-management VPN..."
        :do { /file remove [find name="${tempFileName}"] } on-error={}
        /tool fetch url=$${urlVariable} dst-path="${tempFileName}" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
        ${verifyFetchedFile(`"${tempFileName}"`, tempFileName, true)}
        :delay 2s
         :if ($majorVersion >= 7) do={
             :local preflightError ""
             :do {
                 /import "${tempFileName}" verbose=yes dry-run
             } on-error={
                 :set preflightError $error
             }
             :if ([:len $preflightError] > 0) do={
                 :set ocholaVpnChildError ("${protocol}: RouterOS 7 dry-run rejected the child script: " . $preflightError)
                 :error $ocholaVpnChildError
             }
         }
        :do {
            /import "${tempFileName}"
        } on-error={
            :local importError ""
            :do { :set importError $error } on-error={}
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "${protocol}: child script import failed; inspect failed-${fileName} and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="${fileName}"] } on-error={}
        /file set [find name="${tempFileName}"] name="${fileName}"
        :set vpnConfigured true
        :set vpnProtocol "${protocol}"
        :put "      ${protocol.toUpperCase()} router-management VPN verified."
        $pg 1 "vpn-${protocol}" "applied" ""
    } on-error={
        :local vpnError $ocholaVpnChildError
        :if ([:len $vpnError] = 0) do={
            :set vpnError "${protocol}: child script import failed. Check failed-${fileName} and /log for the RouterOS error."
        }
        :put ("  WARN [vpn-${protocol}] FAILED: " . $vpnError)
        ${failureDiagnostics}
        :set vpnFailureSummary ($vpnFailureSummary . "${protocol}: " . $vpnError . "; ")
        $pg 1 "vpn-${protocol}" "failed" $vpnError
        :do { /file remove [find name="failed-${fileName}"] } on-error={}
        :do { /file set [find name="${tempFileName}"] name="failed-${fileName}" } on-error={}
    }
}`;
  };
  const wireGuardAttempt = routerWireGuardUrl
    ? `:if ($majorVersion >= 7) do={\n${vpnAttempt("wireguard", "wireGuardUrl", "vpn-wireguard.rsc")}\n}`
    : "";
  const ipsecAttempt = routerIpsecUrl
    ? vpnAttempt("ipsec", "ipsecUrl", "vpn-ipsec.rsc")
    : "";

  if (installationMode === "coexist") {
    return `# ${safeCompanyName} — Coexistence management installer
# This path never replaces billing, customer-access, or LAN configuration.
# It audits existing resources, then adds only Ochola management resources.

${pgDef}
${httpsTrustBootstrap}
${safeRouterVpnWarning ? `:put "WARNING: ${safeRouterVpnWarning}"` : ""}

:local bridgeCount [:len [/interface bridge find]]
:local hotspotCount [:len [/ip hotspot find]]
:local dhcpCount [:len [/ip dhcp-server find]]
:local poolCount [:len [/ip pool find]]
:local radiusCount [:len [/radius find]]
:local filterCount [:len [/ip firewall filter find]]
:local natCount [:len [/ip firewall nat find]]
:local ovpnCount [:len [/interface ovpn-client find]]
:local ipsecCount [:len [/ip ipsec peer find]]
:local hotspotUserCount [:len [/ip hotspot user find]]
:local pppUserCount [:len [/ppp secret find]]
:local fileCount [:len [/file find]]
:put ("COEXISTENCE AUDIT — bridges=" . $bridgeCount . ", hotspots=" . $hotspotCount . ", dhcp=" . $dhcpCount . ", pools=" . $poolCount . ", radius=" . $radiusCount . ", firewall=" . $filterCount . ", nat=" . $natCount . ", ovpn=" . $ovpnCount . ", ipsec=" . $ipsecCount . ", hotspot-users=" . $hotspotUserCount . ", ppp-users=" . $pppUserCount . ", files=" . $fileCount)
$pg 0 "coexistence-audit" "audited" ("bridges=" . $bridgeCount . ";hotspots=" . $hotspotCount . ";dhcp=" . $dhcpCount . ";pools=" . $poolCount . ";radius=" . $radiusCount . ";firewall=" . $filterCount . ";nat=" . $natCount . ";ovpn=" . $ovpnCount . ";ipsec=" . $ipsecCount . ";hotspot-users=" . $hotspotUserCount . ";ppp-users=" . $pppUserCount . ";files=" . $fileCount)

:local vpnConfigured false
:local vpnProtocol ""
:local vpnFailureSummary ""
:local routerOsVersion [/system resource get version]
:local routerOsMajorDigit [:pick $routerOsVersion 0 1]
:local majorVersion 0
:if ($routerOsMajorDigit = "7") do={
    :set majorVersion 7
} else={
    :if ($routerOsMajorDigit = "6") do={
        :set majorVersion 6
    } else={
        :error ("Unsupported RouterOS version \"" . $routerOsVersion . "\". Only RouterOS 6.48+ and 7.x are supported.")
    }
}
:if ([/ping 8.8.8.8 count=3] = 0) do={ :error "The router has no internet access; coexistence stopped before any configuration was added." }
:local openVpnUrl ""
    :local wireGuardUrl ""
    :local ipsecUrl ""
${openVpnSelection}
    ${routerWireGuardUrl ? versionedUrlAssignment("wireGuardUrl", safeRouterWireGuardUrl, 7) : `:set wireGuardUrl ""`}
    ${routerIpsecUrl ? versionedUrlAssignment("ipsecUrl", safeRouterIpsecUrl) : `:set ipsecUrl ""`}
${vpnAttempt("openvpn", "openVpnUrl", "ochola-coexist-vpn-openvpn.rsc")}
${wireGuardAttempt.replaceAll("vpn-wireguard.rsc", "ochola-coexist-vpn-wireguard.rsc")}
${ipsecAttempt.replaceAll("vpn-ipsec.rsc", "ochola-coexist-vpn-ipsec.rsc")}
:if (!$vpnConfigured) do={
    :put ("COEXISTENCE STOPPED — no management VPN was installed. " . $vpnFailureSummary)
    $pg 1 "coexistence" "failed" $vpnFailureSummary
    :error ("Coexistence stopped without changing existing billing resources: " . $vpnFailureSummary)
}
:put ("COEXISTENCE VPN READY — " . $vpnProtocol . " added; existing customer configuration was not replaced.")
$pg 1 "coexistence-vpn" "applied" ("management-vpn=" . $vpnProtocol)
${coexistenceHotspotUrl ? `
# Install Ochola's isolated hotspot service only after the management VPN is ready.
:local coexistenceBundleBytes ""
:local coexistencePreflightError ""
:do {
    :global ocholaCoexistenceError
    :set ocholaCoexistenceError ""
    :do { /file remove [find name="ochola-coexistence-hotspot.rsc.download"] } on-error={}
    /tool fetch url="${rscEscape(coexistenceHotspotUrl)}" dst-path="ochola-coexistence-hotspot.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile('"ochola-coexistence-hotspot.rsc.download"', "ochola-coexistence-hotspot.rsc.download")}
    :set coexistenceBundleBytes [/file get [find name="ochola-coexistence-hotspot.rsc.download"] size]
    :put ("COEXISTENCE BUNDLE DOWNLOADED: " . $coexistenceBundleBytes . " bytes")
    # RouterOS 7 can report the exact source line and column for import-time
    # syntax/property failures without changing configuration. RouterOS 6
    # does not have this import option, so the normal import remains the
    # compatibility path there.
    :if ($majorVersion >= 7) do={
        :do {
            /import "ochola-coexistence-hotspot.rsc.download" verbose=yes dry-run
        } on-error={
            :set coexistencePreflightError $error
        }
        :if ([:len $coexistencePreflightError] > 0) do={
            :error ("coexistence hotspot dry-run failed: " . $coexistencePreflightError)
        }
    }
    /import "ochola-coexistence-hotspot.rsc.download"
    :do { /file set [find name="ochola-coexistence-hotspot.rsc.download"] name="ochola-coexistence-hotspot.rsc" } on-error={}
    $pg 1 "coexistence-hotspot" "applied" ""
} on-error={
    :global ocholaCoexistenceError
    :local hotspotError $ocholaCoexistenceError
    :if ([:len $hotspotError] = 0) do={
        :set hotspotError ("isolated hotspot bundle import failed after " . $coexistenceBundleBytes . " bytes; inspect failed-ochola-coexistence-hotspot.rsc and the RouterOS log for the failing stage.")
    }
    :put ("COEXISTENCE STOPPED — isolated hotspot service was not installed: " . $hotspotError)
    $pg 1 "coexistence-hotspot" "failed" $hotspotError
    :do { /file remove [find name="failed-ochola-coexistence-hotspot.rsc"] } on-error={}
    :do { /file set [find name="ochola-coexistence-hotspot.rsc.download"] name="failed-ochola-coexistence-hotspot.rsc" } on-error={}
    :error ("Coexistence stopped without changing existing billing resources; isolated hotspot failed: " . $hotspotError)
}
` : `:put "COEXISTENCE STOPPED — isolated hotspot bundle missing."; $pg 1 "coexistence-hotspot" "failed" "missing bundle"; :error "Coexistence stopped without changing existing billing resources: isolated hotspot bundle missing."`}
${safeHeartbeatUrl ? `:do {
    /tool fetch url="${safeHeartbeatUrl}?coexist=1" keep-result=no ${ROUTER_HTTPS_FETCH_OPTIONS}
    :put "COEXISTENCE HEARTBEAT SENT — existing customer services remain under their current configuration."
} on-error={ :put "WARN: coexistence heartbeat could not be sent; retry the installer after the VPN is up." }
` : ""}
`;
  }

  const takeoverBackupStem = installationMode === "takeover" ? `ochola-takeover-${Date.now()}` : "";
  const takeoverBackup = installationMode === "takeover"
    ? `# TAKEOVER SAFETY BOUNDARY — no service resource is changed before both files exist.
:local takeoverBackup "${takeoverBackupStem}"
:do { /system backup save name=$takeoverBackup } on-error={ :error "Takeover stopped: RouterOS could not create the binary backup." }
:delay 3s
:if ([:len [/file find name="${takeoverBackupStem}.backup"]] = 0) do={ :error "Takeover stopped: the RouterOS binary backup could not be verified." }
:do { /export file=$takeoverBackup } on-error={ :error "Takeover stopped: RouterOS could not create the text export." }
:delay 2s
:if ([:len [/file find name="${takeoverBackupStem}.rsc"]] = 0) do={ :error "Takeover stopped: the RouterOS text export could not be verified." }
:put "TAKEOVER BACKUP VERIFIED — binary backup and text export are present."
`
    : "";

  return `# ${safeCompanyName} Main ISP Setup Script (mainhotspot.rsc)
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.
# Router: ${safeRouterName || "new router"}
#
# INSTALL BUNDLE — downloaded in this order:
#   1. router VPN child scripts                 (OpenVPN → WireGuard → IPsec)
#   2. hotspotsetup.rsc -> hotspotsetup.rsc  (required)
#   3. pppoesetup.rsc   -> pppoesetup.rsc     (required)
#   4. users.rsc        -> users.rsc          (required)
#   5. syncusers.rsc    -> syncusers.rsc      (required)
#   6. heartbeat.rsc    -> heartbeat.rsc      (required)
#   7. syncfull.rsc     -> syncfull.rsc       (required)
#   8. logpush.rsc and seclogpush.rsc are optional diagnostics.
# Hotspot portal files are downloaded by the per-router configuration script
# into the selected root/hotspot, flash/hotspot, or disk1/hotspot directory.

${pgDef}

# Takeover is a separate, destructive path. Its safety boundary runs first.
${takeoverBackup}

# Bootstrap the public CA before any HTTPS download is verified.
${httpsTrustBootstrap}

${safeRouterVpnWarning ? `:put "WARNING: ${safeRouterVpnWarning}"` : ""}

:local routerOsVersion [/system resource get version]
:local routerOsMajorDigit [:pick $routerOsVersion 0 1]
:local majorVersion 0
:local minorVersion 0
:if ($routerOsMajorDigit = "7") do={
    :set majorVersion 7
} else={
    :if ($routerOsMajorDigit = "6") do={
        :set majorVersion 6
        :local firstDot [:find $routerOsVersion "."]
        :local remaining [:pick $routerOsVersion ($firstDot + 1) [:len $routerOsVersion]]
        :local secondDot [:find $remaining "."]
        :if ([:len $secondDot] > 0) do={
            :set minorVersion [:tonum [:pick $remaining 0 $secondDot]]
        } else={
            :set minorVersion [:tonum $remaining]
        }
    } else={
        :error ("Unsupported RouterOS version \"" . $routerOsVersion . "\". Only RouterOS 6.48+ and 7.x are supported.")
    }
}
:if ($majorVersion < 6 || ($majorVersion = 6 && $minorVersion < 48)) do={
    :put "RouterOS version 6.48 or higher is required."
    :error "RouterOS version 6.48 or higher is required."
}
:if ([/ping 8.8.8.8 count=3] = 0) do={
    :error "No internet connection. Please check your internet connection and try again."
}
:local failures 0
:put "======================================================"
:put " ${safeCompanyName} router setup"
:put "======================================================"

# --- Ordered router-management VPN fallback -----------------------------------
# Attempts OpenVPN first, then WireGuard, then IPsec. Each child must verify
# its own resources; a successful child prevents all later children from running.
:local openVpnUrl
${openVpnSelection}
  :local wireGuardUrl ""
  :local ipsecUrl ""
:local vpnConfigured false
:local vpnProtocol ""
:local vpnFailureSummary ""
  ${routerWireGuardUrl ? versionedUrlAssignment("wireGuardUrl", safeRouterWireGuardUrl, 7) : `:set wireGuardUrl ""`}
  ${routerIpsecUrl ? versionedUrlAssignment("ipsecUrl", safeRouterIpsecUrl) : `:set ipsecUrl ""`}
${vpnAttempt("openvpn", "openVpnUrl", "vpn-openvpn.rsc")}
${wireGuardAttempt}
${ipsecAttempt}
:if (!$vpnConfigured) do={
    :set failures ($failures + 1)
    :put ("  ERROR: no router-management VPN protocol succeeded. " . $vpnFailureSummary)
    $pg 1 "vpn" "failed" $vpnFailureSummary
} else={
    :put ("      Selected router-management VPN: " . $vpnProtocol)
}

# --- Hotspot configuration ----------------------------------------------------
:do {
    $pg 2 "hotspot" "downloading" ""
    :put "[2/7] Downloading hotspot configuration..."
    :do { /file remove [find name="hotspotsetup.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/hotspotsetup.rsc" dst-path="hotspotsetup.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"hotspotsetup.rsc.download"`, "hotspotsetup.rsc.download")}
    :delay 2s
    :put "      Applying hotspot configuration..."
    /import "hotspotsetup.rsc.download"
    :do { /file remove [find name="hotspotsetup.rsc"] } on-error={}
    /file set [find name="hotspotsetup.rsc.download"] name="hotspotsetup.rsc"
    :put "      Hotspot configuration applied; saved as hotspotsetup.rsc."
    $pg 2 "hotspot" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [hotspotsetup.rsc] FAILED: " . $error)
    $pg 2 "hotspot" "failed" $error
    :do { /file remove [find name=failed-hotspotsetup.rsc] } on-error={}
    :do { /file set [find name=hotspotsetup.rsc.download] name=failed-hotspotsetup.rsc } on-error={}
}

# --- PPPoE configuration ------------------------------------------------------
:do {
    $pg 3 "pppoe" "downloading" ""
    :put "[3/7] Downloading PPPoE configuration..."
    :do { /file remove [find name="pppoesetup.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/pppoesetup.rsc" dst-path="pppoesetup.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"pppoesetup.rsc.download"`, "pppoesetup.rsc.download")}
    :delay 2s
    :put "      Applying PPPoE configuration..."
    /import "pppoesetup.rsc.download"
    :do { /file remove [find name="pppoesetup.rsc"] } on-error={}
    /file set [find name="pppoesetup.rsc.download"] name="pppoesetup.rsc"
    :put "      PPPoE configuration applied; saved as pppoesetup.rsc."
    $pg 3 "pppoe" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [pppoesetup.rsc] FAILED: " . $error)
    $pg 3 "pppoe" "failed" $error
    :do { /file remove [find name=failed-pppoesetup.rsc] } on-error={}
    :do { /file set [find name=pppoesetup.rsc.download] name=failed-pppoesetup.rsc } on-error={}
}

# --- Users configuration ------------------------------------------------------
:do {
    $pg 4 "users" "downloading" ""
    :put "[4/7] Downloading users configuration..."
    :do { /file remove [find name="users.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/users.rsc" dst-path="users.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"users.rsc.download"`, "users.rsc.download")}
    :delay 2s
    :put "      Applying users configuration..."
    /import "users.rsc.download"
    :do { /file remove [find name="users.rsc"] } on-error={}
    /file set [find name="users.rsc.download"] name="users.rsc"
    :put "      Users configuration applied; saved as users.rsc."
    $pg 4 "users" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [users.rsc] FAILED: " . $error)
    $pg 4 "users" "failed" $error
    :do { /file remove [find name=failed-users.rsc] } on-error={}
    :do { /file set [find name=users.rsc.download] name=failed-users.rsc } on-error={}
}

# --- Sync-users firewalls -----------------------------------------------------
:do {
    $pg 5 "syncusers" "downloading" ""
    :put "[5/7] Downloading sync-users firewalls..."
    :do { /file remove [find name="syncusers.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/syncusers.rsc" dst-path="syncusers.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"syncusers.rsc.download"`, "syncusers.rsc.download")}
    :delay 2s
    :put "      Applying sync-users firewalls..."
    /import "syncusers.rsc.download"
    :do { /file remove [find name="syncusers.rsc"] } on-error={}
    /file set [find name="syncusers.rsc.download"] name="syncusers.rsc"
    :put "      Sync-users firewalls applied; saved as syncusers.rsc."
    $pg 5 "syncusers" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [syncusers.rsc] FAILED: " . $error)
    $pg 5 "syncusers" "failed" $error
    :do { /file remove [find name=failed-syncusers.rsc] } on-error={}
    :do { /file set [find name=syncusers.rsc.download] name=failed-syncusers.rsc } on-error={}
}

# --- Heartbeat firewalls ------------------------------------------------------
:do {
    $pg 6 "heartbeat" "downloading" ""
    :put "[6/7] Downloading heartbeat firewalls..."
    :do { /file remove [find name="heartbeat.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/heartbeat.rsc" dst-path="heartbeat.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"heartbeat.rsc.download"`, "heartbeat.rsc.download")}
    :delay 2s
    :put "      Applying heartbeat firewalls..."
    /import "heartbeat.rsc.download"
    :do { /file remove [find name="heartbeat.rsc"] } on-error={}
    /file set [find name="heartbeat.rsc.download"] name="heartbeat.rsc"
    :put "      Heartbeat firewalls applied; saved as heartbeat.rsc."
    $pg 6 "heartbeat" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [heartbeat.rsc] FAILED: " . $error)
    $pg 6 "heartbeat" "failed" $error
    :do { /file remove [find name=failed-heartbeat.rsc] } on-error={}
    :do { /file set [find name=heartbeat.rsc.download] name=failed-heartbeat.rsc } on-error={}
}

# --- Router-specific heartbeat endpoint ---------------------------------------
# The generic heartbeat bootstrap intentionally has no router secret. Replace it
# here with this router's authenticated URL and run it once immediately so the
# saved-router gate receives a genuine connection proof.
${safeHeartbeatUrl ? `:do {
    /system script remove [find name=ochola-heartbeat-script]
    /system scheduler remove [find name=ochola-heartbeat]
    /system script add name=ochola-heartbeat-script policy=read,write,test source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; :do { /tool fetch url=(\\"${safeHeartbeatUrl}?hs=\\" . [:tostr \\$hs]) ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path=hb.tmp } on-error={}; :do { /file remove [find name=hb.tmp] } on-error={}"
    /system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${safeCompanyName} heartbeat"
    /system script run ochola-heartbeat-script
    :put "      Authenticated heartbeat installed and sent."
} on-error={ :put "  WARN [heartbeat] authenticated heartbeat install failed" }
` : `# This generic script has no saved-router token, so its heartbeat remains disabled.`}

# --- Sync-full script ---------------------------------------------------------
:do {
    $pg 7 "syncfull" "downloading" ""
    :put "[7/7] Downloading sync-full script..."
    :do { /file remove [find name="syncfull.rsc.download"] } on-error={}
    /tool fetch url="${scriptsBase}/syncfull.rsc" dst-path="syncfull.rsc.download" keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"syncfull.rsc.download"`, "syncfull.rsc.download")}
    :delay 2s
    :put "      Applying sync-full script..."
    /import "syncfull.rsc.download"
    :do { /file remove [find name="syncfull.rsc"] } on-error={}
    /file set [find name="syncfull.rsc.download"] name="syncfull.rsc"
    :put "      Sync-full script applied; saved as syncfull.rsc."
    $pg 7 "syncfull" "applied" ""
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [syncfull.rsc] FAILED: " . $error)
    $pg 7 "syncfull" "failed" $error
    :do { /file remove [find name=failed-syncfull.rsc] } on-error={}
    :do { /file set [find name=syncfull.rsc.download] name=failed-syncfull.rsc } on-error={}
}

# --- Preserve the personalized installer on daily updates ---------------------
# syncfull.rsc installs a generic fallback scheduler. Replace it here only when
# this installer was bound to a validated router record, otherwise generic
# downloads must remain tokenless and unable to report as a saved router.
${safeInstallerUrl ? `:do {
    /system scheduler remove [find name=ochola-autoupdate]
    /system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${safeInstallerUrl}\\" dst-path=mainhotspot.rsc ${ROUTER_HTTPS_FETCH_OPTIONS}; /import mainhotspot.rsc" comment="${safeCompanyName} personalized auto-update"
    :put "      Personalized auto-update scheduler installed."
} on-error={ :put "  WARN [auto-update] personalized scheduler install failed" }
` : `# Generic installers intentionally retain the tokenless update scheduler.`}

# --- Optional diagnostic logging ----------------------------------------------
:do {
    :put "Downloading diagnostic log-push script..."
    /tool fetch url="${scriptsBase}/logpush.rsc" dst-path=logpush.rsc keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"logpush.rsc"`, "logpush.rsc")}
    :delay 2s
    /import logpush.rsc
    :put "Diagnostic log-push installed; saved as logpush.rsc."
} on-error={ :put ("Diagnostic log-push install skipped; check logpush.rsc - " . $error) }

# --- Optional API hardening ----------------------------------------------------
:do {
    :put "Downloading API security script..."
    /tool fetch url="${scriptsBase}/seclogpush.rsc" dst-path=seclogpush.rsc keep-result=yes ${ROUTER_HTTPS_FETCH_OPTIONS}
    ${verifyFetchedFile(`"seclogpush.rsc"`, "seclogpush.rsc")}
    :delay 2s
    /import seclogpush.rsc
    :put "API security script installed; saved as seclogpush.rsc."
} on-error={ :put ("API security install skipped; check seclogpush.rsc - " . $error) }

# --- DNS flush scheduler ------------------------------------------------------
:do {
    :put "Setting up DNS flush scheduler..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
    /ip dns cache flush
    :put "DNS flush scheduler installed (every 6 hours)."
} on-error={
    :set failures ($failures + 1)
    :put ("  WARN [dns-flush] FAILED: " . $error)
}

# --- Report the installed router to this ISP's current app --------------------
${safeRegistrationUrl ? `:put "Reporting router to ${safeCompanyName}..."
:local reportedIp "${safeRouterVpnIp}"
:if ($reportedIp = "") do={
    :if ($reportedIp = "") do={
        :foreach a in=[/ip address find where interface="corebillingvpn"] do={
            :set reportedIp [/ip address get $a address]
        }
        :if ($reportedIp = "") do={
            :foreach a in=[/ip address find where interface="coreispbilling"] do={
                :set reportedIp [/ip address get $a address]
            }
        }
    }
    :if ($reportedIp = "") do={
        :foreach a in=[/ip address find where interface="ocholasupernet"] do={
            :set reportedIp [/ip address get $a address]
        }
    }
}
:if ($reportedIp != "") do={
    :local slashPos [:find $reportedIp "/"]
    :if ([:len $slashPos] > 0) do={ :set reportedIp [:pick $reportedIp 0 $slashPos] }
    :local rm ""
    :local ri ""
    :local rv ""
    :do { :set rm [/system routerboard get model] } on-error={}
    :do { :set ri [/system identity get name] } on-error={}
    :do { :set rv [/system package get [find name=routeros] version] } on-error={}
    :do {
        /tool fetch url=("${safeRegistrationUrl}?model=" . $rm . "&rname=" . $ri . "&ver=" . $rv . "&ip=" . $reportedIp) ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path=router-register.tmp
        :do { /file remove router-register.tmp } on-error={}
        :put ("Reported router VPN IP " . $reportedIp . " to ${safeCompanyName}")
    } on-error={ :put "Router registration report failed (ignored)" }
} else={
    :put "Management VPN has no IP yet; skipping router registration report"
}
` : `# Router registration is enabled when this script is generated for a saved router.`}

# --- Keep install noise out of the normal system log --------------------------
:do {
    /system logging set [find topics="warning"] topics=warning,!script
    /system logging set [find topics="script"] topics=script,!warning
    :put "Log script-warning suppression applied"
} on-error={ :put "Log suppression skipped (non-fatal)" }

:if ($failures = 0) do={
    :put "${safeCompanyName}: all configurations completed successfully."
} else={
    :put ("${safeCompanyName}: setup finished with " . $failures . " failed step(s) - see WARN lines above.")
}

# Final completion ping for the admin progress timeline (no-op when pg was disabled)
:do {
    :global IPProgUrl
    :global IPRname
    :if ([:typeof $IPProgUrl] = "str" && [:len $IPProgUrl] > 0) do={
        /tool fetch url=$IPProgUrl http-method=post http-data=("done=1&rname=" . $IPRname) keep-result=no ${ROUTER_HTTPS_FETCH_OPTIONS}
    }
} on-error={}
`;
}

router.get(`/scripts/${ROUTER_HTTPS_CERTIFICATE_FILE}`, (_req, res): void => {
  res
    .status(200)
    .type("application/x-pem-file")
    .set("Cache-Control", "public, max-age=31536000, immutable")
    .send(ISRG_ROOT_X1_PEM);
});

router.post("/admin/router/self-install/takeover/prepare", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.body?.routerId);
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  const confirmation = String(req.body?.confirmation ?? "").trim();
  if (!Number.isSafeInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid signed-in ISP account and router are required." });
    return;
  }
  if (confirmation !== TAKEOVER_CONFIRMATION) {
    res.status(400).json({ ok: false, error: `Type ${TAKEOVER_CONFIRMATION} exactly to authorize takeover.` });
    return;
  }
  if (!takeoverGrantSecret()) {
    res.status(503).json({ ok: false, error: "Takeover authorization is not configured on this server." });
    return;
  }

  try {
    const routers = await sbGet<{ id: number; admin_id: number; name: string }>(
      `isp_routers?id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name&limit=1`,
    );
    const selectedRouter = routers[0];
    if (!selectedRouter) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    res.json({
      ok: true,
      router: { id: selectedRouter.id, name: selectedRouter.name },
      grantToken: createTakeoverGrant(adminId, routerId),
      expiresInSeconds: TAKEOVER_GRANT_TTL_MS / 1000,
      confirmation: TAKEOVER_CONFIRMATION,
      removalPlan: TAKEOVER_PLAN,
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: `Takeover preparation failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

router.post("/admin/router/self-install/grant", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.body?.routerId);
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  if (!Number.isSafeInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid signed-in ISP account and router are required." });
    return;
  }
  if (!takeoverGrantSecret()) {
    res.status(503).json({ ok: false, error: "Installer authorization is not configured on this server." });
    return;
  }
  try {
    const routers = await sbGet<{ id: number; admin_id: number; name: string }>(
      `isp_routers?id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name&limit=1`,
    );
    if (!routers[0]) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    res.json({ ok: true, grantToken: createInstallerGrant(adminId, routerId), expiresInSeconds: 30 * 60 });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: `Installer authorization failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

router.get("/scripts/mainhotspot.rsc", async (req, res): Promise<void> => {
  const origin = requestOrigin(req);
  const scriptsBase = `${origin}/api/scripts`;
  /* Optional ?rid=N&name=routerName&token=<router_secret> turns on per-step
     progress callbacks. The admin UI may instead send rid+adminId; in that
     case the server resolves the router secret here so credentials never
     need to be placed in a browser URL. Without rid+token/adminId the script
     runs exactly as before (no callbacks). */
  const ridRaw   = ((req.query.rid   ?? "") as string).trim();
  const tokenRaw = ((req.query.token ?? "") as string).trim();
  const adminIdRaw = ((req.query.adminId ?? "") as string).trim();
  const installationMode: "coexist" | "takeover" = String(req.query.mode ?? "").trim().toLowerCase() === "takeover"
    ? "takeover"
    : "coexist";
  const takeoverGrant = String(req.query.grant ?? "").trim();
  const rid    = /^\d+$/.test(ridRaw) ? ridRaw : "";
  const token  = /^[A-Za-z0-9_\-]{8,128}$/.test(tokenRaw) ? tokenRaw : "";
  const adminId = /^\d+$/.test(adminIdRaw) ? adminIdRaw : "";
  const certificateMode: RouterCertificateMode = ["off", "none", "disabled", "unverified"]
    .includes(String(req.query.certificate ?? "").trim().toLowerCase())
    ? "unverified"
    : "verified";
  const rname  = ((req.query.name  ?? "") as string).trim().slice(0, 80);
  let companyName = "ISPlatty";
  let resolvedRouterName = rname;
  let registrationUrl = "";
  let heartbeatUrl = "";
  let installerUrl = "";
  let routerVpnUrl = "";
  let routerWireGuardUrl = "";
  let routerIpsecUrl = "";
  let coexistenceHotspotUrl = "";
  let vpnProvisioningError = "";

  interface InstallRouter {
    admin_id: number; name: string; vpn_ip?: string | null;
    router_secret?: string | null; token?: string | null;
  }
  interface InstallAdmin { id: number; name: string; }
  let routerVpnIp = "";
  let resolvedToken = token;

  if (installationMode === "takeover") {
    const grant = verifyTakeoverGrant(takeoverGrant, Number(rid));
    if (!grant || !adminId || grant.adminId !== Number(adminId)) {
      res.status(403).type("text/plain").send("# Takeover authorization is missing, invalid, expired, or scoped to another ISP/router.");
      return;
    }
  } else if (adminId && !verifyInstallerGrant(takeoverGrant, Number(rid))) {
    res.status(403).type("text/plain").send("# Installer authorization is missing, invalid, expired, or scoped to another ISP/router.");
    return;
  }
  const takeoverGrantQuery = installationMode === "takeover"
    ? `&grant=${encodeURIComponent(takeoverGrant)}`
    : "";

  try {
    if (rid && (token || adminId)) {
      /* A valid router secret binds the install script to a specific ISP.
         For the browser-safe path, adminId is checked against the router
         owner and the secret is read only on the server. */
      const ownerFilter = token && installationMode !== "takeover"
        ? `or=(router_secret.eq.${encodeURIComponent(token)},token.eq.${encodeURIComponent(token)})`
        : `admin_id=eq.${encodeURIComponent(adminId)}`;
      const routers = await sbGet<InstallRouter>(
        `isp_routers?id=eq.${rid}&${ownerFilter}&select=admin_id,name,vpn_ip,router_secret,token&limit=1`,
      );
      const currentRouter = routers[0];
      if (currentRouter) {
        const openVpnCredentials = routerManagementOvpnCredentials(currentRouter.name);
        const assignedIp = await ensurePersistentRouterTunnelIp(Number(rid), currentRouter.vpn_ip);
        resolvedToken = resolvedToken || currentRouter.router_secret || currentRouter.token || "";
        if (!resolvedToken) throw new Error("Router install secret is not available.");
        /* Personalize the bundle before reconciling the remote VPN. The
           installer can still configure the router's local services when the
           VPS SSH channel is temporarily unavailable; the VPN child script
           will fail visibly and the dashboard will keep showing recovery. */
        resolvedRouterName = currentRouter.name;
        updateRouterVpnAssignment(openVpnCredentials.username, assignedIp);
        updateVpnCredentials(openVpnCredentials.username, openVpnCredentials.password);
        registrationUrl = `${origin}/api/isp/router/register/${resolvedToken}`;
        heartbeatUrl = `${origin}/api/isp/router/heartbeat/${resolvedToken}`;
        /* A dashboard installer grant is intentionally short-lived. Do not
           bake it into a daily auto-update scheduler; operators can request a
           fresh scoped grant when they start another install. */
        installerUrl = "";
        routerVpnUrl = `${origin}/api/scripts/router-vpn.rsc?rid=${encodeURIComponent(rid)}&token=${encodeURIComponent(resolvedToken)}&mode=${installationMode}${takeoverGrantQuery}`;
        coexistenceHotspotUrl = `${origin}/api/scripts/coexistence-hotspot/${encodeURIComponent(rid)}.rsc?mode=${installationMode}&grant=${encodeURIComponent(takeoverGrant)}&certificate=${certificateMode === "unverified" ? "off" : "on"}`;
        routerVpnIp = assignedIp;
        const fallbackUrl = (protocol: "wireguard" | "ipsec"): string =>
          `${origin}/api/scripts/router-vpn.rsc?rid=${encodeURIComponent(rid)}&token=${encodeURIComponent(resolvedToken)}&protocol=${protocol}&mode=${installationMode}${takeoverGrantQuery}`;

        try {
          const provisioning = await provisionRouterManagementOpenVpn({
            routerId: Number(rid),
            routerName: currentRouter.name,
            routerIp: assignedIp,
          });
          const readiness = routerManagementVpnReadiness({ remoteReady: provisioning.ready });
          if (!readiness.ready) {
            throw new Error(`Router-management VPN is not ready: ${readiness.missing.join(", ")}`);
          }
        } catch (error) {
          vpnProvisioningError = error instanceof Error ? error.message : String(error);
        }

        /* Include both fallback attempts even when server-side readiness is
           currently false. The router must trial each supported protocol and
           advance only after that protocol actually fails. The protocol
           endpoint returns a concrete failure when its server prerequisites
           are unavailable, rather than silently removing the attempt. */
        routerWireGuardUrl = fallbackUrl("wireguard");
        routerIpsecUrl = fallbackUrl("ipsec");
        const admins = await sbGet<InstallAdmin>(
          `isp_admins?id=eq.${currentRouter.admin_id}&select=id,name&limit=1`,
        );
        companyName = admins[0]?.name || companyName;
        routerVpnUrl = `${origin}/api/scripts/router-vpn.rsc?rid=${encodeURIComponent(rid)}&token=${encodeURIComponent(resolvedToken)}&mode=${installationMode}${takeoverGrantQuery}`;
        routerWireGuardUrl = fallbackUrl("wireguard");
        routerIpsecUrl = fallbackUrl("ipsec");
      }
    } else {
      const requestHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
      const subdomain = parseSubdomain(requestHost);
      if (subdomain) {
        const admins = await sbGet<InstallAdmin>(
          `isp_admins?subdomain=eq.${encodeURIComponent(subdomain)}&select=id,name&limit=1`,
        );
        companyName = admins[0]?.name || companyName;
      }
    }
  } catch (error) {
    vpnProvisioningError = error instanceof Error ? error.message : String(error);
  }

  if (vpnProvisioningError) {
    console.warn(`[scripts/mainhotspot] VPN provisioning deferred: ${vpnProvisioningError}`);
  }

  const progressUrl = (rid && resolvedToken)
    ? `${origin}/api/isp/router/install-progress/${rid}?token=${encodeURIComponent(resolvedToken)}`
    : "";
  res
    .set("Content-Type", "text/plain; charset=utf-8")
    .set("Content-Disposition", "attachment; filename=\"mainhotspot.rsc\"")
    .set("Cache-Control", "no-cache")
    .send(buildMainhotspotRsc(
      scriptsBase,
      progressUrl,
      resolvedRouterName,
      companyName,
      registrationUrl,
      heartbeatUrl,
      installerUrl,
      routerVpnUrl,
      routerWireGuardUrl,
      routerIpsecUrl,
      routerVpnIp,
       vpnProvisioningError
         ? "The router-management VPN could not be reconciled yet. Local configuration will continue; retry VPN setup from the dashboard."
         : "",
      certificateMode,
      installationMode,
       coexistenceHotspotUrl,
    ));
});

/* ── Router-management VPN readiness ───────────────────────────────────────
   The browser uses this preflight before showing a router installer. It
   reconciles the server-side peers and returns safe status only; no
   credentials or private material is ever returned. */
router.get("/scripts/router-vpn/readiness", requireAdmin(), async (req, res): Promise<void> => {
  const ridRaw = String(req.query.rid ?? "").trim();
  const routerId = /^\d+$/.test(ridRaw) ? Number(ridRaw) : 0;
  const adminId = authenticatedAdminId(req, req.query.adminId);

  if (!routerId || !adminId) {
    res.status(400).json({ ok: false, ready: false, error: "A valid router id and admin id are required" });
    return;
  }

  try {
    const rows = await sbGet<{
      admin_id: number;
      name: string;
      vpn_ip: string | null;
      router_secret: string | null;
      token: string | null;
    }>(
      `isp_routers?id=eq.${routerId}&admin_id=eq.${adminId}&select=admin_id,name,vpn_ip,router_secret,token&limit=1`,
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, ready: false, error: "Router not found for this ISP account" });
      return;
    }

    const provisioningRouter = rows[0];
    const currentIp = await ensurePersistentRouterTunnelIp(routerId, provisioningRouter.vpn_ip);
    let provisioning: Awaited<ReturnType<typeof provisionRouterManagementOpenVpn>>;
    try {
      provisioning = await provisionRouterManagementOpenVpn({
        routerId,
        routerName: provisioningRouter.name,
        routerIp: currentIp,
      });
    } catch (error) {
      res.status(503).type("text/plain").send(`# Router-management VPN provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const readiness = routerManagementVpnReadiness({ remoteReady: provisioning.ready });
    const requestHost = String(req.headers.host ?? "");
    const endpoint = routerVpnEndpointHost(requestOrigin(req));
    const message = readiness.ready
      ? "Router-management VPN is ready for installation."
      : `Router-management VPN is not ready: ${readiness.missing.join(", ")}. Run the VPS OpenVPN setup first, then retry.`;
    res.status(readiness.ready ? 200 : 503).json({
      ok: readiness.ready,
      ready: readiness.ready,
      error: readiness.ready ? undefined : message,
      message,
      missing: readiness.missing,
      endpoint: endpoint || null,
      port: readiness.port,
      network: readiness.network,
      provisioning: {
        openvpn: provisioning.ready ? "ready" : "failed",
      },
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      ready: false,
      error: `Router-management VPN readiness could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

/* ── Per-router VPN bootstrap used by mainhotspot.rsc ───────────────────────
   The read-only migration collector must never change router state. The
   install script therefore fetches this authenticated, router-specific
   bootstrap first. Its token is already bound to the router and is used as
   the unique VPN password, so no placeholder credential is embedded. */
type RouterVpnProtocol = "openvpn" | "wireguard" | "ipsec";

function requestedRouterVpnProtocol(value: unknown): RouterVpnProtocol {
  const protocol = String(value ?? "openvpn").trim().toLowerCase();
  if (protocol === "openvpn" || protocol === "wireguard" || protocol === "ipsec") return protocol;
  throw new Error("Unsupported router VPN protocol");
}

function requestedRouterOsMajor(value: unknown): 6 | 7 | null {
  const version = String(value ?? "").trim();
  if (version === "6") return 6;
  if (version === "7") return 7;
  return null;
}

function configuredEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function validVpnEndpoint(value: string): boolean {
  return value.length > 0 && value.length <= 255 && /^[A-Za-z0-9:._-]+$/.test(value);
}

function routerEnv(name: string, routerId: number): string {
  return configuredEnv(`${name}_${routerId}`) || configuredEnv(name);
}

function routerWireGuardFallbackConfigured(routerId: number): boolean {
  return Boolean(
    routerEnv("ROUTER_WIREGUARD_ENDPOINT", routerId) &&
    routerEnv("ROUTER_WIREGUARD_SERVER_PUBLIC_KEY", routerId) &&
    routerEnv("ROUTER_WIREGUARD_CLIENT_PRIVATE_KEY", routerId) &&
    routerEnv("ROUTER_WIREGUARD_SERVER_READY", routerId) === "true",
  );
}

function routerIpsecFallbackConfigured(routerId: number): boolean {
  return Boolean(
    routerEnv("ROUTER_IPSEC_ENDPOINT", routerId)
    && routerEnv("ROUTER_IPSEC_PSK", routerId)
    && routerEnv("ROUTER_IPSEC_SERVER_READY", routerId) === "true",
  );
}

router.get("/scripts/router-vpn.rsc", async (req, res): Promise<void> => {
  const ridRaw = String(req.query.rid ?? "").trim();
  const token = String(req.query.token ?? "").trim();
  const routerId = /^\d+$/.test(ridRaw) ? Number(ridRaw) : 0;
  const installationMode: "coexist" | "takeover" = String(req.query.mode ?? "").trim().toLowerCase() === "takeover"
    ? "takeover"
    : "coexist";
  const takeoverGrant = String(req.query.grant ?? "").trim();

  if (!routerId || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    res.status(401).type("text/plain").send(
      "# OCHOLA_ROUTER_VPN_ERROR\n" +
      "# Invalid or expired router VPN bootstrap session.",
    );
    return;
  }

  try {
    interface RouterVpnIdentity {
      id: number;
      admin_id: number;
      name: string;
      vpn_ip?: string | null;
    }
    const rows = await sbGet<RouterVpnIdentity>(
      `isp_routers?id=eq.${routerId}&or=(router_secret.eq.${encodeURIComponent(token)},token.eq.${encodeURIComponent(token)})&select=id,admin_id,name,vpn_ip&limit=1`,
    );
    if (!rows[0]) {
      res.status(401).type("text/plain").send(
        "# OCHOLA_ROUTER_VPN_ERROR\n" +
        "# Router VPN bootstrap is not authorized.",
      );
      return;
    }
    if (installationMode === "takeover") {
      const grant = verifyTakeoverGrant(takeoverGrant, routerId);
      if (!grant || grant.adminId !== Number(rows[0].admin_id)) {
        res.status(403).type("text/plain").send(
          "# OCHOLA_ROUTER_VPN_ERROR\n" +
          "# Takeover authorization is missing, invalid, expired, or scoped to another ISP/router.",
        );
        return;
      }
    }

    const tunnelRouterIp = await ensurePersistentRouterTunnelIp(routerId, rows[0].vpn_ip);
    const protocol = requestedRouterVpnProtocol(req.query.protocol);
    const routerOsMajor = requestedRouterOsMajor(req.query["ros-version"]);
    if (!routerOsMajor) {
      res.status(400).type("text/plain").send(
        "# OCHOLA_ROUTER_VPN_ERROR\n" +
        "# RouterOS major version is required. The installer must read /system resource version first and request ros-version=6 or ros-version=7.",
      );
      return;
    }
    let script: string;

    if (protocol === "openvpn") {
      const openVpnCredentials = routerManagementOvpnCredentials(rows[0].name);
      const readiness = routerManagementVpnReadiness();
      if (!readiness.endpointConfigured) {
        res.status(503).type("text/plain").send(
          "# OCHOLA_ROUTER_VPN_ERROR\n" +
          "# Router-management VPN endpoint is not configured. " +
          "Set ROUTER_OPENVPN_ENDPOINT or VPS_HOST, then retry.",
        );
        return;
      }
      const vpsHost = await routerVpnEndpointAddress(requestOrigin(req));
      if (!vpsHost) {
        res.status(503).type("text/plain").send(
          "# OCHOLA_ROUTER_VPN_ERROR\n" +
          "# VPS OpenVPN endpoint is not configured. Set ROUTER_OPENVPN_ENDPOINT or VPS_HOST.",
        );
        return;
      }
      const vpnPort = routerManagementVpnPortForRouter(routerId);
      const readinessWarning = readiness.ready
        ? ""
        : `# WARNING: API could not verify local OpenVPN files (${readiness.missing.join(", ")}).\n` +
          "# The OpenVPN server may be hosted separately; RouterOS will verify the tunnel after import.\n";
      script = generateRouterAsClientScript({
        vpsPublicIp: vpsHost,
        vpnPort,
        vpnUsername: openVpnCredentials.username,
        vpnPassword: openVpnCredentials.password,
        tunnelRouterIp,
        tunnelVpsIp: ROUTER_VPN_GATEWAY,
        routerId,
        installationMode,
        routerOsMajor,
      });
      script = readinessWarning + script;
    } else if (protocol === "wireguard") {
      const material = await routerFallbackMaterial(routerId, "wireguard");
      const endpoint = material?.endpoint || routerEnv("ROUTER_WIREGUARD_ENDPOINT", routerId);
      const serverPublicKey = routerEnv("ROUTER_WIREGUARD_SERVER_PUBLIC_KEY", routerId);
      const dbServerPublicKey = material?.serverPublicKey || serverPublicKey;
      const clientPrivateKey = material?.secret || routerEnv("ROUTER_WIREGUARD_CLIENT_PRIVATE_KEY", routerId);
      if ((!material && !routerWireGuardFallbackConfigured(routerId)) || !validVpnEndpoint(endpoint) ||
           !/^[A-Za-z0-9+/=]{32,}$/.test(dbServerPublicKey) ||
           !/^[A-Za-z0-9+/=]{32,}$/.test(clientPrivateKey)) {
         res.status(503).type("text/plain").send(
           "# OCHOLA_ROUTER_VPN_ERROR\n" +
           "# Router WireGuard fallback is unavailable because server-side prerequisites are incomplete.\n" +
           "# Required: endpoint, server public key, router private key, and a ready server-side WireGuard peer.\n" +
           "# Run router-management VPN reconciliation on the VPS, then retry the installer.",
         );
        return;
      }
      const endpointPort = material?.endpointPort ?? (Number.parseInt(String(process.env.ROUTER_WIREGUARD_PORT ?? "51820"), 10) || 51820);
      if (endpointPort < 1 || endpointPort > 65535) {
        res.status(503).type("text/plain").send("# OCHOLA_ROUTER_VPN_ERROR\n# Router WireGuard fallback has an invalid endpoint port.");
        return;
      }
      script = generateRouterWireGuardClientScript({
        endpoint,
        endpointPort,
        serverPublicKey: dbServerPublicKey,
        clientPrivateKey,
        tunnelRouterIp,
        tunnelVpsIp: ROUTER_VPN_GATEWAY,
        routerId,
        installationMode,
      });
    } else {
      const material = await routerFallbackMaterial(routerId, "ipsec");
      const endpoint = material?.endpoint || routerEnv("ROUTER_IPSEC_ENDPOINT", routerId);
      const preSharedKey = material?.secret || routerEnv("ROUTER_IPSEC_PSK", routerId);
      if ((!material && !routerIpsecFallbackConfigured(routerId)) || !validVpnEndpoint(endpoint) || preSharedKey.length < 8) {
         res.status(503).type("text/plain").send(
           "# OCHOLA_ROUTER_VPN_ERROR\n" +
           "# Router IPsec fallback is unavailable because server-side prerequisites are incomplete.\n" +
           "# Required: endpoint, PSK, and a ready server-side IPsec peer/policy.\n" +
           "# Run router-management VPN reconciliation on the VPS, then retry the installer.",
         );
        return;
      }
      script = material
        ? generatedRouterVpnChildScript("ipsec", routerId, material, routerOsMajor)
        : generateRouterIpsecClientScript({
            endpoint,
            preSharedKey,
            tunnelRouterIp,
            tunnelVpsIp: ROUTER_VPN_GATEWAY,
            routerId,
            installationMode,
            routerOsMajor,
          });
    }

    res
      .set("Content-Type", "text/plain; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="router-vpn-${protocol}-${routerId}.rsc"`)
      .set("Cache-Control", "no-store")
      .send(script);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("ROUTER_OPENVPN_PORT") ? 503 : 500;
    res.status(status).type("text/plain").send(`# OCHOLA_ROUTER_VPN_ERROR\n# Error generating router VPN bootstrap: ${message}`);
  }
});

/* ═══════════════════════════════════════════════════════════════
   Static vlanpppoe.rsc — PPPoE VLAN setup script.
   Creates a VLAN interface on hotspot-bridge (VLAN ID 200),
   runs a PPPoE server on it, sets up hotspot captive portal for
   expired/unpaid clients, and configures walled-garden entries.
═══════════════════════════════════════════════════════════════ */
function buildVlanpppoeRsc(origin: string): string {
  return `# vlanpppoe.rsc
:log info "PPPoE VLAN: init (vlan-id=200, base=hotspot-bridge)";

:log info "PPPoE VLAN: fetching login.html from ${origin}/hotspot/login.html";
:do { /file add name=pppoe type=directory } on-error={};
:do { /file make-dir pppoe } on-error={};
/tool fetch url="${origin}/hotspot/login.html" ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path="pppoe/login.html"

# === PPPoE (VLAN) — hotspot-bridge, VLAN ID 200, interface pppoe-vlan ===

# 0) Ensure VLAN interface exists on hotspot-bridge
:if ([:len [/interface vlan find where name="pppoe-vlan"]] = 0) do={
    /interface vlan add name=pppoe-vlan vlan-id=200 interface=hotspot-bridge comment="PPPoE VLAN on hotspot-bridge"
}

# 1) IP address on VLAN interface
:if ([:len [/ip address find where interface="pppoe-vlan" and address="192.168.178.1/24"]] = 0) do={
    /ip address add address=192.168.178.1/24 interface=pppoe-vlan comment="PPPoE VLAN gateway"
}

:local poolName "expired_pppoe_pool"; :local poolRange "192.168.178.5-192.168.178.254"; :local ids [/ip pool find where name=$poolName]; :if ([:len $ids] = 0) do={ /ip pool add name=$poolName ranges=$poolRange } else={ :foreach i in=$ids do={ /ip pool set numbers=$i ranges=$poolRange } }

# 3) PPPoE server on the VLAN interface
:if ([:len [/interface pppoe-server server find where interface="pppoe-vlan"]] = 0) do={
    /interface pppoe-server server add interface=pppoe-vlan service-name=pppoe1 disabled=no
}

# 4) NAT masquerade for the VLAN subnet
/ip firewall nat
remove [find where chain=srcnat and action=masquerade and src-address=192.168.178.0/24]
add chain=srcnat action=masquerade src-address=192.168.178.0/24

# 5) Hotspot on the VLAN (using expired_pppoe_pool)
#    Recreate hotspot2 on pppoe-vlan and point to profile=hsprof2 later
/ip hotspot
remove [find where name=hotspot2]
add name=hotspot2 interface=pppoe-vlan profile=default address-pool=expired_pppoe_pool addresses-per-mac=5 disabled=no

# 6) Hotspot profile (html-directory=pppoe so it serves /pppoe/login.html)
/ip hotspot profile
remove [find where name=hsprof2]
add name=hsprof2 hotspot-address=192.168.178.1 dns-name=pppoe.com html-directory=pppoe
set hsprof2 login-by=http-pap,cookie

# 7) DHCP server on the VLAN
/ip dhcp-server
remove [find name="pppoe-dhcp"]
add name="pppoe-dhcp" interface=pppoe-vlan address-pool=expired_pppoe_pool lease-time=1h disabled=no

/ip dhcp-server network
:foreach j in=[/ip dhcp-server network find address="192.168.178.0/24"] do={ /ip dhcp-server network remove $j }
add address=192.168.178.0/24 gateway=192.168.178.1 dns-server=8.8.8.8,8.8.4.4 comment="pppoe VLAN network"

# Link hotspot2 to hsprof2 profile
/ip hotspot
set [find where name=hotspot2] profile=hsprof2

# 8) Walled-garden for hotspot2
/ip hotspot walled-garden ip
remove [find where server=hotspot2 and dst-host=isplatty.org]
remove [find where server=hotspot2 and dst-host=server2.isplatty.org]
remove [find where server=hotspot2 and dst-host=server3.isplatty.org]
remove [find where server=hotspot2 and dst-host=server4.isplatty.org]
remove [find where server=hotspot2 and dst-host=code.jquery.com]
remove [find where server=hotspot2 and dst-host=cdn.jsdelivr.net]
remove [find where server=hotspot2 and dst-host=cdnjs.cloudflare.com]
remove [find where server=hotspot2 and dst-host=fonts.googleapis.com]
remove [find where server=hotspot2 and dst-host=cdn.tailwindcss.com]
remove [find where server=hotspot2 and dst-host=server5.isplatty.org]
remove [find where server=hotspot2 and dst-host=server6.isplatty.org]
remove [find where server=hotspot2 and dst-host=server7.isplatty.org]
add server=hotspot2 dst-host=isplatty.org action=accept
add server=hotspot2 dst-host=server2.isplatty.org action=accept
add server=hotspot2 dst-host=server3.isplatty.org action=accept
add server=hotspot2 dst-host=server4.isplatty.org action=accept
add server=hotspot2 dst-host=code.jquery.com action=accept
add server=hotspot2 dst-host=cdn.jsdelivr.net action=accept
add server=hotspot2 dst-host=cdnjs.cloudflare.com action=accept
add server=hotspot2 dst-host=fonts.googleapis.com action=accept
add server=hotspot2 dst-host=cdn.tailwindcss.com action=accept
add server=hotspot2 dst-host=server5.isplatty.org action=accept
add server=hotspot2 dst-host=server6.isplatty.org action=accept
add server=hotspot2 dst-host=server7.isplatty.org action=accept

/ip firewall address-list
remove [find where list=captive-allow-fqdn and address=cdn.jsdelivr.net]
add list=captive-allow-fqdn address=cdn.jsdelivr.net comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=fonts.gstatic.com]
add list=captive-allow-fqdn address=fonts.gstatic.com comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=fonts.googleapis.com]
add list=captive-allow-fqdn address=fonts.googleapis.com comment="fqdn allow"

# ajax.googleapis.com removed - jQuery is downloaded locally

remove [find where list=captive-allow-fqdn and address=api.iconify.design]
add list=captive-allow-fqdn address=api.iconify.design comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=robohash.org]
add list=captive-allow-fqdn address=robohash.org comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=code.jquery.com]
add list=captive-allow-fqdn address=code.jquery.com comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=cdnjs.cloudflare.com]
add list=captive-allow-fqdn address=cdnjs.cloudflare.com comment="fqdn allow"

/ip firewall filter
remove [find where chain=forward and src-address-list=filter_clients and protocol=tcp and dst-port=443 and dst-address-list=captive-allow-fqdn and action=accept]
add chain=forward src-address-list=filter_clients protocol=tcp dst-port=443 dst-address-list=captive-allow-fqdn action=accept comment="captive allow FQDNs"

:do { /ip firewall filter move [find where comment="captive allow FQDNs"] destination=0 } on-error={}

# ─── ALLOW PRE-LOGIN TO PORTAL IP ────────────────────────────────────────────
/ip firewall filter
remove [find where chain=forward src-address=192.168.178.0/24 dst-address=64.23.188.107 action=accept comment="allow payment pre-login"]
add    chain=forward src-address=192.168.178.0/24 dst-address=64.23.188.107 action=accept comment="allow payment pre-login"

/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=80 to-addresses=142.251.46.170 to-ports=8080]
add    chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=80 action=dst-nat to-addresses=142.251.46.170 to-ports=8080 comment="Enable Web Proxy in IP>Webproxy Force Ip to Panel Walled garden"

# A) SNAT for PPPoE pool (return path)
/ip firewall nat
remove [find where chain=srcnat src-address=192.168.178.0/24 action=masquerade comment="captive: SNAT PPPoE pool (all dest)"]
add    chain=srcnat src-address=192.168.178.0/24 action=masquerade comment="captive: SNAT PPPoE pool (all dest)"

# B1) Force DNS (UDP 53) to router
/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link Update"]
add    chain=dstnat src-address=192.168.178.0/24 protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link Update"

# B2) Force DNS (TCP 53) to router
/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link"]
add    chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link"

# Put these captive rules at the very top of NAT (reverse order so first rule ends up at top)
:do { /ip firewall nat move [find where comment="Enable Web Proxy in IP>Webproxy Force Ip to Panel Walled garden"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="captive: SNAT PPPoE pool (all dest)"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="Force Admin Panel Link Update"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="Force Admin Panel Link"] 0 } on-error={}

:do { /ip firewall filter move [find where comment="allow payment pre-login"] 0 } on-error={}

:log info "PPPoE VLAN configuration applied successfully."

:log info "PPPoE VLAN: done";
`;
}

/* ── Per-router dynamic vlanpppoe.rsc handler ──
   Serves a router-specific vlanpppoe.rsc using config stored in pppoe_mode.
   Called by two routes:
     GET /scripts/vlanpppoe/:routerId.rsc  — path-param (RouterOS-safe, preferred)
     GET /scripts/vlanpppoe.rsc?routerId=X — query-param (legacy, browser-friendly)
   Falls back to dynamic-origin static script when no routerId is resolvable.  ── */
async function handleVlanPPPoERsc(req: Request, res: Response): Promise<void> {
  /* Path param takes precedence (RouterOS-safe, no `?` that the terminal eats).
     Fall through to query param for browser download links. */
  const rawId = (req.params.routerId ?? req.query.routerId ?? req.query.router_id ?? "") as string;
  const routerId = parseInt(rawId.replace(/\.rsc$/i, ""), 10);

  if (!routerId || isNaN(routerId)) {
    /* No routerId — serve origin-resolved static fallback for legacy integrations */
    res.type("text/plain");
    res.send(buildVlanpppoeRsc(requestOrigin(req)));
    return;
  }

  try {
    const rows = await sbGet<PPPoEDbRouter>(
      `isp_routers?id=eq.${routerId}&select=*&limit=1`
    );
    if (rows.length === 0) {
      res.status(404).type("text/plain").send("# Error: router not found");
      return;
    }
    const dbRouter = rows[0];

    let companyName    = "ISP";
    let adminSubdomain = `admin${dbRouter.admin_id}`;
    try {
      interface DbAdmin { id: number; name: string; subdomain: string | null; }
      const admins = await sbGet<DbAdmin>(
        `isp_admins?id=eq.${dbRouter.admin_id}&select=id,name,subdomain&limit=1`
      );
      if (admins.length > 0) {
        companyName    = admins[0].name;
        adminSubdomain = admins[0].subdomain ?? adminSubdomain;
      }
    } catch { /* use defaults */ }

    const { vlanId, vlanGateway, baseBridge } = parsePPPoEVlanConfig(dbRouter.pppoe_mode);
    const ros = parseInt((dbRouter.ros_version ?? "6").replace(/\D.*/u, ""), 10) || 6;

    /* Build a path-based (no query string) auto-update URL that RouterOS /tool fetch
       can handle. Uses resolveOrigin to emit the correct ISP-specific subdomain.
       Re-deriving from pppoe_mode on each fetch ensures the saved VLAN gateway
       is always reflected — no config drift from daily auto-updates. */
    const origin = requestOrigin(req);
    const scriptBaseOverride = `${origin}/api/scripts/vlanpppoe/${routerId}.rsc`;

    const script = genPPPoEVlan(
      dbRouter, companyName, ros, adminSubdomain,
      vlanId, baseBridge, vlanGateway, scriptBaseOverride
    );

    res.set("Content-Type", "text/plain; charset=utf-8")
       .set("Content-Disposition", `attachment; filename="vlanpppoe-${routerId}.rsc"`)
       .set("Cache-Control", "no-cache")
       .send(script);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).type("text/plain").send(`# Error generating vlanpppoe.rsc: ${msg}`);
  }
}

/* Path-param route — preferred for RouterOS /tool fetch (no query string) */
router.get("/scripts/vlanpppoe/:routerId.rsc", (req, res) => { void handleVlanPPPoERsc(req, res); });
/* Query-param route — legacy / browser download link */
router.get("/scripts/vlanpppoe.rsc", (req, res) => { void handleVlanPPPoERsc(req, res); });

/* ═══════════════════════════════════════════════════════════════
   Static normalpppoe.rsc — Normal PPPoE bridge setup script.
   Creates pppoe_bridge, runs PPPoE server + captive hotspot for
   expired clients, walled-garden, firewall rules and NAT ordering.
═══════════════════════════════════════════════════════════════ */
function buildNormalpppoeRsc(origin: string): string {
  return `# normalpppoe.rsc
:log info "PPPoE NORMAL: init";

:log info "PPPoE NORMAL: fetching login.html from ${origin}/hotspot/login.html";
:do { /file add name=pppoe type=directory } on-error={};
:do { /file make-dir pppoe } on-error={};
/tool fetch url="${origin}/hotspot/login.html" ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path="pppoe/login.html"

:if ([:len [/interface bridge find where name="pppoe_bridge"]] = 0) do={ /interface bridge add name=pppoe_bridge protocol-mode=rstp comment="PPPoE bridge" }
:if ([:len [/ip address find where interface="pppoe_bridge" and address="192.168.178.1/24"]] = 0) do={ /ip address add address=192.168.178.1/24 interface=pppoe_bridge comment="PPPoE gateway" }
:local poolName "expired_pppoe_pool"; :local poolRange "192.168.178.5-192.168.178.254"; :local ids [/ip pool find where name=$poolName]; :if ([:len $ids] = 0) do={ /ip pool add name=$poolName ranges=$poolRange } else={ :foreach i in=$ids do={ /ip pool set numbers=$i ranges=$poolRange } }

:if ([:len [/interface pppoe-server server find where interface="pppoe_bridge"]] = 0) do={ /interface pppoe-server server add interface=pppoe_bridge service-name=pppoe1 disabled=no }
/ip firewall nat add chain=srcnat action=masquerade src-address=192.168.178.0/24

# ─── pppoe SERVER (uses profile) ────────────────────────────────────────────
/ip hotspot
remove [find where name=hotspot2]
add name=hotspot2 interface=pppoe_bridge profile=default address-pool=expired_pppoe_pool addresses-per-mac=5 disabled=no
# ─── HOTSPOT PROFILE (dns-name, hotspot-address, per-mac) ───────────────────
/ip hotspot profile
remove [find where name=hsprof2]
add name=hsprof2 hotspot-address=192.168.178.1 dns-name=pppoe.com html-directory=pppoe

/ip hotspot profile
set hsprof2 login-by=http-pap,cookie
# ---------- DHCP-SERVER on pppoe_bridge ----------
/ip dhcp-server
remove [find name="pppoe-dhcp"]
add name="pppoe-dhcp" interface=pppoe_bridge address-pool=expired_pppoe_pool lease-time=1h disabled=no
/ip dhcp-server network
:foreach j in=[/ip dhcp-server network find address="192.168.178.0/24"] do={ /ip dhcp-server network remove $j }
add address=192.168.178.0/24 gateway=192.168.178.1 dns-server=8.8.8.8,8.8.4.4 comment="pppoe network"
/ip hotspot
set [find where name=hotspot2] profile=hsprof2
# ─── WALLED-GARDEN ──────────────────────────────────────────────────────────
/ip hotspot walled-garden ip
remove [find where server=hotspot2 and dst-host=isplatty.org]
remove [find where server=hotspot2 and dst-host=server2.isplatty.org]
remove [find where server=hotspot2 and dst-host=server3.isplatty.org]
remove [find where server=hotspot2 and dst-host=server4.isplatty.org]
remove [find where server=hotspot2 and dst-host=code.jquery.com]
remove [find where server=hotspot2 and dst-host=cdn.jsdelivr.net]
remove [find where server=hotspot2 and dst-host=cdnjs.cloudflare.com]
remove [find where server=hotspot2 and dst-host=fonts.googleapis.com]
remove [find where server=hotspot2 and dst-host=cdn.tailwindcss.com]
add server=hotspot2 dst-host=isplatty.org action=accept
add server=hotspot2 dst-host=server2.isplatty.org action=accept
add server=hotspot2 dst-host=server3.isplatty.org action=accept
add server=hotspot2 dst-host=server4.isplatty.org action=accept
add server=hotspot2 dst-host=code.jquery.com action=accept
add server=hotspot2 dst-host=cdn.jsdelivr.net action=accept
add server=hotspot2 dst-host=cdnjs.cloudflare.com action=accept
add server=hotspot2 dst-host=fonts.googleapis.com action=accept
add server=hotspot2 dst-host=cdn.tailwindcss.com action=accept
add server=hotspot2 dst-host=server5.isplatty.org action=accept
add server=hotspot2 dst-host=server6.isplatty.org action=accept
add server=hotspot2 dst-host=server7.isplatty.org action=accept
# ─── NAT MASQUERADE ──────────────────────────────────────────────────────────
/ip firewall nat
remove [find where chain=srcnat and action=masquerade and src-address=192.168.178.0/24]
add chain=srcnat action=masquerade src-address=192.168.178.0/24

# ─── MANGLE ──────────────────────────────────────────────────────────────────

# ─── ALLOW PRE-LOGIN TO PORTAL IP ────────────────────────────────────────────
/ip firewall filter
remove [find where chain=forward src-address=192.168.178.0/24 dst-address=64.23.188.107 action=accept comment="allow payment pre-login"]
add    chain=forward src-address=192.168.178.0/24 dst-address=64.23.188.107 action=accept comment="allow payment pre-login"

/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=80 to-addresses=84.247.188.241 to-ports=42048]
add    chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=80 action=dst-nat to-addresses=84.247.188.241 to-ports=42048 comment="Enable Web Proxy in IP>Webproxy Force Ip to Panel Walled garden"

/ip firewall address-list
remove [find where list=captive-allow-fqdn and address=cdn.jsdelivr.net]
add list=captive-allow-fqdn address=cdn.jsdelivr.net comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=fonts.gstatic.com]
add list=captive-allow-fqdn address=fonts.gstatic.com comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=fonts.googleapis.com]
add list=captive-allow-fqdn address=fonts.googleapis.com comment="fqdn allow"

# ajax.googleapis.com removed - jQuery is downloaded locally

remove [find where list=captive-allow-fqdn and address=api.iconify.design]
add list=captive-allow-fqdn address=api.iconify.design comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=robohash.org]
add list=captive-allow-fqdn address=robohash.org comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=code.jquery.com]
add list=captive-allow-fqdn address=code.jquery.com comment="fqdn allow"

remove [find where list=captive-allow-fqdn and address=cdnjs.cloudflare.com]
add list=captive-allow-fqdn address=cdnjs.cloudflare.com comment="fqdn allow"

/ip firewall filter
remove [find where chain=forward and src-address-list=filter_clients and protocol=tcp and dst-port=443 and dst-address-list=captive-allow-fqdn and action=accept]
add chain=forward src-address-list=filter_clients protocol=tcp dst-port=443 dst-address-list=captive-allow-fqdn action=accept comment="captive allow FQDNs"

:do { /ip firewall filter move [find where comment="captive allow FQDNs"] destination=0 } on-error={}

# A) SNAT for PPPoE pool (return path)
/ip firewall nat
remove [find where chain=srcnat src-address=192.168.178.0/24 action=masquerade comment="captive: SNAT PPPoE pool (all dest)"]
add    chain=srcnat src-address=192.168.178.0/24 action=masquerade comment="captive: SNAT PPPoE pool (all dest)"

# B1) Force DNS (UDP 53) to router
/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link Update"]
add    chain=dstnat src-address=192.168.178.0/24 protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link Update"

# B2) Force DNS (TCP 53) to router
/ip firewall nat
remove [find where chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link"]
add    chain=dstnat src-address=192.168.178.0/24 protocol=tcp dst-port=53 action=redirect to-ports=53 comment="Force Admin Panel Link"

# Put these captive rules at the very top of NAT (reverse order so first rule ends up at top)
:do { /ip firewall nat move [find where comment="Enable Web Proxy in IP>Webproxy Force Ip to Panel Walled garden"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="captive: SNAT PPPoE pool (all dest)"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="Force Admin Panel Link Update"] 0 } on-error={}
:do { /ip firewall nat move [find where comment="Force Admin Panel Link"] 0 } on-error={}

:do { /ip firewall filter move [find where comment="allow payment pre-login"] 0 } on-error={}

:log info "PPPoE configuration applied successfully."
#pppoe configuration finished
`;
}

router.get("/scripts/normalpppoe.rsc", (req, res): void => {
  res.type("text/plain");
  res.send(buildNormalpppoeRsc(requestOrigin(req)));
});

/* ═══════════════════════════════════════════════════════════════
   Static sub-scripts downloaded by mainhotspot.rsc.
   These must be served BEFORE the dynamic /:name handler so the
   router names "vpn7", "hotspotsetup", etc. are never misrouted
   into the per-router generator.
═══════════════════════════════════════════════════════════════ */

/* ── VPN setup – RouterOS 7 ── */
function buildVpn7Rsc(origin: string): string {
  void origin;
  return `# OCHOLA_ROUTER_VPN_ERROR
# vpn7.rsc – OpenVPN client setup for RouterOS 7
# Direct downloads are intentionally not configured with shared credentials.
# mainhotspot.rsc must be downloaded with rid and token so it can fetch the
# authenticated, router-specific /scripts/router-vpn.rsc bootstrap.
:put "  [vpn7] Router identity is required before VPN setup."
:error "Download mainhotspot.rsc with the router's rid and token."
`;
}

/* ── VPN setup – RouterOS 6 ── */
function buildVpn6Rsc(origin: string): string {
  void origin;
  return `# OCHOLA_ROUTER_VPN_ERROR
# vpn6.rsc – OpenVPN client setup for RouterOS 6
# Direct downloads are intentionally not configured with shared credentials.
# mainhotspot.rsc must be downloaded with rid and token so it can fetch the
# authenticated, router-specific /scripts/router-vpn.rsc bootstrap.
:put "  [vpn6] Router identity is required before VPN setup."
:error "Download mainhotspot.rsc with the router's rid and token."
`;
}

/* ── Hotspot setup ── */
const HOTSPOTSETUP_RSC = `# hotspotsetup.rsc – Hotspot service bootstrap
# Creates a default bridge, IP pool, hotspot profile and hotspot
# service so the service is running before the per-router script
# applies ISP-specific customisation.

:put "  [hotspot] Setting up hotspot service..."

# Detect storage. Some RouterOS devices have neither a flash nor disk1
# directory; on those devices the Files root is the correct storage path.
:local storage ""
:if ([:len [/file find name="disk1" type=directory]] > 0) do={ :set storage "disk1" }
:if ($storage = "") do={ :if ([:len [/file find name="flash" type=directory]] > 0) do={ :set storage "flash" } }
:local hsdir "hotspot"
:if ([:len $storage] > 0) do={ :set hsdir ($storage . "/hotspot") }
:do { /file add name=$hsdir type=directory } on-error={}
:do { /file make-dir $hsdir } on-error={}

# Default bridge – the per-router script will reconfigure with the
# correct bridge name and IP for the specific installation.
:do { /interface bridge add name="hotspot-bridge" comment="SafeNet Hotspot Bridge" } on-error={}
:do { /interface bridge set [find name="hotspot-bridge"] fast-forward=no } on-error={}

# IP address on bridge (will be overwritten by per-router script)
:do { /ip address remove [find interface="hotspot-bridge"] } on-error={}
:do { /ip address add address=192.168.88.1/24 interface="hotspot-bridge" comment="SafeNet hotspot bridge IP" } on-error={}

# DNS
:do { /ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes } on-error={}

# IP pool
:do { /ip pool remove [find name=hspool] } on-error={}
:do { /ip pool add name=hspool ranges=192.168.88.2-192.168.88.254 } on-error={}

# Hotspot profile
:do { /ip hotspot profile remove [find name=default-hs] } on-error={}
:do { /ip hotspot profile add name=default-hs hotspot-address=192.168.88.1 dns-name=wifi.local login-by=http-chap,http-pap html-directory=$hsdir } on-error={ :put "  WARN: hotspot profile add failed" }

# Hotspot service
:do { /ip hotspot remove [find interface="hotspot-bridge"] } on-error={}
:do { /ip hotspot add name=hotspot1 interface="hotspot-bridge" profile=default-hs address-pool=hspool idle-timeout=none } on-error={ :put "  WARN: hotspot service add failed" }

:put "  [hotspot] Hotspot service started on hotspot-bridge (192.168.88.1)  OK"
`;

/* ── PPPoE setup ── */
const PPPOESETUP_RSC = `# pppoesetup.rsc – PPPoE server configuration
# Sets up a PPPoE server profile and service so ISP clients
# can authenticate via PPPoE in addition to hotspot.

:put "  [pppoe] Setting up PPPoE server..."

# PPPoE IP pool
:do { /ip pool remove [find name=pppoe-pool] } on-error={}
:do { /ip pool add name=pppoe-pool ranges=192.168.99.2-192.168.99.254 } on-error={}

# PPP profile (shared between PPPoE and future L2TP use)
:do { /ppp profile remove [find name=isp-profile] } on-error={}
:do { /ppp profile add name=isp-profile local-address=192.168.99.1 remote-address=pppoe-pool dns-server=8.8.8.8,8.8.4.4 use-compression=no use-encryption=yes } on-error={ :put "  WARN: PPP profile add failed" }

# PPPoE server on the LAN hotspot bridge.
# PPPoE subscribers connect through the same bridge created by hotspotsetup.rsc;
# binding this server to ether1 would expose it on the WAN side instead.
:do { /interface pppoe-server server remove [find service-name=isp-pppoe] } on-error={}
:do { /interface pppoe-server server add service-name=isp-pppoe interface=hotspot-bridge default-profile=isp-profile disabled=no } on-error={ :put "  WARN: PPPoE server add failed" }
:do { /interface pppoe-server server set [find service-name=isp-pppoe] authentication=pap,chap,mschap1,mschap2 max-sessions=0 } on-error={ :put "  WARN: PPPoE server options could not be applied" }

:put "  [pppoe] PPPoE server configured  OK"
`;

/* ── Default users ── */
const USERS_RSC = `# users.rsc – Default hotspot user and group setup
# Creates a default admin and a trial guest account.
# The billing integration manages real user accounts via the API.

:put "  [users] Configuring default hotspot users..."

# Default profile tweaks
:do { /ip hotspot user profile set [find name=default] shared-users=1 keepalive-timeout=2m idle-timeout=none } on-error={}

# Remove stale defaults first
:do { /ip hotspot user remove [find name=admin] } on-error={}
:do { /ip hotspot user remove [find name=trial] } on-error={}

# Admin bypass user (MAC or password – per-router script may adjust)
:do { /ip hotspot user add name=admin password=admin profile=default comment="ISP admin bypass" } on-error={ :put "  WARN: admin user add failed" }

# 1-hour trial guest
:do { /ip hotspot user add name=trial password=trial123 profile=default limit-uptime=1h comment="Trial guest" } on-error={ :put "  WARN: trial user add failed" }

:put "  [users] Default users set up  OK"
`;

/* ── Sync-users firewall rules ── */
const SYNCUSERS_RSC = `# syncusers.rsc – Firewall rules required for user synchronisation
# Opens the MikroTik API port (8728) to the VPN management subnet
# (10.8.5.0/24) so the billing server can push user accounts.

:put "  [syncusers] Applying user-sync firewall rules..."

# Allow API from VPN management subnet
:do {
  /ip firewall filter remove [find comment="SafeNet - allow API sync"]
} on-error={}

# place-before=0 puts the rule at the top; fall back to plain add if chain is empty
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.5.0/24 action=accept comment="SafeNet - allow API sync" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.5.0/24 action=accept comment="SafeNet - allow API sync" } on-error={ :put "  WARN: API sync firewall rule failed" } }

# Enable the RouterOS API service
:do { /ip service set api disabled=no } on-error={ :put "  WARN: could not enable API service" }

:put "  [syncusers] User-sync firewall rules applied  OK"
`;

/* ── Optional diagnostic logging bootstrap ──
   This preserves the Main ISP Ledger install stage without introducing a
   third-party log collector. The active app remains the source of router
   health and install events. */
const LOGPUSH_RSC = `# logpush.rsc – ISPlatty diagnostic logging bootstrap
:put "  [logpush] Diagnostics remain available through the ISP dashboard."
`;

/* ── Optional API security bootstrap ──
   Router-specific firewall allow rules are created by the main configuration.
   This stage intentionally avoids broad DROP rules that could lock an admin
   out of a freshly installed router. */
const SECLOGPUSH_RSC = `# seclogpush.rsc – ISPlatty API security bootstrap
:put "  [api-security] Router-specific API access policy is being retained."
`;

/* ── Heartbeat ── */
function buildHeartbeatRsc(origin: string): string {
  return `# heartbeat.rsc – Installs the periodic heartbeat script + scheduler
# The heartbeat pings the billing server every 5 minutes so the
# admin dashboard shows green / yellow / red router status.
# The per-router .rsc sets the exact URL (with router secret token);
# this script installs a placeholder that will be replaced.

:put "  [heartbeat] Installing heartbeat script and scheduler..."

# Remove old entries
:do { /system script remove [find name=ochola-heartbeat-script] } on-error={}
:do { /system scheduler remove [find name=ochola-heartbeat] } on-error={}

# Placeholder heartbeat – the per-router script overwrites with the
# real URL containing the secret token.
:do {
  /system script add \\
    name=ochola-heartbeat-script \\
    policy=read,write,test \\
  source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; :do { /tool fetch url=(\\"${origin}/api/isp/router/heartbeat/pending?hs=\\" . [:tostr \\$hs]) ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path=hb.tmp } on-error={}; :do { /file remove [find name=hb.tmp] } on-error={}"
} on-error={ :put "  WARN: heartbeat script add failed" }

:do {
  /system scheduler add \\
    name=ochola-heartbeat \\
    interval=5m \\
    start-time=startup \\
    on-event="/system script run ochola-heartbeat-script" \\
    comment="ISP heartbeat"
} on-error={ :put "  WARN: heartbeat scheduler add failed" }

# DNS flush scheduler (every 6 hours)
:do { /system scheduler remove [find name=dns-flush] } on-error={}
:do {
  /system scheduler add \\
    name=dns-flush \\
    interval=06:00:00 \\
    on-event="/ip dns cache flush" \\
    policy=read,write,test,ftp \\
    start-time=00:00:00
} on-error={}

:put "  [heartbeat] Heartbeat every 5 min  OK"
`;
}

/* ── Full sync script ── */
function buildSyncfullRsc(origin: string): string {
  return `# syncfull.rsc – Full configuration synchronisation
# Re-downloads and re-applies the per-router .rsc so the router
# always has the latest ISP configuration (plans, portal files, etc.).
# mainhotspot.rsc imports this once; the daily auto-update scheduler
# (added by the per-router script) handles subsequent runs.

:put "  [syncfull] Scheduling full config sync..."

# Remove old auto-update scheduler (per-router script sets the real URL)
:do { /system scheduler remove [find name=ochola-autoupdate] } on-error={}

# Placeholder auto-update – the per-router script replaces this with
# the correct router-specific URL (ISP subdomain + router slug).
:do {
  /system scheduler add \\
    name=ochola-autoupdate \\
    interval=1d \\
    start-time=00:05:00 \\
    on-event="/tool fetch url=\\"${origin}/api/scripts/mainhotspot.rsc\\" dst-path=mainhotspot.rsc ${ROUTER_HTTPS_FETCH_OPTIONS}; /import mainhotspot.rsc" \\
    comment="ISP auto-update"
} on-error={ :put "  WARN: auto-update scheduler add failed" }

:put "  [syncfull] Full-sync scheduler installed  OK"
`;
}

/* ── Serve each sub-script.
   Static entries are plain strings; dynamic entries are builder functions
   that receive the ISP's origin (derived from the Host header) so the
   generated script uses the requesting ISP's own subdomain, not a
   hard-coded example company name. ── */
type SubScriptEntry = string | ((origin: string) => string);

const STATIC_SUBSCRIPTS: Record<string, SubScriptEntry> = {
  "vpn7.rsc":         buildVpn7Rsc,
  "vpn6.rsc":         buildVpn6Rsc,
  "hotspotsetup.rsc": HOTSPOTSETUP_RSC,
  "pppoesetup.rsc":   PPPOESETUP_RSC,
  "users.rsc":        USERS_RSC,
  "syncusers.rsc":    SYNCUSERS_RSC,
  "logpush.rsc":      LOGPUSH_RSC,
  "seclogpush.rsc":   SECLOGPUSH_RSC,
  "heartbeat.rsc":    buildHeartbeatRsc,
  "syncfull.rsc":     buildSyncfullRsc,
};

for (const [filename, entry] of Object.entries(STATIC_SUBSCRIPTS)) {
  router.get(`/scripts/${filename}`, (req, res): void => {
    const origin  = requestOrigin(req);
    const content = typeof entry === "function" ? entry(origin) : entry;
    res
      .set("Content-Type", "text/plain; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${filename}"`)
      .set("Cache-Control", "no-cache")
      .send(content);
  });
}

/* Lists the server-side hotspot assets and RouterOS scripts that the admin
   Files page may publish. This intentionally returns source identifiers, not
   filesystem paths or file contents. */
router.get("/scripts/deployable-sources", (req, res): void => {
  const origin = requestOrigin(req);
  const sources = listDeployableSources().map(source => {
    if (source.type !== "script") return source;
    const content = getDeployableSource("script", source.name, origin);
    return content ? content.source : source;
  });
  res.json({ sources });
});

/* Domain-connected source collector. The token is short-lived and is only
   embedded in the upload URL of the script generated for one admin session. */
router.get("/scripts/router-migration-collector.rsc", (req, res): void => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    res.status(401).type("text/plain").send("# Invalid or expired migration collector session.");
    return;
  }
  const origin = requestOrigin(req);
  const uploadUrl = `${origin}/api/router-migrations/collector-upload?token=${encodeURIComponent(token)}`;
  res
    .set("Content-Type", "text/plain; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="router-migration-collector.rsc"')
    .set("Cache-Control", "no-store")
    .send(buildDomainRouterExportScript(uploadUrl));
});

/* Coexistence service bundle. The URL is only embedded in a short-lived,
   router-scoped installer, so the bridge/service plan cannot be fetched for a
   different router or tenant. */
router.get("/scripts/coexistence-hotspot/:routerId.rsc", async (req, res): Promise<void> => {
  const routerId = Number(req.params.routerId);
  const grant = String(req.query.grant ?? "").trim();
  const mode = String(req.query.mode ?? "").trim().toLowerCase() === "takeover"
    ? "takeover"
    : "coexist";
  const certificateMode: RouterCertificateMode = ["off", "none", "disabled", "unverified"]
    .includes(String(req.query.certificate ?? "").trim().toLowerCase())
    ? "unverified"
    : "verified";

  if (!Number.isInteger(routerId) || routerId <= 0 || !grant) {
    res.status(401).type("text/plain").send("# Invalid or missing router installer authorization.");
    return;
  }

  const authorization = mode === "takeover"
    ? verifyTakeoverGrant(grant, routerId)
    : verifyInstallerGrant(grant, routerId);
  if (!authorization) {
    res.status(403).type("text/plain").send("# Router installer authorization is invalid, expired, or scoped to another router.");
    return;
  }

  try {
    const routers = await sbGet<{ id: number; admin_id: number; name: string }>(
      `isp_routers?id=eq.${routerId}&admin_id=eq.${authorization.adminId}&select=id,admin_id,name&limit=1`,
    );
    const currentRouter = routers[0];
    if (!currentRouter) {
      res.status(404).type("text/plain").send("# Router was not found for this ISP account.");
      return;
    }
    const admins = await sbGet<{ id: number; name: string }>(
      `isp_admins?id=eq.${currentRouter.admin_id}&select=id,name&limit=1`,
    );
    const plans = await sbGet<CoexistenceHotspotPlan>(
      `isp_plans?admin_id=eq.${currentRouter.admin_id}&type=eq.hotspot&select=name,speed_down,speed_up,validity,validity_unit,shared_users`,
    );
    const origin = requestOrigin(req);
    const content = buildCoexistenceHotspotRsc(
      origin,
      currentRouter.id,
      currentRouter.name,
      admins[0]?.name || "ISPlatty",
      plans,
      certificateMode,
    );
    res
      .set("Content-Type", "text/plain; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${coexistenceBridgeName(currentRouter.id)}.rsc"`)
      .set("Cache-Control", "no-store")
      .send(content);
  } catch (error) {
    res.status(503).type("text/plain").send(
      `# Could not generate the isolated coexistence hotspot bundle: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/scripts/:name
   Dynamically generates a RouterOS .rsc file per-router.

   Admin identification (priority order):
     1. Subdomain from Host header  → looks up isp_admins.subdomain
     2. ?admin_id=N query param     → used directly
     3. Falls back to admin_id=5

   Example:
     https://fastnet.isplatty.org/api/scripts/fastnet1.rsc
     ↑ subdomain "fastnet" resolves to that ISP's admin row
     ↑ all plans/routers fetched belong to that admin only
     ↑ self-update URL in the script uses "fastnet.isplatty.org"
═══════════════════════════════════════════════════════════════ */
router.get("/scripts/:name", async (req, res): Promise<void> => {
  const rawName = req.params.name ?? "";
  const slug    = rawName.replace(/\.rsc$/, "");

  if (!slug) {
    res.status(400).send("# Error: script name is required");
    return;
  }

  try {
    /* ── Step 1: Resolve admin from subdomain or query param ── */
    interface DbAdmin {
      id: number;
      name: string;
      subdomain: string | null;
    }

    const hostHeader = (req.headers.host ?? "") as string;
    const subdomain  = parseSubdomain(hostHeader);

     let adminId: number | null = null;
     let adminSubdomain = subdomain;
    let companyName    = "OcholaSupernet";
    let baseDomain     = "isplatty.org";

    if (subdomain) {
      /* Resolve by subdomain column */
      const admins = await sbGet<DbAdmin>(
        `isp_admins?subdomain=eq.${encodeURIComponent(subdomain)}&select=id,name,subdomain&limit=1`
      );
      if (admins.length > 0) {
        adminId        = admins[0].id;
        adminSubdomain = admins[0].subdomain ?? subdomain;
        companyName    = admins[0].name;
      }
    } else if (req.query.admin_id) {
      /* Apex requests may identify the tenant explicitly, but the router
         prefix must still come from that tenant's stored subdomain. */
      const qid = parseInt(req.query.admin_id as string, 10);
      if (!isNaN(qid)) {
        const admins = await sbGet<DbAdmin>(
          `isp_admins?id=eq.${qid}&select=id,name,subdomain&limit=1`
        );
        if (admins.length > 0 && admins[0].subdomain) {
          adminId        = admins[0].id;
          adminSubdomain = admins[0].subdomain;
          companyName    = admins[0].name;
        }
      }
    }
    if (!adminId || !adminSubdomain) {
      throw new Error("A tenant subdomain is required to generate a router file.");
    }

    /* Use the apex certificate for RouterOS downloads. Tenant subdomains are
       currently served by an older Nginx certificate and redirect to the
       apex, which RouterOS cannot reliably follow in HTTPS fetch mode.
       admin_id keeps the generated script tenant-scoped without relying on
       the request Host header. */
    const publicAppOrigin = `https://${baseDomain}`;
    const scriptBaseUrl = `${publicAppOrigin}/api/scripts`;
    const scriptAdminQuery = `admin_id=${encodeURIComponent(String(adminId))}`;
    const routerVpnHost = await routerVpnEndpointAddress(publicAppOrigin);
    if (!routerVpnHost) {
      throw new Error("Router VPN endpoint is not configured with a public IPv4 address.");
    }

    /* ── Step 2: Fetch routers for this admin ── */
    interface DbRouter {
      id: number; name: string; host: string;
      bridge_interface: string | null;
      hotspot_dns_name?: string | null;
      bridge_ip: string | null;
      vpn_ip: string | null;
      router_secret: string | null;
      token: string | null;
      last_seen: string | null;
      status: string;
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${adminId}&select=id,name,host,bridge_interface,bridge_ip,vpn_ip,router_secret,token,last_seen,status`
    );

     /* A generic mainhotspot request creates a fresh router profile. It must
        not select an unfinished record: a failed install belongs to that
        router and must not block the next router's installer. A request with
        a specific slug still targets that named router. */
    let router_row: DbRouter | undefined;
    if (slug === "mainhotspot" || slug === "main-hotspot") {
       const requestedId = Number(req.query.rid);
       if (Number.isSafeInteger(requestedId) && requestedId > 0) {
         router_row = routers.find(router => router.id === requestedId);
       }
    } else {
      router_row = routers.find(r => slugify(r.name) === slug);
    }
    let createError = "";

    /* ── Auto-create when no matching router found ──
       • mainhotspot  → name = ${adminSubdomain}${N}
       • specific slug (e.g. come1) → name = that slug exactly
         (handles the case where the frontend DB insert failed silently) */
    if (!router_row) {
      const autoToken = Buffer
        .from(`${adminId}:${Date.now()}:ocholanet`)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 48);

       const isMainHotspot = slug === "mainhotspot" || slug === "main-hotspot";
       const autoName = isMainHotspot
         ? nextAvailableRouterName(adminSubdomain, routers)
         : slug;   // use the slug as the router name (e.g. "come1")

      /* Try service-role key first (bypasses RLS), then anon key */
      const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      const keysToTry  = serviceKey ? [serviceKey, SUPABASE_KEY].filter(Boolean) : [SUPABASE_KEY];
      for (const key of keysToTry) {
        if (router_row) break;
        try {
          const createRes = await fetch(
            `${SUPABASE_URL}/rest/v1/isp_routers`,
            {
              method: "POST",
              headers: {
                apikey:          key,
                Authorization:   `Bearer ${key}`,
                "Content-Type":  "application/json",
                Prefer:          "return=representation",
              },
              body: JSON.stringify({
                admin_id:         adminId,
                name:             autoName,
                host:             "",
                router_username:  autoName,
                router_secret:    autoName,
                token:            autoToken,  /* NOT NULL installer token */
                bridge_interface: "hotspot-bridge",
                bridge_ip:        "192.168.88.1",
                status:           "setup",
              }),
            }
          );
          const body = await createRes.text();
          if (createRes.ok) {
            try { const rows = JSON.parse(body) as DbRouter[]; router_row = rows[0]; } catch {}
          } else if (createRes.status === 409) {
            /* Row already exists — race condition; try to fetch it */
            const existing = await sbGet<DbRouter>(
              `isp_routers?admin_id=eq.${adminId}&name=eq.${encodeURIComponent(autoName)}&limit=1`
            ).catch(() => []);
            if (existing.length > 0) router_row = existing[0];
          } else {
            createError = `HTTP ${createRes.status}: ${body.slice(0, 200)}`;
          }
        } catch (e) {
          createError = String(e);
        }
      }
    }

    if (!router_row) {
      const serviceSet = !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
      res.status(404).send(
        `# Error: no router found for admin "${adminSubdomain}" matching slug "${slug}"\n` +
        `# Available slugs: ${routers.map(r => slugify(r.name)).join(", ") || "(none)"}\n` +
        `#\n` +
        `# Auto-create failed. Supabase INSERT returned:\n` +
        `#   ${(createError || "unknown error — check server logs").replace(/\n/g, "\n#   ")}\n` +
        `#\n` +
        (!serviceSet
          ? `# HINT: Set SUPABASE_SERVICE_KEY (service_role key) in the server .env\n` +
            `#       to allow the API to create router records bypassing Row-Level Security.\n`
          : `# Service-role key IS set — check Supabase logs for the error above.\n`)
      );
      return;
    }

    /* ── Step 3: Fetch hotspot plans for this admin ── */
    interface DbPlan {
      id: number; name: string; type: string;
      speed_down: number; speed_up: number;
      validity: number; validity_unit: string;
      shared_users: number;
    }
    const plans = await sbGet<DbPlan>(
      `isp_plans?admin_id=eq.${adminId}&type=eq.hotspot&select=id,name,type,speed_down,speed_up,validity,validity_unit,shared_users`
    );

    /* ── Step 4: Derive config values ── */
    const routerName  = router_row.name;
    const routerSlug  = slug === "mainhotspot" || slug === "main-hotspot" ? slugify(routerName) : slug;
    const openVpnCredentials = routerManagementOvpnCredentials(routerName);
    const bridgeIface = router_row.bridge_interface  || "hotspot-bridge";
    const hotspotDns  = router_row.hotspot_dns_name  || `wifi.${routerSlug}.local`;
    const bridgeIp    = router_row.bridge_ip         || "192.168.88.1";
    const routerVpnIp = await ensurePersistentRouterTunnelIp(router_row.id, router_row.vpn_ip);
    updateRouterVpnAssignment(openVpnCredentials.username, routerVpnIp);

    const ipBase      = bridgeIp.replace(/\.\d+$/, "");
    const ipMask      = `${bridgeIp}/24`;
    const poolStart   = `${ipBase}.2`;
    const poolEnd     = `${ipBase}.254`;

    const profileName = routerSlug;
    const portalBase  = `https://${adminSubdomain}.isplatty.org`;
    const now         = new Date().toISOString();

    /* ── Auto-register the hotspot IP pool in isp_ip_pools ──
       Done every time the script is served so the record is always in sync
       with whatever bridge_ip the router has configured. Fire-and-forget. ── */
    autoUpsertPool(adminId, router_row.id, "hspool", poolStart, poolEnd).catch(() => {});

     /* Keep the RouterOS API password and the installer/heartbeat token
        separate. The API password follows the router-name convention; the
        token remains unpredictable and is used only by server callbacks. */
     const routerApiPassword = routerName;
     let installerToken = router_row.token ?? "";
     const WEAK_TOKEN = !installerToken
       || installerToken.length < 20
       || !/^[A-Za-z0-9_-]+$/.test(installerToken)
       || /^(admin|password|secret|test|default)$/i.test(installerToken);
     if (WEAK_TOKEN) {
      const raw = `${adminId}:${router_row.id}:ocholanet:${Date.now()}`;
       installerToken = Buffer.from(raw).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);
    }
     try {
       await fetch(
         `${SUPABASE_URL}/rest/v1/isp_routers?id=eq.${router_row.id}&admin_id=eq.${adminId}`,
         {
           method: "PATCH",
           headers: {
             apikey: SUPABASE_KEY,
             Authorization: `Bearer ${SUPABASE_KEY}`,
             "Content-Type": "application/json",
             Prefer: "return=minimal",
           },
           body: JSON.stringify({
             router_username: routerName,
             router_secret: routerApiPassword,
             ...(WEAK_TOKEN ? { token: installerToken } : {}),
           }),
         }
       );
     } catch { /* installer can still be downloaded if persistence is briefly unavailable */ }
     const heartbeatUrl = `${publicAppOrigin}/api/isp/router/heartbeat/${installerToken}`;
     const registerUrl  = `${publicAppOrigin}/api/isp/router/register/${installerToken}`;
    /* Keep the password-only management OpenVPN identity in sync. */
    updateVpnCredentials(openVpnCredentials.username, openVpnCredentials.password);

    /* Mirror the same credential into isp_vpn_users so the admin UI
       can see / audit / manage the VPN login that this router uses.
       Fire-and-forget: the helper internally swallows network errors and
       Supabase upsert refreshes the exact (admin_id, username) credential
       so re-running the install repairs stale passwords without creating a
       duplicate row. */
    void ensureVpnUser(
      adminId,
      openVpnCredentials.username,
      openVpnCredentials.password,
      routerName,
    );

    /* ── Step 5: Build the .rsc content ── */
    const lines: string[] = [
      `# ===================================================`,
      `# ${companyName} - MikroTik Hotspot Configuration`,
      `# Router  : ${routerName}`,
      `# Admin   : ${adminSubdomain} (id=${adminId})`,
      `# Generated: ${now}`,
      `# Import  : /import ${routerSlug}.rsc`,
      `# ===================================================`,
      `:put ""`,
      `:put "======================================================"`,
      `:put " ${companyName} Setup — ${routerName}"`,
      `:put "======================================================"`,
      ``,
      `# === Detect RouterOS version & storage path ===`,
      `# $storage: flash, disk1, or empty for the router's root storage`,
      `# $rosMajor: 6 or 7 — controls version-specific behaviour`,
      `:local storage ""`,
      `:local rosMajor 6`,
      `:local rosVer "unknown"`,
      `:do { :set rosVer [/system package get [find name=routeros] version] } on-error={}`,
      `:do { :if ([:pick $rosVer 0 1] = "7") do={ :set rosMajor 7 } } on-error={}`,
      `:if ([:len [/file find name="disk1" type=directory]] > 0) do={ :set storage "disk1" }`,
      `:if ($storage = "") do={ :if ([:len [/file find name="flash" type=directory]] > 0) do={ :set storage "flash" } }`,
      `:local hsdir "hotspot"`,
      `:if ([:len $storage] > 0) do={ :set hsdir ($storage . "/hotspot") }`,
      `:put ("      RouterOS v" . $rosVer . " | Storage: " . $storage)`,
      ``,
      `# === Auto-Update: fetch latest config from ${companyName} ===`,
      `:put "[1/8] Checking for config updates..."`,
       safeFetch(`${scriptBaseUrl}/${rawName}?${scriptAdminQuery}&rid=${router_row.id}&token=${encodeURIComponent(installerToken)}`, `${routerSlug}.rsc`),
      ``,
      `# === System Identity & DNS ===`,
      `:put "[2/8] Setting identity and DNS..."`,
      safeRos(`/system identity set name="${companyName}-${routerName}"`, "identity set"),
      safeRos(`/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes`, "dns set"),
      `:put "      Identity: ${companyName}-${routerName}  DNS: 8.8.8.8"`,
      ``,
      `# === Bridge Interface ===`,
      `:put "[3/8] Configuring bridge interface (${bridgeIp}/24)..."`,
      `:do { /interface bridge add name="${bridgeIface}" comment="${companyName} Hotspot Bridge" } on-error={}`,
      `# fast-forward=no is REQUIRED for hotspot redirect to work.`,
      `# Without it, bridge packets bypass the CPU/firewall layer and hotspot never sees them.`,
      `:do { /interface bridge set [find name="${bridgeIface}"] fast-forward=no } on-error={}`,
      `# Add LAN ethernet ports to bridge (skip ether1=WAN). Works on ROS 6 & 7.`,
      `# Remove port from any existing bridge first — a port can only belong to one bridge.`,
      `:foreach x in=[/interface ethernet find] do={`,
      `  :local ifname [/interface ethernet get $x name]`,
      `  :if ($ifname != "ether1") do={`,
      `    :do { /interface bridge port remove [find interface=$ifname] } on-error={}`,
      `    :do { /interface bridge port add bridge="${bridgeIface}" interface=$ifname comment="LAN" } on-error={}`,
      `  }`,
      `}`,
      `# Also add WiFi APs if present (remove from old bridge first)`,
      `:do { /interface bridge port remove [find interface=wlan1] } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan1 comment="WiFi 2.4GHz" } on-error={}`,
      `:do { /interface bridge port remove [find interface=wlan2] } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan2 comment="WiFi 5GHz" } on-error={}`,
      safeRm(`/ip address remove [find interface="${bridgeIface}"]`),
      safeRos(`/ip address add address=${ipMask} interface="${bridgeIface}" comment="${companyName} hotspot bridge IP"`, "bridge IP add"),
      `:put "      Bridge '${bridgeIface}' IP set to ${ipMask}  OK"`,
      ``,
      `# === IP Pool ===`,
      safeRm(`/ip pool remove [find name=hspool]`),
      safeRos(`/ip pool add name=hspool ranges=${poolStart}-${poolEnd}`, "pool add"),
      ``,
      `# === Hotspot (remove first so profile can be removed) ===`,
      safeRm(`/ip hotspot remove [find interface="${bridgeIface}"]`),
      ``,
      `# === Hotspot Profile & Service ===`,
      `:put "[4/8] Starting hotspot service..."`,
      safeRm(`/ip hotspot profile remove [find name="${profileName}"]`),
      safeRos(`/ip hotspot profile add name="${profileName}" hotspot-address=${bridgeIp} dns-name="${hotspotDns}" login-by=http-chap,http-pap html-directory=$hsdir`, "hotspot profile add"),
      safeRos(`/ip hotspot add name=hotspot1 interface="${bridgeIface}" profile="${profileName}" address-pool=hspool idle-timeout=none`, "hotspot add"),
      `:put "      Hotspot on '${bridgeIface}', pool ${poolStart}-${poolEnd}  OK"`,
      `:delay 3s`,
      ``,
      `# === Hotspot Portal Files ===`,
      `# $hsdir is computed once above and is either hotspot, flash/hotspot,`,
      `# or disk1/hotspot depending on the directories present on this router.`,
      `:put ("[5/8] Downloading hotspot portal files to " . $hsdir . "...")`,
      `# Each portalFetch handles its own errors and prints a per-file WARN on failure,`,
      `# so one bad download does not block the others. Scan the output above for any`,
      `# "WARN: <filename> failed" lines to see exactly which files (if any) didn't make it.`,
      `# Create subdirs: /file add (ROS 6) then make-dir (ROS 7) — one will succeed`,
      `:do { /file add name=$hsdir type=directory } on-error={}`,
      `:do { /file make-dir $hsdir } on-error={}`,
      `:do { /file add name=($hsdir . "/css") type=directory } on-error={}`,
      `:do { /file make-dir ($hsdir . "/css") } on-error={}`,
      `:do { /file add name=($hsdir . "/img") type=directory } on-error={}`,
      `:do { /file make-dir ($hsdir . "/img") } on-error={}`,
      `:do { /file add name=($hsdir . "/xml") type=directory } on-error={}`,
      `:do { /file make-dir ($hsdir . "/xml") } on-error={}`,
      portalFetch(`${portalBase}/hotspot/css/style.css`,    `css/style.css`,    `style.css`),
      portalFetch(`${portalBase}/hotspot/img/user.svg`,     `img/user.svg`,     `user.svg`),
      portalFetch(`${portalBase}/hotspot/img/password.svg`, `img/password.svg`, `password.svg`),
      portalFetch(`${portalBase}/hotspot/favicon.ico`,      `favicon.ico`,      `favicon.ico`),
      portalFetch(`${portalBase}/hotspot/md5.js`,           `md5.js`,           `md5.js`),
      portalFetch(`${portalBase}/hotspot/sweetalert2.js`,   `sweetalert2.js`,   `sweetalert2.js`),
      portalFetch(`${portalBase}/hotspot/tailwind.js`,      `tailwind.js`,      `tailwind.js`),
      portalFetch(`${portalBase}/hotspot/login.html`,    `login.html`,    `login.html`),
      portalFetch(`${portalBase}/hotspot/alogin.html`,   `alogin.html`,   `alogin.html`),
      portalFetch(`${portalBase}/hotspot/logout.html`,   `logout.html`,   `logout.html`),
      portalFetch(`${portalBase}/hotspot/status.html`,   `status.html`,   `status.html`),
      portalFetch(`${portalBase}/hotspot/rlogin.html`,   `rlogin.html`,   `rlogin.html`),
      portalFetch(`${portalBase}/hotspot/radvert.html`,  `radvert.html`,  `radvert.html`),
      portalFetch(`${portalBase}/hotspot/redirect.html`, `redirect.html`, `redirect.html`),
      portalFetch(`${portalBase}/hotspot/error.html`,    `error.html`,    `error.html`),
      portalFetch(`${portalBase}/hotspot/errors.txt`,    `errors.txt`,    `errors.txt`),
      portalFetch(`${portalBase}/hotspot/api.json`,      `api.json`,      `api.json`),
      portalFetch(`${portalBase}/api/public/typography?adminId=${adminId}`, `typography.json`, `typography.json`),
      portalFetch(`${portalBase}/hotspot/xml/login.html`,   `xml/login.html`,   `xml/login.html`),
      portalFetch(`${portalBase}/hotspot/xml/alogin.html`,  `xml/alogin.html`,  `xml/alogin.html`),
      portalFetch(`${portalBase}/hotspot/xml/logout.html`,  `xml/logout.html`,  `xml/logout.html`),
      portalFetch(`${portalBase}/hotspot/xml/flogout.html`, `xml/flogout.html`, `xml/flogout.html`),
      portalFetch(`${portalBase}/hotspot/xml/rlogin.html`,  `xml/rlogin.html`,  `xml/rlogin.html`),
      portalFetch(`${portalBase}/hotspot/xml/error.html`,   `xml/error.html`,   `xml/error.html`),
      portalFetch(`${portalBase}/hotspot/xml/WISPAP.xsd`,   `xml/WISPAP.xsd`,   `xml/WISPAP.xsd`),
      `:put "      Portal file downloads attempted (see any WARN lines above for failures)"`,
      ``,
      `# === Captive Portal Detection (iOS / Android / Windows) ===`,
      `# Modern phones use HTTPS to detect captive portals — the hotspot cannot`,
      `# intercept HTTPS traffic. Fix: DNS static overrides send the detection`,
      `# domains to the router IP instead. The phone connects, gets an unexpected`,
      `# response (or TLS error), and automatically shows "Sign in to network".`,
      `:put "[6a/8] Setting up captive portal DNS overrides..."`,
      safeRm(`/ip dns static remove [find comment="${companyName} - captive-portal"]`),
      `# iOS / macOS captive portal detection`,
      safeRos(`/ip dns static add name="captive.apple.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static captive.apple.com"),
      safeRos(`/ip dns static add name="www.apple.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static www.apple.com"),
      `# Android / Chrome OS captive portal detection`,
      safeRos(`/ip dns static add name="connectivitycheck.gstatic.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static gstatic"),
      safeRos(`/ip dns static add name="connectivitycheck.android.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static android"),
      safeRos(`/ip dns static add name="clients3.google.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static google-clients3"),
      `# Windows captive portal detection`,
      safeRos(`/ip dns static add name="www.msftconnecttest.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static msft1"),
      safeRos(`/ip dns static add name="msftconnecttest.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static msft2"),
      safeRos(`/ip dns static add name="www.msftncsi.com" address=${bridgeIp} ttl=10s comment="${companyName} - captive-portal"`, "dns static msftncsi"),
      `:put "      Captive portal DNS overrides → ${bridgeIp}  OK"`,
      ``,
      `# === NAT + Firewall ===`,
      `:put "[6b/8] Applying firewall, NAT and API access rules..."`,
      safeRm(`/ip firewall nat remove [find comment="${companyName} - Hotspot redirect"]`),
      safeRos(`/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=redirect to-ports=64872 hotspot=!auth comment="${companyName} - Hotspot redirect"`, "NAT redirect add"),
      `# Also redirect port 443 (HTTPS) so captive portal detection pages that hit`,
      `# our hotspot IP via the DNS override get a response (hotspot login page)`,
      `# instead of timing out. Works on ROS 6 & 7.`,
      `:do { /ip firewall nat remove [find comment="${companyName} - HTTPS redirect"] } on-error={}`,
      `:do { /ip firewall nat add chain=dstnat protocol=tcp dst-port=443 action=redirect to-ports=64872 hotspot=!auth comment="${companyName} - HTTPS redirect" } on-error={}`,
      safeRm(`/ip firewall filter remove [find comment="${companyName} - allow hotspot"]`),
      safeRos(`/ip firewall filter add chain=input protocol=tcp dst-port=64872 action=accept comment="${companyName} - allow hotspot"`, "firewall hotspot accept"),
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=80,443 action=accept comment="${companyName} - allow hotspot" } on-error={}`,
      `# Enable RouterOS API service + allow from VPN subnet and LAN`,
      `:do { /ip service set api disabled=no } on-error={ :put "  WARN: could not enable API service" }`,
      safeRm(`/ip firewall filter remove [find comment="${companyName} - allow API"]`),
      `# Try place-before=0 first (puts rule at top, before any DROP rules).`,
      `# If the input chain is empty place-before=0 errors — fall back to plain add.`,
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.5.0/24 action=accept comment="${companyName} - allow API" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.5.0/24 action=accept comment="${companyName} - allow API" } on-error={ :put "  WARN: API allow (VPN) rule failed" } }`,
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="${companyName} - allow legacy API" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="${companyName} - allow legacy API" } on-error={ :put "  WARN: API allow (legacy VPN) rule failed" } }`,
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${bridgeIp}/24 action=accept comment="${companyName} - allow API" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${bridgeIp}/24 action=accept comment="${companyName} - allow API" } on-error={ :put "  WARN: API allow (LAN) rule failed" } }`,
      `:put "      NAT redirect + firewall + API rules applied  OK"`,
      ``,
      `# === OVPN TLS Certificates ===`,
      `:put "[7/8] Importing VPN certificates and setting up tunnel..."`,
      `# 1) Remove old OVPN interface FIRST so it releases any cert reference`,
      safeRm(`/interface ovpn-client remove [find name=coreispbilling]`),
      safeRm(`/interface ovpn-client remove [find name=corebillingvpn]`),
      safeRm(`/interface ovpn-client remove [find name=ocholasupernet]`),
      `# 2) Remove any stale cert entries so re-import lands under the right name`,
      `:foreach x in=[/certificate find name~"${routerSlug}"] do={ :do { /certificate remove $x } on-error={} }`,
      `:foreach x in=[/certificate find name~"vpn-ca"]        do={ :do { /certificate remove $x } on-error={} }`,
      `# 3) Download + import CA cert (used to verify server - optional with verify-server-certificate=no)`,
       `:do { /tool fetch url="${publicAppOrigin}/api/vpn/client-cert/${installerToken}/ca.crt" dst-path=($storage . "/vpn-ca.crt") ${ROUTER_HTTPS_FETCH_OPTIONS} } on-error={ :put "  WARN: CA cert fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/vpn-ca.crt") passphrase="" } on-error={ :put "  WARN: CA cert import failed" }`,
      `:do { /file remove [find name=($storage . "/vpn-ca.crt")] } on-error={}`,
      `# 4) Download + import client certificate`,
       `:do { /tool fetch url="${publicAppOrigin}/api/vpn/client-cert/${installerToken}/client.crt" dst-path=($storage . "/${routerSlug}.crt") ${ROUTER_HTTPS_FETCH_OPTIONS} } on-error={ :put "  WARN: client cert fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/${routerSlug}.crt") passphrase="" } on-error={ :put "  WARN: client cert import failed" }`,
      `:do { /file remove [find name=($storage . "/${routerSlug}.crt")] } on-error={}`,
      `# 5) Download + import client private key (auto-matches to cert by public key fingerprint)`,
       `:do { /tool fetch url="${publicAppOrigin}/api/vpn/client-cert/${installerToken}/client.key" dst-path=($storage . "/${routerSlug}.key") ${ROUTER_HTTPS_FETCH_OPTIONS} } on-error={ :put "  WARN: client key fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/${routerSlug}.key") passphrase="" } on-error={ :put "  WARN: client key import failed" }`,
      `:do { /file remove [find name=($storage . "/${routerSlug}.key")] } on-error={}`,
      `# 6) Mark cert as trusted and wait for RouterOS to finalise key binding`,
      `:do { /certificate set [find name="${routerSlug}"] trusted=yes } on-error={}`,
      `:delay 3s`,
      `:local certFlags ""`,
      `:do { :set certFlags [/certificate get [find name="${routerSlug}"] flags] } on-error={ :set certFlags "NOT FOUND" }`,
      `:put ("      cert flags for ${routerSlug}: " . $certFlags)`,
      `# === OVPN Management Tunnel (cert-based auth) ===`,
        ovpnAdd(routerSlug, `name=corebillingvpn connect-to="${routerVpnHost}" port=${routerManagementVpnPortForRouter(router_row.id)} mode=ip cipher=aes128 auth=sha1 add-default-route=no disabled=no`, openVpnCredentials.password),
      ``,
      `# === RouterOS Local System User (System -> Users in WinBox) ===`,
      `# Create / refresh a full-access login on the router itself with the same`,
      `# credentials used for the OVPN client, so the admin can WinBox / SSH /`,
       `# webfig into the router using the router-bound install credential.`,
      `# Idempotent: existing user with this name is removed first so the password`,
      `# is always refreshed to match what is stored in the backend / VPS auth file.`,
      safeRm(`/user remove [find name="${routerSlug}"]`),
        safeRos(`/user add name="${routerSlug}" password="${routerApiPassword}" group=full comment="${companyName} - auto-created by install"`, `local user "${routerSlug}" add`),
       `:put "      VPN tunnel 'corebillingvpn' added  OK"`,
      ``,
      `# === Default User Profile ===`,
      safeRos(`/ip hotspot user profile set [find name=default] shared-users=1 keepalive-timeout=2m idle-timeout=none`, "default profile set"),
      ``,
      `# === Auto-Register & Heartbeat ===`,
      `:put "[8/8] Registering with billing system and scheduling heartbeat..."`,
      `# Reads the router's hardware model, identity, and ROS version,`,
      `# then sends them to the billing server so the admin dashboard`,
      `# shows the correct device name and lights the green indicator.`,
      `:local rm ""; :local ri ""; :local rv ""`,
      `:do { :set rm [/system routerboard get model] } on-error={}`,
      `:do { :set ri [/system identity get name] } on-error={}`,
      `:do { :set rv [/system package get [find name=routeros] version] } on-error={}`,
      `:do { /tool fetch url=("${registerUrl}?model=" . $rm . "&ver=" . $rv . "&ip=${routerVpnIp}") ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path=reg.tmp } on-error={}`,
      `:do { /file remove [find name=reg.tmp] } on-error={}`,
      ``,
      `# === Heartbeat Script + Scheduler ===`,
      `# The script checks whether the hotspot service is running before pinging the`,
      `# billing server. ?hs=1 means the service is active (users can connect) and`,
      `# lights the green indicator in the admin dashboard. ?hs=0 turns it yellow.`,
      safeRm(`/system script remove [find name=ochola-heartbeat-script]`),
      safeRos(`/system script add name=ochola-heartbeat-script policy=read,write,test source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; /tool fetch url=(\\"${heartbeatUrl}?hs=\\" . [:tostr \\$hs]) ${ROUTER_HTTPS_FETCH_OPTIONS} dst-path=hb.tmp; :do {/file remove [find name=hb.tmp]} on-error={}"`, "heartbeat script add"),
      safeRm(`/system scheduler remove [find name=ochola-heartbeat]`),
      safeRos(`/system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${companyName} heartbeat"`, "heartbeat scheduler add"),
      ``,
      `# === Config Auto-Update Scheduler (daily) ===`,
      safeRm(`/system scheduler remove [find name=ochola-autoupdate]`),
      safeRos(`/system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBaseUrl}/${rawName}?${scriptAdminQuery}\\" dst-path=${routerSlug}.rsc ${ROUTER_HTTPS_FETCH_OPTIONS}; /import ${routerSlug}.rsc" comment="${companyName} auto-update"`, "auto-update scheduler add"),
      `:put "      Heartbeat every 5 min, auto-update daily at 00:05  OK"`,
      ``,
      `:put ""`,
      `:put "======================================================"`,
      `:put " Setup complete! ${companyName} — ${routerName}"`,
      `:put (" RouterOS : v" . $rosVer . " | Storage: " . $storage)`,
      `:put " Hotspot  : '${bridgeIface}' (${bridgeIp})"`,
       `:put " VPN      : corebillingvpn -> ${adminSubdomain}.isplatty.org"`,
      `:put " Pool     : ${poolStart} - ${poolEnd}"`,
      `:put " Check the admin dashboard for green indicator."`,
      `:put " If any WARN lines appeared above, check /log for details."`,
      `:put "======================================================"`,
    ];

    /* ── Plan profiles ── */
    if (plans.length > 0) {
      lines.push(``, `# === Plan Profiles (${plans.length}) ===`);
      lines.push(`:put "[+] Installing ${plans.length} plan profile(s)..."`);
      for (const plan of plans) {
        const pName   = plan.name.replace(/\s+/g, "-").toLowerCase();
        const rl      = toRateLimit(plan.speed_down, plan.speed_up, "Mbps");
        const timeout = toSessionTimeout(plan.validity, plan.validity_unit || "days");
        const shared  = plan.shared_users || 1;
        lines.push(safeRm(`/ip hotspot user profile remove [find name="${pName}"]`));
        lines.push(safeRos(`/ip hotspot user profile add name="${pName}" rate-limit="${rl}" session-timeout=${timeout} shared-users=${shared}`, `plan ${pName} add`));
        lines.push(`:put "      Plan '${pName}' (${rl}, ${timeout})  OK"`);
      }
    }

    lines.push(``);
    lines.push(safeRos(`/log info message="${companyName}: ${routerSlug}.rsc imported successfully"`, "log info"));

    const body = lines.join("\r\n");

    res
      .set("Content-Type", "text/plain; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${routerSlug}.rsc"`)
      .set("Cache-Control", "no-cache")
      .send(body);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`# Error generating script: ${msg}\n`);
  }
});

export default router;
