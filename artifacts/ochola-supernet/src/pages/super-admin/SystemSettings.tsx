import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Settings, Save, CheckCircle2, Globe, Mail, Server, Shield, Sliders } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={15} color={C.accent} />
        <span style={{ fontWeight: 700, color: "white", fontSize: "0.88rem" }}>{title}</span>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: "0.68rem", color: C.muted, margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: "0.82rem", color: C.sub }}>{label}</span>
      <button onClick={() => onChange(!on)} style={{ width: 42, height: 22, borderRadius: 11, background: on ? C.accent : "rgba(255,255,255,0.1)", border: "none", cursor: "pointer", position: "relative", padding: 0, transition: "background 0.2s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </button>
    </div>
  );
}

export default function SuperAdminSystemSettings() {
  const [cfg, setCfg] = useState({
    platformName: "ISP Management Platform",
    domain: "isplatty.org",
    adminEmail: "admin@isplatty.org",
    supportEmail: "support@isplatty.org",
    smtpHost: "smtp.gmail.com",
    smtpPort: "587",
    smtpUser: "noreply@isplatty.org",
    smtpPass: "",
    radiusHost: "127.0.0.1",
    radiusPort: "1812",
    radiusSecret: "",
    smsApiKey: "",
    smsProvider: "AfricasTalking",
    taxRate: "16",
    currency: "KES",
    timezone: "Africa/Nairobi",
    dateFormat: "DD/MM/YYYY",
    maintenanceMode: false,
    registrationOpen: true,
    emailVerification: false,
    smsNotifications: true,
    autoSuspend: true,
    darkModeDefault: true,
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof cfg, v: string | boolean) => { setCfg(f => ({ ...f, [k]: v })); setSaved(false); };
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>System Settings</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Global platform configuration for all ISPs.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save Settings"}
          </button>
        </div>

        {/* Platform */}
        <Card title="Platform Identity" icon={Globe}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Platform Name"><input style={inp} value={cfg.platformName} onChange={e => set("platformName", e.target.value)} /></Field>
            <Field label="Primary Domain"><input style={inp} value={cfg.domain} onChange={e => set("domain", e.target.value)} /></Field>
            <Field label="Admin Email"><input style={inp} type="email" value={cfg.adminEmail} onChange={e => set("adminEmail", e.target.value)} /></Field>
            <Field label="Support Email"><input style={inp} type="email" value={cfg.supportEmail} onChange={e => set("supportEmail", e.target.value)} /></Field>
            <Field label="Default Currency">
              <select style={inp} value={cfg.currency} onChange={e => set("currency", e.target.value)}>
                <option value="KES">KES — Kenyan Shilling</option>
                <option value="USD">USD — US Dollar</option>
                <option value="UGX">UGX — Ugandan Shilling</option>
                <option value="TZS">TZS — Tanzanian Shilling</option>
              </select>
            </Field>
            <Field label="Tax / VAT Rate (%)"><input style={inp} type="number" value={cfg.taxRate} onChange={e => set("taxRate", e.target.value)} /></Field>
            <Field label="Timezone">
              <select style={inp} value={cfg.timezone} onChange={e => set("timezone", e.target.value)}>
                <option value="Africa/Nairobi">Africa/Nairobi (EAT +3)</option>
                <option value="Africa/Lagos">Africa/Lagos (WAT +1)</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <Field label="Date Format">
              <select style={inp} value={cfg.dateFormat} onChange={e => set("dateFormat", e.target.value)}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* SMTP */}
        <Card title="Email (SMTP)" icon={Mail}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="SMTP Host"><input style={inp} value={cfg.smtpHost} onChange={e => set("smtpHost", e.target.value)} /></Field>
            <Field label="SMTP Port"><input style={inp} value={cfg.smtpPort} onChange={e => set("smtpPort", e.target.value)} /></Field>
            <Field label="SMTP Username"><input style={inp} value={cfg.smtpUser} onChange={e => set("smtpUser", e.target.value)} /></Field>
            <Field label="SMTP Password"><input style={inp} type="password" value={cfg.smtpPass} onChange={e => set("smtpPass", e.target.value)} placeholder="••••••••" /></Field>
          </div>
        </Card>

        {/* RADIUS */}
        <Card title="RADIUS Server" icon={Server}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="RADIUS Host" hint="IP address of your FreeRADIUS server"><input style={inp} value={cfg.radiusHost} onChange={e => set("radiusHost", e.target.value)} /></Field>
            <Field label="RADIUS Port"><input style={inp} value={cfg.radiusPort} onChange={e => set("radiusPort", e.target.value)} /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="RADIUS Secret"><input style={inp} type="password" value={cfg.radiusSecret} onChange={e => set("radiusSecret", e.target.value)} placeholder="Shared secret" /></Field>
            </div>
          </div>
        </Card>

        {/* SMS */}
        <Card title="SMS Provider" icon={Sliders}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="SMS Provider">
              <select style={inp} value={cfg.smsProvider} onChange={e => set("smsProvider", e.target.value)}>
                <option value="AfricasTalking">Africa's Talking</option>
                <option value="Twilio">Twilio</option>
                <option value="Nexmo">Vonage / Nexmo</option>
                <option value="Custom">Custom API</option>
              </select>
            </Field>
            <Field label="API Key"><input style={inp} type="password" value={cfg.smsApiKey} onChange={e => set("smsApiKey", e.target.value)} placeholder="••••••••••" /></Field>
          </div>
        </Card>

        {/* Flags */}
        <Card title="Platform Flags" icon={Shield}>
          <Toggle on={cfg.maintenanceMode} onChange={v => set("maintenanceMode", v)} label="Maintenance Mode (locks out all ISP admins)" />
          <Toggle on={cfg.registrationOpen} onChange={v => set("registrationOpen", v)} label="Open ISP Registration (allow new signups)" />
          <Toggle on={cfg.emailVerification} onChange={v => set("emailVerification", v)} label="Require Email Verification on Signup" />
          <Toggle on={cfg.smsNotifications} onChange={v => set("smsNotifications", v)} label="SMS Notifications Enabled" />
          <Toggle on={cfg.autoSuspend} onChange={v => set("autoSuspend", v)} label="Auto-Suspend overdue ISP accounts" />
          <Toggle on={cfg.darkModeDefault} onChange={v => set("darkModeDefault", v)} label="Dark Mode as Default Theme" />
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
