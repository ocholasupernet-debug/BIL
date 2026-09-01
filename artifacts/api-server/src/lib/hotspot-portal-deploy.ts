const MAX_GENERATED_HOTSPOT_HTML_BYTES = 2_500_000;
const FORBIDDEN_PORTAL_CONFIG_KEYS = new Set([
  "routerSecret",
  "routerPassword",
  "paymentSecret",
  "paymentPassword",
  "consumerSecret",
  "sessionSecret",
  "vpnPrivateKey",
  "vpnSecret",
  "privateKey",
]);

export function isPublicHttpsOrigin(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !!hostname
      && hostname !== "localhost"
      && hostname !== "::1"
      && hostname !== "0.0.0.0"
      && !hostname.startsWith("127.");
  } catch {
    return false;
  }
}

export function validateGeneratedHotspotPortal(value: unknown): { content: Buffer } | { error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "Generated portal HTML is required." };
  }
  const content = Buffer.from(value, "utf8");
  if (content.length > MAX_GENERATED_HOTSPOT_HTML_BYTES) {
    return { error: "Generated portal HTML is too large." };
  }
  if (!/^<!doctype html>/i.test(value.trim())) {
    return { error: "Generated portal HTML must be a complete HTML document." };
  }
  for (const marker of ["$(link-login-only)", "$(link-orig)", "$(if error)", "$(endif error)"]) {
    if (!value.includes(marker)) return { error: `Generated portal HTML is missing RouterOS marker ${marker}.` };
  }
  const configMatch = value.match(/window\.__HOTSPOT_CONFIG__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!configMatch) return { error: "Generated portal HTML is missing its portal configuration." };
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configMatch[1]) as Record<string, unknown>;
  } catch {
    return { error: "Generated portal configuration is invalid." };
  }
  for (const key of Object.keys(config)) {
    if (FORBIDDEN_PORTAL_CONFIG_KEYS.has(key)) {
      return { error: "Generated portal configuration contains restricted credentials." };
    }
  }
  if (!isPublicHttpsOrigin(config.apiBase)) {
    return { error: "Generated portal configuration must use a public HTTPS API origin." };
  }
  if (/(?:router[_-]?secret|router[_-]?password|payment[_-]?(?:secret|password)|session[_-]?secret|vpn[_-]?(?:private|secret|password|key))/i.test(value)) {
    return { error: "Generated portal HTML contains restricted credential material." };
  }
  return { content };
}