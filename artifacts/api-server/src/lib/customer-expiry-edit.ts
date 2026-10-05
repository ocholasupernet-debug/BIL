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
