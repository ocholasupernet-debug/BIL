import React, { useState, useEffect, useRef } from "react";
import {
  Wifi, Phone, Lock, Zap, CheckCircle2, Ticket,
  AlertCircle, User, Loader2, Shield, Clock,
  ArrowRight, ArrowUpRight, CreditCard, Tv, Sparkles,
} from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { getCurrencySymbol } from "@/lib/utils";

interface Plan {
  id: number; name: string; price: number;
  validity: number; validity_unit: string; validity_days: number;
  speed_down: number; speed_up: number;
  description: string | null; plan_type?: string; type?: string;
  router_id?: number | null; port_id?: number | null;
}
interface HotspotCredentials {
  username: string;
  password: string;
}
interface ConnectedDevice {
  name: string;
  macAddress: string;
  address: string;
  routerId: number;
  routerName: string;
}
type Tab = "plans" | "tv" | "login" | "voucher";

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

function normalizeMacAddress(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) && !/^[0-9a-f]{12}$/i.test(trimmed)) return "";
  const compact = trimmed.replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(compact)) return "";
  return compact.toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

function normalizeClientIp(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return "";
  const octets = trimmed.split(".").map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255) ? trimmed : "";
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

const PAYMENT_GATEWAY_LABELS: Record<string, string> = {
  mpesa_paybill: "M-Pesa PayBill",
  mpesa_till_push: "M-Pesa Till Push",
  bank_stk_push: "BankStkPush",
  airtel: "AirtelMoney",
  azampay: "AzamPay",
  custom_paybill: "CustomPaybill",
  dpo_payments: "DpoPayments",
  flutterwave: "Flutterwave",
  intasend: "Intasend",
  pesapal: "PesaPal",
  stripe: "Stripe",
  paypal: "PayPal",
  tigopesa: "TigoPesa",
  xendit: "XenditEwallet",
  manual: "Cash / Manual",
};

function isDarajaGateway(paymentGateway: string): boolean {
  return paymentGateway === "mpesa_paybill" || paymentGateway === "mpesa_till_push";
}

