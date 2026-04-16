import React, { useState } from "react";
import { Sliders, User, Lock, Eye, EyeOff, Ticket, KeyRound, CheckCircle2, Zap } from "lucide-react";
import { useBrand } from "@/context/BrandContext";

const S = {
  accent: "var(--isp-accent)",
  accentGlow: "var(--isp-accent-glow)",
  accentBorder: "var(--isp-accent-border)",
  card: "var(--isp-card)",
  bg: "var(--isp-bg)",
  text: "var(--isp-text)",
  muted: "var(--isp-text-muted)",
  border: "var(--isp-border-subtle)",
  inputBg: "var(--isp-input-bg)",
  inputBdr: "var(--isp-input-border)",
};

function PortalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{
      width: "100%", background: S.inputBg, border: `1px solid ${S.inputBdr}`,
      borderRadius: 10, color: S.text, fontSize: "0.9375rem", fontWeight: 500,
      padding: "0.75rem 1rem", fontFamily: "inherit", outline: "none",
      boxSizing: "border-box", transition: "border-color 0.2s",
      ...props.style,
    }} />
  );
}

function PortalBtn({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "amber" }) {
  const bg = variant === "amber" ? "#f59e0b" : S.accent;
  return (
    <button {...props} style={{
      width: "100%", padding: "0.85rem 1.5rem", borderRadius: 10,
      background: bg, border: "none", color: "white",
      fontSize: "1rem", fontWeight: 700, cursor: "pointer",
      fontFamily: "inherit", opacity: props.disabled ? 0.65 : 1,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      transition: "opacity 0.2s",
    }}>
      {children}
    </button>
  );
}

