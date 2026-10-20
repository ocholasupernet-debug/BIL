export interface HotspotTetherGuardConfig {
  mode: "enforce" | "cleanup";
  ttlValues: number[];
}

export type HotspotTetherGuardEnvironment = Record<string, string | undefined>;

export const DEFAULT_HOTSPOT_TETHER_TTL_VALUES = [63, 127] as const;

export function parseHotspotTetherTtlValues(value: string | undefined): number[] {
  return [...new Set(
    String(value ?? "")
      .split(",")
      .map(part => Number(part.trim()))
      .filter(value => Number.isInteger(value) && value > 0 && value <= 255),
  )].sort((a, b) => a - b);
}

export function hotspotTetherGuardConfigForRouter(
  routerId: number,
  env: HotspotTetherGuardEnvironment = process.env,
): HotspotTetherGuardConfig | null {
  if (!Number.isSafeInteger(routerId) || routerId < 1) return null;

  const enabled = String(env.HOTSPOT_TETHER_GUARD_ENABLED ?? "true").trim().toLowerCase() !== "false";
  const ttlSetting = env.HOTSPOT_TETHER_GUARD_TTL_VALUES;
  const ttlValues = ttlSetting === undefined
    ? [...DEFAULT_HOTSPOT_TETHER_TTL_VALUES]
    : parseHotspotTetherTtlValues(ttlSetting);
  return enabled && ttlValues.length > 0
    ? { mode: "enforce", ttlValues }
    : { mode: "cleanup", ttlValues: [] };
}

export function hotspotTetherAddressListName(planId: number): string {
  if (!Number.isSafeInteger(planId) || planId < 1) {
    throw new Error("A valid plan ID is required to name a tethering address list.");
  }
  return `osn_tether_block_${planId}`;
}

export function hotspotTetherRuleComment(planId: number, ttl: number): string {
  if (!Number.isSafeInteger(planId) || planId < 1 || !Number.isInteger(ttl) || ttl < 1 || ttl > 255) {
    throw new Error("A valid plan ID and TTL value are required for a tethering rule.");
  }
  return `OSN_TETHER_GUARD:PLAN_${planId}:TTL_${ttl}`;
}

export function hotspotTetherRuleArgs(planId: number, ttl: number): string[] {
  const addressList = hotspotTetherAddressListName(planId);
  const comment = hotspotTetherRuleComment(planId, ttl);
  return [
    "/ip/firewall/filter/add",
    "=chain=forward",
    "=action=drop",
    `=src-address-list=${addressList}`,
    `=ttl=equal:${ttl}`,
    "=place-before=0",
    `=comment=${comment}`,
  ];
}

export function hotspotTetherRuleCommentPrefix(planId: number): string {
  if (!Number.isSafeInteger(planId) || planId < 1) {
    throw new Error("A valid plan ID is required to find tethering rules.");
  }
  return `OSN_TETHER_GUARD:PLAN_${planId}:`;
}
