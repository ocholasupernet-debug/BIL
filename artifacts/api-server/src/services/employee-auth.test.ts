import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmployeeAuthService,
  isStaffOtpChallengeId,
  isStaffOtpCode,
  normalizeStaffEmail,
  normalizeStaffPhone,
  StaffOtpDeliveryError,
  StaffOtpRateLimitError,
} from "./employee-auth.js";

const employeeId = "00000000-0000-4000-8000-000000000001";
const challengeId = "00000000-0000-4000-8000-000000000002";
process.env.SESSION_SECRET = "test-only-staff-auth-signing-key";

test("normalizes valid Staff identity inputs and rejects malformed values", () => {
  assert.equal(normalizeStaffEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeStaffEmail("not-an-email"), null);
  assert.equal(normalizeStaffPhone("0712 345 678"), "254712345678");
  assert.equal(normalizeStaffPhone("+254 112 345 678"), "254112345678");
  assert.equal(normalizeStaffPhone("123"), null);
  assert.equal(isStaffOtpChallengeId(challengeId), true);
  assert.equal(isStaffOtpChallengeId("not-a-uuid"), false);
  assert.equal(isStaffOtpCode("012345"), true);
  assert.equal(isStaffOtpCode("12345"), false);
});

test("signup verification stores only hashes and creates a transient one-time action token", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const emails: Array<{ to: string; text: string }> = [];
  const service = createEmployeeAuthService({
    newChallengeId: () => challengeId,
    newOtpCode: () => "013579",
    newActionToken: () => "A".repeat(43),
    now: () => 1_800_000_000_000,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const outcome = name === "employee_issue_signup_otp" ? "issued"
        : name === "employee_verify_signup_otp" ? "verified"
          : "accepted";
      return [{ outcome }];
    },
    sendEmail: async (message) => {
      emails.push({ to: message.to, text: message.text ?? "" });
    },
  });

  const issued = await service.requestSignupOtp("User@Example.com", "203.0.113.8");
  assert.deepEqual(issued, { challengeId, expiresInSeconds: 300 });
  assert.equal(emails[0]?.to, "user@example.com");
  assert.match(emails[0]?.text ?? "", /013579/);
  const issueArgs = rpcCalls[0]?.args ?? {};
  assert.notEqual(issueArgs.p_otp_hash, "013579");
  assert.match(String(issueArgs.p_otp_hash), /^[0-9a-f]{64}$/);

  const actionToken = await service.verifySignupOtp({
    email: "user@example.com",
    challengeId,
    code: "013579",
  });
  assert.equal(actionToken, "A".repeat(43));
  const verifyArgs = rpcCalls[1]?.args ?? {};
  assert.notEqual(verifyArgs.p_action_token_hash, actionToken);
  assert.match(String(verifyArgs.p_action_token_hash), /^[0-9a-f]{64}$/);

  const outcome = await service.completeSignup({
    email: "user@example.com",
    emailVerificationToken: actionToken,
    fullName: "Example Staff",
    phone: "254712345678",
    passwordHash: `scrypt$${"a".repeat(22)}$${"b".repeat(86)}`,
    accountType: "technician",
  });
  assert.equal(outcome, "accepted");
  const completeArgs = rpcCalls[2]?.args ?? {};
  assert.notEqual(completeArgs.p_action_token_hash, actionToken);
  assert.equal(completeArgs.p_password_hash, `scrypt$${"a".repeat(22)}$${"b".repeat(86)}`);
  assert.equal(completeArgs.p_account_type, "technician");
  assert.equal(JSON.stringify(rpcCalls).includes("013579"), false);
});

test("login OTP is not returned to the client and is bound to the active account", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let emailedCode = "";
  const service = createEmployeeAuthService({
    newChallengeId: () => challengeId,
    newOtpCode: () => "246802",
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "employee_issue_login_otp") return [{ outcome: "issued" }];
      return [{ outcome: "verified", employee_id: employeeId }];
    },
    sendEmail: async (message) => {
      emailedCode = (message.text ?? "").match(/\b\d{6}\b/)?.[0] ?? "";
    },
  });

  const challenge = await service.requestLoginOtp({
    employeeId,
    email: "staff@example.com",
    ipAddress: "203.0.113.9",
  });
  assert.deepEqual(challenge, { challengeId, expiresInSeconds: 300 });
  assert.equal(emailedCode, "246802");
  assert.equal(JSON.stringify(challenge).includes(emailedCode), false);
  assert.notEqual(rpcCalls[0]?.args.p_otp_hash, emailedCode);
  assert.equal(await service.verifyLoginOtp({
    challengeId,
    email: "staff@example.com",
    code: emailedCode,
  }), employeeId);
});

test("rate limits and email delivery failure fail closed", async () => {
  let sent = false;
  const limitedService = createEmployeeAuthService({
    newChallengeId: () => challengeId,
    newOtpCode: () => "135790",
    rpc: async () => [{ outcome: "limited" }],
    sendEmail: async () => { sent = true; },
  });
  await assert.rejects(
    limitedService.requestSignupOtp("staff@example.com", "203.0.113.4"),
    StaffOtpRateLimitError,
  );
  assert.equal(sent, false);

  const invalidated: string[] = [];
  const deliveryFailureService = createEmployeeAuthService({
    newChallengeId: () => challengeId,
    newOtpCode: () => "135790",
    rpc: async (name) => {
      invalidated.push(name);
      return [{ outcome: "issued" }];
    },
    sendEmail: async () => { throw new Error("private mail transport error"); },
  });
  await assert.rejects(
    deliveryFailureService.requestSignupOtp("staff@example.com", "203.0.113.4"),
    StaffOtpDeliveryError,
  );
  assert.deepEqual(invalidated, ["employee_issue_signup_otp", "employee_invalidate_signup_otp"]);
});
