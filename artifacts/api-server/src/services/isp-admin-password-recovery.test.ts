import assert from "node:assert/strict";
import test from "node:test";
import {
  isIspAdminRecoveryActionToken,
  isIspAdminRecoveryChallengeId,
  isIspAdminRecoveryCode,
  maskIspAdminRecoveryEmail,
  maskIspAdminRecoveryPhone,
} from "./isp-admin-password-recovery.js";

test("administrator recovery masks saved email and phone values", () => {
  assert.equal(maskIspAdminRecoveryEmail("jane.doe@example.com"), "j****e@example.com");
  assert.equal(maskIspAdminRecoveryEmail("a@example.co.ke"), "a***@example.co.ke");
  assert.equal(maskIspAdminRecoveryEmail("not-an-email"), null);
  assert.equal(maskIspAdminRecoveryPhone("+254798123458"), "254798****8");
  assert.equal(maskIspAdminRecoveryPhone("123"), null);
});

test("administrator recovery accepts only one-time code and token formats", () => {
  assert.equal(isIspAdminRecoveryCode("123456"), true);
  assert.equal(isIspAdminRecoveryCode("12345"), false);
  assert.equal(isIspAdminRecoveryChallengeId("62bb9752-6ab6-4ca6-97b9-09b28dd00a13"), true);
  assert.equal(isIspAdminRecoveryChallengeId("../private"), false);
  assert.equal(isIspAdminRecoveryActionToken("A".repeat(43)), true);
  assert.equal(isIspAdminRecoveryActionToken("short"), false);
});
