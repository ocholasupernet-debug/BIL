import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../migrations/2026_hotspot_loyalty_repeat_remaining_to_unshared_macs.sql", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url),
  "utf8",
);

test("legacy remaining points are repeated only to unique, ledger-linked MACs and are audited", () => {
  assert.match(runner, /2026_hotspot_loyalty_repeat_remaining_to_unshared_macs\.sql/);
  assert.match(migration, /create table if not exists public\.isp_loyalty_device_legacy_repeat_allocations/i);
  assert.match(migration, /unique \(admin_id, legacy_phone, device_mac, allocation_batch\)/i);
  assert.match(migration, /remaining_phone_points numeric\(14,2\)/i);
  assert.match(migration, /source_ledger_ids text\[\] not null/i);
  assert.match(migration, /m\.net_points > 0/i);
  assert.match(migration, /and other\.phone <> m\.phone/i);
  assert.match(migration, /allocation_count <> 25 or allocation_total <> 88\.48 or tenant_count <> 1/i);
  assert.match(migration, /where not exists\s*\(\s*select 1\s+from public\.isp_loyalty_device_legacy_repeat_allocations\s+where allocation_batch = 'repeat_remaining_to_unshared_macs_v1'/i);
  assert.match(migration, /on conflict \(admin_id, legacy_phone, device_mac, allocation_batch\) do nothing/i);
  assert.match(migration, /alter table public\.isp_loyalty_device_legacy_repeat_allocations enable row level security/i);
});
