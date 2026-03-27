import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Wifi, User, Lock, Eye, EyeOff, ArrowRight,
  Building2, Mail, Phone, Globe, CheckCircle2,
  AlertTriangle, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

/* ══════════════════ Helpers ══════════════════ */
const cls = (...parts: string[]) => parts.filter(Boolean).join(" ");

function Field({
  label, icon, error, children,
}: { label: string; icon?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">{icon}</div>
        )}
        {children}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/* ══════════════════ Main component ══════════════════ */
export default function AdminRegister() {
  const [, setLocation] = useLocation();

  /* form state */
  const [ispName,   setIspName]   = useState("");
  const [fullName,  setFullName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [phone,     setPhone]     = useState("");
  const [country,   setCountry]   = useState("Kenya");
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [showCfm,   setShowCfm]   = useState(false);
  const [terms,     setTerms]     = useState(false);

  /* ui state */
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [errors,    setErrors]    = useState<Record<string, string>>({});

  /* ── validation ── */
  const validate = () => {
    const e: Record<string, string> = {};
    if (!ispName.trim())   e.ispName  = "ISP / company name is required";
    if (!fullName.trim())  e.fullName = "Full name is required";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                           e.email    = "Valid email is required";
    if (!phone.trim())     e.phone    = "Phone number is required";
    if (!username.trim() || username.length < 3)
                           e.username = "Username must be at least 3 characters";
    if (password.length < 8)
                           e.password = "Password must be at least 8 characters";
    if (password !== confirm)
                           e.confirm  = "Passwords do not match";
    if (!terms)            e.terms    = "You must accept the terms";
    return e;
  };

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerErr("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      /* Real isp_admins schema:
         name, username, password, email, phone, area,
         is_active, role, subdomain, created_at           */
      const { error } = await supabase.from("isp_admins").insert({
        name:       ispName.trim(),
        email:      email.trim().toLowerCase(),
        phone:      phone.trim(),
        area:       country.trim(),
        username:   username.trim().toLowerCase(),
        password:   password,
        is_active:  false,          /* pending super-admin approval */
        role:       "isp_admin",
      });

      if (error) throw error;

      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setServerErr("An account with that email or username already exists.");
      } else if (msg.includes("does not exist") || msg.includes("relation")) {
        setServerErr("Registration database is not yet configured. Please contact the Super Admin to activate your account.");
      } else {
        setServerErr(msg || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  /* ══════════════════ Success screen ══════════════════ */
  if (success) {
    return (
      <div className="min-h-screen bg-[#080c10] flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-30" />
        <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] bg-cyan-500/20 rounded-full blur-[100px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

        <div className="w-full max-w-md relative z-10 text-center">
          <div className="bg-[#111820]/90 backdrop-blur-xl border border-emerald-500/20 rounded-2xl shadow-2xl p-10">
            <div className="w-20 h-20 mx-auto mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-2">Registration Submitted!</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-2">
              Your ISP admin account for <span className="text-cyan-400 font-bold">{ispName}</span> has been submitted and is pending approval.
            </p>
            <p className="text-slate-500 text-xs mb-8">
              The Super Admin will review and activate your account. You'll receive confirmation at <span className="text-cyan-400">{email}</span>.
            </p>
            <button
              onClick={() => setLocation("/admin/login")}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all flex items-center justify-center gap-2"
            >
              Go to Sign In <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════ Registration form ══════════════════ */
  const iCls = (err?: string) =>
    cls("w-full bg-white/5 border rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none transition-all text-sm",
      err ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500"
           : "border-white/10 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500");

  return (
    <div className="min-h-screen bg-[#080c10] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] bg-cyan-500/20 rounded-full blur-[100px]" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-2xl relative z-10">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 border border-cyan-500/30 rounded-2xl animate-ping opacity-50" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)]">
              <Wifi className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">ISP Management Platform</h1>
          <p className="text-slate-400 text-sm mt-1">Create your ISP Admin Account</p>
        </div>

        <div className="bg-[#111820]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500" />

          <form onSubmit={handleSubmit} className="p-8 space-y-6">

            {/* ── Section: ISP Details ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-cyan-500/15 flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">ISP / Company Details</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="ISP / Company Name" icon={<Building2 className="w-4 h-4" />} error={errors.ispName}>
                  <input
                    type="text"
                    value={ispName}
                    onChange={e => setIspName(e.target.value)}
                    placeholder="e.g. Ochola Networks Ltd"
                    className={cls(iCls(errors.ispName))}
                  />
                </Field>
                <Field label="Country / Region" icon={<Globe className="w-4 h-4" />}>
                  <select
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all appearance-none"
                  >
                    {["Kenya","Uganda","Tanzania","Ethiopia","Nigeria","Ghana","South Africa","Rwanda","Zambia","Zimbabwe","Other"].map(c => (
                      <option key={c} value={c} className="bg-[#111820]">{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="border-t border-white/5" />

            {/* ── Section: Personal Details ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-indigo-500/15 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Admin Contact Details</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full Name" icon={<User className="w-4 h-4" />} error={errors.fullName}>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. John Ochola"
                    className={iCls(errors.fullName)}
                  />
                </Field>
                <Field label="Email Address" icon={<Mail className="w-4 h-4" />} error={errors.email}>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@myisp.com"
                    className={iCls(errors.email)}
                  />
                </Field>
                <Field label="Phone Number" icon={<Phone className="w-4 h-4" />} error={errors.phone}>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+254 700 000 000"
                    className={iCls(errors.phone)}
                  />
                </Field>
              </div>
            </div>

            <div className="border-t border-white/5" />

            {/* ── Section: Login Credentials ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-emerald-500/15 flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Login Credentials</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Username" icon={<User className="w-4 h-4" />} error={errors.username}>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="admin_username"
                    className={iCls(errors.username)}
                    autoComplete="username"
                  />
                </Field>
                <div className="hidden sm:block" />

                <Field label="Password" icon={<Lock className="w-4 h-4" />} error={errors.password}>
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className={cls(iCls(errors.password), "pr-12")}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </Field>

                <Field label="Confirm Password" icon={<Lock className="w-4 h-4" />} error={errors.confirm}>
                  <input
                    type={showCfm ? "text" : "password"}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    className={cls(iCls(errors.confirm), "pr-12")}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowCfm(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showCfm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </Field>

                {/* Password strength */}
                {password.length > 0 && (
                  <div className="sm:col-span-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4].map(i => {
                        const strength = Math.min(Math.floor(password.length / 3), 4);
                        const col = strength >= 4 ? "bg-emerald-500" : strength >= 3 ? "bg-yellow-500" : strength >= 2 ? "bg-orange-500" : "bg-red-500";
                        return <div key={i} className={cls("h-1 flex-1 rounded-full transition-all", i <= strength ? col : "bg-white/10")} />;
                      })}
                    </div>
                    <p className="text-xs text-slate-500">
                      {password.length < 6 ? "Weak" : password.length < 10 ? "Fair" : password.length < 14 ? "Strong" : "Very strong"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Terms ── */}
            <label className={cls("flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-all", terms ? "bg-cyan-500/5 border-cyan-500/20" : "bg-white/2 border-white/8", errors.terms ? "border-red-500/40" : "")}>
              <div
                onClick={() => setTerms(v => !v)}
                className={cls("w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-all", terms ? "bg-cyan-500 border-cyan-500" : "border-white/20 bg-transparent")}
              >
                {terms && <svg viewBox="0 0 10 8" className="w-3 h-2.5 text-white fill-current"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <input type="checkbox" className="sr-only" checked={terms} onChange={e => setTerms(e.target.checked)} />
              <span className="text-xs text-slate-400 leading-relaxed">
                I agree to the{" "}
                <span className="text-cyan-400 underline cursor-pointer">Terms of Service</span>{" "}
                and{" "}
                <span className="text-cyan-400 underline cursor-pointer">Privacy Policy</span>{" "}
                for OcholaSupernet ISP Management Platform.
              </span>
            </label>
            {errors.terms && <p className="text-xs text-red-400 -mt-4">{errors.terms}</p>}

            {/* ── Server error ── */}
            {serverErr && (
              <div className="flex items-start gap-3 p-3.5 bg-red-500/8 border border-red-500/20 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-300">{serverErr}</p>
              </div>
            )}

            {/* ── Submit ── */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating Account…</>
                : <>Create ISP Admin Account <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
            </button>

            {/* ── Sign in link ── */}
            <p className="text-center text-sm text-slate-500">
              Already have an account?{" "}
              <Link href="/admin/login">
                <span className="text-cyan-400 font-semibold hover:text-cyan-300 cursor-pointer transition-colors">Sign In</span>
              </Link>
            </p>

          </form>
        </div>

        <div className="mt-8 flex justify-center items-center gap-2">
          <div className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </div>
          <span className="text-xs font-medium text-slate-500">All systems operational · isplatty.org</span>
        </div>
      </div>
    </div>
  );
}
