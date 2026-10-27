import { sbSelectStrict } from "./supabase-client.js";

export async function hotspotRoamingEnabled(adminId: number): Promise<boolean> {
  const rows = await sbSelectStrict<{ enabled: boolean }>(
    "isp_hotspot_roaming_settings",
    `admin_id=eq.${adminId}&select=enabled&limit=1`,
  );
  return rows[0] ? rows[0].enabled === true : true;
}

export async function hotspotUserServerForTenant(
  adminId: number,
  routerId: number,
  sourceServer: string | undefined,
): Promise<string | undefined> {
  if (!Number.isSafeInteger(adminId) || adminId <= 0 || !Number.isSafeInteger(routerId) || routerId <= 0) {
    return sourceServer;
  }
  if (!(await hotspotRoamingEnabled(adminId))) return sourceServer;
  const resellerHotspots = await sbSelectStrict<{ id: number }>(
    "isp_reseller_ports",
    `admin_id=eq.${adminId}&router_id=eq.${routerId}&status=eq.active&hotspot_enabled=is.true&assigned_reseller_id=not.is.null&select=id&limit=1`,
  );
  // RouterOS server=all would also authorize logins on reseller-owned SSIDs.
  return resellerHotspots.length ? sourceServer : "all";
}
