export interface SelfInstallFilePushItem {
  sourceName: string;
  destinationPath: string;
  size?: number;
  replaced?: boolean;
  reason?: string;
  error?: string;
}

export interface SelfInstallFilePushResult {
  status: string;
  total: number;
  processed: number;
  deployed: SelfInstallFilePushItem[];
  skipped: SelfInstallFilePushItem[];
  failed: SelfInstallFilePushItem[];
  connectedHost?: string;
  error?: string;
}

interface PushResponse extends SelfInstallFilePushResult {
  jobId?: string;
}

export async function pushSelfInstallFiles(
  routerId: number,
  adminId: number,
  fileNames: string[],
  token = "",
  onProgress?: (result: PushResponse) => void,
): Promise<SelfInstallFilePushResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`/api/router/${routerId}/self-install-files/deploy`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      adminId,
      fileNames,
      overwriteExisting: true,
    }),
  });
  const queued = await response.json().catch(() => ({})) as PushResponse;
  if (!response.ok || !queued.jobId) {
    throw new Error(queued.error || `Self Install file transfer could not start (HTTP ${response.status})`);
  }

  let result = queued;
  onProgress?.(result);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (result.status === "complete" || result.status === "failed") break;
    await new Promise(resolve => window.setTimeout(resolve, 1000));
    const statusResponse = await fetch(
      `/api/router/${routerId}/self-install-files/deploy/${queued.jobId}?adminId=${adminId}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    result = await statusResponse.json().catch(() => ({})) as PushResponse;
    if (!statusResponse.ok) {
      throw new Error(result.error || `Could not read Self Install transfer progress (HTTP ${statusResponse.status})`);
    }
    onProgress?.(result);
  }

  if (result.status !== "complete" && result.status !== "failed") {
    throw new Error("Self Install file transfer is still running. Refresh the router files shortly to see its result.");
  }

  return {
    status: result.status,
    total: Number(result.total ?? 0),
    processed: Number(result.processed ?? 0),
    deployed: Array.isArray(result.deployed) ? result.deployed : [],
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
    connectedHost: result.connectedHost,
    error: result.error,
  };
}