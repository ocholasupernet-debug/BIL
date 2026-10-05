import assert from "node:assert/strict";
import test from "node:test";
import { planBridgePortAddition } from "./bridge-port-assignment.js";

test("bridge assignment adds unassigned ports and skips ports already in the target", () => {
  assert.deepEqual(planBridgePortAddition("ether8", "hotspot-bridge", []), { action: "add" });
  assert.deepEqual(
    planBridgePortAddition("ether8", "hotspot-bridge", [
      { interface: "ether8", bridge: "hotspot-bridge", id: "*4" },
    ]),
    { action: "skip" },
  );
});

test("bridge assignment refuses a move without matching explicit source confirmation", () => {
  const current = [{ interface: "ether8", bridge: "bridge1", id: "*4" }];
  assert.throws(
    () => planBridgePortAddition("ether8", "hotspot-bridge", current),
    /explicitly confirm moving it/,
  );
  assert.throws(
    () => planBridgePortAddition("ether8", "hotspot-bridge", current, "bridge2"),
    /explicitly confirm moving it/,
  );
  assert.throws(
    () => planBridgePortAddition("ether8", "hotspot-bridge", [], "bridge1"),
    /changed since confirmation/,
  );
});

test("bridge assignment returns the live port ID only for a confirmed move", () => {
  assert.deepEqual(
    planBridgePortAddition(
      "ether8",
      "hotspot-bridge",
      [{ interface: "ether8", bridge: "bridge1", id: "*4" }],
      "bridge1",
    ),
    { action: "move", fromBridge: "bridge1", portId: "*4" },
  );
});

test("bridge assignment refuses ambiguous membership or an ID-less move", () => {
  assert.throws(
    () => planBridgePortAddition("ether8", "hotspot-bridge", [
      { interface: "ether8", bridge: "bridge1", id: "*4" },
      { interface: "ether8", bridge: "bridge2", id: "*5" },
    ], "bridge1"),
    /more than one bridge-port entry/,
  );
  assert.throws(
    () => planBridgePortAddition("ether8", "hotspot-bridge", [
      { interface: "ether8", bridge: "bridge1", id: "" },
    ], "bridge1"),
    /did not return a bridge-port ID/,
  );
});
