import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerServiceStatus } from "./customer-service-status";

const NOW = Date.parse("2026-10-06T00:00:00.000Z");

test("counts a current active account as active when it has no expiry", () => {
  assert.equal(getCustomerServiceStatus({ status: "active", expires_at: null }, NOW), "active");
});

test("marks an account expired when its expiry has passed even if its stored status is active", () => {
  assert.equal(
    getCustomerServiceStatus({ status: "active", expires_at: "2026-10-05T23:59:59.000Z" }, NOW),
    "expired",
  );
});

test("restores active status when a stale expired row has a future entitlement", () => {
  assert.equal(
    getCustomerServiceStatus({ status: "expired", expires_at: "2026-10-07T00:00:00.000Z" }, NOW),
    "active",
  );
});

test("counts paid accounts awaiting router reconciliation when their entitlement is current", () => {
  assert.equal(
    getCustomerServiceStatus({
      status: "payment_cleared_router_pending",
      expires_at: "2026-10-07T00:00:00.000Z",
    }, NOW),
    "active",
  );
});

test("keeps suspended accounts out of both active and expired counts", () => {
  assert.equal(
    getCustomerServiceStatus({ status: "suspended", expires_at: "2026-10-05T00:00:00.000Z" }, NOW),
    "suspended",
  );
});

test("treats data-limit depletion as expired even before the time expiry", () => {
  assert.equal(
    getCustomerServiceStatus({
      status: "active",
      expires_at: "2026-10-07T00:00:00.000Z",
      depletion_reason: "data_limit",
    }, NOW),
    "expired",
  );
});

test("does not count an invalid expiry as active", () => {
  assert.equal(
    getCustomerServiceStatus({ status: "active", expires_at: "not-a-date" }, NOW),
    "unknown",
  );
});
