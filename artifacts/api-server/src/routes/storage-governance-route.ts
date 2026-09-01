import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import {
  sbDelete,
  sbInsertStrict,
  sbRpc,
  sbSelect,
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
const TELEMETRY_COLLECTION_INTERVAL_MINUTES = positiveIntegerEnv(
  "STORAGE_TELEMETRY_COLLECTION_INTERVAL_MINUTES",
  15,
);
const TELEMETRY_STALE_AFTER_MINUTES = Math.max(
  TELEMETRY_COLLECTION_INTERVAL_MINUTES,
  positiveIntegerEnv("STORAGE_TELEMETRY_STALE_AFTER_MINUTES", 60),
);
const TELEMETRY_COLLECTION_INTERVAL_MS = TELEMETRY_COLLECTION_INTERVAL_MINUTES * 60_000;
const TELEMETRY_STALE_AFTER_MS = TELEMETRY_STALE_AFTER_MINUTES * 60_000;
const HISTORY_WINDOW_DAYS = 30;
const HISTORY_LIMIT = 1_000;
const DEFAULT_CAPACITY_WARNING_PERCENT = 80;

type CleanupStatus = "pending" | "processing" | "cancelled" | "completed" | "failed";

interface MeasureRow {
  admin_id: number;
  source: string;
  bytes: number | string;
  row_count: number | string;
}

interface PhysicalUsageRow {
  source: string;
  status: "available" | "partial" | "unavailable" | "stale";
  measurement_kind: string;
  used_bytes: number | string | null;
  capacity_bytes: number | string | null;
  free_bytes: number | string | null;
  details: Record<string, unknown> | null;
  measured_at: string | null;
  error: string | null;
}

interface PhysicalUsageHistoryRow extends PhysicalUsageRow {
  captured_at: string;
}

interface TenantUsageHistoryRow {
  status: "available" | "unavailable";
  used_bytes: number | string | null;
  row_count: number | string | null;
  measured_at: string | null;
  error: string | null;
  captured_at: string;
}

interface StorageSettingsRow {
  capacity_bytes: number | string | null;
  capacity_warning_percent: number | string | null;
  capacity_warning_active: boolean;
  capacity_warning_last_percent: number | string | null;
  capacity_warning_last_notified_at: string | null;
  capacity_warning_recovered_at: string | null;
  updated_at: string;
}

interface CapacityWarningNotification {
  id: number;
  notification_type: "storage_capacity_warning" | "storage_capacity_recovered";
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
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

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
  const persistResults = await Promise.allSettled(rows.map(row => {
    const adminId = parsePositiveId(row.admin_id);
    if (!adminId || !row.source) return Promise.resolve();
    return sbUpsertStrict("platform_storage_usage", "admin_id,source", {
      admin_id: adminId,
      source: row.source,
      bytes: Math.max(0, Math.floor(asNumber(row.bytes))),
      row_count: Math.max(0, Math.floor(asNumber(row.row_count))),
      measured_at: new Date().toISOString(),
    });
  }));
  const failedPersistCount = persistResults.filter(result => result.status === "rejected").length;
  if (failedPersistCount > 0) {
    logger.warn({ failedPersistCount }, "[super-admin/storage] some tenant usage rows could not be persisted; current measurement retained");
  }
  return rows;
}

async function collectTenantCapacityWarning(): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  try {
    const measured = await measureAndPersist();
    const settings = await sbSelect<StorageSettingsRow>(
      "platform_storage_settings",
      "id=eq.1&select=capacity_bytes,capacity_warning_percent,capacity_warning_active,capacity_warning_last_percent,capacity_warning_last_notified_at,capacity_warning_recovered_at,updated_at&limit=1",
    );
    const totalUsedBytes = measured.reduce(
      (sum, row) => sum + Math.max(0, Math.floor(asNumber(row.bytes))),
      0,
    );
    const capacityBytes = settings[0]?.capacity_bytes == null ? null : asNumber(settings[0].capacity_bytes);
    await evaluateCapacityWarning({ settings: settings[0], capacityBytes, totalUsedBytes });
  } catch (error) {
    logger.warn({ err: error }, "[super-admin/storage] tenant capacity warning check failed");
  }
}

