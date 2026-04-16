import React, { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase } from "@/lib/supabase";
import type { DbRouter } from "@/lib/supabase";
import {
  Sliders, Upload, Eye, Save, Palette, Image,
  Info, ChevronDown, X, Loader2, Check, Wifi,
} from "lucide-react";

const ADMIN_ID = Number(localStorage.getItem("isp_admin_id") || "5");
const STORAGE_KEY = `pppoe_settings_${ADMIN_ID}`;

const DEFAULT_COLORS = {
  bgColor:      "#020b18",
  bgColor2:     "#051e38",
  primaryColor: "#2563EB",
  accentColor:  "#2563EB",
  cardColor:    "#0c2340",
  buttonColor:  "#10b981",
  textColor:    "#ffffff",
  inputBgColor: "#020b18",
};

interface PSettings {
  ispName:       string;
  tagline:       string;
  routerId:      string;
  enableVouchers:string;
  advertPos:     string;
  enableAdvert:  string;
  testimonials:  string;
  faqSection:    string;
  supportPhone:  string;
  supportEmail:  string;
  logoUrl:       string;
  advertUrl:     string;
  colors:        typeof DEFAULT_COLORS;
}

function loadSettings(): PSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch (_) {}
  return defaults();
}
function defaults(): PSettings {
  return {
    ispName:        "OCHOLASUPERNET",
    tagline:        "Fast PPPoE Broadband",
    routerId:       "",
    enableVouchers: "No",
    advertPos:      "Bottom",
    enableAdvert:   "Disable",
    testimonials:   "Disable",
    faqSection:     "Disable",
    supportPhone:   "",
    supportEmail:   "",
    logoUrl:        "",
    advertUrl:      "",
    colors:         DEFAULT_COLORS,
  };
}

/* ─── Shared styles ─── */
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
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 };

function FieldRow({ label, hint, icon, children }: { label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
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

function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={SELECT}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none" }} />
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 56, height: 56, border: "none", borderRadius: 10, cursor: "pointer", padding: 2, background: "rgba(0,0,0,0.3)" }} />
      <p style={{ fontSize: 10, color: "#64748b", textAlign: "center", maxWidth: 64, lineHeight: 1.3 }}>{label}</p>
      <p style={{ fontSize: 9, color: "#475569", fontFamily: "monospace" }}>{value}</p>
    </div>
  );
}

