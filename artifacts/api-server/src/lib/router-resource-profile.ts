export type RouterReadProfile = "low-resource" | "standard";

export interface RouterProfileEndpoint {
  host: string;
  port: number;
  bridgeIp?: string;
  useSSL?: boolean;
}

const ROUTER_READ_PROFILE_TTL_MS = 6 * 60 * 60 * 1000;
const ROUTER_READ_PROFILE_CACHE_LIMIT = 512;
const LOW_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const LOW_CPU_CORE_LIMIT = 1;
const LOW_CPU_FREQUENCY_LIMIT_MHZ = 650;

const routerReadProfiles = new Map<
  string,
  { profile: RouterReadProfile; expiresAt: number }
>();

function parseRouterMemoryBytes(value: unknown): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;

  const match = /^(\d+(?:\.\d+)?)\s*(b|kib|mib|gib|kb|mb|gb)?$/i.exec(raw);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;

  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
  };

  return amount * multiplier[unit];
}

function parseCpuFrequencyMhz(value: unknown): number | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return undefined;

  const match = /^(\d+(?:\.\d+)?)\s*(mhz|ghz)?$/.exec(raw);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return match[2] === "ghz" ? amount * 1000 : amount;
}

function hasHardwareProfileFacts(resource: Record<string, unknown>): boolean {
  return Boolean(
    String(resource["board-name"] ?? resource.board ?? resource.model ?? "").trim()
    || parseRouterMemoryBytes(resource["total-memory"]) !== undefined
    || Number.parseInt(String(resource["cpu-count"] ?? ""), 10) > 0
    || parseCpuFrequencyMhz(resource["cpu-frequency"]) !== undefined,
  );
}

export function classifyRouterReadProfile(
  resource: Record<string, unknown> | undefined,
): RouterReadProfile {
  if (!resource) return "standard";

  const model = [
    resource["board-name"],
    resource.board,
    resource.model,
  ].map(value => String(value ?? "")).join(" ").toLowerCase();

  if (/\bhap\s*lite\b|\brb941(?:[-\s]|$)/i.test(model)) {
    return "low-resource";
  }

  const totalMemoryBytes = parseRouterMemoryBytes(resource["total-memory"]);
  if (totalMemoryBytes !== undefined && totalMemoryBytes <= LOW_MEMORY_LIMIT_BYTES) {
    return "low-resource";
  }

  const cpuCount = Number.parseInt(String(resource["cpu-count"] ?? ""), 10);
  const cpuFrequencyMhz = parseCpuFrequencyMhz(resource["cpu-frequency"]);
  if (
    cpuCount > 0
    && cpuCount <= LOW_CPU_CORE_LIMIT
    && cpuFrequencyMhz !== undefined
    && cpuFrequencyMhz <= LOW_CPU_FREQUENCY_LIMIT_MHZ
  ) {
    return "low-resource";
  }

  return "standard";
}

export function routerProfileCacheKey(endpoint: RouterProfileEndpoint): string {
  return [
    endpoint.host.trim().toLowerCase(),
    String(endpoint.port),
    endpoint.useSSL ? "tls" : "tcp",
    endpoint.bridgeIp?.trim().toLowerCase() ?? "",
  ].join("|");
}

export function cachedRouterReadProfile(
  key: string,
  now = Date.now(),
): RouterReadProfile | undefined {
  const entry = routerReadProfiles.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    routerReadProfiles.delete(key);
    return undefined;
  }

  // Refresh insertion order for simple least-recently-used eviction without
  // extending the hardware-classification TTL.
  routerReadProfiles.delete(key);
  routerReadProfiles.set(key, entry);
  return entry.profile;
}

export function rememberRouterReadProfile(
  key: string,
  profile: RouterReadProfile,
  now = Date.now(),
): void {
  routerReadProfiles.delete(key);
  while (routerReadProfiles.size >= ROUTER_READ_PROFILE_CACHE_LIMIT) {
    const oldestKey = routerReadProfiles.keys().next().value;
    if (oldestKey === undefined) break;
    routerReadProfiles.delete(oldestKey);
  }
  routerReadProfiles.set(key, {
    profile,
    expiresAt: now + ROUTER_READ_PROFILE_TTL_MS,
  });
}

export function shouldCacheRouterReadProfile(
  resource: Record<string, unknown> | undefined,
): boolean {
  return Boolean(resource && hasHardwareProfileFacts(resource));
}
