import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Phone, Save, Send, ShieldCheck } from "lucide-react";

type FeatureKey =
  | "login"
  | "registrationVerification"
  | "passwordRecovery"
  | "paymentNotifications"
  | "packageNotifications"
  | "ispNotifications"
  | "resellerNotifications"
  | "customerNotifications";

interface SmsSettings {
  enabled: boolean;
  username: string;
  senderId: string;
  sandbox: boolean;
  defaultCountryCode: string;
  features: Record<FeatureKey, boolean>;
}

interface PageState {
  settings: SmsSettings;
  secrets: { apiKeyConfigured: boolean };
  connection: {
    status: "CONNECTED" | "NOT CONFIGURED" | "ERROR";
    error?: string;
  };
  stats: Record<string, string | number | null>;
}

const FEATURES: { key: FeatureKey; label: string; description: string }[] = [
  { key: "login", label: "SMS login", description: "Allow eligible ISP admins and customers to request a sign-in code by SMS." },
  { key: "registrationVerification", label: "Registration verification", description: "Verify the phone number before completing an ISP or reseller registration." },
  { key: "passwordRecovery", label: "Password recovery", description: "Allow a code sent by SMS to authorize a password reset." },
  { key: "paymentNotifications", label: "Payment notifications", description: "Send a confirmation after a customer payment is recorded successfully." },
  { key: "packageNotifications", label: "Package notifications", description: "Send customer renewal and expiry reminders." },
  { key: "ispNotifications", label: "ISP subscription notifications", description: "Send notices about ISP subscription invoices and payments." },
  { key: "resellerNotifications", label: "Reseller notifications", description: "Send notices about reseller subscription invoices and payments." },
  { key: "customerNotifications", label: "Customer notifications", description: "Master switch for customer payment, renewal, and expiry messages." },
];

