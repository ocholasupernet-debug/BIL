import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  MessageSquare, Mail, Phone, Send, Save, Eye,
  X, Check, Copy, Info,
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  event: string;
  channels: ("sms" | "whatsapp" | "email" | "telegram")[];
  subject?: string;
  body: string;
  enabled: boolean;
}

const VARIABLES = [
  { var: "[[name]]", desc: "Customer full name" },
  { var: "[[username]]", desc: "Login username" },
  { var: "[[plan]]", desc: "Plan/package name" },
  { var: "[[price]]", desc: "Plan price (formatted)" },
  { var: "[[expired_date]]", desc: "Expiration date & time" },
  { var: "[[bills]]", desc: "Additional bills & total breakdown" },
  { var: "[[payment_link]]", desc: "One-click payment URL" },
  { var: "[[balance]]", desc: "Current wallet balance" },
  { var: "[[company]]", desc: "ISP company name" },
  { var: "[[invoice]]", desc: "Invoice number" },
];

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "t1",
    name: "Plan Activation",
    event: "customer_activated",
    channels: ["sms", "whatsapp"],
    body: "Hello [[name]], your internet plan [[plan]] has been activated. Enjoy browsing! Your plan expires on [[expired_date]]. - [[company]]",
    enabled: true,
  },
  {
    id: "t2",
    name: "Expiry Reminder",
    event: "plan_expiring",
    channels: ["sms", "whatsapp", "email"],
    subject: "Your [[plan]] plan is expiring soon",
    body: "Dear [[name]], your internet plan [[plan]] (KES [[price]]) will expire on [[expired_date]]. Renew now to avoid disconnection: [[payment_link]]\n\n[[bills]]\n\n- [[company]]",
    enabled: true,
  },
  {
    id: "t3",
    name: "Payment Confirmation",
    event: "payment_received",
    channels: ["sms"],
    body: "Payment of KES [[price]] received for [[plan]]. Thank you [[name]]! Your new expiry date is [[expired_date]]. - [[company]]",
    enabled: true,
  },
  {
    id: "t4",
    name: "Invoice",
    event: "invoice_generated",
    channels: ["email"],
    subject: "Invoice [[invoice]] - [[company]]",
    body: "Dear [[name]],\n\nPlease find your invoice [[invoice]] for the internet service plan [[plan]].\n\n[[bills]]\n\nPay online: [[payment_link]]\n\nRegards,\n[[company]]",
    enabled: true,
  },
  {
    id: "t5",
    name: "Balance Top-Up",
    event: "balance_topup",
    channels: ["sms", "whatsapp"],
    body: "Hi [[name]], your account has been credited. New balance: KES [[balance]]. Thank you! - [[company]]",
    enabled: false,
  },
  {
    id: "t6",
    name: "Service Disconnection",
    event: "service_disconnected",
    channels: ["sms"],
    body: "Dear [[name]], your plan [[plan]] has expired and service has been disconnected. Renew at [[payment_link]] to reconnect. - [[company]]",
    enabled: true,
  },
];

const CHANNEL_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  sms:      { label: "SMS",      color: "var(--isp-accent)", icon: <Phone size={11} /> },
  whatsapp: { label: "WhatsApp", color: "#25d366", icon: <MessageSquare size={11} /> },
  email:    { label: "Email",    color: "#f59e0b", icon: <Mail size={11} /> },
  telegram: { label: "Telegram", color: "#0088cc", icon: <Send size={11} /> },
};

