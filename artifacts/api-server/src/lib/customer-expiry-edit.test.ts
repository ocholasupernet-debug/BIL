import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCustomerExtensionExpiry,
  customerStatusForExpiryEdit,
} from "./customer-expiry-edit.js";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

test("extensions are calculated from the current future expiry", () => {
  assert.equal(
    calculateCustomerExtensionExpiry("2026-10-10T12:00:00.000Z", 30, NOW),
    "2026-11-09T12:00:00.000Z",
  );
});

test("extensions for expired or unlimited accounts start from now", () => {
  assert.equal(
    calculateCustomerExtensionExpiry("2026-10-01T12:00:00.000Z", 1, NOW),
    "2026-10-06T12:00:00.000Z",
  );
  assert.equal(
    calculateCustomerExtensionExpiry(null, 1, NOW),
    "2026-10-06T12:00:00.000Z",
  );
});

test("extension duration is restricted to whole days from 1 through 3650", () => {
  for (const days of [0, -1, 1.5, 3651, "30", null]) {
    assert.throws(() => calculateCustomerExtensionExpiry(null, days, NOW), /whole-number extension/);
  }
});

test("expiry edits activate future-dated customers", () => {
  assert.equal(customerStatusForExpiryEdit("expired", "2026-10-05T13:00:00.000Z", NOW), "active");
});

test("expiry edits immediately expire customers with a past date", () => {
  assert.equal(customerStatusForExpiryEdit("active", "2026-10-05T11:59:59.000Z", NOW), "expired");
});

test("expiry edits preserve suspension regardless of the selected date", () => {
  assert.equal(customerStatusForExpiryEdit("suspended", "2026-10-06T12:00:00.000Z", NOW), "suspended");
  assert.equal(customerStatusForExpiryEdit("SUSPENDED", null, NOW), "suspended");
});

test("clearing an expiry makes a non-suspended customer active", () => {
  assert.equal(customerStatusForExpiryEdit("expired", null, NOW), "active");
});
