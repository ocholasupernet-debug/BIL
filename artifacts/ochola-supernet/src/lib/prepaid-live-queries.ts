import { useQueries } from "@tanstack/react-query";
import { getAdminApiToken } from "@/lib/supabase";
import type { PrepaidLiveData, PrepaidLiveRouter } from "./prepaid-live-presence";

export function prepaidLiveQueryKey(routerId: number) {
  return ["prepaid_live", routerId] as const;
}

async function fetchPrepaidRouterLive(router: PrepaidLiveRouter): Promise<PrepaidLiveData> {
  const token = getAdminApiToken();
  const response = await fetch(`/api/router/${router.id}/live`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Router ${router.name} is unavailable`);
  return response.json() as Promise<PrepaidLiveData>;
}

/**
 * Both the Prepaid Users page and Dashboard observe this same query cache.
 * Keeping one key, endpoint, and refresh cadence prevents the online totals
 * from diverging between the two pages.
 */
export function usePrepaidLiveQueries(
  routers: readonly PrepaidLiveRouter[],
  refetchInterval = 15_000,
) {
  return useQueries({
    queries: routers.map(router => ({
      queryKey: prepaidLiveQueryKey(router.id),
      queryFn: () => fetchPrepaidRouterLive(router),
      staleTime: 5_000,
      refetchInterval,
    })),
  });
}
