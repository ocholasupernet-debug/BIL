import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useBrand } from "@/context/BrandContext";
import { supabase, ADMIN_ID as AUTH_ADMIN_ID, getSelectedTenantId } from "@/lib/supabase";
import type { DbRouter } from "@/lib/supabase";
import {
  AlertCircle, ArrowDownToLine, Check, ChevronDown, CircleHelp, Eye,
  Image, Info, LayoutTemplate, Link2, Loader2, Mail, Palette, Phone,
  Save, ShieldCheck, Smartphone, Sparkles, Upload, Wifi, X,
} from "lucide-react";

const ADMIN_ID = getSelectedTenantId() ?? AUTH_ADMIN_ID;
const STORAGE_KEY = `hotspot_settings_${ADMIN_ID}`;
const PUBLIC_BASE_DOMAIN = "isplatty.org";

const DEFAULT_COLORS = {
  bgColor: "#0d0415",
  bgColor2: "#1a0735",
  primaryColor: "#8b5cf6",
  accentColor: "#d946ef",
  cardColor: "#1a0f2e",
  buttonColor: "#10b981",
  textColor: "#ffffff",
  inputBgColor: "#000000",
};

type ColorSettings = typeof DEFAULT_COLORS;

interface HSettings {
  ispName: string;
  freeTrial: string;
  vouchers: string;
  tagline: string;
  routerId: string;
  advertPos: string;
  enableAdvert: string;
  testimonials: string;
  faqSection: string;
  logoUrl: string;
  advertUrl: string;
  announcement: string;
  paymentInstructions: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  termsUrl: string;
  privacyUrl: string;
  maintenanceMode: string;
  maintenanceMessage: string;
  testimonialText: string;
  faqText: string;
  colors: ColorSettings;
}

const DEFAULT_SETTINGS: HSettings = {
  ispName: "OCHOLASUPERNET",
  freeTrial: "Disable",
  vouchers: "Yes",
  tagline: "Fast & Reliable Internet",
  routerId: "",
  advertPos: "Bottom",
  enableAdvert: "Disable",
  testimonials: "Disable",
  faqSection: "Disable",
  logoUrl: "",
  advertUrl: "",
  announcement: "",
  paymentInstructions: "Enter your M-Pesa number and approve the prompt to connect instantly.",
  supportPhone: "",
  supportEmail: "",
  whatsappNumber: "",
  termsUrl: "",
  privacyUrl: "",
  maintenanceMode: "Online",
  maintenanceMessage: "We are making a few improvements. Please check back shortly.",
  testimonialText: "Fast, reliable Wi-Fi whenever I need it.",
  faqText: "How do I connect?\nChoose a package, complete payment, then sign in with the credentials you receive.",
  colors: DEFAULT_COLORS,
};

function loadSettings(): HSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_COLORS } };
    const parsed = JSON.parse(raw) as Partial<HSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      colors: { ...DEFAULT_COLORS, ...(parsed.colors ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_COLORS } };
  }
}

function safeText(value: string, fallback = ""): string {
  return value.trim() || fallback;
}

function isValidPublicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !!url.hostname &&
      !/^(localhost|127\.|0\.0\.0\.0)/i.test(url.hostname);
  } catch {
    return false;
  }
}

