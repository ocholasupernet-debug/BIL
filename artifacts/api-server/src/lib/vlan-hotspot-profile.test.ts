import test from "node:test";
import assert from "node:assert/strict";
import { buildVlanHotspotProfileConfig } from "./vlan-hotspot-profile.js";

test("builds a VLAN HotSpot profile command without unsupported comment fields", () => {
  const config = buildVlanHotspotProfileConfig({
    name: "HS_PROFILE_RS7_VLAN20",
    gateway: "10.20.0.1",
    htmlDirectory: "flash/hotspot/ochola_RS7_VLAN20",
    dnsName: "goo.isplatty.org",
  });

  assert.deepEqual(config.addCommand, [
    "/ip/hotspot/profile/add",
    "=name=HS_PROFILE_RS7_VLAN20",
    "=hotspot-address=10.20.0.1",
    "=html-directory=flash/hotspot/ochola_RS7_VLAN20",
    "=dns-name=goo.isplatty.org",
    "=login-by=http-chap,http-pap,cookie",
  ]);
  assert.equal(config.addCommand.some(field => field.startsWith("=comment=")), false);
  assert.equal(Object.hasOwn(config.expectedProperties, "comment"), false);
});