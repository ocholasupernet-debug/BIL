import assert from "node:assert/strict";
import { test } from "node:test";
import { transactionOwnerFilter } from "./transaction-account-scope.js";

test("ISP transaction scope excludes reseller-attributed transactions", () => {
  assert.equal(
    transactionOwnerFilter({ id: 41, parent_id: null, role: "isp_admin" }),
    "admin_id=eq.41&reseller_id=is.null",
  );
});

test("reseller transaction scope includes only its parent-tagged and legacy self-owned rows", () => {
  assert.equal(
    transactionOwnerFilter({ id: 83, parent_id: 41, role: "reseller" }),
    "or=(and(admin_id.eq.41,reseller_id.eq.83),and(admin_id.eq.83,reseller_id.is.null))",
  );
});

test("invalid or unsupported account scopes are rejected", () => {
  assert.equal(transactionOwnerFilter({ id: 83, parent_id: null, role: "reseller" }), null);
  assert.equal(transactionOwnerFilter({ id: 0, parent_id: null, role: "isp_admin" }), null);
  assert.equal(transactionOwnerFilter({ id: 83, parent_id: 41, role: "superadmin" }), null);
});