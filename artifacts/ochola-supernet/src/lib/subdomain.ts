const BASE_DOMAINS = ["isplatty.org", "isplatty.com"];
const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "admin", "come", "vpn", "register", "latex", "proxyvpn", "mail",
]);

/**
 * Resolve the tenant label for either domain during the staged migration.
 * Service hosts such as admin and come deliberately do not identify tenants.
 */
export function getHostSubdomainFromHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.includes("replit.dev") ||
    hostname.includes("repl.co") ||
    hostname.includes("worf.")
  ) {
    return "";
  }

  for (const baseDomain of BASE_DOMAINS) {
    const suffix = `.${baseDomain}`;
    if (hostname === baseDomain || !hostname.endsWith(suffix)) continue;

    const label = hostname.slice(0, -suffix.length);
    if (!label || label.includes(".") || RESERVED_SUBDOMAINS.has(label)) return "";
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return label;
  }

  return "";
}

/**
 * Reads the current subdomain from window.location.hostname.
 *
 * Examples:
 *   fastnet.isplatty.org      →  "fastnet"
 *   fastnet.isplatty.com      →  "fastnet"
 *   admin.isplatty.com        →  ""   (service host, not a tenant)
 *   localhost                 →  ""
 *   xxx.worf.replit.dev       →  ""   (Replit preview is ignored)
 */
export function getHostSubdomain(): string {
  return getHostSubdomainFromHostname(window.location.hostname);
}
