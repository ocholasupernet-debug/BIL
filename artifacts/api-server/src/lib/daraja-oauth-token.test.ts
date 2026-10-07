import assert from "node:assert/strict";
import test from "node:test";
import { createDarajaTokenProvider } from "./daraja-oauth-token.js";

const credentials = { consumerKey: "test-key", consumerSecret: "test-secret" };
const baseUrl = "https://sandbox.safaricom.co.ke";

function oauthResponse(token: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("reuses a Daraja token until it approaches expiry", async () => {
  let calls = 0;
  let now = 1_000;
  const getToken = createDarajaTokenProvider({
    now: () => now,
    safetyWindowMs: 10_000,
    fetchImpl: async () => {
      calls += 1;
      return oauthResponse(`token-${calls}`, 30);
    },
  });

  assert.equal(await getToken(credentials, baseUrl), "token-1");
  now += 15_000;
  assert.equal(await getToken(credentials, baseUrl), "token-1");
  now += 6_000;
  assert.equal(await getToken(credentials, baseUrl), "token-2");
  assert.equal(calls, 2);
});

test("coalesces simultaneous OAuth refreshes for the same credentials", async () => {
  let calls = 0;
  let finishRequest!: (response: Response) => void;
  const responsePromise = new Promise<Response>(resolve => {
    finishRequest = resolve;
  });
  const getToken = createDarajaTokenProvider({
    fetchImpl: async () => {
      calls += 1;
      return responsePromise;
    },
  });

  const first = getToken(credentials, baseUrl);
  const second = getToken(credentials, baseUrl);
  finishRequest(oauthResponse("shared-token"));

  assert.deepEqual(await Promise.all([first, second]), ["shared-token", "shared-token"]);
  assert.equal(calls, 1);
});

test("does not share tokens across environments or credential sets", async () => {
  let calls = 0;
  const getToken = createDarajaTokenProvider({
    fetchImpl: async () => oauthResponse(`token-${++calls}`),
  });

  assert.equal(await getToken(credentials, baseUrl), "token-1");
  assert.equal(await getToken(credentials, "https://api.safaricom.co.ke"), "token-2");
  assert.equal(await getToken({ ...credentials, consumerSecret: "rotated-secret" }, baseUrl), "token-3");
  assert.equal(calls, 3);
});
