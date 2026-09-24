import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedPlanType, normalizePlanServiceType } from "../src/lib/plan-service-type.js";

test("treats hotspot and trial plans as hotspot service plans", () => {
  assert.equal(normalizePlanServiceType("hotspot"), "hotspot");
  assert.equal(normalizePlanServiceType("HotSpot"), "hotspot");
  assert.equal(normalizePlanServiceType("trials"), "hotspot");
  assert.equal(normalizePlanServiceType("trial"), "hotspot");
  assert.equal(normalizePlanServiceType(null), "hotspot");
});

test("keeps PPPoE and unsupported services distinct", () => {
  assert.equal(normalizePlanServiceType("pppoe"), "pppoe");
  assert.equal(normalizePlanServiceType("VLAN"), "vlan");
  assert.equal(normalizePlanServiceType("static"), "other");
  assert.equal(normalizePlanServiceType("unknown"), "other");
  assert.equal(isSupportedPlanType("VLAN"), true);
  assert.equal(isSupportedPlanType("static"), true);
  assert.equal(isSupportedPlanType("other"), false);
});