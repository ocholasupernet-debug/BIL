import React, { useEffect, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Settings, Save, CheckCircle2, Globe, Mail, Server, Shield, Sliders, Eye, Loader2, AlertCircle, Copy } from "lucide-react";
import { ADMIN_PAGE_VISIBILITY_CATALOG } from "@/lib/admin-page-visibility";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
type RadiusDiscovery = {
  vpsHost: string;
  detectedVpsIp: string | null;
  managementVpnHost: string | null;
  configRoot: string | null;
  installed: boolean;
  running: boolean;
  configurationValid: boolean;
  authenticationPort: number | null;
  accountingPort: number | null;
  authenticationListening: boolean;
  accountingListening: boolean;
  endpointVerified: boolean;
  radiusHost: string | null;
  secretSynchronized: boolean | null;
  routerSync: Array<{ routerId: number; status: string; vpnIp: string; error?: string; checkedAt: string }>;
  checkedAt: string;
  error?: string;
};
type RadiusRouterOption = { id: number; name: string; vpnIp: string | null; eligible: boolean; reason?: string };

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
    taxRate: "16",
    currency: "KES",
    timezone: "Africa/Nairobi",
    dateFormat: "DD/MM/YYYY",
    maintenanceMode: false,
    registrationOpen: true,
    autoSuspend: true,
    darkModeDefault: true,
  });
  const [saved, setSaved] = useState(false);
  const [pageVisibility, setPageVisibility] = useState<Record<string, boolean>>({});
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilitySaved, setVisibilitySaved] = useState(false);
  const [visibilityError, setVisibilityError] = useState("");
  const [emailCfg, setEmailCfg] = useState({
    enabled: false,
    host: "",
    port: "587",
    security: "starttls",
    authEnabled: true,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "OcholaSupernet",
    securityEmail: "",
    hasPassword: false,
    configured: false,
  });
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailTestMessage, setEmailTestMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [radiusCfg, setRadiusCfg] = useState({
    enabled: false,
    host: "",
    authenticationPort: "1812",
    accountingPort: "1813",
    secret: "",
    hasSecret: false,
    configured: false,
    source: "none",
  });
  const [radiusLoading, setRadiusLoading] = useState(true);
  const [radiusError, setRadiusError] = useState("");
  const [radiusDiscovery, setRadiusDiscovery] = useState<RadiusDiscovery | null>(null);
  const [radiusChecking, setRadiusChecking] = useState(false);
  const [radiusCheckError, setRadiusCheckError] = useState("");
  const [radiusSecretOnce, setRadiusSecretOnce] = useState("");
  const [radiusSecretBusy, setRadiusSecretBusy] = useState(false);
  const [radiusRouters, setRadiusRouters] = useState<RadiusRouterOption[]>([]);
  const [radiusRoutersLoading, setRadiusRoutersLoading] = useState(false);
  const [selectedRadiusRouters, setSelectedRadiusRouters] = useState<number[]>([]);
  const [radiusProvisioning, setRadiusProvisioning] = useState(false);
  const [radiusProvisionResults, setRadiusProvisionResults] = useState<RadiusDiscovery["routerSync"]>([]);
  const set = (k: keyof typeof cfg, v: string | boolean) => { setCfg(f => ({ ...f, [k]: v })); setSaved(false); };
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 3000); };
  const updateEmailCfg = (changes: Partial<typeof emailCfg>) => {
    setEmailCfg(current => ({ ...current, ...changes, configured: false }));
    setEmailSaved(false);
    setEmailTestMessage("");
  };

  const superAdminHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("ochola_superadmin_token") || "";
    return token ? { "x-sa-token": token } : {};
  };

  const loadRadiusRouters = async () => {
    setRadiusRoutersLoading(true);
    try {
      const response = await fetch("/api/super-admin/radius-settings/routers", {
        headers: superAdminHeaders(),
        cache: "no-store",
      });
      const data = await response.json() as { routers?: RadiusRouterOption[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Router list could not be loaded.");
      setRadiusRouters(data.routers ?? []);
      setSelectedRadiusRouters(current => current.filter(id => (data.routers ?? []).some(router => router.id === id && router.eligible)));
    } catch (error) {
      setRadiusCheckError(error instanceof Error ? error.message : "Router list could not be loaded.");
    } finally {
      setRadiusRoutersLoading(false);
    }
  };

  useEffect(() => {
    void loadRadiusRouters();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadVisibility = async () => {
      try {
        const response = await fetch("/api/super-admin/admin-page-visibility", {
          headers: superAdminHeaders(),
        });
        const data = await response.json() as { visibility?: Record<string, boolean>; error?: string };
        if (!response.ok) throw new Error(data.error || "Visibility settings could not be loaded.");
        if (!cancelled && data.visibility) setPageVisibility(data.visibility);
      } catch (error) {
        if (!cancelled) setVisibilityError(error instanceof Error ? error.message : "Visibility settings could not be loaded.");
      } finally {
        if (!cancelled) setVisibilityLoading(false);
      }
    };
    void loadVisibility();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRadiusSettings = async () => {
      try {
        const response = await fetch("/api/super-admin/radius-settings", {
          headers: superAdminHeaders(),
          cache: "no-store",
        });
        const data = await response.json() as {
          settings?: {
            enabled?: boolean; host?: string; authenticationPort?: number;
            accountingPort?: number; hasSecret?: boolean; configured?: boolean; source?: string;
            vpsDiscovery?: RadiusDiscovery | null;
          };
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "RADIUS settings could not be loaded.");
        if (!cancelled && data.settings) {
          const discovery = data.settings.vpsDiscovery ?? null;
          setRadiusDiscovery(discovery);
          setRadiusCfg(current => ({
            ...current,
            ...data.settings,
            host: discovery?.endpointVerified ? discovery.radiusHost ?? "" : "",
            authenticationPort: String(discovery?.endpointVerified ? discovery.authenticationPort : ""),
            accountingPort: String(discovery?.endpointVerified ? discovery.accountingPort : ""),
            secret: "",
          }));
        }
      } catch (error) {
        if (!cancelled) setRadiusError(error instanceof Error ? error.message : "RADIUS settings could not be loaded.");
      } finally {
        if (!cancelled) setRadiusLoading(false);
      }
    };
    void loadRadiusSettings();
    return () => { cancelled = true; };
  }, []);

  const checkRadiusOnVps = async () => {
    setRadiusChecking(true);
    setRadiusCheckError("");
    try {
      const response = await fetch("/api/super-admin/radius-settings/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        cache: "no-store",
      });
      const data = await response.json() as {
        settings?: { vpsDiscovery?: RadiusDiscovery | null; hasSecret?: boolean; enabled?: boolean };
        error?: string;
      };
      if (!response.ok || !data.settings) throw new Error(data.error || "Configured VPS check failed.");
      const discovery = data.settings.vpsDiscovery ?? null;
      setRadiusDiscovery(discovery);
      setRadiusCfg(current => ({
        ...current,
        host: discovery?.endpointVerified ? discovery.radiusHost ?? "" : "",
        authenticationPort: String(discovery?.endpointVerified ? discovery.authenticationPort : ""),
        accountingPort: String(discovery?.endpointVerified ? discovery.accountingPort : ""),
        hasSecret: data.settings?.hasSecret ?? current.hasSecret,
        enabled: discovery?.endpointVerified ? current.enabled : false,
      }));
    } catch (error) {
      setRadiusCheckError(error instanceof Error ? error.message : "Configured VPS check failed.");
    } finally {
      setRadiusChecking(false);
    }
  };

  useEffect(() => {
    void checkRadiusOnVps();
  }, []);

  const createOrRotateRadiusSecret = async (rotate: boolean) => {
    if (rotate && !window.confirm("Rotate the common RADIUS secret? Existing router entries will keep their current value until you explicitly provision each selected router with the new secret.")) return;
    setRadiusSecretBusy(true);
    setRadiusError("");
    setRadiusSecretOnce("");
    try {
      const response = await fetch(rotate
        ? "/api/super-admin/radius-settings/secret/rotate"
        : "/api/super-admin/radius-settings/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        body: JSON.stringify(rotate ? { confirm: true } : {}),
        cache: "no-store",
      });
      const data = await response.json() as { secret?: string; error?: string };
      if (!response.ok || !data.secret) throw new Error(data.error || "RADIUS secret could not be created.");
      setRadiusSecretOnce(data.secret);
      setRadiusCfg(current => ({ ...current, hasSecret: true, enabled: false, secret: "" }));
      setRadiusDiscovery(current => current ? { ...current, secretSynchronized: false } : current);
    } catch (error) {
      setRadiusError(error instanceof Error ? error.message : "RADIUS secret could not be created.");
    } finally {
      setRadiusSecretBusy(false);
    }
  };

  const provisionSelectedRadiusRouters = async () => {
    if (!selectedRadiusRouters.length) return;
    const accepted = window.confirm(
      "Provision the common RADIUS secret to FreeRADIUS and only the selected MikroTik routers? Existing non-managed entries will not be overwritten. Existing entries tagged as managed by OcholaSupernet may be updated.",
    );
    if (!accepted) return;
    setRadiusProvisioning(true);
    setRadiusError("");
    setRadiusProvisionResults([]);
    try {
      const response = await fetch("/api/super-admin/radius-settings/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        body: JSON.stringify({
          confirm: true,
          replaceManaged: radiusDiscovery?.secretSynchronized === false,
          routerIds: selectedRadiusRouters,
        }),
        cache: "no-store",
      });
      const data = await response.json() as {
        ok?: boolean;
        results?: RadiusDiscovery["routerSync"];
        settings?: { vpsDiscovery?: RadiusDiscovery | null; hasSecret?: boolean; enabled?: boolean };
        error?: string;
      };
      setRadiusProvisionResults(data.results ?? []);
      if (!response.ok && response.status !== 207) throw new Error(data.error || "RADIUS provisioning failed.");
      if (data.settings) {
        const discovery = data.settings.vpsDiscovery ?? null;
        setRadiusDiscovery(discovery);
        setRadiusCfg(current => ({
          ...current,
          enabled: data.settings?.enabled ?? current.enabled,
          hasSecret: data.settings?.hasSecret ?? current.hasSecret,
        }));
      }
      if (!data.ok) setRadiusError("Some selected routers need attention; see their individual results.");
    } catch (error) {
      setRadiusError(error instanceof Error ? error.message : "RADIUS provisioning failed.");
    } finally {
      setRadiusProvisioning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadEmailSettings = async () => {
      try {
        const response = await fetch("/api/super-admin/email-settings", {
          headers: superAdminHeaders(),
          cache: "no-store",
        });
        const data = await response.json() as {
          settings?: {
            enabled?: boolean; host?: string; port?: number; security?: string;
            authEnabled?: boolean; username?: string; fromEmail?: string;
            fromName?: string; securityEmail?: string; hasPassword?: boolean;
            configured?: boolean;
          };
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Email settings could not be loaded.");
        if (cancelled || !data.settings) return;
        setEmailCfg(current => ({
          ...current,
          ...data.settings,
          port: String(data.settings?.port ?? 587),
          password: "",
        }));
      } catch (error) {
        if (!cancelled) setEmailError(error instanceof Error ? error.message : "Email settings could not be loaded.");
      } finally {
        if (!cancelled) setEmailLoading(false);
      }
    };
    void loadEmailSettings();
    return () => { cancelled = true; };
  }, []);

  const setPageEnabled = (key: string, enabled: boolean) => {
    if (key === "overview.dashboard" || key === "overview") return;
    setPageVisibility(current => ({ ...current, [key]: enabled }));
    setVisibilitySaved(false);
  };

  const savePageVisibility = async () => {
    setVisibilitySaving(true);
    setVisibilityError("");
    try {
      const response = await fetch("/api/super-admin/admin-page-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        body: JSON.stringify({ visibility: pageVisibility }),
      });
      const data = await response.json() as { visibility?: Record<string, boolean>; error?: string };
      if (!response.ok) throw new Error(data.error || "Visibility settings could not be saved.");
      if (data.visibility) setPageVisibility(data.visibility);
      setVisibilitySaved(true);
      setTimeout(() => setVisibilitySaved(false), 3000);
    } catch (error) {
      setVisibilityError(error instanceof Error ? error.message : "Visibility settings could not be saved.");
    } finally {
      setVisibilitySaving(false);
    }
  };

  const saveEmailSettings = async () => {
    setEmailSaving(true);
    setEmailError("");
    setEmailTestMessage("");
    try {
      const response = await fetch("/api/super-admin/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        body: JSON.stringify({
          enabled: emailCfg.enabled,
          host: emailCfg.host,
          port: emailCfg.port,
          security: emailCfg.security,
          authEnabled: emailCfg.authEnabled,
          username: emailCfg.username,
          password: emailCfg.password,
          fromEmail: emailCfg.fromEmail,
          fromName: emailCfg.fromName,
          securityEmail: emailCfg.securityEmail,
        }),
      });
      const data = await response.json() as {
        settings?: {
          enabled?: boolean; host?: string; port?: number; security?: string;
          authEnabled?: boolean; username?: string; fromEmail?: string;
          fromName?: string; securityEmail?: string; hasPassword?: boolean;
          configured?: boolean;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "SMTP settings could not be saved.");
      if (data.settings) {
        setEmailCfg(current => ({
          ...current,
          ...data.settings,
          port: String(data.settings?.port ?? current.port),
          password: "",
        }));
      }
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "SMTP settings could not be saved.");
    } finally {
      setEmailSaving(false);
    }
  };

  const sendTestEmail = async () => {
    setEmailTesting(true);
    setEmailError("");
    setEmailTestMessage("");
    try {
      const response = await fetch("/api/super-admin/email-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...superAdminHeaders() },
        body: JSON.stringify({ to: emailCfg.securityEmail }),
      });
      const data = await response.json() as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Test email could not be sent.");
      setEmailTestMessage(data.message || "Test email sent.");
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Test email could not be sent.");
    } finally {
      setEmailTesting(false);
    }
  };

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

        {/* Platform-wide SMTP */}
        <Card title="Email (SMTP)" icon={Mail}>
          {emailLoading ? (
            <p style={{ color: C.muted, fontSize: "0.82rem", margin: 0 }}>Loading secure email settings…</p>
          ) : (
            <>
              <p style={{ color: C.muted, fontSize: "0.8rem", lineHeight: 1.55, margin: "0 0 16px" }}>
                One shared sender for the platform. Registration confirmations go to the new account; gateway-change and Super Admin sign-in alerts go to the security email. SMTP passwords are encrypted and never returned to this page.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 16px" }}>
                <Field label="SMTP Host">
                  <input style={inp} value={emailCfg.host} placeholder="smtp.your-provider.com" onChange={e => updateEmailCfg({ host: e.target.value })} />
                </Field>
                <Field label="SMTP Port">
                  <input style={inp} type="number" min="1" max="65535" value={emailCfg.port} onChange={e => updateEmailCfg({ port: e.target.value })} />
                </Field>
                <Field label="Connection Security">
                  <select style={inp} value={emailCfg.security} onChange={e => updateEmailCfg({ security: e.target.value })}>
                    <option value="starttls">STARTTLS (recommended, usually port 587)</option>
                    <option value="tls">SSL/TLS (usually port 465)</option>
                    <option value="none">None (not recommended)</option>
                  </select>
                </Field>
                <Field label="Sender Email">
                  <input style={inp} type="email" value={emailCfg.fromEmail} placeholder="notifications@example.com" onChange={e => updateEmailCfg({ fromEmail: e.target.value })} />
                </Field>
                <Field label="Sender Name">
                  <input style={inp} value={emailCfg.fromName} placeholder="OcholaSupernet" onChange={e => updateEmailCfg({ fromName: e.target.value })} />
                </Field>
                <Field label="Security Alert Email">
                  <input style={inp} type="email" value={emailCfg.securityEmail} placeholder="admin@example.com" onChange={e => updateEmailCfg({ securityEmail: e.target.value })} />
                </Field>
                <Field label="SMTP Username">
                  <input style={inp} value={emailCfg.username} autoComplete="username" onChange={e => updateEmailCfg({ username: e.target.value })} />
                </Field>
                <Field label="SMTP Password">
                  <input
                    style={inp}
                    type="password"
                    autoComplete="new-password"
                    value={emailCfg.password}
                    placeholder={emailCfg.hasPassword ? "Saved — leave blank to keep it" : "SMTP app password"}
                    onChange={e => updateEmailCfg({ password: e.target.value })}
                  />
                </Field>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 9, color: C.text, fontSize: "0.82rem", margin: "2px 0 16px", cursor: "pointer" }}>
                <input type="checkbox" checked={emailCfg.authEnabled} onChange={e => updateEmailCfg({ authEnabled: e.target.checked })} />
                Use SMTP username and password authentication
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 9, color: C.text, fontSize: "0.82rem", marginBottom: 18, cursor: "pointer" }}>
                <input type="checkbox" checked={emailCfg.enabled} onChange={e => updateEmailCfg({ enabled: e.target.checked })} />
                Enable platform email delivery
              </label>
              {emailCfg.hasPassword && (
                <p style={{ color: "#86efac", fontSize: "0.76rem", margin: "-8px 0 14px" }}>
                  An SMTP password is saved securely. Leaving the password field blank keeps the current one.
                </p>
              )}
              {emailError && <p role="alert" style={{ color: "#fca5a5", fontSize: "0.8rem", margin: "0 0 12px" }}>{emailError}</p>}
              {emailTestMessage && <p role="status" style={{ color: "#86efac", fontSize: "0.8rem", margin: "0 0 12px" }}>{emailTestMessage}</p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void saveEmailSettings()}
                  disabled={emailSaving}
                  style={{ display: "flex", alignItems: "center", gap: 8, background: emailSaved ? "#065f46" : C.accent, border: "none", borderRadius: 9, padding: "9px 15px", color: "white", fontWeight: 700, fontSize: "0.8rem", cursor: emailSaving ? "wait" : "pointer", opacity: emailSaving ? 0.7 : 1 }}
                >
                  {emailSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {emailSaving ? "Saving…" : emailSaved ? "Email Saved" : "Save Email Settings"}
                </button>
                <button
                  type="button"
                  onClick={() => void sendTestEmail()}
                  disabled={emailTesting || !emailCfg.configured || !emailCfg.enabled}
                  style={{ display: "flex", alignItems: "center", gap: 8, background: "#172033", border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 15px", color: C.text, fontWeight: 700, fontSize: "0.8rem", cursor: emailTesting || !emailCfg.configured || !emailCfg.enabled ? "not-allowed" : "pointer", opacity: emailTesting || !emailCfg.configured || !emailCfg.enabled ? 0.55 : 1 }}
                >
                  <Mail size={14} /> {emailTesting ? "Sending…" : "Send Test Email"}
                </button>
              </div>
            </>
          )}
        </Card>

        {/* RADIUS */}
        <Card title="RADIUS Server" icon={Server}>
          {radiusLoading ? (
            <p role="status" style={{ display: "flex", alignItems: "center", gap: 8, color: C.sub, fontSize: 13 }}><Loader2 size={15} className="animate-spin" /> Loading secure RADIUS settings…</p>
          ) : (
            <>
              <p style={{ color: C.sub, fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
                The configured VPS IP is detected separately from a verified FreeRADIUS endpoint. The shared secret is encrypted at rest and is never returned by ordinary settings requests.
              </p>
              <div style={{ padding: 14, marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 10, background: "rgba(0,0,0,0.16)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <strong style={{ color: C.text, fontSize: 13 }}>Configured VPS discovery</strong>
                  <button type="button" onClick={() => void checkRadiusOnVps()} disabled={radiusChecking} style={{ border: 0, borderRadius: 8, padding: "8px 12px", background: C.accent, color: "#fff", fontWeight: 700, cursor: radiusChecking ? "wait" : "pointer", opacity: radiusChecking ? 0.7 : 1 }}>
                    {radiusChecking ? "Checking VPS…" : "Check VPS"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 12, fontSize: 12, color: C.sub }}>
                  <div>Detected VPS IP: <strong style={{ color: C.text }}>{radiusDiscovery?.detectedVpsIp || "Not detected"}</strong></div>
                  <div>FreeRADIUS: <strong style={{ color: radiusDiscovery?.installed ? C.text : "#fbbf24" }}>{radiusDiscovery?.installed ? "Installed" : "Not installed/not configured"}</strong></div>
                  <div>Service: <strong style={{ color: radiusDiscovery?.running ? C.text : "#fbbf24" }}>{radiusDiscovery?.running ? "Running" : "Not running"}</strong></div>
                  <div>Configuration: <strong style={{ color: radiusDiscovery?.configurationValid ? C.text : "#fbbf24" }}>{radiusDiscovery?.configurationValid ? "Valid" : "Not configured"}</strong></div>
                  <div>VPS-local UDP listeners: <strong style={{ color: radiusDiscovery?.authenticationListening && radiusDiscovery?.accountingListening ? C.text : "#fbbf24" }}>{radiusDiscovery?.authenticationListening && radiusDiscovery?.accountingListening ? "Authentication and accounting listening" : "Not verified"}</strong></div>
                  <div>Router client provisioning: <strong style={{ color: radiusDiscovery?.endpointVerified ? C.text : "#fbbf24" }}>{radiusDiscovery?.endpointVerified ? "Ready after explicit router selection" : "Unavailable until RADIUS is verified"}</strong></div>
                  <div>Last check: <strong style={{ color: C.text }}>{radiusDiscovery?.checkedAt ? new Date(radiusDiscovery.checkedAt).toLocaleString() : "Never"}</strong></div>
                </div>
                {radiusDiscovery?.detectedVpsIp && <p style={{ color: C.sub, fontSize: 12, margin: "10px 0 0" }}>Detected VPS public IP: {radiusDiscovery.detectedVpsIp}</p>}
                {radiusDiscovery?.endpointVerified && <p style={{ color: "#86efac", fontSize: 12, margin: "6px 0 0" }}>Verified RADIUS endpoint over the management VPN: {radiusDiscovery.radiusHost}:{radiusDiscovery.authenticationPort} auth / {radiusDiscovery.accountingPort} accounting.</p>}
                {radiusDiscovery?.endpointVerified && <p style={{ color: C.sub, fontSize: 12, margin: "6px 0 0" }}>This confirms the VPS service and local UDP listeners. A router configuration sync does not prove firewall reachability; verify with a live authentication/accounting request.</p>}
                {(radiusDiscovery?.error || radiusCheckError) && <p role="status" style={{ color: "#fbbf24", fontSize: 12, margin: "10px 0 0" }}>{radiusCheckError || radiusDiscovery?.error}</p>}
                {radiusDiscovery?.secretSynchronized === false && <p style={{ color: "#fbbf24", fontSize: 12, margin: "10px 0 0" }}>Shared secret is not synchronized to this VPS.</p>}
                {!radiusDiscovery?.installed && <p style={{ color: C.sub, fontSize: 12, margin: "10px 0 0" }}>Guided setup: install and enable FreeRADIUS on the configured VPS, configure authentication and accounting UDP listeners, then run this check again. No server changes are made by the check.</p>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <Field label="Verified RADIUS Host" hint="Populated only after a successful VPS check">
                  <input style={{ ...inp, opacity: 0.75 }} readOnly value={radiusCfg.host} placeholder="Not installed/not configured" />
                </Field>
                <Field label="Verified Authentication Port">
                  <input style={{ ...inp, opacity: 0.75 }} readOnly value={radiusCfg.authenticationPort} placeholder="Not configured" />
                </Field>
                <Field label="Verified Accounting Port">
                  <input style={{ ...inp, opacity: 0.75 }} readOnly value={radiusCfg.accountingPort} placeholder="Not configured" />
                </Field>
              </div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 12 }}>
                <button type="button" disabled={radiusSecretBusy || radiusCfg.hasSecret} onClick={() => void createOrRotateRadiusSecret(false)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", background: "rgba(255,255,255,0.06)", color: C.text, cursor: radiusSecretBusy || radiusCfg.hasSecret ? "not-allowed" : "pointer", opacity: radiusCfg.hasSecret ? 0.5 : 1 }}>
                  {radiusSecretBusy ? "Working…" : "Generate common secret"}
                </button>
                <button type="button" disabled={radiusSecretBusy || !radiusCfg.hasSecret} onClick={() => void createOrRotateRadiusSecret(true)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", background: "rgba(255,255,255,0.06)", color: C.text, cursor: radiusSecretBusy || !radiusCfg.hasSecret ? "not-allowed" : "pointer", opacity: !radiusCfg.hasSecret ? 0.5 : 1 }}>
                  Rotate common secret
                </button>
              </div>
              {radiusSecretOnce && (
                <div style={{ margin: "0 0 14px", padding: 12, border: "1px solid rgba(251,191,36,0.35)", borderRadius: 9, background: "rgba(251,191,36,0.08)" }}>
                  <p style={{ color: "#fbbf24", fontSize: 12, margin: "0 0 8px" }}>Copy and store this secret now. It will not be shown again. RADIUS remains disabled until provisioning succeeds.</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <code style={{ flex: 1, overflowWrap: "anywhere", color: C.text, fontSize: 12 }}>{radiusSecretOnce}</code>
                    <button type="button" aria-label="Copy RADIUS secret" onClick={() => void navigator.clipboard.writeText(radiusSecretOnce).catch(() => setRadiusError("Clipboard access failed; copy the secret manually now."))} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 9px", background: "transparent", color: C.text, cursor: "pointer" }}><Copy size={13} /> Copy</button>
                  </div>
                  <button type="button" onClick={() => setRadiusSecretOnce("")} style={{ marginTop: 8, border: 0, background: "transparent", color: C.sub, cursor: "pointer", padding: 0 }}>Hide secret</button>
                </div>
              )}
              {radiusCfg.hasSecret && <p style={{ color: radiusDiscovery?.secretSynchronized ? "#86efac" : "#fbbf24", fontSize: 12, marginTop: -4 }}>{radiusDiscovery?.secretSynchronized ? "Shared secret is synchronized to the VPS and routers in the latest provisioning batch." : "A shared secret is saved encrypted, but is not yet synchronized."}</p>}
              <p style={{ color: "#fbbf24", fontSize: 12, lineHeight: 1.5 }}>A common secret is supported as requested, but unique secrets per VPS/router are safer. Non-managed RADIUS entries are never overwritten; tagged managed entries change only after explicit confirmation.</p>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <strong style={{ color: C.text, fontSize: 13 }}>Explicit router enrollment</strong>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => setSelectedRadiusRouters(radiusRouters.filter(router => router.eligible).map(router => router.id))} disabled={radiusRoutersLoading || radiusProvisioning || !radiusRouters.some(router => router.eligible)} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 9px", background: "transparent", color: C.text, cursor: "pointer" }}>Select all eligible</button>
                    <button type="button" onClick={() => void loadRadiusRouters()} disabled={radiusRoutersLoading} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 9px", background: "transparent", color: C.text, cursor: "pointer" }}>{radiusRoutersLoading ? "Loading…" : "Refresh routers"}</button>
                  </div>
                </div>
                {radiusRouters.length === 0 ? <p style={{ color: C.sub, fontSize: 12 }}>No router records were found.</p> : (
                  <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 5 }}>
                    {radiusRouters.map(router => {
                      const last = radiusProvisionResults.find(result => result.routerId === router.id)
                        ?? radiusDiscovery?.routerSync?.find(result => result.routerId === router.id);
                      return (
                        <label key={router.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 4px", color: router.eligible ? C.text : C.sub, fontSize: 12, opacity: router.eligible ? 1 : 0.7 }}>
                          <input type="checkbox" disabled={!router.eligible || !radiusCfg.hasSecret || radiusProvisioning} checked={selectedRadiusRouters.includes(router.id)} onChange={event => setSelectedRadiusRouters(current => event.target.checked ? [...new Set([...current, router.id])] : current.filter(id => id !== router.id))} />
                          <span style={{ flex: 1 }}>{router.name} · {router.vpnIp || "No management VPN address"}{!router.eligible && router.reason ? ` · ${router.reason}` : ""}</span>
                          {last && <strong style={{ color: last.status === "added" || last.status === "already-synced" ? "#86efac" : "#fbbf24" }}>{last.status}{last.error ? `: ${last.error}` : ""}</strong>}
                        </label>
                      );
                    })}
                  </div>
                )}
                <button type="button" onClick={() => void provisionSelectedRadiusRouters()} disabled={radiusProvisioning || !radiusCfg.hasSecret || !radiusDiscovery?.endpointVerified || selectedRadiusRouters.length === 0} style={{ marginTop: 10, border: 0, borderRadius: 8, padding: "8px 12px", background: C.accent, color: "#fff", fontWeight: 700, cursor: "pointer", opacity: radiusProvisioning || !radiusCfg.hasSecret || !radiusDiscovery?.endpointVerified || selectedRadiusRouters.length === 0 ? 0.5 : 1 }}>
                  {radiusProvisioning ? "Provisioning selected routers…" : `Provision ${selectedRadiusRouters.length} selected router${selectedRadiusRouters.length === 1 ? "" : "s"}`}
                </button>
              </div>
              {radiusCfg.source === "environment" && <p style={{ color: C.sub, fontSize: 12 }}>The existing environment configuration is being used until a generated secret is explicitly rotated into secure storage.</p>}
              <p style={{ color: C.sub, fontSize: 12 }}>Provisioning changes only the routers you select. New Self Install downloads never contain the shared secret.</p>
              {radiusError && <p role="alert" style={{ display: "flex", alignItems: "center", gap: 7, color: "#fca5a5", fontSize: 13 }}><AlertCircle size={14} /> {radiusError}</p>}
            </>
          )}
        </Card>

        {/* SMS settings are managed in their dedicated platform integration page. */}
        <Card title="SMS Messaging" icon={Sliders}>
          <p style={{ color: "var(--text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
            Configure Africa’s Talking credentials and SMS features in the dedicated messaging settings.
          </p>
          <a href="/super-admin/sms" style={{ display: "inline-block", color: "var(--accent, #38bdf8)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            Open SMS settings →
          </a>
        </Card>

        {/* Flags */}
        <Card title="Platform Flags" icon={Shield}>
          <Toggle on={cfg.maintenanceMode} onChange={v => set("maintenanceMode", v)} label="Maintenance Mode (locks out all ISP admins)" />
          <Toggle on={cfg.registrationOpen} onChange={v => set("registrationOpen", v)} label="Open ISP Registration (allow new signups)" />
          <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "0.82rem", color: C.sub }}>Email verification for all new sign-ups</span>
            <strong style={{ fontSize: "0.72rem", color: C.accent, letterSpacing: "0.04em", textTransform: "uppercase" }}>Always required</strong>
          </div>
          <Toggle on={cfg.autoSuspend} onChange={v => set("autoSuspend", v)} label="Auto-Suspend overdue ISP accounts" />
          <Toggle on={cfg.darkModeDefault} onChange={v => set("darkModeDefault", v)} label="Dark Mode as Default Theme" />
        </Card>

        <Card title="ISP Admin Page Visibility" icon={Eye}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
            <div>
              <p style={{ color: C.sub, fontSize: "0.82rem", margin: 0, lineHeight: 1.5 }}>
                Choose which modules and pages appear in every ISP Admin Panel. Disabling a module also blocks its pages.
              </p>
              <p style={{ color: C.muted, fontSize: "0.72rem", margin: "5px 0 0" }}>
                The Dashboard always remains available as the safe fallback.
              </p>
            </div>
            <button
              onClick={() => void savePageVisibility()}
              disabled={visibilityLoading || visibilitySaving}
              style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, background: visibilitySaved ? "#065f46" : C.accent, border: "none", borderRadius: 9, padding: "9px 14px", color: "white", fontWeight: 700, fontSize: "0.76rem", cursor: visibilityLoading || visibilitySaving ? "wait" : "pointer", opacity: visibilityLoading || visibilitySaving ? 0.7 : 1 }}
            >
              {visibilitySaving ? <Loader2 size={14} className="animate-spin" /> : visibilitySaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {visibilitySaving ? "Saving…" : visibilitySaved ? "Saved!" : "Save Visibility"}
            </button>
          </div>

          {visibilityError && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px", borderRadius: 8, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", fontSize: "0.76rem" }}>
              <AlertCircle size={14} /> {visibilityError}
            </div>
          )}

          {visibilityLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: "0.8rem", padding: "16px 0" }}>
              <Loader2 size={15} className="animate-spin" /> Loading page visibility…
            </div>
          ) : (
            <div>
              {ADMIN_PAGE_VISIBILITY_CATALOG.map(section => {
                const sectionEnabled = section.key === "overview" || pageVisibility[section.key] !== false;
                return (
                  <div key={section.key} style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 13px", background: "rgba(255,255,255,0.03)" }}>
                      <div>
                        <div style={{ color: "white", fontSize: "0.82rem", fontWeight: 700 }}>{section.label}</div>
                        <div style={{ color: C.muted, fontSize: "0.7rem", marginTop: 2 }}>{section.description}</div>
                      </div>
                      <button
                        aria-label={`${sectionEnabled ? "Disable" : "Enable"} ${section.label}`}
                        disabled={section.key === "overview"}
                        onClick={() => setPageEnabled(section.key, !sectionEnabled)}
                        style={{ width: 42, height: 22, borderRadius: 11, background: sectionEnabled ? C.accent : "rgba(255,255,255,0.1)", border: "none", cursor: section.key === "overview" ? "not-allowed" : "pointer", position: "relative", padding: 0, opacity: section.key === "overview" ? 0.65 : 1 }}
                      >
                        <span style={{ position: "absolute", top: 3, left: sectionEnabled ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
                      </button>
                    </div>
                    <div style={{ padding: "0 13px", opacity: sectionEnabled ? 1 : 0.48 }}>
                      {section.pages.map(page => {
                        const enabled = page.key === "overview.dashboard" || pageVisibility[page.key] !== false;
                        return (
                          <div key={page.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                            <div>
                              <div style={{ color: C.sub, fontSize: "0.78rem", fontWeight: 600 }}>{page.label}</div>
                              <div style={{ color: C.muted, fontSize: "0.68rem", marginTop: 2 }}>{page.description}</div>
                            </div>
                            <button
                              aria-label={`${enabled ? "Disable" : "Enable"} ${page.label}`}
                              disabled={!sectionEnabled || page.key === "overview.dashboard"}
                              onClick={() => setPageEnabled(page.key, !enabled)}
                              style={{ width: 38, height: 20, borderRadius: 10, background: enabled ? C.accent : "rgba(255,255,255,0.1)", border: "none", cursor: !sectionEnabled || page.key === "overview.dashboard" ? "not-allowed" : "pointer", position: "relative", padding: 0 }}
                            >
                              <span style={{ position: "absolute", top: 3, left: enabled ? 20 : 3, width: 14, height: 14, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
