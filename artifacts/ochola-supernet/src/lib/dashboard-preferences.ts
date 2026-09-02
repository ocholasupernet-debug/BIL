export type DashboardLayout = "balanced" | "focus" | "compact";
export type DashboardCardShape =
  | "rounded"
  | "soft-square"
  | "compact"
  | "square"
  | "circle"
  | "star"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "pill"
  | "leaf"
  | "arch"
  | "bevel"
  | "notched"
  | "ticket"
  | "squircle";

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
  { value: "square", label: "Square", description: "True right-angle panels with no corner rounding." },
  { value: "circle", label: "Circle", description: "A true circular silhouette for a bold visual statement." },
  { value: "star", label: "Star", description: "A five-point geometric silhouette for standout panels." },
  { value: "triangle", label: "Triangle", description: "A sharp three-sided shape for a directional look." },
  { value: "diamond", label: "Diamond", description: "A four-point shape with a strong visual center." },
  { value: "hexagon", label: "Hexagon", description: "A true six-sided geometric panel." },
  { value: "octagon", label: "Octagon", description: "Eight angled sides for a technical control-room feel." },
  { value: "pill", label: "Pill", description: "Long, smooth corners for a softer dashboard rhythm." },
  { value: "leaf", label: "Leaf", description: "Alternating corners create a natural, distinctive silhouette." },
  { value: "arch", label: "Arch", description: "Rounded upper corners with a grounded lower edge." },
  { value: "bevel", label: "Bevel", description: "Angled corners for a technical operations aesthetic." },
  { value: "notched", label: "Notched", description: "Cut-in corners that make each section feel custom-built." },
  { value: "ticket", label: "Ticket", description: "Perforated-style side cuts inspired by access passes." },
  { value: "squircle", label: "Squircle", description: "Balanced between a square and a circle." },
];

export function isDashboardLayout(value: unknown): value is DashboardLayout {
  return value === "balanced" || value === "focus" || value === "compact";
}

export function isDashboardCardShape(value: unknown): value is DashboardCardShape {
  return DASHBOARD_SHAPE_OPTIONS.some(option => option.value === value);
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