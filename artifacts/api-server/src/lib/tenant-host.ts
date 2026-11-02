import type { Request } from "express";

export const TENANT_BASE_DOMAIN = (process.env.PUBLIC_BASE_DOMAIN ?? "isplatty.org")
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");

// Accept both host suffixes throughout the staged migration. PUBLIC_BASE_DOMAIN
// remains the canonical suffix for generated URLs; the legacy domain stays
// routable until external callbacks and tenant links have been verified.
export const TENANT_BASE_DOMAINS = [...new Set([
  TENANT_BASE_DOMAIN,
  "isplatty.org",
  "isplatty.com",
].filter(Boolean))];

/* These labels are served by platform infrastructure or have a dedicated
   product meaning. They must never resolve to an ISP tenant. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "vpn",
  "register",
  "latex",
  "proxyvpn",
  "mail",
  "admin",
  "come",
]);

function hostnameOnly(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

export function getTenantSubdomain(host: string): string | null {
  const hostname = hostnameOnly(host);
  if (!hostname) return null;

  for (const baseDomain of TENANT_BASE_DOMAINS) {
    const suffix = `.${baseDomain}`;
    if (hostname === baseDomain || !hostname.endsWith(suffix)) continue;

    const label = hostname.slice(0, -suffix.length);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) continue;
    if (RESERVED_SUBDOMAINS.has(label)) continue;
    return label;
  }

  return null;
}

export function getTenantSubdomainFromRequest(req: Request): string | null {
  return getTenantSubdomain(req.headers.host ?? req.hostname ?? "");
}
