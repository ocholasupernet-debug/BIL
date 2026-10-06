import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeMoveConfirmationRequiredError,
  planPortServiceBridgeAddition,
  resolvePortServiceBridgeName,
  type PortServiceBridgeMembership,
} from "./port-service-bridge-move.js";

const foreignMembership: PortServiceBridgeMembership = {
  interfaceName: "ether8",
  bridgePortId: "*4",
  bridgeReference: "*16",
  bridgeName: "existing-lan",
};

test("RouterOS bridge references such as *16 are displayed as bridge names", () => {
  assert.equal(
    resolvePortServiceBridgeName("*16", [
      { id: "*16", name: "existing-lan" },
      { id: "*17", name: "service-bridge" },
    ]),
    "existing-lan",
  );
  assert.equal(
    resolvePortServiceBridgeName("existing-lan", [{ id: "*16", name: "existing-lan" }]),
    "existing-lan",
  );
  assert.equal(resolvePortServiceBridgeName("*99", []), null);
});

test("port service bridge assignment adds an unassigned interface and skips its target bridge", () => {
  assert.deepEqual(planPortServiceBridgeAddition("ether8", "service-bridge", []), { action: "add" });
  assert.deepEqual(
    planPortServiceBridgeAddition("ether8", "service-bridge", [
      { ...foreignMembership, bridgeReference: "*17", bridgeName: "service-bridge" },
    ]),
    { action: "skip" },
  );
});

test("a foreign bridge requires confirmation of its exact live RouterOS reference", () => {
  assert.throws(
    () => planPortServiceBridgeAddition("ether8", "service-bridge", [foreignMembership]),
    (error: unknown) => {
      assert.ok(error instanceof BridgeMoveConfirmationRequiredError);
      assert.equal(error.code, "BRIDGE_MOVE_CONFIRMATION_REQUIRED");
      assert.equal(error.sourceBridgeReference, "*16");
      assert.equal(error.sourceBridgeName, "existing-lan");
      return true;
    },
  );
  assert.throws(
    () => planPortServiceBridgeAddition("ether8", "service-bridge", [foreignMembership], "*17"),
    BridgeMoveConfirmationRequiredError,
  );
});

test("a confirmed foreign bridge move returns only the live membership ID", () => {
  assert.deepEqual(
    planPortServiceBridgeAddition("ether8", "service-bridge", [foreignMembership], "*16"),
    {
      action: "move",
      portId: "*4",
      fromBridgeReference: "*16",
      fromBridgeName: "existing-lan",
    },
  );
});

test("bridge move planner refuses duplicate or incomplete RouterOS memberships", () => {
  assert.throws(
    () => planPortServiceBridgeAddition("ether8", "service-bridge", [
      foreignMembership,
      { ...foreignMembership, bridgePortId: "*5", bridgeReference: "*17", bridgeName: "other" },
    ], "*16"),
    /multiple bridge-port entries/,
  );
  assert.throws(
    () => planPortServiceBridgeAddition("ether8", "service-bridge", [
      { ...foreignMembership, bridgePortId: "" },
    ], "*16"),
    /incomplete bridge membership/,
  );
});
