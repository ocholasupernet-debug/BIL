import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../migrations/2026_isp_admin_password_recovery.sql", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url),
  "utf8",
);

test("ISP admin recovery migration stores only one-time hashes and denies browser roles", () => {
  assert.match(migration, /create table if not exists public\.isp_admin_password_reset_challenges/);
  assert.match(migration, /otp_hash text not null check \(otp_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /action_token_hash text/);
  assert.match(migration, /attempt_count integer not null default 0 check \(attempt_count between 0 and 5\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.isp_admin_password_reset_challenges from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.consume_isp_admin_password_reset\(bigint, text\) to service_role/);
  assert.match(migration, /action_expires_at = now\(\) \+ interval '10 minutes'/);
  assert.match(runner, /2026_isp_admin_password_recovery\.sql/);
});
