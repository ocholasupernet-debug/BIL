import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBridgePortMembership } from "./bridge-port-membership";

test("bridge port membership matches only when actual and desired ports are equal", () => {
  assert.deepEqual(
    compareBridgePortMembership(["ether2", "ether3"], ["ether3", "ether2"]),
    { matches: true, missing: [], unexpected: [] },
  );
});

test("bridge port membership reports missing and unexpected ports", () => {
  assert.deepEqual(
    compareBridgePortMembership(["ether2", "ether4"], ["ether2", "ether3"]),
    { matches: false, missing: ["ether3"], unexpected: ["ether4"] },
  );
});