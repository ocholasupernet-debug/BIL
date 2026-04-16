import React, { useState } from "react";
import { Sliders, User, Lock, Eye, EyeOff, Ticket, KeyRound, CheckCircle2, Zap } from "lucide-react";
import { useBrand } from "@/context/BrandContext";

export default function PPPoELogin() {
  const brand = useBrand();
  const [tab, setTab] = useState<"login" | "forgot" | "voucher">("login");

  /* login form */
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged,  setLogged]  = useState(false);

  /* forgot form */
  const [resetPhone, setResetPhone] = useState("");
  const [resetting,  setResetting]  = useState(false);
  const [resetSent,  setResetSent]  = useState(false);

  /* voucher form */
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [activated,  setActivated]  = useState(false);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLogging(true);
    setTimeout(() => { setLogging(false); setLogged(true); }, 1500);
  }
  function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetting(true);
    setTimeout(() => { setResetting(false); setResetSent(true); }, 1400);
  }
  function handleVoucher(e: React.FormEvent) {
    e.preventDefault();
    setActivating(true);
    setTimeout(() => { setActivating(false); setActivated(true); }, 1400);
  }

  const TABS = [
    { id: "login"  as const, label: "Member Login" },
    { id: "forgot" as const, label: "Forgot Password" },
    { id: "voucher"as const, label: "Redeem Voucher" },
  ];

  return (
    <div className="min-h-screen bg-[#020b18] text-white font-sans overflow-x-hidden relative">
      {/* Background layers */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,#051e38_0%,#020b18_60%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.03)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)] pointer-events-none" />

      {/* Header */}
      <header className="relative z-50 h-20 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <Sliders className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold tracking-tight text-lg leading-tight">{brand.ispName.toUpperCase()}</h1>
              <p className="text-xs text-sky-300 font-medium">PPPoE Client Portal · {brand.domain}</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400">Service Active</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 pt-12 pb-24">

        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-black mb-4 tracking-tight">
            Your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-400">
              Broadband Portal
            </span>
          </h2>
          <p className="text-sky-200/70 max-w-lg mx-auto">
            Manage your PPPoE account, track your data usage and renew your subscription — all in one place.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-12">
          {[
            { icon: <Zap className="w-4 h-4" />, label: "Speed", value: "Up to 100 Mbps" },
            { icon: <CheckCircle2 className="w-4 h-4" />, label: "Uptime", value: "99.9%" },
            { icon: <Sliders className="w-4 h-4" />, label: "Support", value: "24/7" },
          ].map(stat => (
            <div key={stat.label} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
              <div className="flex justify-center mb-2 text-sky-400">{stat.icon}</div>
              <div className="text-lg font-black">{stat.value}</div>
              <div className="text-xs text-sky-300/60 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Tab Toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 inline-flex">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  tab === t.id
                    ? "bg-sky-500 text-white shadow-lg shadow-sky-500/25"
                    : "text-sky-200 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="max-w-md mx-auto">

          {/* ─── LOGIN ─── */}
          {tab === "login" && (
            logged ? (
              <div className="bg-[#051e38] border border-emerald-500/30 rounded-3xl p-10 text-center shadow-2xl">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Welcome Back!</h3>
                <p className="text-sky-200/70 mb-8">You are now authenticated. Your session is active.</p>
                <button
                  onClick={() => { setLogged(false); setUsername(""); setPassword(""); }}
                  className="text-sm font-bold text-sky-400 hover:text-sky-300"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="bg-[#051e38] border border-sky-500/30 rounded-3xl p-6 md:p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-sky-400" />
                  </div>
                  <h3 className="text-xl font-bold">Member Login</h3>
                </div>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-sky-300 uppercase mb-2">Username</label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="your_username"
                      className="w-full bg-black/40 border border-sky-500/20 rounded-xl px-4 py-4 text-base font-medium text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-sky-300 uppercase mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-black/40 border border-sky-500/20 rounded-xl px-4 py-4 pr-12 text-base font-medium text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(p => !p)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-sky-400 hover:text-sky-300"
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={logging}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-lg shadow-lg shadow-sky-500/25 hover:shadow-sky-500/40 transition-all disabled:opacity-70 flex justify-center items-center gap-2 mt-2"
                  >
                    {logging ? "Connecting…" : "Login"}
                  </button>
                  <p className="text-center text-sm text-sky-300/60 pt-1">
                    Forgot your credentials?{" "}
                    <button
                      type="button"
                      onClick={() => setTab("forgot")}
                      className="text-sky-400 font-bold hover:text-sky-300"
                    >
                      Reset here
                    </button>
                  </p>
                </form>
              </div>
            )
          )}

          {/* ─── FORGOT PASSWORD ─── */}
          {tab === "forgot" && (
            resetSent ? (
              <div className="bg-[#051e38] border border-emerald-500/30 rounded-3xl p-10 text-center shadow-2xl">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Request Sent!</h3>
                <p className="text-sky-200/70 mb-8">
                  Our support team will contact you on <strong className="text-white">{resetPhone}</strong> with your new credentials.
                </p>
                <button onClick={() => { setResetSent(false); setResetPhone(""); }} className="text-sm font-bold text-sky-400 hover:text-sky-300">
                  Back
                </button>
              </div>
            ) : (
              <div className="bg-[#051e38] border border-amber-500/20 rounded-3xl p-6 md:p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <KeyRound className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Reset Password</h3>
                    <p className="text-xs text-sky-300/60 mt-0.5">Enter your registered phone number</p>
                  </div>
                </div>
                <form onSubmit={handleReset} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-amber-300 uppercase mb-2">Phone Number</label>
                    <input
                      type="tel"
                      required
                      value={resetPhone}
                      onChange={e => setResetPhone(e.target.value)}
                      placeholder="07XX XXX XXX"
                      className="w-full bg-black/40 border border-amber-500/20 rounded-xl px-4 py-4 text-lg font-bold text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={resetting}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-lg shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all disabled:opacity-70 flex justify-center items-center gap-2"
                  >
                    {resetting ? "Sending request…" : "Request Reset"}
                  </button>
                </form>
              </div>
            )
          )}

          {/* ─── VOUCHER ─── */}
          {tab === "voucher" && (
            activated ? (
              <div className="bg-[#051e38] border border-emerald-500/30 rounded-3xl p-10 text-center shadow-2xl">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Voucher Activated!</h3>
                <p className="text-sky-200/70 mb-8">Your subscription has been renewed. Enjoy your connection.</p>
                <button onClick={() => { setActivated(false); setCode(""); }} className="text-sm font-bold text-sky-400 hover:text-sky-300">
                  Redeem another
                </button>
              </div>
            ) : (
              <div className="bg-[#051e38] border border-sky-500/20 rounded-3xl p-6 md:p-10 shadow-2xl">
                <div className="text-center mb-8">
                  <div className="w-14 h-14 bg-sky-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Ticket className="w-7 h-7 text-sky-400" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">Redeem Voucher</h3>
                  <p className="text-sm text-sky-200/60">Enter your voucher code to renew your PPPoE subscription.</p>
                </div>
                <form onSubmit={handleVoucher} className="space-y-5">
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX"
                    maxLength={14}
                    className="w-full bg-black/40 border border-sky-500/30 rounded-xl px-4 py-4 text-center font-mono text-xl tracking-widest text-sky-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={activating}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-lg shadow-lg shadow-sky-500/25 hover:shadow-sky-500/40 transition-all disabled:opacity-70 flex justify-center items-center gap-2"
                  >
                    {activating ? "Activating…" : "Activate Voucher"}
                  </button>
                </form>
              </div>
            )
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 text-center">
        <p className="text-xs text-sky-300/40">
          &copy; {new Date().getFullYear()} {brand.ispName} &mdash; PPPoE Client Portal. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
