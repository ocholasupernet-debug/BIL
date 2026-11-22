import { buildInstallerV2EntryUrl } from "../services/routeros-installer-v2.js";

export function buildSelfInstallTenantOrigin(subdomain: unknown): string | null {
  const entryUrl = buildInstallerV2EntryUrl("https://isplatty.com", subdomain);
  return entryUrl ? new URL(entryUrl).origin : null;
}

export function moveSelfInstallHostnameToCom(hostname: unknown): string {
  const normalized = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (normalized === "isplatty.org") return "isplatty.com";
  if (normalized.endsWith(".isplatty.org")) {
    return `${normalized.slice(0, -".isplatty.org".length)}.isplatty.com`;
  }
  return normalized;
}
