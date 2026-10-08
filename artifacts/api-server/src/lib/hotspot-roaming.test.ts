import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizedRoamingRouterIds,
  canPlanRoamToService,
  classifyHotspotSessionService,
  hotspotRoamingUserServer,
  isDifferentHotspotService,
  matchingHotspotRoamingRule,
  sharedHotspotUsageAllowance,
  type HotspotRoamingRule,
} from "./hotspot-roaming.js";

const rules: HotspotRoamingRule[] = [
  { source_router_id: 1, source_port_id: 10, target_router_id: 2, target_port_id: 20, enabled: true },
  { source_router_id: 1, source_port_id: 10, target_router_id: 3, target_port_id: null, enabled: true },
  { source_router_id: 1, source_port_id: 11, target_router_id: 4, target_port_id: 40, enabled: false },
];

test("roaming matches explicit source and destination ports", () => {
  assert.equal(canPlanRoamToService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 20 },
    rules,
  ), true);
  assert.equal(canPlanRoamToService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 21 },
    rules,
  ), false);
});

test("roaming evidence returns the exact permission covering a source and destination", () => {
  const permission = { ...rules[0], id: 82 };
  assert.deepEqual(
    matchingHotspotRoamingRule(
      { type: "hotspot", router_id: 1, port_id: 10 },
      { routerId: 2, portId: 20 },
      [permission],
    ),
    permission,
  );
  assert.equal(
    matchingHotspotRoamingRule(
      { type: "hotspot", router_id: 1, port_id: 10 },
      { routerId: 2, portId: 21 },
      [permission],
    ),
    null,
  );
});

test("router-wide destination permission matches any port on that router", () => {
  assert.equal(canPlanRoamToService(
    { type: "trials", router_id: 1, port_id: 10 },
    { routerId: 3, portId: 35 },
    rules,
  ), true);
  assert.equal(canPlanRoamToService(
    { type: "hotspot", router_id: 1, port_id: 11 },
    { routerId: 3, portId: 35 },
    rules,
  ), false);
});

test("roaming is limited to hotspot service plans and enabled grants", () => {
  assert.equal(canPlanRoamToService(
    { type: "pppoe", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 20 },
    rules,
  ), false);
  assert.equal(canPlanRoamToService(
    { type: "hotspot", router_id: 1, port_id: 11 },
    { routerId: 4, portId: 40 },
    rules,
  ), false);
});

test("live Hotspot review distinguishes same service, allowed roaming, unapproved router, and unknown scope", () => {
  assert.equal(classifyHotspotSessionService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 1, portId: 10 },
    rules,
  ), "same-service");
  assert.equal(classifyHotspotSessionService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 20 },
    rules,
  ), "allowed-roaming");
  assert.equal(classifyHotspotSessionService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 21 },
    rules,
  ), "unapproved-router");
  assert.equal(classifyHotspotSessionService(
    { type: "pppoe", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 20 },
    rules,
  ), "unknown");
});

test("same-router port changes still require destination provisioning", () => {
  assert.equal(isDifferentHotspotService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 1, portId: 10 },
  ), false);
  assert.equal(isDifferentHotspotService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 1, portId: 11 },
  ), true);
  assert.equal(isDifferentHotspotService(
    { type: "hotspot", router_id: 1, port_id: 10 },
    { routerId: 2, portId: 10 },
  ), true);
});

test("same-MikroTik roaming users are server-neutral while cross-router users target the destination server", () => {
  assert.equal(hotspotRoamingUserServer(1, 1, "hs-ssid-2"), "all");
  assert.equal(hotspotRoamingUserServer(1, 2, "hs-ssid-2"), "hs-ssid-2");
  assert.equal(hotspotRoamingUserServer(1, 2, undefined), "all");
  assert.equal(hotspotRoamingUserServer(null, 2, "hs-ssid-2"), "hs-ssid-2");
});

test("usage scan includes the source and all enabled destination routers", () => {
  assert.deepEqual(authorizedRoamingRouterIds(
    { type: "hotspot", router_id: 1, port_id: 10 },
    rules,
  ), [1, 2, 3]);
});

test("shared package allowance translates global usage to a local RouterOS limit", () => {
  assert.deepEqual(sharedHotspotUsageAllowance(1_000, 700, 250), {
    remainingBytes: 300,
    targetRouterLimitBytes: 550,
    targetFupThresholdBytes: 550,
  });
  assert.equal(sharedHotspotUsageAllowance(1_000, 1_100, 200).remainingBytes, 0);
});
