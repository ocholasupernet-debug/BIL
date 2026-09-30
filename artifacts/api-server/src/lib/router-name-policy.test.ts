import assert from "node:assert/strict";
import test from "node:test";
import { isSafeRouterName, nextOrdinalRouterName, routerNameBase } from "./router-name-policy.js";

test("router name allocation normalizes tenant labels and skips occupied ordinals case-insensitively", () => {
  assert.equal(
    nextOrdinalRouterName("My Tenant", ["my-tenant1", "MY-TENANT2", "other1"]),
    "my-tenant3",
  );
});

test("router name allocation keeps generated names within the RouterOS limit", () => {
  const name = nextOrdinalRouterName("abcdefghijklmnopqrstuvwxyz123456789", []);
  assert.equal(routerNameBase("abcdefghijklmnopqrstuvwxyz123456789").length, 27);
  assert.equal(name.length, 28);
  assert.ok(isSafeRouterName(name));
});

test("router name allocation rejects tenants without a usable prefix", () => {
  assert.throws(() => nextOrdinalRouterName("!!!", []), /subdomain is required/i);
});