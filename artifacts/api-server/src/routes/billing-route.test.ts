import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { Pool } from "pg";

test("billing-only access reads safely but cannot start an unsettled payment", async () => {
  process.env.SESSION_SECRET = "billing-test-session-secret";
  process.env.VITE_SUPABASE_URL = "https://billing-test.supabase.co";
  process.env.VITE_SUPABASE_KEY = "billing-test-anon";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "billing-test-service";
  const originalDatabaseUrl = process.env.SUPABASE_DB_URL;
  process.env.SUPABASE_DB_URL = "postgres://billing-test:billing-test@127.0.0.1:5432/billing_test";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;

  const [{ default: billingRouter }, { default: mpesaRouter }, { generateAdminSessionToken }] = await Promise.all([
    import("./billing-route.js"),
    import("./mpesa-route.js"),
    import("../lib/api-auth.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", billingRouter);
  app.use("/api", mpesaRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  const poolPrototype = Pool.prototype as unknown as {
    query: (...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  const originalPoolQuery = poolPrototype.query;
  poolPrototype.query = async sql => {
    assert.match(String(sql), /platform_auth_security_policy/);
    return {
      rows: [{
        otp_all_enabled: false,
        otp_whatsapp_enabled: false,
        otp_sms_enabled: false,
        otp_email_enabled: false,
        password_reauth: {},
      }],
      rowCount: 1,
    };
  };
  const requests: { path: string; method: string; key: string | null; prefer: string | null; body?: Record<string, unknown> }[] = [];
  const now = new Date();
  const currentBillingPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // 21:00 UTC on the 24th is midnight at the start of the 25th in Nairobi.
  const cutoffDate = new Date(Date.UTC(
    currentBillingPeriod.getUTCFullYear(),
    currentBillingPeriod.getUTCMonth() - 1,
    24,
    21,
  ));
  const beforeCutoffDate = new Date(Date.UTC(
    currentBillingPeriod.getUTCFullYear(),
    currentBillingPeriod.getUTCMonth() - 1,
    24,
    12,
  ));
  const afterCutoffDate = new Date(Date.UTC(
    currentBillingPeriod.getUTCFullYear(),
    currentBillingPeriod.getUTCMonth() - 1,
    26,
    12,
  ));
  let accountCreatedAt = beforeCutoffDate.toISOString();
  let invoice: Record<string, unknown> | null = null;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "billing-test.supabase.co", "no external payment request should occur");
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    requests.push({
      path: url.pathname,
      method,
      key: headers.get("apikey"),
      prefer: headers.get("Prefer"),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    let rows: Record<string, unknown>[] = [];
    if (url.pathname.endsWith("/isp_admins")) {
      if (url.searchParams.get("id") === "eq.42") {
        rows = [{ id: 42, parent_id: null, role: "isp_admin", account_tier: "isp_admin", is_active: true, auth_version: 1,
          created_at: accountCreatedAt, name: "Test account", phone: null, payment_phone: null }];
      }
    } else if (url.pathname.endsWith("/platform_billing_config")) {
      rows = [{ cutoff_day: 25, due_day: 5, sales_threshold: 8000, low_sales_fee: 500, high_sales_fee: 1400 }];
    } else if (url.pathname.endsWith("/revenue_ledger")) {
      rows = [
        { amount: 100, payment_method: "mpesa_hotspot" },
        { amount: 2500, payment_method: "mpesa_registration" },
        { amount: 800, payment_method: "manual_registration" },
      ];
    } else if (url.pathname.endsWith("/platform_billing_invoices")) {
      if (method === "POST") {
        const created = invoice ?? { ...JSON.parse(String(init?.body)) as Record<string, unknown>, id: 91 };
        invoice = created;
        rows = [created];
      } else if (method === "PATCH") {
        assert.equal(url.searchParams.get("account_id"), "eq.42");
        assert.equal(url.searchParams.get("status"), "neq.paid");
        rows = invoice ? [{ ...invoice, status: "pending" }] : [];
      } else {
        rows = invoice ? [invoice] : [];
      }
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const endpoint = `http://127.0.0.1:${address.port}/api/billing`;
  const token = generateAdminSessionToken("42", 1);
  try {
    const unauthorized = await originalFetch(`${endpoint}/current`);
    assert.equal(unauthorized.status, 401);
    assert.equal(requests.length, 0);
    const wrongAccount = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${generateAdminSessionToken("43", 1)}` },
    });
    assert.equal(wrongAccount.status, 401);
    assert.ok(requests.every(row => row.path.endsWith("/isp_admins")));
    requests.length = 0;

    const preview = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(preview.status, 200);
     const previewBody = await preview.json() as { invoice: { id?: number; status: string; sales_total: number }; eligible: boolean; paymentsAvailable: boolean };
    assert.equal(previewBody.eligible, true);
    assert.equal(previewBody.paymentsAvailable, false);
    assert.ok(["due", "expired"].includes(previewBody.invoice.status));
     assert.equal(previewBody.invoice.sales_total, 100, "registration receipts must not increase tenant renewal assessments");
    assert.equal(previewBody.invoice.id, undefined);
    assert.ok(requests.length > 0);
    assert.ok(requests.every(row => row.method === "GET"));
    assert.ok(requests.filter(row => row.path.endsWith("/isp_admins")).every(row => row.key === "billing-test-anon"));
    assert.ok(requests.filter(row => !row.path.endsWith("/isp_admins")).every(row => row.key === "billing-test-service"));

    accountCreatedAt = cutoffDate.toISOString();
    const newlyCreatedAccountPreview = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(newlyCreatedAccountPreview.status, 200);
    assert.equal(
      (await newlyCreatedAccountPreview.json() as { eligible: boolean }).eligible,
      false,
      "accounts created on the 25th of the previous month should not see the current renewal banner",
    );

    accountCreatedAt = afterCutoffDate.toISOString();
    const afterCutoffAccountPreview = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(afterCutoffAccountPreview.status, 200);
    assert.equal((await afterCutoffAccountPreview.json() as { eligible: boolean }).eligible, false);

    accountCreatedAt = new Date(Date.UTC(
      currentBillingPeriod.getUTCFullYear(),
      currentBillingPeriod.getUTCMonth(),
      1,
      12,
    )).toISOString();
    const currentMonthAccountPreview = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(currentMonthAccountPreview.status, 200);
    assert.equal((await currentMonthAccountPreview.json() as { eligible: boolean }).eligible, false);

    const prepared = await originalFetch(`${endpoint}/renew`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "0700000000" }),
    });
    assert.equal(prepared.status, 503);
    assert.match((await prepared.json() as { error: string }).error, /unavailable/);
    assert.ok(requests.every(row => row.method === "GET"), "no invoice must be created without settlement");

    invoice = { id: 91, account_id: 42, status: "pending", amount_due: 500, due_date: "2026-09-05" };
    const stk = await originalFetch(`http://127.0.0.1:${address.port}/api/mpesa/stk`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "0700000000", amount: 500, adminId: 42, billing_invoice_id: 91 }),
    });
    assert.equal(stk.status, 503);
    assert.match((await stk.json() as { error: string }).error, /unavailable/);
    assert.ok(requests.filter(row => row.path.endsWith("/platform_billing_invoices")).every(row => row.key === "billing-test-service"));
    assert.ok(requests.every(row => row.method === "GET"), "no transaction or payment prompt may be created");

    invoice = { id: 91, account_id: 42, status: "paid", amount_due: 500, due_date: "2026-09-05" };
    const paidCurrent = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(paidCurrent.status, 200);
    assert.equal((await paidCurrent.json() as { invoice: { status: string } }).invoice.status, "paid");
  } finally {
    globalThis.fetch = originalFetch;
    poolPrototype.query = originalPoolQuery;
    if (originalDatabaseUrl === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = originalDatabaseUrl;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});