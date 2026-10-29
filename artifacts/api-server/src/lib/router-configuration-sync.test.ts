import test from "node:test";
import assert from "node:assert/strict";
import { buildRouterConfigurationSyncPlan } from "./router-configuration-sync.js";

test("disables active FastTrack rules and scopes TTL=1 rules to active Hotspot interfaces", () => {
  const plan = buildRouterConfigurationSyncPlan({
    hotspotInterfaces: [
      { name: "hs1", interface: "bridge-hotspot", disabled: "false" },
      { name: "hs2", interface: "vlan-hotspot", disabled: "false" },
      { name: "disabled", interface: "old-hotspot", disabled: "true" },
    ],
    filterRules: [
      { ".id": "*1", action: "fasttrack-connection", disabled: "false" },
      { ".id": "*2", action: "accept", disabled: "false" },
      { ".id": "*3", action: "fasttrack-connection", disabled: "true" },
    ],
    mangleRules: [],
  });

  assert.deepEqual(plan.hotspotInterfaces, ["bridge-hotspot", "vlan-hotspot"]);
  assert.deepEqual(plan.commands, [
    ["/ip/firewall/filter/disable", "=.id=*1"],
    ["/ip/firewall/mangle/add", "=chain=postrouting", "=action=change-ttl", "=new-ttl=set:1", "=out-interface=bridge-hotspot", "=place-before=0", "=comment=Block Hotspot Tethering - bridge-hotspot"],
    ["/ip/firewall/mangle/add", "=chain=postrouting", "=action=change-ttl", "=new-ttl=set:1", "=out-interface=vlan-hotspot", "=place-before=0", "=comment=Block Hotspot Tethering - vlan-hotspot"],
  ]);
});

test("does not duplicate matching TTL rules and enables a disabled managed rule", () => {
  const plan = buildRouterConfigurationSyncPlan({
    hotspotInterfaces: [{ interface: "bridge-hotspot", disabled: "false" }],
    filterRules: [],
    mangleRules: [
      { ".id": "*8", chain: "prerouting", action: "mark-connection", comment: "existing-rule", disabled: "false" },
      { ".id": "*9", chain: "postrouting", action: "change-ttl", "new-ttl": "set:1", "out-interface": "bridge-hotspot", comment: "Block Hotspot Tethering - bridge-hotspot", disabled: "true" },
    ],
  });
  assert.deepEqual(plan.commands, [
    ["/ip/firewall/mangle/enable", "=.id=*9"],
    ["/ip/firewall/mangle/move", "=.id=*9", "=destination=0"],
  ]);
});

test("reports, but does not modify, an unsafe global tethering TTL rule", () => {
  const plan = buildRouterConfigurationSyncPlan({
    hotspotInterfaces: [{ interface: "bridge-hotspot", disabled: "false" }],
    filterRules: [],
    mangleRules: [
      { ".id": "*4", chain: "postrouting", action: "change-ttl", "new-ttl": "set:1", comment: "Block Hotspot Tethering", disabled: "false" },
    ],
  });
  assert.deepEqual(plan.unsafeGlobalTtlComments, ["Block Hotspot Tethering"]);
  assert.deepEqual(plan.commands, []);
});
