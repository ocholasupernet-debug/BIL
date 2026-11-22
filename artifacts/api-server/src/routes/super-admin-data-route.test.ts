import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("platform dashboard data is Super Admin protected and read through the server service client", async () => {
  const envKeys = [
    "SUPERADMIN_USERNAME",
    "SUPERADMIN_API_KEY",
    "SUPERADMIN_PASSWORD",
    "TURNSTILE_SECRET",
    "GMAIL_APP_PASSWORD",
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DEST_SERVICE_ROLE_KEY",
  ] as const;
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPERADMIN_USERNAME: "platform-data-test",
    SUPERADMIN_API_KEY: "platform-data-api-test",
    SUPERADMIN_PASSWORD: "platform-data-password-test",
    TURNSTILE_SECRET: "platform-data-turnstile-test",
    GMAIL_APP_PASSWORD: "",
    VITE_SUPABASE_URL: "https://platform-data-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "platform-data-service-test",
    SUPABASE_DEST_SERVICE_ROLE_KEY: "platform-data-destination-service-test",
  });

  const [{ default: authRouter }, { default: dataRouter }] = await Promise.all([
    import("./super-admin-auth-route.js"),
    import("./super-admin-data-route.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", dataRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  const readTables = new Set<string>();
  let turnstileChecks = 0;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    if (url.hostname === "challenges.cloudflare.com") {
      turnstileChecks += 1;
      const body = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(body.get("response"), "platform-data-turnstile-token");
      return new Response(JSON.stringify({
        success: true,
        hostname: "isplatty.org",
        action: "admin_login",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    assert.equal(url.hostname, "platform-data-test.supabase.co");
    assert.equal(new Headers(init?.headers).get("apikey"), "platform-data-destination-service-test");
    assert.ok(!init?.method || init.method === "GET");
    const table = url.pathname.split("/").at(-1) ?? "";
    readTables.add(table);
    const rows: Record<string, unknown[]> = {
      isp_admins: [{ id: 1, name: "Example ISP", is_active: true }],
      isp_routers: [{ id: 11, name: "router-1", status: "online", admin_id: 1 }],
      isp_customers: [{ id: 21, admin_id: 1, is_active: true, type: "hotspot" }],
      isp_plans: [{ id: 31, admin_id: 1, type: "hotspot", price: 100 }],
    };
    assert.ok(Object.hasOwn(rows, table), `unexpected read from ${table}`);
    return new Response(JSON.stringify(rows[table]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const endpoint = `http://127.0.0.1:${address.port}/api`;
    const unauthorized = await originalFetch(`${endpoint}/super-admin/platform-data`);
    assert.equal(unauthorized.status, 401);
    assert.equal(readTables.size, 0);

    const loginResponse = await originalFetch(`${endpoint}/super-admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://isplatty.org",
      },
      body: JSON.stringify({
        username: "platform-data-test",
        api_key: "platform-data-api-test",
        password: "platform-data-password-test",
        turnstileToken: "platform-data-turnstile-token",
      }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { token: string };

    const response = await originalFetch(`${endpoint}/super-admin/platform-data`, {
      headers: { "x-sa-token": login.token },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      ok: boolean;
      admins: unknown[];
      routers: unknown[];
      customers: unknown[];
      plans: unknown[];
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.admins.length, 1);
    assert.equal(payload.routers.length, 1);
    assert.equal(payload.customers.length, 1);
    assert.equal(payload.plans.length, 1);
    assert.deepEqual([...readTables].sort(), [
      "isp_admins",
      "isp_customers",
      "isp_plans",
      "isp_routers",
    ]);
    assert.equal(turnstileChecks, 1);
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
