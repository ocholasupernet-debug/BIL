import assert from "node:assert/strict";
import test from "node:test";
import {
  isKenyanMobileNumber,
  kenyanMobilePhoneVariants,
  normaliseKenyanMobile,
} from "./kenyan-phone.js";
import { normalisePrepaidPhone } from "./prepaid-identifiers.js";

test("normalizes Kenyan 07 and 01 numbers to Daraja's country-code format", () => {
  for (const [input, expected] of [
    ["0712345678", "254712345678"],
    ["712345678", "254712345678"],
    ["+254712345678", "254712345678"],
    ["01 1234 5678", "254112345678"],
    ["0112345678", "254112345678"],
    ["112345678", "254112345678"],
    ["2541-123-45678", "254112345678"],
    ["+254112345678", "254112345678"],
  ]) {
    assert.equal(normaliseKenyanMobile(input), expected);
  }
});

test("rejects malformed or unsupported numbers and returns all Kenyan storage variants", () => {
  assert.equal(normaliseKenyanMobile("0201234567"), "");
  assert.equal(normaliseKenyanMobile("254212345678"), "");
  assert.equal(normaliseKenyanMobile("25411234567"), "");
  assert.equal(isKenyanMobileNumber("254112345678"), true);
  assert.equal(isKenyanMobileNumber("254012345678"), false);
  assert.equal(normalisePrepaidPhone("0112345678"), "254112345678");
  assert.equal(normalisePrepaidPhone("254112345678"), "254112345678");
  assert.deepEqual(kenyanMobilePhoneVariants("0112345678"), [
    "254112345678",
    "0112345678",
    "112345678",
  ]);
});
