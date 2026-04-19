import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { ensureClientCert } from "./vpn-route.js";

const router: IRouter = Router();

/* Prefer VITE_SUPABASE_URL (the REST API base URL). SUPABASE_URL may be a bare
   DB hostname without https:// — so always fall back to VITE_ first. */
function resolveUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}
const SUPABASE_URL = resolveUrl();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";

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
  const hostname = host.split(":")[0]; // strip port
  // If it's an IP address, there's no subdomain
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return "";
  const parts = hostname.split(".");
  return parts.length >= 3 ? parts[0] : "";
}

/* ── Slug ↔ name helpers ── */
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
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
function ovpnAdd(slug: string, baseFields: string): string {
  /* Attempt 1: cert + password, verify-server-certificate=no (ROS 7) */
  const a1 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="ocholasupernet" certificate=${slug} verify-server-certificate=no`);
  /* Attempt 2: cert + password, no verify-server-certificate (ROS 6) */
  const a2 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="ocholasupernet" certificate=${slug}`);
  /* Attempt 3: password-only fallback — works even if cert import failed */
  const a3 = ros(`/interface ovpn-client add ${baseFields} user="${slug}" password="ocholasupernet"`);
  return [
    `:do { ${a1} } on-error={`,
    ` :do { ${a2} } on-error={`,
    `  :do { ${a3} } on-error={ :put "  WARN: VPN add failed - check /log" }`,
    ` }`,
    `}`,
  ].join("\r\n");
}

/* ── Safe fetch (static path): wraps /tool fetch in :do {} on-error={}.
   The file simply won't be updated if the fetch fails — prior versions
   on flash remain intact. ── */
function safeFetch(url: string, dst: string): string {
  return `:do { /tool fetch url="${url}" dst-path="${dst}" mode=https check-certificate=no } on-error={}`;
}

/* ── Portal file fetch: uses pre-computed $hsdir variable and reports
   exactly which file failed by name, so silent failures are visible.
   filename is the short name shown in WARN output.  ── */
