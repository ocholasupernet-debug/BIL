import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouterUserSnapshotPayload } from "./router-user-snapshot-service.js";
import { buildRouterImportPreview } from "./router-user-import-service.js";

test("import preview is password-free, allows safe PPPoE and Hotspot replacements, and blocks ambiguous conflicts", () => {
  const snapshot: RouterUserSnapshotPayload = {
    version: 2,
    routerId: 7,
    routerName: "edge-7",
    capturedAt: "2026-10-02T08:00:00.000Z",
    pppSecrets: [
      {
        id: "*1",
        name: "existing-customer",
        password: "private-pppoe-password",
        service: "pppoe",
        profile: "standard",
        localAddress: "",
        remoteAddress: "10.0.0.8",
        callerId: "",
        disabled: false,
        comment: "",
      },
      {
        id: "*2",
        name: "unsupported-user",
        password: "private-unsupported-password",
        service: "l2tp",
        profile: "standard",
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        disabled: false,
        comment: "",
      },
      {
        id: "*3",
        name: "same-name",
        password: "private-duplicate-password",
        service: "any",
        profile: "standard",
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        disabled: false,
        comment: "",
      },
      {
        id: "*7",
        name: "wrong-service",
        password: "private-wrong-service-password",
        service: "pppoe",
        profile: "standard",
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        disabled: false,
        comment: "",
      },
      {
        id: "*8",
        name: "radius-only",
        password: "private-radius-only-password",
        service: "pppoe",
        profile: "standard",
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        disabled: false,
        comment: "",
      },
      {
        id: "*10",
        name: "no-version",
        password: "private-no-version-password",
        service: "pppoe",
        profile: "standard",
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        disabled: false,
        comment: "",
      },
    ],
    hotspotUsers: [
      {
        id: "*4",
        name: "SAME-NAME",
        password: "private-hotspot-password",
        profile: "public",
        comment: "",
        macAddress: "AA:BB:CC:DD:EE:FF",
        server: "hotspot1",
        disabled: false,
        limitUptime: "",
        limitBytesTotal: 2_000,
        bytesIn: 1_250,
        bytesOut: 750,
      },
      {
        id: "*9",
        name: "existing-hotspot",
        password: "private-existing-hotspot-password",
        profile: "public",
        comment: "",
        macAddress: "AA:BB:CC:DD:EE:01",
        server: "hotspot1",
        disabled: false,
        limitUptime: "",
        limitBytesTotal: 0,
        bytesIn: 0,
        bytesOut: 0,
      },
    ],
    pppProfiles: [{
      id: "*5",
      name: "standard",
      localAddress: "local-pool",
      remoteAddress: "ppp-pool",
      rateLimit: "10M/2M",
      sessionTimeout: "",
      idleTimeout: "",
      onlyOne: true,
      comment: "PPP profile",
    }],
    hotspotProfiles: [{
      id: "*6",
      name: "public",
      rateLimit: "5M/1M",
      sharedUsers: 2,
      sessionTimeout: "1d",
      idleTimeout: "5m",
      keepaliveTimeout: "",
      statusAutorefresh: "",
      macCookieTimeout: "",
      comment: "Hotspot profile",
    }],
  };

  const preview = buildRouterImportPreview(
    snapshot,
    7,
    "edge-7",
    snapshot.capturedAt,
    [{
      id: 31,
      admin_id: 42,
      type: "pppoe",
      name: "Current subscriber",
      phone: "+254700000001",
      username: "existing-customer",
      pppoe_username: "existing-customer",
      router_id: 7,
      updated_at: "2026-10-02T07:00:00.000Z",
      passwordAvailable: true,
    }, {
      id: 32,
      admin_id: 42,
      type: "hotspot",
      name: "Different service type",
      phone: "+254700000002",
      username: "wrong-service",
      pppoe_username: null,
      router_id: 7,
      updated_at: "2026-10-02T07:00:00.000Z",
      passwordAvailable: false,
    }, {
      id: 33,
      admin_id: 42,
      type: "hotspot",
      name: "Existing Hotspot account",
      phone: "+254700000003",
      username: "existing-hotspot",
      pppoe_username: null,
      router_id: 7,
      updated_at: "2026-10-02T07:00:00.000Z",
      passwordAvailable: true,
    }, {
      id: 34,
      admin_id: 42,
      type: "pppoe",
      name: "Legacy without update time",
      phone: "+254700000004",
      username: "no-version",
      pppoe_username: "no-version",
      router_id: 7,
      updated_at: null,
      passwordAvailable: false,
    }],
    ["radius-only"],
    [],
    42,
  );

  const existing = preview.users.find(user => user.username === "existing-customer");
  const unsupported = preview.users.find(user => user.username === "unsupported-user");
  const duplicatePpp = preview.users.find(user => user.username === "same-name");
  const duplicateHotspot = preview.users.find(user => user.username === "SAME-NAME");
  const wrongService = preview.users.find(user => user.username === "wrong-service");
  const radiusOnly = preview.users.find(user => user.username === "radius-only");
  const existingHotspot = preview.users.find(user => user.username === "existing-hotspot");
  const missingVersion = preview.users.find(user => user.username === "no-version");
  assert.equal(existing?.duplicate, true);
  assert.equal(existing?.replaceable, true);
  assert.equal(existing?.existingCustomerId, 31);
  assert.equal(existing?.existingCustomerName, "Current subscriber");
  assert.equal(existing?.passwordAvailable, true);
  assert.equal(existingHotspot?.duplicate, true);
  assert.equal(existingHotspot?.replaceable, true);
  assert.equal(existingHotspot?.existingCustomerId, 33);
  assert.equal(unsupported?.supported, false);
  assert.equal(duplicatePpp?.duplicate, true);
  assert.equal(duplicatePpp?.replaceable, false);
  assert.equal(duplicateHotspot?.duplicate, true);
  assert.equal(duplicateHotspot?.replaceable, false);
  assert.equal(duplicateHotspot?.quotaReached, true);
  assert.equal(wrongService?.duplicate, true);
  assert.equal(wrongService?.replaceable, false);
  assert.equal(radiusOnly?.duplicate, true);
  assert.equal(radiusOnly?.replaceable, false);
  assert.equal(missingVersion?.duplicate, true);
  assert.equal(missingVersion?.replaceable, false);
  assert.equal(preview.profiles.length, 2);
  assert.equal(preview.profiles.find(profile => profile.name === "public")?.sharedUsers, 2);

  const serializedPreview = JSON.stringify(preview);
  for (const password of [
    "private-pppoe-password",
    "private-unsupported-password",
    "private-duplicate-password",
    "private-hotspot-password",
    "private-wrong-service-password",
    "private-radius-only-password",
    "private-existing-hotspot-password",
    "private-no-version-password",
  ]) {
    assert.equal(serializedPreview.includes(password), false);
  }
});