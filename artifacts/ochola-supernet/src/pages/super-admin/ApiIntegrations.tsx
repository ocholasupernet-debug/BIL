import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Plug, Plus, Copy, Trash2, CheckCircle2, Eye, EyeOff, RefreshCw, X, Globe, Zap, CheckCircle } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

interface ApiKey { id: number; name: string; key: string; scope: string; createdAt: string; lastUsed: string; active: boolean; }

const genKey = () => `sk_live_${Math.random().toString(36).slice(2,12)}${Math.random().toString(36).slice(2,12)}`;

const INIT_KEYS: ApiKey[] = [
  { id: 1, name: "Production API",       key: `sk_live_3a8xk2mn7q9pzr4t`, scope: "read,write",  createdAt: "Mar 1, 2026",  lastUsed: "2 min ago",    active: true  },
  { id: 2, name: "Router Sync Service",  key: `sk_live_7b2lp5nk4r8mzw6s`, scope: "routers",     createdAt: "Feb 14, 2026", lastUsed: "5 min ago",    active: true  },
  { id: 3, name: "Billing Webhook",      key: `sk_live_9c1mp3yk5s7nxv2t`, scope: "billing",     createdAt: "Jan 22, 2026", lastUsed: "Yesterday",    active: true  },
  { id: 4, name: "Monitoring Script",    key: `sk_live_2d4kp8lj3n5mxr1w`, scope: "read",        createdAt: "Jan 10, 2026", lastUsed: "1 week ago",   active: false },
];

const INTEGRATIONS = [
  { name: "FreeRADIUS", desc: "Authentication & accounting for hotspot and PPPoE", status: "connected", color: "#4ade80" },
  { name: "M-Pesa Daraja", desc: "STK Push and payment notifications", status: "connected", color: "#4ade80" },
  { name: "Africa's Talking", desc: "SMS gateway for alerts and OTPs", status: "connected", color: "#4ade80" },
  { name: "Supabase", desc: "Primary PostgreSQL database backend", status: "connected", color: "#4ade80" },
  { name: "Slack", desc: "Operational alerts and incident notifications", status: "disconnected", color: "#f87171" },
  { name: "Stripe", desc: "Card payments for international customers", status: "disconnected", color: "#f87171" },
  { name: "AWS S3", desc: "Backup storage and file hosting", status: "configured", color: "#fbbf24" },
  { name: "SendGrid", desc: "Transactional email delivery", status: "configured", color: "#fbbf24" },
];

const WEBHOOKS = [
  { id: 1, event: "payment.success",  url: "https://api.isplatty.org/hooks/payment", active: true,  lastTriggered: "Today 09:14" },
  { id: 2, event: "admin.suspended",  url: "https://api.isplatty.org/hooks/suspend", active: true,  lastTriggered: "Mar 27 15:00" },
  { id: 3, event: "router.offline",   url: "https://monitoring.isplatty.org/hook",   active: false, lastTriggered: "Mar 24 11:30" },
];

