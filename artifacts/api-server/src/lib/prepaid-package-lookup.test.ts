import assert from "node:assert/strict";
import test from "node:test";
import { resolvePrepaidPackagePlanId } from "./prepaid-package-lookup.js";

test("uses the successful payment package when the prepaid customer has no assigned plan", () => {
  assert.equal(resolvePrepaidPackagePlanId(null, 42), 42);
});

test("prefers the latest successful payment package like the Prepaid Users list", () => {
  assert.equal(resolvePrepaidPackagePlanId(12, "42"), 42);
});

test("falls back to the assigned customer plan when no successful payment has a plan", () => {
  assert.equal(resolvePrepaidPackagePlanId(12, null), 12);
  assert.equal(resolvePrepaidPackagePlanId(12, "0"), 12);
});

test("ignores invalid plan IDs rather than querying an arbitrary package", () => {
  assert.equal(resolvePrepaidPackagePlanId(null, -1), null);
  assert.equal(resolvePrepaidPackagePlanId("invalid", undefined), null);
  assert.equal(resolvePrepaidPackagePlanId(1.5, 9007199254740992), null);
});
