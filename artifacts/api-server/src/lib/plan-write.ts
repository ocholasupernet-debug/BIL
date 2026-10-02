import { normalizePlanValidityUnit } from "./plan-validity.js";
import { validateFupPolicy } from "./fup-policy.js";

export interface PlanWriteScope {
  routerId: number;
  portId: number | null;
}

export interface PlanPoolAssignment {
  activeIpPool: string | null;
  expiredIpPool: string | null;
}

/** Keep plan rows normalized through the same write contract used by the admin API. */
export function planWritePayload(
  input: Record<string, unknown>,
  scope: PlanWriteScope,
  pools: PlanPoolAssignment,
): Record<string, unknown> {
  const validity = Number(input.durationDays ?? input.validity ?? 30);
  const sharedUsers = Number(input.sharedUsers ?? 1);
  const speedDown = Number(input.speedDown ?? input.speed ?? 10);
  const speedUp = Number(input.speedUp ?? input.speed ?? 10);
  const speedDownUnit = String(input.speedDownUnit ?? input.speed_down_unit ?? "Mbps");
  const speedUpUnit = String(input.speedUpUnit ?? input.speed_up_unit ?? "Mbps");
  const validityUnit = normalizePlanValidityUnit(input.validityUnit ?? input.validity_unit);
  const fup = validateFupPolicy(
    input.type,
    input.dataLimitMb,
    input.dataCapMode,
    input.fupSpeedDown,
    input.fupSpeedUp,
    speedDown,
    speedUp,
    speedDownUnit,
    speedUpUnit,
  );
  return {
    name: String(input.name ?? "").trim(),
    type: input.type ?? "hotspot",
    speed_down: Number.isFinite(speedDown) ? speedDown : 10,
    speed_up: Number.isFinite(speedUp) ? speedUp : 10,
    speed_down_unit: speedDownUnit,
    speed_up_unit: speedUpUnit,
    price: Number(input.price),
    validity: Number.isFinite(validity) ? validity : 30,
    validity_unit: validityUnit,
    validity_days: Number.isFinite(validity) ? validity : 30,
    shared_users: Number.isFinite(sharedUsers) && sharedUsers > 0 ? sharedUsers : 1,
    router_id: scope.routerId,
    port_id: scope.portId,
    active_ip_pool: pools.activeIpPool,
    expired_ip_pool: pools.expiredIpPool,
    data_limit_mb: input.dataLimitMb ?? null,
    data_cap_mode: fup.dataCapMode,
    fup_speed_down: fup.fupSpeedDown,
    fup_speed_up: fup.fupSpeedUp,
    is_active: input.isActive ?? true,
    client_can_purchase: input.clientCanPurchase ?? true,
    description: input.description ?? null,
  };
}