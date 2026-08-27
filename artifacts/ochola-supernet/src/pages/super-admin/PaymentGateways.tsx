import React, { useEffect, useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { CreditCard, Save, CheckCircle2, Eye, EyeOff, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 42, height: 22, borderRadius: 11, background: on ? "var(--isp-accent)" : "rgba(255,255,255,0.1)", border: "none", cursor: "pointer", position: "relative", padding: 0, flexShrink: 0 }}>
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
type DestinationType = "bank" | "till" | "paybill";
interface MpesaSettings {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  env: "sandbox" | "production";
  tillNumber: string;
  replacePassword: string;
}
interface PaymentDestination {
  id: string;
  type: DestinationType;
  name: string;
  number: string;
  accountReference: string;
  instructions: string;
  active: boolean;
}
interface RegistrationDestinationData {
  type: DestinationType;
  name: string;
  number: string;
  accountReference: string;
  instructions: string;
}
interface ManualRegistrationPayment {
  id: number;
  admin_id: number;
  amount: number | string;
  payment_phone: string | null;
  notes: string | null;
  created_at: string;
}

const emptyDestination = (): Omit<PaymentDestination, "id"> & { id?: string } => ({
  type: "paybill",
  name: "",
  number: "",
  accountReference: "",
  instructions: "",
  active: true,
});

const automaticMpesaCallbackUrl = (): string =>
  typeof window === "undefined" ? "" : new URL("/api/mpesa/callback", window.location.origin).toString();

const emptyMpesaSettings = (): MpesaSettings => ({
  consumerKey: "",
  consumerSecret: "",
  shortcode: "",
  passkey: "",
  callbackUrl: automaticMpesaCallbackUrl(),
  env: "production",
  tillNumber: "",
  replacePassword: "",
});

