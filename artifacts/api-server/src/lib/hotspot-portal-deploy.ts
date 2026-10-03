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

export type EmbeddedHotspotConfig = {
  config: Record<string, unknown>;
  valueStart: number;
  valueEnd: number;
};

export function findEmbeddedHotspotConfig(html: string): EmbeddedHotspotConfig | null {
  const assignment = /window\.__HOTSPOT_CONFIG__\s*=/.exec(html);
  if (!assignment) return null;

  let cursor = assignment.index + assignment[0].length;
  while (/\s/.test(html[cursor] ?? "")) cursor += 1;
  if (html[cursor] !== "{") return null;

  const valueStart = cursor;
  let braceDepth = 0;
  let inString = false;
  let escaped = false;

  for (; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        const valueEnd = cursor + 1;
        try {
          const parsed = JSON.parse(html.slice(valueStart, valueEnd)) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          return {
            config: parsed as Record<string, unknown>,
            valueStart,
            valueEnd,
          };
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

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
  for (const marker of ["$(link-login-only)", "$(link-orig)", "$(if error)", "$(endif)"]) {
    if (!value.includes(marker)) return { error: `Generated portal HTML is missing RouterOS marker ${marker}.` };
  }
  const embeddedConfig = findEmbeddedHotspotConfig(value);
  if (!embeddedConfig) {
    return {
      error: value.includes("window.__HOTSPOT_CONFIG__")
        ? "Generated portal configuration is invalid."
        : "Generated portal HTML is missing its portal configuration.",
    };
  }
  const config = embeddedConfig.config;
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