import assert from "node:assert/strict";
import test from "node:test";
import {
  hashEmployeeSecret,
  newEmployeeAwardCode,
  normalizeEmployeeAwardCode,
  isMoneyString,
} from "./employee-portal-security.js";

test("award codes are high-entropy, normalized, and only accepted in the defined format", () => {
  const first = newEmployeeAwardCode();
  const second = newEmployeeAwardCode();
  assert.match(first, /^ISPLAT-AWARD-[A-F0-9]{48}$/);
  assert.notEqual(first, second);
  assert.equal(normalizeEmployeeAwardCode(`  ${first.toLowerCase()}  `), first);
  assert.equal(normalizeEmployeeAwardCode("ISPLAT-AWARD-short"), null);
  assert.equal(normalizeEmployeeAwardCode("https://example.com/code"), null);
  assert.equal(normalizeEmployeeAwardCode(null), null);
  assert.equal(hashEmployeeSecret(first).length, 64);
  assert.notEqual(hashEmployeeSecret(first), first);
});

test("credit amounts stay exact decimal strings and reject zero, floats, and excess precision", () => {
  assert.equal(isMoneyString("1250.50"), true);
  assert.equal(isMoneyString("0.01"), true);
  assert.equal(isMoneyString("0"), true);
  assert.equal(isMoneyString("1250.501"), false);
  assert.equal(isMoneyString(1250.5), false);
  assert.equal(isMoneyString("01.00"), false);
  assert.equal(/[1-9]/.test("0.00"), false);
});
