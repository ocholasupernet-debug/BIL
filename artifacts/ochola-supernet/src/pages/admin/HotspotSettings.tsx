import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase } from "@/lib/supabase";
import type { DbRouter } from "@/lib/supabase";
import {
  Wifi, Upload, Eye, Save, Palette, Image,
  Info, ChevronDown, X, Loader2, Check,
} from "lucide-react";

const ADMIN_ID = Number(localStorage.getItem("isp_admin_id") || "5");
const STORAGE_KEY = `hotspot_settings_${ADMIN_ID}`;

/* ─── Defaults ─── */
const DEFAULT_COLORS = {
  bgColor:      "#0d0415",
  bgColor2:     "#1a0735",
  primaryColor: "#8b5cf6",
  accentColor:  "#d946ef",
  cardColor:    "#1a0f2e",
  buttonColor:  "#10b981",
  textColor:    "#ffffff",
  inputBgColor: "#000000",
};

interface HSettings {
  ispName:       string;
  freeTrial:     string;
  vouchers:      string;
  tagline:       string;
  routerId:      string;
  advertPos:     string;
  enableAdvert:  string;
  testimonials:  string;
  faqSection:    string;
  logoUrl:       string;
  advertUrl:     string;
  colors:        typeof DEFAULT_COLORS;
}

function loadSettings(): HSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch (_) {}
  return defaultSettings();
}
function defaultSettings(): HSettings {
  return {
    ispName:      "OCHOLASUPERNET",
    freeTrial:    "Disable",
    vouchers:     "Yes",
    tagline:      "Fast & Reliable Internet",
    routerId:     "",
    advertPos:    "Bottom",
    enableAdvert: "Disable",
    testimonials: "Disable",
    faqSection:   "Disable",
    logoUrl:      "",
    advertUrl:    "",
    colors:       DEFAULT_COLORS,
  };
}

/* ─── Sub-components ─── */
const LABEL: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#94a3b8",
  marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
};
const INPUT: React.CSSProperties = {
  width: "100%", background: "rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
  padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none",
  boxSizing: "border-box",
};
const SELECT: React.CSSProperties = { ...INPUT, appearance: "none", cursor: "pointer" };
const ROW: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "200px 1fr",
  gap: "12px 32px", alignItems: "flex-start",
  padding: "20px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
};
const HINT: React.CSSProperties = { fontSize: 11, color: "#475569", marginTop: 6 };

