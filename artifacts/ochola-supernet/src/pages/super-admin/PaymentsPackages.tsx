import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import {
  CheckCircle2, CreditCard, Edit2, Loader2, Package, Plus, RefreshCw,
  Send, Trash2, X, XCircle,
} from "lucide-react";

const C = {
  card: "rgba(255,255,255,0.04)",
  border: "var(--isp-accent-glow)",
  accent: "var(--isp-accent)",
  text: "#e2e8f0",
  muted: "#64748b",
  sub: "#94a3b8",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "9px 12px",
  color: C.text,
  fontSize: "0.8rem",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

interface Admin {
  id: number;
  name: string;
  subdomain: string | null;
  currency: string;
  payment_gateway: string;
  status: string;
}

interface Plan {
  id: number;
  admin_id: number;
  name: string;
  type: "hotspot" | "pppoe" | "static";
  speed_down: number | string;
  speed_up: number | string;
  price: number | string;
  validity: number;
  validity_unit: string;
  validity_days: number;
  shared_users: number;
  description: string | null;
  is_active: boolean;
}

interface PlanForm {
  name: string;
  type: Plan["type"];
  speed_down: string;
  speed_up: string;
  price: string;
  validity: string;
  validity_unit: string;
  shared_users: string;
  description: string;
  is_active: boolean;
}

interface PaymentSettings {
  paymentGateway: string;
  darajaConfigured: boolean;
  destination: { label: string; number: string } | null;
}

type PromptStatus = "idle" | "sending" | "pending" | "paid" | "failed" | "expired";

const EMPTY_FORM: PlanForm = {
  name: "",
  type: "hotspot",
  speed_down: "10",
  speed_up: "10",
  price: "",
  validity: "1",
  validity_unit: "days",
  shared_users: "1",
  description: "",
  is_active: true,
};

const gatewayLabels: Record<string, string> = {
  mpesa_paybill: "M-Pesa PayBill",
  mpesa_till_push: "M-Pesa Till Push",
  bank_stk_push: "BankStkPush",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: "block", color: C.muted, fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ color: C.muted, fontSize: "0.66rem", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function getToken(): string {
  try {
    return localStorage.getItem("ochola_superadmin_token") || "";
  } catch {
    return "";
  }
}

function planToForm(plan: Plan): PlanForm {
  return {
    name: plan.name,
    type: plan.type,
    speed_down: String(plan.speed_down),
    speed_up: String(plan.speed_up),
    price: String(plan.price),
    validity: String(plan.validity),
    validity_unit: plan.validity_unit || "days",
    shared_users: String(plan.shared_users),
    description: plan.description || "",
    is_active: plan.is_active !== false,
  };
}

function apiError(data: { error?: string }, fallback: string): Error {
  return new Error(data.error || fallback);
}

export default function SuperAdminPaymentsPackages() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminId, setAdminId] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pageError, setPageError] = useState("");
  const [planMessage, setPlanMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [promptStatus, setPromptStatus] = useState<PromptStatus>("idle");
  const [checkoutId, setCheckoutId] = useState("");
  const [promptError, setPromptError] = useState("");

  const selectedAdmin = useMemo(
    () => admins.find(admin => String(admin.id) === adminId) ?? null,
    [admins, adminId],
  );
  const selectedPlan = useMemo(
    () => plans.find(plan => String(plan.id) === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const request = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("x-sa-token", getToken());
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...options, headers });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.ok === false) throw apiError(data, "The request could not be completed.");
    return data;
  };

  const loadPlans = async (id: string) => {
    if (!id) {
      setPlans([]);
      setPaymentSettings(null);
      return;
    }
    setLoadingPlans(true);
    setPageError("");
    try {
      const [planData, paymentData] = await Promise.all([
        request(`/api/super-admin/billing/plans?adminId=${encodeURIComponent(id)}`),
        request(`/api/super-admin/billing/payment-settings?adminId=${encodeURIComponent(id)}`),
      ]);
      setPlans((planData.plans ?? []) as Plan[]);
      setPaymentSettings(paymentData as unknown as PaymentSettings);
      setSelectedPlanId("");
    } catch (error) {
      setPlans([]);
      setPaymentSettings(null);
      setPageError(error instanceof Error ? error.message : "Could not load the selected ISP.");
    } finally {
      setLoadingPlans(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoadingAdmins(true);
    request("/api/super-admin/billing/admins")
      .then(data => {
        if (!active) return;
        const rows = (data.admins ?? []) as Admin[];
        setAdmins(rows);
        if (rows.length > 0) setAdminId(String(rows[0].id));
      })
      .catch(error => {
        if (active) setPageError(error instanceof Error ? error.message : "Could not load active ISP accounts.");
      })
      .finally(() => { if (active) setLoadingAdmins(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void loadPlans(adminId);
  }, [adminId]);

  useEffect(() => {
    if (!checkoutId || promptStatus !== "pending") return;
    let active = true;
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt >= 3 * 60 * 1000) {
        if (active) setPromptStatus("expired");
        return;
      }
      try {
        const response = await fetch(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`);
        const data = await response.json() as { paid?: boolean; status?: string; failureReason?: string };
        if (!active) return;
        if (data.paid) setPromptStatus("paid");
        else if (data.status === "failed") {
          setPromptError(data.failureReason || "The payment prompt was declined or cancelled.");
          setPromptStatus("failed");
        }
      } catch {
        // Keep polling through transient network errors.
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [checkoutId, promptStatus]);

  const setFormValue = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const savePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adminId) return;
    setSavingPlan(true);
    setPlanMessage("");
    setPageError("");
    const validity = Number(form.validity);
    const validityDays = form.validity_unit === "hours" ? Math.ceil(validity / 24) :
      form.validity_unit === "weeks" ? validity * 7 :
      form.validity_unit === "months" ? validity * 30 : validity;
    const body = {
      adminId: Number(adminId),
      ...form,
      speed_down: Number(form.speed_down),
      speed_up: Number(form.speed_up),
      price: Number(form.price),
      validity,
      validity_days: validityDays,
      shared_users: Number(form.shared_users),
    };
    try {
      if (editingId) {
        await request(`/api/super-admin/billing/plans/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        setPlanMessage("Package updated.");
      } else {
        await request("/api/super-admin/billing/plans", { method: "POST", body: JSON.stringify(body) });
        setPlanMessage("Package added.");
      }
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadPlans(adminId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save the package.");
    } finally {
      setSavingPlan(false);
    }
  };

  const togglePlan = async (plan: Plan) => {
    setPageError("");
    try {
      await request(`/api/super-admin/billing/plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({ adminId: Number(adminId), is_active: !plan.is_active }),
      });
      setPlans(current => current.map(item => item.id === plan.id ? { ...item, is_active: !plan.is_active } : item));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not change package status.");
    }
  };

  const deletePlan = async (plan: Plan) => {
    if (!window.confirm(`Delete ${plan.name}? Existing transaction history will remain, but this package will no longer be available.`)) return;
    setDeletingId(plan.id);
    setPageError("");
    try {
      await request(`/api/super-admin/billing/plans/${plan.id}?adminId=${encodeURIComponent(adminId)}`, { method: "DELETE" });
      setPlans(current => current.filter(item => item.id !== plan.id));
      if (selectedPlanId === String(plan.id)) setSelectedPlanId("");
      if (editingId === plan.id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      setPlanMessage("Package deleted.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not delete the package.");
    } finally {
      setDeletingId(null);
    }
  };

  const sendPrompt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPlan || !selectedAdmin) {
      setPromptError("Choose an active package first.");
      return;
    }
    if (!/^(\+?254|0)(7|1)\d{8}$/.test(phone.replace(/[\s-]/g, ""))) {
      setPromptError("Enter a valid Kenyan mobile number, for example 0712345678.");
      return;
    }
    setPromptError("");
    setCheckoutId("");
    setPromptStatus("sending");
    try {
      const data = await request("/api/mpesa/stk", {
        method: "POST",
        body: JSON.stringify({
          adminId: selectedAdmin.id,
          plan_id: selectedPlan.id,
          amount: Math.ceil(Number(selectedPlan.price)),
          phone: phone.trim(),
          account_ref: selectedPlan.name,
        }),
      });
      setCheckoutId(String(data.CheckoutRequestID || ""));
      setPromptStatus(data.CheckoutRequestID ? "pending" : "expired");
    } catch (error) {
      setPromptStatus("idle");
      setPromptError(error instanceof Error ? error.message : "Could not send the payment prompt.");
    }
  };

  const statusText: Record<PromptStatus, string> = {
    idle: "",
    sending: "Contacting M-Pesa…",
    pending: "Prompt sent. Ask the customer to approve it on their phone.",
    paid: "Payment accepted and confirmed.",
    failed: "The prompt was declined or cancelled. No payment was confirmed.",
    expired: "No confirmation arrived within three minutes. Check Transactions before retrying.",
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1180 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ color: "white", fontSize: "1.4rem", fontWeight: 800, margin: 0 }}>Payments &amp; Packages</h1>
            <p style={{ color: C.muted, fontSize: "0.82rem", margin: "5px 0 0" }}>
              Manage what each ISP sells and send a package-linked payment prompt.
            </p>
          </div>
          <Link href="/super-admin/payments" style={{ color: C.accent, fontSize: "0.76rem", fontWeight: 700, textDecoration: "none" }}>
            Configure payment gateways →
          </Link>
        </div>

        {pageError && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#fca5a5", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 9, padding: "10px 12px", marginBottom: 16, fontSize: "0.76rem" }}>
            <XCircle size={15} /> {pageError}
          </div>
        )}
        {planMessage && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#86efac", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 9, padding: "10px 12px", marginBottom: 16, fontSize: "0.76rem" }}>
            <CheckCircle2 size={15} /> {planMessage}
          </div>
        )}

        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <Field label="ISP account" hint={selectedAdmin ? `${selectedAdmin.subdomain || "No subdomain"}.isplatty.org · ${selectedAdmin.currency || "KES"}` : undefined}>
            <select value={adminId} onChange={event => { setAdminId(event.target.value); setEditingId(null); setForm(EMPTY_FORM); }} style={inputStyle} disabled={loadingAdmins || admins.length === 0}>
              {loadingAdmins && <option>Loading ISP accounts…</option>}
              {!loadingAdmins && admins.length === 0 && <option>No active ISP accounts</option>}
              {admins.map(admin => <option key={admin.id} value={admin.id}>{admin.name} · #{admin.id}</option>)}
            </select>
          </Field>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.85fr)", gap: 18, alignItems: "start" }}>
          <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "17px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Package size={17} color={C.accent} />
                <div>
                  <div style={{ color: "white", fontWeight: 750, fontSize: "0.88rem" }}>Packages</div>
                  <div style={{ color: C.muted, fontSize: "0.7rem", marginTop: 3 }}>Hotspot packages appear in the customer portal.</div>
                </div>
              </div>
              <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setPlanMessage(""); }} style={{ display: "flex", alignItems: "center", gap: 6, border: 0, borderRadius: 8, background: C.accent, color: "white", padding: "8px 11px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                <Plus size={14} /> Add package
              </button>
            </div>
            {loadingPlans ? (
              <div style={{ padding: 45, textAlign: "center", color: C.muted }}><Loader2 size={23} style={{ animation: "spin 1s linear infinite" }} /><div style={{ marginTop: 8, fontSize: "0.76rem" }}>Loading packages…</div></div>
            ) : plans.length === 0 ? (
              <div style={{ padding: 45, textAlign: "center", color: C.muted }}><Package size={28} style={{ opacity: 0.45 }} /><div style={{ marginTop: 8, fontSize: "0.76rem" }}>No packages added for this ISP yet.</div></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Package", "Speed", "Price", "Validity", "Status", ""].map(header => <th key={header} style={{ padding: "10px 12px", textAlign: "left", color: C.muted, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{header}</th>)}
                  </tr></thead>
                  <tbody>{plans.map(plan => (
                    <tr key={plan.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", opacity: plan.is_active ? 1 : 0.55 }}>
                      <td style={{ padding: "12px" }}><div style={{ color: "white", fontWeight: 700 }}>{plan.name}</div><div style={{ color: C.muted, marginTop: 3, textTransform: "capitalize" }}>{plan.type} · {plan.shared_users} user{plan.shared_users === 1 ? "" : "s"}</div></td>
                      <td style={{ padding: "12px", color: C.sub }}>{plan.speed_down}/{plan.speed_up} Mbps</td>
                      <td style={{ padding: "12px", color: "#86efac", fontWeight: 700 }}>KSh {Number(plan.price).toLocaleString("en-KE")}</td>
                      <td style={{ padding: "12px", color: C.sub }}>{plan.validity} {plan.validity_unit}</td>
                      <td style={{ padding: "12px" }}><button onClick={() => void togglePlan(plan)} style={{ border: 0, borderRadius: 20, padding: "4px 8px", background: plan.is_active ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.12)", color: plan.is_active ? "#86efac" : C.sub, fontSize: "0.63rem", fontWeight: 700, cursor: "pointer" }}>{plan.is_active ? "Active" : "Inactive"}</button></td>
                      <td style={{ padding: "12px" }}><div style={{ display: "flex", gap: 5 }}><button aria-label={`Edit ${plan.name}`} onClick={() => { setEditingId(plan.id); setForm(planToForm(plan)); setPlanMessage(""); }} style={{ background: "var(--isp-accent-glow)", border: 0, borderRadius: 6, padding: 6, color: C.accent, cursor: "pointer" }}><Edit2 size={13} /></button><button aria-label={`Delete ${plan.name}`} onClick={() => void deletePlan(plan)} disabled={deletingId === plan.id} style={{ background: "rgba(239,68,68,0.08)", border: 0, borderRadius: 6, padding: 6, color: "#fca5a5", cursor: "pointer" }}>{deletingId === plan.id ? <Loader2 size={13} /> : <Trash2 size={13} />}</button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 15 }}>
                <Package size={16} color={C.accent} />
                <div style={{ color: "white", fontWeight: 750, fontSize: "0.86rem" }}>{editingId ? "Edit package" : "Add package"}</div>
                {editingId && <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} aria-label="Cancel edit" style={{ marginLeft: "auto", background: "none", border: 0, color: C.muted, cursor: "pointer" }}><X size={15} /></button>}
              </div>
              <form onSubmit={savePlan}>
                <Field label="Package name"><input required minLength={2} maxLength={120} value={form.name} onChange={event => setFormValue("name", event.target.value)} style={inputStyle} placeholder="e.g. Daily 10 Mbps" /></Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Type"><select value={form.type} onChange={event => setFormValue("type", event.target.value as Plan["type"])} style={inputStyle}><option value="hotspot">Hotspot</option><option value="pppoe">PPPoE</option><option value="static">Static</option></select></Field>
                  <Field label="Price (KES)"><input required type="number" min="0" step="1" value={form.price} onChange={event => setFormValue("price", event.target.value)} style={inputStyle} placeholder="50" /></Field>
                  <Field label="Download (Mbps)"><input required type="number" min="0" step="0.1" value={form.speed_down} onChange={event => setFormValue("speed_down", event.target.value)} style={inputStyle} /></Field>
                  <Field label="Upload (Mbps)"><input required type="number" min="0" step="0.1" value={form.speed_up} onChange={event => setFormValue("speed_up", event.target.value)} style={inputStyle} /></Field>
                  <Field label="Validity"><input required type="number" min="1" max="3650" step="1" value={form.validity} onChange={event => setFormValue("validity", event.target.value)} style={inputStyle} /></Field>
                  <Field label="Unit"><select value={form.validity_unit} onChange={event => setFormValue("validity_unit", event.target.value)} style={inputStyle}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></Field>
                </div>
                <Field label="Shared users"><input required type="number" min="1" max="10000" step="1" value={form.shared_users} onChange={event => setFormValue("shared_users", event.target.value)} style={inputStyle} /></Field>
                <Field label="Description"><textarea maxLength={500} value={form.description} onChange={event => setFormValue("description", event.target.value)} style={{ ...inputStyle, minHeight: 62, resize: "vertical" }} placeholder="Optional customer-facing description" /></Field>
                <label style={{ display: "flex", alignItems: "center", gap: 8, color: C.sub, fontSize: "0.74rem", marginBottom: 15, cursor: "pointer" }}><input type="checkbox" checked={form.is_active} onChange={event => setFormValue("is_active", event.target.checked)} /> Available for customers</label>
                <button type="submit" disabled={savingPlan || !adminId} style={{ width: "100%", border: 0, borderRadius: 8, background: C.accent, color: "white", padding: "10px 12px", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", opacity: savingPlan ? 0.6 : 1 }}>{savingPlan ? "Saving…" : editingId ? "Update package" : "Add package"}</button>
              </form>
            </section>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}><CreditCard size={16} color={C.accent} /><div style={{ color: "white", fontWeight: 750, fontSize: "0.86rem" }}>Send payment prompt</div></div>
              <p style={{ color: C.muted, fontSize: "0.7rem", lineHeight: 1.45, margin: "0 0 14px" }}>Send the selected package amount to a customer’s Kenyan mobile number.</p>
              <div style={{ background: "rgba(255,255,255,0.035)", borderRadius: 8, padding: "9px 10px", marginBottom: 13, fontSize: "0.7rem", color: C.sub }}>
                <div><strong style={{ color: "white" }}>{selectedPlan?.name || "No package selected"}</strong>{selectedPlan && <span> · KSh {Number(selectedPlan.price).toLocaleString("en-KE")}</span>}</div>
                <div style={{ marginTop: 4 }}>Gateway: {gatewayLabels[paymentSettings?.paymentGateway || ""] || paymentSettings?.paymentGateway || "Loading…"}</div>
                <div>Destination: {paymentSettings?.destination ? `${paymentSettings.destination.label} ${paymentSettings.destination.number}` : "Not configured"}</div>
                <div>Daraja: <span style={{ color: paymentSettings?.darajaConfigured ? "#86efac" : "#fbbf24" }}>{paymentSettings?.darajaConfigured ? "Configured" : "Needs configuration"}</span></div>
              </div>
              {promptError && <div style={{ color: "#fca5a5", background: "rgba(239,68,68,0.08)", borderRadius: 7, padding: "8px 9px", marginBottom: 11, fontSize: "0.7rem" }}>{promptError}</div>}
              {promptStatus !== "idle" && <div style={{ color: promptStatus === "paid" ? "#86efac" : C.sub, background: "rgba(255,255,255,0.04)", borderRadius: 7, padding: "8px 9px", marginBottom: 11, fontSize: "0.7rem" }}>{statusText[promptStatus]}</div>}
              <form onSubmit={sendPrompt}>
                <Field label="Package"><select required value={selectedPlanId} onChange={event => { setSelectedPlanId(event.target.value); setPromptStatus("idle"); setPromptError(""); }} style={inputStyle}><option value="">Choose an active package</option>{plans.filter(plan => plan.is_active).map(plan => <option key={plan.id} value={plan.id}>{plan.name} · KSh {Number(plan.price).toLocaleString("en-KE")}</option>)}</select></Field>
                <Field label="Customer phone" hint="Use 07…, 01…, +254…, or 254…"><input required type="tel" value={phone} onChange={event => setPhone(event.target.value)} style={inputStyle} placeholder="0712 345 678" /></Field>
                <button type="submit" disabled={promptStatus === "sending" || promptStatus === "pending" || !selectedPlanId} style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 7, border: 0, borderRadius: 8, background: "#166534", color: "white", padding: "10px 12px", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", opacity: promptStatus === "sending" || promptStatus === "pending" || !selectedPlanId ? 0.55 : 1 }}>{promptStatus === "sending" ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Sending…</> : <><Send size={14} /> Send STK prompt</>}</button>
              </form>
            </section>
          </div>
        </div>

        <div style={{ marginTop: 18, color: C.muted, fontSize: "0.68rem", display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={12} /> Package changes are saved to the selected ISP and are immediately available to its portal.</div>
      </div>
    </SuperAdminLayout>
  );
}