export default function SuperAdminApiIntegrations() {
  const [keys, setKeys] = useState(INIT_KEYS);
  const [showKey, setShowKey] = useState<Record<number, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("read,write");
  const [copied, setCopied] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const copyKey = (key: string, id: number) => {
    navigator.clipboard.writeText(key);
    setCopied(id); setTimeout(() => setCopied(null), 2000);
    showToast("API key copied");
  };

  const deleteKey = (id: number) => { setKeys(k => k.filter(x => x.id !== id)); showToast("API key deleted"); };

  const addKey = () => {
    if (!newKeyName) return;
    setKeys(k => [...k, { id: Date.now(), name: newKeyName, key: genKey(), scope: newKeyScope, createdAt: "Today", lastUsed: "Never", active: true }]);
    setShowAdd(false); setNewKeyName(""); setNewKeyScope("read,write");
    showToast("New API key created");
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1000 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>API & Integrations</h1>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Manage API keys, connected services, and webhook endpoints.</p>
        </div>

        {/* API Keys */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 7 }}><Plug size={15} color={C.accent} /> API Keys</span>
            <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: C.accent, border: "none", borderRadius: 9, padding: "8px 16px", color: "white", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>
              <Plus size={13} /> New Key
            </button>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Name", "API Key", "Scope", "Last Used", "Status", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "13px 16px", fontWeight: 700, color: "white" }}>{k.name}</td>
                    <td style={{ padding: "13px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ fontFamily: "monospace", fontSize: "0.72rem", color: C.sub, background: "rgba(255,255,255,0.04)", padding: "3px 8px", borderRadius: 5 }}>
                          {showKey[k.id] ? k.key : `${k.key.slice(0,12)}••••••••••`}
                        </code>
                        <button onClick={() => setShowKey(s => ({ ...s, [k.id]: !s[k.id] }))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 2 }}>
                          {showKey[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <button onClick={() => copyKey(k.key, k.id)} style={{ background: "none", border: "none", color: copied === k.id ? "#4ade80" : C.muted, cursor: "pointer", padding: 2 }}>
                          {copied === k.id ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <span style={{ background: "var(--isp-accent-glow)", color: "#a5b4fc", padding: "2px 7px", borderRadius: 6, fontSize: "0.67rem", fontWeight: 700, fontFamily: "monospace" }}>{k.scope}</span>
                    </td>
                    <td style={{ padding: "13px 16px", fontSize: "0.72rem", color: C.muted }}>{k.lastUsed}</td>
                    <td style={{ padding: "13px 16px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: "0.67rem", fontWeight: 700, background: k.active ? "rgba(74,222,128,0.1)" : "rgba(100,116,139,0.15)", color: k.active ? "#4ade80" : "#94a3b8" }}>{k.active ? "Active" : "Disabled"}</span>
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <button onClick={() => deleteKey(k.id)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 7, padding: "5px 10px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", fontWeight: 600 }}>
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Integrations */}
        <div style={{ marginBottom: 28 }}>
          <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}><Globe size={15} color={C.accent} /> Connected Services</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {INTEGRATIONS.map(i => (
              <div key={i.name} style={{ background: C.card, border: `1px solid ${i.status === "connected" ? "rgba(74,222,128,0.15)" : i.status === "configured" ? "rgba(251,191,36,0.15)" : C.border}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: "white", fontSize: "0.82rem" }}>{i.name}</span>
                  <span style={{ fontSize: "0.65rem", fontWeight: 700, color: i.color }}>{i.status}</span>
                </div>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: 0, lineHeight: 1.4 }}>{i.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Webhooks */}
        <div>
          <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}><Zap size={15} color={C.accent} /> Webhook Endpoints</span>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Event", "Endpoint URL", "Last Triggered", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.63rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {WEBHOOKS.map(w => (
                  <tr key={w.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "13px 16px", fontFamily: "monospace", color: "#c4b5fd", fontSize: "0.75rem" }}>{w.event}</td>
                    <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.72rem", color: C.sub }}>{w.url}</td>
                    <td style={{ padding: "13px 16px", fontSize: "0.72rem", color: C.muted }}>{w.lastTriggered}</td>
                    <td style={{ padding: "13px 16px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: "0.67rem", fontWeight: 700, background: w.active ? "rgba(74,222,128,0.1)" : "rgba(100,116,139,0.15)", color: w.active ? "#4ade80" : "#94a3b8" }}>{w.active ? "Active" : "Paused"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Key Modal */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#0f1629", border: "1px solid var(--isp-accent-glow)", borderRadius: 16, width: "100%", maxWidth: 420 }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, color: "white" }}>Create API Key</span>
              <button onClick={() => setShowAdd(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Key Name</label>
                <input style={inp} value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="e.g. Production API" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Scope</label>
                <select style={inp} value={newKeyScope} onChange={e => setNewKeyScope(e.target.value)}>
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="read,write">read, write</option>
                  <option value="billing">billing</option>
                  <option value="routers">routers</option>
                  <option value="admin">admin (full)</option>
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setShowAdd(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>Cancel</button>
                <button onClick={addKey} disabled={!newKeyName} style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", opacity: !newKeyName ? 0.5 : 1 }}>Generate Key</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#022c22", border: "1px solid #4ade80", borderRadius: 10, padding: "12px 20px", color: "#4ade80", fontWeight: 600, fontSize: "0.82rem", zIndex: 300 }}>
          {toast}
        </div>
      )}
    </SuperAdminLayout>
  );
}
