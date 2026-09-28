import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Save, Send, ShieldCheck } from "lucide-react";

type FeatureKey =
  | "login"
  | "registrationVerification"
  | "passwordRecovery"
  | "paymentNotifications"
  | "packageNotifications"
  | "ispNotifications"
  | "resellerNotifications"
  | "customerNotifications"
  | "selfService";

interface WhatsAppSettings {
  enabled: boolean;
  features: Record<FeatureKey, boolean>;
  businessAccountId: string;
  phoneNumberId: string;
  businessPhone: string;
  apiVersion: string;
  defaultCountryCode: string;
  language: string;
  templates: {
    authentication: string;
    payment: string;
    renewal: string;
    expiry: string;
    ispSubscription: string;
    reseller: string;
    test: string;
  };
}

interface PageState {
  settings: WhatsAppSettings;
  secrets: {
    accessTokenConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
  };
  connection: {
    status: "CONNECTED" | "NOT CONFIGURED" | "ERROR";
    displayPhoneNumber?: string;
    verifiedName?: string;
    error?: string;
  };
  stats: Record<string, string | number | null>;
}

const FEATURES: { key: FeatureKey; label: string; description: string }[] = [
  { key: "login", label: "WhatsApp login", description: "Allow eligible ISP admin and customer accounts to request a sign-in code." },
  { key: "registrationVerification", label: "Registration verification", description: "Verify a phone before creating an ISP or reseller registration." },
  { key: "passwordRecovery", label: "Password recovery", description: "Allow a verified phone to authorize a password reset." },
  { key: "paymentNotifications", label: "Payment notifications", description: "Send payment confirmations after a payment is recorded successfully." },
  { key: "packageNotifications", label: "Package notifications", description: "Send package expiry reminders from the existing customer expiry date." },
  { key: "ispNotifications", label: "ISP subscription notifications", description: "Control future ISP subscription messages." },
  { key: "resellerNotifications", label: "Reseller notifications", description: "Control reseller account and service messages." },
  { key: "customerNotifications", label: "Customer notifications", description: "Master switch for customer payment and package messages." },
  { key: "selfService", label: "Customer self-service", description: "Respond to WhatsApp menu requests from a single phone-verified customer account." },
];

