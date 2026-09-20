export function normalisePrepaidPhone(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  return digits;
}

export function normalisePrepaidMac(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(compact)) return "";
  return compact.toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

/**
 * Use a stable, human-readable account identifier in RouterOS:
 * 254798088650-11:5F-123
 *
 * The last two MAC octets keep the username short while the optional suffix
 * makes every newly-created account unique, even when a phone and device are
 * reused for another purchase.
 */
export function prepaidHotspotUsername(phone: unknown, macAddress: unknown, uniqueSuffix?: unknown): string {
  const normalizedPhone = normalisePrepaidPhone(phone);
  const normalizedMac = normalisePrepaidMac(macAddress);
  if (!normalizedPhone || !normalizedMac) return "";
  const suffix = String(uniqueSuffix ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return `${normalizedPhone}-${normalizedMac.slice(-5)}${suffix ? `-${suffix}` : ""}`;
}

export function isPrepaidHotspotUsername(value: unknown): boolean {
  return typeof value === "string" && /^\d{9,15}-[0-9A-F]{2}:[0-9A-F]{2}(?:-[a-zA-Z0-9_-]+)?$/i.test(value.trim());
}

export function routerRateLimit(
  speedDown: unknown,
  speedUp: unknown,
  speedDownUnit: unknown = "Mbps",
  speedUpUnit: unknown = speedDownUnit,
): string | undefined {
  const down = Number(speedDown);
  const up = Number(speedUp);
  if (!Number.isFinite(down) || !Number.isFinite(up) || down <= 0 || up <= 0) return undefined;
  const suffix = (unit: unknown): string => {
    const normalized = String(unit ?? "Mbps").toLowerCase();
    if (normalized.startsWith("kb")) return "k";
    if (normalized.startsWith("gb")) return "G";
    return "M";
  };
  return `${up}${suffix(speedUpUnit)}/${down}${suffix(speedDownUnit)}`;
}