function portalOriginFromBrand(domain: string): string {
  const value = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!value) return `https://${PUBLIC_BASE_DOMAIN}`;
  const hostname = value.toLowerCase();
  if (hostname === PUBLIC_BASE_DOMAIN || hostname.endsWith(`.${PUBLIC_BASE_DOMAIN}`)) {
    return `https://${hostname}`;
  }
  if (hostname === "admin") return `https://${PUBLIC_BASE_DOMAIN}`;
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) {
    return `https://${hostname}.${PUBLIC_BASE_DOMAIN}`;
  }
  const candidate = `https://${value}`;
  return isValidPublicOrigin(candidate) ? candidate : `https://${PUBLIC_BASE_DOMAIN}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function safeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function validateSettings(settings: HSettings): string | null {
  if (!safeText(settings.ispName)) return "Enter an ISP name before exporting the portal.";
  if (!safeText(settings.tagline)) return "Enter a short tagline before exporting the portal.";
  for (const [label, value] of [
    ["Terms URL", settings.termsUrl],
    ["Privacy URL", settings.privacyUrl],
  ] as const) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return `${label} must use HTTPS.`;
    } catch {
      return `${label} must be a valid HTTPS link.`;
    }
  }
  return null;
}

type ExportConfig = {
  adminId: number;
  apiBase: string;
  ispName: string;
  tagline: string;
  logoUrl: string;
  advertUrl: string;
  advertEnabled: boolean;
  advertPosition: string;
  vouchersEnabled: boolean;
  freeTrialEnabled: boolean;
  announcement: string;
  paymentInstructions: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  termsUrl: string;
  privacyUrl: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  testimonialsEnabled: boolean;
  testimonialText: string;
  faqEnabled: boolean;
  faqText: string;
  colors: ColorSettings;
};

function makeExportConfig(settings: HSettings, apiBase: string): ExportConfig {
  return {
    adminId: ADMIN_ID,
    apiBase,
    ispName: safeText(settings.ispName, DEFAULT_SETTINGS.ispName),
    tagline: safeText(settings.tagline, DEFAULT_SETTINGS.tagline),
    logoUrl: settings.logoUrl,
    advertUrl: settings.advertUrl,
    advertEnabled: settings.enableAdvert === "Enable" && !!settings.advertUrl,
    advertPosition: settings.advertPos,
    vouchersEnabled: settings.vouchers === "Yes",
    freeTrialEnabled: settings.freeTrial === "Enable",
    announcement: settings.announcement.trim(),
    paymentInstructions: safeText(settings.paymentInstructions, DEFAULT_SETTINGS.paymentInstructions),
    supportPhone: settings.supportPhone.trim(),
    supportEmail: settings.supportEmail.trim(),
    whatsappNumber: settings.whatsappNumber.trim(),
    termsUrl: settings.termsUrl.trim(),
    privacyUrl: settings.privacyUrl.trim(),
    maintenanceMode: settings.maintenanceMode === "Maintenance",
    maintenanceMessage: safeText(settings.maintenanceMessage, DEFAULT_SETTINGS.maintenanceMessage),
    testimonialsEnabled: settings.testimonials === "Enable",
    testimonialText: safeText(settings.testimonialText, DEFAULT_SETTINGS.testimonialText),
    faqEnabled: settings.faqSection === "Enable",
    faqText: safeText(settings.faqText, DEFAULT_SETTINGS.faqText),
    colors: { ...DEFAULT_COLORS, ...settings.colors },
  };
}

async function resolvePortalApiBase(domain: string): Promise<string> {
  try {
    const response = await fetch(`/api/public/typography?adminId=${encodeURIComponent(String(ADMIN_ID))}`, {
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json() as { apiBase?: unknown };
      if (typeof data.apiBase === "string" && isValidPublicOrigin(data.apiBase)) {
        return data.apiBase.replace(/\/$/, "");
      }
    }
  } catch {
    /* The tenant-derived public origin below remains deterministic offline. */
  }
  return portalOriginFromBrand(domain);
}

async function buildPortalHtml(settings: HSettings, domain: string): Promise<string> {
  const response = await fetch("/hotspot/login.html", { cache: "no-store" });
  if (!response.ok) throw new Error("The captive-portal template could not be loaded.");
  const template = await response.text();
  const apiBase = await resolvePortalApiBase(domain);
  const config = makeExportConfig(settings, apiBase);
  const bootstrap = `<script>window.__HOTSPOT_CONFIG__=${safeEmbeddedJson(config)};</script>`;
  const configuredTitle = escapeHtml(config.ispName);
  return template
    .replace("</head>", `${bootstrap}\n</head>`)
    .replace(/\$\(login-title\)/g, configuredTitle);
}

const STYLES = `
  .hs-page { max-width: 1220px; margin: 0 auto; padding: 30px 34px 56px; }
  .hs-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:26px; }
  .hs-eyebrow { display:flex; align-items:center; gap:8px; color:var(--isp-accent); font-size:.68rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; margin-bottom:8px; }
  .hs-title { margin:0; color:var(--isp-text); font-size:1.65rem; line-height:1.15; font-weight:850; letter-spacing:-.04em; }
  .hs-subtitle { margin:8px 0 0; color:var(--isp-text-muted); font-size:.85rem; max-width:590px; line-height:1.55; }
  .hs-actions { display:flex; align-items:center; justify-content:flex-end; gap:9px; flex-wrap:wrap; }
  .hs-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:8px 14px; border-radius:9px; border:1px solid transparent; font:600 .78rem inherit; cursor:pointer; transition:all .16s ease; white-space:nowrap; }
  .hs-btn:disabled { cursor:not-allowed; opacity:.55; }
  .hs-btn-primary { background:var(--isp-accent); border-color:var(--isp-accent); color:#fff; box-shadow:0 4px 13px var(--isp-accent-glow); }
  .hs-btn-primary:hover:not(:disabled) { background:var(--isp-accent-strong); transform:translateY(-1px); }
  .hs-btn-soft { background:var(--isp-accent-glow); border-color:var(--isp-accent-border); color:var(--isp-accent-strong); }
  .hs-btn-soft:hover:not(:disabled) { background:var(--isp-accent-border); }
  .hs-btn-quiet { background:var(--isp-input-bg); border-color:var(--isp-border); color:var(--isp-text-muted); }
  .hs-btn-quiet:hover:not(:disabled) { color:var(--isp-text); background:var(--isp-hover); }
  .hs-grid { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr); gap:18px; align-items:start; }
  .hs-stack { display:flex; flex-direction:column; gap:18px; }
  .hs-card { background:var(--isp-section); border:1px solid var(--isp-border); border-radius:15px; box-shadow:var(--shadow-card); overflow:hidden; }
  .hs-card-head { display:flex; align-items:flex-start; gap:12px; padding:17px 20px 15px; border-bottom:1px solid var(--isp-border-subtle); }
  .hs-card-icon { display:flex; align-items:center; justify-content:center; flex:0 0 32px; width:32px; height:32px; border-radius:9px; color:var(--isp-accent); background:var(--isp-accent-glow); border:1px solid var(--isp-accent-border); }
  .hs-card-title { margin:0; color:var(--isp-text); font-size:.92rem; font-weight:800; }
  .hs-card-desc { margin:3px 0 0; color:var(--isp-text-muted); font-size:.72rem; line-height:1.45; }
  .hs-card-body { padding:4px 20px 8px; }
  .hs-field { display:grid; grid-template-columns:minmax(150px,.62fr) minmax(0,1.38fr); gap:20px; padding:17px 0; border-bottom:1px solid var(--isp-border-subtle); }
  .hs-field:last-child { border-bottom:0; }
  .hs-label { display:block; color:var(--isp-text); font-size:.78rem; font-weight:750; line-height:1.3; }
  .hs-help { margin:5px 0 0; color:var(--isp-text-sub); font-size:.68rem; line-height:1.45; }
  .hs-control { min-width:0; }
  .hs-input, .hs-select, .hs-textarea { width:100%; color:var(--isp-text); background:var(--isp-input-bg); border:1px solid var(--isp-input-border); border-radius:8px; padding:10px 12px; font:500 .78rem inherit; outline:none; transition:border-color .15s, box-shadow .15s; }
  .hs-input:focus, .hs-select:focus, .hs-textarea:focus { border-color:var(--isp-accent); box-shadow:0 0 0 3px var(--isp-accent-glow); }
  .hs-input::placeholder, .hs-textarea::placeholder { color:var(--isp-text-sub); }
  .hs-textarea { min-height:80px; resize:vertical; line-height:1.5; }
  .hs-select-wrap { position:relative; }
  .hs-select { appearance:none; padding-right:34px; cursor:pointer; }
  .hs-select-wrap svg { position:absolute; right:11px; top:50%; transform:translateY(-50%); pointer-events:none; color:var(--isp-text-sub); }
  .hs-upload { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .hs-file { display:none; }
  .hs-file-preview { display:flex; align-items:center; gap:8px; color:var(--isp-text-muted); font-size:.7rem; }
  .hs-file-preview img { width:42px; height:32px; border-radius:6px; border:1px solid var(--isp-border); object-fit:contain; background:#061416; }
  .hs-status { display:flex; align-items:flex-start; gap:9px; padding:11px 13px; border-radius:9px; font-size:.74rem; line-height:1.45; }
  .hs-status-error { color:#fca5a5; background:rgba(239,68,68,.09); border:1px solid rgba(239,68,68,.22); }
  .hs-status-success { color:#86efac; background:rgba(34,197,94,.09); border:1px solid rgba(34,197,94,.2); }
  .hs-status-info { color:var(--isp-text-muted); background:var(--isp-input-bg); border:1px solid var(--isp-border); }
  .hs-status strong { color:inherit; }
  .hs-color-grid { display:grid; grid-template-columns:repeat(4,minmax(68px,1fr)); gap:16px 12px; padding:19px 0 8px; }
  .hs-color { text-align:center; min-width:0; }
  .hs-color input { display:block; width:100%; height:42px; padding:3px; border:1px solid var(--isp-border); border-radius:8px; background:var(--isp-input-bg); cursor:pointer; }
  .hs-color label { display:block; margin-top:6px; color:var(--isp-text-muted); font-size:.63rem; line-height:1.25; }
  .hs-color code { display:block; margin-top:3px; color:var(--isp-text-sub); font-size:.58rem; }
  .hs-presets { display:flex; gap:8px; flex-wrap:wrap; padding:15px 0 8px; border-top:1px solid var(--isp-border-subtle); }
  .hs-preset { display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--isp-border); border-radius:8px; background:var(--isp-input-bg); color:var(--isp-text-muted); font:600 .67rem inherit; cursor:pointer; }
  .hs-preset:hover { color:var(--isp-text); border-color:var(--isp-accent-border); }
  .hs-swatches { display:flex; gap:3px; }
  .hs-swatches i { display:block; width:11px; height:11px; border-radius:3px; }
  .hs-side-card { background:linear-gradient(155deg,var(--isp-card),var(--isp-inner-card)); }
  .hs-side-body { padding:17px 18px 19px; }
  .hs-preview-screen { min-height:270px; overflow:hidden; border-radius:11px; border:1px solid var(--isp-border); background:linear-gradient(145deg,#081018,#122137); position:relative; }
  .hs-preview-screen::before { content:""; position:absolute; inset:0; opacity:.35; background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px); background-size:26px 26px; }
  .hs-mini-content { position:relative; padding:17px 14px; text-align:center; color:#fff; }
  .hs-mini-logo { width:34px; height:34px; margin:0 auto 10px; border-radius:10px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:linear-gradient(135deg,var(--mini-primary),var(--mini-accent)); }
  .hs-mini-logo img { width:100%; height:100%; object-fit:contain; }
  .hs-mini-content h3 { color:#fff; margin:0; font-size:1rem; font-weight:850; }
  .hs-mini-content p { color:rgba(255,255,255,.55); margin:5px auto 16px; font-size:.65rem; line-height:1.4; }
  .hs-mini-plans { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; text-align:left; }
  .hs-mini-plan { padding:9px; border-radius:8px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1); }
  .hs-mini-plan b { display:block; color:#fff; font-size:.66rem; }
  .hs-mini-plan span { display:block; color:var(--mini-primary); margin-top:5px; font-size:.62rem; font-weight:700; }
  .hs-mini-button { margin-top:12px; padding:9px; border-radius:8px; background:var(--mini-button); color:#fff; font-size:.65rem; font-weight:800; }
  .hs-side-note { display:flex; align-items:flex-start; gap:8px; margin-top:13px; color:var(--isp-text-muted); font-size:.69rem; line-height:1.45; }
  .hs-checklist { display:flex; flex-direction:column; gap:10px; margin:0; padding:0; list-style:none; }
  .hs-checklist li { display:flex; align-items:flex-start; gap:8px; color:var(--isp-text-muted); font-size:.72rem; line-height:1.4; }
  .hs-checklist svg { flex:0 0 auto; margin-top:1px; color:var(--isp-green); }
  .hs-foot-actions { display:flex; align-items:center; justify-content:flex-end; gap:9px; padding-top:4px; }
  .hs-modal-backdrop { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:22px; background:rgba(1,7,9,.82); backdrop-filter:blur(8px); }
  .hs-modal { width:min(1180px,96vw); height:min(88vh,820px); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#081416; box-shadow:0 30px 100px rgba(0,0,0,.55); }
  .hs-modal-head { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:13px 16px; border-bottom:1px solid rgba(255,255,255,.1); background:#102426; }
  .hs-modal-title { display:flex; align-items:center; gap:9px; color:#e7efea; font-size:.82rem; font-weight:800; }
  .hs-modal-copy { color:#8da09d; font-size:.67rem; margin:3px 0 0; }
  .hs-modal-close { display:flex; align-items:center; gap:6px; padding:7px 10px; border-radius:7px; border:1px solid rgba(248,113,113,.25); background:rgba(248,113,113,.08); color:#fca5a5; font:700 .68rem inherit; cursor:pointer; }
  .hs-modal-frame { flex:1; min-height:0; border:0; background:#02090f; }
  @media (max-width: 900px) { .hs-grid { grid-template-columns:1fr; } .hs-side { display:grid; grid-template-columns:1fr 1fr; gap:18px; } }
  @media (max-width: 680px) { .hs-page { padding:22px 15px 42px; } .hs-hero { display:block; } .hs-actions { justify-content:flex-start; margin-top:18px; } .hs-field { grid-template-columns:1fr; gap:8px; } .hs-card-body { padding-inline:15px; } .hs-card-head { padding-inline:15px; } .hs-color-grid { grid-template-columns:repeat(4,1fr); gap:12px 7px; } .hs-side { display:flex; flex-direction:column; } .hs-foot-actions { justify-content:stretch; } .hs-foot-actions .hs-btn { flex:1; } }
`;

function Section({
  icon, title, description, children, className = "",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hs-card ${className}`}>
      <div className="hs-card-head">
        <div className="hs-card-icon">{icon}</div>
        <div>
          <h2 className="hs-card-title">{title}</h2>
          <p className="hs-card-desc">{description}</p>
        </div>
      </div>
      <div className="hs-card-body">{children}</div>
    </section>
  );
}

function Field({
  label, help, children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hs-field">
      <div>
        <label className="hs-label">{label}</label>
        {help && <p className="hs-help">{help}</p>}
      </div>
      <div className="hs-control">{children}</div>
    </div>
  );
}

function SelectField({
  value, onChange, options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="hs-select-wrap">
      <select className="hs-select" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}

function FilePicker({
  label, value, accept, onSelect,
}: {
  label: string;
  value: string;
  accept: string;
  onSelect: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="hs-upload">
      <button type="button" className="hs-btn hs-btn-quiet" onClick={() => ref.current?.click()}>
        <Upload size={14} /> {label}
      </button>
      <input
        ref={ref}
        className="hs-file"
        type="file"
        accept={accept}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.currentTarget.value = "";
        }}
      />
      <div className="hs-file-preview">
        {value && <img src={value} alt="" />}
        <span>{value ? "Image ready" : "No image selected"}</span>
      </div>
    </div>
  );
}

function ColorPicker({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="hs-color">
      <input aria-label={label} type="color" value={value} onChange={event => onChange(event.target.value)} />
      <label>{label}</label>
      <code>{value}</code>
    </div>
  );
}

function PreviewModal({
  url, loading, onClose,
}: {
  url: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="hs-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hotspot portal preview">
      <div className="hs-modal">
        <div className="hs-modal-head">
          <div>
            <div className="hs-modal-title"><Eye size={15} /> Captive-portal preview</div>
            <p className="hs-modal-copy">This is the exact generated HTML that the download action produces.</p>
          </div>
          <button type="button" className="hs-modal-close" onClick={onClose}><X size={13} /> Close</button>
        </div>
        {loading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#a3b5af", gap: 9 }}>
            <Loader2 size={18} className="animate-spin" /> Preparing preview…
          </div>
        )}
        {!loading && url && (
          <iframe className="hs-modal-frame" title="Generated hotspot portal" src={url} sandbox="allow-forms allow-modals allow-scripts allow-same-origin" />
        )}
      </div>
    </div>
  );
}

export default function HotspotSettings() {
  const brand = useBrand();
  const [settings, setSettings] = useState<HSettings>(loadSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const { data: routers = [], isLoading: routersLoading } = useQuery<DbRouter[]>({
    queryKey: ["routers_for_hotspot_settings", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_routers")
        .select("id,name,host,admin_id")
        .eq("admin_id", ADMIN_ID)
        .order("name");
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const update = <K extends keyof HSettings>(key: K, value: HSettings[K]) => {
    setSettings(previous => ({ ...previous, [key]: value }));
    setNotice(null);
  };
  const updateColor = (key: keyof ColorSettings, value: string) => {
    setSettings(previous => ({ ...previous, colors: { ...previous.colors, [key]: value } }));
    setNotice(null);
  };

  const handleFile = (key: "logoUrl" | "advertUrl", file: File) => {
    const limit = key === "advertUrl" ? 500 * 1024 : 2 * 1024 * 1024;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice({ type: "error", text: "Use a PNG, JPG, or WebP image for portal branding." });
      return;
    }
    if (file.size > limit) {
      setNotice({ type: "error", text: `${key === "advertUrl" ? "Advert" : "Logo"} images must be smaller than ${key === "advertUrl" ? "500 KB" : "2 MB"}.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const value = event.target?.result;
      if (typeof value === "string") update(key, value);
    };
    reader.onerror = () => setNotice({ type: "error", text: "That image could not be read. Choose it again." });
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const error = validateSettings(settings);
    if (error) {
      setNotice({ type: "error", text: error });
      return;
    }
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.setTimeout(() => {
        setSaving(false);
        setSaved(true);
        setNotice({ type: "success", text: "Hotspot settings saved on this admin workspace." });
        window.setTimeout(() => setSaved(false), 2500);
      }, 350);
    } catch {
      setSaving(false);
      setNotice({ type: "error", text: "Settings could not be saved in this browser. Check available storage and try again." });
    }
  };

  const createExport = async () => {
    const error = validateSettings(settings);
    if (error) {
      setNotice({ type: "error", text: error });
      return null;
    }
    return buildPortalHtml(settings, brand.domain);
  };

  const handleDownload = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const html = await createExport();
      if (!html) return;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = safeText(settings.ispName, "hotspot-portal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hotspot-portal";
      anchor.href = url;
      anchor.download = `${slug}-hotspot-login.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ type: "success", text: "Your tenant-branded login.html is ready to upload to the router hotspot folder." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The portal HTML could not be generated." });
    } finally {
      setExporting(false);
    }
  };

  const handlePreview = async () => {
    setShowPreview(true);
    setPreviewLoading(true);
    setNotice(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    try {
      const html = await createExport();
      if (!html) {
        setShowPreview(false);
        return;
      }
      setPreviewUrl(URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })));
    } catch (error) {
      setShowPreview(false);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The portal preview could not be generated." });
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setShowPreview(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const presets = [
    { name: "Signal Orange", colors: { bgColor: "#081416", bgColor2: "#173638", primaryColor: "#d96835", accentColor: "#f09562", cardColor: "#12292b", buttonColor: "#168c78", textColor: "#ffffff", inputBgColor: "#0b1d1f" } },
    { name: "Purple Night", colors: DEFAULT_COLORS },
    { name: "Ocean Blue", colors: { bgColor: "#020b18", bgColor2: "#051e38", primaryColor: "#0ea5e9", accentColor: "#2563eb", cardColor: "#0c2340", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#020b18" } },
    { name: "Forest Green", colors: { bgColor: "#051a0e", bgColor2: "#0d2e1a", primaryColor: "#22c55e", accentColor: "#4ade80", cardColor: "#0d2e1a", buttonColor: "#f59e0b", textColor: "#ffffff", inputBgColor: "#040d07" } },
  ];

  const previewStyle = {
    "--mini-primary": settings.colors.primaryColor,
    "--mini-accent": settings.colors.accentColor,
    "--mini-button": settings.colors.buttonColor,
  } as React.CSSProperties;

  return (
    <AdminLayout>
      <style>{STYLES}</style>
      {showPreview && <PreviewModal url={previewUrl} loading={previewLoading} onClose={closePreview} />}
      <div className="hs-page">
        <header className="hs-hero">
          <div>
            <div className="hs-eyebrow"><Wifi size={13} /> Customer access experience</div>
            <h1 className="hs-title">Hotspot portal</h1>
            <p className="hs-subtitle">
              Shape what customers see when they join your Wi-Fi, then export one ready-to-upload
              <strong> login.html</strong> with the same payment and RouterOS behavior.
            </p>
          </div>
          <div className="hs-actions">
            <button type="button" className="hs-btn hs-btn-quiet" onClick={handlePreview} disabled={previewLoading}>
              {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
            </button>
            <button type="button" className="hs-btn hs-btn-soft" onClick={handleDownload} disabled={exporting}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />} Download HTML
            </button>
            <button type="button" className="hs-btn hs-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Saving…" : saved ? "Saved" : "Save settings"}
            </button>
          </div>
        </header>

        {notice && (
          <div className={`hs-status hs-status-${notice.type}`} style={{ marginBottom: 18 }}>
            {notice.type === "error" ? <AlertCircle size={16} /> : notice.type === "success" ? <Check size={16} /> : <Info size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="hs-grid">
          <main className="hs-stack">
            <Section icon={<LayoutTemplate size={16} />} title="Portal identity" description="Set the first impression customers get when they join your hotspot.">
              <Field label="ISP name" help="Used in the page title, header, footer, and downloaded filename.">
                <input className="hs-input" value={settings.ispName} maxLength={80} onChange={event => update("ispName", event.target.value)} placeholder="Your ISP name" />
              </Field>
              <Field label="Tagline" help="A short promise shown below the portal title.">
                <input className="hs-input" value={settings.tagline} maxLength={120} onChange={event => update("tagline", event.target.value)} placeholder="Fast and reliable internet" />
              </Field>
              <Field label="Linked router" help="Keeps this workspace’s hotspot export associated with the selected router.">
                {routersLoading ? <div className="hs-status hs-status-info"><Loader2 size={14} className="animate-spin" /> Loading routers…</div> : (
                  <div className="hs-select-wrap">
                    <select className="hs-select" value={settings.routerId} onChange={event => update("routerId", event.target.value)}>
                      <option value="">Choose a router (optional)</option>
                      {routers.map(router => (
                        <option key={router.id} value={router.id}>
                          {router.name}{router.host ? ` — ${router.host}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                )}
              </Field>
              <Field label="Portal status" help="Maintenance mode keeps the page available while replacing purchases with your message.">
                <SelectField value={settings.maintenanceMode} onChange={value => update("maintenanceMode", value)} options={["Online", "Maintenance"]} />
              </Field>
              {settings.maintenanceMode === "Maintenance" && (
                <Field label="Maintenance message" help="Shown to visitors while new purchases are paused.">
                  <textarea className="hs-textarea" value={settings.maintenanceMessage} maxLength={240} onChange={event => update("maintenanceMessage", event.target.value)} />
                </Field>
              )}
              <Field label="Logo" help="PNG, JPG, or WebP. The file is embedded in the exported HTML.">
                <FilePicker label="Choose logo" value={settings.logoUrl} accept=".png,.jpg,.jpeg,.webp" onSelect={file => handleFile("logoUrl", file)} />
              </Field>
            </Section>

            <Section icon={<Palette size={16} />} title="Visual system" description="Use a consistent palette across plans, checkout, forms, and support content.">
              <div className="hs-color-grid">
                <ColorPicker label="Top background" value={settings.colors.bgColor} onChange={value => updateColor("bgColor", value)} />
                <ColorPicker label="Bottom background" value={settings.colors.bgColor2} onChange={value => updateColor("bgColor2", value)} />
                <ColorPicker label="Primary" value={settings.colors.primaryColor} onChange={value => updateColor("primaryColor", value)} />
                <ColorPicker label="Secondary" value={settings.colors.accentColor} onChange={value => updateColor("accentColor", value)} />
                <ColorPicker label="Cards" value={settings.colors.cardColor} onChange={value => updateColor("cardColor", value)} />
                <ColorPicker label="Action button" value={settings.colors.buttonColor} onChange={value => updateColor("buttonColor", value)} />
                <ColorPicker label="Text" value={settings.colors.textColor} onChange={value => updateColor("textColor", value)} />
                <ColorPicker label="Inputs" value={settings.colors.inputBgColor} onChange={value => updateColor("inputBgColor", value)} />
              </div>
              <div className="hs-presets">
                {presets.map(preset => (
                  <button key={preset.name} type="button" className="hs-preset" onClick={() => update("colors", { ...preset.colors })}>
                    <span className="hs-swatches">
                      {[preset.colors.bgColor, preset.colors.primaryColor, preset.colors.accentColor, preset.colors.buttonColor].map(color => <i key={color} style={{ background: color }} />)}
                    </span>
                    {preset.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section icon={<Smartphone size={16} />} title="Checkout & access" description="Choose which access paths appear and make the payment step easy to understand.">
              <Field label="Free trial" help="Keep the existing free-trial setting available to the portal installer.">
                <SelectField value={settings.freeTrial} onChange={value => update("freeTrial", value)} options={["Disable", "Enable"]} />
              </Field>
              <Field label="Voucher redemption" help="Show or hide voucher access without changing RouterOS login forms.">
                <SelectField value={settings.vouchers} onChange={value => update("vouchers", value)} options={["Yes", "No"]} />
              </Field>
              <Field label="Payment instructions" help="Shown in the M-Pesa checkout dialog before a customer approves the prompt.">
                <textarea className="hs-textarea" value={settings.paymentInstructions} maxLength={240} onChange={event => update("paymentInstructions", event.target.value)} />
              </Field>
              <Field label="Announcement" help="Optional notice for outages, promotions, or location-specific guidance.">
                <textarea className="hs-textarea" value={settings.announcement} maxLength={240} onChange={event => update("announcement", event.target.value)} placeholder="e.g. Weekend offer: get 2 hours for Ksh 20." />
              </Field>
              <Field label="Advert banner" help="Optional banner embedded in the page. Maximum 500 KB.">
                <FilePicker label="Choose banner" value={settings.advertUrl} accept=".png,.jpg,.jpeg,.webp" onSelect={file => handleFile("advertUrl", file)} />
              </Field>
              <Field label="Advert display" help="Control whether the banner is shown and where it appears.">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <SelectField value={settings.enableAdvert} onChange={value => update("enableAdvert", value)} options={["Disable", "Enable"]} />
                  <SelectField value={settings.advertPos} onChange={value => update("advertPos", value)} options={["Top", "Middle", "Bottom"]} />
                </div>
              </Field>
            </Section>

            <Section icon={<CircleHelp size={16} />} title="Trust & support" description="Give customers a clear way to get help and understand your service.">
              <Field label="Support phone" help="Shown as a call-to-action in the portal header and footer.">
                <div style={{ position: "relative" }}><Phone size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} value={settings.supportPhone} maxLength={30} onChange={event => update("supportPhone", event.target.value)} placeholder="07XX XXX XXX" /></div>
              </Field>
              <Field label="Support email" help="Optional support mailbox for the portal footer.">
                <div style={{ position: "relative" }}><Mail size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="email" value={settings.supportEmail} maxLength={120} onChange={event => update("supportEmail", event.target.value)} placeholder="support@example.com" /></div>
              </Field>
              <Field label="WhatsApp number" help="Digits only or a country-code number; used for the floating support button.">
                <div style={{ position: "relative" }}><Smartphone size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} value={settings.whatsappNumber} maxLength={20} onChange={event => update("whatsappNumber", event.target.value)} placeholder="2547XXXXXXXX" /></div>
              </Field>
              <Field label="Terms link" help="Optional HTTPS link displayed in the footer.">
                <div style={{ position: "relative" }}><Link2 size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="url" value={settings.termsUrl} maxLength={300} onChange={event => update("termsUrl", event.target.value)} placeholder="https://example.com/terms" /></div>
              </Field>
              <Field label="Privacy link" help="Optional HTTPS link displayed in the footer.">
                <div style={{ position: "relative" }}><ShieldCheck size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="url" value={settings.privacyUrl} maxLength={300} onChange={event => update("privacyUrl", event.target.value)} placeholder="https://example.com/privacy" /></div>
              </Field>
              <Field label="Testimonials" help="Add a short customer quote below the access options.">
                <SelectField value={settings.testimonials} onChange={value => update("testimonials", value)} options={["Disable", "Enable"]} />
              </Field>
              {settings.testimonials === "Enable" && (
                <Field label="Customer quote">
                  <textarea className="hs-textarea" value={settings.testimonialText} maxLength={300} onChange={event => update("testimonialText", event.target.value)} />
                </Field>
              )}
              <Field label="FAQ section" help="Answer a common connection question without sending visitors away.">
                <SelectField value={settings.faqSection} onChange={value => update("faqSection", value)} options={["Disable", "Enable"]} />
              </Field>
              {settings.faqSection === "Enable" && (
                <Field label="FAQ content" help="Use a new line between the question and answer.">
                  <textarea className="hs-textarea" value={settings.faqText} maxLength={700} onChange={event => update("faqText", event.target.value)} />
                </Field>
              )}
            </Section>

            <div className="hs-foot-actions">
              <button type="button" className="hs-btn hs-btn-quiet" onClick={handlePreview} disabled={previewLoading}><Eye size={14} /> Preview portal</button>
              <button type="button" className="hs-btn hs-btn-primary" onClick={handleSave} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? "Saving…" : "Save settings"}</button>
            </div>
          </main>

          <aside className="hs-stack hs-side">
            <section className="hs-card hs-side-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><Sparkles size={16} /></div>
                <div><h2 className="hs-card-title">Live design snapshot</h2><p className="hs-card-desc">A quick look at your current identity.</p></div>
              </div>
              <div className="hs-side-body">
                <div className="hs-preview-screen" style={previewStyle}>
                  <div className="hs-mini-content">
                    <div className="hs-mini-logo">
                      {settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <Wifi size={18} color="#fff" />}
                    </div>
                    <h3>{safeText(settings.ispName, "Your ISP")}</h3>
                    <p>{safeText(settings.tagline, "Fast and reliable internet")}</p>
                    <div className="hs-mini-plans">
                      <div className="hs-mini-plan"><b>Hourly</b><span>From Ksh 20</span></div>
                      <div className="hs-mini-plan"><b>Daily</b><span>Instant access</span></div>
                    </div>
                    <div className="hs-mini-button">Connect with M-Pesa</div>
                  </div>
                </div>
                <div className="hs-side-note"><Info size={14} /> Preview and download use the same generated portal template, including the configured tenant API origin.</div>
              </div>
            </section>

            <section className="hs-card hs-side-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><ArrowDownToLine size={16} /></div>
                <div><h2 className="hs-card-title">Export checklist</h2><p className="hs-card-desc">What the HTML export keeps intact.</p></div>
              </div>
              <div className="hs-side-body">
                <ul className="hs-checklist">
                  <li><Check size={14} /> RouterOS redirect variables and login form conventions</li>
                  <li><Check size={14} /> Tenant-scoped plan loading and M-Pesa status polling</li>
                  <li><Check size={14} /> Paid-device MAC access, voucher, and member login paths</li>
                  <li><Check size={14} /> Branding and content embedded safely in the downloaded file</li>
                  <li><Check size={14} /> No router credentials, payment secrets, or VPN keys</li>
                </ul>
              </div>
            </section>

            <section className="hs-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><ShieldCheck size={16} /></div>
                <div><h2 className="hs-card-title">Safe publishing</h2><p className="hs-card-desc">Keep the write boundary clear.</p></div>
              </div>
              <div className="hs-side-body">
                <div className="hs-status hs-status-info">
                  <Info size={15} />
                  <span>Download creates a local <strong>login.html</strong> only. It does not overwrite router files or change payment settings.</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}