export default function PPPoELogin() {
  const brand = useBrand();
  const [tab, setTab] = useState<"login" | "forgot" | "voucher">("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged,  setLogged]  = useState(false);

  const [resetPhone, setResetPhone] = useState("");
  const [resetting,  setResetting]  = useState(false);
  const [resetSent,  setResetSent]  = useState(false);

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
    <div style={{ minHeight: "100vh", background: S.bg, color: S.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", display: "flex", flexDirection: "column" }}>

      <header style={{ height: 64, borderBottom: `1px solid ${S.border}`, background: S.card, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: S.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sliders size={18} color="white" />
          </div>
          <div>
            <p style={{ fontSize: "0.9375rem", fontWeight: 800, margin: 0, color: S.text }}>{brand.ispName.toUpperCase()}</p>
            <p style={{ fontSize: "0.7rem", color: S.muted, margin: 0 }}>PPPoE Client Portal</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 99, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#10b981" }}>Service Active</span>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 480, margin: "0 auto", padding: "40px 16px 60px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 8px", color: S.text }}>
            Your Broadband Portal
          </h2>
          <p style={{ fontSize: "0.875rem", color: S.muted, margin: 0 }}>
            Manage your PPPoE account, track data usage and renew your subscription.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 32 }}>
          {[
            { icon: <Zap size={15} />, label: "Speed", value: "Up to 100 Mbps" },
            { icon: <CheckCircle2 size={15} />, label: "Uptime", value: "99.9%" },
            { icon: <Sliders size={15} />, label: "Support", value: "24/7" },
          ].map(stat => (
            <div key={stat.label} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: "14px 10px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 6, color: S.accent }}>{stat.icon}</div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: S.text }}>{stat.value}</div>
              <div style={{ fontSize: "0.7rem", color: S.muted, marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: 4, marginBottom: 24 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "10px 8px", borderRadius: 8, border: "none",
                fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.2s",
                background: tab === t.id ? S.accent : "transparent",
                color: tab === t.id ? "white" : S.muted,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "login" && (
          logged ? (
            <div style={{ background: S.card, border: "1px solid rgba(16,185,129,0.25)", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <CheckCircle2 size={32} color="#10b981" />
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 8px", color: S.text }}>Welcome Back!</h3>
              <p style={{ fontSize: "0.85rem", color: S.muted, margin: "0 0 24px" }}>You are now authenticated. Your session is active.</p>
              <button onClick={() => { setLogged(false); setUsername(""); setPassword(""); }} style={{ background: "none", border: "none", color: S.accent, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>Sign out</button>
            </div>
          ) : (
            <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: S.accentGlow, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <User size={18} style={{ color: S.accent }} />
                </div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, color: S.text }}>Member Login</h3>
              </div>
              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: S.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Username</label>
                  <PortalInput type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder="your_username" />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: S.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Password</label>
                  <div style={{ position: "relative" }}>
                    <PortalInput type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ paddingRight: 44 }} />
                    <button type="button" onClick={() => setShowPw(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: S.muted, cursor: "pointer", padding: 0 }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <PortalBtn type="submit" disabled={logging}>{logging ? "Connecting..." : "Login"}</PortalBtn>
                <p style={{ textAlign: "center", fontSize: "0.8rem", color: S.muted, marginTop: 14 }}>
                  Forgot your credentials?{" "}
                  <button type="button" onClick={() => setTab("forgot")} style={{ background: "none", border: "none", color: S.accent, fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}>Reset here</button>
                </p>
              </form>
            </div>
          )
        )}

        {tab === "forgot" && (
          resetSent ? (
            <div style={{ background: S.card, border: "1px solid rgba(16,185,129,0.25)", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <CheckCircle2 size={32} color="#10b981" />
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 8px", color: S.text }}>Request Sent!</h3>
              <p style={{ fontSize: "0.85rem", color: S.muted, margin: "0 0 24px" }}>Our support team will contact you on <strong style={{ color: S.text }}>{resetPhone}</strong> with your new credentials.</p>
              <button onClick={() => { setResetSent(false); setResetPhone(""); }} style={{ background: "none", border: "none", color: S.accent, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>Back</button>
            </div>
          ) : (
            <div style={{ background: S.card, border: "1px solid rgba(245,158,11,0.2)", borderRadius: 16, padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <KeyRound size={18} style={{ color: "#f59e0b" }} />
                </div>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, color: S.text }}>Reset Password</h3>
                  <p style={{ fontSize: "0.72rem", color: S.muted, margin: "2px 0 0" }}>Enter your registered phone number</p>
                </div>
              </div>
              <form onSubmit={handleReset}>
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: S.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Phone Number</label>
                  <PortalInput type="tel" required value={resetPhone} onChange={e => setResetPhone(e.target.value)} placeholder="07XX XXX XXX" />
                </div>
                <PortalBtn type="submit" disabled={resetting} variant="amber">{resetting ? "Sending request..." : "Request Reset"}</PortalBtn>
              </form>
            </div>
          )
        )}

        {tab === "voucher" && (
          activated ? (
            <div style={{ background: S.card, border: "1px solid rgba(16,185,129,0.25)", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <CheckCircle2 size={32} color="#10b981" />
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 8px", color: S.text }}>Voucher Activated!</h3>
              <p style={{ fontSize: "0.85rem", color: S.muted, margin: "0 0 24px" }}>Your subscription has been renewed. Enjoy your connection.</p>
              <button onClick={() => { setActivated(false); setCode(""); }} style={{ background: "none", border: "none", color: S.accent, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>Redeem another</button>
            </div>
          ) : (
            <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: "24px 24px 28px" }}>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: S.accentGlow, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <Ticket size={22} style={{ color: S.accent }} />
                </div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 6px", color: S.text }}>Redeem Voucher</h3>
                <p style={{ fontSize: "0.8rem", color: S.muted, margin: 0 }}>Enter your voucher code to renew your PPPoE subscription.</p>
              </div>
              <form onSubmit={handleVoucher}>
                <div style={{ marginBottom: 18 }}>
                  <PortalInput type="text" required value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={14} style={{ textAlign: "center", fontFamily: "monospace", fontSize: "1.125rem", letterSpacing: "0.15em" }} />
                </div>
                <PortalBtn type="submit" disabled={activating}>{activating ? "Activating..." : "Activate Voucher"}</PortalBtn>
              </form>
            </div>
          )
        )}
      </main>

      <footer style={{ borderTop: `1px solid ${S.border}`, padding: "20px 0", textAlign: "center" }}>
        <p style={{ fontSize: "0.72rem", color: S.muted, margin: 0 }}>
          &copy; {new Date().getFullYear()} {brand.ispName} &mdash; PPPoE Client Portal. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
