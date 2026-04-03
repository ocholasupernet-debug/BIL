import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { sbSelect, sbUpdate } from "../lib/supabase-client";
import { pingRouter } from "../lib/mikrotik";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* Read env per-call so changes after startup are picked up */
function sbUrl(): string {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function sbKey(): string {
  /* Prefer service key (bypasses RLS) → falls back to anon */
  return process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";
}

const CA_PATHS = [
  "/etc/openvpn/ca.crt",
  "/etc/openvpn/easy-rsa/pki/ca.crt",
];
const EASYRSA_DIR = "/etc/openvpn/easy-rsa";
const PKI_ISSUED  = `${EASYRSA_DIR}/pki/issued`;
const PKI_PRIVATE = `${EASYRSA_DIR}/pki/private`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* Generate a client certificate (nopass) using easy-rsa.
   No-ops if the cert already exists. Returns true on success. */
export function ensureClientCert(slug: string): boolean {
  const certPath = `${PKI_ISSUED}/${slug}.crt`;
  const keyPath  = `${PKI_PRIVATE}/${slug}.key`;
  if (existsSync(certPath) && existsSync(keyPath)) return true;
  if (!existsSync(`${EASYRSA_DIR}/easyrsa`)) return false;
  try {
    execSync(
      `cd ${EASYRSA_DIR} && ./easyrsa --batch build-client-full "${slug}" nopass`,
      { stdio: "pipe", timeout: 60_000 }
    );
    return existsSync(certPath) && existsSync(keyPath);
  } catch {
    return false;
  }
}

async function slugBySecret(secret: string): Promise<string | null> {
  const url = sbUrl();
  const key = sbKey();
  if (!url || !key || !secret) return null;
  const enc = encodeURIComponent(secret);
  try {
    /* Query by router_secret OR token — covers both column aliases */
    const res = await fetch(
      `${url}/rest/v1/isp_routers?or=(router_secret.eq.${enc},token.eq.${enc})&select=name&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) {
      console.error(`[vpn] slugBySecret DB error ${res.status}: ${await res.text()}`);
      return null;
    }
    const rows = (await res.json()) as { name: string }[];
    if (!rows.length) {
      console.error(`[vpn] slugBySecret: no router found for secret …${secret.slice(-6)}`);
    }
    return rows.length ? slugify(rows[0].name) : null;
  } catch (e) {
    console.error(`[vpn] slugBySecret error: ${e}`);
    return null;
  }
}

/* ── GET /api/vpn/ca.crt ── serves CA cert (public) */
router.get("/vpn/ca.crt", (_req, res): void => {
  const caPath = CA_PATHS.find(p => existsSync(p));
  if (!caPath) { res.status(404).send("# CA cert not found\n"); return; }
  res.set("Content-Type", "text/plain");
  res.set("Cache-Control", "no-cache");
  res.send(readFileSync(caPath, "utf-8"));
});

/* ── GET /api/vpn/client-cert/:secret/ca.crt
       GET /api/vpn/client-cert/:secret/client.crt
       GET /api/vpn/client-cert/:secret/client.key

   Protected by the per-router routerSecret embedded in the .rsc.
   Returns the CA cert, per-router TLS client cert, or private key. ── */
router.get("/vpn/client-cert/:secret/:file", async (req, res): Promise<void> => {
  const { secret, file } = req.params;

  const slug = await slugBySecret(secret);
  if (!slug) { res.status(404).send("# Router not found\n"); return; }

  if (file === "ca.crt") {
    const caPath = CA_PATHS.find(p => existsSync(p));
    if (!caPath) { res.status(404).send("# CA not found\n"); return; }
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-cache");
    res.send(readFileSync(caPath, "utf-8"));
    return;
  }

  if (file === "client.crt" || file === "client.key") {
    const ok = ensureClientCert(slug);
    if (!ok) {
      res.status(500).send("# Cert generation failed — easy-rsa may not be installed\n");
      return;
    }
    const filePath = file === "client.crt"
      ? `${PKI_ISSUED}/${slug}.crt`
      : `${PKI_PRIVATE}/${slug}.key`;
    if (!existsSync(filePath)) { res.status(404).send("# Cert file missing\n"); return; }
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-cache");
    res.send(readFileSync(filePath, "utf-8"));
    return;
  }

  res.status(400).send("# Unknown file. Use: ca.crt | client.crt | client.key\n");
});

/* ── GET /api/vpn/status ── */
router.get("/vpn/status", (_req, res): void => {
  const caExists = CA_PATHS.some(p => existsSync(p));
  res.json({ ca_cert_available: caExists, server_port: 1194, proto: "tcp" });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GET /api/vpn/ip-map
 *
 * Reads OpenVPN ipp.txt (all-time IP assignments) and status.log (currently
 * connected clients) from the VPS. Returns a map of client → VPN IP.
 * ══════════════════════════════════════════════════════════════════════════ */
const IPP_PATHS = [
  "/etc/openvpn/server/ipp.txt",
  "/etc/openvpn/ipp.txt",
  "/var/log/openvpn/ipp.txt",
];
const STATUS_PATHS = [
  "/run/openvpn/server.status",          /* systemd unit: --status /run/openvpn/server.status */
  "/run/openvpn/server.status.tmp",
  "/etc/openvpn/server/openvpn-status.log",
  "/var/log/openvpn/status.log",
  "/tmp/openvpn-status.log",
  "/etc/openvpn/openvpn-status.log",
];

function readIppFile(): Map<string, string> {
  const map = new Map<string, string>();
  const path = IPP_PATHS.find(p => existsSync(p));
  if (!path) return map;
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    for (const line of lines) {
      const [name, ip] = line.trim().split(",");
      if (name && ip && ip.startsWith("10.")) map.set(name.trim(), ip.trim());
    }
  } catch { /* ignore */ }
  return map;
}

function readStatusLog(): Map<string, { ip: string; realAddr: string; since: string }> {
  const map = new Map<string, { ip: string; realAddr: string; since: string }>();
  const path = STATUS_PATHS.find(p => existsSync(p));
  if (!path) return map;
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    let inRouting = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      /* ── v2 format: ROUTING_TABLE,10.8.0.x,clientname,realAddr,... ── */
      if (trimmed.startsWith("ROUTING_TABLE,")) {
        const parts = trimmed.split(",");
        /* parts[1] = VPN IP, parts[2] = client name, parts[3] = real addr */
        const ip   = parts[1]?.trim() ?? "";
        const name = parts[2]?.trim() ?? "";
        const real = parts[3]?.trim() ?? "";
        if (ip.startsWith("10.") && name) {
          map.set(name, { ip, realAddr: real, since: parts[5]?.trim() ?? "" });
        }
        continue;
      }

      /* ── v1 format: section-based ── */
      if (trimmed.startsWith("ROUTING TABLE") || trimmed.startsWith("HEADER,ROUTING TABLE")) {
        inRouting = true; continue;
      }
      if (trimmed.startsWith("GLOBAL STATS") || trimmed.startsWith("GLOBAL_STATS") || trimmed === "END") {
        inRouting = false; continue;
      }
      if (!inRouting) continue;
      if (trimmed.startsWith("HEADER") || trimmed.startsWith("Virtual")) continue;

      /* v1 routing row: 10.8.0.x,clientname,realAddr:port,lastRef */
      const parts = trimmed.split(",");
      if (parts.length >= 3 && parts[0]?.startsWith("10.")) {
        map.set(parts[1]?.trim() ?? "", {
          ip:       parts[0].trim(),
          realAddr: parts[2]?.trim() ?? "",
          since:    parts[3]?.trim() ?? "",
        });
      }
    }
  } catch { /* ignore */ }
  return map;
}

function readTunNeigh(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const out = execSync("ip neigh show dev tun0 2>/dev/null", { timeout: 3000 }).toString();
    /* 10.8.0.6 dev tun0 lladdr ... REACHABLE */
    for (const line of out.split("\n")) {
      const ip = line.split(" ")[0];
      if (ip?.startsWith("10.")) map.set(ip, ip);
    }
  } catch { /* tun0 may not exist in dev environment */ }
  return map;
}

router.get("/vpn/ip-map", async (_req: Request, res: Response): Promise<void> => {
  const ipp    = readIppFile();
  const status = readStatusLog();
  const neigh  = readTunNeigh();

  const clients: Record<string, { vpnIp: string; connected: boolean; realAddr?: string; since?: string }> = {};

  /* Merge: ipp.txt first, then status log overrides */
  for (const [name, ip] of ipp) {
    clients[name] = { vpnIp: ip, connected: false };
  }
  for (const [name, info] of status) {
    clients[name] = { vpnIp: info.ip, connected: true, realAddr: info.realAddr, since: info.since };
  }

  const connectedIps = new Set([...neigh.values(), ...[...status.values()].map(v => v.ip)]);

  /* Mark ipp entries as connected if their IP is reachable */
  for (const [name, entry] of Object.entries(clients)) {
    if (!entry.connected && connectedIps.has(entry.vpnIp)) {
      clients[name].connected = true;
    }
  }

  res.json({
    clients,
    ippPath:    IPP_PATHS.find(p => existsSync(p)) ?? null,
    statusPath: STATUS_PATHS.find(p => existsSync(p)) ?? null,
    total:      Object.keys(clients).length,
    connected:  Object.values(clients).filter(c => c.connected).length,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POST /api/vpn/auto-fix-ips
 *
 * Reads the VPN IP map, fuzzy-matches client names to router names in
 * Supabase, updates bridge_ip to the 10.8.0.x VPN IP, then pings each
 * updated router to verify the connection immediately.
 * ══════════════════════════════════════════════════════════════════════════ */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.]/g, "");
}

function bestMatch(routerName: string, clients: string[]): string | null {
  const rn = normalize(routerName);
  /* Exact */
  const exact = clients.find(c => normalize(c) === rn);
  if (exact) return exact;
  /* Router name contains client name */
  const contains = clients.find(c => rn.includes(normalize(c)) || normalize(c).includes(rn));
  if (contains) return contains;
  /* First token match */
  const firstToken = rn.split(/\d/)[0];
  if (firstToken.length > 2) {
    const partial = clients.find(c => normalize(c).startsWith(firstToken) || firstToken.startsWith(normalize(c).split(/\d/)[0]));
    if (partial) return partial;
  }
  return null;
}

router.post("/vpn/auto-fix-ips", async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.body?.adminId ?? req.query.adminId ?? "1";

    /* 1. Read VPN IP map */
    const ipp    = readIppFile();
    const status = readStatusLog();

    const clientMap = new Map<string, string>();
    for (const [name, ip] of ipp)      clientMap.set(name, ip);
    for (const [name, info] of status) clientMap.set(name, info.ip);

    if (clientMap.size === 0) {
      res.json({
        ok:       false,
        error:    "No VPN client IP data found on this server. Check that OpenVPN is running and ipp.txt exists.",
        searched: [...IPP_PATHS, ...STATUS_PATHS],
      });
      return;
    }

    /* 2. Load all routers */
    let routers: {
      id: number; name: string; host: string; bridge_ip: string | null;
      router_username: string; router_secret: string | null;
    }[] = [];
    try {
      routers = await sbSelect<{
        id: number; name: string; host: string; bridge_ip: string | null;
        router_username: string; router_secret: string | null;
      }>("isp_routers", `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,router_username,router_secret`);
    } catch (dbErr) {
      res.json({
        ok:    false,
        error: `Failed to load routers from database: ${(dbErr as Error).message}`,
      });
      return;
    }

    const clientNames = [...clientMap.keys()];
    const results: {
      routerId: number; routerName: string; matched: boolean;
      clientName?: string; oldIp?: string; newIp?: string;
      pingOk?: boolean; pingError?: string; identity?: string; uptime?: string;
    }[] = [];

    /* 3. For each router, find matching VPN client and update */
    await Promise.allSettled(
      routers.map(async (row) => {
        const match = bestMatch(row.name, clientNames);

        if (!match) {
          results.push({ routerId: row.id, routerName: row.name, matched: false });
          return;
        }

        const newIp = clientMap.get(match)!;
        const oldIp = row.bridge_ip || row.host;

        /* Update Supabase */
        await sbUpdate("isp_routers", `id=eq.${row.id}`, {
          bridge_ip:  newIp,
          host:       newIp,
          updated_at: new Date().toISOString(),
        });

        logger.info({ routerId: row.id, name: row.name, match, newIp }, "[vpn/auto-fix] IP updated");

        /* Immediately ping the router with the new IP */
        const creds = {
          host:             newIp,
          port:             8728,
          username:         row.router_username || "admin",
          password:         row.router_secret   || "",
          useSSL:           false,
          connectTimeoutMs: 8000,
          requestTimeoutMs: 8000,
        };

        try {
          const ping = await pingRouter(creds);
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status:      "online",
            last_seen:   ping.connectedAt,
            model:       ping.board    || undefined,
            ros_version: ping.version  || undefined,
            updated_at:  ping.connectedAt,
          });
          results.push({
            routerId: row.id, routerName: row.name, matched: true,
            clientName: match, oldIp, newIp,
            pingOk: true, identity: ping.identity, uptime: ping.uptime,
          });
        } catch (err) {
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status: "offline", updated_at: new Date().toISOString(),
          });
          results.push({
            routerId: row.id, routerName: row.name, matched: true,
            clientName: match, oldIp, newIp,
            pingOk: false, pingError: (err as Error).message,
          });
        }
      })
    );

    const updated   = results.filter(r => r.matched).length;
    const online    = results.filter(r => r.pingOk).length;
    const unmatched = results.filter(r => !r.matched).length;

    res.json({
      ok: true,
      summary: { total: routers.length, updated, online, unmatched },
      results,
      vpnClients: Object.fromEntries(clientMap),
    });
  } catch (err) {
    logger.error({ err }, "[vpn/auto-fix-ips] unhandled error");
    res.status(500).json({
      ok:    false,
      error: `Server error: ${(err as Error).message}`,
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * VPN USER MANAGEMENT
 * Users are stored in Supabase (isp_vpn_users table) and synced to
 * /etc/openvpn/users.db on the VPS for password verification.
 * ══════════════════════════════════════════════════════════════════════════ */

const USERS_DB   = "/etc/openvpn/users.db";
const AUTH_SCRIPT = "/etc/openvpn/check-auth.sh";

const AUTH_SCRIPT_CONTENT = `#!/bin/bash
# OpenVPN username/password verify script
CREDS_FILE="$1"
USERNAME=$(sed -n '1p' "\${CREDS_FILE}")
PASSWORD=$(sed -n '2p' "\${CREDS_FILE}")
if grep -qF "\${USERNAME}:\${PASSWORD}" /etc/openvpn/users.db 2>/dev/null; then
  exit 0
fi
exit 1
`;

function ensureAuthInfra(): void {
  try {
    if (!existsSync(AUTH_SCRIPT)) {
      writeFileSync(AUTH_SCRIPT, AUTH_SCRIPT_CONTENT, { mode: 0o755 });
    }
    if (!existsSync(USERS_DB)) {
      writeFileSync(USERS_DB, "", { mode: 0o600 });
    }
  } catch { /* no-op in dev environment */ }
}

function syncUserToDb(username: string, password: string): void {
  try {
    ensureAuthInfra();
    const content = existsSync(USERS_DB) ? readFileSync(USERS_DB, "utf-8") : "";
    const lines = content.split("\n").filter(l => l.trim() && !l.startsWith(`${username}:`));
    lines.push(`${username}:${password}`);
    writeFileSync(USERS_DB, lines.join("\n") + "\n", { mode: 0o600 });
  } catch { /* dev env */ }
}

function removeUserFromDb(username: string): void {
  try {
    if (!existsSync(USERS_DB)) return;
    const content = readFileSync(USERS_DB, "utf-8");
    const lines = content.split("\n").filter(l => l.trim() && !l.startsWith(`${username}:`));
    writeFileSync(USERS_DB, lines.join("\n") + "\n", { mode: 0o600 });
  } catch { /* dev env */ }
}

function generateOvpn(username: string): string {
  const serverHost = process.env.VPN_HOST
    || process.env.VITE_API_BASE?.replace(/^https?:\/\//, "").split(":")[0]
    || "proxyvpn.isplatty.org";

  const caPath = CA_PATHS.find(p => existsSync(p));
  const caCert = caPath ? readFileSync(caPath, "utf-8").trim() : "# CA cert not available — paste your ca.crt here";

  return [
    `# OcholaSupernet VPN — ${username}`,
    `# Generated: ${new Date().toISOString()}`,
    `client`,
    `dev tun`,
    `proto tcp`,
    `remote ${serverHost} 1194`,
    `resolv-retry infinite`,
    `nobind`,
    `persist-key`,
    `persist-tun`,
    `auth-user-pass`,
    `remote-cert-tls server`,
    `cipher AES-256-CBC`,
    `auth SHA1`,
    `verb 3`,
    `<ca>`,
    caCert,
    `</ca>`,
  ].join("\n");
}

/* ── GET /api/vpn/users ── list VPN users for an admin */
router.get("/vpn/users", async (req: Request, res: Response): Promise<void> => {
  const adminId = req.query.adminId ?? "1";
  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    const r = await fetch(
      `${url}/rest/v1/isp_vpn_users?admin_id=eq.${adminId}&order=created_at.desc&select=id,username,notes,is_active,created_at,expires_at`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) throw new Error(await r.text());
    res.json(await r.json());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/vpn/users ── create a VPN user */
router.post("/vpn/users", async (req: Request, res: Response): Promise<void> => {
  const { adminId = 1, username, password, notes, expiresAt } = req.body;
  if (!username || !password) { res.status(400).json({ error: "username and password required" }); return; }

  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    const r = await fetch(`${url}/rest/v1/isp_vpn_users`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        admin_id:   Number(adminId),
        username:   username.trim(),
        password:   password.trim(),
        notes:      notes?.trim() || null,
        is_active:  true,
        expires_at: expiresAt || null,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    syncUserToDb(username.trim(), password.trim());
    res.status(201).json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── PATCH /api/vpn/users/:id/toggle ── flip is_active */
router.patch("/vpn/users/:id/toggle", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    const gr = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}&select=is_active`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await gr.json() as { is_active: boolean }[];
    if (!rows.length) { res.status(404).json({ error: "User not found" }); return; }

    const newState = !rows[0].is_active;
    const ur = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ is_active: newState }),
    });
    if (!ur.ok) throw new Error(await ur.text());
    res.json({ ok: true, is_active: newState });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/vpn/users/:id/regenerate ── new password */
router.post("/vpn/users/:id/regenerate", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const newPassword: string = req.body?.password ?? Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4);
  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    const gr = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}&select=username`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await gr.json() as { username: string }[];
    if (!rows.length) { res.status(404).json({ error: "User not found" }); return; }

    const ur = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!ur.ok) throw new Error(await ur.text());

    syncUserToDb(rows[0].username, newPassword);
    res.json({ ok: true, password: newPassword });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── DELETE /api/vpn/users/:id ── delete a VPN user */
router.delete("/vpn/users/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    /* Fetch username first so we can remove from users.db */
    const gr = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}&select=username`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await gr.json() as { username: string }[];
    if (rows.length) removeUserFromDb(rows[0].username);

    const dr = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!dr.ok) throw new Error(await dr.text());
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/vpn/users/:id/ovpn ── download .ovpn config */
router.get("/vpn/users/:id/ovpn", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const url = sbUrl(); const key = sbKey();
  if (!url || !key) { res.status(503).json({ error: "Supabase not configured" }); return; }

  try {
    const r = await fetch(`${url}/rest/v1/isp_vpn_users?id=eq.${id}&select=username`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await r.json() as { username: string }[];
    if (!rows.length) { res.status(404).json({ error: "User not found" }); return; }

    const ovpn = generateOvpn(rows[0].username);
    res.set("Content-Type", "application/x-openvpn-profile");
    res.set("Content-Disposition", `attachment; filename="${rows[0].username}.ovpn"`);
    res.send(ovpn);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
