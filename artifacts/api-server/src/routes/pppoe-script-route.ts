import { Router, type IRouter } from "express";

const router: IRouter = Router();

/* Use || not ?? so an empty-string env var falls through to the next option */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";

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
function genPPPoEOnly(router: DbRouter, companyName: string): string {
  const secret    = router.router_secret ?? "changeme";
  const wanIface  = router.wan_interface  ?? "ether1";
  const rawIp     = (router.bridge_ip ?? "10.10.0.1").replace(/\/\d+$/, "");
  const net       = deriveNet(rawIp);
  const bridgeName = "bridge-pppoe";

  return `# ============================================================
# ${companyName} — PPPoE Only Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# WAN interface : ${wanIface}
# PPPoE gateway : ${net.gateway}/24
# ============================================================

# ── Detect RouterOS major version so version-specific commands run only where supported ──
:local rosVer [/system package get system version]
:local rosMajor [:tonum [:pick $rosVer 0 1]]
:log info ("ROS major version: " . $rosMajor)

# 1. Clean previous PPPoE config
:do { /interface pppoe-server server remove [find] } on-error={}
:do { /ppp profile remove [find name~"internet"] } on-error={}
:do { /ip pool remove [find name~"pppoe-pool"] } on-error={}
:do { /ip address remove [find interface="${bridgeName}"] } on-error={}
:do { /interface bridge remove [find name="${bridgeName}"] } on-error={}

# 2. Create PPPoE bridge and add all LAN ports (skip WAN). Works on ROS 6 & 7.
/interface bridge add name=${bridgeName} protocol-mode=none fast-forward=no comment="${companyName} PPPoE bridge"
:foreach x in=[/interface ethernet find] do={
  :local ifname [/interface ethernet get $x name]
  :if ($ifname != "${wanIface}") do={
    :do { /interface bridge port remove [find interface=$ifname] } on-error={}
    :do { /interface bridge port add bridge=${bridgeName} interface=$ifname comment="LAN" } on-error={}
  }
}
:do { /interface bridge port remove [find interface=wlan1] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan1 comment="WiFi 2.4GHz" } on-error={}
:do { /interface bridge port remove [find interface=wlan2] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan2 comment="WiFi 5GHz" } on-error={}

# 3. Assign gateway IP to bridge
/ip address add address=${net.gateway}/24 interface=${bridgeName} comment="${companyName} PPPoE gateway"

# 4. IP Pool for PPPoE clients
/ip pool add name=pppoe-pool ranges=${net.poolStart}-${net.poolEnd}

# 5. PPP Profile — local authentication (no RADIUS)
/ppp profile add \\
  name=internet \\
  local-address=${net.gateway} \\
  remote-address=pppoe-pool \\
  use-radius=no \\
  dns-server=8.8.8.8,1.1.1.1 \\
  change-tcp-mss=yes \\
  comment="${companyName} profile"

# 6. PPPoE Server
/interface pppoe-server server add \\
  service-name=internet \\
  interface=${bridgeName} \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 \\
  max-mtu=1480 \\
  one-session-per-host=yes \\
  keepalive-timeout=30 \\
  comment="${companyName} PPPoE Server"

# 7. NAT masquerade for PPPoE clients
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
/ip firewall nat add \\
  chain=srcnat src-address=${net.network} \\
  action=masquerade out-interface=${wanIface} \\
  comment="PPPoE clients masquerade"

# 8. DNS
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# 9. API access
/ip service set api address=0.0.0.0/0 disabled=no
:do { /user remove [find name="${router.router_username}"] } on-error={}
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE Only config applied"
:put "Done. PPPoE server on ${bridgeName} | gateway ${net.gateway}/24 | pool ${net.poolStart}-${net.poolEnd}"
`;
}

