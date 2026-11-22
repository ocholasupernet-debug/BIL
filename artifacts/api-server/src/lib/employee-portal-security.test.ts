import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptEmployeePayoutDetails,
  encryptEmployeePayoutDetails,
  hashEmployeePassword,
  isMoneyString,
  maskedPayoutLabel,
  normalizePayoutDestination,
  verifyEmployeePassword,
} from "./employee-portal-security.js";

test("employee passwords use a verifiable salted scrypt hash", async () => {
  const hash = await hashEmployeePassword("a long employee password");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyEmployeePassword(hash, "a long employee password"), true);
  assert.equal(await verifyEmployeePassword(hash, "wrong password"), false);
});

test("payout details are encrypted and masked labels reveal only the last four digits", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only employee encryption secret";
  try {
    const details = { accountName: "Jane Doe", bankName: "Example Bank", accountNumber: "001234567890" };
    const encrypted = encryptEmployeePayoutDetails(details);
    assert.equal(encrypted.ciphertext.includes(details.accountNumber), false);
    assert.deepEqual(decryptEmployeePayoutDetails(encrypted), details);
    assert.equal(maskedPayoutLabel("bank", details), "bank ending 7890");
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("KES inputs accept exact decimal strings and reject floating-point or malformed values", () => {
  assert.equal(isMoneyString("0"), true);
  assert.equal(isMoneyString("1250.50"), true);
  assert.equal(isMoneyString(1250.5), false);
  assert.equal(isMoneyString("1.005"), false);
  assert.equal(isMoneyString("-10"), false);
  assert.equal(isMoneyString("1e3"), false);
});

test("payout destination input is normalized and rejects incomplete bank details", () => {
  assert.deepEqual(
    normalizePayoutDestination("mpesa_b2c", { phone: "0712 345 678" }),
    { type: "mpesa_b2c", details: { phone: "254712345678", businessName: "" } },
  );
  assert.equal(normalizePayoutDestination("bank", { accountName: "Jane Doe", bankName: "Bank" }), null);
  assert.equal(
    normalizePayoutDestination("till", { tillNumber: "1234567" })?.details.tillNumber,
    "1234567",
  );
});
