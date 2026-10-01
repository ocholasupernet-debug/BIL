import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("router deletion with migration history is rejected before related records are removed", async () => {
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
  let routerReads = 0;
  let migrationReads = 0;
  let deletes = 0;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "router-delete-test.supabase.co");

    if (url.pathname.endsWith("/rest/v1/isp_routers") && (!init?.method || init.method === "GET")) {
      routerReads += 1;
      return new Response(JSON.stringify([{ id: 138, admin_id: 1, name: "Source router" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/rest/v1/router_migration_jobs") && (!init?.method || init.method === "GET")) {
      migrationReads += 1;
      assert.equal(url.searchParams.get("or"), "(source_router_id.eq.138,target_router_id.eq.138)");
      return new Response(JSON.stringify([{ id: 7 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "DELETE") deletes += 1;
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

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "This router is referenced by migration job history and cannot be deleted. The router record must remain to preserve that history.",
      code: "router_migration_job_reference",
    });
    assert.equal(routerReads, 1);
    assert.equal(migrationReads, 1);
    assert.equal(deletes, 0);
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