import test from "node:test";
import assert from "node:assert/strict";
import {
  hotspotPlanProfileName,
  isPrepaidHotspotUsername,
  prepaidHotspotUsername,
} from "./prepaid-identifiers.js";

test("uses a distinct XX:XX suffix when a phone is reused", () => {
  const first = prepaidHotspotUsername("0712345678", "AA:BB:CC:DD:EE:FF", "G6:48");
  const second = prepaidHotspotUsername("0712345678", "AA:BB:CC:DD:EE:FF", "E9:01");

  assert.notEqual(first, second);
  assert.equal(first, "254712345678-G6:48");
  assert.equal(second, "254712345678-E9:01");
  assert.equal(isPrepaidHotspotUsername(first), true);
  assert.equal(isPrepaidHotspotUsername(second), true);
});

test("generates a random-looking suffix when none is supplied", () => {
  const username = prepaidHotspotUsername("0712345678", "AA:BB:CC:DD:EE:FF");
  assert.match(username, /^254712345678-[A-Z0-9]{2}:[A-Z0-9]{2}$/);
  assert.equal(isPrepaidHotspotUsername(username), true);
});

test("uses the same normalized profile name as plan sync", () => {
  assert.equal(hotspotPlanProfileName("  Night  10 Mbps "), "night-10-mbps");
  assert.notEqual(hotspotPlanProfileName("Night 10 Mbps"), "ochola-plan-23");
});

test("scopes equal plan names to their router and physical service", () => {
  assert.equal(
    hotspotPlanProfileName("Night 10 Mbps", 12, 34),
    "night-10-mbps-r12-p34",
  );
  assert.notEqual(
    hotspotPlanProfileName("Night 10 Mbps", 12, 34),
    hotspotPlanProfileName("Night 10 Mbps", 12, 35),
  );
  assert.notEqual(
    hotspotPlanProfileName("Night 10 Mbps", 12),
    hotspotPlanProfileName("Night 10 Mbps", 13),
  );
});