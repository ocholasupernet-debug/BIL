import { Router, type IRouter } from "express";

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
    return `:foreach x in=[${menu} find ${cond}] do={ ${menu} remove $x }`;
  }
  return `:do { ${cleaned} } on-error={}`;
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
    const gatewayIp   = `${ipBase}.1`;

    const profileName = routerSlug;
    const portalBase  = `https://${adminSubdomain}.isplatty.org`;
    const now         = new Date().toISOString();

    /* ── Router secret token for heartbeat ──
       If the router already has a secret, use it.
       Otherwise generate one, persist it to Supabase, then use it.
    ── */
    let routerSecret = router_row.router_secret;
    if (!routerSecret) {
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

    /* ── Step 5: Build the .rsc content ── */
    const lines: string[] = [
      `# ===================================================`,
      `# ${companyName} - MikroTik Hotspot Configuration`,
      `# Router  : ${routerName}`,
      `# Admin   : ${adminSubdomain} (id=${adminId})`,
      `# Generated: ${now}`,
      `# Import  : /import ${routerSlug}.rsc`,
      `# ===================================================`,
      ``,
      `# === Auto-Update: fetch latest config from ${companyName} ===`,
      ros(`/tool fetch url="${scriptBaseUrl}/${rawName}" dst-path=${routerSlug}.rsc mode=https`),
      ``,
      `# === System Identity ===`,
      ros(`/system identity set name="${companyName}-${routerName}"`),
      ``,
      `# === DNS ===`,
      ros(`/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes`),
      ``,
      `# === Bridge Interface ===`,
      `:do { /interface bridge add name="${bridgeIface}" comment="${companyName} Hotspot Bridge" } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan1 comment="WiFi 2.4GHz" } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=wlan2 comment="WiFi 5GHz" } on-error={}`,
      `:do { /interface bridge port add bridge="${bridgeIface}" interface=ether2 comment="LAN port 2" } on-error={}`,
      safeRm(`/ip address remove [find interface="${bridgeIface}"]`),
      ros(`/ip address add address=${ipMask} interface="${bridgeIface}" comment="${companyName} hotspot bridge IP"`),
      ``,
      `# === Default Route / Gateway ===`,
      safeRm(`/ip route remove [find comment="${companyName} default route"]`),
      `:do { /ip route add dst-address=0.0.0.0/0 gateway=${gatewayIp} comment="${companyName} default route" } on-error={}`,
      ``,
      `# === IP Pool ===`,
      safeRm(`/ip pool remove [find name=hspool]`),
      ros(`/ip pool add name=hspool ranges=${poolStart}-${poolEnd}`),
      ``,
      `# === Hotspot Profile ===`,
      safeRm(`/ip hotspot profile remove [find name="${profileName}"]`),
      ros(`/ip hotspot profile add name="${profileName}" hotspot-address=${bridgeIp} dns-name="${hotspotDns}" login-by=http-chap,http-pap html-directory=flash/hotspot`),
      ``,
      `# === Hotspot ===`,
      safeRm(`/ip hotspot remove [find name=hotspot1]`),
      ros(`/ip hotspot add name=hotspot1 interface="${bridgeIface}" profile="${profileName}" address-pool=hspool idle-timeout=none`),
      ``,
      `# === Ensure flash/hotspot directories exist ===`,
      `:do { /file make-dir flash/hotspot } on-error={}`,
      `:do { /file make-dir flash/hotspot/css } on-error={}`,
      `:do { /file make-dir flash/hotspot/img } on-error={}`,
      `:do { /file make-dir flash/hotspot/xml } on-error={}`,
      ``,
      `# === Hotspot Static Assets (CSS / JS libraries / images) ===`,
      ros(`/tool fetch url="${portalBase}/hotspot/css/style.css" dst-path=flash/hotspot/css/style.css mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/img/user.svg" dst-path=flash/hotspot/img/user.svg mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/img/password.svg" dst-path=flash/hotspot/img/password.svg mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/favicon.ico" dst-path=flash/hotspot/favicon.ico mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/md5.js" dst-path=flash/hotspot/md5.js mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/sweetalert2.js" dst-path=flash/hotspot/sweetalert2.js mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/tailwind.js" dst-path=flash/hotspot/tailwind.js mode=https`),
      ``,
      `# === Hotspot HTML Pages ===`,
      ros(`/tool fetch url="${portalBase}/hotspot/login.html" dst-path=flash/hotspot/login.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/alogin.html" dst-path=flash/hotspot/alogin.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/logout.html" dst-path=flash/hotspot/logout.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/status.html" dst-path=flash/hotspot/status.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/rlogin.html" dst-path=flash/hotspot/rlogin.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/radvert.html" dst-path=flash/hotspot/radvert.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/redirect.html" dst-path=flash/hotspot/redirect.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/error.html" dst-path=flash/hotspot/error.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/errors.txt" dst-path=flash/hotspot/errors.txt mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/api.json" dst-path=flash/hotspot/api.json mode=https`),
      ``,
      `# === Hotspot XML Templates ===`,
      ros(`/tool fetch url="${portalBase}/hotspot/xml/login.html" dst-path=flash/hotspot/xml/login.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/alogin.html" dst-path=flash/hotspot/xml/alogin.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/logout.html" dst-path=flash/hotspot/xml/logout.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/flogout.html" dst-path=flash/hotspot/xml/flogout.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/rlogin.html" dst-path=flash/hotspot/xml/rlogin.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/error.html" dst-path=flash/hotspot/xml/error.html mode=https`),
      ros(`/tool fetch url="${portalBase}/hotspot/xml/WISPAP.xsd" dst-path=flash/hotspot/xml/WISPAP.xsd mode=https`),
      ``,
      `# === NAT (Captive Portal Redirect) ===`,
      safeRm(`/ip firewall nat remove [find comment="${companyName} - Hotspot redirect"]`),
      ros(`/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=redirect to-ports=64872 hotspot=!auth comment="${companyName} - Hotspot redirect"`),
      ``,
      `# === Firewall (allow hotspot traffic) ===`,
      safeRm(`/ip firewall filter remove [find comment="${companyName} - allow hotspot"]`),
      ros(`/ip firewall filter add chain=input protocol=tcp dst-port=64872 action=accept comment="${companyName} - allow hotspot"`),
      `:do { /ip firewall filter add chain=input protocol=tcp dst-port=80,443 action=accept comment="${companyName} - allow hotspot" } on-error={}`,
      ``,
      `# === OVPN Client (Management Tunnel - optional, skipped if VPN not configured) ===`,
      `:do { /tool fetch url="${scriptBaseUrl}/../vpn/ca.crt" dst-path=ca.crt mode=https } on-error={}`,
      `:do { /certificate import file-name=ca.crt passphrase="" } on-error={}`,
      `:do { /interface ovpn-client remove [find name=ovpn-mgmt] } on-error={}`,
      `:do { /interface ovpn-client add name=ovpn-mgmt connect-to=${adminSubdomain}.isplatty.org port=1194 mode=ip user="${routerSlug}" auth=sha1 cipher=aes256 add-default-route=no disabled=no comment="${companyName} mgmt" } on-error={}`,
      ``,
      `# === Default User Profile ===`,
      ros(`/ip hotspot user profile set [find name=default] shared-users=1 keepalive-timeout=2m idle-timeout=none`),
      ``,
      `# === Auto-Register: detect model + link router to billing system ===`,
      `# Reads the router's hardware model, identity, and ROS version,`,
      `# then sends them to the billing server so the admin dashboard`,
      `# shows the correct device name and lights the green indicator.`,
      `:local rm ""; :local ri ""; :local rv ""`,
      `:do { :set rm [/system routerboard get model] } on-error={}`,
      `:do { :set ri [/system identity get name] } on-error={}`,
      `:do { :set rv [/system package get [find name=routeros] version] } on-error={}`,
      ros(`/tool fetch url=("${registerUrl}?model=" . $rm . "&rname=" . $ri . "&ver=" . $rv) mode=https dst-path=reg.tmp`),
      `:do { /file remove [find name=reg.tmp] } on-error={}`,
      ``,
      `# === Heartbeat Script + Scheduler ===`,
      `# The script checks whether the hotspot service is running before pinging the`,
      `# billing server. ?hs=1 means the service is active (users can connect) and`,
      `# lights the green indicator in the admin dashboard. ?hs=0 turns it yellow.`,
      safeRm(`/system script remove [find name=ochola-heartbeat-script]`),
      ros(`/system script add name=ochola-heartbeat-script policy=read,write,test source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; /tool fetch url=(\\"${heartbeatUrl}?hs=\\" . [:tostr \\$hs]) mode=https dst-path=hb.tmp; :do {/file remove [find name=hb.tmp]} on-error={}"`),
      safeRm(`/system scheduler remove [find name=ochola-heartbeat]`),
      ros(`/system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${companyName} heartbeat"`),
      ``,
      `# === Config Auto-Update Scheduler (daily) ===`,
      safeRm(`/system scheduler remove [find name=ochola-autoupdate]`),
      ros(`/system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBaseUrl}/${rawName}\\" dst-path=${routerSlug}.rsc mode=https; /import ${routerSlug}.rsc" comment="${companyName} auto-update"`),
    ];

    /* ── Plan profiles ── */
    if (plans.length > 0) {
      lines.push(``, `# === Plan Profiles (${plans.length}) ===`);
      for (const plan of plans) {
        const pName   = plan.name.replace(/\s+/g, "-").toLowerCase();
        const rl      = toRateLimit(plan.speed_down, plan.speed_up, "Mbps");
        const timeout = toSessionTimeout(plan.validity, plan.validity_unit || "days");
        const shared  = plan.shared_users || 1;
        lines.push(safeRm(`/ip hotspot user profile remove [find name="${pName}"]`));
        lines.push(ros(`/ip hotspot user profile add name="${pName}" rate-limit="${rl}" session-timeout=${timeout} shared-users=${shared} comment="${companyName} plan #${plan.id}"`));
      }
    }

    lines.push(``);
    lines.push(ros(`/log info message="${companyName}: ${routerSlug}.rsc imported successfully"`));
    lines.push(``);
    lines.push(`# ===================================================`);
    lines.push(`# Done - ${plans.length} plan profile(s) installed`);
    lines.push(`# ===================================================`);

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
