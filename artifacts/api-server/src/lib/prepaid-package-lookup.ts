function positivePlanId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The prepaid-user list shows the latest successful purchase's package first,
 * then falls back to the package assigned directly to the customer record.
 */
export function resolvePrepaidPackagePlanId(
  customerPlanId: unknown,
  latestSuccessfulPaymentPlanId: unknown,
): number | null {
  return positivePlanId(latestSuccessfulPaymentPlanId) ?? positivePlanId(customerPlanId);
}
