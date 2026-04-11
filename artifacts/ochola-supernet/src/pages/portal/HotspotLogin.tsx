import React, { useState, useEffect } from "react";
import {
  Wifi, Phone, Lock, Zap, CheckCircle2, Ticket,
  AlertCircle, User, Loader2, Shield, Clock,
  ArrowRight, Globe, CreditCard,
} from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { ADMIN_ID } from "@/lib/supabase";

interface Plan {
  id: number; name: string; price: number;
  validity: number; validity_unit: string; validity_days: number;
  speed_down: number; speed_up: number;
  description: string | null; plan_type?: string; type?: string;
}
type Tab = "plans" | "login" | "voucher";

function formatValidity(plan: Plan): string {
  const days = plan.validity_days ?? plan.validity ?? 0;
  const unit = plan.validity_unit ?? "days";
  if (unit === "hours" || days === 0) return `${plan.validity ?? 1} Hrs`;
  if (days < 1) return `${Math.round(days * 24)} Hrs`;
  if (days === 1) return "1 Day";
  if (days < 7) return `${days} Days`;
  if (days === 7) return "1 Week";
  if (days === 30 || days === 31) return "1 Month";
  if (days === 365) return "1 Year";
  return `${days} Days`;
}

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) return `${mbps / 1000}Gbps`;
  return `${mbps}Mbps`;
}

const PLAN_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

