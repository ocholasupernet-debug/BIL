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

/* ── Parse subdomain from Host header ── */
function parseSubdomain(host: string): string {
  const hostname = host.split(":")[0];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return "";
  const parts = hostname.split(".");
  return parts.length >= 3 ? parts[0] : "";
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

/* ══════════════════════════ Script generators ══════════════════════════ */
function genPPPoEOnly(router: DbRouter, companyName: string): string {
  const secret = router.router_secret ?? "changeme";
  return `# ============================================================
# ${companyName} — PPPoE Only Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# ============================================================

# 1. Clean previous config
/interface pppoe-server server remove [find]
/ppp profile remove [find name~"internet"]
/ip pool remove [find name~"pppoe"]
/interface bridge remove [find name="bridge-pppoe"]

# 2. Create bridge for PPPoE clients
/interface bridge add name=bridge-pppoe protocol-mode=none fast-forward=no comment="${companyName} PPPoE bridge"
/interface bridge port add bridge=bridge-pppoe interface=ether2 comment="ether2"
/interface bridge port add bridge=bridge-pppoe interface=ether3 comment="ether3"

# 3. Assign gateway IP to bridge
/ip address add address=10.10.0.1/24 interface=bridge-pppoe

# 4. IP Pool for PPPoE clients
/ip pool add name=pppoe-pool ranges=10.10.0.2-10.10.0.254

# 5. PPP Profile
/ppp profile add \\
  name=internet \\
  local-address=10.10.0.1 \\
  remote-address=pppoe-pool \\
  use-radius=yes \\
  dns-server=8.8.8.8,1.1.1.1 \\
  change-tcp-mss=yes \\
  comment="${companyName} profile"

# 6. RADIUS Client
/radius remove [find service=pppoe]
/radius add \\
  service=pppoe \\
  address=YOUR_RADIUS_IP \\
  secret=${secret} \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3000ms

/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# 7. PPPoE Server
/interface pppoe-server server add \\
  service-name=internet \\
  interface=bridge-pppoe \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 \\
  max-mtu=1480 \\
  one-session-per-host=yes \\
  keepalive-timeout=30 \\
  comment="${companyName} PPPoE Server"

# 8. NAT masquerade
/ip firewall nat add \\
  chain=srcnat src-address=10.10.0.0/24 \\
  action=masquerade out-interface=ether1 \\
  comment="PPPoE clients masquerade"

# 9. API access
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE Only config applied"
:put "Done. PPPoE server running on bridge-pppoe."
`;
}

function genPPPoEOverHotspot(router: DbRouter, companyName: string): string {
  const secret = router.router_secret ?? "changeme";
  return `# ============================================================
# ${companyName} — PPPoE over Hotspot Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# ============================================================

# 1. Clean existing config
/interface pppoe-server server remove [find]
/ip hotspot remove [find]
/ip pool remove [find name~"hs-pool"]
/ip pool remove [find name~"pppoe-pool"]
/ppp profile remove [find name~"internet"]
/interface bridge remove [find name="bridge-shared"]

# 2. Create shared bridge
/interface bridge add name=bridge-shared protocol-mode=none fast-forward=no comment="${companyName} shared bridge"
/interface bridge port add bridge=bridge-shared interface=ether2 comment="Client LAN"

# 3. Bridge IP
/ip address add address=192.168.88.1/24 interface=bridge-shared

# 4. DHCP for hotspot clients
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.200
/ip dhcp-server add name=dhcp-hs interface=bridge-shared address-pool=hs-pool disabled=no lease-time=10m
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1

# 5. DNS
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# 6. Hotspot
/ip hotspot profile add \\
  name=hs-profile \\
  dns-name=hotspot.local \\
  hotspot-address=192.168.88.1 \\
  use-radius=yes \\
  login-by=http-chap,mac \\
  mac-auth-mode=mac-as-username \\
  comment="${companyName} hotspot profile"

/ip hotspot add \\
  name=hotspot1 \\
  interface=bridge-shared \\
  profile=hs-profile \\
  address-pool=hs-pool \\
  idle-timeout=5m \\
  disabled=no

# 7. RADIUS (hotspot + PPPoE)
/radius remove [find service=hotspot]
/radius remove [find service=pppoe]
/radius add service=hotspot address=YOUR_RADIUS_IP secret=${secret} authentication-port=1812 accounting-port=1813 timeout=3000ms
/radius add service=pppoe  address=YOUR_RADIUS_IP secret=${secret} authentication-port=1812 accounting-port=1813 timeout=3000ms
/radius incoming set accept=yes port=3799

# 8. PPPoE pool + profile
/ip pool add name=pppoe-pool ranges=10.10.0.2-10.10.0.254
/ppp profile add \\
  name=internet \\
  local-address=192.168.88.1 \\
  remote-address=pppoe-pool \\
  dns-server=8.8.8.8,1.1.1.1 \\
  use-radius=yes \\
  use-compression=no \\
  change-tcp-mss=yes

/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# 9. PPPoE server on shared bridge
/interface pppoe-server server add \\
  service-name=internet \\
  interface=bridge-shared \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 max-mtu=1480 \\
  one-session-per-host=yes \\
  comment="${companyName} PPPoE-over-Hotspot"

# 10. NAT masquerade
/ip firewall nat add \\
  chain=srcnat src-address=192.168.88.0/24 \\
  action=masquerade out-interface=ether1 \\
  comment="PPPoE/Hotspot masquerade"

# 11. API access
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE-over-Hotspot config applied"
:put "Done. Hotspot: hotspot.local | PPPoE server on bridge-shared."
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
    /* Resolve admin */
    const hostHeader   = (req.headers.host ?? "") as string;
    const subdomain    = parseSubdomain(hostHeader);
    let   adminId      = parseInt(req.query.admin_id as string ?? "", 10) || 5;
    let   companyName  = "ISP";

    if (subdomain) {
      const admins = await sbGet<DbAdmin>(
        `isp_admins?subdomain=eq.${encodeURIComponent(subdomain)}&select=id,name,subdomain&limit=1`
      );
      if (admins.length > 0) { adminId = admins[0].id; companyName = admins[0].name; }
    } else if (!isNaN(adminId)) {
      try {
        const admins = await sbGet<DbAdmin>(`isp_admins?id=eq.${adminId}&select=id,name&limit=1`);
        if (admins.length > 0) companyName = admins[0].name;
      } catch { /* use defaults */ }
    }

    /* Fetch router */
    const rows = await sbGet<DbRouter>(
      `isp_routers?id=eq.${routerId}&admin_id=eq.${adminId}&select=*&limit=1`
    );

    if (rows.length === 0) {
      res.status(404).send("# Error: router not found");
      return;
    }

    const router = rows[0];
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
