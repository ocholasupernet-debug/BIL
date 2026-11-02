import assert from "node:assert/strict";
import test from "node:test";
import {
  processMpesaCallback,
  type MpesaCallbackDependencies,
} from "./mpesa-route.js";

process.env.NODE_ENV = "test";

function callbackBody(metadata: Array<{ Name: string; Value: string | number }>) {
  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: "ws_CO_1234567890",
        MerchantRequestID: "merchant-request-1",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully",
        CallbackMetadata: { Item: metadata },
      },
    },
  };
}

function callbackHarness(metadata: Array<{ Name: string; Value: string | number }>) {
  const calls = { saveReceipt: 0, settle: 0 };
  const transaction = {
    id: 77,
    admin_id: null,
    customer_id: null,
    plan_id: null,
    reseller_id: null,
    reseller_port_id: null,
    amount: 20,
    payment_method: "mpesa",
    payment_phone: "254712345678",
    mac_address: null,
  };
  const dependencies: Partial<MpesaCallbackDependencies> = {
    selectPending: async () => [transaction],
    saveReceipt: async () => {
      calls.saveReceipt += 1;
      return true;
    },
    getSettings: async () => ({} as never),
    verifyStk: async () => ({
      verified: true,
      resultCode: 0,
      resultDesc: "The service request is processed successfully",
    }),
    settle: async () => {
      calls.settle += 1;
      return [{
        settled: true,
        payment_method: "mpesa",
        admin_id: null,
        amount: 20,
        credited_customer_id: null,
      }];
    },
  };
  return { body: callbackBody(metadata), calls, dependencies };
}

const matchingMetadata = [
  { Name: "Amount", Value: 20 },
  { Name: "MpesaReceiptNumber", Value: "RKL8P4K2FQ" },
  { Name: "PhoneNumber", Value: "254712345678" },
];

test("settles an STK callback only when amount and phone match the saved intent", async () => {
  const harness = callbackHarness(matchingMetadata);

  assert.equal(await processMpesaCallback(harness.body, harness.dependencies), true);
  assert.deepEqual(harness.calls, { saveReceipt: 1, settle: 1 });
});

test("leaves a Daraja-confirmed callback pending when its amount differs", async () => {
  const harness = callbackHarness([
    ...matchingMetadata.filter(item => item.Name !== "Amount"),
    { Name: "Amount", Value: 19 },
  ]);

  assert.equal(await processMpesaCallback(harness.body, harness.dependencies), false);
  assert.deepEqual(harness.calls, { saveReceipt: 0, settle: 0 });
});

test("leaves a Daraja-confirmed callback pending when its phone differs or is missing", async t => {
  await t.test("different phone", async () => {
    const harness = callbackHarness([
      ...matchingMetadata.filter(item => item.Name !== "PhoneNumber"),
      { Name: "PhoneNumber", Value: "254700000000" },
    ]);
    assert.equal(await processMpesaCallback(harness.body, harness.dependencies), false);
    assert.deepEqual(harness.calls, { saveReceipt: 0, settle: 0 });
  });

  await t.test("missing phone", async () => {
    const harness = callbackHarness(matchingMetadata.filter(item => item.Name !== "PhoneNumber"));
    assert.equal(await processMpesaCallback(harness.body, harness.dependencies), false);
    assert.deepEqual(harness.calls, { saveReceipt: 0, settle: 0 });
  });
});
