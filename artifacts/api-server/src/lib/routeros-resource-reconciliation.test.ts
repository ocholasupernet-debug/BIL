import test from "node:test";
import assert from "node:assert/strict";
import { routerResourceSetFields } from "./routeros-resource-reconciliation.js";

test("reconciles only changed RouterOS resource properties", () => {
  assert.deepEqual(
    routerResourceSetFields(
      { interface: "hotspot-bridge", "address-pool": "shared", disabled: "true", comment: "vlan-owned" },
      { interface: "vlan-reseller", "address-pool": "reseller-pool", disabled: "no", comment: "vlan-owned" },
    ),
    ["=interface=vlan-reseller", "=address-pool=reseller-pool", "=disabled=no"],
  );
});

test("treats RouterOS yes/no and true/false values as equivalent", () => {
  assert.deepEqual(
    routerResourceSetFields({ disabled: "false", enabled: "yes" }, { disabled: "no", enabled: "yes" }),
    [],
  );
});