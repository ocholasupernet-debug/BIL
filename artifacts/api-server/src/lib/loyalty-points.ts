const MAX_AWARD = 2_147_483_647;

export function calculateHotspotLoyaltyAward(
  purchaseAmountKes: number,
  kesPerPoint: number,
  fixedPlanAward: number | null,
): number {
  if (fixedPlanAward !== null) {
    return Number.isSafeInteger(fixedPlanAward)
      ? Math.max(0, Math.min(MAX_AWARD, fixedPlanAward))
      : 0;
  }
  if (!Number.isFinite(purchaseAmountKes) || purchaseAmountKes <= 0) return 0;
  if (!Number.isFinite(kesPerPoint) || kesPerPoint <= 0) return 0;
  return Math.max(0, Math.min(MAX_AWARD, Math.floor(purchaseAmountKes / kesPerPoint + 1e-9)));
}

export function canRedeemHotspotPlan(balance: number, pointsRequired: number | null): boolean {
  return Number.isSafeInteger(balance)
    && balance >= 0
    && Number.isSafeInteger(pointsRequired)
    && (pointsRequired ?? 0) > 0
    && balance >= (pointsRequired ?? Number.POSITIVE_INFINITY);
}
