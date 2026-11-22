import { validEmployeeSubdomain } from "./employee-portal-security.js";

export const EMPLOYEE_PORTAL_DOMAIN = "isplatty.com";
const LEGACY_EMPLOYEE_PORTAL_DOMAIN = "isplatty.org";
const CANONICAL_EMPLOYEE_ADMIN_HOST = `employee1088.${EMPLOYEE_PORTAL_DOMAIN}`;
const LEGACY_EMPLOYEE_ADMIN_HOST = `employee1088.${LEGACY_EMPLOYEE_PORTAL_DOMAIN}`;
const configuredAdminHost = (process.env.EMPLOYEE_ADMIN_HOST || CANONICAL_EMPLOYEE_ADMIN_HOST)
  .trim()
  .toLowerCase()
  .replace(/\.$/, "");

function hostnameOnly(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

export function isEmployeeAdminHost(host: string): boolean {
  const normalized = hostnameOnly(host);
  return new Set([
    configuredAdminHost,
    CANONICAL_EMPLOYEE_ADMIN_HOST,
    LEGACY_EMPLOYEE_ADMIN_HOST,
  ]).has(normalized);
}

export function employeeSubdomainForHost(host: string): string | null {
  const normalized = hostnameOnly(host);
  for (const domain of [EMPLOYEE_PORTAL_DOMAIN, LEGACY_EMPLOYEE_PORTAL_DOMAIN]) {
    const suffix = `.employees.${domain}`;
    if (!normalized.endsWith(suffix)) continue;
    const label = normalized.slice(0, -suffix.length);
    return validEmployeeSubdomain(label) ? label : null;
  }
  return null;
}

export function employeeInvitationUrl(subdomain: string, token: string): string {
  if (!validEmployeeSubdomain(subdomain)) {
    throw new Error("Invalid employee subdomain.");
  }
  return `https://${subdomain.toLowerCase()}.employees.${EMPLOYEE_PORTAL_DOMAIN}/employee/activate#token=${encodeURIComponent(token)}`;
}
