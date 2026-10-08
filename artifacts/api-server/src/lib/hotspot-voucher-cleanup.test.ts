import assert from "node:assert/strict";
import test from "node:test";
import {
  findManagedVoucherCopies,
  findUnmatchedManagedVoucherUsers,
  isManagedLegacyVoucherComment,
} from "./hotspot-voucher-cleanup.js";

test("managed voucher inventory requires the exact marker and a tenant voucher code", () => {
  const users = [
    { id: "*1", name: "SAVE20", comment: "Weekly voucher · legacy batch" },
    { id: "*2", name: "SAVE20", comment: "personal account" },
    { id: "*3", name: "OTHER", comment: "Weekly voucher · legacy batch" },
    { id: "*4", name: "SAVE20", comment: "voucher legacy batch" },
  ];

  assert.equal(isManagedLegacyVoucherComment("Weekly voucher · legacy batch"), true);
  assert.equal(isManagedLegacyVoucherComment("voucher legacy batch"), false);
  assert.deepEqual(findManagedVoucherCopies(users, new Set(["SAVE20"])), [users[0]]);
  assert.deepEqual(findUnmatchedManagedVoucherUsers(users, new Set(["SAVE20"])), [users[2]]);
});

test("a managed voucher user without a RouterOS item ID is inventoried but not removable", () => {
  const users = [{ id: "", name: "SAVE20", comment: "Weekly voucher · legacy batch" }];
  const matched = findManagedVoucherCopies(users, new Set(["SAVE20"]));

  assert.deepEqual(matched, users);
  assert.deepEqual(matched.filter(user => Boolean(user.id)), []);
});