function TemplateEditor({ template, onClose, onSave }: { template: Template; onClose: () => void; onSave: (t: Template) => void }) {
  const [form, setForm] = useState<Template>({ ...template });
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const previewBody = form.body
    .replace(/\[\[name\]\]/g, "John Kamau")
    .replace(/\[\[username\]\]/g, "jkamau4521")
    .replace(/\[\[plan\]\]/g, "Gold 10Mbps")
    .replace(/\[\[price\]\]/g, "1,000")
    .replace(/\[\[expired_date\]\]/g, "15 Apr 2026 23:59")
    .replace(/\[\[bills\]\]/g, "Gold 10Mbps: KES 1,000\nVAT: KES 160\nTotal: KES 1,160")
    .replace(/\[\[payment_link\]\]/g, "https://pay.isplatty.org/r/12345")
    .replace(/\[\[balance\]\]/g, "2,500")
    .replace(/\[\[company\]\]/g, "FastNet ISP")
    .replace(/\[\[invoice\]\]/g, "INV-001234");

  const copyVar = (v: string) => {
    navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  const toggleChannel = (ch: "sms" | "whatsapp" | "email" | "telegram") => {
    setForm(f => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter(c => c !== ch)
        : [...f.channels, ch],
    }));
  };

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem", borderRadius: 8,
    background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)",
    color: "var(--isp-text)", fontSize: "0.85rem", fontFamily: "inherit",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--isp-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 800, color: "var(--isp-text)", margin: 0 }}>Edit Template: {form.name}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "6px", cursor: "pointer", color: "var(--isp-text-muted)" }}><X size={16} /></button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Template Name</label>
            <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, textTransform: "uppercase" }}>Channels</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(Object.keys(CHANNEL_META) as ("sms" | "whatsapp" | "email" | "telegram")[]).map(ch => {
                const m = CHANNEL_META[ch];
                const active = form.channels.includes(ch);
                return (
                  <button key={ch} onClick={() => toggleChannel(ch)} style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    background: active ? `${m.color}20` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? m.color + "50" : "var(--isp-border)"}`,
                    color: active ? m.color : "var(--isp-text-muted)",
                  }}>
                    {m.icon} {m.label} {active && <Check size={10} />}
                  </button>
                );
              })}
            </div>
          </div>

          {form.channels.includes("email") && (
            <div>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Email Subject</label>
              <input style={inp} value={form.subject || ""} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Your plan is expiring soon" />
            </div>
          )}

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" }}>Message Body</label>
              <button onClick={() => setShowPreview(!showPreview)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--isp-accent)", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                <Eye size={12} /> {showPreview ? "Hide" : "Show"} Preview
              </button>
            </div>
            <textarea
              style={{ ...inp, minHeight: 120, resize: "vertical" }}
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Type your message template here..."
            />
          </div>

          {showPreview && (
            <div style={{ padding: "1rem", borderRadius: 10, background: "rgba(37,99,235,0.06)", border: "1px solid var(--isp-accent-glow)" }}>
              <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", margin: "0 0 6px" }}>Preview</p>
              <p style={{ fontSize: "0.82rem", color: "var(--isp-text)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{previewBody}</p>
            </div>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Info size={12} style={{ color: "var(--isp-text-muted)" }} />
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" }}>Available Variables (click to copy)</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
              {VARIABLES.map(v => (
                <button key={v.var} onClick={() => copyVar(v.var)} title={v.desc} style={{
                  padding: "3px 8px", borderRadius: 6, fontSize: "0.7rem", fontFamily: "monospace", cursor: "pointer",
                  background: copied === v.var ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${copied === v.var ? "rgba(16,185,129,0.4)" : "var(--isp-border)"}`,
                  color: copied === v.var ? "#34d399" : "var(--isp-text-muted)",
                }}>
                  {copied === v.var ? <Check size={9} /> : <Copy size={9} />} {v.var}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.6rem", borderRadius: 10, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button onClick={() => onSave(form)} style={{ flex: 2, padding: "0.6rem", borderRadius: 10, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Save size={14} /> Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MessageTemplates() {
  const [templates, setTemplates] = useState<Template[]>(DEFAULT_TEMPLATES);
  const [editing, setEditing] = useState<Template | null>(null);

  const handleSave = (t: Template) => {
    setTemplates(prev => prev.map(p => p.id === t.id ? t : p));
    setEditing(null);
  };

  const toggleEnabled = (id: string) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--isp-text)", margin: 0 }}>Message Templates</h1>
          <p style={{ fontSize: "0.82rem", color: "var(--isp-text-muted)", margin: "4px 0 0" }}>
            Customize notification messages sent to customers via SMS, WhatsApp, Email, and Telegram.
            Use variables like <code style={{ background: "rgba(37,99,235,0.1)", padding: "1px 5px", borderRadius: 4, fontSize: "0.75rem", color: "var(--isp-accent)" }}>[[name]]</code> to personalize messages.
          </p>
        </div>

        <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
          {templates.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: i < templates.length - 1 ? "1px solid var(--isp-border)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>{t.name}</p>
                  <span style={{ fontSize: "0.65rem", padding: "2px 8px", borderRadius: 10, background: t.enabled ? "rgba(16,185,129,0.12)" : "rgba(248,113,113,0.12)", color: t.enabled ? "#34d399" : "#f87171", fontWeight: 700 }}>
                    {t.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                <p style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", margin: "0 0 6px", fontStyle: "italic" }}>Event: {t.event.replace(/_/g, " ")}</p>
                <div style={{ display: "flex", gap: 4 }}>
                  {t.channels.map(ch => {
                    const m = CHANNEL_META[ch];
                    return (
                      <span key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 10, background: `${m.color}15`, color: m.color, fontSize: "0.65rem", fontWeight: 700 }}>
                        {m.icon} {m.label}
                      </span>
                    );
                  })}
                </div>
                <p style={{ fontSize: "0.72rem", color: "var(--isp-text-sub)", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 500 }}>
                  {t.body}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button onClick={() => toggleEnabled(t.id)} style={{
                  width: 40, height: 22, borderRadius: 11, cursor: "pointer", border: "none", position: "relative",
                  background: t.enabled ? "var(--isp-accent)" : "rgba(255,255,255,0.1)",
                  transition: "background 0.2s",
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "white",
                    position: "absolute", top: 3, left: t.enabled ? 21 : 3,
                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </button>
                <button onClick={() => setEditing(t)} style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>

        {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
      </div>
    </AdminLayout>
  );
}
