import { createHash, randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import {
  authenticatedTenantAdminId,
  requireAuth,
} from "../lib/api-auth.js";
import { decryptVpnSecret, encryptVpnSecret } from "../lib/vpn-crypto.js";
import { sbDeleteStrict, sbInsertStrict, sbRpc, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import {
  buildMigrationPlan,
  assertDistinctTargets,
  executeMigrationPlan,
  redactMigrationPlan,
  type MigrationPlan,
} from "../lib/router-migration-importer.js";
import { MANUAL, parseRouterOsExport } from "../lib/router-migration-exporter.js";
import { READ_ONLY_ROUTER_EXPORT_SCRIPT, buildDomainRouterExportScript } from "../lib/router-migration-export-script.js";
import { buildMigrationTunnelScript } from "../lib/migration-tunnel.js";
import { provisionRouterMigrationVpnClient, revokeRouterMigrationVpnClient } from "../lib/router-migration-vpn.js";
import { ROUTER_MANAGEMENT_VPN_BACKUP, readRouterManagementCaCertificate } from "../lib/router-management-vpn.js";
import { getRouterCreds } from "./mikrotik-route.js";

const router = Router();
const ACTIVE_TUNNEL_STATUSES = ["issued", "script_issued", "connected", "exported"];
const SAFE_SELECT_JOB = "id,admin_id,source_router_id,target_router_id,source_label,source_mode,target_mode,status,ciphertext,iv,auth_tag,findings_json,plan_json,stages_json,verification_json,audit_json,pre_state_ciphertext,pre_state_iv,pre_state_auth_tag,created_at,updated_at,completed_at";
const SAFE_SELECT_TUNNEL = "id,admin_id,source_router_id,migration_job_id,username,assigned_ip,server_endpoint,bootstrap_token_hash,ciphertext,iv,auth_tag,status,expires_at,verified_at,revoked_at";

type MigrationJob = {
  id: number;
  admin_id: number;
  source_router_id: number | null;
  target_router_id: number | null;
  source_label: string | null;
  source_mode: string;
  target_mode: "adopt_source" | "replace_router";
  status: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  findings_json?: Record<string, unknown>;
  plan_json?: Record<string, unknown>;
};

type MigrationTunnel = {
  id: number;
  admin_id: number;
  source_router_id: number;
  migration_job_id: number;
  username: string;
  assigned_ip: string;
  server_endpoint: string;
  bootstrap_token_hash: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  status: string;
  expires_at: string;
  verified_at?: string | null;
  revoked_at?: string | null;
};

type SourceRouter = {
  id: number;
  admin_id: number;
  name?: string | null;
  status?: string | null;
  host?: string | null;
  vpn_ip?: string | null;
  bridge_ip?: string | null;
  router_secret?: string | null;
  username?: string | null;
  identity?: string | null;
  serial?: string | null;
};

type TunnelPayload = {
  password: string;
  apiUsername: string;
  apiPassword: string;
};

function positiveId(value: unknown): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function isAdminRequest(req: Request): boolean {
  return req.authUser?.type === "a";
}

async function tenantIdFor(req: Request, res: Response): Promise<number> {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "An ISP admin account is required." });
    return 0;
  }
  const adminId = await authenticatedTenantAdminId(req);
  if (!Number.isSafeInteger(adminId) || adminId <= 0) {
    res.status(403).json({ error: "The signed-in ISP account could not be verified." });
    return 0;
  }
  return adminId;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encryptJson(value: unknown) {
  return encryptVpnSecret(JSON.stringify(value));
}

function decryptJson<T>(record: { ciphertext: string; iv: string; auth_tag: string }): T {
  return JSON.parse(decryptVpnSecret(record)) as T;
}

function buildOwnerFilter(adminId: number): string {
  return `&admin_id=eq.${adminId}`;
}

async function loadRouter(adminId: number, idValue: unknown, res?: Response): Promise<SourceRouter | null> {
  const id = positiveId(idValue);
  if (!id) {
    res?.status(400).json({ error: "A valid router id is required." });
    return null;
  }
  const ownerFilter = buildOwnerFilter(adminId);
  const rows = await sbSelectStrict<SourceRouter>(
    "isp_routers",
    `id=eq.${id}${ownerFilter}&select=id,admin_id,name,status,host,vpn_ip,bridge_ip,router_secret,username,identity,serial&limit=1`,
  );
  if (!rows[0]) {
    res?.status(404).json({ error: "Router not found for this ISP account." });
    return null;
  }
  return rows[0];
}

