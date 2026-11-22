export const STAFF_PORTAL_HOST = "staff.isplatty.com";
const CANONICAL_EMPLOYEE_ADMIN_HOST = "employee1088.isplatty.com";

function hostnameOnly(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

export function isEmployeeAdminHost(host: string): boolean {
  const normalized = hostnameOnly(host);
  return normalized === CANONICAL_EMPLOYEE_ADMIN_HOST;
}

export function isStaffPortalHost(host: string): boolean {
  const normalized = hostnameOnly(host);
  if (normalized === STAFF_PORTAL_HOST) return true;
  if (process.env.NODE_ENV === "production") return false;

  const configuredPreviewHost = hostnameOnly(process.env.REPLIT_DEV_DOMAIN || "");
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    (configuredPreviewHost !== "" && normalized === configuredPreviewHost);
}

export function staffActivationUrl(token: string): string {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new Error("Invalid staff invitation token.");
  }
  return `https://${STAFF_PORTAL_HOST}/staff/activate#token=${encodeURIComponent(token)}`;
}
