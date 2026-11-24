import React, { useCallback, useRef, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Wifi } from "lucide-react";
import { clearAdminAuth, clearPasswordSetupToken, setAdminAuth, setPasswordSetupToken } from "@/lib/supabase";
import { apiUrl } from "@/lib/api-client";
import { getHostSubdomain } from "@/lib/subdomain";
import { PUBLIC_BASE_DOMAIN } from "@/lib/public-domain";
import { INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_USERNAME } from "@/lib/initial-admin-credentials";
import { TurnstileCheck } from "@/components/TurnstileCheck";

interface CompanyInfo {
  id: number;
  name: string;
  subdomain: string;
}

interface AdminRecoveryOptions {
  email?: { masked: string };
  phone?: { masked: string };
}

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const loginSubdomain = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("subdomain") || "").trim().toLowerCase()
    : "";
  const firstLogin = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("first_login") === "1";
  const [username, setUsername]         = useState(firstLogin ? INITIAL_ADMIN_USERNAME : "");
  const [password, setPassword]         = useState(firstLogin ? INITIAL_ADMIN_PASSWORD : "");
  const [companySubdomain, setCompanySubdomain] = useState(loginSubdomain);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState("");
  const [whatsappLoginEnabled, setWhatsappLoginEnabled] = useState(false);
  const [smsLoginEnabled, setSmsLoginEnabled] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"password" | "whatsapp" | "sms" | "recovery">("password");
  const [otpChannel, setOtpChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpPurpose, setOtpPurpose] = useState<"login">("login");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpNotice, setOtpNotice] = useState("");
  const [resendWait, setResendWait] = useState(0);
  const turnstileTokenRef = useRef("");
  const updateTurnstileToken = useCallback((token: string) => {
    turnstileTokenRef.current = token.trim();
  }, []);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryOptions, setRecoveryOptions] = useState<AdminRecoveryOptions>({});
  const [recoveryChannel, setRecoveryChannel] = useState<"email" | "phone">("email");
  const [recoveryStage, setRecoveryStage] = useState<"request" | "verify" | "password">("request");
  const sessionExpired = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("session") === "expired";

  const [company, setCompany]               = useState<CompanyInfo | null>(null);
  const [tenantBranding, setTenantBranding] = useState<{ ispName?: string; logoUrl?: string }>({});
  const [tenantLogoFailed, setTenantLogoFailed] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const hostSubdomain = getHostSubdomain();

  useEffect(() => {
    const sub = getHostSubdomain();
    if (!sub) return;
    setCompanyLoading(true);
    void (async () => {
      try {
        const response = await fetch(apiUrl(`/api/auth/company-info?subdomain=${encodeURIComponent(sub)}`), { cache: "no-store" });
        const data = await response.json() as { company?: CompanyInfo | null };
        if (response.ok && data.company) {
          setCompany(data.company);
          setCompanyLoading(false);
          try {
            const brandingResponse = await fetch(
              apiUrl(`/api/public/hotspot-branding?adminId=${encodeURIComponent(data.company.id)}`),
              { cache: "no-store" },
            );
            if (brandingResponse.ok) {
              const brandingData = await brandingResponse.json() as {
                branding?: { settings?: { ispName?: string; logoUrl?: string } };
              };
              const settings = brandingData.branding?.settings;
              setTenantBranding({
                ispName: typeof settings?.ispName === "string" ? settings.ispName.trim() : "",
                logoUrl: typeof settings?.logoUrl === "string" ? settings.logoUrl.trim() : "",
              });
            }
          } catch {
            // A missing public branding response must not block administrator sign-in.
          }
        }
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
      setSmsLoginEnabled(sms?.loginEnabled === true);
    });
  }, []);

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = window.setTimeout(() => setResendWait(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendWait]);

  const requestOtpCode = async (
    purpose: "login",
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
    if (otpPurpose === "login" && !turnstileTokenRef.current) {
      setError("Complete Cloudflare verification before signing in.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(`/api/auth/${otpChannel}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: otpChallengeId,
          code: otpCode,
          ...(otpPurpose === "login" ? { turnstileToken: turnstileTokenRef.current } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The code is invalid or expired.");

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
      turnstileTokenRef.current = "";
      setTurnstileResetKey((key) => key + 1);
    }
  };

  const startAdminRecovery = () => {
    setLoginMethod("recovery");
    turnstileTokenRef.current = "";
    setTurnstileResetKey(key => key + 1);
    setRecoveryStage("request");
    setRecoveryUsername(username.trim());
    setRecoveryOptions({});
    setOtpChallengeId("");
    setOtpCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmNewPassword("");
    setError("");
    setOtpNotice("");
  };

  const loadAdminRecoveryOptions = async () => {
    setError("");
    setOtpNotice("");
    if (!recoveryUsername.trim()) {
      setError("Enter your administrator username.");
      return;
    }
    if (!turnstileTokenRef.current) {
      setError("Complete Cloudflare verification before checking recovery options.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(apiUrl("/api/auth/admin/password-recovery/options"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: recoveryUsername.trim(),
          subdomain: (hostSubdomain || companySubdomain).trim().toLowerCase(),
          turnstileToken: turnstileTokenRef.current,
        }),
        cache: "no-store",
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        options?: AdminRecoveryOptions;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "Recovery options are unavailable.");
      const options = data.options ?? {};
      setRecoveryOptions(options);
      setRecoveryChannel(options.email ? "email" : "phone");
      if (!options.email && !options.phone) {
        setOtpNotice("No recovery method is available for that username. Contact your system administrator.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recovery options are unavailable.");
    } finally {
      setOtpLoading(false);
      turnstileTokenRef.current = "";
      setTurnstileResetKey(key => key + 1);
    }
  };

  const requestAdminRecoveryCode = async () => {
    setError("");
    setOtpNotice("");
    if (!turnstileTokenRef.current) {
      setError("Complete Cloudflare verification before requesting a reset code.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(apiUrl("/api/auth/admin/password-recovery/request-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: recoveryUsername.trim(),
          channel: recoveryChannel,
          subdomain: (hostSubdomain || companySubdomain).trim().toLowerCase(),
          turnstileToken: turnstileTokenRef.current,
        }),
        cache: "no-store",
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        challengeId?: string | null;
        maskedDestination?: string | null;
        message?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "The reset code could not be sent.");
      if (!data.challengeId) {
        setOtpNotice(data.message || "If the username and recovery method match an account, a reset code will be sent.");
        return;
      }
      setOtpChallengeId(data.challengeId);
      setOtpCode("");
      setRecoveryStage("verify");
      setOtpNotice(data.maskedDestination
        ? `A reset code was sent to ${data.maskedDestination}.`
        : "A reset code was sent to the selected registered contact.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reset code could not be sent.");
    } finally {
      setOtpLoading(false);
      turnstileTokenRef.current = "";
      setTurnstileResetKey(key => key + 1);
    }
  };

  const verifyAdminRecoveryCode = async () => {
    setError("");
    setOtpNotice("");
    if (!otpChallengeId || !/^\d{6}$/.test(otpCode)) {
      setError("Enter the six-digit code sent to your registered contact.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(apiUrl("/api/auth/admin/password-recovery/verify-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: otpChallengeId, code: otpCode }),
        cache: "no-store",
      });
      const data = await response.json() as { ok?: boolean; error?: string; resetToken?: string };
      if (!response.ok || !data.ok || !data.resetToken) {
        throw new Error(data.error || "The code is invalid or expired.");
      }
      setResetToken(data.resetToken);
      setOtpCode("");
      setRecoveryStage("password");
      setOtpNotice("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code could not be verified.");
    } finally {
      setOtpLoading(false);
    }
  };

  const saveRecoveredPassword = async () => {
    setError("");
    setOtpNotice("");
    if (newPassword.length < 6 || newPassword.length > 256 || newPassword.toLowerCase() === "admin") {
      setError("Choose a new password with at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!resetToken) {
      setError("Verify a reset code before choosing a new password.");
      return;
    }
    setOtpLoading(true);
    try {
      const response = await fetch(apiUrl("/api/auth/admin/password-recovery/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, password: newPassword }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Password could not be reset.");
      setOtpNotice("Password updated. Sign in with your new password.");
      setLoginMethod("password");
      setRecoveryStage("request");
      setResetToken("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPassword("");
      setRecoveryOptions({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be reset.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!turnstileTokenRef.current) {
      setError("Complete Cloudflare verification before signing in.");
      return;
    }
     if (!username.trim() || !password.trim()) {
       setError(firstLogin
         ? "Enter the admin username and temporary password."
          : "Please enter your username and password.");
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
          turnstileToken: turnstileTokenRef.current,
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
      if (company && (admin.id !== company.id || admin.username !== username.trim())) {
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
      turnstileTokenRef.current = "";
      setTurnstileResetKey((key) => key + 1);
    }
  };

  const displayName = tenantBranding.ispName || company?.name?.trim() || "OCHOLASUPERNET ISP";
  const tenantLogoUrl = tenantBranding.logoUrl && (
    (tenantBranding.logoUrl.startsWith("/") && !tenantBranding.logoUrl.startsWith("//")) ||
    /^https:\/\//i.test(tenantBranding.logoUrl) ||
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(tenantBranding.logoUrl)
  ) ? tenantBranding.logoUrl : "";
  const inputStyle: React.CSSProperties = {
    width: "100%", paddingLeft: 38, paddingRight: 14,
    paddingTop: 11, paddingBottom: 11,
    background: "var(--isp-input-bg)",
    border: "1.5px solid var(--isp-input-border)",
    borderRadius: 10,
      fontSize: "0.95rem", color: "#17283d",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  const passwordInputStyle: React.CSSProperties = {
    ...inputStyle,
    paddingRight: 44,
  };

  return (
    <div className="admin-login-shell" style={{
      minHeight: "100svh",
      background: "radial-gradient(ellipse at 10% 16%, rgba(21,205,217,.44), transparent 30%), radial-gradient(ellipse at 88% 80%, rgba(255,57,110,.42), transparent 34%), radial-gradient(ellipse at 58% 6%, rgba(245,117,53,.22), transparent 30%), linear-gradient(128deg, #07152c 0%, #0d2644 47%, #12172f 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 18px",
      position: "relative",
      overflowX: "hidden",
      overflowY: "auto",
      fontFamily: "'Manrope', 'Avenir Next', system-ui, sans-serif",
    }}>
      <div style={{
        display: "flex",
        width: "45%",
        background: "transparent",
        padding: "clamp(28px, 5vw, 72px)",
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

        <div style={{ position: "relative" }}>
          <div className="login-eyebrow"><span className="login-eyebrow-dot" /> ISP OPERATOR CONSOLE</div>
          <h2 style={{
             fontSize: "clamp(2.25rem, 4.2vw, 4rem)", fontWeight: 760, color: "#F1F5F9",
            lineHeight: 1.25, letterSpacing: "-0.03em", marginBottom: 16,
          }}>
            Your network.<br />In full control.
          </h2>
           <p style={{ fontSize: "1rem", color: "#b2c5d9", lineHeight: 1.75, maxWidth: 460 }}>
            A secure workspace for the people who keep connectivity moving. Manage subscribers, billing, routers and payments from one place.
          </p>

          <div className="network-visual" aria-hidden="true">
            <div className="network-orbit network-orbit-one" />
            <div className="network-orbit network-orbit-two" />
            <div className="network-line network-line-one" />
            <div className="network-line network-line-two" />
            <div className="network-line network-line-three" />
            <span className="network-node node-center"><Wifi size={23} /></span>
            <span className="network-node node-one"><span /></span>
            <span className="network-node node-two"><span /></span>
            <span className="network-node node-three"><span /></span>
            <span className="network-node node-four"><span /></span>
            <span className="network-label label-core">CORE NETWORK</span>
            <span className="network-label label-edge">EDGE ROUTER</span>
            <span className="network-label label-hotspot">HOTSPOT</span>
          </div>

          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            {["Automated billing & renewals", "Router and hotspot operations", "Subscriber activity at a glance"].map(f => (
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

          <div style={{ fontSize: "0.78rem", color: "#91a5bc", position: "relative" }}>
          ISPLATTY.ORG · ISPLATTY.COM
        </div>
      </div>

      <div className="admin-login-main" style={{
         flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
         padding: "0",
      }}>
        <div className="admin-login-card" style={{ width: "100%", maxWidth: 456, padding: "clamp(24px, 5vw, 42px)", boxSizing: "border-box" }}>

           <div className="admin-login-brand" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 26 }}>
             {tenantLogoUrl && !tenantLogoFailed ? (
               <img src={tenantLogoUrl} alt={`${displayName} logo`} onError={() => setTenantLogoFailed(true)} style={{ width: 76, height: 76, objectFit: "contain", borderRadius: 18, background: "#fff", padding: 8 }} />
             ) : (
               <div className="admin-login-mark" aria-hidden="true"><Wifi size={30} strokeWidth={1.8} /></div>
             )}
           </div>

          <h1 style={{
              fontSize: "clamp(1.5rem, 5vw, 1.9rem)", fontWeight: 750, color: "#f3f7fc",
             letterSpacing: "-0.035em", marginBottom: 7, textAlign: "center", lineHeight: 1.2, overflowWrap: "anywhere",
          }}>
             {displayName}
          </h1>
            <p style={{ fontSize: "0.95rem", color: "#aebed0", marginBottom: 26, textAlign: "center" }}>
              Secure administrator sign in
          </p>

          {(whatsappLoginEnabled || smsLoginEnabled) && (
             <div role="group" aria-label="Choose sign-in method" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
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
            <div role="alert" style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
               <p style={{ fontSize: "0.9rem", color: "#ffb7bd", margin: 0 }}>{error}</p>
            </div>
          )}
          {sessionExpired && !error && (
            <div role="status" style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.24)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <AlertCircle size={15} style={{ color: "#B45309", flexShrink: 0 }} />
              <p style={{ fontSize: "0.9rem", color: "#ffe0a0", margin: 0 }}>
                Your admin session expired. Sign in again to load your account data.
              </p>
            </div>
          )}
          {otpNotice && <p role="status" style={{ margin: "0 0 16px", fontSize: "0.83rem", color: "var(--isp-text-muted)" }}>{otpNotice}</p>}

            <form onSubmit={event => {
              if (loginMethod === "password") void handleLogin(event);
              else event.preventDefault();
            }} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
             {!hostSubdomain && (
               <div>
                  <label htmlFor="admin-company-subdomain" style={{
                   display: "block", fontSize: "0.88rem", fontWeight: 600,
                   color: "var(--isp-text)", marginBottom: 7,
                 }}>
                   Company subdomain
                 </label>
                 <div style={{ position: "relative" }}>
                   <span style={{
                     position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                      color: "#526982", fontSize: "0.9rem", pointerEvents: "none",
                   }}>https://</span>
                   <input
                      id="admin-company-subdomain"
                     type="text"
                     value={companySubdomain}
                     onChange={e => setCompanySubdomain(e.target.value)}
                     placeholder="your-company"
                     autoComplete="organization"
                     style={{ ...inputStyle, paddingLeft: 62, paddingRight: 104 }}
                   />
                   <span style={{
                     position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      color: "#526982", fontSize: "0.82rem", pointerEvents: "none",
                   }}>.{PUBLIC_BASE_DOMAIN}</span>
                 </div>
                 <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                   Use the company name from your ISP address.
                 </p>
               </div>
             )}
             {loginMethod === "password" && <><div>
               <label htmlFor="admin-username" style={{
                 display: "block", fontSize: "0.88rem", fontWeight: 600,
                color: "var(--isp-text)", marginBottom: 7,
              }}>
                  Username
              </label>
              <div style={{ position: "relative" }}>
                <User size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                   color: "#586f86",
                }} />
                <input
                  id="admin-username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  readOnly={firstLogin}
                  placeholder={firstLogin ? INITIAL_ADMIN_USERNAME : "Enter your username"}
                  autoComplete="username"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

             <div>
               <label htmlFor="admin-password" style={{
                 display: "block", fontSize: "0.88rem", fontWeight: 600,
                color: "var(--isp-text)", marginBottom: 7,
              }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                   color: "#586f86",
                }} />
                <input
                  id="admin-password"
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "#586f86", display: "flex", padding: 2,
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button type="button" onClick={startAdminRecovery} style={{ display: "block", marginTop: 8, marginLeft: "auto", padding: 0, border: 0, background: "none", color: "var(--isp-accent)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
                    Forgot password?
                </button>
                {(whatsappLoginEnabled || smsLoginEnabled) && (
                  <button
                    type="button"
                    onClick={() => {
                      const channel = smsLoginEnabled && !whatsappLoginEnabled ? "sms" : "whatsapp";
                      setOtpChannel(channel);
                      setLoginMethod(channel);
                      setOtpChallengeId("");
                      setOtpCode("");
                      setOtpNotice("");
                      setError("");
                    }}
                    style={{ display: "block", marginTop: 10, marginLeft: "auto", padding: 0, border: 0, background: "none", color: "var(--isp-accent)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    No password yet? Set one up with a verification code
                  </button>
                )}
              </div>
            </div></>}

            {(loginMethod === "whatsapp" || loginMethod === "sms") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label htmlFor="admin-otp-phone" style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>
                    {otpChannel === "sms" ? "SMS phone number" : "WhatsApp phone number"}
                  </label>
                  <input
                    id="admin-otp-phone"
                    type="tel"
                    value={whatsappPhone}
                    onChange={event => { setWhatsappPhone(event.target.value); setOtpChallengeId(""); setOtpCode(""); setResetToken(""); setRecoveryStage("request"); }}
                    placeholder="+254712345678"
                    autoComplete="tel"
                    style={inputStyle}
                  />
                </div>

                {!otpChallengeId && (
                  <button type="button" onClick={() => void requestOtpCode("login", otpChannel)} disabled={otpLoading} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading ? 0.6 : 1 }}>
                    {otpLoading ? "Requesting code…" : otpChannel === "sms" ? "Continue with SMS" : "Continue with WhatsApp"}
                  </button>
                )}

                {otpChallengeId && otpPurpose === "login" && (
                  <>
                    <div>
                      <label htmlFor="admin-otp-code" style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>
                        Enter the 6-digit code
                      </label>
                      <input
                        id="admin-otp-code"
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
                    <TurnstileCheck
                      action="admin_login"
                      resetKey={turnstileResetKey}
                      onToken={updateTurnstileToken}
                    />
                    <button type="button" onClick={() => void verifyWhatsappCode()} disabled={otpLoading || otpCode.length !== 6} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || otpCode.length !== 6 ? 0.6 : 1 }}>
                      {otpLoading ? "Verifying…" : "Verify code"}
                    </button>
                    <button type="button" onClick={() => void requestOtpCode("login", otpChannel)} disabled={otpLoading || resendWait > 0} style={{ border: 0, background: "none", color: "var(--isp-accent)", cursor: resendWait > 0 ? "default" : "pointer", fontSize: "0.82rem", opacity: resendWait > 0 ? 0.6 : 1 }}>
                      {resendWait > 0 ? `Resend code in ${resendWait}s` : "Resend code"}
                    </button>
                  </>
                )}
              </div>
            )}

            {loginMethod === "recovery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button type="button" onClick={() => {
                  setLoginMethod("password");
                  turnstileTokenRef.current = "";
                  setTurnstileResetKey(key => key + 1);
                  setRecoveryOptions({});
                  setOtpChallengeId("");
                  setOtpCode("");
                  setResetToken("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setError("");
                  setOtpNotice("");
                }} style={{ alignSelf: "flex-start", border: 0, background: "none", color: "var(--isp-accent)", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                  ← Back to sign in
                </button>

                {recoveryStage === "request" && (
                  <>
                    <label htmlFor="admin-recovery-username" style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: -8 }}>
                      Administrator username
                    </label>
                    <input
                      id="admin-recovery-username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      maxLength={64}
                      value={recoveryUsername}
                      onChange={event => {
                        setRecoveryUsername(event.target.value);
                        setRecoveryOptions({});
                        setOtpNotice("");
                      }}
                      placeholder="Enter your username"
                      style={inputStyle}
                    />
                    <TurnstileCheck
                      action="admin_password_recovery"
                      resetKey={turnstileResetKey}
                      onToken={updateTurnstileToken}
                    />
                    <button type="button" onClick={() => void loadAdminRecoveryOptions()} disabled={otpLoading || !recoveryUsername.trim()} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || !recoveryUsername.trim() ? 0.6 : 1 }}>
                      {otpLoading ? "Checking…" : "Find recovery options"}
                    </button>
                    {Object.keys(recoveryOptions).length > 0 && (
                      <>
                        <p style={{ margin: "6px 0 0", fontSize: "0.86rem", color: "var(--isp-text-muted)" }}>Choose a registered contact. Full contact details are never shown.</p>
                        {recoveryOptions.email && (
                          <label style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--isp-input-border)", borderRadius: 10, padding: 12, cursor: "pointer" }}>
                            <input type="radio" name="admin-recovery-channel" value="email" checked={recoveryChannel === "email"} onChange={() => setRecoveryChannel("email")} />
                            <span>Email <strong>{recoveryOptions.email.masked}</strong></span>
                          </label>
                        )}
                        {recoveryOptions.phone && (
                          <label style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--isp-input-border)", borderRadius: 10, padding: 12, cursor: "pointer" }}>
                            <input type="radio" name="admin-recovery-channel" value="phone" checked={recoveryChannel === "phone"} onChange={() => setRecoveryChannel("phone")} />
                            <span>Phone <strong>{recoveryOptions.phone.masked}</strong></span>
                          </label>
                        )}
                        <button type="button" onClick={() => void requestAdminRecoveryCode()} disabled={otpLoading} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading ? 0.6 : 1 }}>
                          {otpLoading ? "Sending…" : "Send reset code"}
                        </button>
                      </>
                    )}
                  </>
                )}

                {recoveryStage === "verify" && (
                  <>
                    <p style={{ margin: 0, color: "var(--isp-text-muted)" }}>Enter the six-digit code sent to your registered contact.</p>
                    <input
                      aria-label="Six-digit reset code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={event => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      style={inputStyle}
                    />
                    <button type="button" onClick={() => void verifyAdminRecoveryCode()} disabled={otpLoading || otpCode.length !== 6} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || otpCode.length !== 6 ? 0.6 : 1 }}>
                      {otpLoading ? "Verifying…" : "Verify code"}
                    </button>
                  </>
                )}

                {recoveryStage === "password" && (
                  <>
                    <label htmlFor="admin-new-password" style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)" }}>New password</label>
                    <input id="admin-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={6} maxLength={256} style={inputStyle} />
                    <label htmlFor="admin-confirm-new-password" style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--isp-text)" }}>Confirm new password</label>
                    <input id="admin-confirm-new-password" type="password" autoComplete="new-password" value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} minLength={6} maxLength={256} style={inputStyle} />
                    <button type="button" onClick={() => void saveRecoveredPassword()} disabled={otpLoading || newPassword.length < 6 || newPassword !== confirmNewPassword} className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", borderRadius: 10, opacity: otpLoading || newPassword.length < 6 || newPassword !== confirmNewPassword ? 0.6 : 1 }}>
                      {otpLoading ? "Updating…" : "Reset password"}
                    </button>
                  </>
                )}
              </div>
            )}

            {loginMethod === "password" && (
              <div className="login-turnstile-actions">
                <TurnstileCheck
                  action="admin_login"
                  resetKey={turnstileResetKey}
                  onToken={updateTurnstileToken}
                  size="flexible"
                />
                <button
                  type="submit"
                  disabled={isLoading || companyLoading}
                  className="btn btn-primary"
                  style={{
                    width: "auto", minWidth: 104, padding: "12px 8px",
                    borderRadius: 10,
                    opacity: isLoading || companyLoading ? 0.5 : 1,
                    cursor: isLoading || companyLoading ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {isLoading ? "Signing in…" : "Sign In"}
                  {!isLoading && <ArrowRight size={16} />}
                </button>
              </div>
            )}
          </form>

          <p style={{ marginTop: 22, textAlign: "center", fontSize: "0.9rem", color: "#aebed0" }}>
            {company ? (
              <>Not the right portal?{" "}
                  <a href="https://isplatty.com" style={{ color: "var(--isp-accent)", fontWeight: 700, textDecoration: "none" }}>
                  Visit ISPLATTY.COM
                </a>
              </>
            ) : (
              <>Don't have an account?{" "}
                <Link href="/admin/register" style={{ color: "var(--isp-accent)", fontWeight: 700, cursor: "pointer", textDecoration: "none" }}>Create an account</Link>
              </>
            )}
          </p>

          <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--isp-green)",
            }} />
               <span style={{ fontSize: "0.8rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>
              ISP administrator access
            </span>
          </div>
          <p className="customer-access-note">Membership and hotspot customers use their separate customer access page.</p>
        </div>
      </div>

      <style>{`
        .admin-login-shell {
          --isp-text: #e8f0f9;
          --isp-text-sub: #aebfd2;
          --isp-text-muted: #aebfd2;
          --isp-input-bg: #edf4fa;
          --isp-input-border: #91a4b8;
          --isp-accent: #57e0df;
          --isp-accent-glow: rgba(43, 205, 211, .2);
          --isp-green: #49d8ae;
          --isp-green-glow: rgba(73, 216, 174, .12);
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(360px, 490px);
          align-items: center;
          gap: clamp(24px, 6vw, 96px);
          padding: clamp(24px, 5vw, 72px) clamp(22px, 7vw, 112px) !important;
          isolation: isolate;
        }
        .admin-login-shell::before {
          content: "";
          position: absolute;
          z-index: -1;
          inset: 0;
          pointer-events: none;
          opacity: .21;
          background-image:
            linear-gradient(rgba(178,218,238,.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(178,218,238,.12) 1px, transparent 1px);
          background-size: 68px 68px;
          mask-image: linear-gradient(90deg, #000, transparent 88%);
        }
        .admin-login-shell::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: min(54vw, 760px);
          aspect-ratio: 1;
          right: 17%;
          top: -42%;
          border: 1px solid rgba(71,218,223,.14);
          border-radius: 50%;
          box-shadow: 0 0 0 42px rgba(71,218,223,.035), 0 0 0 100px rgba(71,218,223,.025);
          pointer-events: none;
        }
        .admin-login-shell > .login-left-panel {
          display: flex !important;
          width: auto !important;
          min-width: 0;
          min-height: min(78vh, 740px);
          padding: 0 !important;
          background: transparent !important;
        }
        .admin-login-main {
          min-width: 0;
          width: 100%;
          flex: initial !important;
        }
        .login-eyebrow {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 22px;
          color: #74e3e3;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .18em;
        }
        .login-eyebrow-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #4fe0cb;
          box-shadow: 0 0 0 5px rgba(79,224,203,.13);
        }
        .network-visual {
          position: relative;
          width: min(100%, 520px);
          height: 230px;
          margin: 22px 0 10px;
          overflow: hidden;
          border: 1px solid rgba(168,224,236,.18);
          border-radius: 22px;
          background:
            radial-gradient(ellipse at 48% 48%, rgba(10,196,208,.19), transparent 38%),
            linear-gradient(132deg, rgba(7,26,49,.44), rgba(17,42,67,.24));
          box-shadow: inset 0 1px rgba(255,255,255,.07), 0 24px 55px rgba(2,11,25,.16);
        }
        .network-orbit {
          position: absolute;
          border: 1px solid rgba(101,222,227,.15);
          border-radius: 50%;
          transform: rotate(-18deg);
        }
        .network-orbit-one { width: 370px; height: 150px; left: 12%; top: 16%; }
        .network-orbit-two { width: 280px; height: 102px; left: 23%; top: 27%; border-color: rgba(255,119,132,.18); transform: rotate(18deg); }
        .network-line {
          position: absolute;
          height: 1px;
          transform-origin: left center;
          background: linear-gradient(90deg, rgba(71,222,225,.7), rgba(71,222,225,.12));
        }
        .network-line-one { width: 165px; left: 47%; top: 49%; transform: rotate(-25deg); }
        .network-line-two { width: 150px; left: 46%; top: 53%; transform: rotate(26deg); }
        .network-line-three { width: 130px; left: 43%; top: 52%; transform: rotate(175deg); background: linear-gradient(90deg, rgba(255,115,142,.55), rgba(255,115,142,.08)); }
        .network-node {
          position: absolute;
          z-index: 1;
          display: grid;
          place-items: center;
          border: 1px solid rgba(170,246,244,.65);
          border-radius: 50%;
          color: #e3ffff;
          background: linear-gradient(145deg, rgba(22,195,208,.85), rgba(17,93,139,.92));
          box-shadow: 0 0 25px rgba(18,208,221,.27), inset 0 1px rgba(255,255,255,.32);
        }
        .node-center { width: 52px; height: 52px; left: calc(44% - 26px); top: calc(50% - 26px); }
        .network-node:not(.node-center) { width: 24px; height: 24px; background: #152d4a; }
        .network-node:not(.node-center) span { width: 6px; height: 6px; border-radius: 50%; background: #7cf4e5; box-shadow: 0 0 9px #7cf4e5; }
        .node-one { left: 14%; top: 45%; }.node-two { right: 15%; top: 22%; border-color: rgba(255,133,155,.75); }.node-three { right: 17%; bottom: 21%; }.node-four { left: 68%; bottom: 15%; border-color: rgba(255,133,155,.75); }
        .network-label { position: absolute; color: rgba(195,220,234,.72); font-size: .58rem; font-weight: 800; letter-spacing: .11em; }
        .label-core { left: 38%; top: 76%; }.label-edge { right: 7%; top: 13%; }.label-hotspot { right: 5%; bottom: 10%; }
        .admin-login-card {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(174,215,235,.22);
          border-radius: 23px;
          background: linear-gradient(145deg, rgba(30,45,66,.98), rgba(22,35,54,.985));
          box-shadow: 0 32px 90px rgba(1,9,22,.48), 0 2px 10px rgba(15,35,60,.15), inset 0 1px rgba(255,255,255,.08);
          animation: login-card-enter .5s cubic-bezier(.2,.75,.25,1) both;
        }
        .admin-login-card::before {
          content: "";
          position: absolute;
          inset: 0 0 auto;
          height: 3px;
          background: linear-gradient(90deg, #35d4db, #fb798c 57%, #f6b35c);
        }
        .admin-login-mark {
          width: 62px;
          height: 62px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          color: #fff;
          background: linear-gradient(145deg, #24becb, #155276);
          box-shadow: 0 10px 24px rgba(8,126,164,.32);
        }
        .admin-login-product {
          color: #73dfe2;
          font-size: .7rem;
          font-weight: 800;
          letter-spacing: .18em;
        }
        .admin-login-domain {
          color: #a9bbce;
          font-size: .75rem;
          font-weight: 600;
          text-align: center;
          overflow-wrap: anywhere;
        }
        .login-turnstile-actions {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 12px;
          min-width: 0;
          width: 100%;
        }
        .login-turnstile-actions > div:first-child {
          min-width: 0;
          max-width: 100%;
          overflow: visible;
        }
        .login-turnstile-actions > button {
          width: 100% !important;
          min-height: 48px;
        }
        .admin-login-card input, .admin-login-card select {
          box-sizing: border-box;
          min-height: 46px;
          color: #17283d !important;
        }
        .admin-login-card input::placeholder { color: #687c90; opacity: 1; }
        .admin-login-card input:focus, .admin-login-card select:focus {
          border-color: #26bdc8 !important;
          box-shadow: 0 0 0 3px rgba(38,189,200,.2) !important;
        }
        .admin-login-card select option { color: #17283d; background: #edf4fa; }
        .admin-login-card .text-emerald-700 { color: #7de4bd !important; }
        .admin-login-card .text-amber-700 { color: #ffdc91 !important; }
        .admin-login-card .text-red-600 { color: #ffafb6 !important; }
        .admin-login-card button { transition: transform .18s ease, opacity .18s ease, background-color .18s ease, border-color .18s ease; }
        .admin-login-card button:focus-visible, .admin-login-card a:focus-visible {
          outline: 2px solid #70e5e3;
          outline-offset: 3px;
          border-radius: 5px;
        }
        .admin-login-card .btn-primary {
          background: linear-gradient(100deg, #16aabb, #167b9e) !important;
          color: #f5ffff !important;
          border: 1px solid rgba(127,239,239,.32);
          box-shadow: 0 8px 22px rgba(5,163,178,.2);
          font-weight: 750;
        }
        .admin-login-card .btn-primary:not(:disabled):hover { transform: translateY(-1px); }
        .customer-access-note {
          margin: 12px auto 0;
          max-width: 330px;
          color: #8296ac;
          font-size: .72rem;
          line-height: 1.55;
          text-align: center;
        }
        @keyframes login-card-enter {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 480px) {
          .admin-login-card { border-radius: 19px; }
        }
        @media (max-width: 860px) {
          .admin-login-shell {
            grid-template-columns: minmax(0, 1fr);
            gap: 0;
            padding: 22px 16px !important;
          }
          .admin-login-shell > .login-left-panel { display: none !important; }
          .admin-login-main { max-width: 490px; margin: 0 auto; }
          .admin-login-card { max-width: 100% !important; }
        }
        @media (max-width: 380px) {
          .admin-login-shell { padding: 14px 10px !important; }
          .admin-login-card { padding: 22px 18px !important; }
          .admin-login-brand { margin-bottom: 19px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-login-card, .admin-login-card button { animation: none; transition: none; }
        }
      `}</style>
    </div>
  );
}
