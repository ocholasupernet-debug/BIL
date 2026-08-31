import React, { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, Check, ChevronDown, Eye, HelpCircle, Image as ImageIcon,
  Info, LifeBuoy, Link2, Loader2, Megaphone, Palette, Phone, Save,
  ShieldCheck, Ticket, Upload, UserRound, Wifi, X,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase, ADMIN_ID as AUTH_ADMIN_ID, getSelectedTenantId, type DbRouter } from "@/lib/supabase";
import {
  DEFAULT_PPPOE_COLORS, PPPoELogin, type PppoePortalSettings,
} from "@/pages/portal/PPPoELogin";

const ADMIN_ID = getSelectedTenantId() ?? AUTH_ADMIN_ID;
const STORAGE_KEY = `pppoe_settings_${ADMIN_ID}`;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_ADVERT_BYTES = 500 * 1024;

function safeImageSource(value: unknown): string {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) ? value : "";
}

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
      logoUrl: safeImageSource(parsed.logoUrl),
      advertUrl: safeImageSource(parsed.advertUrl),
      colors: { ...DEFAULT_PPPOE_COLORS, ...(parsed.colors ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_PPPOE_COLORS } };
  }
}

const ADMIN_CSS = `
  .pppoe-settings-page { max-width:1180px; margin:0 auto; padding:32px 34px 52px; color:#e7efea; }
  .pppoe-settings-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:27px; }
  .pppoe-settings-kicker { display:flex; align-items:center; gap:7px; color:var(--isp-accent); font-size:.68rem; font-weight:800; letter-spacing:.13em; text-transform:uppercase; }
  .pppoe-settings-header h1 { margin:7px 0 5px; color:#e7efea; font-size:1.7rem; font-weight:850; letter-spacing:-.035em; }
  .pppoe-settings-header p { margin:0; color:#839893; font-size:.84rem; line-height:1.55; }
  .pppoe-settings-actions { display:flex; gap:9px; flex-wrap:wrap; justify-content:flex-end; }
  .pppoe-settings-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:9px 14px; border-radius:8px; font-size:.76rem; font-weight:750; cursor:pointer; transition:transform .15s,background .15s; }
  .pppoe-settings-button:hover { transform:translateY(-1px); }
  .pppoe-settings-button.preview { color:#75cfe5; border:1px solid rgba(117,207,229,.28); background:rgba(117,207,229,.08); }
  .pppoe-settings-button.save { color:#fff; border:1px solid var(--isp-accent); background:var(--isp-accent); box-shadow:0 5px 14px rgba(217,105,53,.2); }
  .pppoe-settings-button.save.saved { color:#b8f2da; border-color:#168c78; background:rgba(22,140,120,.18); }
  .pppoe-settings-layout { display:grid; grid-template-columns:minmax(0,1fr) 285px; gap:18px; align-items:start; }
  .pppoe-settings-section { margin-bottom:17px; overflow:hidden; border:1px solid rgba(185,210,201,.14); border-radius:13px; background:#102426; box-shadow:0 4px 16px rgba(0,0,0,.12); }
  .pppoe-settings-section-head { display:flex; align-items:flex-start; gap:11px; padding:17px 20px; border-bottom:1px solid rgba(185,210,201,.1); background:rgba(255,255,255,.025); }
  .pppoe-settings-section-icon { width:31px; height:31px; display:grid; place-items:center; flex:none; border-radius:9px; color:#f09562; background:rgba(217,105,53,.12); }
  .pppoe-settings-section-head h2 { margin:1px 0 4px; color:#e7efea; font-size:.91rem; font-weight:800; }
  .pppoe-settings-section-head p { margin:0; color:#718681; font-size:.72rem; line-height:1.45; }
  .pppoe-settings-body { padding:0 20px; }
  .pppoe-settings-row { display:grid; grid-template-columns:175px minmax(0,1fr); gap:20px; align-items:start; padding:17px 0; border-bottom:1px solid rgba(185,210,201,.08); }
  .pppoe-settings-row:last-child { border-bottom:0; }
  .pppoe-settings-row-label { padding-top:2px; }
  .pppoe-settings-row-label strong { display:flex; align-items:center; gap:5px; color:#a9bbb5; font-size:.75rem; font-weight:750; }
  .pppoe-settings-row-label span { display:block; margin-top:5px; color:#637a74; font-size:.67rem; line-height:1.45; }
  .pppoe-settings-input, .pppoe-settings-select, .pppoe-settings-textarea { width:100%; border:1px solid rgba(185,210,201,.17); border-radius:8px; outline:none; color:#e7efea; background:rgba(0,0,0,.22); font-size:.78rem; transition:border-color .15s,box-shadow .15s; }
  .pppoe-settings-input, .pppoe-settings-select { min-height:39px; padding:9px 11px; }
  .pppoe-settings-textarea { min-height:78px; padding:10px 11px; resize:vertical; line-height:1.5; }
  .pppoe-settings-input:focus, .pppoe-settings-select:focus, .pppoe-settings-textarea:focus { border-color:var(--isp-accent); box-shadow:0 0 0 3px rgba(217,105,53,.11); }
  .pppoe-settings-input::placeholder, .pppoe-settings-textarea::placeholder { color:#566e68; }
  .pppoe-settings-select { appearance:none; cursor:pointer; }
  .pppoe-settings-select-wrap { position:relative; }
  .pppoe-settings-select-wrap svg { position:absolute; right:11px; top:50%; transform:translateY(-50%); pointer-events:none; color:#718681; }
  .pppoe-settings-field-note { margin:6px 0 0; color:#617872; font-size:.67rem; line-height:1.4; }
  .pppoe-settings-two-col { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .pppoe-settings-file { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .pppoe-settings-upload { display:inline-flex; align-items:center; gap:6px; min-height:35px; padding:8px 11px; color:#b6c6c0; border:1px solid rgba(185,210,201,.16); border-radius:8px; background:rgba(255,255,255,.045); font-size:.73rem; font-weight:700; cursor:pointer; }
  .pppoe-settings-upload:hover { background:rgba(255,255,255,.08); }
  .pppoe-settings-file-name { color:#738982; font-size:.7rem; }
  .pppoe-settings-image-preview { width:62px; height:40px; object-fit:contain; border:1px solid rgba(185,210,201,.16); border-radius:6px; background:#0b1d1f; }
  .pppoe-settings-remove { display:inline-flex; align-items:center; gap:4px; border:0; padding:0; color:#d7826a; background:transparent; font-size:.68rem; cursor:pointer; }
  .pppoe-settings-check { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:39px; padding:9px 11px; border:1px solid rgba(185,210,201,.12); border-radius:8px; background:rgba(255,255,255,.025); }
  .pppoe-settings-check span { color:#adc0b9; font-size:.74rem; }
  .pppoe-settings-toggle { display:inline-flex; align-items:center; padding:3px; width:40px; height:22px; border:0; border-radius:999px; background:#1d3739; cursor:pointer; }
  .pppoe-settings-toggle.on { justify-content:flex-end; background:var(--isp-accent); }
  .pppoe-settings-toggle i { display:block; width:16px; height:16px; border-radius:50%; background:#dce8e3; }
  .pppoe-settings-colors { display:grid; grid-template-columns:repeat(4,minmax(70px,1fr)); gap:15px; }
  .pppoe-settings-color { text-align:center; }
  .pppoe-settings-color input { display:block; width:100%; height:42px; padding:2px; border:1px solid rgba(185,210,201,.15); border-radius:8px; background:#0b1d1f; cursor:pointer; }
  .pppoe-settings-color label { display:block; margin-top:6px; color:#819790; font-size:.63rem; line-height:1.3; }
  .pppoe-settings-color code { display:block; margin-top:3px; color:#526a64; font-size:.59rem; }
  .pppoe-settings-presets { display:flex; flex-wrap:wrap; gap:7px; padding-top:16px; margin-top:18px; border-top:1px solid rgba(185,210,201,.08); }
  .pppoe-settings-preset { display:inline-flex; align-items:center; gap:6px; min-height:31px; padding:6px 9px; color:#9cb0a9; border:1px solid rgba(185,210,201,.13); border-radius:7px; background:rgba(255,255,255,.035); font-size:.65rem; font-weight:700; cursor:pointer; }
  .pppoe-settings-preset:hover { border-color:var(--isp-accent); color:#e7efea; }
  .pppoe-settings-swatch { display:flex; gap:2px; }
  .pppoe-settings-swatch i { width:10px; height:10px; border-radius:3px; }
  .pppoe-settings-aside { position:sticky; top:20px; }
  .pppoe-settings-aside-card { padding:18px; margin-bottom:15px; border:1px solid rgba(185,210,201,.14); border-radius:13px; background:#0b1d1f; }
  .pppoe-settings-aside-card h3 { display:flex; align-items:center; gap:8px; margin:0 0 7px; color:#dbe8e1; font-size:.82rem; font-weight:800; }
  .pppoe-settings-aside-card h3 svg { color:var(--isp-accent); }
  .pppoe-settings-aside-card p { margin:0 0 15px; color:#718681; font-size:.7rem; line-height:1.55; }
  .pppoe-settings-preview-card { overflow:hidden; border:1px solid rgba(185,210,201,.14); border-radius:13px; background:#102426; }
  .pppoe-settings-preview-head { display:flex; align-items:center; justify-content:space-between; gap:7px; padding:13px 14px; border-bottom:1px solid rgba(185,210,201,.1); }
  .pppoe-settings-preview-head strong { color:#cbdad3; font-size:.75rem; }
  .pppoe-settings-preview-head span { color:#6e827c; font-size:.6rem; }
  .pppoe-settings-preview-body { padding:14px; }
  .pppoe-settings-preview-brand { display:flex; align-items:center; gap:8px; padding-bottom:13px; border-bottom:1px solid rgba(185,210,201,.08); }
  .pppoe-settings-preview-logo { display:grid; place-items:center; width:92px; height:38px; overflow:hidden; border-radius:0; color:#fff; background:transparent; }
  .pppoe-settings-preview-logo img { width:100%; height:100%; object-fit:contain; }
  .pppoe-settings-preview-brand strong { display:block; color:#dce8e1; font-size:.71rem; }
  .pppoe-settings-preview-brand span { display:block; margin-top:2px; color:#718681; font-size:.58rem; }
  .pppoe-settings-preview-stat { display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin:13px 0; }
  .pppoe-settings-preview-stat div { height:41px; border:1px solid rgba(185,210,201,.09); border-radius:6px; background:rgba(255,255,255,.025); }
  .pppoe-settings-preview-stat div:nth-child(2) { background:rgba(217,105,53,.12); }
  .pppoe-settings-preview-line { height:8px; width:72%; margin-bottom:8px; border-radius:4px; background:rgba(185,210,201,.13); }
  .pppoe-settings-preview-line.short { width:45%; background:rgba(185,210,201,.08); }
  .pppoe-settings-preview-button { height:29px; margin-top:7px; border-radius:6px; background:var(--isp-accent); }
  .pppoe-settings-status { display:flex; align-items:flex-start; gap:8px; margin-bottom:17px; padding:11px 13px; border:1px solid rgba(22,140,120,.3); border-radius:9px; color:#b7ddcf; background:rgba(22,140,120,.1); font-size:.72rem; line-height:1.4; }
  .pppoe-settings-error { display:flex; align-items:flex-start; gap:8px; margin-bottom:17px; padding:11px 13px; border:1px solid rgba(239,116,94,.3); border-radius:9px; color:#f2b2a4; background:rgba(239,116,94,.1); font-size:.72rem; line-height:1.4; }
  .pppoe-settings-bottom-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:4px; }
  .pppoe-preview-modal { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(4,12,14,.84); backdrop-filter:blur(6px); }
  .pppoe-preview-window { display:flex; flex-direction:column; width:min(1080px,100%); height:min(900px,94vh); overflow:hidden; border:1px solid rgba(185,210,201,.18); border-radius:14px; background:#0b1d1f; box-shadow:0 25px 80px rgba(0,0,0,.4); }
  .pppoe-preview-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 15px; border-bottom:1px solid rgba(185,210,201,.12); background:#102426; }
  .pppoe-preview-toolbar strong { color:#e7efea; font-size:.77rem; }
  .pppoe-preview-toolbar span { margin-left:7px; color:#6f847c; font-size:.63rem; }
  .pppoe-preview-close { display:inline-flex; align-items:center; gap:5px; padding:6px 9px; color:#e9a494; border:1px solid rgba(239,116,94,.25); border-radius:6px; background:rgba(239,116,94,.08); font-size:.65rem; cursor:pointer; }
  .pppoe-preview-content { flex:1; overflow:auto; }
  @media (max-width: 960px) { .pppoe-settings-layout { grid-template-columns:1fr; } .pppoe-settings-aside { position:static; display:grid; grid-template-columns:1fr 1fr; gap:15px; } .pppoe-settings-aside-card,.pppoe-settings-preview-card { margin:0; } }
  @media (max-width: 640px) { .pppoe-settings-page { padding:24px 16px 40px; } .pppoe-settings-header { display:block; } .pppoe-settings-actions { justify-content:flex-start; margin-top:18px; } .pppoe-settings-row { grid-template-columns:1fr; gap:9px; } .pppoe-settings-row-label { padding:0; } .pppoe-settings-two-col { grid-template-columns:1fr; } .pppoe-settings-colors { grid-template-columns:repeat(2,minmax(75px,1fr)); } .pppoe-settings-aside { display:block; } .pppoe-settings-aside-card { margin-bottom:15px; } .pppoe-preview-modal { padding:0; } .pppoe-preview-window { height:100vh; border-radius:0; } }
`;

