import assert from "node:assert/strict";
import test from "node:test";
import { customerStatusForExpiryEdit } from "./customer-expiry-edit.js";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

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
