import assert from "node:assert/strict";
import test from "node:test";
import {
  findHotspotAdminGrantMatches,
  hotspotAdminGrantExpiry,
  hotspotAdminGrantUsername,
  normalizeHotspotGrantMac,
  type HotspotAdminGrantCustomer,
  type HotspotAdminGrantPlanScope,
} from "./prepaid-hotspot-admin-grant.js";

const customer = (overrides: Partial<HotspotAdminGrantCustomer> = {}): HotspotAdminGrantCustomer => ({
  id: 4,
  name: "Mama Rose",
  phone: "254700000000",
  mac_address: "38:BE:AB:7F:16:A4",
  username: "254700000000",
  password: "stored-password",
  type: "hotspot",
  plan_id: 9,
  router_id: 23,
  port_id: null,
  status: "active",
  expires_at: "2026-12-01T00:00:00.000Z",
  ...overrides,
});

const plan = (overrides: Partial<HotspotAdminGrantPlanScope> = {}): HotspotAdminGrantPlanScope => ({
  id: 9,
  type: "hotspot",
  router_id: 23,
  port_id: null,
  ...overrides,
});

test("normalizes a device MAC and creates a stable router-specific Hotspot username", () => {
  assert.equal(normalizeHotspotGrantMac("38-be-ab-7f-16-a4"), "38:BE:AB:7F:16:A4");
  assert.equal(hotspotAdminGrantUsername(23, "38:BE:AB:7F:16:A4"), "tv2338beab7f16a4");
});

test("finds the existing same-device account instead of creating a duplicate", () => {
  const matches = findHotspotAdminGrantMatches(
    [customer()],
    [plan()],
    { routerId: 23, macAddress: "38:BE:AB:7F:16:A4", name: "Mama Rose" },
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchType, "device_and_name");
  assert.equal(matches[0].eligible, true);
});

test("blocks an existing record with a different device MAC or router binding", () => {
  const matches = findHotspotAdminGrantMatches(
    [
      customer({ id: 5, mac_address: "10:20:30:40:50:60" }),
      customer({ id: 6, name: "Different name", router_id: 24 }),
    ],
    [plan()],
    { routerId: 23, macAddress: "38:BE:AB:7F:16:A4", name: "Mama Rose" },
  );
  assert.equal(matches.length, 2);
  assert.ok(matches.every(match => !match.eligible));
  assert.ok(matches.some(match => /different device MAC/.test(match.reason ?? "")));
  assert.ok(matches.some(match => /different router/.test(match.reason ?? "")));
});

test("does not treat PPPoE or port-service accounts as eligible Hotspot targets", () => {
  const matches = findHotspotAdminGrantMatches(
    [customer({ type: "pppoe" }), customer({ id: 5, port_id: 8 })],
    [plan({ port_id: 8 })],
    { routerId: 23, macAddress: "38:BE:AB:7F:16:A4", name: "Mama Rose" },
  );
  assert.equal(matches.length, 2);
  assert.ok(matches.every(match => !match.eligible));
  assert.ok(matches.some(match => /not a standard Hotspot account/.test(match.reason ?? "")));
  assert.ok(matches.some(match => /port service/.test(match.reason ?? "")));
});

test("sets a fixed 30-day admin-grant expiry", () => {
  assert.equal(
    hotspotAdminGrantExpiry(Date.parse("2026-10-09T00:00:00.000Z")),
    "2026-11-08T00:00:00.000Z",
  );
});
