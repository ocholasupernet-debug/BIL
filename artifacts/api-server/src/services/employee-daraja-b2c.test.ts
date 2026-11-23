import assert from "node:assert/strict";
import test from "node:test";
import {
  buildB2cCallbackUrl,
  initiateDarajaB2cPayout,
  isWholeKesAmount,
  parseDarajaB2cResult,
} from "./employee-daraja-b2c.js";

const credentials = {
  consumerKey: "private-test-key",
  consumerSecret: "private-test-secret",
  initiatorName: "staff-test",
  securityCredential: "encrypted-test-credential",
  shortcode: "600001",
};

const baseInput = {
  credentials,
  environment: "sandbox" as const,
  amountKes: "50",
  phone: "254712345678",
  originatorConversationId: "STAFF0123456789abcdef0123456789",
  resultUrl: "https://staff.test.invalid/api/result?token=test-only",
  queueTimeoutUrl: "https://staff.test.invalid/api/timeout?token=test-only",
};

test("B2C initiation uses the separate app credentials and never logs them", async () => {
  let requestUrl = "";
  let requestPayload: Record<string, unknown> = {};
  const result = await initiateDarajaB2cPayout(baseInput, {
    getToken: async () => "private-test-access-token",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ResponseCode: "0",
        OriginatorConversationID: baseInput.originatorConversationId,
        ConversationID: "AG_20261123_000001",
      }), { status: 200 });
    },
  });

  assert.equal(result.outcome, "submitted");
  assert.equal(requestUrl, "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest");
  assert.equal(requestPayload.PartyB, "254712345678");
  assert.equal(requestPayload.CommandID, "BusinessPayment");
  assert.equal(requestPayload.SecurityCredential, credentials.securityCredential);
  assert.equal(JSON.stringify(result).includes(credentials.consumerSecret), false);
});

test("B2C transport uncertainty is not converted into a retry or payment success", async () => {
  const result = await initiateDarajaB2cPayout(baseInput, {
    getToken: async () => "test-token",
    fetchImpl: async () => { throw new Error("private provider detail"); },
  });
  assert.deepEqual(result, { outcome: "uncertain", category: "transport_or_invalid_response" });
});

test("B2C rejects incomplete credentials and fractional KES before contacting Safaricom", async () => {
  assert.equal(isWholeKesAmount("50"), true);
  assert.equal(isWholeKesAmount("50.25"), false);
  assert.equal(isWholeKesAmount("0"), false);
  let calls = 0;
  await assert.rejects(
    initiateDarajaB2cPayout({ ...baseInput, amountKes: "50.25" }, {
      getToken: async () => { calls += 1; return "token"; },
      fetchImpl: async () => { calls += 1; return new Response("{}"); },
    }),
    /amount or registered M-Pesa number is invalid/,
  );
  await assert.rejects(
    initiateDarajaB2cPayout({
      ...baseInput,
      credentials: { ...credentials, consumerSecret: "" },
    }, { getToken: async () => "token" }),
    /credentials are incomplete/,
  );
  assert.equal(calls, 0);
});

test("explicit Safaricom rejection is distinct from an uncertain network result", async () => {
  const result = await initiateDarajaB2cPayout(baseInput, {
    getToken: async () => "token",
    fetchImpl: async () => new Response(JSON.stringify({
      ResponseCode: "1",
      OriginatorConversationID: baseInput.originatorConversationId,
      ResponseDescription: "do not persist or return this provider text",
    }), { status: 200 }),
  });
  assert.deepEqual(result, {
    outcome: "rejected",
    category: "provider_rejected",
    responseCode: "1",
  });
  assert.equal(JSON.stringify(result).includes("do not persist"), false);
});

test("callback URLs require HTTPS and use query tokens that request logs redact", () => {
  const result = buildB2cCallbackUrl(
    "https://staff.isplatty.com",
    "result",
    "00000000-0000-4000-8000-000000000001",
    "opaque-test-token",
  );
  assert.equal(result, "https://staff.isplatty.com/api/employee/payouts/daraja/b2c/result?withdrawal=00000000-0000-4000-8000-000000000001&token=opaque-test-token");
  assert.throws(() => buildB2cCallbackUrl("http://staff.isplatty.com", "result", "id", "token"));
});

test("B2C result parser requires a result code and keeps sanitized failure categories", () => {
  const parsed = parseDarajaB2cResult({
    Result: {
      ResultCode: 0,
      OriginatorConversationID: baseInput.originatorConversationId,
      ConversationID: "AG_20261123_000001",
      ResultParameters: { ResultParameter: [
        { Key: "TransactionAmount", Value: 50 },
        { Key: "TransactionReceipt", Value: "QWE1234567" },
        { Key: "ReceiverPartyPublicName", Value: "254712345678 - STAFF" },
      ] },
    },
  });
  assert.equal(parsed?.failureCategory, null);
  assert.equal(parsed?.amount, "50");
  assert.equal(parsed?.receipt, "QWE1234567");
  assert.equal(parsed?.receiverPhone, "254712345678");
  assert.equal(parseDarajaB2cResult({ Result: { ResultCode: 0 } }), null);
});
