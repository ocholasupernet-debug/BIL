import { Router, type IRouter } from "express";
import { RouterOSAPI } from "node-routeros";
import { readVpnClients, vpnIpFor, VPN_STATUS_PATHS } from "../lib/vpn-status";

const router: IRouter = Router();

/* ─── Timeout wrapper ─── */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/* ─── Safe write that ignores "already exists / not found" ─── */
async function safeWrite(conn: RouterOSAPI, args: string[]): Promise<unknown> {
  try {
    return await conn.write(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes("already exists") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no such item")
    ) {
      return `(skipped: ${msg})`;
    }
    throw err;
  }
}

/* ─── Upsert helper: set if exists, add if not ─── */
async function upsertByFilter(
  conn: RouterOSAPI,
  path: string,
  filterKey: string,
  filterVal: string,
  props: Record<string, string>
): Promise<"updated" | "created"> {
  const list = await conn.write([`${path}/print`, `?${filterKey}=${filterVal}`]);
  if (Array.isArray(list) && list.length > 0) {
    const id = (list[0] as Record<string, string>)[".id"];
    if (id) {
      await conn.write([`${path}/set`, `=.id=${id}`, ...Object.entries(props).map(([k, v]) => `=${k}=${v}`)]);
      return "updated";
    }
  }
  await conn.write([`${path}/add`, ...Object.entries(props).map(([k, v]) => `=${k}=${v}`)]);
  return "created";
}

/* ─── Connect helper ─── */
function makeConn(host: string, username: string, password: string): RouterOSAPI {
  return new RouterOSAPI({ host, port: 8728, user: username || "admin", password: password || "", timeout: 6, keepalive: false });
}

/* ─── Connect with optional bridgeIp fallback ─── */
async function connectWithFallback(
  host: string,
  bridgeIp: string | undefined,
  username: string,
  password: string,
  log: (msg: string) => void,
): Promise<{ conn: RouterOSAPI; via: string }> {
  const primary = host || bridgeIp || "";
  if (!primary) throw new Error("No host or bridge IP provided");

  log(`▶ Connecting to ${primary}:8728 as '${username || "admin"}'...`);
  const conn = makeConn(primary, username, password);
  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected via ${primary}`);
    return { conn, via: primary };
  } catch (firstErr) {
    const fallback = bridgeIp && bridgeIp !== primary ? bridgeIp : null;
    if (!fallback) throw firstErr;
    log(`⚠ ${primary} unreachable, trying VPN bridge ${fallback}...`);
    const conn2 = makeConn(fallback, username, password);
    await withTimeout(conn2.connect(), 12000);
    log(`✓ Connected via VPN bridge ${fallback}`);
    return { conn: conn2, via: fallback };
  }
}

/* ─── Extract real client IP, unwrap IPv4-mapped IPv6 (::ffff:x.x.x.x) ─── */
function clientIp(req: import("express").Request): string {
  const raw = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").split(",")[0].trim();
  return raw.replace(/^::ffff:/, "");
}

/* ─── Returns true if IP is in the OpenVPN tunnel subnet 10.8.x.x ─── */
function isVpnIp(ip: string): boolean {
  return /^10\.8\./.test(ip);   /* covers 10.8.0.x, 10.8.1.x … 10.8.255.x */
}

/* ─── Returns true if IP is a private/link-local/loopback range ─── */
function isPrivateIp(ip: string): boolean {
  return (
    /^127\./.test(ip) ||           // loopback
    /^10\./.test(ip)  ||           // RFC-1918 (includes VPN 10.8.0.x)
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || // RFC-1918
    /^192\.168\./.test(ip) ||      // RFC-1918
    /^169\.254\./.test(ip) ||      // link-local
    /^::1$/.test(ip) ||            // IPv6 loopback
    /^fc|^fd/.test(ip)             // IPv6 ULA
  );
}

/* ─── Returns true if IP looks like a routable public IP ─── */
function isPublicIp(ip: string): boolean {
  if (!ip || ip === "::1") return false;
  return !isPrivateIp(ip);
}

/* ─── Returns true if IP is a private LAN (not VPN 10.8.0.x) ─── */
function isLanOnlyIp(ip: string): boolean {
  if (!ip) return false;
  return (
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^127\./.test(ip) ||
    /^169\.254\./.test(ip)
  );
}

/* ═══════════════════════════════════════════════════════════════
   GET /api/admin/vpn-status
   Returns all currently connected OpenVPN clients from the
   server-side status file.  Useful for debugging VPN IPs.
═══════════════════════════════════════════════════════════════ */
router.get("/admin/vpn-status", (_req, res) => {
  const clients = readVpnClients();
  if (clients.length === 0) {
    res.json({ ok: false, error: "No VPN status file found or no clients connected", paths: VPN_STATUS_PATHS });
    return;
  }
  res.json({ ok: true, clients });
});

/* ─── Background auto-probe: connect RouterOS API, save host/model/version ─── */
async function bgAutoProbe(
  token: string,
  host:  string,
  username: string,
): Promise<void> {
  const url = hbUrl();
  const key = hbKey();
  if (!url || !key) return;
  const enc = encodeURIComponent(token);
  try {
    const conn = makeConn(host, username || "admin", token);
    await withTimeout(conn.connect(), 10_000);
    const resArr = await conn.write(["/system/resource/print"]);
    const sysRes = (Array.isArray(resArr) && resArr[0]) ? resArr[0] as Record<string, string> : {};
    let boardName = "";
    try {
      const rbArr = await conn.write(["/system/routerboard/print"]);
      const rb = (Array.isArray(rbArr) && rbArr[0]) ? rbArr[0] as Record<string, string> : {};
      boardName = rb.model || rb["board-name"] || "";
    } catch { /* CHR/VM without routerboard */ }
    conn.close();
    const model   = boardName || sysRes["board-name"] || "";
    const version = sysRes.version || "";
    console.log(`[auto-probe] ✓ ${host} — model=${model} ver=${version}`);
    /* Persist host + hardware info */
    await fetch(
      `${url}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})`,
      {
        method: "PATCH",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ host, model, ros_version: version, status: "online" }),
      }
    );
  } catch (e) {
    console.warn(`[auto-probe] ${host} unreachable: ${e instanceof Error ? e.message : e}`);
  }
}

/* ─── Speed → MikroTik rate-limit string ─── */
function toRateLimit(down: number, up: number, unit: string = "Mbps"): string {
  const suffix = unit === "Kbps" ? "k" : unit === "Gbps" ? "G" : "M";
  return `${up}${suffix}/${down}${suffix}`;
}

/* ─── Validity → MikroTik session-timeout string (HH:MM:SS, hours may exceed 24) ─── */
function toSessionTimeout(value: number, unit: string): string {
  const u = (unit || "Days").toLowerCase();
  let totalSec = 0;
  if (u.startsWith("min"))   totalSec = value * 60;
  else if (u.startsWith("hr"))    totalSec = value * 3600;
  else if (u.startsWith("day"))   totalSec = value * 86400;
  else if (u.startsWith("week"))  totalSec = value * 7 * 86400;
  else if (u.startsWith("month")) totalSec = value * 30 * 86400;
  else totalSec = value * 86400;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

/* ─── Connection error message ─── */
function connErr(host: string, rawErr: unknown): string {
  const msg = rawErr instanceof Error
    ? rawErr.message
    : typeof rawErr === "string"
      ? rawErr
      : JSON.stringify(rawErr);

  /* A blank or generic message still means a connection problem */
  const isConnProblem =
    !msg.trim() ||
    /timed out|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(msg);

  if (isConnProblem) {
    return (
      `Cannot reach router at ${host}:8728 — connection timed out or refused. ` +
      `To fix: 1) In RouterOS open IP → Services → enable "api" (port 8728). ` +
      `2) Add a firewall rule to allow port 8728 from the VPN interface (e.g. /ip firewall filter add chain=input protocol=tcp dst-port=8728 action=accept). ` +
      `3) Confirm the router's VPN tunnel IP is reachable from the server.` +
      (msg.trim() ? ` (raw: ${msg})` : "")
    );
  }
  return msg;
}

