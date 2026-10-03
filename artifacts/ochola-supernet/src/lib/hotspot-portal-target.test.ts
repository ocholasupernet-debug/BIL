import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotPortalTargets,
  nextHotspotPortalTarget,
  usesGeneratedHotspotPortal,
} from "./hotspot-portal-target";

const ports = [
  { id: 41, router_id: 3, hotspot_enabled: true, assigned_reseller_id: null },
  { id: 42, router_id: 3, hotspot_enabled: true, assigned_reseller_id: 19 },
  { id: 43, router_id: 3, hotspot_enabled: false, assigned_reseller_id: null },
];

test("ISP portal targets include only enabled ISP-owned services", () => {
  assert.deepEqual(hotspotPortalTargets(ports, false).map(port => port.id), [41]);
  assert.equal(nextHotspotPortalTarget("", ports, false), "41");
  assert.equal(nextHotspotPortalTarget("42", ports, false), "41");
  assert.equal(nextHotspotPortalTarget("41", ports, false), "41");
  assert.equal(nextHotspotPortalTarget("41", [], false), "");
});

test("resellers can still select a service before enabling its Hotspot", () => {
  assert.equal(nextHotspotPortalTarget("43", ports, true), "43");
});

test("switching routers cannot retain a stale assigned-port target", () => {
  assert.equal(nextHotspotPortalTarget("41", [
    { id: 54, router_id: 8, hotspot_enabled: true },
  ], false), "54");
});

test("generated service deployments preserve custom asset selections", () => {
  for (const path of ["login.html", "/hotspot/login.html", "hotspot", "rlogin.html"]) {
    assert.equal(usesGeneratedHotspotPortal(path), true);
  }
  for (const path of ["custom-login.html", "templates/custom.html", "login.html/../custom.html", ""]) {
    assert.equal(usesGeneratedHotspotPortal(path), false);
  }
});