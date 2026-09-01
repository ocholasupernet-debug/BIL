import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_admin_settings_persistence.sql", "utf8");
const route = await readFile("src/routes/admin-settings-route.ts", "utf8");
const templates = await readFile("src/lib/message-templates.ts", "utf8");
const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");

test("admin settings migration creates durable and service-role-only storage", () => {
  for (const table of ["isp_message_templates", "platform_role_permissions", "platform_backup_jobs"]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
    assert.match(migration, new RegExp(`revoke all on table ${table}`));
  }
  assert.match(migration, /unique \(admin_id, template_key\)/);
  assert.match(migration, /artifact_sha256/);
});

test("deployment migration runner includes admin settings storage", () => {
  assert.match(runner, /2026_admin_settings_persistence\.sql/);
});

test("settings API keeps tenant templates and platform controls separate", () => {
  assert.match(route, /router\.get\("\/admin\/message-templates", requireAdmin\(\), requireTenantPermission\("View Settings"\)/);
  assert.match(route, /router\.put\("\/admin\/message-templates\/:templateKey", requireAdmin\(\), requireTenantPermission\("Edit Settings"\)/);
  assert.match(route, /router\.get\("\/super-admin\/roles"/);
  assert.match(route, /router\.get\("\/super-admin\/backups"/);
  assert.match(route, /integrity verification/);
});

test("delivery lookup has an enabled-template fallback and variable rendering", () => {
  assert.match(templates, /getMessageTemplate/);
  assert.match(templates, /renderMessageTemplate/);
  assert.match(templates, /\[\[name\]\]/);
});