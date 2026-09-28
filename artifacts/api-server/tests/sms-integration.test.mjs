import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("SMS migration is registered and its tables stay private", async () => {
  const [runner, migration] = await Promise.all([
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/2026_sms_integration.sql"),
  ]);
  assert.match(runner, /2026_sms_integration\.sql/);
  for (const table of [
    "platform_sms_settings",
    "sms_otp_challenges",
    "sms_action_tokens",
    "sms_outbox",
  ]) {
    assert.match(migration, new RegExp(`revoke all on table ${table} from public`, "i"));
    assert.match(migration, new RegExp(`revoke all on table ${table} from anon`, "i"));
    assert.match(migration, new RegExp(`revoke all on table ${table} from authenticated`, "i"));
  }
});

test("SMS OTP issue and verification RPCs enforce request and guess limits", async () => {
  const migration = await read("../migrations/2026_sms_integration.sql");
  const issue = migration.match(/create or replace function issue_sms_otp\([\s\S]*?\n\$\$;/i)?.[0];
  const verify = migration.match(/create or replace function verify_sms_otp\([\s\S]*?\n\$\$;/i)?.[0];
  assert.ok(issue, "OTP issue function should exist");
  assert.ok(verify, "OTP verification function should exist");
  assert.match(issue, /pg_advisory_xact_lock/i);
  assert.match(issue, /v_phone_count >= 5/i);
  assert.match(issue, /interval '60 seconds'/i);
  assert.match(issue, /v_ip_count >= 20/i);
  assert.match(verify, /v_max_attempts/);
  assert.match(verify, /attempt_count \+ 1 >= v_max_attempts/);
  assert.match(verify, /set consumed_at = now\(\)/);
});

test("SMS outbox covers verified customer expiry and subscription invoice events", async () => {
  const migration = await read("../migrations/2026_sms_integration.sql");
  assert.match(migration, /create trigger isp_transactions_sms_payment_notice/i);
  assert.match(migration, /create trigger isp_customers_sms_renewal/i);
  assert.match(migration, /create trigger platform_billing_invoices_sms_notice/i);
  assert.match(migration, /i\.status in \('due',\s*'pending'\)/i);
  assert.match(migration, /i\.due_date between current_date\s*-\s*3 and current_date\s*\+\s*3/i);
  assert.match(migration, /phone_verified is true/i);
  assert.match(migration, /resellerNotifications/i);
  assert.match(migration, /ispNotifications/i);
  assert.match(migration, /billing_period/i);
  assert.match(migration, /due_date/i);
});

test("SMS authentication routes and feature-aware registration are wired", async () => {
  const [route, registration] = await Promise.all([
    read("../src/routes/sms-route.ts"),
    read("../src/routes/registration-route.ts"),
  ]);
  assert.match(route, /\/auth\/sms\/request-otp/);
  assert.match(route, /\/auth\/sms\/verify-otp/);
  assert.match(route, /\/auth\/sms\/reset-password/);
  assert.match(route, /\/super-admin\/sms\/settings/);
  assert.match(route, /\/super-admin\/sms\/test/);
  assert.match(registration, /consumeSmsActionToken/);
  assert.match(registration, /registrationVerification/);
});