function FieldRow({ label, hint, children, icon }: {
  label: string; hint?: string; children: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="pppoe-settings-row">
      <div className="pppoe-settings-row-label">
        <strong>{icon}{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SelectField({ value, options, onChange }: {
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="pppoe-settings-select-wrap">
      <select className="pppoe-settings-select" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return <option key={item.value} value={item.value}>{item.label || "— Select router —"}</option>;
        })}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}

function FilePicker({
  value, label, accept, maxBytes, onChange, onRemove,
}: {
  value: string; label: string; accept: string; maxBytes: number;
  onChange: (value: string) => void; onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > maxBytes) {
      setError(`Image is too large. Maximum size is ${Math.round(maxBytes / 1024)}KB.`);
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = loadEvent => {
      if (typeof loadEvent.target?.result === "string") onChange(loadEvent.target.result);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div>
      <div className="pppoe-settings-file">
        <button type="button" className="pppoe-settings-upload" onClick={() => inputRef.current?.click()}><Upload size={13} /> {label}</button>
        <input ref={inputRef} type="file" accept={accept} hidden onChange={readFile} />
        <span className="pppoe-settings-file-name">{value ? "Image selected" : "No file chosen"}</span>
        {value && <img className="pppoe-settings-image-preview" src={value} alt="Selected preview" />}
        {value && <button type="button" className="pppoe-settings-remove" onClick={onRemove}><X size={12} /> Remove</button>}
      </div>
      {error && <p className="pppoe-settings-field-note" style={{ color: "#ef9a87" }}>{error}</p>}
    </div>
  );
}

function PreviewModal({ settings, onClose }: { settings: PppoePortalSettings; onClose: () => void }) {
  return (
    <div className="pppoe-preview-modal" role="dialog" aria-modal="true" aria-label="PPPoE portal preview">
      <div className="pppoe-preview-window">
        <div className="pppoe-preview-toolbar">
          <div><strong>Customer portal preview</strong><span>Unsaved settings · interactions are simulated</span></div>
          <button type="button" className="pppoe-preview-close" onClick={onClose}><X size={13} /> Close</button>
        </div>
        <div className="pppoe-preview-content"><PPPoELogin previewSettings={settings} embedded /></div>
      </div>
    </div>
  );
}

export default function PPPoESettings() {
  const [settings, setSettings] = useState<PppoePortalSettings>(loadSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { data: routers = [], isLoading: routersLoading } = useQuery<DbRouter[]>({
    queryKey: ["routers_for_pppoe_settings", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_routers")
        .select("id,name,host,admin_id")
        .eq("admin_id", ADMIN_ID)
        .not("status", "in", "(setup,awaiting_ports,awaiting_sync,awaiting_connection)")
        .order("name");
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  function update<K extends keyof PppoePortalSettings>(key: K, value: PppoePortalSettings[K]) {
    setSettings(previous => ({ ...previous, [key]: value }));
    setSaved(false);
    setSaveError("");
  }
  function updateColor(key: keyof typeof DEFAULT_PPPOE_COLORS, value: string) {
    setSettings(previous => ({ ...previous, colors: { ...previous.colors, [key]: value } }));
    setSaved(false);
    setSaveError("");
  }
  function validate(): string {
    if (!settings.ispName.trim()) return "Add an ISP name before saving.";
    if (settings.ispName.trim().length > 80) return "ISP name must be 80 characters or fewer.";
    if (settings.tagline.length > 180) return "Tagline must be 180 characters or fewer.";
    if (settings.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.supportEmail.trim())) return "Enter a valid support email address.";
    for (const [label, value] of [["Terms of service", settings.termsUrl], ["Privacy policy", settings.privacyUrl]]) {
      if (value && !/^https:\/\//i.test(value.trim())) return `${label} must use an https:// URL.`;
    }
    return "";
  }
  function saveSettings() {
    const error = validate();
    if (error) { setSaveError(error); return; }
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.setTimeout(() => { setSaving(false); setSaved(true); }, 450);
    } catch {
      setSaving(false);
      setSaveError("Settings could not be saved in this browser. Check available storage and try again.");
    }
  }

  const presets = [
    { name: "Signal", colors: { ...DEFAULT_PPPOE_COLORS } },
    { name: "Ocean", colors: { bgColor: "#061421", bgColor2: "#0d2d46", primaryColor: "#0ea5e9", accentColor: "#67e8f9", cardColor: "#103653", buttonColor: "#14b8a6", textColor: "#f0f9ff", inputBgColor: "#071d31" } },
    { name: "Purple", colors: { bgColor: "#10081f", bgColor2: "#24133c", primaryColor: "#8b5cf6", accentColor: "#d8b4fe", cardColor: "#27183d", buttonColor: "#14b8a6", textColor: "#faf5ff", inputBgColor: "#160c28" } },
    { name: "Forest", colors: { bgColor: "#06140f", bgColor2: "#0d2d1d", primaryColor: "#22c55e", accentColor: "#86efac", cardColor: "#123623", buttonColor: "#f59e0b", textColor: "#f0fdf4", inputBgColor: "#071e12" } },
  ];

  return (
    <AdminLayout>
      <style>{ADMIN_CSS}</style>
      {showPreview && <PreviewModal settings={settings} onClose={() => setShowPreview(false)} />}
      <div className="pppoe-settings-page">
        <header className="pppoe-settings-header">
          <div>
            <div className="pppoe-settings-kicker"><Wifi size={13} /> Customer experience</div>
            <h1>PPPoE portal settings</h1>
            <p>Shape the sign-in experience customers see when they manage their broadband account.</p>
          </div>
          <div className="pppoe-settings-actions">
            <button type="button" className="pppoe-settings-button preview" onClick={() => setShowPreview(true)}><Eye size={14} /> Preview portal</button>
            <button type="button" className={`pppoe-settings-button save ${saved ? "saved" : ""}`} onClick={saveSettings} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Saving…" : saved ? "Saved" : "Save settings"}
            </button>
          </div>
        </header>

        {saveError && <div className="pppoe-settings-error"><AlertCircle size={15} /><span>{saveError}</span></div>}
        {saved && !saveError && <div className="pppoe-settings-status"><Check size={15} /><span>Portal settings saved for this tenant. Open the preview to review the customer-facing result.</span></div>}

        <div className="pppoe-settings-layout">
          <div>
            <section className="pppoe-settings-section">
              <div className="pppoe-settings-section-head">
                <div className="pppoe-settings-section-icon"><UserRound size={16} /></div>
                <div><h2>Identity & connection</h2><p>Set the essentials customers need to recognise and use their PPPoE portal.</p></div>
              </div>
              <div className="pppoe-settings-body">
                <FieldRow label="ISP name" hint="Shown in the portal header and footer.">
                  <input className="pppoe-settings-input" value={settings.ispName} maxLength={80} onChange={event => update("ispName", event.target.value)} placeholder="Your ISP name" />
                </FieldRow>
                <FieldRow label="Portal tagline" hint="A short promise beneath the main heading.">
                  <input className="pppoe-settings-input" value={settings.tagline} maxLength={180} onChange={event => update("tagline", event.target.value)} placeholder="Fast, reliable broadband for every day" />
                </FieldRow>
                <FieldRow label="Linked router" icon={<Wifi size={12} />} hint="Stored as the router ID; the name and host are shown for clarity.">
                  <SelectField
                    value={settings.routerId}
                    onChange={value => update("routerId", value)}
                    options={[
                      { value: "", label: "— Select router —" },
                      ...routers.map(router => ({ value: String(router.id), label: `${router.name}${router.host ? ` · ${router.host}` : ""}` })),
                    ]}
                  />
                  {settings.routerId && <p className="pppoe-settings-field-note">{routers.find(router => String(router.id) === settings.routerId)?.name ?? "Selected router"}{routers.find(router => String(router.id) === settings.routerId)?.host ? ` · ${routers.find(router => String(router.id) === settings.routerId)?.host}` : ""}</p>}
                  {!settings.routerId && <p className="pppoe-settings-field-note">{routersLoading ? "Loading tenant routers…" : routers.length ? "Choose the router associated with PPPoE access." : "No routers are available for this tenant yet."}</p>}
                </FieldRow>
                <FieldRow label="Portal logo" icon={<ImageIcon size={12} />} hint="PNG, JPG, or WebP. Maximum 2MB.">
                  <FilePicker value={settings.logoUrl} label="Choose logo" accept=".png,.jpg,.jpeg,.webp" maxBytes={MAX_LOGO_BYTES} onChange={value => update("logoUrl", value)} onRemove={() => update("logoUrl", "")} />
                </FieldRow>
              </div>
            </section>

            <section className="pppoe-settings-section">
              <div className="pppoe-settings-section-head">
                <div className="pppoe-settings-section-icon"><Palette size={16} /></div>
                <div><h2>Visual system</h2><p>Make the portal feel like your network while keeping controls legible and accessible.</p></div>
              </div>
              <div className="pppoe-settings-body">
                <FieldRow label="Portal colours" hint="Preview changes before saving.">
                  <div className="pppoe-settings-colors">
                    {([
                      ["bgColor", "Background"],
                      ["bgColor2", "Background 2"],
                      ["primaryColor", "Primary"],
                      ["accentColor", "Accent"],
                      ["cardColor", "Cards"],
                      ["buttonColor", "Buttons"],
                      ["textColor", "Text"],
                      ["inputBgColor", "Inputs"],
                    ] as const).map(([key, label]) => (
                      <div className="pppoe-settings-color" key={key}>
                        <input type="color" aria-label={label} value={settings.colors[key]} onChange={event => updateColor(key, event.target.value)} />
                        <label>{label}</label>
                        <code>{settings.colors[key]}</code>
                      </div>
                    ))}
                  </div>
                  <div className="pppoe-settings-presets">
                    {presets.map(preset => (
                      <button type="button" className="pppoe-settings-preset" key={preset.name} onClick={() => update("colors", preset.colors)}>
                        <span className="pppoe-settings-swatch">{[preset.colors.bgColor, preset.colors.primaryColor, preset.colors.accentColor].map(color => <i key={color} style={{ background: color }} />)}</span>
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </FieldRow>
              </div>
            </section>

            <section className="pppoe-settings-section">
              <div className="pppoe-settings-section-head">
                <div className="pppoe-settings-section-icon"><Ticket size={16} /></div>
                <div><h2>Access & announcements</h2><p>Control the actions and notices available to PPPoE customers.</p></div>
              </div>
              <div className="pppoe-settings-body">
                <FieldRow label="Voucher redemption" hint="Show the voucher tab for prepaid renewals.">
                  <div className="pppoe-settings-check"><span>Allow customers to redeem vouchers</span><button type="button" aria-label="Toggle voucher redemption" className={`pppoe-settings-toggle ${settings.enableVouchers === "Yes" ? "on" : ""}`} onClick={() => update("enableVouchers", settings.enableVouchers === "Yes" ? "No" : "Yes")}><i /></button></div>
                </FieldRow>
                <FieldRow label="Service status" hint="Show an attention notice when planned maintenance is active.">
                  <SelectField value={settings.maintenanceMode} onChange={value => update("maintenanceMode", value)} options={["Online", "Maintenance"]} />
                </FieldRow>
                {settings.maintenanceMode === "Maintenance" && <FieldRow label="Maintenance message" hint="Keep customers informed about the interruption."><textarea className="pppoe-settings-textarea" value={settings.maintenanceMessage} maxLength={240} onChange={event => update("maintenanceMessage", event.target.value)} /></FieldRow>}
                <FieldRow label="Announcement" icon={<Megaphone size={12} />} hint="Optional message shown above account access.">
                  <textarea className="pppoe-settings-textarea" value={settings.announcement} maxLength={240} onChange={event => update("announcement", event.target.value)} placeholder="e.g. New plans are now available…" />
                </FieldRow>
                <FieldRow label="Advert banner" hint="PNG, JPG, or WebP. Maximum 500KB.">
                  <FilePicker value={settings.advertUrl} label="Choose banner" accept=".png,.jpg,.jpeg,.webp" maxBytes={MAX_ADVERT_BYTES} onChange={value => update("advertUrl", value)} onRemove={() => update("advertUrl", "")} />
                </FieldRow>
                <FieldRow label="Advert display" hint="Choose whether the uploaded banner is visible.">
                  <div className="pppoe-settings-two-col">
                    <SelectField value={settings.enableAdvert} onChange={value => update("enableAdvert", value)} options={["Disable", "Enable"]} />
                    <SelectField value={settings.advertPos} onChange={value => update("advertPos", value)} options={["Top", "Middle", "Bottom"]} />
                  </div>
                </FieldRow>
              </div>
            </section>

            <section className="pppoe-settings-section">
              <div className="pppoe-settings-section-head">
                <div className="pppoe-settings-section-icon"><LifeBuoy size={16} /></div>
                <div><h2>Support & helpful content</h2><p>Give customers direct ways to reach you and answer common questions.</p></div>
              </div>
              <div className="pppoe-settings-body">
                <FieldRow label="Support contacts" hint="Displayed on the portal only when provided.">
                  <div className="pppoe-settings-two-col">
                    <input className="pppoe-settings-input" type="tel" value={settings.supportPhone} onChange={event => update("supportPhone", event.target.value)} placeholder="Support phone" />
                    <input className="pppoe-settings-input" type="email" value={settings.supportEmail} onChange={event => update("supportEmail", event.target.value)} placeholder="support@example.com" />
                  </div>
                  <input className="pppoe-settings-input" style={{ marginTop: 10 }} type="tel" value={settings.whatsappNumber} onChange={event => update("whatsappNumber", event.target.value)} placeholder="WhatsApp number (optional)" />
                </FieldRow>
                <FieldRow label="Testimonials" hint="Show one short customer quote in the portal.">
                  <SelectField value={settings.testimonials} onChange={value => update("testimonials", value)} options={["Disable", "Enable"]} />
                  {settings.testimonials === "Enable" && <textarea className="pppoe-settings-textarea" style={{ marginTop: 10 }} value={settings.testimonialText} maxLength={240} onChange={event => update("testimonialText", event.target.value)} placeholder="A customer quote" />}
                </FieldRow>
                <FieldRow label="FAQ section" icon={<HelpCircle size={12} />} hint="Add a concise answer to common connection questions.">
                  <SelectField value={settings.faqSection} onChange={value => update("faqSection", value)} options={["Disable", "Enable"]} />
                  {settings.faqSection === "Enable" && <textarea className="pppoe-settings-textarea" style={{ marginTop: 10 }} value={settings.faqText} maxLength={600} onChange={event => update("faqText", event.target.value)} placeholder={"How do I connect?\\nUse your PPPoE username and password."} />}
                </FieldRow>
                <FieldRow label="Legal links" icon={<Link2 size={12} />} hint="Optional HTTPS links shown in the portal footer.">
                  <div className="pppoe-settings-two-col">
                    <input className="pppoe-settings-input" type="url" value={settings.termsUrl} onChange={event => update("termsUrl", event.target.value)} placeholder="https://…/terms" />
                    <input className="pppoe-settings-input" type="url" value={settings.privacyUrl} onChange={event => update("privacyUrl", event.target.value)} placeholder="https://…/privacy" />
                  </div>
                </FieldRow>
              </div>
            </section>

            <div className="pppoe-settings-bottom-actions">
              <button type="button" className="pppoe-settings-button preview" onClick={() => setShowPreview(true)}><Eye size={14} /> Review portal</button>
              <button type="button" className={`pppoe-settings-button save ${saved ? "saved" : ""}`} onClick={saveSettings} disabled={saving}><Save size={14} /> {saved ? "Saved" : "Save settings"}</button>
            </div>
          </div>

          <aside className="pppoe-settings-aside">
            <div className="pppoe-settings-aside-card">
              <h3><ShieldCheck size={15} /> Keep access trustworthy</h3>
              <p>Customer-facing copy is rendered as text. This page stores only portal preferences and image data in this tenant’s browser storage — never router credentials or payment secrets.</p>
              <button type="button" className="pppoe-settings-button preview" style={{ width: "100%" }} onClick={() => setShowPreview(true)}><Eye size={14} /> Open live preview</button>
            </div>
            <div className="pppoe-settings-preview-card">
              <div className="pppoe-settings-preview-head"><strong>Portal at a glance</strong><span>Unsaved changes included</span></div>
              <div className="pppoe-settings-preview-body">
                <div className="pppoe-settings-preview-brand">
                  <div className="pppoe-settings-preview-logo"><img src={settings.logoUrl || "/ocholasupernet-logo.png"} alt="" /></div>
                  <div><strong>{settings.ispName || "Your ISP"}</strong><span>PPPoE customer portal</span></div>
                </div>
                <div className="pppoe-settings-preview-stat"><div /><div /><div /></div>
                <div className="pppoe-settings-preview-line" /><div className="pppoe-settings-preview-line short" /><div className="pppoe-settings-preview-button" style={{ background: settings.colors.primaryColor }} />
              </div>
            </div>
            <div className="pppoe-settings-aside-card">
              <h3><Info size={15} /> Before you publish</h3>
              <p>Use Preview portal to check the customer view on narrow screens. Save only after reviewing your colours, support contacts, and maintenance state.</p>
            </div>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}