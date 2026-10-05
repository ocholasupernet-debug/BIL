import assert from "node:assert/strict";
import test from "node:test";
import {
  isSyncAccountExpired,
  isSyncAccountEntitled,
  reconcileRouterAccountForSync,
  routerSyncAccountIsConfirmed,
  syncUserDisplayStatus,
} from "./sync-user-reconciliation.js";

test("paid prepaid states remain entitled only until a valid expiry", () => {
  assert.equal(isSyncAccountEntitled("active", null, 1_000), true);
  assert.equal(isSyncAccountEntitled("active", "1970-01-01T00:00:02.000Z", 1_000), true);
  assert.equal(isSyncAccountEntitled("active", "1970-01-01T00:00:01.000Z", 1_000), false);
  assert.equal(isSyncAccountEntitled("payment_cleared_router_pending", "1970-01-01T00:00:02.000Z", 1_000), true);
  assert.equal(isSyncAccountEntitled("expired", "1970-01-01T00:00:02.000Z", 1_000), true);
  assert.equal(isSyncAccountEntitled("suspended", null, 1_000), false);
  assert.equal(isSyncAccountEntitled("expired", "1970-01-01T00:00:02.000Z", 1_000, "data_limit"), false);
  assert.equal(isSyncAccountEntitled("active", "not-a-date", 1_000), false);
});

test("sync expiry status follows the expiry timestamp except for explicit suspension", () => {
  assert.equal(isSyncAccountExpired("expired", null, 1_000), true);
  assert.equal(isSyncAccountExpired("active", "1970-01-01T00:00:01.000Z", 1_000), true);
  assert.equal(isSyncAccountExpired("active", "1970-01-01T00:00:02.000Z", 1_000), false);
  assert.equal(isSyncAccountExpired("payment_cleared_router_pending", "1970-01-01T00:00:02.000Z", 1_000), false);
  assert.equal(isSyncAccountExpired("expired", "1970-01-01T00:00:02.000Z", 1_000), false);
  assert.equal(isSyncAccountExpired("expired", "1970-01-01T00:00:02.000Z", 1_000, "data_limit"), true);
  assert.equal(isSyncAccountExpired("suspended", null, 1_000), false);
  assert.equal(isSyncAccountExpired("active", "not-a-date", 1_000), false);
});

test("a paid router-pending account follows the normal eligible reconciliation path", async () => {
  const eligible = isSyncAccountEntitled(
    "payment_cleared_router_pending",
    "1970-01-01T00:00:02.000Z",
    1_000,
  );
  const calls: string[] = [];
  const result = await reconcileRouterAccountForSync(eligible, {
    isOnline: async () => { calls.push("online"); return false; },
    push: async () => { calls.push("push"); },
    applyPolicy: async () => { calls.push("policy"); },
    disconnect: async () => { calls.push("disconnect"); },
    confirmActive: async () => { calls.push("confirm"); return true; },
  });
  assert.deepEqual(result, { action: "pushed", confirmedActive: true });
  assert.deepEqual(calls, ["online", "push", "policy", "confirm"]);
});

test("only a live router session is displayed as active; elapsed expiry always displays expired", () => {
  assert.equal(syncUserDisplayStatus(false, true, true), "active");
  assert.equal(syncUserDisplayStatus(false, true, false), null);
  assert.equal(syncUserDisplayStatus(false, false, true), null);
  assert.equal(syncUserDisplayStatus(true, true, true), "expired");
});

test("an entitled online account is verified but receives no sync mutations", async () => {
  const calls: string[] = [];
  const result = await reconcileRouterAccountForSync(true, {
    isOnline: async () => { calls.push("online"); return true; },
    push: async () => { calls.push("push"); },
    applyPolicy: async () => { calls.push("policy"); },
    disconnect: async () => { calls.push("disconnect"); },
    confirmActive: async () => { calls.push("confirm"); return true; },
  });
  assert.deepEqual(result, { action: "preserved-online", confirmedActive: true });
  assert.deepEqual(calls, ["online", "confirm"]);
});

test("an offline entitled account is pushed, policy-applied, then confirmed", async () => {
  const calls: string[] = [];
  const result = await reconcileRouterAccountForSync(true, {
    isOnline: async () => { calls.push("online"); return false; },
    push: async () => { calls.push("push"); },
    applyPolicy: async () => { calls.push("policy"); },
    disconnect: async () => { calls.push("disconnect"); },
    confirmActive: async () => { calls.push("confirm"); return true; },
  });
  assert.deepEqual(result, { action: "pushed", confirmedActive: true });
  assert.deepEqual(calls, ["online", "push", "policy", "confirm"]);
});

test("an ineligible account attempts disconnect even if the router update fails", async () => {
  const calls: string[] = [];
  await assert.rejects(
    reconcileRouterAccountForSync(false, {
      isOnline: async () => { calls.push("online"); return true; },
      push: async () => { calls.push("push"); throw new Error("set failed"); },
      applyPolicy: async () => { calls.push("policy"); },
      disconnect: async () => { calls.push("disconnect"); },
      confirmActive: async () => { calls.push("confirm"); return false; },
    }),
    /set failed/,
  );
  assert.deepEqual(calls, ["push", "policy", "disconnect"]);
});

test("RouterOS confirmation requires the expected username, plan profile, and enabled state", () => {
  assert.equal(routerSyncAccountIsConfirmed(
    { name: "alice", profile: "2-Hour", disabled: "false" },
    "alice",
    "2-Hour",
  ), true);
  assert.equal(routerSyncAccountIsConfirmed(
    { name: "alice", profile: "Other", disabled: "false" },
    "alice",
    "2-Hour",
  ), false);
  assert.equal(routerSyncAccountIsConfirmed(
    { name: "alice", profile: "2-Hour", disabled: "yes" },
    "alice",
    "2-Hour",
  ), false);
  assert.equal(routerSyncAccountIsConfirmed(
    { name: "alice", profile: "2-Hour" },
    "alice",
    "2-Hour",
  ), false);
  assert.equal(routerSyncAccountIsConfirmed(
    { name: "alice", profile: "2-Hour", disabled: "no" },
    "alice",
    "2-Hour",
  ), true);
});
