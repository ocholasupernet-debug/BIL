import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

/* Prefer VITE_SUPABASE_URL (REST API base). SUPABASE_URL may be a raw DB hostname
   without https:// — always normalise to a proper REST API URL. */
function resolveSupabaseUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}
const SUPABASE_URL = resolveSupabaseUrl();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";
const BASE_DOMAIN  = "isplatty.org";

/* ── Auto-upsert an IP pool record for a router ──
   Called every time a PPPoE script is served so the pool always appears
   in the IP Pools page without the admin needing to create it manually. ── */
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

interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
  ros_version: string; ports: string | null;
  wan_interface: string | null; bridge_interface: string | null;
  bridge_ip: string | null; hotspot_dns_name: string | null;
  pppoe_mode: string | null; admin_id: number;
}

interface DbAdmin { id: number; name: string; subdomain: string | null; }

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* Strip characters that RouterOS treats as special inside quoted strings.
   # is a line-comment delimiter even mid-line; " would break string delimiters. */
function rosStr(s: string): string {
  return s.replace(/#/g, "").replace(/"/g, "'").trim();
}

/* ══════════════════════════ IP helpers ══════════════════════════ */
function deriveNet(ip: string): { gateway: string; network: string; poolStart: string; poolEnd: string } {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    const prefix = ip.replace(/\.\d+$/, "");
    return { gateway: ip, network: `${prefix}.0/24`, poolStart: `${prefix}.10`, poolEnd: `${prefix}.254` };
  }
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const gwLast = parseInt(parts[3], 10);
  /* Pool must NOT include the gateway address.
     Use .10 as minimum start (avoids colliding with .1-.9 gateway addresses).
     If the gateway is >= 10, start pool one above it (capped at 250). */
  const poolStartLast = gwLast < 10 ? 10 : Math.min(250, gwLast + 1);
  return {
    gateway:   ip,
    network:   `${prefix}.0/24`,
    poolStart: `${prefix}.${poolStartLast}`,
    poolEnd:   `${prefix}.254`,
  };
}

/* ══════════════════════════ Script generators ══════════════════════════ */

