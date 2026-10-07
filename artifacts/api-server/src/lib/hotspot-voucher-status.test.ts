import assert from "node:assert/strict";
import test from "node:test";
import { summarizeHotspotVoucherStatus } from "./hotspot-voucher-status.js";

const now = Date.parse("2026-10-07T12:00:00.000Z");

test("summarizes a redeemed online voucher and calculates its service expiry", () => {
  const summary = summarizeHotspotVoucherStatus({
    sessions: [{
      acctstarttime: "2026-10-07T11:00:00.000Z",
      acctstoptime: null,
      callingstationid: "AA:BB:CC:DD:EE:FF",
      acctinputoctets: "1200",
      acctoutputoctets: "800",
    }],
    validityMins: 120,
    redeemBy: "2026-10-08T00:00:00.000Z",
    dataLimitMb: 100,
    dataCapMode: "disconnect",
    now,
  });

  assert.equal(summary.used, true);
  assert.equal(summary.online, true);
  assert.equal(summary.redeemedAt, "2026-10-07T11:00:00.000Z");
  assert.equal(summary.redeemedBy, "AA:BB:CC:DD:EE:FF");
  assert.equal(summary.expiry, "2026-10-07T13:00:00.000Z");
  assert.equal(summary.expiryKind, "service");
  assert.equal(summary.serviceStatus, "active");
  assert.equal(summary.dataLimitBytes, 100_000_000);
  assert.equal(summary.dataUsedBytes, 2_000);
});

test("marks a redeemed voucher inactive after expiry or a disconnect-mode data cap", () => {
  const session = {
    acctstarttime: "2026-10-07T09:00:00.000Z",
    acctstoptime: "2026-10-07T10:00:00.000Z",
    acctinputoctets: 600_000,
    acctoutputoctets: 400_000,
  };

  const dataDepleted = summarizeHotspotVoucherStatus({
    sessions: [session],
    validityMins: 0,
    redeemBy: null,
    dataLimitMb: 1,
    dataCapMode: "disconnect",
    now,
  });
  assert.equal(dataDepleted.serviceStatus, "inactive");

  const timeExpired = summarizeHotspotVoucherStatus({
    sessions: [session],
    validityMins: 60,
    redeemBy: null,
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });
  assert.equal(timeExpired.expiry, "2026-10-07T10:00:00.000Z");
  assert.equal(timeExpired.serviceStatus, "inactive");
  assert.equal(timeExpired.online, false);
});

test("keeps throttle-mode capped vouchers active after their threshold", () => {
  const summary = summarizeHotspotVoucherStatus({
    sessions: [{
      acctstarttime: "2026-10-07T11:00:00.000Z",
      acctstoptime: null,
      acctinputoctets: 1_000_000,
    }],
    validityMins: 0,
    redeemBy: null,
    dataLimitMb: 1,
    dataCapMode: "throttle",
    now,
  });

  assert.equal(summary.serviceStatus, "active");
  assert.equal(summary.dataUsedBytes, 1_000_000);
});

test("includes RADIUS gigawords when calculating a voucher's cumulative data use", () => {
  const summary = summarizeHotspotVoucherStatus({
    sessions: [{
      acctstarttime: "2026-10-07T11:00:00.000Z",
      acctstoptime: null,
      acctinputoctets: 1_200,
      acctinputgigawords: 1,
      acctoutputoctets: 800,
      acctoutputgigawords: 0,
    }],
    validityMins: 0,
    redeemBy: null,
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });

  assert.equal(summary.dataUsedBytes, 4_294_969_296);
});

test("prefers the saved service expiry over a duration-derived expiry", () => {
  const summary = summarizeHotspotVoucherStatus({
    sessions: [],
    validityMins: 60,
    redeemBy: null,
    redeemedAt: "2026-10-07T11:00:00.000Z",
    serviceExpiresAt: "2026-10-07T14:00:00.000Z",
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });

  assert.equal(summary.expiry, "2026-10-07T14:00:00.000Z");
  assert.equal(summary.serviceStatus, "active");
});

test("distinguishes an unused available voucher from an expired redemption window", () => {
  const available = summarizeHotspotVoucherStatus({
    sessions: [],
    validityMins: 60,
    redeemBy: "2026-10-08T00:00:00.000Z",
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });
  const expired = summarizeHotspotVoucherStatus({
    sessions: [],
    validityMins: 60,
    redeemBy: "2026-10-07T11:00:00.000Z",
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });

  assert.equal(available.serviceStatus, "available");
  assert.equal(available.expiryKind, "redeem_by");
  assert.equal(expired.serviceStatus, "expired");
});

test("uses the saved redemption time when a claimed voucher has no RADIUS session yet", () => {
  const summary = summarizeHotspotVoucherStatus({
    sessions: [],
    validityMins: 60,
    redeemBy: "2026-10-08T00:00:00.000Z",
    redeemedAt: "2026-10-07T11:30:00.000Z",
    redeemedBy: "254700000000",
    dataLimitMb: null,
    dataCapMode: "disconnect",
    now,
  });

  assert.equal(summary.used, true);
  assert.equal(summary.online, false);
  assert.equal(summary.redeemedAt, "2026-10-07T11:30:00.000Z");
  assert.equal(summary.redeemedBy, "254700000000");
  assert.equal(summary.expiry, "2026-10-07T12:30:00.000Z");
  assert.equal(summary.expiryKind, "service");
  assert.equal(summary.serviceStatus, "active");
});
