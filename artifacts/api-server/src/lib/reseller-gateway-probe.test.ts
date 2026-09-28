import test from "node:test";
import assert from "node:assert/strict";
import { probeResellerGatewayConnection } from "./reseller-gateway-probe.js";

test("tests Stripe credentials with a read-only account request", async () => {
  let requestedUrl = "";
  let authorization = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(JSON.stringify({ id: "acct_test" }), { status: 200 });
  };
  const result = await probeResellerGatewayConnection("stripe", {
    publishableKey: "pk_test",
    secretKey: "sk_reseller_only",
  }, fakeFetch);
  assert.equal(result.status, "verified");
  assert.equal(requestedUrl, "https://api.stripe.com/v1/account");
  assert.equal(authorization, "Bearer sk_reseller_only");
});

test("tests a reseller's own Daraja credentials without sending an STK request", async () => {
  let requestedUrl = "";
  let authorization = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(JSON.stringify({ access_token: "daraja-token" }), { status: 200 });
  };
  const result = await probeResellerGatewayConnection("mpesa_paybill", {
    paybillNumber: "123456",
    accountNumber: "REF",
    businessShortcode: "654321",
    consumerKey: "reseller-key",
    consumerSecret: "reseller-secret",
    passkey: "reseller-passkey",
    environment: "sandbox",
  }, fakeFetch);
  assert.equal(result.status, "verified");
  assert.equal(requestedUrl, "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials");
  assert.match(authorization, /^Basic /);
});

test("tests PayPal credentials by requesting an OAuth token without creating a payment", async () => {
  let requestedUrl = "";
  let requestBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "oauth-token" }), { status: 200 });
  };
  const result = await probeResellerGatewayConnection("paypal", {
    clientId: "reseller-client",
    clientSecret: "reseller-secret",
    environment: "sandbox",
  }, fakeFetch);
  assert.equal(result.status, "verified");
  assert.equal(requestedUrl, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  assert.equal(requestBody, "grant_type=client_credentials");
});

test("does not claim a remote test for manual payment methods", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    throw new Error("should not call a provider");
  };
  const result = await probeResellerGatewayConnection("manual", {
    paymentInstructions: "Pay at the reseller office",
  }, fakeFetch);
  assert.equal(result.status, "setup_only");
  assert.equal(called, false);
});

test("keeps provider rejection responses free of saved credentials", async () => {
  const secret = "sk_sensitive_reseller_key";
  const fakeFetch: typeof fetch = async () => new Response("unauthorized", { status: 401 });
  const result = await probeResellerGatewayConnection("stripe", {
    publishableKey: "pk_test",
    secretKey: secret,
  }, fakeFetch);
  assert.equal(result.status, "rejected");
  assert.equal(result.message.includes(secret), false);
});

test("reports provider network failures without exposing request data", async () => {
  const secret = "reseller-secret";
  const fakeFetch: typeof fetch = async () => {
    throw new Error(secret);
  };
  const result = await probeResellerGatewayConnection("xendit", { apiKey: secret }, fakeFetch);
  assert.equal(result.status, "unavailable");
  assert.equal(result.message.includes(secret), false);
});