export interface HotspotAdminGrantCustomer {
  id: number;
  name: string | null;
  phone: string | null;
  mac_address: string | null;
  username: string | null;
  password: string | null;
  type: string | null;
  plan_id: number | null;
  router_id: number | null;
  port_id: number | null;
  status: string;
  expires_at: string | null;
}

export interface HotspotAdminGrantPlanScope {
  id: number;
  type: string | null;
  router_id: number | null;
  port_id: number | null;
}

export interface HotspotAdminGrantTarget {
  routerId: number;
  macAddress: string;
  name: string;
}

export interface HotspotAdminGrantMatch extends HotspotAdminGrantCustomer {
  matchType: "device" | "name" | "device_and_name";
  eligible: boolean;
  reason: string | null;
}

export function normalizeHotspotGrantMac(value: unknown): string | null {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-F0-9]/g, "");
  if (!/^[A-F0-9]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g)!.join(":");
}

function normalizedName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function findHotspotAdminGrantMatches(
  customers: HotspotAdminGrantCustomer[],
  plans: HotspotAdminGrantPlanScope[],
  target: HotspotAdminGrantTarget,
): HotspotAdminGrantMatch[] {
  const targetMac = normalizeHotspotGrantMac(target.macAddress);
  const targetName = normalizedName(target.name);
  if (!targetMac || !targetName) return [];

  const planById = new Map(plans.map(plan => [plan.id, plan]));
  return customers
    .flatMap(customer => {
      const customerType = String(customer.type ?? "").toLowerCase();
      const macMatches = normalizeHotspotGrantMac(customer.mac_address) === targetMac;
      const nameMatches = normalizedName(customer.name) === targetName;
      if (!macMatches && !nameMatches) return [];

      const plan = customer.plan_id ? planById.get(customer.plan_id) : undefined;
      const serviceType = String(plan?.type ?? "").toLowerCase();
      const assignedRouter = customer.router_id ?? plan?.router_id ?? null;
      const assignedPort = customer.port_id ?? plan?.port_id ?? null;
      const storedMac = normalizeHotspotGrantMac(customer.mac_address);
      const hasStoredMac = Boolean(String(customer.mac_address ?? "").trim());
      let reason: string | null = null;
      if (customerType !== "hotspot") {
        reason = "This matching record is not a standard Hotspot account; review it before granting another login.";
      } else if (hasStoredMac && !storedMac) {
        reason = "This record has an invalid stored device MAC; repair it before changing access.";
      } else if (storedMac && storedMac !== targetMac) {
        reason = "This record is already linked to a different device MAC.";
      } else if (assignedRouter !== target.routerId || assignedPort !== null) {
        reason = "This record is assigned to a different router or a port service; do not move it with this grant.";
      } else if (serviceType !== "hotspot") {
        reason = "This record has no verifiable direct Hotspot plan.";
      } else if (!customer.plan_id || !customer.username || !customer.password || !customer.phone) {
        reason = "This record is missing a linked plan or login details needed for a safe in-place update.";
      }

      return [{
        ...customer,
        matchType: macMatches && nameMatches
          ? "device_and_name" as const
          : macMatches
            ? "device" as const
            : "name" as const,
        eligible: reason === null,
        reason,
      }];
    })
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.matchType !== right.matchType) {
        return left.matchType === "device_and_name" ? -1 : right.matchType === "device_and_name" ? 1 : 0;
      }
      return right.id - left.id;
    });
}

export function hotspotAdminGrantUsername(routerId: number, macAddress: string): string {
  const mac = normalizeHotspotGrantMac(macAddress);
  if (!Number.isSafeInteger(routerId) || routerId < 1 || !mac) {
    throw new Error("A valid router and device MAC are required to create a Hotspot grant.");
  }
  return `tv${routerId}${mac.replace(/:/g, "").toLowerCase()}`;
}

export function hotspotAdminGrantExpiry(now = Date.now()): string {
  return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
}
