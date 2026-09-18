import { MANUAL, redactMigrationValue } from "./router-migration-exporter.js";

export type TargetRunner = (command: string[]) => Promise<Record<string, string>[]>;
export interface MigrationPlanItem { id: string; category: string; command: string[]; source: Record<string, unknown>; supported: boolean; reason?: string }
export interface MigrationPlan { stages: string[]; items: MigrationPlanItem[]; unsupported: MigrationPlanItem[]; warnings: string[] }
export interface MigrationAssetSelection {
  plans: boolean;
  pppoe: boolean;
  hotspot: boolean;
}
export interface MigrationPortMapping {
  sourcePortId?: number;
  targetPortId?: number;
  sourceInterface?: string;
  targetInterface?: string;
}
export interface MigrationTargetPort {
  id: number;
  interface_name: string;
  assigned_reseller_id?: number | null;
  reseller_id?: number | null;
  reseller_bandwidth_cap?: number | null;
  bandwidth_cap_mbps?: number | null;
}

export function redactMigrationPlan(plan: MigrationPlan): MigrationPlan {
  const redactItem = (item: MigrationPlanItem): MigrationPlanItem => ({
    ...item,
    command: item.command.map(word => word.startsWith("=password=") ? `=password=${MANUAL}` : word),
    source: redactMigrationValue(item.source) as Record<string, unknown>,
  });
  return {
    ...plan,
    items: plan.items.map(redactItem),
    unsupported: plan.unsupported.map(redactItem),
  };
}

const stages = ["target_snapshot", "ip_pools", "ppp_profiles", "hotspot_profiles", "billing_plans", "ppp_secrets", "local_ppp_secrets", "hotspot_users", "local_hotspot_users", "migration_queues", "verification"];
const portable: Record<string, { section: string; path: string; allowed: string[] }> = {
  ip_pools: { section: "ip_pools", path: "/ip/pool/add", allowed: ["name", "ranges", "next-pool", "comment"] },
  ppp_profiles: { section: "ppp_profiles", path: "/ppp/profile/add", allowed: ["name", "local-address", "remote-address", "rate-limit", "only-one", "comment"] },
  hotspot_profiles: { section: "hotspot_profiles", path: "/ip/hotspot/user/profile/add", allowed: ["name", "rate-limit", "shared-users", "session-timeout", "idle-timeout", "keepalive-timeout", "comment"] },
  ppp_secrets: { section: "ppp_secrets", path: "/ppp/secret/add", allowed: ["name", "service", "profile", "local-address", "remote-address", "caller-id", "disabled", "comment"] },
  hotspot_users: { section: "hotspot_users", path: "/ip/hotspot/user/add", allowed: ["name", "profile", "limit-uptime", "limit-bytes-in", "limit-bytes-out", "mac-address", "disabled", "comment"] },
  local_ppp_secrets: { section: "local_ppp_secrets", path: "/ppp/secret/add", allowed: ["name", "password", "service", "profile", "remote-address", "comment"] },
  local_hotspot_users: { section: "local_hotspot_users", path: "/ip/hotspot/user/add", allowed: ["name", "password", "profile", "mac-address", "comment"] },
  migration_queues: { section: "migration_queues", path: "/queue/simple/add", allowed: ["name", "target", "parent", "max-limit", "comment"] },
};
function words(path: string, row: Record<string, unknown>, allowed: string[]) {
  if (row.dynamic === "true" || row.default === "true" || row["invalid"] === "true") return [];
  const value = (k: string) => typeof row[k] === "string" && row[k].trim() && !/[\r\n\0]/.test(String(row[k]));
  return [path, ...allowed.filter(value).map(k => `=${k}=${String(row[k])}`)];
}
function safeSegment(value: string, fallback: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return result.slice(0, 48) || fallback;
}

function planProfileRow(row: Record<string, unknown>): string[] {
  const type = String(row.type ?? "hotspot").toLowerCase();
  const mapping = type === "pppoe"
    ? { path: "/ppp/profile/add", allowed: ["name", "rate-limit", "only-one", "comment"] }
    : { path: "/ip/hotspot/user/profile/add", allowed: ["name", "rate-limit", "shared-users", "session-timeout", "comment"] };
  const normalized = {
    ...row,
    name: String(row.name ?? "").replace(/\s+/g, "-").toLowerCase(),
    "rate-limit": row["rate-limit"] ?? `${row.speed_down ?? 10}M/${row.speed_up ?? 10}M`,
    comment: row.comment ?? "OcholaSupernet migrated billing plan",
  };
  return words(mapping.path, normalized, mapping.allowed);
}

