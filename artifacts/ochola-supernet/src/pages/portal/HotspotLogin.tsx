import React, { useState, useEffect, useRef } from "react";
import {
  Wifi, Phone, Lock, Zap, CheckCircle2, Ticket,
  AlertCircle, User, Loader2, Shield, Clock, Signal,
  ChevronRight, Star, ArrowRight,
} from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { ADMIN_ID } from "@/lib/supabase";

/* ── Types ── */
interface Plan {
  id: number; name: string; price: number;
  validity: number; validity_unit: string; validity_days: number;
  speed_down: number; speed_up: number;
  description: string | null; plan_type?: string; type?: string;
}
type Tab = "plans" | "login" | "voucher";

/* ── Helpers ── */
function formatValidity(plan: Plan): string {
  const days = plan.validity_days ?? plan.validity ?? 0;
  const unit = plan.validity_unit ?? "days";
  if (unit === "hours" || days === 0) return `${plan.validity ?? 1} ${unit}`;
  if (days < 1) return `${Math.round(days * 24)} hrs`;
  if (days === 1) return "1 day";
  if (days < 7) return `${days} days`;
  if (days === 7) return "1 week";
  if (days === 30 || days === 31) return "1 month";
  if (days === 365) return "1 year";
  return `${days} days`;
}

/* ── Accent palette for plan cards ── */
const CARD_ACCENTS = [
  { bar: "linear-gradient(90deg,#00d4ff,#0080ff)", glow: "rgba(0,212,255,0.18)", badge: "#00d4ff" },
  { bar: "linear-gradient(90deg,#a855f7,#7c3aed)", glow: "rgba(168,85,247,0.18)", badge: "#a855f7" },
  { bar: "linear-gradient(90deg,#00ff9d,#00b86b)", glow: "rgba(0,255,157,0.18)", badge: "#00ff9d" },
  { bar: "linear-gradient(90deg,#f59e0b,#ef4444)", glow: "rgba(245,158,11,0.18)", badge: "#f59e0b" },
  { bar: "linear-gradient(90deg,#f43f5e,#e11d48)", glow: "rgba(244,63,94,0.18)", badge: "#f43f5e" },
  { bar: "linear-gradient(90deg,#06b6d4,#0e7490)", glow: "rgba(6,182,212,0.18)", badge: "#06b6d4" },
];

/* ── Inline style constants ── */
const BG   = "#020b18";
const CARD = "rgba(255,255,255,0.04)";
const BORD = "rgba(0,212,255,0.12)";
const CYAN = "#00d4ff";
const MINT = "#00ff9d";

/* ── Pulsing WiFi rings (pure CSS animation via style tag) ── */
function GlobalStyles() {
  return (
    <style>{`
      @keyframes ring-pulse {
        0%   { transform: scale(0.6); opacity: 0.7; }
        100% { transform: scale(2.6); opacity: 0; }
      }
      @keyframes float-up {
        0%   { transform: translateY(0px); }
        50%  { transform: translateY(-8px); }
        100% { transform: translateY(0px); }
      }
      @keyframes shimmer {
        0%   { background-position: -200% center; }
        100% { background-position:  200% center; }
      }
      .ring { animation: ring-pulse 3s ease-out infinite; transform-origin: center; }
      .ring:nth-child(2) { animation-delay: 1s; }
      .ring:nth-child(3) { animation-delay: 2s; }
      .wifi-icon { animation: float-up 4s ease-in-out infinite; }
      .shimmer-text {
        background: linear-gradient(90deg, #fff 30%, ${CYAN} 50%, #fff 70%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: shimmer 4s linear infinite;
      }
      .plan-card { transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; }
      .plan-card:hover { transform: translateY(-2px); }
      input:focus { outline: none; border-color: ${CYAN} !important; box-shadow: 0 0 0 3px rgba(0,212,255,0.15) !important; }
      ::-webkit-scrollbar { width: 6px; } 
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.2); border-radius: 3px; }
    `}</style>
  );
}

