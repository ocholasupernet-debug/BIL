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
  | "securityNotifications"
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
    welcome: string;
    accountStatus: string;
    security: string;
    suspiciousSignIn: string;
    test: string;
  };
}

interface PageState {
  settings: WhatsAppSettings;
  secrets: {
    accessTokenConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
    accessTokenSource: "super-admin" | "environment" | "missing";
    webhookVerifyTokenSource: "super-admin" | "environment" | "missing";
    appSecretSource: "super-admin" | "environment" | "missing";
  };
  connection: {
    status: "CONNECTED" | "NOT CONFIGURED" | "ERROR";
    displayPhoneNumber?: string;
    verifiedName?: string;
    error?: string;
  };
  stats: Record<string, string | number | null>;
}

type WahaFeatureKey = "login" | "registrationVerification" | "pageVerification" | "gatewaySettings";

interface WahaSettings {
  enabled: boolean;
  baseUrl: string;
  sessionId: string;
  otpProvider: "whatsapp_cloud" | "waha";
  features: Record<WahaFeatureKey, boolean>;
}

interface WahaSecretsStatus {
  apiKeyConfigured: boolean;
  apiKeySource: "super-admin" | "environment" | "missing";
}

const WAHA_FEATURES: { key: WahaFeatureKey; label: string; description: string }[] = [
  { key: "login", label: "Login codes", description: "Allow customers and ISP admins to request WhatsApp sign-in codes." },
  { key: "registrationVerification", label: "Registration verification", description: "Require a phone verification code before account registration." },
  { key: "pageVerification", label: "Protected-page verification", description: "Use WAHA when an admin page is configured for WhatsApp OTP." },
  { key: "gatewaySettings", label: "Payment-settings verification", description: "Use WAHA for protected payment-gateway settings OTP." },
];

