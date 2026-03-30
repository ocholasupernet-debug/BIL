import { sbInsert } from "./supabase-client.js";

export type ActivityType = "router" | "plan" | "customer" | "provision" | "system";

export interface ActivityLogEntry {
  adminId: number;
  type: ActivityType;
  action: string;
  subject?: string;
  details?: Record<string, unknown>;
}

/**
 * Write an activity log entry to isp_activity_logs.
 * Never throws — log failures must not break the main request.
 *
 * Supabase SQL to create the table (run once in the SQL editor):
 *
 *   create table if not exists isp_activity_logs (
 *     id         bigserial primary key,
 *     admin_id   integer not null,
 *     type       text not null,
 *     action     text not null,
 *     subject    text,
 *     details    jsonb,
 *     created_at timestamptz default now()
 *   );
 *   create index if not exists isp_activity_logs_admin_id_idx
 *     on isp_activity_logs(admin_id);
 *   create index if not exists isp_activity_logs_created_at_idx
 *     on isp_activity_logs(created_at desc);
 */
export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    await sbInsert<unknown>("isp_activity_logs", {
      admin_id: entry.adminId,
      type:     entry.type,
      action:   entry.action,
      subject:  entry.subject ?? null,
      details:  entry.details ?? null,
    });
  } catch {
    /* silently ignore — logs must never break main flows */
  }
}
