import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  inspectSupabaseMigration,
  MIGRATION_DESTINATION_PROJECT_REF,
  MIGRATION_SOURCE_PROJECT_REF,
  runSupabasePublicMigration,
  SupabaseMigrationError,
  type MigrationDiagnostic,
  type MigrationPlan,
  type SourceBackupArtifact,
  type MigrationVerification,
} from "../lib/supabase-migration.js";

type JobState = "running" | "completed" | "failed";
type JobStage = "checking" | "backing_up" | "copying" | "verifying" | "finished";

interface MigrationJob {
  id: string;
  state: JobState;
  stage: JobStage;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  diagnostic: MigrationDiagnostic | null;
  verification: MigrationVerification | null;
  sourceBackup: SourceBackupArtifact | null;
}

interface RouterDependencies {
  isSuperAdminTokenActive?: (token: string) => boolean;
  inspect?: typeof inspectSupabaseMigration;
  run?: typeof runSupabasePublicMigration;
}

const MAX_JOBS = 12;
const MAX_JOB_AGE_MS = 60 * 60 * 1000;
const MAX_ROOT_CERTIFICATE_LENGTH = 64 * 1024;
const SAFE_ERROR_CODES = new Set([
  "invalid_connection",
  "invalid_certificate",
  "wrong_project",
  "source_connection_failed",
  "destination_connection_failed",
  "source_read_only_unavailable",
  "source_schema_empty",
  "destination_not_empty",
  "missing_extensions",
  "destination_extension_versions_differ",
  "postgres_version_mismatch",
  "stale_plan",
  "unsafe_plan",
  "migration_tools_unavailable",
  "postgres_client_version_mismatch",
  "source_backup_failed",
  "source_backup_integrity_failed",
  "restore_failed",
  "restore_timed_out",
  "verification_failed",
]);

function getSuperAdminToken(req: Request): string {
  const value = req.headers["x-sa-token"];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function requireSameOrigin(req: Request, res: Response): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) {
    res.status(403).json({ ok: false, error: "Same-origin access is required." });
    return false;
  }
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (originHost !== host.toLowerCase()) {
      res.status(403).json({ ok: false, error: "Same-origin access is required." });
      return false;
    }
  } catch {
    res.status(403).json({ ok: false, error: "Same-origin access is required." });
    return false;
  }
  return true;
}

function requireSuperAdmin(
  req: Request,
  res: Response,
  isSuperAdminTokenActive: (token: string) => boolean,
): boolean {
  if (!isSuperAdminTokenActive(getSuperAdminToken(req))) {
    res.status(401).json({ ok: false, error: "A valid Super Admin session is required." });
    return false;
  }
  return true;
}

function validateCredentialBody(body: unknown): {
  sourceDatabaseUrl: string;
  destinationDatabaseUrl: string;
  sourceRootCertificate?: string;
  destinationRootCertificate?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.sourceDatabaseUrl !== "string"
    || typeof record.destinationDatabaseUrl !== "string"
    || record.sourceDatabaseUrl.length > 4096
    || record.destinationDatabaseUrl.length > 4096
    || (record.sourceRootCertificate !== undefined
      && (typeof record.sourceRootCertificate !== "string"
        || record.sourceRootCertificate.length > MAX_ROOT_CERTIFICATE_LENGTH))
    || (record.destinationRootCertificate !== undefined
      && (typeof record.destinationRootCertificate !== "string"
        || record.destinationRootCertificate.length > MAX_ROOT_CERTIFICATE_LENGTH))
  ) {
    return null;
  }
  return {
    sourceDatabaseUrl: record.sourceDatabaseUrl,
    destinationDatabaseUrl: record.destinationDatabaseUrl,
    ...(typeof record.sourceRootCertificate === "string"
      ? { sourceRootCertificate: record.sourceRootCertificate }
      : {}),
    ...(typeof record.destinationRootCertificate === "string"
      ? { destinationRootCertificate: record.destinationRootCertificate }
      : {}),
  };
}

function planBlockers(plan: MigrationPlan): string[] {
  const blockers: string[] = [];
  if (plan.publicObjects.tables.length === 0) blockers.push("source_public_schema_empty");
  if (plan.destinationConflicts.length > 0) blockers.push("destination_public_schema_not_empty");
  if (plan.missingDestinationExtensions.length > 0) blockers.push("destination_extensions_missing");
  if (plan.extensionVersionMismatches.length > 0) blockers.push("destination_extension_versions_differ");
  if (plan.sourcePostgresVersion.split(".")[0] !== plan.destinationPostgresVersion.split(".")[0]) {
    blockers.push("postgres_version_mismatch");
  }
  if (plan.toolFailure) blockers.push(plan.toolFailure.errorCode);
  return blockers;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof SupabaseMigrationError && SAFE_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return "migration_failed";
}

function setNoStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
}

