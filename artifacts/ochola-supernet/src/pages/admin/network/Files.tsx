import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { getAdminApiToken, getAdminRole, getSelectedTenantId } from "@/lib/supabase";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode2,
  FileUp,
  FileText,
  Files as FilesIcon,
  Folder,
  HardDrive,
  Loader2,
  Replace,
  RefreshCw,
  Router as RouterIcon,
  Server,
  WifiOff,
} from "lucide-react";

interface RouterSummary {
  id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  vpn_ip: string | null;
  status: string;
  model: string | null;
  ros_version: string | null;
}

interface RouterFile {
  id: string;
  name: string;
  type: string;
  size: number;
  creationTime: string;
}

interface RouterFilesResponse {
  routerId: number;
  routerName: string;
  files: RouterFile[];
  count: number;
  connectedHost: string;
  fetchedAt: string;
}

type DeployableSourceType = "hotspot" | "script";
type ManagementRepairPhase = "preflight" | "identity" | "api" | "firewall" | "verify";

interface DeployableSource {
  id: string;
  type: DeployableSourceType;
  name: string;
  label: string;
  size: number;
}

interface DeployableSourcesResponse {
  sources: DeployableSource[];
}

const HOTSPOT_FILE_NAMES = new Set([
  "login.html",
  "alogin.html",
  "logout.html",
  "status.html",
  "error.html",
  "redirect.html",
  "md5.js",
  "favicon.ico",
  "favicon.png",
]);

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--isp-inner-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 8,
  padding: "0.625rem 0.75rem",
  color: "var(--isp-text)",
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  outline: "none",
};

function filePath(fileName: string): string {
  return fileName.trim().replaceAll("\\", "/").toLowerCase();
}

function isHotspotFile(fileName: string): boolean {
  const path = filePath(fileName);
  const baseName = path.split("/").pop() ?? path;
  return path.startsWith("hotspot/") || HOTSPOT_FILE_NAMES.has(baseName);
}

function fileCategory(file: RouterFile): "Hotspot" | "Script" | "Folder" | "Router file" {
  if (isHotspotFile(file.name)) return "Hotspot";
  if (file.type.toLowerCase().includes("directory")) return "Folder";
  if (file.name.toLowerCase().endsWith(".rsc") || file.type.toLowerCase().includes("script")) {
    return "Script";
  }
  return "Router file";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function statusLabel(status: string): string {
  const value = status.toLowerCase();
  if (value === "online" || value === "connected") return "Online";
  if (value === "setup" || value.startsWith("awaiting")) return "Setup pending";
  return "Offline";
}

async function fetchRouters(): Promise<RouterSummary[]> {
  const adminId = getSelectedTenantId();
  if (!adminId) throw new Error("Sign in to an ISP account before loading routers.");
  const headers = new Headers();
  const token = getAdminApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const role = getAdminRole();
  if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));
  const response = await fetch(`/api/routers?adminId=${encodeURIComponent(String(adminId))}`, { headers });
  if (!response.ok) {
    throw new Error(`Could not load routers (HTTP ${response.status})`);
  }
  const data = await response.json() as unknown;
  return Array.isArray(data) ? data as RouterSummary[] : [];
}

async function fetchRouterFiles(routerId: number): Promise<RouterFilesResponse> {
  const adminId = getSelectedTenantId();
  if (!adminId) throw new Error("Sign in to an ISP account before loading router files.");
  const headers = new Headers();
  const token = getAdminApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const role = getAdminRole();
  if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));
  const response = await fetch(
    `/api/router/${routerId}/files?adminId=${encodeURIComponent(String(adminId))}`,
    { headers },
  );
  let data: { error?: string; detail?: string; [key: string]: unknown };
  try {
    data = await response.json() as typeof data;
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? `Could not load router files (HTTP ${response.status})`);
  }
  return data as unknown as RouterFilesResponse;
}

