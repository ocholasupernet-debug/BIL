import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_tenant_storage_governance.sql", "utf8");
const route = await readFile("src/routes/storage-governance-route.ts", "utf8");
const telemetry = await readFile("src/lib/storage-telemetry.ts", "utf8");
const storageUi = await readFile("../ochola-supernet/src/pages/super-admin/Storage.tsx", "utf8");

test("storage governance persists capacity, tenant estimates, notices, requests, and audit history", () => {
  for (const table of [
    "platform_storage_settings",
    "platform_storage_usage",
    "platform_storage_cleanup_requests",
    "platform_admin_notifications",
    "platform_storage_audit_logs",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(migration, /platform_storage_measure/);
  assert.match(migration, /platform_claim_due_storage_cleanup_requests/);
  assert.match(migration, /platform_execute_storage_cleanup/);
  assert.match(migration, /platform_storage_physical_usage/);
  assert.match(migration, /measurement_kind/);
  assert.match(migration, /'stale'/);
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
  assert.match(route, /Provider capacity/);
  assert.match(route, /Unavailable sources are never included/);
  assert.match(storageUi, /Connected physical storage sources/);
  assert.match(storageUi, /sourceLabel/);
  assert.match(storageUi, /readings become stale after/);
  assert.match(storageUi, /statusColor/);
  assert.match(storageUi, /Measured \{formatDate\(source\.measuredAt\)\}/);
});