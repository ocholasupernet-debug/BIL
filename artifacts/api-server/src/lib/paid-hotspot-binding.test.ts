import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotActiveSessionMatchesDevice,
  hotspotDeviceAddressForMac,
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

test("a paid active session must match both its account and target device MAC", () => {
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
    macAddress: "11:22:33:44:55:66",
  }), false);
});