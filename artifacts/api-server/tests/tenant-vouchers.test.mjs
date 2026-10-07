import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relativePath => readFile(new URL(relativePath, import.meta.url), "utf8");

test("hotspot voucher management is authenticated and account-scoped", async () => {
  const route = await read("../src/routes/hotspot-vouchers-route.ts");

  for (const [method, path] of [
    ["get", "/vouchers/hotspot/config"],
    ["get", "/vouchers/hotspot"],
    ["post", "/vouchers/hotspot/generate"],
    ["post", "/vouchers/hotspot/delete"],
    ["delete", "/vouchers/hotspot/:code"],
  ]) {
    assert.match(
      route,
      new RegExp(`router\\.${method}\\("${path.replaceAll("/", "\\/")}", requireAdmin\\(\\)`),
      `${method.toUpperCase()} ${path} must require an administrator session`,
    );
  }

  assert.match(route, /authenticatedAdminId\(req/);
  assert.match(route, /admin_id=eq\.\$\{adminId\}/);
  assert.match(route, /admin_id=eq\.\$\{adminId\}&\$\{inFilter\("code", ownedCodes\)\}/);
});

test("redeemed hotspot vouchers show their use and are protected from destructive actions", async () => {
  const [route, page] = await Promise.all([
    read("../src/routes/hotspot-vouchers-route.ts"),
    read("../../ochola-supernet/src/pages/admin/Vouchers.tsx"),
  ]);

  assert.match(route, /RedeemedVoucherMutationError/);
  assert.match(route, /"radacct"/);
  assert.match(route, /serviceStatus/);
  assert.match(page, /service_status/);
  assert.match(page, /redeemed_by/);
  assert.match(page, /v\.online \? "Online" : "Offline"/);
  assert.match(page, /disabled=\{v\.used \|\| deleteMutation\.isPending\}/);
  assert.match(page, /selectedDeletableCodes/);
});

test("hotspot voucher data allowances are snapshotted and honor throttle mode", async () => {
  const [route, migration, runner, schema] = await Promise.all([
    read("../src/routes/hotspot-vouchers-route.ts"),
    read("../migrations/2026_hotspot_voucher_data_entitlements.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
  ]);

  assert.match(route, /data_limit_mb: dataLimitMb/);
  assert.match(route, /data_cap_mode: dataCapMode/);
  assert.match(route, /dataCapMode === "disconnect"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS data_limit_mb/);
  assert.match(migration, /CHECK \(data_cap_mode IN \('disconnect', 'throttle'\)\)/);
  assert.match(runner, /2026_hotspot_voucher_data_entitlements\.sql/);
  assert.match(schema, /data_limit_mb\s+numeric\(14,2\)/);
});

test("hotspot voucher list failures are logged and visible with a retry action", async () => {
  const [route, page] = await Promise.all([
    read("../src/routes/hotspot-vouchers-route.ts"),
    read("../../ochola-supernet/src/pages/admin/Vouchers.tsx"),
  ]);

  assert.match(route, /catch \(err\)/);
  assert.match(route, /logger\.error\(\{ err, adminId \}, "\[hotspot-vouchers\] list request failed"\)/);
  assert.match(page, /voucherListFailed/);
  assert.match(page, /Voucher list could not be loaded/);
  assert.match(page, /void refetch\(\)/);
});

test("RADIUS columns used by voucher queries are migrated and checked before deployment", async () => {
  const [route, restoreRoute, migration, runner, schema, deploy] = await Promise.all([
    read("../src/routes/hotspot-vouchers-route.ts"),
    read("../src/routes/sync-route.ts"),
    read("../migrations/2026_radacct_standard_accounting_columns.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
    read("../../../deploy/deploy.sh"),
  ]);

  for (const column of [
    "acctstarttime",
    "callingstationid",
    "acctinputgigawords",
    "acctoutputgigawords",
    "acctterminatecause",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(schema, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /ALTER TABLE IF EXISTS public\.radacct/);
  assert.match(runner, /2026_radacct_standard_accounting_columns\.sql/);
  assert.match(route, /select=username,acctstarttime,acctstoptime,callingstationid/);
  assert.match(restoreRoute, /select=acctstarttime,acctstoptime,callingstationid/);
  assert.match(deploy, /rest\/v1\/radacct\?select=.*acctstarttime.*acctterminatecause/);
  assert.ok(
    deploy.indexOf("RADIUS accounting schema is not ready")
      < deploy.indexOf("pm2 reload ecosystem.config.cjs"),
    "the release must reject an unverified RADIUS schema before restarting the API",
  );
});
test("the vouchers screen no longer queries shared RADIUS tables from the browser", async () => {
  const page = await read("../../ochola-supernet/src/pages/admin/Vouchers.tsx");
  assert.doesNotMatch(page, /supabase\.from\("(radcheck|radusergroup|radacct)"\)/);
  assert.match(page, /\/api\/vouchers\/hotspot/);
  assert.match(page, /adminApiHeaders/);
});

test("hotspot bindings use authenticated, account-scoped APIs instead of direct RADIUS access", async () => {
  const [route, page, migration, runner, schema] = await Promise.all([
    read("../src/routes/hotspot-bindings-route.ts"),
    read("../../ochola-supernet/src/pages/admin/HotspotBinding.tsx"),
    read("../migrations/2026_account_scoped_hotspot_bindings.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
    read("../migrations/supabase_schema.sql"),
  ]);

  for (const [method, path] of [
    ["get", "/hotspot-bindings"],
    ["get", "/hotspot-bindings/sessions"],
    ["post", "/hotspot-bindings/user"],
    ["post", "/hotspot-bindings/bypass"],
    ["delete", "/hotspot-bindings"],
  ]) {
    assert.match(
      route,
      new RegExp(`router\\.${method}\\("${path.replaceAll("/", "\\/")}", requireAdmin\\(\\)`),
      `${method.toUpperCase()} ${path} must require an administrator session`,
    );
  }

  assert.doesNotMatch(page, /supabase\.from\("(radcheck|radacct|isp_customers|isp_routers)"\)/);
  assert.match(page, /\/api\/hotspot-bindings/);
  assert.match(route, /admin_id=eq\.\$\{adminId\}/);
  assert.match(route, /admin_id=neq\.\$\{adminId\}/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.isp_hotspot_mac_bypasses/);
  assert.match(migration, /admin_id bigint NOT NULL REFERENCES public\.isp_admins/);
  assert.match(migration, /ON CONFLICT \(username\) DO NOTHING/);
  assert.match(runner, /2026_account_scoped_hotspot_bindings\.sql/);
  assert.match(schema, /create table if not exists isp_hotspot_mac_bypasses/);
});

test("legacy voucher management endpoints also enforce account ownership", async () => {
  const route = await read("../src/routes/vouchers.ts");
  assert.match(route, /router\.get\("\/vouchers", requireAdmin\(\)/);
  assert.match(route, /router\.post\("\/vouchers\/generate", requireAdmin\(\)/);
  assert.match(route, /router\.patch\("\/vouchers\/:id", requireAdmin\(\)/);
  assert.match(route, /router\.delete\("\/vouchers\/:id", requireAdmin\(\)/);
  assert.match(route, /id=eq\.\$\{id\}&admin_id=eq\.\$\{adminId\}/);
  assert.match(route, /admin_id=eq\.\$\{scopedAdminId\}&code=eq\./);
});

test("tenant ownership storage is private and included in the deployment migration runner", async () => {
  const [migration, runner] = await Promise.all([
    read("../migrations/2026_account_scoped_hotspot_vouchers.sql"),
    read("../scripts/apply-deployment-migrations.mjs"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.isp_radius_vouchers/);
  assert.match(migration, /admin_id bigint NOT NULL REFERENCES public\.isp_admins/);
  assert.match(migration, /code text NOT NULL UNIQUE/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.isp_radius_vouchers FROM anon, authenticated/);
  assert.match(migration, /ON CONFLICT \(code\) DO NOTHING/);
  assert.match(runner, /2026_account_scoped_hotspot_vouchers\.sql/);
});