import assert from "node:assert/strict";
import test from "node:test";
import { calculateHotspotLoyaltyAward, canRedeemHotspotPlan } from "./loyalty-points.js";

test("spend-based awards grant whole points and ignore a partial remainder", () => {
  assert.equal(calculateHotspotLoyaltyAward(275, 100, null), 2);
});

test("a plan award overrides the global spend ratio, including an explicit zero", () => {
  assert.equal(calculateHotspotLoyaltyAward(1_000, 100, 35), 35);
  assert.equal(calculateHotspotLoyaltyAward(1_000, 100, 0), 0);
});

test("spend awards stay disabled until an administrator sets a positive ratio", () => {
  assert.equal(calculateHotspotLoyaltyAward(1_000, 0, null), 0);
  assert.equal(calculateHotspotLoyaltyAward(-1, 100, null), 0);
});

test("a plan is redeemable only when it has a positive point cost the user can cover", () => {
  assert.equal(canRedeemHotspotPlan(40, 40), true);
  assert.equal(canRedeemHotspotPlan(39, 40), false);
  assert.equal(canRedeemHotspotPlan(100, null), false);
  assert.equal(canRedeemHotspotPlan(100, 0), false);
});
