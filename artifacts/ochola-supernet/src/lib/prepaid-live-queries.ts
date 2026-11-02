import { useQueries } from "@tanstack/react-query";
import { adminApiFetch } from "@/lib/api-client";
import type { PrepaidLiveData, PrepaidLiveRouter } from "./prepaid-live-presence";

export function prepaidLiveQueryKey(routerId: number, sessionsOnly = false) {
  return ["prepaid_live", sessionsOnly ? "sessions" : "full", routerId] as const;
}

const LIVE_QUERY_TIMEOUT_MS = 30_000;

async function fetchPrepaidRouterLive(
  router: PrepaidLiveRouter,
  sessionsOnly: boolean,
  querySignal?: AbortSignal,
): Promise<PrepaidLiveData> {
  const query = sessionsOnly ? "?sessionsOnly=true" : "";
  const controller = new AbortController();
  let timedOut = false;
  const abortFromQuery = () => controller.abort();
  if (querySignal?.aborted) controller.abort();
  else querySignal?.addEventListener("abort", abortFromQuery, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LIVE_QUERY_TIMEOUT_MS);

  try {
    const response = await adminApiFetch(`/api/router/${router.id}/live${query}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Router ${router.name} is unavailable`);
    return await response.json() as PrepaidLiveData;
  } catch (error) {
    if (timedOut) throw new Error(`Router ${router.name} session check timed out`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    querySignal?.removeEventListener("abort", abortFromQuery);
  }
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
      queryFn: ({ signal }) => fetchPrepaidRouterLive(router, sessionsOnly, signal),
      staleTime: 5_000,
      refetchInterval,
      retry: false,
    })),
  });
}
