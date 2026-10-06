export function normalizeFixedHotspotVoucherCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,32}$/.test(code) ? code : null;
}

export function normalizeRedeemableHotspotVoucherCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return code.length >= 3
    && code.length <= 32
    && /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)
    ? code
    : null;
}

export function normalizeKenyanVoucherPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

export function normalizeHotspotMac(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^[0-9a-f:.-]+$/i.test(raw)) return null;
  const compact = raw.replace(/[:.-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g)!.join(":");
}

export function formatVoucherDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
