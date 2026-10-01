import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [migration, runner, dashboard, store] = await Promise.all([
  read("../migrations/2026_platform_income_reporting.sql"),
  read("../scripts/apply-deployment-migrations.mjs"),
  read("../../ochola-supernet/src/pages/super-admin/Dashboard.tsx"),
  read("../src/lib/platform-billing-store.ts"),
]);

test("registration receipts stay out of tenant totals without rewriting the immutable ledger", () => {
  assert.match(migration, /new\.payment_method in \('mpesa_registration', 'manual_registration'\)[\s\S]*?return new;/);
  assert.match(migration, /coalesce\(ledger\.payment_method, ''\) not in \('mpesa_registration', 'manual_registration'\)/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.revenue_ledger|update\s+public\.revenue_ledger/i);
  assert.match(runner, /2026_platform_income_reporting\.sql/);
});

test("central income summary separates completed registrations from paid renewals", () => {
  assert.match(migration, /tx\.payment_method in \('mpesa_registration', 'manual_registration'\)/);
  assert.match(migration, /tx\.status in \('completed', 'paid', 'success'\)/);
  assert.match(migration, /invoice\.status = 'paid'[\s\S]*?invoice\.paid_at is not null/);
  assert.match(migration, /grant execute on function public\.get_platform_income_summary\(\) to service_role/);
  assert.match(store, /rpc\/get_platform_income_summary/);
  assert.match(dashboard, /Registration income · this month/);
  assert.match(dashboard, /Renewal income · this month/);
});