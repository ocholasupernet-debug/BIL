const SAFE_SETTINGS = new Set([
  "ispName", "freeTrial", "vouchers", "tagline", "routerId", "advertPos", "enableAdvert",
  "mpesaPrompt", "testimonials", "faqSection", "logoUrl", "advertUrl", "announcement",
  "paymentInstructions", "supportPhone", "supportEmail", "whatsappNumber", "termsUrl",
  "privacyUrl", "maintenanceMode", "maintenanceMessage", "testimonialText", "faqText", "colors",
  "portalCards", "loyaltyCard", "portalLayout", "tawkEnabled", "layoutAppearances", "supportContacts",
  "freeAccess",
]);

const SAFE_PORTAL_CARD_KEYS = new Set([
  "header", "hero", "announcement", "expiryNotice", "packages", "paymentStatus",
  "connectionSupport", "accountLogin", "voucher", "paymentRecovery", "testimonials",
  "loyalty", "faq", "advert", "deviceIdentity", "footer", "whatsapp",
]);

const SAFE_PORTAL_LAYOUTS = new Set([
  "classic", "split-horizon", "coastal-light", "signal-grid", "warm-studio", "forest-pulse",
  "dansted-wifi", "circuit-noir",
]);
const SAFE_LOYALTY_CARD_SETTINGS = {
  position: new Set(["top", "after-packages", "bottom"]),
  treatment: new Set(["filled", "outlined", "glass"]),
  shape: new Set(["rounded", "square", "pill"]),
  size: new Set(["compact", "standard", "large"]),
} as const;
const SAFE_LAYOUT_KEYS = new Set(["classic", "dansted-wifi", "circuit-noir"]);
const SAFE_BACKGROUND_KEYS = new Set(["midnight", "ocean", "aurora", "forest", "sunset", "sand"]);
const SAFE_PACKAGE_SHAPES = new Set(["rounded", "soft-square", "compact", "square", "circle", "pill", "hexagon", "octagon", "squircle"]);

function sanitizeColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const colors: Record<string, string> = {};
  for (const [name, color] of Object.entries(value)) {
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
      colors[name] = color.toLowerCase();
    }
  }
  return colors;
}

export function sanitizeHotspotBrandingSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of SAFE_SETTINGS) {
    const item = input[key];
    if (key === "colors") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      output.colors = sanitizeColors(item);
    } else if (key === "portalCards") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const cards: Record<string, boolean> = {};
      for (const [cardKey, visible] of Object.entries(item)) {
        if (SAFE_PORTAL_CARD_KEYS.has(cardKey) && typeof visible === "boolean") cards[cardKey] = visible;
      }
      // Existing portal bundles read this public setting at runtime; keep
      // customer checkout visible without requiring a MikroTik file update.
      cards.packages = true;
      output.portalCards = cards;
    } else if (key === "loyaltyCard") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const loyaltyCard: Record<string, string> = {};
      for (const [setting, allowed] of Object.entries(SAFE_LOYALTY_CARD_SETTINGS)) {
        const candidate = (item as Record<string, unknown>)[setting];
        if (typeof candidate === "string" && allowed.has(candidate as never)) {
          loyaltyCard[setting] = candidate;
        }
      }
      output.loyaltyCard = loyaltyCard;
    } else if (key === "tawkEnabled") {
      if (typeof item === "boolean") output.tawkEnabled = item;
    } else if (key === "portalLayout") {
      if (typeof item === "string" && SAFE_PORTAL_LAYOUTS.has(item)) output.portalLayout = item;
    } else if (key === "layoutAppearances") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const appearances: Record<string, unknown> = {};
      for (const [layout, value] of Object.entries(item)) {
        if (!SAFE_LAYOUT_KEYS.has(layout) || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const appearance = value as Record<string, unknown>;
        appearances[layout] = {
          ...(typeof appearance.portalBackground === "string" && SAFE_BACKGROUND_KEYS.has(appearance.portalBackground)
            ? { portalBackground: appearance.portalBackground }
            : {}),
          ...(typeof appearance.portalPackageShape === "string" && SAFE_PACKAGE_SHAPES.has(appearance.portalPackageShape)
            ? { portalPackageShape: appearance.portalPackageShape }
            : {}),
          colors: sanitizeColors(appearance.colors),
        };
      }
      output.layoutAppearances = appearances;
    } else if (key === "supportContacts") {
      if (!Array.isArray(item)) continue;
      output.supportContacts = item.slice(0, 8).flatMap(contact => {
        if (!contact || typeof contact !== "object" || Array.isArray(contact)) return [];
        const row = contact as Record<string, unknown>;
        return [{
          id: typeof row.id === "string" ? row.id.slice(0, 80) : "",
          label: typeof row.label === "string" ? row.label.slice(0, 60) : "",
          phone: typeof row.phone === "string" ? row.phone.slice(0, 30) : "",
          whatsapp: typeof row.whatsapp === "string" ? row.whatsapp.slice(0, 30) : "",
        }];
      });
    } else if (key === "freeAccess") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const access = item as Record<string, unknown>;
      const speedDown = Number(access.speedDownMbps);
      const speedUp = Number(access.speedUpMbps);
      const dataLimitMb = Number(access.dataLimitMb);
      output.freeAccess = {
        active: access.active === true,
        ...(Number.isFinite(speedDown) && speedDown >= 0.1 && speedDown <= 1000 ? { speedDownMbps: speedDown } : {}),
        ...(Number.isFinite(speedUp) && speedUp >= 0.1 && speedUp <= 1000 ? { speedUpMbps: speedUp } : {}),
        ...(Number.isSafeInteger(dataLimitMb) && dataLimitMb >= 1 && dataLimitMb <= 102400 ? { dataLimitMb } : {}),
        ...(typeof access.activationId === "string" && /^[a-f0-9-]{36}$/i.test(access.activationId)
          ? { activationId: access.activationId }
          : {}),
      };
    } else if (typeof item === "string" && item.length <= 2_000_000) {
      output[key] = item;
    }
  }
  return output;
}