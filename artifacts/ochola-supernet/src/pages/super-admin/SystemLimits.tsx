import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Gauge, Save, CheckCircle2, Users, Router, FileText, Zap, Database, HardDrive } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", fontFamily: "inherit" };

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={15} color={C.accent} />
        <span style={{ fontWeight: 700, color: "white", fontSize: "0.88rem" }}>{title}</span>
      </div>
      <div style={{ padding: "4px 0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function LimitRow({ label, hint, value, onChange, unit }: { label: string; hint?: string; value: string; onChange: (v: string) => void; unit?: string }) {
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <td style={{ padding: "14px 24px", width: "55%" }}>
        <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "#e2e8f0", margin: 0 }}>{label}</p>
        {hint && <p style={{ fontSize: "0.68rem", color: C.muted, margin: "2px 0 0" }}>{hint}</p>}
      </td>
      <td style={{ padding: "14px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, width: 100 }} />
          {unit && <span style={{ fontSize: "0.78rem", color: C.sub }}>{unit}</span>}
          {value === "0" && <span style={{ fontSize: "0.7rem", color: "#fbbf24", fontWeight: 600 }}>Unlimited</span>}
        </div>
      </td>
    </tr>
  );
}

export default function SuperAdminSystemLimits() {
  const [limits, setLimits] = useState({
    maxAdmins: "100", maxSubAdmins: "10", maxResellers: "50",
    maxRoutersPerAdmin: "20", maxCustomersPerAdmin: "1000", maxVouchersPerBatch: "500",
    maxPlansPerAdmin: "50", maxApiKeysPerAdmin: "5",
    apiRateLimit: "1000", apiRateLimitWindow: "60",
    maxFileUploadMb: "10", maxBackupRetentionDays: "30",
    maxLogRetentionDays: "90",
    trialDays: "14", maxTrialAdmins: "10",
    minPasswordLength: "8", sessionTimeoutMins: "60",
    maxFailedLogins: "5", lockoutMins: "15",
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof limits, v: string) => { setLimits(l => ({ ...l, [k]: v })); setSaved(false); };
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>System Limits</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Set platform-wide quotas and rate limits. Enter 0 for unlimited.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save Limits"}
          </button>
        </div>

        <Section title="ISP Admin Quotas" icon={Users}>
          <LimitRow label="Max ISP Admins" hint="Total admins across the platform" value={limits.maxAdmins} onChange={v => set("maxAdmins", v)} />
          <LimitRow label="Max Sub-Admins per ISP" value={limits.maxSubAdmins} onChange={v => set("maxSubAdmins", v)} />
          <LimitRow label="Max Resellers per ISP" value={limits.maxResellers} onChange={v => set("maxResellers", v)} />
        </Section>

        <Section title="Resource Limits per Admin" icon={Router}>
          <LimitRow label="Max Routers per Admin" value={limits.maxRoutersPerAdmin} onChange={v => set("maxRoutersPerAdmin", v)} />
          <LimitRow label="Max Customers per Admin" value={limits.maxCustomersPerAdmin} onChange={v => set("maxCustomersPerAdmin", v)} />
          <LimitRow label="Max Plans per Admin" value={limits.maxPlansPerAdmin} onChange={v => set("maxPlansPerAdmin", v)} />
          <LimitRow label="Max Vouchers per Batch" hint="Single voucher generation batch size" value={limits.maxVouchersPerBatch} onChange={v => set("maxVouchersPerBatch", v)} />
          <LimitRow label="Max API Keys per Admin" value={limits.maxApiKeysPerAdmin} onChange={v => set("maxApiKeysPerAdmin", v)} />
        </Section>

        <Section title="API Rate Limits" icon={Zap}>
          <LimitRow label="Requests per Window" hint="Max API requests per time window" value={limits.apiRateLimit} onChange={v => set("apiRateLimit", v)} unit="requests" />
          <LimitRow label="Rate Limit Window" hint="Duration of the rate limit window" value={limits.apiRateLimitWindow} onChange={v => set("apiRateLimitWindow", v)} unit="seconds" />
        </Section>

        <Section title="Storage & Retention" icon={HardDrive}>
          <LimitRow label="Max File Upload Size" value={limits.maxFileUploadMb} onChange={v => set("maxFileUploadMb", v)} unit="MB" />
          <LimitRow label="Backup Retention" value={limits.maxBackupRetentionDays} onChange={v => set("maxBackupRetentionDays", v)} unit="days" />
          <LimitRow label="Log Retention" value={limits.maxLogRetentionDays} onChange={v => set("maxLogRetentionDays", v)} unit="days" />
        </Section>

        <Section title="Trial & Onboarding" icon={FileText}>
          <LimitRow label="Trial Period" hint="Free trial duration for new ISP signups" value={limits.trialDays} onChange={v => set("trialDays", v)} unit="days" />
          <LimitRow label="Max Trial Admins at Once" value={limits.maxTrialAdmins} onChange={v => set("maxTrialAdmins", v)} />
        </Section>

        <Section title="Security" icon={Gauge}>
          <LimitRow label="Minimum Password Length" value={limits.minPasswordLength} onChange={v => set("minPasswordLength", v)} unit="chars" />
          <LimitRow label="Session Timeout" value={limits.sessionTimeoutMins} onChange={v => set("sessionTimeoutMins", v)} unit="minutes" />
          <LimitRow label="Max Failed Logins" hint="Before account is temporarily locked" value={limits.maxFailedLogins} onChange={v => set("maxFailedLogins", v)} />
          <LimitRow label="Lockout Duration" value={limits.lockoutMins} onChange={v => set("lockoutMins", v)} unit="minutes" />
        </Section>
      </div>
    </SuperAdminLayout>
  );
}