function genPPPoEOnly(
  router: DbRouter, companyName: string, ros: number,
  adminSubdomain: string
): string {
  const co         = rosStr(companyName);
  const secret     = router.router_secret ?? "ocholasupernet";
  const wanIface   = router.wan_interface  ?? "ether1";
  const apiUser    = rosStr(router.router_username || router.name || "admin");
  const rawIp      = (router.bridge_ip ?? "10.10.0.1").replace(/\/\d+$/, "");
  const net        = deriveNet(rawIp);
  const bridgeName = "bridge-pppoe";
  const slug       = slugify(router.name);
  const configFile = `pppoe-only-${slug}.rsc`;
  const scriptBase = `https://${adminSubdomain}.${BASE_DOMAIN}/api/pppoe-script/${router.id}/pppoe_only`;
  const heartbeatUrl = `https://${adminSubdomain}.${BASE_DOMAIN}/api/isp/router/heartbeat/${secret}`;

  return `# ============================================================
# ${co} - PPPoE Only
# Router  : ${router.name} (${router.host || "no IP"})
# ROS     : ${ros}
# WAN     : ${wanIface}
# Gateway : ${net.gateway}/24
# Pool    : ${net.poolStart} - ${net.poolEnd}
# Generated: ${new Date().toISOString()}
# ============================================================

:put "======================================================"
:put " ${co} PPPoE Setup — ${router.name}"
:put "======================================================"

# === Detect RouterOS version ===
:local rosVer "unknown"
:do { :set rosVer [/system package get [find name=routeros] version] } on-error={}
:put ("      RouterOS v" . $rosVer)

# 1. Clean previous PPPoE config
:put "[1] Cleaning old PPPoE config..."
:do { /interface pppoe-server server remove [find] } on-error={}
:do { /ppp profile remove [find name~"internet"] } on-error={}
:do { /ip pool remove [find name~"pppoe-pool"] } on-error={}
:do { /ip address remove [find interface="${bridgeName}"] } on-error={}
:do { /interface bridge remove [find name="${bridgeName}"] } on-error={}

# 2. Bridge - created first, optional params set separately (ROS 6 compat)
:put "[2] Creating bridge ${bridgeName}..."
:do { /interface bridge add name=${bridgeName} } on-error={}
:do { /interface bridge set [find name=${bridgeName}] fast-forward=no } on-error={}
:do { /interface bridge set [find name=${bridgeName}] protocol-mode=none } on-error={}

# 3. Add all LAN ethernet ports (skip WAN)
:foreach x in=[/interface ethernet find] do={
  :local ifname [/interface ethernet get $x name]
  :if ($ifname != "${wanIface}") do={
    :do { /interface bridge port remove [find interface=$ifname] } on-error={}
    :do { /interface bridge port add bridge=${bridgeName} interface=$ifname } on-error={}
  }
}
:do { /interface bridge port remove [find interface=wlan1] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan1 } on-error={}
:do { /interface bridge port remove [find interface=wlan2] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan2 } on-error={}

# 4. Gateway IP
:put "[3] Setting gateway IP ${net.gateway}/24..."
:do { /ip address add address=${net.gateway}/24 interface=${bridgeName} } on-error={}

# 5. IP pool (starts at ${net.poolStart} — does not conflict with gateway)
:put "[4] Creating PPPoE pool ${net.poolStart}-${net.poolEnd}..."
:do { /ip pool add name=pppoe-pool ranges=${net.poolStart}-${net.poolEnd} } on-error={}

# 6. PPP profile (no comment= or use-radius= - not supported on all ROS 6 builds)
:do { /ppp profile add name=internet local-address=${net.gateway} remote-address=pppoe-pool dns-server=8.8.8.8,1.1.1.1 change-tcp-mss=yes } on-error={}

# 7. PPPoE server — split add + set for ROS 6 compat (fewer params per command)
:put "[5] Starting PPPoE server on ${bridgeName}..."
:do { /interface pppoe-server server add service-name=internet interface=${bridgeName} default-profile=internet disabled=no } on-error={}
:do { /interface pppoe-server server set [find service-name=internet] authentication=pap,chap,mschap1,mschap2 max-mtu=1480 max-mru=1480 one-session-per-host=yes keepalive-timeout=30 } on-error={}

# 8. NAT masquerade
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
:do { /ip firewall nat add chain=srcnat src-address=${net.network} action=masquerade out-interface=${wanIface} comment="PPPoE masquerade" } on-error={}

# 9. DNS
:do { /ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes } on-error={}

# 10. API service + user (for remote management)
:put "[6] Creating API user '${apiUser}'..."
:do { /ip service set api address=0.0.0.0/0 disabled=no } on-error={}
:do { /user remove [find name="${apiUser}"] } on-error={}
:do { /user add name="${apiUser}" password="${secret}" group=full disabled=no } on-error={}

# 11. Port 8728 firewall — allow from VPN (10.8.0.0/24) and LAN
:do { /ip firewall filter remove [find comment="allow-api-8728"] } on-error={}
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" } on-error={} }
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" } on-error={} }

# 12. System identity
:do { /system identity set name="${co}-${router.name}" } on-error={}

# 13. Heartbeat scheduler — updates online/offline indicator in the dashboard
:put "[7] Setting up heartbeat..."
:do { /system script remove [find name=ochola-heartbeat-script] } on-error={}
:do { /system script add name=ochola-heartbeat-script policy=read,write,test source=":do { /tool fetch url=\\"${heartbeatUrl}\\" mode=https check-certificate=no dst-path=hb.tmp } on-error={}; :do { /file remove [find name=hb.tmp] } on-error={}" } on-error={}
:do { /system scheduler remove [find name=ochola-heartbeat] } on-error={}
:do { /system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${co} heartbeat" } on-error={}

# 14. Config auto-update (daily)
:do { /system scheduler remove [find name=ochola-autoupdate] } on-error={}
:do { /system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBase}\\" dst-path=${configFile} mode=https check-certificate=no; /import ${configFile}" comment="${co} auto-update" } on-error={}

:log info "${co} PPPoE-Only applied"
:put "======================================================"
:put " Done! ${co} PPPoE configured."
:put " GW: ${net.gateway}/24  Pool: ${net.poolStart}-${net.poolEnd}"
:put " Heartbeat every 5 min — check dashboard for green indicator."
:put "======================================================"
`;
}

