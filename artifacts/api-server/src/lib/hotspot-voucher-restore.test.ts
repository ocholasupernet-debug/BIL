import assert from "node:assert/strict";
import test from "node:test";
import { calculateHotspotVoucherRestoreLimits } from "./hotspot-voucher-restore.js";

test("restores a limited voucher with only its unused bytes remaining", () => {
  const limits = calculateHotspotVoucherRestoreLimits({
    dataLimitBytes: 1_000_000_000,
    dataCapMode: "disconnect",
    radiusUsedBytes: 400_000_000,
    routerUsedBytes: 200_000_000,
  });

  assert.equal(limits.accountedBytes, 400_000_000);
  assert.equal(limits.remainingBytes, 600_000_000);
  assert.equal(limits.limitBytesTotal, 800_000_000);
  assert.equal(limits.fupThresholdBytes, null);
});

test("restores a throttle voucher with its remaining threshold and no hard cap", () => {
  const limits = calculateHotspotVoucherRestoreLimits({
    dataLimitBytes: 1_000_000,
    dataCapMode: "throttle",
    radiusUsedBytes: 600_000,
    routerUsedBytes: 250_000,
  });

  assert.equal(limits.remainingBytes, 400_000);
  assert.equal(limits.limitBytesTotal, 0);
  assert.equal(limits.fupThresholdBytes, 650_000);
});

test("keeps already-consumed throttle vouchers immediately eligible for throttling", () => {
  const limits = calculateHotspotVoucherRestoreLimits({
    dataLimitBytes: 1_000_000,
    dataCapMode: "throttle",
    radiusUsedBytes: 1_200_000,
    routerUsedBytes: 0,
  });

  assert.equal(limits.remainingBytes, 0);
  assert.equal(limits.fupThresholdBytes, 1);
});

test("unlimited vouchers restore without a byte cap or FUP scheduler", () => {
  const limits = calculateHotspotVoucherRestoreLimits({
    dataLimitBytes: null,
    dataCapMode: "disconnect",
    radiusUsedBytes: 50_000,
    routerUsedBytes: 30_000,
  });

  assert.equal(limits.accountedBytes, 50_000);
  assert.equal(limits.remainingBytes, null);
  assert.equal(limits.limitBytesTotal, 0);
  assert.equal(limits.fupThresholdBytes, null);
});
