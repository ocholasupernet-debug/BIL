import { sbSelectStrict } from "./supabase-client.js";

export async function hotspotRoamingEnabled(adminId: number): Promise<boolean> {
  const rows = await sbSelectStrict<{ enabled: boolean }>(
    "isp_hotspot_roaming_settings",
    `admin_id=eq.${adminId}&select=enabled&limit=1`,
  );
  return rows[0] ? rows[0].enabled === true : true;
}
