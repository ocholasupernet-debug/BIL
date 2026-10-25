import { getCustomerServiceStatus } from "./customer-service-status";

export const PREPAID_LIVE_SNAPSHOT_MAX_AGE_MS = 60_000;

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
  onlineMacAddresses: Set<string>;
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
  mac_address?: string | null;
  ip_address?: string | null;
  service_online?: boolean | null;
}

export interface PrepaidOnlinePlan {
  router_id?: number | null;
}

export function buildLivePresenceByRouter(
  routers: readonly { id: number }[],
  liveQueries: readonly { data?: PrepaidLiveData; isError?: boolean }[],
  now = Date.now(),
): Map<number, LiveRouterPresence> {
  const presence = new Map<number, LiveRouterPresence>();
  routers.forEach((router, index) => {
    const query = liveQueries[index];
    const live = query?.data;
    const onlineUsers = new Set<string>();
    const onlineMacAddresses = new Set<string>();
    live?.hotspotUsers?.forEach(user => {
      const username = normalizeLiveIdentity(user.user);
      if (username) onlineUsers.add(username);
      const macAddress = normalizeLiveMac(user.macAddress);
      if (macAddress) onlineMacAddresses.add(macAddress);
    });
    live?.pppoeUsers?.forEach(user => {
      const username = normalizeLiveIdentity(user.name);
      if (username) onlineUsers.add(username);
    });
    const fetchedAt = live?.fetchedAt ? Date.parse(live.fetchedAt) : NaN;
    // A transient refresh error can leave React Query holding the last good
    // snapshot. Keep matching sessions from that snapshot briefly instead of
    // replacing a known online result with a stale saved service_online flag.
    const recentSnapshot = Number.isFinite(fetchedAt)
      && fetchedAt <= now
      && now - fetchedAt <= PREPAID_LIVE_SNAPSHOT_MAX_AGE_MS;
    presence.set(router.id, {
      authoritative: recentSnapshot,
      hotspotUsersAvailable: live?.hotspotUsersAvailable !== false,
      pppoeUsersAvailable: live?.pppoeUsersAvailable !== false,
      onlineUsers,
      onlineMacAddresses,
    });
  });
  return presence;
}

export function normalizeLiveIdentity(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeLiveMac(value?: string | null) {
  const mac = String(value ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
  return mac.length === 12 ? mac : "";
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

export function customerIsOnline(
  user: PrepaidOnlineCustomer,
  livePresenceByRouter: Map<number, LiveRouterPresence>,
  planMap: Record<number, PrepaidOnlinePlan>,
  now = Date.now(),
) {
  if (getCustomerServiceStatus(user, now) !== "active") return false;
  if (String(user.type ?? "").toLowerCase() === "vlan") {
    return user.status === "active" && user.service_online === true;
  }
  const routerId = user.router_id ?? (user.plan_id != null ? planMap[user.plan_id]?.router_id : null);
  const routerPresence = routerId == null ? undefined : livePresenceByRouter.get(routerId);
  const serviceType = prepaidServiceType(user.type);
  const sessionListAvailable = serviceType === "hotspot"
    ? Boolean(routerPresence?.authoritative && routerPresence.hotspotUsersAvailable)
    : serviceType === "pppoe"
      ? Boolean(routerPresence?.authoritative && routerPresence.pppoeUsersAvailable)
      : Boolean(routerPresence?.authoritative);
  if (sessionListAvailable && routerPresence) {
    const identities = serviceType === "hotspot"
      ? [user.username, purchaseUsername(user)]
      : serviceType === "pppoe"
        ? [user.pppoe_username, user.username, purchaseUsername(user)]
        : [user.username, user.pppoe_username, purchaseUsername(user)];
    const identityMatches = identities
      .map(normalizeLiveIdentity)
      .filter(Boolean)
      .some(value => routerPresence.onlineUsers.has(value));
    if (identityMatches) return true;
    return serviceType === "hotspot"
      && Boolean(normalizeLiveMac(user.mac_address))
      && routerPresence.onlineMacAddresses.has(normalizeLiveMac(user.mac_address));
  }
  // Keep the last saved online state visible while live router data is loading
  // or unavailable instead of turning every account into a false disconnect.
  return user.service_online === true;
}
