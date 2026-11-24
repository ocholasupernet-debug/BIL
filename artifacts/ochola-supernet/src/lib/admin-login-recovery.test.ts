import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const adminLoginSource = readFileSync(
  new URL("../pages/admin/AdminLogin.tsx", import.meta.url),
  "utf8",
);

test("administrator recovery is on the ISP admin login and uses username plus masked contacts", () => {
  assert.match(adminLoginSource, /Forgot password\?/);
  assert.match(adminLoginSource, /password-recovery\/options/);
  assert.match(adminLoginSource, /password-recovery\/request-code/);
  assert.match(adminLoginSource, /password-recovery\/verify-code/);
  assert.match(adminLoginSource, /password-recovery\/reset-password/);
  assert.match(adminLoginSource, /recoveryOptions\.email\.masked/);
  assert.match(adminLoginSource, /recoveryOptions\.phone\.masked/);
  assert.match(adminLoginSource, /Confirm new password/);
  assert.match(adminLoginSource, /action="admin_password_recovery"/);
  assert.match(adminLoginSource, /Username/);
  assert.doesNotMatch(adminLoginSource, /Email or username|you@yourcompany\.com|ISPLATTY <span>· ISP ADMIN/);
  assert.doesNotMatch(adminLoginSource, /localStorage\.setItem\([^,]*recovery|sessionStorage/);
});
