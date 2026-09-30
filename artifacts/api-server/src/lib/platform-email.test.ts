import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalisePlatformEmailSettings,
  publicPlatformEmailSettings,
} from "./platform-email.js";

const completeSettings = {
  enabled: true,
  host: "smtp.example.com",
  port: "587",
  security: "starttls",
  authEnabled: true,
  username: "notifications@example.com",
  password: "",
  fromEmail: "notifications@example.com",
  fromName: "OcholaSupernet",
  securityEmail: "admin@example.com",
};

test("blank SMTP password preserves the previously saved secret", () => {
  const settings = normalisePlatformEmailSettings(
    completeSettings,
    "saved-app-password",
  );
  assert.equal(settings.password, "saved-app-password");
  assert.equal(settings.port, 587);
});

test("public email settings never expose the SMTP password", () => {
  const settings = normalisePlatformEmailSettings(
    { ...completeSettings, password: "smtp-secret" },
  );
  const publicSettings = publicPlatformEmailSettings(settings);
  assert.equal(publicSettings.hasPassword, true);
  assert.equal(publicSettings.configured, true);
  assert.equal(Object.hasOwn(publicSettings, "password"), false);
});

test("enabling authenticated SMTP requires a username and password", () => {
  assert.throws(
    () => normalisePlatformEmailSettings(completeSettings),
    /SMTP username and password/,
  );
});

test("SMTP can be enabled without authentication when the relay allows it", () => {
  const settings = normalisePlatformEmailSettings({
    ...completeSettings,
    authEnabled: false,
    username: "",
    password: "",
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.authEnabled, false);
  assert.equal(publicPlatformEmailSettings(settings).configured, true);
});