async function loadJob(adminId: number, idValue: unknown, res?: Response): Promise<MigrationJob | null> {
  const id = positiveId(idValue);
  if (!id) {
    res?.status(400).json({ error: "A valid migration job id is required." });
    return null;
  }
  const ownerFilter = buildOwnerFilter(adminId);
  const rows = await sbSelectStrict<MigrationJob>(
    "router_migration_jobs",
    `id=eq.${id}${ownerFilter}&select=${SAFE_SELECT_JOB}&limit=1`,
  );
  if (!rows[0]) {
    res?.status(404).json({ error: "Migration job not found for this ISP account." });
    return null;
  }
  return rows[0];
}

async function loadTunnel(adminId: number, jobId: number): Promise<MigrationTunnel | null> {
  const rows = await sbSelectStrict<MigrationTunnel>(
    "router_migration_tunnel_leases",
    `migration_job_id=eq.${jobId}&admin_id=eq.${adminId}&select=${SAFE_SELECT_TUNNEL}&limit=1`,
  );
  return rows[0] ?? null;
}

async function updateJob(adminId: number, jobId: number, values: Record<string, unknown>): Promise<void> {
  const owner = buildOwnerFilter(adminId);
  const rows = await sbUpdateStrict<MigrationJob>(
    "router_migration_jobs",
    `id=eq.${jobId}${owner}`,
    values,
  );
  if (!rows.length) throw new Error("Migration job update failed.");
}

async function updateTunnel(adminId: number, tunnelId: number, values: Record<string, unknown>): Promise<void> {
  const rows = await sbUpdateStrict<MigrationTunnel>(
    "router_migration_tunnel_leases",
    `id=eq.${tunnelId}&admin_id=eq.${adminId}`,
    values,
  );
  if (!rows.length) throw new Error("Migration tunnel update failed.");
}

function vpnEndpointHost(): string {
  const configured = String(process.env.ROUTER_MANAGEMENT_VPN_HOST ?? process.env.VPS_HOST ?? "").trim();
  if (!configured) throw new Error("The isolated management VPN endpoint is not configured.");
  let host = configured;
  if (configured.includes("://")) {
    try { host = new URL(configured).hostname; }
    catch { throw new Error("The isolated management VPN endpoint is invalid."); }
  }
  if (!/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) {
    throw new Error("The isolated management VPN endpoint is invalid.");
  }
  return host;
}

