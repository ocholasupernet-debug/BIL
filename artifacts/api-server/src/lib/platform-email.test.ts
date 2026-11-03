import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRegistrationConfirmationEmail,
  getPlatformEmailStatus,
  normalisePlatformEmailSettings,
  publicPlatformEmailSettings,
  safeTransportErrorFields,
  sendPlatformEmail,
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

test("Gmail status is explicit and never exposes the App Password", () => {
  const previous = process.env.GMAIL_APP_PASSWORD;
  process.env.GMAIL_APP_PASSWORD = "test-only-secret";
  try {
    const status = getPlatformEmailStatus();
    assert.equal(status.configured, true);
  assert.equal(status.senderEmail, "ocholasupernetbilling@gmail.com");
    assert.equal(JSON.stringify(status).includes("test-only-secret"), false);
  } finally {
    if (previous === undefined) delete process.env.GMAIL_APP_PASSWORD;
    else process.env.GMAIL_APP_PASSWORD = previous;
  }
});

test("Gmail diagnostics expose safe SMTP codes without response text", () => {
  const error = Object.assign(new Error("sensitive server response"), {
    code: "EAUTH",
    responseCode: 535,
    command: "AUTH PLAIN",
    response: "private provider response",
  });
  const details = safeTransportErrorFields(error);
  assert.deepEqual(details, {
    errorType: "Error",
    smtpCode: "EAUTH",
    smtpResponseCode: 535,
    smtpCommand: "AUTH",
  });
  assert.equal(JSON.stringify(details).includes("private"), false);
  assert.equal(JSON.stringify(details).includes("sensitive"), false);
});

test("Gmail diagnostics discard unsafe provider fields", () => {
  const details = safeTransportErrorFields({
    code: "AUTH failed with password",
    responseCode: 999,
    command: "AUTH private-value",
  });
  assert.deepEqual(details, { errorType: "unknown", smtpCommand: "AUTH" });
});

test("email delivery fails explicitly while Gmail is not configured", async () => {
  const previous = process.env.GMAIL_APP_PASSWORD;
  delete process.env.GMAIL_APP_PASSWORD;
  try {
    assert.equal(getPlatformEmailStatus().configured, false);
    await assert.rejects(
      sendPlatformEmail({ to: "admin@example.com", subject: "Test", text: "Test" }),
      /GMAIL_APP_PASSWORD/,
    );
  } finally {
    if (previous !== undefined) process.env.GMAIL_APP_PASSWORD = previous;
  }
});

test("registration welcome email uses OcholaSupernet Billing branding and the canonical tenant URL", () => {
  const message = buildRegistrationConfirmationEmail({
    name: "Test ISP",
    fullname: "Test ISP Ltd",
    email: "admin@example.com",
    username: "testadmin",
    subdomain: "testisp",
    role: "isp_admin",
    must_change_password: true,
    is_active: true,
    status: "active",
  }, "isplatty.com");

  assert.ok(message);
  assert.equal(message.fromName, "OcholaSupernet Billing");
  assert.equal(message.subject, "Welcome to OcholaSupernet Billing — your workspace is ready");
  assert.match(message.text, /https:\/\/testisp\.isplatty\.com\/admin\/login/);
  assert.match(message.text, /does not contain a password/);
  assert.equal(message.text.includes("temporary password:"), false);
});

test("registration welcome email is not sent to inactive or invalid accounts", () => {
  assert.equal(buildRegistrationConfirmationEmail({
    email: "admin@example.com",
    subdomain: "testisp",
    is_active: false,
    status: "active",
  }), null);
});