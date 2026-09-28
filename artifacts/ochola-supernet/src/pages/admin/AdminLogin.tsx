import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { clearAdminAuth, clearPasswordSetupToken, setAdminAuth, setPasswordSetupToken, supabase } from "@/lib/supabase";
import { getHostSubdomain } from "@/lib/subdomain";
import { Logo } from "@/components/Logo";

interface CompanyInfo {
  id: number;
  name: string;
  subdomain: string;
}

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const loginSubdomain = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("subdomain") || "").trim().toLowerCase()
    : "";
  const firstLogin = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("first_login") === "1";
  const [username, setUsername]         = useState(firstLogin ? "admin" : "");
  const [password, setPassword]         = useState(firstLogin ? "admin" : "");
  const [companySubdomain, setCompanySubdomain] = useState(loginSubdomain);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState("");
  const [whatsappLoginEnabled, setWhatsappLoginEnabled] = useState(false);
  const [whatsappRecoveryEnabled, setWhatsappRecoveryEnabled] = useState(false);
  const [smsLoginEnabled, setSmsLoginEnabled] = useState(false);
  const [smsRecoveryEnabled, setSmsRecoveryEnabled] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"password" | "whatsapp" | "sms" | "recovery">("password");
  const [otpChannel, setOtpChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpPurpose, setOtpPurpose] = useState<"login" | "recovery">("login");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpNotice, setOtpNotice] = useState("");
  const [resendWait, setResendWait] = useState(0);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryStage, setRecoveryStage] = useState<"request" | "verify" | "password">("request");

  const [company, setCompany]               = useState<CompanyInfo | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const hostSubdomain = getHostSubdomain();

  useEffect(() => {
    const sub = getHostSubdomain();
    if (!sub) return;
    setCompanyLoading(true);
    void (async () => {
      try {
        const { data } = await supabase
          .from("isp_admins")
          .select("id, name, subdomain")
          .ilike("subdomain", sub)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (data) setCompany(data as CompanyInfo);
      } finally {
        setCompanyLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch("/api/whatsapp/public-config", { cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null),
      fetch("/api/sms/public-config", { cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null),
    ]).then(([whatsapp, sms]) => {
      setWhatsappLoginEnabled(whatsapp?.loginEnabled === true);
      setWhatsappRecoveryEnabled(whatsapp?.passwordRecoveryEnabled === true);
      setSmsLoginEnabled(sms?.loginEnabled === true);
      setSmsRecoveryEnabled(sms?.passwordRecoveryEnabled === true);
    });
  }, []);

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = window.setTimeout(() => setResendWait(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendWait]);

  const requestOtpCode = async (
    purpose: "login" | "recovery",
    channel: "whatsapp" | "sms" = otpChannel,
  ) => {
    setError("");
    setOtpNotice("");
    if (!whatsappPhone.trim()) {
      setError("Enter your phone number.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(`/api/auth/${channel}/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: whatsappPhone.trim(),
          purpose,
          accountType: "admin",
          subdomain: (hostSubdomain || companySubdomain).trim().toLowerCase(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not request a verification code.");
      setOtpChannel(channel);
      setOtpChallengeId(data.challengeId);
      setOtpPurpose(purpose);
      setOtpCode("");
      setResendWait(Number(data.resendAfterSeconds) || 60);
      if (purpose === "recovery") setRecoveryStage("verify");
      setOtpNotice(data.message || `If eligible, a code will be sent by ${channel === "sms" ? "SMS" : "WhatsApp"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request a verification code.");
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyWhatsappCode = async () => {
    setError("");
    setOtpNotice("");
    setOtpLoading(true);
    try {
      const response = await fetch(`/api/auth/${otpChannel}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: otpChallengeId, code: otpCode }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The code is invalid or expired.");

      if (otpPurpose === "recovery") {
        if (!data.resetToken) throw new Error("Could not start password recovery. Request a new code.");
        setResetToken(data.resetToken);
        setRecoveryStage("password");
        return;
      }
      const admin = data.admin as {
        id: number;
        name?: string;
        fullname?: string | null;
        username: string;
        email?: string | null;
        role?: string;
        area?: string;
        currency?: string;
      } | undefined;
      if (!admin || (company && admin.id !== company.id)) {
        throw new Error("This number could not be matched to this company portal.");
      }
      if (data.requiresPasswordSetup) {
        if (!data.setupToken) throw new Error("Could not start password setup. Please try again.");
        clearAdminAuth();
        clearPasswordSetupToken();
        setPasswordSetupToken(data.setupToken);
        setLocation("/admin/set-password");
        return;
      }
      if (!data.token) throw new Error("Could not create a secure admin session. Please try again.");
      clearPasswordSetupToken();
      setAdminAuth(admin.id, admin.username, admin.name || admin.username, admin.role, data.token, admin.fullname || undefined);
      try {
        if (admin.currency) localStorage.setItem("ochola_admin_currency", admin.currency);
        if (admin.area) localStorage.setItem("ochola_admin_country", admin.area);
      } catch {}
      setLocation(admin.role === "reseller" ? "/admin/reseller" : "/admin/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phone verification failed.");
    } finally {
      setOtpLoading(false);
    }
  };

  const saveRecoveredPassword = async () => {
    setError("");
    setOtpLoading(true);
    try {
      const response = await fetch(`/api/auth/${otpChannel}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, password: newPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Password could not be reset.");
      setOtpNotice("Password updated. Sign in with your new password.");
      setLoginMethod("password");
      setRecoveryStage("request");
      setResetToken("");
      setNewPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be reset.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
     if (!username.trim() || !password.trim()) {
       setError("Please enter your email or username and password.");
      return;
    }
    setIsLoading(true);
    try {
      const apiLogin = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          subdomain: (hostSubdomain || companySubdomain).trim().toLowerCase(),
        }),
      });
      const apiSession = await apiLogin.json() as {
        ok?: boolean;
        token?: string;
        requiresPasswordSetup?: boolean;
        setupToken?: string;
        error?: string;
         admin?: { id: number; name?: string; fullname?: string | null; username: string; email?: string | null; role?: string; subdomain?: string; area?: string; currency?: string };
      };
      if (!apiLogin.ok || !apiSession.ok || !apiSession.admin) {
        setError(apiSession.error || "Could not create a secure admin session. Please try again.");
        return;
      }
      const admin = apiSession.admin;
      if (company && (admin.id !== company.id || (admin.username !== username.trim() && admin.email !== username.trim().toLowerCase()))) {
        setError("Invalid username or password.");
        return;
      }
      if (apiSession.requiresPasswordSetup) {
        if (!apiSession.setupToken) {
          setError("Could not start password setup. Please try again.");
          return;
        }
        clearAdminAuth();
        clearPasswordSetupToken();
        setPasswordSetupToken(apiSession.setupToken);
        setLocation("/admin/set-password");
        return;
      }
      if (!apiSession.token) {
        setError("Could not create a secure admin session. Please try again.");
        return;
      }
      clearPasswordSetupToken();
      setAdminAuth(admin.id, admin.username, admin.name || admin.username, admin.role, apiSession.token, admin.fullname || undefined);
      /* store country + currency so formatCurrency works immediately */
      try {
        if (admin.currency) localStorage.setItem("ochola_admin_currency", admin.currency);
        if (admin.area) localStorage.setItem("ochola_admin_country", admin.area);
      } catch {}
       setLocation(admin.role === "reseller" ? "/admin/reseller" : "/admin/dashboard");
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const displayName   = company?.name ?? "ISPlatty";
  const displayDomain = company ? `${company.subdomain}.isplatty.org` : "isplatty.org";

  const inputStyle: React.CSSProperties = {
    width: "100%", paddingLeft: 38, paddingRight: 14,
    paddingTop: 11, paddingBottom: 11,
    background: "var(--isp-input-bg)",
    border: "1.5px solid var(--isp-input-border)",
    borderRadius: 10,
     fontSize: "0.95rem", color: "var(--isp-text)",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  const passwordInputStyle: React.CSSProperties = {
    ...inputStyle,
    paddingRight: 44,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--isp-bg)",
      display: "flex",
        fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{
        display: "none",
        width: "45%",
        background: "#0F172A",
        padding: "48px",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
      }}
        className="login-left-panel"
      >
        <div style={{
          position: "absolute", top: -80, right: -80,
          width: 320, height: 320, borderRadius: "50%",
          background: "var(--isp-accent-glow)",
        }} />
        <div style={{
          position: "absolute", bottom: -60, left: -60,
          width: 240, height: 240, borderRadius: "50%",
          background: "var(--isp-accent-glow)",
        }} />

         <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
           <Logo size="lg" />
         </div>

        <div style={{ position: "relative" }}>
          <h2 style={{
             fontSize: "2rem", fontWeight: 600, color: "#F1F5F9",
            lineHeight: 1.25, letterSpacing: "-0.03em", marginBottom: 16,
          }}>
            Manage your ISP with confidence
          </h2>
           <p style={{ fontSize: "1rem", color: "#64748B", lineHeight: 1.7 }}>
            Billing, MikroTik automation, hotspot management, and M-Pesa payments — all in one platform.
          </p>

          <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 12 }}>
            {["Automated billing & renewals", "MikroTik router integration", "M-Pesa payment processing", "Real-time subscriber management"].map(f => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: "var(--isp-green-glow)", border: "1px solid rgba(34,197,94,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                 <span style={{ fontSize: "0.9rem", color: "#94A3B8" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

         <div style={{ fontSize: "0.78rem", color: "#334155", position: "relative" }}>
          © 2024 ISPlatty · isplatty.org
        </div>
      </div>

      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}>
        <div style={{ width: "100%", maxWidth: 420 }}>

           <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, marginBottom: 30 }}>
             <Logo size="lg" />
             <div style={{ fontSize: "0.75rem", color: "var(--isp-text-sub)", fontWeight: 600, textAlign: "center" }}>
               {displayName} · {displayDomain}
             </div>
           </div>

          <h1 style={{
             fontSize: "1.9rem", fontWeight: 600, color: "var(--isp-text)",
            letterSpacing: "-0.03em", marginBottom: 6,
          }}>
            Welcome back
          </h1>
           <p style={{ fontSize: "1rem", color: "var(--isp-text-muted)", marginBottom: 32 }}>
            Sign in to your admin dashboard
          </p>

          {(whatsappLoginEnabled || smsLoginEnabled || whatsappRecoveryEnabled || smsRecoveryEnabled) && (
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button type="button" onClick={() => { setLoginMethod("password"); setError(""); }} aria-pressed={loginMethod === "password"} style={{ flex: 1, border: "1px solid var(--isp-input-border)", borderRadius: 9, padding: "9px 10px", background: loginMethod === "password" ? "var(--isp-accent-glow)" : "transparent", color: "var(--isp-text)", cursor: "pointer", fontWeight: 600 }}>
                Use password
              </button>
              {whatsappLoginEnabled && <button type="button" onClick={() => { setLoginMethod("whatsapp"); setOtpChannel("whatsapp"); setOtpChallengeId(""); setOtpCode(""); setError(""); setOtpNotice(""); }} aria-pressed={loginMethod === "whatsapp"} style={{ flex: 1, border: "1px solid var(--isp-input-border)", borderRadius: 9, padding: "9px 10px", background: loginMethod === "whatsapp" ? "var(--isp-accent-glow)" : "transparent", color: "var(--isp-text)", cursor: "pointer", fontWeight: 600 }}>
                WhatsApp
              </button>}
              {smsLoginEnabled && <button type="button" onClick={() => { setLoginMethod("sms"); setOtpChannel("sms"); setOtpChallengeId(""); setOtpCode(""); setError(""); setOtpNotice(""); }} aria-pressed={loginMethod === "sms"} style={{ flex: 1, border: "1px solid var(--isp-input-border)", borderRadius: 9, padding: "9px 10px", background: loginMethod === "sms" ? "var(--isp-accent-glow)" : "transparent", color: "var(--isp-text)", cursor: "pointer", fontWeight: 600 }}>
                SMS
              </button>}
            </div>
          )}

          {error && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
               <p style={{ fontSize: "0.9rem", color: "#DC2626", margin: 0 }}>{error}</p>
            </div>
          )}
          {otpNotice && <p role="status" style={{ margin: "0 0 16px", fontSize: "0.83rem", color: "var(--isp-text-muted)" }}>{otpNotice}</p>}

           <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
             {!hostSubdomain && (
               <div>
                 <label style={{
                   display: "block", fontSize: "0.88rem", fontWeight: 600,
                   color: "var(--isp-text)", marginBottom: 7,
                 }}>
                   Company subdomain
                 </label>
                 <div style={{ position: "relative" }}>
                   <span style={{
                     position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                     color: "var(--isp-text-sub)", fontSize: "0.9rem", pointerEvents: "none",
                   }}>https://</span>
                   <input
                     type="text"
                     value={companySubdomain}
                     onChange={e => setCompanySubdomain(e.target.value)}
                     placeholder="your-company"
                     autoComplete="organization"
                     style={{ ...inputStyle, paddingLeft: 62, paddingRight: 104 }}
                   />
                   <span style={{
                     position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                     color: "var(--isp-text-sub)", fontSize: "0.82rem", pointerEvents: "none",
                   }}>.isplatty.org</span>
                 </div>
                 <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                   Use the company name from your ISP address.
                 </p>
               </div>
             )}
             {loginMethod === "password" && <><div>
              <label style={{
                 display: "block", fontSize: "0.88rem", fontWeight: 600,
                color: "var(--isp-text)", marginBottom: 7,
              }}>
                 Email or username
              </label>
              <div style={{ position: "relative" }}>
                <User size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: "var(--isp-text-sub)",
                }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                   placeholder="you@yourcompany.com"
                  autoComplete="username"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

             <div>
              <label style={{
                 display: "block", fontSize: "0.88rem", fontWeight: 600,
                color: "var(--isp-text)", marginBottom: 7,
              }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: "var(--isp-text-sub)",
                }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={passwordInputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--isp-text-sub)", display: "flex", padding: 2,
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {(whatsappRecoveryEnabled || smsRecoveryEnabled) && (
                  <button type="button" onClick={() => { setLoginMethod("recovery"); setOtpChannel(smsRecoveryEnabled && !whatsappRecoveryEnabled ? "sms" : "whatsapp"); setRecoveryStage("request"); setOtpChallengeId(""); setResetToken(""); setError(""); setOtpNotice(""); }} style={{ display: "block", marginTop: 8, marginLeft: "auto", padding: 0, border: 0, background: "none", color: "var(--isp-accent)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
                    Forgot password?
                  </button>
                )}
              </div>
            </div></>}

            {(loginMethod === "whatsapp" || loginMethod === "sms" || loginMethod === "recovery") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {loginMethod === "recovery" && whatsappRecoveryEnabled && smsRecoveryEnabled && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>
                      Recovery method
                    </label>
                    <select
                      value={otpChannel}
                      onChange={event => {
                        const channel = event.target.value as "whatsapp" | "sms";
                        setOtpChannel(channel);
                        setOtpChallengeId("");
                        setOtpCode("");
                        setRecoveryStage("request");
                        setOtpNotice("");
                      }}
                      style={inputStyle}
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>
                    {otpChannel === "sms" ? "SMS phone number" : "WhatsApp phone number"}
                  </label>
                  <input
                    type="tel"
                    value={whatsappPhone}
                    onChange={event => { setWhatsappPhone(event.target.value); setOtpChallengeId(""); setOtpCode(""); setResetToken(""); setRecoveryStage("request"); }}
                    placeholder="+254712345678"
                    autoComplete="tel"
                    style={inputStyle}
                  />
                </div>

                {(loginMethod === "whatsapp" || loginMethod === "sms") && !otpChallengeId && (
                  <button type="button" onClick={() => void requestOtpCode("login", otpChannel)} disabled={otpLoading} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading ? 0.6 : 1 }}>
                    {otpLoading ? "Requesting code…" : otpChannel === "sms" ? "Continue with SMS" : "Continue with WhatsApp"}
                  </button>
                )}

                {loginMethod === "recovery" && recoveryStage === "request" && (
                  <button type="button" onClick={() => void requestOtpCode("recovery", otpChannel)} disabled={otpLoading} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading ? 0.6 : 1 }}>
                    {otpLoading ? "Requesting code…" : "Send recovery code"}
                  </button>
                )}

                {(((loginMethod === "whatsapp" || loginMethod === "sms") && otpChallengeId && otpPurpose === "login") || (loginMethod === "recovery" && recoveryStage === "verify")) && (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>
                        Enter the 6-digit code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={otpCode}
                        onChange={event => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        style={inputStyle}
                      />
                    </div>
                    <button type="button" onClick={() => void verifyWhatsappCode()} disabled={otpLoading || otpCode.length !== 6} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || otpCode.length !== 6 ? 0.6 : 1 }}>
                      {otpLoading ? "Verifying…" : "Verify code"}
                    </button>
                    <button type="button" onClick={() => void requestOtpCode(otpPurpose, otpChannel)} disabled={otpLoading || resendWait > 0} style={{ border: 0, background: "none", color: "var(--isp-accent)", cursor: resendWait > 0 ? "default" : "pointer", fontSize: "0.82rem", opacity: resendWait > 0 ? 0.6 : 1 }}>
                      {resendWait > 0 ? `Resend code in ${resendWait}s` : "Resend code"}
                    </button>
                  </>
                )}

                {loginMethod === "recovery" && recoveryStage === "password" && (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>New password</label>
                      <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={10} style={inputStyle} />
                    </div>
                    <button type="button" onClick={() => void saveRecoveredPassword()} disabled={otpLoading || newPassword.length < 10} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || newPassword.length < 10 ? 0.6 : 1 }}>
                      {otpLoading ? "Updating…" : "Reset password"}
                    </button>
                  </>
                )}
              </div>
            )}

            {loginMethod === "password" && <button
              type="submit"
              disabled={isLoading || companyLoading}
              className="btn btn-primary"
              style={{
                width: "100%", padding: "12px 20px",
                borderRadius: 10,
                opacity: isLoading || companyLoading ? 0.5 : 1,
                cursor: isLoading || companyLoading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {isLoading ? "Signing in…" : "Sign In"}
              {!isLoading && <ArrowRight size={16} />}
            </button>}
          </form>

           <p style={{ marginTop: 28, textAlign: "center", fontSize: "0.9rem", color: "var(--isp-text-sub)" }}>
            {company ? (
              <>Not the right portal?{" "}
                <a href="https://isplatty.org" style={{ color: "var(--isp-accent)", fontWeight: 600, textDecoration: "none" }}>
                  Visit main site
                </a>
              </>
            ) : (
              <>Don't have an account?{" "}
                <Link href="/admin/register">
                  <span style={{ color: "var(--isp-accent)", fontWeight: 600, cursor: "pointer" }}>Create an account</span>
                </Link>
              </>
            )}
          </p>

          <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--isp-green)",
            }} />
             <span style={{ fontSize: "0.8rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>
              All systems operational · {displayDomain}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .login-left-panel { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
