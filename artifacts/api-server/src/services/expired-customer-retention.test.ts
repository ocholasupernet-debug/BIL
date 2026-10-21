import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("expired-account cleanup is tenant-aggregate only and registered for deployment", async () => {
  const [migration, schema, runner, service] = await Promise.all([
    readFile(new URL("../../migrations/2026_expired_customer_retention.sql", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/supabase_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
    readFile(new URL("./expired-customer-retention.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /p_grace_days < 180/);
  assert.match(migration, /not exists\s*\(\s*select 1\s+from public\.isp_transactions/i);
  assert.match(migration, /t\.customer_id = c\.id/);
  assert.match(migration, /t\.id = c\.hotspot_purchase_transaction_id/);
  assert.match(migration, /!~\* '\^tv\[0-9\]/);
  assert.match(migration, /public\.isp_expired_customer_history/);
  assert.doesNotMatch(migration, /delete from public\.isp_admins/i);
  assert.doesNotMatch(migration, /delete from public\.isp_transactions/i);
  assert.match(schema, /purge_expired_prepaid_customers/);
  assert.match(runner, /2026_expired_customer_retention\.sql/);
  assert.match(service, /RETENTION_GRACE_DAYS = 180/);
});
