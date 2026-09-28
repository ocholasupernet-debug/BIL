import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareSecret,
  hashWhatsAppOtp,
  normalizeWhatsAppPhone,
} from "./whatsapp-service.js";

process.env.SESSION_SECRET ??= "whatsapp-service-test-secret";

test("normalizes Kenyan local, international, and 00-prefixed numbers", () => {
  assert.equal(normalizeWhatsAppPhone("0712 345 678", "254"), "+254712345678");
  assert.equal(normalizeWhatsAppPhone("254712345678", "254"), "+254712345678");
  assert.equal(normalizeWhatsAppPhone("+44 20 7183 8750", "254"), "+442071838750");
  assert.equal(normalizeWhatsAppPhone("00442071838750", "254"), "+442071838750");
  assert.equal(normalizeWhatsAppPhone("1234", "254"), null);
});

test("OTP hashes are challenge-bound and constant-time secret comparison is correct", () => {
  const hash = hashWhatsAppOtp("otp-challenge-a", "123456");
  assert.equal(hashWhatsAppOtp("otp-challenge-a", "123456"), hash);
  assert.notEqual(hashWhatsAppOtp("otp-challenge-b", "123456"), hash);
  assert.notEqual(hashWhatsAppOtp("otp-challenge-a", "654321"), hash);
  assert.equal(compareSecret("same", "same"), true);
  assert.equal(compareSecret("same", "different"), false);
});