import React, { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { MOCK_PLANS, MOCK_BANDWIDTH_PLANS } from "@/hooks/use-mock-api";
import { Plus, Wifi, Activity, Edit, Trash, Gauge, ArrowDown, ArrowUp, Users, X } from "lucide-react";

/* ─── localStorage persistence ─── */
const LS_PLANS = "ochola_service_plans";
const LS_BW    = "ochola_bandwidth_plans";

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function saveToStorage<T>(key: string, data: T) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore quota errors */ }
}

function useTypeParam() {
  const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
  return raw ?? "hotspot";
}

/* ─── Plan types ─── */
type ServicePlan = typeof MOCK_PLANS[0];
type BwPlan      = typeof MOCK_BANDWIDTH_PLANS[0];

/* ─── shared styles ─── */
const ROW: React.CSSProperties    = { display: "flex", alignItems: "flex-start", gap: "1rem" };
const LBL: React.CSSProperties    = { fontWeight: 700, fontSize: "0.875rem", color: "var(--isp-text)", minWidth: 170, flexShrink: 0, paddingTop: "0.45rem", textAlign: "right" };
const LBL_CYAN: React.CSSProperties = { ...LBL, color: "#06b6d4" };
const INPUT: React.CSSProperties  = { flex: 1, padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit", width: "100%" };
const SELECT: React.CSSProperties = { padding: "0.5rem 0.75rem", borderRadius: 6, background: "var(--isp-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit", cursor: "pointer" };
const HINT: React.CSSProperties   = { fontSize: "0.75rem", color: "var(--isp-text-muted)", marginTop: "0.3rem" };

function Radio({ name, value, checked, onChange, label }: { name: string; value: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", cursor: "pointer", fontSize: "0.875rem", color: "var(--isp-text)" }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} style={{ accentColor: "#06b6d4", width: 15, height: 15, cursor: "pointer" }} />
      {label}
    </label>
  );
}

/* ─── parse validity string ─── */
function parseValidity(v: string): { num: string; unit: string } {
  const m = v.match(/^(\d+)\s*(Min|Hour|Day|Week|Month)/i);
  if (!m) return { num: "1", unit: "Days" };
  const n = m[1];
  const w = m[2].toLowerCase();
  const unit =
    w.startsWith("min") ? "Mins" :
    w.startsWith("hour") ? "Hours" :
    w.startsWith("day") ? "Days" :
    w.startsWith("week") ? "Weeks" : "Months";
  return { num: n, unit };
}

/* ═══════════════════════════════════════════════════════════
   ADD / EDIT SERVICE PLAN FORM
═══════════════════════════════════════════════════════════ */
interface AddServicePlanFormProps {
  planType: string;
  onCancel: () => void;
  onSave: (updated: Partial<ServicePlan> & { id?: number }) => void;
  initialData?: ServicePlan | null;
}

function AddServicePlanForm({ planType, onCancel, onSave, initialData }: AddServicePlanFormProps) {
  const isEdit = !!initialData;
  const parsed = initialData ? parseValidity(initialData.validity) : { num: "", unit: "Days" };

  const [status, setStatus]           = useState<"enable"|"disable">(initialData ? (initialData.active ? "enable" : "disable") : "enable");
  const [canBuy, setCanBuy]           = useState<"yes"|"no">("yes");
  const [name, setName]               = useState(initialData?.name ?? "");
  const [type, setType]               = useState<"unlimited"|"limited">("unlimited");
  const [bandwidth, setBandwidth]     = useState("");
  const [price, setPrice]             = useState(initialData?.price?.toString() ?? "");
  const [shared, setShared]           = useState("1");
  const [validity, setValidity]       = useState(parsed.num);
  const [valUnit, setValUnit]         = useState(parsed.unit);
  const [router, setRouter]           = useState("");
  const [activePool, setActivePool]   = useState("");
  const [expiredPool, setExpiredPool] = useState("");
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  const units           = ["Mins", "Hours", "Days", "Weeks", "Months"];
  const bandwidthOptions = MOCK_BANDWIDTH_PLANS.map(b => b.name);
  const routerOptions   = ["latty1 — L009UiGS-2HaxD", "main-router — CCR1009", "backup-router — RB750Gr3"];
  const poolOptions     = ["hs-pool-1 (192.168.2.2–192.168.2.254)", "pppoe-pool-1 (10.10.0.1–10.10.0.254)", "static-pool (10.20.0.1–10.20.0.50)"];
  const expiredPoolOptions = ["expired-pool (192.168.178.5–192.168.178.254)", "blocked-pool (192.168.200.1–192.168.200.254)"];

  const isPppoe   = planType === "pppoe";
  const isHotspot = planType === "hotspot" || planType === "trials";
  const typeLabel = planType === "hotspot" ? "Hotspot" : planType === "pppoe" ? "PPPoE" : planType === "trials" ? "Trial" : "Static IP";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      onSave({
        id: initialData?.id,
        name,
        price: parseFloat(price) || 0,
        validity: `${validity} ${valUnit.replace(/s$/, validity === "1" ? "" : "s")}`,
        active: status === "enable",
        type: planType,
      });
      setTimeout(() => { setSaved(false); onCancel(); }, 1000);
    }, 700);
  };

  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden", maxWidth: 780 }}>
      {/* Header */}
      <div style={{ padding: "0.875rem 1.5rem", background: "rgba(6,182,212,0.06)", borderBottom: "2px solid #06b6d4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--isp-text)" }}>
          {isEdit ? "Edit Service Plan" : "Add Service Plan"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "0.7rem", color: "#06b6d4", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 4, padding: "0.15rem 0.5rem", fontWeight: 700, textTransform: "capitalize" }}>
            {typeLabel} Plan
          </span>
          {isEdit && (
            <span style={{ fontSize: "0.7rem", color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4, padding: "0.15rem 0.5rem", fontWeight: 700 }}>
              Editing ID #{initialData?.id}
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>

        {/* Status */}
        <div style={ROW}>
          <span style={LBL}>Status</span>
          <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
            <Radio name="status" value="enable"  checked={status==="enable"}  onChange={() => setStatus("enable")}  label="Enable" />
            <Radio name="status" value="disable" checked={status==="disable"} onChange={() => setStatus("disable")} label="Disable" />
          </div>
        </div>

        {/* Client Can Purchase */}
        <div style={ROW}>
          <span style={LBL}>Client Can Purchase</span>
          <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
            <Radio name="canBuy" value="yes" checked={canBuy==="yes"} onChange={() => setCanBuy("yes")} label="Yes" />
            <Radio name="canBuy" value="no"  checked={canBuy==="no"}  onChange={() => setCanBuy("no")}  label="No" />
          </div>
        </div>

        {/* Plan Name */}
        <div style={ROW}>
          <span style={LBL}>Plan Name</span>
          <input style={INPUT} value={name} onChange={e => setName(e.target.value)}
            placeholder={`e.g. ${typeLabel} 10Mbps Daily`} required />
        </div>

        {/* Plan Type — hotspot/trials only */}
        {isHotspot && (
          <div style={ROW}>
            <span style={LBL}>Plan Type</span>
            <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
              <Radio name="planType" value="unlimited" checked={type==="unlimited"} onChange={() => setType("unlimited")} label="Unlimited" />
              <Radio name="planType" value="limited"   checked={type==="limited"}   onChange={() => setType("limited")}   label="Limited" />
            </div>
          </div>
        )}

        {/* Bandwidth Name */}
        <div style={ROW}>
          <span style={LBL_CYAN}>Bandwidth Name</span>
          <select style={{ ...SELECT, flex: 1 }} value={bandwidth} onChange={e => setBandwidth(e.target.value)} required>
            <option value="">Select Bandwidth...</option>
            {bandwidthOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Plan Price */}
        <div style={ROW}>
          <span style={LBL}>Plan Price</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 0 }}>
            <span style={{ padding: "0.5rem 0.625rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: "0.825rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
              Ksh.
            </span>
            <input type="number" min="0" style={{ ...INPUT, borderRadius: "0 6px 6px 0", borderLeft: "none" }}
              value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 500" required />
          </div>
        </div>

        {/* Shared Users — hotspot/trials only */}
        {isHotspot && (
          <div style={ROW}>
            <span style={LBL}>Shared Users</span>
            <div style={{ flex: 1 }}>
              <input type="number" min="1" style={INPUT} value={shared} onChange={e => setShared(e.target.value)} />
              <p style={HINT}>Set to 1 if you want 1 device per purchase.</p>
            </div>
          </div>
        )}

        {/* Plan Validity */}
        <div style={ROW}>
          <span style={LBL}>Plan Validity</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input type="number" min="1" style={INPUT} value={validity}
              onChange={e => setValidity(e.target.value)} placeholder="e.g. 1" required />
            <select style={SELECT} value={valUnit} onChange={e => setValUnit(e.target.value)}>
              {units.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Router Name */}
        <div style={ROW}>
          <span style={LBL_CYAN}>Router Name</span>
          <div style={{ flex: 1 }}>
            <select style={{ ...SELECT, width: "100%" }} value={router} onChange={e => setRouter(e.target.value)} required>
              <option value="">Select Routers</option>
              {routerOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {!isEdit && <p style={HINT}>Cannot be changed after saved.</p>}
          </div>
        </div>

        {/* Active IP Pool — PPPoE only */}
        {isPppoe && (
          <div style={ROW}>
            <span style={LBL_CYAN}>Active IP Pool</span>
            <select style={{ ...SELECT, flex: 1 }} value={activePool} onChange={e => setActivePool(e.target.value)}>
              <option value="">Select Pool</option>
              {poolOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}

        {/* Expired IP Pool — PPPoE only */}
        {isPppoe && (
          <div style={ROW}>
            <span style={LBL}>Expired IP Pool</span>
            <div style={{ flex: 1 }}>
              <select style={{ ...SELECT, width: "100%" }} value={expiredPool} onChange={e => setExpiredPool(e.target.value)}>
                <option value="">Select Expired Pool</option>
                {expiredPoolOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <p style={{ ...HINT, lineHeight: 1.65, marginTop: "0.5rem" }}>
                Make sure your expired PPPoE pool is in the range{" "}
                <code style={{ color: "#f87171", background: "rgba(248,113,113,0.1)", padding: "0 0.2rem", borderRadius: 3, fontSize: "0.75rem" }}>192.168.178.5–192.168.178.254</code>.{" "}
                You can add the pool in <strong>Network → Pools</strong>. Choose this if you want customers to see an expiry page and payment portal once the account has expired or else leave it blank.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingTop: "0.5rem" }}>
          <button type="submit"
            style={{ padding: "0.55rem 1.75rem", borderRadius: 8, background: saving ? "rgba(6,182,212,0.6)" : "#06b6d4", color: "white", border: "none", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "background 0.2s" }}>
            {saving ? "Saving…" : saved ? "✓ Saved!" : isEdit ? "Update Plan" : "Save Changes"}
          </button>
          <span style={{ fontSize: "0.85rem", color: "var(--isp-text-muted)" }}>Or</span>
          <button type="button" onClick={onCancel}
            style={{ background: "none", border: "none", color: "#06b6d4", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DELETE CONFIRM MODAL
═══════════════════════════════════════════════════════════ */
function DeleteModal({ planName, onConfirm, onCancel }: { planName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "var(--isp-card, #1a2440)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "2rem", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash size={20} style={{ color: "#f87171" }} />
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}><X size={18} /></button>
        </div>
        <h3 style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: "1rem", margin: "0 0 8px" }}>Delete Plan?</h3>
        <p style={{ color: "var(--isp-text-muted)", fontSize: "0.83rem", lineHeight: 1.6, margin: "0 0 20px" }}>
          You are about to permanently delete <strong style={{ color: "var(--isp-text)" }}>{planName}</strong>. Any active subscribers on this plan will not be affected, but no new activations will be possible.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onConfirm} style={{ flex: 1, padding: "0.55rem", borderRadius: 8, background: "#ef4444", color: "white", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
            Yes, Delete
          </button>
          <button onClick={onCancel} style={{ flex: 1, padding: "0.55rem", borderRadius: 8, background: "transparent", color: "var(--isp-text-muted)", border: "1px solid var(--isp-border)", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ADD / EDIT BANDWIDTH FORM
═══════════════════════════════════════════════════════════ */
const BW_INPUT: React.CSSProperties  = { flex: 1, padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit" };
const BW_LBL: React.CSSProperties   = { fontWeight: 700, fontSize: "0.85rem", color: "var(--isp-text)", display: "flex", alignItems: "center", minWidth: 160, flexShrink: 0 };
const BW_SELECT: React.CSSProperties= { padding: "0.5rem 0.75rem", borderRadius: 6, background: "var(--isp-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit", cursor: "pointer" };

interface AddBandwidthFormProps {
  onCancel?: () => void;
  onSave?: (updated: Partial<BwPlan> & { id?: number }) => void;
  initialData?: BwPlan | null;
}

function AddBandwidthForm({ onCancel, onSave, initialData }: AddBandwidthFormProps) {
  const isEdit = !!initialData;
  const [name,    setName]    = useState(initialData?.name    ?? "");
  const [dl,      setDl]      = useState(initialData?.download?.toString() ?? "");
  const [dlUnit,  setDlUnit]  = useState(initialData?.unit    ?? "Mbps");
  const [ul,      setUl]      = useState(initialData?.upload?.toString()   ?? "");
  const [ulUnit,  setUlUnit]  = useState(initialData?.unit    ?? "Mbps");
  const [burst,   setBurst]   = useState(initialData?.burst   ?? false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const units = ["Kbps", "Mbps", "Gbps"];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      onSave?.({ id: initialData?.id, name, download: parseFloat(dl), upload: parseFloat(ul), unit: dlUnit, burst });
      setTimeout(() => { setSaved(false); onCancel?.(); }, 1000);
    }, 700);
  };

  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
      <div style={{ padding: "0.875rem 1.25rem", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--isp-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--isp-text)" }}>
          {isEdit ? `Edit Bandwidth — ${initialData?.name}` : "Add New Bandwidth"}
        </span>
        <button style={{ padding: "0.3rem 0.875rem", borderRadius: 6, background: "#06b6d4", color: "white", border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          onClick={() => alert("Bandwidth documentation coming soon!")}>
          Need Help?
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: "1.5rem 1.25rem", display: "flex", flexDirection: "column", gap: "1.125rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Bandwidth Name</span>
          <input style={BW_INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 10Mbps Standard" required />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Rate Download</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" value={dl} onChange={e => setDl(e.target.value)} placeholder="e.g. 10" required />
            <select style={BW_SELECT} value={dlUnit} onChange={e => setDlUnit(e.target.value)}>
              {units.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Rate Upload</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" value={ul} onChange={e => setUl(e.target.value)} placeholder="e.g. 10" required />
            <select style={BW_SELECT} value={ulUnit} onChange={e => setUlUnit(e.target.value)}>
              {units.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
          <span style={{ ...BW_LBL, paddingTop: "0.1rem" }}>Enable Burst? (At<br />Your Own Risk)</span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="checkbox" checked={burst} onChange={e => setBurst(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#06b6d4" }} />
            {burst && (
              <p style={{ fontSize: "0.78rem", color: "#f87171", lineHeight: 1.65, margin: 0 }}>
                <strong>**Disclaimer**</strong>: Misconfiguring burst settings can cause performance issues, customers
                getting unlimited internet or even hotspot/pppoe users not getting connected. If you
                are unsure, please consult an administrator before proceeding.
              </p>
            )}
          </div>
        </div>
        {burst && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={BW_LBL}>Burst Download</span>
              <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
                <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" placeholder="e.g. 20" />
                <select style={BW_SELECT}>{units.map(u => <option key={u}>{u}</option>)}</select>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={BW_LBL}>Burst Upload</span>
              <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
                <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" placeholder="e.g. 20" />
                <select style={BW_SELECT}>{units.map(u => <option key={u}>{u}</option>)}</select>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={BW_LBL}>Burst Threshold</span>
              <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
                <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" placeholder="e.g. 8" />
                <select style={BW_SELECT}>{units.map(u => <option key={u}>{u}</option>)}</select>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={BW_LBL}>Burst Time (sec)</span>
              <input style={BW_INPUT} type="number" min="1" placeholder="e.g. 30" />
            </div>
          </>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingTop: "0.25rem" }}>
          <button type="submit"
            style={{ padding: "0.55rem 1.75rem", borderRadius: 8, background: saving ? "rgba(6,182,212,0.6)" : "#06b6d4", color: "white", border: "none", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {saving ? "Saving…" : saved ? "✓ Saved!" : isEdit ? "Update Bandwidth" : "Submit"}
          </button>
          <span style={{ fontSize: "0.85rem", color: "var(--isp-text-muted)" }}>Or</span>
          <button type="button" onClick={onCancel}
            style={{ padding: 0, background: "none", border: "none", color: "#06b6d4", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BANDWIDTH PLAN CARD
═══════════════════════════════════════════════════════════ */
function BandwidthCard({ plan, onEdit, onDelete }: { plan: BwPlan; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden", transition: "border-color 0.2s" }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(6,182,212,0.4)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--isp-border)")}>
      <div style={{ height: 3, background: "linear-gradient(90deg, #06b6d4, #0891b2)" }} />
      <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Gauge style={{ width: 15, height: 15, color: "#06b6d4" }} />
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--isp-text)" }}>{plan.name}</span>
        </div>
        {plan.burst && <span style={{ fontSize: "0.65rem", color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700 }}>⚡ Burst</span>}
      </div>
      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
          <ArrowDown style={{ width: 13, height: 13, color: "#22c55e" }} />
          <span>Download:</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{plan.download} {plan.unit}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
          <ArrowUp style={{ width: 13, height: 13, color: "#f59e0b" }} />
          <span>Upload:</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{plan.upload} {plan.unit}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--isp-text-muted)", borderTop: "1px solid var(--isp-border-subtle)", paddingTop: "0.5rem" }}>
          <Users style={{ width: 12, height: 12 }} /> {plan.usedBy} plans using this profile
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
          <button onClick={onEdit} style={{ flex: 1, padding: "0.45rem", borderRadius: 8, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)", color: "#06b6d4", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}>
            <Edit style={{ width: 11, height: 11 }} /> Edit
          </button>
          <button onClick={onDelete} style={{ flex: 1, padding: "0.45rem", borderRadius: 8, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}>
            <Trash style={{ width: 11, height: 11 }} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BANDWIDTH PLANS TAB
═══════════════════════════════════════════════════════════ */
function BandwidthPlansTab() {
  const [plans, setPlans]       = useState<BwPlan[]>(() => loadFromStorage<BwPlan[]>(LS_BW, MOCK_BANDWIDTH_PLANS));
  const [showForm, setShowForm] = useState(false);
  const [editingBw, setEditingBw] = useState<BwPlan | null>(null);
  const [deletingBw, setDeletingBw] = useState<BwPlan | null>(null);

  useEffect(() => { saveToStorage(LS_BW, plans); }, [plans]);

  function openAdd()           { setEditingBw(null); setShowForm(true); }
  function openEdit(p: BwPlan) { setEditingBw(p);    setShowForm(true); }
  function closeForm()         { setShowForm(false);  setEditingBw(null); }

  function handleSave(updated: Partial<BwPlan> & { id?: number }) {
    if (updated.id) {
      setPlans(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } as BwPlan : p));
    } else {
      setPlans(ps => [...ps, { ...updated, id: Date.now(), usedBy: 0 } as BwPlan]);
    }
    closeForm();
  }

  function handleDelete(id: number) {
    setPlans(ps => ps.filter(p => p.id !== id));
    setDeletingBw(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {deletingBw && (
        <DeleteModal
          planName={deletingBw.name}
          onConfirm={() => handleDelete(deletingBw.id)}
          onCancel={() => setDeletingBw(null)}
        />
      )}

      {!showForm ? (
        <button onClick={openAdd}
          style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1.125rem", borderRadius: 10, background: "#06b6d4", color: "white", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(6,182,212,0.3)" }}>
          <Plus style={{ width: 15, height: 15 }} /> Add Bandwidth Profile
        </button>
      ) : (
        <AddBandwidthForm initialData={editingBw} onCancel={closeForm} onSave={handleSave} />
      )}

      <div>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>
          Existing Bandwidth Profiles — {plans.length}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1rem" }}>
          {plans.map(p => (
            <BandwidthCard key={p.id} plan={p}
              onEdit={() => { openEdit(p); }}
              onDelete={() => setDeletingBw(p)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PLANS PAGE
═══════════════════════════════════════════════════════════ */
const TAB_LABELS: Record<string, string> = {
  hotspot: "Hotspot Plans", pppoe: "PPPoE Plans", static: "Static IP Plans",
  bandwidth: "Bandwidth Plans", trials: "Hotspot Trials", fup: "FUP",
};

export default function Plans() {
  const typeParam  = useTypeParam();
  const [activeTab, setActiveTab]   = useState(typeParam);
  const [localPlans, setLocalPlans] = useState<ServicePlan[]>(() => loadFromStorage<ServicePlan[]>(LS_PLANS, MOCK_PLANS));
  const [editingPlan, setEditingPlan]   = useState<ServicePlan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<ServicePlan | null>(null);
  const [showAddForm, setShowAddForm]   = useState(false);

  useEffect(() => { saveToStorage(LS_PLANS, localPlans); }, [localPlans]);

  const filteredPlans = localPlans.filter(p => p.type === activeTab);

  const TABS = [
    { id: "hotspot",   label: "Hotspot Plans" },
    { id: "pppoe",     label: "PPPoE Plans" },
    { id: "static",    label: "Static IP Plans" },
    { id: "bandwidth", label: "Bandwidth Plans" },
    { id: "trials",    label: "Hotspot Trials" },
    { id: "fup",       label: "FUP" },
  ];

  const isBandwidth   = activeTab === "bandwidth";
  const isServicePlan = !isBandwidth;
  const showingForm   = showAddForm || !!editingPlan;

  function openEdit(plan: ServicePlan) {
    setEditingPlan(plan);
    setShowAddForm(false);
  }

  function closeForm() {
    setShowAddForm(false);
    setEditingPlan(null);
  }

  function handleSave(updated: Partial<ServicePlan> & { id?: number }) {
    if (updated.id) {
      setLocalPlans(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } as ServicePlan : p));
    } else {
      setLocalPlans(ps => [...ps, { ...updated, id: Date.now(), users: 0, burst: false, data: "Unlimited", speed: "—" } as ServicePlan]);
    }
    closeForm();
  }

  function handleDelete(id: number) {
    setLocalPlans(ps => ps.filter(p => p.id !== id));
    setDeletingPlan(null);
  }

  return (
    <AdminLayout>
      {/* Delete confirmation modal */}
      {deletingPlan && (
        <DeleteModal
          planName={deletingPlan.name}
          onConfirm={() => handleDelete(deletingPlan.id)}
          onCancel={() => setDeletingPlan(null)}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">
            {TAB_LABELS[activeTab] ?? "Plans"}
          </h1>
          {isServicePlan && !showingForm && (
            <button
              onClick={() => { setEditingPlan(null); setShowAddForm(true); }}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Plan
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
          {TABS.map(t => (
            <button key={t.id}
              onClick={() => { setActiveTab(t.id); closeForm(); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-card border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Add / Edit Service Plan form ── */}
        {isServicePlan && showingForm && (
          <AddServicePlanForm
            planType={activeTab}
            initialData={editingPlan}
            onCancel={closeForm}
            onSave={handleSave}
          />
        )}

        {/* ── Bandwidth Plans ── */}
        {isBandwidth && <BandwidthPlansTab />}

        {/* ── Service plan cards ── */}
        {isServicePlan && !showingForm && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredPlans.map((p) => (
              <div key={p.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/50 transition-colors group">
                <div className="h-1 bg-gradient-to-r from-primary to-blue-500" />
                <div className="p-5 border-b border-border flex justify-between items-center bg-background/50">
                  <h3 className="font-bold text-foreground text-lg">{p.name}</h3>
                  <Badge variant={p.active ? "success" : "default"}>{p.active ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="p-6">
                  <div className="flex items-end gap-2 mb-6">
                    <span className="text-3xl font-black text-foreground">Ksh {p.price}</span>
                    <span className="text-sm font-medium text-muted-foreground mb-1">/ {p.validity}</span>
                  </div>
                  <div className="space-y-3 mb-8">
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                      <Wifi className="w-4 h-4 text-primary" /> {p.speed}
                      {p.burst && <Badge variant="violet" className="ml-auto">Burst</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                      <Activity className="w-4 h-4 text-primary" /> Data: {p.data}
                    </div>
                    <div className="text-xs text-muted-foreground mt-4 pt-4 border-t border-white/5">
                      {p.users} active subscribers
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => openEdit(p)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5"
                      style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(6,182,212,0.16)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(6,182,212,0.08)"; }}
                    >
                      <Edit size={13} /> Edit
                    </button>
                    <button
                      onClick={() => setDeletingPlan(p)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5"
                      style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.16)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.08)"; }}
                    >
                      <Trash size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredPlans.length === 0 && (
              <div className="col-span-full text-center py-16 text-muted-foreground text-sm">
                No {TAB_LABELS[activeTab]?.toLowerCase()} yet. Click <strong>Add Plan</strong> to create one.
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
