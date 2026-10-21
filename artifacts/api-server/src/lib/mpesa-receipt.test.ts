import assert from "node:assert/strict";
import test from "node:test";
import { extractMpesaReceipt } from "./mpesa-receipt.js";

test("accepts a pasted M-Pesa receipt code directly", () => {
  assert.equal(extractMpesaReceipt("QAB12CDE34"), "QAB12CDE34");
});

test("extracts the receipt code from the full M-Pesa confirmation", () => {
  assert.equal(
    extractMpesaReceipt("QAB12CDE34 Confirmed. Ksh100.00 sent to Example"),
    "QAB12CDE34",
  );
});

test("extracts a receipt labelled transaction ID", () => {
  assert.equal(extractMpesaReceipt("Transaction ID: QAB12CDE34"), "QAB12CDE34");
});

test("does not treat a Daraja checkout identifier or arbitrary text as a receipt", () => {
  assert.equal(extractMpesaReceipt("ws_CO_123456789"), "");
  assert.equal(extractMpesaReceipt("please reconnect my device"), "");
});
