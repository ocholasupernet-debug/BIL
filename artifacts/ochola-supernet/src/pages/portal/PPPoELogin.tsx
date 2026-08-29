import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Check, CheckCircle2, ChevronRight, Eye, EyeOff, HelpCircle,
  KeyRound, LifeBuoy, LockKeyhole, Mail, MessageCircle, Router, Send,
  ShieldCheck, Ticket, UserRound, Wifi, X, Zap,
} from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { ADMIN_ID as AUTH_ADMIN_ID, getSelectedTenantId } from "@/lib/supabase";

const STORAGE_KEY = `pppoe_settings_${getSelectedTenantId() ?? AUTH_ADMIN_ID}`;

export const DEFAULT_PPPOE_COLORS = {
  bgColor: "#061416",
  bgColor2: "#102426",
  primaryColor: "#d96835",
  accentColor: "#f09562",
  cardColor: "#12292b",
  buttonColor: "#168c78",
  textColor: "#f4f8f5",
  inputBgColor: "#0b1d1f",
};

export type PppoePortalSettings = {
  ispName: string;
  tagline: string;
  routerId: string;
  enableVouchers: string;
  advertPos: string;
  enableAdvert: string;
  testimonials: string;
  faqSection: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  logoUrl: string;
  advertUrl: string;
  announcement: string;
  maintenanceMode: string;
  maintenanceMessage: string;
  testimonialText: string;
  faqText: string;
  termsUrl: string;
  privacyUrl: string;
  colors: typeof DEFAULT_PPPOE_COLORS;
};

const DEFAULT_SETTINGS: PppoePortalSettings = {
  ispName: "OCHOLASUPERNET",
  tagline: "Fast PPPoE broadband, built for every day.",
  routerId: "",
  enableVouchers: "No",
  advertPos: "Bottom",
  enableAdvert: "Disable",
  testimonials: "Disable",
  faqSection: "Disable",
  supportPhone: "",
  supportEmail: "",
  whatsappNumber: "",
  logoUrl: "",
  advertUrl: "",
  announcement: "",
  maintenanceMode: "Online",
  maintenanceMessage: "We are making a few improvements. Please check back shortly.",
  testimonialText: "Stable speeds and quick support whenever I need it.",
  faqText: "How do I connect?\nUse your PPPoE username and password, then sign in below.",
  termsUrl: "",
  privacyUrl: "",
  colors: DEFAULT_PPPOE_COLORS,
};

function loadSettings(): PppoePortalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<PppoePortalSettings> : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      colors: { ...DEFAULT_PPPOE_COLORS, ...(parsed.colors ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_PPPOE_COLORS } };
  }
}

function phoneHref(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeImageSource(value: string): string {
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) ? value : "";
}