function emptySettings(): SmsSettings {
  return {
    enabled: false,
    username: "",
    senderId: "",
    sandbox: false,
    defaultCountryCode: "254",
    features: {
      login: false,
      registrationVerification: false,
      passwordRecovery: false,
      paymentNotifications: false,
      packageNotifications: false,
      ispNotifications: false,
      resellerNotifications: false,
      customerNotifications: false,
    },
  };
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {
    "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "",
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function countValue(stats: PageState["stats"], key: string): string {
  const value = stats[key];
  return typeof value === "number" || typeof value === "string" ? String(value) : "0";
}

export default function SuperAdminSMS() {
  const [settings, setSettings] = useState<SmsSettings>(emptySettings);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [connection, setConnection] = useState<PageState["connection"]>({ status: "NOT CONFIGURED" });
  const [stats, setStats] = useState<PageState["stats"]>({});
  const [testPhone, setTestPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/super-admin/sms/settings", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load SMS settings.");
      const defaults = emptySettings();
      setSettings({
        ...defaults,
        ...data.settings,
        features: { ...defaults.features, ...data.settings?.features },
      });
      setApiKeyConfigured(data.secrets?.apiKeyConfigured === true);
      setConnection(data.connection ?? { status: "NOT CONFIGURED" });
      setStats(data.stats ?? {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load SMS settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/sms/settings", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ settings, apiKey }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save SMS settings.");
      setSettings({ ...emptySettings(), ...data.settings, features: { ...emptySettings().features, ...data.settings?.features } });
      setApiKey("");
      setApiKeyConfigured(data.secrets?.apiKeyConfigured === true);
      setNotice("SMS settings saved.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save SMS settings.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/sms/test", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Test SMS could not be sent.");
      setNotice(data.message || "Test SMS accepted by Africa's Talking.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test SMS could not be sent.");
    } finally {
      setTesting(false);
    }
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500";
  const cardClass = "rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-sm";
  const statusColor = connection.status === "CONNECTED" ? "text-emerald-400" : connection.status === "ERROR" ? "text-red-400" : "text-amber-300";

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-slate-300"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading SMS settings…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 text-slate-100 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sky-400"><Phone className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Platform integration</span></div>
          <h1 className="text-2xl font-bold text-white">SMS messaging</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Configure Africa’s Talking for sign-in codes, phone verification, recovery, and platform notifications.</p>
        </div>
        <div className={`rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-bold ${statusColor}`}>
          {connection.status}
          {connection.error && <div className="mt-1 max-w-sm text-xs font-normal text-red-300">{connection.error}</div>}
        </div>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-400" /><h2 className="font-semibold text-white">Provider credentials</h2></div>
        <p className="mb-4 text-sm text-slate-400">The API key is encrypted before storage and is never sent back to this page. Leave it blank to keep the saved key.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-300">Africa’s Talking username<input className={fieldClass} value={settings.username} onChange={event => setSettings(current => ({ ...current, username: event.target.value }))} maxLength={80} autoComplete="off" /></label>
          <label className="text-sm text-slate-300">
            API key
            <input className={fieldClass} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={apiKeyConfigured ? "Saved key is set; enter a new key to replace it" : "Enter Africa’s Talking API key"} autoComplete="new-password" maxLength={500} />
            <span className={`mt-1 block text-xs ${apiKeyConfigured ? "text-emerald-400" : "text-amber-300"}`}>{apiKeyConfigured ? "API key configured" : "API key not configured"}</span>
          </label>
          <label className="text-sm text-slate-300">Sender ID (optional)<input className={fieldClass} value={settings.senderId} onChange={event => setSettings(current => ({ ...current, senderId: event.target.value }))} maxLength={20} placeholder="Approved sender ID" /></label>
          <label className="text-sm text-slate-300">Default country calling code<input className={fieldClass} value={settings.defaultCountryCode} onChange={event => setSettings(current => ({ ...current, defaultCountryCode: event.target.value.replace(/\D/g, "").slice(0, 4) }))} maxLength={4} placeholder="254" /></label>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <input type="checkbox" checked={settings.sandbox} onChange={event => setSettings(current => ({ ...current, sandbox: event.target.checked }))} className="mt-1 h-4 w-4 accent-sky-500" />
          <span><span className="block text-sm font-medium text-slate-200">Use Africa’s Talking sandbox</span><span className="mt-0.5 block text-xs text-slate-500">Use the sandbox username and endpoint for testing; live SMS requires an approved production application.</span></span>
        </label>
      </section>

      <form onSubmit={save} className="space-y-6">
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><h2 className="font-semibold text-white">SMS delivery</h2><p className="mt-1 text-sm text-slate-400">SMS is off until you enable it and configure a provider account.</p></div>
            <label className="flex items-center gap-2 text-sm font-medium text-white">
              <input type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-sky-500" />
              SMS enabled
            </label>
          </div>
          <div className="divide-y divide-white/5">
            {FEATURES.map(feature => (
              <label key={feature.key} className="flex cursor-pointer items-start justify-between gap-4 py-3">
                <span><span className="block text-sm font-medium text-slate-200">{feature.label}</span><span className="mt-0.5 block text-xs text-slate-500">{feature.description}</span></span>
                <input type="checkbox" checked={settings.features[feature.key]} onChange={event => setSettings(current => ({ ...current, features: { ...current.features, [feature.key]: event.target.checked } }))} className="mt-1 h-4 w-4 accent-sky-500" />
              </label>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <section className={cardClass}>
        <h2 className="mb-4 font-semibold text-white">Delivery overview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Messages today", "messages_today"],
            ["Messages this month", "messages_month"],
            ["OTP requests today", "otp_requests_today"],
            ["Verified OTPs", "successful_otp_verifications"],
            ["Failed OTP attempts", "failed_otp_verifications"],
            ["Failed messages", "failed_messages"],
          ].map(([label, key]) => (
            <div key={key} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <div className="text-xl font-bold text-white">{countValue(stats, key)}</div>
              <div className="mt-1 text-xs text-slate-400">{label}</div>
            </div>
          ))}
        </div>
        {stats.last_api_error && <p className="mt-4 text-sm text-amber-200">Last provider error: {String(stats.last_api_error)}</p>}
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-white">Send a test SMS</h2>
        <p className="mt-1 text-sm text-slate-400">This sends a billable text to the number you enter. Use international format, such as +254712345678.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className={fieldClass + " mt-0"} value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="+254712345678" aria-label="Test recipient phone number" />
          <button type="button" disabled={testing || !testPhone.trim()} onClick={() => void sendTest()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-600/15 px-5 py-2.5 text-sm font-semibold text-sky-300 hover:bg-sky-600/25 disabled:opacity-50">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{testing ? "Sending…" : "Send test SMS"}
          </button>
        </div>
      </section>
    </div>
  );
}