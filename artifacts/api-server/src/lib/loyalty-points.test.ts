import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateHotspotLoyaltyAward,
  canRedeemHotspotPlan,
  resolveHotspotRedemptionPoints,
} from "./loyalty-points.js";

test("spend-based awards preserve fractional points to two decimal places", () => {
  assert.equal(calculateHotspotLoyaltyAward(275, 100, null), 2.75);
  assert.equal(calculateHotspotLoyaltyAward(5, 10, null), 0.5);
  assert.equal(calculateHotspotLoyaltyAward(1, 3, null), 0.33);
});

test("a fractional plan award overrides the global spend ratio, including an explicit zero", () => {
  assert.equal(calculateHotspotLoyaltyAward(1_000, 100, 35), 35);
  assert.equal(calculateHotspotLoyaltyAward(5, 10, 0.5), 0.5);
  assert.equal(calculateHotspotLoyaltyAward(1_000, 100, 0), 0);
  assert.equal(calculateHotspotLoyaltyAward(1_000, 100, 0.255), 0);
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
  assert.equal(canRedeemHotspotPlan(0.5, 1), false);
  assert.equal(canRedeemHotspotPlan(1.5, 1), true);
  const halfPointPurchase = calculateHotspotLoyaltyAward(5, 10, null);
  assert.equal(canRedeemHotspotPlan(halfPointPurchase, 1), false);
  assert.equal(canRedeemHotspotPlan(halfPointPurchase + halfPointPurchase, 1), true);
});

test("unconfigured Hotspot redemption costs default to the package price in whole points", () => {
  assert.equal(resolveHotspotRedemptionPoints(5, null), 5);
  assert.equal(resolveHotspotRedemptionPoints("10.00", undefined), 10);
  assert.equal(resolveHotspotRedemptionPoints(5.25, null), 6);
  assert.equal(resolveHotspotRedemptionPoints(10, 7), 7);
  assert.equal(resolveHotspotRedemptionPoints(10, 0), null);
  assert.equal(resolveHotspotRedemptionPoints(0, null), null);
  assert.equal(resolveHotspotRedemptionPoints(Number.POSITIVE_INFINITY, null), null);
});
