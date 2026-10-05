import assert from "node:assert/strict";
import test from "node:test";
import { latestMpesaStkPushHealth, withMpesaStkPushHealth } from "./mpesa-health.js";

test("M-Pesa health metadata preserves existing transaction metadata", () => {
  const metadata = withMpesaStkPushHealth(
    { source: "reseller_daraja_bridge", gatewayRouteId: 42 },
    {
      status: "available",
      paymentGateway: "mpesa_till_push",
      checkedAt: "2026-10-05T10:30:00.000Z",
    },
  );

  assert.deepEqual(metadata, {
    source: "reseller_daraja_bridge",
    gatewayRouteId: 42,
    stk_push_health: {
      status: "available",
      paymentGateway: "mpesa_till_push",
      checkedAt: "2026-10-05T10:30:00.000Z",
    },
  });
});

test("latest M-Pesa health follows the most recent completed prompt result", () => {
  const health = latestMpesaStkPushHealth([
    {
      created_at: "2026-10-05T10:31:00.000Z",
      payment_metadata: {
        stk_push_health: {
          status: "available",
          paymentGateway: "mpesa_paybill",
          checkedAt: "2026-10-05T10:32:00.000Z",
        },
      },
    },
    {
      created_at: "2026-10-05T10:32:00.000Z",
      payment_metadata: {
        stk_push_health: {
          status: "down",
          paymentGateway: "mpesa_till_push",
          checkedAt: "2026-10-05T10:33:00.000Z",
        },
      },
    },
  ]);

  assert.deepEqual(health, {
    status: "down",
    paymentGateway: "mpesa_till_push",
    checkedAt: "2026-10-05T10:33:00.000Z",
  });
});

test("invalid and unmarked transaction metadata does not claim M-Pesa availability", () => {
  assert.equal(latestMpesaStkPushHealth([
    { created_at: "2026-10-05T10:30:00.000Z", payment_metadata: {} },
    { created_at: "2026-10-05T10:31:00.000Z", payment_metadata: { stk_push_health: { status: "pending" } } },
    { created_at: "2026-10-05T10:32:00.000Z", payment_metadata: { stk_push_health: { status: "available", checkedAt: "bad" } } },
  ]), null);
});