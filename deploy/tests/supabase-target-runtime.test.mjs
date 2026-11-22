import assert from "node:assert/strict";
import test from "node:test";
import { verifySupabaseRuntimeTarget } from "../verify-supabase-runtime-target.mjs";

const env = {
  VITE_SUPABASE_URL: "https://vuvyweofsutgqdtbjckj.supabase.co",
  VITE_SUPABASE_KEY: "public-test-key",
  SUPABASE_DEST_SERVICE_ROLE_KEY: "service-test-key",
};

test("runtime preflight checks destination Auth and performs a read-only table request", async () => {
  const requests = [];
  const result = await verifySupabaseRuntimeTarget(env, async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200 };
  });
  assert.deepEqual(result, { ok: true, category: "destination_read_ok" });
  assert.match(requests[0].url, /auth\/v1\/settings$/);
  assert.match(requests[1].url, /isp_admins\?select=id&limit=0$/);
  assert.equal(requests[1].init.headers.Authorization, "Bearer service-test-key");
});

test("runtime preflight refuses another project before sending a request", async () => {
  let requests = 0;
  const result = await verifySupabaseRuntimeTarget({
    ...env,
    VITE_SUPABASE_URL: "https://qfsxsbzaqwmyuxhramyw.supabase.co",
  }, async () => {
    requests += 1;
    return { ok: true, status: 200 };
  });
  assert.deepEqual(result, { ok: false, category: "target_mismatch" });
  assert.equal(requests, 0);
});

test("runtime preflight returns sanitized errors without credential values", async () => {
  const result = await verifySupabaseRuntimeTarget(env, async () => ({
    ok: false,
    status: 403,
  }));
  assert.deepEqual(result, {
    ok: false,
    category: "publishable_key_denied",
    status: 403,
  });
  assert.doesNotMatch(JSON.stringify(result), /public-test-key|service-test-key/);
});
