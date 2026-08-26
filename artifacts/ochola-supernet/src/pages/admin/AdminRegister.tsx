import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Building2, Phone, ArrowRight, CheckCircle2, XCircle, Loader2, AlertTriangle, Zap } from "lucide-react";
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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [checkingCompany, setCheckingCompany] = useState(false);
  const [companyAvailable, setCompanyAvailable] = useState<boolean | null>(null);
  const companyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState<boolean | null>(null);
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [registeredUsername, setRegisteredUsername] = useState("");
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

    companyDebounceRef.current = setTimeout(async () => {
      setCheckingCompany(true);
      const slug = slugify(company.trim());
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
          registration?: { username?: string };
        };
        if (data.paid && data.registration?.username) {
          window.clearInterval(poll);
          setRegisteredUsername(data.registration.username);
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
    if (companyAvailable === false) e.company = "This company name is already taken";
    if (!phone.trim()) e.phone = "Contact number is required";
    if (phoneAvailable === false) e.phone = "This phone number is already registered";
    if (!paymentPhone.trim()) e.paymentPhone = "M-Pesa payment number is required";
    else if (!/^(\+?254|0)7\d{8}$/.test(paymentPhone.replace(/[\s-]/g, ""))) {
      e.paymentPhone = "Enter a valid Kenyan M-Pesa number";
    }
    if (password.length < 10) e.password = "Choose a password with at least 10 characters";
    if (password !== confirmPassword) e.confirmPassword = "Passwords do not match";
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
        body: JSON.stringify({ company: company.trim(), phone: phone.trim(), paymentPhone: paymentPhone.trim(), password }),
      });
      const data = await response.json() as {
        ok: boolean; error?: string; CheckoutRequestID?: string; manualPayment?: boolean;
        username?: string; destination?: RegistrationDestination;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not start the registration payment.");
      }
      if (data.manualPayment) {
        setRegisteredUsername(data.username || "");
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
    const subdomainUrl = `https://${registeredUsername}.isplatty.org/admin/login`;
    return (
      <div style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
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
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700, color: "var(--isp-text)" }}>{registeredUsername}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>Password</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text)" }}>Use the password you chose</span>
              </div>
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
      <div style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
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
      <div style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
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

  const inputStyle = (hasError: boolean, isAvailable: boolean | null): React.CSSProperties => ({
    width: "100%", paddingLeft: 38, paddingRight: 38,
    paddingTop: 11, paddingBottom: 11,
    background: "var(--isp-input-bg)",
    border: `1.5px solid ${hasError || isAvailable === false ? "#FECACA" : isAvailable === true ? "#BBF7D0" : "var(--isp-input-border)"}`,
    borderRadius: 10,
    fontSize: "0.875rem", color: "var(--isp-text)",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--isp-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={18} style={{ color: "white" }} />
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.02em" }}>ISPlatty</div>
            <div style={{ fontSize: "0.65rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>ISP Management Platform</div>
          </div>
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em", marginBottom: 6 }}>Get Started</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: 18 }}>Register your ISP on the platform</p>
        <div style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "13px 15px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--isp-text)" }}>One-time account creation fee</span>
            <span style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--isp-accent)" }}>{displayFee}</span>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--isp-text-sub)", margin: "6px 0 0" }}>
            {registrationDestination?.type === "bank"
              ? <>Pay manually to <strong>{registrationDestination.name}</strong> ({registrationDestination.number}) before activation.</>
              : registrationDestination
              ? <>An M-Pesa prompt will use <strong>{registrationDestination.name}</strong> ({registrationDestination.number}){registrationDestination.accountReference ? ` · Reference: ${registrationDestination.accountReference}` : ""}{registrationDestination.instructions ? ` — ${registrationDestination.instructions}` : ""}</>
              : "A payment destination must be configured before registration."}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>Company / ISP Name</label>
            <div style={{ position: "relative" }}>
              <Building2 size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value.toLowerCase())}
                placeholder="e.g. ochola networks"
                autoComplete="organization"
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
                {companyAvailable ? "Available" : "Already taken — try a different name"}
              </p>
            )}
            {errors.company && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.company}</p>}
          </div>

          <div>
             <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>ISP Contact Number</label>
            <div style={{ position: "relative" }}>
              <Phone size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
               placeholder="+254 700 000 000"
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

           <div>
             <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>M-Pesa Payment Number</label>
             <div style={{ position: "relative" }}>
               <Phone size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-sub)" }} />
               <input
                 type="tel"
                 value={paymentPhone}
                 onChange={e => setPaymentPhone(e.target.value)}
                 placeholder="+254 700 000 000"
                 autoComplete="tel"
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

          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>Create Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 10 characters" style={{ ...inputStyle(!!errors.password, null), paddingLeft: 14 }} />
            {errors.password && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.password}</p>}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", marginBottom: 7 }}>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Re-enter your password" style={{ ...inputStyle(!!errors.confirmPassword, null), paddingLeft: 14 }} />
            {errors.confirmPassword && <p style={{ fontSize: "0.75rem", color: "#DC2626", marginTop: 4 }}>{errors.confirmPassword}</p>}
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
            className="btn btn-primary"
            style={{
              width: "100%", padding: "12px 20px", borderRadius: 10,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
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

          <p style={{ textAlign: "center", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
            Already registered?{" "}
            <span onClick={() => setLocation("/admin/login")} style={{ color: "var(--isp-accent)", fontWeight: 600, cursor: "pointer" }}>Sign In</span>
          </p>
        </form>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--isp-green)" }} />
          <span style={{ fontSize: "0.72rem", color: "var(--isp-text-sub)", fontWeight: 500 }}>All systems operational</span>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
