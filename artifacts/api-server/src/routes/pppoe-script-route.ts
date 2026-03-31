import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

/* Use || not ?? so an empty-string env var falls through to the next option */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";

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

/* ══════════════════════════ IP helpers ══════════════════════════ */
function deriveNet(ip: string): { gateway: string; network: string; poolStart: string; poolEnd: string } {
  const parts = ip.split(".");
  if (parts.length !== 4) return { gateway: ip, network: `${ip}/24`, poolStart: `${ip.replace(/\.\d+$/, ".2")}`, poolEnd: `${ip.replace(/\.\d+$/, ".254")}` };
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  return {
    gateway:   ip,
    network:   `${prefix}.0/24`,
    poolStart: `${prefix}.2`,
    poolEnd:   `${prefix}.254`,
  };
}

/* ══════════════════════════ Script generators ══════════════════════════ */

/* Strip characters that RouterOS treats as special inside quoted strings.
   # is a line-comment delimiter even mid-line; " would break string delimiters. */
function rosStr(s: string): string {
  return s.replace(/#/g, "").replace(/"/g, "'").trim();
}

function genPPPoEOnly(router: DbRouter, companyName: string, ros: number): string {
  const co         = rosStr(companyName);
  const secret     = router.router_secret ?? "ocholasupernet";
  const wanIface   = router.wan_interface  ?? "ether1";
  const apiUser    = rosStr(router.router_username || router.name || "admin");
  const rawIp      = (router.bridge_ip ?? "10.10.0.1").replace(/\/\d+$/, "");
  const net        = deriveNet(rawIp);
  const bridgeName = "bridge-pppoe";

  return `# ============================================================
# ${co} - PPPoE Only
# Router  : ${router.name} (${router.host})
# ROS     : ${ros}
# WAN     : ${wanIface}
# Gateway : ${net.gateway}/24
# ============================================================

# 1. Clean previous PPPoE config
:do { /interface pppoe-server server remove [find] } on-error={}
:do { /ppp profile remove [find name~"internet"] } on-error={}
:do { /ip pool remove [find name~"pppoe-pool"] } on-error={}
:do { /ip address remove [find interface="${bridgeName}"] } on-error={}
:do { /interface bridge remove [find name="${bridgeName}"] } on-error={}

# 2. Bridge - created first, optional params set separately (ROS 6 compat)
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
:do { /ip address add address=${net.gateway}/24 interface=${bridgeName} } on-error={}

# 5. IP pool
:do { /ip pool add name=pppoe-pool ranges=${net.poolStart}-${net.poolEnd} } on-error={}

# 6. PPP profile (no comment= - not supported on all ROS 6 builds)
:do { /ppp profile add name=internet local-address=${net.gateway} remote-address=pppoe-pool use-radius=no dns-server=8.8.8.8,1.1.1.1 change-tcp-mss=yes } on-error={}

# 7. PPPoE server (no comment= on server add - causes parse error on some ROS 6 builds)
:do { /interface pppoe-server server add service-name=internet interface=${bridgeName} default-profile=internet authentication=pap,chap,mschap1,mschap2 enabled=yes max-mru=1480 max-mtu=1480 one-session-per-host=yes keepalive-timeout=30 } on-error={}

# 8. NAT
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
:do { /ip firewall nat add chain=srcnat src-address=${net.network} action=masquerade out-interface=${wanIface} comment="PPPoE masquerade" } on-error={}

# 9. DNS
:do { /ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes } on-error={}

# 10. API service + user
:do { /ip service set api address=0.0.0.0/0 disabled=no } on-error={}
:do { /user remove [find name="${apiUser}"] } on-error={}
:do { /user add name="${apiUser}" password="${secret}" group=full disabled=no } on-error={}

# 11. Port 8728 firewall (place-before=0 with on-error fallback for empty chain)
:do { /ip firewall filter remove [find comment="allow-api-8728"] } on-error={}
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" } on-error={} }
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" } on-error={} }

:log info "${co} PPPoE-Only applied"
:put "Done. PPPoE on ${bridgeName} | GW ${net.gateway}/24 | pool ${net.poolStart}-${net.poolEnd}"
`;
}

function genPPPoEOverHotspot(router: DbRouter, companyName: string, ros: number): string {
  const co          = rosStr(companyName);
  const secret      = router.router_secret   ?? "ocholasupernet";
  const wanIface    = router.wan_interface   ?? "ether1";
  const bridgeName  = router.bridge_interface ?? "hotspot-bridge";
  const dnsName     = router.hotspot_dns_name ?? "hotspot.local";
  const apiUser     = rosStr(router.router_username || router.name || "admin");
  const rawIp       = (router.bridge_ip ?? "192.168.88.1").replace(/\/\d+$/, "");
  const net         = deriveNet(rawIp);
  const hsPoolStart = rawIp.replace(/\.\d+$/, ".10");
  const hsPoolEnd   = rawIp.replace(/\.\d+$/, ".200");
  const pppPrefix   = "10.20.0";

  /* mac-auth-mode only exists on ROS 7 */
  const hsProfileExtras = ros >= 7 ? ` mac-auth-mode=mac-as-username` : ``;

  return `# ============================================================
# ${co} - PPPoE over Hotspot
# Router  : ${router.name} (${router.host})
# ROS     : ${ros}
# WAN     : ${wanIface}
# Bridge  : ${bridgeName}  GW: ${net.gateway}/24
# ============================================================

# 1. Clean existing config
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

# 2. Bridge - fast-forward=no is CRITICAL for hotspot redirect to work
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
:do { /ip address add address=${net.gateway}/24 interface=${bridgeName} } on-error={}

# 5. DNS
:do { /ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes } on-error={}

# 6. Hotspot pool (hotspot's built-in DHCP - no separate dhcp-server needed)
:do { /ip pool add name=hs-pool ranges=${hsPoolStart}-${hsPoolEnd} } on-error={}

# 7. Hotspot profile (no comment= - not supported on all ROS 6 builds)
:do { /ip hotspot profile add name=hs-profile hotspot-address=${net.gateway} dns-name=${dnsName} login-by=http-chap,mac use-radius=no${hsProfileExtras} } on-error={}

# 8. Hotspot server
:do { /ip hotspot add name=hotspot1 interface=${bridgeName} profile=hs-profile address-pool=hs-pool idle-timeout=none disabled=no } on-error={}

# 9. PPPoE pool (10.20.0.x - separate range, no conflict with hotspot clients)
:do { /ip pool add name=pppoe-pool ranges=${pppPrefix}.2-${pppPrefix}.254 } on-error={}

# 10. PPP profile (no comment= - not supported on all ROS 6 builds)
:do { /ppp profile add name=internet local-address=${net.gateway} remote-address=pppoe-pool use-radius=no dns-server=8.8.8.8,1.1.1.1 change-tcp-mss=yes } on-error={}

# 11. PPPoE server (no comment= on server add - causes parse error on some ROS 6 builds)
:do { /interface pppoe-server server add service-name=internet interface=${bridgeName} default-profile=internet authentication=pap,chap,mschap1,mschap2 enabled=yes max-mru=1480 max-mtu=1480 one-session-per-host=yes keepalive-timeout=30 } on-error={}

# 12. NAT
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
:do { /ip firewall nat remove [find comment~"Hotspot"] } on-error={}
:do { /ip firewall nat add chain=srcnat src-address=${net.network} action=masquerade out-interface=${wanIface} comment="PPPoE-Hotspot masquerade" } on-error={}

# 13. API service + user
:do { /ip service set api address=0.0.0.0/0 disabled=no } on-error={}
:do { /user remove [find name="${apiUser}"] } on-error={}
:do { /user add name="${apiUser}" password="${secret}" group=full disabled=no } on-error={}

# 14. Port 8728 firewall (place-before=0 with on-error fallback for empty chain)
:do { /ip firewall filter remove [find comment="allow-api-8728"] } on-error={}
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="allow-api-8728" } on-error={} }
:do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" place-before=0 } on-error={ :do { /ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${net.gateway}/24 action=accept comment="allow-api-8728" } on-error={} }

:log info "${co} PPPoE-over-Hotspot applied"
:put "Done. Bridge: ${bridgeName} | Hotspot: ${dnsName} | PPPoE pool: ${pppPrefix}.2-254"
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
    /* Fetch router by ID alone — no admin_id needed in the URL
       (RouterOS terminal treats '?' as a help key and strips it) */
    const rows = await sbGet<DbRouter>(
      `isp_routers?id=eq.${routerId}&select=*&limit=1`
    );

    if (rows.length === 0) {
      res.status(404).send("# Error: router not found");
      return;
    }

    const router = rows[0];

    /* Resolve company name from the router's own admin_id */
    let companyName = "ISP";
    try {
      const admins = await sbGet<DbAdmin>(
        `isp_admins?id=eq.${router.admin_id}&select=id,name&limit=1`
      );
      if (admins.length > 0) companyName = admins[0].name;
    } catch { /* use defaults */ }

    const slug     = slugify(router.name);
    const filename = mode === "pppoe_only"
      ? `pppoe-only-${slug}.rsc`
      : `pppoe-hotspot-${slug}.rsc`;

    const script = mode === "pppoe_only"
      ? genPPPoEOnly(router, companyName, rosVersion)
      : genPPPoEOverHotspot(router, companyName, rosVersion);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(script);

    /* ── Auto-register pool(s) in isp_ip_pools — fire-and-forget ──
       Mirrors the pool values the generator writes into the script so the
       IP Pools page is populated automatically after script download. ── */
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
      autoUpsertPool(adminId, routerPk, "hs-pool",    hsPoolStart,           hsPoolEnd          ).catch(() => {});
      autoUpsertPool(adminId, routerPk, "pppoe-pool", `${pppPrefix}.2`, `${pppPrefix}.254`).catch(() => {});
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
