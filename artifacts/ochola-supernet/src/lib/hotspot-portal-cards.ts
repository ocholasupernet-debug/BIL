// Empty means the portal should use its built-in default mark.
// A tenant logo is only shown when that tenant has explicitly configured one.
export const DEFAULT_HOTSPOT_LOGO_URL = "";

export function isDefaultPlatformPortalName(value: unknown): boolean {
  return typeof value === "string"
    && value.trim().toLowerCase().replace(/[^a-z0-9]/g, "") === "ocholasupernet";
}

export const HOTSPOT_PORTAL_CARD_OPTIONS = [
  { key: "header", label: "Brand header", description: "ISP name, logo, and header contact." },
  { key: "hero", label: "Welcome section", description: "Main introduction and service highlights." },
  { key: "announcement", label: "Announcement banner", description: "Promotion, outage, or maintenance notice." },
  { key: "expiryNotice", label: "Expiry notice", description: "Message shown when a package has expired or run out." },
  { key: "packages", label: "Packages", description: "Package list and TV purchase entry point. Always enabled for customer purchases." },
  { key: "paymentStatus", label: "Payment status", description: "M-Pesa availability or checkout guidance." },
  { key: "connectionSupport", label: "Connection support", description: "Troubleshooting card and connection check." },
  { key: "accountLogin", label: "Account login", description: "Username and password sign-in form." },
  { key: "voucher", label: "Voucher redemption", description: "Voucher code entry and redemption." },
  { key: "loyalty", label: "Loyalty points", description: "Customer reward balance and points-earning details." },
  { key: "paymentRecovery", label: "Payment recovery", description: "Reconnect access using a completed M-Pesa payment." },
  { key: "testimonials", label: "Testimonials", description: "Customer quote card." },
  { key: "faq", label: "FAQ", description: "Common connection question and answer." },
  { key: "advert", label: "Advert banner", description: "Optional image advertisement." },
  { key: "deviceIdentity", label: "Device identity", description: "Customer device MAC address." },
  { key: "footer", label: "Footer", description: "ISP contact, terms, privacy, and session links." },
  { key: "whatsapp", label: "WhatsApp button", description: "Floating WhatsApp support link." },
] as const;

export type HotspotPortalCardKey = typeof HOTSPOT_PORTAL_CARD_OPTIONS[number]["key"];
export type HotspotPortalCardVisibility = Record<HotspotPortalCardKey, boolean>;

export const DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS = {
  position: "bottom",
  treatment: "filled",
  shape: "rounded",
  size: "standard",
} as const;

export type HotspotLoyaltyCardSettings = {
  position: "top" | "after-packages" | "bottom";
  treatment: "filled" | "outlined" | "glass";
  shape: "rounded" | "square" | "pill";
  size: "compact" | "standard" | "large";
};

export function normalizeHotspotLoyaltyCardSettings(value: unknown): HotspotLoyaltyCardSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const position = input.position;
  const treatment = input.treatment;
  const shape = input.shape;
  const size = input.size;
  return {
    position: position === "top" || position === "after-packages" || position === "bottom"
      ? position
      : DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS.position,
    treatment: treatment === "filled" || treatment === "outlined" || treatment === "glass"
      ? treatment
      : DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS.treatment,
    shape: shape === "rounded" || shape === "square" || shape === "pill"
      ? shape
      : DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS.shape,
    size: size === "compact" || size === "standard" || size === "large"
      ? size
      : DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS.size,
  };
}

export const DEFAULT_HOTSPOT_PORTAL_CARDS: HotspotPortalCardVisibility = {
  header: true,
  hero: true,
  announcement: true,
  expiryNotice: true,
  packages: true,
  paymentStatus: true,
  connectionSupport: true,
  accountLogin: true,
  voucher: true,
  loyalty: true,
  paymentRecovery: true,
  testimonials: false,
  faq: false,
  advert: false,
  deviceIdentity: true,
  footer: true,
  whatsapp: true,
};

export interface LegacyHotspotPortalCardSettings {
  vouchers?: unknown;
  enableAdvert?: unknown;
  testimonials?: unknown;
  faqSection?: unknown;
}

export function normalizeHotspotPortalCards(
  value: unknown,
  legacy: LegacyHotspotPortalCardSettings = {},
): HotspotPortalCardVisibility {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const cards = { ...DEFAULT_HOTSPOT_PORTAL_CARDS };

  for (const { key } of HOTSPOT_PORTAL_CARD_OPTIONS) {
    // Package checkout is a core customer flow and cannot be hidden by saved
    // branding settings, including settings created before this restriction.
    if (key === "packages") continue;
    if (typeof input[key] === "boolean") cards[key] = input[key];
  }
  cards.packages = true;

  if (typeof input.voucher !== "boolean" && legacy.vouchers === "No") cards.voucher = false;
  if (typeof input.advert !== "boolean" && legacy.enableAdvert === "Enable") cards.advert = true;
  if (typeof input.testimonials !== "boolean" && legacy.testimonials === "Enable") cards.testimonials = true;
  if (typeof input.faq !== "boolean" && legacy.faqSection === "Enable") cards.faq = true;

  return cards;
}