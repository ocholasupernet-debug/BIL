import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Building2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { supabase, setAdminAuth } from "@/lib/supabase";
import { getHostSubdomain } from "@/lib/subdomain";

interface CompanyInfo {
  id: number;
  name: string;
  subdomain: string;
}

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername]       = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState("");

  const [company, setCompany]         = useState<CompanyInfo | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);

  /* ── On mount: resolve subdomain → company branding ── */
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
      .then(({ data }) => {
        if (data) setCompany(data as CompanyInfo);
      })
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

      /* If a subdomain company is known, scope login to that admin only */
      if (company) {
        query = query.eq("id", company.id);
      } else {
        query = query.eq("username", username.trim());
      }

      const { data, error: dbErr } = await query.single();

      if (dbErr || !data) {
        setError("Invalid username or password.");
        return;
      }

      /* Verify username matches when scoped to a company */
      if (company && data.username !== username.trim()) {
        setError("Invalid username or password.");
        return;
      }

      if (data.password !== password) {
        setError("Invalid username or password.");
        return;
      }

      if (!data.is_active) {
        setError("Your account is inactive. Contact the administrator.");
        return;
      }

      setAdminAuth(data.id, data.username, data.name || data.username);

      if (data.password === "admin") {
        setLocation("/admin/set-password");
      } else {
        setLocation("/admin/dashboard");
      }
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const displayName   = company?.name ?? "ISP Admin Portal";
  const displayDomain = company ? `${company.subdomain}.isplatty.org` : "isplatty.org";

  return (
    <div className="min-h-screen bg-[#080c10] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] bg-cyan-500/20 rounded-full blur-[100px]" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo + company header */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Logo size="lg" />
          </div>

          {companyLoading ? (
            <div className="h-5 w-40 bg-white/10 rounded-lg animate-pulse mb-1" />
          ) : (
            <p className="text-slate-400 text-sm text-center">
              {company ? `${displayName} · Admin Portal` : "ISP Admin Portal"} · {displayDomain}
            </p>
          )}

          {company && (
            <span className="mt-2 inline-flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              {company.subdomain}.isplatty.org
            </span>
          )}
        </div>

        {/* Login card */}
        <div className="bg-[#111820]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500" />

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your-username"
                  autoComplete="username"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-12 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || companyLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {isLoading ? "Signing in..." : "Sign In"}
              {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          {company ? (
            <>Not the right portal?{" "}
              <a href="https://isplatty.org" className="text-cyan-400 font-semibold hover:text-cyan-300 cursor-pointer transition-colors">
                Visit main site
              </a>
            </>
          ) : (
            <>Don't have an account?{" "}
              <Link href="/admin/register">
                <span className="text-cyan-400 font-semibold hover:text-cyan-300 cursor-pointer transition-colors">Register your ISP</span>
              </Link>
            </>
          )}
        </p>

        <div className="mt-4 flex justify-center items-center gap-2">
          <div className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </div>
          <span className="text-xs font-medium text-slate-500">All systems operational · {displayDomain}</span>
        </div>
      </div>
    </div>
  );
}
