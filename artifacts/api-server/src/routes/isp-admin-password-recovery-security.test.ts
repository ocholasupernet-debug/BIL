import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const authRoute = readFileSync(new URL("./api-auth-route.ts", import.meta.url), "utf8");

test("ISP admin recovery endpoints are scoped to a tenant username and verified reset token", () => {
  assert.match(authRoute, /\/auth\/admin\/password-recovery\/options/);
  assert.match(authRoute, /\/auth\/admin\/password-recovery\/request-code/);
  assert.match(authRoute, /\/auth\/admin\/password-recovery\/verify-code/);
  assert.match(authRoute, /\/auth\/admin\/password-recovery\/reset-password/);
  assert.match(authRoute, /username=eq\.\$\{encodeURIComponent\(username\.trim\(\)\)\}/);
  assert.match(authRoute, /or=\(id\.eq\.\$\{tenantAdminId\},parent_id\.eq\.\$\{tenantAdminId\}\)/);
  assert.match(authRoute, /consumeIspAdminPasswordRecoveryToken/);
  assert.match(authRoute, /auth_version:\s*nextVersion/);
});

test("tenant administrator login no longer accepts an email as a username alias", () => {
  assert.match(authRoute, /username and password are required/);
  assert.match(authRoute, /username=eq\.\$\{encodeURIComponent\(identity\)\}/);
  assert.doesNotMatch(authRoute, /or=\(username\.eq\.\$\{encodeURIComponent\(identity\)\},email\.eq\./);
});
