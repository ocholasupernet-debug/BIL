import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("router page password storage is private, per administrator, and deployment-migrated", async () => {
  const [migration, runner, schema] = await Promise.all([
    read("../migrations/2026_router_page_password.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
  ]);

  assert.match(migration, /admin_id bigint PRIMARY KEY REFERENCES public\.isp_admins\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /password_hash text NOT NULL/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO service_role/i);
  assert.match(runner, /2026_router_page_password\.sql/);
  assert.match(schema, /isp_admin_router_page_passwords/);
});

test("router page setup and verification never use the ISP sign-in password as the gate", async () => {
  const [authRoute, layout] = await Promise.all([
    read("../src/routes/api-auth-route.ts"),
    read("../../ochola-supernet/src/components/layout/AdminLayout.tsx"),
  ]);

  assert.match(authRoute, /const ROUTER_PAGE_PASSWORD_TABLE = "isp_admin_router_page_passwords"/);
  assert.match(authRoute, /feature === ROUTER_PAGE_AUTH_FEATURE/);
  assert.match(authRoute, /Choose a Routers page password that is different from your ISP sign-in password/);
  assert.match(layout, /router-page-password\/status/);
  assert.match(layout, /router-page-password\/setup/);
  assert.match(layout, /Routers page password/);
});