import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../migrations/2026_revenue_summary_africa_nairobi.sql", import.meta.url),
  "utf8",
);
const deploymentRunner = await readFile(
  new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url),
  "utf8",
);

test("revenue summary uses explicit Nairobi calendar-day and month windows", () => {
  assert.match(migration, /timezone\('Africa\/Nairobi', now\(\)\)/);
  assert.match(migration, /date_trunc\('day', local_now\).*day_start/s);
  assert.match(migration, /date_trunc\('month', local_now\).*month_start/s);
  assert.match(migration, /occurred_at >= bounds\.day_start and ledger\.occurred_at < bounds\.day_end/);
  assert.match(migration, /occurred_at >= bounds\.month_start and ledger\.occurred_at < bounds\.month_end/);
  assert.match(migration, /ledger\.revenue_account_id = p_account_id/);
  assert.doesNotMatch(migration, /occurred_at::date\s*=\s*current_date/);
});

test("deployment runner applies the revenue-window migration after its ledger migration", () => {
  const ledgerIndex = deploymentRunner.indexOf("2026_immutable_revenue_billing.sql");
  const timezoneIndex = deploymentRunner.indexOf("2026_revenue_summary_africa_nairobi.sql");
  assert.notEqual(ledgerIndex, -1);
  assert.notEqual(timezoneIndex, -1);
  assert.ok(timezoneIndex > ledgerIndex);
});