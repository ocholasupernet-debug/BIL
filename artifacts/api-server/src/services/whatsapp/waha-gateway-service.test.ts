import assert from "node:assert/strict";
import test from "node:test";
import {
  WAHAGatewayService,
  WahaGatewayError,
  normalizeWahaPhone,
  validateWahaBaseUrl,
  type WahaGatewayRuntimeConfig,
} from "./waha-gateway-service.js";
import { decryptWahaSecret, encryptWahaSecret } from "./waha-crypto.js";

function config(overrides: Partial<WahaGatewayRuntimeConfig> = {}): WahaGatewayRuntimeConfig {
  return {
    enabled: true,
    baseUrl: "https://waha.example.test",
    sessionId: "default",
    otpProvider: "waha",
    features: {
      login: true,
      registrationVerification: true,
      pageVerification: true,
      gatewaySettings: true,
    },
    apiKey: "server-only-secret",
    ...overrides,
  };
}

test("sendOTP uses the WAHA sendText API with the five-minute OTP message", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const service = new WAHAGatewayService(
    async () => config({ baseUrl: "https://waha.example.test/" }),
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ id: "message-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await service.sendOTP("0712345678", "583104");

  assert.equal(requestUrl, "https://waha.example.test/api/sendText");
  assert.equal(result.messageId, "message-123");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(new Headers(requestInit?.headers).get("X-Api-Key"), "server-only-secret");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    session: "default",
    chatId: "254712345678@c.us",
    text: "Your OcholaSuperNet verification code is: 583104. Valid for 5 minutes.",
  });
});

test("normalizes Kenyan local and international WhatsApp phone formats", () => {
  assert.equal(normalizeWahaPhone("0712 345 678"), "254712345678");
  assert.equal(normalizeWahaPhone("+254 712-345-678"), "254712345678");
  assert.equal(normalizeWahaPhone("00254712345678"), "254712345678");
  assert.equal(normalizeWahaPhone("712345678"), "254712345678");
  assert.equal(normalizeWahaPhone("not-a-phone"), null);
});

test("refuses non-six-digit OTP codes before making an HTTP request", async () => {
  let requests = 0;
  const service = new WAHAGatewayService(
    async () => config(),
    async () => {
      requests += 1;
      return new Response(null, { status: 200 });
    },
  );

  await assert.rejects(service.sendOTP("0712345678", "12345"), /six-digit numeric code/);
  assert.equal(requests, 0);
});

test("refuses WAHA OTP delivery unless WAHA is selected and enabled", async () => {
  const service = new WAHAGatewayService(
    async () => config({ otpProvider: "whatsapp_cloud" }),
    async () => new Response(null, { status: 200 }),
  );

  await assert.rejects(service.sendOTP("0712345678", "123456"), /not enabled as the OTP provider/);
});

test("does not expose the upstream response body when WAHA rejects a message", async () => {
  const service = new WAHAGatewayService(
    async () => config(),
    async () => new Response("private upstream details", { status: 401 }),
  );

  await assert.rejects(
    service.sendOTP("0712345678", "123456"),
    (error: unknown) => {
      assert.ok(error instanceof WahaGatewayError);
      assert.equal(error.status, 401);
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /private upstream details|server-only-secret/);
      return true;
    },
  );
});

test("allows an explicitly requested Super Admin test message while OTP use is disabled", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const service = new WAHAGatewayService(
    async () => config({ enabled: false }),
    async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 200 });
    },
  );

  await service.sendText("+254712345678", "Super Admin test", { allowWhenDisabled: true });
  assert.equal(requestBodies[0]?.chatId, "254712345678@c.us");
  assert.equal(requestBodies[0]?.text, "Super Admin test");
});

test("rejects WAHA base URLs containing credentials or metadata-service targets", () => {
  assert.throws(() => validateWahaBaseUrl("https://user:pass@waha.example.test"), /without credentials/);
  assert.throws(() => validateWahaBaseUrl("http://169.254.169.254"), /reserved/);
  assert.equal(validateWahaBaseUrl("http://localhost:3000/"), "http://localhost:3000");
});

test("encrypts the WAHA API key and rejects decryption with a different session secret", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "waha-test-session-secret";
  try {
    const encrypted = encryptWahaSecret("private-waha-api-key");
    assert.doesNotMatch(JSON.stringify(encrypted), /private-waha-api-key/);
    assert.equal(decryptWahaSecret(encrypted), "private-waha-api-key");

    process.env.SESSION_SECRET = "a-different-session-secret";
    assert.throws(() => decryptWahaSecret(encrypted));
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
