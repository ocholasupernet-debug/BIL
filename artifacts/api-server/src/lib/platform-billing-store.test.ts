import assert from "node:assert/strict";
import test from "node:test";

test("Super Admin secure settings use the isolated billing service key", async () => {
  const envKeys = [
    "VITE_SUPABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_DEST_SERVICE_ROLE_KEY",
    "BILLING_SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "VITE_SUPABASE_KEY",
  ] as const;
  const previousEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;

  process.env.VITE_SUPABASE_URL = "https://secure-settings-test.supabase.co";
  process.env.BILLING_SUPABASE_SERVICE_KEY = "billing-only-test-service-key";
  delete process.env.SUPABASE_DEST_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.VITE_SUPABASE_KEY;

  const requestUrls: string[] = [];
  const requestKeys: string[] = [];
  globalThis.fetch = async (input, init) => {
    requestUrls.push(String(input));
    requestKeys.push(new Headers(init?.headers).get("apikey") ?? "");
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
      requestUrls[0],
      "https://secure-settings-test.supabase.co/rest/v1/platform_secure_settings?id=eq.global_daraja&select=id",
    );
    assert.equal(requestKeys[0], "billing-only-test-service-key");

    process.env.SUPABASE_DEST_SERVICE_ROLE_KEY = "destination-service-test-key";
    await secureStore.platformSecureSettingsSelect("id=eq.global_daraja&select=id");
    assert.equal(requestKeys[1], "destination-service-test-key");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const oldValue = previousEnv.get(key);
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});
