import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import test from "node:test";
import { hashEmployeeSecret } from "../lib/employee-portal-security.js";

process.env.EMPLOYEE_PORTAL_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://employee-daraja-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-secret";

const { default: employeePortalRouter } = await import("./employee-portal-route.js");

test("B2C result callback verifies the opaque token through the settlement RPC", async (t) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const token = "opaque-callback-token-that-is-long-enough-123456";
  const response = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: `/api/employee/payouts/daraja/b2c/result?withdrawal=00000000-0000-4000-8000-000000000001&token=${token}`,
      method: "POST",
      headers: { host: "isplatty.com", "content-type": "application/json" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) as Record<string, unknown> }));
    });
    request.on("error", reject);
    request.end(JSON.stringify({ Result: {
      ResultCode: 0,
      OriginatorConversationID: "STAFF0123456789abcdef0123456789",
      ConversationID: "AG_20261123_000001",
      ResultParameters: { ResultParameter: [
        { Key: "TransactionAmount", Value: 50 },
        { Key: "TransactionReceipt", Value: "QWE1234567" },
        { Key: "ReceiverPartyPublicName", Value: "254712345678 - STAFF" },
      ] },
    } }));
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ResultCode, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/employee_process_daraja_b2c_result$/);
  assert.equal(calls[0].body.p_callback_token_hash, hashEmployeeSecret(token));
  assert.equal(calls[0].body.p_amount, "50");
  assert.equal(calls[0].body.p_phone_hash, hashEmployeeSecret("254712345678"));
  assert.equal(JSON.stringify(response.body).includes(token), false);
});

test("invalid result callbacks do not call Supabase", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("[]", { status: 200 });
  };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/employee/payouts/daraja/b2c/result?withdrawal=00000000-0000-4000-8000-000000000001&token=too-short",
      method: "POST",
      headers: { host: "isplatty.com", "content-type": "application/json" },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    request.on("error", reject);
    request.end(JSON.stringify({ Result: { ResultCode: 0 } }));
  });
  assert.equal(response, 401);
  assert.equal(calls, 0);
});

test("timeout callbacks require a matching hashed token and preserve the reservation", async (t) => {
  const originalFetch = globalThis.fetch;
  const token = "opaque-timeout-token-that-is-long-enough-123456";
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, body });
    if (url.includes("/employee_payout_transactions?")) {
      return new Response(JSON.stringify([{
        originator_reference: "STAFF0123456789abcdef0123456789",
        callback_token_hash: hashEmployeeSecret(token),
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const send = (candidate: string) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: `/api/employee/payouts/daraja/b2c/timeout?withdrawal=00000000-0000-4000-8000-000000000001&token=${candidate}`,
      method: "POST",
      headers: { host: "isplatty.com", "content-type": "application/json" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) as Record<string, unknown> }));
    });
    request.on("error", reject);
    request.end("{}");
  });
  const invalid = await send("different-valid-shaped-callback-token-123456");
  assert.equal(invalid.status, 401);
  assert.equal(calls.some((call) => call.url.includes("/rpc/employee_mark_daraja_b2c_uncertain")), false);
  const accepted = await send(token);
  assert.equal(accepted.status, 200);
  assert.equal(calls.at(-1)?.url.includes("/rpc/employee_mark_daraja_b2c_uncertain"), true);
  assert.equal(calls.at(-1)?.body.p_failure_category, "provider_timeout");
  assert.equal(calls.at(-1)?.body.p_callback_token_hash, hashEmployeeSecret(token));
});

test("a withdrawal approval route still requires Super Admin authentication", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("[]", { status: 200 }); };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/employee/admin/withdrawals/00000000-0000-4000-8000-000000000001/review",
      method: "POST",
      headers: { host: "employee1088.isplatty.com", "content-type": "application/json" },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    request.on("error", reject);
    request.end(JSON.stringify({ decision: "approve" }));
  });
  assert.equal(response, 401);
  assert.equal(calls, 0);
});
