import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePlatformRadiusSettings,
  publicPlatformRadiusSettings,
} from "./platform-radius.js";

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
  const publicSettings = publicPlatformRadiusSettings(settings, "database");
  assert.equal(publicSettings.hasSecret, true);
  assert.equal(publicSettings.configured, true);
  assert.equal(Object.hasOwn(publicSettings, "secret"), false);
  assert.equal(JSON.stringify(publicSettings).includes("test-shared-secret"), false);
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
