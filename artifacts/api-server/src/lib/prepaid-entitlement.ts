const ACCESSIBLE_PREPAID_STATUSES = new Set([
  "active",
  "payment_cleared_router_pending",
  "expired",
]);

export function isPrepaidCustomerEntitled(
  status: unknown,
  expiresAt: unknown,
  depletionReason: unknown,
  now = Date.now(),
  requireExpiry = false,
): boolean {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedDepletion = String(depletionReason ?? "").trim().toLowerCase();

  if (
    normalizedStatus === "suspended"
    || normalizedDepletion === "data_limit"
    || !ACCESSIBLE_PREPAID_STATUSES.has(normalizedStatus)
  ) {
    return false;
  }

  const expiryValue = String(expiresAt ?? "").trim();
  if (!expiryValue) {
    return !requireExpiry && normalizedStatus === "active";
  }

  const expiry = Date.parse(expiryValue);
  return Number.isFinite(expiry) && expiry > now;
}

export function isPrepaidCustomerExpired(
  status: unknown,
  expiresAt: unknown,
  depletionReason: unknown,
  now = Date.now(),
): boolean {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedDepletion = String(depletionReason ?? "").trim().toLowerCase();

  if (normalizedStatus === "suspended") return false;
  if (normalizedDepletion === "data_limit") return true;

  const expiryValue = String(expiresAt ?? "").trim();
  if (!expiryValue) return normalizedStatus === "expired";

  const expiry = Date.parse(expiryValue);
  if (Number.isFinite(expiry)) return expiry <= now;
  return normalizedStatus === "expired";
}
