import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePlatformRadiusSettings,
  generatePlatformRadiusSecret,
  publicPlatformRadiusSettings,
} from "./platform-radius.js";

test("generated platform RADIUS secrets are strong URL-safe random values", () => {
  const first = generatePlatformRadiusSecret();
  const second = generatePlatformRadiusSecret();
  assert.match(first, /^[A-Za-z0-9_-]{64}$/u);
  assert.notEqual(first, second);
});

test("platform RADIUS requires host and secret before enabling", () => {
  assert.throws(
    () => normalizePlatformRadiusSettings({ enabled: true, host: "radius.example.net" }),
    /host and shared secret/,
  );
});

test("platform RADIUS preserves a saved secret when the password field is blank", () => {
  const settings = normalizePlatformRadiusSettings({
    enabled: true,
    host: "radius.example.net",
    authenticationPort: "18120",
    accountingPort: "18130",
    secret: "",
  }, "saved-secret");
  assert.equal(settings.secret, "saved-secret");
  assert.equal(settings.authenticationPort, 18120);
  assert.equal(settings.accountingPort, 18130);
});

test("public platform RADIUS status never exposes the shared secret", () => {
  const settings = normalizePlatformRadiusSettings({
    enabled: true,
    host: "10.8.5.1",
    secret: "test-shared-secret",
  });
  const publicSettings = publicPlatformRadiusSettings(settings, "database", {
    vpsHost: "vps.example.net",
    detectedVpsIp: "203.0.113.5",
    managementVpnHost: "10.8.5.1",
    configRoot: "/etc/freeradius/3.0",
    installed: true,
    running: true,
    configurationValid: true,
    authenticationPort: 1812,
    accountingPort: 1813,
    authenticationListening: true,
    accountingListening: true,
    endpointVerified: true,
    radiusHost: "203.0.113.5",
    secretSynchronized: true,
    routerSync: [],
    checkedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(publicSettings.hasSecret, true);
  assert.equal(publicSettings.configured, true);
  assert.equal(publicSettings.host, "203.0.113.5");
  assert.equal(Object.hasOwn(publicSettings, "secret"), false);
  assert.equal(JSON.stringify(publicSettings).includes("test-shared-secret"), false);
});

test("unverified manual endpoint values are not returned as configured RADIUS", () => {
  const settings = normalizePlatformRadiusSettings({
    enabled: true,
    host: "unverified.example.net",
    secret: "test-shared-secret",
  });
  const publicSettings = publicPlatformRadiusSettings(settings, "database");
  assert.equal(publicSettings.configured, false);
  assert.equal(publicSettings.host, "");
  assert.equal(publicSettings.authenticationPort, null);
  assert.equal(publicSettings.accountingPort, null);
});

test("invalid RADIUS hosts and ports are rejected", () => {
  assert.throws(
    () => normalizePlatformRadiusSettings({ host: "bad host", secret: "safe" }),
    /valid RADIUS server hostname or IP/,
  );
  assert.throws(
    () => normalizePlatformRadiusSettings({ host: "radius.example.net", authenticationPort: 70000 }),
    /authentication port must be/,
  );
});
