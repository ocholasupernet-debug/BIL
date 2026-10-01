import assert from "node:assert/strict";
import { test } from "node:test";

const originalUrl = process.env.VITE_SUPABASE_URL;
const originalKey = process.env.VITE_SUPABASE_KEY;
process.env.VITE_SUPABASE_URL = "https://supabase-test.invalid";
process.env.VITE_SUPABASE_KEY = "test-key";
const { sbDeleteStrict, sbSelectStrict } = await import("./supabase-client.js");
if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = originalUrl;
if (originalKey === undefined) delete process.env.VITE_SUPABASE_KEY;
else process.env.VITE_SUPABASE_KEY = originalKey;

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
