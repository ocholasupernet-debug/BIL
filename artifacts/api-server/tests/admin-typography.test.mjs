import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_admin_typography.sql", "utf8");
const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");
const route = await readFile("src/routes/typography-route.ts", "utf8");
const dashboardRoute = await readFile("src/routes/dashboard-preferences-route.ts", "utf8");
const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
const dashboardMigration = await readFile("migrations/2026_dashboard_amount_visibility.sql", "utf8");
const portal = await readFile("../ochola-supernet/public/hotspot/login.html", "utf8");
const portalPage = await readFile("../ochola-supernet/src/pages/portal/HotspotLogin.tsx", "utf8");

test("typography migration is deployable and bounded", () => {
  assert.match(migration, /add column if not exists font_family/);
  assert.match(migration, /add column if not exists font_style/);
  assert.match(migration, /add column if not exists font_weight/);
  assert.match(migration, /add column if not exists font_size/);
  assert.match(migration, /check \(font_size between 12 and 24\)/);
  assert.match(runner, /2026_admin_typography\.sql/);
});

test("typography API exposes only curated values and protects writes", () => {
  assert.match(route, /router\.get\("\/public\/typography"/);
  assert.match(route, /router\.get\("\/admin\/typography", requireAdmin\(\)/);
  assert.match(route, /router\.put\("\/admin\/typography", requireAdmin\(\)/);
  assert.match(route, /FONT_FAMILIES/);
  assert.match(route, /FONT_STYLES/);
  assert.match(route, /FONT_WEIGHTS/);
  assert.match(route, /fontSize < 12 \|\| fontSize > 24/);
  assert.match(route, /readPortalAccent/);
  assert.match(route, /accentColor/);
  assert.doesNotMatch(route, /return `http:\/\/localhost/);
});

test("dashboard colors stay scoped to the authenticated ISP account", () => {
  assert.match(dashboardRoute, /router\.get\("\/admin\/dashboard-preferences", requireAdmin\(\)/);
  assert.match(dashboardRoute, /router\.put\("\/admin\/dashboard-preferences", requireAdmin\(\)/);
  assert.match(dashboardRoute, /const id = Number\(req\.authUser\?\.uid\)/);
  assert.match(dashboardRoute, /admin_id=eq\.\$\{id\}/);
  assert.match(dashboardRoute, /admin_id: adminId\(req\)/);
  assert.match(scriptsRoute, /typography\?adminId=\$\{adminId\}/);
});

test("dashboard financial visibility is persisted per ISP", () => {
  assert.match(dashboardMigration, /add column if not exists hide_amounts boolean not null default false/i);
  assert.match(dashboardRoute, /hide_amounts/);
  assert.match(dashboardRoute, /hideAmounts/);
  assert.match(dashboardRoute, /typeof hideAmounts !== "boolean"/);
  assert.match(dashboardRoute, /hide_amounts: hideAmounts/);
});

test("router portal gets the RouterOS MAC and synchronized typography asset", () => {
  assert.match(portal, /var ROUTER_MAC="\$\(mac\)"/);
  assert.match(portal, /var DEVICE_MAC=normaliseMac\(ROUTER_MAC\)/);
  assert.match(portal, /mac_address:DEVICE_MAC/);
  assert.match(portal, /fetch\("typography\.json"/);
  assert.match(portal, /applyPortalTypography/);
  assert.match(portal, /data\.accentColor/);
  assert.match(portal, /var\(--portal-accent/);
});

test("React portal does not fall back to manual MAC collection", () => {
  assert.doesNotMatch(portalPage, /id="device-mac-address"/);
  assert.match(portalPage, /disabled=\{payLoading \|\| !deviceMacAddress\}/);
  assert.match(portalPage, /mac_address: macAddress/);
});