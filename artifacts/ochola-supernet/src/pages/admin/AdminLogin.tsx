import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Zap } from "lucide-react";
import { supabase, setAdminAuth } from "@/lib/supabase";
import { getHostSubdomain } from "@/lib/subdomain";

interface CompanyInfo {
  id: number;
  name: string;
  subdomain: string;
}

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState("");

  const [company, setCompany]               = useState<CompanyInfo | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);

  useEffect(() => {
    const sub = getHostSubdomain();
    if (!sub) return;
    setCompanyLoading(true);
    supabase
      .from("isp_admins")
      .select("id, name, subdomain")
      .ilike("subdomain", sub)
      .eq("is_active", true)
      .single()
      .then(({ data }) => { if (data) setCompany(data as CompanyInfo); })
      .finally(() => setCompanyLoading(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setIsLoading(true);
    try {
      let query = supabase
        .from("isp_admins")
        .select("id, name, username, password, is_active, role, subdomain");
      if (company) {
        query = query.eq("id", company.id);
      } else {
        query = query.eq("username", username.trim());
      }
      const { data, error: dbErr } = await query.single();
      if (dbErr || !data) { setError("Invalid username or password."); return; }
      if (company && data.username !== username.trim()) { setError("Invalid username or password."); return; }
      if (data.password !== password) { setError("Invalid username or password."); return; }
      if (!data.is_active) { setError("Your account is inactive. Contact the administrator."); return; }
      setAdminAuth(data.id, data.username, data.name || data.username, data.role ?? undefined);
      setLocation(data.password === "admin" ? "/admin/set-password" : "/admin/dashboard");
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
    fontSize: "0.875rem", color: "var(--isp-text)",
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

        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "var(--isp-accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Zap size={20} style={{ color: "white" }} />
          </div>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#F1F5F9", letterSpacing: "-0.02em" }}>
              ISPlatty
            </div>
            <div style={{ fontSize: "0.7rem", color: "#475569", fontWeight: 500 }}>
              ISP Management Platform
            </div>
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <h2 style={{
            fontSize: "2rem", fontWeight: 800, color: "#F1F5F9",
            lineHeight: 1.25, letterSpacing: "-0.03em", marginBottom: 16,
          }}>
            Manage your ISP with confidence
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#64748B", lineHeight: 1.7 }}>
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
                <span style={{ fontSize: "0.825rem", color: "#94A3B8" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: "0.72rem", color: "#334155", position: "relative" }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "var(--isp-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Zap size={18} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.02em" }}>
                {displayName}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>
                {displayDomain}
              </div>
            </div>
          </div>

          <h1 style={{
            fontSize: "1.75rem", fontWeight: 800, color: "var(--isp-text)",
            letterSpacing: "-0.03em", marginBottom: 6,
          }}>
            Welcome back
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: 32 }}>
            Sign in to your admin dashboard
          </p>

          {error && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
              <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={{
                display: "block", fontSize: "0.78rem", fontWeight: 600,
                color: "var(--isp-text)", marginBottom: 7,
              }}>
                Username
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
                  placeholder="your-username"
                  autoComplete="username"
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; }}
                  onBlur={e => { e.target.style.borderColor = "var(--isp-input-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

            <div>
              <label style={{
                display: "block", fontSize: "0.78rem", fontWeight: 600,
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
              </div>
            </div>

            <button
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
            </button>
          </form>

          <p style={{ marginTop: 28, textAlign: "center", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
            {company ? (
              <>Not the right portal?{" "}
                <a href="https://isplatty.org" style={{ color: "var(--isp-accent)", fontWeight: 600, textDecoration: "none" }}>
                  Visit main site
                </a>
              </>
            ) : (
              <>Don't have an account?{" "}
                <Link href="/admin/register">
                  <span style={{ color: "var(--isp-accent)", fontWeight: 600, cursor: "pointer" }}>Register your ISP</span>
                </Link>
              </>
            )}
          </p>

          <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--isp-green)",
            }} />
            <span style={{ fontSize: "0.72rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>
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
