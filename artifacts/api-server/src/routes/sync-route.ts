import { Router, type IRouter } from "express";
import { RouterOSAPI } from "node-routeros";

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
  return new RouterOSAPI({ host, port: 8728, user: username || "admin", password: password || "", timeout: 10, keepalive: false });
}

/* ─── Speed → MikroTik rate-limit string ─── */
function toRateLimit(down: number, up: number, unit: string = "Mbps"): string {
  const suffix = unit === "Kbps" ? "k" : unit === "Gbps" ? "G" : "M";
  return `${up}${suffix}/${down}${suffix}`;
}

/* ─── Validity → MikroTik session-timeout string ─── */
function toSessionTimeout(value: number, unit: string): string {
  const u = (unit || "Days").toLowerCase();
  if (u.startsWith("min"))   return `${value}m`;
  if (u.startsWith("hr"))    return `${value}h`;
  if (u.startsWith("day"))   return `${value}d`;
  if (u.startsWith("week"))  return `${value * 7}d`;
  if (u.startsWith("month")) return `${value * 30}d`;
  return `${value}d`;
}

/* ─── Connection error message ─── */
function connErr(host: string, msg: string): string {
  const isConnErr = /timed out|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH/i.test(msg);
  return isConnErr
    ? `Cannot reach router at ${host}:8728. Check: 1) RouterOS API enabled (IP → Services → api), 2) Port 8728 not blocked by firewall, 3) Router reachable from server.`
    : msg;
}

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
  const { host, username, password, plans } = req.body as {
    host: string; username: string; password: string;
    plans: Array<{
      id: number; name: string; type: string;
      speed_down: number; speed_up: number;
      speed_down_unit: string; speed_up_unit: string;
      validity: number; validity_unit: string;
      shared_users: number;
    }>;
  };

  if (!host || !plans?.length) { res.status(400).json({ ok: false, error: "host and plans are required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  log(`▶ Connecting to ${host}:8728 as '${username || "admin"}'...`);

  const conn = makeConn(host, username, password);
  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected — pushing ${plans.length} plan profile(s)\n`);

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
            name:        profileName,
            "rate-limit": rateLimit,
            comment:     `OcholaNet plan #${plan.id}`,
          });
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
          skipped++;
        }
      } else if (plan.type === "hotspot" || plan.type === "trials") {
        /* ── Hotspot user profile ── */
        log(`▶ Hotspot profile: ${profileName} | rate-limit: ${rateLimit} | session: ${sessionTime} | shared: ${plan.shared_users}`);
        try {
          const action = await upsertByFilter(conn, "/ip/hotspot/user/profile", "name", profileName, {
            name:             profileName,
            "rate-limit":     rateLimit,
            "session-timeout": sessionTime,
            "shared-users":   String(plan.shared_users || 1),
            comment:          `OcholaNet plan #${plan.id}`,
          });
          log(`  ✓ ${action}`);
          action === "created" ? created++ : updated++;
        } catch (e) {
          log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
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
    res.json({ ok: false, error: connErr(host, msg), logs });
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
  const { host, username, password, users } = req.body as {
    host: string; username: string; password: string;
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

  if (!host || !users?.length) { res.status(400).json({ ok: false, error: "host and users are required" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  log(`▶ Connecting to ${host}:8728 as '${username || "admin"}'...`);

  const conn = makeConn(host, username, password);
  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected — pushing ${users.length} user(s)\n`);

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
    res.json({ ok: false, error: connErr(host, msg), logs });
  }
});

export default router;