function publicApiOrigin(req: Request): string {
  const configured = String(process.env.ROUTER_MIGRATION_PUBLIC_API_ORIGIN ?? "").trim();
  let url: URL;
  if (configured) {
    try { url = new URL(configured); }
    catch { throw new Error("The migration API public origin is invalid."); }
  } else {
    const forwardedProto = String(req.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
    const protocol = req.secure || forwardedProto === "https" ? "https:" : "";
    const hostname = String(req.hostname ?? "").toLowerCase();
    const allowedHost = hostname === "isplatty.org" || hostname.endsWith(".isplatty.org");
    if (protocol !== "https:" || !allowedHost) {
      throw new Error("Set ROUTER_MIGRATION_PUBLIC_API_ORIGIN to the tenant API's public HTTPS origin.");
    }
    url = new URL(`${protocol}//${hostname}`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The migration API public origin must use HTTPS.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.replace(/\/api$/, "");
}

async function routerIdentity(creds: RouterCredentials): Promise<{ identity: string; serial: string; version: string; board: string }> {
  const [identityRows, resourceRows, boardRows] = await Promise.all([
    runRouterCommand(creds, ["/system/identity/print"]),
    runRouterCommand(creds, ["/system/resource/print"]),
    runRouterCommand(creds, ["/system/routerboard/print"]),
  ]);
  const identity = String(identityRows[0]?.name ?? "").trim();
  const version = String(resourceRows[0]?.version ?? "").trim();
  const board = String(boardRows[0]?.["board-name"] ?? "").trim();
  const serial = String(boardRows[0]?.["serial-number"] ?? "").trim();
  if (!identity || !version) throw new Error("RouterOS identity preflight did not return a device identity and version.");
  return { identity, serial, version, board };
}

function pkgFromJob(job: MigrationJob): Record<string, unknown> {
  return decryptJson<Record<string, unknown>>(job);
}

function planForPackage(pkg: Record<string, unknown>): MigrationPlan {
  const plan = buildMigrationPlan(pkg, { assetSelection: { plans: true, pppoe: true, hotspot: true } });
  // Source passwords that are unavailable or redacted must never result in a
  // password-less RouterOS account being created on the target.
  const credentialCategories = new Set(["ppp_secrets", "hotspot_users", "local_ppp_secrets", "local_hotspot_users"]);
  const importable = plan.items.filter(item => {
    if (!credentialCategories.has(item.category)) return true;
    const index = Number(item.id.split(":").at(-1));
    const rows = Array.isArray(pkg[item.category]) ? pkg[item.category] as Record<string, unknown>[] : [];
    const password = rows[index]?.password;
    if (typeof password === "string" && password.length > 0 && password !== MANUAL) {
      item.command.push(`=password=${password}`);
      return true;
    }
    plan.unsupported.push({
      ...item,
      command: [],
      supported: false,
      reason: "Credential is unavailable; configure this account manually on the target.",
    });
    return false;
  });
  plan.items = importable;
  return plan;
}

function safePackageSummary(pkg: Record<string, unknown>) {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  return {
    counts,
    warnings: Array.isArray(pkg.warnings) ? pkg.warnings : [],
    manualConfigurationCount: Array.isArray(pkg.manual_configuration_required)
      ? pkg.manual_configuration_required.length
      : 0,
  };
}

async function revokeTunnel(adminId: number, tunnel: MigrationTunnel): Promise<void> {
  // Remove only resources carrying this migration's unique names/comments.
  // Keep the RouterOS expiry scheduler so it can also restore API's previous
  // disabled state after an explicit early revocation.
  try {
    const payload = decryptJson<TunnelPayload>(tunnel);
    const creds: RouterCredentials = {
      host: String(tunnel.assigned_ip).split("/")[0]!,
      port: 8728,
      username: payload.apiUsername,
      password: payload.apiPassword,
    };
    const removeNamed = async (
      printPath: string,
      removePath: string,
      key: string,
      value: string,
    ) => {
      const rows = await runRouterCommand(creds, [printPath]);
      for (const row of rows) {
        if (row[key] && row[key] === value && row[".id"]) {
          await runRouterCommand(creds, [removePath, `=.id=${row[".id"]}`]);
        }
      }
    };
    await removeNamed(
      "/ip/firewall/filter/print",
      "/ip/firewall/filter/remove",
      "comment",
      `ochola-migration-${tunnel.migration_job_id}`,
    );
    await removeNamed(
      "/user/print",
      "/user/remove",
      "name",
      payload.apiUsername,
    );
    await removeNamed(
      "/interface/ovpn-client/print",
      "/interface/ovpn-client/remove",
      "name",
      `ochola-mig-${tunnel.migration_job_id}`,
    );
  } catch {
    // The one-hour RouterOS scheduler and VPS systemd timer remain in place.
  }
  await revokeRouterMigrationVpnClient(tunnel.username);
  await updateTunnel(adminId, tunnel.id, { status: "revoked", revoked_at: new Date().toISOString() });
}

async function failTunnelSetup(adminId: number, tunnel: MigrationTunnel): Promise<void> {
  try {
    await revokeRouterMigrationVpnClient(tunnel.username);
    await updateTunnel(adminId, tunnel.id, {
      status: "server_unavailable",
      revoked_at: new Date().toISOString(),
    });
  } catch {
    // Keep the lease active and its IP reserved until later revocation succeeds.
  }
}

let expirySweepRunning = false;
async function sweepExpiredMigrationTunnels(): Promise<void> {
  if (expirySweepRunning) return;
  expirySweepRunning = true;
  try {
    const now = new Date().toISOString();
    const expired = await sbSelectStrict<MigrationTunnel>(
      "router_migration_tunnel_leases",
      `status=in.(${ACTIVE_TUNNEL_STATUSES.join(",")})&expires_at=lte.${encodeURIComponent(now)}&select=${SAFE_SELECT_TUNNEL}&limit=100`,
    );
    for (const tunnel of expired) {
      try {
        await revokeRouterMigrationVpnClient(tunnel.username);
        await updateTunnel(tunnel.admin_id, tunnel.id, {
          status: "expired",
          revoked_at: new Date().toISOString(),
        });
      } catch {
        // Keep the lease reserved until the remote expiry/revocation succeeds.
      }
    }
  } catch {
    // Remote VPS systemd timers remain the last-resort credential expiry.
  } finally {
    expirySweepRunning = false;
  }
}

const migrationExpiryTimer = setInterval(() => {
  void sweepExpiredMigrationTunnels();
}, 60_000);
migrationExpiryTimer.unref?.();
void sweepExpiredMigrationTunnels();

function handleError(res: Response, error: unknown, safeMessage: string, status = 500) {
  // Router credentials and RouterOS exports must not be echoed into API
  // responses or logs.
  res.status(status).json({ error: safeMessage });
  void error;
}

router.post(
  "/router-migrations/collector-upload",
  express.text({ type: ["text/plain", "application/octet-stream"], limit: "8mb" }),
  async (req, res) => {
    try {
      const rawToken = String(req.query.token ?? "").trim();
      const tokenHash = sha256(rawToken);
      const chunkIndex = Number(req.query.chunk);
      const totalChunks = Number(req.query.total);
      const isFinal = String(req.query.final ?? "").toLowerCase() === "true";
      const chunk = typeof req.body === "string" ? req.body : "";
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(rawToken) ||
          !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 2500 ||
          !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 2501 ||
          chunkIndex >= totalChunks || !chunk || Buffer.byteLength(chunk, "utf8") > 50_000) {
        res.status(400).json({ error: "Invalid migration upload chunk." });
        return;
      }
      const tokens = await sbSelectStrict<{
        token_hash: string;
        admin_id: number;
        source_label: string;
        expires_at: string;
        used_at: string | null;
        migration_job_id: number;
        tunnel_lease_id: number;
      }>(
        "router_migration_collector_tokens",
        `token_hash=eq.${tokenHash}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=token_hash,admin_id,source_label,expires_at,used_at,migration_job_id,tunnel_lease_id&limit=1`,
      );
      const token = tokens[0];
      if (!token || !token.migration_job_id || !token.tunnel_lease_id) {
        res.status(401).json({ error: "Migration upload token is invalid, expired, or already used." });
        return;
      }
      const tunnelRows = await sbSelectStrict<MigrationTunnel>(
        "router_migration_tunnel_leases",
        `id=eq.${token.tunnel_lease_id}&admin_id=eq.${token.admin_id}&select=${SAFE_SELECT_TUNNEL}&limit=1`,
      );
      const tunnel = tunnelRows[0];
      if (!tunnel || tunnel.status !== "connected") {
        res.status(409).json({ error: "The source RouterOS tunnel must pass its authenticated preflight before upload." });
        return;
      }
      const encrypted = encryptVpnSecret(chunk);
      await sbRpc<boolean>("store_router_migration_collector_chunk", {
        p_token_hash: tokenHash,
        p_chunk_index: chunkIndex,
        p_ciphertext: encrypted.ciphertext,
        p_iv: encrypted.iv,
        p_auth_tag: encrypted.auth_tag,
      });
      if (!isFinal) {
        res.status(202).json({ ok: true, chunk: chunkIndex });
        return;
      }
      const chunks = await sbSelectStrict<{
        chunk_index: number;
        ciphertext: string;
        iv: string;
        auth_tag: string;
      }>(
        "router_migration_collector_chunks",
        `token_hash=eq.${tokenHash}&select=chunk_index,ciphertext,iv,auth_tag&order=chunk_index.asc`,
      );
      if (chunks.length !== totalChunks || chunks.some((item, index) => Number(item.chunk_index) !== index)) {
        res.status(409).json({ error: "The RouterOS export is incomplete; rerun the collector script." });
        return;
      }
      const rawExport = chunks.map(item => decryptVpnSecret(item)).join("");
      if (Buffer.byteLength(rawExport, "utf8") > 8_000_000) {
        res.status(413).json({ error: "The RouterOS export is larger than the migration limit." });
        return;
      }
      const pkg = parseRouterOsExport(rawExport);
      pkg.raw_export = rawExport;
      const job = await loadJob(token.admin_id, token.migration_job_id);
      if (!job) {
        res.status(404).json({ error: "Migration job is no longer available." });
        return;
      }
      const identity = (job.findings_json?.sourceIdentity ?? {}) as Record<string, unknown>;
      pkg.source_identity = identity;
      const safe = safePackageSummary(pkg);
      const encryptedPackage = encryptJson(pkg);
      const consumed = await sbRpc<{ admin_id: number; source_label: string }>(
        "consume_router_migration_collector_token",
        { p_token_hash: tokenHash },
      );
      if (!consumed.length) {
        res.status(401).json({ error: "Migration upload token was already consumed." });
        return;
      }
      await updateJob(token.admin_id, job.id, {
        ciphertext: encryptedPackage.ciphertext,
        iv: encryptedPackage.iv,
        auth_tag: encryptedPackage.auth_tag,
        status: "exported",
        findings_json: {
          ...job.findings_json,
          ...safe,
          uploadedAt: new Date().toISOString(),
          sourceIdentity: identity,
        },
      });
      await updateTunnel(token.admin_id, tunnel.id, {
        status: "exported",
        audit_json: { exportReceived: true, chunkCount: chunks.length },
      });
      await sbDeleteStrict("router_migration_collector_chunks", `token_hash=eq.${tokenHash}`);
      await revokeTunnel(token.admin_id, { ...tunnel, status: "exported" });
      res.json({ ok: true, jobId: job.id, summary: safe });
    } catch (error) {
      handleError(res, error, "Migration upload could not be stored safely.");
    }
  },
);

router.use("/router-migrations", requireAuth());

router.get("/router-migrations/routers", async (req, res) => {
  try {
    const adminId = await tenantIdFor(req, res);
    if (!adminId) return;
    const rows = await sbSelectStrict<SourceRouter>(
      "isp_routers",
      `admin_id=eq.${adminId}&select=id,name,status,host,vpn_ip,bridge_ip&order=id.asc`,
    );
    res.json({ routers: rows });
  } catch (error) {
    handleError(res, error, "Routers could not be loaded.");
  }
});

router.post("/router-migrations/jobs", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  let jobId = 0;
  let tunnel: MigrationTunnel | null = null;
  try {
    const source = await loadRouter(adminId, req.body?.sourceRouterId, res);
    if (!source) return;
    const initial = encryptJson({});
    const jobs = await sbInsertStrict<MigrationJob>("router_migration_jobs", {
      admin_id: adminId,
      source_router_id: source.id,
      target_router_id: null,
      source_label: String(source.name ?? `Router ${source.id}`).slice(0, 100),
      source_mode: "domain_collector",
      target_mode: "replace_router",
      status: "source_pending",
      ciphertext: initial.ciphertext,
      iv: initial.iv,
      auth_tag: initial.auth_tag,
      findings_json: { warnings: ["Sensitive RouterOS export is encrypted at rest and never returned to the browser."] },
      plan_json: {},
      stages_json: {},
      verification_json: {},
      audit_json: {},
    });
    const job = jobs[0];
    if (!job) throw new Error("Could not create migration job.");
    jobId = job.id;

    const endpoint = vpnEndpointHost();
    const vpnUsername = `mig-${job.id}-${randomBytes(4).toString("hex")}`;
    const vpnPassword = randomBytes(32).toString("base64url");
    const apiUsername = `mapi-${job.id}-${randomBytes(4).toString("hex")}`;
    const apiPassword = randomBytes(32).toString("base64url");
    const bootstrapToken = randomBytes(32).toString("base64url");
    const tunnelPayload: TunnelPayload = { password: vpnPassword, apiUsername, apiPassword };
    const encryptedPayload = encryptJson(tunnelPayload);
    const leases = await sbRpc<{ lease_id: number; assigned_ip: string }>(
      "issue_router_migration_tunnel_lease",
      {
        p_admin_id: adminId,
        p_source_router_id: source.id,
        p_migration_job_id: job.id,
        p_username: vpnUsername,
        p_server_endpoint: endpoint,
        p_bootstrap_token_hash: sha256(bootstrapToken),
        p_ciphertext: encryptedPayload.ciphertext,
        p_iv: encryptedPayload.iv,
        p_auth_tag: encryptedPayload.auth_tag,
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    );
    const lease = leases[0];
    if (!lease) throw new Error("The migration VPN address could not be reserved.");
    tunnel = await loadTunnel(adminId, job.id);
    if (!tunnel) throw new Error("The temporary migration VPN lease was not saved.");
    try {
      await provisionRouterMigrationVpnClient({
        username: vpnUsername,
        password: vpnPassword,
        assignedIp: String(lease.assigned_ip).split("/")[0]!,
      });
    } catch {
      await failTunnelSetup(adminId, tunnel);
      await updateJob(adminId, job.id, { status: "failed" });
      res.status(503).json({ error: "The isolated management VPN could not provision this temporary source tunnel." });
      return;
    }
    const ca = readRouterManagementCaCertificate();
    if (!ca) {
      await failTunnelSetup(adminId, tunnel);
      await updateJob(adminId, job.id, { status: "failed" });
      res.status(503).json({ error: "The management VPN CA certificate is unavailable; no tunnel script was issued." });
      return;
    }
    const script = buildMigrationTunnelScript({
      endpoint,
      port: ROUTER_MANAGEMENT_VPN_BACKUP.port,
      username: vpnUsername,
      password: vpnPassword,
      tunnelIp: String(lease.assigned_ip).split("/")[0]!,
      interfaceName: `ochola-mig-${job.id}`,
      firewallComment: `ochola-migration-${job.id}`,
      schedulerName: `ochola-mig-exp-${job.id}`,
      apiUsername,
      apiPassword,
      caCertificatePem: ca,
    });
    await updateTunnel(adminId, tunnel.id, { status: "script_issued" });
    await updateJob(adminId, job.id, { status: "tunnel_issued" });
    res.status(201).json({
      jobId: job.id,
      tunnelScript: script,
      tunnelAddress: String(lease.assigned_ip).split("/")[0],
      expiresAt: tunnel.expires_at,
      warning: "The tunnel account expires automatically. Run this script on the source MikroTik; it does not change billing or promote a router.",
    });
  } catch (error) {
    if (tunnel) {
      await failTunnelSetup(adminId, tunnel);
    }
    if (jobId) {
      try { await updateJob(adminId, jobId, { status: "failed" }); } catch { /* preserve original failure */ }
    }
    handleError(res, error, "The temporary source migration tunnel could not be issued.");
  }
});

router.post("/router-migrations/jobs/:id/verify", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    const tunnel = await loadTunnel(adminId, job.id);
    if (!tunnel || !["script_issued", "connected"].includes(tunnel.status)) {
      res.status(409).json({ error: "Issue and run the temporary tunnel script before RouterOS verification." });
      return;
    }
    const payload = decryptJson<TunnelPayload>(tunnel);
    const creds: RouterCredentials = {
      host: String(tunnel.assigned_ip).split("/")[0]!,
      port: 8728,
      username: payload.apiUsername,
      password: payload.apiPassword,
    };
    const identity = await routerIdentity(creds);
    await updateTunnel(adminId, tunnel.id, { status: "connected", verified_at: new Date().toISOString() });
    await updateJob(adminId, job.id, {
      status: job.status === "exported" ? "exported" : "connected",
      findings_json: {
        ...job.findings_json,
        sourceIdentity: identity,
        sourceVersion: identity.version,
        sourceBoard: identity.board,
      },
    });
    res.json({ ok: true, identity, readOnly: true });
  } catch (error) {
    handleError(res, error, "RouterOS tunnel verification failed. Confirm that the temporary script is running and the API service is reachable.", 502);
  }
});

