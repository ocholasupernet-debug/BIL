import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  RefreshCw, Loader2, Router, BookOpen, Users,
  Zap, Settings, Filter, ChevronDown, ChevronRight,
  PlusCircle, Edit2, Trash2, Wifi, WifiOff, Activity,
} from "lucide-react";

/* ═══════════════════════ Types ═══════════════════════════════════ */
interface ActivityLog {
  id: number;
  admin_id: number;
  type: string;
  action: string;
  subject: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/* ═══════════════════════ Helpers ═══════════════════════════════════ */
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function getAdminId(): number {
  try { return Number(JSON.parse(atob(localStorage.getItem("ochola_token")?.split(".")[1] ?? ""))?.sub ?? 1); } catch { return 1; }
}

/* ═══════════════════════ Visual config ═══════════════════════════ */
const TYPE_CONFIG: Record<string, { label: string; color: string; border: string; bg: string; Icon: React.ElementType }> = {
  router:    { label: "Router",      color: "#38bdf8", border: "rgba(56,189,248,0.3)",  bg: "rgba(56,189,248,0.08)",  Icon: Router   },
  plan:      { label: "Plan",        color: "var(--isp-accent)", border: "var(--isp-accent-border)", bg: "var(--isp-accent-glow)", Icon: BookOpen },
  customer:  { label: "Customer",    color: "#34d399", border: "rgba(52,211,153,0.3)",  bg: "rgba(52,211,153,0.08)",  Icon: Users    },
  provision: { label: "Provision",   color: "#fbbf24", border: "rgba(251,191,36,0.3)",  bg: "rgba(251,191,36,0.08)",  Icon: Zap      },
  system:    { label: "System",      color: "#94a3b8", border: "rgba(148,163,184,0.3)", bg: "rgba(148,163,184,0.08)", Icon: Settings },
};

const ACTION_CONFIG: Record<string, { Icon: React.ElementType; color: string }> = {
  added:    { Icon: PlusCircle, color: "#4ade80" },
  updated:  { Icon: Edit2,      color: "#60a5fa" },
  deleted:  { Icon: Trash2,     color: "#f87171" },
  online:   { Icon: Wifi,       color: "#4ade80" },
  offline:  { Icon: WifiOff,    color: "#f87171" },
  payment:  { Icon: Zap,        color: "#fbbf24" },
  provisioned: { Icon: Zap,     color: "var(--isp-accent)" },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] ?? { label: type, color: "#94a3b8", border: "rgba(148,163,184,0.3)", bg: "rgba(148,163,184,0.08)", Icon: Activity };
}
function getActionConfig(action: string) {
  const key = Object.keys(ACTION_CONFIG).find(k => action.toLowerCase().includes(k));
  return ACTION_CONFIG[key ?? ""] ?? { Icon: Activity, color: "#94a3b8" };
}

/* ═══════════════════════ Row component ═══════════════════════════ */
function LogRow({ log }: { log: ActivityLog }) {
  const [open, setOpen] = useState(false);
  const tc = getTypeConfig(log.type);
  const ac = getActionConfig(log.action);
  const ActionIcon = ac.Icon;

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div
        onClick={() => log.details && setOpen(o => !o)}
        style={{
          display: "grid",
          gridTemplateColumns: "32px 110px 1fr 110px 90px",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          cursor: log.details ? "pointer" : "default",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { if (log.details) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        {/* Action icon */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ActionIcon size={15} style={{ color: ac.color, flexShrink: 0 }} />
        </div>

        {/* Type badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 8px", borderRadius: 6,
          background: tc.bg, border: `1px solid ${tc.border}`,
          color: tc.color, fontSize: 11, fontWeight: 700,
        }}>
          <tc.Icon size={11} />
          {tc.label}
        </div>

        {/* Action + subject */}
        <div>
          <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{log.action}</span>
          {log.subject && (
            <span style={{ color: "#94a3b8", fontSize: 13 }}> — {log.subject}</span>
          )}
        </div>

        {/* Expand indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#475569", fontSize: 11 }}>
          {log.details && (
            open
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />
          )}
          {log.details && <span>details</span>}
        </div>

        {/* Time */}
        <div style={{ color: "#64748b", fontSize: 11, textAlign: "right" }}>
          {timeAgo(log.created_at)}
        </div>
      </div>

      {/* Expanded details */}
      {open && log.details && (
        <div style={{ padding: "0 16px 12px 60px" }}>
          <pre style={{
            background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8, padding: 12, color: "#7dd3fc", fontSize: 11,
            overflowX: "auto", margin: 0, fontFamily: "monospace",
          }}>
            {JSON.stringify(log.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ Main page ══════════════════════════════ */
export default function ActivityLogs() {
  const adminId = getAdminId();
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery<ActivityLog[]>({
    queryKey: ["activity-logs", adminId, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ adminId: String(adminId), limit: "200" });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`/api/logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const types = ["all", "router", "plan", "customer", "provision", "system"];

  return (
    <AdminLayout>
      <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <BookOpen size={22} style={{ color: "#7dd3fc" }} />
              Activity Logs
            </h1>
            <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>
              All platform activities — routers, plans, customers and more
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)",
              color: "var(--isp-accent)", fontSize: 13, fontWeight: 600,
            }}
          >
            <RefreshCw size={13} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <Filter size={14} style={{ color: "#475569", alignSelf: "center", marginRight: 4 }} />
          {types.map(t => {
            const tc = t === "all" ? null : getTypeConfig(t);
            const active = typeFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: "5px 14px", borderRadius: 20, cursor: "pointer",
                  fontSize: 12, fontWeight: 700, textTransform: "capitalize",
                  transition: "all 0.15s",
                  background: active ? (tc?.bg ?? "var(--isp-accent-glow)") : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? (tc?.border ?? "var(--isp-accent-border)") : "rgba(255,255,255,0.08)"}`,
                  color: active ? (tc?.color ?? "var(--isp-accent)") : "#64748b",
                }}
              >
                {t === "all" ? "All" : tc?.label}
              </button>
            );
          })}
        </div>

        {/* Table card */}
        <div style={{
          background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 14, overflow: "hidden",
        }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "32px 110px 1fr 110px 90px",
            gap: 12, padding: "10px 16px",
            background: "rgba(0,0,0,0.2)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div />
            <div style={{ color: "#475569", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Type</div>
            <div style={{ color: "#475569", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Activity</div>
            <div />
            <div style={{ color: "#475569", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, textAlign: "right" }}>When</div>
          </div>

          {/* Body */}
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 48, color: "#475569" }}>
              <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: "#475569" }}>
              <BookOpen size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: 14 }}>No activity yet</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>Actions like adding routers, plans, and customers will appear here</p>
              <p style={{ margin: "12px 0 0", fontSize: 11, color: "#334155" }}>
                Make sure the <code style={{ color: "#7dd3fc" }}>isp_activity_logs</code> table exists in your Supabase project.
              </p>
            </div>
          ) : (
            logs.map(log => <LogRow key={log.id} log={log} />)
          )}
        </div>

        {logs.length > 0 && (
          <p style={{ textAlign: "right", color: "#334155", fontSize: 11, marginTop: 10 }}>
            Showing {logs.length} most recent entries · auto-refreshes every 30s
          </p>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}
