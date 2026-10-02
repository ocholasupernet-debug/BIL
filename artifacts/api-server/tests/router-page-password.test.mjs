import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("router password migration remains private and backfills into generic per-page storage", async () => {
  const [legacyMigration, pageMigration, runner, schema] = await Promise.all([
    read("../migrations/2026_router_page_password.sql"),
    read("../migrations/2026_admin_page_passwords.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
  ]);

  assert.match(legacyMigration, /admin_id bigint PRIMARY KEY REFERENCES public\.isp_admins\(id\) ON DELETE CASCADE/i);
  assert.match(legacyMigration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(legacyMigration, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO service_role/i);
  assert.match(pageMigration, /feature text NOT NULL CHECK \(feature ~ '\^\[a-z0-9\.-\]\+\$'\)/i);
  assert.match(pageMigration, /PRIMARY KEY \(admin_id, feature\)/i);
  assert.match(pageMigration, /INSERT INTO public\.isp_admin_page_passwords[\s\S]*'network\.routers'[\s\S]*FROM public\.isp_admin_router_page_passwords/i);
  assert.match(runner, /2026_router_page_password\.sql[\s\S]*2026_admin_page_passwords\.sql/);
  assert.match(schema, /isp_admin_router_page_passwords/);
  assert.match(schema, /isp_admin_page_passwords/);
});

test("Routers uses its generic per-page password instead of the ISP sign-in password", async () => {
  const [authRoute, layout] = await Promise.all([
    read("../src/routes/api-auth-route.ts"),
    read("../../ochola-supernet/src/components/layout/AdminLayout.tsx"),
  ]);

  assert.match(authRoute, /const ADMIN_PAGE_PASSWORD_TABLE = "isp_admin_page_passwords"/);
  assert.match(authRoute, /const ROUTER_PAGE_AUTH_FEATURE = "network\.routers"/);
  assert.match(authRoute, /router-page-password\/status/);
  assert.match(authRoute, /router-page-password\/setup/);
  assert.match(authRoute, /Each protected page must have a different password/);
  assert.match(authRoute, /different from your ISP sign-in password/);
  assert.match(layout, /pagePasswordLabel[\s\S]*return "Routers"/);
  assert.match(layout, /currentPagePasswordLabel/);
});