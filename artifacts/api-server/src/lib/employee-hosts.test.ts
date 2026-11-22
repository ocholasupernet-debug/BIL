import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeInvitationUrl,
  employeeSubdomainForHost,
  isEmployeeAdminHost,
} from "./employee-hosts.js";

test("employee .com hosts are canonical and .org hosts remain compatible", () => {
  assert.equal(isEmployeeAdminHost("employee1088.isplatty.com"), true);
  assert.equal(isEmployeeAdminHost("employee1088.isplatty.org"), true);
  assert.equal(employeeSubdomainForHost("jane.employees.isplatty.com"), "jane");
  assert.equal(employeeSubdomainForHost("jane.employees.isplatty.org"), "jane");
  assert.equal(employeeSubdomainForHost("nested.jane.employees.isplatty.com"), null);
  assert.equal(employeeSubdomainForHost("not-employees.isplatty.com"), null);
});

test("new employee invitations always use the .com portal host", () => {
  assert.equal(
    employeeInvitationUrl("jane", "token with space"),
    "https://jane.employees.isplatty.com/employee/activate#token=token%20with%20space",
  );
  assert.throws(() => employeeInvitationUrl("bad.subdomain", "token"), /Invalid employee subdomain/);
});
