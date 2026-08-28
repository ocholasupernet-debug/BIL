import express, { Router, type IRouter, type Request } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { requireAdmin } from "../lib/api-auth.js";
import { pingRouter, runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { sbInsertStrict, sbRpc, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { assertSourceCommand, exportRouterMigration, parseRouterOsExport, SOURCE_PRINT_COMMANDS } from "../lib/router-migration-exporter.js";
import { assertDistinctTargets, buildMigrationPlan, executeMigrationPlan } from "../lib/router-migration-importer.js";
import { buildDomainRouterExportScript, READ_ONLY_ROUTER_EXPORT_SCRIPT } from "../lib/router-migration-export-script.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import {
  buildMigrationTunnelScript,
  MIGRATION_TUNNEL_TTL_MS,
  provisionMigrationOpenVpnLease,
  revokeMigrationOpenVpnLease,
} from "../lib/migration-tunnel.js";

const router: IRouter = Router();
const locks = new Set<string>();
type RouterRow = { id: number; admin_id: number; name: string; host: string; bridge_ip?: string; router_username: string; router_secret?: string; identity?: string; serial?: string };
type Job = { id: number; admin_id: number; source_router_id?: number | null; source_label?: string; source_mode?: string; target_router_id?: number; ciphertext?: string; iv?: string; auth_tag?: string; plan_json?: Record<string, unknown>; stages_json?: Record<string, unknown>; verification_json?: Record<string, unknown>; audit_json?: Record<string, unknown>; findings_json?: Record<string, unknown>; status: string };
type CollectorToken = {
  token_hash: string;
  admin_id: number;
  source_label: string;
  expires_at: string;
  used_at?: string | null;
  migration_job_id?: number | null;
  tunnel_lease_id?: number | null;
};
type CollectorChunk = { token_hash: string; chunk_index: number; ciphertext: string; iv: string; auth_tag: string };
type TunnelLease = {
  id: number;
  admin_id: number;
  source_router_id: number;
  migration_job_id?: number | null;
  technology: "openvpn";
  username: string;
  assigned_ip: string;
  server_endpoint: string;
  bootstrap_token_hash: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  status: "issued" | "script_issued" | "connected" | "exported" | "revoked" | "expired" | "server_unavailable";
  created_at: string;
  expires_at: string;
  bootstrap_fetched_at?: string | null;
  verified_at?: string | null;
  revoked_at?: string | null;
  audit_json?: Record<string, unknown>;
};

function admin(req: Request): number { const id = Number(req.authUser?.uid); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid administrator identity."); return id; }
function positive(value: unknown): number { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid numeric identifier."); return id; }
function cleanHost(value: string | undefined): string {
  return String(value ?? "").trim().replace(/\s+\((?:VPN tunnel|⚠ LAN IP — only reachable on local network)\)\s*$/u, "");
}
function creds(row: RouterRow): RouterCredentials {
  return { host: cleanHost(row.host), bridgeIp: row.bridge_ip, port: 8728, username: row.router_username || "admin", password: row.router_secret ?? "" };
}
function key() { const secret = process.env.SESSION_SECRET ?? process.env.TOKEN_SIGNING_SECRET; if (!secret) throw new Error("Migration encryption is not configured."); return createHash("sha256").update(secret).digest(); }
function encrypt(value: unknown) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64") }; }
function decrypt(job: Job) { if (!job.ciphertext || !job.iv || !job.auth_tag) throw new Error("Migration package is unavailable."); const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(job.iv, "base64")); decipher.setAuthTag(Buffer.from(job.auth_tag, "base64")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(job.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>; }
function decryptText(chunk: CollectorChunk) {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(chunk.iv, "base64"));
  decipher.setAuthTag(Buffer.from(chunk.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(chunk.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function collectorHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function leaseHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function publicOrigin(req: Request) {
  const configured = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = String(req.headers.host ?? "").split(":")[0];
  if (host === "isplatty.org" || host.endsWith(".isplatty.org")) return `https://${host}`;
  return host === "localhost" || host === "127.0.0.1" ? `http://${req.headers.host}` : `https://${req.headers.host}`;
}
function summaryFor(pkg: Record<string, unknown>) {
  const pools = Array.isArray(pkg.ip_pools) ? pkg.ip_pools.length : 0;
  const users = (Array.isArray(pkg.ppp_secrets) ? pkg.ppp_secrets.length : 0) + (Array.isArray(pkg.hotspot_users) ? pkg.hotspot_users.length : 0);
  const configs = Object.values(pkg).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  return { configs, users, queues: Array.isArray(pkg.queues) ? pkg.queues.length : 0, pools };
}
function findingsFor(pkg: Record<string, unknown>, plan: ReturnType<typeof buildMigrationPlan>) {
  const warnings = Array.isArray(pkg.warnings) ? pkg.warnings.map(String) : [];
  const manual = plan.unsupported.filter(x => x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const unsupported = plan.unsupported.filter(x => !x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  return { warnings, manual, unsupported };
}
function collectorToken(req: Request): string {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error("Invalid or expired collector session.");
  return token;
}
async function ownedRouter(id: number, adminId: number) {
  positive(id);
  const rows = await sbSelectStrict<RouterRow>("isp_routers", `id=eq.${id}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,router_username,router_secret&limit=1`);
  const row = rows[0];
  if (!row) throw new Error("Router not found.");
  const clients = readVpnClients();
  const discoveredVpnIp = vpnIpFor(row.name, clients) || vpnIpFor(cleanHost(row.host), clients);
  /* Keep the discovered address in memory until a real RouterOS API login
     succeeds. The status file proves that a tunnel client exists, not that
     port 8728 is reachable or that the credentials are valid. */
  if (discoveredVpnIp) row.bridge_ip = discoveredVpnIp;
  return row;
}

function tunnelEndpoint(req: Request): string {
  const configured = process.env.VPS_HOST?.trim();
  if (configured) {
    return configured.replace(/^https?:\/\//i, "").split("/")[0].replace(/:\d+$/, "");
  }
  const host = String(req.headers.host ?? "").split(":")[0];
  if (host === "localhost" || host === "127.0.0.1") return host;
  return host;
}

function tunnelInterfaceName(routerId: number, leaseToken: string): string {
  return `ochola-mig-${routerId}-${leaseToken.slice(0, 8)}`;
}
function tunnelInterfaceNameForLease(lease: TunnelLease): string {
  return tunnelInterfaceName(lease.source_router_id, lease.bootstrap_token_hash);
}

function activeTunnelStatuses(): string {
  return "in.(issued,script_issued,connected,exported)";
}

async function tunnelFor(
  sourceRouterId: number,
  adminId: number,
  leaseId?: number,
): Promise<TunnelLease> {
  const leaseFilter = leaseId ? `&id=eq.${positive(leaseId)}` : "";
  const rows = await sbSelectStrict<TunnelLease>(
    "router_migration_tunnel_leases",
    `admin_id=eq.${adminId}&source_router_id=eq.${positive(sourceRouterId)}&status=${activeTunnelStatuses()}${leaseFilter}&select=*&order=created_at.desc&limit=1`,
  );
  const lease = rows[0];
  if (!lease) throw new Error("Start a one-hour migration tunnel for this source router first.");
  if (new Date(lease.expires_at).getTime() <= Date.now()) {
    await expireTunnel(lease);
    throw new Error("The migration tunnel has expired. Start a new tunnel before exporting.");
  }
  return lease;
}

async function expireTunnel(lease: TunnelLease): Promise<void> {
  if (lease.status === "revoked" || lease.status === "expired") return;
  await revokeMigrationOpenVpnLease(lease.username);
  const events = Array.isArray(lease.audit_json?.events) ? lease.audit_json.events : [];
  await sbUpdateStrict(
    "router_migration_tunnel_leases",
    `id=eq.${lease.id}&admin_id=eq.${lease.admin_id}&status=neq.revoked`,
    {
      status: "expired",
      revoked_at: new Date().toISOString(),
      audit_json: { ...(lease.audit_json ?? {}), events: [...events, { event: "expired", at: new Date().toISOString() }] },
    },
  ).catch(() => undefined);
}

async function expireDueTunnels(): Promise<void> {
  try {
    const leases = await sbSelectStrict<TunnelLease>(
      "router_migration_tunnel_leases",
      `status=${activeTunnelStatuses()}&expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=*`,
    );
    await Promise.all(leases.map(expireTunnel));
  } catch {
    /* The additive lease table may not be deployed yet; existing routes stay usable. */
  }
}

async function expireDueCollectors(): Promise<void> {
  try {
    const sessions = await sbSelectStrict<CollectorToken>(
      "router_migration_collector_tokens",
      `expires_at=lt.${encodeURIComponent(new Date().toISOString())}&used_at=is.null&tunnel_lease_id=not.is.null&select=admin_id,tunnel_lease_id`,
    );
    await Promise.all(sessions.map(async session => {
      if (!session.tunnel_lease_id) return;
      const leases = await sbSelectStrict<TunnelLease>(
        "router_migration_tunnel_leases",
        `id=eq.${positive(session.tunnel_lease_id)}&admin_id=eq.${session.admin_id}&select=*&limit=1`,
      );
      if (leases[0]) await expireTunnel(leases[0]);
    }));
  } catch {
    /* The additive collector-tunnel column may not be deployed yet. */
  }
}

const tunnelExpiryTimer = setInterval(() => {
  void expireDueTunnels();
  void expireDueCollectors();
}, 60_000);
tunnelExpiryTimer.unref();

async function revokeTunnel(lease: TunnelLease, status: "revoked" | "expired" = "revoked"): Promise<void> {
  await revokeMigrationOpenVpnLease(lease.username);
  const events = Array.isArray(lease.audit_json?.events) ? lease.audit_json.events : [];
  const now = new Date().toISOString();
  await sbUpdateStrict(
    "router_migration_tunnel_leases",
    `id=eq.${lease.id}&admin_id=eq.${lease.admin_id}&status=neq.revoked`,
    { status, revoked_at: now, audit_json: { ...(lease.audit_json ?? {}), events: [...events, { event: status, at: now }] } },
  );
}

function tunnelScriptOptions(lease: TunnelLease) {
  const encrypted = decrypt(lease as unknown as Job);
  const password = String(encrypted.password ?? "");
  if (!password) throw new Error("Migration tunnel credential is unavailable.");
  return {
    endpoint: lease.server_endpoint,
    port: 1194,
    username: lease.username,
    password,
    tunnelIp: lease.assigned_ip,
    interfaceName: tunnelInterfaceNameForLease(lease),
    firewallComment: `ochola-migration:${lease.id}`,
    schedulerName: `ochola-migration-expiry-${lease.id}`,
  };
}

async function leaseCredentials(row: RouterRow, lease: TunnelLease): Promise<RouterCredentials> {
  /* Do not let a reachable public/LAN address win before the temporary tunnel.
     Migration preflight must prove the exact leased management path. */
  return { ...creds(row), bridgeIp: lease.assigned_ip, host: lease.assigned_ip };
}

async function requireLeasedApiConnection(row: RouterRow, adminId: number, lease: TunnelLease) {
  const result = await pingRouter(await leaseCredentials(row, lease));
  const events = Array.isArray(lease.audit_json?.events) ? lease.audit_json.events : [];
  await sbUpdateStrict(
    "router_migration_tunnel_leases",
    `id=eq.${lease.id}&admin_id=eq.${adminId}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    { status: "connected", verified_at: result.connectedAt, audit_json: { ...(lease.audit_json ?? {}), events: [...events, { event: "api_verified", at: result.connectedAt, connected_host: result.connectedHost }] } },
  );
  await sbUpdateStrict("isp_routers", `id=eq.${row.id}&admin_id=eq.${adminId}`, {
    status: "online",
    last_seen: result.connectedAt,
    last_connected_host: result.connectedHost,
    bridge_ip: lease.assigned_ip,
    model: result.board || undefined,
    ros_version: result.version || undefined,
    updated_at: result.connectedAt,
  });
  return result;
}
async function requireApiConnection(row: RouterRow, adminId: number) {
  try {
    const result = await pingRouter(creds(row));
    await sbUpdateStrict("isp_routers", `id=eq.${row.id}&admin_id=eq.${adminId}`, {
      status: "online",
      last_seen: result.connectedAt,
      last_connected_host: result.connectedHost,
      ...(row.bridge_ip ? { bridge_ip: row.bridge_ip } : {}),
      model: result.board || undefined,
      ros_version: result.version || undefined,
      updated_at: result.connectedAt,
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Router "${row.name}" is not connected through the RouterOS API. Open Routers, run Re-check, and resolve the VPN/API error before migration or export. ${detail}`);
  }
}
async function jobFor(id: number, adminId: number) { positive(id); const rows = await sbSelectStrict<Job>("router_migration_jobs", `id=eq.${id}&admin_id=eq.${adminId}&select=*&limit=1`); if (!rows[0]) throw new Error("Migration not found."); return rows[0]; }
async function sourceForJob(job: Job, adminId: number): Promise<{ row: RouterRow; tunnel: TunnelLease } | null> {
  if (!job.source_router_id) return null;
  const row = await ownedRouter(job.source_router_id, adminId);
  const audit = job.audit_json as Record<string, unknown> | undefined;
  const tunnel = await tunnelFor(job.source_router_id, adminId, Number(audit?.tunnel_lease_id) || undefined);
  return { row: { ...row, host: tunnel.assigned_ip, bridge_ip: tunnel.assigned_ip }, tunnel };
}
async function guarded(req: Request, fn: (adminId: number) => Promise<void>, res: any) { try { const id = admin(req); const lock = `${id}:${req.params.id ?? req.body.sourceRouterId ?? req.body.sourceLabel ?? ""}`; if (locks.has(lock)) { res.status(409).json({ ok: false, error: "Migration is already in progress." }); return; } locks.add(lock); try { await fn(id); } finally { locks.delete(lock); } } catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Migration request failed." }); } }
async function observeDevice(row: RouterRow) {
  const [identity, resource, routerboard, license] = await Promise.all([
    runRouterCommand(creds(row), ["/system/identity/print"]),
    runRouterCommand(creds(row), ["/system/resource/print"]),
    runRouterCommand(creds(row), ["/system/routerboard/print"]).catch(() => []),
    runRouterCommand(creds(row), ["/system/license/print"]).catch(() => []),
  ]);
  const fingerprint = routerboard[0]?.["serial-number"] || license[0]?.["software-id"] || resource[0]?.["software-id"];
  if (!fingerprint) throw new Error("Router does not expose a stable device fingerprint; migration writes are blocked.");
  return { identity: identity[0]?.name, fingerprint, version: resource[0]?.version, boardName: resource[0]?.["board-name"] ?? resource[0]?.board };
}

/* This is intentionally before the admin middleware below. The MikroTik has
   no browser session; the short-lived, one-time collector token is its auth.
   RouterOS sends the file as ordered HTTP chunks because its HTTP body
   variable is limited to roughly 4KB. */
router.post("/router-migrations/collector-upload", express.raw({ type: "*/*", limit: "8mb" }), async (req, res) => {
  try {
    const token = collectorToken(req);
    const tokenHash = collectorHash(token);
    const chunkIndex = Number(req.query.chunk);
    const isFinal = req.query.final === "yes";
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 2500) throw new Error("Invalid collector chunk.");
    const rawChunk = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!rawChunk || Buffer.byteLength(rawChunk, "utf8") > 3800) throw new Error("Collector chunk is empty or too large.");
    const sessions = await sbSelectStrict<CollectorToken>("router_migration_collector_tokens", `token_hash=eq.${tokenHash}&select=token_hash,admin_id,source_label,expires_at,used_at,migration_job_id,tunnel_lease_id&limit=1`);
    const session = sessions[0];
    if (!session) {
      res.status(401).json({ ok: false, error: "Invalid, expired, or already used collector session." });
      return;
    }
    if (session.used_at || session.migration_job_id || new Date(session.expires_at).getTime() <= Date.now()) {
      res.status(409).json({ ok: false, error: "Collector session is expired or already completed." });
      return;
    }
    let tunnel: TunnelLease | undefined;
    if (session.tunnel_lease_id) {
      const leases = await sbSelectStrict<TunnelLease>(
        "router_migration_tunnel_leases",
        `id=eq.${positive(session.tunnel_lease_id)}&admin_id=eq.${session.admin_id}&select=*&limit=1`,
      );
      tunnel = leases[0];
      if (!tunnel || !["issued", "script_issued", "connected", "exported"].includes(tunnel.status)) {
        throw new Error("The migration tunnel is no longer available.");
      }
      if (new Date(tunnel.expires_at).getTime() <= Date.now()) {
        await expireTunnel(tunnel);
        throw new Error("The migration tunnel has expired.");
      }
    }
    const existing = await sbSelectStrict<CollectorChunk>("router_migration_collector_chunks", `token_hash=eq.${tokenHash}&chunk_index=eq.${chunkIndex}&select=token_hash,chunk_index,ciphertext,iv,auth_tag&limit=1`);
    if (!existing[0]) {
      await sbInsertStrict<CollectorChunk>("router_migration_collector_chunks", { token_hash: tokenHash, chunk_index: chunkIndex, ...encrypt(rawChunk) });
    }
    if (!isFinal) {
      res.json({ ok: true, received: chunkIndex });
      return;
    }
    const chunks = await sbSelectStrict<CollectorChunk>("router_migration_collector_chunks", `token_hash=eq.${tokenHash}&order=chunk_index.asc&select=token_hash,chunk_index,ciphertext,iv,auth_tag`);
    if (chunks.length !== chunkIndex + 1 || chunks.some((chunk, index) => chunk.chunk_index !== index)) {
      throw new Error("Collector chunks are incomplete or out of order.");
    }
    const rawExport = chunks.map(decryptText).join("");
    const pkg = parseRouterOsExport(rawExport);
    const plan = buildMigrationPlan(pkg);
    const findings = findingsFor(pkg, plan);
    const summary = summaryFor(pkg);
    const claimed = await sbRpc<CollectorToken>("consume_router_migration_collector_token", { p_token_hash: tokenHash });
    if (!claimed[0]) {
      res.status(409).json({ ok: false, error: "Collector session was already completed." });
      return;
    }
    const secure = encrypt({ ...pkg, raw_export: rawExport });
    const rows = await sbInsertStrict<Job>("router_migration_jobs", {
      admin_id: session.admin_id,
      source_router_id: null,
      source_label: session.source_label,
      source_mode: "domain_collector",
      status: "exported",
      ...secure,
      findings_json: findings,
      audit_json: {
        exported_at: new Date().toISOString(),
        source_read_only: true,
        source_mode: "domain_collector",
        source_label: session.source_label,
        summary,
        ...(tunnel ? {
          tunnel_lease_id: tunnel.id,
          tunnel_address: tunnel.assigned_ip,
          tunnel_technology: tunnel.technology,
          collector_source_router_id: tunnel.source_router_id,
        } : {}),
      },
    });
    const migrationId = rows[0]?.id;
    if (!migrationId) throw new Error("Collected export could not be saved.");
    await sbUpdateStrict("router_migration_collector_tokens", `token_hash=eq.${tokenHash}&admin_id=eq.${session.admin_id}`, { migration_job_id: migrationId });
    if (tunnel) {
      await sbUpdateStrict(
        "router_migration_tunnel_leases",
        `id=eq.${tunnel.id}&admin_id=eq.${session.admin_id}`,
        {
          migration_job_id: migrationId,
          status: "exported",
          audit_json: {
            ...(tunnel.audit_json ?? {}),
            events: [
              ...(Array.isArray(tunnel.audit_json?.events) ? tunnel.audit_json.events : []),
              { event: "collector_exported", at: new Date().toISOString(), migration_job_id: migrationId },
            ],
          },
        },
      );
      await revokeTunnel(tunnel);
    }
    res.json({ ok: true, migrationId: String(migrationId), status: "exported" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Collector upload failed." });
  }
});

/* The MikroTik cannot present the administrator's browser session. It fetches
   this one-time bootstrap only after the admin has created a lease. */
router.get("/router-migrations/tunnel-bootstrap", async (req, res) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
      res.status(401).send("Invalid or expired migration tunnel session.");
      return;
    }
    const rows = await sbSelectStrict<TunnelLease>(
      "router_migration_tunnel_leases",
      `bootstrap_token_hash=eq.${leaseHash(token)}&status=eq.issued&select=*&limit=1`,
    );
    const lease = rows[0];
    if (!lease || new Date(lease.expires_at).getTime() <= Date.now()) {
      if (lease) await expireTunnel(lease);
      res.status(401).send("Invalid or expired migration tunnel session.");
      return;
    }
    const script = buildMigrationTunnelScript(tunnelScriptOptions(lease));
    const events = Array.isArray(lease.audit_json?.events) ? lease.audit_json.events : [];
    await sbUpdateStrict(
      "router_migration_tunnel_leases",
      `id=eq.${lease.id}&status=eq.issued`,
      {
        status: "script_issued",
        bootstrap_fetched_at: new Date().toISOString(),
        audit_json: { ...(lease.audit_json ?? {}), events: [...events, { event: "bootstrap_fetched", at: new Date().toISOString() }] },
      },
    ).catch(() => undefined);
    res.type("text/plain").set("Content-Disposition", 'inline; filename="ochola-migration-tunnel.rsc"').send(script);
  } catch {
    res.status(401).send("Invalid or expired migration tunnel session.");
  }
});

/* A collector session may be bound to the same registered-router lease. This
   endpoint keeps tunnel secrets server-side while returning one combined RSC:
   connection-only tunnel setup first, read-only export second. */
router.get("/router-migrations/collector-script", async (req, res) => {
  try {
    const token = collectorToken(req);
    const tokenHash = collectorHash(token);
    const sessions = await sbSelectStrict<CollectorToken>(
      "router_migration_collector_tokens",
      `token_hash=eq.${tokenHash}&select=token_hash,admin_id,source_label,expires_at,used_at,migration_job_id,tunnel_lease_id&limit=1`,
    );
    const session = sessions[0];
    if (!session || session.used_at || session.migration_job_id || new Date(session.expires_at).getTime() <= Date.now()) {
      res.status(401).send("# Invalid or expired migration collector session.");
      return;
    }

    let tunnel: TunnelLease | undefined;
    if (session.tunnel_lease_id) {
      const leases = await sbSelectStrict<TunnelLease>(
        "router_migration_tunnel_leases",
        `id=eq.${positive(session.tunnel_lease_id)}&admin_id=eq.${session.admin_id}&select=*&limit=1`,
      );
      tunnel = leases[0];
      if (!tunnel || !["issued", "script_issued", "connected", "exported"].includes(tunnel.status)) {
        res.status(409).send("# The migration tunnel is no longer available. Start a new tunnel session.");
        return;
      }
      if (new Date(tunnel.expires_at).getTime() <= Date.now()) {
        await expireTunnel(tunnel);
        res.status(409).send("# The migration tunnel has expired. Start a new tunnel session.");
        return;
      }
    }

    const origin = publicOrigin(req);
    const uploadUrl = `${origin}/api/router-migrations/collector-upload?token=${encodeURIComponent(token)}`;
    const script = buildDomainRouterExportScript(uploadUrl, tunnel ? tunnelScriptOptions(tunnel) : undefined);
    if (tunnel && tunnel.status === "issued") {
      const events = Array.isArray(tunnel.audit_json?.events) ? tunnel.audit_json.events : [];
      await sbUpdateStrict(
        "router_migration_tunnel_leases",
        `id=eq.${tunnel.id}&admin_id=eq.${session.admin_id}&status=eq.issued`,
        {
          status: "script_issued",
          bootstrap_fetched_at: new Date().toISOString(),
          audit_json: { ...(tunnel.audit_json ?? {}), events: [...events, { event: "collector_script_issued", at: new Date().toISOString() }] },
        },
      ).catch(() => undefined);
    }
    res.type("text/plain").set("Content-Disposition", 'inline; filename="router-migration-collector.rsc"').send(script);
  } catch {
    res.status(401).send("# Invalid or expired migration collector session.");
  }
});

router.use("/router-migrations", requireAdmin());
router.get("/router-migrations/read-only-export-script", (req, res) => {
  try {
    admin(req);
    res.type("text/plain").set("Content-Disposition", 'attachment; filename="ocholasupernet-read-only-export.rsc"').send(READ_ONLY_ROUTER_EXPORT_SCRIPT);
  } catch {
    res.status(401).json({ ok: false, error: "Invalid administrator identity." });
  }
});

router.post("/router-migrations/tunnel-session", async (req, res) => guarded(req, async a => {
  const sourceRouterId = positive(req.body.sourceRouterId);
  const source = await ownedRouter(sourceRouterId, a);
  const endpoint = tunnelEndpoint(req);
  if (!endpoint) throw new Error("VPS_HOST must be configured before creating a migration tunnel.");

  const bootstrapToken = randomBytes(32).toString("base64url");
  const username = `ochola-mig-${sourceRouterId}-${bootstrapToken.slice(0, 8)}`;
  const password = randomBytes(24).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MIGRATION_TUNNEL_TTL_MS).toISOString();
  const candidates = Array.from({ length: 249 }, (_, index) => 2 + ((sourceRouterId + index) % 249));
  let lease: TunnelLease | undefined;

  for (const hostPart of candidates) {
    const assignedIp = `10.8.0.${hostPart}`;
    const conflict = await sbSelectStrict<{ id: number }>(
      "router_migration_tunnel_leases",
      `assigned_ip=eq.${assignedIp}&status=${activeTunnelStatuses()}&select=id&limit=1`,
    );
    if (conflict[0]) continue;
    try {
      const rows = await sbInsertStrict<TunnelLease>("router_migration_tunnel_leases", {
        admin_id: a,
        source_router_id: sourceRouterId,
        migration_job_id: null,
        technology: "openvpn",
        username,
        assigned_ip: assignedIp,
        server_endpoint: endpoint,
        bootstrap_token_hash: leaseHash(bootstrapToken),
        ...encrypt({ password }),
        status: "issued",
        created_at: now.toISOString(),
        expires_at: expiresAt,
        audit_json: { source_read_only: true, lifecycle: "issued" },
      });
      lease = rows[0];
      break;
    } catch {
      /* A concurrent session may have claimed this address; try the next one. */
    }
  }
  if (!lease) throw new Error("No migration tunnel address is available. Close an existing tunnel and try again.");

  const serverReady = await provisionMigrationOpenVpnLease(username, password, lease.assigned_ip);
  if (!serverReady) {
    await sbUpdateStrict("router_migration_tunnel_leases", `id=eq.${lease.id}&admin_id=eq.${a}`, {
      status: "server_unavailable",
      revoked_at: new Date().toISOString(),
      audit_json: { ...(lease.audit_json ?? {}), events: [{ event: "server_unavailable", at: new Date().toISOString() }] },
    }).catch(() => undefined);
    res.status(503).json({
      ok: false,
      error: "The VPS OpenVPN auth and client-config paths are not available to the API server. Run the VPS VPN setup first.",
    });
    return;
  }

  const scriptUrl = `${publicOrigin(req)}/api/router-migrations/tunnel-bootstrap?token=${encodeURIComponent(bootstrapToken)}`;
  const interfaceName = tunnelInterfaceNameForLease(lease);
  const command = `/tool fetch url="${scriptUrl}" dst-path=ochola-migration-tunnel.rsc mode=https check-certificate=no; /import ochola-migration-tunnel.rsc; /file remove [find name="ochola-migration-tunnel.rsc"]`;
  res.status(201).json({
    ok: true,
    leaseId: String(lease.id),
    routerId: sourceRouterId,
    routerName: source.name,
    technology: lease.technology,
    tunnelAddress: lease.assigned_ip,
    serverEndpoint: endpoint,
    interfaceName,
    scriptUrl,
    command,
    createdAt: lease.created_at,
    expiresAt: lease.expires_at,
    status: lease.status,
  });
}, res));
router.get("/router-migrations/tunnel-session/:id", async (req, res) => guarded(req, async a => {
  const rows = await sbSelectStrict<TunnelLease>(
    "router_migration_tunnel_leases",
    `id=eq.${positive(req.params.id)}&admin_id=eq.${a}&select=id,source_router_id,technology,assigned_ip,status,created_at,expires_at,verified_at&limit=1`,
  );
  const lease = rows[0];
  if (!lease) throw new Error("Migration tunnel session not found.");
  if (new Date(lease.expires_at).getTime() <= Date.now() && ["issued", "script_issued", "connected", "exported"].includes(lease.status)) {
    await expireTunnel(lease);
    res.json({ id: String(lease.id), status: "expired", address: lease.assigned_ip, expiresAt: lease.expires_at, verifiedAt: lease.verified_at });
    return;
  }
  res.json({ id: String(lease.id), status: lease.status, address: lease.assigned_ip, expiresAt: lease.expires_at, verifiedAt: lease.verified_at });
}, res));

router.post("/router-migrations/collector-session", async (req, res) => guarded(req, async a => {
  const sourceLabel = typeof req.body.sourceLabel === "string" ? req.body.sourceLabel.trim().slice(0, 120) : "";
  if (!sourceLabel) throw new Error("Give this source router a name.");
  const sourceRouterId = req.body.sourceRouterId ? positive(req.body.sourceRouterId) : undefined;
  const tunnelId = req.body.tunnelId ? positive(req.body.tunnelId) : undefined;
  let tunnel: TunnelLease | undefined;
  if (sourceRouterId || tunnelId) {
    if (!sourceRouterId || !tunnelId) throw new Error("A tunnel-enabled collector requires both a registered source router and its tunnel session.");
    await ownedRouter(sourceRouterId, a);
    tunnel = await tunnelFor(sourceRouterId, a, tunnelId);
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await sbInsertStrict<CollectorToken>("router_migration_collector_tokens", {
    token_hash: collectorHash(token),
    admin_id: a,
    source_label: sourceLabel,
    expires_at: expiresAt,
    tunnel_lease_id: tunnel?.id ?? null,
  });
  const scriptUrl = `${publicOrigin(req)}/api/router-migrations/collector-script?token=${encodeURIComponent(token)}`;
  const command = `/tool fetch url="${scriptUrl}" dst-path="ochola-router-migration-collector.rsc" mode=https check-certificate=no; /import ochola-router-migration-collector.rsc; /file remove [find name="ochola-router-migration-collector.rsc"]`;
  res.status(201).json({
    sourceLabel,
    token,
    scriptUrl,
    command,
    expiresAt,
    status: "waiting",
    ...(tunnel ? {
      tunnel: {
        leaseId: String(tunnel.id),
        routerId: tunnel.source_router_id,
        address: tunnel.assigned_ip,
        technology: tunnel.technology,
        expiresAt: tunnel.expires_at,
        status: tunnel.status,
      },
    } : {}),
  });
}, res));
router.get("/router-migrations/collector-session/status", async (req, res) => guarded(req, async a => {
  const token = collectorToken(req);
  const rows = await sbSelectStrict<CollectorToken>("router_migration_collector_tokens", `token_hash=eq.${collectorHash(token)}&admin_id=eq.${a}&select=token_hash,admin_id,source_label,expires_at,used_at,migration_job_id,tunnel_lease_id&limit=1`);
  const session = rows[0];
  if (!session) throw new Error("Collector session not found.");
  const expired = new Date(session.expires_at).getTime() <= Date.now();
  let tunnel: TunnelLease | undefined;
  if (session.tunnel_lease_id) {
    const leases = await sbSelectStrict<TunnelLease>(
      "router_migration_tunnel_leases",
      `id=eq.${positive(session.tunnel_lease_id)}&admin_id=eq.${a}&select=id,source_router_id,technology,assigned_ip,status,expires_at,verified_at&limit=1`,
    );
    tunnel = leases[0];
  }
  if (!session.migration_job_id) {
    res.json({
      status: expired ? "expired" : session.used_at ? "processing" : "waiting",
      sourceLabel: session.source_label,
      expiresAt: session.expires_at,
      ...(tunnel ? { tunnel: { leaseId: String(tunnel.id), routerId: tunnel.source_router_id, address: tunnel.assigned_ip, technology: tunnel.technology, expiresAt: tunnel.expires_at, status: tunnel.status } } : {}),
    });
    return;
  }
  const jobs = await sbSelectStrict<Job>("router_migration_jobs", `id=eq.${session.migration_job_id}&admin_id=eq.${a}&select=id,status,source_label,source_mode,findings_json,audit_json&limit=1`);
  const job = jobs[0];
  const audit = job?.audit_json ?? {};
  res.json({
    status: job?.status ?? "processing",
    migrationId: String(session.migration_job_id),
    sourceLabel: session.source_label,
    sourceMode: "domain_collector",
    summary: audit.summary ?? {},
    findings: job?.findings_json ?? {},
    ...(tunnel ? { tunnel: { leaseId: String(tunnel.id), routerId: tunnel.source_router_id, address: tunnel.assigned_ip, technology: tunnel.technology, expiresAt: tunnel.expires_at, status: tunnel.status } } : {}),
  });
}, res));
router.get("/router-migrations/:id/tunnel", async (req, res) => guarded(req, async a => {
  const job = await jobFor(positive(req.params.id), a);
  if (!job.source_router_id) throw new Error("This migration has no registered source router tunnel.");
  const tunnel = await tunnelFor(job.source_router_id, a, Number((job.audit_json as Record<string, unknown> | undefined)?.tunnel_lease_id) || undefined);
  res.json({
    id: String(tunnel.id),
    technology: tunnel.technology,
    address: tunnel.assigned_ip,
    expiresAt: tunnel.expires_at,
    status: tunnel.status,
    verifiedAt: tunnel.verified_at,
  });
}, res));
router.post("/router-migrations/:id/tunnel/revoke", async (req, res) => guarded(req, async a => {
  const job = await jobFor(positive(req.params.id), a);
  if (!job.source_router_id) throw new Error("This migration has no registered source router tunnel.");
  const tunnel = await tunnelFor(job.source_router_id, a, Number((job.audit_json as Record<string, unknown> | undefined)?.tunnel_lease_id) || undefined);
  await revokeTunnel(tunnel);
  res.json({ ok: true, status: "revoked", address: tunnel.assigned_ip });
}, res));
router.get("/router-migrations/routers", async (req, res) => guarded(req, async a => {
  const rows = await sbSelectStrict<RouterRow>("isp_routers", `admin_id=eq.${a}&select=id,name,host,status,ros_version&order=name.asc`);
  res.json({ routers: rows });
}, res));
router.post("/router-migrations/analyze", async (req, res) => guarded(req, async a => {
  const sourceRouterId = positive(req.body.sourceRouterId);
  const source = await ownedRouter(sourceRouterId, a);
  const tunnel = await tunnelFor(sourceRouterId, a, req.body.tunnelId ? positive(req.body.tunnelId) : undefined);
  for (const command of ["/system/identity/print", "/system/resource/print", "/system/routerboard/print", "/system/license/print"]) assertSourceCommand(command);
  await requireLeasedApiConnection(source, a, tunnel);
  const observed = await observeDevice({ ...source, host: tunnel.assigned_ip, bridge_ip: tunnel.assigned_ip });
  res.json({
    compatible: true,
    details: `Read-only compatibility analysis completed through the ${tunnel.assigned_ip} migration tunnel.`,
    dataPoints: [{ type: "router", count: 1 }],
    readOnly: true,
    tunnel: { id: String(tunnel.id), address: tunnel.assigned_ip, expiresAt: tunnel.expires_at, technology: tunnel.technology },
    identity: { name: observed.identity, version: observed.version, boardName: observed.boardName },
  });
}, res));
router.post("/router-migrations/export", async (req, res) => guarded(req, async a => {
  const sourceRouterId = positive(req.body.sourceRouterId);
  const source = await ownedRouter(sourceRouterId, a);
  const tunnel = await tunnelFor(sourceRouterId, a, req.body.tunnelId ? positive(req.body.tunnelId) : undefined);
  await requireLeasedApiConnection(source, a, tunnel);
  const pkg = await exportRouterMigration(await leaseCredentials(source, tunnel)); const secure = encrypt(pkg); const plan = buildMigrationPlan(pkg);
  const manual = plan.unsupported.filter(x => x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const unsupported = plan.unsupported.filter(x => !x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const rows = await sbInsertStrict<Job>("router_migration_jobs", {
    admin_id: a,
    source_router_id: source.id,
    status: "exported",
    ...secure,
    findings_json: { warnings: pkg.warnings, manual, unsupported },
    audit_json: { exported_at: new Date().toISOString(), source_read_only: true, tunnel_lease_id: tunnel.id, tunnel_address: tunnel.assigned_ip, tunnel_technology: tunnel.technology },
  });
  if (rows[0]?.id) {
    const events = Array.isArray(tunnel.audit_json?.events) ? tunnel.audit_json.events : [];
    await sbUpdateStrict("router_migration_tunnel_leases", `id=eq.${tunnel.id}&admin_id=eq.${a}`, {
      migration_job_id: rows[0].id,
      status: "exported",
      audit_json: { ...(tunnel.audit_json ?? {}), events: [...events, { event: "exported", at: new Date().toISOString(), migration_job_id: rows[0].id }] },
    });
  }
  const pools = Array.isArray(pkg.ip_pools) ? pkg.ip_pools.length : 0, users = (Array.isArray(pkg.ppp_secrets) ? pkg.ppp_secrets.length : 0) + (Array.isArray(pkg.hotspot_users) ? pkg.hotspot_users.length : 0);
  const configs = Object.values(pkg).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  res.status(201).json({
    id: String(rows[0]?.id),
    status: "exported",
    tunnel: { address: tunnel.assigned_ip, expiresAt: tunnel.expires_at, technology: tunnel.technology },
    summary: { configs, users, queues: Array.isArray(pkg.queues) ? pkg.queues.length : 0, pools },
    findings: { warnings: pkg.warnings, manual, unsupported },
  });
}, res));
router.post("/router-migrations/source-export", async (req, res) => guarded(req, async a => {
  const sourceLabel = typeof req.body.sourceLabel === "string" ? req.body.sourceLabel.trim().slice(0, 120) : "";
  const rawExport = typeof req.body.exportText === "string" ? req.body.exportText : "";
  if (!sourceLabel) throw new Error("Give this source router a name.");
  const pkg = parseRouterOsExport(rawExport);
  const secure = encrypt({ ...pkg, raw_export: rawExport });
  const plan = buildMigrationPlan(pkg);
  const manual = plan.unsupported.filter(x => x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const unsupported = plan.unsupported.filter(x => !x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const rows = await sbInsertStrict<Job>("router_migration_jobs", {
    admin_id: a,
    source_router_id: null,
    source_label: sourceLabel,
    source_mode: "terminal_script",
    status: "exported",
    ...secure,
    findings_json: { warnings: pkg.warnings, manual, unsupported },
    audit_json: { exported_at: new Date().toISOString(), source_read_only: true, source_mode: "terminal_script", source_label: sourceLabel },
  });
  const pools = Array.isArray(pkg.ip_pools) ? pkg.ip_pools.length : 0;
  const users = (Array.isArray(pkg.ppp_secrets) ? pkg.ppp_secrets.length : 0) + (Array.isArray(pkg.hotspot_users) ? pkg.hotspot_users.length : 0);
  const configs = Object.values(pkg).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  res.status(201).json({ id: String(rows[0]?.id), status: "exported", sourceLabel, sourceMode: "terminal_script", summary: { configs, users, queues: Array.isArray(pkg.queues) ? pkg.queues.length : 0, pools }, findings: { warnings: pkg.warnings, manual, unsupported } });
}, res));
router.get("/router-migrations/:id", async (req, res) => guarded(req, async a => { const j = await jobFor(positive(req.params.id), a); res.json({ id: String(j.id), status: j.status, sourceRouterId: j.source_router_id, targetRouterId: j.target_router_id }); }, res));
router.post("/router-migrations/:id/target", async (req, res) => guarded(req, async a => {
  const job = await jobFor(positive(req.params.id), a), sourceInfo = await sourceForJob(job, a), source = sourceInfo?.row ?? null, target = await ownedRouter(positive(req.body.targetRouterId), a);
  if (job.status !== "exported" && job.status !== "target_selected" && job.status !== "dry_run") throw new Error("Migration is not eligible for target selection.");
  const t = await observeDevice(target);
  let s: Awaited<ReturnType<typeof observeDevice>> | undefined;
  if (source) {
    s = await observeDevice(source);
    assertDistinctTargets({ ...source, identity: s.identity, serial: s.fingerprint }, { ...target, identity: t.identity, serial: t.fingerprint });
  }
   const audit = { ...(job.audit_json ?? {}), source_identity: s?.identity ?? job.source_label, source_fingerprint: s?.fingerprint, target_identity: t.identity, target_fingerprint: t.fingerprint, source_host: source?.host, target_host: target.host, source_mode: job.source_mode ?? "connected_router", ...(sourceInfo ? { tunnel_address: sourceInfo.tunnel.assigned_ip, tunnel_expires_at: sourceInfo.tunnel.expires_at } : {}) };
  await sbUpdateStrict("router_migration_jobs", `id=eq.${job.id}&admin_id=eq.${a}`, { target_router_id: target.id, status: "target_selected", audit_json: audit });
  res.json({ ok: true, targetRouterId: target.id });
}, res));
async function planJob(job: Job) { return buildMigrationPlan(decrypt(job)); }
async function reconcileBilling(adminId: number, pkg: Record<string, unknown>) {
  const customers = await sbSelectStrict<{ username?: string; pppoe_username?: string }>("isp_customers", `admin_id=eq.${adminId}&select=username,pppoe_username`);
  const known = new Set(customers.flatMap(x => [x.username, x.pppoe_username]).filter(Boolean));
  const users = [...(Array.isArray(pkg.ppp_secrets) ? pkg.ppp_secrets : []), ...(Array.isArray(pkg.hotspot_users) ? pkg.hotspot_users : [])] as Record<string, unknown>[];
  let matched = 0, missing = 0;
  for (const user of users) known.has(String(user.name ?? "")) ? matched++ : missing++;
  return { matched, missing, conflicting: 0, note: "Read-only billing reconciliation; no customer, plan, or subscription record was modified." };
}
router.post("/router-migrations/:id/dry-run", async (req, res) => guarded(req, async a => {
  const job = await jobFor(positive(req.params.id), a); if (!job.target_router_id) throw new Error("Select a target router first."); if (!["target_selected", "dry_run"].includes(job.status)) throw new Error("Migration is not eligible for dry run.");
  const pkg = decrypt(job), plan = buildMigrationPlan(pkg), approved = Array.isArray(req.body.approvedItemIds) ? req.body.approvedItemIds.filter((x: unknown) => typeof x === "string") : [];
  const reconciliation = await reconcileBilling(a, pkg);
  await sbUpdateStrict("router_migration_jobs", `id=eq.${job.id}&admin_id=eq.${a}`, { plan_json: plan, stages_json: { dry_run: true, approved, reconciliation }, status: "dry_run" });
  res.json({ success: true, warnings: plan.warnings, conflicts: [], plannedChanges: plan.items.map(x => ({ id: x.id, category: x.category, label: `${x.category}: ${String(x.source.name ?? x.id)}` })), skipped: [...plan.unsupported.map(x => `${x.category}: ${x.reason}`), `Billing reconciliation: ${reconciliation.matched} matched, ${reconciliation.missing} missing; no billing writes.`], approvedItemIds: approved });
}, res));
router.post("/router-migrations/:id/import", async (req, res) => guarded(req, async a => {
  if (req.body.confirmation !== "MODIFY TARGET ROUTER") throw new Error("Exact confirmation text MODIFY TARGET ROUTER is required.");
   const job = await jobFor(positive(req.params.id), a); if (!job.target_router_id) throw new Error("Select a target router first."); if (job.status !== "dry_run") throw new Error("A verified dry run is required before import."); const target = await ownedRouter(job.target_router_id, a); const sourceInfo = await sourceForJob(job, a); const source = sourceInfo?.row ?? null; const plan = await planJob(job);
  const approved: string[] = Array.isArray(req.body.approvedItemIds) ? req.body.approvedItemIds.filter((x: unknown): x is string => typeof x === "string") : [];
  const dryRunApproved: string[] = Array.isArray((job.stages_json as Record<string, unknown> | undefined)?.approved) ? (job.stages_json as { approved: unknown[] }).approved.filter((x: unknown): x is string => typeof x === "string") : [];
  if (!approved.length || approved.length !== dryRunApproved.length || approved.some(id => !dryRunApproved.includes(id))) throw new Error("Approved items changed after dry run; run the dry run again.");
  /* Fresh identity lock prevents a target swap between review and writes. */
   const t = await observeDevice(target);
   let s: Awaited<ReturnType<typeof observeDevice>> | undefined;
   if (source) {
     s = await observeDevice(source);
     assertDistinctTargets({ ...source, identity: s.identity, serial: s.fingerprint }, { ...target, identity: t.identity, serial: t.fingerprint });
   }
  const locked = job.audit_json as Record<string, unknown> | undefined;
   if (locked?.target_fingerprint !== t.fingerprint || locked?.target_host !== target.host || (source && (locked?.source_fingerprint !== s?.fingerprint || locked?.source_host !== source.host))) throw new Error("Source or target device changed since target selection.");
  const leaseToken = randomBytes(32).toString("hex");
  const lease = await sbRpc<{ acquired: boolean }>("acquire_router_migration_target_lease", { p_job_id: job.id, p_admin_id: a, p_target_router_id: target.id, p_lease_token: leaseToken });
  if (!lease[0]?.acquired) throw new Error("Another migration is already importing to this target router.");
  let finalized = false;
  try {
    const claimed = await sbUpdateStrict<Job>("router_migration_jobs", `id=eq.${job.id}&admin_id=eq.${a}&status=eq.dry_run`, { status: "importing", audit_json: { ...locked, pre_state_capture: "configuration state capture begins before writes" } });
    if (claimed.length !== 1) throw new Error("Migration was already claimed or is no longer eligible for import.");
    const snapshotCapturedAt = new Date().toISOString();
    const leasedTargetRunner = async (command: string[]) => {
      const renewed = await sbRpc<{ renewed: boolean }>("renew_router_migration_target_lease", { p_job_id: job.id, p_admin_id: a, p_target_router_id: target.id, p_lease_token: leaseToken });
      if (!renewed[0]?.renewed) throw new Error("Target migration lease expired; no further router commands were issued.");
      return runRouterCommand(creds(target), command);
    };
    const report = await executeMigrationPlan(
      plan,
      leasedTargetRunner,
      approved,
      false,
      async preState => {
        const persisted = await sbUpdateStrict<Job>(
          "router_migration_jobs",
          `id=eq.${job.id}&admin_id=eq.${a}&status=eq.importing`,
          { stages_json: { approved, recovery_capture: preState, snapshot_captured_at: snapshotCapturedAt } },
        );
        if (persisted.length !== 1) throw new Error("Recovery capture persistence failed.");
      },
    );
    const recovery = report.stopped ? "Stop target writes and restore the reviewed configuration state manually." : "No recovery required.";
    const finished = await sbUpdateStrict<Job>("router_migration_jobs", `id=eq.${job.id}&admin_id=eq.${a}&status=eq.importing`, { plan_json: plan, stages_json: { ...report, snapshotCapturedAt }, verification_json: report.verification ?? {}, audit_json: { ...locked, applied: report.applied, failures: report.failures, recovery }, status: report.stopped ? "failed" : "completed", completed_at: new Date().toISOString() });
    if (finished.length !== 1) throw new Error("Migration result could not be persisted; the target lease remains active.");
    finalized = true;
    res.json({ success: !report.stopped, importedItems: report.applied.length, failedItems: report.failures.length, recovery, status: report.stopped ? "failed" : "completed" });
  } finally {
     if (finalized) {
      await sbRpc("release_router_migration_target_lease", { p_job_id: job.id, p_admin_id: a, p_target_router_id: target.id, p_lease_token: leaseToken }).catch(() => undefined);
       if (sourceInfo) await revokeTunnel(sourceInfo.tunnel).catch(() => undefined);
    }
  }
}, res));
router.get("/router-migrations/:id/report", async (req, res) => guarded(req, async a => {
  const j = await jobFor(positive(req.params.id), a);
  const stages = j.stages_json as Record<string, unknown> | undefined;
  const audit = j.audit_json as Record<string, unknown> | undefined;
  const applied = Array.isArray(stages?.applied) ? stages.applied.map(String) : [];
  const failures = Array.isArray(stages?.failures) ? stages.failures.map(String) : [];
  const preState = stages?.preState && typeof stages.preState === "object" ? stages.preState : stages?.recovery_capture;
  const recoveryPackage = (j.status === "failed" || j.status === "importing") && preState && typeof preState === "object"
    ? {
        migrationId: String(j.id),
        targetRouterId: j.target_router_id,
        capturedAt: String(stages?.snapshotCapturedAt ?? stages?.snapshot_captured_at ?? ""),
        appliedItemIds: applied,
        failedStage: failures[0] ?? (j.status === "importing" ? "Import was interrupted after target state capture." : "Unknown failure stage."),
        preChangeState: preState,
        note: "Redacted configuration state only. This is not a RouterOS backup file and restoration must be reviewed manually.",
      }
    : undefined;
  res.json({
    success: j.status === "completed",
    importedItems: applied.length,
    failedItems: failures.length,
    logs: [...applied.map(id => `Applied approved item ${id}.`), ...failures.map(message => `Failed: ${message}`)],
    recovery: String(audit?.recovery ?? "Configuration state capture is available for manual recovery review."),
    recoveryPackage,
    status: j.status,
    verification: j.verification_json ?? {},
  });
}, res));
export default router;