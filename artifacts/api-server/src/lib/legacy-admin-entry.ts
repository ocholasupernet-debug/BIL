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

  return "/admin/entry";
}
