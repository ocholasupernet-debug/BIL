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
  const strengthColor = ["", "#ef4444", "#f59e0b", "#22c55e", "#2563EB"][strength];

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
    background: "#FFFFFF",
    border: "1.5px solid #E2E8F0",
    borderRadius: 10,
    fontSize: "0.875rem", color: "#0F172A",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(37,99,235,0.3)" }}>
            <Zap size={18} style={{ color: "white" }} />
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>ISPlatty</div>
            <div style={{ fontSize: "0.65rem", color: "#94A3B8", fontWeight: 500 }}>ISP Management Platform</div>
          </div>
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", marginBottom: 6 }}>Create Your Password</h1>
        <p style={{ fontSize: "0.875rem", color: "#64748B", marginBottom: 32 }}>Set a strong password to secure your account</p>

        {done ? (
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "48px 32px", textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: "50%", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
            </div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>Password Updated!</h2>
            <p style={{ fontSize: "0.875rem", color: "#64748B" }}>Taking you to your dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "10px 14px" }}>
              <KeyRound size={14} style={{ color: "#2563EB", flexShrink: 0 }} />
              <p style={{ fontSize: "0.8rem", color: "#1D4ED8", margin: 0 }}>You're using the default password. Please create a new one to continue.</p>
            </div>

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px" }}>
                <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
                <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{error}</p>
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginBottom: 7 }}>New Password</label>
              <div style={{ position: "relative" }}>
                <KeyRound size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#E2E8F0"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8", display: "flex", padding: 2 }}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {password.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} style={{ height: 3, flex: 1, borderRadius: 99, transition: "all 0.2s", background: n <= strength ? strengthColor : "#E2E8F0" }} />
                    ))}
                  </div>
                  <p style={{ fontSize: "0.72rem", fontWeight: 600, marginTop: 4, color: strengthColor }}>{strengthLabel}</p>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginBottom: 7 }}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                <KeyRound size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#E2E8F0"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8", display: "flex", padding: 2 }}>
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
              style={{
                width: "100%", padding: "12px 20px", borderRadius: 10,
                background: loading ? "#93C5FD" : "#2563EB",
                border: "none", color: "white", fontSize: "0.9rem", fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "all 0.15s",
                boxShadow: loading ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
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
