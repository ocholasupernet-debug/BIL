import assert from "node:assert/strict";
import test from "node:test";
import { planBelongsToOwner, planOwnerFilter } from "./plan-ownership.js";

test("ISP packages have no reseller owner", () => {
  assert.equal(planOwnerFilter(null), "owner_reseller_id=is.null");
  assert.equal(planBelongsToOwner({ owner_reseller_id: null }, null), true);
  assert.equal(planBelongsToOwner({}, null), true);
  assert.equal(planBelongsToOwner({ owner_reseller_id: 12 }, null), false);
});

test("resellers only see packages owned by their account", () => {
  assert.equal(planOwnerFilter(12), "owner_reseller_id=eq.12");
  assert.equal(planBelongsToOwner({ owner_reseller_id: 12 }, 12), true);
  assert.equal(planBelongsToOwner({ owner_reseller_id: "12" }, 12), true);
  assert.equal(planBelongsToOwner({ owner_reseller_id: null }, 12), false);
  assert.equal(planBelongsToOwner({ owner_reseller_id: 13 }, 12), false);
  assert.throws(() => planOwnerFilter(0));
});