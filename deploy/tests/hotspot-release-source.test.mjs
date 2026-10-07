import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// These wiring checks complement the behavioral unit tests. They deliberately
// do not import the API, load .env, execute SQL, or connect to RouterOS.
const source = (path) => readFileSync(
  fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8",
);
const api = (path) => source(`artifacts/api-server/${path}`);
const web = (path) => source(`artifacts/ochola-supernet/${path}`);

test("the first ISP admin login uses the same fixed username and temporary password that registration creates", () => {
  const registration = api("src/routes/registration-route.ts");
  const credentials = web("src/lib/initial-admin-credentials.ts");
  const login = web("src/pages/admin/AdminLogin.tsx");
  const successPage = web("src/pages/admin/AdminRegister.tsx");
  const setupPage = web("src/pages/admin/AdminSetPassword.tsx");
  const backendPassword = registration.match(/const INITIAL_ADMIN_PASSWORD = "([^"]+)"/)?.[1];
  const frontendUsername = credentials.match(/INITIAL_ADMIN_USERNAME = "([^"]+)"/)?.[1];
  const frontendPassword = credentials.match(/INITIAL_ADMIN_PASSWORD = "([^"]+)"/)?.[1];

  assert.equal(frontendUsername, "admin");
  assert.ok(frontendPassword && frontendPassword.length >= 6, "temporary password must be at least six characters");
  assert.equal(frontendPassword, backendPassword, "registration and first-login passwords must match");
  assert.ok(login.includes("firstLogin ? INITIAL_ADMIN_USERNAME : \"\""));
  assert.ok(login.includes("firstLogin ? INITIAL_ADMIN_PASSWORD : \"\""));
  assert.ok(login.includes("readOnly={firstLogin}"));
  assert.ok(successPage.includes("{INITIAL_ADMIN_PASSWORD}"));
  assert.ok(setupPage.includes("minLength={6}"));
  assert.ok(setupPage.includes("password.length < 6"));
});


test("deployments register both loyalty and voucher entitlement migrations", () => {
  const runner = api("scripts/apply-deployment-migrations.mjs");
  for (const name of [
    "2026_prepaid_transaction_account_claim.sql",
    "2026_hotspot_voucher_account_activation.sql",
    "2026_hotspot_voucher_data_entitlements.sql",
    "2026_hotspot_loyalty_points.sql",
    "2026_radacct_standard_accounting_columns.sql",
  ]) {
    assert.ok(runner.includes(`../migrations/${name}`), `Migration not registered: ${name}`);
    assert.ok(api(`migrations/${name}`).length > 0);
  }
});

test("the default release source keeps WAHA and prepaid migrations without running unrelated RouterOS setup", () => {
  const runner = api("scripts/apply-deployment-migrations.mjs");
  for (const name of [
    "2026_waha_gateway.sql",
    "2026_prepaid_checkout_idempotency.sql",
    "2026_prepaid_transaction_account_claim.sql",
  ]) {
    assert.ok(runner.includes(`../migrations/${name}`), `Migration not registered: ${name}`);
    assert.ok(api(`migrations/${name}`).length > 0);
  }

  const gatewayRoute = api("src/routes/waha-gateway-route.ts");
  const gatewayService = api("src/services/whatsapp/waha-gateway-service.ts");
  const routeIndex = api("src/routes/index.ts");
  assert.ok(gatewayRoute.includes("wahaGatewayService"));
  assert.ok(gatewayService.includes("class WAHAGatewayService"));
  assert.ok(routeIndex.includes("wahaGatewayRouter"));

  const workflow = source(".github/workflows/deploy.yml");
  assert.ok(workflow.includes(
    "DEPLOY_SKIP_ROUTER_MANAGEMENT_SETUP: ${{ github.event_name == 'push' || inputs.skip_router_management_setup }}",
  ));
  for (const name of ["WAHA_BASE_URL", "WAHA_API_KEY", "WAHA_SESSION_ID", "WAHA_DEFAULT_COUNTRY_CODE"]) {
    assert.ok(workflow.includes(name + ": ${{ secrets." + name + " }}"), `${name} secret is not mapped`);
  }
  assert.equal(source("deploy/skip-live-router-oneshots-once"), "");
});