function physicalPublic(measurement: StorageTelemetry | PhysicalUsageRow) {
  const persisted = "measurement_kind" in measurement;
  return {
    source: measurement.source,
    status: measurement.status,
    measurementKind: persisted ? measurement.measurement_kind : measurement.measurementKind,
    usedBytes: persisted ? toNullableNumber(measurement.used_bytes) : measurement.usedBytes,
    capacityBytes: persisted ? toNullableNumber(measurement.capacity_bytes) : measurement.capacityBytes,
    freeBytes: persisted ? toNullableNumber(measurement.free_bytes) : measurement.freeBytes,
    measuredAt: persisted ? measurement.measured_at : measurement.measuredAt,
    error: measurement.error,
    details: measurement.details ?? {},
  };
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAlertBytes(value: number): string {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

async function loadCapacityWarningNotifications(): Promise<CapacityWarningNotification[]> {
  return sbSelect<CapacityWarningNotification>(
    "platform_super_admin_notifications",
    "select=id,notification_type,title,body,metadata,read_at,created_at&order=created_at.desc&limit=10",
  );
}

async function evaluateCapacityWarning(input: {
  settings: StorageSettingsRow | undefined;
  capacityBytes: number | null;
  totalUsedBytes: number | null;
}): Promise<{
  state: "monitoring" | "warning" | "unavailable";
  active: boolean;
  thresholdPercent: number;
  usagePercent: number | null;
  lastNotifiedAt: string | null;
  recoveredAt: string | null;
  notifications: CapacityWarningNotification[];
}> {
  const settings = input.settings;
  const thresholdPercent = Math.min(
    100,
    Math.max(1, Math.floor(asNumber(settings?.capacity_warning_percent) || DEFAULT_CAPACITY_WARNING_PERCENT)),
  );
  let active = settings?.capacity_warning_active === true;
  let lastNotifiedAt = settings?.capacity_warning_last_notified_at ?? null;
  let recoveredAt = settings?.capacity_warning_recovered_at ?? null;
  const usagePercent = input.capacityBytes === null || input.totalUsedBytes === null
    ? null
    : input.capacityBytes > 0
      ? Math.min(100, Math.max(0, (input.totalUsedBytes / input.capacityBytes) * 100))
      : input.totalUsedBytes > 0 ? 100 : 0;

  if (usagePercent !== null && input.capacityBytes !== null && input.totalUsedBytes !== null && supabaseServiceRoleConfigured) {
    try {
      const now = new Date().toISOString();
      if (usagePercent >= thresholdPercent && !active) {
        const [claimed] = await sbUpdateStrict<StorageSettingsRow>(
          "platform_storage_settings",
          "id=eq.1&capacity_warning_active=eq.false",
          {
            capacity_warning_active: true,
            capacity_warning_last_percent: usagePercent,
            capacity_warning_last_notified_at: now,
            capacity_warning_recovered_at: null,
          },
        );
        if (claimed) {
          active = true;
          lastNotifiedAt = now;
          recoveredAt = null;
          await sbInsertStrict("platform_super_admin_notifications", {
            notification_type: "storage_capacity_warning",
            title: `Storage capacity warning: ${usagePercent.toFixed(1)}% used`,
            body: `Tenant row-payload estimates currently use ${formatAlertBytes(input.totalUsedBytes)} of the configured ${formatAlertBytes(input.capacityBytes)} budget, above the ${thresholdPercent}% warning threshold.`,
            metadata: {
              source: "tenant_row_payload_estimate",
              usagePercent,
              thresholdPercent,
              usedBytes: input.totalUsedBytes,
              capacityBytes: input.capacityBytes,
            },
          });
        }
      } else if (usagePercent < thresholdPercent && active) {
        const [released] = await sbUpdateStrict<StorageSettingsRow>(
          "platform_storage_settings",
          "id=eq.1&capacity_warning_active=eq.true",
          {
            capacity_warning_active: false,
            capacity_warning_last_percent: usagePercent,
            capacity_warning_recovered_at: now,
          },
        );
        if (released) {
          active = false;
          recoveredAt = now;
          await sbInsertStrict("platform_super_admin_notifications", {
            notification_type: "storage_capacity_recovered",
            title: "Storage capacity warning cleared",
            body: `Tenant row-payload estimates are back below the ${thresholdPercent}% warning threshold at ${usagePercent.toFixed(1)}% of the configured budget.`,
            metadata: {
              source: "tenant_row_payload_estimate",
              usagePercent,
              thresholdPercent,
              usedBytes: input.totalUsedBytes,
              capacityBytes: input.capacityBytes,
            },
          });
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "[super-admin/storage] capacity warning state unavailable");
    }
  }

  return {
    state: usagePercent === null ? "unavailable" : active ? "warning" : "monitoring",
    active,
    thresholdPercent,
    usagePercent,
    lastNotifiedAt,
    recoveredAt,
    notifications: await loadCapacityWarningNotifications(),
  };
}

async function persistPhysicalMeasurements(measurements: StorageTelemetry[]): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  const results = await Promise.all(measurements.map(measurement => Promise.allSettled([
    sbUpsertStrict(
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
    ),
    sbInsertStrict("platform_storage_physical_usage_history", {
      source: measurement.source,
      status: measurement.status,
      measurement_kind: measurement.measurementKind,
      used_bytes: measurement.usedBytes,
      capacity_bytes: measurement.capacityBytes,
      free_bytes: measurement.freeBytes,
      details: measurement.details ?? {},
      measured_at: measurement.measuredAt,
      error: measurement.error,
    }),
  ])));
  if (results.flat().some(result => result.status === "rejected")) {
    logger.warn("[super-admin/storage] physical telemetry snapshot could not be persisted");
  }
}

async function persistTenantUsageHistory(snapshot: {
  status: "available" | "unavailable";
  usedBytes: number | null;
  rowCount: number | null;
  measuredAt: string | null;
  error: string | null;
}): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  try {
    await sbInsertStrict("platform_storage_tenant_usage_history", {
      status: snapshot.status,
      used_bytes: snapshot.usedBytes,
      row_count: snapshot.rowCount,
      measured_at: snapshot.measuredAt,
      error: snapshot.error,
    });
  } catch {
    logger.warn("[super-admin/storage] tenant usage history could not be persisted");
  }
}

async function loadStorageHistory(): Promise<{
  physical: Array<ReturnType<typeof physicalPublic> & { capturedAt: string }>;
  tenant: Array<{
    status: TenantUsageHistoryRow["status"];
    usedBytes: number | null;
    rowCount: number | null;
    measuredAt: string | null;
    capturedAt: string;
    error: string | null;
  }>;
}> {
  const since = encodeURIComponent(new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000).toISOString());
  const [physicalRows, tenantRows] = await Promise.all([
    sbSelect<PhysicalUsageHistoryRow>(
      "platform_storage_physical_usage_history",
      `select=source,status,measurement_kind,used_bytes,capacity_bytes,free_bytes,details,measured_at,error,captured_at&captured_at=gte.${since}&order=captured_at.asc&limit=${HISTORY_LIMIT}`,
    ),
    sbSelect<TenantUsageHistoryRow>(
      "platform_storage_tenant_usage_history",
      `select=status,used_bytes,row_count,measured_at,error,captured_at&captured_at=gte.${since}&order=captured_at.asc&limit=${HISTORY_LIMIT}`,
    ),
  ]);
  return {
    physical: physicalRows.map(row => ({ ...physicalPublic(row), capturedAt: row.captured_at })),
    tenant: tenantRows.map(row => ({
      status: row.status,
      usedBytes: toNullableNumber(row.used_bytes),
      rowCount: toNullableNumber(row.row_count),
      measuredAt: row.measured_at,
      capturedAt: row.captured_at,
      error: row.error,
    })),
  };
}

