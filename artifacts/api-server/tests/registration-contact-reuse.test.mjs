import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  migration,
  migrationRunner,
  adminRegister,
  authController,
  registrationRoute,
  smsRoute,
  whatsappRoute,
] = await Promise.all([
  read("../migrations/2026_registration_contact_reuse_limit.sql"),
  read("../scripts/apply-deployment-migrations.mjs"),
  read("../../ochola-supernet/src/pages/admin/AdminRegister.tsx"),
  read("../src/controllers/auth-controller.ts"),
  read("../src/routes/registration-route.ts"),
  read("../src/routes/sms-route.ts"),
  read("../src/routes/whatsapp-route.ts"),
]);

test("registration contact reuse is capped safely and the migration is deployed", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /email_count\s*>=\s*7/);
  assert.match(migration, /phone_count\s*>=\s*7/);
  assert.match(migration, /registration_phone_key/);
  assert.match(migration, /payment_failed/);
  assert.match(migrationRunner, /2026_registration_contact_reuse_limit\.sql/);
});

test("registration accepts reused contacts without advertising the allowance", () => {
  assert.match(adminRegister, /setCompany\(e\.target\.value\.toLowerCase\(\)\)/);
  assert.doesNotMatch(adminRegister, /phoneAvailable|checkingPhone|Phone already registered/);
  assert.doesNotMatch(adminRegister, /reused for multiple ISP registrations/);
  assert.match(registrationRoute, /checkRegistrationContactCapacity\(email, phoneE164\)/);
  assert.match(authController, /checkRegistrationContactCapacity\(email, null\)/);
});

test("registration does not require email verification", () => {
  assert.match(adminRegister, /Email address/);
  assert.doesNotMatch(adminRegister, /emailVerificationToken|requestEmailVerification|verifyRegistrationEmail|Send email verification code/);
  assert.doesNotMatch(registrationRoute, /consumeEmailRegistrationToken|emailVerificationToken|Verify your email address before continuing registration/);
  assert.doesNotMatch(authController, /consumeEmailRegistrationToken|emailVerificationToken|Verify your email address before creating an account/);
});

test("registration OTP is delivered for contact numbers still within the account cap", () => {
  assert.match(smsRoute, /checkRegistrationContactCapacity\(null, phone\)/);
  assert.match(whatsappRoute, /checkRegistrationContactCapacity\(null, phone\)/);
});