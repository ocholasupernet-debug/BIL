import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmployeeAdminHost,
  isStaffPortalHost,
  staffActivationUrl,
} from "./employee-hosts.js";

test("shared Staff host is canonical and the existing Super Admin .com host is preserved", () => {
  assert.equal(isEmployeeAdminHost("employee1088.isplatty.com"), true);
  assert.equal(isEmployeeAdminHost("employee1088.isplatty.org"), false);
  assert.equal(isStaffPortalHost("staff.isplatty.com"), true);
  assert.equal(isStaffPortalHost("jane.employees.isplatty.com"), false);
  assert.equal(isStaffPortalHost("employee1088.isplatty.com"), false);
});

test("Staff invitations use the shared .com host and a fragment token", () => {
  assert.equal(
    staffActivationUrl("A".repeat(43)),
    `https://staff.isplatty.com/staff/activate#token=${"A".repeat(43)}`,
  );
  assert.throws(() => staffActivationUrl("too-short"), /Invalid staff invitation token/);
});
