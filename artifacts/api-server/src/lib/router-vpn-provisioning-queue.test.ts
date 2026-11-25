import assert from "node:assert/strict";
import { test } from "node:test";
import { createManagementVpnPairScheduler } from "./router-vpn-provisioning.js";

const input = {
  routerId: 51,
  adminId: 8,
  routerName: "come3",
  routerIp: "10.8.5.51",
};

test("management VPN scheduling returns immediately, deduplicates, and reports readiness", async () => {
  let resolveProvisioning!: () => void;
  let calls = 0;
  const scheduler = createManagementVpnPairScheduler(() => {
    calls += 1;
    return new Promise<void>(resolve => {
      resolveProvisioning = resolve;
    });
  });

  assert.equal(scheduler.start(input).status, "pending");
  assert.equal(scheduler.start(input).status, "pending");
  assert.equal(calls, 1);
  assert.equal(scheduler.getStatus(input).status, "pending");

  resolveProvisioning();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.getStatus(input).status, "ready");
});

test("failed management VPN setup can be retried and stale router identity is not reported ready", async () => {
  let calls = 0;
  const scheduler = createManagementVpnPairScheduler(async () => {
    calls += 1;
    if (calls === 1) throw new Error("mock failure");
  });

  assert.equal(scheduler.start(input).status, "pending");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.getStatus(input).status, "failed");
  assert.equal(scheduler.start(input).status, "pending");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.getStatus(input).status, "ready");
  assert.equal(calls, 2);
  assert.equal(scheduler.getStatus({ ...input, routerName: "come4" }).status, "unknown");
});

test("a changed router identity waits for the in-flight setup instead of claiming it is ready", async () => {
  let resolveProvisioning!: () => void;
  let calls = 0;
  const scheduler = createManagementVpnPairScheduler(() => {
    calls += 1;
    return new Promise<void>(resolve => {
      resolveProvisioning = resolve;
    });
  });
  const renamed = { ...input, routerName: "come4" };

  assert.equal(scheduler.start(input).status, "pending");
  assert.equal(scheduler.start(renamed).status, "pending");
  assert.equal(calls, 1);

  resolveProvisioning();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.start(renamed).status, "pending");
  assert.equal(calls, 2);
});
