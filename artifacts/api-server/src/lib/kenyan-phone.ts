const KENYAN_MOBILE_RE = /^254[17]\d{8}$/;

export function normaliseKenyanMobile(value: unknown): string {
  const digits = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";

  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (KENYAN_MOBILE_RE.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return "";
}

export function isKenyanMobileNumber(value: unknown): value is string {
  return typeof value === "string" && KENYAN_MOBILE_RE.test(value);
}

export function kenyanMobilePhoneVariants(value: unknown): string[] {
  const canonical = normaliseKenyanMobile(value);
  if (!canonical) return [];

  return [...new Set([
    canonical,
    `0${canonical.slice(3)}`,
    canonical.slice(3),
  ])];
}
