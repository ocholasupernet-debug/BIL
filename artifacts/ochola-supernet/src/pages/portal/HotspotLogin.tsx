import React, { useState, useEffect } from "react";
import {
  Wifi, Phone, Lock, Zap, CheckCircle2, Ticket,
  AlertCircle, User, Loader2, Shield, Clock,
  ArrowRight, CreditCard,
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

const PLAN_GRADIENTS = [
  { bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", light: "#667eea" },
  { bg: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)", light: "#f093fb" },
  { bg: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)", light: "#4facfe" },
  { bg: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)", light: "#43e97b" },
  { bg: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)", light: "#fa709a" },
  { bg: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)", light: "#a18cd1" },
  { bg: "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)", light: "#fccb90" },
  { bg: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)", light: "#e0c3fc" },
  { bg: "linear-gradient(135deg, #f5576c 0%, #ff6f61 100%)", light: "#f5576c" },
  { bg: "linear-gradient(135deg, #0acffe 0%, #495aff 100%)", light: "#0acffe" },
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
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [mpesaStatus, setMpesaStatus] = useState<{ configured: boolean; env: string; shortcode: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [plansRes, mpesaRes] = await Promise.all([
          fetch(`/api/plans?adminId=${adminId}`),
          fetch("/api/settings/mpesa").catch(() => null),
        ]);
        const plansData: Plan[] = await plansRes.json();
        const hs = plansData.filter(p => !p.type || p.type === "hotspot" || p.plan_type === "hotspot");
        setPlans(hs.length > 0 ? hs : plansData);

        if (mpesaRes?.ok) {
          const mpesaData = await mpesaRes.json();
          setMpesaStatus({
            configured: mpesaData.configured,
            env: mpesaData.settings?.env ?? "sandbox",
            shortcode: mpesaData.settings?.shortcode ?? "",
          });
        }
      } catch { setPlans([]); }
      finally { setPlansLoading(false); }
    })();
  }, [adminId]);

  const [pollTimedOut, setPollTimedOut] = useState(false);

  useEffect(() => {
    if (!checkoutId || paymentConfirmed) return;
    setPollTimedOut(false);
    const start = Date.now();
    const maxPollMs = 3 * 60 * 1000;
    const interval = setInterval(async () => {
      if (Date.now() - start > maxPollMs) {
        setPollTimedOut(true);
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`);
        const data = await res.json();
        if (data.paid) {
          setPaymentConfirmed(true);
          clearInterval(interval);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [checkoutId, paymentConfirmed]);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !phone.trim()) return;
    setPayLoading(true); setPayError(null);
    try {
      const res = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), amount: selectedPlan.price, plan_id: selectedPlan.id, adminId, account_ref: brand.ispName }),
      });
      const data = await res.json() as { ok: boolean; error?: string; CheckoutRequestID?: string };
      if (!res.ok || !data.ok) setPayError(data.error ?? "Failed to send STK push. Please try again.");
      else {
        setStkSent(true);
        if (data.CheckoutRequestID) setCheckoutId(data.CheckoutRequestID);
      }
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
    { id: "plans", label: "Buy Data", icon: <CreditCard size={16} /> },
    { id: "login", label: "Login", icon: <User size={16} /> },
    { id: "voucher", label: "Voucher", icon: <Ticket size={16} /> },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes breathe { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.05); opacity: 0.8; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes glow-pulse { 0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.2); } 50% { box-shadow: 0 0 40px rgba(99,102,241,0.4); } }

        .hp-root {
          min-height: 100vh;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #0f0f1a;
          color: #fff;
          overflow-x: hidden;
          position: relative;
        }

        .hp-bg-orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          animation: breathe 8s ease-in-out infinite;
        }

        .hp-header {
          position: sticky; top: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 20px; height: 60px;
          background: rgba(15,15,26,0.6);
          backdrop-filter: blur(24px);
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .hp-logo { display: flex; align-items: center; gap: 12px; }
        .hp-logo-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
        }
        .hp-logo-text { font-weight: 800; font-size: 15px; color: #fff; }
        .hp-logo-sub { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 500; }

        .hp-status {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 14px; border-radius: 100px;
          background: rgba(52,211,153,0.1);
          border: 1px solid rgba(52,211,153,0.2);
          font-size: 12px; font-weight: 700; color: #34d399;
        }
        .hp-status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 10px #34d399;
        }

        .hp-main {
          position: relative; z-index: 1;
          max-width: 460px; margin: 0 auto;
          padding: 28px 16px 60px;
        }

        .hp-hero { text-align: center; margin-bottom: 28px; animation: fadeUp 0.5s ease-out; }

        .hp-wifi-wrap {
          position: relative; width: 88px; height: 88px;
          margin: 0 auto 22px;
        }
        .hp-wifi-box {
          width: 88px; height: 88px; border-radius: 24px;
          background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15));
          border: 1.5px solid rgba(99,102,241,0.3);
          display: flex; align-items: center; justify-content: center;
          position: relative; z-index: 2;
          animation: float 5s ease-in-out infinite, glow-pulse 3s ease-in-out infinite;
        }

        .hp-title {
          font-size: 32px; font-weight: 900; color: #fff;
          letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 8px;
        }
        .hp-subtitle { font-size: 15px; color: rgba(255,255,255,0.45); font-weight: 500; margin-bottom: 16px; }

        .hp-badges { display: flex; justify-content: center; gap: 20px; }
        .hp-badge {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: rgba(255,255,255,0.35); font-weight: 600;
        }

        .hp-tabs {
          display: flex; gap: 4px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 4px;
          margin-bottom: 20px;
          animation: fadeUp 0.5s 0.1s ease-out both;
        }
        .hp-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 11px 8px; border-radius: 10px;
          border: none; cursor: pointer;
          font-size: 13px; font-weight: 700;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: all 0.25s ease;
          background: transparent; color: rgba(255,255,255,0.35);
        }
        .hp-tab.active {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff;
          box-shadow: 0 4px 20px rgba(99,102,241,0.35);
        }
        .hp-tab:not(.active):hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }

        .hp-section { animation: fadeUp 0.4s ease-out; }

        .hp-glass {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          overflow: hidden;
        }

        .hp-glass-header {
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; gap: 12px;
        }
        .hp-glass-icon {
          width: 36px; height: 36px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .hp-glass-title { font-size: 14px; font-weight: 700; color: #fff; }
        .hp-glass-desc { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 500; margin-top: 1px; }
        .hp-glass-body { padding: 20px; }

        .hp-plans-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          margin-bottom: 16px;
        }
        .hp-plans-grid.has-expanded {
          grid-template-columns: 1fr;
        }

        .hp-plan {
          position: relative; padding: 0; border: none; cursor: pointer;
          border-radius: 16px; overflow: hidden;
          text-align: left; font-family: 'Plus Jakarta Sans', sans-serif;
          color: #fff; transition: all 0.3s ease;
          background: rgba(255,255,255,0.05);
          border: 1.5px solid rgba(255,255,255,0.07);
        }
        .hp-plan:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.12); }
        .hp-plan.expanded { grid-column: 1 / -1; cursor: default; }
        .hp-plan.expanded:hover { transform: none; }
        .hp-plan.collapsed { display: none; }

        .hp-plan-accent { height: 4px; }
        .hp-plan-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0; cursor: pointer; }
        .hp-plan-body { padding: 6px 16px 16px; }

        .hp-plan-name {
          font-size: 10px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.08em; margin-bottom: 6px; opacity: 0.9;
        }
        .hp-plan-price {
          font-size: 30px; font-weight: 900; line-height: 1;
          margin-bottom: 12px; color: #fff;
        }
        .hp-plan-price span { font-size: 12px; font-weight: 500; opacity: 0.5; }

        .hp-plan-meta { display: flex; flex-direction: column; gap: 5px; }
        .hp-plan-meta-row {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.55);
        }

        .hp-plan-check {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .hp-plan-pay {
          margin-top: 14px; padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,0.06);
          animation: fadeUp 0.3s ease-out;
        }
        .hp-plan-pay .hp-input {
          background: rgba(0,0,0,0.2);
          border-color: rgba(255,255,255,0.1);
        }
        .hp-plan-change {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; color: rgba(255,255,255,0.4);
          font-size: 12px; font-weight: 600; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          padding: 0; margin-top: 10px;
          transition: color 0.2s;
        }
        .hp-plan-change:hover { color: rgba(255,255,255,0.7); }

        .hp-input-group { margin-bottom: 14px; }
        .hp-label {
          display: block; font-size: 12px; font-weight: 700;
          color: rgba(255,255,255,0.5); margin-bottom: 7px;
        }
        .hp-input-wrap { position: relative; }
        .hp-input-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: rgba(255,255,255,0.25); pointer-events: none;
        }
        .hp-input {
          width: 100%; padding: 13px 16px;
          background: rgba(255,255,255,0.05);
          border: 1.5px solid rgba(255,255,255,0.08);
          border-radius: 12px; color: #fff;
          font-size: 14px; font-weight: 600;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .hp-input:focus {
          border-color: rgba(99,102,241,0.5);
          box-shadow: 0 0 0 4px rgba(99,102,241,0.1);
        }
        .hp-input::placeholder { color: rgba(255,255,255,0.2); font-weight: 500; }
        .hp-input-left { padding-left: 42px; }
        .hp-input-phone { padding-left: 62px; }

        .hp-btn {
          width: 100%; padding: 14px; border: none; border-radius: 12px;
          font-size: 14px; font-weight: 800;
          font-family: 'Plus Jakarta Sans', sans-serif;
          cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.25s ease;
        }
        .hp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .hp-btn:not(:disabled):hover { transform: translateY(-1px); }

        .hp-btn-mpesa {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: #fff; box-shadow: 0 4px 24px rgba(22,163,74,0.35);
        }
        .hp-btn-primary {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff; box-shadow: 0 4px 24px rgba(99,102,241,0.35);
        }
        .hp-btn-voucher {
          background: linear-gradient(135deg, #f59e0b, #f97316);
          color: #fff; box-shadow: 0 4px 24px rgba(245,158,11,0.3);
        }
        .hp-btn-ghost {
          background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6);
          box-shadow: none; border: 1px solid rgba(255,255,255,0.08);
        }
        .hp-btn-disabled {
          background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.2);
          cursor: not-allowed; box-shadow: none;
        }

        .hp-error {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 11px 14px; border-radius: 12px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.15);
          font-size: 13px; color: #fca5a5; font-weight: 500;
          margin-bottom: 14px;
        }

        .hp-plan-inline-meta {
          display: flex; align-items: center; gap: 14px;
          flex-wrap: wrap;
        }
        .hp-plan-inline-meta .hp-plan-meta-row { flex-direction: row; }

        .hp-success { text-align: center; padding: 32px 20px; animation: fadeUp 0.4s ease-out; }
        .hp-success-icon {
          width: 72px; height: 72px; border-radius: 50%;
          background: rgba(52,211,153,0.1); border: 2px solid rgba(52,211,153,0.25);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          box-shadow: 0 0 32px rgba(52,211,153,0.15);
        }
        .hp-success h3 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
        .hp-success p { color: rgba(255,255,255,0.45); font-size: 14px; margin-bottom: 6px; }

        .hp-secured {
          display: flex; align-items: center; justify-content: center; gap: 5px;
          margin-top: 14px; font-size: 11px; color: rgba(255,255,255,0.2); font-weight: 500;
        }

        .hp-footer {
          text-align: center; margin-top: 32px;
          font-size: 11px; color: rgba(255,255,255,0.15); font-weight: 500;
        }

        .hp-connected-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2);
          border-radius: 100px; padding: 5px 14px; margin-bottom: 24px;
          font-size: 12px; font-weight: 700; color: #34d399;
        }

        .hp-voucher-hint {
          padding: 18px; border-radius: 14px;
          background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.1);
          text-align: center; margin-bottom: 16px;
        }

        .hp-voucher-input {
          text-align: center; font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 20px; letter-spacing: 0.15em; font-weight: 700;
          color: #fbbf24; padding: 16px;
          border-color: rgba(245,158,11,0.15);
        }
        .hp-voucher-input:focus { border-color: rgba(245,158,11,0.4); box-shadow: 0 0 0 4px rgba(245,158,11,0.08); }

        @media (max-width: 400px) {
          .hp-plans-grid { grid-template-columns: 1fr; }
          .hp-plan-price { font-size: 26px; }
          .hp-title { font-size: 26px; }
        }
      `}</style>

      <div className="hp-root">
        {/* Ambient background orbs */}
        <div className="hp-bg-orb" style={{ width: 400, height: 400, top: -100, left: -100, background: "rgba(99,102,241,0.12)" }} />
        <div className="hp-bg-orb" style={{ width: 350, height: 350, bottom: -80, right: -80, background: "rgba(139,92,246,0.08)", animationDelay: "4s" }} />
        <div className="hp-bg-orb" style={{ width: 250, height: 250, top: "40%", left: "60%", background: "rgba(236,72,153,0.06)", animationDelay: "2s" }} />

        {/* Header */}
        <header className="hp-header">
          <div className="hp-logo">
            <div className="hp-logo-icon">
              <Wifi size={18} color="#fff" strokeWidth={2.5} />
            </div>
            <div>
              <div className="hp-logo-text">{brand.ispName}</div>
              <div className="hp-logo-sub">{brand.domain}</div>
            </div>
          </div>
          <div className="hp-status">
            <span className="hp-status-dot" />
            Online
          </div>
        </header>

        {/* Main */}
        <main className="hp-main">
          {/* Hero */}
          <div className="hp-hero">
            <div className="hp-wifi-wrap">
              <div className="hp-wifi-box">
                <Wifi size={36} color="#a5b4fc" strokeWidth={2} />
              </div>
            </div>
            <h1 className="hp-title">Get Connected</h1>
            <p className="hp-subtitle">Fast & reliable Wi-Fi by {brand.ispName}</p>
            <div className="hp-badges">
              <span className="hp-badge"><Shield size={12} /> Secure</span>
              <span className="hp-badge"><Zap size={12} /> Instant</span>
              <span className="hp-badge"><Clock size={12} /> 24/7</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="hp-tabs">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`hp-tab${activeTab === tab.id ? " active" : ""}`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ── BUY DATA ── */}
          {activeTab === "plans" && (
            <div className="hp-section">
              {stkSent ? (
                <div className="hp-glass">
                  <div className="hp-success">
                    {paymentConfirmed ? (
                      <>
                        <div className="hp-success-icon">
                          <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                        </div>
                        <h3>Payment Confirmed!</h3>
                        <p>Your payment of <strong style={{ color: "#fff" }}>Ksh {selectedPlan?.price}</strong> has been received.</p>
                        <p style={{ fontSize: 12, marginBottom: 8 }}>You are now connected to the network.</p>
                        <div className="hp-connected-badge" style={{ marginTop: 16, marginBottom: 24 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                          Connected
                        </div>
                        {mpesaStatus?.shortcode && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16 }}>
                            Paybill: {mpesaStatus.shortcode} {mpesaStatus.env === "sandbox" ? "(Sandbox)" : ""}
                          </p>
                        )}
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); }}>
                          Done
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(99,102,241,0.1)", border: "2px solid rgba(99,102,241,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <Loader2 size={28} color="#818cf8" style={{ animation: "spin 1.5s linear infinite" }} />
                        </div>
                        <h3>Waiting for Payment</h3>
                        <p>An STK push has been sent to <strong style={{ color: "#fff" }}>{phone}</strong></p>
                        <p style={{ fontSize: 13, marginBottom: 4 }}>
                          Enter your M-Pesa PIN on your phone to pay <strong style={{ color: "#34d399" }}>Ksh {selectedPlan?.price}</strong>
                        </p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
                          {mpesaStatus?.shortcode && <>Paybill: {mpesaStatus.shortcode} &middot; </>}
                          {mpesaStatus?.env === "sandbox" ? "Sandbox Mode" : "Live Payment"}
                        </p>
                        {pollTimedOut ? (
                          <div style={{ padding: 14, borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", marginBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, textAlign: "center" }}>
                            <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                            <p style={{ margin: 0 }}>Payment not confirmed yet. If you already entered your PIN, it may take a moment to process.</p>
                            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Try again or contact support if the amount was deducted.</p>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 24, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                            <Loader2 size={12} style={{ animation: "spin 2s linear infinite" }} />
                            Checking payment status...
                          </div>
                        )}
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setPollTimedOut(false); }}>
                          {pollTimedOut ? "Try Again" : "Cancel & Start Over"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {plansLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                      <Loader2 size={28} color="#6366f1" style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  ) : plans.length === 0 ? (
                    <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: "48px 0", fontSize: 14 }}>
                      No plans available at the moment.
                    </p>
                  ) : (
                    <div className={`hp-plans-grid${selectedPlan ? " has-expanded" : ""}`}>
                      {plans.map((plan, i) => {
                        const grad = PLAN_GRADIENTS[i % PLAN_GRADIENTS.length];
                        const isExpanded = selectedPlan?.id === plan.id;
                        const isCollapsed = selectedPlan && !isExpanded;
                        return (
                          <div key={plan.id}
                            className={`hp-plan${isExpanded ? " expanded" : ""}${isCollapsed ? " collapsed" : ""}`}
                            style={isExpanded ? { borderColor: grad.light + "44", boxShadow: `0 4px 32px ${grad.light}15` } : {}}>

                            <div className="hp-plan-accent" style={{ background: grad.bg }} />

                            {isExpanded ? (
                              <div className="hp-plan-body">
                                <div className="hp-plan-top" onClick={() => setSelectedPlan(null)} style={{ padding: 0, marginBottom: 4 }}>
                                  <div>
                                    <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                    <div className="hp-plan-price" style={{ marginBottom: 6 }}>
                                      <span>Ksh </span>{plan.price}
                                    </div>
                                  </div>
                                  <div className="hp-plan-check" style={{ background: grad.bg }}>
                                    <CheckCircle2 size={12} color="#fff" strokeWidth={3} />
                                  </div>
                                </div>
                                <div className="hp-plan-inline-meta" style={{ marginBottom: 0 }}>
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>

                                <div className="hp-plan-pay">
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <Phone size={14} color="#22c55e" />
                                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Pay with M-Pesa</span>
                                    </div>
                                    {mpesaStatus && (
                                      <span style={{
                                        fontSize: 10, fontWeight: 700,
                                        padding: "3px 8px", borderRadius: 6,
                                        background: mpesaStatus.configured ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                                        color: mpesaStatus.configured ? "#34d399" : "#fca5a5",
                                        border: `1px solid ${mpesaStatus.configured ? "rgba(52,211,153,0.2)" : "rgba(239,68,68,0.2)"}`,
                                      }}>
                                        {mpesaStatus.configured
                                          ? mpesaStatus.env === "sandbox" ? "SANDBOX" : "LIVE"
                                          : "NOT CONFIGURED"}
                                      </span>
                                    )}
                                  </div>

                                  {mpesaStatus && !mpesaStatus.configured ? (
                                    <div style={{
                                      padding: 14, borderRadius: 10, textAlign: "center",
                                      background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
                                      fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
                                    }}>
                                      <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                                      <p style={{ margin: 0 }}>M-Pesa Daraja API not configured yet.</p>
                                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Admin needs to set Consumer Key, Secret, Shortcode &amp; Passkey in Settings.</p>
                                    </div>
                                  ) : (
                                    <form onSubmit={handlePay}>
                                      <div className="hp-input-group">
                                        <div className="hp-input-wrap">
                                          <span className="hp-input-icon" style={{ fontSize: 13, fontWeight: 700, left: 14 }}>+254</span>
                                          <input className="hp-input hp-input-phone" type="tel"
                                            placeholder="7XX XXX XXX" required
                                            value={phone} onChange={e => setPhone(e.target.value)} />
                                        </div>
                                      </div>

                                      {payError && (
                                        <div className="hp-error">
                                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                          {payError}
                                        </div>
                                      )}

                                      <button type="submit" disabled={payLoading} className="hp-btn hp-btn-mpesa">
                                        {payLoading ? (
                                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Sending STK Push...</>
                                        ) : (
                                          <><Phone size={16} /> Pay Ksh {plan.price}</>
                                        )}
                                      </button>
                                    </form>
                                  )}

                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                                    <div className="hp-secured" style={{ margin: 0 }}>
                                      <Shield size={11} />
                                      {mpesaStatus?.shortcode
                                        ? <>Paybill {mpesaStatus.shortcode} &middot; Safaricom Daraja</>
                                        : <>Secured by Safaricom M-Pesa</>
                                      }
                                    </div>
                                    <button className="hp-plan-change" onClick={() => { setSelectedPlan(null); setPhone(""); setPayError(null); }}>
                                      <ArrowRight size={12} style={{ transform: "rotate(180deg)" }} /> Change plan
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="hp-plan-body" onClick={() => { setSelectedPlan(plan); setPhone(""); setPayError(null); }} style={{ cursor: "pointer" }}>
                                <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                <div className="hp-plan-price">
                                  <span>Ksh </span>{plan.price}
                                </div>
                                <div className="hp-plan-meta">
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── LOGIN ── */}
          {activeTab === "login" && (
            <div className="hp-section">
              <div className="hp-glass">
                <div className="hp-glass-header">
                  <div className="hp-glass-icon" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
                    <User size={16} color="#818cf8" />
                  </div>
                  <div>
                    <div className="hp-glass-title">Member Login</div>
                    <div className="hp-glass-desc">Sign in with your credentials</div>
                  </div>
                </div>
                <div className="hp-glass-body">
                  {loginSuccess ? (
                    <div className="hp-success">
                      <div className="hp-success-icon">
                        <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                      </div>
                      <h3>Welcome, {loggedInName}!</h3>
                      <p style={{ marginBottom: 24 }}>You're now connected to the network.</p>
                      <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                        onClick={() => { setLoginSuccess(false); setLoginUsername(""); setLoginPassword(""); }}>
                        Sign Out
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleLogin}>
                      {loginError && (
                        <div className="hp-error">
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {loginError}
                        </div>
                      )}

                      <div className="hp-input-group">
                        <label className="hp-label">Username</label>
                        <div className="hp-input-wrap">
                          <User size={15} className="hp-input-icon" />
                          <input className="hp-input hp-input-left" type="text"
                            placeholder="Enter username" required
                            value={loginUsername} onChange={e => setLoginUsername(e.target.value)} />
                        </div>
                      </div>

                      <div className="hp-input-group">
                        <label className="hp-label">Password</label>
                        <div className="hp-input-wrap">
                          <Lock size={15} className="hp-input-icon" />
                          <input className="hp-input hp-input-left" type="password"
                            placeholder="Enter password" required
                            value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                        </div>
                      </div>

                      <button type="submit" disabled={loginLoading} className="hp-btn hp-btn-primary">
                        {loginLoading ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Connecting...</>
                        ) : (
                          <><Wifi size={16} /> Connect</>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── VOUCHER ── */}
          {activeTab === "voucher" && (
            <div className="hp-section">
              <div className="hp-glass">
                <div className="hp-glass-header">
                  <div className="hp-glass-icon" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    <Ticket size={16} color="#fbbf24" />
                  </div>
                  <div>
                    <div className="hp-glass-title">Redeem Voucher</div>
                    <div className="hp-glass-desc">Enter your voucher code below</div>
                  </div>
                </div>
                <div className="hp-glass-body">
                  {voucherSuccess ? (
                    <div className="hp-success">
                      <div className="hp-success-icon">
                        <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                      </div>
                      <h3>Voucher Activated!</h3>
                      {voucherInfo?.plan_name && (
                        <p>Plan: <strong style={{ color: "#fff" }}>{String(voucherInfo.plan_name)}</strong></p>
                      )}
                      {voucherInfo?.duration && (
                        <p style={{ marginBottom: 16 }}>Duration: <strong style={{ color: "#fff" }}>{String(voucherInfo.duration)}</strong></p>
                      )}
                      <div className="hp-connected-badge">
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                        Connected
                      </div>
                      <br />
                      <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                        onClick={() => { setVoucherSuccess(false); setVoucherCode(""); setVoucherInfo(null); }}>
                        Redeem Another
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleVoucher}>
                      <div className="hp-voucher-hint">
                        <Ticket size={20} color="#fbbf24" style={{ marginBottom: 6 }} />
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
                          Enter the code from your voucher card
                        </p>
                      </div>

                      {voucherError && (
                        <div className="hp-error">
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {voucherError}
                        </div>
                      )}

                      <div className="hp-input-group">
                        <input className="hp-input hp-voucher-input" type="text"
                          placeholder="XXXX-XXXX-XXXX" required
                          value={voucherCode} onChange={e => setVoucherCode(e.target.value.toUpperCase())} />
                      </div>

                      <button type="submit" disabled={voucherLoading} className="hp-btn hp-btn-voucher">
                        {voucherLoading ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Validating...</>
                        ) : (
                          <><ArrowRight size={16} /> Activate Voucher</>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="hp-footer">
            {new Date().getFullYear()} {brand.ispName} &middot; {brand.domain}
          </div>
        </main>
      </div>
    </>
  );
}
