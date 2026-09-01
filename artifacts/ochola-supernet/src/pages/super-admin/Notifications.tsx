import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Bell, Save, CheckCircle2, Mail, MessageSquare, Zap, AlertTriangle, Loader2, RefreshCw } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8", green: "#4ade80", amber: "#fbbf24" };

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 42, height: 22, borderRadius: 11, background: on ? C.accent : "rgba(255,255,255,0.1)", border: "none", cursor: "pointer", position: "relative", padding: 0, flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </button>
  );
}

interface NotifRule {
  id: string; label: string; desc: string;
  email: boolean; sms: boolean; push: boolean;
}

interface CapacityAlert {
  id: number;
  notification_type: "storage_capacity_warning" | "storage_capacity_recovered";
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const DEFAULTS: NotifRule[] = [
  { id: "new_admin",      label: "New ISP Registered",        desc: "When a new ISP admin signs up",                         email: true,  sms: false, push: true  },
  { id: "admin_suspend",  label: "Admin Suspended",            desc: "When an ISP account is auto-suspended",                 email: true,  sms: true,  push: true  },
  { id: "payment_recv",   label: "Payment Received",           desc: "When a subscription payment is processed",              email: true,  sms: false, push: false },
  { id: "payment_fail",   label: "Payment Failed",             desc: "When a payment attempt fails",                          email: true,  sms: true,  push: true  },
  { id: "router_offline", label: "Router Offline",             desc: "When a managed router goes offline for >5 min",          email: false, sms: false, push: true  },
  { id: "login_fail",     label: "Failed Login (5+)",          desc: "When an account has 5+ failed login attempts",           email: true,  sms: true,  push: true  },
  { id: "disk_warn",      label: "Disk Space Warning",         desc: "When disk usage exceeds 80%",                           email: true,  sms: false, push: true  },
  { id: "backup_done",    label: "Backup Completed",           desc: "When automatic database backup finishes",               email: false, sms: false, push: false },
  { id: "backup_fail",    label: "Backup Failed",              desc: "When automatic database backup fails",                  email: true,  sms: true,  push: true  },
  { id: "api_limit",      label: "API Rate Limit Hit",         desc: "When an API key exceeds its rate limit",                email: false, sms: false, push: true  },
  { id: "system_update",  label: "System Update Available",    desc: "When a new platform version is available",              email: true,  sms: false, push: false },
];

const CHANNELS = [
  { key: "email" as const, icon: Mail, label: "Email" },
  { key: "sms" as const, icon: MessageSquare, label: "SMS" },
  { key: "push" as const, icon: Zap, label: "In-App" },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
}

export default function SuperAdminNotifications() {
  const [rules, setRules] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [globalEmail, setGlobalEmail] = useState(true);
  const [globalSms, setGlobalSms] = useState(true);
  const [alerts, setAlerts] = useState<CapacityAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsRefreshing, setAlertsRefreshing] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [workingAlertId, setWorkingAlertId] = useState<number | null>(null);

