import test from "node:test";
import assert from "node:assert/strict";
import {
  bankBusinessNumberFor,
  isResellerGatewayTestMetadata,
  resellerGatewayCheckoutSupported,
  resellerGatewayConfigComplete,
  resellerDestinationConfigured,
  hasResellerDarajaCredentials,
  resellerGatewayCollectionConfig,
} from "./reseller-payment-gateway.js";

test("uses the known KCB business number", () => {
  assert.equal(bankBusinessNumberFor("KCB Bank"), "533533");
  assert.equal(bankBusinessNumberFor("kcb bank"), "533533");
});

test("does not invent a destination for an unknown bank", () => {
  assert.equal(bankBusinessNumberFor("Unknown Bank"), "");
  assert.equal(bankBusinessNumberFor(""), "");
});

test("accepts current and legacy reseller Till metadata", () => {
  assert.equal(resellerDestinationConfigured("mpesa_till_push", { tillNumber: "123456" }), true);
  assert.equal(resellerDestinationConfigured("mpesa_till_push", { merchant_identifier: "123456" }), true);
  assert.equal(resellerDestinationConfigured("mpesa_till_push", {}), false);
});

test("accepts current and legacy reseller PayBill metadata", () => {
  assert.equal(resellerDestinationConfigured("mpesa_paybill", { paybillNumber: "123456", accountNumber: "ISP" }), true);
  assert.equal(resellerDestinationConfigured("mpesa_paybill", { merchant_identifier: "123456", account_reference: "ISP" }), true);
  assert.equal(resellerDestinationConfigured("mpesa_paybill", { paybillNumber: "123456" }), false);
});

test("requires only a collection destination for a Daraja reseller route", () => {
  assert.equal(resellerGatewayConfigComplete("mpesa_paybill", {
    paybillNumber: "123456",
    accountNumber: "REF",
  }), true);
  assert.equal(resellerGatewayConfigComplete("mpesa_paybill", {
    paybillNumber: "123456",
    accountNumber: "REF",
  }), true);
  assert.equal(resellerGatewayConfigComplete("mpesa_paybill", { paybillNumber: "123456" }), false);
});

test("strips centrally managed Daraja fields from reseller collection config", () => {
  const legacyConfig = {
    paybillNumber: "123456",
    accountNumber: "REF",
    business_shortcode: "654321",
    consumer_key: "old-key",
    consumerSecret: "old-secret",
    passkey: "old-passkey",
    environment: "production",
    callbackUrl: "https://example.com/callback",
  };
  assert.equal(hasResellerDarajaCredentials("mpesa_paybill", legacyConfig), true);
  assert.deepEqual(resellerGatewayCollectionConfig("mpesa_paybill", legacyConfig), {
    paybillNumber: "123456",
    accountNumber: "REF",
  });
  assert.deepEqual(resellerGatewayCollectionConfig("mpesa_till_push", {
    tillNumber: "987654",
    consumerKey: "old-key",
    shortcode: "654321",
  }), { tillNumber: "987654" });
});

test("allows setup checks for other gateways without enabling their checkout", () => {
  assert.equal(resellerGatewayConfigComplete("stripe", {
    publishableKey: "pk_test",
    secretKey: "sk_test",
  }), true);
  assert.equal(resellerGatewayCheckoutSupported("stripe"), false);
  assert.equal(resellerGatewayCheckoutSupported("mpesa_paybill"), true);
});

test("recognizes only explicitly marked reseller gateway test payments", () => {
  assert.equal(isResellerGatewayTestMetadata({ source: "reseller_gateway_test" }), true);
  assert.equal(isResellerGatewayTestMetadata({ source: "reseller_daraja_bridge" }), false);
  assert.equal(isResellerGatewayTestMetadata(null), false);
  assert.equal(isResellerGatewayTestMetadata("reseller_gateway_test"), false);
});