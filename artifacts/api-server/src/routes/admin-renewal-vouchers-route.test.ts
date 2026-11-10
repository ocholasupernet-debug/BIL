import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";

test("voucher management endpoints require an active Super Admin session", async () => {
  const [{ default: adminVoucherRouter }, { default: billingRouter }] = await Promise.all([
    import("./admin-renewal-vouchers-route.js"),
    import("./billing-route.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", adminVoucherRouter);
  app.use("/api", billingRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    for (const path of [
      "/super-admin/admin-renewal-vouchers",
      "/super-admin/admin-renewal-vouchers/accounts",
    ]) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    assert.equal((await fetch(base + "/super-admin/admin-renewal-vouchers/1/revoke", { method: "POST" })).status, 401);
    assert.equal((await fetch(base + "/billing/vouchers/validate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "AR-TEST" }),
    })).status, 401);
    assert.equal((await fetch(base + "/billing/vouchers/redeem", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "AR-TEST" }),
    })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
