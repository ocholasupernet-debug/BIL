import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { secretMatches, verifyStripeSignature } from "./webhook-auth";

test("secretMatches rejects missing, incorrect, and accepts exact configured secrets", () => {
  assert.equal(secretMatches("", "configured"), false);
  assert.equal(secretMatches("provided", ""), false);
  assert.equal(secretMatches("wrong", "configured"), false);
  assert.equal(secretMatches("configured", "configured"), true);
});

test("Stripe signatures use the exact body bytes and reject stale or invalid signatures", () => {
  const secret = "whsec_test";
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const body = Buffer.from('{"id":"evt_123","type":"payment_intent.succeeded"}');
  const signature = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest("hex");

  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, now), true);
  assert.equal(verifyStripeSignature(Buffer.from(`${body.toString()} `), `t=${timestamp},v1=${signature}`, secret, now), false);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, now + 301_000), false);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, "", now), false);
});