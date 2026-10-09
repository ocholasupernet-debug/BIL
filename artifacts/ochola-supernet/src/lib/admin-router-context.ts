import { useQuery } from "@tanstack/react-query";
import { adminApiFetch } from "@/lib/api-client";
import { getAdminApiToken } from "@/lib/supabase";

export interface AdminContextRouter {
  [key: string]: unknown;
  id: number;
  admin_id?: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  vpn_ip: string | null;
  status: string;
  router_username: string;
  router_secret: string | null;
}

export interface AdminRouterManagementContext {
  routers: AdminContextRouter[];
}

export interface AdminContextPort {
  id: number;
  router_id: number;
  interface_name: string;
  vlan_tag?: string | null;
  status: string;
}

export interface AdminContextPlan {
  id: number;
  admin_id: number;
  name: string;
  type: string;
  price: number | string | null;
  router_id: number | null;
  port_id: number | null;
  owner_reseller_id?: number | null;
  [key: string]: unknown;
}

export interface AdminRouterContext {
  routers: AdminContextRouter[];
  plans: AdminContextPlan[];
  ports: AdminContextPort[];
  pools: Array<{
    id: number;
    name: string;
    range_start: string;
    range_end: string;
    router_id: number | null;
    port_id: number | null;
    created_at?: string;
  }>;
  reseller?: boolean;
  tenantId?: number;
}

export function adminApiHeaders(): HeadersInit {
  const token = getAdminApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAdminRouterContext(): Promise<AdminRouterContext> {
  const response = await adminApiFetch("/api/plans/admin-context", { cache: "no-store" });
  const body = await response.json().catch(() => null) as (AdminRouterContext & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Router context could not be loaded (${response.status}).`);
  }
  return body;
}

export async function fetchAdminRouterManagementContext(): Promise<AdminRouterManagementContext> {
  const response = await adminApiFetch("/api/routers/admin-context", { cache: "no-store" });
  const body = await response.json().catch(() => null) as (AdminRouterManagementContext & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !body?.ok || !Array.isArray(body.routers)) {
    throw new Error(body?.error ?? `Router management data could not be loaded (${response.status}).`);
  }
  return { routers: body.routers };
}

export function useAdminRouterContext() {
  return useQuery({
    queryKey: ["admin-router-context"],
    queryFn: fetchAdminRouterContext,
    staleTime: 15_000,
  });
}