const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function hotspotPortalApiOrigin(
  portalHostname: string,
  fallbackApiBase: string,
  baseDomain: string,
): string {
  const configuredHost = portalHostname.trim().toLowerCase();
  if (!configuredHost) return fallbackApiBase.replace(/\/+$/, "");
  if (configuredHost === "localhost" || configuredHost.endsWith(".localhost")) {
    throw new Error("Portal hostname must be a public DNS hostname.");
  }
  if (!HOSTNAME_PATTERN.test(configuredHost) || configuredHost.includes("..")) {
    throw new Error("Portal hostname must be a valid DNS hostname.");
  }

  const normalizedBaseDomain = baseDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!HOSTNAME_PATTERN.test(normalizedBaseDomain) || normalizedBaseDomain.includes("..")) {
    throw new Error("The default portal domain is invalid.");
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
    throw new Error("Portal hostname must be a public DNS hostname.");
  }

  return `https://${hostname}`;
}