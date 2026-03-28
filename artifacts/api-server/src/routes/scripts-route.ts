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
  const parts    = hostname.split(".");
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
      /* Fallback: explicit query param */
      const qid = parseInt(req.query.admin_id as string, 10);
      if (!isNaN(qid)) {
        const admins = await sbGet<DbAdmin>(
          `isp_admins?id=eq.${qid}&select=id,name,subdomain&limit=1`
        );
        if (admins.length > 0) {
          adminId        = admins[0].id;
          adminSubdomain = admins[0].subdomain ?? `admin${qid}`;
          companyName    = admins[0].name;
        }
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
    }
    const routers = await sbGet<DbRouter>(
      `isp_routers?admin_id=eq.${adminId}&select=id,name,host,bridge_interface,hotspot_dns_name,bridge_ip`
    );

    /* "mainhotspot" is a special keyword meaning "first/main hotspot router" */
    let router_row: DbRouter | undefined;
    if (slug === "mainhotspot" || slug === "main-hotspot") {
      router_row = routers[0]; // use the first router for this admin
    } else {
      router_row = routers.find(r => slugify(r.name) === slug);
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
    const poolStart   = `${ipBase}.2`;
    const poolEnd     = `${ipBase}.254`;

    const profileName = routerSlug;
    const now         = new Date().toISOString();

    /* ── Step 5: Build the .rsc content ── */
    const lines: string[] = [
      `# ═══════════════════════════════════════════════════`,
      `# ${companyName} — MikroTik Hotspot Configuration`,
      `# Router  : ${routerName}`,
      `# Admin   : ${adminSubdomain} (id=${adminId})`,
      `# Generated: ${now}`,
      `# Import  : /import ${routerSlug}.rsc`,
      `# ═══════════════════════════════════════════════════`,
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
      ros(`/ip firewall nat remove [find comment="${companyName} - Hotspot redirect"]`),
      ros(`/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=redirect to-ports=64872 hotspot=!auth comment="${companyName} - Hotspot redirect"`),
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
        lines.push(ros(`/ip hotspot user profile add name="${pName}" rate-limit="${rl}" session-timeout=${timeout} shared-users=${shared} comment="${companyName} plan #${plan.id}"`));
      }
    }

    lines.push(``);
    lines.push(ros(`/log info message="${companyName}: ${routerSlug}.rsc imported successfully"`));
    lines.push(``);
    lines.push(`# ═══════════════════════════════════════════════════`);
    lines.push(`# Done — ${plans.length} plan profile(s) installed`);
    lines.push(`# ═══════════════════════════════════════════════════`);

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
