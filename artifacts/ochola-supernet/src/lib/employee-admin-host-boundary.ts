const EMPLOYEE_ADMIN_HOSTNAME = "employee1088.isplatty.com";

export function shouldRedirectPlatformAdminToStaffFinance(hostname: string, path: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
  const normalizedPath = path.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  return normalizedHost === EMPLOYEE_ADMIN_HOSTNAME &&
    (normalizedPath === "/super-admin" || normalizedPath.startsWith("/super-admin/"));
}
