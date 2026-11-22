import assert from "node:assert/strict";
import test from "node:test";
import { verifyTurnstile } from "./turnstile.js";

type MockRequest = Parameters<typeof verifyTurnstile>[0];

function request(body: Record<string, unknown>, origin = "https://staff.isplatty.com"): MockRequest {
  return {
    body,
    get(name: string) {
      if (name.toLowerCase() === "origin") return origin;
      if (name.toLowerCase() === "cf-connecting-ip") return "203.0.113.1";
      return undefined;
    },
  } as unknown as MockRequest;
}

test("Staff Turnstile accepts only a verified exact hostname and action", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.TURNSTILE_SECRET;
  process.env.TURNSTILE_SECRET = "test-turnstile-secret-do-not-print";
  let submittedBody = "";
  globalThis.fetch = async (_input, init) => {
    submittedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      success: true,
      hostname: "staff.isplatty.com",
      action: "staff_login",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await verifyTurnstile(
      request({ turnstileToken: "one-time-widget-token" }),
      "staff_login",
    );
    assert.deepEqual(result, { ok: true });
    assert.match(submittedBody, /response=one-time-widget-token/);
    assert.doesNotMatch(JSON.stringify(result), /test-turnstile-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = originalSecret;
  }
});

test("Turnstile rejects mismatched action, hostname, and missing secrets without exposing values", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.TURNSTILE_SECRET;
  process.env.TURNSTILE_SECRET = "test-turnstile-secret-do-not-print";
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    hostname: "staff.isplatty.com",
    action: "staff_signup_request",
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const wrongAction = await verifyTurnstile(
      request({ turnstileToken: "test-widget-token" }),
      "staff_login",
    );
    assert.deepEqual(wrongAction, {
      ok: false,
      status: 403,
      error: "Cloudflare verification failed. Complete it again and retry.",
    });
    assert.doesNotMatch(JSON.stringify(wrongAction), /secret|token/i);

    globalThis.fetch = async () => new Response(JSON.stringify({
      success: true,
      hostname: "other.isplatty.com",
      action: "staff_login",
    }), { status: 200, headers: { "content-type": "application/json" } });
    const wrongHost = await verifyTurnstile(
      request({ turnstileToken: "test-widget-token" }),
      "staff_login",
    );
    assert.equal(wrongHost.ok, false);
    assert.doesNotMatch(JSON.stringify(wrongHost), /test-turnstile-secret|test-widget-token/);

    delete process.env.TURNSTILE_SECRET;
    const missingSecret = await verifyTurnstile(
      request({ turnstileToken: "test-widget-token" }),
      "staff_login",
    );
    assert.equal(missingSecret.ok, false);
    assert.equal(missingSecret.status, 503);
    assert.doesNotMatch(JSON.stringify(missingSecret), /test-turnstile-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = originalSecret;
  }
});