export function prepareMigrationPackage(
  pkg: Record<string, unknown>,
  options: {
    assetSelection?: MigrationAssetSelection;
    portMapping?: MigrationPortMapping[];
    targetPorts?: MigrationTargetPort[];
  } = {},
): Record<string, unknown> {
  const selection = options.assetSelection ?? { plans: true, pppoe: true, hotspot: true };
  const prepared: Record<string, unknown> = { ...pkg };
  const local = (pkg.local_assets && typeof pkg.local_assets === "object")
    ? pkg.local_assets as Record<string, unknown>
    : {};
  const sourceToTarget = new Map(
    (options.portMapping ?? [])
      .filter(item => item.sourcePortId && item.targetPortId)
      .map(item => [Number(item.sourcePortId), Number(item.targetPortId)]),
  );
  const sourceInterfaceToTarget = new Map(
    (options.portMapping ?? [])
      .filter(item => item.sourceInterface && item.targetInterface)
      .map(item => [String(item.sourceInterface), String(item.targetInterface)]),
  );
  const sourcePortToTargetInterface = new Map(
    (options.portMapping ?? [])
      .filter(item => item.sourcePortId && item.targetInterface)
      .map(item => [Number(item.sourcePortId), String(item.targetInterface)]),
  );
  const targetPorts = new Map(
    (options.targetPorts ?? []).map(port => [Number(port.id), port]),
  );

  prepared.billing_plans = selection.plans && Array.isArray(local.plans) ? local.plans : [];
  prepared.local_ppp_secrets = selection.pppoe && Array.isArray(local.ppp_secrets)
    ? (local.ppp_secrets as Record<string, unknown>[]).map(row => ({
      ...row,
      name: row.name ?? row.username,
      "remote-address": row["remote-address"] ?? row.ip_address,
    }))
    : [];
  prepared.local_hotspot_users = selection.hotspot && Array.isArray(local.customers)
    ? (local.customers as Record<string, unknown>[])
      .filter(row => String(row.type ?? "hotspot").toLowerCase() === "hotspot")
      .map(row => ({
        ...row,
        name: row.name ?? row.username,
        "mac-address": row["mac-address"] ?? row.mac_address,
        comment: row.comment ?? row.phone,
      }))
    : [];
  prepared.ppp_profiles = selection.plans ? (pkg.ppp_profiles ?? []) : [];
  prepared.hotspot_profiles = selection.plans ? (pkg.hotspot_profiles ?? []) : [];
  prepared.ppp_secrets = selection.pppoe ? (pkg.ppp_secrets ?? []) : [];
  prepared.hotspot_users = selection.hotspot ? (pkg.hotspot_users ?? []) : [];

  const queues: Record<string, unknown>[] = [];
  if (selection.pppoe || selection.hotspot) {
    const users = [
      ...(Array.isArray(local.ppp_secrets) ? local.ppp_secrets : []),
      ...(Array.isArray(local.customers) ? (local.customers as Record<string, unknown>[]).filter(row => {
        const type = String(row.type ?? "hotspot").toLowerCase();
        return type === "pppoe" || type === "hotspot";
      }) : []),
    ] as Record<string, unknown>[];
    for (const user of users) {
      const sourcePortId = Number(user.port_id);
      const targetPortId = sourceToTarget.get(sourcePortId);
      const mappedInterface = sourceInterfaceToTarget.get(String(user.interface_name ?? ""))
        ?? sourcePortToTargetInterface.get(sourcePortId);
      const targetPort = targetPortId
        ? targetPorts.get(targetPortId)
        : [...targetPorts.values()].find(port => port.interface_name === mappedInterface);
      const ip = String(user.ip_address ?? user["remote-address"] ?? "").trim();
      if (!targetPort || !ip || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) continue;
      const cap = Number(targetPort.reseller_bandwidth_cap ?? targetPort.bandwidth_cap_mbps ?? 0);
      if (!Number.isFinite(cap) || cap <= 0) continue;
      const targetInterface = String(targetPort?.interface_name ?? mappedInterface ?? "").trim();
      const username = safeSegment(String(user.username ?? user.name ?? "client"), "client");
      queues.push({
        name: `CLIENT_${username}`,
        target: ip,
        parent: `RESELLER_ROOT_${safeSegment(targetInterface, `PORT_${targetPort.id}`)}`,
        "max-limit": `${cap}M/${cap}M`,
        comment: `OcholaSupernet migrated client ${username}`,
      });
    }
  }
  prepared.migration_queues = queues;
  return prepared;
}

