import test from "node:test";
import assert from "node:assert/strict";
import {
  isPrepaidHotspotUsername,
  prepaidHotspotUsername,
} from "./prepaid-identifiers.js";

test("adds a unique suffix when a phone and device are reused", () => {
  const first = prepaidHotspotUsername("0712345678", "AA:BB:CC:DD:EE:FF", 101);
  const second = prepaidHotspotUsername("0712345678", "AA:BB:CC:DD:EE:FF", 102);

  assert.notEqual(first, second);
  assert.equal(first, "254712345678-EE:FF-101");
  assert.equal(second, "254712345678-EE:FF-102");
  assert.equal(isPrepaidHotspotUsername(first), true);
  assert.equal(isPrepaidHotspotUsername(second), true);
});