import test from "node:test";
import assert from "node:assert/strict";
import {
  dataLimitMegabytesToBytes,
  fupRateLimitFromMbps,
  validateFupPolicy,
} from "../src/lib/fup-policy.js";

test("defaults capped plans to hard disconnect", () => {
  assert.deepEqual(validateFupPolicy("hotspot", 1000, undefined, undefined, undefined), {
    dataCapMode: "disconnect",
    fupSpeedDown: null,
    fupSpeedUp: null,
  });
});

test("accepts sub-1 Mbps throttle speeds for hotspot plans", () => {
  assert.deepEqual(validateFupPolicy("hotspot", "1000", "throttle", 0.5, 0.25, 10, 5), {
    dataCapMode: "throttle",
    fupSpeedDown: 0.5,
    fupSpeedUp: 0.25,
  });
  assert.equal(dataLimitMegabytesToBytes(1000), 1_000_000_000);
  assert.equal(fupRateLimitFromMbps(0.5, 0.25), "250k/500k");
});

test("rejects invalid caps and incomplete throttle policies", () => {
  assert.throws(() => validateFupPolicy("hotspot", -1, "disconnect", null, null), /positive finite/);
  assert.throws(() => validateFupPolicy("hotspot", 1000, "throttle", 0, 1), /positive finite reduced/);
  assert.throws(() => validateFupPolicy("pppoe", 1000, "throttle", 1, 1), /only for hotspot/);
  assert.throws(() => validateFupPolicy("hotspot", 1000, "throttle", 5, 0.5, 5, 10), /lower than/);
  assert.throws(() => dataLimitMegabytesToBytes(Number.MAX_VALUE), /byte range/);
});