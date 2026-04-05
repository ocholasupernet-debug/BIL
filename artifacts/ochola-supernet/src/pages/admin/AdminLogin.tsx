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

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F8FAFC",
      display: "flex",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Left panel — branding */}
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
        {/* Decorative circles */}
        <div style={{
          position: "absolute", top: -80, right: -80,
          width: 320, height: 320, borderRadius: "50%",
          background: "rgba(37,99,235,0.12)",
        }} />
        <div style={{
          position: "absolute", bottom: -60, left: -60,
          width: 240, height: 240, borderRadius: "50%",
          background: "rgba(37,99,235,0.08)",
        }} />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(37,99,235,0.4)",
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

        {/* Tagline */}
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
                  background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)",
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

      {/* Right panel — login form */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}>
        <div style={{ width: "100%", maxWidth: 420 }}>

          {/* Logo (shown on mobile / when left panel hidden) */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
            }}>
              <Zap size={18} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>
                {displayName}
              </div>
              <div style={{ fontSize: "0.65rem", color: "#94A3B8", fontWeight: 500 }}>
                {displayDomain}
              </div>
            </div>
          </div>

          <h1 style={{
            fontSize: "1.75rem", fontWeight: 800, color: "#0F172A",
            letterSpacing: "-0.03em", marginBottom: 6,
          }}>
            Welcome back
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#64748B", marginBottom: 32 }}>
            Sign in to your admin dashboard
          </p>

          {/* Error */}
          {error && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "#FEF2F2", border: "1px solid #FECACA",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <AlertCircle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
              <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Username */}
            <div>
              <label style={{
                display: "block", fontSize: "0.78rem", fontWeight: 600,
                color: "#374151", marginBottom: 7,
              }}>
                Username
              </label>
              <div style={{ position: "relative" }}>
                <User size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: "#94A3B8",
                }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your-username"
                  autoComplete="username"
                  style={{
                    width: "100%", paddingLeft: 38, paddingRight: 14,
                    paddingTop: 11, paddingBottom: 11,
                    background: "#FFFFFF",
                    border: "1.5px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: "0.875rem", color: "#0F172A",
                    outline: "none", fontFamily: "inherit",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#E2E8F0"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{
                display: "block", fontSize: "0.78rem", fontWeight: 600,
                color: "#374151", marginBottom: 7,
              }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: "#94A3B8",
                }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{
                    width: "100%", paddingLeft: 38, paddingRight: 44,
                    paddingTop: 11, paddingBottom: 11,
                    background: "#FFFFFF",
                    border: "1.5px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: "0.875rem", color: "#0F172A",
                    outline: "none", fontFamily: "inherit",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "#E2E8F0"; e.target.style.boxShadow = "none"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "#94A3B8", display: "flex", padding: 2,
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || companyLoading}
              style={{
                width: "100%", padding: "12px 20px",
                borderRadius: 10,
                background: isLoading || companyLoading ? "#93C5FD" : "#2563EB",
                border: "none",
                color: "white", fontSize: "0.9rem", fontWeight: 700,
                cursor: isLoading || companyLoading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "all 0.15s",
                boxShadow: isLoading ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
              }}
              onMouseEnter={e => { if (!isLoading) { (e.currentTarget as HTMLButtonElement).style.background = "#1D4ED8"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 20px rgba(37,99,235,0.4)"; }}}
              onMouseLeave={e => { if (!isLoading) { (e.currentTarget as HTMLButtonElement).style.background = "#2563EB"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 14px rgba(37,99,235,0.3)"; }}}
            >
              {isLoading ? "Signing in…" : "Sign In"}
              {!isLoading && <ArrowRight size={16} />}
            </button>
          </form>

          <p style={{ marginTop: 28, textAlign: "center", fontSize: "0.825rem", color: "#94A3B8" }}>
            {company ? (
              <>Not the right portal?{" "}
                <a href="https://isplatty.org" style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none" }}>
                  Visit main site
                </a>
              </>
            ) : (
              <>Don't have an account?{" "}
                <Link href="/admin/register">
                  <span style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>Register your ISP</span>
                </Link>
              </>
            )}
          </p>

          {/* Status indicator */}
          <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#22C55E",
              boxShadow: "0 0 6px rgba(34,197,94,0.5)",
            }} />
            <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 500 }}>
              All systems operational · {displayDomain}
            </span>
          </div>
        </div>
      </div>

      {/* Responsive: show left panel on larger screens */}
      <style>{`
        @media (min-width: 900px) {
          .login-left-panel { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
