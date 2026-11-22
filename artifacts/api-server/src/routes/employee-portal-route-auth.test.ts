import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import test from "node:test";
import { hashEmployeeSecret } from "../lib/employee-portal-security.js";

process.env.EMPLOYEE_PORTAL_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://employee-portal-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-secret";

const { default: employeePortalRouter } = await import("./employee-portal-route.js");

test("Staff routes require an authenticated Super Admin or active Staff session", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const get = async (path: string, host: string, cookie?: string) => new Promise<{
    status: number;
    body: Record<string, unknown>;
  }>((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: `/api${path}`,
      method: "GET",
      headers: { host, ...(cookie ? { cookie } : {}) },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) as Record<string, unknown> });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });

  const admin = await get("/employee/admin/employees", "employee1088.isplatty.com");
  assert.equal(admin.status, 401);
  assert.equal(admin.body.error, "Super Admin authentication is required.");

  const adminStatus = await get("/employee/status", "employee1088.isplatty.com");
  assert.equal(adminStatus.body.portal, "admin");

  const staffStatus = await get("/employee/status", "staff.isplatty.com");
  assert.equal(staffStatus.body.portal, "staff");

  const obsoleteStaffStatus = await get("/employee/status", "jane.employees.isplatty.com");
  assert.equal(obsoleteStaffStatus.body.portal, "unmatched");

  const staffNoSession = await get("/employee/dashboard", "staff.isplatty.com");
  assert.equal(staffNoSession.status, 401);
  assert.equal(staffNoSession.body.error, "Staff sign-in is required.");

  const employeeWrongHost = await get(
    "/employee/dashboard",
    "employee1088.isplatty.org",
    "bil_employee_session=fake-session",
  );
  assert.equal(employeeWrongHost.status, 401);
  assert.equal(employeeWrongHost.body.error, "Staff sign-in is required.");

  const previousFetch = globalThis.fetch;
  const sessionToken = "test-session-for-another-employee";
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/employee_sessions?")) {
      return new Response(JSON.stringify([{
        id: "test-session",
        employee_id: "00000000-0000-4000-8000-000000000001",
        auth_version: 1,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/employee_profiles?")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected test Supabase request.");
  };
  try {
    const staffSession = await get(
      "/employee/dashboard",
      "staff.isplatty.com",
      `bil_employee_session=${sessionToken}`,
    );
    assert.equal(staffSession.status, 401);
    assert.equal(staffSession.body.error, "Staff session is no longer valid.");
    assert.ok(requestedUrls.some((url) =>
      url.includes(`token_hash=eq.${hashEmployeeSecret(sessionToken)}`),
    ));
    assert.ok(requestedUrls.some((url) => url.includes("status=eq.active")));
    assert.ok(requestedUrls.every((url) => !url.includes("subdomain=eq.")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
