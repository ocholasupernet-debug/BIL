export interface PendingHotspotCustomerForRetry {
  id: number;
  admin_id: number;
  plan_id: number;
  type: string;
  status: string;
  mac_address: string | null;
  router_id: number | null;
  port_id: number | null;
  expires_at: string | null;
  depletion_reason: string | null;
}

export interface PaidHotspotTransactionForRetry {
  id: number;
  admin_id: number;
  customer_id: number;
  plan_id: number;
  status: string;
  payment_method: string;
  payment_intent_id: string | null;
  reference: string | null;
  mac_address: string | null;
}

export interface HotspotPlanRetryScope {
  type: string;
  router_id: number | null;
  port_id: number | null;
}

export const ACTIVE_HOTSPOT_SESSION_PENDING_NOTE = "session activation is pending";

function normalizedMac(value: string | null) {
  return String(value ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

export function isRetryablePaidHotspotAccount(
  customer: PendingHotspotCustomerForRetry,
  transaction: PaidHotspotTransactionForRetry,
  plan: HotspotPlanRetryScope,
  now = Date.now(),
  allowLegacyActive = false,
) {
  const mac = normalizedMac(customer.mac_address);
  const transactionMac = normalizedMac(transaction.mac_address);
  const expiry = customer.expires_at ? Date.parse(customer.expires_at) : NaN;
  const customerStatus = customer.status.toLowerCase();
  return customer.type.toLowerCase() === "hotspot"
    && (customerStatus === "payment_cleared_router_pending" || (allowLegacyActive && customerStatus === "active"))
    && !String(customer.depletion_reason ?? "").trim()
    && Number.isFinite(expiry)
    && expiry > now
    && customer.admin_id === transaction.admin_id
    && customer.id === transaction.customer_id
    && customer.plan_id === transaction.plan_id
    && ["completed", "paid", "success"].includes(transaction.status.toLowerCase())
    && transaction.payment_method.toLowerCase() === "mpesa"
    && Boolean(transaction.payment_intent_id)
    && Boolean(transaction.reference && /^[A-Za-z0-9_-]{8,128}$/.test(transaction.reference))
    && mac.length === 12
    && transactionMac === mac
    && plan.type.toLowerCase() === "hotspot"
    && customer.router_id != null
    && customer.router_id === plan.router_id
    && customer.port_id === plan.port_id;
}