function buildCapacityForecast(
  points: Array<{ status: TenantUsageHistoryRow["status"]; usedBytes: number | null; capturedAt: string }>,
  capacityBytes: number | null,
) {
  const valid = points
    .filter(point => point.status === "available" && point.usedBytes !== null && Number.isFinite(new Date(point.capturedAt).getTime()))
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  if (capacityBytes === null) {
    return { status: "unavailable", source: "tenant_row_payload_history", validPoints: valid.length, trendBytesPerDay: null, projectedFullAt: null, reason: "A platform capacity budget is not configured." };
  }
  if (valid.length < 2) {
    return { status: "insufficient_data", source: "tenant_row_payload_history", validPoints: valid.length, trendBytesPerDay: null, projectedFullAt: null, reason: "At least two available tenant measurements are required." };
  }
  const first = valid[0];
  const last = valid[valid.length - 1];
  const days = (new Date(last.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) {
    return { status: "insufficient_data", source: "tenant_row_payload_history", validPoints: valid.length, trendBytesPerDay: null, projectedFullAt: null, reason: "Available measurements do not span enough time." };
  }
  const trendBytesPerDay = (last.usedBytes! - first.usedBytes!) / days;
  if (trendBytesPerDay <= 0) {
    return { status: "not_growing", source: "tenant_row_payload_history", validPoints: valid.length, trendBytesPerDay, projectedFullAt: null, reason: "Available tenant usage is flat or decreasing." };
  }
  const remaining = Math.max(0, capacityBytes - last.usedBytes!);
  const projectedFullAt = new Date(new Date(last.capturedAt).getTime() + (remaining / trendBytesPerDay) * 86_400_000).toISOString();
  return { status: "available", source: "tenant_row_payload_history", validPoints: valid.length, trendBytesPerDay, projectedFullAt, reason: null };
}

async function loadPhysicalMeasurements(): Promise<ReturnType<typeof physicalPublic>[]> {
  const rows = await sbSelect<PhysicalUsageRow>(
    "platform_storage_physical_usage",
    "select=source,status,measurement_kind,used_bytes,capacity_bytes,free_bytes,details,measured_at,error&order=source.asc",
  );
  const bySource = new Map(rows.map(row => [row.source, row]));
  return ["supabase_postgres", "supabase_storage", "vps_filesystem"].map(source => {
    const row = bySource.get(source);
    if (row) return physicalPublic(row);
    return physicalPublic({
      source,
      status: "unavailable",
      measurementKind: source === "supabase_storage" ? "storage_object_bytes" : source === "vps_filesystem" ? "filesystem_df" : "database_physical_size",
      usedBytes: null,
      capacityBytes: null,
      freeBytes: null,
      measuredAt: null,
      error: "No server-side telemetry reading has been recorded yet.",
      details: {},
    });
  });
}

async function markStalePhysicalMeasurements(): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  try {
    const rows = await sbSelect<Pick<PhysicalUsageRow, "source" | "status" | "measured_at">>(
      "platform_storage_physical_usage",
      "select=source,status,measured_at",
    );
    const cutoff = Date.now() - TELEMETRY_STALE_AFTER_MS;
    await Promise.all(rows
      .filter(row => row.status !== "stale" && row.measured_at && new Date(row.measured_at).getTime() < cutoff)
      .map(row => sbUpdateStrict(
        "platform_storage_physical_usage",
        `source=eq.${encodeURIComponent(row.source)}`,
        {
          status: "stale",
          error: "This reading is older than the configured freshness window.",
        },
      )));
  } catch (error) {
    logger.warn({ err: error }, "[super-admin/storage] freshness check unavailable");
  }
}

