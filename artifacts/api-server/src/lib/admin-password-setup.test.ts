import assert from "node:assert/strict";
import test from "node:test";
import { isOtpPasswordSetupRequired } from "./admin-password-setup.js";

test("OTP login requires first-password setup for flagged and passwordless accounts", () => {
  assert.equal(isOtpPasswordSetupRequired({ id: 1, must_change_password: true, password: "temporary-hash" }), true);
  assert.equal(isOtpPasswordSetupRequired({ id: 2, must_change_password: false, password: null }), true);
  assert.equal(isOtpPasswordSetupRequired({ id: 3, must_change_password: false, password: "" }), true);
  assert.equal(isOtpPasswordSetupRequired({ id: 4, must_change_password: false, password: "stored-hash" }), false);
});

test("OTP login fails closed when password status was not selected", () => {
  assert.throws(() => isOtpPasswordSetupRequired({ id: 5, must_change_password: false }), /password status/);
});