import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

process.env.SESSION_SECRET = "customers-archive-test-session-secret";
process.env.VITE_SUPABASE_URL = "https://customers-archive-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "customers-archive-test-service-role";

type FixtureRow = Record<string, unknown>;

function matches(row: FixtureRow, query: URLSearchParams): boolean {
  for (const [key, filter] of query) {
    if (["select", "limit", "order"].includes(key)) continue;
    const value = row[key];
    if (filter.startsWith("eq.")) {
      if (String(value ?? "") !== filter.slice(3)) return false;
    } else if (filter === "is.null" && value != null) {
      return false;
    } else if (filter === "not.is.null" && value == null) {
      return false;
    } else if (filter.startsWith("in.(") && !filter.slice(4, -1).split(",").includes(String(value))) {
      return false;
    }
  }
  return true;
}

test("expired customer archive preserves every transaction field and can be restored", async t => {
  const [{ generateAdminSessionToken }, { default: customersRouter }] = await Promise.all([
    import("../lib/api-auth.js"),
    import("./customers.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", customersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  const customers: FixtureRow[] = [
    { id: 801, admin_id: 7, status: "expired", expires_at: "2020-01-01T00:00:00Z", depletion_reason: null, archived_at: null },
    { id: 802, admin_id: 7, status: "active", expires_at: "2099-01-01T00:00:00Z", depletion_reason: null, archived_at: null },
    { id: 803, admin_id: 7, status: "expired", expires_at: "2020-01-01T00:00:00Z", depletion_reason: null, archived_at: "2021-01-01T00:00:00Z" },
  ];
  const transactions: FixtureRow[] = [
    { id: 9001, admin_id: 7, customer_id: 801, amount: 100, status: "completed", notes: "paid receipt" },
    { id: 9002, admin_id: 7, customer_id: 801, amount: 50, status: "pending", notes: "pending payment" },
  ];
  const requests: Array<{ table: string; method: string; body?: FixtureRow }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "customers-archive-test.supabase.co");
    const table = url.pathname.split("/").at(-1) ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    const query = new URLSearchParams(url.search);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as FixtureRow : undefined;
    requests.push({ table, method, ...(body ? { body } : {}) });
    const source = table === "isp_customers"
      ? customers
      : table === "isp_transactions"
        ? transactions
        : table === "isp_expired_customer_history"
          ? [{ admin_id: 7, permanently_deleted_count: 4 }]
        : table === "isp_admins"
          ? [{ id: 7, is_active: true, role: "isp_admin", parent_id: null }]
          : [];
    const rows = source.filter(row => matches(row, query));
    if (method === "PATCH" && body) rows.forEach(row => Object.assign(row, body));
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const token = generateAdminSessionToken("7", 1);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const beforeTransactions = structuredClone(transactions);
  const preview = await originalFetch(`${origin}/api/customers/archive-preview?customerIds=801`, { headers });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal((await preview.json() as { transactionCount: number }).transactionCount, 2);
  assert.deepEqual(transactions, beforeTransactions);

  const archived = await originalFetch(`${origin}/api/customers/archive-expired`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customerIds: [801] }),
  });
  assert.equal(archived.status, 200, await archived.clone().text());
  assert.ok(customers.find(row => row.id === 801)?.archived_at);
  assert.deepEqual(transactions, beforeTransactions);

  const activeAccountRejected = await originalFetch(`${origin}/api/customers/archive-expired`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customerIds: [802] }),
  });
  assert.equal(activeAccountRejected.status, 409);
  assert.deepEqual(transactions, beforeTransactions);

  const restored = await originalFetch(`${origin}/api/customers/801/restore-archive`, {
    method: "POST",
    headers,
  });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(customers.find(row => row.id === 801)?.archived_at, null);
  assert.deepEqual(transactions, beforeTransactions);
  assert.equal(requests.some(request => request.table === "isp_transactions" && request.method === "PATCH"), false);

  const history = await originalFetch(`${origin}/api/customers/expired-history`, { headers });
  assert.equal(history.status, 200, await history.clone().text());
  assert.deepEqual(await history.json(), {
    ok: true,
    archivedExpiredCount: 1,
    permanentlyDeletedExpiredCount: 4,
  });
});
