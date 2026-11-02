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
  portalBackground: PortalBackground;
  portalPackageShape: PortalPackageShape;
}

export type PortalBackground = "midnight" | "ocean" | "aurora" | "forest" | "sunset" | "sand";
export type PortalPackageShape = "rounded" | "soft-square" | "compact" | "square" | "circle" | "pill" | "hexagon" | "octagon" | "squircle";

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  accentColor: "#d96835",
  layout: "balanced",
  cardShape: "rounded",
  hideAmounts: false,
  portalBackground: "midnight",
  portalPackageShape: "rounded",
};

export const PORTAL_BACKGROUND_OPTIONS: Array<{
  value: PortalBackground;
  label: string;
  description: string;
  gradient: string;
}> = [
  {
    value: "midnight",
    label: "Obsidian grid",
    description: "Graphite mesh with a soft violet glow",
    gradient: "radial-gradient(ellipse at 78% 12%,rgba(111,91,190,.42),transparent 48%),repeating-linear-gradient(0deg,rgba(188,198,224,.09) 0 1px,transparent 1px 24px),repeating-linear-gradient(90deg,rgba(188,198,224,.09) 0 1px,transparent 1px 24px),linear-gradient(145deg,#111827,#20263a 58%,#111827)",
  },
  {
    value: "ocean",
    label: "Deep current",
    description: "Blue depth with a fine wave lattice",
    gradient: "radial-gradient(ellipse at 75% 8%,rgba(58,150,191,.42),transparent 48%),repeating-linear-gradient(135deg,rgba(153,218,236,.075) 0 1px,transparent 1px 12px),linear-gradient(145deg,#102735,#153f52 55%,#102735)",
  },
  {
    value: "aurora",
    label: "Northern lights",
    description: "Jade and indigo light over a subtle star grid",
    gradient: "radial-gradient(ellipse at 22% 15%,rgba(65,183,151,.42),transparent 48%),radial-gradient(ellipse at 82% 88%,rgba(106,91,190,.34),transparent 50%),repeating-linear-gradient(0deg,rgba(213,235,239,.055) 0 1px,transparent 1px 30px),repeating-linear-gradient(90deg,rgba(213,235,239,.055) 0 1px,transparent 1px 30px),linear-gradient(145deg,#14242c,#1b3440)",
  },
  {
    value: "forest",
    label: "Evergreen lattice",
    description: "Calm pine tones with a clean box pattern",
    gradient: "radial-gradient(ellipse at 80% 12%,rgba(81,154,112,.34),transparent 48%),repeating-linear-gradient(0deg,rgba(193,222,201,.085) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,rgba(193,222,201,.085) 0 1px,transparent 1px 28px),linear-gradient(145deg,#152821,#203b30 58%,#14241f)",
  },
  {
    value: "sunset",
    label: "Ember glow",
    description: "Muted copper light on a deep plum base",
    gradient: "radial-gradient(ellipse at 78% 15%,rgba(191,105,89,.4),transparent 48%),repeating-linear-gradient(45deg,rgba(232,186,167,.055) 0 1px,transparent 1px 14px),linear-gradient(145deg,#292027,#493039 58%,#211d27)",
  },
  {
    value: "sand",
    label: "Warm stone",
    description: "Soft bronze tones with a refined diamond texture",
    gradient: "radial-gradient(ellipse at 75% 10%,rgba(190,151,93,.4),transparent 48%),repeating-linear-gradient(45deg,rgba(239,221,184,.075) 0 1px,transparent 1px 11px),repeating-linear-gradient(-45deg,rgba(239,221,184,.06) 0 1px,transparent 1px 11px),linear-gradient(145deg,#292820,#464032 58%,#25251f)",
  },
];

export const PORTAL_PACKAGE_SHAPE_OPTIONS: Array<{
  value: PortalPackageShape;
  label: string;
  description: string;
}> = [
  { value: "rounded", label: "Rounded", description: "Friendly corners" },
  { value: "soft-square", label: "Soft square", description: "Structured corners" },
  { value: "compact", label: "Compact", description: "Tight corner radius" },
  { value: "square", label: "Square", description: "Right-angle cards" },
  { value: "circle", label: "Circle", description: "Bold circular silhouette" },
  { value: "pill", label: "Pill", description: "Long smooth corners" },
  { value: "hexagon", label: "Hexagon", description: "Technical six-sided card" },
  { value: "octagon", label: "Octagon", description: "Eight angled sides" },
  { value: "squircle", label: "Squircle", description: "Balanced square and circle" },
];

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
    portalBackground: PORTAL_BACKGROUND_OPTIONS.some(option => option.value === input?.portalBackground)
      ? input!.portalBackground as PortalBackground
      : DEFAULT_DASHBOARD_PREFERENCES.portalBackground,
    portalPackageShape: PORTAL_PACKAGE_SHAPE_OPTIONS.some(option => option.value === input?.portalPackageShape)
      ? input!.portalPackageShape as PortalPackageShape
      : DEFAULT_DASHBOARD_PREFERENCES.portalPackageShape,
  };
}