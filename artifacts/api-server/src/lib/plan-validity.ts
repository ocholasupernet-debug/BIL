export type PlanValidityUnit = "mins" | "hours" | "days" | "weeks" | "months";

export function normalizePlanValidityUnit(value: unknown): PlanValidityUnit {
  const unit = String(value ?? "").trim().toLowerCase();
  if (unit.startsWith("min")) return "mins";
  if (unit.startsWith("hr") || unit.startsWith("hour")) return "hours";
  if (unit.startsWith("day")) return "days";
  if (unit.startsWith("week")) return "weeks";
  if (unit.startsWith("month")) return "months";
  return "days";
}

export function planValiditySeconds(value: unknown, unit: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  switch (normalizePlanValidityUnit(unit)) {
    case "mins": return amount * 60;
    case "hours": return amount * 60 * 60;
    case "weeks": return amount * 7 * 24 * 60 * 60;
    case "months": return amount * 30 * 24 * 60 * 60;
    case "days":
    default: return amount * 24 * 60 * 60;
  }
}