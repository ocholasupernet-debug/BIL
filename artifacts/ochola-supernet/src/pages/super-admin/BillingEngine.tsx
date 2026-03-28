import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Receipt, Save, CheckCircle2, DollarSign, AlertTriangle, Clock, RefreshCw } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
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

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start", paddingBottom: 16, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div>
        <p style={{ fontSize: "0.82rem", fontWeight: 600, color: C.text, margin: 0 }}>{label}</p>
        {hint && <p style={{ fontSize: "0.68rem", color: C.muted, margin: "3px 0 0" }}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 42, height: 22, borderRadius: 11, background: on ? C.accent : "rgba(255,255,255,0.1)", border: "none", cursor: "pointer", position: "relative", padding: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </button>
  );
}

export default function SuperAdminBillingEngine() {
  const [cfg, setCfg] = useState({
    billingCycle: "monthly", gracePeriodDays: "3", lateFee: "50", lateFeeType: "fixed",
    autoInvoice: true, autoSuspend: true, autoResume: true,
    suspendAfterDays: "7", terminateAfterDays: "30",
    invoicePrefix: "INV", invoiceFooter: "Thank you for your business. Please pay within the due date to avoid service interruption.",
    taxLabel: "VAT", taxRate: "16", taxIncluded: false,
    prorationEnabled: true, reminderDays: "3", reminderSms: true, reminderEmail: true,
    commissionRate: "10",
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof cfg, v: string | boolean) => { setCfg(f => ({ ...f, [k]: v })); setSaved(false); };
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 800 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Billing Engine</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Global billing rules applied to all ISP accounts on the platform.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save"}
          </button>
        </div>

        <Section title="Billing Cycle" icon={RefreshCw}>
          <Row label="Default Billing Cycle" hint="How often ISP customers are billed">
            <select style={inp} value={cfg.billingCycle} onChange={e => set("billingCycle", e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Row>
          <Row label="Grace Period" hint="Days before service is suspended after due date">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input style={{ ...inp, width: 80 }} type="number" value={cfg.gracePeriodDays} onChange={e => set("gracePeriodDays", e.target.value)} />
              <span style={{ color: C.sub, fontSize: "0.82rem" }}>days</span>
            </div>
          </Row>
          <Row label="Late Payment Fee" hint="Charge applied after grace period">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input style={{ ...inp, width: 100 }} type="number" value={cfg.lateFee} onChange={e => set("lateFee", e.target.value)} />
              <select style={{ ...inp, width: 120 }} value={cfg.lateFeeType} onChange={e => set("lateFeeType", e.target.value)}>
                <option value="fixed">Fixed (KES)</option>
                <option value="percent">Percentage (%)</option>
              </select>
            </div>
          </Row>
          <Row label="Proration" hint="Charge partial amounts for mid-cycle plan changes">
            <Toggle on={cfg.prorationEnabled} onChange={v => set("prorationEnabled", v)} />
          </Row>
        </Section>

        <Section title="Automation Rules" icon={AlertTriangle}>
          <Row label="Auto-Generate Invoices"><Toggle on={cfg.autoInvoice} onChange={v => set("autoInvoice", v)} /></Row>
          <Row label="Auto-Suspend on Overdue" hint={`Suspends after ${cfg.suspendAfterDays} days unpaid`}><Toggle on={cfg.autoSuspend} onChange={v => set("autoSuspend", v)} /></Row>
          <Row label="Suspend After (days)">
            <input style={{ ...inp, width: 80 }} type="number" value={cfg.suspendAfterDays} onChange={e => set("suspendAfterDays", e.target.value)} />
          </Row>
          <Row label="Auto-Resume on Payment"><Toggle on={cfg.autoResume} onChange={v => set("autoResume", v)} /></Row>
          <Row label="Terminate After (days)" hint="After suspension, permanently terminate">
            <input style={{ ...inp, width: 80 }} type="number" value={cfg.terminateAfterDays} onChange={e => set("terminateAfterDays", e.target.value)} />
          </Row>
        </Section>

        <Section title="Invoice Configuration" icon={Receipt}>
          <Row label="Invoice Number Prefix"><input style={inp} value={cfg.invoicePrefix} onChange={e => set("invoicePrefix", e.target.value)} placeholder="INV" /></Row>
          <Row label="Tax Label"><input style={inp} value={cfg.taxLabel} onChange={e => set("taxLabel", e.target.value)} placeholder="VAT" /></Row>
          <Row label="Tax Rate (%)"><input style={{ ...inp, width: 80 }} type="number" value={cfg.taxRate} onChange={e => set("taxRate", e.target.value)} /></Row>
          <Row label="Tax Included in Price"><Toggle on={cfg.taxIncluded} onChange={v => set("taxIncluded", v)} /></Row>
          <Row label="Invoice Footer Note">
            <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={cfg.invoiceFooter} onChange={e => set("invoiceFooter", e.target.value)} />
          </Row>
        </Section>

        <Section title="Reminders & Commissions" icon={Clock}>
          <Row label="Payment Reminder (days before due)">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input style={{ ...inp, width: 80 }} type="number" value={cfg.reminderDays} onChange={e => set("reminderDays", e.target.value)} />
              <span style={{ color: C.sub, fontSize: "0.82rem" }}>days</span>
            </div>
          </Row>
          <Row label="Send Reminder via SMS"><Toggle on={cfg.reminderSms} onChange={v => set("reminderSms", v)} /></Row>
          <Row label="Send Reminder via Email"><Toggle on={cfg.reminderEmail} onChange={v => set("reminderEmail", v)} /></Row>
          <Row label="Default Sub-Admin Commission Rate" hint="Percentage of revenue for resellers">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input style={{ ...inp, width: 80 }} type="number" value={cfg.commissionRate} onChange={e => set("commissionRate", e.target.value)} />
              <span style={{ color: C.sub, fontSize: "0.82rem" }}>%</span>
            </div>
          </Row>
        </Section>
      </div>
    </SuperAdminLayout>
  );
}
