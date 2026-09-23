import test from "node:test";
import assert from "node:assert/strict";
import { bankBusinessNumberFor, resellerDestinationConfigured } from "./reseller-payment-gateway.js";

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