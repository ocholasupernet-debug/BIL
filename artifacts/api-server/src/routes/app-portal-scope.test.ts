import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "portal-scope-app-test-secret";
process.env.VITE_SUPABASE_URL = "https://portal-scope-app-test.supabase.co";
process.env.VITE_SUPABASE_KEY = "portal-scope-app-test-key";

const { default: app } = await import("../app.js");

test("router-served Hotspot HTML loads before signed API scope verification", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const portalResponse = await fetch(
    `${baseUrl}/hotspot/login.html?nasid=shared-router&server=reseller-hotspot`,
  );
  const portalBody = await portalResponse.text();

  assert.notEqual(portalResponse.status, 403);
  assert.doesNotMatch(portalBody, /requires a verified service scope/i);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const apiResponse = await originalFetch(
      `${baseUrl}/api/scope-test?nasid=shared-router&server=reseller-hotspot`,
    );
    assert.equal(apiResponse.status, 403);
    assert.match(await apiResponse.text(), /requires a verified service scope/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
