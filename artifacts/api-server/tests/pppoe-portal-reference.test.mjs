import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import express from "express";

process.env.NODE_ENV = "production";
process.env.TOKEN_SIGNING_SECRET = "pppoe-portal-test-secret";
process.env.VITE_SUPABASE_URL = "https://supabase.test";
process.env.VITE_SUPABASE_KEY = "supabase-test-key";

const outdir = "tests/.pppoe-portal-build";
await build({
  entryPoints: [
    "src/lib/api-auth.ts",
    "src/routes/pppoe-portal-route.ts",
  ],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["express"],
  logLevel: "silent",
});
const auth = await import(path.resolve(outdir, "lib/api-auth.cjs"));
const portalRoute = await import(path.resolve(outdir, "routes/pppoe-portal-route.cjs"));
await rm(outdir, { recursive: true, force: true });
const realFetch = globalThis.fetch;
const portalMiddleware = portalRoute.default.default;
const portalStatus = portalRoute.isEligiblePppoePortalStatus;

const app = express();
app.use(portalMiddleware);
const server = await new Promise(resolve => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

function request(pathname, host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${pathname}`, {
      headers: { Host: host },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          headers: response.headers,
          json: () => JSON.parse(body),
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

let customerStatus = "expired";
globalThis.fetch = async input => {
  const url = new URL(String(input));
  const rows = url.pathname.endsWith("/isp_admins")
    ? [{ id: 7, subdomain: "tenant", is_active: true }]
    : url.pathname.endsWith("/isp_routers")
      ? [{ id: 42, admin_id: 7, router_secret: "router-secret" }]
      : url.pathname.endsWith("/isp_customers")
        ? [{
            id: 101,
            admin_id: 7,
            type: "pppoe",
            status: customerStatus,
            username: "subscriber",
            pppoe_username: "subscriber",
            name: "Subscriber",
          }]
        : [];
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

function signBody(body) {
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", process.env.TOKEN_SIGNING_SECRET)
    .update(encoded)
    .digest("hex");
  return `${encoded}.${signature}`;
}

test("portal references are short-lived, signed, and tamper resistant", () => {
  const token = auth.generatePppoePortalReference({
    customerId: 101,
    adminId: 7,
    routerId: 42,
  });
  const payload = auth.validatePppoePortalReference(token);

  assert.equal(payload.customerId, 101);
  assert.equal(payload.adminId, 7);
  assert.equal(payload.routerId, 42);
  assert.equal(payload.purpose, "pppoe-expired-portal");
  assert.equal(auth.validatePppoePortalReference(`${token}tampered`), null);
});

test("portal references reject expiry, wrong purpose, and invalid identifiers", () => {
  const base = {
    purpose: "pppoe-expired-portal",
    customerId: 101,
    adminId: 7,
    routerId: 42,
    issuedAt: Date.now() - auth.PPPOE_PORTAL_REFERENCE_TTL_MS - 1,
    nonce: "test-nonce",
  };
  assert.equal(auth.validatePppoePortalReference(signBody(base)), null);
  assert.equal(auth.validatePppoePortalReference(signBody({ ...base, issuedAt: Date.now(), purpose: "customer-session" })), null);
  assert.equal(auth.validatePppoePortalReference(signBody({ ...base, issuedAt: Date.now(), customerId: 0 })), null);
});

test("only expired and paused subscriptions are portal eligible", () => {
  assert.equal(portalStatus("expired"), true);
  assert.equal(portalStatus("paused"), true);
  assert.equal(portalStatus("active"), false);
  assert.equal(portalStatus("suspended"), false);
  assert.equal(portalStatus("unknown"), false);
});

test("the access endpoint enforces tenant, router, and live subscription status", async () => {
  const token = auth.generatePppoePortalReference({
    customerId: 101,
    adminId: 7,
    routerId: 42,
  });
  const allowed = await request(`/public/pppoe-portal/access?ref=${encodeURIComponent(token)}`, "tenant.isplatty.org");
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json().customer.status, "expired");

  customerStatus = "active";
  const active = await request(`/public/pppoe-portal/access?ref=${encodeURIComponent(token)}`, "tenant.isplatty.org");
  assert.equal(active.status, 404);

  customerStatus = "paused";
  const wrongTenant = await request(`/public/pppoe-portal/access?ref=${encodeURIComponent(token)}`, "another.isplatty.org");
  assert.equal(wrongTenant.status, 404);
});

test("the router handoff keeps router credentials out of the customer redirect", async () => {
  customerStatus = "paused";
  const handoff = await request(
    `/public/pppoe-portal/handoff/42?token=${encodeURIComponent("router-secret")}&username=subscriber`,
    "tenant.isplatty.org",
  );
  assert.equal(handoff.status, 302);
  const location = handoff.headers.location;
  assert.match(location, /\/pppoe-login\?ref=/);
  assert.doesNotMatch(location, /router-secret|subscriber/);
});

test.after(() => {
  globalThis.fetch = realFetch;
  return new Promise(resolve => server.close(resolve));
});