function genPPPoEOverHotspot(router: DbRouter, companyName: string): string {
  const secret      = router.router_secret   ?? "changeme";
  const wanIface    = router.wan_interface   ?? "ether1";
  const bridgeName  = router.bridge_interface ?? "hotspot-bridge";
  const dnsName     = router.hotspot_dns_name ?? "hotspot.local";
  const rawIp       = (router.bridge_ip ?? "192.168.88.1").replace(/\/\d+$/, "");
  const net         = deriveNet(rawIp);
  const hsPoolStart = rawIp.replace(/\.\d+$/, ".10");
  const hsPoolEnd   = rawIp.replace(/\.\d+$/, ".200");
  const pppPrefix   = "10.20.0";

  return `# ============================================================
# ${companyName} — PPPoE over Hotspot Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# WAN interface : ${wanIface}
# Bridge / Hotspot IP : ${net.gateway}/24
# ============================================================

# ── Detect RouterOS major version so version-specific commands run only where supported ──
:local rosVer [/system package get system version]
:local rosMajor [:tonum [:pick $rosVer 0 1]]
:log info ("ROS major version: " . $rosMajor)

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

# 2. Create shared bridge and add all LAN ports (skip WAN). Works on ROS 6 & 7.
/interface bridge add name=${bridgeName} protocol-mode=none fast-forward=no comment="${companyName} Hotspot+PPPoE bridge"
:foreach x in=[/interface ethernet find] do={
  :local ifname [/interface ethernet get $x name]
  :if ($ifname != "${wanIface}") do={
    :do { /interface bridge port remove [find interface=$ifname] } on-error={}
    :do { /interface bridge port add bridge=${bridgeName} interface=$ifname comment="LAN" } on-error={}
  }
}
:do { /interface bridge port remove [find interface=wlan1] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan1 comment="WiFi 2.4GHz" } on-error={}
:do { /interface bridge port remove [find interface=wlan2] } on-error={}
:do { /interface bridge port add bridge=${bridgeName} interface=wlan2 comment="WiFi 5GHz" } on-error={}

# 3. Bridge gateway IP
/ip address add address=${net.gateway}/24 interface=${bridgeName} comment="${companyName} gateway"

# 4. DHCP pool for hotspot clients
/ip pool add name=hs-pool ranges=${hsPoolStart}-${hsPoolEnd}
/ip dhcp-server add name=dhcp-hs interface=${bridgeName} address-pool=hs-pool disabled=no lease-time=10m
/ip dhcp-server network add address=${net.network} gateway=${net.gateway} dns-server=${net.gateway}

# 5. DNS
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# 6. Hotspot profile & server — local authentication
/ip hotspot profile add name=hs-profile hotspot-address=${net.gateway} dns-name=${dnsName} login-by=http-chap,mac comment="${companyName} hotspot profile"

# ROS 7+: parameters that do not exist in ROS 6
:if ($rosMajor >= 7) do={
  /ip hotspot profile set [find name="hs-profile"] use-radius=no mac-auth-mode=mac-as-username
}

/ip hotspot add name=hotspot1 interface=${bridgeName} profile=hs-profile address-pool=hs-pool idle-timeout=5m disabled=no

# 7. PPPoE IP pool (separate range so it doesn't conflict with hotspot clients)
/ip pool add name=pppoe-pool ranges=${pppPrefix}.2-${pppPrefix}.254

# 8. PPP profile — local authentication (no RADIUS)
/ppp profile add \\
  name=internet \\
  local-address=${net.gateway} \\
  remote-address=pppoe-pool \\
  dns-server=8.8.8.8,1.1.1.1 \\
  use-radius=no \\
  use-compression=no \\
  change-tcp-mss=yes \\
  comment="${companyName} PPPoE profile"

# 9. PPPoE server on shared bridge
/interface pppoe-server server add \\
  service-name=internet \\
  interface=${bridgeName} \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 \\
  max-mtu=1480 \\
  one-session-per-host=yes \\
  comment="${companyName} PPPoE-over-Hotspot"

# 10. NAT masquerade
:do { /ip firewall nat remove [find comment~"PPPoE"] } on-error={}
:do { /ip firewall nat remove [find comment~"Hotspot"] } on-error={}
/ip firewall nat add \\
  chain=srcnat src-address=${net.network} \\
  action=masquerade out-interface=${wanIface} \\
  comment="PPPoE/Hotspot masquerade"

# 11. API access
/ip service set api address=0.0.0.0/0 disabled=no
:do { /user remove [find name="${router.router_username}"] } on-error={}
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE-over-Hotspot config applied"
:put "Done. Bridge: ${bridgeName} | Hotspot: ${dnsName} | PPPoE pool: ${pppPrefix}.2-${pppPrefix}.254"
`;
}

/* ══════════════════════════════════════════════════════════════
   GET /api/pppoe-script/:routerId/:mode
   Serves the PPPoE .rsc config file so the router can fetch it
   with /tool fetch.
   mode = "pppoe_only" | "pppoe_over_hotspot"
══════════════════════════════════════════════════════════════ */
router.get("/pppoe-script/:routerId/:mode", async (req, res): Promise<void> => {
  const routerId = parseInt(req.params.routerId ?? "", 10);
  const mode     = req.params.mode as "pppoe_only" | "pppoe_over_hotspot";

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

    const slug   = slugify(router.name);
    const filename = mode === "pppoe_only"
      ? `pppoe-only-${slug}.rsc`
      : `pppoe-hotspot-${slug}.rsc`;

    const script = mode === "pppoe_only"
      ? genPPPoEOnly(router, companyName)
      : genPPPoEOverHotspot(router, companyName);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(script);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`# Error generating script: ${msg}`);
  }
});

export default router;
