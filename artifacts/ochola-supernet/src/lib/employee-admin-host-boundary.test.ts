import assert from "node:assert/strict";
import test from "node:test";
import { shouldRedirectPlatformAdminToStaffFinance } from "./employee-admin-host-boundary.js";

test("the employee admin hostname does not render platform Super Admin routes", () => {
  assert.equal(
    shouldRedirectPlatformAdminToStaffFinance("employee1088.isplatty.com", "/super-admin/dashboard"),
    true,
  );
  assert.equal(
    shouldRedirectPlatformAdminToStaffFinance("EMPLOYEE1088.ISPLATTY.COM.", "/super-admin/login?reason=no_session"),
    true,
  );
});

test("the employee admin hostname preserves its Staff finance route", () => {
  assert.equal(
    shouldRedirectPlatformAdminToStaffFinance("employee1088.isplatty.com", "/employee/admin"),
    false,
  );
});

test("other hosts keep the platform Super Admin routes", () => {
  assert.equal(
    shouldRedirectPlatformAdminToStaffFinance("isplatty.com", "/super-admin/dashboard"),
    false,
  );
  assert.equal(
    shouldRedirectPlatformAdminToStaffFinance("isp.example.com", "/super-admin/login"),
    false,
  );
});
