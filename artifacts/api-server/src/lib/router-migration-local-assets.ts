import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
} from "./supabase-client.js";
import type {
  MigrationAssetSelection,
  MigrationPortMapping,
  MigrationTargetPort,
} from "./router-migration-importer.js";

type JsonRow = Record<string, unknown>;

export interface LocalMigrationAssets {
  plans: JsonRow[];
  customers: JsonRow[];
  ppp_secrets: JsonRow[];
  hotspot_users: JsonRow[];
  ports: JsonRow[];
  ip_pools: JsonRow[];
}

function withoutIdentity(row: JsonRow): JsonRow {
  const copy = { ...row };
  for (const key of ["id", "created_at", "updated_at", "last_seen"]) delete copy[key];
  return copy;
}

export async function loadLocalMigrationAssets(adminId: number, sourceRouterId: number): Promise<LocalMigrationAssets> {
  const [plans, customers, pppSecrets, hotspotUsers, ports, ipPools] = await Promise.all([
    sbSelectStrict<JsonRow>("isp_plans", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=*&order=id.asc`),
    sbSelectStrict<JsonRow>("isp_customers", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=*&order=id.asc`),
    sbSelectStrict<JsonRow>("isp_ppp_secrets", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=*&order=id.asc`),
    sbSelectStrict<JsonRow>("isp_hotspot_users", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=*&order=id.asc`),
    sbSelectStrict<JsonRow>("isp_reseller_ports", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=id,router_id,interface_name,bridge_name,reseller_id,assigned_reseller_id,bandwidth_cap_mbps,reseller_bandwidth_cap,status&order=interface_name.asc`),
    sbSelectStrict<JsonRow>("isp_ip_pools", `admin_id=eq.${adminId}&router_id=eq.${sourceRouterId}&select=*&order=id.asc`),
  ]);
  return { plans, customers, ppp_secrets: pppSecrets, hotspot_users: hotspotUsers, ports, ip_pools: ipPools };
}

function targetPortFor(
  sourcePortId: unknown,
  mapping: Map<number, number>,
  mappedInterfaces: Map<number, string>,
  targetPorts: Map<number, MigrationTargetPort>,
): MigrationTargetPort | undefined {
  const targetId = mapping.get(Number(sourcePortId));
  if (targetId) return targetPorts.get(targetId);
  const targetInterface = mappedInterfaces.get(Number(sourcePortId));
  return targetInterface ? [...targetPorts.values()].find(port => port.interface_name === targetInterface) : undefined;
}

export async function cloneLocalMigrationAssets(
  assets: LocalMigrationAssets,
  adminId: number,
  targetRouterId: number,
  selection: MigrationAssetSelection,
  portMapping: MigrationPortMapping[],
  targetPortRows: MigrationTargetPort[],
): Promise<{ inserted: Record<string, number[]>; counts: Record<string, number> }> {
  const mapping = new Map(portMapping.map(item => [Number(item.sourcePortId), Number(item.targetPortId)]));
  const mappedInterfaces = new Map(
    portMapping
      .filter(item => item.sourcePortId && item.targetInterface)
      .map(item => [Number(item.sourcePortId), String(item.targetInterface)]),
  );
  const targetPorts = new Map(targetPortRows.map(port => [Number(port.id), port]));
  const inserted: Record<string, number[]> = {};
  const counts: Record<string, number> = {};
  const planIds = new Map<number, number>();

  const remember = (table: string, id: number) => {
    inserted[table] = [...(inserted[table] ?? []), id];
  };

  try {
    if (selection.plans) {
      for (const source of assets.plans) {
        const rows = await sbInsertStrict<JsonRow>("isp_plans", {
          ...withoutIdentity(source),
          admin_id: adminId,
          router_id: targetRouterId,
          port_id: null,
        });
        const id = Number(rows[0]?.id);
        if (!id) throw new Error("A migrated Internet package could not be saved.");
        if (source.id !== undefined) planIds.set(Number(source.id), id);
        remember("isp_plans", id);
        counts.plans = (counts.plans ?? 0) + 1;
      }
    }

    if (selection.pppoe) {
      for (const source of assets.ppp_secrets) {
        const port = targetPortFor(source.port_id, mapping, mappedInterfaces, targetPorts);
        const rows = await sbInsertStrict<JsonRow>("isp_ppp_secrets", {
          ...withoutIdentity(source),
          admin_id: adminId,
          router_id: targetRouterId,
          port_id: port?.id ?? null,
          assigned_reseller_id: port?.assigned_reseller_id ?? port?.reseller_id ?? source.assigned_reseller_id ?? null,
        });
        const id = Number(rows[0]?.id);
        if (!id) throw new Error("A migrated PPPoE secret could not be saved.");
        remember("isp_ppp_secrets", id);
        counts.pppoe = (counts.pppoe ?? 0) + 1;
      }
    }

    if (selection.hotspot) {
      for (const source of assets.hotspot_users) {
        const port = targetPortFor(source.port_id, mapping, mappedInterfaces, targetPorts);
        const rows = await sbInsertStrict<JsonRow>("isp_hotspot_users", {
          ...withoutIdentity(source),
          admin_id: adminId,
          router_id: targetRouterId,
          port_id: port?.id ?? null,
          assigned_reseller_id: port?.assigned_reseller_id ?? port?.reseller_id ?? source.assigned_reseller_id ?? null,
        });
        const id = Number(rows[0]?.id);
        if (!id) throw new Error("A migrated Hotspot user record could not be saved.");
        remember("isp_hotspot_users", id);
        counts.hotspot = (counts.hotspot ?? 0) + 1;
      }
    }

    if (selection.pppoe || selection.hotspot) {
      for (const source of assets.customers) {
        const sourceType = String(source.type ?? "hotspot").toLowerCase();
        if ((sourceType === "pppoe" && !selection.pppoe) || (sourceType === "hotspot" && !selection.hotspot)) continue;
        if (sourceType !== "pppoe" && sourceType !== "hotspot") continue;
        const port = targetPortFor(source.port_id, mapping, mappedInterfaces, targetPorts);
        const sourcePlanId = Number(source.plan_id);
        const rows = await sbInsertStrict<JsonRow>("isp_customers", {
          ...withoutIdentity(source),
          admin_id: adminId,
          router_id: targetRouterId,
          plan_id: planIds.get(sourcePlanId) ?? null,
          port_id: port?.id ?? null,
          assigned_reseller_id: port?.assigned_reseller_id ?? port?.reseller_id ?? source.assigned_reseller_id ?? null,
        });
        const id = Number(rows[0]?.id);
        if (!id) throw new Error("A migrated customer record could not be saved.");
        remember("isp_customers", id);
        counts.customers = (counts.customers ?? 0) + 1;
      }
    }
    return { inserted, counts };
  } catch (error) {
    await rollbackClonedMigrationAssets(inserted);
    throw error;
  }
}

export async function rollbackClonedMigrationAssets(inserted: Record<string, number[]>): Promise<void> {
  const order = ["isp_customers", "isp_hotspot_users", "isp_ppp_secrets", "isp_plans"];
  for (const table of order) {
    const ids = inserted[table] ?? [];
    for (const id of ids) {
      await sbDeleteStrict(table, `id=eq.${id}`).catch(() => undefined);
    }
  }
}