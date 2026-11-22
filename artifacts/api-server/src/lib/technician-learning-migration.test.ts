import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../migrations/2026_technician_learning_center.sql", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");

test("Technician learning migration is additive, service-role-only, and registered", () => {
  assert.match(migration, /add column if not exists account_type text not null default 'employee'/);
  assert.match(migration, /create table if not exists public\.technician_learning_guides/);
  assert.match(migration, /create table if not exists public\.technician_device_models/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.technician_learning_guides from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.technician_learning_guides to service_role/);
  assert.match(migration, /on conflict \(slug\) do nothing/);
  assert.match(migration, /on conflict \(brand, model\) do nothing/);
  assert.match(runner, /migrations\/2026_technician_learning_center\.sql/);
  assert.doesNotMatch(migration, /\b(drop table|truncate table|delete from)\b/i);
});

test("seeded learning material covers requested safe field topics and nuanced Tenda guidance", () => {
  for (const required of [
    "MikroTik", "Tenda", "TP-Link", "Huawei", "ZTE", "GPON", "XPON", "ONU", "ONT",
    "Hotspot", "PPPoE", "WAN", "LAN", "LOS", "PON", "DNS", "DHCP",
    "power", "cable", "customer", "authorization", "backup", "factory reset",
  ]) assert.match(migration.toLowerCase(), new RegExp(required.toLowerCase()));
  assert.match(migration, /WAN\/LAN behavior is model- and mode-specific/);
  assert.match(migration, /Hotspot uplinks typically use a supported LAN\/bridge path/);
  assert.match(migration, /Do not factory reset a provider-managed GPON\/XPON ONU\/ONT without explicit provider authorization/);
  assert.match(migration, /LED colors and blink patterns are model-specific/);
});
