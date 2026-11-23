import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import test from "node:test";
import { hashEmployeeSecret } from "../lib/employee-portal-security.js";

process.env.EMPLOYEE_PORTAL_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://employee-daraja-b2b-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-secret";

const { default: employeePortalRouter } = await import("./employee-portal-route.js");

function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  return { server, ready: once(server, "listening") };
}

function post(port: number, path: string, body: unknown) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { host: "isplatty.com", "content-type": "application/json" },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(text) as Record<string, unknown>,
      }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

test("B2B result callback verifies its token and submits sanitized result metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const { server, ready } = listen(app);
  await ready;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const token = "opaque-b2b-callback-token-that-is-long-enough-123456";
  const response = await post(address.port,
    `/api/employee/payouts/daraja/b2b/result?withdrawal=00000000-0000-4000-8000-000000000001&token=${token}`,
    { Result: {
      ResultCode: 0,
      OriginatorConversationID: "STAFFB2B0123456789abcdef",
      ConversationID: "AG_B2B_20261123_1",
      ResultParameters: { ResultParameter: [
        { Key: "Amount", Value: "250.00" },
        { Key: "TransactionReceipt", Value: "B2B1234567" },
      ] },
    } });
  assert.equal(response.status, 200);
  assert.equal(response.body.ResultCode, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/employee_process_daraja_b2b_result$/);
  assert.equal(calls[0].body.p_callback_token_hash, hashEmployeeSecret(token));
  assert.equal(calls[0].body.p_amount, "250.00");
  assert.equal(calls[0].body.p_receipt, "B2B1234567");
  assert.equal(JSON.stringify(response.body).includes(token), false);
});

test("unauthenticated callers cannot record Pochi as paid", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("[]", { status: 200 }); };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const { server, ready } = listen(app);
  await ready;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await post(address.port,
    "/api/employee/admin/withdrawals/00000000-0000-4000-8000-000000000001/record-pochi-payment",
    { reference: "ABC1234567", confirmedPaid: true, confirmPassword: "not-a-password" });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("unauthenticated callers cannot reconcile a Daraja payout", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("[]", { status: 200 }); };
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const { server, ready } = listen(app);
  await ready;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await post(address.port,
    "/api/employee/admin/withdrawals/00000000-0000-4000-8000-000000000001/reconcile-daraja",
    {
      outcome: "success",
      providerReference: "B2B1234567",
      amount: "250.00",
      note: "Checked official Safaricom status",
      verifiedSafaricomResult: true,
      confirmPassword: "not-a-password",
    });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