router.get("/router-migrations/jobs/:id/tunnel-script", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    const tunnel = await loadTunnel(adminId, job.id);
    if (!tunnel || !["issued", "script_issued", "connected"].includes(tunnel.status) ||
        Date.parse(tunnel.expires_at) <= Date.now()) {
      res.status(409).json({ error: "The source tunnel is no longer available; start a new migration session." });
      return;
    }
    const payload = decryptJson<TunnelPayload>(tunnel);
    const ca = readRouterManagementCaCertificate();
    if (!ca) {
      res.status(503).json({ error: "The management VPN CA certificate is unavailable." });
      return;
    }
    const script = buildMigrationTunnelScript({
      endpoint: tunnel.server_endpoint,
      port: ROUTER_MANAGEMENT_VPN_BACKUP.port,
      username: tunnel.username,
      password: payload.password,
      tunnelIp: String(tunnel.assigned_ip).split("/")[0]!,
      interfaceName: `ochola-mig-${job.id}`,
      firewallComment: `ochola-migration-${job.id}`,
      schedulerName: `ochola-mig-exp-${job.id}`,
      apiUsername: payload.apiUsername,
      apiPassword: payload.apiPassword,
      caCertificatePem: ca,
    });
    await updateTunnel(adminId, tunnel.id, { status: "script_issued" });
    res.json({ tunnelScript: script, expiresAt: tunnel.expires_at });
  } catch (error) {
    handleError(res, error, "The source tunnel script could not be regenerated.");
  }
});

