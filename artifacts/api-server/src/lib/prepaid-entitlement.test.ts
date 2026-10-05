import assert from "node:assert/strict";
import test from "node:test";
import {
  isPrepaidCustomerEntitled,
  isPrepaidCustomerExpired,
} from "./prepaid-entitlement.js";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const BEFORE_EXPIRY = "2026-10-05T12:00:01.000Z";
const AFTER_EXPIRY = "2026-10-05T11:59:59.000Z";

test("active and payment-cleared router-pending plans remain usable until expiry", () => {
  assert.equal(isPrepaidCustomerEntitled("active", BEFORE_EXPIRY, null, NOW), true);
  assert.equal(isPrepaidCustomerEntitled("payment_cleared_router_pending", BEFORE_EXPIRY, null, NOW), true);
  assert.equal(isPrepaidCustomerEntitled("expired", BEFORE_EXPIRY, null, NOW), true);
  assert.equal(isPrepaidCustomerEntitled("payment_cleared_router_pending", AFTER_EXPIRY, null, NOW), false);
  assert.equal(isPrepaidCustomerExpired("payment_cleared_router_pending", BEFORE_EXPIRY, null, NOW), false);
  assert.equal(isPrepaidCustomerExpired("expired", BEFORE_EXPIRY, null, NOW), false);
  assert.equal(isPrepaidCustomerExpired("active", AFTER_EXPIRY, null, NOW), true);
});

test("admin suspension and explicit data depletion remain enforcement boundaries", () => {
  assert.equal(isPrepaidCustomerEntitled("suspended", BEFORE_EXPIRY, null, NOW), false);
  assert.equal(isPrepaidCustomerEntitled("active", BEFORE_EXPIRY, "data_limit", NOW), false);
  assert.equal(isPrepaidCustomerExpired("suspended", AFTER_EXPIRY, null, NOW), false);
  assert.equal(isPrepaidCustomerExpired("active", BEFORE_EXPIRY, "data_limit", NOW), true);
});

test("expiry-required payment paths reject missing or malformed expiry values", () => {
  assert.equal(isPrepaidCustomerEntitled("active", null, null, NOW, true), false);
  assert.equal(isPrepaidCustomerEntitled("active", "not-a-date", null, NOW, true), false);
  assert.equal(isPrepaidCustomerEntitled("active", null, null, NOW), true);
  assert.equal(isPrepaidCustomerEntitled("pending", BEFORE_EXPIRY, null, NOW), false);
});
