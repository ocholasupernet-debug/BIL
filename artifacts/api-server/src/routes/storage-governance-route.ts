import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import {
  sbDelete,
  sbInsertStrict,
  sbRpc,
  sbSelectStrict,
  sbUpdateStrict,
  sbUpsertStrict,
  supabaseServiceRoleConfigured,
} from "../lib/supabase-client.js";
import { requireAdmin } from "../lib/api-auth.js";
import { activeSuperAdminName, isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  measureSupabaseDatabase,
  measureSupabaseStorage,
  measureVpsDisk,
  type StorageTelemetry,
} from "../lib/storage-telemetry.js";

const router: IRouter = Router();
const CLEANUP_SCOPE = "expired_migration_artifacts";
const RETENTION_DAYS = 30;
const MAX_REASON_LENGTH = 500;

type CleanupStatus = "pending" | "processing" | "cancelled" | "completed" | "failed";

interface MeasureRow {
  admin_id: number;
  source: string;
  bytes: number | string;
  row_count: number | string;
}

interface CleanupCandidate {
  id: number;
  admin_id: number;
  source_label: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  bytes: number | string;
  row_count: number | string;
}

interface CleanupRequest {
  id: number;
  admin_id: number;
  scope: string;
  reason: string;
  requested_by: string;
  scheduled_for: string;
  candidate_bytes: number | string;
  candidate_rows: number | string;
  candidate_ids: number[] | string[];
  status: CleanupStatus;
  claimed_at: string | null;
  completed_at: string | null;
  failure_details: string | null;
  created_at: string;
  updated_at: string;
}

function asNumber(value: number | string | null | undefined): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isSuperAdmin(req: Request, res: Response): boolean {
  const token = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  if (isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
  return false;
}

function tenantAdminId(req: Request, res: Response): number | null {
  if (!req.authUser || req.authUser.type !== "a" || req.authUser.uid === "superadmin") {
    res.status(403).json({ ok: false, error: "A signed-in ISP Admin session is required." });
    return null;
  }
  const adminId = parsePositiveId(req.authUser.uid);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "The signed-in ISP Admin identity is invalid." });
    return null;
  }
  return adminId;
}

function parseCandidateIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const ids = value.map(parsePositiveId);
  if (ids.some(id => id === null)) return null;
  return [...new Set(ids as number[])];
}

function parseSchedule(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  const now = Date.now();
  const min = now + 60_000;
  const max = now + 90 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(date.getTime()) || date.getTime() < min || date.getTime() > max) return null;
  return date.toISOString();
}

function cleanupMetadata(request: CleanupRequest): Record<string, unknown> {
  return {
    cleanupRequestId: request.id,
    scope: request.scope,
    scheduledFor: request.scheduled_for,
    candidateRows: asNumber(request.candidate_rows),
    candidateBytes: asNumber(request.candidate_bytes),
  };
}

async function writeAudit(
  request: Partial<CleanupRequest> & { id: number; admin_id: number },
  actorType: "super_admin" | "admin" | "system",
  actorId: string,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sbInsertStrict("platform_storage_audit_logs", {
    cleanup_request_id: request.id,
    admin_id: request.admin_id,
    actor_type: actorType,
    actor_id: actorId,
    action,
    details,
  });
}

async function notifyAdmin(
  request: CleanupRequest,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await sbInsertStrict("platform_admin_notifications", {
    admin_id: request.admin_id,
    notification_type: "storage_cleanup",
    title,
    body,
    cleanup_request_id: request.id,
    metadata: { ...cleanupMetadata(request), ...metadata },
  });
}

async function measureAndPersist(): Promise<MeasureRow[]> {
  if (!supabaseServiceRoleConfigured) {
    throw new Error("Supabase service-role access is required for tenant storage measurement.");
  }
  const rows = await sbRpc<MeasureRow>("platform_storage_measure", {});
  for (const row of rows) {
    const adminId = parsePositiveId(row.admin_id);
    if (!adminId || !row.source) continue;
    await sbUpsertStrict("platform_storage_usage", "admin_id,source", {
      admin_id: adminId,
      source: row.source,
      bytes: Math.max(0, Math.floor(asNumber(row.bytes))),
      row_count: Math.max(0, Math.floor(asNumber(row.row_count))),
      measured_at: new Date().toISOString(),
    });
  }
  return rows;
}

