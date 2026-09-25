export type VlanCustomerQueueIdentity = {
  adminId: number;
  customerId: number;
  ipAddress: string;
  name: string;
  target: string;
  comment: string;
};

type VlanCustomerQueuePresenceFields = {
  name: string;
  target: string;
  comment: string;
  disabled: boolean;
  rate: string;
};

function ipv4ToNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(raw)) return null;
  const octets = raw.split(".").map(Number);
  if (octets.some(octet => octet > 255)) return null;
  return octets.reduce((result, octet) => result * 256 + octet, 0);
}

export function isValidIpv4(value: unknown): value is string {
  return ipv4ToNumber(value) !== null;
}

export function isValidVlanTag(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,4}$/.test(raw)) return false;
  const tag = Number(raw);
  return Number.isInteger(tag) && tag >= 1 && tag <= 4094;
}

export function ipv4InSubnet(address: unknown, subnet: unknown): boolean {
  const ip = ipv4ToNumber(address);
  const rawSubnet = String(subnet ?? "").trim();
  const [networkAddress, prefixText, ...extra] = rawSubnet.split("/");
  const network = ipv4ToNumber(networkAddress);
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (ip === null || network === null || extra.length > 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (network & mask);
}

export function vlanCustomerQueueIdentity(
  adminId: number,
  customerId: number,
  ipAddress: unknown,
): VlanCustomerQueueIdentity {
  if (!Number.isSafeInteger(adminId) || adminId < 1) {
    throw new Error("A valid ISP account is required for a VLAN customer queue.");
  }
  if (!Number.isSafeInteger(customerId) || customerId < 1) {
    throw new Error("A valid customer account is required for a VLAN customer queue.");
  }
  const ip = String(ipAddress ?? "").trim();
  if (!isValidIpv4(ip)) throw new Error("A valid assigned IPv4 address is required for a VLAN customer.");
  const safeIp = ip.replace(/\./g, "-");
  const name = `ochola-vlan-${adminId}-${customerId}-${safeIp}`;
  if (name.length > 64) throw new Error("The VLAN customer queue identity is too long for RouterOS.");
  return {
    adminId,
    customerId,
    ipAddress: ip,
    name,
    target: `${ip}/32`,
    comment: `ochola-vlan-customer:${adminId}:${customerId}:${ip}`,
  };
}

export function isVlanCustomerQueueName(value: unknown): boolean {
  return /^ochola-vlan-\d+-\d+-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/.test(String(value ?? ""));
}

export function isValidSimpleQueueRateLimit(value: unknown): value is string {
  const raw = String(value ?? "").trim();
  const match = /^(\d+(?:\.\d+)?)([kMG]?)\/(\d+(?:\.\d+)?)([kMG]?)$/.exec(raw);
  return !!match && Number(match[1]) > 0 && Number(match[3]) > 0;
}

export function parseVlanQueueCounters(
  bytes: unknown,
  bytesIn?: unknown,
  bytesOut?: unknown,
): { bytesIn: number; bytesOut: number } | null {
  const explicitIn = bytesIn === undefined ? null : Number(bytesIn);
  const explicitOut = bytesOut === undefined ? null : Number(bytesOut);
  if (explicitIn !== null && explicitOut !== null) {
    if (Number.isFinite(explicitIn) && Number.isFinite(explicitOut) && explicitIn >= 0 && explicitOut >= 0) {
      return { bytesIn: Math.floor(explicitIn), bytesOut: Math.floor(explicitOut) };
    }
    return null;
  }

  const pair = /^(\d+)\/(\d+)$/.exec(String(bytes ?? "").trim());
  if (!pair) return null;
  return { bytesIn: Number(pair[1]), bytesOut: Number(pair[2]) };
}

export function vlanQueueHasTraffic(rate: unknown): boolean {
  const pair = /^(\d+)\/(\d+)$/.exec(String(rate ?? "").trim());
  return !!pair && (Number(pair[1]) > 0 || Number(pair[2]) > 0);
}

export function vlanCustomerQueuePresence<T extends VlanCustomerQueuePresenceFields>(
  adminId: number,
  customer: { id: number; ipAddress: unknown; expiresAt: string | null },
  queues: readonly T[],
  statsAvailable: boolean,
  observedAtMs: number,
): { statsAvailable: boolean; online: boolean; queue: T | null } {
  if (!statsAvailable) return { statsAvailable: false, online: false, queue: null };

  let queue: T | undefined;
  try {
    const identity = vlanCustomerQueueIdentity(adminId, customer.id, customer.ipAddress);
    queue = queues.find(candidate =>
      candidate.name === identity.name
      && candidate.comment === identity.comment
      && candidate.target === identity.target,
    );
  } catch {
    queue = undefined;
  }

  const expiresAtMs = customer.expiresAt ? Date.parse(customer.expiresAt) : Number.NaN;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= observedAtMs;
  return {
    statsAvailable: true,
    online: !!queue && !queue.disabled && vlanQueueHasTraffic(queue.rate) && !expired,
    queue: queue ?? null,
  };
}