router.post("/router-migrations/jobs/:id/collector-script", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    const tunnel = await loadTunnel(adminId, job.id);
    if (!tunnel || tunnel.status !== "connected") {
      res.status(409).json({ error: "Verify RouterOS API access through the temporary tunnel before generating the collector handoff." });
      return;
    }
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const apiOrigin = publicApiOrigin(req);
    const uploadUrl = `${apiOrigin}/api/router-migrations/collector-upload?token=${encodeURIComponent(rawToken)}`;
    const tokenHash = sha256(rawToken);
    await sbInsertStrict("router_migration_collector_tokens", {
      token_hash: tokenHash,
      admin_id: adminId,
      source_label: job.source_label ?? `Router ${job.source_router_id}`,
      expires_at: expiresAt,
      migration_job_id: job.id,
      tunnel_lease_id: tunnel.id,
    });
    const script = buildDomainRouterExportScript(uploadUrl);
    res.json({
      collectorScript: script,
      readOnlyPreviewScript: READ_ONLY_ROUTER_EXPORT_SCRIPT,
      expiresAt,
      warning: "The collector exports sensitive configuration into encrypted server-side storage. It never returns the raw export to the browser.",
    });
  } catch (error) {
    handleError(res, error, "The source export handoff could not be created.");
  }
});

