import assert from "node:assert/strict";
import { test } from "node:test";
import { TENANT_BASE_DOMAIN } from "../../lib/tenant-host.js";
import {
  compareSecret,
  createWhatsAppWelcomeSetupUrl,
  hashWhatsAppOtp,
  normalizeWhatsAppPhone,
  sanitizeWhatsAppSignInContext,
} from "./whatsapp-service.js";

process.env.SESSION_SECRET ??= "whatsapp-service-test-secret";
process.env.TOKEN_SIGNING_SECRET ??= "whatsapp-service-test-token-secret";

test("normalizes Kenyan local, international, and 00-prefixed numbers", () => {
  assert.equal(normalizeWhatsAppPhone("0712 345 678", "254"), "+254712345678");
  assert.equal(normalizeWhatsAppPhone("254712345678", "254"), "+254712345678");
  assert.equal(normalizeWhatsAppPhone("+44 20 7183 8750", "254"), "+442071838750");
  assert.equal(normalizeWhatsAppPhone("00442071838750", "254"), "+442071838750");
  assert.equal(normalizeWhatsAppPhone("1234", "254"), null);
});

test("OTP hashes are challenge-bound and constant-time secret comparison is correct", () => {
  const hash = hashWhatsAppOtp("otp-challenge-a", "123456");

  const context = sanitizeWhatsAppSignInContext(
    "203.0.113.8\nforged",
    `Mozilla/5.0\u0000${"x".repeat(220)}`,
  );
  assert.equal(hashWhatsAppOtp("otp-challenge-a", "123456"), hash);
  assert.notEqual(hashWhatsAppOtp("otp-challenge-b", "123456"), hash);
  assert.notEqual(hashWhatsAppOtp("otp-challenge-a", "654321"), hash);
  assert.equal(compareSecret("same", "same"), true);
  assert.equal(compareSecret("same", "different"), false);
});

test("welcome links carry a signed setup token in the URL fragment, never a password", () => {
  const setupUrl = new URL(createWhatsAppWelcomeSetupUrl(42, "isp-example", true));
  const setupToken = new URLSearchParams(setupUrl.hash.slice(1)).get("setupToken");
  assert.equal(setupUrl.origin, `https://isp-example.${TENANT_BASE_DOMAIN}`);
  assert.equal(setupUrl.pathname, "/admin/set-password");
  assert.equal(setupUrl.search, "");
  assert.ok(setupToken);
  assert.equal(setupUrl.searchParams.has("password"), false);
  assert.throws(() => createWhatsAppWelcomeSetupUrl(42, "bad/path", true));

  const loginUrl = new URL(createWhatsAppWelcomeSetupUrl(42, "isp-example", false));
  assert.equal(loginUrl.pathname, "/admin/login");
  assert.equal(loginUrl.hash, "");
});
