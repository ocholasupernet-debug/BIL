export type HotspotPortalTargetPort = {
  id: number;
  router_id: number;
  hotspot_enabled: boolean;
  assigned_reseller_id?: number | null;
};

export function hotspotPortalTargets<T extends HotspotPortalTargetPort>(
  ports: T[],
  reseller: boolean,
): T[] {
  // Resellers must still be able to select and enable an unfinished service.
  return ports.filter(port => reseller || (port.hotspot_enabled && !port.assigned_reseller_id));
}

export function nextHotspotPortalTarget(
  current: string,
  ports: HotspotPortalTargetPort[],
  reseller: boolean,
): string {
  const targets = hotspotPortalTargets(ports, reseller);
  return targets.some(port => String(port.id) === current)
    ? current
    : String(targets[0]?.id ?? "");
}

export function usesGeneratedHotspotPortal(assetPath: string): boolean {
  const path = assetPath.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return ["hotspot", "login.html", "rlogin.html", "hotspot/login.html", "hotspot/rlogin.html"].includes(path);
}