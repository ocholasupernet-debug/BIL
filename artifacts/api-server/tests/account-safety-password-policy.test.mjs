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
  accountAccessRoute,
  adminLayout,
  superAdminAdminsRoute,
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
  read("../src/routes/super-admin-account-access-route.ts"),
  read("../../ochola-supernet/src/components/layout/AdminLayout.tsx"),
  read("../src/routes/super-admin-admins-route.ts"),
]);

test("account password setup and registration allow a six-character minimum", () => {
  assert.match(authController, /password\.length < 6/);
  assert.match(setupRoute, /password\.length < 6/);
  assert.match(unifiedRegister, /minLength=\{6\}/);
  assert.match(setPassword, /password\.length < 6/);
  assert.match(setPassword, /minLength=\{6\}/);
  assert.match(adminLayout, /newPassword\.length < 6/);
  assert.match(adminLayout, /noValidate/);
  assert.match(superAdminAdminsRoute, /password\.length < 6/);
});

test("payment settings password is separate and only Super Admin can reset its credentials", () => {
  assert.match(whatsappRoute, /password\.length < 10/);
  assert.match(whatsappRoute, /password !== confirmPassword/);
  assert.match(whatsappRoute, /A payment settings password is already set\./);
  assert.match(whatsappRoute, /if \(purpose === "recovery"\)[\s\S]*Password recovery is not available here\./);
  assert.match(accountAccessRoute, /reset-payment-settings-credentials/);
  assert.match(accountAccessRoute, /activeSuperAdminName/);
  assert.match(accountAccessRoute, /gateway_settings_password_hash:\s*null/);
});

test("new signups start with no parent tenant and unauthenticated UI queries have no tenant ID", () => {
  assert.match(registrationRoute, /role, parent_id: null, subdomain: candidate/);
  assert.match(supabaseClient, /if \(!\/\^\[1-9\]\\d\*\$\/\.test\(value\)\) return 0/);
  assert.match(supabaseClient, /export function clearAdminAuth\(\) \{\s*ADMIN_ID = 0;/);
  assert.doesNotMatch(supabaseClient, /return 5/);
});