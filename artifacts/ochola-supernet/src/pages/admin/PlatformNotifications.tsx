import React, { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { getAdminApiToken } from "@/lib/supabase";
import { AlertTriangle, Bell, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

interface CleanupRequest {
  id: number;
  admin_id: number;
  scheduled_for: string;
  candidate_bytes: number | string;
  candidate_rows: number | string;
  status: "pending" | "processing" | "cancelled" | "completed" | "failed";
  reason: string;
  completed_at: string | null;
  failure_details: string | null;
}

interface Notification {
  id: number;
  title: string;
  body: string;
  notification_type: string;
  cleanup_request_id: number | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  cleanupRequest: CleanupRequest | null;
}

const COLORS = { accent: "var(--isp-accent)", border: "var(--isp-accent-glow)", muted: "#64748b", sub: "#94a3b8", text: "#e2e8f0", green: "#4ade80", red: "#f87171", amber: "#fbbf24" };

function formatBytes(value: number | string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
}

function remaining(value: string, now: number): string {
  const ms = new Date(value).getTime() - now;
  if (ms <= 0) return "Due now";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  return days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export default function PlatformNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/storage/notifications", {
        headers: { Authorization: `Bearer ${getAdminApiToken()}` },
      });
      const body = await response.json() as { ok?: boolean; error?: string; notifications?: Notification[] };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not load notifications.");
      setNotifications(body.notifications ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load notifications.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(true), 30_000);
    const ticker = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(ticker);
    };
  }, [load]);

  const recover = async (requestId: number) => {
    if (!window.confirm("Keep this data and cancel the pending cleanup?")) return;
    setWorkingId(requestId);
    try {
      const response = await fetch(`/api/admin/storage/cleanup-requests/${requestId}/recover`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminApiToken()}` },
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not recover the data.");
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not recover the data.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <AdminLayout>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
          <div>
            <h1 style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 9 }}><Bell size={21} color={COLORS.accent} /> Platform notifications</h1>
            <p style={{ color: COLORS.muted, fontSize: 13, margin: "5px 0 0" }}>Important notices from your platform administrator.</p>
          </div>
          <button onClick={() => void load(true)} disabled={refreshing} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", borderRadius: 8, color: COLORS.accent, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}><RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} /> Refresh</button>
        </div>

        {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 9, color: COLORS.red, padding: 12, fontSize: 12, marginBottom: 16 }}>{error}</div>}
        {loading ? <div style={{ padding: 50, textAlign: "center", color: COLORS.muted }}><Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} /><p>Loading notifications…</p></div> : notifications.length === 0 ? (
          <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 48, textAlign: "center", color: COLORS.muted }}><CheckCircle2 size={28} color={COLORS.green} /><p style={{ color: COLORS.text, fontWeight: 700 }}>You’re all caught up</p><p style={{ fontSize: 12 }}>There are no platform notices for this ISP account.</p></div>
        ) : (
          <div style={{ display: "grid", gap: 13 }}>
            {notifications.map(notification => {
              const request = notification.cleanupRequest;
              const pending = request?.status === "pending";
              const statusColor = request?.status === "completed" ? COLORS.green : request?.status === "failed" ? COLORS.red : request?.status === "cancelled" ? COLORS.muted : COLORS.amber;
              return (
                <article key={notification.id} style={{ background: "rgba(15,23,42,0.6)", border: `1px solid ${pending ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: pending ? "rgba(251,191,36,0.1)" : "var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center" }}>{pending ? <AlertTriangle size={17} color={COLORS.amber} /> : <Bell size={17} color={COLORS.accent} />}</div>
                      <div><h2 style={{ margin: 0, color: "#f8fafc", fontSize: 14 }}>{notification.title}</h2><p style={{ margin: "4px 0 0", color: COLORS.sub, fontSize: 12, lineHeight: 1.55 }}>{notification.body}</p></div>
                    </div>
                    <span style={{ color: COLORS.muted, fontSize: 10, whiteSpace: "nowrap" }}>{formatDate(notification.created_at)}</span>
                  </div>
                  {request && (
                    <div style={{ marginTop: 16, padding: 13, background: "rgba(0,0,0,0.18)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="admin-notice-meta" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                        <div><span style={{ display: "block", color: COLORS.muted, fontSize: 10, textTransform: "uppercase", fontWeight: 800 }}>Data scope</span><strong style={{ display: "block", color: COLORS.text, fontSize: 12, marginTop: 4 }}>Aged migration artifacts</strong></div>
                        <div><span style={{ display: "block", color: COLORS.muted, fontSize: 10, textTransform: "uppercase", fontWeight: 800 }}>Selected data</span><strong style={{ display: "block", color: COLORS.text, fontSize: 12, marginTop: 4 }}>{Number(request.candidate_rows)} item(s) · {formatBytes(request.candidate_bytes)}</strong></div>
                        <div><span style={{ display: "block", color: COLORS.muted, fontSize: 10, textTransform: "uppercase", fontWeight: 800 }}>Status</span><strong style={{ display: "block", color: statusColor, fontSize: 12, marginTop: 4 }}>{request.status === "pending" ? `${remaining(request.scheduled_for, now)} remaining` : request.status}</strong></div>
                      </div>
                      <p style={{ color: COLORS.muted, fontSize: 11, margin: "12px 0 0" }}>Deadline: <span style={{ color: COLORS.sub }}>{formatDate(request.scheduled_for)}</span></p>
                      {pending && <button onClick={() => void recover(request.id)} disabled={workingId === request.id} style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 8, border: "1px solid rgba(74,222,128,0.3)", background: "rgba(74,222,128,0.08)", color: COLORS.green, padding: "8px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{workingId === request.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <ShieldCheck size={13} />} Keep my data / cancel cleanup</button>}
                      {request.status === "failed" && request.failure_details && <p style={{ color: COLORS.red, fontSize: 11, margin: "10px 0 0" }}><XCircle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />{request.failure_details}</p>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@media(max-width:600px){.admin-notice-meta{grid-template-columns:1fr!important}}`}</style>
    </AdminLayout>
  );
}