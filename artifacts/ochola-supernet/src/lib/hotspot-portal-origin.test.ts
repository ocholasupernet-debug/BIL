import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotPostLoginDestination,
  hotspotApiOriginFromTenantContext,
  resolveHotspotPortalApiOrigin,
} from "./hotspot-portal-origin.js";

test("normalizes the tenant-resolved public API origin", () => {
  assert.equal(
    hotspotApiOriginFromTenantContext("https://come.isplatty.org/"),
    "https://come.isplatty.org",
  );
});

test("creates a safe HTTPS post-login destination from the configured tenant hostname", () => {
  assert.equal(hotspotPostLoginDestination("ocholasupernet.org", "isplatty.org"), "https://ocholasupernet.org/");
  assert.equal(hotspotPostLoginDestination("come", "isplatty.org"), "https://come.isplatty.org/");
  assert.equal(hotspotPostLoginDestination("bad..example.com", "isplatty.org"), "");
});

test("uses a custom portal hostname only after its app health endpoint responds", async () => {
  let healthCheckUrl = "";
  const result = await resolveHotspotPortalApiOrigin(
    "wifi.example.com",
    "https://come.isplatty.org/",
    "isplatty.org",
    async input => {
      healthCheckUrl = String(input);
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  assert.equal(healthCheckUrl, "https://wifi.example.com/api/healthz");
  assert.deepEqual(result, {
    apiBase: "https://wifi.example.com",
    source: "verified_portal_hostname",
  });
});

test("an unreachable custom portal hostname falls back to the tenant API origin", async () => {
  const result = await resolveHotspotPortalApiOrigin(
    "ocholasupernet.org",
    "https://come.isplatty.org/",
    "isplatty.org",
    async () => {
      throw new Error("DNS lookup failed");
    },
  );

  assert.deepEqual(result, {
    apiBase: "https://come.isplatty.org",
    source: "tenant_context",
  });
});

test("tenant labels keep the default base domain and invalid hosts fall back without a request", async () => {
  let healthChecks = 0;
  const fetcher: typeof fetch = async () => {
    healthChecks += 1;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const tenantLabel = await resolveHotspotPortalApiOrigin(
    "come",
    "https://other.isplatty.org",
    "isplatty.org",
    fetcher,
  );
  const invalidHost = await resolveHotspotPortalApiOrigin(
    "bad..example.com",
    "https://come.isplatty.org",
    "isplatty.org",
    fetcher,
  );

  assert.deepEqual(tenantLabel, {
    apiBase: "https://come.isplatty.org",
    source: "verified_portal_hostname",
  });
  assert.deepEqual(invalidHost, {
    apiBase: "https://come.isplatty.org",
    source: "tenant_context",
  });
  assert.equal(healthChecks, 1);
});

test("rejects non-HTTPS and local API origins", () => {
  for (const origin of [
    "http://come.isplatty.org",
    "https://localhost:8080",
    "https://127.0.0.1:8080",
    "https://0.0.0.0",
    "https://user:password@come.isplatty.org",
    "not a URL",
  ]) {
    assert.throws(
      () => hotspotApiOriginFromTenantContext(origin),
      /public HTTPS origin/,
      origin,
    );
  }
});
