import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { supabase, ADMIN_ID, isLoggedIn } from "@/lib/supabase";

export default function AdminSetPassword() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) setLocation("/admin/login");
  }, []);

  const getStrength = (pw: string) => {
    if (pw.length === 0) return 0;
    if (pw.length < 6) return 1;
    if (pw.length < 10) return 2;
    const hasUpper = /[A-Z]/.test(pw);
    const hasNum   = /[0-9]/.test(pw);
    const hasSym   = /[^a-zA-Z0-9]/.test(pw);
    return hasUpper && hasNum && hasSym ? 4 : hasNum ? 3 : 2;
  };

  const strength = getStrength(password);
  const strengthLabel = ["", "Too short", "Fair", "Good", "Strong"][strength];
  const strengthColor = ["", "#ef4444", "#f59e0b", "#22c55e", "var(--isp-accent)"][strength];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: dbErr } = await supabase
        .from("isp_admins")
        .update({ password })
        .eq("id", ADMIN_ID);

      if (dbErr) throw dbErr;
      setDone(true);
      setTimeout(() => setLocation("/admin/dashboard"), 1800);
    } catch {
      setError("Failed to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", paddingLeft: 38, paddingRight: 44,
    paddingTop: 11, paddingBottom: 11,
    background: "var(--isp-input-bg)",
    border: "1.5px solid var(--isp-input-border)",
    borderRadius: 10,
    fontSize: "0.875rem", color: "var(--isp-text)",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={18} style={{ color: "white" }} />
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.02em" }}>ISPlatty</div>
            <div style={{ fontSize: "0.65rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>ISP Management Platform</div>
          </div>
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em", marginBottom: 6 }}>Create Your Password</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: 32 }}>Set a strong password to secure your account</p>

        {done ? (
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: "48px 32px", textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: "50%", background: "var(--isp-green-glow)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={32} style={{ color: "var(--isp-green)" }} />
            </div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--isp-text)", marginBottom: 8 }}>Password Updated!</h2>
            <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)" }}>Taking you to your dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", borderRadius: 10, padding: "10px 14px" }}>
              <KeyRound size={14} style={{ color: "var(--isp-accent)", flexShrink: 0 }} />
              <p style={{ fontSize: "0.8rem", color: "var(--isp-accent)", margin: 0 }}>You're using the default password. Please create a new one to continue.</p>
            </div>

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "10px 14px" }}>
                <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
                <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{error}</p>
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>New Password</label>
              <div style={{ position: "relative" }}>
                <KeyRound size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-sub)", display: "flex", padding: 2 }}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {password.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} style={{ height: 3, flex: 1, borderRadius: 99, transition: "all 0.2s", background: n <= strength ? strengthColor : "var(--isp-border)" }} />
                    ))}
                  </div>
                  <p style={{ fontSize: "0.72rem", fontWeight: 600, marginTop: 4, color: strengthColor }}>{strengthLabel}</p>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                <KeyRound size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-sub)", display: "flex", padding: 2 }}>
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {confirm.length > 0 && password !== confirm && (
                <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>Passwords do not match</p>
              )}
              {confirm.length > 0 && password === confirm && (
                <p style={{ fontSize: "0.75rem", color: "#16A34A", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={12} /> Passwords match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: "100%", padding: "12px 20px", borderRadius: 10,
                opacity: loading ? 0.5 : 1,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {loading ? "Saving..." : "Set Password & Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
