import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REGISTRATION_FEE,
  mergeMpesaSettingsPreservingCredentials,
  normaliseRegistrationFee,
  persistMpesaSettingsSafely,
  resolveStoredRegistrationFee,
  MpesaSettingsUnavailableError,
  type EncryptedDarajaSettings,
  type MpesaSettings,
} from "./settings-store.js";

test("registration fee defaults to KSh 700 when no valid saved value exists", () => {
  assert.equal(DEFAULT_REGISTRATION_FEE, 700);
  assert.equal(normaliseRegistrationFee(undefined), 700);
  assert.equal(normaliseRegistrationFee(0), 700);
  assert.equal(normaliseRegistrationFee("700"), 700);
});

test("legacy unversioned KSh 10 registration fee upgrades to the new KSh 700 default", () => {
  assert.equal(resolveStoredRegistrationFee(10, undefined), 700);
});

test("a versioned Super Admin setting may intentionally use KSh 10", () => {
  assert.equal(resolveStoredRegistrationFee(10, 1), 10);
});

test("valid custom registration fees remain unchanged", () => {
  assert.equal(resolveStoredRegistrationFee(850, undefined), 850);
  assert.equal(resolveStoredRegistrationFee(2500, 1), 2500);
});

const savedDarajaSettings: MpesaSettings = {
  consumerKey: "saved-consumer-key",
  consumerSecret: "saved-consumer-secret",
  shortcode: "123456",
  passkey: "saved-passkey",
  callbackUrl: "https://isp.example/api/mpesa/callback",
  env: "sandbox",
  tillNumber: "987654",
};

test("blank and masked form fields cannot erase saved global Daraja credentials", () => {
  const merged = mergeMpesaSettingsPreservingCredentials(savedDarajaSettings, {
    consumerKey: "**hidden**",
    consumerSecret: "",
    shortcode: "",
    passkey: "**hidden**",
    callbackUrl: "",
    env: "production",
    tillNumber: "",
  });

  assert.equal(merged.consumerKey, savedDarajaSettings.consumerKey);
  assert.equal(merged.consumerSecret, savedDarajaSettings.consumerSecret);
  assert.equal(merged.shortcode, savedDarajaSettings.shortcode);
  assert.equal(merged.passkey, savedDarajaSettings.passkey);
  assert.equal(merged.callbackUrl, savedDarajaSettings.callbackUrl);
  assert.equal(merged.env, "production");
  assert.equal(merged.tillNumber, "");
});

test("explicit Super Admin credential replacements update the global values", () => {
  const merged = mergeMpesaSettingsPreservingCredentials(savedDarajaSettings, {
    consumerKey: "new-consumer-key",
    consumerSecret: "**hidden**",
    shortcode: "654321",
    passkey: "new-passkey",
    callbackUrl: "https://isp.example/api/mpesa/callback",
    env: "production",
  });

  assert.equal(merged.consumerKey, "new-consumer-key");
  assert.equal(merged.consumerSecret, savedDarajaSettings.consumerSecret);
  assert.equal(merged.shortcode, "654321");
  assert.equal(merged.passkey, "new-passkey");
  assert.equal(merged.env, "production");
  assert.equal(merged.tillNumber, savedDarajaSettings.tillNumber);
});

const encryptedRecord: EncryptedDarajaSettings = {
  id: "global_daraja",
  ciphertext: "opaque-ciphertext",
  iv: "opaque-iv",
  auth_tag: "opaque-auth-tag",
};

test("an unreadable saved row is not archived over or overwritten", async () => {
  let archiveCalled = false;
  let writeCalled = false;

  await assert.rejects(
    persistMpesaSettingsSafely(savedDarajaSettings, {
      readCurrent: async () => encryptedRecord,
      decrypt: () => {
        throw new Error("authentication failed");
      },
      archive: async () => {
        archiveCalled = true;
      },
      write: async () => {
        writeCalled = true;
      },
    }),
    error => error instanceof MpesaSettingsUnavailableError,
  );

  assert.equal(archiveCalled, false);
  assert.equal(writeCalled, false);
});

test("a successful update archives the old ciphertext before writing merged credentials", async () => {
  const calls: string[] = [];
  const written: MpesaSettings[] = [];

  await persistMpesaSettingsSafely({
    ...savedDarajaSettings,
    consumerKey: "**hidden**",
    consumerSecret: "",
    passkey: "**hidden**",
  }, {
    readCurrent: async () => encryptedRecord,
    decrypt: () => savedDarajaSettings,
    archive: async record => {
      assert.equal(record, encryptedRecord);
      calls.push("archive");
    },
    write: async settings => {
      written.push(settings);
      calls.push("write");
    },
  });

  assert.deepEqual(calls, ["archive", "write"]);
  assert.equal(written[0]?.consumerKey, savedDarajaSettings.consumerKey);
  assert.equal(written[0]?.consumerSecret, savedDarajaSettings.consumerSecret);
  assert.equal(written[0]?.passkey, savedDarajaSettings.passkey);
});
