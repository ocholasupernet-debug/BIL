import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Database, Download, RefreshCw, CheckCircle2, AlertTriangle, Play, Trash2, Clock, HardDrive } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

interface Backup { id: number; name: string; size: string; type: "auto" | "manual"; status: "completed" | "failed" | "running"; createdAt: string; duration: string; }

const INIT_BACKUPS: Backup[] = [
  { id: 1, name: "db-backup-2026-03-28",   size: "12.4 MB", type: "auto",   status: "completed", createdAt: "Today 02:00:00",    duration: "1m 12s" },
  { id: 2, name: "db-backup-2026-03-27",   size: "12.1 MB", type: "auto",   status: "completed", createdAt: "Yesterday 02:00:00",duration: "1m 08s" },
  { id: 3, name: "db-backup-2026-03-26",   size: "11.9 MB", type: "auto",   status: "completed", createdAt: "Mar 26 02:00:00",   duration: "1m 05s" },
  { id: 4, name: "pre-migration-backup",    size: "11.8 MB", type: "manual", status: "completed", createdAt: "Mar 25 16:30:00",   duration: "58s"    },
  { id: 5, name: "db-backup-2026-03-25",   size: "11.7 MB", type: "auto",   status: "completed", createdAt: "Mar 25 02:00:00",   duration: "1m 01s" },
  { id: 6, name: "db-backup-2026-03-24",   size: "11.5 MB", type: "auto",   status: "failed",    createdAt: "Mar 24 02:00:00",   duration: "—"      },
];

export default function SuperAdminBackups() {
  const [backups, setBackups] = useState(INIT_BACKUPS);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const triggerBackup = () => {
    setRunning(true);
    const newBackup: Backup = { id: Date.now(), name: `manual-backup-${new Date().toISOString().slice(0,10)}`, size: "—", type: "manual", status: "running", createdAt: "Just now", duration: "—" };
    setBackups(b => [newBackup, ...b]);
    setTimeout(() => {
      setBackups(b => b.map(bk => bk.id === newBackup.id ? { ...bk, size: "12.6 MB", status: "completed", duration: "1m 03s" } : bk));
      setRunning(false);
      showToast("Backup completed successfully");
    }, 4000);
  };

  const deleteBackup = (id: number) => { setBackups(b => b.filter(bk => bk.id !== id)); showToast("Backup deleted"); };

  const totalSize = backups.filter(b => b.status === "completed").reduce((acc, b) => acc + parseFloat(b.size) || 0, 0);

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 900 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Backups</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Database backups — automated daily at 02:00 EAT. Retained for 30 days.</p>
          </div>
          <button onClick={triggerBackup} disabled={running} style={{ display: "flex", alignItems: "center", gap: 8, background: running ? "var(--isp-accent-border)" : C.accent, border: "none", borderRadius: 10, padding: "10px 18px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: running ? "not-allowed" : "pointer" }}>
            {running ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={14} />}
            {running ? "Running Backup…" : "Run Backup Now"}
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Backups", value: backups.length, color: "var(--isp-accent)", icon: Database },
            { label: "Completed", value: backups.filter(b => b.status === "completed").length, color: "#4ade80", icon: CheckCircle2 },
            { label: "Failed", value: backups.filter(b => b.status === "failed").length, color: "#f87171", icon: AlertTriangle },
            { label: "Total Size", value: `${totalSize.toFixed(1)} MB`, color: "var(--isp-accent)", icon: HardDrive },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>{s.label}</p>
                <s.icon size={14} color={s.color} />
              </div>
              <p style={{ fontSize: "1.4rem", fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Schedule info */}
        <div style={{ background: "var(--isp-accent-glow)", border: `1px solid var(--isp-accent-glow)`, borderRadius: 12, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <Clock size={16} color={C.accent} />
          <div>
            <p style={{ fontWeight: 700, color: "white", margin: 0, fontSize: "0.85rem" }}>Automatic Schedule</p>
            <p style={{ fontSize: "0.72rem", color: C.sub, margin: "2px 0 0" }}>Daily at <strong style={{ color: C.accent }}>02:00 EAT</strong> · Cron: <code style={{ fontFamily: "monospace", color: "var(--isp-accent)" }}>0 2 * * *</code> · Storage: Local + S3 · Retention: 30 days</p>
          </div>
        </div>

        {/* Backups list */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Backup Name", "Type", "Size", "Status", "Created", "Duration", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "13px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Database size={13} color={C.accent} />
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "white", fontSize: "0.78rem" }}>{b.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "13px 16px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: "0.67rem", fontWeight: 700, background: b.type === "auto" ? "var(--isp-accent-glow)" : "rgba(139,92,246,0.1)", color: b.type === "auto" ? "var(--isp-accent)" : "var(--isp-accent)" }}>
                      {b.type}
                    </span>
                  </td>
                  <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.75rem", color: C.sub }}>{b.size}</td>
                  <td style={{ padding: "13px 16px" }}>
                    {b.status === "completed" && <span style={{ color: "#4ade80", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={11} /> Completed</span>}
                    {b.status === "failed" && <span style={{ color: "#f87171", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> Failed</span>}
                    {b.status === "running" && <span style={{ color: "#fbbf24", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Running</span>}
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "0.72rem", color: C.muted }}>{b.createdAt}</td>
                  <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.72rem", color: C.sub }}>{b.duration}</td>
                  <td style={{ padding: "13px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {b.status === "completed" && (
                        <button style={{ background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)", borderRadius: 7, padding: "5px 10px", color: C.accent, cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                          <Download size={11} /> Download
                        </button>
                      )}
                      <button onClick={() => deleteBackup(b.id)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 7, padding: "5px 10px", color: "#f87171", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.ok ? "#022c22" : "#450a0a", border: `1px solid ${toast.ok ? "#4ade80" : "#f87171"}`, borderRadius: 10, padding: "12px 20px", color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.82rem", zIndex: 300 }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
