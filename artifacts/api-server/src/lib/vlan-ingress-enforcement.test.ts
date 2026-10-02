import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceTaggedVlanIngress,
  planTaggedVlanIngressEnforcement,
  type TaggedIngressSnapshot,
} from "./vlan-ingress-enforcement.js";

function snapshot(): TaggedIngressSnapshot {
  return {
    bridges: [{
      ".id": "*1",
      name: "hotspot-bridge",
      "vlan-filtering": "false",
      pvid: "1",
      "frame-types": "admit-all",
    }],
    bridgePorts: [
      {
        ".id": "*2",
        interface: "ether4",
        bridge: "hotspot-bridge",
        disabled: "false",
        pvid: "1",
        "frame-types": "admit-all",
        "ingress-filtering": "true",
      },
      {
        ".id": "*3",
        interface: "wlan2",
        bridge: "hotspot-bridge",
        disabled: "false",
        pvid: "1",
        "frame-types": "admit-all",
      },
      {
        ".id": "*4",
        interface: "wlan3",
        bridge: "hotspot-bridge",
        disabled: "false",
        pvid: "1",
        "frame-types": "admit-all",
      },
    ],
    bridgeVlans: [
      { ".id": "*5", bridge: "hotspot-bridge", "vlan-ids": "20", tagged: "hotspot-bridge,ether4", untagged: "" },
      { ".id": "*6", bridge: "hotspot-bridge", "vlan-ids": "100", tagged: "hotspot-bridge,ether4", untagged: "" },
      { ".id": "*7", bridge: "hotspot-bridge", "vlan-ids": "200", tagged: "hotspot-bridge,ether4", untagged: "" },
      { ".id": "*8", bridge: "hotspot-bridge", "vlan-ids": "500", tagged: "hotspot-bridge,ether4", untagged: "" },
    ],
  };
}

test("plans tagged VLAN filtering while preserving native bridge ports and existing tagged VLANs", () => {
  const result = planTaggedVlanIngressEnforcement({
    bridgeName: "hotspot-bridge",
    ingressInterface: "ether4",
    vlanId: 20,
    snapshot: snapshot(),
  });

  assert.equal(result.previousFiltering, false);
  assert.equal(result.previousFrameTypes, "admit-all");
  assert.deepEqual(result.nativePvidPorts, ["wlan2", "wlan3"]);
  assert.deepEqual(result.staticVlanRows.map(row => row.vlanIds).sort(), ["100", "20", "200", "500"]);
  assert.equal(JSON.stringify(result).includes("mac-address"), false);
});

test("refuses to enable filtering when another active bridge port is not on native VLAN 1", () => {
  const current = snapshot();
  current.bridgePorts[1].pvid = "30";

  assert.throws(
    () => planTaggedVlanIngressEnforcement({
      bridgeName: "hotspot-bridge",
      ingressInterface: "ether4",
      vlanId: 20,
      snapshot: current,
    }),
    /not a verified native VLAN 1 port/,
  );
});

test("refuses to enable filtering when the saved VLAN is not a tagged trunk member", () => {
  const current = snapshot();
  current.bridgeVlans[0].untagged = "ether4";

  assert.throws(
    () => planTaggedVlanIngressEnforcement({
      bridgeName: "hotspot-bridge",
      ingressInterface: "ether4",
      vlanId: 20,
      snapshot: current,
    }),
    /must list both .* as tagged members/,
  );
});

test("enforces tagged-only ingress and verifies native VLAN 1 before returning success", async () => {
  const current = snapshot();
  const writes: string[][] = [];
  const result = await enforceTaggedVlanIngress({
    bridgeName: "hotspot-bridge",
    ingressInterface: "ether4",
    vlanId: 20,
    readState: async () => current,
    writeRouterCommand: async command => {
      writes.push(command);
      const id = command.find(value => value.startsWith("=.id="))?.slice("=.id=".length);
      for (const field of command.filter(value => value.startsWith("=") && !value.startsWith("=.id="))) {
        const separator = field.indexOf("=", 1);
        const key = field.slice(1, separator);
        const value = field.slice(separator + 1);
        if (command[0] === "/interface/bridge/port/set") {
          const row = current.bridgePorts.find(item => item[".id"] === id);
          if (row) row[key] = value;
        } else if (command[0] === "/interface/bridge/set") {
          const row = current.bridges.find(item => item[".id"] === id);
          if (row) row[key] = value;
          if (key === "vlan-filtering" && value === "yes") {
            current.bridgeVlans.push({
              ".id": "*9",
              bridge: "hotspot-bridge",
              "vlan-ids": "1",
              dynamic: "true",
              "current-untagged": "hotspot-bridge,wlan2,wlan3",
            });
          } else if (key === "vlan-filtering" && value === "no") {
            current.bridgeVlans = current.bridgeVlans.filter(row => row["vlan-ids"] !== "1");
          }
        }
      }
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.vlanFiltering, true);
  assert.equal(result.frameTypes, "admit-only-vlan-tagged");
  assert.deepEqual(result.nativePvidPorts, ["wlan2", "wlan3"]);
  assert.equal(writes[0][0], "/interface/bridge/port/set");
  assert.equal(writes[0].includes("=frame-types=admit-only-vlan-tagged"), true);
  assert.equal(writes[1][0], "/interface/bridge/set");
  assert.equal(writes[1].includes("=vlan-filtering=yes"), true);
});

test("rolls back bridge filtering and ingress properties when native membership verification fails", async () => {
  const current = snapshot();
  const writes: string[][] = [];

  await assert.rejects(
    enforceTaggedVlanIngress({
      bridgeName: "hotspot-bridge",
      ingressInterface: "ether4",
      vlanId: 20,
      readState: async () => current,
      writeRouterCommand: async command => {
        writes.push(command);
        const id = command.find(value => value.startsWith("=.id="))?.slice("=.id=".length);
        for (const field of command.filter(value => value.startsWith("=") && !value.startsWith("=.id="))) {
          const separator = field.indexOf("=", 1);
          const key = field.slice(1, separator);
          const value = field.slice(separator + 1);
          if (command[0] === "/interface/bridge/port/set") {
            const row = current.bridgePorts.find(item => item[".id"] === id);
            if (row) row[key] = value;
          } else if (command[0] === "/interface/bridge/set") {
            const row = current.bridges.find(item => item[".id"] === id);
            if (row) row[key] = value;
            if (key === "vlan-filtering" && value === "yes") {
              current.bridgeVlans.push({
                ".id": "*9",
                bridge: "hotspot-bridge",
                "vlan-ids": "1",
                dynamic: "true",
                "current-untagged": "hotspot-bridge,wlan2",
              });
            } else if (key === "vlan-filtering" && value === "no") {
              current.bridgeVlans = current.bridgeVlans.filter(row => row["vlan-ids"] !== "1");
            }
          }
        }
      },
    }),
    /Previous bridge and ingress settings were restored/,
  );

  assert.equal(current.bridges[0]["vlan-filtering"], "no");
  assert.equal(current.bridgePorts[0]["frame-types"], "admit-all");
  assert.equal(current.bridgePorts[0]["ingress-filtering"], "yes");
  assert.deepEqual(writes.slice(-2).map(command => command[0]), [
    "/interface/bridge/set",
    "/interface/bridge/port/set",
  ]);
});