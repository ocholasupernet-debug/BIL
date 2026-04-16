import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Wifi, Building2, Phone, ArrowRight, CheckCircle2, XCircle, Loader2, AlertTriangle, Zap } from "lucide-react";
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

  const validate = () => {
    const e: Record<string, string> = {};
    if (!company.trim() || company.trim().length < 2) e.company = "Company name is required";
    if (companyAvailable === false) e.company = "This company name is already taken";
    if (!phone.trim()) e.phone = "Mobile number is required";
    if (phoneAvailable === false) e.phone = "This phone number is already registered";
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerErr("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const slug = slugify(company);
    setLoading(true);
    try {
      const finalSlug = slug || company.trim().toLowerCase();
      const { error } = await supabase.from("isp_admins").insert({
        name:      company.trim(),
        phone:     phone.trim(),
        username:  finalSlug,
        password:  "admin",
        is_active: true,
        role:      "isp_admin",
        subdomain: finalSlug,
      });
      if (error) throw error;

      fetch("/api/isp/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: finalSlug }),
      }).catch(() => {});

      setRegisteredUsername(finalSlug);
      setSuccess(true);
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
    && !checkingPhone;

  if (success) {
    const subdomainUrl = `https://${registeredUsername}.isplatty.org/admin/login`;
    return (
      <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "48px 32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: "50%", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>Account Created!</h2>
            <p style={{ fontSize: "0.875rem", color: "#64748B", marginBottom: 20 }}>
              <span style={{ color: "#2563EB", fontWeight: 600 }}>{company}</span> is now registered.
            </p>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "16px 20px", marginBottom: 20, textAlign: "left" }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Your Login Credentials</p>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>Username</span>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700, color: "#0F172A" }}>{registeredUsername}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>Default Password</span>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700, color: "#D97706" }}>admin</span>
              </div>
              <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 12 }}>
                <p style={{ fontSize: "0.72rem", color: "#64748B", marginBottom: 4 }}>Your portal URL</p>
                <p style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#2563EB", wordBreak: "break-all" }}>{subdomainUrl}</p>
              </div>
              <p style={{ fontSize: "0.72rem", color: "#94A3B8", borderTop: "1px solid #E2E8F0", paddingTop: 10, marginTop: 10 }}>You'll be asked to create a new password on first sign in.</p>
            </div>
            <a
              href={subdomainUrl}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 20px", borderRadius: 10, background: "#2563EB", color: "white", fontWeight: 700, fontSize: "0.9rem", textDecoration: "none", boxShadow: "0 4px 14px rgba(37,99,235,0.3)" }}
            >
              Go to My Portal <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  const inputStyle = (hasError: boolean, isAvailable: boolean | null): React.CSSProperties => ({
    width: "100%", paddingLeft: 38, paddingRight: 38,
    paddingTop: 11, paddingBottom: 11,
    background: "#FFFFFF",
    border: `1.5px solid ${hasError || isAvailable === false ? "#FECACA" : isAvailable === true ? "#BBF7D0" : "#E2E8F0"}`,
    borderRadius: 10,
    fontSize: "0.875rem", color: "#0F172A",
    outline: "none", fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(37,99,235,0.3)" }}>
            <Zap size={18} style={{ color: "white" }} />
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>ISPlatty</div>
            <div style={{ fontSize: "0.65rem", color: "#94A3B8", fontWeight: 500 }}>ISP Management Platform</div>
          </div>
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", marginBottom: 6 }}>Get Started</h1>
        <p style={{ fontSize: "0.875rem", color: "#64748B", marginBottom: 32 }}>Register your ISP on the platform</p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginBottom: 7 }}>Company / ISP Name</label>
            <div style={{ position: "relative" }}>
              <Building2 size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value.toLowerCase())}
                placeholder="e.g. ochola networks"
                autoComplete="organization"
                style={inputStyle(!!errors.company, companyAvailable)}
                onFocus={e => { if (!errors.company && companyAvailable !== false) { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; } }}
                onBlur={e => { e.target.style.boxShadow = "none"; if (!errors.company && companyAvailable !== false) e.target.style.borderColor = companyAvailable === true ? "#BBF7D0" : "#E2E8F0"; }}
              />
              <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                {checkingCompany && <Loader2 size={15} style={{ color: "#94A3B8", animation: "spin 1s linear infinite" }} />}
                {!checkingCompany && companyAvailable === true && <CheckCircle2 size={15} style={{ color: "#22C55E" }} />}
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
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginBottom: 7 }}>Mobile Number</label>
            <div style={{ position: "relative" }}>
              <Phone size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+254 700 000 000"
                style={inputStyle(!!errors.phone, phoneAvailable)}
                onFocus={e => { if (!errors.phone && phoneAvailable !== false) { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; } }}
                onBlur={e => { e.target.style.boxShadow = "none"; if (!errors.phone && phoneAvailable !== false) e.target.style.borderColor = phoneAvailable === true ? "#BBF7D0" : "#E2E8F0"; }}
              />
              <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                {checkingPhone && <Loader2 size={15} style={{ color: "#94A3B8", animation: "spin 1s linear infinite" }} />}
                {!checkingPhone && phoneAvailable === true && <CheckCircle2 size={15} style={{ color: "#22C55E" }} />}
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

          {serverErr && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px" }}>
              <AlertTriangle size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
              <p style={{ fontSize: "0.825rem", color: "#DC2626", margin: 0 }}>{serverErr}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: "100%", padding: "12px 20px", borderRadius: 10,
              background: canSubmit ? "#2563EB" : "#93C5FD",
              border: "none", color: "white", fontSize: "0.9rem", fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.15s",
              boxShadow: canSubmit ? "0 4px 14px rgba(37,99,235,0.3)" : "none",
            }}
          >
            {loading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Registering...</> : <>Register <ArrowRight size={16} /></>}
          </button>

          <p style={{ textAlign: "center", fontSize: "0.825rem", color: "#94A3B8" }}>
            Already registered?{" "}
            <span onClick={() => setLocation("/admin/login")} style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>Sign In</span>
          </p>
        </form>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 6px rgba(34,197,94,0.5)" }} />
          <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 500 }}>All systems operational</span>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
