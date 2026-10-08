import {
  normalizeHotspotMac,
  normalizeKenyanVoucherPhone,
} from "./hotspot-voucher-utils.js";

export function hotspotVoucherIdentityKey(contact: unknown, macAddress: unknown): string | null {
  const mac = normalizeHotspotMac(String(macAddress ?? ""));
  if (!mac) return null;
  const phone = normalizeKenyanVoucherPhone(String(contact ?? ""));
  return phone ? `phone:${phone}` : `mac:${mac.replace(/[^0-9A-F]/gi, "")}`;
}

export function formatVoucherExpiryInEastAfrica(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "the stated expiry time";
  const formatted = new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Nairobi",
  }).format(date);
  return `${formatted} EAT`;
}

export function voucherExpiryFromEastAfricaDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const calendarDate = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value) return null;
  const deadline = new Date(`${value}T23:59:59.999+03:00`);
  return Number.isFinite(deadline.getTime()) ? deadline.toISOString() : null;
}

