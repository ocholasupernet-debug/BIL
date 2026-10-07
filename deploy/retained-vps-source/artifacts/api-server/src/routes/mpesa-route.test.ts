import assert from "node:assert/strict";
import { test } from "node:test";
import { processMpesaCallback } from "./mpesa-route.js";

const successfulCallback = {
  Body: {
    stkCallback: {
      ResultCode: 0,
      ResultDesc: "Success",
      CheckoutRequestID: "ws_CO_reseller_test_1",
      MerchantRequestID: "merchant_request_1",
      CallbackMetadata: { Item: [] },
    },
  },
};

function pendingTransaction(paymentMetadata?: unknown) {
  return {
    id: 91,
    admin_id: 7,
    customer_id: null,
    plan_id: null,
    reseller_id: 21,
    reseller_port_id: null,
    amount: 5,
    payment_method: "mpesa",
    payment_metadata: paymentMetadata,
    payment_phone: "254712345678",
    mac_address: null,
  };
}

test("reseller gateway test callbacks use isolated settlement without provisioning or normal credits", async () => {
  let normalSettlementCalls = 0;
  let testSettlementCalls = 0;
  let provisioningCalls = 0;

  const processed = await processMpesaCallback(successfulCallback, {
    selectPending: async filter => {
      assert.match(filter, /payment_metadata/);
      return [pendingTransaction({ source: "reseller_gateway_test" })];
    },
    getSettings: async () => ({} as never),
    verifyStk: async () => ({ verified: true, resultCode: 0, resultDesc: "Success" }),
    reactivatePppoeAccess: async () => {
      provisioningCalls += 1;
      return { ok: true };
    },
    reactivateVlanAccess: async () => {
      provisioningCalls += 1;
      return { ok: true };
    },
    settle: async () => {
      normalSettlementCalls += 1;
      return [{ settled: true, payment_method: "mpesa", admin_id: 7, amount: 5, credited_customer_id: null }];
    },
    settleResellerTest: async args => {
      testSettlementCalls += 1;
      assert.equal(args.p_transaction_id, 91);
      assert.equal(args.p_status, "completed");
      return [{ settled: true, payment_method: "mpesa", admin_id: 7, amount: 5, credited_customer_id: null }];
    },
  });

  assert.equal(processed, true);
  assert.equal(testSettlementCalls, 1);
  assert.equal(normalSettlementCalls, 0);
  assert.equal(provisioningCalls, 0);
});

test("ordinary M-Pesa callbacks continue using normal settlement", async () => {
  let normalSettlementCalls = 0;
  let testSettlementCalls = 0;

  const processed = await processMpesaCallback(successfulCallback, {
    selectPending: async () => [pendingTransaction()],
    getSettings: async () => ({} as never),
    verifyStk: async () => ({ verified: true, resultCode: 0, resultDesc: "Success" }),
    reactivatePppoeAccess: async () => ({ ok: true }),
    reactivateVlanAccess: async () => ({ ok: true }),
    settle: async () => {
      normalSettlementCalls += 1;
      return [{ settled: true, payment_method: "mpesa", admin_id: 7, amount: 5, credited_customer_id: null }];
    },
    settleResellerTest: async () => {
      testSettlementCalls += 1;
      return [];
    },
  });

  assert.equal(processed, true);
  assert.equal(normalSettlementCalls, 1);
  assert.equal(testSettlementCalls, 0);
});