function PortalButton({
  children, variant = "primary", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      {...props}
      className={`pppoe-button pppoe-button-${variant} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function PortalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`pppoe-input ${props.className ?? ""}`} />;
}

function ResultState({
  icon, eyebrow, title, message, action,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  message: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="pppoe-result">
      <div className="pppoe-result-icon">{icon}</div>
      <span className="pppoe-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

const PORTAL_CSS = `
  .pppoe-portal {
    --pppoe-bg: #061416;
    --pppoe-bg-2: #102426;
    --pppoe-primary: #d96835;
    --pppoe-accent: #f09562;
    --pppoe-card: #12292b;
    --pppoe-button: #168c78;
    --pppoe-text: #f4f8f5;
    --pppoe-input: #0b1d1f;
    min-height:100vh; color:var(--pppoe-text); background:
      radial-gradient(ellipse 90% 55% at 80% -10%, color-mix(in srgb,var(--pppoe-primary) 25%,transparent), transparent 70%),
      linear-gradient(145deg,var(--pppoe-bg),var(--pppoe-bg-2));
    font-family:var(--isp-font-family,'DM Sans',system-ui,sans-serif);
    font-weight:var(--isp-font-weight,500); display:flex; flex-direction:column;
  }
  .pppoe-portal *, .pppoe-portal *::before, .pppoe-portal *::after { box-sizing:border-box; }
  .pppoe-portal button, .pppoe-portal input { font:inherit; }
  .pppoe-shell { width:min(1180px,100%); margin:0 auto; padding:0 26px; }
  .pppoe-header { height:72px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid rgba(255,255,255,.1); }
  .pppoe-brand { display:flex; align-items:center; gap:11px; min-width:0; }
  .pppoe-brand-mark { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; overflow:hidden; flex:none; background:linear-gradient(135deg,var(--pppoe-primary),var(--pppoe-accent)); box-shadow:0 8px 22px color-mix(in srgb,var(--pppoe-primary) 25%,transparent); }
  .pppoe-brand-mark img { width:100%; height:100%; object-fit:contain; }
  .pppoe-brand-name { color:var(--pppoe-text); font-size:.9rem; font-weight:850; letter-spacing:-.02em; white-space:nowrap; }
  .pppoe-brand-meta { color:rgba(244,248,245,.5); font-size:.66rem; margin-top:2px; }
  .pppoe-header-status { display:flex; align-items:center; gap:8px; padding:7px 11px; border:1px solid rgba(52,211,153,.24); border-radius:999px; color:#75e4bd; background:rgba(52,211,153,.08); font-size:.7rem; font-weight:750; white-space:nowrap; }
  .pppoe-live-dot { width:7px; height:7px; border-radius:50%; background:#34d399; box-shadow:0 0 0 4px rgba(52,211,153,.12); }
  .pppoe-main { width:min(1080px,100%); margin:0 auto; padding:58px 26px 72px; flex:1; }
  .pppoe-hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,.78fr); gap:58px; align-items:center; margin-bottom:42px; }
  .pppoe-eyebrow { display:inline-flex; align-items:center; gap:7px; color:var(--pppoe-accent); font-size:.67rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
  .pppoe-hero h1 { max-width:650px; margin:13px 0 14px; color:var(--pppoe-text); font-size:clamp(2.2rem,5vw,4.2rem); line-height:1.02; font-weight:900; letter-spacing:-.055em; }
  .pppoe-hero h1 span { background:linear-gradient(90deg,var(--pppoe-primary),var(--pppoe-accent)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .pppoe-hero-copy { max-width:550px; color:rgba(244,248,245,.62); font-size:1rem; line-height:1.7; margin:0; }
  .pppoe-hero-note { display:flex; flex-wrap:wrap; gap:9px; margin-top:25px; }
  .pppoe-note { display:inline-flex; align-items:center; gap:7px; padding:8px 11px; border:1px solid rgba(255,255,255,.11); border-radius:999px; color:rgba(244,248,245,.72); background:rgba(255,255,255,.045); font-size:.7rem; }
  .pppoe-hero-panel { padding:22px; border:1px solid rgba(255,255,255,.12); border-radius:19px; background:linear-gradient(155deg,rgba(255,255,255,.1),rgba(255,255,255,.035)); box-shadow:0 22px 55px rgba(0,0,0,.24); }
  .pppoe-hero-panel-head { display:flex; justify-content:space-between; gap:14px; padding-bottom:17px; border-bottom:1px solid rgba(255,255,255,.1); }
  .pppoe-hero-panel h2 { margin:0; color:var(--pppoe-text); font-size:1rem; font-weight:800; }
  .pppoe-hero-panel p { margin:5px 0 0; color:rgba(244,248,245,.5); font-size:.72rem; line-height:1.45; }
  .pppoe-panel-icon { width:34px; height:34px; display:grid; place-items:center; color:var(--pppoe-accent); border-radius:10px; background:color-mix(in srgb,var(--pppoe-primary) 18%,transparent); }
  .pppoe-hero-list { display:flex; flex-direction:column; gap:13px; padding-top:17px; }
  .pppoe-hero-list div { display:flex; align-items:flex-start; gap:10px; color:rgba(244,248,245,.7); font-size:.76rem; line-height:1.45; }
  .pppoe-hero-list svg { flex:none; color:#66d6b5; margin-top:1px; }
  .pppoe-alert { display:flex; align-items:flex-start; gap:10px; margin:0 0 27px; padding:13px 15px; border:1px solid color-mix(in srgb,var(--pppoe-primary) 35%,transparent); border-radius:11px; color:rgba(244,248,245,.82); background:color-mix(in srgb,var(--pppoe-primary) 12%,transparent); font-size:.78rem; line-height:1.5; }
  .pppoe-alert svg { flex:none; color:var(--pppoe-accent); margin-top:1px; }
  .pppoe-alert.maintenance { border-color:rgba(245,158,11,.3); background:rgba(245,158,11,.1); }
  .pppoe-content-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(260px,.62fr); gap:18px; align-items:start; }
  .pppoe-card { border:1px solid rgba(255,255,255,.12); border-radius:17px; background:var(--pppoe-card); box-shadow:0 18px 45px rgba(0,0,0,.18); overflow:hidden; }
  .pppoe-card-head { display:flex; align-items:flex-start; gap:12px; padding:20px 22px 17px; border-bottom:1px solid rgba(255,255,255,.1); }
  .pppoe-card-icon { width:33px; height:33px; display:grid; place-items:center; flex:none; border-radius:10px; color:var(--pppoe-accent); background:color-mix(in srgb,var(--pppoe-primary) 17%,transparent); }
  .pppoe-card-head h2 { margin:0; color:var(--pppoe-text); font-size:.95rem; font-weight:800; }
  .pppoe-card-head p { margin:4px 0 0; color:rgba(244,248,245,.5); font-size:.72rem; line-height:1.45; }
  .pppoe-tabs { display:flex; gap:4px; padding:5px; margin:19px 22px 0; border:1px solid rgba(255,255,255,.1); border-radius:11px; background:rgba(0,0,0,.18); }
  .pppoe-tab { flex:1; border:0; border-radius:8px; padding:10px 8px; color:rgba(244,248,245,.5); background:transparent; font-size:.72rem; font-weight:750; cursor:pointer; transition:all .16s ease; }
  .pppoe-tab:hover { color:var(--pppoe-text); background:rgba(255,255,255,.05); }
  .pppoe-tab.active { color:#fff; background:var(--pppoe-primary); box-shadow:0 5px 15px color-mix(in srgb,var(--pppoe-primary) 25%,transparent); }
  .pppoe-form { padding:22px; }
  .pppoe-field { margin-bottom:16px; }
  .pppoe-field label { display:block; margin-bottom:7px; color:rgba(244,248,245,.72); font-size:.69rem; font-weight:750; letter-spacing:.08em; text-transform:uppercase; }
  .pppoe-input { display:block; width:100%; min-height:45px; padding:11px 13px; border:1px solid rgba(255,255,255,.13); border-radius:9px; outline:none; color:var(--pppoe-text); background:var(--pppoe-input); font-size:.82rem; transition:border-color .16s,box-shadow .16s; }
  .pppoe-input::placeholder { color:rgba(244,248,245,.27); }
  .pppoe-input:focus { border-color:var(--pppoe-primary); box-shadow:0 0 0 3px color-mix(in srgb,var(--pppoe-primary) 17%,transparent); }
  .pppoe-input-wrap { position:relative; }
  .pppoe-input-wrap .pppoe-input { padding-right:45px; }
  .pppoe-icon-button { position:absolute; right:11px; top:50%; transform:translateY(-50%); display:grid; place-items:center; border:0; padding:2px; color:rgba(244,248,245,.5); background:transparent; cursor:pointer; }
  .pppoe-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:45px; padding:11px 16px; border:1px solid transparent; border-radius:9px; color:#fff; font-size:.8rem; font-weight:800; cursor:pointer; transition:transform .16s,box-shadow .16s,opacity .16s; }
  .pppoe-button:hover:not(:disabled) { transform:translateY(-1px); }
  .pppoe-button:disabled { cursor:not-allowed; opacity:.56; }
  .pppoe-button-primary { background:linear-gradient(135deg,var(--pppoe-primary),var(--pppoe-accent)); box-shadow:0 8px 18px color-mix(in srgb,var(--pppoe-primary) 22%,transparent); }
  .pppoe-button-secondary { color:var(--pppoe-accent); border-color:color-mix(in srgb,var(--pppoe-primary) 35%,transparent); background:color-mix(in srgb,var(--pppoe-primary) 10%,transparent); }
  .pppoe-form-note { margin:15px 0 0; color:rgba(244,248,245,.42); font-size:.72rem; line-height:1.5; text-align:center; }
  .pppoe-link-button { border:0; padding:0; color:var(--pppoe-accent); background:transparent; font-weight:750; cursor:pointer; }
  .pppoe-result { padding:42px 22px 45px; text-align:center; }
  .pppoe-result-icon { width:66px; height:66px; display:grid; place-items:center; margin:0 auto 19px; border:1px solid rgba(52,211,153,.35); border-radius:50%; color:#66d6b5; background:rgba(52,211,153,.1); }
  .pppoe-result .pppoe-eyebrow { color:#66d6b5; }
  .pppoe-result h2 { margin:10px 0 8px; color:var(--pppoe-text); font-size:1.28rem; font-weight:850; }
  .pppoe-result p { max-width:330px; margin:0 auto 22px; color:rgba(244,248,245,.55); font-size:.8rem; line-height:1.6; }
  .pppoe-result .pppoe-button { width:auto; min-width:150px; }
  .pppoe-side-stack { display:flex; flex-direction:column; gap:18px; }
  .pppoe-side-card { padding:19px; }
  .pppoe-side-card h3 { display:flex; align-items:center; gap:8px; margin:0 0 13px; color:var(--pppoe-text); font-size:.83rem; font-weight:800; }
  .pppoe-side-card h3 svg { color:var(--pppoe-accent); }
  .pppoe-side-card p { margin:0; color:rgba(244,248,245,.55); font-size:.74rem; line-height:1.6; white-space:pre-line; }
  .pppoe-side-card a { display:flex; align-items:center; gap:9px; margin-top:11px; color:var(--pppoe-accent); font-size:.76rem; text-decoration:none; }
  .pppoe-side-card a:hover { text-decoration:underline; }
  .pppoe-advert { margin-top:18px; border:1px solid rgba(255,255,255,.12); border-radius:13px; overflow:hidden; background:rgba(255,255,255,.04); }
  .pppoe-advert img { display:block; width:100%; max-height:190px; object-fit:cover; }
  .pppoe-footer { padding:20px 26px 25px; border-top:1px solid rgba(255,255,255,.1); text-align:center; }
  .pppoe-footer p { margin:0; color:rgba(244,248,245,.37); font-size:.68rem; }
  .pppoe-footer-links { display:flex; justify-content:center; flex-wrap:wrap; gap:16px; margin-bottom:9px; }
  .pppoe-footer-links a { color:rgba(244,248,245,.55); font-size:.7rem; text-decoration:none; }
  .pppoe-footer-links a:hover { color:var(--pppoe-accent); }
  @media (max-width: 820px) { .pppoe-hero { grid-template-columns:1fr; gap:25px; } .pppoe-hero-panel { max-width:560px; } .pppoe-content-grid { grid-template-columns:1fr; } .pppoe-side-stack { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width: 580px) { .pppoe-shell,.pppoe-main { padding-left:16px; padding-right:16px; } .pppoe-header { height:64px; } .pppoe-header-status { padding:6px 8px; font-size:.62rem; } .pppoe-brand-meta { display:none; } .pppoe-main { padding-top:35px; padding-bottom:48px; } .pppoe-hero h1 { font-size:2.42rem; } .pppoe-hero-note { gap:7px; } .pppoe-note { font-size:.63rem; padding:7px 9px; } .pppoe-tabs { margin-inline:14px; } .pppoe-tab { font-size:.64rem; padding:9px 5px; } .pppoe-form { padding:18px 14px 20px; } .pppoe-side-stack { display:flex; } }
  @media (prefers-reduced-motion: reduce) { .pppoe-portal * { scroll-behavior:auto !important; transition:none !important; } }
`;

export function PPPoELogin({
  previewSettings,
  embedded = false,
}: {
  previewSettings?: PppoePortalSettings;
  embedded?: boolean;
}) {
  const brand = useBrand();
  const [storedSettings] = useState(loadSettings);
  const settings = previewSettings ?? storedSettings;
  const [tab, setTab] = useState<"login" | "forgot" | "voucher">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [resetPhone, setResetPhone] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const ispName = settings.ispName.trim() || brand.ispName || "Your ISP";
  const phone = settings.supportPhone.trim();
  const email = settings.supportEmail.trim();
  const whatsapp = settings.whatsappNumber.replace(/\D/g, "");
  const colors = settings.colors;
  const style = {
    "--pppoe-bg": colors.bgColor,
    "--pppoe-bg-2": colors.bgColor2,
    "--pppoe-primary": colors.primaryColor,
    "--pppoe-accent": colors.accentColor,
    "--pppoe-card": colors.cardColor,
    "--pppoe-button": colors.buttonColor,
    "--pppoe-text": colors.textColor,
    "--pppoe-input": colors.inputBgColor,
  } as React.CSSProperties;
  const showVoucher = settings.enableVouchers === "Yes";
  const maintenance = settings.maintenanceMode === "Maintenance";
  const safePhone = phoneHref(phone);
  const safeTerms = safeExternalUrl(settings.termsUrl);
  const safePrivacy = safeExternalUrl(settings.privacyUrl);
  const logoUrl = safeImageSource(settings.logoUrl);
  const advertUrl = safeImageSource(settings.advertUrl);
  const advertEnabled = settings.enableAdvert === "Enable" && Boolean(advertUrl);
  const advert = advertEnabled ? (
    <div className="pppoe-advert"><img src={advertUrl} alt="Service announcement" /></div>
  ) : null;

  useEffect(() => {
    if (!embedded) document.title = `${ispName} — PPPoE Portal`;
  }, [embedded, ispName]);

  const tabs = useMemo(() => [
    { id: "login" as const, label: "Sign in" },
    { id: "forgot" as const, label: "Reset access" },
    ...(showVoucher ? [{ id: "voucher" as const, label: "Voucher" }] : []),
  ], [showVoucher]);

  function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLogging(true);
    window.setTimeout(() => { setLogging(false); setLogged(true); }, 900);
  }
  function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setResetting(true);
    window.setTimeout(() => { setResetting(false); setResetSent(true); }, 900);
  }
  function handleVoucher(event: React.FormEvent) {
    event.preventDefault();
    setActivating(true);
    window.setTimeout(() => { setActivating(false); setActivated(true); }, 900);
  }

  return (
    <div className={`pppoe-portal ${embedded ? "pppoe-portal-embedded" : ""}`} style={style}>
      <style>{PORTAL_CSS}</style>
      <header className="pppoe-header pppoe-shell">
        <div className="pppoe-brand">
          <div className="pppoe-brand-mark">
            {logoUrl ? <img src={logoUrl} alt="" /> : <Wifi size={18} color="#fff" />}
          </div>
          <div>
            <div className="pppoe-brand-name">{ispName}</div>
            <div className="pppoe-brand-meta">PPPoE customer portal</div>
          </div>
        </div>
        <div className="pppoe-header-status"><span className="pppoe-live-dot" /> Network online</div>
      </header>

      <main className="pppoe-main">
        <section className="pppoe-hero">
          <div>
            <span className="pppoe-eyebrow"><Router size={13} /> Broadband access</span>
            <h1>Internet that <span>keeps up.</span></h1>
            <p className="pppoe-hero-copy">{settings.tagline || "Manage your PPPoE account, track usage, and renew your connection with confidence."}</p>
            <div className="pppoe-hero-note">
              <span className="pppoe-note"><Zap size={13} /> Reliable speeds</span>
              <span className="pppoe-note"><ShieldCheck size={13} /> Secure access</span>
              <span className="pppoe-note"><LifeBuoy size={13} /> Human support</span>
            </div>
          </div>
          <div className="pppoe-hero-panel">
            <div className="pppoe-hero-panel-head">
              <div><h2>Your connection, in control</h2><p>One place to access your broadband account.</p></div>
              <div className="pppoe-panel-icon"><Wifi size={17} /></div>
            </div>
            <div className="pppoe-hero-list">
              <div><Check size={15} /> View your access status and sign in securely.</div>
              <div><Check size={15} /> Reset credentials without waiting on a visit.</div>
              {showVoucher && <div><Check size={15} /> Renew quickly with a voucher code.</div>}
            </div>
          </div>
        </section>

        {(settings.announcement.trim() || maintenance) && (
          <div className={`pppoe-alert ${maintenance ? "maintenance" : ""}`}>
            <HelpCircle size={16} />
            <span>{maintenance ? settings.maintenanceMessage : settings.announcement}</span>
          </div>
        )}

        {settings.advertPos === "Top" && advert}

        <section className="pppoe-content-grid">
          <div className="pppoe-card">
            <div className="pppoe-card-head">
              <div className="pppoe-card-icon">{tab === "login" ? <UserRound size={16} /> : tab === "forgot" ? <KeyRound size={16} /> : <Ticket size={16} />}</div>
              <div>
                <h2>{tab === "login" ? "Member access" : tab === "forgot" ? "Recover your access" : "Redeem a voucher"}</h2>
                <p>{tab === "login" ? "Use the credentials provided for your PPPoE connection." : tab === "forgot" ? "We’ll help you get back online securely." : "Apply a voucher to renew your PPPoE subscription."}</p>
              </div>
            </div>
            <div className="pppoe-tabs" role="tablist" aria-label="PPPoE account actions">
              {tabs.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={`pppoe-tab ${tab === item.id ? "active" : ""}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "login" && (
              logged ? (
                <ResultState
                  icon={<CheckCircle2 size={31} />}
                  eyebrow="Access confirmed"
                  title="Welcome back"
                  message={<>Your PPPoE session is ready. You can now close this page and continue browsing.</>}
                  action={<PortalButton type="button" variant="secondary" onClick={() => { setLogged(false); setUsername(""); setPassword(""); }}>Sign out</PortalButton>}
                />
              ) : (
                <form className="pppoe-form" onSubmit={handleLogin}>
                  <div className="pppoe-field">
                    <label htmlFor="pppoe-username">Username</label>
                    <PortalInput id="pppoe-username" type="text" required value={username} onChange={event => setUsername(event.target.value)} placeholder="your_username" autoComplete="username" />
                  </div>
                  <div className="pppoe-field">
                    <label htmlFor="pppoe-password">Password</label>
                    <div className="pppoe-input-wrap">
                      <PortalInput id="pppoe-password" type={showPw ? "text" : "password"} required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" />
                      <button className="pppoe-icon-button" type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(value => !value)}>
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <PortalButton type="submit" disabled={logging}>{logging ? "Signing you in…" : <>Sign in <ArrowRight size={15} /></>}</PortalButton>
                  <p className="pppoe-form-note">Forgot your credentials? <button type="button" className="pppoe-link-button" onClick={() => setTab("forgot")}>Reset them here</button></p>
                </form>
              )
            )}

            {tab === "forgot" && (
              resetSent ? (
                <ResultState
                  icon={<Send size={28} />}
                  eyebrow="Request received"
                  title="Check your phone"
                  message={<>Our support team will contact <strong>{resetPhone}</strong> with your new credentials.</>}
                  action={<PortalButton type="button" variant="secondary" onClick={() => { setResetSent(false); setResetPhone(""); }}>Send another request</PortalButton>}
                />
              ) : (
                <form className="pppoe-form" onSubmit={handleReset}>
                  <div className="pppoe-field">
                    <label htmlFor="pppoe-reset-phone">Registered phone number</label>
                    <PortalInput id="pppoe-reset-phone" type="tel" required value={resetPhone} onChange={event => setResetPhone(event.target.value)} placeholder="07XX XXX XXX" autoComplete="tel" />
                  </div>
                  <PortalButton type="submit" disabled={resetting} variant="secondary">{resetting ? "Sending request…" : <>Request a reset <ArrowRight size={15} /></>}</PortalButton>
                  <p className="pppoe-form-note">We’ll use the number on your account to verify the request.</p>
                </form>
              )
            )}

            {tab === "voucher" && showVoucher && (
              activated ? (
                <ResultState
                  icon={<Check size={32} />}
                  eyebrow="Voucher applied"
                  title="You’re renewed"
                  message="Your subscription has been renewed. Enjoy your connection."
                  action={<PortalButton type="button" variant="secondary" onClick={() => { setActivated(false); setCode(""); }}>Redeem another</PortalButton>}
                />
              ) : (
                <form className="pppoe-form" onSubmit={handleVoucher}>
                  <div className="pppoe-field">
                    <label htmlFor="pppoe-voucher">Voucher code</label>
                    <PortalInput id="pppoe-voucher" type="text" required value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={20} style={{ textAlign: "center", fontFamily: "monospace", letterSpacing: ".12em" }} />
                  </div>
                  <PortalButton type="submit" disabled={activating}>{activating ? "Activating…" : <>Activate voucher <ArrowRight size={15} /></>}</PortalButton>
                  <p className="pppoe-form-note">Enter the voucher exactly as it appears on your receipt.</p>
                </form>
              )
            )}
          </div>

          <aside className="pppoe-side-stack">
            {(phone || email || whatsapp) && (
              <div className="pppoe-card pppoe-side-card">
                <h3><MessageCircle size={15} /> Need a hand?</h3>
                <p>Our support team is ready to help you get connected.</p>
                {safePhone && <a href={`tel:${safePhone}`}><LockKeyhole size={14} /> {phone}</a>}
                {email && <a href={`mailto:${email}`}><Mail size={14} /> {email}</a>}
                {whatsapp && <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Chat on WhatsApp</a>}
              </div>
            )}
            {settings.testimonials === "Enable" && (
              <div className="pppoe-card pppoe-side-card">
                <h3><CheckCircle2 size={15} /> What customers say</h3>
                <p>“{settings.testimonialText}”</p>
              </div>
            )}
            {settings.faqSection === "Enable" && (
              <div className="pppoe-card pppoe-side-card">
                <h3><HelpCircle size={15} /> Frequently asked</h3>
                <p>{settings.faqText}</p>
              </div>
            )}
            {settings.advertPos === "Middle" && advert}
          </aside>
        </section>
        {settings.advertPos === "Bottom" && advert}
      </main>

      <footer className="pppoe-footer">
        <div className="pppoe-footer-links">
          {safeTerms && <a href={safeTerms} target="_blank" rel="noreferrer">Terms of service</a>}
          {safePrivacy && <a href={safePrivacy} target="_blank" rel="noreferrer">Privacy policy</a>}
          {safePhone && <a href={`tel:${safePhone}`}>Contact support</a>}
        </div>
        <p>© {new Date().getFullYear()} {ispName} · Secure PPPoE customer access</p>
      </footer>
    </div>
  );
}

export default function PPPoELoginRoute() {
  return <PPPoELogin />;
}