import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKEN_SIGNING_SECRET = "page-auth-unit-test-signing-secret";
const {
  generatePageAuthProof,
  hashPageOtpCode,
  validatePasswordReauthProof,
} = await import("./api-auth.js");

test("signed page verification proofs preserve the selected method", () => {
  const created = generatePageAuthProof("42", "reseller", "network.routers", "sms");
  const proof = validatePasswordReauthProof(created.proof);
  assert.ok(proof);
  assert.equal(proof.method, "sms");
  assert.equal(proof.feature, "network.routers");
  assert.equal(proof.role, "reseller");
});

test("page OTP hashes are bound to session, page, role, and method", () => {
  const input = {
    challengeId: "f5a31c7e-0f33-442f-a1f2-b0f44ef8087f",
    code: "123456",
    token: "session-token-one",
    uid: "42",
    role: "isp_admin" as const,
    feature: "network.routers",
    method: "whatsapp" as const,
  };
  const original = hashPageOtpCode(input);
  assert.equal(hashPageOtpCode(input), original);
  assert.notEqual(hashPageOtpCode({ ...input, token: "session-token-two" }), original);
  assert.notEqual(hashPageOtpCode({ ...input, feature: "billing.transactions" }), original);
  assert.notEqual(hashPageOtpCode({ ...input, method: "sms" }), original);
});