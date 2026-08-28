import type { Request } from "express";

export const TENANT_BASE_DOMAIN = (process.env.PUBLIC_BASE_DOMAIN ?? "isplatty.org")
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");

/* These labels are served by platform infrastructure or have a dedicated
   product meaning. They must never resolve to an ISP tenant. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "vpn",
  "register",
  "proxyvpn",
  "mail",
  "admin",
]);

function hostnameOnly(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

export function getTenantSubdomain(host: string): string | null {
  const hostname = hostnameOnly(host);
  const suffix = `.${TENANT_BASE_DOMAIN}`;

  if (!hostname || hostname === TENANT_BASE_DOMAIN || !hostname.endsWith(suffix)) {
    return null;
  }

  const label = hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

export function getTenantSubdomainFromRequest(req: Request): string | null {
  return getTenantSubdomain(req.headers.host ?? req.hostname ?? "");
}
