import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import test from "node:test";

process.env.EMPLOYEE_PORTAL_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://employee-credit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-secret";

const { default: employeePortalRouter } = await import("./employee-portal-route.js");

test("credit and award-code routes deny unauthenticated admin and cross-origin redemption requests", async (t) => {
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

  const send = (method: "GET" | "POST", path: string, host: string, body?: Record<string, unknown>, origin?: string) =>
    new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path: `/api${path}`,
        method,
        headers: {
          host,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(origin ? { origin } : {}),
        },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }));
      });
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });

  const readAdmin = await send("GET", "/employee/admin/credits", "employee1088.isplatty.com");
  assert.equal(readAdmin.status, 401);

  const directCredit = await send(
    "POST", "/employee/admin/credits", "employee1088.isplatty.com",
    { employeeId: "00000000-0000-4000-8000-000000000001", amount: "100.00", reason: "Test credit", idempotencyKey: "credit-request-0001" },
    "https://employee1088.isplatty.com",
  );
  assert.equal(directCredit.status, 401);

  const issueAward = await send(
    "POST", "/employee/admin/award-codes", "employee1088.isplatty.com",
    { employeeId: "00000000-0000-4000-8000-000000000001", amount: "100.00", reason: "Test award", expiresAt: new Date(Date.now() + 86400000).toISOString(), idempotencyKey: "award-request-0001" },
    "https://employee1088.isplatty.com",
  );
  assert.equal(issueAward.status, 401);

  const crossOriginRedeem = await send(
    "POST", "/employee/award-codes/redeem", "staff.isplatty.com", { code: "ISPLAT-AWARD-invalid" },
    "https://attacker.invalid",
  );
  assert.equal(crossOriginRedeem.status, 403);

  const noSessionRedeem = await send(
    "POST", "/employee/award-codes/redeem", "staff.isplatty.com", { code: "ISPLAT-AWARD-invalid" },
    "https://staff.isplatty.com",
  );
  assert.equal(noSessionRedeem.status, 401);
});
