import { logger } from "../lib/logger.js";
import {
  sbSelectStrict,
  supabaseServiceRoleConfigured,
} from "../lib/supabase-client.js";
import { reconnectPrepaidHotspotCustomer } from "../routes/customers.js";

type ReconnectCandidate = {
  id: number;
  admin_id: number;
  router_id: number | null;
};

type ReconnectAccount = {
  id: number;
  parent_id: number | null;
  role: string;
  account_tier: "system_admin" | "isp_admin" | "reseller" | null;
};

const CANDIDATE_PAGE_SIZE = 60;
const MAX_PARALLEL_ROUTERS = 3;

let running = false;
let cursor = 0;
let pendingCandidates: ReconnectCandidate[] = [];

export function selectDistinctReconnectCandidates(
  candidates: ReconnectCandidate[],
  maxParallelRouters = MAX_PARALLEL_ROUTERS,
): { selected: ReconnectCandidate[]; remaining: ReconnectCandidate[] } {
  const selected: ReconnectCandidate[] = [];
  const routerKeys = new Set<string>();
  const remaining: ReconnectCandidate[] = [];

  for (const candidate of candidates) {
    const routerId = Number(candidate.router_id);
    const key = Number.isSafeInteger(routerId) && routerId > 0 ? `router:${routerId}` : "router:unknown";
    if (selected.length < maxParallelRouters && !routerKeys.has(key)) {
      routerKeys.add(key);
      selected.push(candidate);
    } else {
      remaining.push(candidate);
    }
  }

  return { selected, remaining };
}

async function loadNextCandidates(): Promise<boolean> {
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await sbSelectStrict<ReconnectCandidate>(
    "isp_customers",
    `id=gt.${cursor}&admin_id=not.is.null&type=in.(hotspot,trials,trial)&status=in.(active,payment_cleared_router_pending,expired)&mac_address=not.is.null&username=not.is.null&password=not.is.null&plan_id=not.is.null&and=(or(expires_at.is.null,expires_at.gt.${now}),or(depletion_reason.is.null,depletion_reason.neq.data_limit))&select=id,admin_id,router_id&order=id.asc&limit=${CANDIDATE_PAGE_SIZE}`,
  );
  if (rows.length === 0) {
    cursor = 0;
    return false;
  }
  cursor = Number(rows[rows.length - 1]?.id) || cursor;
  pendingCandidates = rows.filter(candidate =>
    Number.isSafeInteger(Number(candidate.id))
    && Number(candidate.id) > 0
    && Number.isSafeInteger(Number(candidate.admin_id))
    && Number(candidate.admin_id) > 0,
  );
  return pendingCandidates.length > 0;
}

function takeDistinctRouterBatch(): ReconnectCandidate[] {
  const batch = selectDistinctReconnectCandidates(pendingCandidates);
  pendingCandidates = batch.remaining;
  return batch.selected;
}

async function reconnectCandidate(candidate: ReconnectCandidate): Promise<void> {
  const accountRows = await sbSelectStrict<ReconnectAccount>(
    "isp_admins",
    `id=eq.${candidate.admin_id}&is_active=is.true&role=in.(isp_admin,reseller)&select=id,parent_id,role,account_tier&limit=1`,
  );
  const account = accountRows[0];
  if (!account) return;

  const result = await reconnectPrepaidHotspotCustomer(account, Number(candidate.id));
  if (result?.status === "connected") {
    logger.info(
      { adminId: account.id, customerId: candidate.id },
      "[prepaid-hotspot-reconnect] entitled device reconnected",
    );
  }
}

/** Runs a bounded, rotating reconnect pass for entitled Hotspot accounts. */
export async function runPrepaidHotspotReconnectSweep(): Promise<void> {
  if (running || !supabaseServiceRoleConfigured) return;
  running = true;
  try {
    if (pendingCandidates.length === 0 && !await loadNextCandidates()) return;
    const batch = takeDistinctRouterBatch();
    await Promise.all(batch.map(async candidate => {
      try {
        await reconnectCandidate(candidate);
      } catch (error) {
        logger.warn(
          { err: error, adminId: candidate.admin_id, customerId: candidate.id },
          "[prepaid-hotspot-reconnect] background attempt failed",
        );
      }
    }));
  } finally {
    running = false;
  }
}
