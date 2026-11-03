export type HotspotHostMapping = {
  adminId: number;
  portalHostname: string | null;
  subdomain: string | null;
  isActive: boolean;
  status: string;
};

export function normalizeRequestHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

export function isPlatformHostname(host: string, baseDomains: string[]): boolean {
  const hostname = normalizeRequestHostname(host);
  return baseDomains.some(domain => {
    const base = domain.trim().toLowerCase();
    return hostname === base || hostname.endsWith(`.${base}`);
  }) || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".replit.dev")
    || hostname.endsWith(".repl.co");
}

export function resolveHotspotHostMapping(
  host: string,
  mappings: HotspotHostMapping[],
): HotspotHostMapping | null {
  const hostname = normalizeRequestHostname(host);
  if (!hostname || !hostname.includes(".")) return null;
  const matches = mappings.filter(mapping =>
    normalizeRequestHostname(mapping.portalHostname ?? "") === hostname
    && Number.isSafeInteger(mapping.adminId)
    && mapping.adminId > 0
    && mapping.isActive
    && mapping.status === "active"
    && Boolean(mapping.subdomain?.trim()),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function injectHotspotHostConfig(html: string, host: string, adminId: number): string {
  const hostname = normalizeRequestHostname(host);
  if (!hostname || !Number.isSafeInteger(adminId) || adminId < 1) return html;
  const config = JSON.stringify({ apiBase: `https://${hostname}`, adminId })
    .replace(/</g, "\\u003c");
  return html.replace(/<head([^>]*)>/i, `<head$1><script>window.__HOTSPOT_CONFIG__=${config};</script>`);
}
