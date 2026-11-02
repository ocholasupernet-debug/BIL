import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRouterApiSecret,
  encryptRouterApiSecret,
  routerApiSecretLookupHash,
} from "./router-api-secret.js";

test("router API password encryption is reversible without storing plaintext", () => {
  process.env.SESSION_SECRET = "unit-test-session-secret";
  const password = "test-router-password";
  const encrypted = encryptRouterApiSecret(password);

  assert.notEqual(encrypted, password);
  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.equal(encrypted.includes(password), false);
  assert.equal(decryptRouterApiSecret(encrypted), password);
});

test("legacy plaintext credentials remain readable during migration", () => {
  assert.equal(decryptRouterApiSecret("legacy-router-password"), "legacy-router-password");
  assert.equal(decryptRouterApiSecret(null), "");
});

test("lookup hashes are stable and do not contain the password", () => {
  process.env.SESSION_SECRET = "unit-test-session-secret";
  const password = "test-router-password";
  const hash = routerApiSecretLookupHash(password);

  assert.equal(hash, routerApiSecretLookupHash(password));
  assert.notEqual(hash, password);
  assert.equal(hash.length, 64);
});