function physicalPublic(measurement: StorageTelemetry) {
  return {
    source: measurement.source,
    status: measurement.status,
    measurementKind: measurement.measurementKind,
    usedBytes: measurement.usedBytes,
    capacityBytes: measurement.capacityBytes,
    freeBytes: measurement.freeBytes,
    measuredAt: measurement.measuredAt,
    error: measurement.error,
    details: measurement.details ?? {},
  };
}

async function persistPhysicalMeasurements(measurements: StorageTelemetry[]): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  const results = await Promise.allSettled(measurements.map(measurement => sbUpsertStrict(
    "platform_storage_physical_usage",
    "source",
    {
      source: measurement.source,
      status: measurement.status,
      measurement_kind: measurement.measurementKind,
      used_bytes: measurement.usedBytes,
      capacity_bytes: measurement.capacityBytes,
      free_bytes: measurement.freeBytes,
      details: measurement.details ?? {},
      measured_at: measurement.measuredAt,
      error: measurement.error,
    },
  )));
  if (results.some(result => result.status === "rejected")) {
    logger.warn("[super-admin/storage] physical telemetry snapshot could not be persisted");
  }
}

async function getCleanupRequest(id: number): Promise<CleanupRequest | null> {
  const rows = await sbSelectStrict<CleanupRequest>(
    "platform_storage_cleanup_requests",
    `id=eq.${id}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

async function executeRequest(request: CleanupRequest, actorType: "system" | "super_admin", actorId: string): Promise<{
  deletedRows: number;
  deletedBytes: number;
  status: string;
}> {
  try {
    const result = await sbRpc<{
      request_id: number;
      deleted_rows: number | string;
      deleted_bytes: number | string;
      final_status: string;
    }>("platform_execute_storage_cleanup", { p_request_id: request.id });
    const completed = result[0] ?? {
      request_id: request.id,
      deleted_rows: 0,
      deleted_bytes: 0,
      final_status: request.status,
    };
    const deletedRows = asNumber(completed.deleted_rows);
    const deletedBytes = asNumber(completed.deleted_bytes);
    if (completed.final_status === "completed") {
      await writeAudit(request, actorType, actorId, "cleanup_completed", {
        deletedRows,
        deletedBytes,
      });
      await notifyAdmin(
        request,
        "Scheduled data cleanup completed",
        `The approved cleanup for ${deletedRows} aged migration item(s) completed and released ${deletedBytes} measured bytes.`,
        { status: "completed", deletedRows, deletedBytes },
      );
    }
    return { deletedRows, deletedBytes, status: completed.final_status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup execution failed.";
    await sbUpdateStrict(
      "platform_storage_cleanup_requests",
      `id=eq.${request.id}&status=eq.processing`,
      { status: "failed", failure_details: message.slice(0, 1000), updated_at: new Date().toISOString() },
    );
    await writeAudit(request, actorType, actorId, "cleanup_failed", { error: message.slice(0, 1000) });
    await notifyAdmin(
      request,
      "Scheduled data cleanup failed",
      "The scheduled cleanup could not be completed. No further automatic retry will run until it is reviewed by a Super Admin.",
      { status: "failed", error: message.slice(0, 1000) },
    );
    throw error;
  }
}

async function processDueCleanupRequests(): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  try {
    const due = await sbRpc<{ id: number }>("platform_claim_due_storage_cleanup_requests", { p_limit: 10 });
    for (const row of due) {
      const request = await getCleanupRequest(asNumber(row.id));
      if (!request || request.status !== "processing") continue;
      try {
        await executeRequest(request, "system", "storage-cleanup-worker");
      } catch (error) {
        logger.error({ requestId: request.id, err: error }, "[storage-cleanup] scheduled request failed");
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "[storage-cleanup] due request scan unavailable");
  }
}

const worker = setInterval(() => {
  void processDueCleanupRequests();
}, 60_000);
worker.unref?.();
void processDueCleanupRequests();

router.get("/super-admin/storage", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    let measured: MeasureRow[] = [];
    let tenantMeasurementError: string | null = null;
    try {
      measured = await measureAndPersist();
    } catch {
      tenantMeasurementError = "Tenant row-payload measurement is unavailable.";
    }
    const physicalMeasurements = await Promise.all([
      measureSupabaseDatabase(),
      measureSupabaseStorage(),
      measureVpsDisk(),
    ]);
    await persistPhysicalMeasurements(physicalMeasurements);
    const [settings, admins, candidates, requests] = await Promise.all([
      sbSelectStrict<{ capacity_bytes: number | string | null; updated_at: string }>(
        "platform_storage_settings",
        "id=eq.1&select=capacity_bytes,updated_at&limit=1",
      ),
      sbSelectStrict<{ id: number; name: string; username: string; email: string | null; is_active: boolean }>(
        "isp_admins",
        "select=id,name,username,email,is_active&order=name.asc",
      ),
      sbRpc<CleanupCandidate>("platform_storage_cleanup_candidates", { p_admin_id: null }),
      sbSelectStrict<CleanupRequest>(
        "platform_storage_cleanup_requests",
        "select=*&order=created_at.desc&limit=200",
      ),
    ]);

    const byAdmin = new Map<number, { bytes: number; rows: number; breakdown: Record<string, { bytes: number; rows: number }> }>();
    for (const row of measured) {
      const adminId = parsePositiveId(row.admin_id);
      if (!adminId) continue;
      const current = byAdmin.get(adminId) ?? { bytes: 0, rows: 0, breakdown: {} };
      const bytes = Math.max(0, Math.floor(asNumber(row.bytes)));
      const rows = Math.max(0, Math.floor(asNumber(row.row_count)));
      current.bytes += bytes;
      current.rows += rows;
      current.breakdown[row.source] = { bytes, rows };
      byAdmin.set(adminId, current);
    }

    const usage = admins.map(admin => ({
      ...admin,
      bytes: tenantMeasurementError ? null : byAdmin.get(admin.id)?.bytes ?? 0,
      rowCount: tenantMeasurementError ? null : byAdmin.get(admin.id)?.rows ?? 0,
      breakdown: byAdmin.get(admin.id)?.breakdown ?? {},
    }));
    const measuredAt = new Date().toISOString();
    const totalUsedBytes = tenantMeasurementError
      ? null
      : usage.reduce((sum, admin) => sum + (admin.bytes ?? 0), 0);
    const capacityBytes = settings[0]?.capacity_bytes == null ? null : asNumber(settings[0].capacity_bytes);
    const freeBytes = capacityBytes == null || totalUsedBytes == null
      ? null
      : Math.max(0, capacityBytes - totalUsedBytes);
    const candidateRows = candidates.map(candidate => ({
      ...candidate,
      bytes: asNumber(candidate.bytes),
      rowCount: asNumber(candidate.row_count),
    }));

    res.json({
      ok: true,
      measuredAt,
      measurement: {
        kind: "tenant_row_payload_estimate",
        retentionDays: RETENTION_DAYS,
        tenantRowPayload: {
          source: "supabase_row_payload_rpc",
          status: tenantMeasurementError ? "unavailable" : "available",
          usedBytes: totalUsedBytes,
          measuredAt: tenantMeasurementError ? null : measuredAt,
          error: tenantMeasurementError,
        },
        physicalSources: physicalMeasurements.map(physicalPublic),
        notes: [
          "Tenant bytes are row-payload estimates and are not physical database usage.",
          "Supabase Postgres and VPS filesystem measurements are physical-source readings; Supabase Storage reports logical object bytes.",
          "Provider capacity and overhead are not inferred when a source does not expose them.",
          "Unavailable sources are never included in capacity or free-space calculations.",
        ],
      },
      capacityBytes,
      totalUsedBytes,
      freeBytes,
      capacity: {
        bytes: capacityBytes,
        source: capacityBytes === null ? "not_configured" : "super_admin_configured_budget",
        measuredAt: settings[0]?.updated_at ?? null,
      },
      freeSpace: {
        bytes: freeBytes,
        source: freeBytes === null ? null : "configured_budget_minus_tenant_row_payload_estimate",
        measuredAt: freeBytes === null ? null : measuredAt,
      },
      usagePercent: capacityBytes && capacityBytes > 0 && totalUsedBytes !== null
        ? Math.min(100, (totalUsedBytes / capacityBytes) * 100)
        : null,
      usage,
      candidates: candidateRows,
      requests,
    });
  } catch (error) {
    logger.error({ err: error }, "[super-admin/storage] load failed");
    res.status(503).json({ ok: false, error: "Storage reporting is unavailable. Apply the storage governance migration and verify service-role access." });
  }
});

router.put("/super-admin/storage/capacity", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const raw = req.body?.capacityBytes;
  const capacity = Number(raw);
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 9_000_000_000_000_000) {
    res.status(400).json({ ok: false, error: "Capacity must be a whole number of bytes between 0 and 9 PB." });
    return;
  }
  try {
    const token = String(req.headers["x-sa-token"] ?? "");
    const updated = await sbUpdateStrict(
      "platform_storage_settings",
      "id=eq.1",
      { capacity_bytes: capacity, updated_by: activeSuperAdminName(token) ?? "superadmin", updated_at: new Date().toISOString() },
    );
    if (!updated[0]) {
      res.status(503).json({ ok: false, error: "Storage capacity settings are not available." });
      return;
    }
    res.json({ ok: true, capacityBytes: capacity });
  } catch {
    res.status(503).json({ ok: false, error: "Could not save the platform storage capacity." });
  }
});

router.post("/super-admin/storage/cleanup-requests", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const adminId = parsePositiveId(req.body?.adminId);
  const candidateIds = parseCandidateIds(req.body?.candidateIds);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const scheduledFor = parseSchedule(req.body?.scheduledFor);
  if (!adminId || !candidateIds || reason.length < 5 || reason.length > MAX_REASON_LENGTH || !scheduledFor) {
    res.status(400).json({ ok: false, error: "Choose an ISP admin, eligible data, a reason of 5–500 characters, and a deadline within the next 90 days." });
    return;
  }

  try {
    const candidates = await sbRpc<CleanupCandidate>("platform_storage_cleanup_candidates", { p_admin_id: adminId });
    const selected = candidates.filter(candidate => candidateIds.includes(asNumber(candidate.id)));
    if (selected.length !== candidateIds.length) {
      res.status(400).json({ ok: false, error: "One or more selected items are no longer eligible for cleanup." });
      return;
    }
    const pending = await sbSelectStrict<{ id: number }>(
      "platform_storage_cleanup_requests",
      `admin_id=eq.${adminId}&status=eq.pending&select=id&limit=1`,
    );
    if (pending[0]) {
      res.status(409).json({ ok: false, error: "This ISP admin already has a pending cleanup request. Cancel it before creating another." });
      return;
    }

    const token = String(req.headers["x-sa-token"] ?? "");
    const requestedBy = activeSuperAdminName(token) ?? "superadmin";
    const [request] = await sbInsertStrict<CleanupRequest>("platform_storage_cleanup_requests", {
      admin_id: adminId,
      scope: CLEANUP_SCOPE,
      reason,
      requested_by: requestedBy,
      scheduled_for: scheduledFor,
      candidate_bytes: selected.reduce((sum, item) => sum + asNumber(item.bytes), 0),
      candidate_rows: selected.reduce((sum, item) => sum + asNumber(item.row_count), 0),
      candidate_ids: selected.map(item => asNumber(item.id)),
      status: "pending",
    });
    if (!request) {
      res.status(503).json({ ok: false, error: "Could not create the cleanup request." });
      return;
    }

    await notifyAdmin(
      request,
      "Data cleanup scheduled",
      `A Super Admin scheduled deletion of ${selected.length} aged router-migration item(s) on ${new Date(scheduledFor).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}. You can keep the data before the deadline.`,
      { reason },
    );
    await writeAudit(request, "super_admin", requestedBy, "cleanup_scheduled", { reason, candidateIds: selected.map(item => item.id) });
    res.status(201).json({ ok: true, request });
  } catch (error) {
    logger.error({ err: error }, "[super-admin/storage] schedule failed");
    res.status(503).json({ ok: false, error: "Could not schedule the cleanup request." });
  }
});

router.post("/super-admin/storage/cleanup-requests/:id/cancel", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const id = parsePositiveId(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: "A valid cleanup request ID is required." });
    return;
  }
  try {
    const request = await getCleanupRequest(id);
    if (!request) {
      res.status(404).json({ ok: false, error: "Cleanup request not found." });
      return;
    }
    if (request.status === "cancelled" || request.status === "completed") {
      res.json({ ok: true, request });
      return;
    }
    if (request.status !== "pending") {
      res.status(409).json({ ok: false, error: "This request is already being processed and cannot be cancelled." });
      return;
    }
    const [cancelled] = await sbUpdateStrict<CleanupRequest>(
      "platform_storage_cleanup_requests",
      `id=eq.${id}&status=eq.pending`,
      { status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    );
    if (!cancelled) {
      res.status(409).json({ ok: false, error: "The cleanup request changed state. Refresh and try again." });
      return;
    }
    const token = String(req.headers["x-sa-token"] ?? "");
    const actor = activeSuperAdminName(token) ?? "superadmin";
    await writeAudit(cancelled, "super_admin", actor, "cleanup_cancelled");
    await notifyAdmin(cancelled, "Data cleanup cancelled", "The pending cleanup request was cancelled. Your data will not be removed by this request.", { status: "cancelled" });
    res.json({ ok: true, request: cancelled });
  } catch {
    res.status(503).json({ ok: false, error: "Could not cancel the cleanup request." });
  }
});

router.post("/super-admin/storage/cleanup-requests/:id/delete-now", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const id = parsePositiveId(req.params.id);
  if (!id || req.body?.confirmation !== "DELETE") {
    res.status(400).json({ ok: false, error: "Enter DELETE to confirm immediate removal." });
    return;
  }
  try {
    const request = await getCleanupRequest(id);
    if (!request) {
      res.status(404).json({ ok: false, error: "Cleanup request not found." });
      return;
    }
    if (request.status === "cancelled") {
      res.status(409).json({ ok: false, error: "A cancelled request cannot be deleted. Create a new reviewed request." });
      return;
    }
    if (request.status === "completed") {
      res.json({ ok: true, request, deletedRows: 0, deletedBytes: 0, alreadyCompleted: true });
      return;
    }
    if (request.status === "processing") {
      res.status(409).json({ ok: false, error: "This cleanup is already being processed. Refresh shortly." });
      return;
    }
    const [claimed] = await sbUpdateStrict<CleanupRequest>(
      "platform_storage_cleanup_requests",
      `id=eq.${id}&status=eq.pending`,
      { status: "processing", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    );
    if (!claimed) {
      res.status(409).json({ ok: false, error: "The cleanup request changed state. Refresh and try again." });
      return;
    }
    const token = String(req.headers["x-sa-token"] ?? "");
    const actor = activeSuperAdminName(token) ?? "superadmin";
    const result = await executeRequest(claimed, "super_admin", actor);
    const finalRequest = await getCleanupRequest(id);
    res.json({ ok: true, request: finalRequest ?? claimed, deletedRows: result.deletedRows, deletedBytes: result.deletedBytes });
  } catch {
    res.status(503).json({ ok: false, error: "Immediate cleanup failed. Review the request history for details." });
  }
});

router.get("/admin/storage/notifications", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = tenantAdminId(req, res);
  if (!adminId) return;
  try {
    const notifications = await sbSelectStrict<{
      id: number;
      notification_type: string;
      title: string;
      body: string;
      cleanup_request_id: number | null;
      metadata: Record<string, unknown>;
      read_at: string | null;
      created_at: string;
    }>(
      "platform_admin_notifications",
      `admin_id=eq.${adminId}&select=id,notification_type,title,body,cleanup_request_id,metadata,read_at,created_at&order=created_at.desc&limit=100`,
    );
    const requestIds = notifications
      .map(notification => parsePositiveId(notification.cleanup_request_id))
      .filter((id): id is number => id !== null);
    const requests = requestIds.length > 0
      ? await sbSelectStrict<CleanupRequest>(
        "platform_storage_cleanup_requests",
        `admin_id=eq.${adminId}&id=in.(${requestIds.join(",")})&select=*&limit=100`,
      )
      : [];
    const requestById = new Map(requests.map(request => [request.id, request]));
    res.json({
      ok: true,
      notifications: notifications.map(notification => ({
        ...notification,
        cleanupRequest: notification.cleanup_request_id
          ? requestById.get(notification.cleanup_request_id) ?? null
          : null,
      })),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load platform notifications." });
  }
});

router.post("/admin/storage/cleanup-requests/:id/recover", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = tenantAdminId(req, res);
  if (!adminId) return;
  const id = parsePositiveId(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: "A valid cleanup request ID is required." });
    return;
  }
  try {
    const request = await getCleanupRequest(id);
    if (!request || request.admin_id !== adminId) {
      res.status(404).json({ ok: false, error: "Cleanup request not found." });
      return;
    }
    if (request.status === "cancelled") {
      res.json({ ok: true, request });
      return;
    }
    if (request.status !== "pending") {
      res.status(409).json({ ok: false, error: "This request has already passed its recovery window." });
      return;
    }
    const [recovered] = await sbUpdateStrict<CleanupRequest>(
      "platform_storage_cleanup_requests",
      `id=eq.${id}&admin_id=eq.${adminId}&status=eq.pending`,
      { status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    );
    if (!recovered) {
      res.status(409).json({ ok: false, error: "The cleanup request changed state. Refresh and try again." });
      return;
    }
    await writeAudit(recovered, "admin", String(adminId), "cleanup_recovered");
    await notifyAdmin(recovered, "Data recovered", "Your recovery request was recorded. The pending cleanup will not remove this data.", { status: "cancelled", recoveredBy: adminId });
    res.json({ ok: true, request: recovered });
  } catch {
    res.status(503).json({ ok: false, error: "Could not recover the pending data cleanup." });
  }
});

export default router;