/* ── WiFi hero animation ── */
function WifiHero() {
  return (
    <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 32px" }}>
      {[0,1,2].map(i => (
        <div key={i} className="ring" style={{
          position: "absolute", inset: 0,
          borderRadius: "50%",
          border: `1px solid rgba(0,212,255,${0.35 - i * 0.1})`,
          animationDelay: `${i}s`,
        }} />
      ))}
      <div className="wifi-icon" style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(circle, rgba(0,212,255,0.15) 0%, transparent 70%)",
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: `linear-gradient(135deg, rgba(0,212,255,0.2), rgba(0,128,255,0.25))`,
          border: `1px solid rgba(0,212,255,0.35)`,
          backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 32px rgba(0,212,255,0.25)",
        }}>
          <Wifi size={28} color={CYAN} strokeWidth={1.8} />
        </div>
      </div>
    </div>
  );
}

/* ── Small trust badge ── */
function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 99,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 600,
    }}>
      {icon}
      {label}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
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

  /* ── Plans ── */
  const [plans,        setPlans]        = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [phone,        setPhone]        = useState("");
  const [payLoading,   setPayLoading]   = useState(false);
  const [payError,     setPayError]     = useState<string | null>(null);
  const [stkSent,      setStkSent]      = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`/api/plans?adminId=${adminId}`);
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
      const res  = await fetch("/api/mpesa/stk", {
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

  /* ── Member login ── */
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading,  setLoginLoading]  = useState(false);
  const [loginError,    setLoginError]    = useState("");
  const [loginSuccess,  setLoginSuccess]  = useState(false);
  const [loggedInName,  setLoggedInName]  = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(""); setLoginLoading(true);
    try {
      const res  = await fetch("/api/customers/hotspot-login", {
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

  /* ── Voucher ── */
  const [voucherCode,    setVoucherCode]    = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError,   setVoucherError]   = useState("");
  const [voucherSuccess, setVoucherSuccess] = useState(false);
  const [voucherInfo,    setVoucherInfo]    = useState<Record<string, unknown> | null>(null);

  const handleVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoucherError(""); setVoucherLoading(true);
    try {
      const res  = await fetch("/api/vouchers/redeem", {
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

  /* ── Tab definitions ── */
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "plans",   label: "Buy Data",      icon: <Signal size={14} /> },
    { id: "login",   label: "Member Login",  icon: <User   size={14} /> },
    { id: "voucher", label: "Voucher",        icon: <Ticket size={14} /> },
  ];

  /* ════ RENDER ════ */
  return (
    <div style={{
      minHeight: "100vh", background: BG, color: "#e8f4f8",
      fontFamily: "'Inter', system-ui, sans-serif",
      overflowX: "hidden", position: "relative",
    }}>
      <GlobalStyles />

      {/* ── Deep-space background ── */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,100,200,0.18) 0%, transparent 70%),
                     radial-gradient(ellipse 60% 40% at 80% 80%, rgba(0,212,255,0.06) 0%, transparent 60%)`,
      }} />
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: `linear-gradient(rgba(0,212,255,0.025) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(0,212,255,0.025) 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(ellipse 100% 80% at 50% 0%, black, transparent)",
        WebkitMaskImage: "radial-gradient(ellipse 100% 80% at 50% 0%, black, transparent)",
      }} />

      {/* ── Header ── */}
      <header style={{
        position: "relative", zIndex: 10,
        borderBottom: "1px solid rgba(0,212,255,0.1)",
        background: "rgba(2,11,24,0.8)", backdropFilter: "blur(20px)",
        padding: "0 24px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: `linear-gradient(135deg, rgba(0,212,255,0.2), rgba(0,128,255,0.3))`,
            border: "1px solid rgba(0,212,255,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 20px rgba(0,212,255,0.15)",
          }}>
            <Wifi size={18} color={CYAN} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.04em", color: "#f0f9ff" }}>
              {brand.ispName.toUpperCase()}
            </div>
            <div style={{ fontSize: 11, color: "rgba(0,212,255,0.6)", fontWeight: 500 }}>
              Hotspot Portal · {brand.domain}
            </div>
          </div>
        </div>

        {/* Network status chip */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 14px", borderRadius: 99,
          background: "rgba(0,255,157,0.06)",
          border: "1px solid rgba(0,255,157,0.2)",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: MINT, display: "inline-block",
            boxShadow: `0 0 8px ${MINT}`,
            animation: "ring-pulse 2s ease-out infinite",
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: MINT }}>Network Online</span>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ position: "relative", zIndex: 1, maxWidth: 560, margin: "0 auto", padding: "48px 20px 80px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <WifiHero />
          <h1 className="shimmer-text" style={{ fontSize: 36, fontWeight: 900, margin: "0 0 12px", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            Connect in Seconds
          </h1>
          <p style={{ color: "rgba(200,230,255,0.5)", fontSize: 14, margin: "0 0 24px", maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
            Fast, reliable Wi-Fi powered by {brand.ispName}. Pay instantly with M-Pesa and get online.
          </p>
          {/* Trust badges */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge icon={<Shield size={11} color={CYAN} />} label="Secure Payment" />
            <Badge icon={<Zap size={11} color="#f59e0b" />} label="Instant Activation" />
            <Badge icon={<Clock size={11} color={MINT} />} label="24/7 Support" />
          </div>
        </div>

        {/* ── Tab switcher ── */}
        <div style={{
          display: "flex", background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: 4, marginBottom: 28, gap: 2,
        }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "10px 8px", borderRadius: 12, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                  transition: "all 0.2s",
                  background: active ? CYAN : "transparent",
                  color: active ? "#020b18" : "rgba(200,230,255,0.5)",
                  boxShadow: active ? `0 4px 16px rgba(0,212,255,0.3)` : "none",
                }}
              >
                {tab.icon}
                <span style={{ whiteSpace: "nowrap" }}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ══════════════════════════════════════
            TAB: BUY DATA
        ══════════════════════════════════════ */}
        {activeTab === "plans" && (
          <div>
            {stkSent ? (
              /* ── STK sent success ── */
              <div style={{
                background: CARD, border: "1px solid rgba(0,255,157,0.2)",
                borderRadius: 24, padding: "48px 32px", textAlign: "center",
                backdropFilter: "blur(20px)",
                boxShadow: "0 0 40px rgba(0,255,157,0.06)",
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: "50%",
                  background: "rgba(0,255,157,0.1)", border: "1px solid rgba(0,255,157,0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 20px", boxShadow: "0 0 32px rgba(0,255,157,0.15)",
                }}>
                  <CheckCircle2 size={32} color={MINT} strokeWidth={1.5} />
                </div>
                <h3 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "0 0 10px" }}>
                  STK Push Sent!
                </h3>
                <p style={{ color: "rgba(200,230,255,0.6)", fontSize: 14, margin: "0 0 8px" }}>
                  Check your phone and enter your M-Pesa PIN to complete payment.
                </p>
                <p style={{ color: "rgba(200,230,255,0.4)", fontSize: 12, margin: "0 0 32px" }}>
                  You'll be connected automatically once payment is confirmed.
                </p>
                <button
                  onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); }}
                  style={{
                    background: "none", border: `1px solid rgba(0,212,255,0.25)`,
                    color: CYAN, borderRadius: 10, padding: "10px 24px",
                    fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Start Over
                </button>
              </div>
            ) : (
              <>
                {/* Plan grid */}
                {plansLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                    <Loader2 size={28} color={CYAN} style={{ animation: "spin 1s linear infinite" }} />
                  </div>
                ) : plans.length === 0 ? (
                  <p style={{ textAlign: "center", color: "rgba(200,230,255,0.4)", padding: "40px 0", fontSize: 14 }}>
                    No hotspot plans available yet.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                    {plans.map((plan, i) => {
                      const acc = CARD_ACCENTS[i % CARD_ACCENTS.length];
                      const sel = selectedPlan?.id === plan.id;
                      return (
                        <button
                          key={plan.id}
                          className="plan-card"
                          onClick={() => setSelectedPlan(sel ? null : plan)}
                          style={{
                            textAlign: "left", padding: "0 0 16px",
                            borderRadius: 16, border: `1px solid ${sel ? acc.badge + "55" : BORD}`,
                            background: sel ? `${acc.glow}` : CARD,
                            backdropFilter: "blur(12px)",
                            cursor: "pointer", fontFamily: "inherit", color: "#e8f4f8",
                            overflow: "hidden", position: "relative",
                            boxShadow: sel ? `0 0 24px ${acc.glow}` : "none",
                          }}
                        >
                          {/* Colour bar */}
                          <div style={{ height: 3, background: acc.bar, marginBottom: 14 }} />

                          <div style={{ padding: "0 16px" }}>
                            {/* Selected tick */}
                            {sel && (
                              <div style={{
                                position: "absolute", top: 12, right: 12,
                                width: 20, height: 20, borderRadius: "50%",
                                background: acc.badge,
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                <CheckCircle2 size={12} color="#020b18" strokeWidth={3} />
                              </div>
                            )}

                            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(200,230,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px" }}>
                              {plan.name}
                            </p>
                            <p style={{ fontSize: 26, fontWeight: 900, margin: "0 0 10px", color: "#fff", letterSpacing: "-0.02em" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(200,230,255,0.5)" }}>Ksh </span>
                              {plan.price}
                            </p>

                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: acc.badge, fontWeight: 600 }}>
                                <Clock size={11} /> {formatValidity(plan)}
                              </div>
                              {plan.speed_down > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(200,230,255,0.4)", fontWeight: 500 }}>
                                  <Zap size={10} /> {plan.speed_down}Mbps
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selected plan summary + payment form */}
                <div style={{
                  background: "rgba(0,20,40,0.7)", backdropFilter: "blur(20px)",
                  border: `1px solid ${BORD}`, borderRadius: 20,
                  overflow: "hidden",
                }}>
                  {/* Header stripe */}
                  <div style={{
                    padding: "16px 24px", borderBottom: "1px solid rgba(0,212,255,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* M-Pesa green dot */}
                      <div style={{
                        width: 32, height: 32, borderRadius: 9,
                        background: "rgba(0,166,81,0.15)", border: "1px solid rgba(0,166,81,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Phone size={15} color="#00a651" />
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fff" }}>Pay with M-Pesa</p>
                        <p style={{ margin: 0, fontSize: 11, color: "rgba(200,230,255,0.4)" }}>STK push to your phone</p>
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: "#00a651",
                      background: "rgba(0,166,81,0.1)", border: "1px solid rgba(0,166,81,0.25)",
                      borderRadius: 99, padding: "3px 10px", letterSpacing: "0.05em",
                    }}>
                      OFFICIAL
                    </div>
                  </div>

                  <div style={{ padding: "20px 24px" }}>
                    {/* Selected plan chip */}
                    {selectedPlan ? (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 14px", borderRadius: 10, marginBottom: 18,
                        background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.15)",
                      }}>
                        <div>
                          <span style={{ fontSize: 11, color: "rgba(200,230,255,0.5)", display: "block" }}>Selected plan</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{selectedPlan.name}</span>
                        </div>
                        <span style={{ fontSize: 18, fontWeight: 900, color: CYAN }}>Ksh {selectedPlan.price}</span>
                      </div>
                    ) : (
                      <div style={{
                        padding: "10px 14px", borderRadius: 10, marginBottom: 18,
                        background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)",
                        fontSize: 13, color: "rgba(200,230,255,0.35)", textAlign: "center",
                      }}>
                        ↑ Select a plan above to continue
                      </div>
                    )}

                    <form onSubmit={handlePay} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(200,230,255,0.45)", marginBottom: 8 }}>
                          M-Pesa Phone Number
                        </label>
                        <div style={{ position: "relative" }}>
                          <span style={{
                            position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                            fontSize: 13, fontWeight: 700, color: "rgba(200,230,255,0.35)",
                          }}>🇰🇪 +254</span>
                          <input
                            type="tel" placeholder="7XX XXX XXX" required
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            style={{
                              width: "100%", boxSizing: "border-box",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(0,212,255,0.15)",
                              borderRadius: 12, padding: "13px 14px 13px 88px",
                              fontSize: 15, fontWeight: 700, color: "#fff",
                              fontFamily: "inherit", transition: "border-color 0.2s",
                            }}
                          />
                        </div>
                      </div>

                      {payError && (
                        <div style={{
                          display: "flex", alignItems: "flex-start", gap: 8,
                          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                          borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fca5a5",
                        }}>
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {payError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={payLoading || !selectedPlan}
                        style={{
                          width: "100%", padding: "14px", borderRadius: 12, border: "none",
                          background: selectedPlan
                            ? "linear-gradient(135deg, #00a651, #00c96b)"
                            : "rgba(255,255,255,0.06)",
                          color: selectedPlan ? "#fff" : "rgba(200,230,255,0.25)",
                          fontSize: 14, fontWeight: 800, cursor: selectedPlan ? "pointer" : "not-allowed",
                          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          boxShadow: selectedPlan ? "0 4px 24px rgba(0,166,81,0.3)" : "none",
                          transition: "all 0.2s",
                        }}
                      >
                        {payLoading ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Sending prompt…</>
                        ) : !selectedPlan ? (
                          "Select a plan above"
                        ) : (
                          <><Phone size={15} /> Send M-Pesa STK Push · Ksh {selectedPlan.price}</>
                        )}
                      </button>
                    </form>

                    {/* Security note */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 }}>
                      <Shield size={11} color="rgba(200,230,255,0.25)" />
                      <span style={{ fontSize: 11, color: "rgba(200,230,255,0.25)" }}>
                        Secured · Powered by Safaricom M-Pesa
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: MEMBER LOGIN
        ══════════════════════════════════════ */}
        {activeTab === "login" && (
          <div style={{
            background: "rgba(0,20,40,0.7)", backdropFilter: "blur(20px)",
            border: `1px solid ${BORD}`, borderRadius: 20, overflow: "hidden",
          }}>
            <div style={{
              padding: "20px 24px", borderBottom: "1px solid rgba(0,212,255,0.08)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <User size={18} color={CYAN} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>Member Login</p>
                <p style={{ margin: 0, fontSize: 11, color: "rgba(200,230,255,0.4)" }}>Sign in to your account</p>
              </div>
            </div>

            <div style={{ padding: "24px" }}>
              {loginSuccess ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    background: "rgba(0,255,157,0.1)", border: "1px solid rgba(0,255,157,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 20px", boxShadow: "0 0 32px rgba(0,255,157,0.15)",
                  }}>
                    <CheckCircle2 size={32} color={MINT} strokeWidth={1.5} />
                  </div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>
                    Welcome, {loggedInName}!
                  </h3>
                  <p style={{ color: "rgba(200,230,255,0.5)", fontSize: 13, margin: "0 0 28px" }}>
                    You are now connected to the network.
                  </p>
                  <button
                    onClick={() => { setLoginSuccess(false); setLoginUsername(""); setLoginPassword(""); }}
                    style={{
                      background: "none", border: "1px solid rgba(0,212,255,0.2)",
                      color: CYAN, borderRadius: 10, padding: "9px 22px",
                      fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {loginError && (
                    <div style={{
                      display: "flex", alignItems: "flex-start", gap: 8,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fca5a5",
                    }}>
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {loginError}
                    </div>
                  )}

                  {[
                    { label: "Username", type: "text",     val: loginUsername, set: setLoginUsername, ph: "your-username", icon: <User size={14} /> },
                    { label: "Password", type: "password", val: loginPassword, set: setLoginPassword, ph: "••••••••",       icon: <Lock size={14} /> },
                  ].map(f => (
                    <div key={f.label}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(200,230,255,0.45)", marginBottom: 8 }}>
                        {f.label}
                      </label>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(200,230,255,0.3)" }}>
                          {f.icon}
                        </span>
                        <input
                          type={f.type} placeholder={f.ph} required
                          value={f.val} onChange={e => f.set(e.target.value)}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(0,212,255,0.15)",
                            borderRadius: 12, padding: "13px 14px 13px 44px",
                            fontSize: 14, color: "#fff", fontFamily: "inherit",
                            transition: "border-color 0.2s",
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    type="submit" disabled={loginLoading}
                    style={{
                      width: "100%", padding: "14px", borderRadius: 12, border: "none",
                      background: `linear-gradient(135deg, ${CYAN}, #0080ff)`,
                      color: "#020b18", fontSize: 14, fontWeight: 800,
                      cursor: loginLoading ? "not-allowed" : "pointer",
                      fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: "0 4px 24px rgba(0,212,255,0.25)",
                      opacity: loginLoading ? 0.7 : 1, transition: "opacity 0.2s",
                    }}
                  >
                    {loginLoading ? (
                      <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Verifying…</>
                    ) : (
                      <><Wifi size={15} /> Connect to Network</>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: VOUCHER
        ══════════════════════════════════════ */}
        {activeTab === "voucher" && (
          <div style={{
            background: "rgba(0,20,40,0.7)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(245,158,11,0.15)", borderRadius: 20, overflow: "hidden",
          }}>
            <div style={{
              padding: "20px 24px", borderBottom: "1px solid rgba(245,158,11,0.1)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Ticket size={18} color="#f59e0b" />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>Redeem Voucher</p>
                <p style={{ margin: 0, fontSize: 11, color: "rgba(200,230,255,0.4)" }}>Enter your printed code to connect</p>
              </div>
            </div>

            <div style={{ padding: "24px" }}>
              {voucherSuccess ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    background: "rgba(0,255,157,0.1)", border: "1px solid rgba(0,255,157,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 20px",
                  }}>
                    <CheckCircle2 size={32} color={MINT} strokeWidth={1.5} />
                  </div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>Voucher Activated!</h3>
                  {voucherInfo?.plan_name && (
                    <p style={{ color: "rgba(200,230,255,0.5)", fontSize: 13, margin: "0 0 4px" }}>
                      Plan: <strong style={{ color: "#fff" }}>{String(voucherInfo.plan_name)}</strong>
                    </p>
                  )}
                  {voucherInfo?.duration && (
                    <p style={{ color: "rgba(200,230,255,0.5)", fontSize: 13, margin: "0 0 24px" }}>
                      Duration: <strong style={{ color: "#fff" }}>{String(voucherInfo.duration)}</strong>
                    </p>
                  )}
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "rgba(0,255,157,0.06)", border: "1px solid rgba(0,255,157,0.2)",
                    borderRadius: 99, padding: "6px 16px", marginBottom: 28,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: MINT }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: MINT }}>You are now connected</span>
                  </div>
                  <br />
                  <button
                    onClick={() => { setVoucherSuccess(false); setVoucherCode(""); setVoucherInfo(null); }}
                    style={{
                      background: "none", border: "1px solid rgba(245,158,11,0.25)",
                      color: "#f59e0b", borderRadius: 10, padding: "9px 22px",
                      fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Redeem Another
                  </button>
                </div>
              ) : (
                <form onSubmit={handleVoucher} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{
                    padding: "20px", borderRadius: 14,
                    background: "rgba(245,158,11,0.04)", border: "1px dashed rgba(245,158,11,0.2)",
                    textAlign: "center",
                  }}>
                    <Star size={20} color="#f59e0b" style={{ marginBottom: 8 }} />
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(200,230,255,0.45)" }}>
                      Enter the code printed on your voucher card below.
                    </p>
                  </div>

                  {voucherError && (
                    <div style={{
                      display: "flex", alignItems: "flex-start", gap: 8,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fca5a5",
                    }}>
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {voucherError}
                    </div>
                  )}

                  <input
                    type="text" placeholder="XXXX-XXXX-XXXX" required
                    value={voucherCode}
                    onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(245,158,11,0.25)",
                      borderRadius: 12, padding: "16px",
                      textAlign: "center", fontFamily: "monospace",
                      fontSize: 20, letterSpacing: "0.15em", fontWeight: 700,
                      color: "#f59e0b", transition: "border-color 0.2s",
                    }}
                  />

                  <button
                    type="submit" disabled={voucherLoading}
                    style={{
                      width: "100%", padding: "14px", borderRadius: 12, border: "none",
                      background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                      color: "#fff", fontSize: 14, fontWeight: 800,
                      cursor: voucherLoading ? "not-allowed" : "pointer",
                      fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: "0 4px 24px rgba(245,158,11,0.2)",
                      opacity: voucherLoading ? 0.7 : 1, transition: "opacity 0.2s",
                    }}
                  >
                    {voucherLoading ? (
                      <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Validating…</>
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
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <p style={{ fontSize: 11, color: "rgba(200,230,255,0.2)", margin: 0 }}>
            © {new Date().getFullYear()} {brand.ispName} · {brand.domain} · All rights reserved
          </p>
        </div>
      </main>
    </div>
  );
}
