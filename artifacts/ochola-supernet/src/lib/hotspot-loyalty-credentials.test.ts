import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accountCredentialsPayload,
  forgetHotspotLoyaltyDeviceAuthorization,
  isVerificationRequired,
  loyaltyDeviceAuthorizationPayload,
  normalizeConfirmedCredentials,
  readStoredHotspotLoyaltyDeviceAuthorization,
  readStoredHotspotCredentials,
  redeemOutcomeIsUncertain,
  storeHotspotLoyaltyDeviceAuthorization,
} from "./hotspot-loyalty-credentials";

test("reads only well-formed saved credentials", () => {
  const store = (value: string | null) => ({ getItem: () => value });
  assert.deepEqual(readStoredHotspotCredentials(store('{"username":" ann ","password":"p"}'), "k"), { username: "ann", password: "p" });
  assert.equal(readStoredHotspotCredentials(store("nope"), "k"), null);
  assert.equal(readStoredHotspotCredentials(store('{"username":"a"}'), "k"), null);
  assert.equal(readStoredHotspotCredentials(null, "k"), null);
});

test("payload and confirmation helpers", () => {
  assert.deepEqual(accountCredentialsPayload({ username: "a", password: "b" }), { account_credentials: { username: "a", password: "b" } });
  assert.deepEqual(accountCredentialsPayload(null), {});
  assert.equal(normalizeConfirmedCredentials("  ", "x"), null);
  assert.deepEqual(normalizeConfirmedCredentials(" u ", "x"), { username: "u", password: "x" });
});

test("trusted-device authorization is stored as a separate token and can be removed", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(storeHotspotLoyaltyDeviceAuthorization(storage, "device", "signed-token", Date.now() + 60_000), true);
  assert.equal(readStoredHotspotLoyaltyDeviceAuthorization(storage, "device"), "signed-token");
  assert.deepEqual(loyaltyDeviceAuthorizationPayload(" signed-token "), { device_authorization: "signed-token" });
  assert.deepEqual(loyaltyDeviceAuthorizationPayload(null), {});
  assert.equal(readStoredHotspotLoyaltyDeviceAuthorization(
    { getItem: () => JSON.stringify({ token: "expired", expiresAt: 100 }) },
    "device",
    101,
  ), null);
  forgetHotspotLoyaltyDeviceAuthorization(storage, "device");
  assert.equal(readStoredHotspotLoyaltyDeviceAuthorization(storage, "device"), null);
});

test("verification and uncertainty classification", () => {
  assert.equal(isVerificationRequired(401, { verificationRequired: true }), true);
  assert.equal(isVerificationRequired(401, { error: "x" }), false);
  assert.equal(isVerificationRequired(400, { verificationRequired: true }), false);
  assert.equal(redeemOutcomeIsUncertain(null), true);
  assert.equal(redeemOutcomeIsUncertain(502), true);
  assert.equal(redeemOutcomeIsUncertain(401), false);
});

test("React portal wires credentials into quote and redeem without URLs", () => {
  const src = readFileSync(new URL("../pages/portal/HotspotLogin.tsx", import.meta.url), "utf8");
  assert.ok((src.match(/accountCredentialsPayload\(/g) ?? []).length >= 2);
  assert.ok((src.match(/loyaltyDeviceAuthorizationPayload\(/g) ?? []).length >= 2);
  assert.ok(src.includes("!loyaltyDeviceAuthorization"));
  assert.ok(src.includes("isVerificationRequired("));
  assert.ok(!/loyalty\/(quote|redeem)\?/.test(src));
});

test("static portal remembers verified devices after purchase and sends authorization with loyalty requests", () => {
  const html = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
  assert.ok(html.includes("function saveHotspotLoginCredentials("));
  assert.ok((html.match(/saveHotspotLoginCredentials\(/g) ?? []).length >= 4);
  assert.ok((html.match(/account_credentials/g) ?? []).length >= 2);
  assert.ok(html.includes("device_authorization"));
  assert.match(html, /data\.device_authorization[\s\S]{0,240}saveHotspotLoyaltyDeviceAuthorization/);
  assert.ok(html.includes("loyUncertain"));
});
