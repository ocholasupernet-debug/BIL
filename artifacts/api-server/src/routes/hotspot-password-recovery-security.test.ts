import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./customers.ts", import.meta.url), "utf8");
const gate = source.indexOf('router.use("/customers/hotspot-password-recovery"');
const start = source.indexOf('router.post("/customers/hotspot-password-recovery/options"');
const end = source.indexOf('router.post("/customers/hotspot-login"');
const recoveryRoutes = source.slice(start, end);
const recoveryHelpers = source.slice(source.indexOf("type HotspotRecoveryCustomer"), start);

test("Hotspot recovery routes are host-scoped, username-only, rate-limited, and return masked contacts", () => {
  assert.notEqual(gate, -1);
  assert.notEqual(start, -1);
  assert.ok(gate < start);
  assert.notEqual(end, -1);
  assert.match(recoveryHelpers, /getTenantSubdomainFromRequest\(req\)/);
  assert.match(recoveryHelpers, /allowHotspotRecoveryLookup\(requestIp\)/);
  assert.match(recoveryHelpers, /allowHotspotPasswordRecoveryLookup\(requestIp\)/);
  assert.match(recoveryHelpers, /admin_id=in\.\(\$\{tenant\.customerAdminIds\.join\(","\)\}\)/);
  assert.match(recoveryHelpers, /type=eq\.hotspot/);
  assert.match(recoveryRoutes, /maskRecoveryEmail/);
  assert.match(recoveryRoutes, /maskRecoveryPhone/);
  assert.doesNotMatch(recoveryRoutes, /req\.body\??\.adminId|req\.body\.admin_id/);
});

test("member recovery API is disabled while recovery belongs to ISP administrator sign-in", () => {
  const gateSource = source.slice(gate, start);
  assert.match(gateSource, /res\.status\(404\)\.json/);
});

test("a verified reset uses the existing locked RouterOS, RADIUS, and database compensation path", () => {
  assert.match(recoveryRoutes, /withCustomerEditLock\(current\.admin_id, current\.id/);
  assert.match(recoveryRoutes, /saveCustomerEditWithRouter/);
  assert.match(recoveryRoutes, /reconcileCustomerAccess\(current, updates, current\.admin_id/);
  assert.match(recoveryRoutes, /matchesRequested:\s*row => row\.password === newPassword/);
  assert.match(recoveryRoutes, /hotspot_member_password_reset/);
  assert.match(recoveryRoutes, /errorType:\s*error instanceof Error \? error\.name/);
});
