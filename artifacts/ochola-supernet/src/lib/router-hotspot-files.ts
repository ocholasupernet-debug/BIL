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

  const response = await fetch(`/api/router/${routerId}/files/deploy-bulk`, {
    method: "POST",
    headers,
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

  let result = queued;
  onProgress?.(result);
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (result.status === "complete" || result.status === "failed") break;
    await new Promise(resolve => window.setTimeout(resolve, 1000));
    const statusResponse = await fetch(
      `/api/router/${routerId}/files/deploy-bulk/${queued.jobId}?adminId=${adminId}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    result = await statusResponse.json().catch(() => ({})) as DeploymentResponse;
    if (!statusResponse.ok) {
      throw new Error(result.error || `Could not read deployment progress (HTTP ${statusResponse.status})`);
    }
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
  };
}