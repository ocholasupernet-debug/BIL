const SAFE_SETTINGS = new Set([
  "ispName", "freeTrial", "vouchers", "tagline", "routerId", "advertPos", "enableAdvert",
  "mpesaPrompt", "testimonials", "faqSection", "logoUrl", "advertUrl", "announcement",
  "paymentInstructions", "supportPhone", "supportEmail", "whatsappNumber", "termsUrl",
  "privacyUrl", "maintenanceMode", "maintenanceMessage", "testimonialText", "faqText", "colors",
  "portalCards",
]);

const SAFE_PORTAL_CARD_KEYS = new Set([
  "header", "hero", "announcement", "expiryNotice", "packages", "paymentStatus",
  "connectionSupport", "accountLogin", "voucher", "paymentRecovery", "testimonials",
  "faq", "advert", "deviceIdentity", "footer", "whatsapp",
]);

export function sanitizeHotspotBrandingSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of SAFE_SETTINGS) {
    const item = input[key];
    if (key === "colors") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const colors: Record<string, string> = {};
      for (const [name, color] of Object.entries(item)) {
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
          colors[name] = color.toLowerCase();
        }
      }
      output.colors = colors;
    } else if (key === "portalCards") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const cards: Record<string, boolean> = {};
      for (const [cardKey, visible] of Object.entries(item)) {
        if (SAFE_PORTAL_CARD_KEYS.has(cardKey) && typeof visible === "boolean") cards[cardKey] = visible;
      }
      output.portalCards = cards;
    } else if (typeof item === "string" && item.length <= 2_000_000) {
      output[key] = item;
    }
  }
  return output;
}