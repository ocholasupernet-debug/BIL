import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePortalHostname } from "./portal-hostname.js";
import { getTenantSubdomain, TENANT_BASE_DOMAIN } from "./tenant-host.js";

const CAPTIVE_PORTAL_HOST_PURPOSE = "captive-portal-host-v1";

function captivePortalSigningSecret(): string {
  const secret = process.env.TOKEN_SIGNING_SECRET ?? process.env.SESSION_SECRET ?? "";
  if (!secret) throw new Error("Captive-portal signing is not configured.");
  return secret;
}

export function getCaptivePortalApiOrigin(): string {
  return `https://api.${TENANT_BASE_DOMAIN}`;
}

export function signCaptivePortalHostname(portalHostname: string): string {
  const hostname = normalizePortalHostname(portalHostname);
  if (!hostname) throw new Error("The Hotspot portal hostname is invalid for captive-portal discovery.");
  return createHmac("sha256", captivePortalSigningSecret())
    .update(`${CAPTIVE_PORTAL_HOST_PURPOSE}\n${hostname}`)
    .digest("base64url");
}

export function isAuthorizedCaptivePortalHostname(
  portalHostname: string,
  signature?: string | null,
): boolean {
  const hostname = normalizePortalHostname(portalHostname);
  if (!hostname) return false;

  if (signature) {
    try {
      const expected = Buffer.from(signCaptivePortalHostname(hostname));
      const received = Buffer.from(signature);
      return received.length === expected.length && timingSafeEqual(received, expected);
    } catch {
      return false;
    }
  }

  // Older DHCP option 114 values did not include a signature. Keep those
  // working for first-party tenant hostnames while requiring newly generated
  // configs to sign custom portal domains.
  return Boolean(getTenantSubdomain(hostname));
}

export function buildCaptivePortalContinueUrl(apiOrigin: string, portalHostname: string): string {
  const origin = new URL(apiOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("The captive-portal landing page must use a public HTTPS origin.");
  }
  const hostname = normalizePortalHostname(portalHostname);
  if (!hostname) throw new Error("The Hotspot portal hostname is invalid for captive-portal discovery.");

  const url = new URL("/api/captive-portal/continue", origin);
  url.searchParams.set("portal", hostname);
  url.searchParams.set("sig", signCaptivePortalHostname(hostname));
  return url.toString();
}

/**
 * Builds the RFC 8910 DHCP option 114 URI for the public captive-portal API.
 * The API answers with application/captive+json and a signed, HTTPS handoff URL.
 */
export function buildCaptivePortalApiUrl(apiOrigin: string, portalHostname: string): string {
  let origin: URL;
  try {
    origin = new URL(apiOrigin);
  } catch {
    throw new Error("The captive-portal API origin is not a valid URL.");
  }

  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
  ) {
    throw new Error("The captive-portal API origin must use HTTPS without credentials.");
  }

  const hostname = normalizePortalHostname(portalHostname);
  if (!hostname) {
    throw new Error("The Hotspot portal hostname is invalid for captive-portal discovery.");
  }

  // RouterOS commonly installs a static DNS record for the Hotspot portal
  // hostname that points back to its own gateway. Never send discovery to
  // that same host, even if a caller accidentally supplies it as the API.
  const resolvedApiOrigin = origin.hostname === hostname
    ? getCaptivePortalApiOrigin()
    : origin.origin;
  const url = new URL("/api/captive-portal", resolvedApiOrigin);
  url.searchParams.set("portal", hostname);
  url.searchParams.set("sig", signCaptivePortalHostname(hostname));
  return url.toString();
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
