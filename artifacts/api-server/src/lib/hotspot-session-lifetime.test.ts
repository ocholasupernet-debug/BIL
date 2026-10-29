import test from "node:test";
import assert from "node:assert/strict";
import { hotspotSessionExpiresAtMs } from "./hotspot-session-lifetime.js";

const nowMs = Date.parse("2026-10-29T00:00:00.000Z");

test("uses the paid daily, weekly, or monthly plan validity when no expiry is stored", () => {
  assert.equal(
    hotspotSessionExpiresAtMs({ nowMs, entitlementExpiresAt: null, planValidity: 1, planValidityUnit: "days" }),
    nowMs + 24 * 60 * 60 * 1000,
  );
  assert.equal(
    hotspotSessionExpiresAtMs({ nowMs, entitlementExpiresAt: null, planValidity: 1, planValidityUnit: "weeks" }),
    nowMs + 7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(
    hotspotSessionExpiresAtMs({ nowMs, entitlementExpiresAt: null, planValidity: 1, planValidityUnit: "months" }),
    nowMs + 30 * 24 * 60 * 60 * 1000,
  );
});

test("caps browser-session expiry at the already stored paid entitlement expiry", () => {
  const paidExpiry = nowMs + 4 * 24 * 60 * 60 * 1000;
  assert.equal(
    hotspotSessionExpiresAtMs({
      nowMs,
      entitlementExpiresAt: new Date(paidExpiry).toISOString(),
      planValidity: 1,
      planValidityUnit: "weeks",
    }),
    paidExpiry,
  );
});

test("does not extend an expired paid entitlement using the plan validity fallback", () => {
  const expiredAt = nowMs - 1000;
  assert.equal(
    hotspotSessionExpiresAtMs({
      nowMs,
      entitlementExpiresAt: new Date(expiredAt).toISOString(),
      planValidity: 1,
      planValidityUnit: "months",
    }),
    expiredAt,
  );
});

test("uses a one-day fallback only when both paid expiry and plan validity are absent", () => {
  assert.equal(
    hotspotSessionExpiresAtMs({ nowMs, entitlementExpiresAt: null, planValidity: null, planValidityUnit: null }),
    nowMs + 24 * 60 * 60 * 1000,
  );
});
