 move [find where comment="Force Admin Panel Link"] 0 } on-error={}

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
  const host = (req.headers.host ?? "") as string;

  /* Path param takes precedence (RouterOS-safe, no `?` that the terminal eats).
     Fall through to query param for browser download links. */
  const rawId = (req.params.routerId ?? req.query.routerId ?? req.query.router_id ?? "") as string;
  const routerId = parseInt(rawId.replace(/\.rsc$/i, ""), 10);

  if (!routerId || isNaN(routerId)) {
    /* No routerId — serve origin-resolved static fallback for legacy integrations */
    res.type("text/plain");
    res.send(buildVlanpppoeRsc(resolveOrigin(host)));
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
    const origin = resolveOrigin(host);
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
/tool fetch url="${origin}/hotspot/login.html" mode=https check-certificate=no dst-path="pppoe/login.html"

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
  const host = (req.headers.host ?? "") as string;
  res.type("text/plain");
  res.send(buildNormalpppoeRsc(resolveOrigin(host)));
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
  return `# vpn7.rsc – OpenVPN client setup for RouterOS 7
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
  return `# vpn6.rsc – OpenVPN client setup for RouterOS 6
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
    source=":local hs 0; :do {:if ([/ip hotspot print count-only where !disabled]>0) do={:set hs 1}} on-error={}; :do { /tool fetch url=(\\"${origin}/api/isp/router/heartbeat/pending?hs=\\" . [:tostr \\$hs]) mode=https check-certificate=no dst-path=hb.tmp } on-error={}; :do { /file remove [find name=hb.tmp] } on-error={}"
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
    on-event="/tool fetch url=\\"${origin}/api/scripts/mainhotspot.rsc\\" dst-path=mainhotspot.rsc mode=https check-certificate=no; /import mainhotspot.rsc" \\
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
    const host    = (req.headers.host ?? "") as string;
    const origin  = resolveOrigin(host);
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
  const origin = resolveOrigin((req.headers.host ?? "") as string);
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
  const origin = resolveOrigin((req.headers.host ?? "") as string);
  const uploadUrl = `${origin}/api/router-migrations/collector-upload?token=${encodeURIComponent(token)}`;
  res
    .set("Content-Type", "text/plain; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="router-migration-collector.rsc"')
    .set("Cache-Control", "no-store")
    .send(buildDomainRouterExportScript(uploadUrl));
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
      vpn_ip: string | null;
      router_secret: string | null;
      last_seen: string | null;
      status: string;
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${adminId}&select=id,name,host,bridge_interface,hotspot_dns_name,bridge_ip,vpn_ip,router_secret,last_seen,status`
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
    let createError = "";

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
                router_username:  "admin",
                router_secret:    autoSecret,
                token:            autoSecret,  /* NOT NULL column */
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
    const bridgeIface = router_row.bridge_interface  || "hotspot-bridge";
    const hotspotDns  = router_row.hotspot_dns_name  || `wifi.${routerSlug}.local`;
    const bridgeIp    = router_row.bridge_ip         || "192.168.88.1";
    const routerVpnIp = await ensurePersistentRouterTunnelIp(router_row.id, router_row.vpn_ip);
    updateRouterVpnAssignment(routerSlug, routerVpnIp);

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
    const WEAK = !routerSecret
      || routerSecret.length < 20
      || !/^[A-Za-z0-9_-]+$/.test(routerSecret)
      || /^(admin|password|secret|test|default)$/i.test(routerSecret);
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
    const routerVpnPassword = routerSecret ?? "";

    /* Ensure this router has a TLS client certificate ready on the server.
       Also keeps the psw-file in sync as a fallback during transition. */
    ensureClientCert(routerSlug);
    updateVpnCredentials(routerSlug, routerVpnPassword);

    /* Mirror the same credential into isp_vpn_users so the admin UI
       can see / audit / manage the VPN login that this router uses.
       Fire-and-forget: the helper internally swallows network errors and
       Supabase upsert is configured with resolution=ignore-duplicates on
       (admin_id, username), so re-running the install for the same router
       is a no-op rather than a duplicate row or a 4xx. The username is the
       router slug (e.g. "come1") to match what is configured on the
       MikroTik OVPN client and in the VPS auth file — keeping all three
       sources of truth in sync. */
    void ensureVpnUser(adminId, routerSlug, routerVpnPassword, routerName);

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
       ovpnAdd(routerSlug, `name=coreispbilling connect-to="${adminSubdomain}.isplatty.org" port=${Number.parseInt(String(process.env.ROUTER_OPENVPN_PORT ?? "1196"), 10) || 1196} mode=ip cipher=aes256 auth=sha1 add-default-route=no disabled=no`, routerSecret ?? ""),
      ``,
      `# === RouterOS Local System User (System -> Users in WinBox) ===`,
      `# Create / refresh a full-access login on the router itself with the same`,
      `# credentials used for the OVPN client, so the admin can WinBox / SSH /`,
       `# webfig into the router using the router-bound install credential.`,
      `# Idempotent: existing user with this name is removed first so the password`,
      `# is always refreshed to match what is stored in the backend / VPS auth file.`,
      safeRm(`/user remove [find name="${routerSlug}"]`),
       safeRos(`/user add name="${routerSlug}" password="${routerSecret}" group=full comment="${companyName} - auto-created by install"`, `local user "${routerSlug}" add`),
       `:put "      VPN tunnel 'coreispbilling' added  OK"`,
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
      `:do { /tool fetch url=("${registerUrl}?model=" . $rm . "&ver=" . $rv . "&ip=${routerVpnIp}") mode=https check-certificate=no dst-path=reg.tmp } on-error={}`,
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
       `:put " VPN      : coreispbilling -> ${adminSubdomain}.isplatty.org"`,
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
