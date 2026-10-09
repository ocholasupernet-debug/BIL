import { routerManagementApiAccountOrder } from "./router-health-api-account-order.js";
import { isRouterManagementVpnIp } from "./router-vpn-ip.js";
import { vpnIpFor, type VpnClient } from "./vpn-status.js";

export interface PaymentRouterConnectionSource {
  name?: string | null;
  host?: string | null;
  bridge_ip?: string | null;
  vpn_ip?: string | null;
  router_username?: string | null;
  router_secret?: string | null;
}

export function paymentRouterConnectionCredentials(
  router: PaymentRouterConnectionSource,
  vpnClients: VpnClient[],
) {
  const storedManagementIp = [router.vpn_ip, router.bridge_ip, router.host]
    .map(value => value?.trim() ?? "")
    .find(isRouterManagementVpnIp);
  const discoveredIp = vpnIpFor(router.host?.trim() ?? "", vpnClients)
    ?? vpnIpFor(router.name?.trim() ?? "", vpnClients);
  const managementVpnIp = isRouterManagementVpnIp(discoveredIp)
    ? discoveredIp
    : storedManagementIp;

  const host = managementVpnIp
    || router.host?.trim()
    || router.vpn_ip?.trim()
    || router.bridge_ip?.trim()
    || "";
  const bridgeIp = managementVpnIp
    || router.vpn_ip?.trim()
    || router.bridge_ip?.trim()
    || undefined;
  const accounts = routerManagementApiAccountOrder(router.router_username, managementVpnIp);

  return {
    host,
    port: 8728,
    username: accounts.username,
    password: router.router_secret || "",
    useSSL: false,
    bridgeIp,
    alternateUsernames: accounts.alternateUsernames,
  };
}
