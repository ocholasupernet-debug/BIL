import assert from "node:assert/strict";
import test from "node:test";
import { paidHotspotBindingSnapshotForCustomer } from "./mikrotik.js";

const customer = { name: "user-123", macAddress: "AA:BB:CC:DD:EE:FF" };

test("captures the identified paid binding's address, type, and comment", () => {
  const snapshot = paidHotspotBindingSnapshotForCustomer([
    {
      "mac-address": "AA:BB:CC:DD:EE:FF",
      address: "192.168.10.25",
      comment: "user-123",
      type: "regular",
    },
  ], customer);
  assert.deepEqual(snapshot, {
    macAddress: "AA:BB:CC:DD:EE:FF",
    ipAddress: "192.168.10.25",
    comment: "user-123",
    bindingType: "regular",
  });
});

test("does not select a binding attached to a different MAC", () => {
  assert.equal(paidHotspotBindingSnapshotForCustomer([
    {
      "mac-address": "00:11:22:33:44:55",
      address: "192.168.10.25",
      comment: "user-123",
      type: "regular",
    },
  ], customer), null);
});

test("does not guess when paid bindings are ambiguous or use an unsupported type", () => {
  const binding = {
    "mac-address": "AA:BB:CC:DD:EE:FF",
    address: "192.168.10.25",
    comment: "user-123",
    type: "regular",
  };
  assert.equal(paidHotspotBindingSnapshotForCustomer([binding, binding], customer), null);
  assert.equal(paidHotspotBindingSnapshotForCustomer([{ ...binding, type: "unknown" }], customer), null);
});
