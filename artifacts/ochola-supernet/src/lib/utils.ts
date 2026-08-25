import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { COUNTRIES, DEFAULT_COUNTRY } from "./countries";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Read the admin's chosen currency code from localStorage (e.g. "KES", "NGN"). */
export function getAdminCurrency(): string {
  try { return localStorage.getItem("ochola_admin_currency") || DEFAULT_COUNTRY.currency; } catch { return DEFAULT_COUNTRY.currency; }
}

/** Persist the admin's currency code to localStorage. */
export function setAdminCurrency(code: string): void {
  try { localStorage.setItem("ochola_admin_currency", code); } catch {}
}

/** Read the admin's country name from localStorage. */
export function getAdminCountry(): string {
  try { return localStorage.getItem("ochola_admin_country") || DEFAULT_COUNTRY.name; } catch { return DEFAULT_COUNTRY.name; }
}

/** Persist the admin's country name to localStorage. */
export function setAdminCountryLocal(name: string): void {
  try { localStorage.setItem("ochola_admin_country", name); } catch {}
}

/** Get the short symbol for the admin's currency (e.g. "Ksh", "₦", "$"). */
export function getCurrencySymbol(): string {
  const code = getAdminCurrency();
  return COUNTRIES.find(c => c.currency === code)?.symbol ?? code;
}

/** Get the locale for the admin's currency (for Intl formatting). */
function getAdminLocale(): string {
  const code = getAdminCurrency();
  return COUNTRIES.find(c => c.currency === code)?.locale ?? "en-KE";
}

/** Format a number as currency using the admin's stored preference. */
export function formatCurrency(amount: number): string {
  const currency = getAdminCurrency();
  const locale   = getAdminLocale();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${getCurrencySymbol()} ${amount.toLocaleString()}`;
  }
}

/** Compact format for large numbers (e.g. "Ksh. 1.2M"). Used on dashboards. */
export function fmtMoney(n: number): string {
  const sym = getCurrencySymbol();
  if (n >= 1_000_000) return `${sym} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${sym} ${n.toLocaleString()}`;
  return `${sym} ${n}`;
}
