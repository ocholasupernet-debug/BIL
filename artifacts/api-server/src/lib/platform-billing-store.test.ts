import assert from "node:assert/strict";
import test from "node:test";

test("Super Admin secure settings use the isolated billing service key", async () => {
  const envKeys = [
    "VITE_SUPABASE_URL",
    "SUPABASE_URL",
    "BILLING_SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "VITE_SUPABASE_KEY",
  ] as const;
  const previousEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;

  process.env.VITE_SUPABASE_URL = "https://secure-settings-test.supabase.co";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "billing-only-test-service-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.VITE_SUPABASE_KEY;

  let requestUrl = "";
  let requestHeaders = new Headers();
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify([{ id: "global_daraja" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const secureStore = await import("./platform-billing-store.js");
    const sharedClient = await import("./supabase-client.js");
    assert.equal(secureStore.platformSecureSettingsConfigured(), true);
    assert.equal(sharedClient.supabaseServiceRoleConfigured, false);
    assert.deepEqual(
      await secureStore.platformSecureSettingsSelect("id=eq.global_daraja&select=id"),
      [{ id: "global_daraja" }],
    );
    assert.equal(
      requestUrl,
      "https://secure-settings-test.supabase.co/rest/v1/platform_secure_settings?id=eq.global_daraja&select=id",
    );
    assert.equal(requestHeaders.get("apikey"), "billing-only-test-service-key");
    assert.equal(requestHeaders.get("authorization"), "Bearer billing-only-test-service-key");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const oldValue = previousEnv.get(key);
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});
