export type DashboardLayout = "balanced" | "focus" | "compact";
export type DashboardCardShape = "rounded" | "soft-square" | "compact";

export interface DashboardPreferences {
  accentColor: string;
  layout: DashboardLayout;
  cardShape: DashboardCardShape;
  hideAmounts: boolean;
}

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  accentColor: "#d96835",
  layout: "balanced",
  cardShape: "rounded",
  hideAmounts: false,
};

export const DASHBOARD_COLOR_PRESETS = [
  { name: "Signal orange", value: "#d96835" },
  { name: "Ocean blue", value: "#2f6fed" },
  { name: "Emerald", value: "#168c78" },
  { name: "Violet", value: "#7c5cc4" },
  { name: "Rose", value: "#d55372" },
  { name: "Sky", value: "#0284c7" },
  { name: "Teal", value: "#0d9488" },
  { name: "Lime", value: "#65a30d" },
  { name: "Amber", value: "#d97706" },
  { name: "Red", value: "#dc2626" },
  { name: "Fuchsia", value: "#c026d3" },
  { name: "Slate", value: "#475569" },
] as const;

export const DASHBOARD_LAYOUT_OPTIONS: Array<{
  value: DashboardLayout;
  label: string;
  description: string;
}> = [
  { value: "balanced", label: "Balanced", description: "Equal-weight cards for a calm daily overview." },
  { value: "focus", label: "Operations focus", description: "Gives live network and revenue information more room." },
  { value: "compact", label: "Compact", description: "Tighter spacing for more information above the fold." },
];

export const DASHBOARD_SHAPE_OPTIONS: Array<{
  value: DashboardCardShape;
  label: string;
  description: string;
}> = [
  { value: "rounded", label: "Rounded", description: "Friendly cards with generous corners." },
  { value: "soft-square", label: "Soft square", description: "A sharper, structured operations look." },
  { value: "compact", label: "Compact", description: "Tight corners for a dense control-room feel." },
];

export function isDashboardLayout(value: unknown): value is DashboardLayout {
  return value === "balanced" || value === "focus" || value === "compact";
}

export function isDashboardCardShape(value: unknown): value is DashboardCardShape {
  return value === "rounded" || value === "soft-square" || value === "compact";
}

export function isDashboardAccentColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeDashboardPreferences(
  input: Partial<DashboardPreferences> | null | undefined,
): DashboardPreferences {
  return {
    accentColor: isDashboardAccentColor(input?.accentColor)
      ? input.accentColor.toLowerCase()
      : DEFAULT_DASHBOARD_PREFERENCES.accentColor,
    layout: isDashboardLayout(input?.layout) ? input.layout : DEFAULT_DASHBOARD_PREFERENCES.layout,
    cardShape: isDashboardCardShape(input?.cardShape) ? input.cardShape : DEFAULT_DASHBOARD_PREFERENCES.cardShape,
    hideAmounts: typeof input?.hideAmounts === "boolean"
      ? input.hideAmounts
      : DEFAULT_DASHBOARD_PREFERENCES.hideAmounts,
  };
}