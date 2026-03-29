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
  const { host, username, password, bridgeIp } = req.body as {
    host: string; username: string; password: string; bridgeIp?: string;
  };
  if (!host) { res.status(400).json({ ok: false, error: "host is required" }); return; }

  let conn = makeConn(host, username, password);
  let connectedVia = host;
  try {
    try {
      await withTimeout(conn.connect(), 12000);
    } catch (directErr) {
      if (bridgeIp) {
        conn = makeConn(bridgeIp, username, password);
        await withTimeout(conn.connect(), 12000);
        connectedVia = `${bridgeIp} (VPN)`;
      } else {
        throw directErr;
      }
    }

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
  const { host, username, password, bridge, addPorts = [], removePorts = [] } = req.body as {
    host: string; username: string; password: string;
    bridge: string; addPorts: string[]; removePorts: string[];
  };
  if (!host || !bridge) { res.status(400).json({ ok: false, error: "host and bridge are required" }); return; }

  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const conn = makeConn(host, username, password);

  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected to ${host}`);

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
      } catch (e) { log(`  (skip remove ${iface}: ${e})`); }
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
          log(`  ${iface} already in ${bridge} — skipped`);
          continue;
        }
        await conn.write([
          "/interface/bridge/port/add",
          `=bridge=${bridge}`,
          `=interface=${iface}`,
        ]);
        log(`✓ Added ${iface} → ${bridge}`);
      } catch (e) { log(`❌ Add ${iface}: ${e}`); }
    }

    conn.close();
    log(`\n✅ Bridge port assignment complete`);
    res.json({ ok: true, logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }
    res.json({ ok: false, error: connErr(host, msg), logs });
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/isp/router/heartbeat/:token
   Called by the MikroTik scheduler every 5 minutes.
   Looks up the router by its router_secret token and marks it online.
═══════════════════════════════════════════════════════════════ */
const HB_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const HB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";

router.get("/isp/router/heartbeat/:token", async (req, res): Promise<void> => {
  const token = (req.params.token ?? "").trim();

  if (!token) {
    res.status(400).json({ ok: false, error: "invalid token" });
    return;
  }

  const ts = new Date().toISOString();

  /* ?hs=1  → router confirmed hotspot/PPPoE service is running → status "online"  (green)
     ?hs=0  → router reachable but service not running            → status "connected" (yellow)
     no hs  → old heartbeat without service check (backward compat)→ status "online"  (green) */
  const hsParam = req.query.hs as string | undefined;
  const newStatus = (hsParam === "0") ? "connected" : "online";

  if (!HB_URL || !HB_KEY) {
    console.log(`[heartbeat] token=${token.slice(0, 8)}… — db not configured, returning 200`);
    res.json({ ok: true, ts });
    return;
  }

  try {
    const patchRes = await fetch(
      `${HB_URL}/rest/v1/isp_routers?router_secret=eq.${encodeURIComponent(token)}`,
      {
        method: "PATCH",
        headers: {
          apikey: HB_KEY,
          Authorization: `Bearer ${HB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: newStatus, last_seen: ts }),
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error(`[heartbeat] Supabase PATCH ${patchRes.status}: ${errText}`);
      res.status(500).json({ ok: false, error: "db update failed" });
      return;
    }

    const updated = await patchRes.json() as Array<{ id: number; name: string }>;
    const routerName = updated[0]?.name ?? "unknown";
    console.log(`[heartbeat] ✓ ${routerName} ${newStatus} (hs=${hsParam ?? "n/a"}) @ ${ts}`);
    res.json({ ok: true, ts, router: routerName, status: newStatus });

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
  const token  = (req.params.token ?? "").trim();
  const model  = ((req.query.model  as string) ?? "").trim();
  const rname  = ((req.query.rname  as string) ?? "").trim();
  const ver    = ((req.query.ver    as string) ?? "").trim();
  const ts     = new Date().toISOString();

  if (!token) {
    res.status(400).json({ ok: false, error: "invalid token" });
    return;
  }

  if (!HB_URL || !HB_KEY) {
    res.json({ ok: true, ts, note: "db not configured" });
    return;
  }

  try {
    /* Build the patch — only include fields that were provided */
    const patch: Record<string, string> = { last_seen: ts, status: "online" };
    if (model) patch.model       = model;
    if (ver)   patch.ros_version = ver;
    /* If the router still has the auto-generated name, rename it to the RouterOS identity */
    if (rname) patch.identity = rname;   // store identity (non-destructive new field check below)

    /* First: read current name to decide whether to rename */
    const getRes = await fetch(
      `${HB_URL}/rest/v1/isp_routers?router_secret=eq.${encodeURIComponent(token)}&select=id,name`,
      {
        headers: {
          apikey: HB_KEY,
          Authorization: `Bearer ${HB_KEY}`,
          Accept: "application/json",
        },
      }
    );
    if (getRes.ok) {
      const rows = await getRes.json() as Array<{ id: number; name: string }>;
      const existing = rows[0];
      /* Update name to RouterOS identity only if the current name ends with " Router"
         (the auto-generated placeholder) and an identity was reported */
      if (existing && rname && existing.name.endsWith(" Router")) {
        patch.name = rname;
      }
    }

    /* Remove identity from patch (it's not a DB column — only used for name logic above) */
    delete patch.identity;

    /* Apply the patch */
    const patchRes = await fetch(
      `${HB_URL}/rest/v1/isp_routers?router_secret=eq.${encodeURIComponent(token)}`,
      {
        method: "PATCH",
        headers: {
          apikey: HB_KEY,
          Authorization: `Bearer ${HB_KEY}`,
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

    const updated = await patchRes.json() as Array<{ id: number; name: string }>;
    const routerName = updated[0]?.name ?? rname ?? "unknown";
    console.log(`[register] ✓ ${routerName} | model=${model} ver=${ver} @ ${ts}`);
    res.json({ ok: true, ts, router: routerName, model, version: ver });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[register] error: ${msg}`);
    res.json({ ok: true, ts, note: "db error but registration ping received" });
  }
});

export default router;
