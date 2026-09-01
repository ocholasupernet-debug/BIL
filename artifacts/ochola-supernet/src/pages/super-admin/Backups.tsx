import React, { useEffect, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Database, Download, RefreshCw, CheckCircle2, AlertTriangle, Play, Trash2, Clock, HardDrive, Loader2 } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
interface Backup {
  id: number; name: string; size: number | null; type: "auto" | "manual";
  status: "completed" | "failed" | "running" | "unavailable";
  createdAt: string; startedAt: string; completedAt: string | null;
  failureReason: string | null; artifactName: string | null; sha256: string | null;
}
interface SchedulerInfo {
  enabled: boolean;
  status: "starting" | "healthy" | "degraded" | "unavailable" | "disabled";
  scheduleUtc: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  retention?: { days: number; maxArtifacts: number; status: "healthy" | "degraded"; lastRunAt: string | null; lastError: string | null };
  storage?: { durable: boolean; available: boolean; kind: string; error: string | null };
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function SuperAdminBackups() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduler, setScheduler] = useState<SchedulerInfo | null>(null);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const authHeaders = () => ({ "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "" });

  const loadBackups = async () => {
    try {
      const [response, schedulerResponse] = await Promise.all([
        fetch("/api/super-admin/backups", { headers: authHeaders(), cache: "no-store" }),
        fetch("/api/super-admin/backups/status", { headers: authHeaders(), cache: "no-store" }),
      ]);
      const data = await response.json() as { backups?: Backup[]; error?: string };
      if (!response.ok || !data.backups) throw new Error(data.error || "Backups could not be loaded.");
      setBackups(data.backups);
      setRunning(data.backups.some(backup => backup.status === "running"));
      setError("");
      try {
        const schedulerData = await schedulerResponse.json() as {
          scheduler?: SchedulerInfo;
          storage?: SchedulerInfo["storage"];
          retention?: SchedulerInfo["retention"];
          error?: string;
        };
        if (!schedulerResponse.ok || !schedulerData.scheduler) {
          throw new Error(schedulerData.error || "Automatic backup scheduler status is unavailable.");
        }
        setScheduler({
          ...schedulerData.scheduler,
          storage: schedulerData.storage,
          retention: schedulerData.retention,
        });
      } catch (schedulerError) {
        setScheduler({
          enabled: false,
          status: "unavailable",
          scheduleUtc: null,
          nextRunAt: null,
          lastRunAt: null,
          lastError: schedulerError instanceof Error ? schedulerError.message : "Automatic backup scheduler status is unavailable.",
          storage: { durable: false, available: false, kind: "unknown", error: "Scheduler status could not be loaded." },
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Backups could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBackups();
    const timer = window.setInterval(() => { void loadBackups(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const triggerBackup = async () => {
    setRunning(true); setError("");
    try {
      const response = await fetch("/api/super-admin/backups", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Backup could not be started.");
      await loadBackups();
      showToast("Backup job started");
    } catch (backupError) {
      setRunning(false);
      setError(backupError instanceof Error ? backupError.message : "Backup could not be started.");
    }
  };

  const deleteBackup = async (id: number) => {
    try {
      const response = await fetch(`/api/super-admin/backups/${id}`, { method: "DELETE", headers: authHeaders() });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Backup could not be deleted.");
      setBackups(current => current.filter(backup => backup.id !== id));
      showToast("Backup deleted");
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : "Backup could not be deleted.", false);
    }
  };

  const downloadBackup = async (backup: Backup) => {
    try {
      const response = await fetch(`/api/super-admin/backups/${backup.id}/download`, { headers: authHeaders() });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "Backup could not be downloaded.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = backup.artifactName || `${backup.name}.dump`; link.click();
      URL.revokeObjectURL(url);
      showToast("Verified backup downloaded");
    } catch (downloadError) {
      showToast(downloadError instanceof Error ? downloadError.message : "Backup could not be downloaded.", false);
    }
  };

  const totalSize = backups.filter(b => b.status === "completed").reduce((acc, b) => acc + (b.size || 0), 0);
  const scheduleTitle = scheduler === null
    ? "Automatic Schedule: Checking…"
    : scheduler.status === "healthy"
      ? `Automatic Schedule: ${scheduler.scheduleUtc || "Daily"}`
      : scheduler.status === "disabled"
        ? "Automatic Schedule: Disabled"
        : scheduler.status === "degraded"
          ? "Automatic Schedule: Needs attention"
          : scheduler.status === "starting"
            ? "Automatic Schedule: Starting"
            : "Automatic Schedule: Unavailable";
  const scheduleDescription = scheduler === null
    ? "Checking server scheduler health and durable artifact storage…"
    : scheduler.status === "healthy"
      ? `Next run: ${scheduler.nextRunAt ? formatDate(scheduler.nextRunAt) : "pending"}. ${scheduler.storage?.durable && scheduler.storage.available ? "Durable filesystem storage is active." : "Durable storage is unavailable."}`
      : scheduler.lastError || "Automatic backups are not currently available. Manual runs still report their real server result.";
  const retentionDescription = scheduler?.retention
    ? scheduler.retention.status === "degraded"
      ? `Retention cleanup needs attention: ${scheduler.retention.lastError || "the server could not remove an expired artifact."}`
      : `Retention: ${scheduler.retention.days} days, up to ${scheduler.retention.maxArtifacts} artifacts.`
    : "Retention policy is reported by the server.";
  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 900 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Backups</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Verified database artifacts created by this server. No backup is shown as complete until its checksum is recorded.</p>
          </div>
          <button onClick={() => void triggerBackup()} disabled={running || loading} style={{ display: "flex", alignItems: "center", gap: 8, background: running ? "var(--isp-accent-border)" : C.accent, border: "none", borderRadius: 10, padding: "10px 18px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: running ? "not-allowed" : "pointer" }}>
            {running ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={14} />}
            {running ? "Running Backup…" : "Run Backup Now"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Backups", value: backups.length, color: "var(--isp-accent)", icon: Database },
            { label: "Completed", value: backups.filter(b => b.status === "completed").length, color: "#4ade80", icon: CheckCircle2 },
            { label: "Failed", value: backups.filter(b => b.status === "failed" || b.status === "unavailable").length, color: "#f87171", icon: AlertTriangle },
            { label: "Total Size", value: formatSize(totalSize), color: "var(--isp-accent)", icon: HardDrive },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}><p style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>{s.label}</p><s.icon size={14} color={s.color} /></div>
              <p style={{ fontSize: "1.4rem", fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--isp-accent-glow)", border: `1px solid var(--isp-accent-glow)`, borderRadius: 12, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <Clock size={16} color={scheduler?.status === "healthy" ? "#4ade80" : scheduler?.status === "degraded" ? "#fbbf24" : C.accent} />
          <div>
            <p style={{ fontWeight: 700, color: "white", margin: 0, fontSize: "0.85rem" }}>{scheduleTitle}</p>
            <p style={{ fontSize: "0.72rem", color: C.sub, margin: "2px 0 0" }}>{scheduleDescription}</p>
            <p style={{ fontSize: "0.68rem", color: C.muted, margin: "5px 0 0" }}>{retentionDescription}</p>
          </div>
        </div>

        {error && <div role="alert" style={{ marginBottom: 16, padding: "0.75rem 1rem", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#fca5a5", fontSize: "0.78rem" }}>{error}</div>}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {loading ? <div style={{ padding: 48, textAlign: "center", color: C.muted }}><Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} /><p>Loading backup history…</p></div> : backups.length === 0 ? <div style={{ padding: 48, textAlign: "center", color: C.muted }}>No backup jobs have been created.</div> : (
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["Backup Name", "Type", "Size", "Status", "Created", "Duration", "Actions"].map(h => <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
              <tbody>{backups.map(b => (
                <tr key={b.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "13px 16px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Database size={13} color={C.accent} /><span style={{ fontFamily: "monospace", fontWeight: 600, color: "white", fontSize: "0.78rem" }}>{b.name}</span></div></td>
                  <td style={{ padding: "13px 16px" }}><span style={{ padding: "2px 8px", borderRadius: 8, fontSize: "0.67rem", fontWeight: 700, background: "var(--isp-accent-glow)", color: C.accent }}>{b.type}</span></td>
                  <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.75rem", color: C.sub }}>{formatSize(b.size)}</td>
                  <td style={{ padding: "13px 16px" }}>
                    {b.status === "completed" && <span style={{ color: "#4ade80", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={11} /> Completed</span>}
                    {b.status === "running" && <span style={{ color: "#fbbf24", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Running</span>}
                    {(b.status === "failed" || b.status === "unavailable") && <span title={b.failureReason || undefined} style={{ color: "#f87171", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> {b.status === "unavailable" ? "Unavailable" : "Failed"}</span>}
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "0.72rem", color: C.muted }}>{formatDate(b.createdAt)}</td>
                  <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.72rem", color: C.sub }}>{b.completedAt ? `${Math.max(0, Math.round((new Date(b.completedAt).getTime() - new Date(b.startedAt).getTime()) / 1000))}s` : "—"}</td>
                  <td style={{ padding: "13px 16px" }}><div style={{ display: "flex", gap: 6 }}>
                    {b.status === "completed" && <button onClick={() => void downloadBackup(b)} style={{ background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)", borderRadius: 7, padding: "5px 10px", color: C.accent, cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><Download size={11} /> Download</button>}
                    <button onClick={() => void deleteBackup(b.id)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 7, padding: "5px 10px", color: "#f87171", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><Trash2 size={11} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.ok ? "#022c22" : "#450a0a", border: `1px solid ${toast.ok ? "#4ade80" : "#f87171"}`, borderRadius: 10, padding: "12px 20px", color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.82rem", zIndex: 300 }}>{toast.msg}</div>}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}