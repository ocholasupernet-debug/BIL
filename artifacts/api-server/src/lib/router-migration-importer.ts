import { MANUAL, redactMigrationValue } from "./router-migration-exporter.js";

export type TargetRunner = (command: string[]) => Promise<Record<string, string>[]>;
export interface MigrationPlanItem { id: string; category: string; command: string[]; source: Record<string, unknown>; supported: boolean; reason?: string }
export interface MigrationPlan { stages: string[]; items: MigrationPlanItem[]; unsupported: MigrationPlanItem[]; warnings: string[] }

const stages = ["target_snapshot", "ip_pools", "ppp_profiles", "hotspot_profiles", "ppp_secrets", "hotspot_users", "verification"];
const portable: Record<string, { section: string; path: string; allowed: string[] }> = {
  ip_pools: { section: "ip_pools", path: "/ip/pool/add", allowed: ["name", "ranges", "next-pool", "comment"] },
  ppp_profiles: { section: "ppp_profiles", path: "/ppp/profile/add", allowed: ["name", "local-address", "remote-address", "rate-limit", "only-one", "comment"] },
  hotspot_profiles: { section: "hotspot_profiles", path: "/ip/hotspot/user/profile/add", allowed: ["name", "rate-limit", "shared-users", "session-timeout", "idle-timeout", "keepalive-timeout", "comment"] },
  ppp_secrets: { section: "ppp_secrets", path: "/ppp/secret/add", allowed: ["name", "service", "profile", "local-address", "remote-address", "caller-id", "disabled", "comment"] },
  hotspot_users: { section: "hotspot_users", path: "/ip/hotspot/user/add", allowed: ["name", "profile", "limit-uptime", "limit-bytes-in", "limit-bytes-out", "mac-address", "disabled", "comment"] },
};
function words(path: string, row: Record<string, unknown>, allowed: string[]) {
  if (row.dynamic === "true" || row.default === "true" || row["invalid"] === "true") return [];
  const value = (k: string) => typeof row[k] === "string" && row[k].trim() && !/[\r\n\0]/.test(String(row[k]));
  return [path, ...allowed.filter(value).map(k => `=${k}=${String(row[k])}`)];
}
export function buildMigrationPlan(pkg: Record<string, unknown>): MigrationPlan {
  const items: MigrationPlanItem[] = [], unsupported: MigrationPlanItem[] = [];
  for (const [category, value] of Object.entries(pkg)) {
    if (!Array.isArray(value)) continue;
    const mapping = portable[category];
    for (let i = 0; i < value.length; i++) {
      const row = value[i] as Record<string, unknown>;
      if (!mapping) unsupported.push({ id: `${category}:${i}`, category, command: [], source: row, supported: false, reason: "Unsupported or hardware-specific; manual configuration required." });
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
  const snapshotCommands: Record<string, string> = { ip_pools: "/ip/pool/print", ppp_profiles: "/ppp/profile/print", hotspot_profiles: "/ip/hotspot/user/profile/print", ppp_secrets: "/ppp/secret/print", hotspot_users: "/ip/hotspot/user/print" };
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
    try { await runner(item.command); applied.push(item.id); }
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