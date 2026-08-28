import { Router, type IRouter, type Request } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { requireAdmin } from "../lib/api-auth.js";
import { runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { sbInsertStrict, sbRpc, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { assertSourceCommand, exportRouterMigration, SOURCE_PRINT_COMMANDS } from "../lib/router-migration-exporter.js";
import { assertDistinctTargets, buildMigrationPlan, executeMigrationPlan } from "../lib/router-migration-importer.js";
import { READ_ONLY_ROUTER_EXPORT_SCRIPT } from "../lib/router-migration-export-script.js";

const router: IRouter = Router();
const locks = new Set<string>();
type RouterRow = { id: number; admin_id: number; name: string; host: string; bridge_ip?: string; router_username: string; router_secret?: string; identity?: string; serial?: string };
type Job = { id: number; admin_id: number; source_router_id: number; target_router_id?: number; ciphertext?: string; iv?: string; auth_tag?: string; plan_json?: Record<string, unknown>; stages_json?: Record<string, unknown>; verification_json?: Record<string, unknown>; audit_json?: Record<string, unknown>; status: string };

function admin(req: Request): number { const id = Number(req.authUser?.uid); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid administrator identity."); return id; }
function positive(value: unknown): number { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid numeric identifier."); return id; }
function creds(row: RouterRow): RouterCredentials { return { host: row.host, bridgeIp: row.bridge_ip, port: 8728, username: row.router_username || "admin", password: row.router_secret ?? "" }; }
function key() { const secret = process.env.SESSION_SECRET ?? process.env.TOKEN_SIGNING_SECRET; if (!secret) throw new Error("Migration encryption is not configured."); return createHash("sha256").update(secret).digest(); }
function encrypt(value: unknown) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64") }; }
function decrypt(job: Job) { if (!job.ciphertext || !job.iv || !job.auth_tag) throw new Error("Migration package is unavailable."); const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(job.iv, "base64")); decipher.setAuthTag(Buffer.from(job.auth_tag, "base64")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(job.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>; }
async function ownedRouter(id: number, adminId: number) { positive(id); const rows = await sbSelectStrict<RouterRow>("isp_routers", `id=eq.${id}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,router_username,router_secret&limit=1`); if (!rows[0]) throw new Error("Router not found."); return rows[0]; }
async function jobFor(id: number, adminId: number) { positive(id); const rows = await sbSelectStrict<Job>("router_migration_jobs", `id=eq.${id}&admin_id=eq.${adminId}&select=*&limit=1`); if (!rows[0]) throw new Error("Migration not found."); return rows[0]; }
async function guarded(req: Request, fn: (adminId: number) => Promise<void>, res: any) { try { const id = admin(req); const lock = `${id}:${req.params.id ?? req.body.sourceRouterId ?? ""}`; if (locks.has(lock)) { res.status(409).json({ ok: false, error: "Migration is already in progress." }); return; } locks.add(lock); try { await fn(id); } finally { locks.delete(lock); } } catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Migration request failed." }); } }
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

router.use("/router-migrations", requireAdmin());
router.get("/router-migrations/read-only-export-script", (req, res) => {
  try {
    admin(req);
    res.type("text/plain").set("Content-Disposition", 'attachment; filename="ocholasupernet-read-only-export.rsc"').send(READ_ONLY_ROUTER_EXPORT_SCRIPT);
  } catch {
    res.status(401).json({ ok: false, error: "Invalid administrator identity." });
  }
});
router.get("/router-migrations/routers", async (req, res) => guarded(req, async a => {
  const rows = await sbSelectStrict<RouterRow>("isp_routers", `admin_id=eq.${a}&select=id,name,host,status,ros_version&order=name.asc`);
  res.json({ routers: rows });
}, res));
router.post("/router-migrations/analyze", async (req, res) => guarded(req, async a => {
  const source = await ownedRouter(positive(req.body.sourceRouterId), a);
  for (const command of ["/system/identity/print", "/system/resource/print", "/system/routerboard/print", "/system/license/print"]) assertSourceCommand(command);
  const observed = await observeDevice(source);
  res.json({ compatible: true, details: "Read-only compatibility analysis completed.", dataPoints: [{ type: "router", count: 1 }], readOnly: true, identity: { name: observed.identity, version: observed.version, boardName: observed.boardName } });
}, res));
router.post("/router-migrations/export", async (req, res) => guarded(req, async a => {
  const source = await ownedRouter(positive(req.body.sourceRouterId), a);
  const pkg = await exportRouterMigration(creds(source)); const secure = encrypt(pkg); const plan = buildMigrationPlan(pkg);
  const manual = plan.unsupported.filter(x => x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const unsupported = plan.unsupported.filter(x => !x.reason?.includes("Credential")).map(x => `${x.category}: ${x.reason}`);
  const rows = await sbInsertStrict<Job>("router_migration_jobs", { admin_id: a, source_router_id: source.id, status: "exported", ...secure, findings_json: { warnings: pkg.warnings, manual, unsupported }, audit_json: { exported_at: new Date().toISOString(), source_read_only: true } });
  const pools = Array.isArray(pkg.ip_pools) ? pkg.ip_pools.length : 0, users = (Array.isArray(pkg.ppp_secrets) ? pkg.ppp_secrets.length : 0) + (Array.isArray(pkg.hotspot_users) ? pkg.hotspot_users.length : 0);
  const configs = Object.values(pkg).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  res.status(201).json({ id: String(rows[0]?.id), status: "exported", summary: { configs, users, queues: Array.isArray(pkg.queues) ? pkg.queues.length : 0, pools }, findings: { warnings: pkg.warnings, manual, unsupported } });
}, res));
router.get("/router-migrations/:id", async (req, res) => guarded(req, async a => { const j = await jobFor(positive(req.params.id), a); res.json({ id: String(j.id), status: j.status, sourceRouterId: j.source_router_id, targetRouterId: j.target_router_id }); }, res));
router.post("/router-migrations/:id/target", async (req, res) => guarded(req, async a => {
  const job = await jobFor(positive(req.params.id), a), source = await ownedRouter(job.source_router_id, a), target = await ownedRouter(positive(req.body.targetRouterId), a);
  if (job.status !== "exported" && job.status !== "target_selected" && job.status !== "dry_run") throw new Error("Migration is not eligible for target selection.");
  const [s, t] = await Promise.all([observeDevice(source), observeDevice(target)]);
  assertDistinctTargets({ ...source, identity: s.identity, serial: s.fingerprint }, { ...target, identity: t.identity, serial: t.fingerprint });
  await sbUpdateStrict("router_migration_jobs", `id=eq.${job.id}&admin_id=eq.${a}`, { target_router_id: target.id, status: "target_selected", audit_json: { source_identity: s.identity, target_identity: t.identity, source_fingerprint: s.fingerprint, target_fingerprint: t.fingerprint, source_host: source.host, target_host: target.host } });
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
  const job = await jobFor(positive(req.params.id), a); if (!job.target_router_id) throw new Error("Select a target router first."); if (job.status !== "dry_run") throw new Error("A verified dry run is required before import."); const target = await ownedRouter(job.target_router_id, a); const source = await ownedRouter(job.source_router_id, a); const plan = await planJob(job);
  const approved: string[] = Array.isArray(req.body.approvedItemIds) ? req.body.approvedItemIds.filter((x: unknown): x is string => typeof x === "string") : [];
  const dryRunApproved: string[] = Array.isArray((job.stages_json as Record<string, unknown> | undefined)?.approved) ? (job.stages_json as { approved: unknown[] }).approved.filter((x: unknown): x is string => typeof x === "string") : [];
  if (!approved.length || approved.length !== dryRunApproved.length || approved.some(id => !dryRunApproved.includes(id))) throw new Error("Approved items changed after dry run; run the dry run again.");
  /* Fresh identity lock prevents a target swap between review and writes. */
  const [s, t] = await Promise.all([observeDevice(source), observeDevice(target)]);
  assertDistinctTargets({ ...source, identity: s.identity, serial: s.fingerprint }, { ...target, identity: t.identity, serial: t.fingerprint });
  const locked = job.audit_json as Record<string, unknown> | undefined;
  if (locked?.source_fingerprint !== s.fingerprint || locked?.target_fingerprint !== t.fingerprint || locked?.source_host !== source.host || locked?.target_host !== target.host) throw new Error("Source or target device changed since target selection.");
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