router.get("/router-migrations/jobs/:id", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    const tunnel = await loadTunnel(adminId, job.id);
    res.json({
      id: job.id,
      sourceRouterId: job.source_router_id,
      sourceLabel: job.source_label,
      targetRouterId: job.target_router_id,
      targetMode: job.target_mode,
      status: job.status,
      findings: job.findings_json ?? {},
      plan: job.plan_json ?? {},
      tunnel: tunnel ? {
        status: tunnel.status,
        expiresAt: tunnel.expires_at,
        verifiedAt: tunnel.verified_at ?? null,
      } : null,
    });
  } catch (error) {
    handleError(res, error, "Migration status could not be loaded.");
  }
});

router.post("/router-migrations/jobs/:id/target", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    if (job.status !== "exported" && job.status !== "target_selected") {
      res.status(409).json({ error: "A complete source export is required before choosing an outcome." });
      return;
    }
    const mode = req.body?.mode === "adopt_source" ? "adopt_source" : "replace_router";
    if (mode === "adopt_source") {
      if (!job.source_router_id) {
        res.status(409).json({ error: "This source must be registered through the existing router onboarding flow before adoption." });
        return;
      }
      await updateJob(adminId, job.id, {
        target_router_id: null,
        target_mode: "adopt_source",
        status: "target_selected",
      });
      res.json({ ok: true, mode, targetRouterId: null, writesWillOccur: false });
      return;
    }
    const target = await loadRouter(adminId, req.body?.targetRouterId, res);
    if (!target) return;
    if (!job.source_router_id) {
      res.status(409).json({ error: "The source router must be registered before using a replacement target." });
      return;
    }
    const sourceIdentity = (job.findings_json?.sourceIdentity ?? {}) as Record<string, unknown>;
    const source = await loadRouter(adminId, job.source_router_id);
    if (!source) {
      res.status(404).json({ error: "The migration source router is no longer available." });
      return;
    }
    const targetData = await getRouterCreds(target.id, adminId);
    if (!targetData) {
      res.status(409).json({ error: "The replacement router does not have stored RouterOS access for preflight." });
      return;
    }
    const targetIdentity = await routerIdentity(targetData.creds);
    assertDistinctTargets(
      {
        id: job.source_router_id,
        host: String(source.host ?? source.vpn_ip ?? ""),
        identity: String(sourceIdentity.identity ?? ""),
        serial: String(sourceIdentity.serial ?? ""),
      },
      {
        id: target.id,
        host: String(target.host ?? target.vpn_ip ?? ""),
        identity: targetIdentity.identity,
        serial: targetIdentity.serial,
      },
    );
    await updateJob(adminId, job.id, {
      target_router_id: target.id,
      target_mode: "replace_router",
      status: "target_selected",
      findings_json: { ...job.findings_json, targetIdentity },
    });
    res.json({ ok: true, mode, targetRouterId: target.id, targetIdentity });
  } catch (error) {
    const message = error instanceof Error && error.message === "Source and target router must be distinct."
      ? error.message
      : "Replacement router preflight failed; choose a distinct, reachable target.";
    handleError(res, error, message, 409);
  }
});

