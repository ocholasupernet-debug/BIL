import assert from "node:assert/strict";
import test from "node:test";
import {
  buildB2bCallbackUrl,
  b2bCommandForDestination,
  initiateDarajaB2bPayout,
  parseDarajaB2bResult,
  validateB2bPayout,
} from "./employee-daraja-b2b.js";

const credentials = {
  consumerKey: "b2b-only-test-key",
  consumerSecret: "b2b-only-test-secret",
  initiatorName: "b2b-test-initiator",
  securityCredential: "b2b-test-security-credential",
  shortcode: "600001",
};
const baseInput = {
  credentials,
  environment: "sandbox" as const,
  destinationType: "paybill" as const,
  amountKes: "250",
  destinationNumber: "123456",
  accountReference: "STAFF123",
  originatorConversationId: "STAFFB2B0123456789abcdef",
  resultUrl: "https://staff.test.invalid/api/b2b/result?token=opaque-token",
  queueTimeoutUrl: "https://staff.test.invalid/api/b2b/timeout?token=opaque-token",
};

test("B2B uses its own credentials and sends the documented Paybill command", async () => {
  let payload: Record<string, unknown> = {};
  let requestUrl = "";
  const result = await initiateDarajaB2bPayout(baseInput, {
    getToken: async (supplied, host) => {
      assert.equal(supplied.consumerKey, credentials.consumerKey);
      assert.equal(host, "https://sandbox.safaricom.co.ke");
      return "b2b-test-access-token";
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ResponseCode: "0",
        OriginatorConversationID: baseInput.originatorConversationId,
        ConversationID: "AG_B2B_20261123_1",
      }), { status: 200 });
    },
  });
  assert.equal(result.outcome, "submitted");
  assert.equal(requestUrl, "https://sandbox.safaricom.co.ke/mpesa/b2b/v1/paymentrequest");
  assert.equal(payload.CommandID, "BusinessPayBill");
  assert.equal(payload.PartyA, "600001");
  assert.equal(payload.PartyB, "123456");
  assert.equal(payload.AccountReference, "STAFF123");
  assert.equal(payload.RecieverIdentifierType, "4");
  assert.equal(JSON.stringify(result).includes(credentials.consumerSecret), false);
});

test("B2B maps Till separately and rejects unsafe configuration before provider calls", async () => {
  assert.equal(b2bCommandForDestination("paybill"), "BusinessPayBill");
  assert.equal(b2bCommandForDestination("till"), "BusinessBuyGoods");
  assert.throws(() => validateB2bPayout({ ...baseInput, destinationNumber: "1234" }), /destination/);
  assert.throws(() => validateB2bPayout({ ...baseInput, accountReference: "ACCOUNTREFERENCE14" }), /destination/);
  assert.throws(() => validateB2bPayout({ ...baseInput, amountKes: "250.50" }), /whole-KES/);
  assert.throws(() => validateB2bPayout({ ...baseInput, resultUrl: "http://staff.test.invalid/result" }), /HTTPS/);
  const callback = buildB2bCallbackUrl(
    "https://staff.test.invalid",
    "result",
    "00000000-0000-4000-8000-000000000001",
    "opaque-test-callback-token",
  );
  assert.equal(new URL(callback).protocol, "https:");
  assert.equal(new URL(callback).searchParams.get("token"), "opaque-test-callback-token");
  assert.equal(callback.includes("b2b/result"), true);
});

test("B2B timeout stays uncertain and provider result parsing is sanitized", async () => {
  const uncertain = await initiateDarajaB2bPayout(baseInput, {
    getToken: async () => "b2b-test-access-token",
    fetchImpl: async () => { throw new Error("sensitive provider response"); },
  });
  assert.deepEqual(uncertain, { outcome: "uncertain", category: "transport_or_invalid_response" });
  assert.equal(JSON.stringify(uncertain).includes("sensitive provider response"), false);

  const result = parseDarajaB2bResult({
    Result: {
      ResultCode: 0,
      OriginatorConversationID: baseInput.originatorConversationId,
      ConversationID: "AG_B2B_20261123_1",
      ResultParameters: { ResultParameter: [
        { Key: "Amount", Value: "250.00" },
        { Key: "TransactionReceipt", Value: "B2B1234567" },
      ] },
    },
  });
  assert.deepEqual(result, {
    resultCode: 0,
    originatorConversationId: baseInput.originatorConversationId,
    conversationId: "AG_B2B_20261123_1",
    receipt: "B2B1234567",
    amount: "250.00",
  });
});
