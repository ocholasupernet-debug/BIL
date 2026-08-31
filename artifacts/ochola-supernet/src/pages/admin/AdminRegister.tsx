import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Building2, Phone, ArrowRight, CheckCircle2, XCircle, Loader2, AlertTriangle, ShieldCheck, Router, CreditCard, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

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

const RESERVED_SUBDOMAINS = new Set(["www", "api", "vpn", "register", "latex", "proxyvpn", "mail", "admin"]);

interface RegistrationDestination {
  type: "bank" | "till" | "paybill";
  name: string;
  number: string;
  accountReference?: string;
  instructions?: string;
}

export default function AdminRegister() {
  const [, setLocation] = useLocation();

  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");

  const [checkingCompany, setCheckingCompany] = useState(false);
  const [companyAvailable, setCompanyAvailable] = useState<boolean | null>(null);
  const companyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState<boolean | null>(null);
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [registeredUsername, setRegisteredUsername] = useState("");
  const [registeredSubdomain, setRegisteredSubdomain] = useState("");
  const [serverErr, setServerErr] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkoutId, setCheckoutId] = useState("");
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [registrationFee, setRegistrationFee] = useState({ amount: 500, currency: "KES" });
  const [registrationDestination, setRegistrationDestination] = useState<RegistrationDestination | null>(null);
  const [manualPayment, setManualPayment] = useState<RegistrationDestination | null>(null);

  useEffect(() => {
    setCompanyAvailable(null);
    if (companyDebounceRef.current) clearTimeout(companyDebounceRef.current);
    if (company.trim().length < 2) return;

    const slug = slugify(company.trim());
    if (RESERVED_SUBDOMAINS.has(slug)) {
      setCompanyAvailable(false);
      return;
    }

    companyDebounceRef.current = setTimeout(async () => {
      setCheckingCompany(true);
      const { data } = await supabase
        .from("isp_admins")
        .select("id")
        .ilike("subdomain", slug)
        .limit(1);
      setCheckingCompany(false);
      setCompanyAvailable(!data || data.length === 0);
    }, 600);

    return () => { if (companyDebounceRef.current) clearTimeout(companyDebounceRef.current); };
  }, [company]);

  useEffect(() => {
    setPhoneAvailable(null);
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);
    if (phone.trim().length < 7) return;

    phoneDebounceRef.current = setTimeout(async () => {
      setCheckingPhone(true);
      const { data } = await supabase
        .from("isp_admins")
        .select("id")
        .eq("phone", phone.trim())
        .limit(1);
      setCheckingPhone(false);
      setPhoneAvailable(!data || data.length === 0);
    }, 600);

    return () => { if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current); };
  }, [phone]);

  useEffect(() => {
    fetch("/api/registration/config")
      .then(async response => {
        const data = await response.json() as {
          registrationFee?: { amount?: number; currency?: string };
          automaticPaymentAvailable?: boolean;
          manualPaymentRequired?: boolean;
          destination?: RegistrationDestination | null;
        };
        if (data.registrationFee?.amount && data.registrationFee.currency) {
          setRegistrationFee({ amount: data.registrationFee.amount, currency: data.registrationFee.currency });
        }
        setRegistrationDestination(data.destination ?? null);
        setPaymentReady(data.manualPaymentRequired === true || data.automaticPaymentAvailable === true);
      })
      .catch(() => setPaymentReady(false));
  }, []);

  useEffect(() => {
    if (!awaitingPayment || !checkoutId) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`);
        const data = await response.json() as {
          paid?: boolean;
          status?: string;
          registration?: { username?: string; subdomain?: string };
        };
        if (data.paid && data.registration?.username) {
          window.clearInterval(poll);
          setRegisteredUsername(data.registration.username);
          setRegisteredSubdomain(data.registration.subdomain || slugify(company));
          setAwaitingPayment(false);
          setSuccess(true);
        } else if (data.status === "failed") {
          window.clearInterval(poll);
          setAwaitingPayment(false);
          setServerErr("The payment was not completed. You can try registering again.");
        }
      } catch {
        /* Keep polling while the payment provider finishes the callback. */
      }
    }, 3000);
    return () => window.clearInterval(poll);
  }, [awaitingPayment, checkoutId]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!company.trim() || company.trim().length < 2) e.company = "Company name is required";
    else if (RESERVED_SUBDOMAINS.has(slugify(company))) {
      e.company = "This company name is reserved for platform services. Please choose another name.";
    } else if (companyAvailable === false) {
      e.company = "This company name is already taken";
    }
    if (!phone.trim()) e.phone = "Contact number is required";
    if (phoneAvailable === false) e.phone = "This phone number is already registered";
    if (!paymentPhone.trim()) e.paymentPhone = "M-Pesa payment number is required";
    else if (!/^(\+?254|0)7\d{8}$/.test(paymentPhone.replace(/[\s-]/g, ""))) {
      e.paymentPhone = "Enter a valid Kenyan M-Pesa number";
    }
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerErr("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const response = await fetch("/api/registration/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.trim(), phone: phone.trim(), paymentPhone: paymentPhone.trim() }),
      });
      const data = await response.json() as {
        ok: boolean; error?: string; CheckoutRequestID?: string; manualPayment?: boolean;
        username?: string; subdomain?: string; destination?: RegistrationDestination;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not start the registration payment.");
      }
      if (data.manualPayment) {
        setRegisteredUsername(data.username || "");
        setRegisteredSubdomain(data.subdomain || slugify(company));
        setManualPayment(data.destination || registrationDestination);
        return;
      }
      if (!data.CheckoutRequestID) throw new Error("The registration payment prompt could not be created.");
      setCheckoutId(data.CheckoutRequestID);
      setAwaitingPayment(true);
    } catch (err) {
      const msg = extractMsg(err);
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setServerErr("This company name or phone number is already registered. Please use different details.");
      } else {
        setServerErr(msg || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading
    && companyAvailable !== false
    && phoneAvailable !== false
    && !checkingCompany
    && !checkingPhone
    && paymentReady;

  const displayFee = new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: registrationFee.currency,
    maximumFractionDigits: 0,
  }).format(registrationFee.amount);

  if (success) {
    const subdomainUrl = `https://${registeredSubdomain}.isplatty.org`;
    return (
      <div className="register-state-page" style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: "48px 32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: "50%", background: "var(--isp-green-glow)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={32} style={{ color: "var(--isp-green)" }} />
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--isp-text)", marginBottom: 8 }}>Account Created!</h2>
            <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: 20 }}>
              <span style={{ color: "var(--isp-accent)", fontWeight: 600 }}>{company}</span> is now registered.
            </p>
            <div style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "16px 20px", marginBottom: 20, textAlign: "left" }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Your Login Credentials</p>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>Username</span>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700, color: "var(--isp-text)" }}>{registeredUsername || "admin"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>Password</span>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700, color: "var(--isp-text)" }}>admin</span>
              </div>
              <p style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", lineHeight: 1.45, margin: "0 0 12px" }}>
                Sign in with these temporary details, then create your own password to access the workspace.
              </p>
              <div style={{ borderTop: "1px solid var(--isp-border)", paddingTop: 12 }}>
                <p style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginBottom: 4 }}>Your portal URL</p>
                <p style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--isp-accent)", wordBreak: "break-all" }}>{subdomainUrl}</p>
              </div>
            </div>
            <a
              href={subdomainUrl}
              className="btn btn-primary"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 20px", borderRadius: 10, fontSize: "0.9rem", textDecoration: "none" }}
            >
              Go to My Portal <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (awaitingPayment) {
    return (
      <div className="register-state-page" style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center", background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: "48px 32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: "50%", background: "var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 size={30} style={{ color: "var(--isp-accent)", animation: "spin 1.2s linear infinite" }} />
          </div>
          <h2 style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--isp-text)", marginBottom: 10 }}>Confirm your payment</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--isp-text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
             An M-Pesa prompt for <strong style={{ color: "var(--isp-text)" }}>{displayFee}</strong> has been sent to <strong style={{ color: "var(--isp-text)" }}>{paymentPhone}</strong>.
          </p>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-sub)", lineHeight: 1.55 }}>
            Enter your M-Pesa PIN on your phone. Your ISP account will be created only after the payment is confirmed.
          </p>
        </div>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (manualPayment) {
    return (
      <div className="register-state-page" style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 460, background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: "40px 32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          <h2 style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--isp-text)", margin: "0 0 10px" }}>Complete your bank payment</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--isp-text-muted)", lineHeight: 1.6, margin: "0 0 18px" }}>
            Pay <strong style={{ color: "var(--isp-text)" }}>{displayFee}</strong> to <strong style={{ color: "var(--isp-text)" }}>{manualPayment.name}</strong> before your ISP is activated.
          </p>
          <div style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: 16, color: "var(--isp-text)", fontSize: "0.875rem", lineHeight: 1.65 }}>
            <div><strong>Account:</strong> {manualPayment.number}</div>
            {manualPayment.accountReference && <div><strong>Reference:</strong> {manualPayment.accountReference}</div>}
            {manualPayment.instructions && <div style={{ marginTop: 8 }}>{manualPayment.instructions}</div>}
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-sub)", lineHeight: 1.55, margin: "18px 0 0" }}>
            Your registration is pending. A Super Admin will verify the bank payment and activate your account.
          </p>
        </div>
      </div>
    );
  }

  const inputStyle = (hasError: boolean, isAvailable: boolean | null, icon = true): React.CSSProperties => ({
    width: "100%", minHeight: 52, paddingLeft: icon ? 42 : 15, paddingRight: 42,
    background: "var(--isp-input-bg)",
    border: `1.5px solid ${hasError || isAvailable === false ? "#FCA5A5" : isAvailable === true ? "#86EFAC" : "var(--isp-input-border)"}`,
    borderRadius: 14,
    fontSize: "0.9rem", color: "var(--isp-text)",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
  });

  return (
    <div className="register-page">
      <div className="register-shell">
        <aside className="register-visual">
          <div className="register-visual-top">
            <Logo size="md" />
            <span className="register-portal-pill">ISP OPERATING SYSTEM</span>
          </div>
          <div className="register-visual-copy">
            <div className="register-eyebrow"><Sparkles size={14} /> BUILT FOR AMBITIOUS NETWORKS</div>
            <h2>Make your network the <span>best part</span> of your business.</h2>
            <p>Everything you need to launch, automate, and grow a modern ISP — without the operational overhead.</p>
            <div className="register-benefits">
              <div className="register-benefit">
                <div className="register-benefit-icon"><Router size={17} /></div>
                <div><strong>One powerful control room</strong><span>Billing, customers, routers, and access in one view.</span></div>
              </div>
              <div className="register-benefit">
                <div className="register-benefit-icon"><CreditCard size={17} /></div>
                <div><strong>Payments that just work</strong><span>Collect with M-Pesa and activate customers faster.</span></div>
              </div>
              <div className="register-benefit">
                <div className="register-benefit-icon"><ShieldCheck size={17} /></div>
                <div><strong>Built for reliable growth</strong><span>Secure infrastructure that keeps your business moving.</span></div>
              </div>
            </div>
          </div>
          <div className="register-visual-footer">
            <span className="register-live-dot" /> <span>Trusted infrastructure for connected communities</span>
          </div>
          <div className="register-orbit register-orbit-one" />
          <div className="register-orbit register-orbit-two" />
          <div className="register-grid" />
        </aside>

        <main className="register-form-side">
          <div className="register-mobile-brand"><Logo size="sm" /></div>
          <div className="register-form-wrap">
            <div className="register-progress">
              <div className="register-step active"><span>1</span><strong>ISP details</strong></div>
              <div className="register-progress-line" />
              <div className="register-step"><span>2</span><strong>Payment</strong></div>
              <div className="register-progress-line" />
              <div className="register-step"><span>3</span><strong>Workspace ready</strong></div>
            </div>
            <div className="register-heading">
              <p className="register-kicker">START YOUR JOURNEY</p>
              <h1>Launch your ISP workspace</h1>
              <p>Set up your account in a few simple steps. You’ll be ready to manage your network in minutes.</p>
            </div>

            <div className="register-fee-card">
              <div className="register-fee-icon"><CreditCard size={18} /></div>
              <div className="register-fee-copy">
                <div><strong>One-time account setup</strong><span>Secure activation fee</span></div>
                <b>{displayFee}</b>
              </div>
              <div className="register-fee-note">
                {registrationDestination?.type === "bank"
                  ? <>Pay manually to <strong>{registrationDestination.name}</strong> ({registrationDestination.number}) before activation.</>
                  : registrationDestination
                  ? <>An M-Pesa prompt will use <strong>{registrationDestination.name}</strong> ({registrationDestination.number}){registrationDestination.accountReference ? ` · ${registrationDestination.accountReference}` : ""}</>
                  : "A payment destination must be configured before registration."}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="register-form">
              <div className="register-form-section">
                <div className="register-section-heading"><span>01</span><div><strong>Your business</strong><small>Tell us about your ISP</small></div></div>
                <div className="register-two-col">
                  <div>
                    <label className="register-label">Company / ISP Name</label>
            <div style={{ position: "relative" }}>
              <Building2 size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value.toLowerCase())}
                placeholder="e.g. ochola networks"
                autoComplete="organization"
                 className="register-input"
                 style={inputStyle(!!errors.company, companyAvailable)}
                onFocus={e => { if (!errors.company && companyAvailable !== false) { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; } }}
                onBlur={e => { e.target.style.boxShadow = "none"; }}
              />
              <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                {checkingCompany && <Loader2 size={15} style={{ color: "var(--isp-text-sub)", animation: "spin 1s linear infinite" }} />}
                {!checkingCompany && companyAvailable === true && <CheckCircle2 size={15} style={{ color: "var(--isp-green)" }} />}
                {!checkingCompany && companyAvailable === false && <XCircle size={15} style={{ color: "#EF4444" }} />}
              </div>
            </div>
            {!errors.company && company.trim().length >= 2 && !checkingCompany && companyAvailable !== null && (
              <p style={{ fontSize: "0.75rem", marginTop: 6, fontWeight: 500, color: companyAvailable ? "#16A34A" : "#DC2626" }}>
                {companyAvailable
                  ? "Available"
                  : RESERVED_SUBDOMAINS.has(slugify(company))
                  ? "Reserved platform name — choose another name"
                  : "Already taken — try a different name"}
              </p>
            )}
            {errors.company && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.company}</p>}
                  </div>
                  <div>
                    <label className="register-label">ISP Contact Number</label>
            <div style={{ position: "relative" }}>
              <Phone size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
               placeholder="+254 700 000 000"
                 className="register-input"
                 style={inputStyle(!!errors.phone, phoneAvailable)}
                onFocus={e => { if (!errors.phone && phoneAvailable !== false) { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; } }}
                onBlur={e => { e.target.style.boxShadow = "none"; }}
              />
              <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                {checkingPhone && <Loader2 size={15} style={{ color: "var(--isp-text-sub)", animation: "spin 1s linear infinite" }} />}
                {!checkingPhone && phoneAvailable === true && <CheckCircle2 size={15} style={{ color: "var(--isp-green)" }} />}
                {!checkingPhone && phoneAvailable === false && <XCircle size={15} style={{ color: "#EF4444" }} />}
              </div>
            </div>
            {!errors.phone && phone.trim().length >= 7 && !checkingPhone && phoneAvailable !== null && (
              <p style={{ fontSize: "0.75rem", marginTop: 6, fontWeight: 500, color: phoneAvailable ? "#16A34A" : "#DC2626" }}>
                {phoneAvailable ? "Phone available" : "Phone already registered — try signing in instead"}
              </p>
            )}
            {errors.phone && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.phone}</p>}
                  </div>
                </div>
              </div>

              <div className="register-form-section">
                <div className="register-section-heading"><span>02</span><div><strong>Payment contact</strong><small>Where should we send the M-Pesa prompt?</small></div></div>
                <div>
              <label className="register-label">M-Pesa Payment Number</label>
             <div style={{ position: "relative" }}>
               <Phone size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
               <input
                 type="tel"
                 value={paymentPhone}
                 onChange={e => setPaymentPhone(e.target.value)}
                 placeholder="+254 700 000 000"
                 autoComplete="tel"
                  className="register-input"
                  style={inputStyle(!!errors.paymentPhone, null)}
                 onFocus={e => { if (!errors.paymentPhone) { e.target.style.borderColor = "var(--isp-accent)"; e.target.style.boxShadow = "0 0 0 3px var(--isp-accent-glow)"; } }}
                 onBlur={e => { e.target.style.boxShadow = "none"; }}
               />
             </div>
             <p style={{ fontSize: "0.72rem", color: "var(--isp-text-sub)", margin: "6px 0 0" }}>
               The STK Push will be sent here. This number may be reused for multiple ISP registrations.
             </p>
             {errors.paymentPhone && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.paymentPhone}</p>}
                </div>
              </div>

          {serverErr && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "10px 14px" }}>
              <AlertTriangle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
              <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{serverErr}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="register-submit"
            style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            {loading
              ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> {registrationDestination?.type === "bank" ? "Saving registration..." : "Sending payment prompt..."}</>
              : registrationDestination?.type === "bank"
              ? <>Continue to bank payment instructions <ArrowRight size={16} /></>
              : <>Pay {displayFee} &amp; Create Account <ArrowRight size={16} /></>}
          </button>

          {!paymentReady && (
            <p style={{ fontSize: "0.75rem", color: "#B45309", textAlign: "center", margin: "-6px 0 0" }}>
              Registration payments are not configured yet. Please contact support.
            </p>
          )}

          <p className="register-sign-in">
            Already registered?{" "}
            <span onClick={() => setLocation("/admin/login")} style={{ color: "var(--isp-accent)", fontWeight: 600, cursor: "pointer" }}>Sign In</span>
          </p>
        </form>

            <div className="register-trust-row"><ShieldCheck size={15} /> Your information is encrypted and protected</div>
          </div>
        </main>
      </div>
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .register-page{min-height:100vh;background:#f6f8fc;color:var(--isp-text);font-family:'Inter',system-ui,sans-serif}
        .register-shell{min-height:100vh;display:grid;grid-template-columns:minmax(390px,.82fr) minmax(560px,1.18fr)}
        .register-visual{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:42px 8%;background:linear-gradient(145deg,#0b1426 0%,#111b35 55%,#18214a 100%);color:white}
        .register-visual:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 80% 16%,rgba(72,122,255,.28),transparent 34%),radial-gradient(circle at 12% 90%,rgba(109,74,255,.22),transparent 33%);pointer-events:none}
        .register-visual>*:not(.register-orbit):not(.register-grid){position:relative;z-index:2}
        .register-visual-top{display:flex;align-items:center;justify-content:space-between;gap:20px;color:white}
        .register-portal-pill{padding:7px 10px;border:1px solid rgba(148,163,184,.23);border-radius:999px;color:#9fb3d8;font-size:.58rem;font-weight:800;letter-spacing:.12em;white-space:nowrap}
        .register-visual-copy{max-width:470px;margin:auto 0}
        .register-eyebrow,.register-kicker{display:flex;align-items:center;gap:7px;color:#80a8ff;font-size:.64rem;font-weight:800;letter-spacing:.14em}
        .register-visual-copy h2{margin:18px 0 18px;max-width:500px;color:#f4f7ff;font-size:clamp(2.35rem,4vw,4rem);line-height:1.05;letter-spacing:-.065em;font-weight:800}
        .register-visual-copy h2 span{color:#89adff}
        .register-visual-copy>p{max-width:410px;margin:0;color:#a5b4cf;font-size:.96rem;line-height:1.75}
        .register-benefits{display:flex;flex-direction:column;gap:18px;margin-top:42px}
        .register-benefit{display:flex;align-items:flex-start;gap:13px}
        .register-benefit-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid rgba(128,168,255,.25);border-radius:10px;background:rgba(71,112,225,.16);color:#91b2ff;flex:0 0 auto}
        .register-benefit strong,.register-benefit span{display:block}
        .register-benefit strong{margin-bottom:4px;font-size:.8rem;color:#e7edfa}
        .register-benefit span{color:#8191b1;font-size:.72rem;line-height:1.45}
        .register-visual-footer{display:flex;align-items:center;gap:8px;color:#8090ae;font-size:.68rem}
        .register-live-dot{width:7px;height:7px;border-radius:50%;background:#43e3a2;box-shadow:0 0 0 4px rgba(67,227,162,.12)}
        .register-orbit{position:absolute;z-index:1;border:1px solid rgba(119,157,255,.1);border-radius:50%;pointer-events:none}
        .register-orbit-one{width:500px;height:500px;right:-270px;top:12%}
        .register-orbit-two{width:740px;height:740px;right:-430px;top:-3%}
        .register-grid{position:absolute;z-index:1;inset:0;opacity:.14;background-image:linear-gradient(rgba(155,178,255,.18) 1px,transparent 1px),linear-gradient(90deg,rgba(155,178,255,.18) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,transparent 0%,black 55%,transparent 100%);pointer-events:none}
        .register-form-side{display:flex;justify-content:center;min-width:0;padding:54px 7%;background:#f8fafc}
        .register-form-wrap{width:100%;max-width:690px}
        .register-mobile-brand{display:none}
        .register-progress{display:flex;align-items:center;margin-bottom:38px}
        .register-step{display:flex;align-items:center;gap:8px;color:#9aa7b9;white-space:nowrap}
        .register-step span{display:grid;place-items:center;width:25px;height:25px;border:1px solid #d7deea;border-radius:50%;font-size:.68rem;font-weight:800}
        .register-step strong{font-size:.68rem;font-weight:700}
        .register-step.active{color:#2563eb}
        .register-step.active span{border-color:#2563eb;background:#2563eb;color:#fff;box-shadow:0 4px 10px rgba(37,99,235,.2)}
        .register-progress-line{height:1px;flex:1;min-width:22px;margin:0 12px;background:#dce3ed}
        .register-heading{margin-bottom:27px}
        .register-kicker{margin:0 0 10px;color:#2563eb}
        .register-heading h1{margin:0 0 9px;font-size:clamp(1.8rem,3vw,2.45rem);line-height:1.1;letter-spacing:-.055em;font-weight:800;color:#111b35}
        .register-heading>p:last-child{max-width:520px;margin:0;color:#718096;font-size:.85rem;line-height:1.65}
        .register-fee-card{display:grid;grid-template-columns:42px 1fr auto;column-gap:13px;align-items:center;padding:16px 18px;margin-bottom:30px;border:1px solid #dce5f2;border-radius:16px;background:linear-gradient(115deg,#eef4ff,#f8faff);box-shadow:0 7px 20px rgba(34,73,140,.05)}
        .register-fee-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#dbe8ff;color:#2563eb}
        .register-fee-copy{display:flex;align-items:center;justify-content:space-between;gap:18px}
        .register-fee-copy strong,.register-fee-copy span{display:block}
        .register-fee-copy strong{font-size:.79rem;color:#263652}
        .register-fee-copy span{margin-top:4px;color:#8491a7;font-size:.67rem}
        .register-fee-copy>b{color:#2563eb;font-size:1.15rem;white-space:nowrap}
        .register-fee-note{grid-column:2 / -1;margin-top:10px;color:#718096;font-size:.68rem;line-height:1.5}
        .register-fee-note strong{color:#4c6184}
        .register-form{display:flex;flex-direction:column;gap:25px}
        .register-form-section{padding-bottom:25px;border-bottom:1px solid #e5eaf2}
        .register-section-heading{display:flex;align-items:center;gap:11px;margin-bottom:16px}
        .register-section-heading>span{color:#2563eb;font-size:.68rem;font-weight:800;letter-spacing:.04em}
        .register-section-heading strong,.register-section-heading small{display:block}
        .register-section-heading strong{margin-bottom:3px;color:#1e2a41;font-size:.83rem}
        .register-section-heading small{color:#8794a8;font-size:.68rem}
        .register-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .register-label{display:block;margin-bottom:8px;color:#33415b;font-size:.71rem;font-weight:700}
        .register-input{box-sizing:border-box}
        .register-input::placeholder{color:#a3adbd}
        .register-input:focus{border-color:#4f8cff!important;box-shadow:0 0 0 4px rgba(79,140,255,.13);transform:translateY(-1px)}
        .register-password-toggle{position:absolute;right:13px;top:50%;display:flex;padding:4px;transform:translateY(-50%);border:0;background:transparent;color:#8c99ad;cursor:pointer}
        .register-password-toggle:hover{color:#2563eb}
        .register-password-meter{display:flex;align-items:center;gap:9px;margin-top:8px}
        .register-meter-bars{display:flex;gap:3px}
        .register-meter-bars span{width:24px;height:3px;border-radius:4px;background:#dce3ec}
        .register-meter-bars span.active{background:#f3b94f}.register-meter-bars span.strong{background:#32c58a}
        .register-password-meter small{color:#8491a4;font-size:.63rem}
        .register-submit{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:54px;padding:14px 20px;border:0;border-radius:14px;background:linear-gradient(105deg,#2563eb,#4f7cff);box-shadow:0 10px 20px rgba(37,99,235,.2);color:white;font-family:inherit;font-size:.82rem;font-weight:800;transition:transform .15s,box-shadow .15s}
        .register-submit:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 14px 25px rgba(37,99,235,.28)}
        .register-sign-in{margin:0;text-align:center;color:#8794a8;font-size:.76rem}
        .register-sign-in span{color:#2563eb;font-weight:700}
        .register-trust-row{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:18px;color:#9aa7b9;font-size:.65rem}
        .register-trust-row svg{color:#5a8cf4}
        .register-state-page .register-shell{display:none}
        @media(max-width:900px){.register-shell{display:block}.register-visual{display:none}.register-form-side{min-height:100vh;padding:28px 20px 40px}.register-mobile-brand{display:flex;margin-bottom:32px}.register-progress{margin-bottom:30px}.register-form-wrap{max-width:560px;margin:0 auto}.register-heading h1{font-size:2rem}}
        @media(max-width:560px){.register-form-side{padding:23px 16px 32px}.register-mobile-brand{margin-bottom:27px}.register-progress-line{margin:0 7px;min-width:10px}.register-step{gap:5px}.register-step strong{display:none}.register-fee-card{grid-template-columns:38px 1fr;padding:14px}.register-fee-icon{width:38px;height:38px}.register-fee-copy{display:block}.register-fee-copy>b{display:block;margin-top:5px}.register-fee-note{grid-column:1 / -1}.register-two-col{grid-template-columns:1fr;gap:18px}.register-form{gap:22px}}
      `}</style>
    </div>
  );
}
