import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("WhatsApp database migration is included in the external VPS deployment runner", async () => {
  const runner = await read("../scripts/apply-deployment-migrations.mjs");
  assert.match(runner, /2026_whatsapp_integration\.sql/);
  assert.match(runner, /2026_whatsapp_secure_credentials\.sql/);
  assert.match(runner, /2026_whatsapp_security_events\.sql/);
  assert.match(runner, /2026_gateway_settings_credentials\.sql/);
});

test("payment notices remain isolated from payment settlement failures", async () => {
  const migration = await read("../migrations/2026_whatsapp_integration.sql");
  const paymentTrigger = migration.match(/create or replace function queue_whatsapp_payment_notification\(\)([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(paymentTrigger, "payment outbox trigger should exist");
  assert.match(paymentTrigger, /phone_verified is true/i);
  assert.match(paymentTrigger, /customerNotifications/i);
  assert.match(paymentTrigger, /exception when others/i);
  assert.match(paymentTrigger, /return new/i);
  assert.match(migration, /create trigger isp_transactions_whatsapp_payment_notice/i);
});

test("subscription and renewal notices use separate verified-recipient outbox events", async () => {
  const migration = await read("../migrations/2026_whatsapp_integration.sql");
  assert.match(migration, /create trigger isp_customers_whatsapp_renewal/i);
  assert.match(migration, /create trigger platform_billing_invoices_whatsapp_notice/i);
  assert.match(migration, /'isp_subscription'/);
  assert.match(migration, /'reseller_subscription'/);
  assert.match(migration, /a\.phone_verified is true/i);
});

test("webhook raw bytes are captured before JSON body parsing", async () => {
  const app = await read("../src/app.ts");
  const rawParser = app.indexOf('express.raw({ type: "application/json"');
  const jsonParser = app.indexOf("express.json(");
  assert.notEqual(rawParser, -1);
  assert.notEqual(jsonParser, -1);
  assert.ok(rawParser < jsonParser, "raw parser must precede the global JSON parser");
});

test("optional public auth config fails closed without breaking existing login screens", async () => {
  const route = await read("../src/routes/whatsapp-route.ts");
  const publicConfig = route.match(/router\.get\("\/whatsapp\/public-config"([\s\S]*?)\n\}\);/i)?.[1];
  assert.ok(publicConfig, "public WhatsApp configuration endpoint should exist");
  assert.match(publicConfig, /catch\s*\(error\)/);
  assert.match(publicConfig, /loginEnabled:\s*false/);
  assert.match(publicConfig, /registrationVerificationEnabled:\s*false/);
  assert.match(publicConfig, /passwordRecoveryEnabled:\s*false/);
});

test("payment gateway reads and changes require an access grant bound to the active session", async () => {
  const migration = await read("../migrations/2026_whatsapp_secure_credentials.sql");
  const settingsRoute = await read("../src/routes/settings-route.ts");
  const resellerRoute = await read("../src/routes/reseller-route.ts");
  const whatsappRoute = await read("../src/routes/whatsapp-route.ts");
  const mpesaRoute = await read("../src/routes/mpesa-route.ts");
  const settingsPage = await read("../../ochola-supernet/src/pages/admin/AdminSettings.tsx");
  assert.match(migration, /whatsapp_gateway_settings_grants/i);
  assert.match(migration, /session_binding_hash/i);
  assert.match(migration, /auth_request_id/i);
  assert.match(settingsRoute, /hasGatewaySettingsGrant/);
  assert.match(resellerRoute, /hasGatewaySettingsGrant/);
  assert.match(mpesaRoute, /hasGatewaySettingsGrant/);
  assert.match(whatsappRoute, /gateway-settings\/request-otp/);
  assert.match(whatsappRoute, /gateway-settings\/verify-otp/);
  assert.match(whatsappRoute, /gateway-settings\/verify-password/);
  assert.match(settingsPage, /gatewayOtp\.headers\(\)/);
});

test("gateway OTP enrolls a separate account payment number without changing the contact phone", async () => {
  const route = await read("../src/routes/whatsapp-route.ts");
  const service = await read("../src/services/whatsapp/whatsapp-gateway-settings-otp.ts");
  const migration = await read("../migrations/2026_gateway_settings_credentials.sql");
  const actor = route.match(/async function gatewaySettingsActor\([\s\S]*?\n\}/)?.[0];
  const request = route.match(/router\.post\(\s*"\/auth\/whatsapp\/gateway-settings\/request-otp"[\s\S]*?\n\);/)?.[0];
  assert.ok(actor, "payment settings actor should validate the signed-in account");
  assert.match(actor, /account\.is_active !== true/);
  assert.match(actor, /auth\.impersonationSessionId/);
  assert.match(actor, /gateway_settings_otp_phone_e164/);
  assert.doesNotMatch(actor, /select=id,is_active,phone_e164/);
  assert.ok(request, "gateway OTP request route should exist");
  assert.match(request, /actor\.otpPhone\s*\?\?\s*requestedPhone/);
  assert.match(request, /req\.body\??\.phone/);

  const verify = service.match(/export async function verifyWhatsAppGatewaySettingsOtp\([\s\S]*?(?=\nexport async function createGatewaySettingsGrant)/)?.[0];
  assert.ok(verify, "gateway OTP verification should exist");
  const rpcIndex = verify.indexOf('sbRpc<GatewayOtpVerifyRow>("verify_whatsapp_gateway_settings_otp"');
  const verifiedOutcomeIndex = verify.indexOf('verified[0]?.outcome !== "verified"');
  const phoneCheckIndex = verify.indexOf("challengePhone !== input.expectedPhone");
  const accountUpdateIndex = verify.indexOf("gateway_settings_otp_phone_e164");
  const grantIssueIndex = verify.indexOf("createGatewaySettingsGrant(input)");
  assert.ok(rpcIndex >= 0 && rpcIndex < verifiedOutcomeIndex);
  assert.ok(verifiedOutcomeIndex < phoneCheckIndex && phoneCheckIndex < accountUpdateIndex);
  assert.ok(accountUpdateIndex < grantIssueIndex, "grant is issued only after OTP verification and separate-number enrollment");
  assert.doesNotMatch(verify, /phone_verified:\s*true/);
  assert.doesNotMatch(verify, /phone_verified_at:/);
  assert.match(migration, /gateway_settings_otp_phone_e164 text/);
  assert.match(migration, /gateway_settings_password_hash text/);
});

test("password mode sets up payment credentials and reserves resets for Super Admin", async () => {
  const route = await read("../src/routes/whatsapp-route.ts");
  const resetRoute = await read("../src/routes/super-admin-account-access-route.ts");
  const securityPage = await read("../../ochola-supernet/src/pages/super-admin/AuthSecurity.tsx");
  const accountAccessPage = await read("../../ochola-supernet/src/pages/super-admin/Impersonate.tsx");
  assert.match(route, /isOtpChannelEnabled\("whatsapp"\)\s*\?\s*"whatsapp"\s*:\s*"password"/);
  assert.match(route, /gateway-settings\/set-password/);
  assert.match(route, /verifyIspAdminPassword\(actor\.passwordHash,\s*password\)/);
  assert.match(route, /gateway_settings_password_hash=is\.null/);
  assert.match(route, /GATEWAY_PASSWORD_ATTEMPT_LIMIT/);
  assert.match(resetRoute, /activeSuperAdminName/);
  assert.match(resetRoute, /reset-payment-settings-credentials/);
  assert.match(resetRoute, /gateway_settings_password_hash:\s*null/);
  assert.match(resetRoute, /gateway_settings_otp_phone_e164:\s*null/);
  assert.match(resetRoute, /revoked_at:\s*auditTime/);
  assert.match(accountAccessPage, /Reset payment access/);
  assert.match(securityPage, /body:\s*JSON\.stringify\(\{\s*policy\s*\}\)/);
  assert.match(securityPage, /disabling WhatsApp switches accounts to a separate payment-settings password/i);
});

test("reseller workspace receives configured route summaries without a settings grant", async () => {
  const route = await read("../src/routes/reseller-route.ts");
  const workspace = await read("../../ochola-supernet/src/pages/admin/ResellerWorkspace.tsx");
  const me = route.match(/router\.get\("\/reseller\/me"[\s\S]*?\n\}\);/)?.[0];
  const settings = route.match(/router\.get\("\/reseller\/payment-gateways"[\s\S]*?\n\}\);/)?.[0];
  assert.ok(me, "authenticated reseller projection should exist");
  assert.match(me, /paymentGatewayRoutes/);
  assert.match(me, /destinationConfigured\s*=\s*resellerGatewayConfigComplete/);
  assert.match(me, /destinationPreview/);
  assert.match(me, /destinationFields\s*=\s*\[/);
  assert.match(me, /gateways:\s*gateways\.map\(\(\{\s*id,\s*gateway_type,\s*router_id,\s*port_id,\s*is_active,\s*created_at,\s*updated_at\s*\}\)/);
  assert.doesNotMatch(me, /hasWhatsAppGatewaySettingsGrant/);
  const routeSummary = me.match(/return \{\s*id: route\.id,[\s\S]*?destinationPreview,\s*\};/)?.[0] ?? "";
  assert.ok(routeSummary, "the unaudited projection should return read-only route metadata");
  assert.doesNotMatch(routeSummary, /config_ciphertext|config_preview|config:/);
  const publicLegacyRoutes = me.match(/gateways:\s*gateways\.map\([\s\S]*?\n\s*\}\)\),/)?.[0] ?? "";
  assert.doesNotMatch(publicLegacyRoutes, /config_ciphertext|config_preview/);
  assert.match(workspace, /dashboard\.paymentGatewayRoutes/);
  assert.doesNotMatch(workspace, /apiJson<\{ ok: boolean; routes: ResellerGatewayRoute\[\] \}>\("\/api\/reseller\/payment-gateways"\)/);
  assert.ok(settings, "payment settings endpoint should remain available");
  assert.match(settings, /requireResellerGatewaySettingsGrant/);
  assert.match(settings, /config_ciphertext/);
});

test("corrupt reseller gateway configuration is reported unavailable without failing the dashboard", async () => {
  const route = await read("../src/routes/reseller-route.ts");
  const workspace = await read("../../ochola-supernet/src/pages/admin/ResellerWorkspace.tsx");
  const me = route.match(/router\.get\("\/reseller\/me"[\s\S]*?\n\}\);/)?.[0];
  const summary = me?.match(/const paymentGatewayRoutes = gateways\.map\([\s\S]*?(?=\n\s*const now = Date\.now\(\))/)?.[0] ?? "";
  assert.ok(summary, "reseller route summaries should be mapped independently");
  assert.match(summary, /try \{\s*const config = route\.config_ciphertext \? decryptGatewayConfig/);
  assert.match(summary, /catch \{\s*\/\/ A broken legacy route must not take down the reseller dashboard/);
  assert.match(summary, /destinationConfigured = null/);
  assert.match(summary, /destinationStatus = "unavailable"/);
  assert.doesNotMatch(summary, /catch\s*\(\s*(?:error|err)\s*\)|error\.message|config_ciphertext\s*[:,]/);
  assert.match(workspace, /destinationStatus === "unavailable"[\s\S]*?"unavailable"/);
});

test("welcome, account-status and password-change notices use verified accounts without passwords", async () => {
  const migration = await read("../migrations/2026_whatsapp_security_events.sql");
  const service = await read("../src/services/whatsapp/whatsapp-service.ts");
  const welcome = migration.match(/create or replace function enqueue_whatsapp_isp_welcome\(\)([\s\S]*?)\$\$;/i)?.[1];
  const lifecycle = migration.match(/create or replace function enqueue_whatsapp_customer_lifecycle\(\)([\s\S]*?)\$\$;/i)?.[1];
  const adminPasswordNotice = migration.match(/create or replace function enqueue_whatsapp_admin_password_change\(\)([\s\S]*?)\$\$;/i)?.[1];
  const customerPasswordNotice = migration.match(/create or replace function enqueue_whatsapp_customer_password_change\(\)([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(welcome, "account welcome producer should exist");
  assert.ok(lifecycle, "customer lifecycle producer should exist");
  assert.ok(adminPasswordNotice, "admin password-change producer should exist");
  assert.ok(customerPasswordNotice, "customer password-change producer should exist");
  assert.match(welcome, /phone_verified/i);
  assert.match(welcome, /ispNotifications/i);
  assert.match(welcome, /resellerNotifications/i);
  assert.match(welcome, /must_change_password/i);
  assert.match(lifecycle, /customerNotifications/i);
  assert.match(lifecycle, /account_reactivated/i);
  for (const producer of [adminPasswordNotice, customerPasswordNotice]) {
    assert.match(producer, /securityNotifications/i);
    assert.match(producer, /phone_verified/i);
    assert.match(producer, /jsonb_build_object\('changed_at', now\(\)\)/i);
    assert.doesNotMatch(producer, /jsonb_build_object\([^)]*password/i);
  }
  assert.match(service, /settings\.templates\.welcome/);
  assert.match(service, /settings\.templates\.accountStatus/);
  assert.match(service, /settings\.templates\.security/);
  assert.match(service, /createWhatsAppWelcomeSetupUrl/);
});

test("suspicious sign-in alerts use a verified-account threshold, cooldown, and bounded request context", async () => {
  const migration = await read("../migrations/2026_whatsapp_security_events.sql");
  const route = await read("../src/routes/api-auth-route.ts");
  const service = await read("../src/services/whatsapp/whatsapp-service.ts");
  const settingsPage = await read("../../ochola-supernet/src/pages/super-admin/WhatsApp.tsx");
  const attemptsTable = migration.match(/create table if not exists whatsapp_login_attempts \(([\s\S]*?)\n\);/i)?.[1];
  const recorder = migration.match(/create or replace function record_whatsapp_login_failure\([\s\S]*?\n\$\$;/i)?.[0];
  assert.ok(attemptsTable, "recent failed sign-in table should exist");
  assert.ok(recorder, "atomic sign-in threshold and queue function should exist");
  assert.match(attemptsTable, /attempted_at/i);
  assert.match(attemptsTable, /ip_address/i);
  assert.match(attemptsTable, /user_agent/i);
  assert.doesNotMatch(attemptsTable, /password|otp|credential|token/i);
  assert.match(recorder, /securityNotifications/i);
  assert.match(recorder, /phone_verified is distinct from true/i);
  assert.match(recorder, /v_attempt_count < 5/i);
  assert.match(recorder, /interval '15 minutes'/i);
  assert.match(recorder, /interval '1 hour'/i);
  assert.match(recorder, /suspicious_sign_in/i);
  assert.match(recorder, /on conflict \(dedupe_key\) do nothing/i);
  assert.doesNotMatch(recorder, /password|otp|credential|token/i);
  assert.match(route, /recordFailedAccountSignIn\(req, "admin"/);
  assert.match(route, /recordFailedAccountSignIn\(req, "customer"/);
  assert.match(service, /"password_changed", "suspicious_sign_in"/);
  assert.match(service, /settings\.templates\.suspiciousSignIn/);
  assert.match(service, /WHATSAPP_SUSPICIOUS_SIGN_IN_TEMPLATE/);
  assert.match(settingsPage, /suspiciousSignIn/);
  assert.match(settingsPage, /name, time, IP, device/i);
});

test("failed webhooks are retryable, completed events remain deduplicated, and failures return 500", async () => {
  const migration = await read("../migrations/2026_whatsapp_security_events.sql");
  const route = await read("../src/routes/whatsapp-route.ts");
  const claim = migration.match(/create function claim_whatsapp_webhook_event\([\s\S]*?\$\$;/i)?.[0];
  assert.ok(claim, "webhook claim function should exist");
  assert.match(claim, /processing_status = 'failed'[\s\S]*?attempts < 5/i);
  assert.match(claim, /processing_status = 'processing'[\s\S]*?interval '5 minutes'/i);
  assert.match(migration, /processing_status = 'processed'/i);
  assert.match(route, /claimWhatsAppWebhookEvent/);
  assert.match(route, /claim\.processingStatus === "processing"/);
  assert.match(route, /completeWhatsAppWebhookEvent/);
  assert.match(route, /failWhatsAppWebhookEvent/);
  assert.match(route, /res\.sendStatus\(500\)/);
});