import React, { useState, useEffect } from "react";
import { Wifi, Phone, Lock, Zap, CheckCircle2, Ticket, AlertCircle, User, Loader2 } from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { ADMIN_ID } from "@/lib/supabase";

interface Plan {
  id: number;
  name: string;
  price: number;
  validity: number;
  validity_unit: string;
  validity_days: number;
  speed_down: number;
  speed_up: number;
  description: string | null;
  plan_type?: string;
  type?: string;
}

type Tab = "plans" | "login" | "voucher";

const PLAN_COLORS = [
  "from-pink-500 to-rose-600",
  "from-purple-500 to-indigo-600",
  "from-cyan-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
];

function formatValidity(plan: Plan): string {
  const days = plan.validity_days ?? plan.validity ?? 0;
  const unit = plan.validity_unit ?? "days";
  if (unit === "hours" || days === 0) return `${plan.validity ?? 1} ${unit}`;
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days === 1) return "1 day";
  if (days < 7) return `${days} days`;
  if (days === 7) return "1 week";
  if (days === 30 || days === 31) return "1 month";
  if (days === 365) return "1 year";
  return `${days} days`;
}

export default function HotspotLogin() {
  const brand = useBrand();
  const [activeTab, setActiveTab] = useState<Tab>("plans");

  // Derive adminId from URL query param or fallback to stored ADMIN_ID
  const adminId = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qId = params.get("adminId") ?? params.get("ispId");
      return qId ? parseInt(qId) : ADMIN_ID;
    } catch {
      return ADMIN_ID;
    }
  })();

  // ── Plans ──────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [phone, setPhone] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [stkSent, setStkSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/plans?adminId=${adminId}`);
        const data: Plan[] = await res.json();
        const hotspot = data.filter(
          (p) =>
            !p.type || p.type === "hotspot" || p.plan_type === "hotspot",
        );
        setPlans(hotspot.length > 0 ? hotspot : data);
      } catch {
        setPlans([]);
      } finally {
        setPlansLoading(false);
      }
    })();
  }, [adminId]);

  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !phone.trim()) return;
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone:       phone.trim(),
          amount:      selectedPlan.price,
          plan_id:     selectedPlan.id,
          adminId,
          account_ref: "ISPlatty",
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string; demo?: boolean; CheckoutRequestID?: string };
      if (!res.ok || !data.ok) {
        setPayError(data.error ?? "Failed to send STK push. Please try again.");
      } else {
        setStkSent(true);
      }
    } catch {
      setPayError("Could not reach the payment server. Please try again.");
    } finally {
      setPayLoading(false);
    }
  };

  // ── Member Login ───────────────────────────────────────────────────────
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loggedInName, setLoggedInName] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch("/api/customers/hotspot-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, username: loginUsername, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error ?? "Login failed");
      } else {
        setLoggedInName(data.customer?.name || loginUsername);
        setLoginSuccess(true);
      }
    } catch {
      setLoginError("Could not reach the server. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Voucher ────────────────────────────────────────────────────────────
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [voucherSuccess, setVoucherSuccess] = useState(false);
  const [voucherInfo, setVoucherInfo] = useState<Record<string, unknown> | null>(null);

  const handleVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoucherError("");
    setVoucherLoading(true);
    try {
      const res = await fetch("/api/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, code: voucherCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVoucherError(data.error ?? "Voucher redemption failed");
      } else {
        setVoucherInfo(data.voucher);
        setVoucherSuccess(true);
      }
    } catch {
      setVoucherError("Could not reach the server. Please try again.");
    } finally {
      setVoucherLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0415] text-white font-sans overflow-x-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,#2d0d45_0%,#0d0415_55%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)] pointer-events-none" />

      {/* Header */}
      <header className="relative z-50 h-20 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Wifi className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold tracking-tight text-lg leading-tight">{brand.ispName.toUpperCase()}</h1>
              <p className="text-xs text-purple-300 font-medium">Hotspot Portal · {brand.domain}</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400">Network Online</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 pt-12 pb-24">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-black mb-4 tracking-tight">
            Connect to{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400">
              Fast Internet
            </span>
          </h2>
          <p className="text-purple-200/70 max-w-lg mx-auto">
            Pay via M-Pesa and get connected instantly. No data caps, just reliable high-speed Wi-Fi.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 inline-flex">
            {(["plans", "login", "voucher"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab
                    ? "bg-purple-500 text-white shadow-lg shadow-purple-500/25"
                    : "text-purple-200 hover:text-white"
                }`}
              >
                {tab === "plans" ? "Buy Package" : tab === "login" ? "Member Login" : "Redeem Voucher"}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-xl mx-auto">

          {/* ── Buy Package ── */}
          {activeTab === "plans" && (
            <div className="space-y-8">
              {!stkSent ? (
                <>
                  {plansLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                    </div>
                  ) : plans.length === 0 ? (
                    <p className="text-center text-purple-300/60 py-8">No hotspot plans available yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {plans.map((plan, i) => (
                        <button
                          key={plan.id}
                          onClick={() => setSelectedPlan(plan)}
                          className={`text-left bg-white/5 border rounded-2xl p-5 hover:-translate-y-1 transition-all hover:bg-white/10 group relative overflow-hidden ${
                            selectedPlan?.id === plan.id
                              ? "border-purple-500 bg-purple-500/10"
                              : "border-white/10 hover:border-purple-500/50"
                          }`}
                        >
                          <div
                            className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${PLAN_COLORS[i % PLAN_COLORS.length]} ${
                              selectedPlan?.id === plan.id ? "opacity-100" : "opacity-50 group-hover:opacity-100"
                            } transition-opacity`}
                          />
                          <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                          <p className="text-3xl font-black mb-3">Ksh {plan.price}</p>
                          <p className="text-xs text-purple-300 font-medium flex items-center gap-1">
                            <Zap className="w-3 h-3" /> {formatValidity(plan)}
                          </p>
                          {plan.speed_down > 0 && (
                            <p className="text-xs text-purple-400/60 mt-1">{plan.speed_down}Mbps</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="bg-[#1a0f2e] border border-purple-500/30 rounded-3xl p-6 md:p-8 shadow-2xl">
                    {selectedPlan && (
                      <div className="mb-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-sm text-purple-200">
                        Selected: <span className="font-bold text-white">{selectedPlan.name}</span> — Ksh {selectedPlan.price} for {formatValidity(selectedPlan)}
                      </div>
                    )}
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <Phone className="text-emerald-400" /> Pay with M-Pesa
                    </h3>
                    <form onSubmit={handlePay} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Phone Number</label>
                        <input
                          type="tel"
                          placeholder="07XX XXX XXX"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full bg-black/40 border border-purple-500/20 rounded-xl px-4 py-4 text-lg font-bold text-white focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                      </div>
                      {payError && (
                        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{payError}</span>
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={payLoading || !selectedPlan}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-lg shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                      >
                        {payLoading ? (
                          <><Loader2 className="w-5 h-5 animate-spin" /> Sending prompt...</>
                        ) : !selectedPlan ? (
                          "Select a plan above"
                        ) : (
                          "Send STK Push"
                        )}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="bg-[#1a0f2e] border border-emerald-500/30 rounded-3xl p-10 text-center shadow-2xl">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">STK Push Sent!</h3>
                  <p className="text-purple-200 mb-8">
                    Check your phone and enter your M-Pesa PIN to complete the payment. You will be connected automatically.
                  </p>
                  <button onClick={() => { setStkSent(false); setSelectedPlan(null); }} className="text-sm font-bold text-emerald-400 hover:text-emerald-300">
                    Start over
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Member Login ── */}
          {activeTab === "login" && (
            <div className="bg-[#1a0f2e] border border-white/10 rounded-3xl p-6 md:p-10 shadow-2xl">
              {loginSuccess ? (
                <div className="text-center py-4">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Welcome, {loggedInName}!</h3>
                  <p className="text-purple-200 mb-6">You are now connected to the network.</p>
                  <button
                    onClick={() => { setLoginSuccess(false); setLoginUsername(""); setLoginPassword(""); }}
                    className="text-sm font-bold text-purple-400 hover:text-purple-300"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-2xl font-bold mb-6 text-center flex items-center justify-center gap-2">
                    <User className="text-purple-400" /> Welcome Back
                  </h3>
                  {loginError && (
                    <div className="mb-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {loginError}
                    </div>
                  )}
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div>
                      <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Username</label>
                      <input
                        type="text"
                        required
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        placeholder="your-username"
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:border-purple-500 focus:outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-purple-300 uppercase mb-2">Password</label>
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:border-purple-500 focus:outline-none transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loginLoading}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white font-bold text-lg shadow-lg shadow-purple-500/25 mt-4 flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {loginLoading ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> Verifying...</>
                      ) : (
                        <><Lock className="w-4 h-4" /> Connect</>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          )}

          {/* ── Redeem Voucher ── */}
          {activeTab === "voucher" && (
            <div className="bg-[#1a0f2e] border border-amber-500/20 rounded-3xl p-6 md:p-10 shadow-2xl">
              {voucherSuccess ? (
                <div className="text-center py-4">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Voucher Activated!</h3>
                  {voucherInfo?.plan_name && (
                    <p className="text-purple-200 mb-2">
                      Plan: <span className="text-white font-bold">{String(voucherInfo.plan_name)}</span>
                    </p>
                  )}
                  {voucherInfo?.duration && (
                    <p className="text-purple-200 mb-6">
                      Duration: <span className="text-white font-bold">{String(voucherInfo.duration)}</span>
                    </p>
                  )}
                  <p className="text-sm text-emerald-400 font-medium">You are now connected.</p>
                  <button
                    onClick={() => { setVoucherSuccess(false); setVoucherCode(""); setVoucherInfo(null); }}
                    className="mt-6 text-sm font-bold text-purple-400 hover:text-purple-300"
                  >
                    Redeem another
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Ticket className="w-6 h-6 text-amber-400" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Redeem Voucher</h3>
                    <p className="text-sm text-purple-200/70">Enter your printed code to get online.</p>
                  </div>
                  {voucherError && (
                    <div className="mb-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {voucherError}
                    </div>
                  )}
                  <form onSubmit={handleVoucher} className="space-y-5">
                    <input
                      type="text"
                      placeholder="XXXX-XXXX-XXXX"
                      required
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                      className="w-full bg-black/40 border border-amber-500/30 rounded-xl px-4 py-4 text-center font-mono text-xl tracking-widest text-amber-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-all"
                    />
                    <button
                      type="submit"
                      disabled={voucherLoading}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-lg shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {voucherLoading ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> Validating...</>
                      ) : (
                        "Activate Voucher"
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