export default function HotspotLogin() {
  const brand = useBrand();
  const [activeTab, setActiveTab] = useState<Tab>("plans");

  const adminId = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qId = params.get("adminId") ?? params.get("ispId");
      return qId ? parseInt(qId) : ADMIN_ID;
    } catch { return ADMIN_ID; }
  })();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [phone, setPhone] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [stkSent, setStkSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/plans?adminId=${adminId}`);
        const data: Plan[] = await res.json();
        const hs = data.filter(p => !p.type || p.type === "hotspot" || p.plan_type === "hotspot");
        setPlans(hs.length > 0 ? hs : data);
      } catch { setPlans([]); }
      finally { setPlansLoading(false); }
    })();
  }, [adminId]);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !phone.trim()) return;
    setPayLoading(true); setPayError(null);
    try {
      const res = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), amount: selectedPlan.price, plan_id: selectedPlan.id, adminId, account_ref: "ISPlatty" }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) setPayError(data.error ?? "Failed to send STK push. Please try again.");
      else setStkSent(true);
    } catch { setPayError("Could not reach the payment server. Please try again."); }
    finally { setPayLoading(false); }
  };

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loggedInName, setLoggedInName] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(""); setLoginLoading(true);
    try {
      const res = await fetch("/api/customers/hotspot-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, username: loginUsername, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) setLoginError(data.error ?? "Login failed");
      else { setLoggedInName(data.customer?.name || loginUsername); setLoginSuccess(true); }
    } catch { setLoginError("Could not reach the server. Please try again."); }
    finally { setLoginLoading(false); }
  };

  const [voucherCode, setVoucherCode] = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [voucherSuccess, setVoucherSuccess] = useState(false);
  const [voucherInfo, setVoucherInfo] = useState<Record<string, unknown> | null>(null);

  const handleVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoucherError(""); setVoucherLoading(true);
    try {
      const res = await fetch("/api/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, code: voucherCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) setVoucherError(data.error ?? "Voucher redemption failed");
      else { setVoucherInfo(data.voucher); setVoucherSuccess(true); }
    } catch { setVoucherError("Could not reach the server. Please try again."); }
    finally { setVoucherLoading(false); }
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "plans", label: "Buy Data", icon: <CreditCard size={15} /> },
    { id: "login", label: "Login", icon: <User size={15} /> },
    { id: "voucher", label: "Voucher", icon: <Ticket size={15} /> },
  ];

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .hs-page { min-height: 100vh; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0f1e; color: #e2e8f0; overflow-x: hidden; }
        .hs-input { width: 100%; padding: 12px 14px; background: rgba(255,255,255,0.06); border: 1.5px solid rgba(255,255,255,0.1); border-radius: 10px; color: #f1f5f9; font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s; outline: none; }
        .hs-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .hs-input::placeholder { color: rgba(148,163,184,0.5); }
        .hs-btn { width: 100%; padding: 13px; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; }
        .hs-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .hs-btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; box-shadow: 0 4px 20px rgba(59,130,246,0.3); }
        .hs-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 28px rgba(59,130,246,0.4); transform: translateY(-1px); }
        .hs-btn-mpesa { background: linear-gradient(135deg, #00a651, #00c96b); color: #fff; box-shadow: 0 4px 20px rgba(0,166,81,0.3); }
        .hs-btn-mpesa:hover:not(:disabled) { box-shadow: 0 6px 28px rgba(0,166,81,0.4); transform: translateY(-1px); }
        .hs-btn-voucher { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; box-shadow: 0 4px 20px rgba(245,158,11,0.25); }
        .hs-btn-voucher:hover:not(:disabled) { box-shadow: 0 6px 28px rgba(245,158,11,0.35); transform: translateY(-1px); }
        .hs-card { background: rgba(15,23,42,0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; animation: fadeIn 0.3s ease-out; }
        .plan-card { background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px; cursor: pointer; transition: all 0.2s; position: relative; text-align: left; font-family: inherit; color: inherit; width: 100%; }
        .plan-card:hover { border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); transform: translateY(-2px); }
        .plan-card.selected { border-color: rgba(59,130,246,0.5); background: rgba(59,130,246,0.08); box-shadow: 0 0 20px rgba(59,130,246,0.1); }
        .error-box { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border-radius: 10px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); font-size: 13px; color: #fca5a5; }
        .success-box { text-align: center; padding: 32px 24px; animation: fadeIn 0.4s ease-out; }
        .success-icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(16,185,129,0.12); border: 2px solid rgba(16,185,129,0.3); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.2); border-radius: 3px; }
      `}</style>

      <div className="hs-page">
        {/* Background layers */}
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(59,130,246,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(139,92,246,0.06) 0%, transparent 60%)",
        }} />

        {/* Header */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(10,15,30,0.85)", backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "0 20px", height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: "linear-gradient(135deg, #3b82f6, #2563eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 12px rgba(59,130,246,0.3)",
            }}>
              <Wifi size={16} color="#fff" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#f1f5f9", letterSpacing: "0.02em" }}>
                {brand.ispName}
              </div>
              <div style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}>
                {brand.domain}
              </div>
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 99,
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981" }}>Online</span>
          </div>
        </header>

        {/* Main content */}
        <main style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "32px 16px 60px" }}>

          {/* Hero section */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 20px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  position: "absolute", inset: -8 - i * 12, borderRadius: "50%",
                  border: `1px solid rgba(59,130,246,${0.2 - i * 0.06})`,
                  animation: `pulse-ring 3s ease-out ${i * 0.8}s infinite`,
                }} />
              ))}
              <div style={{
                width: 80, height: 80, borderRadius: 20,
                background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))",
                border: "1px solid rgba(59,130,246,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "float 4s ease-in-out infinite",
                position: "relative", zIndex: 1,
              }}>
                <Wifi size={32} color="#3b82f6" strokeWidth={2} />
              </div>
            </div>

            <h1 style={{
              fontSize: 28, fontWeight: 900, color: "#f8fafc",
              margin: "0 0 8px", letterSpacing: "-0.03em", lineHeight: 1.15,
            }}>
              Get Connected
            </h1>
            <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px", lineHeight: 1.5 }}>
              Fast, reliable Wi-Fi by {brand.ispName}
            </p>

            <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
              {[
                { icon: <Shield size={12} />, text: "Secure" },
                { icon: <Zap size={12} />, text: "Instant" },
                { icon: <Globe size={12} />, text: "24/7" },
              ].map((b, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                  {b.icon} {b.text}
                </div>
              ))}
            </div>
          </div>

          {/* Tab bar */}
          <div style={{
            display: "flex", background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, padding: 3, marginBottom: 20, gap: 2,
          }}>
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "10px 8px", borderRadius: 9, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  transition: "all 0.2s",
                  background: active ? "#3b82f6" : "transparent",
                  color: active ? "#fff" : "#64748b",
                  boxShadow: active ? "0 2px 12px rgba(59,130,246,0.3)" : "none",
                }}>
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── TAB: BUY DATA ── */}
          {activeTab === "plans" && (
            <div style={{ animation: "fadeIn 0.3s ease-out" }}>
              {stkSent ? (
                <div className="hs-card" style={{ overflow: "hidden" }}>
                  <div className="success-box">
                    <div className="success-icon">
                      <CheckCircle2 size={28} color="#10b981" strokeWidth={2} />
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>
                      Payment Requested
                    </h3>
                    <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 6 }}>
                      Check your phone and enter your M-Pesa PIN.
                    </p>
                    <p style={{ color: "#64748b", fontSize: 12, marginBottom: 28 }}>
                      You'll be connected automatically once confirmed.
                    </p>
                    <button onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); }}
                      style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Start Over
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {plansLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                      <Loader2 size={24} color="#3b82f6" style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  ) : plans.length === 0 ? (
                    <p style={{ textAlign: "center", color: "#64748b", padding: "48px 0", fontSize: 14 }}>
                      No plans available at the moment.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                      {plans.map((plan, i) => {
                        const color = PLAN_COLORS[i % PLAN_COLORS.length];
                        const sel = selectedPlan?.id === plan.id;
                        return (
                          <button key={plan.id} className={`plan-card${sel ? " selected" : ""}`}
                            onClick={() => setSelectedPlan(sel ? null : plan)}
                            style={sel ? { borderColor: color + "66", background: color + "0d", boxShadow: `0 0 20px ${color}15` } : {}}>

                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                                letterSpacing: "0.06em", color, opacity: 0.9,
                              }}>
                                {plan.name}
                              </span>
                              {sel && (
                                <div style={{
                                  width: 18, height: 18, borderRadius: "50%", background: color,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                  <CheckCircle2 size={10} color="#fff" strokeWidth={3} />
                                </div>
                              )}
                            </div>

                            <div style={{ fontSize: 28, fontWeight: 900, color: "#f1f5f9", lineHeight: 1, marginBottom: 12 }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>Ksh</span>{" "}
                              {plan.price}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#94a3b8" }}>
                                <Clock size={11} color={color} /> {formatValidity(plan)}
                              </div>
                              {plan.speed_down > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#94a3b8" }}>
                                  <Zap size={11} color={color} /> {formatSpeed(plan.speed_down)}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Payment section */}
                  <div className="hs-card" style={{ overflow: "hidden" }}>
                    <div style={{
                      padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        background: "rgba(0,166,81,0.12)", border: "1px solid rgba(0,166,81,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Phone size={14} color="#00a651" />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>M-Pesa Payment</p>
                        <p style={{ fontSize: 11, color: "#64748b" }}>Instant STK push</p>
                      </div>
                    </div>

                    <div style={{ padding: 18 }}>
                      {selectedPlan ? (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 14px", borderRadius: 10, marginBottom: 14,
                          background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)",
                        }}>
                          <div>
                            <span style={{ fontSize: 11, color: "#64748b" }}>Selected</span>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>{selectedPlan.name}</p>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 900, color: "#3b82f6" }}>Ksh {selectedPlan.price}</span>
                        </div>
                      ) : (
                        <div style={{
                          padding: "14px", borderRadius: 10, marginBottom: 14,
                          background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)",
                          fontSize: 13, color: "#475569", textAlign: "center",
                        }}>
                          Select a plan above
                        </div>
                      )}

                      <form onSubmit={handlePay} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
                            Phone Number
                          </label>
                          <div style={{ position: "relative" }}>
                            <span style={{
                              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                              fontSize: 13, fontWeight: 600, color: "#64748b", pointerEvents: "none",
                            }}>+254</span>
                            <input className="hs-input" type="tel" placeholder="7XX XXX XXX" required
                              value={phone} onChange={e => setPhone(e.target.value)}
                              style={{ paddingLeft: 56 }} />
                          </div>
                        </div>

                        {payError && (
                          <div className="error-box">
                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                            {payError}
                          </div>
                        )}

                        <button type="submit" disabled={payLoading || !selectedPlan}
                          className={`hs-btn ${selectedPlan ? "hs-btn-mpesa" : ""}`}
                          style={!selectedPlan ? { background: "rgba(255,255,255,0.06)", color: "#475569", cursor: "not-allowed", boxShadow: "none" } : {}}>
                          {payLoading ? (
                            <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Sending...</>
                          ) : !selectedPlan ? (
                            "Select a plan to continue"
                          ) : (
                            <><Phone size={15} /> Pay Ksh {selectedPlan.price}</>
                          )}
                        </button>
                      </form>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 12 }}>
                        <Shield size={10} color="#475569" />
                        <span style={{ fontSize: 10, color: "#475569" }}>Secured by Safaricom M-Pesa</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── TAB: LOGIN ── */}
          {activeTab === "login" && (
            <div className="hs-card" style={{ overflow: "hidden", animation: "fadeIn 0.3s ease-out" }}>
              <div style={{
                padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <User size={14} color="#3b82f6" />
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>Member Login</p>
                  <p style={{ fontSize: 11, color: "#64748b" }}>Sign in with your credentials</p>
                </div>
              </div>

              <div style={{ padding: 18 }}>
                {loginSuccess ? (
                  <div className="success-box">
                    <div className="success-icon">
                      <CheckCircle2 size={28} color="#10b981" strokeWidth={2} />
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>
                      Welcome, {loggedInName}!
                    </h3>
                    <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
                      You're now connected to the network.
                    </p>
                    <button onClick={() => { setLoginSuccess(false); setLoginUsername(""); setLoginPassword(""); }}
                      style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {loginError && (
                      <div className="error-box">
                        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        {loginError}
                      </div>
                    )}

                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>Username</label>
                      <div style={{ position: "relative" }}>
                        <User size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                        <input className="hs-input" type="text" placeholder="Enter username" required
                          value={loginUsername} onChange={e => setLoginUsername(e.target.value)}
                          style={{ paddingLeft: 36 }} />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>Password</label>
                      <div style={{ position: "relative" }}>
                        <Lock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                        <input className="hs-input" type="password" placeholder="Enter password" required
                          value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                          style={{ paddingLeft: 36 }} />
                      </div>
                    </div>

                    <button type="submit" disabled={loginLoading} className="hs-btn hs-btn-primary">
                      {loginLoading ? (
                        <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Connecting...</>
                      ) : (
                        <><Wifi size={15} /> Connect</>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: VOUCHER ── */}
          {activeTab === "voucher" && (
            <div className="hs-card" style={{ overflow: "hidden", animation: "fadeIn 0.3s ease-out" }}>
              <div style={{
                padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Ticket size={14} color="#f59e0b" />
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>Redeem Voucher</p>
                  <p style={{ fontSize: 11, color: "#64748b" }}>Enter your voucher code</p>
                </div>
              </div>

              <div style={{ padding: 18 }}>
                {voucherSuccess ? (
                  <div className="success-box">
                    <div className="success-icon">
                      <CheckCircle2 size={28} color="#10b981" strokeWidth={2} />
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>Activated!</h3>
                    {voucherInfo?.plan_name && (
                      <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>
                        Plan: <strong style={{ color: "#f1f5f9" }}>{String(voucherInfo.plan_name)}</strong>
                      </p>
                    )}
                    {voucherInfo?.duration && (
                      <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 20 }}>
                        Duration: <strong style={{ color: "#f1f5f9" }}>{String(voucherInfo.duration)}</strong>
                      </p>
                    )}
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
                      borderRadius: 99, padding: "5px 14px", marginBottom: 24,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#10b981" }}>Connected</span>
                    </div>
                    <br />
                    <button onClick={() => { setVoucherSuccess(false); setVoucherCode(""); setVoucherInfo(null); }}
                      style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Redeem Another
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleVoucher} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{
                      padding: 16, borderRadius: 10,
                      background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)",
                      textAlign: "center",
                    }}>
                      <Ticket size={18} color="#f59e0b" style={{ marginBottom: 6 }} />
                      <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
                        Enter the code from your voucher card
                      </p>
                    </div>

                    {voucherError && (
                      <div className="error-box">
                        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        {voucherError}
                      </div>
                    )}

                    <input className="hs-input" type="text" placeholder="XXXX-XXXX-XXXX" required
                      value={voucherCode} onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                      style={{
                        textAlign: "center", fontFamily: "monospace",
                        fontSize: 18, letterSpacing: "0.12em", fontWeight: 700,
                        color: "#f59e0b", padding: "14px",
                        borderColor: "rgba(245,158,11,0.2)",
                      }} />

                    <button type="submit" disabled={voucherLoading} className="hs-btn hs-btn-voucher">
                      {voucherLoading ? (
                        <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Validating...</>
                      ) : (
                        <><ArrowRight size={15} /> Activate Voucher</>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ textAlign: "center", marginTop: 32, padding: "0 16px" }}>
            <p style={{ fontSize: 11, color: "#334155" }}>
              {new Date().getFullYear()} {brand.ispName} · {brand.domain}
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
