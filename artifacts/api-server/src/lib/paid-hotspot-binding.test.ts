import assert from "node:assert/strict";
import test from "node:test";
import { paidHotspotBindingMatchesCustomer } from "./mikrotik.js";

test("an exact paid account comment is owned even if the saved MAC differs", () => {
  assert.equal(paidHotspotBindingMatchesCustomer(
    { comment: "254712345678-AB:12", "mac-address": "AA:BB:CC:DD:EE:FF", type: "bypassed" },
    { name: "254712345678-AB:12", macAddress: "00:11:22:33:44:55" },
  ), true);
});

test("legacy paid comments must match the saved MAC", () => {
  const row = { comment: "OcholaSupernet paid", "mac-address": "AA:BB:CC:DD:EE:FF", type: "bypassed" };
  assert.equal(paidHotspotBindingMatchesCustomer(row, { name: "login", macAddress: "00:11:22:33:44:55" }), false);
  assert.equal(paidHotspotBindingMatchesCustomer(row, { name: "login", macAddress: "aa-bb-cc-dd-ee-ff" }), true);
});