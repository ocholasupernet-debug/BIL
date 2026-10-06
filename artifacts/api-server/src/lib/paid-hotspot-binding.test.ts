import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotActiveSessionMatchesDevice,
  hotspotDeviceAddressForMac,
  paidHotspotBindingEditPlan,
  paidHotspotBindingMatchesCustomer,
} from "./mikrotik.js";

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

test("device IP lookup only returns the address for the purchased MAC", () => {
  const devices = [
    { macAddress: "11:22:33:44:55:66", address: "10.0.0.12" },
    { macAddress: "AA:BB:CC:DD:EE:FF", address: "10.0.0.88" },
  ];

  assert.equal(hotspotDeviceAddressForMac(devices, "aa:bb:cc:dd:ee:ff"), "10.0.0.88");
  assert.equal(hotspotDeviceAddressForMac(devices, "00:11:22:33:44:55"), null);
});

test("a paid active session must match both its account and target device identity", () => {
  const sessions = [
    { user: "tv-package", address: "10.0.0.88", "mac-address": "AA:BB:CC:DD:EE:FF" },
    { user: "phone-package", address: "10.0.0.12", "mac-address": "11:22:33:44:55:66" },
  ];

  assert.equal(hotspotActiveSessionMatchesDevice(sessions, {
    user: "tv-package",
    macAddress: "aa:bb:cc:dd:ee:ff",
  }), true);
  assert.equal(hotspotActiveSessionMatchesDevice(sessions, {
    user: "tv-package",
    macAddress: "aa:bb:cc:dd:ee:ff",
    ip: "10.0.0.88",
  }), true);
  assert.equal(hotspotActiveSessionMatchesDevice(sessions, {
    user: "tv-package",
    macAddress: "aa:bb:cc:dd:ee:ff",
    ip: "10.0.0.12",
  }), false);
  assert.equal(hotspotActiveSessionMatchesDevice(sessions, {
    user: "tv-package",
    macAddress: "11:22:33:44:55:66",
  }), false);
});

const bindingSnapshot = {
  macAddress: "AA:BB:CC:DD:EE:FF",
  ipAddress: "192.168.10.25",
  comment: "paid-user",
  bindingType: "bypassed" as const,
};

test("paid-bound edits preserve and refresh the binding when its identity is unchanged", () => {
  assert.deepEqual(paidHotspotBindingEditPlan({
    snapshot: bindingSnapshot,
    currentName: "paid-user",
    currentMacAddress: "AA:BB:CC:DD:EE:FF",
    nextName: "paid-user",
    nextMacAddress: "aa-bb-cc-dd-ee-ff",
    enabled: true,
  }), {
    remove: [],
    ensure: { macAddress: "AA:BB:CC:DD:EE:FF", comment: "paid-user" },
  });
});

test("paid-bound renames remove old binding identities and ensure the edited identity", () => {
  assert.deepEqual(paidHotspotBindingEditPlan({
    snapshot: bindingSnapshot,
    currentName: "paid-user",
    currentMacAddress: "AA:BB:CC:DD:EE:FF",
    nextName: "renamed-user",
    nextMacAddress: "AA:BB:CC:DD:EE:FF",
    enabled: true,
  }), {
    remove: [{ macAddress: "AA:BB:CC:DD:EE:FF", comment: "paid-user" }],
    ensure: { macAddress: "AA:BB:CC:DD:EE:FF", comment: "renamed-user" },
  });
});

test("paid-bound rollback removes the attempted identity and restores the original binding", () => {
  assert.deepEqual(paidHotspotBindingEditPlan({
    snapshot: bindingSnapshot,
    currentName: "renamed-user",
    currentMacAddress: "AA:BB:CC:DD:EE:FF",
    nextName: "paid-user",
    nextMacAddress: "AA:BB:CC:DD:EE:FF",
    enabled: true,
  }), {
    remove: [{ macAddress: "AA:BB:CC:DD:EE:FF", comment: "renamed-user" }],
    ensure: { macAddress: "AA:BB:CC:DD:EE:FF", comment: "paid-user" },
  });
});

test("disabling a paid-bound account removes the binding instead of ensuring access", () => {
  assert.deepEqual(paidHotspotBindingEditPlan({
    snapshot: bindingSnapshot,
    currentName: "paid-user",
    currentMacAddress: "AA:BB:CC:DD:EE:FF",
    nextName: "paid-user",
    nextMacAddress: "AA:BB:CC:DD:EE:FF",
    enabled: false,
  }), {
    remove: [{ macAddress: "AA:BB:CC:DD:EE:FF", comment: "paid-user" }],
    ensure: null,
  });
});