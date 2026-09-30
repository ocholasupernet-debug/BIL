import React, { useEffect, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Settings, Save, CheckCircle2, Globe, Mail, Server, Shield, Sliders, Eye, Loader2, AlertCircle } from "lucide-react";
import { ADMIN_PAGE_VISIBILITY_CATALOG } from "@/lib/admin-page-visibility";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

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
    radiusHost: "127.0.0.1",
    radiusPort: "1812",
    radiusSecret: "",
    taxRate: "16",
    currency: "KES",
    timezone: "Africa/Nairobi",
    dateFormat: "DD/MM/YYYY",
    maintenanceMode: false,
    registrationOpen: true,
    emailVerification: false,
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="RADIUS Host" hint="IP address of your FreeRADIUS server"><input style={inp} value={cfg.radiusHost} onChange={e => set("radiusHost", e.target.value)} /></Field>
            <Field label="RADIUS Port"><input style={inp} value={cfg.radiusPort} onChange={e => set("radiusPort", e.target.value)} /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="RADIUS Secret"><input style={inp} type="password" value={cfg.radiusSecret} onChange={e => set("radiusSecret", e.target.value)} placeholder="Shared secret" /></Field>
            </div>
          </div>
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
          <Toggle on={cfg.emailVerification} onChange={v => set("emailVerification", v)} label="Require Email Verification on Signup" />
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
