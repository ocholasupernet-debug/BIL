import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../migrations/2026_hotspot_loyalty_legacy_mac_review_allocations.sql", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url),
  "utf8",
);

test("legacy loyalty allocation is bounded, audited, and repeat-safe", () => {
  assert.match(runner, /2026_hotspot_loyalty_legacy_mac_review_allocations\.sql/);
  assert.match(migration, /create table if not exists public\.isp_loyalty_device_legacy_allocations/i);
  assert.match(migration, /unique \(admin_id, legacy_phone, device_mac\)/i);
  assert.match(migration, /source_ledger_ids text\[\] not null/i);
  assert.match(migration, /m\.device_rank <= 2/i);
  assert.match(migration, /and not m\.shared_mac/i);
  assert.match(migration, /greatest\(m\.net_points - m\.current_device_balance, 0\)/i);
  assert.match(migration, /allocation_count <> 3 or allocation_total <> 1\.83/i);
  assert.match(migration, /where not exists\s*\(\s*select 1 from public\.isp_loyalty_device_legacy_allocations\s*\)/i);
  assert.match(migration, /on conflict \(admin_id, legacy_phone, device_mac\) do nothing/i);
  assert.match(migration, /alter table public\.isp_loyalty_device_legacy_allocations enable row level security/i);
});
