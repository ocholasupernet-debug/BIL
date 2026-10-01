import test from "node:test";
import assert from "node:assert/strict";
import { buildVlanHotspotServerConfig } from "./vlan-hotspot-server.js";

test("builds a VLAN HotSpot server command without unsupported comment fields", () => {
  const config = buildVlanHotspotServerConfig({
    name: "HS_RS7_VLAN20",
    interfaceName: "vlan20",
    profile: "HS_PROFILE_RS7_VLAN20",
    addressPool: "POOL_RS7_VLAN20_HS",
  });

  assert.deepEqual(config.addCommand, [
    "/ip/hotspot/add",
    "=name=HS_RS7_VLAN20",
    "=interface=vlan20",
    "=profile=HS_PROFILE_RS7_VLAN20",
    "=address-pool=POOL_RS7_VLAN20_HS",
    "=disabled=no",
  ]);
  assert.equal(config.addCommand.some(field => field.startsWith("=comment=")), false);
  assert.equal(Object.hasOwn(config.expectedProperties, "comment"), false);
});