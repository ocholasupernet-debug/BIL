import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SUPABASE_URL = "https://lijposnfdhlrfwdmbpge.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpanBvc25mZGhscmZ3ZG1icGdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE0Njk3NiwiZXhwIjoyMDg5NzIyOTc2fQ.4P1-ePDpjbHTxxUfW0sMnyFHHYeK014SOl5QmpTKLUQ";
const ADMIN_ID = 5;

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

/* ═══════════════════════════════════════════════════════════════
   GET /api/scripts/:name
   Dynamically generates a RouterOS .rsc file for the named router.
   The name is the router's name slugified (spaces → dashes).
   Example: router "come 1"  →  GET /api/scripts/come-1.rsc
═══════════════════════════════════════════════════════════════ */
router.get("/scripts/:name", async (req, res): Promise<void> => {
  const rawName  = req.params.name ?? "";
  /* Strip .rsc extension if present */
  const slug     = rawName.replace(/\.rsc$/, "");

  if (!slug) {
    res.status(400).send("# Error: script name is required");
    return;
  }

  try {
    /* ── Fetch all routers for this ISP ── */
    interface DbRouter {
      id: number; name: string; host: string;
      bridge_interface: string | null;
      hotspot_dns_name: string | null;
      bridge_ip: string | null;
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${ADMIN_ID}&select=id,name,host,bridge_interface,hotspot_dns_name,bridge_ip`
    );

    /* Match by slug */
    const router_row = routers.find(r => slugify(r.name) === slug);

    if (!router_row) {
      res.status(404).send(`# Error: no router found matching slug "${slug}"\n# Available: ${routers.map(r => slugify(r.name)).join(", ")}`);
      return;
    }

    /* ── Fetch hotspot plans ── */
    interface DbPlan {
      id: number; name: string; type: string;
      speed_down: number; speed_up: number;
      validity: number; validity_unit: string;
      shared_users: number;
    }
    const plans = await sbGet<DbPlan>(
      `isp_plans?admin_id=eq.${ADMIN_ID}&type=eq.hotspot&select=id,name,type,speed_down,speed_up,validity,validity_unit,shared_users`
    );

    /* ── Derive config values ── */
    const routerName   = router_row.name;
    const bridgeIface  = router_row.bridge_interface  || "bridge";
    const hotspotDns   = router_row.hotspot_dns_name  || `wifi.${slug}.local`;
    const bridgeIp     = router_row.bridge_ip         || "192.168.88.1";

    /* Derive pool range from bridge IP (use /24 of the bridge address) */
    const ipBase    = bridgeIp.replace(/\.\d+$/, "");
    const poolStart = `${ipBase}.2`;
    const poolEnd   = `${ipBase}.254`;

    const profileName = slug;
    const now         = new Date().toISOString();

    /* ── Build the .rsc content ── */
    const lines: string[] = [
      `# ═══════════════════════════════════════════════════`,
      `# OcholaSupernet — MikroTik Hotspot Configuration`,
      `# Router  : ${routerName}`,
      `# Generated: ${now}`,
      `# Import  : /import ${slug}.rsc`,
      `# ═══════════════════════════════════════════════════`,
      ``,
      `# === System Identity ===`,
      ros(`/system identity set name="OcholaNet-${routerName}"`),
      ``,
      `# === DNS ===`,
      ros(`/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes`),
      ``,
      `# === IP Pool ===`,
      ros(`/ip pool remove [find name=hspool]`),
      ros(`/ip pool add name=hspool ranges=${poolStart}-${poolEnd}`),
      ``,
      `# === Hotspot Profile ===`,
      ros(`/ip hotspot profile remove [find name="${profileName}"]`),
      ros(`/ip hotspot profile add name="${profileName}" hotspot-address=${bridgeIp} dns-name="${hotspotDns}" login-by=http-chap,http-pap use-radius=yes html-directory=flash/hotspot`),
      ``,
      `# === Hotspot ===`,
      ros(`/ip hotspot remove [find name=hotspot1]`),
      ros(`/ip hotspot add name=hotspot1 interface="${bridgeIface}" profile="${profileName}" address-pool=hspool idle-timeout=none`),
      ``,
      `# === RADIUS ===`,
      ros(`/radius remove [find service=hotspot]`),
      ros(`/radius add service=hotspot address=127.0.0.1 secret=radius123 authentication-port=1812 accounting-port=1813 timeout=3000ms`),
      ``,
      `# === NAT (Captive Portal Redirect) ===`,
      ros(`/ip firewall nat remove [find comment="OcholaNet - Hotspot redirect"]`),
      ros(`/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=redirect to-ports=64872 hotspot=!auth comment="OcholaNet - Hotspot redirect"`),
      ``,
      `# === Default User Profile ===`,
      ros(`/ip hotspot user profile remove [find name=default]`),
      ros(`/ip hotspot user profile add name=default shared-users=1 keepalive-timeout=2m idle-timeout=none`),
    ];

    /* ── Plan profiles ── */
    if (plans.length > 0) {
      lines.push(``, `# === Plan Profiles (${plans.length}) ===`);
      for (const plan of plans) {
        const pName   = plan.name.replace(/\s+/g, "-").toLowerCase();
        const rl      = toRateLimit(plan.speed_down, plan.speed_up, "Mbps");
        const timeout = toSessionTimeout(plan.validity, plan.validity_unit || "days");
        const shared  = plan.shared_users || 1;
        lines.push(ros(`/ip hotspot user profile remove [find name="${pName}"]`));
        lines.push(ros(`/ip hotspot user profile add name="${pName}" rate-limit="${rl}" session-timeout=${timeout} shared-users=${shared} comment="OcholaNet plan #${plan.id}"`));
      }
    }

    lines.push(``);
    lines.push(ros(`/log info message="OcholaNet: ${slug}.rsc imported successfully"`));
    lines.push(``);
    lines.push(`# ═══════════════════════════════════════════════════`);
    lines.push(`# Done — ${plans.length} plan profile(s) installed`);
    lines.push(`# ═══════════════════════════════════════════════════`);

    const body = lines.join("\r\n");

    res
      .set("Content-Type", "text/plain; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${slug}.rsc"`)
      .set("Cache-Control", "no-cache")
      .send(body);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`# Error generating script: ${msg}\n`);
  }
});

export default router;
