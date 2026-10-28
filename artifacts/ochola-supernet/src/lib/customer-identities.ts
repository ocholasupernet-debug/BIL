import { getCustomerServiceStatus } from "./customer-service-status";

export interface ServiceIdentityCustomer {
  id: number;
  type?: string | null;
  status?: unknown;
  plan_id?: number | null;
  router_id?: number | null;
  port_id?: number | null;
  mac_address?: string | null;
  phone?: string | null;
  pppoe_username?: string | null;
  username?: string | null;
  ip_address?: string | null;
  expires_at?: string | null;
  depletion_reason?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ServiceIdentityPlan {
  router_id?: number | null;
  port_id?: number | null;
}

export type MergedServiceIdentity<T> = T & { mergedCustomerIds: number[] };

function normalizedIdentity(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function customerIdentityKey(
  customer: ServiceIdentityCustomer,
  plans: Record<number, ServiceIdentityPlan>,
) {
  const type = String(customer.type ?? "").toLowerCase();
  const plan = customer.plan_id ? plans[customer.plan_id] : null;
  const routerId = customer.router_id ?? plan?.router_id ?? null;
  const portId = customer.port_id ?? plan?.port_id ?? null;
  const scope = `${routerId ?? "unknown-router"}:${portId ?? "unknown-port"}`;

  if (type === "hotspot" || type === "trial" || type === "trials") {
    const mac = String(customer.mac_address ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
    const phone = String(customer.phone ?? "").replace(/\D/g, "");
    // A MAC can be shared or reused, so only group Hotspot rows when both
    // the device and contact number match.
    if (mac.length === 12 && phone) return `hotspot:${scope}:${mac}:${phone}`;
  } else if (type === "pppoe") {
    const username = normalizedIdentity(customer.pppoe_username || customer.username);
    if (username) return `pppoe:${scope}:${username}`;
  } else if (type === "vlan" || type === "static") {
    const address = normalizedIdentity(customer.ip_address);
    if (address) return `${type}:${scope}:${address}`;
  }

  return `record:${customer.id}`;
}

function customerRecordTime(customer: ServiceIdentityCustomer) {
  const created = Date.parse(customer.created_at ?? "");
  const updated = Date.parse(customer.updated_at ?? "");
  return Number.isFinite(created) ? created : Number.isFinite(updated) ? updated : 0;
}

function isMissingCustomerValue(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function mergeCustomerServiceIdentities<T extends ServiceIdentityCustomer>(
  customers: T[],
  plans: Record<number, ServiceIdentityPlan>,
  now = Date.now(),
): MergedServiceIdentity<T>[] {
  const groups = new Map<string, T[]>();
  for (const customer of customers) {
    const key = customerIdentityKey(customer, plans);
    const group = groups.get(key) ?? [];
    group.push(customer);
    groups.set(key, group);
  }

  const primaryStateFields = new Set([
    "id", "status", "created_at", "updated_at", "expires_at",
    "last_seen", "service_online", "data_used_bytes", "data_used_mb",
    "depletion_reason", "password", "username", "pppoe_username",
  ]);

  return Array.from(groups.values(), group => {
    group.sort((a, b) => customerRecordTime(b) - customerRecordTime(a) || b.id - a.id);
    const newest = group[0];
    const newestIsSuspended = getCustomerServiceStatus(newest, now) === "suspended";
    if (
      !newestIsSuspended
      && ["hotspot", "trial", "trials"].includes(String(newest.type ?? "").toLowerCase())
    ) {
      const activeIndex = group.findIndex(customer =>
        getCustomerServiceStatus(customer, now) === "active",
      );
      if (activeIndex > 0) {
        const [activeCustomer] = group.splice(activeIndex, 1);
        group.unshift(activeCustomer);
      }
    }
    const [primary, ...related] = group;
    const merged = { ...primary } as MergedServiceIdentity<T>;
    const mergedFields = merged as unknown as Record<string, unknown>;

    for (const relatedCustomer of related) {
      for (const [field, value] of Object.entries(relatedCustomer)) {
        if (primaryStateFields.has(field) || !isMissingCustomerValue(mergedFields[field])) continue;
        if (!isMissingCustomerValue(value)) mergedFields[field] = value;
      }
    }

    // Router imports can add a newer PPPoE identity row without an expiry.
    // Keep the newest stored expiry from the same scoped identity when that
    // happens, but never replace an expiry already present on the primary row.
    if (String(primary.type ?? "").toLowerCase() === "pppoe" && isMissingCustomerValue(mergedFields.expires_at)) {
      const relatedExpiry = related.find(customer => {
        const expiry = customer.expires_at;
        return typeof expiry === "string" && Number.isFinite(Date.parse(expiry));
      })?.expires_at;
      if (relatedExpiry) mergedFields.expires_at = relatedExpiry;
    }

    merged.mergedCustomerIds = group.map(customer => customer.id);
    return merged;
  });
}