async function collectPhysicalMeasurements(): Promise<void> {
  if (!supabaseServiceRoleConfigured) return;
  try {
    const measurements = await Promise.all([
      measureSupabaseDatabase(),
      measureSupabaseStorage(),
      measureVpsDisk(),
    ]);
    await persistPhysicalMeasurements(measurements);
  } catch (error) {
    logger.warn({ err: error }, "[super-admin/storage] server telemetry collection failed");
  }
}

async function runTelemetryCycle(): Promise<void> {
  await collectPhysicalMeasurements();
  await collectTenantCapacityWarning();
  await markStalePhysicalMeasurements();
}

const telemetryWorker = setInterval(() => {
  void runTelemetryCycle();
}, TELEMETRY_COLLECTION_INTERVAL_MS);
telemetryWorker.unref?.();
void runTelemetryCycle();

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
    const measuredAt = new Date().toISOString();
    const tenantHistoryUsedBytes = tenantMeasurementError
      ? null
      : measured.reduce((sum, row) => sum + Math.max(0, Math.floor(asNumber(row.bytes))), 0);
    const tenantHistoryRowCount = tenantMeasurementError
      ? null
      : measured.reduce((sum, row) => sum + Math.max(0, Math.floor(asNumber(row.row_count))), 0);
    await persistTenantUsageHistory({
      status: tenantMeasurementError ? "unavailable" : "available",
      usedBytes: tenantHistoryUsedBytes,
      rowCount: tenantHistoryRowCount,
      measuredAt: tenantMeasurementError ? null : measuredAt,
      error: tenantMeasurementError,
    });
    const [physicalMeasurements, settings, admins, candidates, requests, history] = await Promise.all([
      loadPhysicalMeasurements(),
      sbSelectStrict<StorageSettingsRow>(
        "platform_storage_settings",
        "id=eq.1&select=capacity_bytes,capacity_warning_percent,capacity_warning_active,capacity_warning_last_percent,capacity_warning_last_notified_at,capacity_warning_recovered_at,updated_at&limit=1",
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
      loadStorageHistory(),
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
    const totalUsedBytes = tenantMeasurementError
      ? null
      : usage.reduce((sum, admin) => sum + (admin.bytes ?? 0), 0);
    const capacityBytes = settings[0]?.capacity_bytes == null ? null : asNumber(settings[0].capacity_bytes);
    const freeBytes = capacityBytes == null || totalUsedBytes == null
      ? null
      : Math.max(0, capacityBytes - totalUsedBytes);
    const forecast = buildCapacityForecast(history.tenant, capacityBytes);
    const capacityWarning = await evaluateCapacityWarning({
      settings: settings[0],
      capacityBytes,
      totalUsedBytes,
    });
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
        physicalSources: physicalMeasurements,
        freshness: {
          collectionIntervalMinutes: TELEMETRY_COLLECTION_INTERVAL_MINUTES,
          staleAfterMinutes: TELEMETRY_STALE_AFTER_MINUTES,
          checkedAt: measuredAt,
        },
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
      capacityWarning,
      history: {
        windowDays: HISTORY_WINDOW_DAYS,
        physical: history.physical,
        tenant: history.tenant,
      },
      forecast,
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
  const rawWarningPercent = req.body?.warningPercent;
  const warningPercent = rawWarningPercent == null ? null : Number(rawWarningPercent);
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 9_000_000_000_000_000) {
    res.status(400).json({ ok: false, error: "Capacity must be a whole number of bytes between 0 and 9 PB." });
    return;
  }
  if (warningPercent !== null && (!Number.isSafeInteger(warningPercent) || warningPercent < 1 || warningPercent > 100)) {
    res.status(400).json({ ok: false, error: "The capacity warning threshold must be a whole percentage between 1 and 100." });
    return;
  }
  try {
    const token = String(req.headers["x-sa-token"] ?? "");
    const settings: Record<string, unknown> = {
      capacity_bytes: capacity,
      updated_by: activeSuperAdminName(token) ?? "superadmin",
      updated_at: new Date().toISOString(),
    };
    if (warningPercent !== null) settings.capacity_warning_percent = warningPercent;
    const updated = await sbUpdateStrict(
      "platform_storage_settings",
      "id=eq.1",
      settings,
    );
    if (!updated[0]) {
      res.status(503).json({ ok: false, error: "Storage capacity settings are not available." });
      return;
    }
    res.json({ ok: true, capacityBytes: capacity, warningPercent });
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

router.get("/super-admin/storage/notifications", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const notifications = await sbSelectStrict<CapacityWarningNotification>(
      "platform_super_admin_notifications",
      "select=id,notification_type,title,body,metadata,read_at,created_at&order=created_at.desc&limit=100",
    );
    res.json({
      ok: true,
      unreadCount: notifications.filter(notification => notification.read_at === null).length,
      notifications,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load Super Admin capacity alerts." });
  }
});

router.post("/super-admin/storage/notifications/:id/read", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const id = parsePositiveId(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: "A valid capacity alert ID is required." });
    return;
  }
  try {
    const [updated] = await sbUpdateStrict<CapacityWarningNotification>(
      "platform_super_admin_notifications",
      `id=eq.${id}&read_at=is.null`,
      { read_at: new Date().toISOString() },
    );
    if (updated) {
      res.json({ ok: true, notification: updated });
      return;
    }
    const existing = await sbSelectStrict<CapacityWarningNotification>(
      "platform_super_admin_notifications",
      `id=eq.${id}&select=id,notification_type,title,body,metadata,read_at,created_at&limit=1`,
    );
    if (!existing[0]) {
      res.status(404).json({ ok: false, error: "Capacity alert not found." });
      return;
    }
    res.json({ ok: true, notification: existing[0] });
  } catch {
    res.status(503).json({ ok: false, error: "Could not acknowledge the capacity alert." });
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