import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accountCredentialsPayload,
  isVerificationRequired,
  normalizeConfirmedCredentials,
  readStoredHotspotCredentials,
  redeemOutcomeIsUncertain,
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
  assert.ok(src.includes("isVerificationRequired("));
  assert.ok(!/loyalty\/(quote|redeem)\?/.test(src));
});

test("static portal saves credentials and sends them with quote and redeem", () => {
  const html = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
  assert.ok(html.includes("function saveHotspotLoginCredentials("));
  assert.ok((html.match(/saveHotspotLoginCredentials\(/g) ?? []).length >= 4);
  assert.ok((html.match(/account_credentials/g) ?? []).length >= 2);
  assert.ok(html.includes("loyUncertain"));
});
