import { getCustomerServiceStatus } from "./customer-service-status";

export interface PrepaidLiveRouter {
  id: number;
  name: string;
}

export interface PrepaidLiveData {
  hotspotUsers?: Array<{
    user?: string;
    macAddress?: string;
    bytesIn?: number;
    bytesOut?: number;
  }>;
  hotspotUsersAvailable?: boolean;
  pppoeUsers?: Array<{ name?: string; bytesIn?: number; bytesOut?: number }>;
  pppoeUsersAvailable?: boolean;
  fetchedAt?: string;
}

export interface LiveRouterPresence {
  authoritative: boolean;
  hotspotUsersAvailable: boolean;
  pppoeUsersAvailable: boolean;
  onlineUsers: Set<string>;
  hotspotMacAddresses: Set<string>;
}

export interface PrepaidOnlineCustomer {
  id: number;
  type?: string | null;
  status?: string | null;
  expires_at?: string | null;
  depletion_reason?: string | null;
  plan_id?: number | null;
  router_id?: number | null;
  username?: string | null;
  pppoe_username?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  service_online?: boolean | null;
}

export interface PrepaidOnlinePlan {
  router_id?: number | null;
}

export function buildLivePresenceByRouter(
  routers: readonly { id: number }[],
  liveQueries: readonly { data?: PrepaidLiveData; isError?: boolean }[],
): Map<number, LiveRouterPresence> {
  const presence = new Map<number, LiveRouterPresence>();
  routers.forEach((router, index) => {
    const query = liveQueries[index];
    const live = query?.data;
    const onlineUsers = new Set<string>();
    const hotspotMacAddresses = new Set<string>();
    live?.hotspotUsers?.forEach(user => {
      const username = normalizeLiveIdentity(user.user);
      if (username) onlineUsers.add(username);
      const macAddress = normalizeLiveMac(user.macAddress);
      if (macAddress) hotspotMacAddresses.add(macAddress);
    });
    live?.pppoeUsers?.forEach(user => {
      const username = normalizeLiveIdentity(user.name);
      if (username) onlineUsers.add(username);
    });
    presence.set(router.id, {
      authoritative: Boolean(live?.fetchedAt && !query?.isError),
      hotspotUsersAvailable: live?.hotspotUsersAvailable !== false,
      pppoeUsersAvailable: live?.pppoeUsersAvailable !== false,
      onlineUsers,
      hotspotMacAddresses,
    });
  });
  return presence;
}

export function normalizeLiveIdentity(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeLiveMac(value?: string | null) {
  const mac = String(value ?? "").replace(/[^a-f0-9]/gi, "").toUpperCase();
  return /^[A-F0-9]{12}$/.test(mac) ? mac : "";
}

export function prepaidServiceType(value?: string | null) {
  const type = String(value ?? "").toLowerCase();
  return type === "trial" || type === "trials" || type === "voucher" ? "hotspot" : type;
}

export function purchaseUsername(user: PrepaidOnlineCustomer) {
  const type = String(user.type ?? "").toLowerCase();
  if (type === "vlan") return user.ip_address || `VLAN customer #${user.id}`;
  const actual = type === "hotspot" || type === "voucher" ? user.username : (user.pppoe_username || user.username);
  if (actual) return actual;
  return `prepaid-${user.id}`;
}

export type CustomerLiveState = "online" | "offline" | "unknown";

export function getCustomerLiveState(
  user: PrepaidOnlineCustomer,
  livePresenceByRouter: Map<number, LiveRouterPresence>,
  planMap: Record<number, PrepaidOnlinePlan>,
  now = Date.now(),
): CustomerLiveState {
  if (getCustomerServiceStatus(user, now) !== "active") return "offline";
  if (String(user.type ?? "").toLowerCase() === "vlan") {
    if (user.status !== "active") return "offline";
    if (user.service_online === true) return "online";
    return user.service_online === false ? "offline" : "unknown";
  }
  const routerId = user.router_id ?? (user.plan_id != null ? planMap[user.plan_id]?.router_id : null);
  const routerPresence = routerId == null ? undefined : livePresenceByRouter.get(routerId);
  const serviceType = prepaidServiceType(user.type);
  const sessionListAvailable = serviceType === "hotspot"
    ? Boolean(routerPresence?.authoritative && routerPresence.hotspotUsersAvailable)
    : serviceType === "pppoe"
      ? Boolean(routerPresence?.authoritative && routerPresence.pppoeUsersAvailable)
      : Boolean(routerPresence?.authoritative);
  if (!sessionListAvailable || !routerPresence) return "unknown";

  const identities = serviceType === "hotspot"
    ? [user.username, purchaseUsername(user)]
    : serviceType === "pppoe"
      ? [user.pppoe_username, user.username, purchaseUsername(user)]
      : [user.username, user.pppoe_username, purchaseUsername(user)];
  const usernameMatch = identities
    .map(normalizeLiveIdentity)
    .filter(Boolean)
    .some(value => routerPresence.onlineUsers.has(value));
  if (usernameMatch) return "online";
  if (
    serviceType === "hotspot"
    && normalizeLiveMac(user.mac_address)
    && routerPresence.hotspotMacAddresses.has(normalizeLiveMac(user.mac_address))
  ) return "online";
  return "offline";
}

export function customerIsOnline(
  user: PrepaidOnlineCustomer,
  livePresenceByRouter: Map<number, LiveRouterPresence>,
  planMap: Record<number, PrepaidOnlinePlan>,
  now = Date.now(),
) {
  return getCustomerLiveState(user, livePresenceByRouter, planMap, now) === "online";
}