function destinationTypeLabel(type: DestinationType): string {
  return type === "till" ? "Till number" : type === "paybill" ? "PayBill" : "Bank account";
}

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
    Object.fromEntries(GATEWAYS.filter(gw => gw.id !== "mpesa").map(gw => [gw.id, { enabled: false, sandbox: true, ...Object.fromEntries(gw.fields.map(f => [f.key, ""])) }]))
  );
  const [expanded, setExpanded] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [mpesa, setMpesa] = useState<MpesaSettings>(emptyMpesaSettings);
  const [mpesaConfigured, setMpesaConfigured] = useState(false);
  const [mpesaError, setMpesaError] = useState("");
  const [mpesaSaving, setMpesaSaving] = useState(false);
  const [destinations, setDestinations] = useState<PaymentDestination[]>([]);
  const [registrationFee, setRegistrationFee] = useState("500");
  const [registrationDestinationId, setRegistrationDestinationId] = useState("");
  const [renewalDestinationId, setRenewalDestinationId] = useState("");
  const [destinationForm, setDestinationForm] = useState(emptyDestination);
  const [destinationError, setDestinationError] = useState("");
  const [destinationSaved, setDestinationSaved] = useState(false);
  const [destinationSaving, setDestinationSaving] = useState(false);
  const [registrationReplacePassword, setRegistrationReplacePassword] = useState("");
  const [manualRegistrations, setManualRegistrations] = useState<ManualRegistrationPayment[]>([]);
  const token = useMemo(() => {
    try { return localStorage.getItem("ochola_superadmin_token") || ""; } catch { return ""; }
  }, []);

  const applyDestinationData = (data: {
    destinations?: PaymentDestination[];
    registrationFee?: { amount?: number; currency?: string };
    registrationDestinationId?: string;
    renewalDestinationId?: string;
  }) => {
    setDestinations(data.destinations ?? []);
    setRegistrationFee(String(data.registrationFee?.amount ?? 500));
    setRegistrationDestinationId(data.registrationDestinationId ?? "");
    setRenewalDestinationId(data.renewalDestinationId ?? "");
  };

  useEffect(() => {
    fetch("/api/super-admin/payment-destinations", { headers: { "x-sa-token": token } })
      .then(async response => {
        const data = await response.json() as { ok: boolean; error?: string } & Parameters<typeof applyDestinationData>[0];
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not load payment destinations.");
        applyDestinationData(data);
      })
      .catch(error => setDestinationError(error instanceof Error ? error.message : "Could not load payment destinations."));
  }, [token]);

  const loadManualRegistrations = async () => {
    try {
      const response = await fetch("/api/super-admin/manual-registration-payments", {
        headers: { "x-sa-token": token },
      });
      const data = await response.json() as { ok: boolean; error?: string; payments?: ManualRegistrationPayment[] };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load manual registration payments.");
      setManualRegistrations(data.payments ?? []);
    } catch (error) {
      setDestinationError(error instanceof Error ? error.message : "Could not load manual registration payments.");
    }
  };

  useEffect(() => {
    void loadManualRegistrations();
  }, [token]);

  useEffect(() => {
    fetch("/api/super-admin/mpesa", { headers: { "x-sa-token": token } })
      .then(async response => {
        const data = await response.json() as {
          ok: boolean;
          configured?: boolean;
          error?: string;
          settings?: Omit<MpesaSettings, "replacePassword">;
        };
        if (!response.ok || !data.ok || !data.settings) throw new Error(data.error || "Could not load M-Pesa settings.");
        setMpesa({
          ...emptyMpesaSettings(),
          ...data.settings,
          callbackUrl: data.settings.callbackUrl || automaticMpesaCallbackUrl(),
        });
        setMpesaConfigured(!!data.configured);
      })
      .catch(error => setMpesaError(error instanceof Error ? error.message : "Could not load M-Pesa settings."));
  }, [token]);

  const setField = (gw: string, k: string, v: string | boolean) =>
    setConfigs(c => ({ ...c, [gw]: { ...c[gw], [k]: v } }));

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };

  const updateMpesa = (key: keyof MpesaSettings, value: string) =>
    setMpesa(current => ({ ...current, [key]: value }));

  const saveMpesa = async () => {
    setMpesaError("");
    setMpesaSaving(true);
    try {
      const response = await fetch("/api/super-admin/mpesa", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token },
        body: JSON.stringify(mpesa),
      });
      const data = await response.json() as { ok: boolean; configured?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save M-Pesa settings.");
      setMpesaConfigured(!!data.configured);
      setMpesa(current => ({
        ...current,
        consumerKey: current.consumerKey ? "**hidden**" : "",
        consumerSecret: current.consumerSecret ? "**hidden**" : "",
        passkey: current.passkey ? "**hidden**" : "",
        replacePassword: "",
      }));
    } catch (error) {
      setMpesaError(error instanceof Error ? error.message : "Could not save M-Pesa settings.");
    } finally {
      setMpesaSaving(false);
    }
  };

  const saveDestination = async () => {
    setDestinationError("");
    setDestinationSaved(false);
    setDestinationSaving(true);
    try {
      const response = await fetch("/api/super-admin/payment-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token },
        body: JSON.stringify({
          action: "upsert",
          destination: destinationForm,
          replacePassword: registrationReplacePassword,
        }),
      });
      const data = await response.json() as { ok: boolean; error?: string } & Parameters<typeof applyDestinationData>[0];
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save the destination.");
      applyDestinationData(data);
      setDestinationForm(emptyDestination());
      setRegistrationReplacePassword("");
      setDestinationSaved(true);
    } catch (error) {
      setDestinationError(error instanceof Error ? error.message : "Could not save the destination.");
    } finally {
      setDestinationSaving(false);
    }
  };

  const savePurposes = async () => {
    setDestinationError("");
    setDestinationSaved(false);
    setDestinationSaving(true);
    const amount = Number(registrationFee);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      setDestinationError("Registration fee must be a whole KSh amount between 1 and 1,000,000.");
      setDestinationSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/super-admin/payment-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token },
        body: JSON.stringify({
          action: "select",
          registrationFee: amount,
          registrationDestinationId,
          renewalDestinationId,
          replacePassword: registrationReplacePassword,
        }),
      });
      const data = await response.json() as { ok: boolean; error?: string } & Parameters<typeof applyDestinationData>[0];
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save payment purposes.");
      applyDestinationData(data);
      setRegistrationReplacePassword("");
      setDestinationSaved(true);
    } catch (error) {
      setDestinationError(error instanceof Error ? error.message : "Could not save payment purposes.");
    } finally {
      setDestinationSaving(false);
    }
  };

  const removeDestination = async (id: string) => {
    setDestinationError("");
    setDestinationSaved(false);
    setDestinationSaving(true);
    try {
      const response = await fetch(`/api/super-admin/payment-destinations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-sa-token": token },
        body: JSON.stringify({ replacePassword: registrationReplacePassword }),
      });
      const data = await response.json() as { ok: boolean; error?: string } & Parameters<typeof applyDestinationData>[0];
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not remove the destination.");
      applyDestinationData(data);
      if (destinationForm.id === id) setDestinationForm(emptyDestination());
      setRegistrationReplacePassword("");
      setDestinationSaved(true);
    } catch (error) {
      setDestinationError(error instanceof Error ? error.message : "Could not remove the destination.");
    } finally {
      setDestinationSaving(false);
    }
  };

  const verifyManualRegistration = async (id: number) => {
    setDestinationError("");
    setDestinationSaved(false);
    setDestinationSaving(true);
    try {
      const response = await fetch(`/api/super-admin/manual-registration-payments/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token },
        body: JSON.stringify({ replacePassword: registrationReplacePassword }),
      });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not verify this bank payment.");
      setManualRegistrations(current => current.filter(payment => payment.id !== id));
      setRegistrationReplacePassword("");
      setDestinationSaved(true);
    } catch (error) {
      setDestinationError(error instanceof Error ? error.message : "Could not verify this bank payment.");
    } finally {
      setDestinationSaving(false);
    }
  };

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

        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: "1.1rem" }}>🟢</span>
            <div style={{ color: "white", fontWeight: 750 }}>M-Pesa Daraja</div>
            <span style={{ marginLeft: 4, fontSize: "0.65rem", background: mpesa.env === "production" ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.12)", color: mpesa.env === "production" ? "#4ade80" : "#fbbf24", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>
              {mpesa.env === "production" ? "Live" : "Sandbox"}
            </span>
            {mpesaConfigured && <span style={{ fontSize: "0.65rem", background: "rgba(74,222,128,0.12)", color: "#4ade80", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>Configured</span>}
          </div>
          <p style={{ color: C.sub, fontSize: "0.76rem", lineHeight: 1.5, margin: "0 0 16px" }}>
            Credentials are encrypted in Supabase and only their status is shown here. Enter the replacement passcode to change any live M-Pesa setting.
          </p>
          {mpesaError && <div style={{ color: "#fca5a5", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "9px 11px", fontSize: "0.75rem", marginBottom: 14 }}>{mpesaError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <SecretField label="Consumer Key" value={mpesa.consumerKey} onChange={value => updateMpesa("consumerKey", value)} />
            <SecretField label="Consumer Secret" value={mpesa.consumerSecret} onChange={value => updateMpesa("consumerSecret", value)} />
            <Field label="Business shortcode">
              <input style={inp} inputMode="numeric" value={mpesa.shortcode} onChange={e => updateMpesa("shortcode", e.target.value)} />
            </Field>
            <SecretField label="Lipa na M-Pesa passkey" value={mpesa.passkey} onChange={value => updateMpesa("passkey", value)} />
            <Field label="Mode">
              <select style={inp} value={mpesa.env} onChange={e => updateMpesa("env", e.target.value)}>
                <option value="production">Live / Production</option>
                <option value="sandbox">Sandbox / Test</option>
              </select>
            </Field>
            <Field label="Till number (optional)">
              <input style={inp} inputMode="numeric" value={mpesa.tillNumber} onChange={e => updateMpesa("tillNumber", e.target.value)} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Callback URL" hint="Generated automatically from your deployed HTTPS domain and used for every Daraja STK request.">
                <input style={{ ...inp, color: C.sub, cursor: "not-allowed" }} type="url" value={mpesa.callbackUrl} readOnly aria-readonly="true" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <SecretField label="Replacement passcode" hint="Required to change credentials, shortcode, mode, callback, or till number." value={mpesa.replacePassword} onChange={value => updateMpesa("replacePassword", value)} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={saveMpesa} disabled={mpesaSaving} style={{ border: 0, borderRadius: 8, background: C.accent, color: "white", padding: "9px 13px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", opacity: mpesaSaving ? 0.6 : 1 }}>
              {mpesaSaving ? "Saving…" : "Save protected M-Pesa settings"}
            </button>
          </div>
        </section>

        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <CreditCard size={17} color={C.accent} />
            <div style={{ color: "white", fontWeight: 750 }}>Collection destinations</div>
          </div>
          <p style={{ color: C.sub, fontSize: "0.76rem", lineHeight: 1.5, margin: "0 0 18px" }}>
            Choose where platform registration and renewal payments are collected. Till and PayBill support automatic M-Pesa prompts; bank accounts switch registration to manual payment instructions.
          </p>

          {destinationError && (
            <div style={{ color: "#fca5a5", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "9px 11px", fontSize: "0.75rem", marginBottom: 14 }}>
              {destinationError}
            </div>
          )}
          {destinationSaved && (
            <div style={{ color: "#86efac", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "9px 11px", fontSize: "0.75rem", marginBottom: 14 }}>
              Registration payment settings saved.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 6 }}>
            <Field label="ISP registration fee (KES)" hint="Whole Kenyan shilling amount, from KSh 1 to KSh 1,000,000">
              <input
                style={inp}
                type="number"
                min="1"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={registrationFee}
                onChange={e => { setRegistrationFee(e.target.value); setDestinationSaved(false); }}
              />
            </Field>
            <div />
            <Field label="Destination type">
              <select value={destinationForm.type} onChange={e => setDestinationForm(form => ({ ...form, type: e.target.value as DestinationType }))} style={inp}>
                <option value="paybill">PayBill</option>
                <option value="till">Till number</option>
                <option value="bank">Bank account</option>
              </select>
            </Field>
            <Field label="Display name" hint="e.g. ISPlatty collections">
              <input style={inp} value={destinationForm.name} onChange={e => setDestinationForm(form => ({ ...form, name: e.target.value }))} />
            </Field>
            <Field label={destinationForm.type === "bank" ? "Account number" : destinationForm.type === "till" ? "Till number" : "PayBill number"}>
              <input style={inp} inputMode="numeric" value={destinationForm.number} onChange={e => setDestinationForm(form => ({ ...form, number: e.target.value }))} />
            </Field>
            <Field label="Account / business number" hint={destinationForm.type === "bank" ? "Required account-holder name or transfer reference" : destinationForm.type === "paybill" ? "Required for PayBill" : "Optional reference shown with the payment"}>
              <input style={inp} value={destinationForm.accountReference} onChange={e => setDestinationForm(form => ({ ...form, accountReference: e.target.value }))} />
            </Field>
            <Field label="Payment instructions" hint={destinationForm.type === "bank" ? "Required instructions shown to registrants" : "Optional instructions shown with the payment"}>
              <input style={inp} value={destinationForm.instructions} onChange={e => setDestinationForm(form => ({ ...form, instructions: e.target.value }))} />
            </Field>
            <Field label="Status">
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36 }}>
                <Toggle on={destinationForm.active} onChange={active => setDestinationForm(form => ({ ...form, active }))} />
                <span style={{ fontSize: "0.76rem", color: destinationForm.active ? "#4ade80" : C.sub }}>{destinationForm.active ? "Active" : "Inactive"}</span>
              </div>
            </Field>
          </div>
          <div style={{ maxWidth: 380 }}>
            <SecretField
              label="Replacement passcode"
              hint="Required to add, edit, delete, or select a registration payment setting."
              value={registrationReplacePassword}
              onChange={value => setRegistrationReplacePassword(value)}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 18 }}>
            {destinationForm.id && <button onClick={() => setDestinationForm(emptyDestination())} style={{ border: 0, background: "transparent", color: C.sub, fontSize: "0.76rem", cursor: "pointer" }}>Cancel edit</button>}
            <button onClick={saveDestination} disabled={destinationSaving} style={{ border: 0, borderRadius: 8, background: C.accent, color: "white", padding: "9px 13px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", opacity: destinationSaving ? 0.6 : 1 }}>
              {destinationForm.id ? "Update destination" : "Add destination"}
            </button>
          </div>

          {destinations.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, paddingTop: 16, borderTop: `1px solid ${C.border}`, marginBottom: 14 }}>
                <Field label="New account creation">
                  <select value={registrationDestinationId} onChange={e => setRegistrationDestinationId(e.target.value)} style={inp}>
                    <option value="">No destination selected</option>
                    {destinations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name} · {destinationTypeLabel(item.type)}</option>)}
                  </select>
                </Field>
                <Field label="Account renewal">
                  <select value={renewalDestinationId} onChange={e => setRenewalDestinationId(e.target.value)} style={inp}>
                    <option value="">No destination selected</option>
                    {destinations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name} · {destinationTypeLabel(item.type)}</option>)}
                  </select>
                </Field>
                <div style={{ display: "flex", alignItems: "end", paddingBottom: 14 }}>
                  <button onClick={savePurposes} disabled={destinationSaving} style={{ border: 0, borderRadius: 8, background: "rgba(255,255,255,0.12)", color: "white", padding: "9px 12px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer" }}>Save registration settings</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {destinations.map(destination => (
                  <div key={destination.id} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}`, borderRadius: 9, padding: "10px 11px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "white", fontWeight: 700, fontSize: "0.78rem" }}>{destination.name} <span style={{ color: C.sub, fontWeight: 500 }}>· {destinationTypeLabel(destination.type)}</span></div>
                      <div style={{ color: C.sub, fontSize: "0.7rem", marginTop: 3 }}>{destination.number}{destination.accountReference ? ` · ${destination.accountReference}` : ""}{destination.active ? "" : " · inactive"}</div>
                    </div>
                    <button onClick={() => setDestinationForm(destination)} style={{ border: 0, background: "transparent", color: C.accent, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => removeDestination(destination.id)} aria-label={`Delete ${destination.name}`} style={{ border: 0, background: "transparent", color: "#fca5a5", display: "flex", cursor: "pointer" }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
          {destinations.length === 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={savePurposes} disabled={destinationSaving} style={{ border: 0, borderRadius: 8, background: "rgba(255,255,255,0.12)", color: "white", padding: "9px 12px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer" }}>
                Save registration fee
              </button>
            </div>
          )}
          {manualRegistrations.length > 0 && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div style={{ color: "white", fontWeight: 750, fontSize: "0.84rem", marginBottom: 5 }}>Manual bank registrations awaiting verification</div>
              <p style={{ color: C.sub, fontSize: "0.74rem", lineHeight: 1.45, margin: "0 0 10px" }}>
                Confirm the bank transfer outside the platform, then approve it here. Approval activates the ISP exactly once.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {manualRegistrations.map(payment => (
                  <div key={payment.id} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}`, borderRadius: 9, padding: "10px 11px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "white", fontWeight: 700, fontSize: "0.78rem" }}>KSh {Number(payment.amount).toLocaleString("en-KE")} · ISP #{payment.admin_id}</div>
                      <div style={{ color: C.sub, fontSize: "0.7rem", marginTop: 3 }}>{payment.payment_phone || "No mobile number"} · {new Date(payment.created_at).toLocaleString("en-KE")}</div>
                    </div>
                    <button onClick={() => void verifyManualRegistration(payment.id)} disabled={destinationSaving} style={{ border: 0, borderRadius: 7, background: "#166534", color: "white", padding: "7px 10px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", opacity: destinationSaving ? 0.6 : 1 }}>
                      Verify &amp; activate
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {GATEWAYS.filter(gw => gw.id !== "mpesa").map(gw => {
          const cfg = configs[gw.id] ?? {};
          const open = expanded === gw.id;
          return (
            <div key={gw.id} style={{ background: C.card, border: `1px solid ${cfg.enabled ? "var(--isp-accent-border)" : C.border}`, borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
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
