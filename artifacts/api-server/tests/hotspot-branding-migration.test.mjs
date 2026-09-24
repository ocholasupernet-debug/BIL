import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/2026_reseller_hotspot_branding.sql", import.meta.url), "utf8");
const runner = await readFile(new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../src/routes/hotspot-branding-route.ts", import.meta.url), "utf8");

test("branding migration is included and hostname uniqueness is case-insensitive and nullable", () => {
  assert.match(runner, /2026_reseller_hotspot_branding\.sql/);
  assert.match(migration, /create table if not exists isp_hotspot_branding/);
  assert.match(migration, /unique index if not exists isp_hotspot_branding_hostname_ci/);
  assert.match(migration, /lower\(portal_hostname\)/);
  assert.match(migration, /where portal_hostname is not null/);
});

test("public branding response is allow-listed and does not expose gateway secrets", () => {
  assert.match(route, /SAFE_SETTINGS/);
  assert.match(route, /router\.get\("\/public\/hotspot-branding"/);
  assert.match(route, /safeSettings\(row\?\.settings\)/);
  assert.doesNotMatch(route, /gateway|password|secret|credential/i);
});