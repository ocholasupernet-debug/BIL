import { sbInsert, sbSelect } from "./supabase-client.js";

/**
 * Persistent history of router self-install step events.
 * Mirrors the in-memory install timeline so admins can debug past
 * failures and audit which routers needed retries.
 *
 * Schema lives in artifacts/api-server/migrations/2026_isp_router_install_events.sql.
 */

export type InstallEventPhase = "downloading" | "applied" | "failed";

export interface InstallEventInsert {
  routerId:         number;
  adminId:          number;
  routerName?:      string;
  installStartedAt: number; // ms epoch — same value for every step in one install run
  step:             number;
  stepName?:        string;
  phase:            InstallEventPhase;
  error?:           string;
  done?:            boolean;
}

export interface InstallEventRow {
  id:                 number;
  router_id:          number;
  admin_id:           number;
  router_name:        string | null;
  install_started_at: string;
  step:               number;
  step_name:          string | null;
  phase:              InstallEventPhase;
  error:              string | null;
  done:               boolean;
  created_at:         string;
}

export async function recordInstallEvent(e: InstallEventInsert): Promise<void> {
  try {
    const rows = await sbInsert<unknown>("isp_router_install_events", {
      router_id:          e.routerId,
      admin_id:           e.adminId,
      router_name:        e.routerName ?? null,
      install_started_at: new Date(e.installStartedAt).toISOString(),
      step:               e.step,
      step_name:          e.stepName ?? null,
      phase:              e.phase,
      error:              e.error ?? null,
      done:               !!e.done,
    });
    /* sbInsert returns [] on non-OK responses — surface that so an
       outage of the persistence path is at least visible in the logs
       without breaking the router callback. */
    if (!rows.length) {
      console.warn(
        `[install-events] insert returned no rows for router=${e.routerId} step=${e.step} phase=${e.phase} — Supabase may be unavailable or RLS misconfigured`,
      );
    }
  } catch (err) {
    /* never break the install callback */
    console.warn(
      `[install-events] insert failed for router=${e.routerId} step=${e.step}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function listInstallHistory(
  adminId: number,
  routerId?: number,
  limit = 500,
): Promise<InstallEventRow[]> {
  const parts = [
    `admin_id=eq.${adminId}`,
    `order=install_started_at.desc,step.asc,id.asc`,
    `limit=${Math.min(limit, 1000)}`,
  ];
  if (routerId) parts.push(`router_id=eq.${routerId}`);
  return sbSelect<InstallEventRow>("isp_router_install_events", parts.join("&"));
}
