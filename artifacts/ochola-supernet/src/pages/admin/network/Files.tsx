import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID } from "@/lib/supabase";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode2,
  FileText,
  Files as FilesIcon,
  Folder,
  HardDrive,
  Loader2,
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

const HOTSPOT_FILE_NAMES = new Set([
  "login.html",
  "alogin.html",
  "logout.html",
  "status.html",
  "error.html",
  "redirect.html",
  "md5.js",
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
  const response = await fetch(`/api/routers?adminId=${encodeURIComponent(String(ADMIN_ID))}`);
  if (!response.ok) {
    throw new Error(`Could not load routers (HTTP ${response.status})`);
  }
  const data = await response.json() as unknown;
  return Array.isArray(data) ? data as RouterSummary[] : [];
}

async function fetchRouterFiles(routerId: number): Promise<RouterFilesResponse> {
  const response = await fetch(
    `/api/router/${routerId}/files?adminId=${encodeURIComponent(String(ADMIN_ID))}`,
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

  const routersQuery = useQuery<RouterSummary[]>({
    queryKey: ["router-files-routers", ADMIN_ID],
    queryFn: fetchRouters,
    retry: 1,
  });
  const routers = routersQuery.data ?? [];

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
    queryKey: ["router-files", ADMIN_ID, selectedRouterId],
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

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .router-files-row:hover { background: rgba(255,255,255,0.025); }
        @media (max-width: 640px) {
          .router-files-picker { flex-direction: column !important; align-items: stretch !important; }
          .router-files-picker > label { min-width: 0 !important; }
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
                  {router.name} — {router.host || router.bridge_ip || "no address"}
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
            <a href="/admin/network/add-router" style={{ display: "inline-block", marginTop: "0.9rem", color: "var(--isp-accent)", fontSize: "0.78rem", fontWeight: 700 }}>
              Add a router →
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
              Connected through {filesQuery.data.connectedHost || selectedRouter.host || selectedRouter.bridge_ip || "configured router address"} · Last read {new Date(filesQuery.data.fetchedAt).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}