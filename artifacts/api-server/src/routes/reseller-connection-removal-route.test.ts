import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

test("ISP connection-request deletion stays scoped and safely clears approved links", async () => {
  const envKeys = [
    "SESSION_SECRET",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_KEY",
    "BILLING_SUPABASE_SERVICE_KEY",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.SESSION_SECRET = "reseller-connection-test-secret";
  process.env.VITE_SUPABASE_URL = "https://reseller-connection-test.supabase.co";
  process.env.VITE_SUPABASE_KEY = "reseller-connection-test-anon";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "reseller-connection-test-service";

  const [{ default: resellerRouter }, { generateAdminSessionToken }] = await Promise.all([
    import("./reseller-route.js"),
    import("../lib/api-auth.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", resellerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  type MockRequest = {
    id: number;
    reseller_id: number;
    isp_admin_id: number;
    status: "pending" | "approved" | "rejected";
  };
  const ispAdminId = 42;
  const resellerId = 19;
  let requests: MockRequest[] = [];
  let handoffs: { id: number; status: string }[] = [];
  let otherApprovedIspIds: number[] = [];
  let resellerParentId: number | null = ispAdminId;
  let failNextRequestDelete = false;
  const mutations: { table: string; method: string; query: URLSearchParams; body?: Record<string, unknown> }[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "reseller-connection-test.supabase.co");
    const method = init?.method ?? "GET";
    const table = url.pathname.split("/").at(-1);
    const body = init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : undefined;
    let rows: Record<string, unknown>[] = [];
    if (method !== "GET") mutations.push({ table: table ?? "", method, query: url.searchParams, body });

    if (table === "isp_admins") {
      if (method === "GET") {
        const id = Number(url.searchParams.get("id")?.replace(/^eq\./, ""));
        if (id === resellerId && url.searchParams.get("role") === "eq.reseller") {
          rows = [{ id: resellerId, parent_id: resellerParentId, role: "reseller", status: "active" }];
        } else if (id === 42 || id === 43) {
          rows = [{
            id,
            parent_id: null,
            subdomain: `isp${id}`,
            role: "isp_admin",
            account_tier: "isp_admin",
            is_active: true,
            auth_version: 1,
          }];
        }
      } else if (method === "PATCH" && url.searchParams.get("id") === `eq.${resellerId}`) {
        const parentFilter = url.searchParams.get("parent_id");
        const matchesParent = !parentFilter ||
          (parentFilter === "is.null" ? resellerParentId === null : parentFilter === `eq.${resellerParentId}`);
        if (matchesParent) {
          resellerParentId = body?.parent_id as number | null;
          rows = [{ id: resellerId, parent_id: resellerParentId, role: "reseller", status: body?.status ?? "active" }];
        }
      }
    } else if (table === "isp_reseller_connection_requests") {
      if (method === "GET" && url.searchParams.has("reseller_id")) {
        rows = otherApprovedIspIds.map((isp_admin_id) => ({ isp_admin_id }));
      } else if (method === "GET") {
        const id = Number(url.searchParams.get("id")?.replace(/^eq\./, ""));
        const scopedIspId = Number(url.searchParams.get("isp_admin_id")?.replace(/^eq\./, ""));
        rows = requests.filter((row) => row.id === id && row.isp_admin_id === scopedIspId);
      } else if (method === "DELETE") {
        if (failNextRequestDelete) {
          failNextRequestDelete = false;
          return new Response(JSON.stringify({ message: "injected delete failure" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const idFilter = url.searchParams.get("id");
        const resellerFilter = url.searchParams.get("reseller_id");
        const ispFilter = url.searchParams.get("isp_admin_id");
        const statusFilter = url.searchParams.get("status");
        rows = requests.filter((row) =>
          (!idFilter || idFilter === `eq.${row.id}`) &&
          (!resellerFilter || resellerFilter === `eq.${row.reseller_id}`) &&
          (!ispFilter || ispFilter === `eq.${row.isp_admin_id}`) &&
          (!statusFilter || statusFilter === `eq.${row.status}`),
        );
        requests = requests.filter((row) => !rows.some((deleted) => deleted.id === row.id));
      }
    } else if (table === "isp_reseller_ports" && method === "GET") {
      rows = handoffs;
    }

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const endpoint = `http://127.0.0.1:${address.port}/api/isp/reseller-connection-requests/5`;
  const ispToken = generateAdminSessionToken(String(ispAdminId), 1);
  const deleteWithToken = (token: string) => originalFetch(endpoint, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    requests = [{ id: 5, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "pending" }];
    handoffs = [{ id: 8, status: "cleanup_pending" }];
    const pendingDelete = await deleteWithToken(ispToken);
    assert.equal(pendingDelete.status, 200);
    assert.equal((await pendingDelete.json() as { connectionCleared: boolean }).connectionCleared, false);
    assert.equal(requests.length, 0);
    assert.equal(
      mutations.some((mutation) => mutation.table === "isp_admins" && mutation.method === "PATCH"),
      false,
    );

    requests = [{ id: 5, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "pending" }];
    const mutationCountBeforeOtherIspDelete = mutations.length;
    const otherIspDelete = await deleteWithToken(generateAdminSessionToken("43", 1));
    assert.equal(otherIspDelete.status, 404);
    assert.equal(requests.length, 1, "another ISP must not delete this ISP's request");
    assert.equal(mutations.length, mutationCountBeforeOtherIspDelete);

    requests = [{ id: 5, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "approved" }];
    handoffs = [{ id: 8, status: "cleanup_pending" }];
    const mutationCountBeforeBlockedClear = mutations.length;
    const blockedClear = await deleteWithToken(ispToken);
    assert.equal(blockedClear.status, 409);
    assert.match((await blockedClear.json() as { error: string }).error, /handoffs before clearing/i);
    assert.equal(mutations.length, mutationCountBeforeBlockedClear, "blocked clearing must not update the account or delete records");

    requests = [
      { id: 5, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "approved" },
      { id: 6, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "approved" },
    ];
    handoffs = [];
    otherApprovedIspIds = [77];
    resellerParentId = ispAdminId;
    failNextRequestDelete = true;
    const failedClear = await deleteWithToken(ispToken);
    assert.equal(failedClear.status, 500);
    assert.equal(resellerParentId, ispAdminId, "a failed delete must restore the original reseller parent");
    assert.equal(requests.length, 2, "approved request rows remain when deletion fails");

    requests = [
      { id: 5, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "approved" },
      { id: 6, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "approved" },
      { id: 7, reseller_id: resellerId, isp_admin_id: ispAdminId, status: "pending" },
    ];
    handoffs = [];
    otherApprovedIspIds = [77];
    resellerParentId = ispAdminId;
    const clear = await deleteWithToken(ispToken);
    assert.equal(clear.status, 200);
    assert.equal((await clear.json() as { connectionCleared: boolean }).connectionCleared, true);
    assert.equal(resellerParentId, 77, "the reseller should remain linked to another approved ISP");
    assert.deepEqual(requests.map((row) => row.id), [7], "only approved rows for this ISP should be removed");
    assert.ok(mutations.some((mutation) =>
      mutation.table === "isp_reseller_connection_requests" &&
      mutation.method === "DELETE" &&
      mutation.query.get("isp_admin_id") === `eq.${ispAdminId}` &&
      mutation.query.get("status") === "eq.approved",
    ));
    assert.equal(mutations.some((mutation) => mutation.table === "isp_reseller_ports"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
  }
});