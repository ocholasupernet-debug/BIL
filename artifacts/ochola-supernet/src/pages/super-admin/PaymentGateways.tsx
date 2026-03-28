import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { CreditCard, Save, CheckCircle2, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 42, height: 22, borderRadius: 11, background: on ? "#6366f1" : "rgba(255,255,255,0.1)", border: "none", cursor: "pointer", position: "relative", padding: 0, flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: "0.67rem", color: C.muted, margin: "3px 0 0" }}>{hint}</p>}
    </div>
  );
}

function SecretField({ value, onChange, label, hint }: { value: string; onChange: (v: string) => void; label: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div style={{ position: "relative" }}>
        <input type={show ? "text" : "password"} style={{ ...inp, paddingRight: 36 }} value={value} onChange={e => onChange(e.target.value)} placeholder="••••••••••••••••" />
        <button onClick={() => setShow(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </Field>
  );
}

interface GwConfig { enabled: boolean; sandbox: boolean; [key: string]: string | boolean; }

const GATEWAYS: { id: string; name: string; logo: string; color: string; fields: { key: string; label: string; hint?: string }[] }[] = [
  { id: "mpesa", name: "M-Pesa (Safaricom Daraja)", logo: "🟢", color: "#00a651",
    fields: [
      { key: "consumerKey", label: "Consumer Key" }, { key: "consumerSecret", label: "Consumer Secret" },
      { key: "shortCode", label: "Business Short Code", hint: "Till number or Paybill" },
      { key: "passKey", label: "Lipa Na M-Pesa Passkey" },
      { key: "callbackUrl", label: "Callback URL", hint: "e.g. https://api.isplatty.org/mpesa/callback" },
    ],
  },
  { id: "stripe", name: "Stripe", logo: "💳", color: "#635bff",
    fields: [
      { key: "publishableKey", label: "Publishable Key" }, { key: "secretKey", label: "Secret Key" },
      { key: "webhookSecret", label: "Webhook Secret" },
    ],
  },
  { id: "flutterwave", name: "Flutterwave", logo: "🦋", color: "#f5a623",
    fields: [
      { key: "publicKey", label: "Public Key" }, { key: "secretKey", label: "Secret Key" },
      { key: "encryptionKey", label: "Encryption Key" },
    ],
  },
  { id: "paystack", name: "Paystack", logo: "🅿️", color: "#00c3f7",
    fields: [
      { key: "publicKey", label: "Public Key" }, { key: "secretKey", label: "Secret Key" },
    ],
  },
  { id: "manual", name: "Manual / Bank Transfer", logo: "🏦", color: "#64748b",
    fields: [
      { key: "bankName", label: "Bank Name" }, { key: "accountName", label: "Account Name" },
      { key: "accountNumber", label: "Account Number" }, { key: "branchCode", label: "Branch Code" },
      { key: "paymentInstructions", label: "Payment Instructions" },
    ],
  },
];

export default function SuperAdminPaymentGateways() {
  const [configs, setConfigs] = useState<Record<string, GwConfig>>(
    Object.fromEntries(GATEWAYS.map(gw => [gw.id, { enabled: gw.id === "mpesa", sandbox: true, ...Object.fromEntries(gw.fields.map(f => [f.key, ""])) }]))
  );
  const [expanded, setExpanded] = useState<string>("mpesa");
  const [saved, setSaved] = useState(false);

  const setField = (gw: string, k: string, v: string | boolean) =>
    setConfigs(c => ({ ...c, [gw]: { ...c[gw], [k]: v } }));

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 800 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Payment Gateways</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Configure payment integrations available to all ISP admins.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save All"}
          </button>
        </div>

        {GATEWAYS.map(gw => {
          const cfg = configs[gw.id] ?? {};
          const open = expanded === gw.id;
          return (
            <div key={gw.id} style={{ background: C.card, border: `1px solid ${cfg.enabled ? "rgba(99,102,241,0.3)" : C.border}`, borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
              <div
                style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                onClick={() => setExpanded(open ? "" : gw.id)}
              >
                <span style={{ fontSize: "1.2rem" }}>{gw.logo}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem" }}>{gw.name}</span>
                  {cfg.enabled && <span style={{ marginLeft: 8, fontSize: "0.65rem", background: "rgba(74,222,128,0.12)", color: "#4ade80", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>Enabled</span>}
                  {cfg.enabled && cfg.sandbox && <span style={{ marginLeft: 6, fontSize: "0.65rem", background: "rgba(251,191,36,0.12)", color: "#fbbf24", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>Sandbox</span>}
                </div>
                <Toggle on={!!cfg.enabled} onChange={v => setField(gw.id, "enabled", v)} />
                {open ? <ChevronUp size={16} color={C.muted} /> : <ChevronDown size={16} color={C.muted} />}
              </div>

              {open && (
                <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
                    <span style={{ fontSize: "0.78rem", color: C.sub }}>Sandbox / Test Mode</span>
                    <Toggle on={!!cfg.sandbox} onChange={v => setField(gw.id, "sandbox", v)} />
                    {cfg.sandbox && <span style={{ fontSize: "0.7rem", color: "#fbbf24" }}>No real transactions will occur</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                    {gw.fields.map(f => (
                      <SecretField key={f.key} value={(cfg[f.key] as string) || ""} onChange={v => setField(gw.id, f.key, v)} label={f.label} hint={f.hint} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SuperAdminLayout>
  );
}
