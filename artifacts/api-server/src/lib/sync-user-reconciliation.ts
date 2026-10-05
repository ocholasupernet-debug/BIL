import {
  isPrepaidCustomerEntitled,
  isPrepaidCustomerExpired,
} from "./prepaid-entitlement.js";

export interface RouterSyncAccount {
  name?: string;
  profile?: string;
  disabled?: string | boolean;
}

export interface RouterSyncAccountOperations {
  isOnline(): Promise<boolean>;
  push(): Promise<void>;
  applyPolicy(): Promise<void>;
  disconnect(): Promise<void>;
  confirmActive(): Promise<boolean>;
}

export type RouterSyncAccountResult = {
  action: "preserved-online" | "pushed" | "disabled";
  confirmedActive: boolean;
};

export function isSyncAccountEntitled(
  status: unknown,
  expiresAt: unknown,
  now = Date.now(),
  depletionReason?: unknown,
): boolean {
  return isPrepaidCustomerEntitled(status ?? "active", expiresAt, depletionReason, now);
}

export function isSyncAccountExpired(
  status: unknown,
  expiresAt: unknown,
  now = Date.now(),
  depletionReason?: unknown,
): boolean {
  return isPrepaidCustomerExpired(status, expiresAt, depletionReason, now);
}

export function syncUserDisplayStatus(
  expired: boolean,
  routerAccountEnabled: boolean,
  hasActiveSession: boolean,
): "active" | "expired" | null {
  if (expired) return "expired";
  return routerAccountEnabled && hasActiveSession ? "active" : null;
}

export function routerSyncAccountIsConfirmed(
  row: RouterSyncAccount | undefined,
  username: string,
  expectedProfile: string,
): boolean {
  if (!row || row.name !== username || row.profile !== expectedProfile) return false;
  if (typeof row.disabled === "boolean") return !row.disabled;
  const disabled = String(row.disabled ?? "").trim().toLowerCase();
  return ["false", "no", "0"].includes(disabled);
}

/**
 * Keep an entitled live session completely untouched. Offline eligible
 * accounts are pushed and verified; ineligible accounts still attempt all
 * disable/cleanup/disconnect steps so a failed account update cannot prevent
 * a required session removal.
 */
export async function reconcileRouterAccountForSync(
  eligible: boolean,
  operations: RouterSyncAccountOperations,
): Promise<RouterSyncAccountResult> {
  if (eligible && await operations.isOnline()) {
    return {
      action: "preserved-online",
      confirmedActive: await operations.confirmActive(),
    };
  }

  if (eligible) {
    await operations.push();
    await operations.applyPolicy();
    return {
      action: "pushed",
      confirmedActive: await operations.confirmActive(),
    };
  }

  const errors: string[] = [];
  for (const operation of [operations.push, operations.applyPolicy, operations.disconnect]) {
    try {
      await operation();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Could not fully disable/disconnect this router account: ${errors.join("; ")}`);
  }
  return { action: "disabled", confirmedActive: false };
}