function genPPPoEOverHotspot(
  router: DbRouter, companyName: string, ros: number,
  adminSubdomain: string
): string {
  const co          = rosStr(companyName);
  const secret      = router.router_secret   ?? "ocholasupernet";
  const wanIface    = router.wan_interface   ?? "ether1";
  const bridgeName  = router.bridge_interface ?? "hotspot-bridge";
  const dnsName     = router.hotspot_dns_name ?? "hotspot.local";
  const apiUser     = rosStr(router.router_username || router.name || "admin");
  const rawIp       = (router.bridge_ip ?? "192.168.88.1").replace(/\/\d+$/, "");
  const net         = deriveNet(rawIp);
  /* Hotspot pool: .10-.200 (keeps .1 for gateway, leaves .201-.254 free) */
  const hsPoolStart = rawIp.replace(/\.\d+$/, ".10");
  const hsPoolEnd   = rawIp.replace(/\.\d+$/, ".200");
  /* PPPoE pool: separate /24 to avoid any conflict with hotspot clients */
  const pppPrefix   = "10.20.0";
  const slug        = slugify(router.name);
  const configFile  = `pppoe-hotspot-${slug}.rsc`;
  const scriptBase  = `https://${adminSubdomain}.${BASE_DOMAIN}/api/pppoe-script/${router.id}/pppoe_over_hotspot`;
  const heartbeatUrl = `https://${adminSubdomain}.${BASE_DOMAIN}/api/isp/router/heartbeat/${secret}`;

  return `# ============================================================
# ${co} - PPPoE over Hotspot
# Router  : ${router.name} (${router.host || "no IP"})
# ROS     : ${ros}
# WAN     : ${wanIface}
# Bridge  : ${bridgeName}  GW: ${net.gateway}/24
# HS Pool : ${hsPoolStart} - ${hsPoolEnd}
# PPPoE Pool: ${pppPrefix}.10 - ${pppPrefix}.254
# Generated: ${new Date().toISOString()}
# ============================================================

:put "======================================================"
:put " ${co} PPPoE-over-Hotspot Setup — ${router.name}"
:put "======================================================"

# === Detect RouterOS version ===
:local rosVer "unknown"
:do { :set rosVer [/system package get [find name=routeros] version] } on-error={}
:put ("      RouterOS v" . $rosVer)

# 1. Clean existing config
:put "[1] Cleaning old config..."
:do { /interface pppoe-server server remove [find] } on-error={}
:do { /ip hotspot remove [find] } on-error={}
:do { /ip hotspot profile remove [find name="hs-profile"] } on-error={}
:do { /ip dhcp-server remove [find name="dhcp-hs"] } on-error={}
:do { /ip dhcp-server network remove [find address="${net.network}"] } on-error={}
:do { /ip pool remove [find name~"hs-pool"] } on-error={}
:do { /ip pool remove [find name~"pppoe-pool"] } on-error={}
:do { /ppp profile remove [find name~"internet"] } on-error={}
:do { /ip address remove [find interface="${bridgeName}"] } on-error={}
:do { /interface bridge remove [find name="${bridgeName}"] } on-error={}

# 2. Bridge — fast-forward=no is CRITICAL for hotspot redirect to work
:put "[2] Creating bridge ${bridgeName}..."
:do { /interface bridge add name=${bridgeName} } on-error={}
:do { /interface bridge set [find name=${bridgeName}] fast-forward=no } on-error={}
:do { /interface bridge set [find name=${bridgeName}] protocol-mode=none } on-error={}

# 3. Add all LAN ethernet ports (skip WAN)
:foreach x in=[/interface ethernet find] do={
  :local ifname [/interface ethernet get $x name]
  :if ($ifname != "${wanIface}") do={
    :do { /interface bridge port remove [find interface=$ifname] } on-error={}
    :do { /interface bridge port add bridge=${bridgeName} interface=$ifname } on-error={}
  }
}
:do { /interface bridge port remove [find interface=wlan1] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan1 } on-error={}
:do { /interface bridge port remove [find interface=wlan2] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan2 } on-error={}

# 4. Gateway IP
:put "[3] Setting gateway ${net.gateway}/24..."
:do { /ip address add address=${net.gateway}/24 interface=${bridgeName} } on-error={}

# 5. DNS
:do { /ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes } on-error={}

# 6. Hotspot pool
:put "[4] Creating hotspot pool ${hsPoolStart}-${hsPoolEnd}..."
:do { /ip pool add name=hs-pool ranges=${hsPoolStart}-${hsPoolEnd} } on-error={}

# 7. Hotspot profile — minimal add, then set optional params (ROS 6 compat)
:do { /ip hotspot profile add name=hs-profile hotspot-address=${net.gateway} dns-name=${dnsName} } on-error={}
:do { /ip hotspot profile set [find name=hs-profile] login-by=http-chap,http-pap } on-error={}
:do { /ip hotspot profile set [find name=hs-profile] mac-auth-mode=mac-as-username } on-error={}

# 8. Hotspot server
:do { /ip hotspot add name=hotspot1 interface=${bridgeName} profile=hs-profile address-pool=hs-pool idle-timeout=none disabled=no } on-error={}
:put "      Hotspot on '${bridgeName}' — ${dnsName}  OK"
:delay 2s

# 9. PPPoE pool — separate /24, no conflict with hotspot clients
:put "[5] Creating PPPoE pool ${pppPrefix}.10-${pppPrefix}.254..."
:do { /ip pool add name=pppoe-pool ranges=${pppPrefix}.10-${pppPrefix}.254 } on-error={}

# 10. PPP profile (no use-radius= — not supported on all ROS 6 builds; default is already no)
:do { /ppp profile add name=internet local-address=${net.gateway} remote-address=pppoe-pool dns-server=8.8.8.8,1.1.1.1 change-tcp-mss=yes } on-error={}

# 11. PPPoE server — split add + set for ROS 6 compat
:put "[6] Starting PPPoE server on ${bridgeName}..."
:do { /interface pppoe-server server add service-name=internet interface=${bridgeName} default-profile=internet disabled=no } on-error={}
:do { /interface pppoe-server server set [find service-name=internet] authentication=pap,chap,mschap1,mschap2 max-mtu=1480 max-mru=1480 one-session-per-host=yes keepalive-timeout=30 } on-error={}

# 12. NAT masquerade
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
:do { /ip firewall nat remove [find comment~"Hotspot"] } on-error={}
:do { /ip firewall nat add chain=srcnat src-address=${net.network} action=masquerade out-interface=${wanIface} comment="PPPoE-Hotspot masquerade" } on-error={}

# 13. API service + user
:put "[7] Creating API user '${apiUser}'..."
:do { /ip service set api address=0.0.0.0/0 disabled=no } on-error={}
:do { /user remove [find name="${apiUser}"] } on-error={}
:do { /user add name="${apiUser}" password="${secret}" group=full disabled=no } on-error={}

# 14. Port 8728 firewall — allow from VPN and LAN
:do { /ip firewall filter remove [find comment="allow-api-8728"] } on-error={}
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" } on-error={} }
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" } on-error={} }

# 15. System identity
:do { /system identity set name="${co}-${router.name}" } on-error={}

# 16. Heartbeat scheduler
:put "[8] Setting up heartbeat..."
:do { /system script remove [find name=ochola-heartbeat-script] } on-error={}
:do { /system script add name=ochola-heartbeat-script policy=read,write,test source=":do { /tool fetch url=\\"${heartbeatUrl}\\" mode=https check-certificate=no dst-path=hb.tmp } on-error={}; :do { /file remove [find name=hb.tmp] } on-error={}" } on-error={}
:do { /system scheduler remove [find name=ochola-heartbeat] } on-error={}
:do { /system scheduler add name=ochola-heartbeat interval=5m start-time=startup on-event="/system script run ochola-heartbeat-script" comment="${co} heartbeat" } on-error={}

# 17. Config auto-update (daily)
:do { /system scheduler remove [find name=ochola-autoupdate] } on-error={}
:do { /system scheduler add name=ochola-autoupdate interval=1d start-time=00:05:00 on-event="/tool fetch url=\\"${scriptBase}\\" dst-path=${configFile} mode=https check-certificate=no; /import ${configFile}" comment="${co} auto-update" } on-error={}

:log info "${co} PPPoE-over-Hotspot applied"
:put "======================================================"
:put " Done! ${co} PPPoE+Hotspot configured."
:put " GW: ${net.gateway}/24  HS: ${hsPoolStart}-${hsPoolEnd}"
:put " PPPoE pool: ${pppPrefix}.10-${pppPrefix}.254"
:put " Heartbeat every 5 min — check dashboard for green indicator."
:put "======================================================"
`;
}

