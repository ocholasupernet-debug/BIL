import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlanValidityUnit, planValiditySeconds } from "./plan-validity.js";

test("normalizes the plan form's abbreviated units", () => {
  assert.equal(normalizePlanValidityUnit("Mins"), "mins");
  assert.equal(normalizePlanValidityUnit("Hrs"), "hours");
  assert.equal(normalizePlanValidityUnit("Weeks"), "weeks");
  assert.equal(normalizePlanValidityUnit("unknown"), "days");
});

test("converts plan validity using the selected unit", () => {
  assert.equal(planValiditySeconds(5, "mins"), 5 * 60);
  assert.equal(planValiditySeconds(5, "hours"), 5 * 60 * 60);
  assert.equal(planValiditySeconds(5, "days"), 5 * 24 * 60 * 60);
  assert.equal(planValiditySeconds(2, "weeks"), 2 * 7 * 24 * 60 * 60);
  assert.equal(planValiditySeconds(1, "months"), 30 * 24 * 60 * 60);
});