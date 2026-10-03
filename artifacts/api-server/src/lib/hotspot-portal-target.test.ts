import assert from "node:assert/strict";
import test from "node:test";
import { selectUniqueActiveHotspotServer } from "./hotspot-portal-target.js";

test("automatically selects the only active Hotspot server", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "disabled", interface: "bridge-old", profile: "old", disabled: "yes" },
    { name: "main", interface: "come3-lan", profile: "default", disabled: "no" },
  ]);

  assert.equal(selection.selected?.name, "main");
  assert.deepEqual(selection.activeServers.map(server => server.interface), ["come3-lan"]);
});

test("an explicit interface matches exactly even when another active service exists", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
    { name: "guest", interface: "guest-vlan", profile: "guest" },
  ], "guest-vlan");

  assert.equal(selection.selected?.name, "guest");
  assert.equal(selection.candidates.length, 1);
});

test("automatic selection fails closed when there are multiple active Hotspot servers", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
    { name: "guest", interface: "guest-vlan", profile: "guest" },
  ]);

  assert.equal(selection.selected, null);
  assert.equal(selection.activeServers.length, 2);
});

test("an explicit interface with no matching active server remains unselected", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
  ], "co-hotspot-bridge");

  assert.equal(selection.selected, null);
  assert.equal(selection.candidates.length, 0);
});