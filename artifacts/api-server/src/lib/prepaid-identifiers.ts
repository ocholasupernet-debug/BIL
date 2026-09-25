import { randomBytes } from "node:crypto";

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

const PREPAID_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomPrepaidSuffix(): string {
  const bytes = randomBytes(4);
  const chars = Array.from(bytes, byte => PREPAID_SUFFIX_ALPHABET[byte % PREPAID_SUFFIX_ALPHABET.length]);
  return `${chars[0]}${chars[1]}:${chars[2]}${chars[3]}`;
}

/**
 * Use a human-readable account identifier in RouterOS:
 * 254798088650-G6:48
 *
 * The suffix is random rather than derived from the phone or MAC address, so
 * repeated purchases with the same phone can receive different identifiers.
 * Callers that need deterministic output in tests may provide an explicit
 * suffix such as "G6:48".
 */
export function prepaidHotspotUsername(phone: unknown, _macAddress?: unknown, explicitSuffix?: unknown): string {
  const normalizedPhone = normalisePrepaidPhone(phone);
  if (!normalizedPhone) return "";
  const requestedSuffix = String(explicitSuffix ?? "").trim().toUpperCase();
  const suffix = /^[A-Z0-9]{2}:[A-Z0-9]{2}$/.test(requestedSuffix)
    ? requestedSuffix
    : randomPrepaidSuffix();
  return `${normalizedPhone}-${suffix}`;
}

export function isPrepaidHotspotUsername(value: unknown): boolean {
  return typeof value === "string" && /^\d{9,15}-(?:[A-Z0-9]{2}:[A-Z0-9]{2}(?:-[a-zA-Z0-9_-]+)?|[0-9A-F]{2}:[0-9A-F]{2}(?:-[a-zA-Z0-9_-]+)?)$/i.test(value.trim());
}

/** Keep the existing login and suffix stable unless the contact phone actually changes. */
export function prepaidHotspotUsernameForEdit(
  currentUsername: unknown,
  currentPhone: unknown,
  requestedPhone: unknown,
): string {
  const phone = normalisePrepaidPhone(requestedPhone);
  if (!phone) return "";
  const username = String(currentUsername ?? "").trim();
  if (username && normalisePrepaidPhone(currentPhone) === phone) return username;
  if (isPrepaidHotspotUsername(username)) {
    return `${phone}-${username.slice(username.indexOf("-") + 1)}`;
  }
  return prepaidHotspotUsername(phone);
}

/**
 * The admin plan sync uses a normalized, service-scoped plan name as the
 * RouterOS hotspot user profile. The scope prevents same-named plans on
 * separate routers or physical service ports from sharing a profile.
 */
export function hotspotPlanProfileName(
  planName: unknown,
  routerId?: unknown,
  portId?: unknown,
): string {
  const base = String(planName ?? "").trim().replace(/\s+/g, "-").toLowerCase();
  const router = Number(routerId);
  const port = Number(portId);
  const scope = Number.isSafeInteger(port) && port > 0
    ? `r${Number.isSafeInteger(router) && router > 0 ? router : "x"}-p${port}`
    : Number.isSafeInteger(router) && router > 0
      ? `r${router}`
      : "";
  return scope ? `${base}-${scope}` : base;
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