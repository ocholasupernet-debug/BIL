import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("tenant router context is authenticated and always scoped to the signed-in ISP", async () => {
  const envKeys = ["TOKEN_SIGNING_SECRET", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  process.env.TOKEN_SIGNING_SECRET = "admin-data-route-test-secret";
  process.env.VITE_SUPABASE_URL = "https://admin-data-route-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "admin-data-route-test-service";

  const [{ default: routersRouter }, { generateAdminSessionToken }] = await Promise.all([
    import("./routers-route.js"),
    import("../lib/api-auth.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", routersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const originalFetch = globalThis.fetch;
  const externalRequests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    externalRequests.push(`${init?.method ?? "GET"} ${url.pathname}?${url.searchParams.toString()}`);
    assert.equal(url.hostname, "admin-data-route-test.supabase.co");
    assert.equal(new Headers(init?.headers).get("apikey"), "admin-data-route-test-service");

    if (url.pathname.endsWith("/rest/v1/isp_admins")) {
      const id = Number(url.searchParams.get("id")?.replace(/^eq\./, ""));
      const row = id === 44
        ? { id: 44, parent_id: null, subdomain: "cedar", role: "isp_admin", account_tier: "isp_admin", is_active: true, auth_version: 1 }
        : id === 83
          ? { id: 83, parent_id: 44, subdomain: null, role: "reseller", account_tier: "reseller", is_active: true, auth_version: 1 }
          : null;
      return new Response(JSON.stringify(row ? [row] : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/rest/v1/isp_routers")) {
      if (url.searchParams.get("id") === "eq.800") {
        assert.equal(url.searchParams.get("id"), "eq.800");
        assert.equal(url.searchParams.get("admin_id"), "eq.44");
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (init?.method === "PATCH") {
        throw new Error("A cross-tenant router update must not reach Supabase.");
      }
      assert.equal(url.searchParams.get("admin_id"), "eq.44");
      assert.equal(url.searchParams.get("select"), "*");
      return new Response(JSON.stringify([{
        id: 800,
        admin_id: 44,
        name: "Cedar router",
        host: "10.8.5.16",
        status: "online",
        router_username: "router-api",
        router_secret: "test-router-secret",
        token: "must-not-reach-browser",
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected database request: ${init?.method ?? "GET"} ${url.pathname}`);
  };

  try {
    const root = `http://127.0.0.1:${address.port}/api`;
    const unauthorized = await originalFetch(`${root}/routers/admin-context`);
    assert.equal(unauthorized.status, 401);
    assert.equal(externalRequests.length, 0);

    const adminToken = generateAdminSessionToken("44", 1);
    const contextResponse = await originalFetch(`${root}/routers/admin-context`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json() as {
      ok: boolean;
      routers: Array<{ id: number; router_secret: string; token?: string }>;
    };
    assert.equal(context.ok, true);
    assert.equal(context.routers[0]?.id, 800);
    assert.equal(context.routers[0]?.token, undefined);

    const resellerToken = generateAdminSessionToken("83", 1);
    const resellerResponse = await originalFetch(`${root}/routers/admin-context`, {
      headers: { Authorization: `Bearer ${resellerToken}` },
    });
    assert.equal(resellerResponse.status, 403);
    assert.equal(externalRequests.filter(request => request.includes("/rest/v1/isp_routers")).length, 1);

    const crossTenantUpdate = await originalFetch(`${root}/routers/800`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "attempted update" }),
    });
    assert.equal(crossTenantUpdate.status, 404);
    assert.equal(externalRequests.filter(request => request.startsWith("PATCH /rest/v1/isp_routers")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Super Admin platform-data routes reject missing authentication before database reads", async () => {
  const [{ default: dataRouter }] = await Promise.all([import("./super-admin-data-route.js")]);
  const app = express();
  app.use("/api", dataRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  let databaseReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    databaseReads += 1;
    throw new Error(`Unexpected database request: ${init?.method ?? "GET"} ${url.pathname}`);
  };
  try {
    const response = await originalFetch(`http://127.0.0.1:${address.port}/api/super-admin/platform-data`);
    assert.equal(response.status, 401);
    assert.equal(databaseReads, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
