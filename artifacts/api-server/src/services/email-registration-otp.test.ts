import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  hashEmailRegistrationCode,
  hashEmailRegistrationToken,
  isEmailRegistrationChallengeId,
  isEmailRegistrationCode,
  normalizeRegistrationEmail,
} from "./email-registration-otp.js";

test("registration email normalization trims and lowercases valid addresses", () => {
  assert.equal(
    normalizeRegistrationEmail("  Person+tag@Example.COM "),
    "person+tag@example.com",
  );
  assert.equal(normalizeRegistrationEmail("not-an-email"), null);
  assert.equal(normalizeRegistrationEmail("a".repeat(250) + "@example.com"), null);
});

test("email OTP input validation only accepts UUID challenges and six digits", () => {
  assert.equal(
    isEmailRegistrationChallengeId("9c858901-8a57-4791-81fe-4c455b099bc9"),
    true,
  );
  assert.equal(isEmailRegistrationChallengeId("challenge-1"), false);
  assert.equal(isEmailRegistrationCode("004219"), true);
  assert.equal(isEmailRegistrationCode("4219"), false);
  assert.equal(isEmailRegistrationCode("42x219"), false);
});

test("OTP and action-token hashes are keyed and purpose-bound", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "email-otp-unit-test-secret";
  try {
    const base = hashEmailRegistrationCode(
      "9c858901-8a57-4791-81fe-4c455b099bc9",
      "person@example.com",
      "004219",
    );
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.notEqual(
      base,
      hashEmailRegistrationCode(
        "9c858901-8a57-4791-81fe-4c455b099bc9",
        "person@example.com",
        "004220",
      ),
    );
    assert.notEqual(base, hashEmailRegistrationToken("004219"));
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("email OTP migration is runner-registered and enforces private, one-time challenges", async () => {
  const [migration, runner] = await Promise.all([
    readFile(new URL("../../migrations/2026_email_registration_otp.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(runner, /2026_email_registration_otp\.sql/);
  assert.match(migration, /alter table email_registration_otp_challenges enable row level security/i);
  assert.match(migration, /revoke all on table email_registration_otp_challenges\s+from public, anon, authenticated/i);
  assert.match(migration, /interval '60 seconds'/i);
  assert.match(migration, /interval '10 minutes'/i);
  assert.match(migration, /attempt_count \+ 1 >= 5/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /and consumed_at is null/i);
  assert.match(migration, /grant execute on function consume_email_registration_token/i);
});