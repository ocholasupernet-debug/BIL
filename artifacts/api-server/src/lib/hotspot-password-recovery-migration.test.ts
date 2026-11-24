import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../migrations/2026_hotspot_customer_password_recovery.sql", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url),
  "utf8",
);

test("Hotspot password recovery migration stores hashes only and protects the challenge table", () => {
  assert.match(migration, /create table if not exists hotspot_customer_password_reset_lookup_limits/i);
  assert.match(migration, /create table if not exists hotspot_customer_password_reset_challenges/i);
  assert.match(migration, /destination_hash text not null/i);
  assert.match(migration, /otp_hash text not null/i);
  assert.match(migration, /action_token_hash text/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table hotspot_customer_password_reset_lookup_limits\s+from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table hotspot_customer_password_reset_challenges\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /\bemail\s+text\b|\bphone(?:_e164)?\s+text\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|column|function)\b/i);
});

test("challenge RPCs enforce throttles, expiry, one-time consumption, and service-role-only access", () => {
  assert.match(migration, /perform pg_advisory_xact_lock/i);
  assert.match(migration, /allow_hotspot_customer_password_reset_lookup/i);
  assert.match(migration, /v_attempt_count <= 10/i);
  assert.match(migration, /v_account_count >= 5/i);
  assert.match(migration, /v_ip_count >= 20/i);
  assert.match(migration, /attempt_count \+ 1 >= 5/i);
  assert.match(migration, /action_expires_at > now\(\)/i);
  assert.match(migration, /set consumed_at = now\(\)/i);
  assert.match(migration, /grant execute on function issue_hotspot_customer_password_reset[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function allow_hotspot_customer_password_reset_lookup\(text\)\s+to service_role/i);
  assert.match(runner, /migrations\/2026_hotspot_customer_password_recovery\.sql/);
});
