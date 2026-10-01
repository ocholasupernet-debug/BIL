import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [
  authController,
  setupRoute,
  smsRoute,
  whatsappRoute,
  resellerRoute,
  registrationRoute,
  supabaseClient,
  unifiedRegister,
  setPassword,
  recoveryUi,
  resellerUi,
] = await Promise.all([
  read("../src/controllers/auth-controller.ts"),
  read("../src/routes/api-auth-route.ts"),
  read("../src/routes/sms-route.ts"),
  read("../src/routes/whatsapp-route.ts"),
  read("../src/routes/reseller-route.ts"),
  read("../src/routes/registration-route.ts"),
  read("../../ochola-supernet/src/lib/supabase.ts"),
  read("../../ochola-supernet/src/pages/auth/UnifiedRegister.tsx"),
  read("../../ochola-supernet/src/pages/admin/AdminSetPassword.tsx"),
  read("../../ochola-supernet/src/pages/admin/AdminLogin.tsx"),
  read("../../ochola-supernet/src/pages/admin/ResellerWorkspace.tsx"),
]);

test("registration and first-password setup require eight characters", () => {
  assert.match(authController, /password\.length < 8/);
  assert.match(setupRoute, /password\.length < 8/);
  assert.match(unifiedRegister, /minLength=\{8\}/);
  assert.match(setPassword, /password\.length < 8/);
  assert.match(setPassword, /minLength=\{8\}/);
});

test("other administrator and account-password reset paths accept six characters", () => {
  assert.match(resellerRoute, /cleanPassword\.length < 6/);
  assert.match(smsRoute, /password\.length < 6/);
  assert.match(whatsappRoute, /password\.length < 6/);
  assert.match(recoveryUi, /minLength=\{6\}/);
  assert.match(recoveryUi, /newPassword\.length < 6/);
  assert.match(resellerUi, /Initial password[\s\S]*?minLength=\{6\}/);
});

test("new signups start with no parent tenant and unauthenticated UI queries have no tenant ID", () => {
  assert.match(registrationRoute, /role, parent_id: null, subdomain: candidate/);
  assert.match(supabaseClient, /if \(!\/\^\[1-9\]\\d\*\$\/\.test\(value\)\) return 0/);
  assert.match(supabaseClient, /export function clearAdminAuth\(\) \{\s*ADMIN_ID = 0;/);
  assert.doesNotMatch(supabaseClient, /return 5/);
});