/* ══════════════════════════════════════════════════════════════
   GET /api/pppoe-script/:routerId/:mode/:rosVersion?
   Serves the PPPoE .rsc config file so the router can fetch it
   with /tool fetch (no ? in the URL — RouterOS terminal eats it).
   mode       = "pppoe_only" | "pppoe_over_hotspot"
   rosVersion = "6" | "7"  (defaults to "6" if omitted)
══════════════════════════════════════════════════════════════ */
async function handlePPPoEScript(req: Request, res: Response): Promise<void> {
  const routerId   = parseInt(req.params.routerId ?? "", 10);
  const mode       = req.params.mode as "pppoe_only" | "pppoe_over_hotspot";
  const rosVersion = parseInt(req.params.rosVersion ?? "6", 10) || 6;

  if (isNaN(routerId) || !["pppoe_only", "pppoe_over_hotspot"].includes(mode)) {
    res.status(400).send("# Error: invalid routerId or mode");
    return;
  }

  try {
    const rows = await sbGet<DbRouter>(
      `isp_routers?id=eq.${routerId}&select=*&limit=1`
    );

    if (rows.length === 0) {
      res.status(404).send("# Error: router not found");
      return;
    }

    const router = rows[0];

    /* Resolve company name + subdomain from the router's own admin_id */
    let companyName    = "ISP";
    let adminSubdomain = `admin${router.admin_id}`;
    try {
      const admins = await sbGet<DbAdmin>(
        `isp_admins?id=eq.${router.admin_id}&select=id,name,subdomain&limit=1`
      );
      if (admins.length > 0) {
        companyName    = admins[0].name;
        adminSubdomain = admins[0].subdomain ?? adminSubdomain;
      }
    } catch { /* use defaults */ }

    const slug     = slugify(router.name);
    const filename = mode === "pppoe_only"
      ? `pppoe-only-${slug}.rsc`
      : `pppoe-hotspot-${slug}.rsc`;

    const script = mode === "pppoe_only"
      ? genPPPoEOnly(router, companyName, rosVersion, adminSubdomain)
      : genPPPoEOverHotspot(router, companyName, rosVersion, adminSubdomain);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-cache");
    res.send(script);

    /* ── Auto-register pool(s) in isp_ip_pools — fire-and-forget ── */
    const adminId  = router.admin_id;
    const routerPk = router.id;
    if (mode === "pppoe_only") {
      const rawIp = (router.bridge_ip ?? "10.10.0.1").replace(/\/\d+$/, "");
      const net   = deriveNet(rawIp);
      autoUpsertPool(adminId, routerPk, "pppoe-pool", net.poolStart, net.poolEnd).catch(() => {});
    } else {
      const rawIp       = (router.bridge_ip ?? "192.168.88.1").replace(/\/\d+$/, "");
      const hsPoolStart = rawIp.replace(/\.\d+$/, ".10");
      const hsPoolEnd   = rawIp.replace(/\.\d+$/, ".200");
      const pppPrefix   = "10.20.0";
      autoUpsertPool(adminId, routerPk, "hs-pool",    hsPoolStart,          hsPoolEnd          ).catch(() => {});
      autoUpsertPool(adminId, routerPk, "pppoe-pool", `${pppPrefix}.10`, `${pppPrefix}.254`).catch(() => {});
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`# Error generating script: ${msg}`);
  }
}

/* Register both with and without rosVersion segment (Express 5 doesn't support :param?) */
router.get("/pppoe-script/:routerId/:mode/:rosVersion", handlePPPoEScript);
router.get("/pppoe-script/:routerId/:mode",             handlePPPoEScript);

export default router;
