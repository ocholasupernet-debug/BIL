import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Info, Shield } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", muted: "#64748b", sub: "#94a3b8" };

type LogLevel = "success" | "warning" | "error" | "info";
interface LogEntry { id: number; level: LogLevel; action: string; user: string; ip: string; time: string; details: string; }

const SAMPLE_LOGS: LogEntry[] = [
  { id: 1,  level: "success", action: "Admin Login",            user: "admin",       ip: "41.90.1.5",      time: "Today 09:14:22",     details: "Successful login from Nairobi, KE" },
  { id: 2,  level: "warning", action: "Failed Login Attempt",   user: "unknown",     ip: "196.201.214.3",  time: "Today 09:02:11",     details: "5 failed attempts — IP flagged" },
  { id: 3,  level: "info",    action: "Admin Created",           user: "superadmin",  ip: "127.0.0.1",      time: "Today 08:55:00",     details: "New ISP admin fastnet registered" },
  { id: 4,  level: "success", action: "Config Pushed",           user: "chris",       ip: "41.90.100.12",   time: "Today 08:30:14",     details: "MikroTik config pushed to router latty1" },
  { id: 5,  level: "error",   action: "Router Connect Failed",   user: "chris",       ip: "41.90.100.12",   time: "Today 07:45:33",     details: "Connection timeout — router latty3 unreachable" },
  { id: 6,  level: "info",    action: "Backup Completed",        user: "system",      ip: "127.0.0.1",      time: "Today 02:00:00",     details: "Automatic database backup completed (12.4 MB)" },
  { id: 7,  level: "warning", action: "API Rate Limit Hit",      user: "fastnet-api", ip: "196.201.3.45",   time: "Yesterday 23:12:05", details: "API key sk_live hit 1000 req/hr limit" },
  { id: 8,  level: "success", action: "Password Changed",        user: "come",        ip: "41.90.55.100",   time: "Yesterday 18:05:30", details: "Password successfully changed" },
  { id: 9,  level: "error",   action: "RADIUS Auth Failure",     user: "system",      ip: "127.0.0.1",      time: "Yesterday 15:30:00", details: "FreeRADIUS unreachable for 2 minutes" },
  { id: 10, level: "info",    action: "New Voucher Batch",        user: "chris",       ip: "41.90.100.12",   time: "Yesterday 12:00:00", details: "50 voucher codes generated for router latty2" },
  { id: 11, level: "warning", action: "Disk Space Warning",      user: "system",      ip: "127.0.0.1",      time: "Mar 27 09:00:00",    details: "Disk usage at 82% — 8.6 GB / 50 GB used" },
  { id: 12, level: "success", action: "Admin Suspended",         user: "superadmin",  ip: "127.0.0.1",      time: "Mar 27 08:15:00",    details: "ISP admin slownet suspended for non-payment" },
];

const LEVEL_STYLES: Record<LogLevel, { bg: string; color: string; icon: React.ElementType }> = {
  success: { bg: "rgba(74,222,128,0.1)",  color: "#4ade80", icon: CheckCircle2  },
  warning: { bg: "rgba(251,191,36,0.1)",  color: "#fbbf24", icon: AlertTriangle },
  error:   { bg: "rgba(248,113,113,0.1)", color: "#f87171", icon: XCircle       },
  info:    { bg: "var(--isp-accent-glow)",  color: "#a5b4fc", icon: Info          },
};

export default function SuperAdminSecurityLogs() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogLevel | "all">("all");

  const filtered = SAMPLE_LOGS.filter(l =>
    (filter === "all" || l.level === filter) &&
    [l.action, l.user, l.ip, l.details].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    success: SAMPLE_LOGS.filter(l => l.level === "success").length,
    warning: SAMPLE_LOGS.filter(l => l.level === "warning").length,
    error:   SAMPLE_LOGS.filter(l => l.level === "error").length,
    info:    SAMPLE_LOGS.filter(l => l.level === "info").length,
  };

  const FILTERS: [string, string, string][] = [
    ["all",     "All Events",              "var(--isp-accent)"],
    ["success", `Success (${counts.success})`, "#4ade80"],
    ["warning", `Warning (${counts.warning})`, "#fbbf24"],
    ["error",   `Error (${counts.error})`,     "#f87171"],
    ["info",    `Info (${counts.info})`,        "#a5b4fc"],
  ];

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1100 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Security Logs</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Audit trail of all significant platform actions and events.</p>
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 16px", color: C.sub, fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Level filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {FILTERS.map(([val, label, color]) => (
            <button key={val} onClick={() => setFilter(val as LogLevel | "all")} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
              background: filter === val ? `${color}18` : C.card,
              border: `1px solid ${filter === val ? color + "40" : C.border}`,
              color: filter === val ? color : C.muted,
            }}>
              {label}
            </button>
          ))}
          <div style={{ position: "relative", marginLeft: "auto", minWidth: 240 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search logs…"
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px 8px 30px", color: "#e2e8f0", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" as const }}
            />
          </div>
        </div>

        {/* Log table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Shield size={28} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              <p>No log entries match your filter.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Level", "Action", "User", "IP Address", "Time", "Details"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(log => {
                    const s = LEVEL_STYLES[log.level];
                    const Icon = s.icon;
                    return (
                      <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 8, background: s.bg, color: s.color, fontSize: "0.68rem", fontWeight: 700 }}>
                            <Icon size={10} /> {log.level}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "white" }}>{log.action}</td>
                        <td style={{ padding: "12px 16px", fontFamily: "monospace", color: C.accent, fontSize: "0.75rem" }}>{log.user}</td>
                        <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: "0.72rem", color: C.sub }}>{log.ip}</td>
                        <td style={{ padding: "12px 16px", fontSize: "0.72rem", color: C.muted, whiteSpace: "nowrap" as const }}>{log.time}</td>
                        <td style={{ padding: "12px 16px", color: C.sub, fontSize: "0.75rem" }}>{log.details}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p style={{ fontSize: "0.72rem", color: C.muted, margin: "12px 0 0", textAlign: "right" as const }}>
          Showing {filtered.length} of {SAMPLE_LOGS.length} entries. Logs retained for 90 days.
        </p>
      </div>
    </SuperAdminLayout>
  );
}
