import { RESERVED_SUBDOMAINS, TENANT_BASE_DOMAIN } from "./tenant-host.js";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function resellerTenantOrigin(subdomain: string | null | undefined): string | null {
  const value = String(subdomain ?? "").trim().toLowerCase();
  if (!SUBDOMAIN_PATTERN.test(value) || RESERVED_SUBDOMAINS.has(value)) {
    return null;
  }
  return `https://${value}.${TENANT_BASE_DOMAIN}`;
}

export function resellerTenantHostname(subdomain: string | null | undefined): string | null {
  const origin = resellerTenantOrigin(subdomain);
  return origin ? new URL(origin).hostname : null;
}