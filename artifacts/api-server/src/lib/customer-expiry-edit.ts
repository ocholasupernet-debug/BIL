const MAX_CUSTOMER_EXTENSION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateCustomerExtensionExpiry(
  currentExpiresAt: string | null | undefined,
  days: unknown,
  nowMs = Date.now(),
): string {
  if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > MAX_CUSTOMER_EXTENSION_DAYS) {
    throw new Error(`Choose a whole-number extension from 1 to ${MAX_CUSTOMER_EXTENSION_DAYS} days.`);
  }
  const currentExpiryMs = currentExpiresAt ? Date.parse(currentExpiresAt) : Number.NaN;
  const baseMs = Number.isFinite(currentExpiryMs) && currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
  return new Date(baseMs + days * DAY_MS).toISOString();
}

export function customerStatusForExpiryEdit(
  currentStatus: unknown,
  expiresAt: string | null,
  nowMs = Date.now(),
): "active" | "expired" | "suspended" {
  if (String(currentStatus ?? "").trim().toLowerCase() === "suspended") {
    return "suspended";
  }
  if (!expiresAt) return "active";
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs <= nowMs ? "expired" : "active";
}
