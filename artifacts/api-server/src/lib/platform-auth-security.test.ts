import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  getAdminApiReauthFeature,
  normalizePlatformAuthPolicy,
  validatePlatformAuthPolicy,
} from "./platform-auth-security.js";

test("legacy boolean page policy remains a password-or-none policy", () => {
  const policy = normalizePlatformAuthPolicy({
    otp_all_enabled: true,
    otp_whatsapp_enabled: true,
    otp_sms_enabled: false,
    otp_email_enabled: true,
    password_reauth: {
      isp_admin: { "network.routers": true },
      reseller: { "network.routers": false },
    },
  });

  assert.equal(policy.pageMethods.isp_admin["network.routers"], "password");
  assert.equal(policy.pageMethods.reseller["network.routers"], "none");
  assert.equal(policy.otp.channels.email, true);
});

test("page policy accepts one method per role and page, including email OTP", () => {
  const policy = validatePlatformAuthPolicy({
    otp: {
      allEnabled: true,
      channels: { whatsapp: true, sms: true, email: true },
    },
    pageMethods: {
      isp_admin: { "network.routers": "whatsapp", "billing.transactions": "password" },
      reseller: { "network.routers": "email", "billing.transactions": "none" },
    },
  });

  assert.ok(policy);
  assert.equal(policy.pageMethods.isp_admin["network.routers"], "whatsapp");
  assert.equal(policy.pageMethods.reseller["network.routers"], "email");
  assert.equal(policy.pageMethods.reseller["billing.transactions"], "none");
});

test("settings tabs receive independent policies while legacy Settings policy is preserved", () => {
  const legacy = normalizePlatformAuthPolicy({
    otp_all_enabled: false,
    otp_whatsapp_enabled: false,
    otp_sms_enabled: false,
    otp_email_enabled: false,
    password_reauth: {
      isp_admin: { "admin.settings": "password" },
      reseller: { "admin.settings": "whatsapp" },
    },
  });
  const settingsKeys = [
    "settings.profile",
    "settings.billing",
    "settings.gateways",
    "settings.dashboard",
    "settings.typography",
    "settings.sms",
    "settings.network",
    "settings.hotspot",
    "settings.security",
    "settings.notifications",
    "settings.system",
    "settings.plugins",
  ];

  for (const key of settingsKeys) {
    assert.equal(legacy.pageMethods.isp_admin[key], "password");
    assert.equal(legacy.pageMethods.reseller[key], "whatsapp");
  }

  const independent = validatePlatformAuthPolicy({
    otp: { allEnabled: false, channels: { whatsapp: false, sms: false, email: false } },
    pageMethods: {
      isp_admin: { "admin.settings": "password", "settings.billing": "none" },
      reseller: {},
    },
  });
  assert.ok(independent);
  assert.equal(independent.pageMethods.isp_admin["settings.profile"], "password");
  assert.equal(independent.pageMethods.isp_admin["settings.billing"], "none");
  assert.equal(independent.pageMethods.isp_admin["settings.gateways"], "password");
});

test("settings API reauthentication maps M-Pesa endpoints to Billing & M-Pesa", () => {
  assert.equal(getAdminApiReauthFeature("/api/settings/mpesa?adminTest=true"), "settings.billing");
  assert.equal(getAdminApiReauthFeature("/api/settings/mpesa/status"), "settings.billing");
});

test("page policy rejects unknown methods and page keys", () => {
  const base = {
    otp: { allEnabled: false, channels: { whatsapp: false, sms: false, email: false } },
    pageMethods: { isp_admin: {}, reseller: {} },
  };

  assert.equal(validatePlatformAuthPolicy({
    ...base,
    pageMethods: { ...base.pageMethods, isp_admin: { "network.routers": "voice" } },
  }), null);
  assert.equal(validatePlatformAuthPolicy({
    ...base,
    pageMethods: { ...base.pageMethods, reseller: { "not-a-page": "password" } },
  }), null);
});

test("page OTP challenges use a private one-time migration registered for deployment", () => {
  const migrationPath = fileURLToPath(new URL("../../migrations/2026_platform_page_auth_otp.sql", import.meta.url));
  const runnerPath = fileURLToPath(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url));
  const migration = readFileSync(migrationPath, "utf8");
  const runner = readFileSync(runnerPath, "utf8");

  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /attempts >= 5/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /verified_at = now\(\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
  assert.match(runner, /2026_platform_page_auth_otp\.sql/);
});