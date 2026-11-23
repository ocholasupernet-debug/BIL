export type StaffPortalSection = "dashboard" | "learning";

const STAFF_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const STAFF_PORTAL_ORIGIN = "https://staff.isplatty.com";

export function normalizeStaffUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return STAFF_USERNAME.test(username) ? username : null;
}

export function personalizedStaffPath(
  username: unknown,
  section: StaffPortalSection,
): string | null {
  const normalized = normalizeStaffUsername(username);
  return normalized ? `/u/${encodeURIComponent(normalized)}/${section}` : null;
}

export function personalizedStaffUrl(username: unknown): string {
  const path = personalizedStaffPath(username, "dashboard");
  return `${STAFF_PORTAL_ORIGIN}${path ?? "/staff/dashboard"}`;
}

export function parsePersonalizedStaffPath(
  pathname: string,
): { username: string; section: StaffPortalSection } | null {
  const match = pathname.match(/^\/u\/([^/]+)\/(dashboard|learning)\/?$/);
  if (!match) return null;
  let decodedUsername = "";
  try {
    decodedUsername = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const username = normalizeStaffUsername(decodedUsername);
  return username ? { username, section: match[2] as StaffPortalSection } : null;
}

export function safeStaffReturnPath(search: string): string | null {
  const candidate = new URLSearchParams(search).get("returnTo");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;

  let url: URL;
  try {
    url = new URL(candidate, STAFF_PORTAL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== STAFF_PORTAL_ORIGIN || url.search || url.hash) return null;
  const route = parsePersonalizedStaffPath(url.pathname);
  return route ? personalizedStaffPath(route.username, route.section) : null;
}

export function safeBrowserBackTarget(
  referrer: string,
  currentOrigin: string,
  historyLength: number,
): boolean {
  if (historyLength < 2 || !referrer) return false;
  try {
    return new URL(referrer).origin === currentOrigin;
  } catch {
    return false;
  }
}

export function staffNotFoundFallback(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "staff.isplatty.com") return "/staff/login";
  if (host === "employee1088.isplatty.com") return "/employee/admin";
  return "/";
}
