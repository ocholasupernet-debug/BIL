import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";

const router: IRouter = Router();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.VITE_SUPABASE_KEY ?? "";

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
   Level 1: with verify-server-certificate=no  (ROS 6.16+)
   Level 2: without verify-server-certificate  (older ROS 6 that lacks the param)
   RouterOS cipher enum uses "aes256" — never "aes256-cbc" (that's OpenSSL format).
   Each level only runs if the one above failed. ── */
function ovpnAdd(fields: string): string {
  const withV = ros(`/interface ovpn-client add ${fields} verify-server-certificate=no`);
  const bare  = ros(`/interface ovpn-client add ${fields}`);
  return [
    `:do { ${withV} } on-error={`,
    ` :do { ${bare} } on-error={ :put "  WARN: VPN add failed - check /log" }`,
    `}`,
  ].join("\r\n");
}

/* ── Safe fetch (static path): wraps /tool fetch in :do {} on-error={}.
   The file simply won't be updated if the fetch fails — prior versions
   on flash remain intact. ── */
function safeFetch(url: string, dst: string): string {
  return `:do { /tool fetch url="${url}" dst-path="${dst}" mode=https } on-error={}`;
}

/* ── Portal file fetch: uses pre-computed $hsdir variable and reports
   exactly which file failed by name, so silent failures are visible.
   filename is the short name shown in WARN output.  ── */
function portalFetch(url: string, subpath: string, filename: string): string {
  return `:do { /tool fetch url="${url}" dst-path=($hsdir . "/${subpath}") mode=https } on-error={ :put "  WARN: ${filename} failed" }`;
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

/* ═══════════════════════════════════════════════════════════════
   GET /api/scripts/:name
   Dynamically generates a RouterOS .rsc file.

   Admin identification (priority order):
     1. Subdomain from Host header  → looks up isp_admins.subdomain
     2. ?admin_id=N query param     → used directly
     3. Falls back to admin_id=5

   Example:
     https://fastnet.isplatty.org/api/scripts/mainhotspot.rsc
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
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${adminId}&select=id,name,host,bridge_interface,hotspot_dns_name,bridge_ip,router_secret`
    );

    /* "mainhotspot" is a special keyword meaning "first/main hotspot router" */
    let router_row: DbRouter | undefined;
    if (slug === "mainhotspot" || slug === "main-hotspot") {
      router_row = routers[0]; // use the first router for this admin
    } else {
      router_row = routers.find(r => slugify(r.name) === slug);
    }

    /* ── Auto-create router if none exist for this admin ──
       When "mainhotspot" or "main-hotspot" is requested and the admin
       has no routers yet, we create a placeholder record so the script
       can embed a router_secret.  The registration call inside the .rsc
       will later fill in the real model and identity. */
    if (!router_row && (slug === "mainhotspot" || slug === "main-hotspot")) {
      const autoSecret = Buffer
        .from(`${adminId}:${Date.now()}:ocholanet`)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 48);
      const autoName = `${companyName} Router`;
      try {
        const createRes = await fetch(
          `${SUPABASE_URL}/rest/v1/isp_routers`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              admin_id:         adminId,
              name:             autoName,
              host:             "",
              router_username:  "admin",
              router_secret:    autoSecret,
              bridge_interface: "bridge",
              bridge_ip:        "192.168.88.1",
              status:           "offline",
            }),
          }
        );
        if (createRes.ok) {
          const rows = await createRes.json() as DbRouter[];
          router_row = rows[0];
        }
      } catch { /* proceed with null — will 404 below */ }
    }

    if (!router_row) {
      res.status(404).send(
        `# Error: no router found for admin "${adminSubdomain}" matching slug "${slug}"\n` +
        `# Available slugs: ${routers.map(r => slugify(r.name)).join(", ") || "(none)"}\n`
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
    const bridgeIface = router_row.bridge_interface  || "bridge";
    const hotspotDns  = router_row.hotspot_dns_name  || `wifi.${routerSlug}.local`;
    const bridgeIp    = router_row.bridge_ip         || "192.168.88.1";

    const ipBase      = bridgeIp.replace(/\.\d+$/, "");
    const ipMask      = `${bridgeIp}/24`;
    const poolStart   = `${ipBase}.2`;
    const poolEnd     = `${ipBase}.254`;

    const profileName = routerSlug;
    const portalBase  = `https://${adminSubdomain}.isplatty.org`;
    const now         = new Date().toISOString();

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

    /* Ensure this router can authenticate to the OpenVPN server */
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
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan1 comment="WiFi 2.4GHz" } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan2 comment="WiFi 5GHz" } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=ether2 comment="LAN port 2" } on-error={}`,
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
      ``,
      `# === Hotspot Portal Files ===`,
      `# $hsdir is a pre-computed scalar (not an inline expression) so it`,
      `# works reliably on all RouterOS versions including very old builds.`,
      `:local hsdir ($storage . "/hotspot")`,
      `:if ($storage = "flash") do={ :set hsdir "flash/hotspot" }`,
      `:if ($storage = "disk1") do={ :set hsdir "disk1/hotspot" }`,
      `:put ("[5/8] Downloading hotspot portal files to " . $hsdir . "...")`,
      `# --- HTTPS connectivity check ---`,
      `:local httpsOk false`,
      `:do { /tool fetch url="${portalBase}/hotspot/api.json" dst-path=hs-check.tmp mode=https; :set httpsOk true; :do { /file remove [find name=hs-check.tmp] } on-error={} } on-error={ :put "  WARN: HTTPS unreachable from this router - portal files skipped" }`,
      `:if ($httpsOk) do={`,
      `  :do { /file make-dir $hsdir } on-error={}`,
      `  :do { /file make-dir ($hsdir . "/css") } on-error={}`,
      `  :do { /file make-dir ($hsdir . "/img") } on-error={}`,
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
      `# === NAT + Firewall ===`,
      `:put "[6/8] Applying firewall and NAT rules..."`,
      safeRm(`/ip firewall nat remove [find comment="${companyName} - Hotspot redirect"]`),
      safeRos(`/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=redirect to-ports=64872 hotspot=!auth comment="${companyName} - Hotspot redirect"`, "NAT redirect add"),
      safeRm(`/ip firewall filter remove [find comment="${companyName} - allow hotspot"]`),
      safeRos(`/ip firewall filter add chain=input protocol=tcp dst-port=64872 action=accept comment="${companyName} - allow hotspot"`, "firewall hotspot accept"),
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=80,443 action=accept comment="${companyName} - allow hotspot" } on-error={}`,
      `:put "      NAT redirect + firewall rules applied  OK"`,
      ``,
      `# === OVPN Management Tunnel ===`,
      `:put "[7/8] Setting up management VPN tunnel..."`,
      safeRm(`/interface ovpn-client remove [find name=ocholasupernet]`),
      ovpnAdd(`name=ocholasupernet connect-to="${adminSubdomain}.isplatty.org" port=1194 mode=ip user="${routerSlug}" password="ocholasupernet" cipher=aes256 auth=sha1 add-default-route=no disabled=no`),
      `:put "      VPN interface 'ocholasupernet' added  OK"`,
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
      `:do { /tool fetch url=("${registerUrl}?model=" . $rm . "&rname=" . $ri . "&ver=" . $rv) mode=https dst-path=reg.tmp } on-error={}`,
      `:do { /file remove [find name=reg.tmp] } on-error={}`,
      ``,
      `# === Heartbeat Script + Scheduler ===`,
      `# The script checks whether the hotspot service is running before pinging the`,
      `# billing server. ?hs=1 means the service is active (users can connect) and`,
      `# lights the green indicator in the admin dashboard. ?hs=0 turns it yellow.`,
      safeRm(`/system script remove [find name=ochola-heartbeat-script]`),
      safeRos(`/system script add name=ochola-heartbeat-script policy=read,write,test source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; /tool fetch url=(\\"${heartbeatUrl}?hs=\\" . [:tostr \\$hs]) mode=https dst-path=hb.tmp; :do {/file remove [find name=hb.tmp]} on-error={}"`, "heartbeat script add"),
      safeRm(`/system scheduler remove [find name=ochola-heartbeat]`),
      safeRos(`/system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${companyName} heartbeat"`, "heartbeat scheduler add"),
      ``,
      `# === Config Auto-Update Scheduler (daily) ===`,
      safeRm(`/system scheduler remove [find name=ochola-autoupdate]`),
      safeRos(`/system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBaseUrl}/${rawName}\\" dst-path=${routerSlug}.rsc mode=https; /import ${routerSlug}.rsc" comment="${companyName} auto-update"`, "auto-update scheduler add"),
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
        lines.push(safeRos(`/ip hotspot user profile add name="${pName}" rate-limit="${rl}" session-timeout=${timeout} shared-users=${shared} comment="${companyName} plan #${plan.id}"`, `plan ${pName} add`));
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