export default function HotspotLogin() {
  const brand = useBrand();
  const [activeTab, setActiveTab] = useState<Tab>("plans");

  const portalContext = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        mac: normalizeMacAddress(params.get("mac") ?? params.get("mac-address") ?? ""),
        ip: normalizeClientIp(params.get("ip") ?? ""),
        linkLogin: params.get("link-login-only") ?? params.get("link-login") ?? "",
        linkOrig: params.get("link-orig") ?? "",
      };
    } catch {
      return { mac: "", ip: "", linkLogin: "", linkOrig: "" };
    }
  })();

  const adminId: number | null = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qId = params.get("adminId") ?? params.get("ispId");
      const parsedId = qId ? parseInt(qId, 10) : NaN;
      return Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null;
    } catch { return null; }
  })();
  const portalScope = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const routerId = Number(params.get("routerId") ?? "");
      const portId = Number(params.get("portId") ?? "");
      return {
        routerId: Number.isSafeInteger(routerId) && routerId > 0 ? routerId : null,
        portId: Number.isSafeInteger(portId) && portId > 0 ? portId : null,
      };
    } catch {
      return { routerId: null, portId: null };
    }
  })();
  const planScopeQuery = [
    adminId ? `adminId=${encodeURIComponent(String(adminId))}` : "",
    portalScope.routerId ? `routerId=${encodeURIComponent(String(portalScope.routerId))}` : "",
    portalScope.portId ? `portId=${encodeURIComponent(String(portalScope.portId))}` : "",
  ].filter(Boolean).map(value => `&${value}`).join("");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentMode, setPaymentMode] = useState<"data" | "tv">("data");
  const [phone, setPhone] = useState("");
  const [deviceMacAddress, setDeviceMacAddress] = useState(portalContext.mac);
  const [deviceName, setDeviceName] = useState("");
  const [tvDialogOpen, setTvDialogOpen] = useState(false);
  const [tvDevices, setTvDevices] = useState<ConnectedDevice[]>([]);
  const [tvDevicesLoading, setTvDevicesLoading] = useState(false);
  const [tvDeviceChoice, setTvDeviceChoice] = useState("");
  const [tvMacAddress, setTvMacAddress] = useState(portalContext.mac);
  const [tvDeviceName, setTvDeviceName] = useState("");
  const [tvPlanId, setTvPlanId] = useState("");
  const [tvPhone, setTvPhone] = useState("");
  const [tvDialogError, setTvDialogError] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [stkSent, setStkSent] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [hotspotCredentials, setHotspotCredentials] = useState<HotspotCredentials | null>(null);
  const bindingInFlight = useRef(false);
  const [mpesaStatus, setMpesaStatus] = useState<{
    configured: boolean;
    env: string;
    shortcode: string;
    hasTillNumber: boolean;
    paymentGateway: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [plansRes, mpesaRes] = await Promise.all([
          fetch(`/api/plans?type=hotspot&activeOnly=true&purchasableOnly=true${planScopeQuery}`),
          fetch(`/api/settings/mpesa${adminId ? `?adminId=${encodeURIComponent(String(adminId))}` : ""}`).catch(() => null),
        ]);
        const plansData: Plan[] = await plansRes.json();
        setPlans(plansData);

        if (mpesaRes?.ok) {
          const mpesaData = await mpesaRes.json();
          setMpesaStatus({
            configured: mpesaData.configured,
            env: mpesaData.settings?.env ?? "sandbox",
            shortcode: mpesaData.settings?.shortcode ?? "",
            hasTillNumber: mpesaData.settings?.hasTillNumber === true,
            paymentGateway: typeof mpesaData.settings?.paymentGateway === "string" ? mpesaData.settings.paymentGateway : "mpesa_paybill",
          });
        }
      } catch { setPlans([]); }
      finally { setPlansLoading(false); }
    })();
  }, [adminId, planScopeQuery]);

  useEffect(() => {
    if (!tvDialogOpen) return;
    setTvDevicesLoading(true);
    setTvDialogError("");
    fetch(`/api/mpesa/hotspot-devices${adminId ? `?adminId=${encodeURIComponent(String(adminId))}` : ""}`)
      .then(async response => {
        const data = await response.json() as { ok?: boolean; devices?: ConnectedDevice[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "Connected devices could not be loaded.");
        setTvDevices(Array.isArray(data.devices) ? data.devices : []);
      })
      .catch(error => {
        setTvDevices([]);
        setTvDialogError(error instanceof Error ? error.message : "Connected devices could not be loaded.");
      })
      .finally(() => setTvDevicesLoading(false));
  }, [adminId, tvDialogOpen]);

  const [pollTimedOut, setPollTimedOut] = useState(false);

  useEffect(() => {
    if (!checkoutId || paymentConfirmed || paymentFailed) return;
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
        if (data.paid && !bindingInFlight.current) {
          bindingInFlight.current = true;
          const accessResponse = await fetch("/api/mpesa/hotspot-mac-access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              checkout_id: checkoutId,
              ...(adminId ? { adminId } : {}),
              mac_address: deviceMacAddress,
              device_name: deviceName,
              ...(portalContext.ip ? { client_ip: portalContext.ip } : {}),
            }),
          });
          const accessData = await accessResponse.json() as {
            ok?: boolean;
            error?: string;
            credentials?: HotspotCredentials;
          };
          if (accessResponse.ok && accessData.ok && accessData.credentials?.username && accessData.credentials.password) {
            setHotspotCredentials(accessData.credentials);
            setLoginUsername(accessData.credentials.username);
            setLoginPassword(accessData.credentials.password);
            setAccessReady(true);
            setPaymentConfirmed(true);
            clearInterval(interval);
          } else {
            setPayError(accessData.error || "Payment confirmed, but hotspot credentials could not be assigned yet.");
            bindingInFlight.current = false;
          }
        } else if (data.status === "failed") {
          setPayError(data.failureReason || "M-Pesa cancelled or declined the payment prompt.");
          setPaymentFailed(true);
          clearInterval(interval);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [checkoutId, paymentConfirmed, deviceMacAddress, deviceName, adminId]);

  useEffect(() => {
    if (!accessReady) return;
    const destination = portalContext.linkLogin || portalContext.linkOrig;
    if (!/^https?:\/\//i.test(destination) || !hotspotCredentials) {
      setActiveTab("login");
      return;
    }
    const destinationWithoutHash = destination.split("#", 1)[0];
    const credentialHash = new URLSearchParams({
      hotspot_username: hotspotCredentials.username,
      hotspot_password: hotspotCredentials.password,
    }).toString();
    const redirectTimer = window.setTimeout(
      () => window.location.assign(`${destinationWithoutHash}#${credentialHash}`),
      1200,
    );
    return () => window.clearTimeout(redirectTimer);
  }, [accessReady, hotspotCredentials]);

  const startPayment = async (options: {
    plan: Plan;
    phoneValue: string;
    macValue: string;
    deviceNameValue?: string;
    deviceRouterId?: number;
  }) => {
    const { plan, phoneValue, macValue, deviceNameValue = "", deviceRouterId } = options;
    const macAddress = normalizeMacAddress(macValue);
    const normalizedDeviceName = deviceNameValue.trim().replace(/\s+/g, " ").slice(0, 64);
    setSelectedPlan(plan);
    setPhone(phoneValue);
    setDeviceMacAddress(macAddress);
    setDeviceName(normalizedDeviceName);
    setPayLoading(true); setPayError(null); setPaymentFailed(false); setPaymentConfirmed(false); setAccessReady(false); setHotspotCredentials(null); setPollTimedOut(false);
    bindingInFlight.current = false;
    try {
      const intentResponse = await fetch("/api/mpesa/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneValue.trim(),
          plan_id: plan.id,
          ...(adminId ? { adminId } : {}),
          ...(macAddress ? { mac_address: macAddress } : {}),
          ...(normalizedDeviceName ? { device_name: normalizedDeviceName } : {}),
          ...(deviceRouterId ? { device_router_id: deviceRouterId } : {}),
          ...(portalContext.ip ? { client_ip: portalContext.ip } : {}),
        }),
      });
      const intentData = await intentResponse.json() as { ok?: boolean; error?: string; paymentIntent?: string; amount?: number; deviceMacAddress?: string };
      if (!intentResponse.ok || !intentData.ok || !intentData.paymentIntent || !intentData.amount) {
        setPayError(intentData.error ?? "Could not start a secure payment checkout. Please try again.");
        return;
      }
      if (intentData.deviceMacAddress) setDeviceMacAddress(intentData.deviceMacAddress);
      const res = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneValue.trim(),
          amount: intentData.amount,
          plan_id: plan.id,
          ...(adminId ? { adminId } : {}),
          account_ref: brand.ispName,
          paymentIntent: intentData.paymentIntent,
          ...(macAddress ? { mac_address: macAddress } : {}),
          ...(normalizedDeviceName ? { device_name: normalizedDeviceName } : {}),
        }),
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

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !phone.trim()) return;
    await startPayment({
      plan: selectedPlan,
      phoneValue: phone.trim(),
      macValue: deviceMacAddress,
      deviceNameValue: deviceName,
    });
  };

  const openTvDialog = () => {
    setTvDialogOpen(true);
    setTvDialogError("");
    setTvDeviceChoice("");
    setTvMacAddress(deviceMacAddress || portalContext.mac);
    setTvDeviceName("");
    setTvPlanId(selectedPlan ? String(selectedPlan.id) : plans[0] ? String(plans[0].id) : "");
    setTvPhone("");
  };

  const handleTvDeviceChoice = (value: string) => {
    setTvDeviceChoice(value);
    const device = tvDevices.find(item => item.macAddress === value);
    if (device) {
      setTvMacAddress(device.macAddress);
      setTvDeviceName(device.name);
    }
  };

  const handleTvBindPay = async (e: React.FormEvent) => {
    e.preventDefault();
    const plan = plans.find(item => String(item.id) === tvPlanId);
    const macAddress = normalizeMacAddress(tvMacAddress);
    if (!plan) {
      setTvDialogError("Choose a package before continuing.");
      return;
    }
    if (!macAddress) {
      setTvDialogError("Enter a valid TV MAC address, for example AA:BB:CC:DD:EE:FF.");
      return;
    }
    if (!tvDeviceName.trim()) {
      setTvDialogError("Give the device a name so you can recognize it later.");
      return;
    }
    if (!tvPhone.trim()) {
      setTvDialogError("Enter the phone number that will receive the M-Pesa prompt.");
      return;
    }
    setActiveTab("tv");
    setPaymentMode("tv");
    setTvDialogOpen(false);
    await startPayment({
      plan,
      phoneValue: tvPhone.trim(),
      macValue: macAddress,
      deviceNameValue: tvDeviceName,
      deviceRouterId: tvDevices.find(item => item.macAddress === macAddress)?.routerId,
    });
  };

  const handleTabChange = (tab: Tab) => {
    if (stkSent) return;
    if (tab === "tv") {
      openTvDialog();
      return;
    }
    setActiveTab(tab);
    setSelectedPlan(null);
    setPhone("");
    setPayError(null);
    if (tab === "plans") setPaymentMode("data");
  };

  const selectPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    setPaymentMode(activeTab === "tv" ? "tv" : "data");
    setPhone("");
    setPayError(null);
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
        body: JSON.stringify({ ...(adminId ? { adminId } : {}), username: loginUsername, password: loginPassword }),
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
        body: JSON.stringify({ ...(adminId ? { adminId } : {}), code: voucherCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) setVoucherError(data.error ?? "Voucher redemption failed");
      else { setVoucherInfo(data.voucher); setVoucherSuccess(true); }
    } catch { setVoucherError("Could not reach the server. Please try again."); }
    finally { setVoucherLoading(false); }
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "plans", label: "Buy Data", icon: <CreditCard size={16} /> },
    { id: "tv", label: "Buy for TV", icon: <Tv size={16} /> },
    { id: "login", label: "Login", icon: <User size={16} /> },
    { id: "voucher", label: "Voucher", icon: <Ticket size={16} /> },
  ];
  const isTvMode = paymentMode === "tv";
  const voucherPlanName = voucherInfo?.plan_name == null ? "" : String(voucherInfo.plan_name);
  const voucherDuration = voucherInfo?.duration == null ? "" : String(voucherInfo.duration);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

        .hp-root {
          min-height: 100vh;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
           /* The portal uses a dark glass layout even when the admin app is
              in its light theme. Keep its contrast self-contained so plan
              names and prices do not render white-on-white. */
           background:
             radial-gradient(circle at 50% -10%, var(--isp-accent-glow), transparent 34%),
             radial-gradient(circle at 100% 70%, rgba(14,165,233,0.09), transparent 28%),
             #02090f;
          color: #fff;
          overflow-x: hidden;
          position: relative;
           isolation: isolate;
        }

         .hp-root::before {
           content: "";
           position: absolute; inset: 0; z-index: -1; pointer-events: none;
           opacity: 0.35;
           background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
             linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
           background-size: 42px 42px;
           mask-image: linear-gradient(to bottom, black, transparent 80%);
         }

         .hp-bg-orb {
           position: absolute; border-radius: 50%; filter: blur(2px);
           opacity: 0.6; pointer-events: none; z-index: -1;
           animation: float 7s ease-in-out infinite;
         }

        .hp-header {
          position: sticky; top: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
           padding: 0 max(20px, calc((100vw - 1120px) / 2)); height: 72px;
           background: rgba(3,11,20,0.72);
          backdrop-filter: blur(24px);
           border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .hp-logo { display: flex; align-items: center; gap: 12px; }
         .hp-logo-image { width: 128px; height: 54px; object-fit: contain; flex: 0 0 auto; display: block; }
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
           max-width: 720px; margin: 0 auto;
           padding: 54px 20px 72px;
        }

         .hp-hero { text-align: center; margin-bottom: 32px; animation: fadeUp 0.5s ease-out; }

        .hp-wifi-wrap {
           position: relative; width: 104px; height: 104px;
           margin: 0 auto 24px;
        }
         .hp-wifi-wrap::before, .hp-wifi-wrap::after {
           content: ""; position: absolute; border: 1px solid var(--isp-accent-border);
           border-radius: 50%; inset: -12px; opacity: 0.55;
         }
         .hp-wifi-wrap::after { inset: -24px; opacity: 0.18; }
        .hp-wifi-box {
           width: 104px; height: 104px; border-radius: 30px;
           background: linear-gradient(145deg, var(--isp-accent-glow), rgba(14,165,233,0.12));
          border: 1.5px solid var(--isp-accent-border);
          display: flex; align-items: center; justify-content: center;
          position: relative; z-index: 2;
          animation: float 5s ease-in-out infinite;
        }

        .hp-title {
           font-size: clamp(34px, 7vw, 48px); font-weight: 900; color: #fff;
          letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 8px;
           background: linear-gradient(135deg, #fff 20%, #b9d9ff 80%);
           -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
         .hp-subtitle { max-width: 440px; margin: 0 auto 18px; font-size: 15px; color: rgba(255,255,255,0.52); font-weight: 500; line-height: 1.6; }

         .hp-badges { display: flex; justify-content: center; gap: 22px; flex-wrap: wrap; }
        .hp-badge {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: rgba(255,255,255,0.35); font-weight: 600;
        }

        .hp-tabs {
           display: flex; gap: 4px;
           background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 4px;
           margin-bottom: 22px;
          animation: fadeUp 0.5s 0.1s ease-out both;
           box-shadow: 0 16px 40px rgba(0,0,0,0.18);
        }
        .hp-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 11px 8px; border-radius: 10px;
          border: none; cursor: pointer;
           font-size: 12px; font-weight: 700;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: all 0.25s ease;
          background: transparent; color: rgba(255,255,255,0.35);
        }
        .hp-tab.active {
          background: var(--isp-accent);
          color: #fff;
        }
        .hp-tab:not(.active):hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }
         .hp-tab:disabled { cursor: not-allowed; opacity: 0.65; }

        .hp-section { animation: fadeUp 0.4s ease-out; }

        .hp-glass {
           background: linear-gradient(145deg, rgba(255,255,255,0.065), rgba(255,255,255,0.025));
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          overflow: hidden;
           box-shadow: 0 24px 70px rgba(0,0,0,0.16);
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

         .hp-purchase-hero {
           display: flex; align-items: center; justify-content: space-between; gap: 20px;
           padding: 22px; margin-bottom: 14px; border-radius: 20px;
           background: linear-gradient(135deg, var(--isp-accent-glow), rgba(14,165,233,0.05));
           border: 1px solid var(--isp-accent-border);
           color: #fff;
         }
         .hp-kicker {
           color: var(--isp-accent); font-size: 10px; font-weight: 800;
           text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 7px;
         }
         .hp-purchase-title { color: #fff; font-size: 22px; line-height: 1.2; font-weight: 850; margin-bottom: 7px; }
         .hp-purchase-copy { color: rgba(255,255,255,0.5); font-size: 12px; line-height: 1.6; max-width: 480px; }
         .hp-purchase-icon {
           width: 58px; height: 58px; flex: 0 0 58px; border-radius: 18px;
           display: flex; align-items: center; justify-content: center;
           color: var(--isp-accent); background: rgba(255,255,255,0.1);
           border: 1px solid rgba(255,255,255,0.12);
         }
         .hp-trust-row {
           display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px;
         }
         .hp-trust-item {
           display: flex; align-items: center; gap: 8px; min-width: 0;
           padding: 10px 11px; border-radius: 12px;
           color: rgba(255,255,255,0.48); background: rgba(255,255,255,0.03);
           border: 1px solid rgba(255,255,255,0.05); font-size: 11px; font-weight: 700;
         }
         .hp-trust-item svg { color: #34d399; flex-shrink: 0; }

         .hp-device-card {
           display: flex; align-items: center; gap: 10px; min-width: 0;
           padding: 11px 12px; margin-bottom: 14px; border-radius: 12px;
           background: rgba(14,165,233,0.06);
           border: 1px solid rgba(14,165,233,0.16);
         }
         .hp-device-icon {
           width: 32px; height: 32px; flex: 0 0 32px; border-radius: 9px;
           display: flex; align-items: center; justify-content: center;
           color: #67e8f9; background: rgba(14,165,233,0.12);
         }
         .hp-device-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
         .hp-device-kicker {
           color: rgba(255,255,255,0.38); font-size: 9px; font-weight: 800;
           letter-spacing: 0.12em; text-transform: uppercase;
         }
         .hp-device-copy strong {
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
           color: #fff; font-family: 'JetBrains Mono', 'Fira Code', monospace;
           font-size: 12px; letter-spacing: 0.04em;
         }
         .hp-device-copy small { color: rgba(255,255,255,0.34); font-size: 10px; }
         .hp-device-state {
           display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
           flex: 0 0 auto; color: #34d399; font-size: 10px; font-weight: 800;
         }
         .hp-tv-trigger {
           display: inline-flex; align-items: center; justify-content: center; gap: 8px;
           margin-top: 14px; padding: 11px 16px; border-radius: 11px;
           border: 1px solid var(--isp-accent-border); background: var(--isp-accent-glow);
           color: #fff; font: 800 12px 'Plus Jakarta Sans', sans-serif; cursor: pointer;
           transition: transform .2s ease, background .2s ease;
         }
         .hp-tv-trigger:hover { transform: translateY(-1px); background: var(--isp-accent-border); }
         .hp-modal-backdrop {
           position: fixed; inset: 0; z-index: 100; display: flex; align-items: center;
           justify-content: center; padding: 18px; background: rgba(0,5,12,.78);
           backdrop-filter: blur(12px);
         }
         .hp-tv-modal {
           width: min(100%, 520px); max-height: min(760px, calc(100vh - 36px)); overflow: auto;
           border: 1px solid rgba(255,255,255,.12); border-radius: 22px;
           background: linear-gradient(145deg, #0b1a29, #07111d);
           box-shadow: 0 30px 90px rgba(0,0,0,.5); color: #fff;
         }
         .hp-tv-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:22px 22px 16px; border-bottom:1px solid rgba(255,255,255,.07); }
         .hp-tv-modal-head h3 { font-size:18px; font-weight:850; margin-bottom:5px; }
         .hp-tv-modal-head p { color:rgba(255,255,255,.46); font-size:12px; line-height:1.5; }
         .hp-tv-modal-close { border:0; background:rgba(255,255,255,.06); color:rgba(255,255,255,.7); width:32px; height:32px; border-radius:9px; cursor:pointer; font-size:20px; line-height:1; }
         .hp-tv-modal-body { padding:20px 22px 22px; }
         .hp-tv-field { margin-bottom:15px; }
         .hp-tv-label { display:block; margin-bottom:7px; color:rgba(255,255,255,.56); font-size:11px; font-weight:800; letter-spacing:.04em; }
         .hp-tv-select, .hp-tv-input { width:100%; border:1px solid rgba(255,255,255,.1); border-radius:11px; padding:12px 13px; color:#fff; background:rgba(255,255,255,.055); font:600 13px 'Plus Jakarta Sans', sans-serif; outline:none; }
         .hp-tv-select:focus, .hp-tv-input:focus { border-color:var(--isp-accent-border); box-shadow:0 0 0 3px var(--isp-accent-glow); }
         .hp-tv-select option { color:#0b1420; background:#fff; }
         .hp-tv-help { margin-top:6px; color:rgba(255,255,255,.3); font-size:10px; line-height:1.45; }
         .hp-tv-device-list { display:grid; gap:7px; margin-top:9px; max-height:130px; overflow:auto; }
         .hp-tv-device-row { display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:10px; background:rgba(52,211,153,.06); border:1px solid rgba(52,211,153,.14); }
         .hp-tv-device-row strong { display:block; font-size:11px; color:#fff; }
         .hp-tv-device-row span { display:block; margin-top:2px; color:rgba(255,255,255,.42); font:10px monospace; }
         .hp-tv-actions { display:flex; gap:9px; margin-top:20px; }
         .hp-tv-actions .hp-btn { flex:1; }
         .hp-tv-cancel { background:rgba(255,255,255,.06); color:rgba(255,255,255,.65); border:1px solid rgba(255,255,255,.1); box-shadow:none; }

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
           background: rgba(255,255,255,0.045);
          border: 1.5px solid rgba(255,255,255,0.07);
           box-shadow: 0 10px 28px rgba(0,0,0,0.1);
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
         .hp-plan-action {
           display: flex; align-items: center; justify-content: space-between;
           margin-top: 16px; padding-top: 12px;
           border-top: 1px solid rgba(255,255,255,0.06);
           color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 700;
         }
         .hp-plan-action svg { color: rgba(255,255,255,0.55); transition: transform 0.2s ease; }
         .hp-plan:hover .hp-plan-action svg { transform: translate(2px, -2px); color: #fff; }

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
          border-color: var(--isp-accent-border);
          box-shadow: 0 0 0 4px var(--isp-accent-glow);
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
          background: var(--isp-accent);
          color: #fff; box-shadow: 0 4px 24px var(--isp-accent-border);
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
           text-align: center; margin-top: 38px;
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
         @media (max-width: 560px) {
           .hp-header { padding: 0 14px; }
           .hp-logo-sub { display: none; }
           .hp-status { padding: 6px 10px; }
           .hp-main { padding: 42px 14px 56px; }
           .hp-tabs { gap: 2px; }
           .hp-tab { padding: 10px 4px; font-size: 10px; gap: 4px; }
           .hp-tab svg { width: 14px; height: 14px; }
           .hp-purchase-hero { padding: 18px; }
           .hp-purchase-title { font-size: 19px; }
           .hp-purchase-icon { width: 48px; height: 48px; flex-basis: 48px; border-radius: 15px; }
           .hp-trust-row { grid-template-columns: 1fr; }
            .hp-device-state { display: none; }
         }
      `}</style>

      <div className="hp-root">
        {/* Ambient background orbs */}
        <div className="hp-bg-orb" style={{ width: 400, height: 400, top: -100, left: -100, background: "var(--isp-accent-glow)" }} />
        <div className="hp-bg-orb" style={{ width: 350, height: 350, bottom: -80, right: -80, background: "var(--isp-accent-glow)", animationDelay: "4s" }} />
        <div className="hp-bg-orb" style={{ width: 250, height: 250, top: "40%", left: "60%", background: "rgba(236,72,153,0.06)", animationDelay: "2s" }} />

        {/* Header */}
        <header className="hp-header">
          <div className="hp-logo">
            <img className="hp-logo-image" src="/ocholasupernet-logo.png" alt={brand.ispName} />
            <div>
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
                <Wifi size={36} color="var(--isp-accent)" strokeWidth={2} />
              </div>
            </div>
             <h1 className="hp-title">Your world, connected.</h1>
             <p className="hp-subtitle">Fast, reliable internet for your phone, home and TV — powered by {brand.ispName}.</p>
            <div className="hp-badges">
              <span className="hp-badge"><Shield size={12} /> Secure</span>
              <span className="hp-badge"><Zap size={12} /> Instant</span>
              <span className="hp-badge"><Clock size={12} /> 24/7</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="hp-tabs">
            {TABS.map(tab => (
               <button key={tab.id} onClick={() => handleTabChange(tab.id)} disabled={stkSent}
                 className={`hp-tab${activeTab === tab.id ? " active" : ""}`} aria-pressed={activeTab === tab.id}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ── BUY DATA ── */}
           {(activeTab === "plans" || activeTab === "tv") && (
            <div className="hp-section">
              {stkSent ? (
                <div className="hp-glass">
                  <div className="hp-success">
                    {paymentConfirmed ? (
                      <>
                        <div className="hp-success-icon">
                          <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                        </div>
                          <h3>{accessReady ? (isTvMode ? "TV is ready to stream!" : "Device connected!") : "Payment Confirmed"}</h3>
                         <p>Your payment of <strong style={{ color: "#fff" }}>{getCurrencySymbol()} {selectedPlan?.price}</strong> has been received.</p>
                          <p style={{ fontSize: 12, marginBottom: 8 }}>{accessReady ? "Your device has been authorized by the hotspot. Use the credentials below for the next sign-in." : "Your payment is confirmed, but the hotspot still needs to be updated."}</p>
                          {hotspotCredentials && (
                            <div style={{ display: "grid", gap: 8, textAlign: "left", margin: "0 auto 16px", maxWidth: 320 }}>
                              <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: ".08em" }}>Username</div>
                                <strong style={{ color: "#fff", fontSize: 14 }}>{hotspotCredentials.username}</strong>
                              </div>
                              <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: ".08em" }}>Password</div>
                                <strong style={{ color: "#fff", fontSize: 14 }}>{hotspotCredentials.password}</strong>
                              </div>
                            </div>
                          )}
                        <div className="hp-connected-badge" style={{ marginTop: 16, marginBottom: 24 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                            {accessReady ? "Connected" : "Payment received"}
                        </div>
                          {!accessReady && payError && (
                            <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 16 }}>{payError}</p>
                          )}
                        {mpesaStatus?.shortcode && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16 }}>
                            Daraja shortcode: {mpesaStatus.shortcode} {mpesaStatus.env === "sandbox" ? "(Sandbox)" : ""}
                          </p>
                        )}
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => {
                            const destination = portalContext.linkOrig || portalContext.linkLogin;
                            if (accessReady && /^https?:\/\//i.test(destination)) window.location.assign(destination);
                            else { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setAccessReady(false); bindingInFlight.current = false; }
                          }}>
                          {accessReady ? "Continue online" : "Start over"}
                        </button>
                      </>
                    ) : paymentFailed ? (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "2px solid rgba(245,158,11,0.22)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <AlertCircle size={30} color="#fbbf24" strokeWidth={2} />
                        </div>
                        <h3>Payment Not Completed</h3>
                        <p>The M-Pesa prompt was cancelled or declined. No payment was confirmed and your plan has not been activated.</p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 20 }}>Check M-Pesa before retrying if you believe the amount was deducted.</p>
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          Try Again
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--isp-accent-glow)", border: "2px solid var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1.5s linear infinite" }} />
                        </div>
                        <h3>{payError ? "Connecting your device" : "Waiting for Payment"}</h3>
                        <p>An STK push has been sent to <strong style={{ color: "#fff" }}>{phone}</strong></p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 13, marginBottom: 4 }}>
                          Enter your PIN on your phone to pay <strong style={{ color: "#34d399" }}>{getCurrencySymbol()} {selectedPlan?.price}</strong>
                        </p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
                          {mpesaStatus?.shortcode && <>Daraja shortcode: {mpesaStatus.shortcode} &middot; </>}
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
                           onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          {pollTimedOut ? "Try Again" : "Cancel & Start Over"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                   ) : (
                <>
                   <div className="hp-purchase-hero">
                     <div>
                       <div className="hp-kicker">{isTvMode ? "TV CONNECT" : "HOTSPOT ACCESS"}</div>
                       <h2 className="hp-purchase-title">{isTvMode ? "Bring streaming to life." : "Pick your perfect plan."}</h2>
                       <p className="hp-purchase-copy">{isTvMode ? "Choose a plan for your smart TV or streaming device. Pay from your phone and connect instantly." : "Simple packages, instant activation, and no contracts. Choose a plan and get online in seconds."}</p>
                     </div>
                     <div className="hp-purchase-icon">
                       {isTvMode ? <Tv size={27} strokeWidth={1.8} /> : <Sparkles size={27} strokeWidth={1.8} />}
                     </div>
                   </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                      <button type="button" className="hp-tv-trigger" onClick={openTvDialog}>
                        <Tv size={15} /> Connect to TV
                      </button>
                    </div>
                   <div className="hp-trust-row">
                     <div className="hp-trust-item"><CheckCircle2 size={14} /> Instant access</div>
                     <div className="hp-trust-item"><Shield size={14} /> Secure payment</div>
                     <div className="hp-trust-item"><Zap size={14} /> No contracts</div>
                   </div>
                  {plansLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                      <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1s linear infinite" }} />
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
                                      <span>{getCurrencySymbol()} </span>{plan.price}
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
                                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                                        {isTvMode ? "Pay for TV with M-Pesa" : "Pay with M-Pesa"}
                                      </span>
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

                                   {mpesaStatus && (!mpesaStatus.configured || !isDarajaGateway(mpesaStatus.paymentGateway) || (mpesaStatus.paymentGateway === "mpesa_till_push" && !mpesaStatus.hasTillNumber)) ? (
                                    <div style={{
                                      padding: 14, borderRadius: 10, textAlign: "center",
                                      background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
                                      fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
                                    }}>
                                      <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                                       <p style={{ margin: 0 }}>{!isDarajaGateway(mpesaStatus.paymentGateway) ? `${PAYMENT_GATEWAY_LABELS[mpesaStatus.paymentGateway] || "Selected payment gateway"} is not connected for automated payments yet.` : mpesaStatus.paymentGateway === "mpesa_till_push" && !mpesaStatus.hasTillNumber ? "M-Pesa Till Push is not configured yet." : "M-Pesa Daraja API is not configured yet."}</p>
                                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{!isDarajaGateway(mpesaStatus.paymentGateway) ? "Choose a connected payment gateway to continue." : "Complete the required M-Pesa connection settings to continue."}</p>
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
                                           <><Phone size={16} /> Pay {getCurrencySymbol()} {plan.price}{isTvMode ? " for TV" : ""}</>
                                        )}
                                      </button>
                                    </form>
                                  )}

                                     <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                                    <div className="hp-secured" style={{ margin: 0 }}>
                                      <Shield size={11} />
                                        {!isDarajaGateway(mpesaStatus?.paymentGateway || "")
                                          ? <>{PAYMENT_GATEWAY_LABELS[mpesaStatus?.paymentGateway || ""] || "Payment gateway"} selected</>
                                          : mpesaStatus?.paymentGateway === "mpesa_till_push" && mpesaStatus.hasTillNumber
                                         ? <>Buy Goods &amp; Services Till &middot; Safaricom Daraja</>
                                         : mpesaStatus?.shortcode
                                          ? <>Daraja shortcode {mpesaStatus.shortcode} &middot; Safaricom Daraja</>
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
                             <div className="hp-plan-body" onClick={() => selectPlan(plan)} style={{ cursor: "pointer" }}>
                                <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                <div className="hp-plan-price">
                                  <span>{getCurrencySymbol()} </span>{plan.price}
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
                                 <div className="hp-plan-action">
                                   <span>{isTvMode ? "Choose for TV" : "Choose plan"}</span>
                                   <ArrowUpRight size={15} />
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
                  <div className="hp-glass-icon" style={{ background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)" }}>
                    <User size={16} color="var(--isp-accent)" />
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
                      {voucherPlanName && (
                        <p>Plan: <strong style={{ color: "#fff" }}>{voucherPlanName}</strong></p>
                      )}
                      {voucherDuration && (
                        <p style={{ marginBottom: 16 }}>Duration: <strong style={{ color: "#fff" }}>{voucherDuration}</strong></p>
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

          {tvDialogOpen && (
            <div className="hp-modal-backdrop" role="presentation">
              <div className="hp-tv-modal" role="dialog" aria-modal="true" aria-labelledby="connect-tv-title">
                <div className="hp-tv-modal-head">
                  <div>
                    <h3 id="connect-tv-title">Connect to TV</h3>
                    <p>Add a TV or streaming device, choose its package, and pay securely with M-Pesa.</p>
                  </div>
                  <button type="button" className="hp-tv-modal-close" onClick={() => setTvDialogOpen(false)} aria-label="Close">×</button>
                </div>
                <form className="hp-tv-modal-body" onSubmit={handleTvBindPay}>
                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-connected-device">CONNECTED DEVICES</label>
                    <select
                      id="tv-connected-device"
                      className="hp-tv-select"
                      value={tvDeviceChoice}
                      onChange={e => handleTvDeviceChoice(e.target.value)}
                    >
                      <option value="">Enter a MAC address manually</option>
                      {tvDevices.map(device => (
                        <option key={`${device.routerId}-${device.macAddress}`} value={device.macAddress}>
                          {device.name} — {device.macAddress}
                        </option>
                      ))}
                    </select>
                    <div className="hp-tv-help">
                      {tvDevicesLoading
                        ? "Checking the connected devices on your hotspot router…"
                        : tvDevices.length > 0
                          ? "Choose a named connected device, or enter another TV MAC address below."
                          : "No named connected devices were found. Enter the TV MAC address below."}
                    </div>
                    {!tvDevicesLoading && tvDevices.length > 0 && (
                      <div className="hp-tv-device-list" aria-label="Available connected devices">
                        {tvDevices.map(device => (
                          <div className="hp-tv-device-row" key={`device-${device.routerId}-${device.macAddress}`}>
                            <Tv size={14} color="#34d399" />
                            <div>
                              <strong>{device.name}</strong>
                              <span>{device.macAddress}{device.routerName ? ` · ${device.routerName}` : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-mac-address">DEVICE MAC ADDRESS</label>
                    <input
                      id="tv-mac-address"
                      className="hp-tv-input"
                      value={tvMacAddress}
                      onChange={e => setTvMacAddress(e.target.value.toUpperCase())}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      inputMode="text"
                      autoCapitalize="characters"
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-device-name">DEVICE NAME</label>
                    <input
                      id="tv-device-name"
                      className="hp-tv-input"
                      value={tvDeviceName}
                      onChange={e => setTvDeviceName(e.target.value)}
                      placeholder="e.g. Living Room TV"
                      maxLength={64}
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-package">PACKAGE TO PURCHASE</label>
                    <select
                      id="tv-package"
                      className="hp-tv-select"
                      value={tvPlanId}
                      onChange={e => setTvPlanId(e.target.value)}
                      required
                    >
                      <option value="" disabled>Choose a package</option>
                      {plans.map(plan => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — {getCurrencySymbol()} {plan.price} · {formatValidity(plan)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-phone">PHONE NUMBER</label>
                    <input
                      id="tv-phone"
                      className="hp-tv-input"
                      type="tel"
                      value={tvPhone}
                      onChange={e => setTvPhone(e.target.value)}
                      placeholder="7XX XXX XXX"
                      inputMode="tel"
                      required
                    />
                    <div className="hp-tv-help">The M-Pesa payment prompt will be sent to this number.</div>
                  </div>

                  {tvDialogError && (
                    <div className="hp-error" role="alert">
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {tvDialogError}
                    </div>
                  )}

                  <div className="hp-tv-actions">
                    <button type="button" className="hp-btn hp-tv-cancel" onClick={() => setTvDialogOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="hp-btn hp-btn-mpesa" disabled={payLoading || plansLoading}>
                      {payLoading ? (
                        <><Loader2 size={16} style={{ animation: "spin 1.5s linear infinite" }} /> Starting…</>
                      ) : (
                        <><Tv size={16} /> Bind &amp; Pay</>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div style={{ padding: "0 0 16px", textAlign: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
              Your MAC address:
              <strong style={{ color: "rgba(255,255,255,0.78)", fontFamily: "monospace", fontWeight: 700 }}>
                {deviceMacAddress || "Resolved by router"}
              </strong>
            </span>
          </div>
          <div className="hp-footer">
            {new Date().getFullYear()} {brand.ispName} &middot; {brand.domain}
          </div>
        </main>
      </div>
    </>
  );
}
