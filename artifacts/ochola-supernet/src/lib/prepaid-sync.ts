import { getCustomerServiceStatus } from "./customer-service-status";
import { purchaseUsername } from "./prepaid-live-presence";
import type { PrepaidSyncResult } from "../components/ui/PrepaidSyncReport";

interface SyncCustomer {
  id: number;
  type?: string | null;
  status?: string | null;
  expires_at?: string | null;
  depletion_reason?: string | null;
  router_id?: number | null;
  plan_id?: number | null;
  username?: string | null;
  pppoe_username?: string | null;
  password?: string | null;
  mac_address?: string | null;
  ip_address?: string | null;
  fup_limit_mb?: number | null;
}
interface SyncPlan {
  id: number;
  name: string;
  router_id?: number | null;
  speed_down?: number;
  speed_up?: number;
  speed_down_unit?: string;
  speed_up_unit?: string;
  data_limit_mb?: number | null;
}
export interface PrepaidSyncRun {
  ok: boolean;
  total: number;
  processed: number;
  users: PrepaidSyncResult[];
  error?: string;
}

/** One user-facing operation; bounded requests protect the MikroTik API. */
export async function syncActiveAccountsToRouter(options: {
  router: { id: number; name: string };
  users: SyncCustomer[];
  plans: SyncPlan[];
  endpoint: string;
  adminId: number;
  token: string;
  request?: typeof fetch;
  onProgress?: (total: number, processed: number, users: PrepaidSyncResult[]) => void;
  onLog?: (message: string) => void;
}): Promise<PrepaidSyncRun> {
  const { router, plans } = options;
  const planMap = new Map(plans.map(plan => [plan.id, plan]));
  const eligible = [...new Map(options.users.filter(user =>
    String(user.type).toLowerCase() !== "vlan"
    && getCustomerServiceStatus(user) === "active"
    && Number(user.router_id ?? planMap.get(Number(user.plan_id))?.router_id) === router.id,
  ).map(user => [user.id, user])).values()];
  const results: PrepaidSyncResult[] = [];
  const total = eligible.length;
  let processed = 0;
  let error: string | undefined;
  const progress = () => options.onProgress?.(total, processed, [...results]);
  const rowFor = (user: SyncCustomer): PrepaidSyncResult => ({
    customerId: user.id,
    username: purchaseUsername(user),
    planName: planMap.get(Number(user.plan_id))?.name || "No assigned plan",
    serviceType: user.type || "hotspot",
    routerName: router.name,
    outcome: "unknown",
    message: "MikroTik did not return a verified result for this account.",
  });
  progress();
  for (let offset = 0; offset < total; offset += 5) {
    const chunk = eligible.slice(offset, offset + 5);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await (options.request ?? fetch)(options.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({
          adminId: options.adminId,
          routerId: router.id,
          activeOnly: true,
          users: chunk.map(user => {
            const plan = planMap.get(Number(user.plan_id));
            return {
              customer_id: user.id, router_id: router.id,
              username: purchaseUsername(user), password: user.password || "",
              type: user.type || "hotspot", status: user.status,
              plan_id: user.plan_id || undefined, plan_name: plan?.name || "",
              mac_address: user.mac_address || undefined,
              ip_address: user.ip_address || undefined,
              speed_down: plan?.speed_down, speed_up: plan?.speed_up,
              speed_down_unit: plan?.speed_down_unit || "Mbps",
              speed_up_unit: plan?.speed_up_unit || "Mbps",
              data_limit_mb: user.fup_limit_mb ?? plan?.data_limit_mb,
              expires_at: user.expires_at || undefined,
            };
          }),
        }),
      });
      const data = await response.json() as {
        ok?: boolean; error?: string; logs?: string[]; syncResults?: PrepaidSyncResult[];
      };
      if (Array.isArray(data.logs)) data.logs.forEach(line => options.onLog?.(line));
      // Retain confirmed rows even when a connection fails partway through a request.
      for (const user of chunk) {
        const row = rowFor(user);
        const confirmed = data.syncResults?.find(result =>
          result.customerId === user.id && result.username === row.username,
        );
        results.push(confirmed && ["synced", "failed", "skipped", "unknown"].includes(confirmed.outcome)
          ? { ...row, ...confirmed }
          : row);
      }
      processed += chunk.length;
      progress();
      if (data.ok !== true) {
        error = data.error || "Some accounts could not be fully synchronized or confirmed.";
      }
      if (!response.ok || (data.ok !== true && results.slice(-chunk.length).some(row => row.outcome === "unknown"))) {
        error = data.error || "Sync stopped before MikroTik could confirm every account.";
        break;
      }
    } catch (cause) {
      error = cause instanceof Error && cause.name === "AbortError"
        ? "MikroTik took too long to confirm the sync. Some changes may have applied; refresh before retrying."
        : cause instanceof Error ? cause.message : "The sync connection was interrupted.";
      break;
    } finally {
      clearTimeout(timeout);
    }
  }
  const recorded = new Set(results.map(row => row.customerId));
  for (const user of eligible) {
    if (!recorded.has(user.id)) results.push({
      ...rowFor(user),
      message: "Not confirmed because the sync was interrupted. No automatic retry was sent.",
    });
  }
  return { ok: !error && results.every(row => row.outcome === "synced"), total, processed, users: results, ...(error ? { error } : {}) };
}
