import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const portalUrl = new URL("../../ochola-supernet/public/hotspot/login.html", import.meta.url);
const portalHtml = readFileSync(portalUrl, "utf8");
const helperStart = portalHtml.indexOf("function tvSavedDevicesStorageKey(){");
const helperEnd = portalHtml.indexOf("function useSavedTvDevice(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "saved-device storage helpers must remain extractable");
const helperSource = portalHtml.slice(helperStart, helperEnd);

function createHarness({ host = "portal.example", adminId = 3, routerId = 11, portId = 4 } = {}) {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
  const context = {
    window: { location: { host }, localStorage: storage },
    PORTAL_ADMIN_ID: adminId,
    PORTAL_ROUTER_ID: routerId,
    PORTAL_PORT_ID: portId,
    normaliseMac(value) {
      const compact = String(value || "").toUpperCase().replace(/[^A-F0-9]/g, "");
      return /^[A-F0-9]{12}$/.test(compact) ? compact.match(/.{2}/g).join(":") : "";
    },
  };
  runInNewContext(
    `${helperSource}\nglobalThis.savedDeviceApi = { key: tvSavedDevicesStorageKey, read: readSavedTvDevices, save: saveSavedTvDevice, rename: renameSavedTvDevice, forget: forgetSavedTvDevice };`,
    context,
  );
  return {
    api: context.savedDeviceApi,
    storage,
    plain(value) {
      return JSON.parse(JSON.stringify(value));
    },
  };
}

test("RouterOS saved-device storage is scoped to portal host, ISP, router, and port", () => {
  const first = createHarness();
  const otherHost = createHarness({ host: "other.example" });
  const otherRouter = createHarness({ routerId: 12 });
  const otherPort = createHarness({ portId: 5 });

  assert.equal(first.api.key(), "ochola_hotspot_devices_v1:portal.example:3:11:4");
  assert.notEqual(first.api.key(), otherHost.api.key());
  assert.notEqual(first.api.key(), otherRouter.api.key());
  assert.notEqual(first.api.key(), otherPort.api.key());
});

test("RouterOS saved devices normalize, cap, rename, and remove browser-local records", () => {
  const { api, storage, plain } = createHarness();
  for (let i = 0; i < 25; i += 1) {
    const suffix = i.toString(16).padStart(2, "0");
    assert.equal(api.save(`00:00:00:00:00:${suffix}`.replaceAll(":", "-"), `  TV   ${i}  `), true);
  }

  const devices = plain(api.read());
  assert.equal(devices.length, 20);
  assert.deepEqual(devices[0], { name: "TV 24", macAddress: "00:00:00:00:00:18" });
  assert.deepEqual(devices[19], { name: "TV 5", macAddress: "00:00:00:00:00:05" });

  assert.equal(api.rename("00-00-00-00-00-18", "  Family   Room TV "), true);
  assert.equal(api.rename("00:00:00:00:00:18", "   "), false);
  assert.equal(api.rename("AA:BB:CC:DD:EE:FF", "Unknown"), false);
  assert.deepEqual(plain(api.read())[0], { name: "Family Room TV", macAddress: "00:00:00:00:00:18" });

  assert.equal(api.forget("00-00-00-00-00-18"), true);
  assert.equal(plain(api.read()).some(device => device.macAddress === "00:00:00:00:00:18"), false);
  const storedRows = JSON.parse(storage.getItem(api.key()));
  assert.equal(Object.keys(storedRows[0]).sort().join(","), "macAddress,name");
});

test("RouterOS purchase modal exposes saved-device selection, rename, removal, and an opt-in remember control", () => {
  assert.match(portalHtml, /Saved on this browser/);
  assert.match(portalHtml, /data-tv-saved-use/);
  assert.match(portalHtml, /data-tv-saved-rename/);
  assert.match(portalHtml, /data-tv-saved-remove/);
  assert.match(portalHtml, /Remember this TV on this browser/);
  assert.match(portalHtml, /saveSavedTvDevice\(DEVICE_MAC\|\|tvMacAddress,tvDeviceName\)/);
});