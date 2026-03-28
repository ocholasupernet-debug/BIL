import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Bell, Save, CheckCircle2, Mail, MessageSquare, Zap, AlertTriangle } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

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

export default function SuperAdminNotifications() {
  const [rules, setRules] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [globalEmail, setGlobalEmail] = useState(true);
  const [globalSms, setGlobalSms] = useState(true);

  const toggle = (id: string, channel: "email" | "sms" | "push") =>
    setRules(r => r.map(rule => rule.id === id ? { ...rule, [channel]: !rule[channel] } : rule));

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

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

        {/* Global toggles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Email Notifications", sub: "Send event alerts via email", on: globalEmail, set: setGlobalEmail, icon: Mail },
            { label: "SMS Notifications", sub: "Send event alerts via SMS", on: globalSms, set: setGlobalSms, icon: MessageSquare },
          ].map(g => (
            <div key={g.label} style={{ background: C.card, border: `1px solid ${g.on ? "rgba(99,102,241,0.3)" : C.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: g.on ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
    </SuperAdminLayout>
  );
}
