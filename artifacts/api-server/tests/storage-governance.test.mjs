import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_tenant_storage_governance.sql", "utf8");
const route = await readFile("src/routes/storage-governance-route.ts", "utf8");
const telemetry = await readFile("src/lib/storage-telemetry.ts", "utf8");
const storageUi = await readFile("../ochola-supernet/src/pages/super-admin/Storage.tsx", "utf8");
const superAdminNotificationsUi = await readFile("../ochola-supernet/src/pages/super-admin/Notifications.tsx", "utf8");

test("storage governance persists capacity, tenant estimates, notices, requests, and audit history", () => {
  for (const table of [
    "platform_storage_settings",
    "platform_storage_usage",
    "platform_storage_cleanup_requests",
    "platform_admin_notifications",
    "platform_super_admin_notifications",
    "platform_storage_audit_logs",
    "platform_storage_physical_usage_history",
    "platform_storage_tenant_usage_history",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(migration, /platform_storage_measure/);
  assert.match(migration, /platform_claim_due_storage_cleanup_requests/);
  assert.match(migration, /platform_execute_storage_cleanup/);
  assert.match(migration, /platform_storage_physical_usage/);
  assert.match(migration, /measurement_kind/);
  assert.match(migration, /'stale'/);
  assert.match(migration, /capacity_warning_percent integer not null default 80/);
  assert.match(migration, /capacity_warning_active boolean not null default false/);
  assert.match(migration, /storage_capacity_warning/);
  assert.match(migration, /storage_capacity_recovered/);
});

test("cleanup scope is explicitly limited to aged migration artifacts", () => {
  assert.match(migration, /scope\s+text not null check \(scope in \('expired_migration_artifacts'\)\)/);
  assert.match(migration, /j\.status in \('completed', 'failed'\)/);
  assert.match(migration, /j\.created_at < now\(\) - interval '30 days'/);
  assert.match(migration, /delete from public\.router_migration_jobs/);
  assert.match(migration, /delete from public\.router_migration_collector_tokens/);
  assert.doesNotMatch(migration, /delete from public\.isp_customers/);
  assert.doesNotMatch(migration, /delete from public\.isp_transactions/);
});

test("API routes keep Super Admin and tenant recovery boundaries separate", () => {
  assert.match(route, /isSuperAdmin\(req, res\)/);
  assert.match(route, /requireAdmin\(\)/);
  assert.match(route, /request\.admin_id !== adminId/);
  assert.match(route, /confirmation !== "DELETE"/);
  assert.match(route, /status=eq\.pending/);
  assert.match(route, /cleanup_recovered/);
  assert.match(route, /cleanup_completed/);
});

test("physical storage telemetry uses authoritative sources and keeps failures explicit", () => {
  assert.match(telemetry, /pg_database_size\(current_database\(\)\)/);
  assert.match(telemetry, /storage\/v1\/bucket/);
  assert.match(telemetry, /storage_object_bytes/);
  assert.match(telemetry, /df -B1/);
  assert.match(telemetry, /VPS filesystem usage is unavailable/);
  assert.match(route, /measureSupabaseDatabase/);
  assert.match(route, /measureSupabaseStorage/);
  assert.match(route, /measureVpsDisk/);
  assert.match(route, /STORAGE_TELEMETRY_COLLECTION_INTERVAL_MINUTES/);
  assert.match(route, /markStalePhysicalMeasurements/);
  assert.match(route, /collectPhysicalMeasurements/);
  assert.match(route, /No server-side telemetry reading has been recorded yet/);
  assert.match(route, /platform_storage_physical_usage_history/);
  assert.match(route, /platform_storage_tenant_usage_history/);
  assert.match(route, /buildCapacityForecast/);
  assert.match(route, /point\.status === "available"/);
  assert.match(route, /collectTenantCapacityWarning/);
  assert.match(route, /capacity_warning_active=eq\.false/);
  assert.match(route, /capacity_warning_active=eq\.true/);
  assert.match(route, /storage_capacity_warning/);
  assert.match(route, /storage_capacity_recovered/);
  assert.match(route, /usagePercent >= thresholdPercent/);
  assert.match(route, /usagePercent < thresholdPercent/);
  assert.match(route, /Promise\.allSettled\(rows\.map/);
  assert.match(route, /current measurement retained/);
  assert.match(route, /\/super-admin\/storage\/notifications/);
  assert.match(route, /unreadCount/);
  assert.match(route, /read_at=is\.null/);
  assert.match(route, /Could not acknowledge the capacity alert/);
  assert.match(route, /Provider capacity/);
  assert.match(route, /Unavailable sources are never included/);
  assert.match(storageUi, /Connected physical storage sources/);
  assert.match(storageUi, /sourceLabel/);
  assert.match(storageUi, /readings become stale after/);
  assert.match(storageUi, /statusColor/);
  assert.match(storageUi, /Measured \{formatDate\(source\.measuredAt\)\}/);
  assert.match(storageUi, /Storage history &amp; capacity trends/);
  assert.match(storageUi, /Only available samples are plotted/);
  assert.match(storageUi, /Capacity forecast/);
  assert.match(storageUi, /warningPercent/);
  assert.match(storageUi, /Capacity warning is active/);
  assert.match(storageUi, /are sent once until usage falls back below the threshold/);
});

test("Super Admin capacity inbox distinguishes unread warnings and supports acknowledgement", () => {
  assert.match(storageUi, /capacityWarning/);
  assert.match(superAdminNotificationsUi, /Capacity alerts/);
  assert.match(superAdminNotificationsUi, /unread/);
  assert.match(superAdminNotificationsUi, /Mark read/);
  assert.match(superAdminNotificationsUi, /Warning cleared/);
  assert.match(superAdminNotificationsUi, /never clears the underlying active storage warning/);
});