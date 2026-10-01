import assert from "node:assert/strict";
import test from "node:test";
import { planIspResellerConnectionRemoval } from "./reseller-connection-removal.js";

test("deleting a pending request does not clear an account link or depend on handoff state", () => {
  assert.deepEqual(
    planIspResellerConnectionRemoval({
      status: "pending",
      ispAdminId: 7,
      currentParentId: 7,
      otherApprovedIspIds: [],
      hasNonDisabledHandoffs: true,
    }),
    {
      allowed: true,
      clearConnection: false,
      updateParent: false,
      nextParentId: 7,
    },
  );
});

test("clearing an approved connection is blocked while any handoff is not disabled", () => {
  const result = planIspResellerConnectionRemoval({
    status: "approved",
    ispAdminId: 7,
    currentParentId: 7,
    otherApprovedIspIds: [],
    hasNonDisabledHandoffs: true,
  });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.match(result.error, /handoffs before clearing/i);
});

test("clearing an approved connection restores the newest other approved ISP link", () => {
  assert.deepEqual(
    planIspResellerConnectionRemoval({
      status: "approved",
      ispAdminId: 7,
      currentParentId: 7,
      otherApprovedIspIds: [11, 13],
      hasNonDisabledHandoffs: false,
    }),
    {
      allowed: true,
      clearConnection: true,
      updateParent: true,
      nextParentId: 11,
    },
  );
});

test("clearing an approved request does not rewrite a different current parent", () => {
  assert.deepEqual(
    planIspResellerConnectionRemoval({
      status: "approved",
      ispAdminId: 7,
      currentParentId: 13,
      otherApprovedIspIds: [11],
      hasNonDisabledHandoffs: false,
    }),
    {
      allowed: true,
      clearConnection: true,
      updateParent: false,
      nextParentId: 13,
    },
  );
});