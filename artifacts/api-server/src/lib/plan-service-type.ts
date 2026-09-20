export type PlanServiceType = "hotspot" | "pppoe" | "other";

/**
 * Convert the stored plan category into the service that provisions access.
 * Trial plans use the hotspot provisioner too, and older rows may have a
 * missing type because the database default was applied before the row was
 * fully populated.
 */
export function normalizePlanServiceType(value: unknown): PlanServiceType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "hotspot" || normalized === "trial" || normalized === "trials") {
    return "hotspot";
  }
  if (normalized === "pppoe") return "pppoe";
  return "other";
}