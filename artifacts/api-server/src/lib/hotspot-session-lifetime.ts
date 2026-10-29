import { planValiditySeconds } from "./plan-validity.js";

const DAILY_SESSION_FALLBACK_MS = 24 * 60 * 60 * 1000;

export function hotspotSessionExpiresAtMs(input: {
  nowMs: number;
  entitlementExpiresAt: unknown;
  planValidity: unknown;
  planValidityUnit: unknown;
}): number {
  const storedExpiry = Date.parse(String(input.entitlementExpiresAt ?? ""));
  if (Number.isFinite(storedExpiry)) return storedExpiry;

  const planValidityMs = planValiditySeconds(input.planValidity, input.planValidityUnit) * 1000;
  return input.nowMs + (planValidityMs > 0 ? planValidityMs : DAILY_SESSION_FALLBACK_MS);
}
