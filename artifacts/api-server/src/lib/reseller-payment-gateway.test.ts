import test from "node:test";
import assert from "node:assert/strict";
import { bankBusinessNumberFor } from "./reseller-payment-gateway.js";

test("uses the known KCB business number", () => {
  assert.equal(bankBusinessNumberFor("KCB Bank"), "533533");
  assert.equal(bankBusinessNumberFor("kcb bank"), "533533");
});

test("does not invent a destination for an unknown bank", () => {
  assert.equal(bankBusinessNumberFor("Unknown Bank"), "");
  assert.equal(bankBusinessNumberFor(""), "");
});