router.get("/router-migrations/jobs/:id/plan", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    if (job.status !== "target_selected" && job.status !== "dry_run") {
      res.status(409).json({ error: "Choose an outcome before loading the migration plan." });
      return;
    }
    if (job.target_mode === "adopt_source") {
      res.json({
        mode: "adopt_source",
        items: [],
        unsupported: [],
        warnings: ["The inspected source router remains the adopted router. No RouterOS or billing records will be written."],
      });
      return;
    }
    const pkg = pkgFromJob(job);
    const plan = redactMigrationPlan(planForPackage(pkg));
    const stored = {
      items: plan.items.map(({ id, category, command, supported, reason }) => ({ id, category, command, supported, reason })),
      unsupported: plan.unsupported.map(({ id, category, supported, reason }) => ({ id, category, supported, reason })),
      warnings: plan.warnings,
    };
    await updateJob(adminId, job.id, { plan_json: stored });
    res.json({ mode: "replace_router", ...stored });
  } catch (error) {
    handleError(res, error, "The migration review plan could not be generated.");
  }
});

router.post("/router-migrations/jobs/:id/dry-run", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    if (job.status !== "target_selected" && job.status !== "dry_run") {
      res.status(409).json({ error: "Choose and review a migration outcome before dry-run." });
      return;
    }
    if (job.target_mode === "adopt_source") {
      await updateJob(adminId, job.id, { status: "dry_run" });
      res.json({ dryRun: true, commands: [], approved: [], warnings: ["Adoption performs no target writes."] });
      return;
    }
    const approvedIds: string[] = Array.isArray(req.body?.approvedIds)
      ? (req.body.approvedIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const pkg = pkgFromJob(job);
    const plan = planForPackage(pkg);
    if (approvedIds.some(id => !plan.items.some(item => item.id === id))) {
      res.status(400).json({ error: "The approval list includes an unknown or unsupported item." });
      return;
    }
    const result = await executeMigrationPlan(plan, async () => {
      throw new Error("Dry-run must not connect to the RouterOS target.");
    }, approvedIds, true);
    await updateJob(adminId, job.id, {
      status: "dry_run",
      plan_json: redactMigrationPlan(plan),
      audit_json: { dryRunAt: new Date().toISOString(), approvedIds },
    });
    res.json({
      dryRun: true,
      commands: result.commands.map(command => command.map(word => word.startsWith("=password=") ? "=password=REQUIRES_MANUAL_CONFIGURATION" : word)),
      approved: approvedIds,
      warnings: plan.warnings,
    });
  } catch (error) {
    handleError(res, error, "The migration dry-run failed.");
  }
});

