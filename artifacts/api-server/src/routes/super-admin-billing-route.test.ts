import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("platform income summary is super-admin protected and returns separate totals", async () => {
  process.env.SUPERADMIN_USERNAME = "platform-income-test";
  process.env.SUPERADMIN_API_KEY = "platform-income-api-test";
  process.env.SUPERADMIN_PASSWORD = "platform-income-password-test";
  process.env.VITE_SUPABASE_URL = "https://platform-income-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "platform-income-service-test";
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
  let transactionReads = 0;
  let accountReads = 0;
  let platformConfig = {
    id: 1,
    cutoff_day: 24,
    due_day: 6,
    sales_threshold: 9500,
    low_sales_fee: 650,
    high_sales_fee: 1750,
  };
  const supabaseRequests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    supabaseRequests.push(url.toString());
    assert.equal(url.hostname, "platform-income-test.supabase.co");
    assert.equal(new Headers(init?.headers).get("apikey"), "platform-income-service-test");
    if (url.pathname.endsWith("/rpc/get_platform_income_summary")) {
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
    }
    if (url.pathname.endsWith("/rest/v1/platform_billing_config")) {
      if (init?.method === "POST") {
        const update = JSON.parse(String(init.body)) as Partial<typeof platformConfig>;
        platformConfig = { ...platformConfig, ...update };
      }
      return new Response(JSON.stringify([platformConfig]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/isp_transactions")) {
      transactionReads += 1;
      assert.equal(url.searchParams.get("payment_method"), "in.(mpesa_registration,manual_registration,mpesa_platform_billing)");
      assert.equal(url.searchParams.get("order"), "created_at.desc");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.ok(!url.searchParams.get("select")?.includes("reference"));
      return new Response(JSON.stringify([
        { id: 314, admin_id: 17, amount: 8500, payment_method: "mpesa_registration", status: "completed", created_at: "2026-10-01T08:00:00.000Z" },
        { id: 271, admin_id: 19, amount: 500, payment_method: "mpesa_platform_billing", status: "pending", created_at: "2026-10-01T07:00:00.000Z" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/isp_admins")) {
      accountReads += 1;
      assert.equal(url.searchParams.get("id"), "in.(17,19)");
      return new Response(JSON.stringify([
        { id: 17, name: "Cedar ISP", company_name: null, role: "isp_admin" },
        { id: 19, name: "North Reseller", company_name: "North Networks", role: "reseller" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  };

  const endpoint = `http://127.0.0.1:${address.port}/api/super-admin/billing`;
  try {
    const unauthorized = await originalFetch(`${endpoint}/income-summary`);
    assert.equal(unauthorized.status, 401);
    assert.equal(rpcCalls, 0);
    const unauthorizedTransactions = await originalFetch(`${endpoint}/platform-transactions`);
    assert.equal(unauthorizedTransactions.status, 401);
    assert.equal(transactionReads, 0);
    assert.equal(accountReads, 0);

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
    const renewalFeeResponse = await originalFetch(`${endpoint}/platform-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-sa-token": login.token },
      body: JSON.stringify({ sales_threshold: 11000, low_sales_fee: 800, high_sales_fee: 2100 }),
    });
    assert.equal(renewalFeeResponse.status, 200);
    assert.deepEqual({
      cutoff_day: platformConfig.cutoff_day,
      due_day: platformConfig.due_day,
      sales_threshold: platformConfig.sales_threshold,
      low_sales_fee: platformConfig.low_sales_fee,
      high_sales_fee: platformConfig.high_sales_fee,
    }, {
      cutoff_day: 24,
      due_day: 6,
      sales_threshold: 11000,
      low_sales_fee: 800,
      high_sales_fee: 2100,
    });

    const timingResponse = await originalFetch(`${endpoint}/platform-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-sa-token": login.token },
      body: JSON.stringify({ cutoff_day: 26, due_day: 7 }),
    });
    assert.equal(timingResponse.status, 200);
    assert.deepEqual({
      cutoff_day: platformConfig.cutoff_day,
      due_day: platformConfig.due_day,
      sales_threshold: platformConfig.sales_threshold,
      low_sales_fee: platformConfig.low_sales_fee,
      high_sales_fee: platformConfig.high_sales_fee,
    }, {
      cutoff_day: 26,
      due_day: 7,
      sales_threshold: 11000,
      low_sales_fee: 800,
      high_sales_fee: 2100,
    });

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

    const transactionsResponse = await originalFetch(`${endpoint}/platform-transactions`, {
      headers: { "x-sa-token": login.token },
    });
    assert.equal(transactionsResponse.status, 200, `Unexpected platform transaction response: ${supabaseRequests.join(" | ")}`);
    assert.deepEqual(await transactionsResponse.json(), {
      ok: true,
      transactions: [
        {
          transactionId: 314,
          accountId: 17,
          accountName: "Cedar ISP",
          accountRole: "isp_admin",
          category: "registration",
          amount: 8500,
          paymentMethod: "mpesa_registration",
          status: "completed",
          createdAt: "2026-10-01T08:00:00.000Z",
        },
        {
          transactionId: 271,
          accountId: 19,
          accountName: "North Networks",
          accountRole: "reseller",
          category: "renewal",
          amount: 500,
          paymentMethod: "mpesa_platform_billing",
          status: "pending",
          createdAt: "2026-10-01T07:00:00.000Z",
        },
      ],
    });
    assert.equal(transactionReads, 1);
    assert.equal(accountReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});