/* ─── PPPoE Login Preview Modal — mirrors actual PPPoELogin.tsx ─── */
function PPPoEPreviewModal({ onClose, settings, colors }: {
  onClose: () => void; settings: PSettings; colors: typeof DEFAULT_COLORS;
}) {
  const [tab, setTab] = useState<"login" | "forgot" | "voucher">("login");

  const bg = `linear-gradient(160deg, ${colors.bgColor} 0%, ${colors.bgColor2} 100%)`;
  const card: React.CSSProperties = {
    background: colors.cardColor,
    border: `1px solid ${colors.primaryColor}33`,
    borderRadius: 20, padding: "24px 28px",
  };
  const mainBtn: React.CSSProperties = {
    width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
    fontWeight: 700, fontSize: 14, color: "#fff", cursor: "pointer",
    background: `linear-gradient(90deg,${colors.primaryColor},${colors.accentColor})`,
  };
  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: colors.inputBgColor,
    border: `1px solid ${colors.primaryColor}22`,
    borderRadius: 10, padding: "12px 14px",
    color: colors.textColor, fontSize: 13, outline: "none", marginBottom: 12,
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 10, fontWeight: 700,
    color: colors.primaryColor, letterSpacing: "0.08em",
    marginBottom: 6, textTransform: "uppercase" as const,
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "9px 16px", borderRadius: 9, border: "none", cursor: "pointer",
    fontSize: 12, fontWeight: 700,
    background: active ? colors.primaryColor : "transparent",
    color: active ? "#fff" : `${colors.textColor}88`,
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "min(920px,96vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>

        {/* toolbar */}
        <div style={{ background: "#0f172a", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eye size={16} style={{ color: colors.primaryColor }} />
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>PPPoE Login Page Preview</span>
            <span style={{ fontSize: 11, color: "#64748b", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 6 }}>Live preview — changes not yet saved</span>
          </div>
          <button onClick={onClose} style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "6px 12px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <X size={13} /> Close Preview
          </button>
        </div>

        {/* page body */}
        <div style={{ flex: 1, overflowY: "auto", background: bg, color: colors.textColor, fontFamily: "sans-serif" }}>

          {/* ── Header ── */}
          <div style={{ padding: "16px 40px", borderBottom: `1px solid ${colors.primaryColor}1a`, background: `${colors.bgColor}cc`, backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {settings.logoUrl ? (
                <img src={settings.logoUrl} alt="logo" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${colors.primaryColor},${colors.accentColor})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sliders size={18} color="#fff" />
                </div>
              )}
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{settings.ispName}</div>
                <div style={{ fontSize: 10, color: colors.primaryColor }}>PPPoE Client Portal · {settings.ispName.toLowerCase()}.net</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 99, padding: "4px 12px" }}>● Service Active</div>
          </div>

          {/* ── Hero ── */}
          <div style={{ textAlign: "center", padding: "36px 32px 20px" }}>
            <h2 style={{ fontSize: 30, fontWeight: 900, margin: "0 0 10px" }}>
              Your{" "}
              <span style={{ background: `linear-gradient(90deg,${colors.primaryColor},${colors.accentColor})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Broadband Portal
              </span>
            </h2>
            <p style={{ color: `${colors.textColor}88`, fontSize: 13, margin: 0 }}>
              {settings.tagline || "Manage your PPPoE account, track usage and renew your subscription."}
            </p>
          </div>

          {/* ── Stats bar ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, maxWidth: 520, margin: "0 auto 28px", padding: "0 24px" }}>
            {[
              { icon: "⚡", label: "Speed",   value: "Up to 100 Mbps" },
              { icon: "✅", label: "Uptime",  value: "99.9%" },
              { icon: "🛠", label: "Support", value: "24/7" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: `${colors.primaryColor}aa`, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── Tabs ── */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 4, display: "inline-flex", gap: 2 }}>
              {(["login", "forgot", "voucher"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
                  {t === "login" ? "Member Login" : t === "forgot" ? "Forgot Password" : "Redeem Voucher"}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab content ── */}
          <div style={{ maxWidth: 440, margin: "0 auto", padding: "0 24px 48px" }}>

            {tab === "login" && (
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${colors.primaryColor}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👤</div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>Member Login</div>
                </div>
                <label style={lbl}>Username</label>
                <input style={inp} readOnly placeholder="your_username" />
                <label style={lbl}>Password</label>
                <input type="password" style={{ ...inp, marginBottom: 20 }} readOnly placeholder="••••••••" />
                <button style={mainBtn}>Login</button>
                <p style={{ textAlign: "center", fontSize: 11, color: `${colors.textColor}55`, marginTop: 14 }}>
                  Forgot your credentials?{" "}
                  <span onClick={() => setTab("forgot")} style={{ color: colors.primaryColor, fontWeight: 700, cursor: "pointer" }}>Reset here</span>
                </p>
                {settings.supportPhone && (
                  <p style={{ textAlign: "center", fontSize: 11, color: `${colors.textColor}44`, marginTop: 8 }}>
                    Need help? Call <strong style={{ color: colors.primaryColor }}>{settings.supportPhone}</strong>
                  </p>
                )}
              </div>
            )}

            {tab === "forgot" && (
              <div style={{ ...card, borderColor: `#f59e0b33` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔑</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>Reset Password</div>
                    <div style={{ fontSize: 11, color: `${colors.textColor}66` }}>Enter your registered phone number</div>
                  </div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <label style={{ ...lbl, color: "#f59e0b" }}>Phone Number</label>
                  <input placeholder="07XX XXX XXX" style={{ ...inp, borderColor: "rgba(245,158,11,0.2)" }} readOnly />
                </div>
                <button style={{ ...mainBtn, marginTop: 4, background: "linear-gradient(90deg,#f59e0b,#ea580c)" }}>Request Reset</button>
              </div>
            )}

            {tab === "voucher" && (
              <div style={{ ...card, borderColor: `${colors.primaryColor}22` }}>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${colors.primaryColor}22`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: 22 }}>🎟</div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>Redeem Voucher</div>
                  <div style={{ fontSize: 12, color: `${colors.textColor}66`, marginTop: 4 }}>Enter your voucher code to renew your PPPoE subscription</div>
                </div>
                <input
                  placeholder="XXXX-XXXX-XXXX"
                  style={{ ...inp, textAlign: "center", fontFamily: "monospace", fontSize: 17, letterSpacing: "0.15em", color: colors.primaryColor, borderColor: `${colors.primaryColor}33`, marginBottom: 16 }}
                  readOnly
                />
                <button style={mainBtn}>Activate Voucher</button>
              </div>
            )}

          </div>

          {/* ── Footer ── */}
          <div style={{ textAlign: "center", padding: "16px 0 28px", borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 11, color: `${colors.textColor}33` }}>
            &copy; {new Date().getFullYear()} {settings.ispName} — PPPoE Client Portal
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ─── */
export default function PPPoESettings() {
  const [s, setS] = useState<PSettings>(loadSettings);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const logoRef  = useRef<HTMLInputElement>(null);
  const advertRef = useRef<HTMLInputElement>(null);

  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["routers_for_pppoe_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("id,name,host").eq("admin_id", ADMIN_ID).order("name");
      return (data ?? []) as DbRouter[];
    },
  });

  const upd = (key: keyof PSettings, val: string) => setS(p => ({ ...p, [key]: val }));
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
    background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden", marginBottom: 24,
  };
  const SECTION_HEAD: React.CSSProperties = {
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)",
    display: "flex", alignItems: "center", gap: 8,
    color: "#f1f5f9", fontWeight: 700, fontSize: 15,
    background: "rgba(255,255,255,0.02)",
  };
  const SECTION_BODY: React.CSSProperties = { padding: "0 24px" };

  const actBtnBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 7,
    padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  };

  return (
    <AdminLayout>
      {showPreview && (
        <PPPoEPreviewModal colors={s.colors} settings={s} onClose={() => setShowPreview(false)} />
      )}

      <div style={{ padding: "32px 40px", maxWidth: 940, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 24, margin: 0 }}>PPPoE Settings</h1>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>General configuration &amp; login page appearance</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowPreview(true)} style={{ ...actBtnBase, background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.35)", color: "#38bdf8" }}>
              <Eye size={14} /> Preview Login Page
            </button>
            <button onClick={handleSave} style={{ ...actBtnBase, background: saved ? "rgba(74,222,128,0.15)" : "rgba(37,99,235,0.12)", border: `1px solid ${saved ? "rgba(74,222,128,0.4)" : "rgba(37,99,235,0.35)"}`, color: saved ? "#4ade80" : "#2563EB" }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>

        {/* General Settings */}
        <div style={SECTION}>
          <div style={SECTION_HEAD}><Info size={16} style={{ color: "#2563EB" }} /> General Settings</div>
          <div style={SECTION_BODY}>
            <FieldRow label="PPPoE Page Title" hint="Your ISP name — displayed as the main heading on the PPPoE login page.">
              <input value={s.ispName} onChange={e => upd("ispName", e.target.value)} style={INPUT} />
            </FieldRow>

            <FieldRow label="Tagline" hint="A short description displayed under the ISP name.">
              <input value={s.tagline} onChange={e => upd("tagline", e.target.value)} style={INPUT} />
            </FieldRow>

            <FieldRow label="Router" icon={<Wifi size={12} />} hint="Select the router this PPPoE login page is linked to.">
              <div style={{ position: "relative" }}>
                <select value={s.routerId} onChange={e => upd("routerId", e.target.value)} style={SELECT}>
                  <option value="">— Select router —</option>
                  {routers.map(r => <option key={r.id} value={String(r.id)}>{r.name}{r.host ? ` (${r.host})` : ""}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none" }} />
              </div>
            </FieldRow>

            <FieldRow label="Enable Vouchers" hint="Allow users to redeem voucher codes on the PPPoE login page.">
              <SelectField value={s.enableVouchers} onChange={v => upd("enableVouchers", v)} options={["No", "Yes"]} />
            </FieldRow>

            <FieldRow label="Support Phone" hint="Optional support number displayed on the login page.">
              <input value={s.supportPhone} onChange={e => upd("supportPhone", e.target.value)} style={INPUT} placeholder="e.g. 0712 345 678" />
            </FieldRow>

            <FieldRow label="Support Email" hint="Optional support email displayed on the login page.">
              <input value={s.supportEmail} onChange={e => upd("supportEmail", e.target.value)} style={INPUT} placeholder="e.g. support@example.com" />
            </FieldRow>

            <FieldRow label="Upload Logo" icon={<Image size={12} />} hint="Only .png, .jpg, .jpeg allowed.">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => logoRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", fontSize: 13, cursor: "pointer" }}>
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

            <FieldRow label="Upload Advert Banner" icon={<Image size={12} />} hint="Rectangular/landscape banner, max 500KB.">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => advertRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", fontSize: 13, cursor: "pointer" }}>
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

            <FieldRow label="Testimonials" hint="Show customer testimonials on the PPPoE login page.">
              <SelectField value={s.testimonials} onChange={v => upd("testimonials", v)} options={["Disable", "Enable"]} />
            </FieldRow>

            <FieldRow label="FAQ Section" hint="Show a FAQ section on the PPPoE login page.">
              <SelectField value={s.faqSection} onChange={v => upd("faqSection", v)} options={["Disable", "Enable"]} />
            </FieldRow>
          </div>
        </div>

        {/* Colour Scheme */}
        <div style={SECTION}>
          <div style={SECTION_HEAD}><Palette size={16} style={{ color: "#38bdf8" }} /> Colour Scheme</div>
          <div style={{ padding: "24px" }}>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
              Customise the colours of your PPPoE login page. Click <strong style={{ color: "#38bdf8" }}>Preview Login Page</strong> above to see changes live before saving.
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <ColorPicker label="Background (Top)"    value={s.colors.bgColor}      onChange={v => updColor("bgColor", v)} />
              <ColorPicker label="Background (Bottom)" value={s.colors.bgColor2}     onChange={v => updColor("bgColor2", v)} />
              <ColorPicker label="Primary / Accent"    value={s.colors.primaryColor} onChange={v => updColor("primaryColor", v)} />
              <ColorPicker label="Secondary Accent"    value={s.colors.accentColor}  onChange={v => updColor("accentColor", v)} />
              <ColorPicker label="Card Background"     value={s.colors.cardColor}    onChange={v => updColor("cardColor", v)} />
              <ColorPicker label="Button Color"        value={s.colors.buttonColor}  onChange={v => updColor("buttonColor", v)} />
              <ColorPicker label="Text Color"          value={s.colors.textColor}    onChange={v => updColor("textColor", v)} />
              <ColorPicker label="Input Background"    value={s.colors.inputBgColor} onChange={v => updColor("inputBgColor", v)} />
            </div>

            {/* Presets */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Quick Presets</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { name: "Ocean Blue",    colors: { bgColor: "#020b18", bgColor2: "#051e38", primaryColor: "#0ea5e9", accentColor: "#2563EB", cardColor: "#0c2340", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#020b18" } },
                  { name: "Purple Night",  colors: { bgColor: "#0d0415", bgColor2: "#1a0735", primaryColor: "#8b5cf6", accentColor: "#d946ef", cardColor: "#1a0f2e", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#000000" } },
                  { name: "Forest Green",  colors: { bgColor: "#051a0e", bgColor2: "#0d2e1a", primaryColor: "#22c55e", accentColor: "#4ade80", cardColor: "#0d2e1a", buttonColor: "#f59e0b", textColor: "#ffffff", inputBgColor: "#040d07" } },
                  { name: "Corporate",     colors: { bgColor: "#0f172a", bgColor2: "#1e293b", primaryColor: "#3b82f6", accentColor: "#2563eb", cardColor: "#1e293b", buttonColor: "#22c55e", textColor: "#ffffff", inputBgColor: "#0f172a" } },
                  { name: "Midnight Dark", colors: { bgColor: "#090909", bgColor2: "#141414", primaryColor: "#2563EB", accentColor: "#1D4ED8", cardColor: "#1a1a1a", buttonColor: "#22c55e", textColor: "#ffffff", inputBgColor: "#000000" } },
                ].map(p => (
                  <button key={p.name}
                    onClick={() => setS(prev => ({ ...prev, colors: p.colors as typeof DEFAULT_COLORS }))}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
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
          <button onClick={() => setShowPreview(true)} style={{ ...{ display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }, background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.35)", color: "#38bdf8" }}>
            <Eye size={14} /> Preview Login Page
          </button>
          <button onClick={handleSave} style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, background: saved ? "rgba(74,222,128,0.15)" : "rgba(37,99,235,0.12)", border: `1px solid ${saved ? "rgba(74,222,128,0.4)" : "rgba(37,99,235,0.35)"}`, color: saved ? "#4ade80" : "#2563EB", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {saving ? <Loader2 size={14} /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
