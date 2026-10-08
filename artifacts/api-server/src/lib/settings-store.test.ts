import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REGISTRATION_FEE,
  normaliseRegistrationFee,
  resolveStoredRegistrationFee,
} from "./settings-store.js";

test("registration fee defaults to KSh 700 when no valid saved value exists", () => {
  assert.equal(DEFAULT_REGISTRATION_FEE, 700);
  assert.equal(normaliseRegistrationFee(undefined), 700);
  assert.equal(normaliseRegistrationFee(0), 700);
  assert.equal(normaliseRegistrationFee("700"), 700);
});

test("legacy unversioned KSh 10 registration fee upgrades to the new KSh 700 default", () => {
  assert.equal(resolveStoredRegistrationFee(10, undefined), 700);
});

test("a versioned Super Admin setting may intentionally use KSh 10", () => {
  assert.equal(resolveStoredRegistrationFee(10, 1), 10);
});

test("valid custom registration fees remain unchanged", () => {
  assert.equal(resolveStoredRegistrationFee(850, undefined), 850);
  assert.equal(resolveStoredRegistrationFee(2500, 1), 2500);
});