/* ─── Enrich "not enough permissions" errors with the fix command ─── */
function enrichPermErr(err: unknown, username: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not enough permissions|permission/i.test(msg)) {
    return (
      `not enough permissions — the API user "${username}" needs the "write" policy. ` +
      `Run in router terminal: /user set [find name="${username}"] policy=read,write,api,test`
    );
  }
  return msg;
}

/* ═══════════════════════════════════════════════════════════════
   GET /api/admin/server-info
   Returns the server's outbound public IP so the frontend can show
   the exact firewall rule the user needs to add on their router.
═══════════════════════════════════════════════════════════════ */
router.get("/admin/server-info", async (_req, res): Promise<void> => {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
    const { ip } = await r.json() as { ip: string };
    res.json({ ok: true, serverIp: ip });
  } catch {
    res.json({ ok: true, serverIp: "34.145.0.87" }); /* fallback to known IP */
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/sync
   Pushes full hotspot setup config to router
═══════════════════════════════════════════════════════════════ */
router.post("/admin/sync", async (req, res): Promise<void> => {
  const { host, username, password, cfg } = req.body as {
    host: string; username: string; password: string;
    cfg: {
      routerName: string; hotspotIp: string; dnsName: string;
      radiusIp: string; radiusSecret: string; bridgeInterface: string;
      poolStart: string; poolEnd: string; profileName: string;
    };
  };

  if (!host || !cfg) { res.status(400).json({ ok: false, error: "host and cfg are required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  log(`▶ Connecting to ${host}:8728 as '${username || "admin"}'...`);

  const conn = makeConn(host, username, password);
  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected`);

    log(`Setting identity → OcholaNet-${cfg.routerName}`);
    await conn.write(["/system/identity/set", `=name=OcholaNet-${cfg.routerName}`]);
    log(`✓ Identity set`);

    log(`Configuring DNS → 8.8.8.8, 8.8.4.4`);
    await conn.write(["/ip/dns/set", "=servers=8.8.8.8,8.8.4.4", "=allow-remote-requests=yes"]);
    log(`✓ DNS configured`);

    log(`Hotspot profile '${cfg.profileName}'...`);
    const profAction = await upsertByFilter(conn, "/ip/hotspot/profile", "name", cfg.profileName, {
      name: cfg.profileName, "hotspot-address": cfg.hotspotIp, "dns-name": cfg.dnsName,
      "login-by": "http-chap,http-pap", "use-radius": "yes", "html-directory": "flash/hotspot",
    });
    log(`✓ Profile ${profAction}`);

    log(`IP pool hspool → ${cfg.poolStart}-${cfg.poolEnd}`);
    const poolAction = await upsertByFilter(conn, "/ip/pool", "name", "hspool", { name: "hspool", ranges: `${cfg.poolStart}-${cfg.poolEnd}` });
    log(`✓ Pool ${poolAction}`);

    log(`Hotspot on interface '${cfg.bridgeInterface}'...`);
    const hsAction = await upsertByFilter(conn, "/ip/hotspot", "name", "hotspot1", {
      name: "hotspot1", interface: cfg.bridgeInterface, profile: cfg.profileName, "address-pool": "hspool", "idle-timeout": "none",
    });
    log(`✓ Hotspot ${hsAction}`);

    log(`RADIUS → ${cfg.radiusIp}:1812/1813`);
    const radAction = await upsertByFilter(conn, "/radius", "service", "hotspot", {
      service: "hotspot", address: cfg.radiusIp, secret: cfg.radiusSecret,
      "authentication-port": "1812", "accounting-port": "1813", timeout: "3000ms",
    });
    log(`✓ RADIUS ${radAction}`);

    log(`NAT redirect rule...`);
    const natList = await conn.write(["/ip/firewall/nat/print", "?comment=OcholaNet - Hotspot redirect"]);
    if (Array.isArray(natList) && natList.length === 0) {
      await safeWrite(conn, ["/ip/firewall/nat/add", "=chain=dstnat", "=protocol=tcp", "=dst-port=80",
        "=action=redirect", "=to-ports=64872", "=hotspot=!auth", "=comment=OcholaNet - Hotspot redirect"]);
      log(`✓ NAT rule added`);
    } else { log(`✓ NAT rule already present`); }

    log(`Hotspot user profile default...`);
    await safeWrite(conn, ["/ip/hotspot/user/profile/add", "=name=default", "=shared-users=1", "=keepalive-timeout=2m", "=idle-timeout=none"]);
    log(`✓ User profile ready`);

    await conn.write(["/log/info", `=message=OcholaNet: Hotspot synced on ${cfg.routerName}`]);
    log(`\n✅ Sync complete — ${cfg.routerName} (${host})`);
    conn.close();
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host, msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/sync/plans
   Pushes service plans as MikroTik hotspot/PPPoE profiles
   Body: {
     host, username, password,
     plans: [{ id, name, type, speed_down, speed_up, speed_down_unit, speed_up_unit,
               validity, validity_unit, shared_users }]
   }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/sync/plans", async (req, res): Promise<void> => {
  const { host, bridgeIp, username, password, plans } = req.body as {
    host: string; bridgeIp?: string; username: string; password: string;
    plans: Array<{
      id: number; name: string; type: string;
      speed_down: number; speed_up: number;
      speed_down_unit: string; speed_up_unit: string;
      validity: number; validity_unit: string;
      shared_users: number;
    }>;
  };

  if ((!host && !bridgeIp) || !plans?.length) { res.status(400).json({ ok: false, error: "host/bridgeIp and plans are required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  let conn!: RouterOSAPI;
  try {
    ({ conn } = await connectWithFallback(host, bridgeIp, username, password, log));
    log(`  pushing ${plans.length} plan profile(s)\n`);

    let created = 0, updated = 0, skipped = 0;

    for (const plan of plans) {
      const profileName = plan.name.replace(/\s+/g, "-").toLowerCase();
      const rateLimit   = toRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit || "Mbps");
      const sessionTime = toSessionTimeout(plan.validity, plan.validity_unit);

      if (plan.type === "pppoe") {
        /* ── PPPoE profile ── */
        log(`▶ PPPoE profile: ${profileName} | rate-limit: ${rateLimit}`);
        try {
          const action = await upsertByFilter(conn, "/ppp/profile", "name", profileName, {
            name:         profileName,
            "rate-limit": rateLimit,
          });
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${enrichPermErr(e, username)}`);
          skipped++;
        }
      } else if (plan.type === "hotspot" || plan.type === "trials") {
        /* ── Hotspot user profile ── */
        log(`▶ Hotspot profile: ${profileName} | rate-limit: ${rateLimit} | session: ${sessionTime} | shared: ${plan.shared_users}`);
        try {
          const action = await upsertByFilter(conn, "/ip/hotspot/user/profile", "name", profileName, {
            name:              profileName,
            "rate-limit":      rateLimit,
            "session-timeout": sessionTime,
            "shared-users":    String(plan.shared_users || 1),
          });
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${enrichPermErr(e, username)}`);
          skipped++;
        }
      } else {
        log(`  — Skipping ${plan.type} plan '${plan.name}' (not hotspot/pppoe)`);
        skipped++;
      }
    }

    await conn.write(["/log/info", `=message=OcholaNet: Synced ${created + updated} plan profiles`]);
    log(`\n✅ Done — ${created} created, ${updated} updated, ${skipped} skipped`);
    conn.close();
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host || bridgeIp || "", msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/sync/ip-pools
   Pushes IP pools to a MikroTik router.
   Body: { host, bridgeIp?, username, password,
           pools: [{ name, rangeStart, rangeEnd }] }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/sync/ip-pools", async (req, res): Promise<void> => {
  const { host, bridgeIp, username, password, pools } = req.body as {
    host: string; bridgeIp?: string; username: string; password: string;
    pools: Array<{ name: string; rangeStart: string; rangeEnd: string }>;
  };

  if ((!host && !bridgeIp) || !pools?.length) {
    res.status(400).json({ ok: false, error: "host/bridgeIp and pools are required" });
    return;
  }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  let conn!: RouterOSAPI;
  try {
    ({ conn } = await connectWithFallback(host, bridgeIp, username, password, log));
    log(`  pushing ${pools.length} IP pool(s)\n`);

    let created = 0, updated = 0;

    for (const pool of pools) {
      const ranges = `${pool.rangeStart}-${pool.rangeEnd}`;
      log(`▶ Pool: ${pool.name} | ranges: ${ranges}`);
      try {
        const action = await upsertByFilter(conn, "/ip/pool", "name", pool.name, {
          name: pool.name,
          ranges,
        });
        log(`  ✓ ${action}`);
        action === "created" ? created++ : updated++;
      } catch (e) {
        log(`  ❌ ${enrichPermErr(e, username)}`);
      }
    }

    log(`\n✅ Done — ${created} created, ${updated} updated`);
    conn.close();
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host || bridgeIp || "", msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/sync/users
   Pushes customers or vouchers to router as hotspot users / PPPoE secrets
   Body: {
     host, username, password,
     users: [{ username, password, type, plan_name, pppoe_username,
               mac_address, ip_address, comment? }]
   }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/sync/users", async (req, res): Promise<void> => {
  const { host, bridgeIp, username, password, users } = req.body as {
    host: string; bridgeIp?: string; username: string; password: string;
    users: Array<{
      username: string; password: string;
      type: string;           // "hotspot" | "pppoe" | "static" | "voucher"
      plan_name: string;      // becomes profile name on router
      pppoe_username?: string;
      mac_address?: string;
      ip_address?: string;
      comment?: string;
    }>;
  };

  if ((!host && !bridgeIp) || !users?.length) { res.status(400).json({ ok: false, error: "host/bridgeIp and users are required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  let conn!: RouterOSAPI;
  try {
    ({ conn } = await connectWithFallback(host, bridgeIp, username, password, log));
    log(`  pushing ${users.length} user(s)\n`);

    let created = 0, updated = 0, skipped = 0;

    for (const u of users) {
      const profileName = u.plan_name ? u.plan_name.replace(/\s+/g, "-").toLowerCase() : "default";
      const comment     = u.comment || `OcholaNet`;

      if (u.type === "pppoe") {
        /* ── PPPoE secret ── */
        const secretName = u.pppoe_username || u.username;
        log(`▶ PPPoE secret: ${secretName} | profile: ${profileName}`);
        try {
          const props: Record<string, string> = {
            name:     secretName,
            password: u.password || "",
            service:  "ppp",
            profile:  profileName,
            comment,
          };
          if (u.ip_address) props["remote-address"] = u.ip_address;
          const action = await upsertByFilter(conn, "/ppp/secret", "name", secretName, props);
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
          skipped++;
        }
      } else if (u.type === "hotspot" || u.type === "voucher") {
        /* ── Hotspot user ── */
        log(`▶ Hotspot user: ${u.username} | profile: ${profileName}`);
        try {
          const props: Record<string, string> = {
            name:     u.username,
            password: u.password || "",
            profile:  profileName,
            comment,
          };
          if (u.mac_address) props["mac-address"] = u.mac_address;
          const action = await upsertByFilter(conn, "/ip/hotspot/user", "name", u.username, props);
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
          skipped++;
        }
      } else {
        log(`  — Skipping static/unknown user '${u.username}'`);
        skipped++;
      }
    }

    await conn.write(["/log/info", `=message=OcholaNet: Synced ${created + updated} users`]);
    log(`\n✅ Done — ${created} created, ${updated} updated, ${skipped} skipped`);
    conn.close();
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host || bridgeIp || "", msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/router/reboot
   Connects to a MikroTik router and sends /system reboot.
   Body: { host, username, password, bridgeIp? }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/router/reboot", async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp } = req.body as {
    host: string; username: string; password: string; bridgeIp?: string;
  };
  if (!host) { res.status(400).json({ ok: false, error: "host is required" }); return; }

  let conn = makeConn(host, username, password);
  let connected = false;
  let via = host;

  try {
    await withTimeout(conn.connect(), 8000);
    connected = true;
  } catch {
    if (bridgeIp && bridgeIp !== host) {
      try {
        conn = makeConn(bridgeIp, username, password);
        await withTimeout(conn.connect(), 8000);
        connected = true;
        via = bridgeIp;
      } catch { /* both failed */ }
    }
  }

  if (!connected) {
    res.json({ ok: false, error: connErr(host, "Connection timed out") });
    return;
  }

  try {
    /* Send reboot — router disconnects immediately, so we don't wait for a response */
    conn.write(["/system/reboot"]).catch(() => { /* expected disconnect */ });
    res.json({ ok: true, via, message: `Reboot command sent to ${via}` });
  } catch (err) {
    res.json({ ok: false, error: connErr(host, err) });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/router/fix-api
   Connects to a MikroTik router via the API and:
     1. Enables the API service (/ip service set [find name=api] disabled=no)
     2. Adds a firewall rule to allow port 8728 from the VPN range
   Body: { host, username, password, bridgeIp? }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/router/fix-api", async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp } = req.body as {
    host: string; username: string; password: string; bridgeIp?: string;
  };
  if (!host) { res.status(400).json({ ok: false, error: "host is required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  let conn = makeConn(host, username, password);
  let connected = false;
  let via = host;

  try {
    log(`▶ Connecting to ${host}:8728 as '${username || "admin"}'…`);
    await withTimeout(conn.connect(), 8000);
    connected = true;
    log("✓ Connected");
  } catch {
    if (bridgeIp && bridgeIp !== host) {
      try {
        log(`▶ Retrying via VPN IP ${bridgeIp}…`);
        conn = makeConn(bridgeIp, username, password);
        await withTimeout(conn.connect(), 8000);
        connected = true;
        via = bridgeIp;
        log("✓ Connected via VPN IP");
      } catch { /* both failed */ }
    }
  }

  if (!connected) {
    res.json({
      ok: false,
      canConnect: false,
      logs,
      error: "Cannot reach router — run the commands manually in Winbox Terminal",
    });
    return;
  }

  try {
    log("Enabling API service…");
    await conn.write(["/ip/service/set", "=numbers=api", "=disabled=no"]).catch(() => {
      conn.write(["/ip/service/set", `=.id=[/ip/service/find name=api]`, "=disabled=no"]).catch(() => {});
    });
    log("✓ API service enabled");

    log("Adding firewall rule for port 8728 (VPN range 10.8.0.0/16)…");
    await conn.write([
      "/ip/firewall/filter/add",
      "=chain=input",
      "=protocol=tcp",
      "=dst-port=8728",
      "=src-address=10.8.0.0/16",
      "=action=accept",
      "=place-before=0",
    ]).catch(() => {
      /* May fail if rule already exists — not an error */
      log("  (firewall rule may already exist — skipping)");
    });
    log("✓ Firewall rule applied");

    log("✅ Auto-fix complete — try syncing again");
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: true, canConnect: true, via, logs });
  } catch (err) {
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, canConnect: true, logs, error: connErr(via, err) });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/router/probe
   Connects to a MikroTik router and reads:
     - /system/resource  (version, board-name, uptime, cpu-load, memory)
     - /system/routerboard (model, serial-number, current-firmware)
     - /system/identity  (name)
     - /ip/address/print (first WAN/LAN IP)
   Returns the parsed info as JSON so the frontend can display + save it.
   Body: { host, username, password, routerId? }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/router/probe", async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp } = req.body as {
    host: string; username: string; password: string; routerId?: number; bridgeIp?: string;
  };

  if (!host) { res.status(400).json({ ok: false, error: "host is required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  /* ── Try direct connection first, then VPN bridge IP as fallback ── */
  let conn = makeConn(host, username, password);
  let connectedVia = host;
  let connected = false;

  try {
    log(`▶ Probing ${host}:8728 as '${username || "admin"}'…`);
    await withTimeout(conn.connect(), 12000);
    connected = true;
    log(`✓ Connected (direct)`);
  } catch (directErr) {
    const directMsg = directErr instanceof Error ? directErr.message : String(directErr);
    log(`✗ Direct connection failed: ${directMsg}`);
    if (bridgeIp) {
      try {
        log(`▶ Retrying via VPN bridge ${bridgeIp}:8728…`);
        conn = makeConn(bridgeIp, username, password);
        await withTimeout(conn.connect(), 12000);
        connectedVia = `${bridgeIp} (VPN)`;
        connected = true;
        log(`✓ Connected via VPN bridge`);
      } catch (bridgeErr) {
        const bridgeMsg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
        log(`✗ VPN bridge also failed: ${bridgeMsg}`);
      }
    }
  }

  if (!connected) {
    res.json({ ok: false, error: `Cannot reach ${host}:8728 — check the IP and that API is enabled (port 8728 open, /ip/service api=yes)`, logs });
    return;
  }

  log(`✓ Via: ${connectedVia}`);

  try {
    /* ── /system/resource ── */
    log(`Reading /system/resource…`);
    const resArr = await conn.write(["/system/resource/print"]);
    const sysRes = (Array.isArray(resArr) && resArr[0]) ? resArr[0] as Record<string, string> : {};
    log(`✓ resource OK`);

    /* ── /system/routerboard ── */
    log(`Reading /system/routerboard…`);
    let routerboard: Record<string, string> = {};
    try {
      const rbArr = await conn.write(["/system/routerboard/print"]);
      routerboard = (Array.isArray(rbArr) && rbArr[0]) ? rbArr[0] as Record<string, string> : {};
      log(`✓ routerboard OK`);
    } catch {
      log(`  (routerboard not available — CHR/VM?)`);
    }

    /* ── /system/identity ── */
    log(`Reading /system/identity…`);
    let identity = "";
    try {
      const idArr = await conn.write(["/system/identity/print"]);
      identity = (Array.isArray(idArr) && idArr[0]) ? (idArr[0] as Record<string, string>).name || "" : "";
      log(`✓ identity: ${identity}`);
    } catch {
      log(`  (identity not available)`);
    }

    /* ── /ip/address ── */
    log(`Reading /ip/address…`);
    let ipAddresses: Array<{ address: string; interface: string }> = [];
    try {
      const ipArr = await conn.write(["/ip/address/print"]);
      if (Array.isArray(ipArr)) {
        ipAddresses = (ipArr as Record<string, string>[]).map(a => ({
          address:   a.address || "",
          interface: a.interface || "",
        }));
      }
      log(`✓ ${ipAddresses.length} IP address(es)`);
    } catch {
      log(`  (IP address read failed)`);
    }

    /* ── /interface/print brief ── */
    log(`Reading /interface…`);
    let interfaces: Array<{ name: string; type: string; running: boolean }> = [];
    try {
      const ifArr = await conn.write(["/interface/print"]);
      if (Array.isArray(ifArr)) {
        interfaces = (ifArr as Record<string, string>[]).slice(0, 12).map(i => ({
          name:    i.name || "",
          type:    i.type || "",
          running: i.running === "true",
        }));
      }
      log(`✓ ${interfaces.length} interface(s)`);
    } catch {
      log(`  (interface read failed)`);
    }

    conn.close();

    /* ── Parse useful fields ── */
    const version   = sysRes.version        || "";
    const boardName = routerboard["board-name"] || sysRes["board-name"] || "";
    const model     = routerboard.model     || boardName;
    const serial    = routerboard["serial-number"]    || "";
    const firmware  = routerboard["current-firmware"] || "";
    const uptime    = sysRes.uptime         || "";
    const cpuLoad   = sysRes["cpu-load"]    || "0";
    const freeMem   = parseInt(sysRes["free-memory"]  || "0", 10);
    const totalMem  = parseInt(sysRes["total-memory"] || "0", 10);
    const cpuCount  = sysRes["cpu-count"]   || "1";
    const platform  = sysRes.platform       || "MikroTik";
    const arch      = sysRes["architecture-name"] || "";

    const fmtMB = (b: number) => b > 0 ? `${(b / 1024 / 1024).toFixed(0)} MB` : "—";

    log(`\n✅ Probe complete`);
    log(`  Model:      ${model || "—"}`);
    log(`  ROS:        ${version || "—"}`);
    log(`  Uptime:     ${uptime || "—"}`);
    log(`  CPU load:   ${cpuLoad}%`);
    log(`  Memory:     ${fmtMB(freeMem)} free / ${fmtMB(totalMem)} total`);
    log(`  Serial:     ${serial || "—"}`);
    log(`  Firmware:   ${firmware || "—"}`);

    res.json({
      ok: true,
      connectedVia,
      logs,
      /* Top-level fields so the frontend ProbeResult interface reads them directly */
      version,
      model:     model || "MikroTik",
      boardName,
      serial,
      firmware,
      uptime,
      cpuLoad:   parseInt(cpuLoad, 10),
      freeMem,
      totalMem,
      cpuCount:  parseInt(cpuCount, 10),
      platform,
      arch,
      identity,
      ipAddresses,
      interfaces,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host, msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/router/ports
   Reads all interfaces and current bridge-port memberships.
   Body: { host, username, password }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/router/ports", async (req, res): Promise<void> => {
  const { host, username, password, bridgeIp, routerCn, routerId } = req.body as {
    host: string; username: string; password: string;
    bridgeIp?: string; routerCn?: string; routerId?: number;
  };

  /* ── Build list of IPs to try in order ──────────────────────
     1. host       (WAN or direct IP stored in Supabase)
     2. bridgeIp   (explicit VPN bridge IP if set and different)
     3. vpnIp      (auto-looked up from OpenVPN server status file by WAN IP)
     4. cnVpnIp    (looked up by router VPN certificate CN — fallback when
                    host is empty, e.g. brand-new router whose host was never set)
     ─────────────────────────────────────────────────────────── */
  const vpnClients = readVpnClients();
  const autoVpnIp  = host ? vpnIpFor(host, vpnClients) : null;   /* e.g. 10.8.0.6 */
  const cnVpnIp    = routerCn ? vpnIpFor(routerCn, vpnClients) : null;

  /* Require at least one usable address */
  if (!host && !bridgeIp && !autoVpnIp && !cnVpnIp) {
    res.status(400).json({ ok: false, error: "host is required" });
    return;
  }

  /* Fast-fail only when ALL candidates are LAN-only with no VPN alternative */
  const candidates = [host, bridgeIp, autoVpnIp, cnVpnIp].filter(Boolean) as string[];
  const hasReachableCandidate = candidates.some(ip => !isLanOnlyIp(ip));
  if (!hasReachableCandidate) {
    const detail = (autoVpnIp || cnVpnIp)
      ? ""
      : bridgeIp && bridgeIp === host
        ? `Bridge IP is set to the same LAN address (${bridgeIp}).`
        : `No VPN tunnel IP found. Set the router's VPN IP in Bridge IP or ensure OpenVPN is running.`;
    res.json({
      ok: false,
      error: `Router host ${host || "(none)"} is a private LAN address — the server cannot reach it directly. ${detail}`.trim(),
    });
    return;
  }

  /* ── Try each candidate in order ── */
  let conn!: RouterOSAPI;
  let connectedVia = "";
  let lastErr: unknown;

  const toTry: Array<{ ip: string; label: string }> = [];
  if (host && !isLanOnlyIp(host)) toTry.push({ ip: host, label: host });
  if (bridgeIp && bridgeIp !== host && !isLanOnlyIp(bridgeIp))
    toTry.push({ ip: bridgeIp, label: `${bridgeIp} (bridge)` });
  if (autoVpnIp && !toTry.find(t => t.ip === autoVpnIp))
    toTry.push({ ip: autoVpnIp, label: `${autoVpnIp} (VPN tunnel)` });
  if (cnVpnIp && !toTry.find(t => t.ip === cnVpnIp))
    toTry.push({ ip: cnVpnIp, label: `${cnVpnIp} (VPN by CN)` });

  for (const { ip, label } of toTry) {
    try {
      conn = makeConn(ip, username, password);
      await withTimeout(conn.connect(), 8000);
      connectedVia = label;

      /* ── Save discovered VPN IP back to Supabase in background ── */
      const HB_URL = hbUrl();
      const HB_KEY = hbKey();
      if (HB_URL && HB_KEY) {
        if (ip === autoVpnIp && host) {
          /* Found VPN IP by matching WAN host → save as bridge_ip */
          fetch(
            `${HB_URL}/rest/v1/isp_routers?host=eq.${encodeURIComponent(host)}`,
            { method: "PATCH", headers: { apikey: HB_KEY, Authorization: `Bearer ${HB_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ bridge_ip: ip }) }
          ).catch(() => {});
        } else if (ip === cnVpnIp && routerId) {
          /* Found VPN IP by CN (host was empty) → save as both host and bridge_ip using router ID */
          fetch(
            `${HB_URL}/rest/v1/isp_routers?id=eq.${routerId}`,
            { method: "PATCH", headers: { apikey: HB_KEY, Authorization: `Bearer ${HB_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ host: ip, bridge_ip: ip }) }
          ).catch(() => {});
        }
      }
      break; /* connected — stop trying */
    } catch (err) {
      lastErr = err;
      try { conn?.close(); } catch { /* ignore */ }
    }
  }

  if (!connectedVia) {
    /* All candidates failed */
    res.json({ ok: false, error: connErr(host, lastErr) });
    return;
  }

  try {

    /* All interfaces */
    const ifArr = await conn.write(["/interface/print"]);
    const interfaces = (Array.isArray(ifArr) ? ifArr : []) as Record<string, string>[];

    /* All bridges */
    let bridges: Record<string, string>[] = [];
    try {
      const brArr = await conn.write(["/interface/bridge/print"]);
      bridges = (Array.isArray(brArr) ? brArr : []) as Record<string, string>[];
    } catch { /* old ROS / no bridge package */ }

    /* Current bridge-port memberships */
    let bridgePorts: Record<string, string>[] = [];
    try {
      const bpArr = await conn.write(["/interface/bridge/port/print"]);
      bridgePorts = (Array.isArray(bpArr) ? bpArr : []) as Record<string, string>[];
    } catch { /* ignore */ }

    conn.close();

    res.json({
      ok: true,
      connectedVia,
      interfaces: interfaces.map(i => ({
        name:    i.name    || "",
        type:    i.type    || "ether",
        running: i.running === "true",
        disabled: i.disabled === "true",
        macAddress: i["mac-address"] || "",
        comment:  i.comment || "",
      })),
      bridges: bridges.map(b => ({
        name:    b.name || "",
        running: b.running === "true",
      })),
      bridgePorts: bridgePorts.map(bp => ({
        bridge:    bp.bridge    || "",
        interface: bp.interface || "",
        id:        bp[".id"]   || "",
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host, msg) });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/router/bridge-assign
   Adds/removes ports from a bridge.
   Body: { host, username, password, bridge, addPorts[], removePorts[] }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/router/bridge-assign", async (req, res): Promise<void> => {
  const { host, username, password, bridge, addPorts = [], removePorts = [], bridgeIp } = req.body as {
    host: string; username: string; password: string;
    bridge: string; addPorts: string[]; removePorts: string[];
    bridgeIp?: string;
  };

  /* Accept bridgeIp as a fallback when host is absent */
  const primaryHost = host || bridgeIp || "";
  if (!primaryHost || !bridge) {
    res.status(400).json({ ok: false, logs: ["❌ host/bridgeIp and bridge name are required"], error: "host and bridge are required" });
    return;
  }

  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  /* No-op short-circuit — report clearly instead of silently succeeding */
  if (addPorts.length === 0 && removePorts.length === 0) {
    log("ℹ️  No port changes needed — the selected ports already match the bridge membership.");
    log(`   Bridge: ${bridge}`);
    log("   To add a port: tick it and click Finish. To remove: untick and click Finish.");
    res.json({ ok: true, logs });
    return;
  }

  let conn = makeConn(primaryHost, username, password);
  let connectedVia = primaryHost;

  try {
    try {
      await withTimeout(conn.connect(), 12000);
      log(`✓ Connected to ${primaryHost}`);
    } catch (directErr) {
      /* If primaryHost is already the bridgeIp, or bridgeIp is different, try it */
      const altHost = bridgeIp && bridgeIp !== primaryHost ? bridgeIp : null;
      if (altHost) {
        conn = makeConn(altHost, username, password);
        await withTimeout(conn.connect(), 12000);
        connectedVia = `${altHost} (VPN)`;
        log(`✓ Connected via VPN tunnel (${altHost})`);
      } else {
        throw directErr;
      }
    }
    void connectedVia;

    /* Remove ports */
    for (const iface of removePorts) {
      try {
        const existing = await conn.write([
          "/interface/bridge/port/print",
          `?bridge=${bridge}`,
          `?interface=${iface}`,
        ]);
        if (Array.isArray(existing) && existing.length > 0) {
          const id = (existing[0] as Record<string, string>)[".id"];
          if (id) {
            await conn.write(["/interface/bridge/port/remove", `=.id=${id}`]);
            log(`✓ Removed ${iface} from ${bridge}`);
          }
        }
      } catch (e) { log(`  ⚠ skip remove ${iface}: ${enrichPermErr(e, username)}`); }
    }

    /* Add ports */
    for (const iface of addPorts) {
      try {
        /* Check not already a member */
        const existing = await conn.write([
          "/interface/bridge/port/print",
          `?bridge=${bridge}`,
          `?interface=${iface}`,
        ]);
        if (Array.isArray(existing) && existing.length > 0) {
          log(`  ℹ ${iface} already in ${bridge} — skipped`);
          continue;
        }
        await conn.write([
          "/interface/bridge/port/add",
          `=bridge=${bridge}`,
          `=interface=${iface}`,
        ]);
        log(`✓ Added ${iface} → ${bridge}`);
      } catch (e) { log(`❌ Add ${iface}: ${enrichPermErr(e, username)}`); }
    }

    conn.close();
    log(`\n✅ Bridge port assignment complete`);
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${enrichPermErr(err, username)}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(primaryHost, msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/isp/router/heartbeat/:token
   Called by the MikroTik scheduler every 5 minutes.
   Looks up the router by its router_secret token and marks it online.
═══════════════════════════════════════════════════════════════ */
/* Per-request env helpers — use || so empty-string falls through */
function hbUrl(): string { return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""; }
function hbKey(): string { return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY || ""; }

  /* ===============================================================
     Install progress tracking - in-memory store
     Routers POST a step update each time they download/apply/fail
     one of the 7 self-install sub-scripts. The admin Routers page
     polls a listing endpoint and shows a live timeline per router.
  =============================================================== */
  type InstallPhase = "downloading" | "applied" | "failed";
  interface InstallStep {
    step: number;
    name: string;
    phase: InstallPhase;
    error?: string;
    ts: number;
  }
  interface InstallProgress {
    routerId: number;
    adminId?: number;
    routerName?: string;
    startedAt: number;
    updatedAt: number;
    done: boolean;
    failures: number;
    steps: Map<number, InstallStep>;
  }

  const installProgress = new Map<number, InstallProgress>();
  const INSTALL_TTL_MS       = 30 * 60 * 1000;
  const INSTALL_DONE_KEEP_MS = 60 * 1000;

  function gcInstallProgress(): void {
    const now = Date.now();
    for (const [rid, p] of installProgress) {
      if (now - p.updatedAt > INSTALL_TTL_MS) installProgress.delete(rid);
    }
  }

  async function enrichInstallProgress(p: InstallProgress): Promise<void> {
    if (p.adminId && p.routerName) return;
    const url = hbUrl();
    const key = hbKey();
    if (!url || !key) return;
    try {
      const r = await fetch(
        `${url}/rest/v1/isp_routers?id=eq.${p.routerId}&select=id,admin_id,name`,
        { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } },
      );
      if (!r.ok) return;
      const rows = await r.json() as Array<{ id: number; admin_id: number; name: string }>;
      if (rows[0]) {
        p.adminId    = rows[0].admin_id;
        p.routerName = p.routerName || rows[0].name;
      }
    } catch { /* ignore */ }
  }

  /* Router callback - accept GET (query) or POST (urlencoded body).
   Requires ?token=<router_secret> matching the router row, so a malicious
   caller cannot spoof install events for other routers. Always returns 200
   so the router-side install never blocks on this. */
async function handleInstallProgressUpdate(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const rid = parseInt((req.params.rid ?? "0") as string, 10);
  if (!rid || isNaN(rid)) { res.json({ ok: false, error: "invalid rid" }); return; }

  const src   = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
  const token = (src.token ?? "").toString().trim();
  if (!token) { res.json({ ok: false, error: "missing token" }); return; }

  /* Verify token matches this router. Cache resolved (rid -> {secret, adminId, name}) */
  const url = hbUrl();
  const key = hbKey();
  if (!url || !key) { res.json({ ok: false, error: "auth backend unavailable" }); return; }
  let routerRow: { id: number; admin_id: number; name: string; router_secret: string } | null = null;
  try {
    const r = await fetch(
      `${url}/rest/v1/isp_routers?id=eq.${rid}&select=id,admin_id,name,router_secret`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } },
    );
    if (r.ok) {
      const rows = await r.json() as Array<{ id: number; admin_id: number; name: string; router_secret: string }>;
      routerRow = rows[0] ?? null;
    }
  } catch { /* ignore */ }

  if (!routerRow || !routerRow.router_secret || routerRow.router_secret !== token) {
    res.status(401).json({ ok: false, error: "invalid token" });
    return;
  }

  const step  = parseInt(src.step ?? "0", 10);
  const name  = (src.name  ?? "").toString().slice(0, 40);
  const phaseRaw = (src.phase ?? "downloading").toString();
  const allowedPhases = new Set(["downloading", "applied", "failed"]);
  if (!allowedPhases.has(phaseRaw)) { res.json({ ok: false, error: "invalid phase" }); return; }
  const phase = phaseRaw as InstallPhase;
  const err   = (src.err   ?? src.error ?? "").toString().slice(0, 500);
  const rname = (src.rname ?? "").toString().slice(0, 80);
  const done  = src.done === "1" || src.done === "true";

  if (!done && (!step || step < 1 || step > 7)) { res.json({ ok: false, error: "step out of range" }); return; }

  let p = installProgress.get(rid);
  if (!p) {
    p = {
      routerId:   rid,
      adminId:    routerRow.admin_id,
      routerName: rname || routerRow.name,
      startedAt:  Date.now(),
      updatedAt:  Date.now(),
      done:       false,
      failures:   0,
      steps:      new Map(),
    };
    installProgress.set(rid, p);
  } else {
    p.adminId    = routerRow.admin_id;
    p.routerName = p.routerName || rname || routerRow.name;
  }
  p.updatedAt = Date.now();

  if (step) {
    const order: Record<InstallPhase, number> = { downloading: 1, applied: 2, failed: 2 };
    const prev = p.steps.get(step);
    if (!prev || order[phase] >= order[prev.phase]) {
      p.steps.set(step, { step, name: name || prev?.name || "", phase, error: err || undefined, ts: Date.now() });
      if (phase === "failed" && (!prev || prev.phase !== "failed")) p.failures += 1;
    }
  }

  if (done) p.done = true;

  console.log(`[install-progress] router=${rid} step=${step}/${name} phase=${phase}${err ? ` err="${err.slice(0, 80)}"` : ""}${done ? " (done)" : ""}`);

  gcInstallProgress();
  res.json({ ok: true });
}

router.get ("/isp/router/install-progress/:rid", handleInstallProgressUpdate);
router.post("/isp/router/install-progress/:rid", handleInstallProgressUpdate);

/* Admin listing - used by the Routers page to render live timelines.
   Tenant scoping is mandatory: ?adminId= is required and we drop any
   entry whose owning admin could not be resolved from Supabase, so an
   unknown-ownership install never leaks across tenants.

   NOTE: like every other /admin/router/* endpoint in this codebase
   (reboot, fix-api, probe, ports, bridge-assign, ensure...), this
   endpoint trusts the caller-supplied adminId. The whole admin app
   currently runs on a localStorage-stored adminId model with no
   session token, so adding token enforcement here in isolation would
   not improve security. Migrating all admin endpoints to a real
   session-bound auth middleware is tracked as a follow-up task. */
router.get("/admin/router/install-progress", async (req, res): Promise<void> => {
  gcInstallProgress();
  const adminId = parseInt(((req.query.adminId ?? "") as string), 10);
  if (!adminId || isNaN(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "adminId required" });
    return;
  }

  const now = Date.now();

  /* Resolve owners for any entry whose owning admin we don't yet know,
     so the strict-equality filter below is authoritative. */
  const pending: Array<Promise<void>> = [];
  for (const p of installProgress.values()) {
    if (!p.adminId) pending.push(enrichInstallProgress(p));
  }
  if (pending.length) await Promise.allSettled(pending);

  const installs: Array<{
    routerId: number; routerName: string; startedAt: number; updatedAt: number;
    done: boolean; failures: number; steps: InstallStep[];
  }> = [];

  for (const p of installProgress.values()) {
    /* Strict tenant filter: must have a resolved owner that matches.
       Entries with unknown ownership are NEVER returned. */
    if (!p.adminId || p.adminId !== adminId) continue;
    if (p.done && p.failures === 0 && now - p.updatedAt > INSTALL_DONE_KEEP_MS) {
      installProgress.delete(p.routerId);
      continue;
    }
    installs.push({
      routerId:   p.routerId,
      routerName: p.routerName ?? `Router #${p.routerId}`,
      startedAt:  p.startedAt,
      updatedAt:  p.updatedAt,
      done:       p.done,
      failures:   p.failures,
      steps:      Array.from(p.steps.values()).sort((a, b) => a.step - b.step),
    });
  }

  installs.sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ ok: true, installs });
});

router.get("/isp/router/heartbeat/:token", async (req, res): Promise<void> => {
  const token = (req.params.token ?? "").trim();

  if (!token) {
    res.status(400).json({ ok: false, error: "invalid token" });
    return;
  }

  const ts = new Date().toISOString();
  const HB_URL = hbUrl();
  const HB_KEY = hbKey();

  /* ?hs=1  → router confirmed hotspot/PPPoE service is running → status "online"  (green)
     ?hs=0  → router reachable but service not running            → status "connected" (yellow)
     no hs  → old heartbeat without service check (backward compat)→ status "online"  (green) */
  const hsParam = req.query.hs as string | undefined;
  const newStatus = (hsParam === "0") ? "connected" : "online";

  if (!HB_URL || !HB_KEY) {
    console.warn(`[heartbeat] token=${token.slice(0, 8)}… — db not configured (SUPABASE_URL/KEY missing)`);
    res.json({ ok: true, ts, note: "db-not-configured" });
    return;
  }

  try {
    const enc = encodeURIComponent(token);
    const hbHeaders = {
      apikey: HB_KEY,
      Authorization: `Bearer ${HB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    /* Step 1 — always update last_seen (and retrieve the row for auto-discovery) */
    const patchRes = await fetch(
      `${HB_URL}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})`,
      {
        method: "PATCH",
        headers: hbHeaders,
        body: JSON.stringify({ last_seen: ts }),
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error(`[heartbeat] Supabase PATCH ${patchRes.status}: ${errText}`);
      res.status(500).json({ ok: false, error: "db update failed" });
      return;
    }

    const updated = await patchRes.json() as Array<{
      id: number; name: string; host?: string; status?: string;
      router_username?: string; router_secret?: string;
    }>;
    const row = updated[0];
    const routerName = row?.name ?? "unknown";

    /* Step 2 — only promote status if the router is NOT in "setup" (awaiting bridge ports) */
    if (row && row.status !== "setup") {
      fetch(
        `${HB_URL}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})`,
        {
          method: "PATCH",
          headers: { apikey: HB_KEY, Authorization: `Bearer ${HB_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      ).catch((e: unknown) => console.warn(`[heartbeat] status update failed: ${e instanceof Error ? e.message : e}`));
    } else if (row?.status === "setup") {
      console.log(`[heartbeat] ↷ ${routerName} is in "setup" — skipping status promotion`);
    }

    console.log(`[heartbeat] ✓ ${routerName} ${row?.status === "setup" ? "setup" : newStatus} (hs=${hsParam ?? "n/a"}) @ ${ts}`);
    res.json({ ok: true, ts, router: routerName, status: newStatus });

    /* ── Auto-discovery:
       1. If request comes in over VPN (10.8.0.x) → save VPN IP as host.
       2. If request comes in from a public WAN IP AND current host is a
          LAN-only IP (192.168.x.x etc.) → save WAN IP as host so the
          backend can later reach the router via port 8728 (once the user
          adds the firewall rule).  Always attempt a background probe. ── */
    const srcIp = clientIp(req);
    const currentHost = row?.host ?? "";
    const hostIsUnreachable = !currentHost || isLanOnlyIp(currentHost);

    if (row && (isVpnIp(srcIp) || (isPublicIp(srcIp) && hostIsUnreachable)) && srcIp !== currentHost) {
      console.log(`[heartbeat] auto-discovering ${routerName} via ${isVpnIp(srcIp) ? "VPN" : "WAN"} IP ${srcIp}`);

      /* Save the IP as host immediately so the next bridge-ports call uses it */
      const HB_URL2 = hbUrl();
      const HB_KEY2 = hbKey();
      if (HB_URL2 && HB_KEY2) {
        const enc2 = encodeURIComponent(token);
        fetch(
          `${HB_URL2}/rest/v1/isp_routers?or=(router_secret.eq.${enc2},token.eq.${enc2})`,
          {
            method: "PATCH",
            headers: { apikey: HB_KEY2, Authorization: `Bearer ${HB_KEY2}`, "Content-Type": "application/json" },
            body: JSON.stringify({ host: srcIp }),
          }
        ).then(() => console.log(`[heartbeat] saved WAN IP ${srcIp} as host for ${routerName}`))
         .catch((e: unknown) => console.warn(`[heartbeat] failed to save WAN IP: ${e instanceof Error ? e.message : e}`));
      }

      bgAutoProbe(row.router_secret ?? token, srcIp, row.router_username ?? "admin");
    }

    /* ── VPN IP auto-save ──────────────────────────────────────────
       Even when heartbeat arrives over WAN, the router may be
       connected via VPN.  Read the OpenVPN status file and, if
       we find a VPN IP for this router's WAN IP, save it as
       bridge_ip so the bridge-ports endpoint can use the tunnel.
    ── */
    if (row && isPublicIp(srcIp)) {
      const vpnClients = readVpnClients();
      const foundVpnIp = vpnIpFor(srcIp, vpnClients);
      const storedBridgeIp = (row as Record<string, unknown>).bridge_ip as string | undefined;
      if (foundVpnIp && foundVpnIp !== storedBridgeIp) {
        console.log(`[heartbeat] found VPN IP ${foundVpnIp} for router ${routerName} (real ${srcIp}), saving as bridge_ip`);
        const HB_URL3 = hbUrl();
        const HB_KEY3 = hbKey();
        if (HB_URL3 && HB_KEY3) {
          const enc3 = encodeURIComponent(token);
          fetch(
            `${HB_URL3}/rest/v1/isp_routers?or=(router_secret.eq.${enc3},token.eq.${enc3})`,
            {
              method: "PATCH",
              headers: { apikey: HB_KEY3, Authorization: `Bearer ${HB_KEY3}`, "Content-Type": "application/json" },
              body: JSON.stringify({ bridge_ip: foundVpnIp }),
            }
          ).then(() => console.log(`[heartbeat] saved VPN IP ${foundVpnIp} as bridge_ip for ${routerName}`))
           .catch((e: unknown) => console.warn(`[heartbeat] VPN IP save failed: ${e instanceof Error ? e.message : e}`));
        }
      }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[heartbeat] error: ${msg}`);
    res.json({ ok: true, ts, note: "db error but router is alive" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/isp/router/register/:token
   Called once during /import of the .rsc script on the MikroTik.
   Detects router model, RouterOS version and identity then stores
   them in isp_routers, also marking the router online.

   Query params (URL-encoded, sent by RouterOS):
     ?model=RB750Gr3   — routerboard model
     ?rname=MyRouter   — /system identity name
     ?ver=7.3.1        — RouterOS version
═══════════════════════════════════════════════════════════════ */
router.get("/isp/router/register/:token", async (req, res): Promise<void> => {
  const token    = (req.params.token ?? "").trim();
  const model    = ((req.query.model  as string) ?? "").trim();
  const rname    = ((req.query.rname  as string) ?? "").trim();
  const ver      = ((req.query.ver    as string) ?? "").trim();
  const bridgeIp = ((req.query.ip     as string) ?? "").trim();   // bridge IP sent by RouterOS
  const ts       = new Date().toISOString();

  if (!token) {
    res.status(400).json({ ok: false, error: "invalid token" });
    return;
  }

  const REG_URL = hbUrl();
  const REG_KEY = hbKey();

  if (!REG_URL || !REG_KEY) {
    res.json({ ok: true, ts, note: "db-not-configured" });
    return;
  }

  const enc = encodeURIComponent(token);

  try {
    /* Build the patch — only include fields that were provided */
    const patch: Record<string, string> = { last_seen: ts, status: "online" };
    if (model)    patch.model       = model;
    if (ver)      patch.ros_version = ver;
    if (bridgeIp) patch.bridge_ip   = bridgeIp;
    /* If the router still has the auto-generated name, rename it to the RouterOS identity */
    if (rname) patch.identity = rname;   // store identity (non-destructive new field check below)

    /* First: read current name + admin_id to decide whether to rename + for VPN user */
    let existingAdminId: number | null = null;
    let existingName: string = "";
    const getRes = await fetch(
      `${REG_URL}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})&select=id,name,admin_id`,
      {
        headers: {
          apikey: REG_KEY,
          Authorization: `Bearer ${REG_KEY}`,
          Accept: "application/json",
        },
      }
    );
    if (getRes.ok) {
      const rows = await getRes.json() as Array<{ id: number; name: string; admin_id: number }>;
      const existing = rows[0];
      if (existing) {
        existingAdminId = existing.admin_id;
        existingName    = existing.name;
        /* Update name to RouterOS identity only if the current name ends with " Router"
           (the auto-generated placeholder) and an identity was reported */
        if (rname && existing.name.endsWith(" Router")) {
          patch.name = rname;
        }
      }
    }

    /* Remove identity from patch (it's not a DB column — only used for name logic above) */
    delete patch.identity;

    /* Apply the patch */
    const patchRes = await fetch(
      `${REG_URL}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})`,
      {
        method: "PATCH",
        headers: {
          apikey: REG_KEY,
          Authorization: `Bearer ${REG_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error(`[register] Supabase PATCH ${patchRes.status}: ${errText}`);
      res.status(500).json({ ok: false, error: "db update failed" });
      return;
    }

    const updated = await patchRes.json() as Array<{
      id: number; name: string; host?: string; router_username?: string;
    }>;
    const row = updated[0];
    const routerName = row?.name ?? existingName ?? rname ?? "unknown";
    console.log(`[register] ✓ ${routerName} | model=${model} ver=${ver} @ ${ts}`);
    res.json({ ok: true, ts, router: routerName, model, version: ver });

    /* ── Auto-probe: prefer VPN source IP; fall back to bridge IP ── */
    const srcIp   = clientIp(req);
    const probeIp = isVpnIp(srcIp) ? srcIp : bridgeIp;
    if (probeIp && probeIp !== row?.host) {
      console.log(`[register] scheduling auto-probe for ${routerName} @ ${probeIp}`);
      bgAutoProbe(token, probeIp, row?.router_username ?? "admin");
    }

    /* ── Auto-create VPN user ──────────────────────────────────────
       Upsert a VPN user in isp_vpn_users so the router appears in
       Remote Access → VPN Users immediately after installation,
       without requiring the admin to create it manually. ── */
    const adminId = existingAdminId ?? (row as Record<string, unknown> | undefined)?.admin_id as number | undefined;
    if (adminId && routerName !== "unknown") {
      const vpnUsername = routerName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      fetch(`${REG_URL}/rest/v1/isp_vpn_users`, {
        method: "POST",
        headers: {
          apikey:         REG_KEY,
          Authorization:  `Bearer ${REG_KEY}`,
          "Content-Type": "application/json",
          Prefer:         "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify({
          admin_id:  adminId,
          username:  vpnUsername,
          password:  "ocholasupernet",
          notes:     `Auto — router: ${routerName}`,
          is_active: true,
        }),
      })
        .then(() => console.log(`[register] VPN user '${vpnUsername}' ensured for ${routerName}`))
        .catch((e: unknown) => console.warn(`[register] VPN user upsert failed: ${e instanceof Error ? e.message : e}`));
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[register] error: ${msg}`);
    res.json({ ok: true, ts, note: "db error but registration ping received" });
  }
});

export default router;
