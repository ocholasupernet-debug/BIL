export interface HotspotFileDeploymentItem {
  sourceName: string;
  destinationPath: string;
  size?: number;
  reason?: string;
  error?: string;
}

export interface HotspotFileDeploymentResult {
  status: string;
  total: number;
  processed: number;
  deployed: HotspotFileDeploymentItem[];
  skipped: HotspotFileDeploymentItem[];
  failed: HotspotFileDeploymentItem[];
  error?: string;
}

interface DeploymentResponse extends HotspotFileDeploymentResult {
  jobId?: string;
  error?: string;
}

export async function installHotspotFiles(
  routerId: number,
  adminId: number,
  token = "",
  onProgress?: (result: DeploymentResponse) => void,
): Promise<HotspotFileDeploymentResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const startDeployment = async (): Promise<DeploymentResponse> => {
    const response = await fetch(`/api/router/${routerId}/files/deploy-bulk`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        adminId,
        scope: "hotspot",
        destinationDirectory: "flash/hotspot",
      }),
    });
    const queued = await response.json().catch(() => ({})) as DeploymentResponse;
    if (!response.ok || !queued.jobId) {
      throw new Error(queued.error || `Hotspot file deployment could not start (HTTP ${response.status})`);
    }
    return queued;
  };

  let queued = await startDeployment();
  let result = queued;
  onProgress?.(result);
  let successfulPolls = 0;
  let consecutiveReadFailures = 0;
  let sawTemporaryUnavailable = false;
  let recoveredLostJob = false;
  while (successfulPolls < 360) {
    if (result.status === "complete" || result.status === "failed") break;
    await new Promise(resolve => window.setTimeout(resolve, 1000));
    let statusResponse: Response;
    try {
      statusResponse = await fetch(
        `/api/router/${routerId}/files/deploy-bulk/${queued.jobId}?adminId=${adminId}`,
        {
          headers: token ? { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } : { "Cache-Control": "no-cache" },
          cache: "no-store",
        },
      );
    } catch {
      sawTemporaryUnavailable = true;
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures > 6) {
        throw new Error("Could not read deployment progress after repeated network errors. The deployment may still be running; refresh the router files to check.");
      }
      await new Promise(resolve => window.setTimeout(resolve, Math.min(5000, 250 * 2 ** (consecutiveReadFailures - 1))));
      continue;
    }

    if (statusResponse.status >= 500 || statusResponse.status === 304) {
      sawTemporaryUnavailable = true;
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures > 6) {
        throw new Error(`Could not read deployment progress after repeated HTTP ${statusResponse.status} responses. The deployment may still be running; refresh the router files to check.`);
      }
      await new Promise(resolve => window.setTimeout(resolve, Math.min(5000, 250 * 2 ** (consecutiveReadFailures - 1))));
      continue;
    }

    if (statusResponse.status === 404 && sawTemporaryUnavailable && !recoveredLostJob) {
      /* API restarts clear the in-memory job. Requeue once; bulk deployment
         never overwrites files, so already-transferred assets are skipped. */
      queued = await startDeployment();
      result = queued;
      onProgress?.(result);
      recoveredLostJob = true;
      consecutiveReadFailures = 0;
      sawTemporaryUnavailable = false;
      continue;
    }

    result = await statusResponse.json().catch(() => ({})) as DeploymentResponse;
    if (!statusResponse.ok) {
      throw new Error(result.error || `Could not read deployment progress (HTTP ${statusResponse.status})`);
    }
    successfulPolls += 1;
    consecutiveReadFailures = 0;
    sawTemporaryUnavailable = false;
    onProgress?.(result);
  }

  if (result.status !== "complete" && result.status !== "failed") {
    throw new Error("Hotspot file deployment is still running. Refresh the router files shortly to see its result.");
  }
  return {
    status: result.status,
    total: Number(result.total ?? 0),
    processed: Number(result.processed ?? 0),
    deployed: Array.isArray(result.deployed) ? result.deployed : [],
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
    error: result.error,
  };
}