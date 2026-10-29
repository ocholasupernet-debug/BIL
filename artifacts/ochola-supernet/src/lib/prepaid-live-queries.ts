import { useQueries } from "@tanstack/react-query";
import { adminApiFetch } from "@/lib/api-client";
import type { PrepaidLiveData, PrepaidLiveRouter } from "./prepaid-live-presence";

export function prepaidLiveQueryKey(routerId: number, sessionsOnly = false) {
  return ["prepaid_live", sessionsOnly ? "sessions" : "full", routerId] as const;
}

async function fetchPrepaidRouterLive(router: PrepaidLiveRouter, sessionsOnly: boolean): Promise<PrepaidLiveData> {
  const query = sessionsOnly ? "?sessionsOnly=true" : "";
  const response = await adminApiFetch(`/api/router/${router.id}/live${query}`, { cache: "no-store" });
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
  refetchInterval = 10_000,
  sessionsOnly = false,
) {
  return useQueries({
    queries: routers.map(router => ({
      queryKey: prepaidLiveQueryKey(router.id, sessionsOnly),
      queryFn: () => fetchPrepaidRouterLive(router, sessionsOnly),
      staleTime: 5_000,
      refetchInterval,
    })),
  });
}
