import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotTetherAddressListName,
  hotspotTetherGuardConfigForRouter,
  hotspotTetherRuleArgs,
  hotspotTetherRuleComment,
  parseHotspotTetherTtlValues,
} from "./hotspot-tether-guard.js";

test("tether guard is inert unless the router ID is explicitly allowlisted", () => {
  assert.equal(
    hotspotTetherGuardConfigForRouter(12, {
      HOTSPOT_TETHER_GUARD_ENABLED: "true",
      HOTSPOT_TETHER_GUARD_TTL_VALUES: "63,127",
    }),
    null,
  );
});

test("allowlisted router remains cleanup-only without explicit enablement and TTL values", () => {
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(12, {
      HOTSPOT_TETHER_GUARD_TEST_ROUTER_IDS: "12",
      HOTSPOT_TETHER_GUARD_ENABLED: "true",
      HOTSPOT_TETHER_GUARD_TTL_VALUES: "",
    }),
    { mode: "cleanup", ttlValues: [] },
  );
});

test("guard requires a validated TTL list and applies only to the test router", () => {
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(12, {
      HOTSPOT_TETHER_GUARD_TEST_ROUTER_IDS: "12,13",
      HOTSPOT_TETHER_GUARD_ENABLED: "true",
      HOTSPOT_TETHER_GUARD_TTL_VALUES: "63,127,0,300,63",
    }),
    { mode: "enforce", ttlValues: [63, 127] },
  );
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(14, {
      HOTSPOT_TETHER_GUARD_TEST_ROUTER_IDS: "12,13",
      HOTSPOT_TETHER_GUARD_ENABLED: "true",
      HOTSPOT_TETHER_GUARD_TTL_VALUES: "63,127",
    }),
    null,
  );
});

test("TTL parsing and RouterOS rules are deterministic and plan-scoped", () => {
  assert.deepEqual(parseHotspotTetherTtlValues("127,63,63,-1,256"), [63, 127]);
  assert.equal(hotspotTetherAddressListName(41), "osn_tether_block_41");
  assert.equal(hotspotTetherRuleComment(41, 63), "OSN_TETHER_GUARD:PLAN_41:TTL_63");
  assert.deepEqual(hotspotTetherRuleArgs(41, 63), [
    "/ip/firewall/filter/add",
    "=chain=forward",
    "=action=drop",
    "=src-address-list=osn_tether_block_41",
    "=ttl=equal:63",
    "=place-before=0",
    "=comment=OSN_TETHER_GUARD:PLAN_41:TTL_63",
  ]);
});
