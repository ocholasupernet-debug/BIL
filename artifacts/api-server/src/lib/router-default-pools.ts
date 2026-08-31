import { sbInsertStrict, sbSelectStrict } from "./supabase-client.js";

type DefaultPool = {
  name: "active" | "pppoe" | "expired";
  range_start: string;
  range_end: string;
};

const DEFAULT_BRIDGE_IP = "192.168.88.1";

function bridgePrefix(bridgeIp: string | null | undefined): string {
  const raw = String(bridgeIp ?? "").trim().replace(/\/\d+$/, "");
  const parts = raw.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return DEFAULT_BRIDGE_IP.replace(/\.\d+$/, "");
  }
  return parts.slice(0, 3).join(".");
}

function defaultPools(bridgeIp: string | null | undefined): DefaultPool[] {
  const prefix = bridgePrefix(bridgeIp);
  return [
    { name: "active",  range_start: `${prefix}.10`,  range_end: `${prefix}.200` },
    { name: "pppoe",   range_start: "10.20.0.10",    range_end: "10.20.0.254" },
    { name: "expired", range_start: `${prefix}.201`, range_end: `${prefix}.254` },
  ];
}

/**
 * Ensure the standard account-facing pool set exists for an installed router.
 * Existing rows are deliberately left unchanged so administrator edits win.
 */
export async function ensureDefaultRouterPools(
  adminId: number,
  routerId: number,
  bridgeIp: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  for (const pool of defaultPools(bridgeIp)) {
    const existing = await sbSelectStrict<Record<string, unknown>>(
      "isp_ip_pools",
      `admin_id=eq.${adminId}&router_id=eq.${routerId}&name=eq.${pool.name}&select=id&limit=1`,
    );
    if (existing.length > 0) continue;

    const inserted = await sbInsertStrict<Record<string, unknown>>("isp_ip_pools", {
      admin_id: adminId,
      router_id: routerId,
      ...pool,
      created_at: now,
      updated_at: now,
    });
    if (inserted.length === 0) {
      throw new Error(`Could not create the ${pool.name} IP pool.`);
    }
  }
}