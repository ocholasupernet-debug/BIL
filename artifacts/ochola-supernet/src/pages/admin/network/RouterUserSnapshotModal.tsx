import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Clock3, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { getAdminApiToken } from "@/lib/supabase";

interface SnapshotStatus {
  routerId: number;
  routerName: string | null;
  snapshotAvailable: boolean;
  scheduleEnabled: boolean;
  nextSyncAt: string | null;
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
  status: "never" | "success" | "failed";
  errorCode: string | null;
  pppCount: number;
  hotspotCount: number;
}

interface ApiError {
  error?: string;
}

async function snapshotRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminApiToken();
  if (!token) throw new Error("Your admin session has expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  const body = await parseJsonResponse<T & ApiError>(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (HTTP ${response.status}).`);
  }
  return body;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
}

export function RouterUserSnapshotModal({
  routerId,
  routerName,
  onClose,
}: {
  routerId: number;
  routerName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<SnapshotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const result = await snapshotRequest<SnapshotStatus>(`/api/router-user-snapshots/${routerId}`);
      setStatus(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [routerId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      await snapshotRequest(`/api/router-user-snapshots/${routerId}/sync`, { method: "POST", body: "{}" });
      setNotice("Router users were backed up successfully.");
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The user backup could not be completed.");
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }

  async function toggleSchedule() {
    if (!status) return;
    setSavingSchedule(true);
    setError("");
    setNotice("");
    try {
      const result = await snapshotRequest<{ scheduleEnabled: boolean; nextSyncAt: string | null }>(
        `/api/router-user-snapshots/${routerId}/schedule`,
        { method: "PATCH", body: JSON.stringify({ enabled: !status.scheduleEnabled }) },
      );
      setStatus(current => current ? {
        ...current,
        scheduleEnabled: result.scheduleEnabled,
        nextSyncAt: result.nextSyncAt,
      } : current);
      setNotice(result.scheduleEnabled
        ? "Daily refresh enabled. The first scheduled backup is due in 24 hours."
        : "Daily refresh disabled. Existing backup is kept.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The daily refresh setting could not be saved.");
    } finally {
      setSavingSchedule(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1100, padding: "1rem",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.66)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="router-user-backup-title"
        onClick={event => event.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, borderRadius: 12, padding: "1.25rem",
          background: "var(--isp-section)", border: "1px solid var(--isp-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 id="router-user-backup-title" style={{ margin: 0, color: "var(--isp-text)", fontSize: "1rem" }}>
              User backup
            </h2>
            <p style={{ margin: "0.3rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.78rem" }}>{routerName}</p>
          </div>
          <button
            type="button"
            aria-label="Close user backup"
            onClick={onClose}
            style={{ border: 0, background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4 }}
          >
            <X size={17} />
          </button>
        </header>

        <div style={{
          display: "flex", gap: 9, marginTop: "1rem", padding: "0.7rem 0.75rem",
          borderRadius: 8, color: "#a7f3d0", background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.2)", fontSize: "0.73rem", lineHeight: 1.5,
        }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>PPP and Hotspot user details, including passwords, are encrypted in storage and never shown here. This does not include live sessions or historical session records.</span>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "1.5rem 0", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
            <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading backup status…
          </div>
        ) : (
          <>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8, marginTop: "1rem",
            }}>
              {[
                ["Backup status", status?.status === "success" ? "Available" : status?.status === "failed" ? "Last attempt failed" : "No backup yet"],
                ["Last backup", formatDate(status?.lastSyncedAt ?? null)],
                ["PPP users", status?.snapshotAvailable ? status.pppCount : "—"],
                ["Hotspot users", status?.snapshotAvailable ? status.hotspotCount : "—"],
                ["Daily refresh", status?.scheduleEnabled ? "Enabled · UTC" : "Disabled"],
                ["Next refresh", status?.scheduleEnabled ? formatDate(status.nextSyncAt) : "—"],
              ].map(([label, value]) => (
                <div key={label} style={{
                  minWidth: 0, padding: "0.65rem 0.7rem", borderRadius: 8,
                  border: "1px solid var(--isp-border-subtle)", background: "rgba(255,255,255,0.025)",
                }}>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                  <div style={{ marginTop: 4, color: "var(--isp-text)", fontSize: "0.76rem", fontWeight: 650, overflowWrap: "anywhere" }}>{value}</div>
                </div>
              ))}
            </div>

            {status?.status === "failed" && (
              <p style={{ display: "flex", alignItems: "center", gap: 6, margin: "0.75rem 0 0", color: "#fbbf24", fontSize: "0.74rem" }}>
                <AlertCircle size={14} /> The previous attempt did not replace the last successful backup.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" style={{ margin: "0.8rem 0 0", color: "#f87171", fontSize: "0.76rem", lineHeight: 1.5 }}>
            <AlertCircle size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{error}
          </p>
        )}
        {notice && (
          <p role="status" style={{ margin: "0.8rem 0 0", color: "#4ade80", fontSize: "0.76rem", lineHeight: 1.5 }}>
            <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{notice}
          </p>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: "1.1rem" }}>
          <button
            type="button"
            onClick={() => void toggleSchedule()}
            disabled={!status || loading || savingSchedule}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.75rem",
              borderRadius: 7, border: "1px solid var(--isp-border)", background: "rgba(255,255,255,0.04)",
              color: "var(--isp-text)", fontSize: "0.75rem", fontWeight: 650,
              cursor: !status || loading || savingSchedule ? "not-allowed" : "pointer",
              opacity: !status || loading || savingSchedule ? 0.6 : 1,
            }}
          >
            {savingSchedule
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <Clock3 size={13} />}
            {status?.scheduleEnabled ? "Disable daily refresh" : "Enable daily refresh"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void loadStatus()}
              disabled={loading || syncing}
              title="Refresh backup status"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0.55rem", borderRadius: 7, border: "1px solid var(--isp-border)",
                background: "rgba(255,255,255,0.04)", color: "var(--isp-text-muted)", cursor: "pointer",
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={loading || syncing}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.85rem",
                borderRadius: 7, border: "1px solid var(--isp-accent-border)",
                background: "var(--isp-accent)", color: "#fff", fontSize: "0.76rem",
                fontWeight: 700, cursor: loading || syncing ? "not-allowed" : "pointer",
                opacity: loading || syncing ? 0.7 : 1,
              }}
            >
              {syncing
                ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Syncing…</>
                : <><RefreshCw size={13} /> Sync now</>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}