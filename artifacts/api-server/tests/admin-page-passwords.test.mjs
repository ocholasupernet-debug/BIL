import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("page-password storage is private, per administrator and feature, and preserves router credentials", async () => {
  const [migration, legacyMigration, runner, schema] = await Promise.all([
    read("../migrations/2026_admin_page_passwords.sql"),
    read("../migrations/2026_router_page_password.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
  ]);

  assert.match(migration, /PRIMARY KEY \(admin_id, feature\)/i);
  assert.match(migration, /password_hash text NOT NULL/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO service_role/i);
  assert.match(migration, /SELECT admin_id, 'network\.routers', password_hash/i);
  assert.match(migration, /FROM public\.isp_admin_router_page_passwords/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.match(legacyMigration, /isp_admin_router_page_passwords/);
  assert.match(runner, /2026_admin_page_passwords\.sql/);
  assert.match(schema, /isp_admin_page_passwords/);
});

test("every password-gated page uses its own password and rejects old login-password grants", async () => {
  const [authRoute, otpRoute, apiAuth, layout] = await Promise.all([
    read("../src/routes/api-auth-route.ts"),
    read("../src/routes/platform-page-auth-route.ts"),
    read("../src/lib/api-auth.ts"),
    read("../../ochola-supernet/src/components/layout/AdminLayout.tsx"),
  ]);
  const reauthHandler = authRoute.slice(
    authRoute.indexOf('router.post("/auth/admin/reauth"'),
    authRoute.indexOf("async function getPagePasswordStatus"),
  );

  assert.match(authRoute, /const ADMIN_PAGE_PASSWORD_TABLE = "isp_admin_page_passwords"/);
  assert.match(reauthHandler, /feature=eq\.\$\{encodeURIComponent\(feature\)\}/);
  assert.doesNotMatch(reauthHandler, /verifyIspAdminPassword\(admin\.password,\s*password\)/);
  assert.match(authRoute, /Choose a page password that is different from your ISP sign-in password/);
  assert.match(authRoute, /Each protected page must have a different password/);
  assert.match(layout, /page-password\/status\?feature=/);
  assert.match(layout, /page-password\/setup/);
  assert.match(layout, /Enter your \$\{currentPagePasswordLabel\} page password/);
  assert.match(layout, /_page-password-v1/);
  assert.match(apiAuth, /proof\.credentialVersion === PAGE_PASSWORD_CREDENTIAL_VERSION/);
  assert.match(apiAuth, /parsed\.method === "password" && parsed\.credentialVersion !== PAGE_PASSWORD_CREDENTIAL_VERSION/);
  assert.match(authRoute, /existing\.method !== "password" \|\| existing\.credentialVersion === 1/);
  assert.match(otpRoute, /existing\.method !== "password" \|\| existing\.credentialVersion === 1/);
});