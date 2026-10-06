const ENTITLEMENT_STATUSES = new Set([
  "active",
  "payment_cleared_router_pending",
  "expired",
]);

export interface CustomerServiceStatusInput {
  status?: unknown;
  expires_at?: unknown;
  depletion_reason?: unknown;
}

/**
 * Resolve the effective customer access state using the same rules as the API:
 * a valid future expiry can override a stale "expired" status, but suspension
 * and data-limit depletion still prevent active access.
 */
export function getCustomerServiceStatus(
  customer: CustomerServiceStatusInput,
  now = Date.now(),
): string {
  const status = String(customer.status ?? "").trim().toLowerCase();
  const depletionReason = String(customer.depletion_reason ?? "").trim().toLowerCase();

  if (status === "suspended") return "suspended";
  if (depletionReason === "data_limit") return "expired";

  const expiryValue = String(customer.expires_at ?? "").trim();
  if (!expiryValue) {
    if (status === "expired") return "expired";
    if (status === "active") return "active";
    return status || "unknown";
  }

  const expiry = Date.parse(expiryValue);
  if (!Number.isFinite(expiry)) {
    return status === "expired" ? "expired" : "unknown";
  }
  if (expiry <= now) return "expired";
  if (ENTITLEMENT_STATUSES.has(status)) return "active";
  return status || "unknown";
}
