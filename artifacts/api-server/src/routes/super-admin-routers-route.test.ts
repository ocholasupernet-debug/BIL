import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("super-admin router deletion revokes planned temporary VPN clients and removes linked history atomically", async () => {
  const envKeys = [
    "SUPERADMIN_USERNAME",
    "SUPERADMIN_API_KEY",
    "SUPERADMIN_PASSWORD",
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  process.env.SUPERADMIN_USERNAME = "router-delete-test";
  process.env.SUPERADMIN_API_KEY = "router-delete-api-test";
  process.env.SUPERADMIN_PASSWORD = "router-delete-password-test";
  process.env.VITE_SUPABASE_URL = "https://router-delete-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "router-delete-service-test";

  const [{ default: authRouter }, { default: routersRouter }] = await Promise.all([
    import("./super-admin-auth-route.js"),
    import("./super-admin-routers-route.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", routersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  let prepareCalls = 0;
  let deleteCalls = 0;
  let activityWrites = 0;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "router-delete-test.supabase.co");

    if (url.pathname.endsWith("/rest/v1/rpc/prepare_super_admin_router_deletion")) {
      prepareCalls += 1;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { p_router_id: 138 });
      return new Response(JSON.stringify([{
        router_id: 138,
        admin_id: 1,
        router_name: "Source router",
        active_vpn_usernames: [],
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/delete_super_admin_router_with_history")) {
      deleteCalls += 1;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        p_router_id: 138,
        p_revoked_vpn_usernames: [],
      });
      return new Response(JSON.stringify([{
        router_id: 138,
        admin_id: 1,
        router_name: "Source router",
        migration_jobs_deleted: 1,
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "POST" && url.pathname.startsWith("/rest/v1/")) {
      activityWrites += 1;
      return new Response("[]", {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Supabase request: ${init?.method ?? "GET"} ${url.pathname}`);
  };

  try {
    const endpoint = `http://127.0.0.1:${address.port}/api`;
    const loginResponse = await originalFetch(`${endpoint}/super-admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "router-delete-test",
        api_key: "router-delete-api-test",
        password: "router-delete-password-test",
      }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { token: string };
    const response = await originalFetch(`${endpoint}/super-admin/routers/138`, {
      method: "DELETE",
      headers: { "x-sa-token": login.token },
    });

    assert.equal(response.status, 204);
    assert.equal(prepareCalls, 1);
    assert.equal(deleteCalls, 1);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(activityWrites, 1);
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