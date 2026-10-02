import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { getAdminApiToken } from "@/lib/supabase";

export interface MigrationRouter {
  id: number;
  name?: string | null;
  status?: string | null;
  host?: string | null;
  vpn_ip?: string | null;
  bridge_ip?: string | null;
  identity?: string | null;
  serial?: string | null;
  migration_source_only?: boolean;
}

export interface MigrationPlanItem {
  id: string;
  category: string;
  command: string[];
  supported: boolean;
  reason?: string;
}

export interface MigrationPlanResponse {
  mode: "adopt_source" | "replace_router";
  items: MigrationPlanItem[];
  unsupported: MigrationPlanItem[];
  warnings: string[];
}

export interface MigrationJobStatus {
  id: number;
  sourceRouterId: number | null;
  sourceLabel: string;
  targetRouterId: number | null;
  targetMode: "adopt_source" | "replace_router";
  status: string;
  findings: {
    counts?: Record<string, number>;
    warnings?: string[];
    sourceIdentity?: { identity?: string; version?: string; board?: string; serial?: string };
    sourceRegistrationComplete?: boolean;
    manualConfigurationCount?: number;
  };
  tunnel?: { status: string; expiresAt: string; verifiedAt?: string | null } | null;
}

async function migrationRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminApiToken();
  if (!token) throw new Error("Your admin session has expired. Sign in again to continue.");
  const headers = new Headers(init.headers);
  const sessionHeaders = { Authorization: `Bearer ${token}` };
  headers.set("Authorization", sessionHeaders.Authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(`/api/router-migrations${path}`), {
    ...init,
    headers,
    cache: "no-store",
  });
  const body = await parseJsonResponse<Record<string, unknown>>(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Migration request failed (HTTP ${response.status}).`);
  }
  return body as T;
}

export const migrationApi = {
  routers: () => migrationRequest<{ routers: MigrationRouter[] }>("/routers"),
  start: (sourceRouterId: number) =>
    migrationRequest<{ jobId: number; sourceRouterId: number; sourceRouterName: string; tunnelScript: string; tunnelAddress: string; expiresAt: string; warning: string }>(
      "/jobs",
      { method: "POST", body: JSON.stringify({ sourceRouterId }) },
    ),
  registerSource: (registrationKey: string) =>
    migrationRequest<{
      jobId: number;
      sourceRouterId: number | null;
      sourceRouterName: string;
      tunnelScript?: string;
      tunnelAddress?: string;
      expiresAt?: string;
      warning?: string;
      reused?: boolean;
    }>(
      "/jobs",
      { method: "POST", body: JSON.stringify({ registerSource: true, registrationKey }) },
    ),
  tunnelScript: (jobId: number) =>
    migrationRequest<{ tunnelScript: string; expiresAt: string }>(`/jobs/${jobId}/tunnel-script`),
  verify: (jobId: number) =>
    migrationRequest<{
      ok: boolean;
      identity: { identity: string; version: string; board: string; serial: string };
      sourceRouterId: number | null;
      sourceRouterName: string | null;
      sourceRegistered: boolean;
    }>(
      `/jobs/${jobId}/verify`,
      { method: "POST", body: "{}" },
    ),
  collectorScript: (jobId: number) =>
    migrationRequest<{ collectorScript: string; readOnlyPreviewScript: string; expiresAt: string; warning: string }>(
      `/jobs/${jobId}/collector-script`,
      { method: "POST", body: "{}" },
    ),
  job: (jobId: number) => migrationRequest<MigrationJobStatus>(`/jobs/${jobId}`),
  chooseTarget: (jobId: number, mode: "adopt_source" | "replace_router", targetRouterId?: number) =>
    migrationRequest<{ ok: boolean; mode: string; targetRouterId: number | null; writesWillOccur?: boolean }>(
      `/jobs/${jobId}/target`,
      { method: "POST", body: JSON.stringify({ mode, targetRouterId }) },
    ),
  plan: (jobId: number) => migrationRequest<MigrationPlanResponse>(`/jobs/${jobId}/plan`),
  dryRun: (jobId: number, approvedIds: string[]) =>
    migrationRequest<{ dryRun: boolean; commands: string[][]; approved: string[]; warnings: string[] }>(
      `/jobs/${jobId}/dry-run`,
      { method: "POST", body: JSON.stringify({ approvedIds }) },
    ),
  apply: (jobId: number, approvedIds: string[]) =>
    migrationRequest<{
      completed: boolean;
      partial?: boolean;
      applied?: string[];
      failures?: string[];
      limitation?: string;
    }>(`/jobs/${jobId}/apply`, { method: "POST", body: JSON.stringify({ approvedIds }) }),
  revoke: (jobId: number) =>
    migrationRequest<{ revoked: boolean }>(`/jobs/${jobId}/revoke`, { method: "POST", body: "{}" }),
};