async function fetchDeployableSources(): Promise<DeployableSource[]> {
  const response = await fetch("/api/scripts/deployable-sources");
  const data = await response.json() as DeployableSourcesResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Could not load local files (HTTP ${response.status})`);
  }
  return Array.isArray(data.sources) ? data.sources : [];
}

function CategoryBadge({ category }: { category: ReturnType<typeof fileCategory> }) {
  const colors: Record<string, { background: string; border: string; color: string }> = {
    Hotspot: {
      background: "rgba(37,99,235,0.12)",
      border: "rgba(96,165,250,0.3)",
      color: "#93c5fd",
    },
    Script: {
      background: "rgba(168,85,247,0.12)",
      border: "rgba(192,132,252,0.3)",
      color: "#d8b4fe",
    },
    Folder: {
      background: "rgba(234,179,8,0.1)",
      border: "rgba(250,204,21,0.3)",
      color: "#fde047",
    },
    "Router file": {
      background: "rgba(148,163,184,0.1)",
      border: "rgba(148,163,184,0.25)",
      color: "#cbd5e1",
    },
  };
  const style = colors[category];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "0.3rem",
      padding: "0.22rem 0.5rem",
      borderRadius: 999,
      background: style.background,
      border: `1px solid ${style.border}`,
      color: style.color,
      fontSize: "0.68rem",
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {category === "Hotspot" ? <RouterIcon size={11} /> : category === "Script" ? <FileCode2 size={11} /> : category === "Folder" ? <Folder size={11} /> : <FileText size={11} />}
      {category}
    </span>
  );
}

function ErrorPanel({
  title,
  message,
  onRetry,
  retrying,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div style={{
      maxWidth: 980,
      display: "flex",
      alignItems: "flex-start",
      gap: "0.75rem",
      padding: "1.125rem 1.25rem",
      borderRadius: 12,
      background: "rgba(248,113,113,0.06)",
      border: "1px solid rgba(248,113,113,0.28)",
    }}>
      <AlertTriangle size={18} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, color: "#f87171", fontWeight: 700, fontSize: "0.875rem" }}>{title}</p>
        <p style={{ margin: "0.3rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem", lineHeight: 1.55 }}>
          {message}
        </p>
        <p style={{ margin: "0.65rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.76rem", lineHeight: 1.5 }}>
          Make sure the router is online, the MikroTik API service is enabled, and the VPS can reach port 8728 or the configured VPN tunnel.
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            flexShrink: 0,
            padding: "0.45rem 0.7rem",
            borderRadius: 7,
            border: "1px solid var(--isp-border)",
            background: "rgba(255,255,255,0.05)",
            color: "var(--isp-text-muted)",
            fontWeight: 600,
            fontSize: "0.74rem",
            cursor: retrying ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          <RefreshCw size={12} style={retrying ? { animation: "spin 1s linear infinite" } : undefined} />
          Retry
        </button>
      )}
    </div>
  );
}

export default function Files() {
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<DeployableSourceType>("hotspot");
  const [sourceName, setSourceName] = useState("");
  const [destinationDirectory, setDestinationDirectory] = useState("hotspot");
  const [destinationPath, setDestinationPath] = useState("");
  const [deployStatus, setDeployStatus] = useState<
    "idle" | "preparing" | "uploading" | "success" | "error" | "conflict"
  >("idle");
  const [deployMessage, setDeployMessage] = useState("");
  const [conflictDetails, setConflictDetails] = useState<{ name: string; size: number; type: string } | null>(null);
  const [bulkDeploying, setBulkDeploying] = useState(false);
  const [bulkDeployMessage, setBulkDeployMessage] = useState("");
  const [bulkDeployError, setBulkDeployError] = useState(false);
  const [managementPhase, setManagementPhase] = useState<ManagementRepairPhase>("preflight");
  const [managementImporting, setManagementImporting] = useState(false);
  const [managementImportMessage, setManagementImportMessage] = useState("");
  const [managementImportError, setManagementImportError] = useState(false);

  const routersQuery = useQuery<RouterSummary[]>({
    queryKey: ["router-files-routers", getSelectedTenantId()],
    queryFn: fetchRouters,
    retry: 1,
  });
  const routers = routersQuery.data ?? [];

  const deployableSourcesQuery = useQuery<DeployableSource[]>({
    queryKey: ["router-file-sources"],
    queryFn: fetchDeployableSources,
    retry: 1,
  });

  useEffect(() => {
    if (selectedRouterId !== null && !routers.some(router => router.id === selectedRouterId)) {
      setSelectedRouterId(null);
    }
  }, [routers, selectedRouterId]);

  const selectedRouter = useMemo(
    () => routers.find(router => router.id === selectedRouterId) ?? null,
    [routers, selectedRouterId],
  );

  const filesQuery = useQuery<RouterFilesResponse>({
    queryKey: ["router-files", getSelectedTenantId(), selectedRouterId],
    queryFn: () => fetchRouterFiles(selectedRouterId as number),
    enabled: selectedRouterId !== null,
    retry: 0,
  });

  const files = filesQuery.data?.files ?? [];
  const hotspotFiles = useMemo(() => files.filter(file => isHotspotFile(file.name)), [files]);
  const scriptFiles = useMemo(
    () => files.filter(file => fileCategory(file) === "Script"),
    [files],
  );
  const availableSources = useMemo(
    () => (deployableSourcesQuery.data ?? []).filter(source => source.type === sourceType),
    [deployableSourcesQuery.data, sourceType],
  );
  const allDeployableSources = deployableSourcesQuery.data ?? [];

  useEffect(() => {
    if (availableSources.length > 0 && !availableSources.some(source => source.name === sourceName)) {
      setSourceName(availableSources[0].name);
    }
  }, [availableSources, sourceName]);

  useEffect(() => {
    if (sourceType === "script" && sourceName) setDestinationPath(sourceName);
  }, [sourceName, sourceType]);

  async function deploySelectedFile(overwrite = false): Promise<void> {
    if (!selectedRouter || !sourceName) return;

    setDeployStatus("preparing");
    setDeployMessage("");
    setConflictDetails(null);
    /* The router transfer happens server-side. These stages keep the admin
       informed while the backend connects and waits for RouterOS /tool fetch. */
    await new Promise(resolve => window.setTimeout(resolve, 120));
    setDeployStatus("uploading");

    try {
      const adminId = getSelectedTenantId();
      if (!adminId) throw new Error("Sign in to an ISP account before deploying router files.");
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = getAdminApiToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const role = getAdminRole();
      if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));
      const response = await fetch(`/api/router/${selectedRouter.id}/files/deploy`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          adminId,
          sourceType,
          sourceName,
          destinationDirectory: sourceType === "hotspot" ? destinationDirectory : undefined,
          destinationPath: sourceType === "script" ? (destinationPath.trim() || sourceName) : undefined,
          overwrite,
        }),
      });
      let data: {
        error?: string;
        detail?: string;
        hint?: string;
        destinationPath?: string;
        replaced?: boolean;
        existingFile?: { name: string; size: number; type: string };
      } = {};
      try {
        data = await response.json();
      } catch {
        /* Keep the HTTP status as the fallback error below. */
      }

      if (response.status === 409 && data.existingFile) {
        setConflictDetails(data.existingFile);
        setDeployMessage(data.error ?? `A file already exists at ${data.existingFile.name}.`);
        setDeployStatus("conflict");
        return;
      }
      if (!response.ok) {
        const serverMessage = [data.error, data.detail]
          .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
          .join(": ");
        throw new Error(serverMessage || `Deployment failed (HTTP ${response.status})`);
      }

      setDeployStatus("success");
      setDeployMessage(
        data.replaced
          ? `${data.destinationPath} was replaced successfully.`
          : `${data.destinationPath} was deployed successfully.`,
      );
      void filesQuery.refetch();
    } catch (error) {
      setDeployStatus("error");
      setDeployMessage(error instanceof Error ? error.message : "Deployment failed");
    }
  }

  async function deployAllApprovedFiles(): Promise<void> {
    if (!selectedRouter || allDeployableSources.length === 0 || bulkDeploying) return;
    const confirmed = window.confirm(
      `Deploy all ${allDeployableSources.length} approved files to ${selectedRouter.name}? Portal assets go to flash/hotspot and RouterOS scripts, including PPPoE files, go to the router root. Existing files will be skipped. Scripts will not be imported or executed.`,
    );
    if (!confirmed) return;

    setBulkDeploying(true);
    setBulkDeployMessage("");
    setBulkDeployError(false);
    try {
      const adminId = getSelectedTenantId();
      if (!adminId) throw new Error("Sign in to an ISP account before deploying router files.");
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = getAdminApiToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const role = getAdminRole();
      if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));

      const response = await fetch(`/api/router/${selectedRouter.id}/files/deploy-bulk`, {
        method: "POST",
        headers,
        body: JSON.stringify({ adminId, scope: "all", destinationDirectory: "flash/hotspot" }),
      });
      let data: {
        error?: string;
        detail?: string;
        jobId?: string;
        status?: string;
        total?: number;
        processed?: number;
        deployed?: Array<{ sourceName: string }>;
        skipped?: Array<{ sourceName: string; reason: string }>;
        failed?: Array<{ sourceName: string; error: string }>;
      } = {};
      try {
        data = await response.json();
      } catch {
        /* Keep the HTTP status as the fallback error below. */
      }
      if (!response.ok) {
        const serverMessage = [data.error, data.detail]
          .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
          .join(": ");
        throw new Error(serverMessage || `Bulk deployment failed (HTTP ${response.status})`);
      }

      if (response.status === 202 && data.jobId) {
        setBulkDeployMessage(`Bulk deployment started: 0 of ${data.total ?? allDeployableSources.length} files processed…`);
        const maxPolls = 180;
        for (let attempt = 0; attempt < maxPolls; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 2000));
          const pollResponse = await fetch(
            `/api/router/${selectedRouter.id}/files/deploy-bulk/${encodeURIComponent(data.jobId)}?adminId=${encodeURIComponent(String(adminId))}`,
            { headers },
          );
          let progress: typeof data = {};
          try {
            progress = await pollResponse.json();
          } catch {
            /* Keep the HTTP status as the fallback error below. */
          }
          if (!pollResponse.ok) {
            const serverMessage = [progress.error, progress.detail]
              .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
              .join(": ");
            throw new Error(serverMessage || `Could not read bulk deployment progress (HTTP ${pollResponse.status})`);
          }

          const total = progress.total ?? data.total ?? allDeployableSources.length;
          const processed = progress.processed ?? 0;
          if (progress.status === "queued" || progress.status === "running") {
            setBulkDeployMessage(`Deploying approved files… ${processed} of ${total} processed.`);
            continue;
          }

          const deployedCount = progress.deployed?.length ?? 0;
          const skippedCount = progress.skipped?.length ?? 0;
          const failedCount = progress.failed?.length ?? 0;
          setBulkDeployMessage(
            `Processed ${total} assets: ${deployedCount} deployed, ${skippedCount} skipped, ${failedCount} failed.`,
          );
          setBulkDeployError(progress.status === "failed" || failedCount > 0);
          void filesQuery.refetch();
          return;
        }
        throw new Error("Bulk deployment is taking longer than expected. Reopen Files later to check the router.");
      }

      const deployedCount = data.deployed?.length ?? 0;
      const skippedCount = data.skipped?.length ?? 0;
      const failedCount = data.failed?.length ?? 0;
      setBulkDeployMessage(
        `Processed ${allDeployableSources.length} files: ${deployedCount} deployed, ${skippedCount} skipped, ${failedCount} failed.`,
      );
      setBulkDeployError(failedCount > 0);
      void filesQuery.refetch();
    } catch (error) {
      setBulkDeployMessage(error instanceof Error ? error.message : "Bulk deployment failed");
      setBulkDeployError(true);
    } finally {
      setBulkDeploying(false);
    }
  }

  async function importManagementPhase(): Promise<void> {
    if (!selectedRouter || managementImporting) return;
    const confirmed = window.confirm(
      `Import the ${managementPhase} management script into ${selectedRouter.name}? This will run the selected RouterOS phase.`,
    );
    if (!confirmed) return;

    setManagementImporting(true);
    setManagementImportMessage("");
    setManagementImportError(false);
    try {
      const adminId = getSelectedTenantId();
      if (!adminId) throw new Error("Sign in to an ISP account before importing RouterOS files.");
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = getAdminApiToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const role = getAdminRole();
      if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));

      const response = await fetch(`/api/router/${selectedRouter.id}/management-access/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ adminId, phase: managementPhase, confirm: true }),
      });
      let data: { error?: string; detail?: string; fileName?: string; connectedHost?: string } = {};
      try {
        data = await response.json();
      } catch {
        /* Keep the HTTP status as the fallback error below. */
      }
      if (!response.ok) {
        const serverMessage = [data.error, data.detail]
          .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
          .join(": ");
        throw new Error(serverMessage || `RouterOS import failed (HTTP ${response.status})`);
      }
      setManagementImportMessage(
        `${managementPhase} imported successfully as ${data.fileName ?? "RouterOS script"} via ${data.connectedHost ?? "management VPN"}.`,
      );
      void filesQuery.refetch();
    } catch (error) {
      setManagementImportError(true);
      setManagementImportMessage(error instanceof Error ? error.message : "RouterOS import failed");
    } finally {
      setManagementImporting(false);
    }
  }

  const deploymentProgress = deployStatus === "preparing"
    ? 25
    : deployStatus === "uploading" || deployStatus === "conflict"
      ? 72
      : deployStatus === "success"
        ? 100
        : 0;

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .router-files-row:hover { background: rgba(255,255,255,0.025); }
        @media (max-width: 640px) {
          .router-files-picker { flex-direction: column !important; align-items: stretch !important; }
          .router-files-picker > label { min-width: 0 !important; }
          .router-files-deploy-grid { grid-template-columns: 1fr !important; }
          .router-files-summary { grid-template-columns: 1fr !important; }
          .router-files-error { flex-direction: column !important; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", animation: "fadeIn 0.2s ease" }}>
        <div>
          <h1 style={{ margin: 0, color: "var(--isp-text)", fontSize: "1.25rem", fontWeight: 700 }}>
            Router Files
          </h1>
          <p style={{ margin: "0.35rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
            Inspect hotspot pages, RouterOS scripts, and other files stored on a MikroTik router.
          </p>
        </div>

        <NetworkTabs active="files" />

        <div style={{
          maxWidth: 980,
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "1rem 1.25rem",
          borderRadius: 12,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
        }} className="router-files-picker">
          <label htmlFor="router-files-selector" style={{
            minWidth: 110,
            color: "var(--isp-text-muted)",
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            Select router
          </label>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <Server size={15} style={{
              position: "absolute",
              left: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--isp-text-sub)",
              pointerEvents: "none",
            }} />
            <select
              id="router-files-selector"
              value={selectedRouterId ?? ""}
              onChange={event => {
                const value = event.target.value;
                setSelectedRouterId(value ? Number(value) : null);
              }}
              disabled={routersQuery.isLoading || routers.length === 0}
              style={{ ...inputStyle, paddingLeft: "2.25rem", cursor: routers.length ? "pointer" : "not-allowed" }}
            >
              <option value="">
                {routersQuery.isLoading ? "Loading routers…" : routers.length ? "Choose a MikroTik router…" : "No routers found"}
              </option>
              {routers.map(router => (
                <option key={router.id} value={router.id}>
                  {router.name} — {router.host || router.vpn_ip || "no address"}
                </option>
              ))}
            </select>
          </div>
          {selectedRouter && (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              flexShrink: 0,
              color: selectedRouter.status === "online" || selectedRouter.status === "connected" ? "#4ade80" : "#fbbf24",
              fontSize: "0.73rem",
              fontWeight: 700,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
              {statusLabel(selectedRouter.status)}
            </div>
          )}
          {selectedRouter && (
            <button
              type="button"
              onClick={() => void filesQuery.refetch()}
              disabled={filesQuery.isFetching}
              title="Refresh files"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                flexShrink: 0,
                padding: "0.5rem 0.7rem",
                borderRadius: 7,
                border: "1px solid var(--isp-border)",
                background: "rgba(255,255,255,0.05)",
                color: "var(--isp-text-muted)",
                fontWeight: 600,
                fontSize: "0.74rem",
                cursor: filesQuery.isFetching ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              <RefreshCw size={12} style={filesQuery.isFetching ? { animation: "spin 1s linear infinite" } : undefined} />
              Refresh
            </button>
          )}
        </div>

        {selectedRouter && (
          <div style={{
            maxWidth: 980,
            padding: "1.1rem 1.25rem 1.2rem",
            borderRadius: 12,
            background: "var(--isp-section)",
            border: "1px solid rgba(167,139,250,0.3)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "1rem" }}>
              <span style={{
                width: 31,
                height: 31,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                borderRadius: 8,
                background: "rgba(167,139,250,0.12)",
                color: "#c4b5fd",
              }}>
                <FileCode2 size={16} />
              </span>
              <div>
                <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.9rem", fontWeight: 700 }}>
                  Import management script into {selectedRouter.name}
                </h2>
                <p style={{ margin: "0.25rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.5 }}>
                  Generates the approved script on the server, uploads it through the verified API login, and runs <code>/import</code> one phase at a time.
                </p>
              </div>
            </div>
            <div className="router-files-deploy-grid" style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1fr) auto",
              gap: "0.7rem",
              alignItems: "end",
            }}>
              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 650 }}>
                Phase
                <select
                  value={managementPhase}
                  onChange={event => {
                    setManagementPhase(event.target.value as ManagementRepairPhase);
                    setManagementImportMessage("");
                    setManagementImportError(false);
                  }}
                  disabled={managementImporting}
                  style={{ ...inputStyle, marginTop: "0.35rem", cursor: "pointer" }}
                >
                  <option value="preflight">1 · Preflight (read-only)</option>
                  <option value="identity">2 · Add API user</option>
                  <option value="api">3 · Enable API services</option>
                  <option value="firewall">4 · Allow management firewall</option>
                  <option value="verify">5 · Verify configuration</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void importManagementPhase()}
                disabled={managementImporting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  minHeight: 37,
                  padding: "0.55rem 0.85rem",
                  border: "1px solid rgba(167,139,250,0.4)",
                  borderRadius: 8,
                  background: "rgba(167,139,250,0.14)",
                  color: "#c4b5fd",
                  fontSize: "0.75rem",
                  fontWeight: 750,
                  cursor: managementImporting ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: managementImporting ? 0.65 : 1,
                }}
              >
                {managementImporting
                  ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  : <FileCode2 size={13} />}
                {managementImporting ? "Importing…" : "Import and run phase"}
              </button>
            </div>
            {managementImportMessage && (
              <p style={{
                margin: "0.65rem 0 0",
                color: managementImportError ? "#f87171" : "#a7f3d0",
                fontSize: "0.74rem",
                lineHeight: 1.45,
              }}>
                {managementImportMessage}
              </p>
            )}
          </div>
        )}

        {selectedRouter && (
          <div style={{
            maxWidth: 980,
            padding: "1.1rem 1.25rem 1.2rem",
            borderRadius: 12,
            background: "var(--isp-section)",
            border: "1px solid var(--isp-border)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "1rem" }}>
              <span style={{
                width: 31,
                height: 31,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                borderRadius: 8,
                background: "rgba(52,211,153,0.12)",
                color: "#34d399",
              }}>
                <FileUp size={16} />
              </span>
              <div>
                <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.9rem", fontWeight: 700 }}>
                  Deploy a file to {selectedRouter.name}
                </h2>
                <p style={{ margin: "0.25rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.5 }}>
                  Choose a server-side hotspot asset or RouterOS script. Router credentials stay on the server.
                </p>
              </div>
            </div>

            <div className="router-files-deploy-grid" style={{
              display: "grid",
              gridTemplateColumns: "minmax(145px, 0.7fr) minmax(220px, 1.35fr) minmax(160px, 1fr) auto",
              gap: "0.7rem",
              alignItems: "end",
            }}>
              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 650 }}>
                File type
                <select
                  value={sourceType}
                  onChange={event => {
                    setSourceType(event.target.value as DeployableSourceType);
                    setDeployStatus("idle");
                    setDeployMessage("");
                  }}
                  disabled={deployableSourcesQuery.isLoading || deployStatus === "preparing" || deployStatus === "uploading"}
                  style={{ ...inputStyle, marginTop: "0.35rem", cursor: "pointer" }}
                >
                  <option value="hotspot">Hotspot asset</option>
                  <option value="script">RouterOS script</option>
                </select>
              </label>

              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 650 }}>
                Local source
                <select
                  value={sourceName}
                  onChange={event => {
                    setSourceName(event.target.value);
                    setDeployStatus("idle");
                    setDeployMessage("");
                  }}
                  disabled={deployableSourcesQuery.isLoading || availableSources.length === 0 || deployStatus === "preparing" || deployStatus === "uploading"}
                  style={{ ...inputStyle, marginTop: "0.35rem", cursor: availableSources.length ? "pointer" : "not-allowed" }}
                >
                  <option value="">
                    {deployableSourcesQuery.isLoading ? "Loading local files…" : availableSources.length ? "Choose a file…" : "No files available"}
                  </option>
                  {availableSources.map(source => (
                    <option key={source.id} value={source.name}>
                      {source.name} {source.size ? `(${formatBytes(source.size)})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {sourceType === "hotspot" ? (
                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 650 }}>
                  Router folder
                  <select
                    value={destinationDirectory}
                    onChange={event => setDestinationDirectory(event.target.value)}
                    disabled={deployStatus === "preparing" || deployStatus === "uploading"}
                    style={{ ...inputStyle, marginTop: "0.35rem", cursor: "pointer" }}
                  >
                    <option value="hotspot">hotspot/</option>
                    <option value="flash/hotspot">flash/hotspot/</option>
                    <option value="disk1/hotspot">disk1/hotspot/</option>
                  </select>
                </label>
              ) : (
                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 650 }}>
                  Router filename
                  <input
                    value={destinationPath}
                    onChange={event => {
                      setDestinationPath(event.target.value);
                      setDeployStatus("idle");
                      setDeployMessage("");
                    }}
                    disabled={deployStatus === "preparing" || deployStatus === "uploading"}
                    placeholder="setup.rsc"
                    style={{ ...inputStyle, marginTop: "0.35rem" }}
                  />
                </label>
              )}

              <button
                type="button"
                onClick={() => void deploySelectedFile()}
                disabled={!sourceName || availableSources.length === 0 || deployStatus === "preparing" || deployStatus === "uploading"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  minHeight: 37,
                  padding: "0.55rem 0.85rem",
                  border: "1px solid rgba(52,211,153,0.35)",
                  borderRadius: 8,
                  background: "rgba(52,211,153,0.12)",
                  color: "#6ee7b7",
                  fontSize: "0.75rem",
                  fontWeight: 750,
                  cursor: !sourceName || availableSources.length === 0 || deployStatus === "preparing" || deployStatus === "uploading" ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: !sourceName || availableSources.length === 0 ? 0.55 : 1,
                }}
              >
                {deployStatus === "preparing" || deployStatus === "uploading"
                  ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  : <FileUp size={13} />}
                {deployStatus === "preparing" ? "Preparing…" : deployStatus === "uploading" ? "Deploying…" : "Deploy file"}
              </button>
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              marginTop: "1rem",
              paddingTop: "0.9rem",
              borderTop: "1px solid var(--isp-border-subtle)",
            }}>
              <div>
                <strong style={{ display: "block", color: "var(--isp-text)", fontSize: "0.76rem" }}>
                  Deploy all approved files
                </strong>
                <span style={{ display: "block", marginTop: "0.25rem", color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>
                  Publishes {allDeployableSources.length} approved files, including PPPoE and management-firewall configs. Portal assets go to flash/hotspot and RouterOS scripts go to the router root. Existing files are skipped; scripts are uploaded but not executed.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void deployAllApprovedFiles()}
                disabled={bulkDeploying || allDeployableSources.length === 0 || deployStatus === "preparing" || deployStatus === "uploading"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  minHeight: 37,
                  padding: "0.55rem 0.85rem",
                  border: "1px solid rgba(96,165,250,0.35)",
                  borderRadius: 8,
                  background: "rgba(96,165,250,0.12)",
                  color: "#93c5fd",
                  fontSize: "0.75rem",
                  fontWeight: 750,
                  cursor: bulkDeploying || allDeployableSources.length === 0 ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: bulkDeploying || allDeployableSources.length === 0 ? 0.55 : 1,
                }}
              >
                {bulkDeploying
                  ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  : <FileUp size={13} />}
                {bulkDeploying ? "Deploying all…" : "Deploy all files"}
              </button>
            </div>
            {bulkDeployMessage && (
              <p style={{
                margin: "0.65rem 0 0",
                color: bulkDeployError ? "#f87171" : "#6ee7b7",
                fontSize: "0.74rem",
                lineHeight: 1.45,
              }}>
                {bulkDeployMessage}
              </p>
            )}

            {deployableSourcesQuery.error && (
              <p style={{ margin: "0.7rem 0 0", color: "#f87171", fontSize: "0.74rem" }}>
                Could not load local files: {(deployableSourcesQuery.error as Error).message}
              </p>
            )}

            {deployStatus !== "idle" && (
              <div style={{ marginTop: "0.9rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", color: "var(--isp-text-sub)", fontSize: "0.68rem" }}>
                  <span>{deployStatus === "preparing" ? "Preparing server-side transfer…" : deployStatus === "uploading" ? "Transferring to router…" : deployStatus === "success" ? "Deployment complete" : deployStatus === "conflict" ? "Confirmation required" : "Deployment failed"}</span>
                  <span>{deploymentProgress}%</span>
                </div>
                <div style={{ height: 5, marginTop: "0.35rem", overflow: "hidden", borderRadius: 99, background: "rgba(148,163,184,0.14)" }}>
                  <div style={{ width: `${deploymentProgress}%`, height: "100%", borderRadius: 99, background: deployStatus === "error" ? "#f87171" : deployStatus === "conflict" ? "#fbbf24" : "#34d399", transition: "width 0.25s ease" }} />
                </div>
                {deployMessage && (
                  <p style={{ margin: "0.55rem 0 0", color: deployStatus === "success" ? "#6ee7b7" : deployStatus === "error" ? "#f87171" : "var(--isp-text-muted)", fontSize: "0.74rem", lineHeight: 1.45 }}>
                    {deployMessage}
                  </p>
                )}
              </div>
            )}

            {deployStatus === "conflict" && conflictDetails && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.8rem",
                marginTop: "0.75rem",
                padding: "0.7rem 0.8rem",
                borderRadius: 8,
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.28)",
              }}>
                <div style={{ minWidth: 0, color: "#fbbf24", fontSize: "0.73rem", lineHeight: 1.45 }}>
                  <strong>{conflictDetails.name}</strong> already exists ({formatBytes(conflictDetails.size)}). Replace it with the selected source?
                </div>
                <button
                  type="button"
                  onClick={() => void deploySelectedFile(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    flexShrink: 0,
                    padding: "0.45rem 0.65rem",
                    border: "1px solid rgba(251,191,36,0.35)",
                    borderRadius: 7,
                    background: "rgba(251,191,36,0.12)",
                    color: "#fcd34d",
                    fontSize: "0.7rem",
                    fontWeight: 750,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <Replace size={12} /> Replace file
                </button>
              </div>
            )}
          </div>
        )}

        {routersQuery.isLoading && (
          <div style={{ maxWidth: 980, display: "flex", alignItems: "center", gap: "0.6rem", color: "var(--isp-text-muted)", fontSize: "0.82rem" }}>
            <Loader2 size={17} style={{ color: "var(--isp-accent)", animation: "spin 1s linear infinite" }} />
            Loading your routers…
          </div>
        )}

        {routersQuery.error && !routersQuery.isLoading && (
          <ErrorPanel
            title="Could not load routers"
            message={(routersQuery.error as Error).message}
            onRetry={() => void routersQuery.refetch()}
            retrying={routersQuery.isFetching}
          />
        )}

        {!routersQuery.isLoading && !routersQuery.error && routers.length === 0 && (
          <div style={{
            maxWidth: 980,
            textAlign: "center",
            padding: "3.5rem 1.25rem",
            borderRadius: 14,
            background: "var(--isp-section)",
            border: "1px solid var(--isp-border)",
            color: "var(--isp-text-muted)",
          }}>
            <RouterIcon size={34} style={{ opacity: 0.35, marginBottom: "0.75rem" }} />
            <p style={{ margin: 0, fontWeight: 700, color: "var(--isp-text)" }}>No routers available</p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem" }}>
              Add and configure a MikroTik router before inspecting its files.
            </p>
            <a href="/admin/network/self-install" style={{ display: "inline-block", marginTop: "0.9rem", color: "var(--isp-accent)", fontSize: "0.78rem", fontWeight: 700 }}>
              Start Self Install →
            </a>
          </div>
        )}

        {selectedRouter && filesQuery.isLoading && (
          <div style={{
            maxWidth: 980,
            display: "flex",
            alignItems: "center",
            gap: "0.65rem",
            padding: "2.25rem 1.25rem",
            color: "var(--isp-text-muted)",
            fontSize: "0.82rem",
          }}>
            <Loader2 size={18} style={{ color: "var(--isp-accent)", animation: "spin 1s linear infinite" }} />
            Reading files from {selectedRouter.name}…
          </div>
        )}

        {selectedRouter && filesQuery.error && !filesQuery.isLoading && (
          <div className="router-files-error">
            <ErrorPanel
              title="Could not read router files"
              message={(filesQuery.error as Error).message}
              onRetry={() => void filesQuery.refetch()}
              retrying={filesQuery.isFetching}
            />
          </div>
        )}

        {selectedRouter && filesQuery.data && !filesQuery.isLoading && !filesQuery.error && (
          <>
            <div className="router-files-summary" style={{
              maxWidth: 980,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "0.75rem",
            }}>
              {[
                { label: "Total files", value: files.length, icon: FilesIcon, color: "#60a5fa" },
                { label: "Hotspot assets", value: hotspotFiles.length, icon: RouterIcon, color: "#34d399" },
                { label: "RouterOS scripts", value: scriptFiles.length, icon: FileCode2, color: "#c084fc" },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.label} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.9rem 1rem",
                    borderRadius: 10,
                    background: "var(--isp-section)",
                    border: "1px solid var(--isp-border)",
                  }}>
                    <span style={{
                      width: 30,
                      height: 30,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      borderRadius: 8,
                      background: `${item.color}18`,
                      color: item.color,
                    }}>
                      <Icon size={16} />
                    </span>
                    <div>
                      <div style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", fontWeight: 600 }}>{item.label}</div>
                      <div style={{ color: "var(--isp-text)", fontSize: "1.1rem", fontWeight: 800, lineHeight: 1.2 }}>{item.value}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              maxWidth: 980,
              display: "flex",
              alignItems: "flex-start",
              gap: "0.65rem",
              padding: "0.85rem 1rem",
              borderRadius: 10,
              background: "rgba(37,99,235,0.06)",
              border: "1px solid rgba(96,165,250,0.2)",
              color: "var(--isp-text-muted)",
              fontSize: "0.76rem",
              lineHeight: 1.5,
            }}>
              <CheckCircle2 size={15} style={{ color: "#60a5fa", flexShrink: 0, marginTop: 1 }} />
              <span>
                Hotspot assets are marked when they are inside the <strong style={{ color: "var(--isp-text)" }}>hotspot/</strong> folder or use a standard MikroTik hotspot filename such as <strong style={{ color: "var(--isp-text)" }}>login.html</strong>. This view lists metadata only; file contents are not opened.
              </span>
            </div>

            <div style={{
              maxWidth: 980,
              overflow: "hidden",
              borderRadius: 12,
              background: "var(--isp-section)",
              border: "1px solid var(--isp-border)",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                padding: "1rem 1.25rem",
                borderBottom: "1px solid var(--isp-border-subtle)",
              }}>
                <div>
                  <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.9rem", fontWeight: 700 }}>
                    Files on {selectedRouter.name}
                  </h2>
                  <p style={{ margin: "0.25rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.73rem" }}>
                    {files.length} entr{files.length === 1 ? "y" : "ies"} returned by RouterOS
                  </p>
                </div>
                <HardDrive size={18} style={{ color: "var(--isp-text-sub)" }} />
              </div>

              {files.length === 0 ? (
                <div style={{ padding: "3rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)" }}>
                  <Folder size={30} style={{ opacity: 0.35, marginBottom: "0.65rem" }} />
                  <p style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.85rem", fontWeight: 700 }}>No files returned</p>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.76rem" }}>
                    The router may be empty, or the API user may not have permission to list files.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse", fontSize: "0.78rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                        {["Name", "Category", "RouterOS type", "Size", "Creation time"].map(heading => (
                          <th key={heading} style={{
                            padding: "0.7rem 1.25rem",
                            textAlign: "left",
                            color: "var(--isp-text-sub)",
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(file => {
                        const category = fileCategory(file);
                        return (
                          <tr key={`${file.id}-${file.name}`} className="router-files-row" style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                            <td style={{ padding: "0.8rem 1.25rem", color: "var(--isp-text)", fontWeight: 650 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", minWidth: 0 }}>
                                {category === "Folder" ? <Folder size={15} style={{ color: "#facc15", flexShrink: 0 }} /> : category === "Script" ? <FileCode2 size={15} style={{ color: "#c084fc", flexShrink: 0 }} /> : <FileText size={15} style={{ color: "var(--isp-text-sub)", flexShrink: 0 }} />}
                                <span style={{ fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-word" }}>{file.name}</span>
                              </span>
                            </td>
                            <td style={{ padding: "0.8rem 1.25rem" }}><CategoryBadge category={category} /></td>
                            <td style={{ padding: "0.8rem 1.25rem", color: "var(--isp-text-muted)" }}>{file.type || "file"}</td>
                            <td style={{ padding: "0.8rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{formatBytes(file.size)}</td>
                            <td style={{ padding: "0.8rem 1.25rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                                <Clock3 size={12} style={{ color: "var(--isp-text-sub)" }} />
                                {file.creationTime || "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ maxWidth: 980, display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--isp-text-sub)", fontSize: "0.7rem" }}>
              <WifiOff size={12} />
              Connected through {filesQuery.data.connectedHost || selectedRouter.host || selectedRouter.vpn_ip || "configured router address"} · Last read {new Date(filesQuery.data.fetchedAt).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}