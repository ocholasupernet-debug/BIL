import { sbSelectStrict } from "./supabase-client.js";

export const ROLE_NAMES = ["super_admin", "isp_admin", "sub_admin", "reseller", "support"] as const;
export type PlatformRole = typeof ROLE_NAMES[number];

export const PERMISSION_CATALOG = [
  { category: "Admins", perms: ["View Admins", "Create Admins", "Edit Admins", "Delete Admins", "Toggle Active"] },
  { category: "Customers", perms: ["View Customers", "Create Customers", "Edit Customers", "Delete Customers", "Export Customers"] },
  { category: "Routers", perms: ["View Routers", "Add Routers", "Edit Routers", "Delete Routers", "Push Config"] },
  { category: "Plans", perms: ["View Plans", "Create Plans", "Edit Plans", "Delete Plans"] },
  { category: "Vouchers", perms: ["View Vouchers", "Generate Vouchers", "Delete Vouchers", "Export Vouchers"] },
  { category: "Billing", perms: ["View Transactions", "Create Invoices", "Issue Refunds", "Configure Billing"] },
  { category: "Reports", perms: ["View Reports", "Export Reports", "Custom Reports"] },
  { category: "Settings", perms: ["View Settings", "Edit Settings", "Manage Gateways", "System Limits"] },
  { category: "Security", perms: ["View Logs", "Manage API Keys", "Manage Backups", "Automation"] },
] as const;

export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap(group => [...group.perms]);

export interface PermissionRow {
  role_name: string;
  permission_key: string;
  enabled: boolean;
  updated_at?: string;
}

function normalizeRole(role: unknown): PlatformRole | null {
  const normalized = String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "admin") return "isp_admin";
  return (ROLE_NAMES as readonly string[]).includes(normalized) ? normalized as PlatformRole : null;
}

export async function adminHasPermission(adminId: number, permission: string): Promise<boolean> {
  const admins = await sbSelectStrict<{ role: string | null }>(
    "isp_admins",
    `id=eq.${adminId}&is_active=is.true&select=role&limit=1`,
  );
  const role = normalizeRole(admins[0]?.role ?? "isp_admin");
  if (!role) return false;
  if (role === "super_admin") return true;
  const rows = await sbSelectStrict<PermissionRow>(
    "platform_role_permissions",
    `role_name=eq.${role}&permission_key=eq.${encodeURIComponent(permission)}&select=enabled&limit=1`,
  );
  return rows[0]?.enabled === true;
}

export function roleLabel(role: string): string {
  return role.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}