import assert from "node:assert/strict";
import test from "node:test";
import {
  hotspotTetherAddressListName,
  hotspotTetherGuardConfigForRouter,
  hotspotTetherRuleArgs,
  hotspotTetherRuleComment,
  parseHotspotTetherTtlValues,
} from "./hotspot-tether-guard.js";

test("tether guard defaults to common TTL values for every valid router during plan sync", () => {
  assert.deepEqual(hotspotTetherGuardConfigForRouter(12, {}), {
    mode: "enforce",
    ttlValues: [63, 127],
  });
  assert.deepEqual(hotspotTetherGuardConfigForRouter(99, {}), {
    mode: "enforce",
    ttlValues: [63, 127],
  });
  assert.equal(hotspotTetherGuardConfigForRouter(0, {}), null);
});

test("an explicit global disable enters cleanup mode on plan sync", () => {
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(12, { HOTSPOT_TETHER_GUARD_ENABLED: "false" }),
    { mode: "cleanup", ttlValues: [] },
  );
});

test("configured TTL values override defaults and malformed values fail closed to cleanup", () => {
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(12, { HOTSPOT_TETHER_GUARD_TTL_VALUES: "61,125,61,0,300" }),
    { mode: "enforce", ttlValues: [61, 125] },
  );
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(12, { HOTSPOT_TETHER_GUARD_TTL_VALUES: "0,300" }),
    { mode: "cleanup", ttlValues: [] },
  );
  assert.deepEqual(
    hotspotTetherGuardConfigForRouter(13, {
      HOTSPOT_TETHER_GUARD_ENABLED: "true",
      HOTSPOT_TETHER_GUARD_TTL_VALUES: "63,127,0,300,63",
    }),
    { mode: "enforce", ttlValues: [63, 127] },
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
