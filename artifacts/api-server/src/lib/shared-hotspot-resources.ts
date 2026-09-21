export const SHARED_HOTSPOT_SERVER_NAME = "hotspot";
export const SHARED_HOTSPOT_POOL_NAME = "hotspot pool";
export const SHARED_HOTSPOT_PROFILE_NAME = "hsprof";

export function legacySharedHotspotResourceNames(routerId: number | string): {
  serverName: string;
  poolName: string;
} {
  const tag = `ochola-services-${routerId}`;
  return {
    serverName: `${tag}-hotspot`,
    poolName: `${tag}-hotspot-pool`,
  };
}