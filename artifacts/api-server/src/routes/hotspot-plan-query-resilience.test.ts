import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

process.env.VITE_SUPABASE_URL = "https://hotspot-plan-resilience-test.supabase.co";
process.env.VITE_SUPABASE_KEY = "hotspot-plan-resilience-test-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

test("customer Hotspot plan reads distinguish database failures from a real empty result", async t => {
  const { default: plansRouter } = await import("./plans.js");
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let failTable: string | null = null;

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "hotspot-plan-resilience-test.supabase.co");

    const table = url.pathname.split("/").at(-1) ?? "";
    requests.push(table);
    if (table === failTable) {
      failTable = null;
      return new Response("temporary database failure", { status: 503 });
    }

    const rows = table === "isp_reseller_ports"
      ? [{ id: 43, router_id: 31, assigned_reseller_id: null }]
      : [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const app = express();
  app.use("/api", plansRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const path = "/api/plans?adminId=7&routerId=31&portId=43&type=hotspot&activeOnly=true&purchasableOnly=true";
  for (const table of ["isp_reseller_ports", "isp_plans"]) {
    requests.length = 0;
    failTable = table;
    const response = await originalFetch(`${origin}${path}`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Hotspot packages could not be loaded. Please try again.",
    });
    assert.ok(requests.includes(table), `the failing ${table} read should be attempted`);
  }

  requests.length = 0;
  const emptyResponse = await originalFetch(`${origin}${path}`);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(await emptyResponse.json(), []);
  assert.ok(requests.includes("isp_plans"));
});