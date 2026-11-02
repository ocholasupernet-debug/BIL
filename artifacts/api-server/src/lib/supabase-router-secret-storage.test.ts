import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRouterApiSecret,
  encryptRouterApiSecret,
  routerApiSecretLookupHash,
} from "./router-api-secret.js";

test("Supabase router reads keep plaintext server-side and serialize only ciphertext", async () => {
  process.env.SESSION_SECRET = "unit-test-router-secret-storage";
  process.env.VITE_SUPABASE_URL = "https://supabase.test";
  process.env.VITE_SUPABASE_KEY = "test-anon-key";
  const { sbSelect } = await import("./supabase-client.js");
  const originalFetch = globalThis.fetch;
  const password = "router-password-not-for-browser";
  const encrypted = encryptRouterApiSecret(password);
  let capturedUrl = "";
  globalThis.fetch = async input => {
    capturedUrl = String(input);
    return new Response(JSON.stringify([{
      id: 7,
      router_secret: encrypted,
      router_secret_lookup_hash: routerApiSecretLookupHash(password),
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const rows = await sbSelect<{ id: number; router_secret: string }>(
      "isp_routers",
      `id=eq.7&router_secret=eq.${encodeURIComponent(password)}&select=id,router_secret`,
    );
    assert.equal(rows[0]?.router_secret, password);
    assert.equal(capturedUrl.includes(password), false);
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes(password), false);
    const browserRows = JSON.parse(serialized) as Array<{ router_secret: string; router_secret_lookup_hash?: string }>;
    assert.equal(decryptRouterApiSecret(browserRows[0]?.router_secret), password);
    assert.equal(browserRows[0]?.router_secret_lookup_hash, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Supabase router writes store ciphertext and an equality-safe keyed hash", async () => {
  process.env.SESSION_SECRET = "unit-test-router-secret-storage";
  process.env.VITE_SUPABASE_URL = "https://supabase.test";
  process.env.VITE_SUPABASE_KEY = "test-anon-key";
  const { sbUpdate } = await import("./supabase-client.js");
  const originalFetch = globalThis.fetch;
  const password = "router-password-to-store";
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify([{
      id: 8,
      router_secret: encryptRouterApiSecret(password),
      router_secret_lookup_hash: routerApiSecretLookupHash(password),
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const rows = await sbUpdate<{ router_secret: string }>(
      "isp_routers",
      "id=eq.8",
      { router_secret: password },
    );
    const stored = JSON.parse(body) as { router_secret: string; router_secret_lookup_hash: string };
    assert.equal(body.includes(password), false);
    assert.equal(decryptRouterApiSecret(stored.router_secret), password);
    assert.equal(stored.router_secret_lookup_hash, routerApiSecretLookupHash(password));
    assert.equal(rows[0]?.router_secret, password);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
