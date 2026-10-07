import assert from "node:assert/strict";
import test from "node:test";
import {
  paidHotspotBindingEditPlan,
  paidHotspotBindingSnapshotForCustomer,
} from "./mikrotik.js";

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

test("collapses duplicate rows for the exact same account/device binding", () => {
  const binding = {
    "mac-address": "AA:BB:CC:DD:EE:FF",
    address: "192.168.10.25",
    comment: "user-123",
    type: "regular",
  };
  const snapshot = paidHotspotBindingSnapshotForCustomer([binding, binding], customer);
  assert.deepEqual(snapshot, {
    macAddress: "AA:BB:CC:DD:EE:FF",
    ipAddress: "192.168.10.25",
    comment: "user-123",
    bindingType: "regular",
    duplicateCount: 2,
  });
  assert.deepEqual(paidHotspotBindingEditPlan({
    snapshot: snapshot!,
    currentName: "user-123",
    currentMacAddress: "AA:BB:CC:DD:EE:FF",
    nextName: "user-123",
    nextMacAddress: "AA:BB:CC:DD:EE:FF",
    enabled: true,
  }), {
    remove: [{ macAddress: "AA:BB:CC:DD:EE:FF", comment: "user-123" }],
    ensure: { macAddress: "AA:BB:CC:DD:EE:FF", comment: "user-123" },
  });
});

test("still fails closed when duplicate rows disagree about the binding", () => {
  const binding = {
    "mac-address": "AA:BB:CC:DD:EE:FF",
    address: "192.168.10.25",
    comment: "user-123",
    type: "regular",
  };
  assert.equal(
    paidHotspotBindingSnapshotForCustomer([binding, { ...binding, address: "192.168.10.26" }], customer),
    null,
  );
  assert.equal(paidHotspotBindingSnapshotForCustomer([{ ...binding, type: "unknown" }], customer), null);
});

test("uses the saved IP to repair same-type duplicate rows with stale addresses", () => {
  const rows = [
    {
      "mac-address": "AA:BB:CC:DD:EE:FF",
      address: "192.168.10.25",
      comment: "user-123",
      type: "regular",
    },
    {
      "mac-address": "AA:BB:CC:DD:EE:FF",
      address: "192.168.10.26",
      comment: "user-123",
      type: "regular",
    },
  ];
  const snapshot = paidHotspotBindingSnapshotForCustomer(rows, {
    ...customer,
    ipAddress: "192.168.10.25",
  });
  assert.deepEqual(snapshot, {
    macAddress: "AA:BB:CC:DD:EE:FF",
    ipAddress: "192.168.10.25",
    comment: "user-123",
    bindingType: "regular",
    duplicateCount: 2,
  });
});

test("does not use the saved IP to choose between different binding types", () => {
  const rows = [
    {
      "mac-address": "AA:BB:CC:DD:EE:FF",
      address: "192.168.10.25",
      comment: "user-123",
      type: "regular",
    },
    {
      "mac-address": "AA:BB:CC:DD:EE:FF",
      address: "192.168.10.26",
      comment: "user-123",
      type: "bypassed",
    },
  ];
  assert.equal(paidHotspotBindingSnapshotForCustomer(rows, {
    ...customer,
    ipAddress: "192.168.10.25",
  }), null);
});

test("identifies the exact username binding by saved IP when the customer row has no MAC", () => {
  const snapshot = paidHotspotBindingSnapshotForCustomer([{
    "mac-address": "AA:BB:CC:DD:EE:FF",
    address: "192.168.10.25",
    comment: "user-123",
    type: "regular",
  }], { name: "user-123", ipAddress: "192.168.10.25/32" });
  assert.equal(snapshot?.macAddress, "AA:BB:CC:DD:EE:FF");
  assert.equal(snapshot?.comment, "user-123");
});
