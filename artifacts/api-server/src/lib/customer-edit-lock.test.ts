import test from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerEditLockCoordinator,
  CustomerEditLockLostError,
  type CustomerEditLockStore,
} from "./customer-edit-lock.js";

const fastOptions = {
  leaseMs: 1_000,
  renewEveryMs: 10_000,
  retryEveryMs: 1,
  acquireTimeoutMs: 1_000,
};

test("independent workers serialize edits for the same ISP customer", async () => {
  let activeToken: string | null = null;
  const workerOne = createCustomerEditLockCoordinator(
    createSharedMockStore(),
    fastOptions,
  );
  const workerTwo = createCustomerEditLockCoordinator(
    createSharedMockStore(),
    fastOptions,
  );
  let releaseFirst!: () => void;
  let signalSecondAttempt!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondAttempt = new Promise<void>((resolve) => {
    signalSecondAttempt = resolve;
  });
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;

  const first = workerOne(7, 42, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push("first-start");
    await firstGate;
    order.push("first-end");
    active -= 1;
  });
  const second = workerTwo(7, 42, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push("second-start");
    active -= 1;
  });
  await secondAttempt;
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["first-start", "first-end", "second-start"]);

  function createSharedMockStore(): CustomerEditLockStore {
    return {
      acquire: async (token) => {
        if (activeToken) {
          signalSecondAttempt();
          return false;
        }
        activeToken = token;
        return true;
      },
      renew: async (token) => activeToken === token,
      release: async (token) => {
        if (activeToken === token) activeToken = null;
      },
    };
  }
});

test("fails the edit and releases when the lease cannot be renewed", async () => {
  let releaseCount = 0;
  const coordinator = createCustomerEditLockCoordinator({
    acquire: async () => true,
    renew: async () => false,
    release: async () => {
      releaseCount += 1;
    },
  }, fastOptions);

  await assert.rejects(
    coordinator(7, 42, async () => "edited"),
    CustomerEditLockLostError,
  );
  assert.equal(releaseCount, 1);
});