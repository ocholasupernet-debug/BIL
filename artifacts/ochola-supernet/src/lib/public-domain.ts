const configuredDomain = String(import.meta.env.VITE_PUBLIC_BASE_DOMAIN ?? "")
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");

export const PUBLIC_BASE_DOMAIN = configuredDomain || "isplatty.com";

if (!["isplatty.org", "isplatty.com"].includes(PUBLIC_BASE_DOMAIN)) {
  throw new Error(`Unsupported VITE_PUBLIC_BASE_DOMAIN: ${PUBLIC_BASE_DOMAIN}`);
}

export function publicOrigin(): string {
  return `https://${PUBLIC_BASE_DOMAIN}`;
}

export function tenantHostname(subdomain: string): string {
  const label = subdomain.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
    throw new Error("Invalid public subdomain.");
  }
  return `${label}.${PUBLIC_BASE_DOMAIN}`;
}
