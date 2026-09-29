import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetHotspotDevice,
  hotspotSavedDevicesStorageKey,
  readSavedHotspotDevices,
  saveHotspotDevice,
  type SavedHotspotDeviceStorage,
} from "./saved-hotspot-devices.js";

function createStorage(): SavedHotspotDeviceStorage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("saved-device storage keys are isolated by portal, ISP, router, and port", () => {
  const key = hotspotSavedDevicesStorageKey("portal.example.test", 7, 3, 2);

  assert.notEqual(key, hotspotSavedDevicesStorageKey("other.example.test", 7, 3, 2));
  assert.notEqual(key, hotspotSavedDevicesStorageKey("portal.example.test", 8, 3, 2));
  assert.notEqual(key, hotspotSavedDevicesStorageKey("portal.example.test", 7, 4, 2));
  assert.notEqual(key, hotspotSavedDevicesStorageKey("portal.example.test", 7, 3, 5));
});

test("saving normalizes MAC addresses and updates an existing device in place", () => {
  const storage = createStorage();
  const key = "saved";

  assert.equal(saveHotspotDevice(key, { name: " Living  Room TV ", macAddress: "aa-bb-cc-dd-ee-ff" }, storage), true);
  assert.equal(saveHotspotDevice(key, { name: "Bedroom TV", macAddress: "AA:BB:CC:DD:EE:FF" }, storage), true);
  assert.deepEqual(readSavedHotspotDevices(key, storage), [
    { name: "Bedroom TV", macAddress: "AA:BB:CC:DD:EE:FF" },
  ]);
});

test("invalid stored devices and duplicate MAC addresses are ignored", () => {
  const storage = createStorage();
  const key = "saved";
  storage.setItem(key, JSON.stringify([
    { name: "Living Room", macAddress: "aa:bb:cc:dd:ee:ff" },
    { name: "Duplicate", macAddress: "AA-BB-CC-DD-EE-FF" },
    { name: "Missing MAC", macAddress: "not-a-mac" },
    { name: "   ", macAddress: "11:22:33:44:55:66" },
  ]));

  assert.deepEqual(readSavedHotspotDevices(key, storage), [
    { name: "Living Room", macAddress: "AA:BB:CC:DD:EE:FF" },
  ]);
});

test("forgetting a device removes only the matching normalized MAC", () => {
  const storage = createStorage();
  const key = "saved";
  saveHotspotDevice(key, { name: "Living Room TV", macAddress: "AA:BB:CC:DD:EE:FF" }, storage);
  saveHotspotDevice(key, { name: "Bedroom TV", macAddress: "11:22:33:44:55:66" }, storage);

  assert.equal(forgetHotspotDevice(key, "aa-bb-cc-dd-ee-ff", storage), true);
  assert.deepEqual(readSavedHotspotDevices(key, storage), [
    { name: "Bedroom TV", macAddress: "11:22:33:44:55:66" },
  ]);
});