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

test("session pairing returns a no-store-ready QR image only while scan is required", async () => {
  const requests: { url: string; headers: Headers }[] = [];
  const png = Buffer.from([137, 80, 78, 71]);
  const service = new WAHAGatewayService(
    async () => config(),
    async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      if (String(input).endsWith("/api/sessions/default")) {
        return new Response(JSON.stringify({ name: "default", status: "SCAN_QR_CODE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  );

  const result = await service.getSessionPairingState();

  assert.equal(result.status, "SCAN_QR_CODE");
  assert.equal(result.qrDataUrl, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(requests[0]?.url, "https://waha.example.test/api/sessions/default");
  assert.equal(requests[1]?.url, "https://waha.example.test/api/default/auth/qr");
  assert.equal(requests[1]?.headers.get("X-Api-Key"), "server-only-secret");
  assert.equal(requests[1]?.headers.get("Accept"), "image/png");
});

test("session pairing creates a missing session without exposing the WAHA key", async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  let statusReads = 0;
  const service = new WAHAGatewayService(
    async () => config(),
    async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
      requests.push({ url, method, body });
      if (method === "GET") {
        statusReads += 1;
        if (statusReads === 1) return new Response(null, { status: 404 });
        return new Response(JSON.stringify({ name: "default", status: "STARTING" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ name: "default", status: "STARTING" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await service.startSessionPairing();

  assert.equal(result.status, "STARTING");
  assert.deepEqual(requests.map(request => [request.method, request.url]), [
    ["GET", "https://waha.example.test/api/sessions/default"],
    ["POST", "https://waha.example.test/api/sessions"],
    ["GET", "https://waha.example.test/api/sessions/default"],
  ]);
  assert.deepEqual(requests[1]?.body, { name: "default" });
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

test("accepts only loopback, private IP, or private service-name WAHA endpoints", () => {
  for (const url of [
    "http://127.0.0.1:3000",
    "http://10.2.3.4:3000",
    "http://172.31.255.1:3000",
    "http://192.168.1.20:3000",
    "http://[fd00::1]:3000",
    "http://waha:3000",
    "http://waha.internal:3000",
  ]) {
    assert.equal(validateWahaBaseUrl(url), url);
  }

  for (const url of [
    "http://isplatty.org:3000",
    "https://example.com",
    "http://8.8.8.8:3000",
    "http://0.0.0.0:3000",
    "http://169.254.1.2:3000",
  ]) {
    assert.throws(() => validateWahaBaseUrl(url), /private host/);
  }
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
