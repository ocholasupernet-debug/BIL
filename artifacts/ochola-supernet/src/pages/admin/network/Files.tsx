import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { installHotspotFiles, type HotspotFileDeploymentResult } from "@/lib/router-hotspot-files";
import {
  AlertCircle,
  Check,
  Clipboard,
  File,
  FileCode2,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";

interface RouterSummary {
  id: number;
  name: string;
  status?: string | null;
  host?: string | null;
  vpn_ip?: string | null;
}

interface RouterFile {
  id: string;
  name: string;
  type: string;
  size: number;
  creationTime: string;
}

interface RouterFilesPayload {
  routerId: number;
  routerName: string;
  files: RouterFile[];
  count: number;
  connectedHost?: string;
  fetchedAt?: string;
}

const panel: React.CSSProperties = {
  background: "var(--isp-section)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
};

const mutedText: React.CSSProperties = {
  color: "var(--isp-text-muted)",
  fontSize: "0.76rem",
  lineHeight: 1.5,
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.45rem",
  borderRadius: 8,
  padding: "0.58rem 0.85rem",
  border: "1px solid var(--isp-border)",
  background: "var(--isp-section)",
  color: "var(--isp-text)",
  fontFamily: "inherit",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isDirectory(file: RouterFile): boolean {
  return file.type.toLowerCase().includes("directory");
}

function fileIcon(file: RouterFile) {
  if (isDirectory(file)) return <Folder size={17} style={{ color: "#fbbf24" }} />;
  if (file.name.toLowerCase().endsWith(".rsc")) return <FileCode2 size={17} style={{ color: "#60a5fa" }} />;
  if (file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".txt")) {
    return <FileText size={17} style={{ color: "#4ade80" }} />;
  }
  return <File size={17} style={{ color: "var(--isp-text-muted)" }} />;
}

async function readJson<T>(url: string): Promise<T> {
  const token = getAdminApiToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `Request failed (${response.status})`);
  }
  return payload as T;
}

