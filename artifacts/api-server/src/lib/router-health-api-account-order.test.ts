import assert from "node:assert/strict";
import { test } from "node:test";
import { routerHealthApiAccountOrder } from "./router-health-api-account-order.js";

test("health checks prefer the management account and retain the saved username as fallback", () => {
  assert.deepEqual(routerHealthApiAccountOrder("alistwifi1", "10.8.5.16"), {
    username: "ocholasupernet",
    alternateUsernames: ["alistwifi1"],
  });
});

test("health checks keep the saved username for non-management router addresses", () => {
  assert.deepEqual(routerHealthApiAccountOrder("router-admin", "192.168.88.1"), {
    username: "router-admin",
  });
});

test("health checks use the management account without duplicating it as fallback", () => {
  assert.deepEqual(routerHealthApiAccountOrder("ocholasupernet", "10.8.5.16"), {
    username: "ocholasupernet",
  });
});
