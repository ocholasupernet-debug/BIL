export function normalizePortalHostname(value: unknown): string | null {
  const hostname = String(value ?? "").trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname)
    || hostname.includes("..")
    || hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return null;
  }
  return hostname;
}