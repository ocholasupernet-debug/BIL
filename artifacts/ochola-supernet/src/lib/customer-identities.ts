export interface ServiceIdentityCustomer {
  id: number;
  type?: string | null;
  plan_id?: number | null;
  router_id?: number | null;
  port_id?: number | null;
  mac_address?: string | null;
  phone?: string | null;
  pppoe_username?: string | null;
  username?: string | null;
  ip_address?: string | null;
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
    const [primary, ...related] = group;
    const merged = { ...primary } as MergedServiceIdentity<T>;
    const mergedFields = merged as unknown as Record<string, unknown>;

    for (const relatedCustomer of related) {
      for (const [field, value] of Object.entries(relatedCustomer)) {
        if (primaryStateFields.has(field) || !isMissingCustomerValue(mergedFields[field])) continue;
        if (!isMissingCustomerValue(value)) mergedFields[field] = value;
      }
    }

    merged.mergedCustomerIds = group.map(customer => customer.id);
    return merged;
  });
}
