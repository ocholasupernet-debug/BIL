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

/* ─── Find + remove an entry by name field ─── */
async function removeByName(conn: RouterOSAPI, path: string, name: string) {
  try {
    const list = await conn.write([`${path}/print`, `?name=${name}`]);
    if (Array.isArray(list) && list.length > 0) {
      const id = (list[0] as Record<string, string>)[".id"];
      if (id) await conn.write([`${path}/remove`, `=.id=${id}`]);
    }
  } catch { /* ignore */ }
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

/* ═══════════════════════════════════════════════════════════════
   POST /api/admin/sync
   Body: {
     host, username, password,
     cfg: { routerName, hotspotIp, dnsName, radiusIp, radiusSecret,
             bridgeInterface, poolStart, poolEnd, profileName }
   }
═══════════════════════════════════════════════════════════════ */
router.post("/admin/sync", async (req, res): Promise<void> => {
  const { host, username, password, cfg } = req.body as {
    host: string;
    username: string;
    password: string;
    cfg: {
      routerName: string;
      hotspotIp: string;
      dnsName: string;
      radiusIp: string;
      radiusSecret: string;
      bridgeInterface: string;
      poolStart: string;
      poolEnd: string;
      profileName: string;
    };
  };

  if (!host || !cfg) {
    res.status(400).json({ ok: false, error: "host and cfg are required" });
    return;
  }

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  log(`▶ Connecting to ${host}:8728 as '${username || "admin"}'...`);

  const conn = new RouterOSAPI({
    host,
    port: 8728,
    user: username || "admin",
    password: password || "",
    timeout: 10,
    keepalive: false,
  });

  try {
    await withTimeout(conn.connect(), 12000);
    log(`✓ Connected`);

    /* ─ 1. System identity ─ */
    log(`Setting identity → OcholaNet-${cfg.routerName}`);
    await conn.write(["/system/identity/set", `=name=OcholaNet-${cfg.routerName}`]);
    log(`✓ Identity set`);

    /* ─ 2. DNS ─ */
    log(`Configuring DNS → 8.8.8.8, 8.8.4.4`);
    await conn.write(["/ip/dns/set", "=servers=8.8.8.8,8.8.4.4", "=allow-remote-requests=yes"]);
    log(`✓ DNS configured`);

    /* ─ 3. Hotspot profile (upsert by name) ─ */
    log(`Hotspot profile '${cfg.profileName}'...`);
    const profAction = await upsertByFilter(conn, "/ip/hotspot/profile", "name", cfg.profileName, {
      name:              cfg.profileName,
      "hotspot-address": cfg.hotspotIp,
      "dns-name":        cfg.dnsName,
      "login-by":        "http-chap,http-pap",
      "use-radius":      "yes",
      "html-directory":  "flash/hotspot",
    });
    log(`✓ Profile ${profAction}`);

    /* ─ 4. IP Pool ─ */
    log(`IP pool hspool → ${cfg.poolStart}-${cfg.poolEnd}`);
    const poolAction = await upsertByFilter(conn, "/ip/pool", "name", "hspool", {
      name:   "hspool",
      ranges: `${cfg.poolStart}-${cfg.poolEnd}`,
    });
    log(`✓ Pool ${poolAction}`);

    /* ─ 5. Hotspot instance ─ */
    log(`Hotspot on interface '${cfg.bridgeInterface}'...`);
    const hsAction = await upsertByFilter(conn, "/ip/hotspot", "name", "hotspot1", {
      name:           "hotspot1",
      interface:      cfg.bridgeInterface,
      profile:        cfg.profileName,
      "address-pool": "hspool",
      "idle-timeout": "none",
    });
    log(`✓ Hotspot ${hsAction}`);

    /* ─ 6. RADIUS ─ */
    log(`RADIUS → ${cfg.radiusIp}:1812/1813`);
    const radAction = await upsertByFilter(conn, "/radius", "service", "hotspot", {
      service:               "hotspot",
      address:               cfg.radiusIp,
      secret:                cfg.radiusSecret,
      "authentication-port": "1812",
      "accounting-port":     "1813",
      timeout:               "3000ms",
    });
    log(`✓ RADIUS ${radAction}`);

    /* ─ 7. Firewall NAT redirect ─ */
    log(`NAT redirect rule...`);
    const natList = await conn.write(["/ip/firewall/nat/print", "?comment=OcholaNet - Hotspot redirect"]);
    if (Array.isArray(natList) && natList.length === 0) {
      await safeWrite(conn, [
        "/ip/firewall/nat/add",
        "=chain=dstnat",
        "=protocol=tcp",
        "=dst-port=80",
        "=action=redirect",
        "=to-ports=64872",
        "=hotspot=!auth",
        "=comment=OcholaNet - Hotspot redirect",
      ]);
      log(`✓ NAT rule added`);
    } else {
      log(`✓ NAT rule already present`);
    }

    /* ─ 8. Hotspot user profile default ─ */
    log(`Hotspot user profile...`);
    await safeWrite(conn, [
      "/ip/hotspot/user/profile/add",
      "=name=default",
      "=shared-users=1",
      "=keepalive-timeout=2m",
      "=idle-timeout=none",
    ]);
    log(`✓ User profile ready`);

    /* ─ 9. Log on router ─ */
    await conn.write(["/log/info", `=message=OcholaNet: Hotspot synced on ${cfg.routerName}`]);
    log(`\n✅ Sync complete — ${cfg.routerName} (${host})`);

    conn.close();
    res.json({ ok: true, logs });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ ${msg}`);
    try { conn.close(); } catch { /* ignore */ }

    const isConnErr = /timed out|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH/i.test(msg);
    res.json({
      ok: false,
      error: isConnErr
        ? `Cannot reach router at ${host}:8728. Check that: 1) RouterOS API service is enabled (IP → Services → api), 2) Port 8728 is not blocked by firewall, 3) The router is reachable from the server.`
        : msg,
      logs,
    });
  }
});

export default router;