export function buildMigrationPlan(
  pkg: Record<string, unknown>,
  options: {
    assetSelection?: MigrationAssetSelection;
    portMapping?: MigrationPortMapping[];
    targetPorts?: MigrationTargetPort[];
  } = {},
): MigrationPlan {
  const prepared = prepareMigrationPackage(pkg, options);
  const items: MigrationPlanItem[] = [], unsupported: MigrationPlanItem[] = [];
  for (const [category, value] of Object.entries(prepared)) {
    if (!Array.isArray(value)) continue;
    const mapping = portable[category];
    for (let i = 0; i < value.length; i++) {
      const row = value[i] as Record<string, unknown>;
      if (category === "billing_plans") {
        const command = planProfileRow(row);
        if (command.length < 2) unsupported.push({ id: `${category}:${i}`, category, command: [], source: row, supported: false, reason: "Billing plan has no portable profile values." });
        else items.push({ id: `${category}:${i}`, category, command, source: row, supported: true });
      } else if (!mapping) unsupported.push({ id: `${category}:${i}`, category, command: [], source: row, supported: false, reason: "Unsupported or hardware-specific; manual configuration required." });
      else if ((category === "ppp_secrets" || category === "hotspot_users") && Object.values(row).includes(MANUAL))
        unsupported.push({ id: `${category}:${i}`, category, command: [], source: row, supported: false, reason: "Credential requires manual configuration; billing is not modified." });
      else { const command = words(mapping.path, row, mapping.allowed); if (command.length < 2) unsupported.push({ id: `${category}:${i}`, category, command: [], source: row, supported: false, reason: "Dynamic/default/invalid or empty portable configuration." }); else items.push({ id: `${category}:${i}`, category, command, source: row, supported: true }); }
    }
  }
  return { stages, items, unsupported, warnings: ["Only portable, explicitly mapped entities can be written. Billing records are never modified."] };
}
export function assertDistinctTargets(source: { id: number; host?: string; identity?: string; serial?: string }, target: { id: number; host?: string; identity?: string; serial?: string }) {
  if (source.id === target.id || (!!source.host && source.host === target.host) ||
      (!!source.identity && source.identity === target.identity) || (!!source.serial && source.serial === target.serial)) {
    throw new Error("Source and target router must be distinct.");
  }
}
export async function executeMigrationPlan(
  plan: MigrationPlan,
  runner: TargetRunner,
  approvedIds: string[],
  dryRun: boolean,
  persistPreState?: (preState: Record<string, Record<string, string>[]>) => Promise<void>,
) {
  const approved = new Set(approvedIds); const applied: string[] = []; const failures: string[] = [];
  const selected = plan.items.filter(x => approved.has(x.id));
  if (dryRun) return { dryRun: true, commands: selected.map(x => x.command), applied, failures, stopped: false };
  // Configuration state capture, not a RouterOS backup file: capture every
  // portable category before its first mutation so recovery is reviewable.
  const preState: Record<string, Record<string, string>[]> = {};
  const snapshotCommands: Record<string, string> = { ip_pools: "/ip/pool/print", ppp_profiles: "/ppp/profile/print", hotspot_profiles: "/ip/hotspot/user/profile/print", billing_plans: "/ppp/profile/print", ppp_secrets: "/ppp/secret/print", local_ppp_secrets: "/ppp/secret/print", hotspot_users: "/ip/hotspot/user/print", local_hotspot_users: "/ip/hotspot/user/print", migration_queues: "/queue/simple/print" };
  const selectedCategories = [...new Set(selected.map(x => x.category))];
  try {
    for (const category of selectedCategories) {
      preState[category] = redactMigrationValue(
        await runner([snapshotCommands[category]!]),
      ) as Record<string, string>[];
    }
  } catch {
    failures.push("Target configuration state capture failed before any write.");
    return { dryRun: false, commands: [], applied, failures, stopped: true, preState };
  }
  if (persistPreState) {
    try {
      await persistPreState(preState);
    } catch {
      failures.push("Target configuration state capture could not be persisted; no writes were attempted.");
      return { dryRun: false, commands: [], applied, failures, stopped: true, preState };
    }
  }
  for (const stage of stages.slice(1, -1)) for (const item of selected.filter(x => x.category === stage)) {
    try {
      /*
       * The pre-state is also the idempotency index. Re-running an approved
       * migration updates the existing named resource instead of creating a
       * second secret, profile, or queue. Passwords are taken from the
       * encrypted command plan, never from the redacted snapshot.
       */
      const name = item.command.find(word => word.startsWith("=name="))?.slice("=name=".length);
      const existing = name
        ? preState[stage]?.find(row => String(row.name ?? "") === name)
        : undefined;
      const command = existing?.[".id"]
        ? [item.command[0]!.replace(/\/add$/, "/set"), `=.id=${existing[".id"]}`, ...item.command.slice(1)]
        : item.command;
      await runner(command);
      applied.push(item.id);
    }
    catch { failures.push(`${item.id}: RouterOS write failed.`); return { dryRun: false, commands: [], applied, failures, stopped: true, preState }; }
  }
  const verification: Record<string, Record<string, string>[]> = {};
  try {
    for (const category of selectedCategories) {
      verification[category] = redactMigrationValue(
        await runner([snapshotCommands[category]!]),
      ) as Record<string, string>[];
    }
  } catch {
    failures.push("Post-import verification failed; review the captured target state.");
    return { dryRun: false, commands: [], applied, failures, stopped: true, preState, verification };
  }
  return { dryRun: false, commands: [], applied, failures, stopped: false, verification, preState };
}