import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/2026_staff_shared_portal_auth.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");

test("Staff auth migration is additive and refuses duplicate verified-email identities", () => {
  assert.match(migration, /add column if not exists email_verified_at/);
  assert.match(migration, /employee_profiles_email_ci_uniq/);
  assert.match(migration, /duplicate employee email addresses must be reviewed/);
  assert.doesNotMatch(migration, /\b(drop\s+table|truncate\s+table|delete\s+from\s+public\.employee_profiles)\b/i);
});

test("anonymous Staff requests remain pending and do not create sessions", () => {
  assert.match(migration, /status text not null default 'pending_approval'/);
  assert.match(migration, /employee_complete_signup/);
  assert.match(migration, /insert into public\.employee_signup_requests/);
  assert.doesNotMatch(migration, /employee_complete_signup[\s\S]*?insert into public\.employee_sessions/i);
  assert.match(migration, /employee_review_signup_request/);
  assert.match(migration, /insert into public\.employee_profiles/);
  assert.match(migration, /insert into public\.employee_credentials/);
});

test("verification data is hash-only, rate-limited, one-time, and server-role only", () => {
  assert.match(migration, /otp_hash text not null check \(otp_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /attempt_count integer not null default 0 check \(attempt_count between 0 and 5\)/);
  assert.match(migration, /interval '60 seconds'/);
  assert.match(migration, /action_token_hash/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(runner, /2026_staff_shared_portal_auth\.sql/);
});

test("Super Admin email correction revokes existing Staff sessions and is audited", () => {
  assert.match(migration, /employee_update_staff_contact/);
  assert.match(migration, /auth_version = auth_version \+ 1/);
  assert.match(migration, /email_verified_at = null/);
  assert.match(migration, /staff_contact_updated/);
  assert.match(migration, /'sessions_invalidated', true/);
});
