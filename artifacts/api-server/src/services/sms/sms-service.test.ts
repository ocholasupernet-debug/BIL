import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "sms-service-test-secret";
process.env.SMS_ENABLED = "true";
process.env.AT_API_KEY = "test-api-key";
process.env.AT_USERNAME = "sandbox-user";
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_KEY = "test-key";

const { hashSmsOtp, normalizeSmsPhone, sendSms } =
  await import("./sms-service.js");

test("normalizes local, international, and invalid SMS numbers", () => {
  assert.equal(normalizeSmsPhone("0712 345 678"), "+254712345678");
  assert.equal(normalizeSmsPhone("00442071838750"), "+442071838750");
  assert.equal(normalizeSmsPhone("+442071838750"), "+442071838750");
  assert.equal(normalizeSmsPhone("1234"), null);
});

test("SMS OTP HMAC is challenge-bound", () => {
  const hash = hashSmsOtp("challenge-a", "123456");
  assert.equal(hashSmsOtp("challenge-a", "123456"), hash);
  assert.notEqual(hashSmsOtp("challenge-b", "123456"), hash);
});

test("SMS provider accepts documented recipient status codes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const statusCode of [100, 101, 102]) {
      let requestBody = "";
      globalThis.fetch = async (url, init) => {
        if (String(url).includes("rest/v1"))
          return new Response("[]", { status: 200 });
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            SMSMessageData: {
              Recipients: [{ statusCode, messageId: `AT-${statusCode}` }],
            },
          }),
          { status: 200 },
        );
      };
      const result = await sendSms("+254712345678", "test");
      assert.equal(result.messageId, `AT-${statusCode}`);
      assert.match(requestBody, /to=%2B254712345678/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SMS provider rejects recipient errors and never exposes the API key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("rest/v1")
      ? new Response("[]", { status: 200 })
      : new Response(
          JSON.stringify({
            SMSMessageData: {
              Recipients: [{ statusCode: 406, messageId: "" }],
            },
          }),
          { status: 200 },
        );
  try {
    await assert.rejects(
      () => sendSms("+254712345678", "test"),
      (error) => {
        assert.equal(
          String(error),
          "Error: Africa's Talking rejected the SMS recipient.",
        );
        assert.equal(String(error).includes("test-api-key"), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SMS connection check validates the non-billable account response", async () => {
  const originalFetch = globalThis.fetch;
  let accountBody: Record<string, unknown> = {
    userData: { balance: "KES 0.00" },
  };
  globalThis.fetch = async (url) =>
    String(url).includes("rest/v1")
      ? new Response("[]", { status: 200 })
      : new Response(JSON.stringify(accountBody), { status: 200 });
  try {
    const { checkSmsConnection } = await import("./sms-service.js");
    assert.deepEqual(await checkSmsConnection(), { status: "CONNECTED" });
    accountBody = {};
    assert.deepEqual(await checkSmsConnection(), {
      status: "ERROR",
      error: "Africa's Talking credentials were rejected.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
