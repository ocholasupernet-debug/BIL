import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const adminLoginSource = readFileSync(
  new URL("../pages/admin/AdminLogin.tsx", import.meta.url),
  "utf8",
);
const turnstileSource = readFileSync(
  new URL("../components/TurnstileCheck.tsx", import.meta.url),
  "utf8",
);

test("administrator recovery uses the shared username without asking for it again", () => {
  assert.match(adminLoginSource, /Forgot password\?/);
  assert.match(adminLoginSource, /password-recovery\/options/);
  assert.match(adminLoginSource, /password-recovery\/request-code/);
  assert.match(adminLoginSource, /password-recovery\/verify-code/);
  assert.match(adminLoginSource, /password-recovery\/reset-password/);
  assert.match(adminLoginSource, /recoveryOptions\.email\.masked/);
  assert.match(adminLoginSource, /recoveryOptions\.phone\.masked/);
  assert.match(adminLoginSource, /Confirm new password/);
  assert.match(adminLoginSource, /action="admin_password_recovery"/);
  assert.match(adminLoginSource, /username: INITIAL_ADMIN_USERNAME/);
  assert.doesNotMatch(adminLoginSource, /admin-recovery-username|recoveryUsername|Administrator username/);
  assert.match(adminLoginSource, /Username/);
  assert.doesNotMatch(adminLoginSource, /Email or username|you@yourcompany\.com|ISPLATTY <span>· ISP ADMIN/);
  assert.doesNotMatch(adminLoginSource, /Not the right portal\?|Create an account|ISP administrator access|customer-access-note/);
  assert.match(adminLoginSource, /disabled=\{isLoading \|\| companyLoading \|\| !turnstileVerified\}/);
  assert.match(adminLoginSource, /size="normal"\s+appearance="always"\s+theme="dark"/);
  assert.match(turnstileSource, /appearance = "always"/);
  assert.match(turnstileSource, /appearance,\s+theme,/);
  assert.doesNotMatch(adminLoginSource, /localStorage\.setItem\([^,]*recovery|sessionStorage/);
});
