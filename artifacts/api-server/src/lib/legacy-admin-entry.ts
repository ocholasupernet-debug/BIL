import { getTenantSubdomain } from "./tenant-host.js";

/**
 * Resolve the one supported PHP-style compatibility URL to the existing
 * tenant-aware login route. This intentionally never executes or serves PHP.
 */
export function resolveLegacyAdminEntry(host: string, requestUrl: string): string | null {
  if (!getTenantSubdomain(host)) return null;

  let url: URL;
  try {
    url = new URL(requestUrl, "https://routing.invalid");
  } catch {
    return null;
  }

  const routeValues = url.searchParams.getAll("_route");
  if (url.pathname !== "/index.php" || routeValues.length !== 1 || routeValues[0] !== "admin/") {
    return null;
  }

  return "/admin/login";
}

/**
 * Canonicalize tenant login URLs to the PHP-style entry point without
 * executing PHP or affecting customer Hotspot hostnames.
 */
export function resolveCanonicalAdminLoginRedirect(
  host: string,
  requestUrl: string,
): string | null {
  if (!getTenantSubdomain(host)) return null;

  let url: URL;
  try {
    url = new URL(requestUrl, "https://routing.invalid");
  } catch {
    return null;
  }

  if (url.pathname !== "/admin/login") return null;

  const params = new URLSearchParams();
  params.set("_route", "admin/");
  for (const [key, value] of url.searchParams) {
    if (key !== "_route") params.append(key, value);
  }

  return `/index.php?${params.toString().replace("_route=admin%2F", "_route=admin/")}`;
}