function emptySettings(): WhatsAppSettings {
  return {
    enabled: false,
    features: {
      login: false,
      registrationVerification: false,
      passwordRecovery: false,
      paymentNotifications: false,
      packageNotifications: false,
      ispNotifications: false,
      resellerNotifications: false,
      customerNotifications: false,
      selfService: false,
    },
    businessAccountId: "",
    phoneNumberId: "",
    businessPhone: "",
    apiVersion: "v23.0",
    defaultCountryCode: "254",
    language: "en",
    templates: {
      authentication: "",
      payment: "",
      renewal: "",
      expiry: "",
      ispSubscription: "",
      reseller: "",
      test: "",
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

export default function SuperAdminWhatsApp() {
  const [settings, setSettings] = useState<WhatsAppSettings>(emptySettings);
  const [secrets, setSecrets] = useState<PageState["secrets"]>({
    accessTokenConfigured: false,
    webhookVerifyTokenConfigured: false,
    appSecretConfigured: false,
  });
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
      const response = await fetch("/api/super-admin/whatsapp/settings", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load WhatsApp settings.");
      setSettings({ ...emptySettings(), ...data.settings, features: { ...emptySettings().features, ...data.settings?.features }, templates: { ...emptySettings().templates, ...data.settings?.templates } });
      setSecrets(data.secrets ?? {});
      setConnection(data.connection ?? { status: "NOT CONFIGURED" });
      setStats(data.stats ?? {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load WhatsApp settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateSetting = <K extends keyof WhatsAppSettings>(key: K, value: WhatsAppSettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
  };

  const updateTemplate = (key: keyof WhatsAppSettings["templates"], value: string) => {
    setSettings(current => ({ ...current, templates: { ...current.templates, [key]: value } }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/whatsapp/settings", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ settings }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save WhatsApp settings.");
      setSettings(data.settings);
      setSecrets(data.secrets ?? secrets);
      setNotice("WhatsApp settings saved.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WhatsApp settings.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/whatsapp/test", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Test message could not be sent.");
      setNotice(data.message || "Test message accepted by WhatsApp.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test message could not be sent.");
    } finally {
      setTesting(false);
    }
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500";
  const cardClass = "rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-sm";
  const statusColor = connection.status === "CONNECTED" ? "text-emerald-400" : connection.status === "ERROR" ? "text-red-400" : "text-amber-300";

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-slate-300"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading WhatsApp settings…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 text-slate-100 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-400"><MessageCircle className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Platform integration</span></div>
          <h1 className="text-2xl font-bold text-white">WhatsApp Business</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Configure the Cloud API, approved templates, and independent OCHOLASUPERNET feature switches.</p>
        </div>
        <div className={`rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-bold ${statusColor}`}>
          {connection.status}
          {connection.verifiedName && <div className="mt-1 text-xs font-normal text-slate-400">{connection.verifiedName} {connection.displayPhoneNumber ? `· ${connection.displayPhoneNumber}` : ""}</div>}
          {connection.error && <div className="mt-1 max-w-sm text-xs font-normal text-red-300">{connection.error}</div>}
        </div>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      <section className={cardClass}>
        <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" /><h2 className="font-semibold text-white">Server credentials</h2></div>
        <p className="mb-4 text-sm text-slate-400">Credentials are read only by the API server and are never sent to this page. Set these in the server environment on the VPS and in Replit Secrets for development.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Cloud API access token", secrets.accessTokenConfigured],
            ["Webhook verify token", secrets.webhookVerifyTokenConfigured],
            ["Meta app secret", secrets.appSecretConfigured],
          ].map(([label, configured]) => (
            <div key={String(label)} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
              <span className="text-slate-300">{label}</span>
              <span className={configured ? "text-emerald-400" : "text-amber-300"}>{configured ? "Set" : "Missing"}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Required variables: <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>, and <code>WHATSAPP_APP_SECRET</code>.</p>
      </section>

      <form onSubmit={save} className="space-y-6">
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><h2 className="font-semibold text-white">Cloud API configuration</h2><p className="mt-1 text-sm text-slate-400">IDs and template names are not secret. Keep the version aligned with the Meta Graph API version you use.</p></div>
            <label className="flex items-center gap-2 text-sm font-medium text-white">
              <input type="checkbox" checked={settings.enabled} onChange={event => updateSetting("enabled", event.target.checked)} className="h-4 w-4 accent-emerald-500" />
              WhatsApp enabled
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">WhatsApp Business Account ID<input className={fieldClass} value={settings.businessAccountId} onChange={event => updateSetting("businessAccountId", event.target.value)} maxLength={80} /></label>
            <label className="text-sm text-slate-300">Phone Number ID<input className={fieldClass} value={settings.phoneNumberId} onChange={event => updateSetting("phoneNumberId", event.target.value)} maxLength={80} /></label>
            <label className="text-sm text-slate-300">Business phone number<input className={fieldClass} value={settings.businessPhone} onChange={event => updateSetting("businessPhone", event.target.value)} maxLength={32} placeholder="+254…" /></label>
            <label className="text-sm text-slate-300">Graph API version<input className={fieldClass} value={settings.apiVersion} onChange={event => updateSetting("apiVersion", event.target.value)} placeholder="v23.0" maxLength={12} /></label>
            <label className="text-sm text-slate-300">Default country calling code<input className={fieldClass} value={settings.defaultCountryCode} onChange={event => updateSetting("defaultCountryCode", event.target.value)} placeholder="254" maxLength={5} /></label>
            <label className="text-sm text-slate-300">Template language<input className={fieldClass} value={settings.language} onChange={event => updateSetting("language", event.target.value)} placeholder="en" maxLength={10} /></label>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="mb-1 font-semibold text-white">Meta-approved templates</h2>
          <p className="mb-4 text-sm text-slate-400">Use the exact names and language approved in WhatsApp Manager. Do not enter an unapproved free-form message as a template.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {([
              ["authentication", "Authentication / OTP"],
              ["payment", "Payment notification"],
              ["renewal", "Package renewal"],
              ["expiry", "Package expiry"],
              ["ispSubscription", "ISP subscription reminder"],
              ["reseller", "Reseller notification"],
              ["test", "Test message"],
            ] as [keyof WhatsAppSettings["templates"], string][]).map(([key, label]) => (
              <label key={key} className="text-sm text-slate-300">{label}<input className={fieldClass} value={settings.templates[key]} onChange={event => updateTemplate(key, event.target.value)} maxLength={100} /></label>
            ))}
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="mb-1 font-semibold text-white">Feature switches</h2>
          <p className="mb-4 text-sm text-slate-400">Turning WhatsApp off leaves existing sign-in, registration, billing, and network services unchanged. Customer payment and package notices require both the customer master switch and their matching feature switch.</p>
          <div className="divide-y divide-white/5">
            {FEATURES.map(feature => (
              <label key={feature.key} className="flex cursor-pointer items-start justify-between gap-4 py-3">
                <span><span className="block text-sm font-medium text-slate-200">{feature.label}</span><span className="mt-0.5 block text-xs text-slate-500">{feature.description}</span></span>
                <input type="checkbox" checked={settings.features[feature.key]} onChange={event => setSettings(current => ({ ...current, features: { ...current.features, [feature.key]: event.target.checked } }))} className="mt-1 h-4 w-4 accent-emerald-500" />
              </label>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60">
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
        <h2 className="font-semibold text-white">Send a test message</h2>
        <p className="mt-1 text-sm text-slate-400">Requires an approved test template and a recipient in international format.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className={fieldClass + " mt-0"} value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="+254712345678" aria-label="Test recipient phone number" />
          <button type="button" disabled={testing || !testPhone.trim()} onClick={() => void sendTest()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/15 px-5 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{testing ? "Sending…" : "Test WhatsApp"}
          </button>
        </div>
      </section>

      <p className="text-xs text-slate-500">Webhook endpoint: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/webhook` : "/api/whatsapp/webhook"}</code>. See <code>docs/whatsapp-cloud-api.md</code> for Meta and VPS setup.</p>
    </div>
  );
}