function FieldRow({ label, hint, icon, children }: {
  label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={ROW}>
      <div style={{ paddingTop: 10 }}>
        <div style={LABEL}>{icon}{label}</div>
        {hint && <p style={HINT}>{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SelectField({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={SELECT}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none" }} />
    </div>
  );
}

function ColorPicker({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      <div style={{ position: "relative", width: 56, height: 56 }}>
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", height: "100%", border: "none", borderRadius: 10, cursor: "pointer", padding: 2, background: "rgba(0,0,0,0.3)" }}
        />
      </div>
      <p style={{ fontSize: 10, color: "#64748b", textAlign: "center", maxWidth: 64, lineHeight: 1.3 }}>{label}</p>
      <p style={{ fontSize: 9, color: "#475569", fontFamily: "monospace" }}>{value}</p>
    </div>
  );
}

/* ─── Live preview modal — hotspot login ─── */
function HotspotPreviewModal({
  onClose, settings, colors,
}: {
  onClose: () => void;
  settings: HSettings;
  colors: typeof DEFAULT_COLORS;
}) {
  const [tab, setTab] = useState<"plans" | "login" | "voucher">("plans");

  const bg = `linear-gradient(135deg, ${colors.bgColor} 0%, ${colors.bgColor2} 100%)`;
  const btnStyle: React.CSSProperties = {
    padding: "12px 0", borderRadius: 10, color: "#fff",
    fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", width: "100%",
    background: colors.buttonColor,
  };
  const cardStyle: React.CSSProperties = {
    background: colors.cardColor, border: `1px solid ${colors.primaryColor}33`,
    borderRadius: 16, padding: "20px 24px",
  };
  const tabBtnBase: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    border: "none", cursor: "pointer", transition: "all 0.15s",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(6px)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ width: "min(900px,95vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>

        {/* Modal toolbar */}
        <div style={{ background: "#0f172a", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eye size={16} style={{ color: colors.primaryColor }} />
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>Hotspot Login Page Preview</span>
            <span style={{ fontSize: 11, color: "#64748b", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 6 }}>Live preview — changes not yet saved</span>
          </div>
          <button onClick={onClose} style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "6px 12px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <X size={13} /> Close Preview
          </button>
        </div>

        {/* Scrollable preview area */}
        <div style={{ flex: 1, overflowY: "auto", background: bg, color: colors.textColor }}>
          {/* Header */}
          <div style={{ padding: "16px 32px", borderBottom: `1px solid ${colors.primaryColor}22`, background: `${colors.bgColor}CC`, backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {settings.logoUrl ? (
                <img src={settings.logoUrl} alt="logo" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg,${colors.primaryColor},${colors.accentColor})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Wifi size={18} color="#fff" />
                </div>
              )}
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{settings.ispName}</div>
                <div style={{ fontSize: 10, color: colors.primaryColor }}>Hotspot Portal</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 99, padding: "4px 12px" }}>● Network Online</div>
          </div>

          {/* Hero */}
          <div style={{ textAlign: "center", padding: "40px 32px 24px" }}>
            <h2 style={{ fontSize: 28, fontWeight: 900, margin: 0, marginBottom: 10 }}>
              Connect to{" "}
              <span style={{ background: `linear-gradient(90deg,${colors.primaryColor},${colors.accentColor})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Fast Internet
              </span>
            </h2>
            <p style={{ color: `${colors.textColor}99`, fontSize: 13, margin: 0 }}>{settings.tagline}</p>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 4, display: "inline-flex", gap: 2 }}>
              {(["plans", "login", "voucher"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  ...tabBtnBase,
                  background: tab === t ? colors.primaryColor : "transparent",
                  color: tab === t ? "#fff" : `${colors.textColor}88`,
                }}>
                  {t === "plans" ? "Buy Package" : t === "login" ? "Member Login" : "Redeem Voucher"}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 24px 40px" }}>
            {tab === "plans" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  {[["1 Hour", "Ksh 20"], ["24 Hours", "Ksh 50"], ["7 Days", "Ksh 250"], ["30 Days", "Ksh 800"]].map(([n, p]) => (
                    <div key={n} style={{ ...cardStyle, cursor: "pointer" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{n}</div>
                      <div style={{ fontSize: 22, fontWeight: 900, margin: "6px 0" }}>{p}</div>
                      <div style={{ fontSize: 10, color: colors.primaryColor }}>⚡ Unlimited</div>
                    </div>
                  ))}
                </div>
                <div style={cardStyle}>
                  <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>📱 Pay with M-Pesa</div>
                  <input placeholder="07XX XXX XXX" style={{ ...INPUT, background: colors.inputBgColor, marginBottom: 10 }} readOnly />
                  <button style={{ ...btnStyle, background: `linear-gradient(90deg,${colors.buttonColor},${colors.accentColor})` }}>Send STK Push</button>
                </div>
              </div>
            )}
            {tab === "login" && (
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, textAlign: "center", fontSize: 18, marginBottom: 16 }}>Welcome Back</div>
                <label style={{ fontSize: 11, fontWeight: 700, color: colors.primaryColor, display: "block", marginBottom: 6 }}>USERNAME</label>
                <input style={{ ...INPUT, background: colors.inputBgColor, marginBottom: 12 }} readOnly />
                <label style={{ fontSize: 11, fontWeight: 700, color: colors.primaryColor, display: "block", marginBottom: 6 }}>PASSWORD</label>
                <input type="password" style={{ ...INPUT, background: colors.inputBgColor, marginBottom: 16 }} readOnly />
                <button style={{ ...btnStyle, background: `linear-gradient(90deg,${colors.primaryColor},${colors.accentColor})` }}>Connect</button>
              </div>
            )}
            {tab === "voucher" && (
              <div style={cardStyle}>
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>🎟 Redeem Voucher</div>
                  <div style={{ fontSize: 12, color: `${colors.textColor}88`, marginTop: 6 }}>Enter your printed code to get online</div>
                </div>
                <input placeholder="XXXX-XXXX-XXXX" style={{ ...INPUT, background: colors.inputBgColor, textAlign: "center", fontFamily: "monospace", fontSize: 16, marginBottom: 12 }} readOnly />
                <button style={{ ...btnStyle, background: "linear-gradient(90deg,#f59e0b,#ea580c)" }}>Activate Voucher</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ─── */
export default function HotspotSettings() {
  const [s, setS] = useState<HSettings>(loadSettings);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const logoRef  = useRef<HTMLInputElement>(null);
  const advertRef = useRef<HTMLInputElement>(null);

  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["routers_for_hsettings"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("id,name,host").eq("admin_id", ADMIN_ID).order("name");
      return (data ?? []) as DbRouter[];
    },
  });

  const upd = (key: keyof HSettings, val: string) => setS(p => ({ ...p, [key]: val }));
  const updColor = (key: keyof typeof DEFAULT_COLORS, val: string) =>
    setS(p => ({ ...p, colors: { ...p.colors, [key]: val } }));

  function handleFile(ref: React.RefObject<HTMLInputElement | null>, key: "logoUrl" | "advertUrl") {
    const file = ref.current?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => setS(p => ({ ...p, [key]: e.target?.result as string }));
    reader.readAsDataURL(file);
  }

  function handleSave() {
    setSaving(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    setTimeout(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500); }, 600);
  }

  const SECTION: React.CSSProperties = {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden", marginBottom: 24,
  };
  const SECTION_HEAD: React.CSSProperties = {
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)",
    display: "flex", alignItems: "center", gap: 8,
    color: "#f1f5f9", fontWeight: 700, fontSize: 15,
    background: "rgba(255,255,255,0.02)",
  };
  const SECTION_BODY: React.CSSProperties = { padding: "0 24px" };

  return (
    <AdminLayout>
      {showPreview && (
        <HotspotPreviewModal colors={s.colors} settings={s} onClose={() => setShowPreview(false)} />
      )}

      <div style={{ padding: "32px 40px", maxWidth: 940, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 24, margin: 0 }}>Hotspot Settings</h1>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>General configuration &amp; login page appearance</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setShowPreview(true)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.35)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              <Eye size={14} /> Preview Login Page
            </button>
            <button
              onClick={handleSave}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, background: saved ? "rgba(74,222,128,0.15)" : "rgba(6,182,212,0.12)", border: `1px solid ${saved ? "rgba(74,222,128,0.4)" : "rgba(6,182,212,0.35)"}`, color: saved ? "#4ade80" : "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>

        {/* General Settings */}
        <div style={SECTION}>
          <div style={SECTION_HEAD}><Info size={16} style={{ color: "#06b6d4" }} /> General Settings</div>
          <div style={SECTION_BODY}>
            <FieldRow label="Hotspot Page Title" icon={<span style={{ fontSize: 12 }}>H</span>}
              hint="Your ISP company name — appears as the main title on the hotspot page.">
              <input value={s.ispName} onChange={e => upd("ispName", e.target.value)} style={INPUT} />
            </FieldRow>

            <FieldRow label="Free Trial" hint='Select to enable or disable the free trial feature. Default is "Disable".'>
              <SelectField value={s.freeTrial} onChange={v => upd("freeTrial", v)} options={["Disable", "Enable"]} />
            </FieldRow>

            <FieldRow label="Enable Vouchers" hint='Select to enable or disable voucher activation and reconnection forms. Default is "Yes".'>
              <SelectField value={s.vouchers} onChange={v => upd("vouchers", v)} options={["Yes", "No"]} />
            </FieldRow>

            <FieldRow label="Brief Description / Tagline" hint="A short description or tagline displayed under the ISP name.">
              <input value={s.tagline} onChange={e => upd("tagline", e.target.value)} style={INPUT} />
            </FieldRow>

            <FieldRow label="Router" icon={<Wifi size={12} />}
              hint="Select the router this hotspot page is linked to.">
              <div style={{ position: "relative" }}>
                <select value={s.routerId} onChange={e => upd("routerId", e.target.value)} style={SELECT}>
                  <option value="">— Select router —</option>
                  {routers.map(r => <option key={r.id} value={String(r.id)}>{r.name}{r.host ? ` (${r.host})` : ""}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none" }} />
              </div>
            </FieldRow>

            <FieldRow label="Upload Logo" icon={<Image size={12} />}
              hint="Logo auto-resized. Only .png, .jpg, or .jpeg allowed.">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => logoRef.current?.click()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", fontSize: 13, cursor: "pointer" }}
                >
                  <Upload size={13} /> Choose File
                </button>
                <span style={{ fontSize: 12, color: "#64748b" }}>{s.logoUrl ? "Logo uploaded" : "No file chosen"}</span>
                <input ref={logoRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }} onChange={() => handleFile(logoRef, "logoUrl")} />
                {s.logoUrl && (
                  <div style={{ textAlign: "center" }}>
                    <img src={s.logoUrl} alt="logo" style={{ height: 48, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }} />
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Logo Preview</div>
                  </div>
                )}
              </div>
            </FieldRow>

            <FieldRow label="Upload Advert Banner" icon={<Image size={12} />}
              hint="Only one advert image allowed. Rectangular/landscape banner, max 500KB.">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => advertRef.current?.click()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", fontSize: 13, cursor: "pointer" }}
                >
                  <Upload size={13} /> Choose File
                </button>
                <span style={{ fontSize: 12, color: "#64748b" }}>{s.advertUrl ? "Banner uploaded" : "No file chosen"}</span>
                <input ref={advertRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }} onChange={() => handleFile(advertRef, "advertUrl")} />
                {s.advertUrl && (
                  <div style={{ textAlign: "center" }}>
                    <img src={s.advertUrl} alt="advert" style={{ height: 48, maxWidth: 200, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", objectFit: "cover" }} />
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Advert Preview</div>
                  </div>
                )}
              </div>
            </FieldRow>

            <FieldRow label="Advert Position" hint="Where the advert banner appears on the page.">
              <SelectField value={s.advertPos} onChange={v => upd("advertPos", v)} options={["Bottom", "Top", "Middle"]} />
            </FieldRow>

            <FieldRow label="Enable Advert" hint='If set to "Enable", your advert banner will appear.'>
              <SelectField value={s.enableAdvert} onChange={v => upd("enableAdvert", v)} options={["Disable", "Enable"]} />
            </FieldRow>

            <FieldRow label="Testimonials" hint="Display customer testimonials on the login page.">
              <SelectField value={s.testimonials} onChange={v => upd("testimonials", v)} options={["Disable", "Enable"]} />
            </FieldRow>

            <FieldRow label="FAQ Section" hint="Display a Frequently Asked Questions section on the login page.">
              <SelectField value={s.faqSection} onChange={v => upd("faqSection", v)} options={["Disable", "Enable"]} />
            </FieldRow>
          </div>
        </div>

        {/* Color Scheme */}
        <div style={SECTION}>
          <div style={SECTION_HEAD}><Palette size={16} style={{ color: "#a78bfa" }} /> Colour Scheme</div>
          <div style={{ padding: "24px" }}>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
              Customise the colours of your hotspot login page. Click <strong style={{ color: "#a78bfa" }}>Preview Login Page</strong> above to see changes live before saving.
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <ColorPicker label="Background (Top)"    value={s.colors.bgColor}     onChange={v => updColor("bgColor", v)} />
              <ColorPicker label="Background (Bottom)" value={s.colors.bgColor2}    onChange={v => updColor("bgColor2", v)} />
              <ColorPicker label="Primary / Accent"    value={s.colors.primaryColor} onChange={v => updColor("primaryColor", v)} />
              <ColorPicker label="Secondary Accent"    value={s.colors.accentColor}  onChange={v => updColor("accentColor", v)} />
              <ColorPicker label="Card Background"     value={s.colors.cardColor}    onChange={v => updColor("cardColor", v)} />
              <ColorPicker label="Pay Button"          value={s.colors.buttonColor}  onChange={v => updColor("buttonColor", v)} />
              <ColorPicker label="Text Color"          value={s.colors.textColor}    onChange={v => updColor("textColor", v)} />
              <ColorPicker label="Input Background"    value={s.colors.inputBgColor} onChange={v => updColor("inputBgColor", v)} />
            </div>

            {/* Quick presets */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Quick Presets</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { name: "Purple Night", colors: { bgColor: "#0d0415", bgColor2: "#1a0735", primaryColor: "#8b5cf6", accentColor: "#d946ef", cardColor: "#1a0f2e", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#000000" } },
                  { name: "Ocean Blue",   colors: { bgColor: "#020b18", bgColor2: "#051e38", primaryColor: "#0ea5e9", accentColor: "#06b6d4", cardColor: "#0c2340", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#020b18" } },
                  { name: "Forest Green", colors: { bgColor: "#051a0e", bgColor2: "#0d2e1a", primaryColor: "#22c55e", accentColor: "#4ade80", cardColor: "#0d2e1a", buttonColor: "#f59e0b", textColor: "#ffffff", inputBgColor: "#040d07" } },
                  { name: "Sunset Red",   colors: { bgColor: "#1a0508", bgColor2: "#2e0d14", primaryColor: "#f43f5e", accentColor: "#fb923c", cardColor: "#2e0d14", buttonColor: "#8b5cf6", textColor: "#ffffff", inputBgColor: "#0d0205" } },
                  { name: "Midnight Dark",colors: { bgColor: "#090909", bgColor2: "#141414", primaryColor: "#06b6d4", accentColor: "#0891b2", cardColor: "#1a1a1a", buttonColor: "#22c55e", textColor: "#ffffff", inputBgColor: "#000000" } },
                ].map(p => (
                  <button
                    key={p.name}
                    onClick={() => setS(prev => ({ ...prev, colors: p.colors as typeof DEFAULT_COLORS }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 14px", borderRadius: 8,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      color: "#e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", gap: 3 }}>
                      {[p.colors.bgColor, p.colors.primaryColor, p.colors.accentColor, p.colors.buttonColor].map((c, i) => (
                        <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c, display: "inline-block" }} />
                      ))}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom save */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={() => setShowPreview(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.35)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <Eye size={14} /> Preview Login Page
          </button>
          <button onClick={handleSave} style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, background: saved ? "rgba(74,222,128,0.15)" : "rgba(6,182,212,0.12)", border: `1px solid ${saved ? "rgba(74,222,128,0.4)" : "rgba(6,182,212,0.35)"}`, color: saved ? "#4ade80" : "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {saving ? <Loader2 size={14} /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
