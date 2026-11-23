import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeStaffUsername,
  parsePersonalizedStaffPath,
  personalizedStaffPath,
  personalizedStaffUrl,
  safeBrowserBackTarget,
  safeStaffReturnPath,
  staffNotFoundFallback,
} from "./staff-routes";

test("personal Staff paths are normalized and only accept supported sections", () => {
  assert.equal(personalizedStaffPath(" Chris-Staff ", "dashboard"), "/u/chris-staff/dashboard");
  assert.deepEqual(parsePersonalizedStaffPath("/u/chris-staff/learning"), {
    username: "chris-staff",
    section: "learning",
  });
  assert.equal(parsePersonalizedStaffPath("/u/chris-staff/admin"), null);
  assert.equal(normalizeStaffUsername("../other"), null);
  assert.equal(personalizedStaffUrl("Chris-Staff"), "https://staff.isplatty.com/u/chris-staff/dashboard");
});

test("login return path permits only same-host personalized Staff routes", () => {
  assert.equal(safeStaffReturnPath("?returnTo=%2Fu%2Fchris%2Fdashboard"), "/u/chris/dashboard");
  assert.equal(safeStaffReturnPath("?returnTo=https%3A%2F%2Fevil.example%2F"), null);
  assert.equal(safeStaffReturnPath("?returnTo=%2F%2Fevil.example%2F"), null);
  assert.equal(safeStaffReturnPath("?returnTo=%2Fadmin%2Fdashboard"), null);
  assert.equal(safeStaffReturnPath("?returnTo=%2Fu%2Fchris-staff%2Fdashboard%3Fnext%3D%2F"), null);
});

test("browser Back uses only a prior same-origin page and has host-specific fallbacks", () => {
  assert.equal(safeBrowserBackTarget("https://staff.isplatty.com/staff/login", "https://staff.isplatty.com", 2), true);
  assert.equal(safeBrowserBackTarget("https://external.example/", "https://staff.isplatty.com", 2), false);
  assert.equal(safeBrowserBackTarget("", "https://staff.isplatty.com", 1), false);
  assert.equal(staffNotFoundFallback("staff.isplatty.com"), "/staff/login");
  assert.equal(staffNotFoundFallback("employee1088.isplatty.com"), "/employee/admin");
  assert.equal(staffNotFoundFallback("isplatty.com"), "/");
});

test("router keeps personalized and legacy Staff/Technician paths registered", async () => {
  const appSource = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  for (const path of [
    "/staff/dashboard",
    "/staff/learning",
    "/u/:username/dashboard",
    "/u/:username/learning",
    "/dashboard",
    "/learning",
    "/technician",
    "/technician/learning",
    "/technician/dashboard",
    "/employee/admin/learning",
  ]) {
    assert.ok(appSource.includes(`<Route path="${path}"`), `Missing route: ${path}`);
  }
});

test("Technician dashboard alias uses its technician-only page guard", async () => {
  const appSource = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  const dashboardSource = await readFile(new URL("../technician/TechnicianDashboard.tsx", import.meta.url), "utf8");

  assert.ok(appSource.includes(
    '<Route path="/technician/dashboard" component={TechnicianDashboard} />',
  ));
  assert.match(
    dashboardSource,
    /employee\.accountType !== "technician"/,
  );
});