export default function Files() {
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [payload, setPayload] = useState<RouterFilesPayload | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "files" | "directories">("all");
  const [loadingRouters, setLoadingRouters] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [error, setError] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [deployingHotspot, setDeployingHotspot] = useState(false);
  const [deploymentSummary, setDeploymentSummary] = useState<HotspotFileDeploymentResult | null>(null);

  const loadRouters = useCallback(async () => {
    setLoadingRouters(true);
    setError("");
    try {
      const result = await readJson<RouterSummary[]>(
        `/api/routers?adminId=${ADMIN_ID}&includeSetup=false`,
      );
      const activeRouters = result.filter(router => !["setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"].includes(router.status ?? ""));
      setRouters(activeRouters);
      setSelectedRouterId(current => (
        current && activeRouters.some(router => router.id === current)
          ? current
          : activeRouters[0]?.id ?? null
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load routers.");
    } finally {
      setLoadingRouters(false);
    }
  }, []);

  const loadFiles = useCallback(async (routerId: number) => {
    setLoadingFiles(true);
    setError("");
    try {
      const result = await readJson<RouterFilesPayload>(
        `/api/router/${routerId}/files?adminId=${ADMIN_ID}`,
      );
      setPayload(result);
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "Could not read files from this router.");
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    void loadRouters();
  }, [loadRouters]);

  useEffect(() => {
    if (selectedRouterId) void loadFiles(selectedRouterId);
  }, [loadFiles, selectedRouterId]);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.files ?? [])
      .filter(file => {
        if (kind === "files" && isDirectory(file)) return false;
        if (kind === "directories" && !isDirectory(file)) return false;
        return !query || file.name.toLowerCase().includes(query) || file.type.toLowerCase().includes(query);
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [kind, payload?.files, search]);

  const totalSize = useMemo(
    () => (payload?.files ?? []).reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0),
    [payload?.files],
  );
  const directoryCount = (payload?.files ?? []).filter(isDirectory).length;
  const selectedRouter = routers.find(router => router.id === selectedRouterId);

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath(current => current === path ? null : current), 1800);
    } catch {
      setError("The file path could not be copied in this browser.");
    }
  };

  const deployHotspotFiles = async () => {
    if (!selectedRouterId || deployingHotspot) return;
    if (!window.confirm(
      `Install the approved hotspot files on ${selectedRouter?.name || "this router"}? Existing files will be kept and skipped; only missing files in flash/hotspot will be added.`,
    )) return;

    setDeployingHotspot(true);
    setError("");
    setDeploymentSummary(null);
    try {
      const token = getAdminApiToken();
      const result = await installHotspotFiles(selectedRouterId, ADMIN_ID, token);
      setDeploymentSummary(result);
      if (result.status === "failed" && result.failed.length) {
        setError(`Hotspot deployment finished with ${result.failed.length} failed file(s).`);
      }
      await loadFiles(selectedRouterId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hotspot files could not be deployed.");
    } finally {
      setDeployingHotspot(false);
    }
  };

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <NetworkTabs active="files" />

        <div>
          <h1 style={{ margin: 0, color: "var(--isp-text)", fontSize: "1.35rem", fontWeight: 800 }}>
            Router File Manager
          </h1>
          <p style={{ ...mutedText, margin: "0.35rem 0 0" }}>
            View every file and directory currently stored on a tenant router through the management VPN.
          </p>
        </div>

        <section style={{ ...panel, padding: "1rem", display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 260, flex: "1 1 300px" }}>
            <span style={{ ...mutedText, fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Router
            </span>
            <select
              value={selectedRouterId ?? ""}
              onChange={event => setSelectedRouterId(Number(event.target.value) || null)}
              disabled={loadingRouters || routers.length === 0}
              style={{ ...buttonStyle, justifyContent: "space-between", appearance: "auto", textAlign: "left" }}
            >
              {routers.length === 0 && <option value="">No installed routers</option>}
              {routers.map(router => (
                <option key={router.id} value={router.id}>{router.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => selectedRouterId && void loadFiles(selectedRouterId)}
            disabled={!selectedRouterId || loadingFiles}
            style={{ ...buttonStyle, color: selectedRouterId && !loadingFiles ? "var(--isp-accent)" : "var(--isp-text-muted)", cursor: selectedRouterId && !loadingFiles ? "pointer" : "not-allowed" }}
          >
            {loadingFiles ? <Loader2 size={15} style={{ animation: "self-install-spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
            Refresh files
          </button>
          <button
            type="button"
            onClick={() => void deployHotspotFiles()}
            disabled={!selectedRouterId || deployingHotspot}
            style={{ ...buttonStyle, background: "var(--isp-accent)", borderColor: "var(--isp-accent)", color: "#fff", cursor: selectedRouterId && !deployingHotspot ? "pointer" : "not-allowed", opacity: selectedRouterId && !deployingHotspot ? 1 : 0.6 }}
          >
            {deployingHotspot ? <Loader2 size={15} style={{ animation: "self-install-spin 1s linear infinite" }} /> : <HardDrive size={15} />}
            {deployingHotspot ? "Installing hotspot files…" : "Install hotspot files"}
          </button>
          <button type="button" onClick={() => void loadRouters()} disabled={loadingRouters} style={{ ...buttonStyle, cursor: loadingRouters ? "not-allowed" : "pointer" }}>
            {loadingRouters ? <Loader2 size={15} style={{ animation: "self-install-spin 1s linear infinite" }} /> : <Server size={15} />}
            Refresh routers
          </button>
        </section>

        {deploymentSummary && (
          <section style={{ ...panel, padding: "0.9rem 1rem", borderColor: deploymentSummary.failed.length ? "rgba(248,113,113,0.35)" : "rgba(74,222,128,0.3)", background: deploymentSummary.failed.length ? "rgba(248,113,113,0.06)" : "rgba(74,222,128,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: deploymentSummary.failed.length ? "#fca5a5" : "#86efac", fontWeight: 800, fontSize: "0.82rem" }}>
              {deploymentSummary.failed.length ? <AlertCircle size={16} /> : <Check size={16} />}
              Hotspot file installation {deploymentSummary.status === "complete" && !deploymentSummary.failed.length ? "complete" : "finished with errors"}
            </div>
            <div style={{ ...mutedText, marginTop: "0.4rem" }}>
              {deploymentSummary.deployed.length} added · {deploymentSummary.skipped.length} already present · {deploymentSummary.failed.length} failed · {deploymentSummary.processed} of {deploymentSummary.total} processed
            </div>
            {deploymentSummary.failed.length > 0 && (
              <ul style={{ margin: "0.65rem 0 0", paddingLeft: "1.2rem", color: "#fca5a5", fontSize: "0.74rem", lineHeight: 1.5 }}>
                {deploymentSummary.failed.map(file => (
                  <li key={`${file.destinationPath}:${file.error}`}>{file.destinationPath}: {file.error}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {error && (
          <div style={{ ...panel, padding: "0.9rem 1rem", color: "#fca5a5", background: "rgba(248,113,113,0.07)", borderColor: "rgba(248,113,113,0.28)", display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "0.8rem" }}>
            <AlertCircle size={16} style={{ color: "#f87171", flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {!loadingRouters && routers.length === 0 && !error && (
          <section style={{ ...panel, padding: "2.5rem 1.25rem", textAlign: "center" }}>
            <HardDrive size={30} style={{ color: "var(--isp-text-muted)", marginBottom: "0.65rem" }} />
            <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "1rem" }}>No installed routers yet</h2>
            <p style={{ ...mutedText, margin: "0.45rem auto 0", maxWidth: 480 }}>
              Complete Self Install for a router first. Its RouterOS files will appear here after the management connection is available.
            </p>
          </section>
        )}

        {selectedRouterId && (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.7rem" }}>
              {[
                { label: "Files and directories", value: payload ? String(payload.count) : "—", icon: File },
                { label: "Directories", value: payload ? String(directoryCount) : "—", icon: Folder },
                { label: "Total size", value: payload ? formatBytes(totalSize) : "—", icon: HardDrive },
                { label: "Connected through", value: payload?.connectedHost || "—", icon: Server },
              ].map(card => (
                <div key={card.label} style={{ ...panel, padding: "0.85rem 0.9rem", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--isp-text-muted)", fontSize: "0.68rem", fontWeight: 750 }}>
                    <card.icon size={14} style={{ color: "var(--isp-accent)" }} />
                    {card.label}
                  </div>
                  <div style={{ marginTop: "0.4rem", color: "var(--isp-text)", fontWeight: 800, fontSize: "0.92rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </section>

            <section style={{ ...panel, overflow: "hidden" }}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", gap: "0.65rem", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: "1 1 260px" }}>
                  <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search every file and directory…" style={{ width: "100%", boxSizing: "border-box", padding: "0.6rem 0.7rem 0.6rem 2rem", borderRadius: 8, border: "1px solid var(--isp-border)", background: "var(--isp-bg)", color: "var(--isp-text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  {(["all", "files", "directories"] as const).map(option => (
                    <button key={option} type="button" onClick={() => setKind(option)} style={{ ...buttonStyle, padding: "0.52rem 0.7rem", fontSize: "0.72rem", background: kind === option ? "var(--isp-accent-glow)" : "var(--isp-section)", borderColor: kind === option ? "var(--isp-accent-border)" : "var(--isp-border)", color: kind === option ? "var(--isp-accent)" : "var(--isp-text-muted)" }}>
                      {option[0].toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {loadingFiles ? (
                <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                  <Loader2 size={22} style={{ animation: "self-install-spin 1s linear infinite", color: "var(--isp-accent)", marginBottom: "0.55rem" }} />
                  <div>Reading the complete RouterOS file list from {selectedRouter?.name || "the router"}…</div>
                </div>
              ) : visibleFiles.length === 0 ? (
                <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                  <File size={24} style={{ color: "var(--isp-text-muted)", marginBottom: "0.5rem" }} />
                  <div>{payload ? "No files match the current filter." : "Select a router to read its files."}</div>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead>
                      <tr style={{ color: "var(--isp-text-muted)", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 800 }}>Name</th>
                        <th style={{ padding: "0.75rem 0.75rem", fontWeight: 800 }}>Type</th>
                        <th style={{ padding: "0.75rem 0.75rem", fontWeight: 800 }}>Size</th>
                        <th style={{ padding: "0.75rem 0.75rem", fontWeight: 800 }}>Created</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 800, textAlign: "right" }}>Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFiles.map(file => (
                        <tr key={`${file.id}:${file.name}`} style={{ borderTop: "1px solid var(--isp-border-subtle)", color: "var(--isp-text)", fontSize: "0.78rem" }}>
                          <td style={{ padding: "0.72rem 1rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", minWidth: 240 }}>
                              {fileIcon(file)}
                              <span className="technical-value" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", overflowWrap: "anywhere" }}>{file.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: "0.72rem 0.75rem", color: "var(--isp-text-muted)" }}>{isDirectory(file) ? "Directory" : file.type || "File"}</td>
                          <td style={{ padding: "0.72rem 0.75rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{isDirectory(file) ? "—" : formatBytes(file.size)}</td>
                          <td style={{ padding: "0.72rem 0.75rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{formatDate(file.creationTime)}</td>
                          <td style={{ padding: "0.72rem 1rem", textAlign: "right" }}>
                            <button type="button" onClick={() => void copyPath(file.name)} style={{ ...buttonStyle, padding: "0.35rem 0.55rem", fontSize: "0.68rem", marginLeft: "auto", color: copiedPath === file.name ? "#4ade80" : "var(--isp-text-muted)" }}>
                              {copiedPath === file.name ? <Check size={12} /> : <Clipboard size={12} />}
                              {copiedPath === file.name ? "Copied" : "Copy path"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {payload && !loadingFiles && (
                <div style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--isp-border-subtle)", ...mutedText, fontSize: "0.68rem" }}>
                  Showing {visibleFiles.length} of {payload.count} entries
                  {payload.fetchedAt ? ` · Last read ${formatDate(payload.fetchedAt)}` : ""}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}