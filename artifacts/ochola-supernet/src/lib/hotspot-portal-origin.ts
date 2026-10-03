const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function hotspotApiOriginFromTenantContext(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Hotspot API origin must be a public HTTPS origin.");
  }
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.hostname.toLowerCase() === "localhost"
    || url.hostname.startsWith("127.")
    || url.hostname === "0.0.0.0"
    || url.hostname === "[::1]"
    || url.username
    || url.password
  ) {
    throw new Error("Hotspot API origin must be a public HTTPS origin.");
  }
  return url.origin;
}

function configuredPortalOrigin(portalHostname: string, baseDomain: string): string | null {
  const configuredHost = portalHostname.trim().toLowerCase();
  if (!configuredHost || !HOSTNAME_PATTERN.test(configuredHost) || configuredHost.includes("..")) {
    return null;
  }

  const normalizedBaseDomain = baseDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!HOSTNAME_PATTERN.test(normalizedBaseDomain) || normalizedBaseDomain.includes("..")) {
    return null;
  }

  const hostname = configuredHost === "admin"
    ? normalizedBaseDomain
    : configuredHost === normalizedBaseDomain
      || configuredHost.endsWith(`.${normalizedBaseDomain}`)
      || configuredHost.includes(".")
      ? configuredHost
      : `${configuredHost}.${normalizedBaseDomain}`;

  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    return null;
  }

  return `https://${hostname}`;
}

export async function resolveHotspotPortalApiOrigin(
  portalHostname: string,
  tenantApiBase: string,
  baseDomain: string,
  fetcher: typeof fetch = fetch,
): Promise<{ apiBase: string; source: "tenant_context" | "verified_portal_hostname" }> {
  const tenantOrigin = hotspotApiOriginFromTenantContext(tenantApiBase);
  const configuredOrigin = configuredPortalOrigin(portalHostname, baseDomain);
  if (!configuredOrigin || configuredOrigin === tenantOrigin) {
    return { apiBase: tenantOrigin, source: "tenant_context" };
  }

  try {
    const healthUrl = new URL("/api/healthz", configuredOrigin);
    const response = await fetcher(healthUrl, {
      cache: "no-store",
      credentials: "omit",
    });
    if (
      !response.ok
      || (response.redirected && new URL(response.url).origin !== configuredOrigin)
    ) {
      return { apiBase: tenantOrigin, source: "tenant_context" };
    }
    const body = await response.json() as { status?: unknown; ok?: unknown };
    if (body?.status !== "ok" && body?.ok !== true) {
      return { apiBase: tenantOrigin, source: "tenant_context" };
    }
    return { apiBase: configuredOrigin, source: "verified_portal_hostname" };
  } catch {
    return { apiBase: tenantOrigin, source: "tenant_context" };
  }
}