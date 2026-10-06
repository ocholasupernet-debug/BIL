import assert from "node:assert/strict";
import { test } from "node:test";

const originalUrl = process.env.VITE_SUPABASE_URL;
const originalKey = process.env.VITE_SUPABASE_KEY;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_URL = "https://supabase-test.invalid";
process.env.VITE_SUPABASE_KEY = "test-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
const { sbDeleteStrict, sbRpc, sbSelectStrict } = await import("./supabase-client.js");
if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = originalUrl;
if (originalKey === undefined) delete process.env.VITE_SUPABASE_KEY;
else process.env.VITE_SUPABASE_KEY = originalKey;
if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;

test("isp_plans selects omit the removed plan_type field", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(String(input));
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    await sbSelectStrict(
      "isp_plans",
      "id=eq.9&select=id,name,type,plan_type,data_limit_mb&limit=1",
    );
    await sbSelectStrict(
      "isp_routers",
      "select=id,plan_type&limit=1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    new URL(requestedUrls[0]).searchParams.get("select"),
    "id,name,type,data_limit_mb",
  );
  assert.equal(
    new URL(requestedUrls[1]).searchParams.get("select"),
    "id,plan_type",
  );
});

test("strict delete failures identify the table being deleted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    code: "23503",
    message: "update or delete violates a foreign key constraint",
  }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      sbDeleteStrict("isp_routers", "id=eq.138"),
      /Supabase rejected deletion from isp_routers \(HTTP 409\): 23503/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RPC errors retain safe Postgres diagnostics without details or hints", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    code: "P0001",
    message: "The confirmed Hotspot payment could not be claimed.",
    details: "Sensitive account value 254700000000",
    hint: "Sensitive internal hint",
  }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      sbRpc("claim_prepaid_hotspot_transaction_account", {}),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /P0001 — The confirmed Hotspot payment could not be claimed\./);
        assert.doesNotMatch(message, /254700000000|Sensitive internal hint/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
