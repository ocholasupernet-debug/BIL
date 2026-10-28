import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryablePaidHotspotAccount,
  type HotspotPlanRetryScope,
  type PaidHotspotTransactionForRetry,
  type PendingHotspotCustomerForRetry,
} from "./hotspot-activation-retry.js";

const NOW = Date.parse("2026-10-28T06:00:00.000Z");
const customer: PendingHotspotCustomerForRetry = {
  id: 12,
  admin_id: 7,
  plan_id: 46,
  type: "hotspot",
  status: "payment_cleared_router_pending",
  mac_address: "FE:9F:05:D6:CF:DE",
  router_id: 243,
  port_id: null,
  expires_at: "2026-10-29T06:00:00.000Z",
  depletion_reason: null,
};
const transaction: PaidHotspotTransactionForRetry = {
  id: 99,
  admin_id: 7,
  customer_id: 12,
  plan_id: 46,
  status: "completed",
  payment_method: "mpesa",
  payment_intent_id: "payment-intent",
  reference: "checkout_123456",
  mac_address: "fe-9f-05-d6-cf-de",
};
const plan: HotspotPlanRetryScope = {
  type: "hotspot",
  router_id: 243,
  port_id: null,
};

test("paid pending Hotspot purchases retry by verified linked records without a note dependency", () => {
  assert.equal(isRetryablePaidHotspotAccount(customer, transaction, plan, NOW), true);
});

test("expired, depleted, mis-scoped, or mismatched purchase records never retry", () => {
  assert.equal(isRetryablePaidHotspotAccount({ ...customer, status: "active" }, transaction, plan, NOW), false);
  assert.equal(isRetryablePaidHotspotAccount({ ...customer, status: "active" }, transaction, plan, NOW, true), true);
  assert.equal(isRetryablePaidHotspotAccount({ ...customer, expires_at: "2026-10-28T05:59:59.000Z" }, transaction, plan, NOW), false);
  assert.equal(isRetryablePaidHotspotAccount({ ...customer, depletion_reason: "data_limit" }, transaction, plan, NOW), false);
  assert.equal(isRetryablePaidHotspotAccount(customer, transaction, { ...plan, router_id: 248 }, NOW), false);
  assert.equal(isRetryablePaidHotspotAccount(customer, { ...transaction, mac_address: "00:11:22:33:44:55" }, plan, NOW), false);
  assert.equal(isRetryablePaidHotspotAccount(customer, { ...transaction, payment_intent_id: null }, plan, NOW), false);
});
