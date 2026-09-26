import assert from "node:assert/strict";
import test from "node:test";
import {
  isManagedResetComment,
  isManagedResetItem,
  isManagedResetPath,
} from "./mikrotik.js";

test("managed reset accepts only exact router service tags", () => {
  assert.equal(isManagedResetComment("ochola-services-42 owned pool", 42), true);
  assert.equal(isManagedResetComment("ochola-coexist-42-owned bridge", 42), true);
  assert.equal(isManagedResetComment("ochola-services-420 owned pool", 42), false);
  assert.equal(isManagedResetComment("prefix ochola-services-42 owned pool", 42), false);
  assert.equal(isManagedResetComment("ochola-services-42x owned pool", 42), false);
});

test("managed reset excludes access and management markers", () => {
  const base = { ".id": "*1", name: "customer-pool", comment: "ochola-services-42 owned pool" };
  assert.equal(isManagedResetItem(base, "/ip/pool", 42), true);
  for (const marker of ["API", "VPN", "management", "mainbillingvpn", "certificate", "DO NOT DELETE", "failover", "VPS tunnel"]) {
    assert.equal(
      isManagedResetItem({ ...base, comment: `ochola-services-42 ${marker}` }, "/ip/pool", 42),
      false,
      marker,
    );
  }
});

test("managed reset path allowlist excludes network and access paths", () => {
  assert.equal(isManagedResetPath("/ip/pool"), true);
  assert.equal(isManagedResetPath("/queue/simple"), true);
  assert.equal(isManagedResetPath("/ip/firewall/filter"), false);
  assert.equal(isManagedResetPath("/interface/ovpn-client"), false);
  assert.equal(isManagedResetPath("/ip/address"), false);
});