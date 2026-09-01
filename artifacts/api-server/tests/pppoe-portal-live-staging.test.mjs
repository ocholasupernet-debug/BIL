/*
 * Opt-in live staging probe.
 *
 * Run only with a non-production tenant/API origin, a staging router handoff
 * token, a staging customer, and PPPOE_STAGING_ROUTEROS_VERSION set. The
 * default CI/local run skips this file's live case and uses no credentials.
 */
import assert from "node:assert/strict";
import test from "node:test";

const enabled = process.env.PPPOE_LIVE_STAGING === "1";
const baseUrl = String(process.env.PPPOE_STAGING_BASE_URL || "").replace(/\/+$/, "");
const tenantHost = String(process.env.PPPOE_STAGING_TENANT_HOST || "");
const routerId = String(process.env.PPPOE_STAGING_ROUTER_ID || "");
const routerToken = String(process.env.PPPOE_STAGING_ROUTER_TOKEN || "");
const username = String(process.env.PPPOE_STAGING_USERNAME || "");
const routerOsVersion = String(process.env.PPPOE_STAGING_ROUTEROS_VERSION || "");

test("a real RouterOS staging handoff reaches the tenant recovery page", {
  skip: !enabled
    ? "Set PPPOE_LIVE_STAGING=1 with non-production staging values to run the live probe."
    : false,
}, async () => {
  assert.ok(/^https:\/\//i.test(baseUrl), "staging base URL must use HTTPS");
  assert.ok(tenantHost && !/^(www|api)\./i.test(tenantHost), "staging tenant host is required");
  assert.ok(routerId && routerToken && username, "staging router/customer handoff values are required");
  assert.match(routerOsVersion, /^\d+\.\d+/, "RouterOS version must be supplied for the staging record");

  const handoffUrl = `${baseUrl}/api/public/pppoe-portal/handoff/${encodeURIComponent(routerId)}`
    + `?token=${encodeURIComponent(routerToken)}&username=${encodeURIComponent(username)}`;
  const handoff = await fetch(handoffUrl, {
    redirect: "manual",
    headers: { Host: tenantHost, "X-Forwarded-Proto": "https" },
  });
  assert.equal(handoff.status, 302);
  const location = handoff.headers.get("location") || "";
  assert.match(location, new RegExp(`^https://${tenantHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pppoe-login\\?ref=`));
  assert.doesNotMatch(location, new RegExp(routerToken));
  assert.doesNotMatch(location, /password|pppoe-password/i);

  const reference = new URL(location).searchParams.get("ref");
  assert.ok(reference, `RouterOS ${routerOsVersion} did not receive a recovery reference`);
  const access = await fetch(`${baseUrl}/api/public/pppoe-portal/access?ref=${encodeURIComponent(reference)}`, {
    headers: { Host: tenantHost, "X-Forwarded-Proto": "https" },
  });
  assert.equal(access.status, 200);
  const body = await access.json();
  assert.ok(["expired", "paused"].includes(body.customer?.status));
  assert.equal(body.customer?.password, undefined);
  assert.equal(body.customer?.routerSecret, undefined);
  assert.doesNotMatch(JSON.stringify(body), /pppoe-password|router-secret/i);
});