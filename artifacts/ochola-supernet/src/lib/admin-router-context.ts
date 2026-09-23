import { useQuery } from "@tanstack/react-query";
import { getAdminApiToken } from "@/lib/supabase";

export interface AdminContextRouter {
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

export interface AdminContextPort {
  id: number;
  router_id: number;
  interface_name: string;
  vlan_tag?: string | null;
  status: string;
}

export interface AdminRouterContext {
  routers: AdminContextRouter[];
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
  const response = await fetch("/api/plans/admin-context", {
    headers: adminApiHeaders(),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as (AdminRouterContext & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Router context could not be loaded (${response.status}).`);
  }
  return body;
}

export function useAdminRouterContext() {
  return useQuery({
    queryKey: ["admin-router-context"],
    queryFn: fetchAdminRouterContext,
    staleTime: 15_000,
  });
}