function emptyWahaSettings(): WahaSettings {
  return {
    enabled: false,
    baseUrl: "http://localhost:3000",
    sessionId: "default",
    otpProvider: "whatsapp_cloud",
    features: {
      login: false,
      registrationVerification: false,
      pageVerification: false,
      gatewaySettings: false,
    },
  };
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
  { key: "securityNotifications", label: "Security notifications", description: "Alert after 5 failed sign-ins for one account within 15 minutes; suppress repeats for 1 hour. Sends only to verified account phones." },
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
      securityNotifications: false,
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
      welcome: "",
      accountStatus: "",
      security: "",
      suspiciousSignIn: "",
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
  const [wahaSettings, setWahaSettings] = useState<WahaSettings>(emptyWahaSettings);
  const [wahaSecrets, setWahaSecrets] = useState<WahaSecretsStatus>({
    apiKeyConfigured: false,
    apiKeySource: "missing",
  });
  const [wahaReady, setWahaReady] = useState(false);
  const [wahaApiKey, setWahaApiKey] = useState("");
  const [wahaTestPhone, setWahaTestPhone] = useState("");
  const [secrets, setSecrets] = useState<PageState["secrets"]>({
    accessTokenConfigured: false,
    webhookVerifyTokenConfigured: false,
    appSecretConfigured: false,
    accessTokenSource: "missing",
    webhookVerifyTokenSource: "missing",
    appSecretSource: "missing",
  });
  const [credentials, setCredentials] = useState({
    accessToken: "",
    webhookVerifyToken: "",
    appSecret: "",
  });
  const [connection, setConnection] = useState<PageState["connection"]>({ status: "NOT CONFIGURED" });
  const [stats, setStats] = useState<PageState["stats"]>({});
  const [testPhone, setTestPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingWahaSettings, setSavingWahaSettings] = useState(false);
  const [savingWahaCredentials, setSavingWahaCredentials] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingWaha, setTestingWaha] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [response, wahaResponse] = await Promise.all([
        fetch("/api/super-admin/whatsapp/settings", {
          headers: authHeaders(),
          cache: "no-store",
        }),
        fetch("/api/super-admin/waha/settings", {
          headers: authHeaders(),
          cache: "no-store",
        }),
      ]);
      const [data, wahaData] = await Promise.all([response.json(), wahaResponse.json()]);
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load WhatsApp settings.");
      if (!wahaResponse.ok || !wahaData.ok) throw new Error(wahaData.error || "Could not load WAHA settings.");
      setSettings({ ...emptySettings(), ...data.settings, features: { ...emptySettings().features, ...data.settings?.features }, templates: { ...emptySettings().templates, ...data.settings?.templates } });
      setSecrets(data.secrets ?? {});
      setConnection(data.connection ?? { status: "NOT CONFIGURED" });
      setStats(data.stats ?? {});
      setWahaSettings({
        ...emptyWahaSettings(),
        ...wahaData.settings,
        features: { ...emptyWahaSettings().features, ...wahaData.settings?.features },
      });
      setWahaSecrets(wahaData.secrets ?? { apiKeyConfigured: false, apiKeySource: "missing" });
      setWahaReady(wahaData.ready === true);
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

  const saveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingCredentials(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/whatsapp/credentials", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ credentials }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save WhatsApp credentials.");
      setCredentials({ accessToken: "", webhookVerifyToken: "", appSecret: "" });
      setSecrets(data.secrets);
      setNotice("WhatsApp credentials encrypted and saved. Values are not returned to this page.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WhatsApp credentials.");
    } finally {
      setSavingCredentials(false);
    }
  };

  const clearCredentials = async () => {
    if (!window.confirm("Clear the WhatsApp credentials stored in Super Admin? Environment fallback credentials, if configured, will remain active.")) return;
    setSavingCredentials(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/whatsapp/credentials", {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not clear WhatsApp credentials.");
      setSecrets(data.secrets);
      setNotice("Super Admin-stored WhatsApp credentials cleared.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear WhatsApp credentials.");
    } finally {
      setSavingCredentials(false);
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

  const saveWahaSettingsForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingWahaSettings(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/waha/settings", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ settings: wahaSettings }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save WAHA settings.");
      setWahaSettings({
        ...emptyWahaSettings(),
        ...data.settings,
        features: { ...emptyWahaSettings().features, ...data.settings?.features },
      });
      setWahaSecrets(data.secrets ?? wahaSecrets);
      setWahaReady(data.ready === true);
      setNotice("WAHA settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WAHA settings.");
    } finally {
      setSavingWahaSettings(false);
    }
  };

  const saveWahaCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingWahaCredentials(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/waha/credentials", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ credentials: { apiKey: wahaApiKey } }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save the WAHA API key.");
      setWahaApiKey("");
      setWahaSecrets(data.secrets);
      setWahaReady(data.ready === true);
      setNotice("WAHA API key encrypted and saved. Its value is not returned to this page.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the WAHA API key.");
    } finally {
      setSavingWahaCredentials(false);
    }
  };

  const clearWahaCredentials = async () => {
    if (!window.confirm("Clear the WAHA API key stored in Super Admin? An environment fallback, if configured, will remain active.")) return;
    setSavingWahaCredentials(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/waha/credentials", {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not clear the WAHA API key.");
      setWahaSecrets(data.secrets);
      setWahaReady(data.ready === true);
      setNotice("The Super Admin-stored WAHA API key was cleared.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear the WAHA API key.");
    } finally {
      setSavingWahaCredentials(false);
    }
  };

  const sendWahaTest = async () => {
    setTestingWaha(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin/waha/test", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ phone: wahaTestPhone }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "WAHA test message could not be sent.");
      setNotice(data.message || "WAHA test message accepted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WAHA test message could not be sent.");
    } finally {
      setTestingWaha(false);
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
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Configure Meta Cloud API messaging and the separate WAHA gateway used for OTP delivery.</p>
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
        <p className="mb-4 text-sm text-slate-400">Enter Meta credentials here to encrypt and store them for the API server. Existing environment credentials remain a fallback. Saved values are never sent back to this page.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Cloud API access token", secrets.accessTokenConfigured, secrets.accessTokenSource],
            ["Webhook verify token", secrets.webhookVerifyTokenConfigured, secrets.webhookVerifyTokenSource],
            ["Meta app secret", secrets.appSecretConfigured, secrets.appSecretSource],
          ].map(([label, configured, source]) => (
            <div key={String(label)} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
              <span className="text-slate-300">{label}</span>
              <span className={configured ? "text-emerald-400" : "text-amber-300"}>
                {configured ? source === "super-admin" ? "Encrypted in database" : "Environment fallback" : "Missing"}
              </span>
            </div>
          ))}
        </div>
        <form onSubmit={saveCredentials} className="mt-5 space-y-3">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm text-slate-300">Cloud API access token
              <input type="password" autoComplete="new-password" className={fieldClass} value={credentials.accessToken} onChange={event => setCredentials(current => ({ ...current, accessToken: event.target.value }))} maxLength={4096} />
            </label>
            <label className="text-sm text-slate-300">Webhook verify token
              <input type="password" autoComplete="new-password" className={fieldClass} value={credentials.webhookVerifyToken} onChange={event => setCredentials(current => ({ ...current, webhookVerifyToken: event.target.value }))} maxLength={1024} />
            </label>
            <label className="text-sm text-slate-300">Meta app secret
              <input type="password" autoComplete="new-password" className={fieldClass} value={credentials.appSecret} onChange={event => setCredentials(current => ({ ...current, appSecret: event.target.value }))} maxLength={1024} />
            </label>
          </div>
          <p className="text-xs text-slate-500">Leave a field blank to keep its saved value. Credentials are encrypted with a WhatsApp-specific key derived from SESSION_SECRET.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={clearCredentials} disabled={savingCredentials} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-50">Clear stored credentials</button>
            <button type="submit" disabled={savingCredentials} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {savingCredentials ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save credentials
            </button>
          </div>
        </form>
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
              ["welcome", "Account welcome and setup link"],
              ["accountStatus", "Customer account status"],
              ["security", "Password changed"],
              ["suspiciousSignIn", "Suspicious sign-in (name, time, IP, device)"],
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-cyan-300"><MessageCircle className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Separate WhatsApp HTTP API</span></div>
            <h2 className="font-semibold text-white">WAHA OTP gateway</h2>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${wahaReady ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300" : "border-amber-500/30 bg-amber-950/30 text-amber-200"}`}>
            {!wahaSettings.enabled ? "Disabled" : wahaReady ? "Ready" : wahaSecrets.apiKeyConfigured ? "Not ready" : "Missing API key"}
          </span>
        </div>
        <p className="mb-5 text-sm text-slate-400">WAHA sends login, registration, and protected-page verification codes only. Payment, renewal, and expiry notices continue through the existing Meta Cloud API. Hotspot devices contact this API server; the WAHA API key is never sent to captive clients.</p>

        <form onSubmit={saveWahaSettingsForm} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">WAHA base URL
              <input className={fieldClass} value={wahaSettings.baseUrl} onChange={event => setWahaSettings(current => ({ ...current, baseUrl: event.target.value }))} maxLength={512} placeholder="http://localhost:3000" />
            </label>
            <label className="text-sm text-slate-300">WAHA session ID
              <input className={fieldClass} value={wahaSettings.sessionId} onChange={event => setWahaSettings(current => ({ ...current, sessionId: event.target.value }))} maxLength={64} placeholder="default" />
            </label>
            <label className="text-sm text-slate-300">OTP provider
              <select className={fieldClass} value={wahaSettings.otpProvider} onChange={event => setWahaSettings(current => ({ ...current, otpProvider: event.target.value as WahaSettings["otpProvider"] }))}>
                <option value="whatsapp_cloud">WhatsApp Cloud API</option>
                <option value="waha">WAHA</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm font-medium text-white">
              <input type="checkbox" checked={wahaSettings.enabled} onChange={event => setWahaSettings(current => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-cyan-500" />
              Enable WAHA gateway
            </label>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">WAHA OTP features</h3>
            <div className="divide-y divide-white/5">
              {WAHA_FEATURES.map(feature => (
                <label key={feature.key} className="flex cursor-pointer items-start justify-between gap-4 py-3">
                  <span><span className="block text-sm font-medium text-slate-200">{feature.label}</span><span className="mt-0.5 block text-xs text-slate-500">{feature.description}</span></span>
                  <input type="checkbox" checked={wahaSettings.features[feature.key]} onChange={event => setWahaSettings(current => ({ ...current, features: { ...current.features, [feature.key]: event.target.checked } }))} className="mt-1 h-4 w-4 accent-cyan-500" />
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button disabled={savingWahaSettings} className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60">
              {savingWahaSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{savingWahaSettings ? "Saving…" : "Save WAHA settings"}
            </button>
          </div>
        </form>
      </section>

      <section className={cardClass}>
        <div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-cyan-300" /><h2 className="font-semibold text-white">WAHA server API key</h2></div>
        <p className="mb-4 text-sm text-slate-400">The key is encrypted with a WAHA-specific key derived from SESSION_SECRET. It is never returned to the browser. WAHA_API_KEY remains an optional server-side fallback.</p>
        <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
          <span className="text-slate-300">Current key</span>
          <span className={wahaSecrets.apiKeyConfigured ? "text-emerald-400" : "text-amber-300"}>
            {wahaSecrets.apiKeyConfigured ? wahaSecrets.apiKeySource === "super-admin" ? "Encrypted in database" : "Environment fallback" : "Missing"}
          </span>
        </div>
        <form onSubmit={saveWahaCredentials} className="space-y-3">
          <label className="block text-sm text-slate-300">WAHA API key
            <input type="password" autoComplete="new-password" className={fieldClass} value={wahaApiKey} onChange={event => setWahaApiKey(event.target.value)} maxLength={4096} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={clearWahaCredentials} disabled={savingWahaCredentials} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-50">Clear stored key</button>
            <button type="submit" disabled={savingWahaCredentials || !wahaApiKey.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {savingWahaCredentials ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save API key
            </button>
          </div>
        </form>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-white">Test WAHA delivery</h2>
        <p className="mt-1 text-sm text-slate-400">Sends a one-time test message to the number you enter. Testing is available even while WAHA is disabled for OTP use.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className={fieldClass + " mt-0"} value={wahaTestPhone} onChange={event => setWahaTestPhone(event.target.value)} placeholder="+254712345678" aria-label="WAHA test recipient phone number" />
          <button type="button" disabled={testingWaha || !wahaTestPhone.trim()} onClick={() => void sendWahaTest()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-700/20 px-5 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-700/30 disabled:opacity-50">
            {testingWaha ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{testingWaha ? "Sending…" : "Test WAHA"}
          </button>
        </div>
      </section>

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