test("the shared schema retains tenant-scoped loyalty and voucher allowances", () => {
  const schema = api("migrations/supabase_schema.sql");
  for (const table of [
    "isp_loyalty_settings", "isp_loyalty_plan_rules",
    "isp_loyalty_accounts", "isp_loyalty_ledger",
  ]) {
    assert.ok(schema.includes(`create table if not exists public.${table}`), table);
  }
  const vouchers = schema.match(/create table if not exists (?:public\.)?isp_radius_vouchers\s*\(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(vouchers, "Voucher table is missing");
  assert.match(vouchers, /data_limit_mb/);
  assert.match(vouchers, /data_cap_mode/);
  const loyalty = api("migrations/2026_hotspot_loyalty_points.sql");
  assert.match(loyalty, /primary key \(admin_id, phone\)/i);
  assert.match(loyalty, /unique \(admin_id, source_reference\)/i);
});

test("loyalty remains reachable in the API, admin UI, and customer checkout", () => {
  const routes = api("src/routes/index.ts");
  assert.match(routes, /import hotspotLoyaltyRouter from "\.\/hotspot-loyalty-route\.js"/);
  assert.match(routes, /router\.use\(hotspotLoyaltyRouter\)/);
  assert.match(web("src/App.tsx"), /path="\/admin\/plans\/loyalty" component=\{LoyaltyPoints\}/);
  const checkout = web("src/pages/portal/HotspotLogin.tsx");
  assert.ok(checkout.includes("/api/hotspot/loyalty/quote"));
  assert.ok(checkout.includes("/api/hotspot/loyalty/redeem"));
  const payments = api("src/routes/mpesa-route.ts");
  assert.ok(payments.includes('sbRpc("award_hotspot_loyalty_points_fractional"'));
  assert.ok(payments.includes("payment_method=in.(mpesa,loyalty_points)"));
});

test("voucher status and remaining allowances stay wired into listing and sync", () => {
  const listing = api("src/routes/hotspot-vouchers-route.ts");
  assert.ok(listing.includes("summarizeHotspotVoucherStatus({"));
  assert.match(listing, /\bdataLimitMb\s*[:,]/);
  assert.ok(listing.includes("dataCapMode:"));
  const sync = api("src/routes/sync-route.ts");
  assert.ok(sync.includes('from "../lib/hotspot-voucher-restore.js"'));
  assert.ok(sync.includes("calculateHotspotVoucherRestoreLimits({"));
  assert.ok(sync.includes("await restoreVoucherRadiusAccess("));
});

test("RADIUS accounting columns are migrated and verified before restart", () => {
  const runner = api("scripts/apply-deployment-migrations.mjs");
  const migration = api("migrations/2026_radacct_standard_accounting_columns.sql");
  const schema = api("migrations/supabase_schema.sql");
  const deploy = source("deploy/deploy.sh");
  for (const column of ["acctstarttime", "callingstationid", "acctinputgigawords", "acctoutputgigawords", "acctterminatecause"]) {
    assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS " + column), column);
    assert.ok(schema.includes(column), column);
  }
  assert.ok(runner.includes("2026_radacct_standard_accounting_columns.sql"));
  assert.ok(deploy.includes("/rest/v1/radacct?select="));
  const schemaGuard = deploy.indexOf("RADIUS accounting schema is not ready");
  assert.ok(schemaGuard >= 0);
  assert.ok(schemaGuard < deploy.indexOf("pm2 reload ecosystem.config.cjs"));
});
test("the deployment source check runs before migrations and API restart", () => {
  const deploy = source("deploy/deploy.sh");
  const guard = deploy.indexOf('node --test "$PROJECT_DIR/deploy/tests/hotspot-release-source.test.mjs"');
  assert.ok(guard >= 0);
  assert.ok(guard < deploy.indexOf("\napply_supabase_migration\n"));
  assert.ok(guard < deploy.indexOf("pm2 reload ecosystem.config.cjs"));
});

test("SSH transfer and deployment retain the verified VPS fingerprint", () => {
  const workflow = source(".github/workflows/deploy.yml");
  assert.equal(
    workflow.split('fingerprint: "SHA256:XlSA4l6O/lK6axMYwcViSVdoy2Z8i3DPDjJtQtQrtFc"').length - 1,
    2,
  );
});
