export type HotspotRoamingServiceScope = {
  routerId: number;
  portId: number | null;
};

export type HotspotRoamingRule = {
  id?: number;
  source_router_id: number;
  source_port_id: number | null;
  target_router_id: number;
  target_port_id: number | null;
  enabled: boolean;
};

export type HotspotRoamingPlan = {
  type?: string | null;
  router_id: number | null;
  port_id: number | null;
};

export type HotspotSessionReviewClassification =
  | "same-service"
  | "allowed-roaming"
  | "unapproved-router"
  | "unknown";

function sameNullableId(left: unknown, right: unknown): boolean {
  const a = left == null ? null : Number(left);
  const b = right == null ? null : Number(right);
  return a === b;
}

export function isDifferentHotspotService(
  plan: HotspotRoamingPlan,
  target: HotspotRoamingServiceScope,
): boolean {
  return Number(plan.router_id) !== target.routerId || !sameNullableId(plan.port_id, target.portId);
}

/**
 * RouterOS stores one Hotspot server on each local user. A same-MikroTik roam
 * must leave that user available to all servers; the login command still
 * selects the specifically authorized destination server.
 */
export function hotspotRoamingUserServer(
  sourceRouterId: number | null,
  targetRouterId: number,
  destinationServer: string | null | undefined,
): string {
  if (sourceRouterId !== null && Number(sourceRouterId) === Number(targetRouterId)) return "all";
  return destinationServer?.trim() || "all";
}

/** A permission may be router-wide at either end, but never crosses tenants. */
export function canPlanRoamToService(
  plan: HotspotRoamingPlan,
  target: HotspotRoamingServiceScope,
  rules: readonly HotspotRoamingRule[],
): boolean {
  const planType = String(plan.type ?? "").trim().toLowerCase();
  if (!["hotspot", "trial", "trials"].includes(planType)) return false;
  if (!Number.isSafeInteger(plan.router_id) || Number(plan.router_id) < 1) return false;

  if (
    Number(plan.router_id) === target.routerId
    && sameNullableId(plan.port_id, target.portId)
  ) return true;

  return matchingHotspotRoamingRule(plan, target, rules) !== null;
}

/** Return the exact active permission that supports a source-to-target roam. */
export function matchingHotspotRoamingRule(
  plan: HotspotRoamingPlan,
  target: HotspotRoamingServiceScope,
  rules: readonly HotspotRoamingRule[],
): HotspotRoamingRule | null {
  const planType = String(plan.type ?? "").trim().toLowerCase();
  if (!["hotspot", "trial", "trials"].includes(planType)) return null;
  if (!Number.isSafeInteger(plan.router_id) || Number(plan.router_id) < 1) return null;

  return rules.find(rule =>
    rule.enabled
    && rule.source_router_id === Number(plan.router_id)
    && (rule.source_port_id === null || sameNullableId(rule.source_port_id, plan.port_id))
    && rule.target_router_id === target.routerId
    && (rule.target_port_id === null || sameNullableId(rule.target_port_id, target.portId)),
  ) ?? null;
}

export function classifyHotspotSessionService(
  plan: HotspotRoamingPlan,
  target: HotspotRoamingServiceScope,
  rules: readonly HotspotRoamingRule[],
): HotspotSessionReviewClassification {
  const planType = String(plan.type ?? "").trim().toLowerCase();
  if (
    !["hotspot", "trial", "trials"].includes(planType)
    || !Number.isSafeInteger(plan.router_id)
    || Number(plan.router_id) < 1
  ) return "unknown";

  if (
    Number(plan.router_id) === target.routerId
    && sameNullableId(plan.port_id, target.portId)
  ) return "same-service";

  return canPlanRoamToService(plan, target, rules)
    ? "allowed-roaming"
    : "unapproved-router";
}

export function authorizedRoamingRouterIds(
  plan: HotspotRoamingPlan,
  rules: readonly HotspotRoamingRule[],
): number[] {
  const planType = String(plan.type ?? "").trim().toLowerCase();
  if (!["hotspot", "trial", "trials"].includes(planType) || !plan.router_id) return [];
  return Array.from(new Set([
    Number(plan.router_id),
    ...rules
      .filter(rule =>
        rule.enabled
        && rule.source_router_id === Number(plan.router_id)
        && (rule.source_port_id === null || sameNullableId(rule.source_port_id, plan.port_id)),
      )
      .map(rule => rule.target_router_id),
  ]));
}

export function sharedHotspotUsageAllowance(
  capBytes: number,
  totalBytesUsed: number,
  targetRouterBytesUsed: number,
): { remainingBytes: number; targetRouterLimitBytes: number; targetFupThresholdBytes: number } {
  const remainingBytes = Math.max(0, Math.floor(capBytes - totalBytesUsed));
  return {
    remainingBytes,
    // RouterOS stores counters locally; include prior local use when setting
    // its cumulative limit so the remaining package balance stays shared.
    targetRouterLimitBytes: Math.max(0, Math.floor(targetRouterBytesUsed + remainingBytes)),
    // Translate the package-wide FUP threshold into this router's local count.
    targetFupThresholdBytes: Math.max(0, Math.floor(targetRouterBytesUsed + capBytes - totalBytesUsed)),
  };
}