function portalFetch(url: string, subpath: string, filename: string): string {
  return `:do { /tool fetch url="${url}" dst-path=($hsdir . "/${subpath}") mode=https check-certificate=no } on-error={ :put "  WARN: ${filename} failed" }`;
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

/* ── VPN psw-file updater ──
   Keeps /etc/openvpn/psw-file in sync with the router's credentials.
   The checkpsw.sh script reads this file on every connection attempt,
   so no OpenVPN reload is needed — just a file write.
   No-ops when the file doesn't exist (dev / non-VPS environments). ── */
const PSW_FILE = "/etc/openvpn/psw-file";
function updateVpnCredentials(username: string, password: string): void {
  try {
    const existing = existsSync(PSW_FILE) ? readFileSync(PSW_FILE, "utf-8") : "";
    const lines = existing.split("\n").filter(l => l.trim() && !l.startsWith(`${username} `));
    lines.push(`${username} ${password}`);
    writeFileSync(PSW_FILE, lines.join("\n") + "\n", { mode: 0o600 });
  } catch { /* non-root dev env — silently skip */ }
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
        /* Upsert: ignore conflict on (admin_id, username) */
        Prefer:          "resolution=ignore-duplicates,return=minimal",
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

/* ═══════════════════════════════════════════════════════════════
   Static mainhotspot.rsc — the entry-point orchestrator script.
   Downloads VPN, hotspot, PPPoE, sync and heartbeat sub-scripts
   from safenetworks.isplatty.org, then installs them in order.
═══════════════════════════════════════════════════════════════ */
const MAINHOTSPOT_RSC = `# Main ISP Setup Script (mainhotspot.rsc)
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.

:global version [/system package update get installed-version]
:local majorVersion 0
:local minorVersion 0
:local dotPos [:find $version "."]
:if ([:len $dotPos] > 0) do={
    :set majorVersion [:tonum [:pick $version 0 $dotPos]]
    :local remaining [:pick $version ($dotPos + 1) [:len $version]]
    :set dotPos [:find $remaining "."]
    :if ([:len $dotPos] > 0) do={
        :set minorVersion [:tonum [:pick $remaining 0 $dotPos]]
    }
}
:if ($majorVersion < 6 || ($majorVersion = 6 && $minorVersion < 48)) do={
    :put "RouterOS version 6.48 or higher is required."
    :error "RouterOS version 6.48 or higher is required."
}
:if ([/ping 8.8.8.8 count=3] = 0) do={
    :error "No internet connection. Please check your internet connection and try again."
}
:do {
    :put "Downloading VPN configuration..."
    :local vpnUrl
    :if ($majorVersion = 7) do={
        :set vpnUrl "https://safenetworks.isplatty.org/scripts/vpn7.rsc"
    } else={
        :set vpnUrl "https://safenetworks.isplatty.org/scripts/vpn6.rsc"
    }
    /tool fetch url=$vpnUrl dst-path=vpnsetup.rsc mode=https
    :delay 2s
    :put "Applying VPN configuration..."
    /import vpnsetup.rsc
    /file remove vpnsetup.rsc
    :put "Downloading hotspot configuration..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/hotspotsetup.rsc" dst-path=hotspotsetup.rsc mode=https
    :delay 2s
    :put "Applying hotspot configuration..."
    /import hotspotsetup.rsc
    /file remove hotspotsetup.rsc
    :put "Downloading PPPoE configuration..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/pppoesetup.rsc" dst-path=pppoesetup.rsc mode=https
    :delay 2s
    :put "Applying PPPoE configuration..."
    /import pppoesetup.rsc
    /file remove pppoesetup.rsc
    :put "Downloading users configuration..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/users.rsc" dst-path=users.rsc mode=https
    :delay 2s
    :put "Applying users configuration..."
    /import users.rsc
    /file remove users.rsc
    :put "Downloading sync-users firewalls..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/syncusers.rsc" dst-path=syncusers.rsc mode=https
    :delay 2s
    :put "Applying sync-users firewalls..."
    /import syncusers.rsc
    /file remove syncusers.rsc
    :put "Downloading heartbeat firewalls..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/heartbeat.rsc" dst-path=heartbeat.rsc mode=https
    :delay 2s
    :put "Applying heartbeat firewalls..."
    /import heartbeat.rsc
    /file remove heartbeat.rsc
    :put "Downloading sync-full script..."
    /tool fetch url="https://safenetworks.isplatty.org/scripts/syncfull.rsc" dst-path=syncfull.rsc mode=https
    :delay 2s
    :put "Applying sync-full script..."
    /import syncfull.rsc
    /file remove syncfull.rsc

    :put "Setting up DNS flush firewalls..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
    /ip dns cache flush
    :put "DNS flush firewalls installed (every 6 hours)"

    :put "All configurations completed successfully."
} on-error={
    :put "Error occurred during configuration:"
    :put $error
}
`;

router.get("/scripts/mainhotspot.rsc", (_req, res): void => {
  res.type("text/plain");
  res.send(MAINHOTSPOT_RSC);
});

/* ═══════════════════════════════════════════════════════════════
   Static vlanpppoe.rsc — PPPoE VLAN setup script.
   Creates a VLAN interface on hotspot-bridge (VLAN ID 200),
   runs a PPPoE server on it, sets up hotspot captive portal for
   expired/unpaid clients, and configures walled-garden entries.
═══════════════════════════════════════════════════════════════ */
const VLANPPPOE_RSC = `# vlanpppoe.rsc
:log info "PPPoE VLAN: init (vlan-id=200, base=hotspot-bridge)";

:log info "PPPoE VLAN: fetching login.html from https://safenetworks.isplatty.org/pppoe/pppoefiles/login.html";
/tool fetch url="https://safenetworks.isplatty.org/pppoe/pppoefiles/login.html" mode=https dst-path="pppoe/login.html"

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

router.get("/scripts/vlanpppoe.rsc", (_req, res): void => {
  res.type("text/plain");
  res.send(VLANPPPOE_RSC);
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

    let adminId        = 5;          // safe fallback
    let adminSubdomain = subdomain || "ocholasupernet";
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
      /* Fallback: explicit query param — use ID directly, try to fetch name but don't fail */
      const qid = parseInt(req.query.admin_id as string, 10);
      if (!isNaN(qid)) {
        adminId        = qid;
        adminSubdomain = `admin${qid}`;
        try {
          const admins = await sbGet<DbAdmin>(
            `isp_admins?id=eq.${qid}&select=id,name,subdomain&limit=1`
          );
          if (admins.length > 0) {
            adminSubdomain = admins[0].subdomain ?? `admin${qid}`;
            companyName    = admins[0].name;
          }
        } catch { /* use defaults if RLS blocks */ }
      }
    }

    /* Self-referencing script URL for auto-update inside the .rsc */
    const scriptBaseUrl = `https://${adminSubdomain}.${baseDomain}/api/scripts`;

    /* ── Step 2: Fetch routers for this admin ── */
    interface DbRouter {
      id: number; name: string; host: string;
      bridge_interface: string | null;
      hotspot_dns_name: string | null;
      bridge_ip: string | null;
      router_secret: string | null;
      last_seen: string | null;
      status: string;
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${adminId}&select=id,name,host,bridge_interface,hotspot_dns_name,bridge_ip,router_secret,last_seen,status`
    );

    /* ── Helper to decide if a router record is "pending" (not yet installed) ── */
    const STALE_MS = 12 * 60 * 1000;
    function isPending(r: DbRouter): boolean {
      if (!r.last_seen) return true;
      return (Date.now() - new Date(r.last_seen).getTime()) > STALE_MS;
    }

    /* "mainhotspot" always serves the NEXT router that needs configuring:
       1. First router that hasn't connected yet (pending)
       2. If all are installed → auto-create the next numbered one
       Any other slug → find router by name, or auto-create on-the-fly */
    let router_row: DbRouter | undefined;
    if (slug === "mainhotspot" || slug === "main-hotspot") {
      router_row = routers.find(isPending) ?? routers[0];
      // If still undefined → all installed, we'll auto-create below
    } else {
      router_row = routers.find(r => slugify(r.name) === slug);
    }

    /* ── Auto-create when no matching router found ──
       • mainhotspot  → name = ${adminSubdomain}${N}
       • specific slug (e.g. come1) → name = that slug exactly
         (handles the case where the frontend DB insert failed silently) */
    if (!router_row) {
      const autoSecret = Buffer
        .from(`${adminId}:${Date.now()}:ocholanet`)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 48);

      const isMainHotspot = slug === "mainhotspot" || slug === "main-hotspot";
      const autoName = isMainHotspot
        ? `${adminSubdomain}${routers.length + 1}`
        : slug;   // use the slug as the router name (e.g. "come1")

      let createError = "";
      /* Try service-role key first (bypasses RLS), then anon key */
      const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? "";
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
                router_username:  "admin",
                router_secret:    autoSecret,
                token:            autoSecret,  /* NOT NULL column */
                bridge_interface: "hotspot-bridge",
                bridge_ip:        "192.168.88.1",
                status:           "offline",
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
      const serviceSet = !!process.env.SUPABASE_SERVICE_KEY;
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
    const bridgeIface = router_row.bridge_interface  || "hotspot-bridge";
    const hotspotDns  = router_row.hotspot_dns_name  || `wifi.${routerSlug}.local`;
    const bridgeIp    = router_row.bridge_ip         || "192.168.88.1";

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

    /* ── Router secret token for heartbeat ──
       If the router already has a secret, use it.
       Otherwise generate one, persist it to Supabase, then use it.
    ── */
    let routerSecret = router_row.router_secret;
    /* Treat missing, too-short, or obvious placeholder secrets as invalid
       and auto-generate a proper 40-char alphanumeric token. */
    const WEAK = !routerSecret || routerSecret.length < 20 || /^(admin|password|secret|test|default)$/i.test(routerSecret);
    if (WEAK) {
      const raw = `${adminId}:${router_row.id}:ocholanet:${Date.now()}`;
      routerSecret = Buffer.from(raw).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);
      /* Persist to DB (best-effort, don't fail the request if this errors) */
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
            body: JSON.stringify({ router_secret: routerSecret }),
          }
        );
      } catch { /* ignore */ }
    }
    const heartbeatUrl = `https://${adminSubdomain}.${baseDomain}/api/isp/router/heartbeat/${routerSecret}`;
    const registerUrl  = `https://${adminSubdomain}.${baseDomain}/api/isp/router/register/${routerSecret}`;

    /* Ensure this router has a TLS client certificate ready on the server.
       Also keeps the psw-file in sync as a fallback during transition. */
    ensureClientCert(routerSlug);
    updateVpnCredentials(routerSlug, "ocholasupernet");

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
      `# $storage: flash (NAND/internal) or disk1 (CHR / USB primary)`,
      `# $rosMajor: 6 or 7 — controls version-specific behaviour`,
      `:local storage "flash"`,
      `:local rosMajor 6`,
      `:local rosVer "unknown"`,
      `:do { :set rosVer [/system package get [find name=routeros] version] } on-error={}`,
      `:do { :if ([:pick $rosVer 0 1] = "7") do={ :set rosMajor 7 } } on-error={}`,
      `:if ([:len [/file find name="disk1" type=directory]] > 0) do={ :set storage "disk1" }`,
      `:put ("      RouterOS v" . $rosVer . " | Storage: " . $storage)`,
      ``,
      `# === Auto-Update: fetch latest config from ${companyName} ===`,
      `:put "[1/8] Checking for config updates..."`,
      safeFetch(`${scriptBaseUrl}/${rawName}`, `${routerSlug}.rsc`),
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
      safeRos(`/ip hotspot profile add name="${profileName}" hotspot-address=${bridgeIp} dns-name="${hotspotDns}" login-by=http-chap,http-pap html-directory=($storage . "/hotspot")`, "hotspot profile add"),
      safeRos(`/ip hotspot add name=hotspot1 interface="${bridgeIface}" profile="${profileName}" address-pool=hspool idle-timeout=none`, "hotspot add"),
      `:put "      Hotspot on '${bridgeIface}', pool ${poolStart}-${poolEnd}  OK"`,
      `:delay 3s`,
      ``,
      `# === Hotspot Portal Files ===`,
      `# $hsdir is a pre-computed scalar (not an inline expression) so it`,
      `# works reliably on all RouterOS versions including very old builds.`,
      `:local hsdir ($storage . "/hotspot")`,
      `:if ($storage = "flash") do={ :set hsdir "flash/hotspot" }`,
      `:if ($storage = "disk1") do={ :set hsdir "disk1/hotspot" }`,
      `:put ("[5/8] Downloading hotspot portal files to " . $hsdir . "...")`,
      `# --- HTTPS connectivity check (hits healthz — always 200 if server reachable) ---`,
      `:local httpsOk false`,
      `:do { /tool fetch url="https://${adminSubdomain}.${baseDomain}/api/healthz" dst-path=($storage . "/hs-check.tmp") mode=https check-certificate=no; :set httpsOk true; :do { /file remove [find name=($storage . "/hs-check.tmp")] } on-error={} } on-error={ :put "  WARN: HTTPS unreachable from this router - portal files skipped" }`,
      `:if ($httpsOk) do={`,
      `  # Create subdirs: /file add (ROS 6) then make-dir (ROS 7) — one will succeed`,
      `  :do { /file add name=$hsdir type=directory } on-error={}`,
      `  :do { /file make-dir $hsdir } on-error={}`,
      `  :do { /file add name=($hsdir . "/css") type=directory } on-error={}`,
      `  :do { /file make-dir ($hsdir . "/css") } on-error={}`,
      `  :do { /file add name=($hsdir . "/img") type=directory } on-error={}`,
      `  :do { /file make-dir ($hsdir . "/img") } on-error={}`,
      `  :do { /file add name=($hsdir . "/xml") type=directory } on-error={}`,
      `  :do { /file make-dir ($hsdir . "/xml") } on-error={}`,
      `  ` + portalFetch(`${portalBase}/hotspot/css/style.css`,    `css/style.css`,    `style.css`),
      `  ` + portalFetch(`${portalBase}/hotspot/img/user.svg`,     `img/user.svg`,     `user.svg`),
      `  ` + portalFetch(`${portalBase}/hotspot/img/password.svg`, `img/password.svg`, `password.svg`),
      `  ` + portalFetch(`${portalBase}/hotspot/favicon.ico`,      `favicon.ico`,      `favicon.ico`),
      `  ` + portalFetch(`${portalBase}/hotspot/md5.js`,           `md5.js`,           `md5.js`),
      `  ` + portalFetch(`${portalBase}/hotspot/sweetalert2.js`,   `sweetalert2.js`,   `sweetalert2.js`),
      `  ` + portalFetch(`${portalBase}/hotspot/tailwind.js`,      `tailwind.js`,      `tailwind.js`),
      `  ` + portalFetch(`${portalBase}/hotspot/login.html`,    `login.html`,    `login.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/alogin.html`,   `alogin.html`,   `alogin.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/logout.html`,   `logout.html`,   `logout.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/status.html`,   `status.html`,   `status.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/rlogin.html`,   `rlogin.html`,   `rlogin.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/radvert.html`,  `radvert.html`,  `radvert.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/redirect.html`, `redirect.html`, `redirect.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/error.html`,    `error.html`,    `error.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/errors.txt`,    `errors.txt`,    `errors.txt`),
      `  ` + portalFetch(`${portalBase}/hotspot/api.json`,      `api.json`,      `api.json`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/login.html`,   `xml/login.html`,   `xml/login.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/alogin.html`,  `xml/alogin.html`,  `xml/alogin.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/logout.html`,  `xml/logout.html`,  `xml/logout.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/flogout.html`, `xml/flogout.html`, `xml/flogout.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/rlogin.html`,  `xml/rlogin.html`,  `xml/rlogin.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/error.html`,   `xml/error.html`,   `xml/error.html`),
      `  ` + portalFetch(`${portalBase}/hotspot/xml/WISPAP.xsd`,   `xml/WISPAP.xsd`,   `xml/WISPAP.xsd`),
      `  :put "      Portal files downloaded  OK"`,
      `}`,
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
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="${companyName} - allow API" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="${companyName} - allow API" } on-error={ :put "  WARN: API allow (VPN) rule failed" } }`,
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${bridgeIp}/24 action=accept comment="${companyName} - allow API" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${bridgeIp}/24 action=accept comment="${companyName} - allow API" } on-error={ :put "  WARN: API allow (LAN) rule failed" } }`,
      `:put "      NAT redirect + firewall + API rules applied  OK"`,
      ``,
      `# === OVPN TLS Certificates ===`,
      `:put "[7/8] Importing VPN certificates and setting up tunnel..."`,
      `# 1) Remove old OVPN interface FIRST so it releases any cert reference`,
      safeRm(`/interface ovpn-client remove [find name=ocholasupernet]`),
      `# 2) Remove any stale cert entries so re-import lands under the right name`,
      `:foreach x in=[/certificate find name~"${routerSlug}"] do={ :do { /certificate remove $x } on-error={} }`,
      `:foreach x in=[/certificate find name~"vpn-ca"]        do={ :do { /certificate remove $x } on-error={} }`,
      `# 3) Download + import CA cert (used to verify server - optional with verify-server-certificate=no)`,
      `:do { /tool fetch url="https://${adminSubdomain}.${baseDomain}/api/vpn/client-cert/${routerSecret}/ca.crt" dst-path=($storage . "/vpn-ca.crt") mode=https check-certificate=no } on-error={ :put "  WARN: CA cert fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/vpn-ca.crt") passphrase="" } on-error={ :put "  WARN: CA cert import failed" }`,
      `:do { /file remove [find name=($storage . "/vpn-ca.crt")] } on-error={}`,
      `# 4) Download + import client certificate`,
      `:do { /tool fetch url="https://${adminSubdomain}.${baseDomain}/api/vpn/client-cert/${routerSecret}/client.crt" dst-path=($storage . "/${routerSlug}.crt") mode=https check-certificate=no } on-error={ :put "  WARN: client cert fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/${routerSlug}.crt") passphrase="" } on-error={ :put "  WARN: client cert import failed" }`,
      `:do { /file remove [find name=($storage . "/${routerSlug}.crt")] } on-error={}`,
      `# 5) Download + import client private key (auto-matches to cert by public key fingerprint)`,
      `:do { /tool fetch url="https://${adminSubdomain}.${baseDomain}/api/vpn/client-cert/${routerSecret}/client.key" dst-path=($storage . "/${routerSlug}.key") mode=https check-certificate=no } on-error={ :put "  WARN: client key fetch failed" }`,
      `:do { /certificate import file-name=($storage . "/${routerSlug}.key") passphrase="" } on-error={ :put "  WARN: client key import failed" }`,
      `:do { /file remove [find name=($storage . "/${routerSlug}.key")] } on-error={}`,
      `# 6) Mark cert as trusted and wait for RouterOS to finalise key binding`,
      `:do { /certificate set [find name="${routerSlug}"] trusted=yes } on-error={}`,
      `:delay 3s`,
      `:local certFlags ""`,
      `:do { :set certFlags [/certificate get [find name="${routerSlug}"] flags] } on-error={ :set certFlags "NOT FOUND" }`,
      `:put ("      cert flags for ${routerSlug}: " . $certFlags)`,
      `# === OVPN Management Tunnel (cert-based auth) ===`,
      ovpnAdd(routerSlug, `name=ocholasupernet connect-to="${adminSubdomain}.isplatty.org" port=1194 mode=ip cipher=aes256 auth=sha1 add-default-route=no disabled=no`),
      `:put "      VPN tunnel 'ocholasupernet' added  OK"`,
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
      `:do { /tool fetch url=("${registerUrl}?model=" . $rm . "&ver=" . $rv . "&ip=${bridgeIp}") mode=https check-certificate=no dst-path=reg.tmp } on-error={}`,
      `:do { /file remove [find name=reg.tmp] } on-error={}`,
      ``,
      `# === Heartbeat Script + Scheduler ===`,
      `# The script checks whether the hotspot service is running before pinging the`,
      `# billing server. ?hs=1 means the service is active (users can connect) and`,
      `# lights the green indicator in the admin dashboard. ?hs=0 turns it yellow.`,
      safeRm(`/system script remove [find name=ochola-heartbeat-script]`),
      safeRos(`/system script add name=ochola-heartbeat-script policy=read,write,test source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; /tool fetch url=(\\"${heartbeatUrl}?hs=\\" . [:tostr \\$hs]) mode=https check-certificate=no dst-path=hb.tmp; :do {/file remove [find name=hb.tmp]} on-error={}"`, "heartbeat script add"),
      safeRm(`/system scheduler remove [find name=ochola-heartbeat]`),
      safeRos(`/system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${companyName} heartbeat"`, "heartbeat scheduler add"),
      ``,
      `# === Config Auto-Update Scheduler (daily) ===`,
      safeRm(`/system scheduler remove [find name=ochola-autoupdate]`),
      safeRos(`/system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBaseUrl}/${rawName}\\" dst-path=${routerSlug}.rsc mode=https check-certificate=no; /import ${routerSlug}.rsc" comment="${companyName} auto-update"`, "auto-update scheduler add"),
      `:put "      Heartbeat every 5 min, auto-update daily at 00:05  OK"`,
      ``,
      `:put ""`,
      `:put "======================================================"`,
      `:put " Setup complete! ${companyName} — ${routerName}"`,
      `:put (" RouterOS : v" . $rosVer . " | Storage: " . $storage)`,
      `:put " Hotspot  : '${bridgeIface}' (${bridgeIp})"`,
      `:put " VPN      : ocholasupernet -> ${adminSubdomain}.isplatty.org"`,
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
