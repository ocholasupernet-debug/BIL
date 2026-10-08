const MAX_AWARD = 2_147_483_647;
const POINT_PRECISION_TOLERANCE = 1e-7;

function isPointAmount(value: number, maximum = MAX_AWARD): boolean {
  return Number.isFinite(value)
    && value >= 0
    && value <= maximum
    && Math.abs(value * 100 - Math.round(value * 100)) <= POINT_PRECISION_TOLERANCE;
}

function roundPoints(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateHotspotLoyaltyAward(
  purchaseAmountKes: number,
  kesPerPoint: number,
  fixedPlanAward: number | null,
): number {
  if (fixedPlanAward !== null) {
    return isPointAmount(fixedPlanAward)
      ? Math.max(0, Math.min(MAX_AWARD, roundPoints(fixedPlanAward)))
      : 0;
  }
  if (!Number.isFinite(purchaseAmountKes) || purchaseAmountKes <= 0) return 0;
  if (!Number.isFinite(kesPerPoint) || kesPerPoint <= 0) return 0;
  return roundPoints(Math.max(0, Math.min(MAX_AWARD, purchaseAmountKes / kesPerPoint)));
}

export function canRedeemHotspotPlan(balance: number, pointsRequired: number | null): boolean {
  return isPointAmount(balance, Number.MAX_SAFE_INTEGER)
    && Number.isSafeInteger(pointsRequired)
    && (pointsRequired ?? 0) > 0
    && balance >= (pointsRequired ?? Number.POSITIVE_INFINITY);
}

export function resolveHotspotRedemptionPoints(
  planPrice: number | string | null | undefined,
  configuredPoints: number | null | undefined,
): number | null {
  if (configuredPoints !== null && configuredPoints !== undefined) {
    return Number.isSafeInteger(configuredPoints) && configuredPoints > 0
      ? configuredPoints
      : null;
  }

  const price = Number(planPrice);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_AWARD) return null;
  const defaultPoints = Math.ceil(price);
  return Number.isSafeInteger(defaultPoints) && defaultPoints > 0 ? defaultPoints : null;
}