router.post("/router-migrations/jobs/:id/apply", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  const job = await loadJob(adminId, req.params.id, res);
  if (!job) return;
  if (job.status !== "dry_run") {
    res.status(409).json({ error: "Run and review the dry-run before applying changes." });
    return;
  }
  if (job.target_mode === "adopt_source") {
    try {
      await updateJob(adminId, job.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_json: { adoptedSource: true, routerWrites: 0, billingWrites: 0 },
      });
      const tunnel = await loadTunnel(adminId, job.id);
      if (tunnel && ACTIVE_TUNNEL_STATUSES.includes(tunnel.status)) await revokeTunnel(adminId, tunnel);
      res.json({ completed: true, adoptedSource: true, routerWrites: 0, billingWrites: 0 });
    } catch (error) {
      handleError(res, error, "Source adoption could not be recorded.");
    }
    return;
  }
  let targetLeaseToken = "";
  try {
    if (!job.target_router_id) {
      res.status(409).json({ error: "A replacement target must be selected." });
      return;
    }
    const approvedIds: string[] = Array.isArray(req.body?.approvedIds)
      ? (req.body.approvedIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const pkg = pkgFromJob(job);
    const plan = planForPackage(pkg);
    if (!approvedIds.length || approvedIds.some(id => !plan.items.some(item => item.id === id))) {
      res.status(400).json({ error: "Select at least one supported item and approve only reviewed rows." });
      return;
    }
    const leaseToken = randomBytes(24).toString("hex");
    const acquired = await sbRpc<{ acquired: boolean }>("acquire_router_migration_target_lease", {
      p_job_id: job.id,
      p_admin_id: adminId,
      p_target_router_id: job.target_router_id,
      p_lease_token: leaseToken,
    });
    if (!acquired[0]?.acquired) {
      res.status(409).json({ error: "Another migration is using this replacement router, or the target review has expired." });
      return;
    }
    targetLeaseToken = leaseToken;
    await updateJob(adminId, job.id, { status: "importing" });
    const target = await getRouterCreds(job.target_router_id, adminId);
    if (!target) throw new Error("Replacement RouterOS credentials are unavailable.");
    const findings = job.findings_json ?? {};
    const sourceIdentity = (findings.sourceIdentity ?? {}) as Record<string, unknown>;
    const source = await loadRouter(adminId, job.source_router_id);
    if (!source) throw new Error("Migration source router is unavailable.");
    const targetIdentity = await routerIdentity(target.creds);
    assertDistinctTargets(
      {
        id: job.source_router_id ?? 0,
        host: String(source.host ?? source.vpn_ip ?? ""),
        identity: String(sourceIdentity.identity ?? ""),
        serial: String(sourceIdentity.serial ?? ""),
      },
      {
        id: job.target_router_id,
        host: String(target.row.host ?? target.row.vpn_ip ?? ""),
        identity: targetIdentity.identity,
        serial: targetIdentity.serial,
      },
    );
    const result = await executeMigrationPlan(
      plan,
      command => runRouterCommand(target.creds, command),
      approvedIds,
      false,
      async preState => {
        const encrypted = encryptJson(preState);
        await updateJob(adminId, job.id, {
          pre_state_ciphertext: encrypted.ciphertext,
          pre_state_iv: encrypted.iv,
          pre_state_auth_tag: encrypted.auth_tag,
        });
      },
    );
    const completed = !result.stopped && result.failures.length === 0;
    const safeVerification = {
      applied: result.applied,
      failures: result.failures,
      stopped: result.stopped,
      verification: result.verification ?? {},
    };
    await updateJob(adminId, job.id, {
      status: completed ? "completed" : "failed",
      completed_at: completed ? new Date().toISOString() : null,
      verification_json: safeVerification,
    });
    res.json({
      completed,
      partial: !completed && result.applied.length > 0,
      applied: result.applied,
      failures: result.failures,
      stopped: result.stopped,
      limitation: "Active RouterOS sessions cannot be transferred. Billing records remain unchanged.",
    });
  } catch (error) {
    try { await updateJob(adminId, job.id, { status: "failed" }); } catch { /* keep the safe response */ }
    handleError(res, error, "The target migration stopped. Review the captured target state before retrying.", 502);
  } finally {
    if (targetLeaseToken && job.target_router_id) {
      try {
        await sbRpc("release_router_migration_target_lease", {
          p_job_id: job.id,
          p_admin_id: adminId,
          p_target_router_id: job.target_router_id,
          p_lease_token: targetLeaseToken,
        });
      } catch { /* the lease expires automatically */ }
    }
  }
});

router.post("/router-migrations/jobs/:id/revoke", async (req, res) => {
  const adminId = await tenantIdFor(req, res);
  if (!adminId) return;
  try {
    const job = await loadJob(adminId, req.params.id, res);
    if (!job) return;
    const tunnel = await loadTunnel(adminId, job.id);
    if (!tunnel) {
      res.json({ revoked: false, message: "No migration tunnel is active." });
      return;
    }
    if (ACTIVE_TUNNEL_STATUSES.includes(tunnel.status)) await revokeTunnel(adminId, tunnel);
    res.json({ revoked: true });
  } catch (error) {
    handleError(res, error, "The temporary migration tunnel could not be revoked.");
  }
});

export default router;