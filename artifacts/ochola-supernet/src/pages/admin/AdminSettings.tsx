import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useBrand } from "@/context/BrandContext";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Logo } from "@/components/Logo";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { useDashboardPreferences } from "@/context/DashboardPreferencesContext";
import { useTypography } from "@/context/TypographyContext";
import {
  FONT_FAMILY_OPTIONS,
  FONT_STYLE_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  type TypographyPreferences,
} from "@/lib/typography";
import {
  DASHBOARD_COLOR_PRESETS,
  DASHBOARD_LAYOUT_OPTIONS,
  DASHBOARD_SHAPE_OPTIONS,
  type DashboardPreferences,
} from "@/lib/dashboard-preferences";
import {
  Building2, CreditCard, MessageSquare, Radio, Wifi, Shield,
  Bell, Wrench, Check, Eye, EyeOff, Copy, Trash2, Plus,
  Upload, RefreshCw, AlertTriangle, Terminal, Save, Key,
  LogOut, Monitor, ChevronDown, ChevronUp, Smartphone, Mail, Puzzle,
  Send, MessageCircle, Phone, Palette, LayoutDashboard,
  MapPin, Clock, Users, Zap, Wallet, Landmark, Banknote, BarChart3, ReceiptText, TrendingUp,
  Type,
} from "lucide-react";

// ─── shared primitives ───────────────────────────────────────────────────────

const C = {
  cyan:      "var(--isp-accent)",
  cyanDark:  "var(--isp-accent)",
  sidebar:   "#131929",
  card:      "var(--isp-card)",
  border:    "var(--isp-border-subtle)",
  bg:        "var(--isp-bg)",
  text:      "var(--isp-text)",
  muted:     "var(--isp-text-muted)",
  input:     "var(--isp-input-bg)",
  inputBdr:  "var(--isp-input-border)",
};

function adminApiHeaders(): Record<string, string> {
  const token = getAdminApiToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function Toggle({ on, onChange, label = "Toggle setting" }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={() => onChange(!on)} style={{
      position: "relative", display: "inline-flex", width: 44, height: 24,
      borderRadius: 12, background: on ? C.cyan : "rgba(255,255,255,0.12)",
      border: "none", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 0.2s",
    }}>
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18,
        borderRadius: "50%", background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
        <p style={{ fontSize: "0.875rem", fontWeight: 700, color: C.text, margin: 0 }}>{title}</p>
        {desc && <p style={{ fontSize: "0.72rem", color: C.muted, margin: "2px 0 0" }}>{desc}</p>}
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: "0.68rem", color: C.muted, margin: "4px 0 0", opacity: 0.8 }}>{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{
      width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`,
      borderRadius: 8, color: C.text, fontSize: "0.8125rem",
      padding: "0.45rem 0.75rem", fontFamily: "inherit", outline: "none",
      boxSizing: "border-box", transition: "border-color 0.2s",
      ...props.style,
    }} />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{
      width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`,
      borderRadius: 8, color: C.text, fontSize: "0.8125rem",
      padding: "0.45rem 0.75rem", fontFamily: "inherit", outline: "none",
      boxSizing: "border-box",
    }}>
      {children}
    </select>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {children}
    </div>
  );
}

function SaveBtn({ label = "Save Changes" }: { label?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }} style={{
      display: "flex", alignItems: "center", gap: 6,
      background: saved ? "#10b981" : C.cyan, border: "none", cursor: "pointer",
      color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem",
      borderRadius: 8, fontFamily: "inherit", transition: "background 0.2s",
    }}>
      {saved ? <><Check size={13} /> Saved!</> : <><Save size={13} /> {label}</>}
    </button>
  );
}

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, ...style }}>{children}</div>;
}

// ─── tab content ─────────────────────────────────────────────────────────────

function IspProfileTab() {
  const brand = useBrand();
  const year = new Date().getFullYear();
  const [tawkEnabled, setTawkEnabled] = useState(false);
  return (
    <>
      <Card title="ISP Identity" desc="Branding and contact info shown to customers and on invoices">
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ width: 150, height: 68, display: "flex", alignItems: "center", flexShrink: 0 }}>
            <Logo size="lg" />
          </div>
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 800, color: C.text, margin: 0 }}>{brand.ispName}</p>
            <p style={{ fontSize: "0.72rem", color: C.muted, margin: "2px 0 4px" }}>{brand.domain}</p>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", color: C.cyan, fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>
              <Upload size={11} /> Upload Logo
            </button>
          </div>
        </div>
        {/* key forces inputs to reset defaultValue once brand data arrives */}
        <Grid2 key={brand.ispName + brand.domain}>
          <Field label="ISP Name"><Input defaultValue={brand.ispName} /></Field>
          <Field label="Website"><Input defaultValue={`https://${brand.domain}`} /></Field>
          <Field label="Support Email"><Input defaultValue={brand.supportEmail} type="email" /></Field>
          <Field label="Support Phone"><Input defaultValue={brand.phone || "+254 700 000 000"} /></Field>
          <Field label="WhatsApp Number" hint="Used for customer support links"><Input defaultValue={brand.phone || "+254 700 000 000"} /></Field>
          <Field label="Country">
            <Select defaultValue="KE">
              <option value="KE">Kenya</option>
              <option value="UG">Uganda</option>
              <option value="TZ">Tanzania</option>
              <option value="NG">Nigeria</option>
            </Select>
          </Field>
        </Grid2>
        <Field label="Physical Address">
          <Input defaultValue="Tom Mboya St, Nairobi, Kenya" />
        </Field>
        <Field label="Business Registration Number">
          <Input placeholder="e.g. CPR/2020/123456" />
        </Field>
        <Row><SaveBtn /></Row>
      </Card>

      <Card title="Customer Portal" desc="Settings for the customer-facing hotspot and PPPoE portal">
        <Grid2 key={brand.domain + "-portal"}>
          <Field label="Portal Title"><Input defaultValue={`${brand.ispName} Customer Portal`} /></Field>
          <Field label="Portal URL"><Input defaultValue={`https://portal.${brand.domain}`} /></Field>
          <Field label="Terms of Service URL"><Input placeholder={`https://${brand.domain}/terms`} /></Field>
          <Field label="Privacy Policy URL"><Input placeholder={`https://${brand.domain}/privacy`} /></Field>
        </Grid2>
        <Field label="Footer Text on Login Pages" hint="Shown at the bottom of hotspot login pages">
          <Input defaultValue={`© ${year} ${brand.ispName}. All rights reserved.`} />
        </Field>
        <Row><SaveBtn label="Save Portal Settings" /></Row>
      </Card>

      <Card title="Tawk.to Live Chat" desc="Embed a live chat widget on your customer portal for real-time support">
        <Grid2>
          <Field label="Tawk.to Property ID" hint="Found in your Tawk.to dashboard under Administration → Channels → Chat Widget">
            <Input placeholder="e.g. 6123456789abcdef01234567" />
          </Field>
          <Field label="Tawk.to Widget ID" hint="The widget identifier from your embed code">
            <Input placeholder="e.g. 1abcdefgh" />
          </Field>
          <Field label="Tawk.to API Key (optional)" hint="Used for HMAC identity verification — keeps chat sessions secure">
            <Input type="password" placeholder="••••••••••" />
          </Field>
        </Grid2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.border}`, marginTop: 8 }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>Enable Live Chat Widget</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Show Tawk.to chat bubble on customer-facing pages</p>
          </div>
          <Toggle on={tawkEnabled} onChange={setTawkEnabled} />
        </div>
        <Row><SaveBtn label="Save Chat Settings" /></Row>
      </Card>
    </>
  );
}

const ADMIN_PAYMENT_GATEWAY_OPTIONS = [
  { id: "mpesa_paybill", label: "M-Pesa PayBill (STK Push)" },
  { id: "mpesa_till_push", label: "M-Pesa Till Push (Buy Goods & Services)" },
  { id: "bank_stk_push", label: "BankStkPush" },
  { id: "airtel", label: "AirtelMoney" },
  { id: "azampay", label: "AzamPay" },
  { id: "custom_paybill", label: "CustomPaybill" },
  { id: "dpo_payments", label: "DpoPayments" },
  { id: "flutterwave", label: "Flutterwave" },
  { id: "intasend", label: "Intasend" },
  { id: "pesapal", label: "PesaPal" },
  { id: "stripe", label: "Stripe" },
  { id: "paypal", label: "PayPal" },
  { id: "tigopesa", label: "TigoPesa" },
  { id: "xendit", label: "XenditEwallet" },
  { id: "manual", label: "Cash / Manual" },
];

type PaymentTestStatus = "idle" | "sending" | "pending" | "paid" | "failed" | "expired";

function AdminPaymentTestCard({ currency }: { currency: string }) {
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [shortcode, setShortcode] = useState("");
  const [paymentGateway, setPaymentGateway] = useState("mpesa_paybill");
  const [bankStkPushConfigured, setBankStkPushConfigured] = useState(false);
  const [adminTillPushConfigured, setAdminTillPushConfigured] = useState(false);
  const [status, setStatus] = useState<PaymentTestStatus>("idle");
  const [checkoutId, setCheckoutId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const loadMpesaSettings = () => {
      fetch(`/api/settings/mpesa?adminId=${ADMIN_ID}`)
        .then(response => response.json())
        .then((data: { configured?: boolean; settings?: { env?: "sandbox" | "production"; shortcode?: string; hasTillNumber?: boolean; bankStkPushConfigured?: boolean; adminTillPushConfigured?: boolean; paymentGateway?: string } }) => {
          setConfigured(data.configured === true);
          setEnvironment(data.settings?.env === "production" ? "production" : "sandbox");
          setShortcode(data.settings?.shortcode?.trim() || "");
          setPaymentGateway(ADMIN_PAYMENT_GATEWAY_OPTIONS.some(option => option.id === data.settings?.paymentGateway) ? data.settings?.paymentGateway || "mpesa_paybill" : "mpesa_paybill");
          setBankStkPushConfigured(data.settings?.bankStkPushConfigured === true);
          setAdminTillPushConfigured(data.settings?.adminTillPushConfigured === true);
        })
        .catch(() => setConfigured(false));
    };
    loadMpesaSettings();
    window.addEventListener("ochola-payment-gateway-change", loadMpesaSettings);
    return () => window.removeEventListener("ochola-payment-gateway-change", loadMpesaSettings);
  }, []);

  useEffect(() => {
    if (!checkoutId || status !== "pending") return;
    const startedAt = Date.now();
    let active = true;

    const poll = async () => {
      if (Date.now() - startedAt >= 3 * 60 * 1000) {
        if (active) setStatus("expired");
        return;
      }
      try {
        const response = await fetch(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`);
        const data = await response.json() as { paid?: boolean; status?: string; failureReason?: string };
        if (!active) return;
        if (data.paid) setStatus("paid");
        else if (data.status === "failed") {
          setError(data.failureReason || "M-Pesa cancelled or declined the payment prompt.");
          setStatus("failed");
        }
      } catch {}
    };

    poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [checkoutId, status]);

  const sendPrompt = async (event: React.FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!phone.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid subscriber phone number and amount.");
      return;
    }
    if (paymentGateway !== "mpesa_paybill" && paymentGateway !== "mpesa_till_push" && paymentGateway !== "bank_stk_push") {
      setError("Automated payment tests are available when a Daraja payment gateway is selected.");
      return;
    }
    if (paymentGateway === "bank_stk_push" && !bankStkPushConfigured) {
      setError("Save the selected bank, PayBill Number, and Account / Business Number before sending a BankStkPush test.");
      return;
    }
    if (paymentGateway === "mpesa_till_push" && !adminTillPushConfigured) {
      setError("Save this ISP’s Buy Goods Till Number before sending a Till Push test.");
      return;
    }

    setError("");
    setStatus("sending");
    setCheckoutId("");
    try {
      const { ADMIN_ID: adminId } = await import("@/lib/supabase");
      const response = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: adminApiHeaders(),
        body: JSON.stringify({
          phone: phone.trim(),
          amount: numericAmount,
          adminId,
          account_ref: "Admin payment test",
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; CheckoutRequestID?: string };
      if (!response.ok || !data.ok) {
        setStatus("idle");
        setError(data.error || "M-Pesa could not send the payment prompt.");
        return;
      }
      setCheckoutId(data.CheckoutRequestID || "");
      setStatus(data.CheckoutRequestID ? "pending" : "expired");
    } catch {
      setStatus("idle");
      setError("Could not reach the payment server.");
    }
  };

  const statusMessage = {
    idle: "",
    sending: "Contacting M-Pesa…",
    pending: "Prompt sent. Ask the subscriber to approve it on their phone.",
    paid: "Payment accepted. The callback confirmed the transaction.",
    failed: "The payment prompt was cancelled or declined. No payment was confirmed.",
    expired: "No confirmation arrived within three minutes. Check M-Pesa and Transactions before retrying.",
  }[status];
  const usingTillPush = paymentGateway === "mpesa_till_push";
  const usingBankStkPush = paymentGateway === "bank_stk_push";
  const usingDarajaGateway = paymentGateway === "mpesa_paybill" || usingTillPush || usingBankStkPush;
  const gatewayLabel = ADMIN_PAYMENT_GATEWAY_OPTIONS.find(option => option.id === paymentGateway)?.label || paymentGateway;

  return (
    <Card title="Test Subscriber Payment Prompt" desc="Send a one-time STK prompt to verify the configured M-Pesa account">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "9px 11px", borderRadius: 8, background: environment === "production" ? "rgba(245,158,11,0.08)" : "rgba(37,99,235,0.06)", border: `1px solid ${environment === "production" ? "rgba(245,158,11,0.25)" : "var(--isp-border)"}`, color: environment === "production" ? "#fbbf24" : C.muted, fontSize: "0.72rem", lineHeight: 1.45 }}>
        {environment === "production"
          ? `Live mode: approving this prompt charges the phone and sends ${currency} through the configured ${gatewayLabel} gateway using shortcode ${shortcode || "the configured account"}.`
          : `Sandbox mode: this prompt uses the configured ${gatewayLabel} gateway${shortcode ? ` with shortcode ${shortcode}` : ""}.`}
      </div>

      <form onSubmit={sendPrompt}>
        <Grid2>
          <Field label="Subscriber phone number" hint="Use 07…, 01…, or +254…">
            <Input value={phone} onChange={event => setPhone(event.target.value)} placeholder="0712 345 678" inputMode="tel" />
          </Field>
          <Field label={`Amount (${currency})`}>
            <Input value={amount} onChange={event => setAmount(event.target.value)} placeholder="e.g. 50" type="number" min="1" step="1" inputMode="decimal" />
          </Field>
        </Grid2>

        {configured === false && (
          <p style={{ color: "#fbbf24", fontSize: "0.74rem", margin: "0 0 10px" }}>
            M-Pesa is not configured yet.
          </p>
        )}
        {!usingDarajaGateway && (
          <p style={{ color: "#fbbf24", fontSize: "0.74rem", margin: "0 0 10px" }}>
            {gatewayLabel} is active. Select an M-Pesa or BankStkPush gateway to send an automated payment test.
          </p>
        )}
        {usingBankStkPush && !bankStkPushConfigured && (
          <p style={{ color: "#fbbf24", fontSize: "0.74rem", margin: "0 0 10px" }}>
            Complete and save the BankStkPush configuration before sending a test.
          </p>
        )}
        {usingTillPush && !adminTillPushConfigured && (
          <p style={{ color: "#fbbf24", fontSize: "0.74rem", margin: "0 0 10px" }}>
            Complete and save this ISP’s Buy Goods Till Number before sending a test.
          </p>
        )}
        {error && <p style={{ display: "flex", alignItems: "center", gap: 5, color: "#f87171", fontSize: "0.74rem", margin: "0 0 10px" }}><AlertTriangle size={13} aria-hidden="true" /> {error}</p>}
        {statusMessage && (
          <p style={{ color: status === "paid" ? "#34d399" : status === "failed" || status === "expired" ? "#fbbf24" : C.muted, fontSize: "0.74rem", lineHeight: 1.45, margin: "0 0 10px" }}>
            {status === "paid" && <Check size={13} aria-hidden="true" />}{statusMessage}
          </p>
        )}
        <Row>
           <button type="submit" disabled={configured !== true || !usingDarajaGateway || (usingBankStkPush && !bankStkPushConfigured) || (usingTillPush && !adminTillPushConfigured) || status === "sending" || status === "pending"} style={{ display: "flex", alignItems: "center", gap: 6, background: C.cyan, border: "none", cursor: configured !== true || !usingDarajaGateway || (usingBankStkPush && !bankStkPushConfigured) || (usingTillPush && !adminTillPushConfigured) || status === "sending" || status === "pending" ? "not-allowed" : "pointer", color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem", borderRadius: 8, fontFamily: "inherit", opacity: configured !== true || !usingDarajaGateway || (usingBankStkPush && !bankStkPushConfigured) || (usingTillPush && !adminTillPushConfigured) || status === "sending" || status === "pending" ? 0.55 : 1 }}>
             {status === "sending" ? "Sending…" : status === "pending" ? "Waiting for approval…" : "Send STK Prompt"}
          </button>
        </Row>
      </form>
    </Card>
  );
}

