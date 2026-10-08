import { normalizePortalHostname } from "./portal-hostname.js";

/**
 * Builds the RFC 8910 DHCP option 114 URI for the public captive-portal API.
 * The API answers with application/captive+json and the actual tenant login URL.
 */
export function buildCaptivePortalApiUrl(apiOrigin: string, portalHostname: string): string {
  let origin: URL;
  try {
    origin = new URL(apiOrigin);
  } catch {
    throw new Error("The captive-portal API origin is not a valid URL.");
  }

  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:")
    || origin.username
    || origin.password
  ) {
    throw new Error("The captive-portal API origin must be an HTTP(S) URL without credentials.");
  }

  const hostname = normalizePortalHostname(portalHostname);
  if (!hostname) {
    throw new Error("The Hotspot portal hostname is invalid for captive-portal discovery.");
  }

  return `${origin.origin}/api/captive-portal?portal=${encodeURIComponent(hostname)}`;
}

/** RouterOS DHCP option 114 stores the URI as a quoted string value. */
export function routerOsDhcpOptionUriValue(uri: string): string {
  return `'${uri.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Merge option names without dropping DHCP options already assigned to a network. */
export function mergeRouterDhcpOptionNames(existing: unknown, requested: unknown): string {
  const names = new Set(
    [existing, requested]
      .flatMap(value => String(value ?? "").split(","))
      .map(value => value.trim())
      .filter(Boolean),
  );
  return [...names].join(",");
}