export function createSupabaseMigrationRouter(
  dependencies: RouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const isSuperAdminTokenActive = dependencies.isSuperAdminTokenActive ?? isActiveSuperAdminToken;
  const inspect = dependencies.inspect ?? inspectSupabaseMigration;
  const run = dependencies.run ?? runSupabasePublicMigration;
  const jobs = new Map<string, MigrationJob>();
  let activeJobId: string | null = null;

  function pruneJobs(): void {
    const cutoff = Date.now() - MAX_JOB_AGE_MS;
    for (const [id, job] of jobs) {
      if (job.state !== "running" && Date.parse(job.startedAt) < cutoff) jobs.delete(id);
    }
    while (jobs.size >= MAX_JOBS) {
      const removable = [...jobs.values()].find((job) => job.state !== "running");
      if (!removable) break;
      jobs.delete(removable.id);
    }
  }

  router.post("/super-admin/supabase-migration/preflight", async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    setNoStore(res);
    if (!requireSameOrigin(req, res)) return;
    if (!requireSuperAdmin(req, res, isSuperAdminTokenActive)) return;
    const credentials = validateCredentialBody(req.body);
    if (!credentials) {
      res.status(400).json({ ok: false, error: "Enter both database connection strings." });
      return;
    }

    try {
      const plan = await inspect(
        credentials.sourceDatabaseUrl,
        credentials.destinationDatabaseUrl,
        {
          sourceRootCertificate: credentials.sourceRootCertificate,
          destinationRootCertificate: credentials.destinationRootCertificate,
        },
      );
      res.status(plan.canMigrate ? 200 : 409).json({
        ok: plan.canMigrate,
        scope: "public",
        sourceProjectRef: plan.sourceProjectRef,
        destinationProjectRef: plan.destinationProjectRef,
        sourcePostgresVersion: plan.sourcePostgresVersion,
        destinationPostgresVersion: plan.destinationPostgresVersion,
        tables: plan.tables,
        publicObjects: plan.publicObjects,
        schemaManifest: plan.schemaManifest,
        foreignKeyCount: plan.foreignKeyCount,
        sourceExtensions: plan.sourceExtensions,
        missingDestinationExtensions: plan.missingDestinationExtensions,
        extensionVersionMismatches: plan.extensionVersionMismatches,
        destinationConflicts: plan.destinationConflicts,
        toolFailure: plan.toolFailure ?? null,
        blockers: planBlockers(plan),
        fingerprint: plan.fingerprint,
      });
    } catch (error) {
      const code = safeErrorCode(error);
      const status = code === "wrong_project" || code === "invalid_connection" || code === "invalid_certificate"
        ? 400
        : 422;
      const diagnostic = error instanceof SupabaseMigrationError ? error.diagnostic : undefined;
      res.status(status).json({
        ok: false,
        error: code,
        ...(diagnostic ? { diagnostic } : {}),
      });
    }
  });

  router.post("/super-admin/supabase-migration/run", async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    setNoStore(res);
    if (!requireSameOrigin(req, res)) return;
    if (!requireSuperAdmin(req, res, isSuperAdminTokenActive)) return;
    const credentials = validateCredentialBody(req.body);
    const body = req.body as Record<string, unknown> | null;
    const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint : "";
    const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
    if (
      !credentials
      || !/^[a-f0-9]{64}$/.test(fingerprint)
      || confirmation !== MIGRATION_DESTINATION_PROJECT_REF
    ) {
      res.status(400).json({
        ok: false,
        error: "Re-enter both connections, review the plan, and confirm the destination project ID.",
      });
      return;
    }
    if (activeJobId) {
      res.status(409).json({ ok: false, error: "A migration is already running." });
      return;
    }

    pruneJobs();
    const id = randomUUID();
    const job: MigrationJob = {
      id,
      state: "running",
      stage: "checking",
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorCode: null,
      diagnostic: null,
      verification: null,
      sourceBackup: null,
    };
    jobs.set(id, job);
    activeJobId = id;
    res.status(202).json({ ok: true, jobId: id });

    void run(
      credentials.sourceDatabaseUrl,
      credentials.destinationDatabaseUrl,
      fingerprint,
      {
        sourceRootCertificate: credentials.sourceRootCertificate,
        destinationRootCertificate: credentials.destinationRootCertificate,
        onStage(stage) {
          const activeJob = jobs.get(id);
          if (activeJob?.state === "running") activeJob.stage = stage;
        },
        onSourceBackup(backup) {
          const activeJob = jobs.get(id);
          if (activeJob) activeJob.sourceBackup = backup;
        },
      },
    ).then(({ verification, sourceBackup }) => {
      const activeJob = jobs.get(id);
      if (!activeJob) return;
      activeJob.state = verification.verified ? "completed" : "failed";
      activeJob.stage = "finished";
      activeJob.completedAt = new Date().toISOString();
      activeJob.verification = verification;
      activeJob.sourceBackup = sourceBackup ?? null;
      if (!verification.verified) activeJob.errorCode = "verification_failed";
    }).catch((error: unknown) => {
      const activeJob = jobs.get(id);
      if (!activeJob) return;
      activeJob.state = "failed";
      activeJob.stage = "finished";
      activeJob.completedAt = new Date().toISOString();
      activeJob.errorCode = safeErrorCode(error);
      activeJob.diagnostic = error instanceof SupabaseMigrationError
        ? error.diagnostic ?? null
        : null;
    }).finally(() => {
      if (activeJobId === id) activeJobId = null;
    });
  });

  router.get("/super-admin/supabase-migration/jobs/:id", (
    req: Request,
    res: Response,
  ): void => {
    setNoStore(res);
    if (!requireSameOrigin(req, res)) return;
    if (!requireSuperAdmin(req, res, isSuperAdminTokenActive)) return;
    const rawJobId = req.params.id;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] ?? "" : rawJobId;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: "Migration status is unavailable." });
      return;
    }
    res.json({
      ok: true,
      job: {
        id: job.id,
        state: job.state,
        stage: job.stage,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorCode: job.errorCode,
        diagnostic: job.diagnostic,
        verification: job.verification,
        sourceBackup: job.sourceBackup,
      },
    });
  });

  return router;
}

export default createSupabaseMigrationRouter();
