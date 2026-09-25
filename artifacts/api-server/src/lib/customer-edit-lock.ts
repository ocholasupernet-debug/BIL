import { randomUUID } from "node:crypto";
import { sbRpc } from "./supabase-client.js";
import { logger } from "./logger.js";

export type CustomerEditLockStore = {
  acquire: (token: string, leaseMs: number) => Promise<boolean>;
  renew: (token: string, leaseMs: number) => Promise<boolean>;
  release: (token: string) => Promise<void>;
};
export type CustomerEditLockStoreFactory = (adminId: number, customerId: number) => CustomerEditLockStore;

export type CustomerEditLockOptions = {
  leaseMs?: number;
  renewEveryMs?: number;
  retryEveryMs?: number;
  acquireTimeoutMs?: number;
};

export class CustomerEditLockConflictError extends Error {
  constructor() {
    super("Another edit for this customer is in progress. Retry shortly.");
    this.name = "CustomerEditLockConflictError";
  }
}

export class CustomerEditLockLostError extends Error {
  constructor() {
    super("The customer edit lock could not be confirmed. Reload before retrying.");
    this.name = "CustomerEditLockLostError";
  }
}

/**
 * Creates a customer-keyed lock coordinator. The store provides the shared
 * lease while this coordinator also queues overlapping requests in one worker.
 */
export function createCustomerEditLockCoordinator(
  storeOrFactory: CustomerEditLockStore | CustomerEditLockStoreFactory,
  options: CustomerEditLockOptions = {},
) {
  const locks = new Map<string, Promise<void>>();
  const leaseMs = options.leaseMs ?? 90_000;
  const renewEveryMs = options.renewEveryMs ?? 20_000;
  const retryEveryMs = options.retryEveryMs ?? 250;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? 120_000;

  return async function withCustomerEditLock<T>(
    adminId: number,
    customerId: number,
    operation: (assertLock: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    if (!Number.isSafeInteger(adminId) || adminId < 1 || !Number.isSafeInteger(customerId) || customerId < 1) {
      throw new TypeError("Customer edit locks require positive safe-integer admin and customer IDs.");
    }

    const key = `${adminId}:${customerId}`;
    const previous = locks.get(key) ?? Promise.resolve();
    let releaseLocal!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const queued = previous.then(() => current);
    locks.set(key, queued);

    await previous;
    const store = typeof storeOrFactory === "function"
      ? storeOrFactory(adminId, customerId)
      : storeOrFactory;
    let token: string | undefined;
    let sharedLockAcquired = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatStopped = false;
    let lockLost = false;
    let renewalInFlight: Promise<boolean> | undefined;

    const assertLock = async (): Promise<void> => {
      if (lockLost || !sharedLockAcquired || !token) throw new CustomerEditLockLostError();
      try {
        if (!renewalInFlight) {
          renewalInFlight = store.renew(token, leaseMs).finally(() => {
            renewalInFlight = undefined;
          });
        }
        if (!await renewalInFlight) lockLost = true;
      } catch {
        lockLost = true;
      }
      if (lockLost) throw new CustomerEditLockLostError();
    };

    try {
      token = randomUUID();
      const deadline = Date.now() + acquireTimeoutMs;
      do {
        sharedLockAcquired = await store.acquire(token, leaseMs);
        if (sharedLockAcquired) break;
        if (Date.now() >= deadline) throw new CustomerEditLockConflictError();
        await new Promise((resolve) => setTimeout(resolve, retryEveryMs));
      } while (!sharedLockAcquired);

      const renewInBackground = async (): Promise<void> => {
        if (heartbeatStopped || lockLost) return;
        try {
          await assertLock();
        } catch {
          lockLost = true;
        }
        if (!heartbeatStopped && !lockLost) {
          heartbeatTimer = setTimeout(() => void renewInBackground(), renewEveryMs);
          heartbeatTimer.unref?.();
        }
      };
      heartbeatTimer = setTimeout(() => void renewInBackground(), renewEveryMs);
      heartbeatTimer.unref?.();

      const result = await operation(assertLock);
      await assertLock();
      return result;
    } finally {
      heartbeatStopped = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (renewalInFlight) await renewalInFlight.catch(() => false);
      try {
        if (sharedLockAcquired && token) await store.release(token);
      } catch (error) {
        logger.error(
          { adminId, customerId, error },
          "Customer edit lock release failed; the lease will expire automatically",
        );
      } finally {
        releaseLocal();
        if (locks.get(key) === queued) locks.delete(key);
      }
    }
  };
}

function expectRpcBoolean<T extends "acquired" | "renewed" | "released">(
  response: unknown,
  field: T,
  functionName: string,
): boolean {
  if (
    !Array.isArray(response)
    || response.length !== 1
    || response[0] === null
    || typeof response[0] !== "object"
    || typeof (response[0] as Record<string, unknown>)[field] !== "boolean"
  ) {
    throw new Error(`Supabase RPC ${functionName} returned an invalid response.`);
  }
  return (response[0] as Record<T, boolean>)[field];
}

function createSupabaseCustomerEditLockStore(adminId: number, customerId: number): CustomerEditLockStore {
  return {
    acquire: async (token, leaseMs) => {
      const response = await sbRpc<unknown>("acquire_isp_customer_edit_lock", {
        p_admin_id: adminId,
        p_customer_id: customerId,
        p_lease_token: token,
        p_lease_seconds: Math.ceil(leaseMs / 1000),
      });
      return expectRpcBoolean(response, "acquired", "acquire_isp_customer_edit_lock");
    },
    renew: async (token, leaseMs) => {
      const response = await sbRpc<unknown>("renew_isp_customer_edit_lock", {
        p_admin_id: adminId,
        p_customer_id: customerId,
        p_lease_token: token,
        p_lease_seconds: Math.ceil(leaseMs / 1000),
      });
      return expectRpcBoolean(response, "renewed", "renew_isp_customer_edit_lock");
    },
    release: async (token) => {
      const response = await sbRpc<unknown>("release_isp_customer_edit_lock", {
        p_admin_id: adminId,
        p_customer_id: customerId,
        p_lease_token: token,
      });
      if (!expectRpcBoolean(response, "released", "release_isp_customer_edit_lock")) {
        throw new Error("Supabase did not confirm release of the customer edit lease.");
      }
    },
  };
}

/**
 * Runs an edit while holding the renewable cross-worker lease for this ISP
 * customer. Call assertLock before irreversible external writes.
 */
const processCustomerEditLock = createCustomerEditLockCoordinator(createSupabaseCustomerEditLockStore);

export function withCustomerEditLock<T>(
  adminId: number,
  customerId: number,
  operation: (assertLock: () => Promise<void>) => Promise<T>,
): Promise<T> {
  return processCustomerEditLock(adminId, customerId, operation);
}