function AdminPaymentGatewayCard() {
  const [paymentGateway, setPaymentGateway] = useState("mpesa_paybill");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/settings/mpesa?adminId=${ADMIN_ID}`)
      .then(response => response.json())
      .then((data: { settings?: { paymentGateway?: string } }) => {
        setPaymentGateway(ADMIN_PAYMENT_GATEWAY_OPTIONS.some(option => option.id === data.settings?.paymentGateway) ? data.settings?.paymentGateway || "mpesa_paybill" : "mpesa_paybill");
      })
      .catch(() => setError("Could not load your payment gateway settings."));
  }, []);

  const savePaymentGateway = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/admin/payment-gateway", {
        method: "POST",
        headers: adminApiHeaders(),
        body: JSON.stringify({ adminId: ADMIN_ID, paymentGateway }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save the payment gateway.");
      setSaved(true);
      window.dispatchEvent(new Event("ochola-payment-gateway-change"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the payment gateway.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Active Payment Gateway" desc="Switch this ISP’s payment gateway anytime — no Super Admin approval or passcode required">
      <Field label="Payment Gateway">
        <Select value={paymentGateway} onChange={event => { setPaymentGateway(event.target.value); setSaved(false); setError(""); }}>
          {ADMIN_PAYMENT_GATEWAY_OPTIONS.map(option => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </Select>
      </Field>
      <p style={{ color: C.muted, fontSize: "0.72rem", lineHeight: 1.5, margin: "10px 0 0" }}>
        This setting belongs to your ISP account. Select a different option at any time to switch the active gateway; only your normal ISP Admin sign-in is required.
      </p>
      {error && <p style={{ display: "flex", alignItems: "center", gap: 5, color: "#f87171", fontSize: "0.74rem", margin: "10px 0 0" }}><AlertTriangle size={13} aria-hidden="true" /> {error}</p>}
      {saved && <p style={{ display: "flex", alignItems: "center", gap: 5, color: "#34d399", fontSize: "0.74rem", margin: "10px 0 0" }}><Check size={13} aria-hidden="true" /> Payment gateway saved.</p>}
      <Row>
        <button
          type="button"
          onClick={savePaymentGateway}
          disabled={saving}
          style={{ display: "flex", alignItems: "center", gap: 6, background: C.cyan, border: "none", cursor: saving ? "wait" : "pointer", color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem", borderRadius: 8, fontFamily: "inherit", opacity: saving ? 0.7 : 1 }}
        >
          <Save size={13} /> {saving ? "Saving…" : "Save Payment Gateway"}
        </button>
      </Row>
    </Card>
  );
}

function BillingTab() {
  const [currency, setCurrency] = useState(() => {
    try { return localStorage.getItem("ochola_admin_currency") || "KES"; } catch { return "KES"; }
  });
  const [currencySaving, setCurrencySaving] = useState(false);
  const [vatEnabled, setVatEnabled] = useState(true);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [autoRenew, setAutoRenew] = useState(false);
  const [installments, setInstallments] = useState(false);

  return (
    <>
      <Card title="M-Pesa Integration" desc="Safaricom Daraja API credentials for STK push and C2B payments">
        <p style={{ color: C.muted, fontSize: "0.8rem", lineHeight: 1.55, margin: 0 }}>
          M-Pesa connection details and callback settings are managed centrally for this platform.
        </p>
      </Card>
      <AdminPaymentTestCard currency={currency} />

      <Card title="Billing Preferences" desc="Currency, VAT, grace periods, and invoice configuration">
        <Grid2>
          <Field label="Currency" hint="Applies across the entire platform">
            <Select value={currency} onChange={e => setCurrency(e.target.value)}>
              <option value="KES">KES — Kenyan Shilling (Ksh)</option>
              <option value="UGX">UGX — Ugandan Shilling (USh)</option>
              <option value="TZS">TZS — Tanzanian Shilling (TSh)</option>
              <option value="RWF">RWF — Rwandan Franc (RF)</option>
              <option value="ETB">ETB — Ethiopian Birr</option>
              <option value="NGN">NGN — Nigerian Naira (₦)</option>
              <option value="GHS">GHS — Ghanaian Cedi (GH₵)</option>
              <option value="ZAR">ZAR — South African Rand (R)</option>
              <option value="ZMW">ZMW — Zambian Kwacha (ZK)</option>
              <option value="MWK">MWK — Malawian Kwacha (MK)</option>
              <option value="XAF">XAF — Central African Franc (FCFA)</option>
              <option value="XOF">XOF — West African Franc (CFA)</option>
              <option value="EGP">EGP — Egyptian Pound (E£)</option>
              <option value="MAD">MAD — Moroccan Dirham (DH)</option>
              <option value="USD">USD — US Dollar ($)</option>
              <option value="GBP">GBP — British Pound (£)</option>
              <option value="EUR">EUR — Euro (€)</option>
              <option value="INR">INR — Indian Rupee (₹)</option>
              <option value="CAD">CAD — Canadian Dollar (CA$)</option>
              <option value="AUD">AUD — Australian Dollar (A$)</option>
            </Select>
          </Field>
          <Field label="Invoice Prefix" hint="e.g. INV → INV-0001"><Input defaultValue="INV" /></Field>
          <Field label="Invoice Starting Number"><Input defaultValue="1001" type="number" /></Field>
          <Field label="Default Payment Terms (days)"><Input defaultValue="7" type="number" /></Field>
        </Grid2>

        <div style={{ marginTop: 4 }}>
          {[
            { label: "Enable VAT / Tax on Invoices", desc: "Apply 16% VAT to all customer invoices", val: vatEnabled, fn: setVatEnabled },
            { label: "Grace Period After Expiry", desc: "Allow 3-day grace before cutting off service", val: gracePeriod, fn: setGracePeriod },
            { label: "Auto-Renew Active Plans", desc: "Automatically renew plans if M-Pesa balance is available", val: autoRenew, fn: setAutoRenew },
          { label: "Enable Installment Payments", desc: "Allow customers to pay plans in multiple installments (e.g. 3 parts)", val: installments, fn: setInstallments },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
              </div>
              <Toggle on={item.val} onChange={item.fn} />
            </div>
          ))}
        </div>
        <Row>
          <button
            onClick={async () => {
              setCurrencySaving(true);
              try {
                const { supabase: sb, ADMIN_ID: aid } = await import("@/lib/supabase");
                await sb.from("isp_admins").update({ currency }).eq("id", aid);
                localStorage.setItem("ochola_admin_currency", currency);
                window.dispatchEvent(new Event("ochola-currency-change"));
              } catch {}
              setCurrencySaving(false);
            }}
            disabled={currencySaving}
            style={{ display: "flex", alignItems: "center", gap: 6, background: C.cyan, border: "none", cursor: currencySaving ? "wait" : "pointer", color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem", borderRadius: 8, fontFamily: "inherit", opacity: currencySaving ? 0.7 : 1 }}>
            <Save size={13} /> {currencySaving ? "Saving…" : "Save Billing Settings"}
          </button>
        </Row>
      </Card>
    </>
  );
}

function SmsEmailTab() {
  const brand = useBrand();
  const [smsGateway, setSmsGateway] = useState("africastalking");
  const [smtpAuth, setSmtpAuth] = useState(true);

  return (
    <>
      <Card title="SMS Gateway" desc="Send OTPs, expiry alerts, and bulk SMS to customers">
        <Field label="SMS Provider">
          <Select value={smsGateway} onChange={e => setSmsGateway(e.target.value)}>
            <option value="africastalking">Africa's Talking</option>
            <option value="twilio">Twilio</option>
            <option value="vonage">Vonage (Nexmo)</option>
            <option value="custom">Custom HTTP API</option>
          </Select>
        </Field>
        {smsGateway === "africastalking" && (
          <Grid2>
            <Field label="Username"><Input defaultValue="ocholasupernet" /></Field>
            <Field label="API Key"><Input type="password" placeholder="•••••••••••••••••" /></Field>
            <Field label="Sender ID"><Input defaultValue="ISPLATTY" /></Field>
            <Field label="Environment">
              <Select defaultValue="live">
                <option value="sandbox">Sandbox</option>
                <option value="live">Live</option>
              </Select>
            </Field>
          </Grid2>
        )}
        {smsGateway === "twilio" && (
          <Grid2>
            <Field label="Account SID"><Input placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></Field>
            <Field label="Auth Token"><Input type="password" placeholder="•••••••••••••••••" /></Field>
            <Field label="From Number"><Input placeholder="+1234567890" /></Field>
          </Grid2>
        )}
        {smsGateway === "custom" && (
          <>
            <Field label="API Endpoint URL"><Input placeholder="https://sms.yourgw.com/send" /></Field>
            <Grid2>
              <Field label="Auth Header Name"><Input placeholder="Authorization" /></Field>
              <Field label="Auth Header Value"><Input type="password" placeholder="Bearer xxxxxxxx" /></Field>
            </Grid2>
          </>
        )}
        <Row><SaveBtn label="Save SMS Settings" /></Row>
      </Card>

      <Card title="Email / SMTP" desc="Outgoing email for invoices, welcome messages, and expiry alerts">
        <Grid2>
          <Field label="SMTP Host"><Input defaultValue="smtp.zoho.com" /></Field>
          <Field label="SMTP Port"><Input defaultValue="587" type="number" /></Field>
          <Field label="From Name"><Input defaultValue={brand.ispName} /></Field>
          <Field label="From Email"><Input defaultValue={`noreply@${brand.domain}`} type="email" /></Field>
          <Field label="SMTP Username"><Input defaultValue={`noreply@${brand.domain}`} /></Field>
          <Field label="SMTP Password"><Input type="password" placeholder="••••••••••" /></Field>
          <Field label="Encryption">
            <Select defaultValue="tls">
              <option value="none">None</option>
              <option value="ssl">SSL</option>
              <option value="tls">TLS (StartTLS)</option>
            </Select>
          </Field>
          <Field label="SMTP Authentication">
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <Toggle on={smtpAuth} onChange={setSmtpAuth} />
              <span style={{ fontSize: "0.8rem", color: C.muted }}>Require auth</span>
            </div>
          </Field>
        </Grid2>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <Mail size={13} /> Send Test Email
          </button>
          <SaveBtn label="Save SMTP Settings" />
        </div>
      </Card>

      <Card title="Test Messaging" desc="Send a test message through each configured channel to verify delivery">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Test SMS", desc: "Send a test SMS via your configured gateway", icon: Smartphone, color: "var(--isp-accent)" },
            { label: "Test WhatsApp", desc: "Send a test WhatsApp message", icon: MessageCircle, color: "#25d366" },
            { label: "Test Telegram", desc: "Send a test message to your Telegram bot", icon: Send, color: "#0088cc" },
            { label: "Test Email", desc: "Send a test email via SMTP", icon: Mail, color: "#f59e0b" },
          ].map((ch, i) => {
            const Icon = ch.icon;
            return (
              <button key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
                borderRadius: 10, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                transition: "border-color 0.2s",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${ch.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={16} style={{ color: ch.color }} />
                </div>
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: C.text, margin: 0 }}>{ch.label}</p>
                  <p style={{ fontSize: "0.68rem", color: C.muted, margin: "2px 0 0" }}>{ch.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        <Field label="Test Recipient Number / Email" hint="Enter the phone number or email to receive the test message">
          <Input placeholder="+254 700 000 000 or admin@example.com" style={{ marginTop: 8 }} />
        </Field>
      </Card>

      <Card title="WhatsApp Business" desc="WhatsApp messaging integration for customer notifications">
        <Grid2>
          <Field label="WhatsApp API Provider">
            <Select defaultValue="wabiz">
              <option value="wabiz">WhatsApp Business API</option>
              <option value="fonnte">Fonnte</option>
              <option value="dripsender">DripSender</option>
              <option value="custom">Custom HTTP API</option>
            </Select>
          </Field>
          <Field label="API Token"><Input type="password" placeholder="••••••••••" /></Field>
          <Field label="From Number"><Input placeholder="+254 700 000 000" /></Field>
          <Field label="Webhook URL (optional)"><Input placeholder="https://yourdomain.com/api/webhooks/whatsapp" /></Field>
        </Grid2>
        <Row><SaveBtn label="Save WhatsApp Settings" /></Row>
      </Card>

      <Card title="Telegram Bot" desc="Receive admin alerts and send notifications via Telegram">
        <Grid2>
          <Field label="Bot Token" hint="Get from @BotFather on Telegram"><Input type="password" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" /></Field>
          <Field label="Chat ID" hint="Your Telegram chat/group ID for receiving alerts"><Input placeholder="e.g. -1001234567890" /></Field>
        </Grid2>
        <Row><SaveBtn label="Save Telegram Settings" /></Row>
      </Card>

      <Card title="Notification Templates" desc="Customise the message sent to customers for each event">
        {[
          { label: "Welcome Message",       var: "{name}, {plan}, {expiry}" },
          { label: "Expiry Reminder (3 days)", var: "{name}, {plan}, {days}" },
          { label: "Account Expired",       var: "{name}, {plan}"          },
          { label: "Payment Received",      var: "{name}, {amount}, {plan}"},
          { label: "Voucher Activated",     var: "{name}, {code}, {expiry}"},
        ].map((t, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.label}</label>
              <span style={{ fontSize: "0.65rem", color: C.cyan, fontFamily: "monospace" }}>vars: {t.var}</span>
            </div>
            <textarea rows={2} style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box" }} placeholder={`Write template using ${t.var}`} />
          </div>
        ))}
        <Row><SaveBtn label="Save Templates" /></Row>
      </Card>
    </>
  );
}

function NetworkTab() {
  const [radiusEnabled, setRadiusEnabled] = useState(false);
  const [pppoeEnabled, setPppoeEnabled]   = useState(true);

  return (
    <>
      <Card title="MikroTik / RouterOS API" desc="Default API credentials used to push configs to managed routers">
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: "0.72rem", color: "#f59e0b", margin: 0 }}>These credentials are used to connect to all routers by default. Each router can also have its own credentials set per-device.</p>
        </div>
        <Grid2>
          <Field label="Default API Username"><Input defaultValue="api_admin" /></Field>
          <Field label="Default API Password"><Input type="password" placeholder="••••••••" /></Field>
          <Field label="API Port" hint="Default RouterOS API port"><Input defaultValue="8728" type="number" /></Field>
          <Field label="API SSL Port" hint="For encrypted API connections"><Input defaultValue="8729" type="number" /></Field>
          <Field label="SSH Port"><Input defaultValue="22" type="number" /></Field>
          <Field label="Connection Timeout (s)"><Input defaultValue="10" type="number" /></Field>
        </Grid2>
        <Row><SaveBtn label="Save Router Defaults" /></Row>
      </Card>

      <Card title="FreeRADIUS Server" desc="RADIUS server for PPPoE and hotspot authentication">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>Enable FreeRADIUS Authentication</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Use RADIUS for centralised user authentication</p>
          </div>
          <Toggle on={radiusEnabled} onChange={setRadiusEnabled} />
        </div>
        {radiusEnabled && (
          <Grid2>
            <Field label="RADIUS Server IP"><Input defaultValue="127.0.0.1" /></Field>
            <Field label="Auth Port"><Input defaultValue="1812" type="number" /></Field>
            <Field label="Acct Port"><Input defaultValue="1813" type="number" /></Field>
            <Field label="Shared Secret"><Input type="password" placeholder="••••••••••" /></Field>
            <Field label="NAS Identifier"><Input defaultValue="ocholasupernet-nas" /></Field>
            <Field label="NAS IP Address"><Input defaultValue="10.0.0.1" /></Field>
          </Grid2>
        )}
        <Row><SaveBtn label="Save RADIUS Settings" /></Row>
      </Card>

      <Card title="PPPoE Global Settings" desc="Default PPPoE server behaviour applied to all routers">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>PPPoE Server Enabled</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Toggle PPPoE service across all managed routers</p>
          </div>
          <Toggle on={pppoeEnabled} onChange={setPppoeEnabled} />
        </div>
        <Grid2>
          <Field label="Default Authentication">
            <Select defaultValue="chap">
              <option value="pap">PAP</option>
              <option value="chap">CHAP</option>
              <option value="mschap2">MS-CHAPv2</option>
            </Select>
          </Field>
          <Field label="Max MTU Size"><Input defaultValue="1480" type="number" /></Field>
          <Field label="Max MRU Size"><Input defaultValue="1480" type="number" /></Field>
          <Field label="Keepalive Timeout (s)"><Input defaultValue="10" type="number" /></Field>
          <Field label="Max Sessions Per User"><Input defaultValue="1" type="number" /></Field>
          <Field label="IP Pool Assignment">
            <Select defaultValue="dynamic">
              <option value="dynamic">Dynamic (from pool)</option>
              <option value="static">Static (fixed per user)</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save PPPoE Settings" /></Row>
      </Card>
    </>
  );
}

function HotspotTab() {
  const brand = useBrand();
  const [macAuth, setMacAuth]         = useState(false);
  const [trialEnabled, setTrial]      = useState(true);
  const [uamEnabled, setUam]          = useState(false);

  return (
    <>
      <Card title="Hotspot Server" desc="Global hotspot settings applied to all hotspot-enabled routers">
        <Grid2>
          <Field label="Login Page Template">
            <Select defaultValue="default">
              <option value="default">Default ({brand.ispName})</option>
              <option value="minimal">Minimal</option>
              <option value="branded">Branded with Logo</option>
              <option value="custom">Custom HTML</option>
            </Select>
          </Field>
          <Field label="Redirect After Login" hint="Where to send users after successful login">
            <Input defaultValue={`https://${brand.domain}`} />
          </Field>
          <Field label="Session Timeout (hours)" hint="Max time a session stays active"><Input defaultValue="24" type="number" /></Field>
          <Field label="Idle Timeout (minutes)" hint="Disconnect after this many idle minutes"><Input defaultValue="10" type="number" /></Field>
          <Field label="WALLED Garden URLs" hint="Comma-separated — accessible without login">
            <Input placeholder="isplatty.org, safaricom.com" />
          </Field>
          <Field label="DNS Domain"><Input defaultValue={`hotspot.${brand.domain}`} /></Field>
        </Grid2>

        {[
          { label: "MAC Address Authentication", desc: "Auto-login returning devices by MAC address",              val: macAuth,      fn: setMacAuth      },
          { label: "Enable Free Trials",          desc: "Allow new users to access a trial plan before paying",    val: trialEnabled, fn: setTrial        },
          { label: "UAM Hotspot Mode",            desc: "Forward login to a Universal Access Method (UAM) server", val: uamEnabled,   fn: setUam          },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <Row><SaveBtn label="Save Hotspot Settings" /></Row>
      </Card>

      <Card title="Voucher Settings" desc="How printed vouchers behave when activated">
        <Grid2>
          <Field label="Voucher Code Length"><Input defaultValue="8" type="number" /></Field>
          <Field label="Code Format">
            <Select defaultValue="alphanumeric">
              <option value="numeric">Numeric only</option>
              <option value="alpha">Letters only</option>
              <option value="alphanumeric">Alphanumeric (recommended)</option>
            </Select>
          </Field>
          <Field label="Default Batch Size"><Input defaultValue="50" type="number" /></Field>
          <Field label="Expiry After Activation">
            <Select defaultValue="plan">
              <option value="plan">Follow plan duration</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="never">Never (until used)</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save Voucher Settings" /></Row>
      </Card>
    </>
  );
}

function SecurityTab() {
  const [twoFa, setTwoFa]       = useState(false);
  const [ipWhitelist, setIpWL]  = useState(false);
  const [forceHttps, setHttps]  = useState(true);
  const [auditLog, setAudit]    = useState(true);
  const [singleSession, setSingleSession] = useState(false);
  const [csrfProtect, setCsrfProtect]     = useState(true);
  const [showApiKey, setShowKey] = useState(false);
  const [copied, setCopied]     = useState(false);
  const ADMIN_KEY = "demo_admin_key_xxxxxxxxxxxxxxxxxxxxxxxx";
  const SESSIONS = [
    { id: 1, device: "Chrome — Windows 11",   ip: "x.x.x.x", location: "Nairobi, KE", time: "Now",       current: true  },
    { id: 2, device: "Firefox — Ubuntu 22",   ip: "x.x.x.x", location: "Nairobi, KE", time: "1h ago",    current: false },
  ];

  function copy() { navigator.clipboard.writeText(ADMIN_KEY); setCopied(true); setTimeout(() => setCopied(false), 1800); }

  return (
    <>
      <Card title="Two-Factor Authentication" desc="Protect the admin panel with TOTP 2FA">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>Authenticator App (TOTP)</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Google Authenticator, Authy, or any TOTP app</p>
          </div>
          <Toggle on={twoFa} onChange={setTwoFa} />
        </div>
        {twoFa && (
          <div style={{ background: "rgba(37,99,235,0.07)", border: `1px solid rgba(37,99,235,0.25)`, borderRadius: 10, padding: 16, marginTop: 14, display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ width: 72, height: 72, background: "rgba(255,255,255,0.05)", border: `2px solid var(--isp-accent-border)`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Smartphone size={28} aria-hidden="true" style={{ color: C.cyan }} />
            </div>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, color: C.cyan, margin: "0 0 4px" }}>Scan QR Code</p>
              <p style={{ fontSize: "0.72rem", color: C.muted, margin: "0 0 8px" }}>Scan the QR code with your authenticator app to link it to this admin account.</p>
              <p style={{ fontSize: "0.7rem", fontFamily: "monospace", color: C.text, background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>JBSWY3DPEHPK3PXP (manual)</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input placeholder="Enter 6-digit code" style={{ background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 6, color: C.text, fontSize: "0.8rem", padding: "6px 10px", outline: "none", width: 140, fontFamily: "inherit" }} />
                <button style={{ background: C.cyan, border: "none", borderRadius: 6, color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}>Verify</button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Access Control" desc="Restrict and secure admin panel access">
        {[
          { label: "Force HTTPS",         desc: "Redirect all HTTP traffic to HTTPS",                          val: forceHttps, fn: setHttps },
          { label: "IP Whitelist",         desc: "Only allow admin access from specific IP addresses",          val: ipWhitelist,fn: setIpWL  },
          { label: "Admin Audit Log",      desc: "Log all admin actions (login, changes, deletions)",           val: auditLog,   fn: setAudit },
          { label: "Single Session Only",   desc: "Invalidate previous sessions when admin logs in from a new device", val: singleSession, fn: setSingleSession },
          { label: "CSRF Protection",       desc: "Require CSRF tokens on all form submissions",                      val: csrfProtect, fn: setCsrfProtect },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        {ipWhitelist && (
          <div style={{ marginTop: 10 }}>
            <Field label="Allowed IP Addresses" hint="One IP or CIDR range per line">
              <textarea rows={4} placeholder={"10.0.0.0/24\n197.x.x.x"} style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "monospace", resize: "none", outline: "none", boxSizing: "border-box" }} />
            </Field>
          </div>
        )}

        <Field label="Admin Session Timeout">
          <Select defaultValue="480">
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="480">8 hours</option>
            <option value="0">Never (not recommended)</option>
          </Select>
        </Field>
        <Row><SaveBtn label="Save Access Settings" /></Row>
      </Card>

      <Card title="Active Admin Sessions" desc="Devices currently signed into the admin panel">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SESSIONS.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: s.current ? "rgba(37,99,235,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${s.current ? "rgba(37,99,235,0.25)" : C.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Monitor size={16} style={{ color: s.current ? C.cyan : C.muted }} />
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>
                    {s.device}
                    {s.current && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: C.cyan, color: "white", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>This device</span>}
                  </p>
                  <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{s.ip} · {s.location} · {s.time}</p>
                </div>
              </div>
              {!s.current && <button style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}><LogOut size={12} /> Revoke</button>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
            <LogOut size={12} /> Sign out all other sessions
          </button>
        </div>
      </Card>

      <Card title="API Key" desc="For integrating with the ISP Management API from scripts or third-party apps">
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
          <Key size={13} style={{ color: C.muted, flexShrink: 0 }} />
          <span style={{ flex: 1, fontFamily: "monospace", fontSize: "0.78rem", color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>
            {showApiKey ? ADMIN_KEY : "demo_admin_key_••••••••••••••••••••••••"}
          </span>
          <button onClick={() => setShowKey(v => !v)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "2px" }}>
            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={copy} style={{ background: "none", border: "none", color: copied ? "#10b981" : C.muted, cursor: "pointer", padding: "2px" }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: C.cyan, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={12} /> Regenerate Key
          </button>
        </div>
      </Card>
    </>
  );
}

function NotificationsTab() {
  const brand = useBrand();
  const [email, setEmail]     = useState(true);
  const [sms, setSms]         = useState(false);
  const [newCust, setNewCust] = useState(true);
  const [expiry, setExpiry]   = useState(true);
  const [payment, setPayment] = useState(true);
  const [router, setRouter]   = useState(true);
  const [ticket, setTicket]   = useState(true);
  const [lowBal, setLowBal]   = useState(false);
  const [slack, setSlack]     = useState(false);
  const [remind1Day, setRemind1Day] = useState(true);
  const [remind3Day, setRemind3Day] = useState(true);
  const [remind7Day, setRemind7Day] = useState(false);

  return (
    <>
      <Card title="Admin Alert Channels" desc="How you want to receive system and customer alerts">
        {[
          { label: "Email Alerts",   desc: `Send alerts to ${brand.supportEmail}`,  val: email,  fn: setEmail,  icon: Mail },
          { label: "SMS Alerts",     desc: "Send alerts to +254 700 000 000",    val: sms,    fn: setSms,    icon: Smartphone },
          { label: "Slack Webhook",  desc: "Post alerts to a Slack channel",     val: slack,  fn: setSlack,  icon: MessageSquare },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(37,99,235,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={15} style={{ color: C.cyan }} />
                </div>
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                  <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
                </div>
              </div>
              <Toggle on={item.val} onChange={item.fn} />
            </div>
          );
        })}
        {slack && (
          <Field label="Slack Webhook URL">
            <Input placeholder="https://hooks.slack.com/services/TXXXXXXXX/BXXXXXXXX/xxxx" />
          </Field>
        )}
      </Card>

      <Card title="Alert Types" desc="Choose which events trigger an alert to the admin">
        {[
          { label: "New Customer Registration", desc: "Alert when a new customer signs up",                   val: newCust, fn: setNewCust },
          { label: "Customer Expiry Today",      desc: "Daily digest of expiring accounts",                   val: expiry,  fn: setExpiry  },
          { label: "Payment Received",           desc: "Alert on every M-Pesa or manual payment",             val: payment, fn: setPayment },
          { label: "Router Goes Offline",        desc: "Notify immediately if a managed router disconnects",  val: router,  fn: setRouter  },
          { label: "New Support Ticket",         desc: "Alert when a customer submits a ticket",              val: ticket,  fn: setTicket  },
          { label: "Low Airtime Balance",        desc: "Warn when SMS gateway credit runs below threshold",   val: lowBal,  fn: setLowBal  },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <Row><SaveBtn label="Save Notification Settings" /></Row>
      </Card>

      <Card title="Customer Expiry Reminders" desc="Automatically notify customers before their plan expires">
        {[
          { label: "1-Day Reminder", desc: "Send a reminder 1 day before the plan expires", val: remind1Day, fn: setRemind1Day },
          { label: "3-Day Reminder", desc: "Send a reminder 3 days before the plan expires", val: remind3Day, fn: setRemind3Day },
          { label: "7-Day Reminder", desc: "Send a reminder 7 days before the plan expires", val: remind7Day, fn: setRemind7Day },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Clock size={15} style={{ color: "#f59e0b" }} />
              </div>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
              </div>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <Field label="Reminder Message Template" hint="Variables: {name}, {plan}, {days}, {expiry_date}">
          <textarea rows={2} defaultValue="Hi {name}, your {plan} plan expires in {days} day(s) on {expiry_date}. Please renew to avoid disconnection." style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box" }} />
        </Field>
        <Field label="Reminder Channel">
          <Select defaultValue="both">
            <option value="sms">SMS Only</option>
            <option value="email">Email Only</option>
            <option value="whatsapp">WhatsApp Only</option>
            <option value="both">SMS + Email</option>
            <option value="all">All Channels</option>
          </Select>
        </Field>
        <Row><SaveBtn label="Save Reminder Settings" /></Row>
      </Card>
    </>
  );
}

function DashboardBuilderTab() {
  const { preferences, loading, saving, savePreferences } = useDashboardPreferences();
  const [draft, setDraft] = useState<DashboardPreferences>(preferences);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const updateDraft = (change: Partial<DashboardPreferences>) => {
    setDraft(current => ({ ...current, ...change }));
    setSaved(false);
    setError("");
  };

  const saveDashboardPreferences = async () => {
    setError("");
    setSaved(false);
    try {
      await savePreferences(draft);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard appearance could not be saved.");
    }
  };

  const previewStyle = {
    "--dashboard-accent": draft.accentColor,
    "--dashboard-accent-glow": `${draft.accentColor}1a`,
    "--dashboard-accent-border": `${draft.accentColor}45`,
  } as React.CSSProperties;

  return (
    <>
      <Card title="Dashboard Page Builder" desc="Personalize your ISP dashboard and captive portal without changing live data or access controls.">
        <div className="dashboard-builder-grid">
          <div className="dashboard-builder-controls">
            <div className="dashboard-builder-control-group">
              <div className="dashboard-builder-control-heading">
                <div>
                  <p>Accent color</p>
                   <span>Used for live status, links, highlights, dashboard actions, and this ISP's captive portal.</span>
                </div>
                <label className="dashboard-color-input" style={{ background: draft.accentColor }}>
                  <input
                    type="color"
                    value={draft.accentColor}
                    aria-label="Choose dashboard accent color"
                    onChange={event => updateDraft({ accentColor: event.target.value })}
                  />
                </label>
              </div>
              <div className="dashboard-color-presets">
                {DASHBOARD_COLOR_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`dashboard-color-swatch${draft.accentColor === preset.value ? " dashboard-color-swatch--selected" : ""}`}
                    style={{ background: preset.value }}
                    aria-label={`Use ${preset.name}`}
                    aria-pressed={draft.accentColor === preset.value}
                    title={preset.name}
                    onClick={() => updateDraft({ accentColor: preset.value })}
                  />
                ))}
              </div>
            </div>

            <div className="dashboard-builder-control-group">
              <div className="dashboard-builder-control-heading">
                <div>
                  <p>Card shape</p>
                  <span>Set the visual weight of dashboard panels and summary cards.</span>
                </div>
              </div>
              <div className="dashboard-builder-options dashboard-builder-shape-options">
                {DASHBOARD_SHAPE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`dashboard-builder-option${draft.cardShape === option.value ? " dashboard-builder-option--selected" : ""}`}
                    aria-pressed={draft.cardShape === option.value}
                    onClick={() => updateDraft({ cardShape: option.value })}
                  >
                    <span className={`dashboard-option-shape dashboard-option-shape--${option.value}`} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                    {draft.cardShape === option.value && <Check size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="dashboard-builder-control-group">
              <div className="dashboard-builder-control-heading">
                <div>
                  <p>Layout template</p>
                  <span>Choose how much space the dashboard gives each information group.</span>
                </div>
              </div>
              <div className="dashboard-builder-options">
                {DASHBOARD_LAYOUT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`dashboard-builder-option${draft.layout === option.value ? " dashboard-builder-option--selected" : ""}`}
                    aria-pressed={draft.layout === option.value}
                    onClick={() => updateDraft({ layout: option.value })}
                  >
                    <span className={`dashboard-option-layout dashboard-option-layout--${option.value}`}><i /><i /><i /><i /></span>
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                    {draft.layout === option.value && <Check size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="dashboard-builder-control-group">
              <div className="dashboard-builder-control-heading">
                <div>
                  <p>Financial amounts</p>
                  <span>Hide income and revenue figures on the dashboard while keeping transaction counts visible.</span>
                </div>
                <Toggle label="Hide financial amounts" on={draft.hideAmounts} onChange={(hideAmounts) => updateDraft({ hideAmounts })} />
              </div>
            </div>

            {error && <p className="dashboard-builder-message dashboard-builder-message--error" role="alert">{error}</p>}
            {saved && <p className="dashboard-builder-message dashboard-builder-message--success" role="status">Dashboard appearance saved for this ISP.</p>}
            <Row>
              <button
                type="button"
                className="dashboard-builder-save"
                onClick={saveDashboardPreferences}
                disabled={loading || saving}
              >
                <Save size={14} /> {saving ? "Saving…" : "Save Dashboard Appearance"}
              </button>
            </Row>
          </div>

          <div className="dashboard-builder-preview-wrap">
            <div className="dashboard-builder-preview-label"><Monitor size={14} /> Live preview</div>
            <div className={`dashboard-builder-preview dashboard-page--${draft.layout} dashboard-shape--${draft.cardShape}`} style={previewStyle}>
              <div className="dashboard-preview-hero">
                <div><span className="dashboard-preview-eyebrow">Live operations</span><strong>Good afternoon</strong><small>Network pulse, customer activity, and cashflow in one view.</small></div>
                <span className="dashboard-preview-date">28 Aug 2026</span>
              </div>
              <div className="dashboard-preview-section-label"><i>01</i><span>Financial pulse</span><small>Live payment activity</small></div>
              <div className="dashboard-preview-kpis">
                {[
                   { label: "Income today", value: draft.hideAmounts ? "••••" : "Ksh 48,200", tone: "dashboard-preview-kpi--accent", icon: <Banknote size={10} /> },
                   { label: "Income this month", value: draft.hideAmounts ? "••••" : "Ksh 412,800", tone: "dashboard-preview-kpi--green", icon: <TrendingUp size={10} /> },
                  { label: "Total transactions", value: "1,248", tone: "dashboard-preview-kpi--amber", icon: <ReceiptText size={10} /> },
                   { label: "Total revenue", value: draft.hideAmounts ? "••••" : "Ksh 1.8M", tone: "dashboard-preview-kpi--plum", icon: <BarChart3 size={10} /> },
                ].map(({ label, value, tone, icon }) => (
                  <div key={label} className={`dashboard-preview-kpi ${tone}`}><span className="dashboard-preview-icon">{icon}</span><span><strong>{value}</strong><small>{label}</small></span></div>
                ))}
              </div>
               <div className="dashboard-preview-stats">{["Total online users", "PPPoE online", "Hotspot online", "Static online"].map(label => <span key={label}><i />{label}</span>)}</div>
              <div className="dashboard-preview-section-label"><i>02</i><span>Network health</span><small>Heartbeat window</small></div>
              <div className="dashboard-preview-network">
                {["Core Router", "Westlands POP", "Ruiru Edge"].map((label, index) => (
                  <span key={label}><i className={index === 2 ? "is-offline" : ""} /><strong>{label}</strong><small>{index === 2 ? "Offline" : "Online"}</small></span>
                ))}
              </div>
              <div className="dashboard-preview-section-label"><i>03</i><span>Customer intelligence</span><small>Growth & mix</small></div>
              <div className="dashboard-preview-panels">
                <div className="dashboard-preview-panel dashboard-preview-panel--wide"><span className="dashboard-preview-panel-title">Customer growth</span><div className="dashboard-preview-chart"><i /><i /><i /><i /><i /><i /></div></div>
                <div className="dashboard-preview-panel"><span className="dashboard-preview-panel-title">Payment gateway</span><div className="dashboard-preview-line"><i /> Active</div><div className="dashboard-preview-line dashboard-preview-line--muted">M-Pesa PayBill</div></div>
              </div>
              <div className="dashboard-preview-footer"><span>Recent transactions</span><strong>View all activity →</strong></div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="What this changes" desc="Your dashboard builder only controls presentation for this ISP.">
        <div className="dashboard-builder-notes">
          <div><Palette size={16} /><span><strong>Brand-aware</strong><small>Appearance is saved to this ISP account and copied only to this ISP's captive portal.</small></span></div>
          <div><LayoutDashboard size={16} /><span><strong>Data stays live</strong><small>Router health, customer counts, charts, transactions, and loading states are unchanged.</small></span></div>
          <div><Shield size={16} /><span><strong>Tenant-isolated</strong><small>Other ISP administrators and their users never receive this account's dashboard or portal colors.</small></span></div>
        </div>
      </Card>
    </>
  );
}

function SystemTab() {
  const [maintenance, setMaintenance] = useState(false);
  const [autoBackup, setAutoBackup]   = useState(true);
  const [debugMode, setDebug]         = useState(false);

  return (
    <>
      <Card title="Dashboard Widgets" desc="Choose which widgets are visible on your admin dashboard">
        {[
          { label: "Monthly Revenue Chart", key: "hide_mrc", desc: "Revenue trend graph on the dashboard", val: true },
          { label: "Top-Up / M-Pesa Summary", key: "hide_tms", desc: "Recent M-Pesa transactions summary", val: true },
          { label: "Activity Log", key: "hide_al", desc: "Latest admin actions and events", val: true },
          { label: "User Expiry Timeline", key: "hide_uet", desc: "Customers expiring soon timeline", val: true },
          { label: "Voucher Stats", key: "hide_vs", desc: "Active / used / expired voucher counts", val: true },
          { label: "Payment Gateway Status", key: "hide_pg", desc: "Current payment gateway health", val: false },
          { label: "Active Users Info", key: "hide_aui", desc: "Real-time connected users count", val: true },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <LayoutDashboard size={14} style={{ color: C.cyan, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
              </div>
            </div>
            <Toggle on={item.val} onChange={() => {}} />
          </div>
        ))}
        <Row><SaveBtn label="Save Dashboard Layout" /></Row>
      </Card>

      <Card title="Theme & Appearance" desc="Customize the look and feel of the admin panel">
        <Grid2>
          <Field label="Admin Panel Theme">
            <Select defaultValue="dark-blue">
              <option value="dark-blue">Dark Blue (Default)</option>
              <option value="dark-blue">Dark Blue</option>
              <option value="dark-green">Dark Green</option>
              <option value="dark-purple">Dark Purple</option>
              <option value="light">Light Mode</option>
              <option value="auto">System Auto</option>
            </Select>
          </Field>
          <Field label="Customer Portal Theme">
            <Select defaultValue="modern-dark">
              <option value="modern-dark">Modern Dark</option>
              <option value="modern-light">Modern Light</option>
              <option value="classic">Classic</option>
              <option value="minimal">Minimal</option>
              <option value="branded">Branded (uses ISP colors)</option>
            </Select>
          </Field>
          <Field label="Accent Color" hint="Primary color used for buttons, links, and highlights">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["var(--isp-accent)","#8b5cf6","#ec4899","#10b981","#f59e0b","#ef4444"].map(color => (
                <button key={color} style={{ width: 32, height: 32, borderRadius: 8, background: color, border: color === "var(--isp-accent)" ? "2px solid white" : "2px solid transparent", cursor: "pointer", transition: "transform 0.1s" }} />
              ))}
            </div>
          </Field>
          <Field label="Sidebar Style">
            <Select defaultValue="collapsed">
              <option value="expanded">Always Expanded</option>
              <option value="collapsed">Collapsed (hover to expand)</option>
              <option value="compact">Compact Icons Only</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save Theme" /></Row>
      </Card>

      <Card title="System Preferences" desc="Timezone, date format, and localisation">
        <Grid2>
          <Field label="System Timezone">
            <Select defaultValue="Africa/Nairobi">
              <option value="Africa/Nairobi">Africa/Nairobi (EAT +3)</option>
              <option value="Africa/Lagos">Africa/Lagos (WAT +1)</option>
              <option value="UTC">UTC ±0</option>
            </Select>
          </Field>
          <Field label="Date Format">
            <Select defaultValue="DD/MM/YYYY">
              <option>DD/MM/YYYY</option>
              <option>MM/DD/YYYY</option>
              <option>YYYY-MM-DD</option>
            </Select>
          </Field>
          <Field label="Time Format">
            <Select defaultValue="24h">
              <option value="12h">12-hour (2:30 PM)</option>
              <option value="24h">24-hour (14:30)</option>
            </Select>
          </Field>
          <Field label="Default Language">
            <Select defaultValue="en">
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save Preferences" /></Row>
      </Card>

      <Card title="Data & Backups" desc="Database backup and restore settings">
        {[
          { label: "Automatic Daily Backup", desc: "Backup database to cloud storage every 24 hours", val: autoBackup, fn: setAutoBackup },
          { label: "Debug Mode",             desc: "Log detailed error traces (disable on production)", val: debugMode,  fn: setDebug     },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <RefreshCw size={13} /> Backup Now
          </button>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <Upload size={13} /> Restore Backup
          </button>
          <SaveBtn label="Save Backup Settings" />
        </div>
      </Card>

      <Card title="Maintenance Mode" desc="Take the portal offline for all customers while you make changes">
        <div style={{ background: maintenance ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${maintenance ? "rgba(239,68,68,0.35)" : C.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 700, color: maintenance ? "#ef4444" : C.text, margin: 0 }}>
                {maintenance ? <><AlertTriangle size={14} aria-hidden="true" /> Maintenance Mode is ACTIVE</> : "Maintenance Mode"}
              </p>
              <p style={{ fontSize: "0.72rem", color: C.muted, margin: "3px 0 0" }}>
                {maintenance ? "All customers see the maintenance page right now." : "Customers see a maintenance page; admin panel remains accessible."}
              </p>
            </div>
            <Toggle on={maintenance} onChange={setMaintenance} />
          </div>
          {maintenance && (
            <div style={{ marginTop: 12 }}>
              <Field label="Maintenance Message">
                <textarea rows={2} defaultValue="We are performing scheduled maintenance. We'll be back shortly. Thank you for your patience." style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box" }} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card title="System Information" desc="Current software and environment details">
        {[
          ["Platform",        "ISP Management v2.6.0"],
          ["Database",        "PostgreSQL 15.4"],
          ["Runtime",         "Node.js 20.x / Express 5"],
          ["Last Backup",     "Mar 27, 2026 — 02:00 EAT"],
          ["Disk Usage",      "4.2 GB / 50 GB"],
          ["Active Customers","247"],
          ["Online Now",      "38"],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: "0.78rem", color: C.muted }}>{k}</span>
            <span style={{ fontSize: "0.78rem", color: C.text, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

function PluginsTab() {
  const PLUGINS = [
    { name: "MikrotikHotspot", desc: "Hotspot authentication and session management for MikroTik routers", author: "OcholaSupernet", status: "active", version: "2.1.0" },
    { name: "MikrotikPPPoE", desc: "PPPoE server configuration and user provisioning", author: "OcholaSupernet", status: "active", version: "2.0.3" },
    { name: "Radius", desc: "FreeRADIUS integration for centralised authentication", author: "OcholaSupernet", status: "inactive", version: "1.5.0" },
    { name: "MpesaDaraja", desc: "Safaricom M-Pesa STK Push and C2B payment processing", author: "OcholaSupernet", status: "active", version: "3.0.1" },
    { name: "SmsGateway", desc: "SMS notification gateway (Africa's Talking, Twilio, Vonage)", author: "OcholaSupernet", status: "active", version: "1.2.0" },
    { name: "VoucherEngine", desc: "Bulk voucher generation, validation, and redemption", author: "OcholaSupernet", status: "active", version: "2.0.0" },
    { name: "OpenVPNBridge", desc: "OpenVPN tunnel management for remote router access", author: "OcholaSupernet", status: "active", version: "1.1.0" },
    { name: "CustomerPortal", desc: "Self-service customer portal with account management", author: "OcholaSupernet", status: "active", version: "2.3.0" },
  ];

  return (
    <>
      <Card title="Installed Plugins" desc="Device drivers and feature modules loaded by the platform">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {PLUGINS.map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px", borderRadius: 10,
              background: p.status === "active" ? "rgba(37,99,235,0.04)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${p.status === "active" ? "var(--isp-accent-glow)" : C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: p.status === "active" ? "var(--isp-accent-glow)" : "rgba(255,255,255,0.05)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Puzzle size={16} style={{ color: p.status === "active" ? C.cyan : C.muted }} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontSize: "0.84rem", fontWeight: 700, color: C.text, margin: 0 }}>{p.name}</p>
                    <span style={{
                      fontSize: "0.6rem", fontWeight: 700, borderRadius: 4, padding: "1px 6px",
                      background: p.status === "active" ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)",
                      color: p.status === "active" ? "#10b981" : C.muted,
                    }}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>
                    <span style={{ fontSize: "0.62rem", color: C.muted, fontFamily: "monospace" }}>v{p.version}</span>
                  </div>
                  <p style={{ fontSize: "0.72rem", color: C.muted, margin: "2px 0 0" }}>{p.desc}</p>
                  <p style={{ fontSize: "0.62rem", color: C.muted, margin: "2px 0 0", opacity: 0.7 }}>by {p.author}</p>
                </div>
              </div>
              <Toggle on={p.status === "active"} onChange={() => {}} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Add Plugin" desc="Upload or install additional device drivers and modules">
        <div style={{
          border: `2px dashed ${C.border}`, borderRadius: 12, padding: "2rem",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          cursor: "pointer", transition: "border-color 0.2s",
        }}>
          <Upload size={24} style={{ color: C.muted }} />
          <p style={{ fontSize: "0.84rem", fontWeight: 600, color: C.text, margin: 0 }}>Upload Plugin Package</p>
          <p style={{ fontSize: "0.72rem", color: C.muted, margin: 0 }}>Drag and drop a .zip plugin file or click to browse</p>
        </div>
      </Card>
    </>
  );
}

// ─── Payment Gateways Tab ────────────────────────────────────────────────────

interface GatewayField {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  type?: "text" | "select";
  options?: string[];
}

interface GatewayDef {
  id: string;
  name: string;
  category: string;
  color: string;
  icon: React.ElementType;
  fields: GatewayField[];
}

const KENYAN_BANKS = [
  "Absa Bank Kenya", "Access Bank Kenya", "ABC Bank", "Bank of Africa",
  "Bank of Baroda", "Bank of India", "Citibank Kenya", "Co-operative Bank",
  "Consolidated Bank", "Credit Bank", "Development Bank of Kenya",
  "Diamond Trust Bank", "Dubai Islamic Bank", "Ecobank Kenya", "Equity Bank",
  "Family Bank", "Guaranty Trust Bank", "Gulf African Bank", "Habib Bank AG Zurich",
  "I&M Bank", "KCB Bank", "Kenya Post Office Savings Bank", "Kingdom Bank",
  "Mayfair Bank", "M-Oriental Bank", "National Bank of Kenya", "NCBA Bank",
  "Paramount Universal Bank", "Prime Bank", "SBM Bank Kenya", "Sidian Bank",
  "Spire Bank", "Stanbic Bank", "Standard Chartered Bank", "UBA Kenya",
  "Victoria Commercial Bank",
];

const GATEWAYS: GatewayDef[] = [
  {
    id: "mpesa_paybill", name: "M-Pesa PayBill", category: "Mobile Money", color: "#00a651", icon: Phone,
    fields: [
      { key: "paybillNumber", label: "PayBill Number", hint: "Enter the PayBill number used by this ISP" },
      { key: "accountNumber", label: "Account / Business Number", hint: "Enter the account or business number required by this PayBill" },
    ],
  },
  {
    id: "mpesa_till_push", name: "M-Pesa Till Push", category: "Mobile Money", color: "#00a651", icon: Phone,
    fields: [
      { key: "tillNumber", label: "Buy Goods Till Number", hint: "Enter the Till Number used by this ISP" },
    ],
  },
  {
    id: "bank_stk_push", name: "BankStkPush", category: "Kenyan Banks", color: "#00529b", icon: Landmark,
    fields: [
      { key: "bankName", label: "Bank Name", type: "select", options: KENYAN_BANKS },
      { key: "paybillNumber", label: "PayBill Number", hint: "Enter the PayBill number provided by your bank" },
      { key: "accountNumber", label: "Account / Business Number", hint: "Enter the account or business number required by the bank" },
    ],
  },
  {
    id: "airtel", name: "AirtelMoney", category: "Mobile Money", color: "#e4002b", icon: Phone,
    fields: [
      { key: "clientId", label: "Client ID", secret: true },
      { key: "clientSecret", label: "Client Secret", secret: true },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "azampay", name: "AzamPay", category: "International", color: "#0066cc", icon: CreditCard,
    fields: [
      { key: "appName", label: "App Name" },
      { key: "clientId", label: "Client ID", secret: true },
      { key: "clientSecret", label: "Client Secret", secret: true },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "custom_paybill", name: "CustomPaybill", category: "Mobile Money", color: "#059669", icon: Phone,
    fields: [
      { key: "paybillNumber", label: "Paybill Number" },
      { key: "accountNumber", label: "Account Number" },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "dpo_payments", name: "DpoPayments", category: "International", color: "#1e40af", icon: CreditCard,
    fields: [
      { key: "companyToken", label: "Company Token", secret: true },
      { key: "serviceType", label: "Service Type" },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "flutterwave", name: "Flutterwave", category: "International", color: "#f5a623", icon: CreditCard,
    fields: [
      { key: "publicKey", label: "Public Key" },
      { key: "secretKey", label: "Secret Key", secret: true },
      { key: "encryptionKey", label: "Encryption Key", secret: true },
    ],
  },
  {
    id: "intasend", name: "Intasend", category: "International", color: "#6d28d9", icon: CreditCard,
    fields: [
      { key: "publishableKey", label: "Publishable Key" },
      { key: "secretKey", label: "Secret Key", secret: true },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "pesapal", name: "PesaPal", category: "International", color: "#003087", icon: CreditCard,
    fields: [
      { key: "consumerKey", label: "Consumer Key", secret: true },
      { key: "consumerSecret", label: "Consumer Secret", secret: true },
      { key: "callbackUrl", label: "IPN Callback URL" },
    ],
  },
  {
    id: "stripe", name: "Stripe", category: "International", color: "#635bff", icon: CreditCard,
    fields: [
      { key: "publishableKey", label: "Publishable Key" },
      { key: "secretKey", label: "Secret Key", secret: true },
      { key: "webhookSecret", label: "Webhook Secret", secret: true },
    ],
  },
  {
    id: "paypal", name: "PayPal", category: "International", color: "#003087", icon: CreditCard,
    fields: [
      { key: "clientId", label: "Client ID", secret: true },
      { key: "clientSecret", label: "Client Secret", secret: true },
      { key: "webhookUrl", label: "Webhook URL" },
    ],
  },
  {
    id: "tigopesa", name: "TigoPesa", category: "Mobile Money", color: "#0077c8", icon: Phone,
    fields: [
      { key: "accountId", label: "Account ID" },
      { key: "apiKey", label: "API Key", secret: true },
      { key: "apiSecret", label: "API Secret", secret: true },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "xendit", name: "XenditEwallet", category: "International", color: "#0d9488", icon: CreditCard,
    fields: [
      { key: "apiKey", label: "API Key", secret: true },
      { key: "callbackUrl", label: "Callback URL" },
    ],
  },
  {
    id: "manual", name: "Cash / Manual", category: "Manual", color: "#64748b", icon: Banknote,
    fields: [
      { key: "bankName", label: "Bank Name" },
      { key: "accountName", label: "Account Name" },
      { key: "accountNumber", label: "Account Number" },
      { key: "branchCode", label: "Branch Code" },
      { key: "paymentInstructions", label: "Payment Instructions", hint: "Instructions shown to customers on how to pay" },
    ],
  },
];

function PaymentGatewaysTab() {
  const brand = useBrand();
  const [selectedGw, setSelectedGw] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const s = localStorage.getItem("ochola_gw_fields");
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [savingGateway, setSavingGateway] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [routingMode, setRoutingMode] = useState<"shared" | "separate">("shared");
  const [routingServices, setRoutingServices] = useState<Record<"hotspot" | "pppoe", { gatewayId: string; config: Record<string, string> }>>({
    hotspot: { gatewayId: "mpesa_paybill", config: {} },
    pppoe: { gatewayId: "mpesa_paybill", config: {} },
  });
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingSaved, setRoutingSaved] = useState(false);
  const [routingError, setRoutingError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/mpesa-gateway-config?adminId=${ADMIN_ID}`)
      .then(response => response.ok ? response.json() : null)
      .then((data: { configs?: Record<string, Record<string, string>> } | null) => {
        const configs = data?.configs;
        if (!configs) return;
        setFields(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(configs).map(([gatewayId, config]) => [
              gatewayId,
              { ...(prev[gatewayId] || {}), ...config },
            ]),
          ),
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/admin/payment-routing?adminId=${ADMIN_ID}`, { headers: adminApiHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then((data: {
        mode?: "shared" | "separate";
        services?: Record<"hotspot" | "pppoe", { gatewayId?: string; config?: Record<string, string> }>;
      } | null) => {
        if (!data) return;
        setRoutingMode(data.mode === "separate" ? "separate" : "shared");
        setRoutingServices(prev => ({
          hotspot: { gatewayId: data.services?.hotspot?.gatewayId || prev.hotspot.gatewayId, config: data.services?.hotspot?.config || prev.hotspot.config },
          pppoe: { gatewayId: data.services?.pppoe?.gatewayId || prev.pppoe.gatewayId, config: data.services?.pppoe?.config || prev.pppoe.config },
        }));
      })
      .catch(() => {});
  }, []);

  const updateField = (gwId: string, fieldKey: string, value: string) => {
    setFields(prev => ({
      ...prev,
      [gwId]: { ...(prev[gwId] || {}), [fieldKey]: value },
    }));
  };

  const saveGateway = async (gwId: string) => {
    setSaveError("");
    setSavingGateway(gwId);
    try { localStorage.setItem("ochola_gw_fields", JSON.stringify(fields)); } catch {}
    try {
      if (gwId === "bank_stk_push" || gwId === "mpesa_till_push" || gwId === "mpesa_paybill") {
        const response = await fetch("/api/admin/mpesa-gateway-config", {
          method: "POST",
          headers: adminApiHeaders(),
          body: JSON.stringify({ adminId: ADMIN_ID, gatewayId: gwId, config: fields[gwId] || {} }),
        });
        const data = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not save M-Pesa gateway settings.");
        window.dispatchEvent(new Event("ochola-payment-gateway-change"));
      }
      setSaved(gwId);
      setTimeout(() => setSaved(null), 2000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save payment gateway settings.");
    } finally {
      setSavingGateway(null);
    }
  };

  const updateRoutingConfig = (service: "hotspot" | "pppoe", key: string, value: string) => {
    setRoutingServices(prev => ({
      ...prev,
      [service]: {
        ...prev[service],
        config: { ...prev[service].config, [key]: value },
      },
    }));
  };

  const saveRouting = async () => {
    setRoutingError("");
    setRoutingSaving(true);
    setRoutingSaved(false);
    try {
      const response = await fetch("/api/admin/payment-routing", {
        method: "POST",
        headers: adminApiHeaders(),
        body: JSON.stringify({
          adminId: ADMIN_ID,
          mode: routingMode,
          services: routingMode === "separate" ? routingServices : undefined,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save payment routing.");
      setRoutingSaved(true);
      setTimeout(() => setRoutingSaved(false), 2200);
      window.dispatchEvent(new Event("ochola-payment-gateway-change"));
    } catch (error) {
      setRoutingError(error instanceof Error ? error.message : "Could not save payment routing.");
    } finally {
      setRoutingSaving(false);
    }
  };

  const routingGatewayOptions = GATEWAYS.filter(gateway =>
    gateway.id === "mpesa_paybill" || gateway.id === "mpesa_till_push" || gateway.id === "bank_stk_push"
  );
  const routingFields = (gatewayId: string) => GATEWAYS.find(gateway => gateway.id === gatewayId)?.fields ?? [];

  const activeGw = GATEWAYS.find(g => g.id === selectedGw);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, background: "rgba(37,99,235,0.06)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: "0.74rem", lineHeight: 1.45 }}>
        Select one active payment gateway for this ISP. You can switch to another gateway whenever needed without Super Admin approval.
      </div>
      <AdminPaymentGatewayCard />

      <Card title="Service payment routing" desc="Use one collection account for both services, or send Hotspot and PPPoE payments to separate M-Pesa destinations. API credentials remain managed centrally by Super Admin.">
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {([
            ["shared", "Shared account", "One destination for Hotspot and PPPoE"],
            ["separate", "Separate accounts", "Different destination per service"],
          ] as const).map(([value, label, description]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRoutingMode(value)}
              style={{
                flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                fontFamily: "inherit", background: routingMode === value ? "rgba(8,145,178,.15)" : C.card,
                color: C.text, border: `1px solid ${routingMode === value ? C.cyan : C.border}`,
              }}
            >
              <div style={{ fontSize: "0.82rem", fontWeight: 800 }}>{label}</div>
              <div style={{ color: C.muted, fontSize: "0.7rem", marginTop: 4 }}>{description}</div>
            </button>
          ))}
        </div>
        {routingMode === "shared" ? (
          <p style={{ color: C.muted, fontSize: "0.75rem", lineHeight: 1.5, margin: "0 0 14px" }}>
            Both plan types use the active gateway and destination configured below. Save the gateway details first, then save this routing choice.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {(["hotspot", "pppoe"] as const).map(service => {
              const serviceGateway = routingServices[service].gatewayId;
              const fieldsForGateway = routingFields(serviceGateway);
              return (
                <div key={service} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ color: C.text, fontSize: "0.82rem", fontWeight: 800 }}>{service === "hotspot" ? "Hotspot payments" : "PPPoE payments"}</div>
                      <div style={{ color: C.muted, fontSize: "0.7rem", marginTop: 3 }}>Collection destination for {service.toUpperCase()} plans</div>
                    </div>
                    <Select
                      value={serviceGateway}
                      onChange={event => setRoutingServices(prev => ({
                        ...prev,
                        [service]: { gatewayId: event.target.value, config: {} },
                      }))}
                      style={{ width: 190 }}
                    >
                      {routingGatewayOptions.map(gateway => <option key={gateway.id} value={gateway.id}>{gateway.name}</option>)}
                    </Select>
                  </div>
                  {fieldsForGateway.map(field => (
                    <div key={field.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0" }}>
                      <label style={{ width: 170, flexShrink: 0, color: C.muted, fontSize: "0.72rem", textAlign: "right" }}>{field.label}</label>
                      {field.type === "select" && field.options ? (
                        <Select
                          value={routingServices[service].config[field.key] || ""}
                          onChange={event => updateRoutingConfig(service, field.key, event.target.value)}
                        >
                          <option value="">-- Select --</option>
                          {field.options.map(option => <option key={option} value={option}>{option}</option>)}
                        </Select>
                      ) : (
                        <Input
                          value={routingServices[service].config[field.key] || ""}
                          onChange={event => updateRoutingConfig(service, field.key, event.target.value)}
                          placeholder={field.hint || `Enter ${field.label.toLowerCase()}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {routingError && <p style={{ color: "#f87171", fontSize: "0.74rem", margin: "12px 0 0" }}><AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{routingError}</p>}
        <Row>
          <button
            type="button"
            onClick={saveRouting}
            disabled={routingSaving}
            style={{ display: "flex", alignItems: "center", gap: 6, background: routingSaved ? "#10b981" : C.cyan, border: "none", cursor: "pointer", color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem", borderRadius: 8, fontFamily: "inherit", opacity: routingSaving ? 0.65 : 1 }}
          >
            {routingSaved ? <><Check size={13} /> Saved!</> : routingSaving ? "Saving…" : <><Save size={13} /> Save routing</>}
          </button>
        </Row>
      </Card>

      <Card title="Payment Gateway Configurations" desc="Add or update the account details for the payment gateways available to this ISP.">
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8,
          marginBottom: selectedGw ? 20 : 0,
        }}>
          {GATEWAYS.map(gw => {
            const isSelected = selectedGw === gw.id;
            return (
              <button
                key={gw.id}
                onClick={() => setSelectedGw(isSelected ? null : gw.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                  fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 600,
                  transition: "all 0.2s",
                  background: isSelected ? C.cyan : C.card,
                  color: isSelected ? "white" : C.text,
                  border: `1.5px solid ${isSelected ? C.cyan : C.border}`,
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: `2px solid ${isSelected ? "white" : C.border}`,
                  background: isSelected ? "white" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isSelected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.cyan }} />}
                </span>
                {gw.name}
              </button>
            );
          })}
        </div>

        {activeGw && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "16px 20px", borderBottom: `1px solid ${C.border}`,
            }}>
              <p style={{ fontSize: "1rem", fontWeight: 800, color: C.text, margin: 0 }}>
                {activeGw.name === "BankStkPush"
                  ? `Bank Stk Push - ${brand.ispName.toUpperCase()}`
                  : `${activeGw.name} Configuration`}
              </p>
            </div>

            <div style={{ padding: "20px" }}>
              {activeGw.id === "bank_stk_push" && (
                <div style={{
                  background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)",
                  borderRadius: 8, padding: "12px 16px", marginBottom: 20,
                  borderLeft: `3px solid ${C.cyan}`,
                }}>
                  <p style={{ fontSize: "0.82rem", fontWeight: 600, color: C.text, margin: 0 }}>
                    Fill the details below to complete Bank STK Push setup
                  </p>
                </div>
              )}

              {activeGw.fields.map(f => {
                const selectedBank = fields[activeGw.id]?.bankName || "";
                if (activeGw.id === "bank_stk_push" && (f.key === "paybillNumber" || f.key === "accountNumber") && !selectedBank) return null;
                const fieldLabel = f.key === "paybillNumber" && selectedBank
                  ? `${selectedBank} PayBill Number`
                  : f.key === "accountNumber" && selectedBank
                  ? `${selectedBank} Account / Business Number`
                  : f.label;
                return (
                  <div key={f.key} style={{
                    display: "flex", alignItems: "center", gap: 16,
                    padding: "12px 0",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <label style={{
                      width: 180, flexShrink: 0,
                      fontSize: "0.8rem", fontWeight: 600, color: C.muted,
                      textAlign: "right",
                    }}>
                      {fieldLabel}
                    </label>
                    <div style={{ flex: 1 }}>
                      {f.type === "select" && f.options ? (
                        <Select
                          value={fields[activeGw.id]?.[f.key] || ""}
                          onChange={e => updateField(activeGw.id, f.key, e.target.value)}
                        >
                          <option value="">-- Select --</option>
                          {f.options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </Select>
                      ) : f.secret ? (
                        <div style={{ position: "relative" }}>
                          <Input
                            type={showSecrets[`${activeGw.id}_${f.key}`] ? "text" : "password"}
                            value={fields[activeGw.id]?.[f.key] || ""}
                            onChange={e => updateField(activeGw.id, f.key, e.target.value)}
                            placeholder="••••••••••••••••"
                            style={{ paddingRight: 36 }}
                          />
                          <button
                            onClick={() => setShowSecrets(prev => ({ ...prev, [`${activeGw.id}_${f.key}`]: !prev[`${activeGw.id}_${f.key}`] }))}
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 2 }}
                          >
                            {showSecrets[`${activeGw.id}_${f.key}`] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      ) : (
                        <Input
                          value={fields[activeGw.id]?.[f.key] || ""}
                          onChange={e => updateField(activeGw.id, f.key, e.target.value)}
                          placeholder={f.hint || `Enter ${f.label.toLowerCase()}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {activeGw.id === "bank_stk_push" && (
                <div style={{
                  background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)",
                  borderRadius: 8, padding: "12px 16px", marginTop: 20,
                }}>
                  <p style={{ fontSize: "0.78rem", color: "#f59e0b", margin: 0, lineHeight: 1.6 }}>
                    <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
                    BankStkPush sends a Daraja PayBill prompt using the chosen bank’s PayBill Number.
                    The Account / Business Number is included as the payment reference.
                  </p>
                </div>
              )}

              {saveError && <p style={{ display: "flex", alignItems: "center", gap: 5, color: "#f87171", fontSize: "0.74rem", margin: "14px 0 0" }}><AlertTriangle size={13} aria-hidden="true" /> {saveError}</p>}
              <Row>
                <button
                  onClick={() => saveGateway(activeGw.id)}
                  disabled={savingGateway === activeGw.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: saved === activeGw.id ? "#10b981" : C.cyan,
                    border: "none", cursor: "pointer", color: "white",
                    fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem",
                    borderRadius: 8, fontFamily: "inherit", transition: "background 0.2s",
                    opacity: savingGateway === activeGw.id ? 0.65 : 1,
                  }}
                >
                  {saved === activeGw.id ? <><Check size={13} /> Saved!</> : savingGateway === activeGw.id ? "Saving…" : <><Save size={13} /> Save Changes</>}
                </button>
              </Row>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function TypographyTab() {
  const current = useTypography();
  const [draft, setDraft] = useState<TypographyPreferences>({
    fontFamily: current.fontFamily,
    fontStyle: current.fontStyle,
    fontWeight: current.fontWeight,
    fontSize: current.fontSize,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!current.loading) {
      setDraft({
        fontFamily: current.fontFamily,
        fontStyle: current.fontStyle,
        fontWeight: current.fontWeight,
        fontSize: current.fontSize,
      });
    }
  }, [current.loading, current.fontFamily, current.fontStyle, current.fontWeight, current.fontSize]);

  const update = <K extends keyof TypographyPreferences>(key: K, value: TypographyPreferences[K]) => {
    setSaved(false);
    setError("");
    setDraft(previous => ({ ...previous, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/admin/typography", {
        method: "PUT",
        headers: adminApiHeaders(),
        body: JSON.stringify({ preferences: draft }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Typography preferences could not be saved.");
      setSaved(true);
      window.dispatchEvent(new Event("isp-typography-change"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Typography preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        title="Desired Font"
        desc="Choose the typography used throughout this ISP's admin panel and captive portals."
      >
        {current.loading ? (
          <p style={{ color: C.muted, fontSize: "0.8rem", margin: 0 }}>Loading typography preferences…</p>
        ) : (
          <>
            <Grid2>
              <Field label="Font family" hint="The selected family is used wherever the interface allows inherited typography.">
                <Select
                  value={draft.fontFamily}
                  onChange={event => update("fontFamily", event.target.value)}
                  style={{ fontFamily: `"${draft.fontFamily}", system-ui, sans-serif` }}
                >
                  {FONT_FAMILY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Font style">
                <Select
                  value={draft.fontStyle}
                  onChange={event => update("fontStyle", event.target.value as TypographyPreferences["fontStyle"])}
                >
                  {FONT_STYLE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Font weight">
                <Select
                  value={String(draft.fontWeight)}
                  onChange={event => update("fontWeight", Number(event.target.value))}
                >
                  {FONT_WEIGHT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label} ({option.value})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Base font size" hint="Applies from 12px to 24px and keeps the setting readable on smaller screens.">
                <Input
                  type="number"
                  min={12}
                  max={24}
                  step={1}
                  value={draft.fontSize}
                  onChange={event => update("fontSize", Number(event.target.value))}
                />
              </Field>
            </Grid2>

            <div style={{
              marginTop: 8,
              padding: "18px 20px",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: C.input,
              fontFamily: `"${draft.fontFamily}", system-ui, sans-serif`,
              fontSize: `${draft.fontSize}px`,
              fontStyle: draft.fontStyle,
              fontWeight: draft.fontWeight,
            }}>
              <div style={{ fontSize: "0.7em", color: C.cyan, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Live preview</div>
              <div style={{ marginTop: 6, color: C.text, lineHeight: 1.25 }}>Network operations at a glance</div>
              <div style={{ marginTop: 5, fontSize: "0.75em", color: C.muted }}>Payments, customers, and routers in one control room.</div>
            </div>

            {error && <p role="alert" style={{ color: "#ef4444", fontSize: "0.75rem", margin: "14px 0 0" }}>{error}</p>}
            {saved && <p role="status" style={{ color: "#10b981", fontSize: "0.75rem", margin: "14px 0 0" }}>Typography saved for this ISP and queued for the next router portal sync.</p>}
            <Row>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || draft.fontSize < 12 || draft.fontSize > 24 || !Number.isInteger(draft.fontSize)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: C.cyan, border: "none", cursor: saving ? "wait" : "pointer",
                  color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem",
                  borderRadius: 8, fontFamily: "inherit", opacity: saving ? 0.65 : 1,
                }}
              >
                <Save size={13} /> {saving ? "Saving…" : saved ? "Saved" : "Save Typography"}
              </button>
            </Row>
          </>
        )}
      </Card>

      <Card title="Where it applies" desc="Typography is scoped to the signed-in ISP account.">
        <div className="dashboard-builder-notes">
          <div><Type size={16} /><span><strong>Admin section</strong><small>Navigation, forms, tables, dashboards, and settings inherit your saved choice.</small></span></div>
          <div><Wifi size={16} /><span><strong>Captive portals</strong><small>New or refreshed MikroTik portal files download the same typography settings.</small></span></div>
          <div><Shield size={16} /><span><strong>Safe fallback</strong><small>Only curated font families, styles, weights, and readable sizes can be saved.</small></span></div>
        </div>
      </Card>
    </>
  );
}

const TABS = [
  { id: "profile",       label: "ISP Profile",       icon: Building2    },
  { id: "billing",       label: "Billing & M-Pesa",  icon: CreditCard   },
  { id: "gateways",      label: "Payment Gateways",  icon: Wallet       },
  { id: "dashboard",     label: "Dashboard Page Builder", icon: LayoutDashboard },
  { id: "typography",    label: "Desired Font",           icon: Type          },
  { id: "sms",           label: "SMS & Email",        icon: MessageSquare},
  { id: "network",       label: "Network",            icon: Radio        },
  { id: "hotspot",       label: "Hotspot",            icon: Wifi         },
  { id: "security",      label: "Security",           icon: Shield       },
  { id: "notifications", label: "Notifications",      icon: Bell         },
  { id: "system",        label: "System",             icon: Wrench       },
  { id: "plugins",       label: "Plugins",            icon: Puzzle       },
];

export default function AdminSettings() {
  const [location, setLocation] = useLocation();
  const requestedTab = new URLSearchParams(location.split("?")[1] ?? "").get("tab");
  const initialTab = TABS.some(item => item.id === requestedTab) ? requestedTab! : "profile";
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (requestedTab && TABS.some(item => item.id === requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (nextTab: string) => {
    setTab(nextTab);
    setLocation(`/admin/settings?tab=${nextTab}`);
  };

  return (
    <AdminLayout>
      <div className="settings-layout" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* Sidebar */}
        <aside className="settings-sidebar" style={{ width: 220, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", position: "sticky", top: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Settings</p>
          </div>
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => selectTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 16px",
                background: active ? "rgba(37,99,235,0.1)" : "transparent",
                borderTop: "none", borderRight: "none",
                borderLeft: active ? `3px solid ${C.cyan}` : "3px solid transparent",
                borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                color: active ? C.cyan : C.muted, fontSize: "0.78rem", fontWeight: active ? 700 : 400,
                textAlign: "left", fontFamily: "inherit", transition: "all 0.15s",
              }}>
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 800, color: C.text, margin: 0 }}>
              {TABS.find(t => t.id === tab)?.label}
            </h1>
            <p style={{ fontSize: "0.75rem", color: C.muted, margin: "3px 0 0" }}>
              Manage your {TABS.find(t => t.id === tab)?.label.toLowerCase()} settings
            </p>
          </div>
          <div className="settings-mobile-nav">
            <Select value={tab} onChange={event => selectTab(event.target.value)} aria-label="Choose settings section">
              {TABS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </Select>
          </div>

          {tab === "profile"       && <IspProfileTab />}
          {tab === "billing"       && <BillingTab />}
          {tab === "gateways"      && <PaymentGatewaysTab />}
          {tab === "dashboard"     && <DashboardBuilderTab />}
          {tab === "typography"    && <TypographyTab />}
          {tab === "sms"           && <SmsEmailTab />}
          {tab === "network"       && <NetworkTab />}
          {tab === "hotspot"       && <HotspotTab />}
          {tab === "security"      && <SecurityTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "system"        && <SystemTab />}
          {tab === "plugins"       && <PluginsTab />}
        </div>
      </div>
    </AdminLayout>
  );
}
