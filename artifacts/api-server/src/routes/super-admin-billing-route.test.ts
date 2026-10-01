import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("platform income summary is super-admin protected and returns separate totals", async () => {
  process.env.SUPERADMIN_USERNAME = "platform-income-test";
  process.env.SUPERADMIN_API_KEY = "platform-income-api-test";
  process.env.SUPERADMIN_PASSWORD = "platform-income-password-test";
  process.env.VITE_SUPABASE_URL = "https://platform-income-test.supabase.co";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "platform-income-service-test";

  const [{ default: authRouter }, { default: billingRouter }] = await Promise.all([
    import("./super-admin-auth-route.js"),
    import("./super-admin-billing-route.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", billingRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "platform-income-test.supabase.co");
    assert.ok(url.pathname.endsWith("/rpc/get_platform_income_summary"));
    assert.equal(new Headers(init?.headers).get("apikey"), "platform-income-service-test");
    rpcCalls += 1;
    return new Response(JSON.stringify([{
      registration_today: "200",
      registration_month: "1200",
      registration_total: "4500",
      registration_transactions: "9",
      renewal_today: "500",
      renewal_month: "2500",
      renewal_total: "12500",
      renewal_transactions: "6",
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const endpoint = `http://127.0.0.1:${address.port}/api/super-admin/billing`;
  try {
    const unauthorized = await originalFetch(`${endpoint}/income-summary`);
    assert.equal(unauthorized.status, 401);
    assert.equal(rpcCalls, 0);

    const loginResponse = await originalFetch(`http://127.0.0.1:${address.port}/api/super-admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "platform-income-test",
        api_key: "platform-income-api-test",
        password: "platform-income-password-test",
      }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { token: string };
    const response = await originalFetch(`${endpoint}/income-summary`, {
      headers: { "x-sa-token": login.token },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      summary: {
        registrationToday: 200,
        registrationMonth: 1200,
        registrationTotal: 4500,
        registrationTransactions: 9,
        renewalToday: 500,
        renewalMonth: 2500,
        renewalTotal: 12500,
        renewalTransactions: 6,
      },
    });
    assert.equal(rpcCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});