import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Wifi } from "lucide-react";
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
  const strengthColor = ["", "#ef4444", "#f59e0b", "#22c55e", "#06b6d4"][strength];

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

  return (
    <div className="min-h-screen bg-[#080c10] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] bg-cyan-500/20 rounded-full blur-[100px]" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 border border-cyan-500/30 rounded-2xl animate-ping opacity-50" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)]">
              <Wifi className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Create Your Password</h1>
          <p className="text-slate-400 text-sm mt-1">Set a strong password to secure your account</p>
        </div>

        <div className="bg-[#111820]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500" />

          {done ? (
            <div className="p-10 text-center">
              <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Password Updated!</h2>
              <p className="text-slate-400 text-sm">Taking you to your dashboard...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div className="flex items-center gap-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-3 mb-2">
                <KeyRound className="w-4 h-4 text-cyan-400 shrink-0" />
                <p className="text-xs text-cyan-300">You're using the default password. Please create a new one to continue.</p>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {/* New password */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">New Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-12 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(n => (
                        <div key={n} className="h-1 flex-1 rounded-full transition-all" style={{ background: n <= strength ? strengthColor : "rgba(255,255,255,0.08)" }} />
                      ))}
                    </div>
                    <p className="text-xs font-medium" style={{ color: strengthColor }}>{strengthLabel}</p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Confirm Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-12 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
                {confirm.length > 0 && password === confirm && (
                  <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Passwords match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all disabled:opacity-70"
              >
                {loading ? "Saving..." : "Set Password & Continue"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
