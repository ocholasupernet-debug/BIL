import test from "node:test";
import assert from "node:assert/strict";
import { planServicePoolName, portServiceResourceNames } from "./port-service-resources.js";

test("plan pool mapping uses the existing scoped service pools", () => {
  const resources = portServiceResourceNames({
    id: 12,
    router_id: 4,
    interface_name: "ether5",
    handoff_mode: "vlan_services",
    assigned_reseller_id: 9,
    vlan_tag: "210",
  });

  assert.equal(planServicePoolName("hotspot", resources), "HS_POOL_RS9_VLAN210");
  assert.equal(planServicePoolName("trials", resources), "HS_POOL_RS9_VLAN210");
  assert.equal(planServicePoolName("pppoe", resources), "PPPOE_POOL_RS9_VLAN210");
});

test("router-wide plans retain the installed default pool names", () => {
  assert.equal(planServicePoolName("hotspot"), "hotspot pool");
  assert.equal(planServicePoolName("pppoe"), "pppoe");
  assert.equal(planServicePoolName("static"), null);
});