import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("transaction APIs enforce ISP and reseller ownership from the signed-in account", async () => {
  process.env.TOKEN_SIGNING_SECRET = "transaction-scope-test-secret";
  process.env.VITE_SUPABASE_URL = "https://transaction-scope-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "transaction-scope-test-service-key";

  const [{ default: transactionsRouter }, { generateAdminSessionToken }] = await Promise.all([
    import("./transactions.js"),
    import("../lib/api-auth.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", transactionsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const accounts = new Map([
    [41, { id: 41, parent_id: null, role: "isp_admin", account_tier: "isp_admin", is_active: true, auth_version: 1 }],
    [83, { id: 83, parent_id: 41, role: "reseller", account_tier: "reseller", is_active: true, auth_version: 1 }],
  ]);
  const originalFetch = globalThis.fetch;
  let activeAccountId = 41;
  let transactionReads = 0;
  const supabaseRequests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "transaction-scope-test.supabase.co");
    supabaseRequests.push(`${init?.method ?? "GET"} ${url.pathname}?${url.searchParams.toString()}`);

    if (url.pathname.endsWith("/rest/v1/isp_admins")) {
      const requestedId = Number(url.searchParams.get("id")?.replace(/^eq\./, ""));
      const account = accounts.get(requestedId);
      return new Response(JSON.stringify(account ? [account] : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/rest/v1/isp_transactions")) {
      transactionReads += 1;
      assert.equal(url.searchParams.get("payment_method"), "not.in.(mpesa_registration,manual_registration,mpesa_platform_billing)");
      assert.equal(url.searchParams.get("order"), "created_at.desc");
      assert.equal(url.searchParams.get("limit"), "10000");
      assert.equal(
        url.searchParams.get("select"),
        "id,customer_id,plan_id,amount,payment_method,reference,mpesa_receipt,status,notes,created_at",
      );
      if (activeAccountId === 41) {
        assert.equal(url.searchParams.get("admin_id"), "eq.41");
        assert.equal(url.searchParams.get("reseller_id"), "is.null");
        assert.equal(url.searchParams.get("or"), null);
      } else {
        assert.equal(
          url.searchParams.get("or"),
          "(and(admin_id.eq.41,reseller_id.eq.83),and(admin_id.eq.83,reseller_id.is.null))",
        );
        assert.equal(url.searchParams.get("admin_id"), null);
      }
      return new Response(JSON.stringify([{
        id: 900 + activeAccountId,
        customer_id: null,
        plan_id: 7,
        amount: "250",
        payment_method: "mpesa",
        reference: `TX-${activeAccountId}`,
        mpesa_receipt: "UJ5QQ8VB9M",
        status: "completed",
        notes: null,
        created_at: "2026-10-03T08:00:00.000Z",
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname.endsWith("/rest/v1/isp_reseller_ports")) {
      assert.equal(url.searchParams.get("admin_id"), "eq.41");
      assert.equal(url.searchParams.get("assigned_reseller_id"), "eq.83");
      return new Response(JSON.stringify([{ router_id: 7 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/rest/v1/isp_plans")) {
      if (activeAccountId === 41) {
        assert.equal(url.searchParams.get("admin_id"), "eq.41");
        assert.equal(url.searchParams.get("owner_reseller_id"), "is.null");
      } else {
        assert.equal(url.searchParams.get("admin_id"), "eq.41");
        assert.equal(url.searchParams.get("owner_reseller_id"), "eq.83");
        assert.equal(url.searchParams.get("router_id"), "in.(7)");
      }
      return new Response(JSON.stringify([{ id: 7, router_id: 7 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/rest/v1/isp_routers")) {
      assert.equal(url.searchParams.get("admin_id"), "eq.41");
      if (activeAccountId === 83) assert.equal(url.searchParams.get("id"), "in.(7)");
      return new Response(JSON.stringify([{ id: 7, name: "Scoped router" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Page-auth policy lookups default to no extra verification in this test.
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const endpoint = `http://127.0.0.1:${address.port}/api`;
  try {
    const unauthorized = await originalFetch(`${endpoint}/transactions`, {
      headers: { Connection: "close" },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    assert.equal(transactionReads, 0);

    const ispToken = generateAdminSessionToken("41", 1);
    const ispResponse = await originalFetch(`${endpoint}/transactions`, {
      headers: { Authorization: `Bearer ${ispToken}`, Connection: "close" },
    });
    assert.equal(
      ispResponse.status,
      200,
      `Unexpected ISP response: ${await ispResponse.clone().text()}; Supabase calls: ${supabaseRequests.join(" | ")}`,
    );
    const ispRows = await ispResponse.json() as Array<{ amount: number; reference: string }>;
    assert.equal(ispRows[0]?.amount, 250);
    assert.equal(ispRows[0]?.reference, "TX-41");

    const mismatchedTenant = await originalFetch(`${endpoint}/transactions?adminId=83`, {
      headers: { Authorization: `Bearer ${ispToken}`, Connection: "close" },
    });
    assert.equal(mismatchedTenant.status, 400);
    await mismatchedTenant.arrayBuffer();
    assert.equal(transactionReads, 1);

    activeAccountId = 83;
    const resellerToken = generateAdminSessionToken("83", 1);
    const resellerResponse = await originalFetch(`${endpoint}/transactions/overview`, {
      headers: { Authorization: `Bearer ${resellerToken}`, Connection: "close" },
    });
    assert.equal(
      resellerResponse.status,
      200,
      `Unexpected reseller response: ${await resellerResponse.clone().text()}; Supabase calls: ${supabaseRequests.join(" | ")}`,
    );
    const overview = await resellerResponse.json() as {
      transactions: Array<{ amount: number; reference: string }>;
      plans: Array<{ id: number; router_id: number }>;
      routers: Array<{ id: number; name: string }>;
    };
    assert.equal(overview.transactions[0]?.amount, 250);
    assert.equal(overview.transactions[0]?.reference, "TX-83");
    assert.deepEqual(overview.plans, [{ id: 7, router_id: 7 }]);
    assert.deepEqual(overview.routers, [{ id: 7, name: "Scoped router" }]);
    assert.equal(transactionReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});