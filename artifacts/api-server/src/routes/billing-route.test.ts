import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

test("billing-only access reads safely but cannot start an unsettled payment", async () => {
  process.env.SESSION_SECRET = "billing-test-session-secret";
  process.env.VITE_SUPABASE_URL = "https://billing-test.supabase.co";
  process.env.VITE_SUPABASE_KEY = "billing-test-anon";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "billing-test-service";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;

  const [{ default: billingRouter }, { default: mpesaRouter }, { generateToken }] = await Promise.all([
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
  const requests: { path: string; method: string; key: string | null; prefer: string | null; body?: Record<string, unknown> }[] = [];
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
        rows = [{ id: 42, parent_id: null, role: "isp_admin", account_tier: "isp_admin",
          created_at: "2025-01-01T00:00:00Z", name: "Test account", phone: null, payment_phone: null }];
      }
    } else if (url.pathname.endsWith("/platform_billing_config")) {
      rows = [{ cutoff_day: 25, due_day: 5, sales_threshold: 8000, low_sales_fee: 500, high_sales_fee: 1400 }];
    } else if (url.pathname.endsWith("/revenue_ledger")) {
      rows = [{ amount: 100 }];
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
  const token = generateToken("a", "42");
  try {
    const unauthorized = await originalFetch(`${endpoint}/current`);
    assert.equal(unauthorized.status, 401);
    assert.equal(requests.length, 0);
    const wrongAccount = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${generateToken("a", "43")}` },
    });
    assert.equal(wrongAccount.status, 403);
    assert.ok(requests.every(row => row.path.endsWith("/isp_admins")));
    requests.length = 0;

    const preview = await originalFetch(`${endpoint}/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { invoice: { id?: number; status: string }; eligible: boolean; paymentsAvailable: boolean };
    assert.equal(previewBody.eligible, true);
    assert.equal(previewBody.paymentsAvailable, false);
    assert.ok(["due", "expired"].includes(previewBody.invoice.status));
    assert.equal(previewBody.invoice.id, undefined);
    assert.ok(requests.length > 0);
    assert.ok(requests.every(row => row.method === "GET"));
    assert.ok(requests.filter(row => row.path.endsWith("/isp_admins")).every(row => row.key === "billing-test-anon"));
    assert.ok(requests.filter(row => !row.path.endsWith("/isp_admins")).every(row => row.key === "billing-test-service"));

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
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});