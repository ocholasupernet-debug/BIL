import {
  summarizeHotspotVoucherStatus,
  type HotspotVoucherSession,
} from "./hotspot-voucher-status.js";

export type BillableRouterSessionService = "hotspot" | "pppoe";

export interface CustomerEntitlementRecord {
  id?: number;
  plan_id?: number | null;
  router_id?: number | null;
  port_id?: number | null;
  type?: string | null;
  status?: string | null;
  expires_at?: string | null;
  depletion_reason?: string | null;
  username?: string | null;
  pppoe_username?: string | null;
  mac_address?: string | null;
}

export interface HotspotVoucherEntitlementRecord {
  code: string;
  validity_mins: number | null;
  data_limit_mb: number | null;
  data_cap_mode: "disconnect" | "throttle" | null;
  expires_at: string | null;
  service_expires_at: string | null;
  redeemed_at: string | null;
}

function normalizedIdentity(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function customerRecordHasActiveEntitlement(
  customer: Pick<CustomerEntitlementRecord, "status" | "expires_at" | "depletion_reason">,
  nowMs = Date.now(),
): boolean {
  const status = String(customer.status ?? "").trim().toLowerCase();
  if (status === "suspended" || customer.depletion_reason === "data_limit") return false;

  const acceptedStatus = status === "active"
    || status === "payment_cleared_router_pending"
    || status === "expired";
  if (!acceptedStatus) return false;

  if (!customer.expires_at) return status === "active";
  const expiresAt = Date.parse(customer.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function customerEntitlesRouterSession(
  service: BillableRouterSessionService,
  username: string,
  macAddress: string | null | undefined,
  customers: readonly CustomerEntitlementRecord[],
  nowMs = Date.now(),
): boolean {
  return matchingActiveCustomerRecordsForRouterSession(
    service,
    username,
    macAddress,
    customers,
    nowMs,
  ).length > 0;
}

export function matchingActiveCustomerRecordsForRouterSession(
  service: BillableRouterSessionService,
  username: string,
  macAddress: string | null | undefined,
  customers: readonly CustomerEntitlementRecord[],
  nowMs = Date.now(),
): CustomerEntitlementRecord[] {
  const login = normalizedIdentity(username);
  const mac = normalizedIdentity(macAddress);
  if (!login && !(service === "hotspot" && mac)) return [];

  return customers.filter(customer => {
    const type = String(customer.type ?? "").trim().toLowerCase();
    const allowedType = service === "pppoe"
      ? type === "pppoe"
      : type === "hotspot" || type === "voucher" || type === "trial" || type === "trials";
    if (!allowedType || !customerRecordHasActiveEntitlement(customer, nowMs)) return false;

    const loginMatches = Boolean(login) && [
      customer.username,
      service === "pppoe" ? customer.pppoe_username : null,
    ].some(value => normalizedIdentity(value) === login);
    const macMatches = service === "hotspot"
      && Boolean(mac)
      && normalizedIdentity(customer.mac_address) === mac;
    return loginMatches || macMatches;
  });
}

export function voucherEntitlesLiveHotspotSession(
  voucher: HotspotVoucherEntitlementRecord,
  accountingSessions: readonly HotspotVoucherSession[],
  nowMs = Date.now(),
): boolean {
  // The live RouterOS session itself proves the voucher is being used, even if
  // FreeRADIUS has not written its accounting row yet.
  const liveSession: HotspotVoucherSession = {
    acctstarttime: null,
    acctstoptime: null,
    callingstationid: null,
    framedipaddress: null,
    acctinputoctets: 0,
    acctoutputoctets: 0,
    acctinputgigawords: 0,
    acctoutputgigawords: 0,
  };
  const result = summarizeHotspotVoucherStatus({
    sessions: [...accountingSessions, liveSession],
    validityMins: voucher.validity_mins ?? 0,
    redeemBy: voucher.expires_at,
    redeemedAt: voucher.redeemed_at,
    serviceExpiresAt: voucher.service_expires_at,
    dataLimitMb: voucher.data_limit_mb,
    dataCapMode: voucher.data_cap_mode ?? "disconnect",
    now: nowMs,
  });
  return result.serviceStatus === "active" || result.serviceStatus === "available";
}
