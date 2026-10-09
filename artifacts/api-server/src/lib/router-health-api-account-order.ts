import { ROUTER_MANAGEMENT_API_USERNAME } from "./router-management-vpn.js";
import { isRouterManagementVpnIp } from "./router-vpn-ip.js";

export function routerHealthApiAccountOrder(
  savedUsername: string | null | undefined,
  managementVpnIp: string | null | undefined,
): { username: string; alternateUsernames?: string[] } {
  const saved = savedUsername?.trim() || "admin";
  if (!isRouterManagementVpnIp(managementVpnIp ?? "")) {
    return { username: saved };
  }

  return {
    username: ROUTER_MANAGEMENT_API_USERNAME,
    ...(saved !== ROUTER_MANAGEMENT_API_USERNAME ? { alternateUsernames: [saved] } : {}),
  };
}

// Shared by router health and VPN-scoped RouterOS operations that need the
// same management-account-first policy.
export const routerManagementApiAccountOrder = routerHealthApiAccountOrder;