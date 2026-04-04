import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { User, Key, Lock, Eye, EyeOff, ShieldCheck, AlertCircle, ArrowRight, Clock, LogOut } from "lucide-react";

/* ── Helper: store super admin session in localStorage ── */
function setSuperAdminSession(name: string, token: string, issuedAt: number) {
  try {
    localStorage.setItem("ochola_superadmin_token",     token);
    localStorage.setItem("ochola_superadmin_name",      name);
    localStorage.setItem("ochola_superadmin_issued_at", String(issuedAt));
    localStorage.setItem("ochola_admin_role",           "superadmin");
    localStorage.setItem("ochola_admin_name",           name);
    localStorage.setItem("ochola_admin_username",       name);
    localStorage.setItem("ochola_admin_id",             "0");
  } catch {}
}

export function isSuperAdminLoggedIn(): boolean {
  try { return !!localStorage.getItem("ochola_superadmin_token"); } catch { return false; }
}

/* ── Reason messages shown when redirected back to login ── */
const REASON_MESSAGES: Record<string, { text: string; color: string; icon: "clock" | "kick" }> = {
  expired:    { text: "Your session expired after 3 hours. Please log in again.", color: "#fbbf24", icon: "clock" },
  superseded: { text: "Your session was ended because someone else logged in.", color: "#f87171",  icon: "kick"  },
  no_session: { text: "Session not found. Please log in to continue.",           color: "#94a3b8", icon: "clock" },
};

/* ── Input component ── */
function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#c4a44a", marginBottom: 8 }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#78716c", display: "flex" }}>
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(212,179,74,0.2)",
  borderRadius: 10,
  padding: "13px 14px 13px 44px",
  color: "#f5f0e8",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

/* ── Main component ── */
export default function SuperAdminLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [apiKey,   setApiKey]   = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showKey,  setShowKey]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [reason,   setReason]   = useState<string | null>(null);

  /* Read ?reason= from URL on mount */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("reason");
    if (r && REASON_MESSAGES[r]) setReason(r);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setReason(null);
    if (!username.trim() || !apiKey.trim() || !password) {
      setError("All three fields are required.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), api_key: apiKey.trim(), password }),
      });
      const data = await res.json() as {
        ok: boolean; error?: string; name?: string; token?: string; issuedAt?: number;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Invalid credentials. Access denied.");
        return;
      }
      setSuperAdminSession(data.name ?? username, data.token ?? "sa", data.issuedAt ?? Date.now());
      setLocation("/super-admin/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0804 0%, #140f06 40%, #0c0a10 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      position: "relative",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Background glows */}
      <div style={{ position: "absolute", top: "-15%", left: "-10%", width: 600, height: 600, background: "radial-gradient(circle, rgba(212,179,74,0.08) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-20%", right: "-10%", width: 700, height: 700, background: "radial-gradient(circle, rgba(120,60,180,0.06) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />

      {/* Grid overlay */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(212,179,74,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(212,179,74,0.03) 1px,transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 10 }}>

        {/* Logo + header */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          {/* Shield icon */}
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg,#b8860b,#d4b34a,#8b6914)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", boxShadow: "0 0 40px rgba(212,179,74,0.3), 0 8px 24px rgba(0,0,0,0.4)" }}>
            <ShieldCheck size={34} color="#fff" strokeWidth={1.5} />
          </div>
          <h1 style={{ color: "#f5f0e8", fontWeight: 900, fontSize: 26, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            Super Admin
          </h1>
          <p style={{ color: "#78716c", fontSize: 13, margin: 0 }}>
            ISPlatty · Restricted Access Panel
          </p>

          {/* Warning badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, background: "rgba(212,179,74,0.08)", border: "1px solid rgba(212,179,74,0.25)", borderRadius: 99, padding: "5px 14px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#d4b34a", display: "inline-block", animation: "pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, color: "#d4b34a", fontWeight: 700, letterSpacing: "0.05em" }}>AUTHORISED ACCESS ONLY</span>
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(20,15,8,0.9)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(212,179,74,0.15)",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,179,74,0.05) inset",
        }}>
          {/* Gold accent bar */}
          <div style={{ height: 3, background: "linear-gradient(90deg, #8b6914, #d4b34a, #c4a44a, #8b6914)" }} />

          <form onSubmit={handleLogin} style={{ padding: "32px 28px", display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Session-ended reason banner */}
            {reason && REASON_MESSAGES[reason] && (() => {
              const rm = REASON_MESSAGES[reason];
              const Icon = rm.icon === "clock" ? Clock : LogOut;
              return (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: `${rm.color}14`, border: `1px solid ${rm.color}44`, borderRadius: 10, padding: "12px 14px" }}>
                  <Icon size={15} color={rm.color} style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ margin: 0, fontSize: 13, color: rm.color }}>{rm.text}</p>
                </div>
              );
            })()}

            {/* Error */}
            {error && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "12px 14px" }}>
                <AlertCircle size={15} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 13, color: "#fca5a5" }}>{error}</p>
              </div>
            )}

            {/* Username */}
            <Field label="Username" icon={<User size={15} />}>
              <input
                style={inputStyle}
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                required
              />
            </Field>

            {/* API Key */}
            <Field label="API Key" icon={<Key size={15} />}>
              <input
                style={{ ...inputStyle, paddingRight: 44 }}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Enter API key"
                autoComplete="off"
                required
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#78716c", padding: 0, display: "flex" }}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </Field>

            {/* Password */}
            <Field label="Password" icon={<Lock size={15} />}>
              <input
                style={{ ...inputStyle, paddingRight: 44 }}
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#78716c", padding: 0, display: "flex" }}
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </Field>

            {/* Divider */}
            <div style={{ borderTop: "1px solid rgba(212,179,74,0.08)" }} />

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "14px 24px",
                borderRadius: 12,
                background: loading
                  ? "rgba(180,144,50,0.4)"
                  : "linear-gradient(135deg, #b8860b 0%, #d4b34a 50%, #c4a44a 100%)",
                border: "none",
                cursor: loading ? "wait" : "pointer",
                color: "#0a0804",
                fontSize: 14,
                fontWeight: 800,
                fontFamily: "inherit",
                letterSpacing: "0.02em",
                boxShadow: loading ? "none" : "0 4px 20px rgba(212,179,74,0.3)",
                transition: "all 0.2s",
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(10,8,4,0.4)", borderTopColor: "#0a0804", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                  Verifying…
                </>
              ) : (
                <>
                  Authenticate
                  <ArrowRight size={15} />
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 24, display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ margin: 0, fontSize: 11, color: "#44403c" }}>
            Unauthorised access attempts are logged and reported.
          </p>
          <a
            href="/admin"
            style={{ fontSize: 12, color: "#78716c", textDecoration: "none", fontWeight: 600 }}
          >
            ← Back to Admin Login
          </a>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        input:focus { border-color: rgba(212,179,74,0.5) !important; box-shadow: 0 0 0 3px rgba(212,179,74,0.08) !important; }
      `}</style>
    </div>
  );
}
