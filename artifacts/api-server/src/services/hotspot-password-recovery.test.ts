import assert from "node:assert/strict";
import test from "node:test";
import {
  allowHotspotRecoveryLookup,
  hashHotspotRecoveryActionToken,
  hashHotspotRecoveryCode,
  hashHotspotRecoveryDestination,
  isHotspotRecoveryActionToken,
  isHotspotRecoveryChallengeId,
  isHotspotRecoveryCode,
  maskRecoveryEmail,
  maskRecoveryPhone,
} from "./hotspot-password-recovery.js";

test("email masking preserves only the first and last local-part letters and the domain", () => {
  assert.equal(maskRecoveryEmail("chris.phine@gmail.com"), "c****e@gmail.com");
  assert.equal(maskRecoveryEmail("x@example.co.ke"), "x***@example.co.ke");
  assert.equal(maskRecoveryEmail("not-an-email"), null);
  assert.equal(maskRecoveryEmail("user@"), null);
});

test("phone masking shows a short prefix and final digit only", () => {
  assert.equal(maskRecoveryPhone("+254 798 123 458"), "254798****8");
  assert.equal(maskRecoveryPhone("123"), null);
});

test("recovery inputs are validated and sensitive values are HMACed", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-for-hotspot-recovery";
  try {
    const challengeId = "5dbe1e98-0d88-4c03-9240-9f35cd52db8c";
    const code = "314159";
    const actionToken = "x".repeat(43);
    assert.equal(isHotspotRecoveryChallengeId(challengeId), true);
    assert.equal(isHotspotRecoveryCode(code), true);
    assert.equal(isHotspotRecoveryCode("31415"), false);
    assert.equal(isHotspotRecoveryActionToken(actionToken), true);
    assert.equal(isHotspotRecoveryActionToken("short"), false);
    assert.match(hashHotspotRecoveryCode(challengeId, code), /^[0-9a-f]{64}$/);
    assert.match(hashHotspotRecoveryActionToken(actionToken), /^[0-9a-f]{64}$/);
    assert.match(hashHotspotRecoveryDestination("email", "Person@Example.com"), /^[0-9a-f]{64}$/);
    assert.doesNotMatch(hashHotspotRecoveryCode(challengeId, code), new RegExp(code));
    assert.doesNotMatch(hashHotspotRecoveryActionToken(actionToken), new RegExp(actionToken));
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("recovery contact lookup throttles repeated attempts by address", () => {
  const ip = "recovery-test-lookup-198.51.100.73";
  const start = 1_800_000_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(allowHotspotRecoveryLookup(ip, start + attempt), true);
  }
  assert.equal(allowHotspotRecoveryLookup(ip, start + 11), false);
  assert.equal(allowHotspotRecoveryLookup(ip, start + 15 * 60 * 1000 + 1), true);
});
