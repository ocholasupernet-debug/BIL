import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "production";
process.env.VITE_SUPABASE_URL = "https://supabase-production-test.invalid";
process.env.VITE_SUPABASE_KEY = "public-anon-test-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

const { sbSelectStrict, supabaseConfigured } = await import("./supabase-client.js");

test("production database access refuses to fall back to the public anon key", async () => {
  assert.equal(supabaseConfigured, false);
  await assert.rejects(
    sbSelectStrict("isp_customers", "select=id&limit=1"),
    /Server Supabase service-role access is not configured/,
  );
});
