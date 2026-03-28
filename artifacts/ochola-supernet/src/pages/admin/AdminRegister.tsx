import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Wifi, Building2, Phone, ArrowRight, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

function extractMsg(err: unknown): string {
  if (!err) return "Registration failed. Please try again.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const e = err as Record<string, unknown>;
  return (e.message as string) || (e.details as string) || JSON.stringify(err);
}

function slugify(str: string) {
  return str.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function AdminRegister() {
  const [, setLocation] = useLocation();

  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");

  /* availability */
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* submit */
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* ── live availability check ── */
  useEffect(() => {
    setAvailable(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (company.trim().length < 2) return;

    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      const { data } = await supabase
        .from("isp_admins")
        .select("id")
        .ilike("name", company.trim())
        .limit(1);
      setChecking(false);
      setAvailable(!data || data.length === 0);
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [company]);

  /* ── validation ── */
  const validate = () => {
    const e: Record<string, string> = {};
    if (!company.trim() || company.trim().length < 2) e.company = "Company name is required";
    if (available === false) e.company = "This company name is already taken";
    if (!phone.trim()) e.phone = "Mobile number is required";
    return e;
  };

  /* ── submit ── */
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerErr("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const slug = slugify(company);
    setLoading(true);
    try {
      const { error } = await supabase.from("isp_admins").insert({
        name:      company.trim(),
        phone:     phone.trim(),
        username:  slug || "user",
        password:  phone.trim(),
        is_active: true,
        role:      "isp_admin",
      });
      if (error) throw error;
      setSuccess(true);
    } catch (err) {
      const msg = extractMsg(err);
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setServerErr("This company name or phone is already registered.");
      } else {
        setServerErr(msg || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  /* ══════════ Success ══════════ */
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-10 shadow-2xl">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Account Created!</h2>
            <p className="text-slate-300 text-sm mb-1">
              <span className="text-violet-300 font-semibold">{company}</span> is now registered.
            </p>
            <p className="text-slate-500 text-xs mb-8">Your account is active. Sign in with your phone number as the password.</p>
            <button
              onClick={() => setLocation("/admin/login")}
              className="w-full py-3.5 rounded-2xl font-bold text-white flex items-center justify-center gap-2 transition-all"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}
            >
              Go to Sign In <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ Form ══════════ */
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" }}
    >
      {/* decorative blobs */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-30 blur-3xl pointer-events-none"
           style={{ background: "radial-gradient(circle,#7c3aed,transparent)" }} />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-20 blur-3xl pointer-events-none"
           style={{ background: "radial-gradient(circle,#06b6d4,transparent)" }} />

      <div className="w-full max-w-sm relative z-10">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl mb-4"
               style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5,#06b6d4)" }}>
            <Wifi className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Get Started</h1>
          <p className="text-slate-400 text-sm mt-1">Register your ISP on the platform</p>
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* top accent bar */}
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#7c3aed,#4f46e5,#06b6d4)" }} />

          <form onSubmit={handleSubmit} className="p-8 space-y-5">

            {/* ── Company Name ── */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Company / ISP Name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Ochola Networks"
                  autoComplete="organization"
                  className={`w-full bg-white/5 border rounded-xl py-3 pl-10 pr-10 text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 transition-all text-sm ${
                    errors.company ? "border-red-500/60 focus:ring-red-500" :
                    available === true ? "border-emerald-500/60 focus:ring-emerald-500" :
                    available === false ? "border-red-500/60 focus:ring-red-500" :
                    "border-white/10 focus:border-violet-500 focus:ring-violet-500"
                  }`}
                />
                {/* status icon */}
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {checking && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                  {!checking && available === true && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {!checking && available === false && <XCircle className="w-4 h-4 text-red-400" />}
                </div>
              </div>
              {/* availability badge */}
              {!errors.company && company.trim().length >= 2 && !checking && available !== null && (
                <p className={`text-xs mt-1.5 font-medium ${available ? "text-emerald-400" : "text-red-400"}`}>
                  {available ? "✓ Available" : "✗ Already taken"}
                </p>
              )}
              {errors.company && <p className="text-xs text-red-400 mt-1">{errors.company}</p>}
            </div>

            {/* ── Phone ── */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Mobile Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+254 700 000 000"
                  className={`w-full bg-white/5 border rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all text-sm ${errors.phone ? "border-red-500/60" : "border-white/10"}`}
                />
              </div>
              {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone}</p>}
            </div>

            {/* ── Server error ── */}
            {serverErr && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-300">{serverErr}</p>
              </div>
            )}

            {/* ── Submit ── */}
            <button
              type="submit"
              disabled={loading || available === false || checking}
              className="w-full py-3.5 rounded-2xl font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-60 group mt-2"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</>
                : <>Register <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
            </button>

            <p className="text-center text-xs text-slate-500">
              Already registered?{" "}
              <span
                onClick={() => setLocation("/admin/login")}
                className="text-violet-400 font-semibold cursor-pointer hover:text-violet-300 transition-colors"
              >
                Sign In
              </span>
            </p>

          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          © {new Date().getFullYear()} OcholaSupernet · ISP Management Platform
        </p>
      </div>
    </div>
  );
}