  const toggle = (id: string, channel: "email" | "sms" | "push") =>
    setRules(r => r.map(rule => rule.id === id ? { ...rule, [channel]: !rule[channel] } : rule));

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  const getToken = () => localStorage.getItem("ochola_superadmin_token") || "";
  const loadAlerts = useCallback(async (quiet = false) => {
    if (quiet) setAlertsRefreshing(true);
    else setAlertsLoading(true);
    setAlertsError("");
    try {
      const response = await fetch("/api/super-admin/storage/notifications", { headers: { "x-sa-token": getToken() } });
      const body = await response.json() as { ok?: boolean; error?: string; notifications?: CapacityAlert[]; unreadCount?: number };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not load capacity alerts.");
      const nextAlerts = body.notifications ?? [];
      setAlerts(nextAlerts);
      setUnreadCount(body.unreadCount ?? nextAlerts.filter(alert => alert.read_at === null).length);
    } catch (cause) {
      setAlertsError(cause instanceof Error ? cause.message : "Could not load capacity alerts.");
    } finally {
      setAlertsLoading(false);
      setAlertsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
    const refresh = window.setInterval(() => void loadAlerts(true), 30_000);
    return () => window.clearInterval(refresh);
  }, [loadAlerts]);

  const unreadAlerts = useMemo(() => alerts.filter(alert => alert.read_at === null), [alerts]);

  const markAlertRead = async (id: number) => {
    setWorkingAlertId(id);
    try {
      const response = await fetch(`/api/super-admin/storage/notifications/${id}/read`, {
        method: "POST",
        headers: { "x-sa-token": getToken() },
      });
      const body = await response.json() as { ok?: boolean; error?: string; notification?: CapacityAlert };
      if (!response.ok || !body.ok || !body.notification) throw new Error(body.error || "Could not acknowledge the capacity alert.");
      setAlerts(current => current.map(alert => alert.id === id ? body.notification! : alert));
      setUnreadCount(count => Math.max(0, count - 1));
    } catch (cause) {
      setAlertsError(cause instanceof Error ? cause.message : "Could not acknowledge the capacity alert.");
    } finally {
      setWorkingAlertId(null);
    }
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 900 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Notifications</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Control which events trigger alerts and how they're delivered.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save"}
          </button>
        </div>

        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
            <div>
              <h2 style={{ color: "white", fontSize: "0.95rem", margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Bell size={16} color={C.accent} /> Capacity alerts</h2>
              <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.72rem" }}>Persistent storage warnings from current, available tenant measurements.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ color: unreadCount > 0 ? C.amber : C.green, background: unreadCount > 0 ? "rgba(251,191,36,0.1)" : "rgba(74,222,128,0.1)", border: `1px solid ${unreadCount > 0 ? "rgba(251,191,36,0.25)" : "rgba(74,222,128,0.25)"}`, borderRadius: 999, padding: "5px 9px", fontSize: 10, fontWeight: 800 }}>{unreadCount} unread</span>
              <button onClick={() => void loadAlerts(true)} disabled={alertsRefreshing} aria-label="Refresh capacity alerts" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.sub, padding: "7px 9px", fontSize: 11, cursor: alertsRefreshing ? "not-allowed" : "pointer" }}><RefreshCw size={12} style={{ animation: alertsRefreshing ? "spin 1s linear infinite" : "none" }} /> Refresh</button>
            </div>
          </div>
          {alertsError && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, color: "#f87171", padding: "9px 11px", fontSize: 11, marginBottom: 12 }}>{alertsError}</div>}
          {alertsLoading ? (
            <div style={{ color: C.muted, padding: 26, textAlign: "center", fontSize: 11 }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Loading capacity alerts…</div>
          ) : alerts.length === 0 ? (
            <div style={{ background: "rgba(0,0,0,0.14)", border: `1px dashed ${C.border}`, borderRadius: 9, padding: "20px 14px", color: C.muted, fontSize: 11, textAlign: "center" }}>No capacity alerts have been recorded.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {alerts.map(alert => {
                const warning = alert.notification_type === "storage_capacity_warning";
                const unread = alert.read_at === null;
                return (
                  <article key={alert.id} style={{ background: "rgba(0,0,0,0.14)", border: `1px solid ${unread ? (warning ? "rgba(251,191,36,0.35)" : "rgba(74,222,128,0.3)") : C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div className="capacity-alert-meta" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: warning ? "rgba(251,191,36,0.1)" : "rgba(74,222,128,0.1)", display: "grid", placeItems: "center", flexShrink: 0 }}><AlertTriangle size={15} color={warning ? C.amber : C.green} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ color: warning ? C.amber : C.green, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{warning ? "Capacity warning" : "Warning cleared"}</span>
                          {!unread && <span style={{ color: C.muted, fontSize: 9, textTransform: "uppercase" }}>Read</span>}
                        </div>
                        <h3 style={{ color: "white", fontSize: 12, margin: "4px 0 0" }}>{alert.title}</h3>
                        <p style={{ color: C.sub, fontSize: 11, lineHeight: 1.5, margin: "4px 0 0" }}>{alert.body}</p>
                      </div>
                      <div className="capacity-alert-action" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
                        <span style={{ color: C.muted, fontSize: 9, whiteSpace: "nowrap" }}>{formatDate(alert.created_at)}</span>
                        {unread && <button onClick={() => void markAlertRead(alert.id)} disabled={workingAlertId === alert.id} style={{ color: C.accent, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", borderRadius: 7, padding: "5px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>{workingAlertId === alert.id ? "Saving…" : "Mark read"}</button>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {unreadAlerts.length > 0 && <p style={{ color: C.muted, fontSize: 10, margin: "12px 0 0" }}>Unread count reflects alerts that have not been acknowledged. Marking an alert read never clears the underlying active storage warning.</p>}
        </section>

        {/* Global toggles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Email Notifications", sub: "Send event alerts via email", on: globalEmail, set: setGlobalEmail, icon: Mail },
            { label: "SMS Notifications", sub: "Send event alerts via SMS", on: globalSms, set: setGlobalSms, icon: MessageSquare },
          ].map(g => (
            <div key={g.label} style={{ background: C.card, border: `1px solid ${g.on ? "var(--isp-accent-border)" : C.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: g.on ? "var(--isp-accent-glow)" : "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <g.icon size={16} color={g.on ? C.accent : C.muted} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, color: "white", fontSize: "0.85rem", margin: 0 }}>{g.label}</p>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{g.sub}</p>
              </div>
              <Toggle on={g.on} onChange={g.set} />
            </div>
          ))}
        </div>

        {/* Rules table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={14} color={C.accent} />
            <span style={{ fontWeight: 700, color: "white", fontSize: "0.88rem" }}>Event Rules</span>
            <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: C.muted }}>Toggle delivery channel per event</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ textAlign: "left", padding: "10px 24px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Event</th>
                {CHANNELS.map(ch => (
                  <th key={ch.key} style={{ textAlign: "center", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <ch.icon size={12} /> {ch.label}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "13px 24px" }}>
                    <p style={{ fontWeight: 600, color: "white", margin: 0, fontSize: "0.82rem" }}>{rule.label}</p>
                    <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{rule.desc}</p>
                  </td>
                  {CHANNELS.map(ch => (
                    <td key={ch.key} style={{ textAlign: "center", padding: "13px 16px" }}>
                      <Toggle on={rule[ch.key]} onChange={() => toggle(rule.id, ch.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@media(max-width:620px){.capacity-alert-meta{flex-direction:column!important;align-items:flex-start!important}.capacity-alert-action{align-items:flex-start!important}}`}</style>
    </SuperAdminLayout>
  );
}
