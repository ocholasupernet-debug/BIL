import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { supabase, ADMIN_ID, type DbPlan, type DbBandwidth, type DbRouter } from "@/lib/supabase";
import { Plus, Wifi, Activity, Edit, Trash, Gauge, ArrowDown, ArrowUp, Users, X, Loader2, UploadCloud, Share2, Database } from "lucide-react";
import { RouterSyncBar } from "@/components/ui/RouterSyncBar";

interface DbPool { id: number; name: string; range_start: string; range_end: string; router_id: number | null; }

function useTypeParam() {
  const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
  return raw ?? "hotspot";
}

/* ─── Supabase query helpers ─── */
async function fetchPlans(type?: string): Promise<DbPlan[]> {
  let q = supabase.from("isp_plans").select("*").eq("admin_id", ADMIN_ID).order("created_at", { ascending: true });
  if (type && type !== "bandwidth") q = q.eq("type", type);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function fetchBandwidths(): Promise<DbBandwidth[]> {
  const { data, error } = await supabase.from("isp_bandwidth").select("*").eq("admin_id", ADMIN_ID).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchRouters(): Promise<DbRouter[]> {
  const { data, error } = await supabase
    .from("isp_routers")
    .select("id,name,host,model,bridge_ip,status")
    .eq("admin_id", ADMIN_ID)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbRouter[];
}

async function fetchPools(): Promise<DbPool[]> {
  const { data } = await supabase
    .from("isp_ip_pools")
    .select("id,name,range_start,range_end,router_id")
    .eq("admin_id", ADMIN_ID)
    .order("name");
  return (data ?? []) as DbPool[];
}

/* ─── Display helpers ─── */
function planValidity(p: DbPlan) {
  return `${p.validity} ${p.validity_unit}`;
}
function planSpeed(p: DbPlan) {
  return `${p.speed_down}Mbps / ${p.speed_up}Mbps`;
}

/* ─── Shared styles ─── */
const ROW: React.CSSProperties     = { display: "flex", alignItems: "flex-start", gap: "1rem" };
const LBL: React.CSSProperties     = { fontWeight: 700, fontSize: "0.875rem", color: "var(--isp-text)", minWidth: 170, flexShrink: 0, paddingTop: "0.45rem", textAlign: "right" };
const LBL_CYAN: React.CSSProperties= { ...LBL, color: "var(--isp-accent)" };
const INPUT: React.CSSProperties   = { flex: 1, padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit", width: "100%" };
const SELECT: React.CSSProperties  = { padding: "0.5rem 0.75rem", borderRadius: 6, background: "var(--isp-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.875rem", outline: "none", fontFamily: "inherit", cursor: "pointer" };
const HINT: React.CSSProperties    = { fontSize: "0.75rem", color: "var(--isp-text-muted)", marginTop: "0.3rem" };

function Radio({ name, value, checked, onChange, label }: { name: string; value: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", cursor: "pointer", fontSize: "0.875rem", color: "var(--isp-text)" }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} style={{ accentColor: "var(--isp-accent)", width: 15, height: 15, cursor: "pointer" }} />
      {label}
    </label>
  );
}

/* ═══════════════════════════════════════════════════════════
   ADD / EDIT SERVICE PLAN FORM
═══════════════════════════════════════════════════════════ */
interface ServicePlanFormProps {
  planType: string;
  initialData?: DbPlan | null;
  bandwidths: DbBandwidth[];
  routers: DbRouter[];
  pools: DbPool[];
  onCancel: () => void;
  onSaved: () => void;
}

function AddServicePlanForm({ planType, initialData, bandwidths, routers, pools, onCancel, onSaved }: ServicePlanFormProps) {
  const isEdit   = !!initialData;
  const typeLabel= planType === "hotspot" ? "Hotspot" : planType === "pppoe" ? "PPPoE" : planType === "trials" ? "Trial" : "Static IP";
  const isPppoe  = planType === "pppoe";
  const isHotspot= planType === "hotspot" || planType === "trials";

  const [status,        setStatus]        = useState<"enable"|"disable">(initialData ? (initialData.is_active ? "enable" : "disable") : "enable");
  const [canBuy,        setCanBuy]        = useState<"yes"|"no">(initialData ? (initialData.client_can_purchase ? "yes" : "no") : "yes");
  const [name,          setName]          = useState(initialData?.name ?? "");
  const [planKind,      setPlanKind]      = useState<"unlimited"|"limited">(initialData?.plan_type === "limited" ? "limited" : "unlimited");
  const [bandwidthId,   setBandwidthId]   = useState(initialData?.bandwidth_id?.toString() ?? "");
  const [price,         setPrice]         = useState(initialData?.price?.toString() ?? "");
  /* Sharing: if shared_users > 1 on edit, sharing was enabled */
  const initSharing = initialData ? (initialData.shared_users ?? 1) > 1 : false;
  const [sharingAllowed, setSharingAllowed] = useState<"yes"|"no">(initSharing ? "yes" : "no");
  const [maxSharedUsers, setMaxSharedUsers] = useState(
    initialData?.shared_users && initialData.shared_users > 1 ? initialData.shared_users.toString() : "5"
  );
  const [validity,      setValidity]      = useState(initialData?.validity?.toString() ?? "");
  const [valUnit,       setValUnit]       = useState(initialData?.validity_unit ?? "Days");
  const [routerId,      setRouterId]      = useState(initialData?.router_id?.toString() ?? "");
  const [activePool,    setActivePool]    = useState(initialData?.active_ip_pool ?? "");
  const [expiredPool,   setExpiredPool]   = useState(initialData?.expired_ip_pool ?? "");
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [customActive,  setCustomActive]  = useState(false);
  const [customExpired, setCustomExpired] = useState(false);

  /* ── Data cap (for Limited plans) ── */
  const initDataUnit = (() => {
    const mb = initialData?.data_limit_mb ?? 0;
    if (!mb) return "GB";
    return mb % 1000 === 0 ? "GB" : "MB";
  })();
  const initDataVal = (() => {
    const mb = initialData?.data_limit_mb ?? 0;
    if (!mb) return "";
    return initDataUnit === "GB" ? String(mb / 1000) : String(mb);
  })();
  const [dataLimitVal,  setDataLimitVal]  = useState(initDataVal);
  const [dataLimitUnit, setDataLimitUnit] = useState<"MB"|"GB"|"TB">(initDataUnit as "MB"|"GB"|"TB");

  const units = ["Mins", "Hrs", "Days", "Weeks", "Months"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const sharedUsers = sharingAllowed === "yes" ? (parseInt(maxSharedUsers) || 5) : 1;
      /* Derive speed from the linked bandwidth profile so speed_down/speed_up are always set */
      const bw = bandwidthId ? bandwidths.find(b => b.id === parseInt(bandwidthId)) : null;
      const speedDown = bw?.speed_down ?? 0;
      const speedUp   = bw?.speed_up   ?? 0;
      /* Convert data limit to MB for storage */
      const dataLimitMb = planKind === "limited" && dataLimitVal
        ? (() => {
            const v = parseFloat(dataLimitVal) || 0;
            if (dataLimitUnit === "TB") return Math.round(v * 1_000_000);
            if (dataLimitUnit === "GB") return Math.round(v * 1_000);
            return Math.round(v); // MB
          })()
        : null;
      const payload = {
        admin_id:            ADMIN_ID,
        name,
        type:                planType,
        plan_type:           planKind,
        price:               parseFloat(price) || 0,
        validity:            parseInt(validity) || 1,
        validity_unit:       valUnit,
        validity_days:       parseInt(validity) || 1,
        speed_down:          speedDown,
        speed_up:            speedUp,
        is_active:           status === "enable",
        client_can_purchase: canBuy === "yes",
        shared_users:        sharedUsers,
        bandwidth_id:        bandwidthId ? parseInt(bandwidthId) : null,
        router_id:           routerId ? parseInt(routerId) : null,
        active_ip_pool:      activePool || null,
        expired_ip_pool:     expiredPool || null,
        data_limit_mb:       dataLimitMb,
        updated_at:          new Date().toISOString(),
      };

      if (isEdit && initialData) {
        const { error: err } = await supabase.from("isp_plans").update(payload).eq("id", initialData.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("isp_plans").insert({ ...payload, created_at: new Date().toISOString() });
        if (err) throw err;
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden", maxWidth: 780 }}>
      <div style={{ padding: "0.875rem 1.5rem", background: "var(--isp-accent-glow)", borderBottom: "2px solid var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--isp-text)" }}>
          {isEdit ? "Edit Service Plan" : "Add Service Plan"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: "0.7rem", color: "var(--isp-accent)", background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 4, padding: "0.15rem 0.5rem", fontWeight: 700 }}>{typeLabel} Plan</span>
          {isEdit && <span style={{ fontSize: "0.7rem", color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4, padding: "0.15rem 0.5rem", fontWeight: 700 }}>ID #{initialData?.id}</span>}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
        {error && <div style={{ padding: "0.625rem 1rem", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "0.82rem" }}>{error}</div>}

        <div style={ROW}>
          <span style={LBL}>Status</span>
          <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
            <Radio name="status" value="enable"  checked={status==="enable"}  onChange={() => setStatus("enable")}  label="Enable" />
            <Radio name="status" value="disable" checked={status==="disable"} onChange={() => setStatus("disable")} label="Disable" />
          </div>
        </div>

        <div style={ROW}>
          <span style={LBL}>Client Can Purchase</span>
          <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
            <Radio name="canBuy" value="yes" checked={canBuy==="yes"} onChange={() => setCanBuy("yes")} label="Yes" />
            <Radio name="canBuy" value="no"  checked={canBuy==="no"}  onChange={() => setCanBuy("no")}  label="No" />
          </div>
        </div>

        <div style={ROW}>
          <span style={LBL}>Plan Name</span>
          <input style={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder={`e.g. ${typeLabel} 10Mbps Daily`} required />
        </div>

        {isHotspot && (
          <div style={ROW}>
            <span style={LBL}>Plan Type</span>
            <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem" }}>
              <Radio name="planKind" value="unlimited" checked={planKind==="unlimited"} onChange={() => setPlanKind("unlimited")} label="Unlimited" />
              <Radio name="planKind" value="limited"   checked={planKind==="limited"}   onChange={() => setPlanKind("limited")}   label="Limited" />
            </div>
          </div>
        )}

        {isHotspot && planKind === "limited" && (
          <div style={ROW}>
            <span style={{ ...LBL_CYAN, display: "flex", alignItems: "center", gap: "0.35rem" }}>
              Data Cap
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  style={{ ...INPUT, flex: 1, maxWidth: 140 }}
                  value={dataLimitVal}
                  onChange={e => setDataLimitVal(e.target.value)}
                  placeholder="e.g. 10"
                  required={planKind === "limited"}
                />
                <select
                  style={{ ...SELECT, minWidth: 80 }}
                  value={dataLimitUnit}
                  onChange={e => setDataLimitUnit(e.target.value as "MB"|"GB"|"TB")}
                >
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                  <option value="TB">TB</option>
                </select>
                {dataLimitVal && (
                  <span style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                    = {dataLimitUnit === "TB"
                        ? `${(parseFloat(dataLimitVal)*1_000_000).toLocaleString()} MB`
                        : dataLimitUnit === "GB"
                        ? `${(parseFloat(dataLimitVal)*1_000).toLocaleString()} MB`
                        : `${parseFloat(dataLimitVal).toLocaleString()} MB`}
                  </span>
                )}
              </div>
              <p style={HINT}>
                When a customer's data usage reaches this limit, their session will be cut off or moved to the expired pool.
              </p>
            </div>
          </div>
        )}

        <div style={ROW}>
          <span style={LBL_CYAN}>Bandwidth Profile</span>
          <select style={{ ...SELECT, flex: 1 }} value={bandwidthId} onChange={e => setBandwidthId(e.target.value)}>
            <option value="">Select Bandwidth...</option>
            {bandwidths.map(b => <option key={b.id} value={b.id}>{b.name} ({b.speed_down}/{b.speed_up} {b.speed_down_unit})</option>)}
          </select>
        </div>

        <div style={ROW}>
          <span style={LBL}>Plan Price</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <span style={{ padding: "0.5rem 0.625rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: "0.825rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Ksh.</span>
            <input type="number" min="0" style={{ ...INPUT, borderRadius: "0 6px 6px 0", borderLeft: "none" }} value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 500" required />
          </div>
        </div>

        {isHotspot && (
          <div style={ROW}>
            <span style={{ ...LBL, display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <Share2 size={13} /> Allow Sharing
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: "1.25rem", paddingTop: "0.45rem", marginBottom: sharingAllowed === "yes" ? "0.75rem" : 0 }}>
                <Radio name="sharingAllowed" value="no"  checked={sharingAllowed==="no"}  onChange={() => setSharingAllowed("no")}  label="No — 1 device only" />
                <Radio name="sharingAllowed" value="yes" checked={sharingAllowed==="yes"} onChange={() => setSharingAllowed("yes")} label="Yes — allow sharing" />
              </div>
              {sharingAllowed === "yes" && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>Max users:</span>
                  <input
                    type="number" min="2" max="100"
                    style={{ ...INPUT, width: 80, flex: "none" }}
                    value={maxSharedUsers}
                    onChange={e => setMaxSharedUsers(e.target.value)}
                  />
                  <span style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                    devices can share one voucher/session
                  </span>
                </div>
              )}
              {sharingAllowed === "no" && (
                <p style={HINT}>Each voucher/session is limited to 1 device only.</p>
              )}
            </div>
          </div>
        )}

        <div style={ROW}>
          <span style={LBL}>Plan Validity</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input type="number" min="1" style={INPUT} value={validity} onChange={e => setValidity(e.target.value)} placeholder="e.g. 1" required />
            <select style={SELECT} value={valUnit} onChange={e => setValUnit(e.target.value)}>
              {units.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div style={ROW}>
          <span style={LBL_CYAN}>Router</span>
          <div style={{ flex: 1 }}>
            {routers.length === 0 ? (
              <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.18)", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                No routers configured — router assignment is optional.{" "}
                <a href="/admin/network/add-router" style={{ color: "var(--isp-accent)", textDecoration: "underline" }}>Add a router</a> anytime later.
              </div>
            ) : (
              <select style={{ ...SELECT, width: "100%" }} value={routerId} onChange={e => setRouterId(e.target.value)}>
                <option value="">— No specific router (save to DB only) —</option>
                {routers.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.model ? ` — ${r.model}` : ""}{r.host ? ` (${r.host})` : ""}
                    {r.status && r.status !== "online" && r.status !== "connected" ? " [offline]" : ""}
                  </option>
                ))}
              </select>
            )}
            <p style={HINT}>
              Router assignment is optional. This plan will be saved to your database immediately — you can sync it to a router at any time using the <strong>Sync to Router</strong> bar, even if the router is currently offline.
            </p>
          </div>
        </div>

        {isPppoe && (
          <div style={ROW}>
            <span style={LBL_CYAN}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <Database size={13} /> Active IP Pool
              </span>
            </span>
            <div style={{ flex: 1 }}>
              {pools.length > 0 ? (
                <>
                  {!customActive ? (
                    <select
                      style={{ ...SELECT, width: "100%" }}
                      value={activePool}
                      onChange={e => {
                        if (e.target.value === "__custom__") { setCustomActive(true); setActivePool(""); }
                        else setActivePool(e.target.value);
                      }}
                    >
                      <option value="">— Select IP Pool —</option>
                      {(routerId
                        ? pools.filter(p => p.router_id === parseInt(routerId) || p.router_id === null)
                        : pools
                      ).map(p => (
                        <option key={p.id} value={p.name}>
                          {p.name} ({p.range_start}–{p.range_end})
                        </option>
                      ))}
                      <option value="__custom__">✏ Enter manually…</option>
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <input
                        style={{ ...INPUT, flex: 1 }}
                        value={activePool}
                        onChange={e => setActivePool(e.target.value)}
                        placeholder="e.g. active"
                        autoFocus
                      />
                      <button type="button" onClick={() => { setCustomActive(false); setActivePool(""); }}
                        style={{ padding: "0.45rem 0.75rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer", fontSize: "0.78rem" }}>
                        ← List
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <input style={INPUT} value={activePool} onChange={e => setActivePool(e.target.value)} placeholder="e.g. active" />
                  <p style={{ ...HINT, color: "#fbbf24" }}>
                    No IP pools found. <a href="/admin/network/ip-pools" style={{ color: "var(--isp-accent)" }}>Create one on the IP Pools page →</a>
                  </p>
                </>
              )}
              <p style={HINT}>
                Pool assigned to active subscribers. Defined in{" "}
                <a href="/admin/network/ip-pools" style={{ color: "var(--isp-accent)" }}>IP Pools</a>.
              </p>
            </div>
          </div>
        )}

        {isPppoe && (
          <div style={ROW}>
            <span style={LBL}>Expired IP Pool</span>
            <div style={{ flex: 1 }}>
              {pools.length > 0 ? (
                <>
                  {!customExpired ? (
                    <select
                      style={{ ...SELECT, width: "100%" }}
                      value={expiredPool}
                      onChange={e => {
                        if (e.target.value === "__custom__") { setCustomExpired(true); setExpiredPool(""); }
                        else setExpiredPool(e.target.value);
                      }}
                    >
                      <option value="">— None (optional) —</option>
                      {(routerId
                        ? pools.filter(p => p.router_id === parseInt(routerId) || p.router_id === null)
                        : pools
                      ).map(p => (
                        <option key={p.id} value={p.name}>
                          {p.name} ({p.range_start}–{p.range_end})
                        </option>
                      ))}
                      <option value="__custom__">✏ Enter manually…</option>
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <input
                        style={{ ...INPUT, flex: 1 }}
                        value={expiredPool}
                        onChange={e => setExpiredPool(e.target.value)}
                        placeholder="e.g. expired"
                        autoFocus
                      />
                      <button type="button" onClick={() => { setCustomExpired(false); setExpiredPool(""); }}
                        style={{ padding: "0.45rem 0.75rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer", fontSize: "0.78rem" }}>
                        ← List
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <input style={INPUT} value={expiredPool} onChange={e => setExpiredPool(e.target.value)} placeholder="e.g. expired" />
              )}
              <p style={HINT}>Customers are moved to this pool after their plan expires (optional).</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingTop: "0.5rem" }}>
          <button type="submit" disabled={saving}
            style={{ padding: "0.55rem 1.75rem", borderRadius: 8, background: saving ? "rgba(37,99,235,0.6)" : "var(--isp-accent)", color: "white", border: "none", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {saving && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
            {saving ? "Saving…" : isEdit ? "Update Plan" : "Save Plan"}
          </button>
          <span style={{ fontSize: "0.85rem", color: "var(--isp-text-muted)" }}>Or</span>
          <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 }}>
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
function DeleteModal({ name, onConfirm, onCancel, deleting }: { name: string; onConfirm: () => void; onCancel: () => void; deleting?: boolean }) {
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
          You are about to permanently delete <strong style={{ color: "var(--isp-text)" }}>{name}</strong>. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onConfirm} disabled={deleting}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 8, background: "#ef4444", color: "white", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: deleting ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {deleting && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
            {deleting ? "Deleting…" : "Yes, Delete"}
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

interface BandwidthFormProps {
  initialData?: DbBandwidth | null;
  onCancel?: () => void;
  onSaved?: () => void;
}

function AddBandwidthForm({ initialData, onCancel, onSaved }: BandwidthFormProps) {
  const isEdit = !!initialData;
  const [name,   setName]   = useState(initialData?.name ?? "");
  const [dl,     setDl]     = useState(initialData?.speed_down?.toString() ?? "");
  const [dlUnit, setDlUnit] = useState(initialData?.speed_down_unit ?? "Mbps");
  const [ul,     setUl]     = useState(initialData?.speed_up?.toString() ?? "");
  const [ulUnit, setUlUnit] = useState(initialData?.speed_up_unit ?? "Mbps");
  const [burst,  setBurst]  = useState(initialData?.burst_enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const units = ["Kbps", "Mbps", "Gbps"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        admin_id:        ADMIN_ID,
        name,
        speed_down:      parseFloat(dl),
        speed_up:        parseFloat(ul),
        speed_down_unit: dlUnit,
        speed_up_unit:   ulUnit,
        burst_enabled:   burst,
        updated_at:      new Date().toISOString(),
      };
      if (isEdit && initialData) {
        const { error: err } = await supabase.from("isp_bandwidth").update(payload).eq("id", initialData.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("isp_bandwidth").insert({ ...payload, is_active: true, created_at: new Date().toISOString() });
        if (err) throw err;
      }
      onSaved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
      <div style={{ padding: "0.875rem 1.25rem", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--isp-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--isp-text)" }}>
          {isEdit ? `Edit Bandwidth — ${initialData?.name}` : "Add New Bandwidth"}
        </span>
        <button style={{ padding: "0.3rem 0.875rem", borderRadius: 6, background: "var(--isp-accent)", color: "white", border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          onClick={() => alert("Bandwidth documentation coming soon!")}>
          Need Help?
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: "1.5rem 1.25rem", display: "flex", flexDirection: "column", gap: "1.125rem" }}>
        {error && <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "0.82rem" }}>{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Bandwidth Name</span>
          <input style={BW_INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 10Mbps Standard" required />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Rate Download</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" value={dl} onChange={e => setDl(e.target.value)} placeholder="e.g. 10" required />
            <select style={BW_SELECT} value={dlUnit} onChange={e => setDlUnit(e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={BW_LBL}>Rate Upload</span>
          <div style={{ flex: 1, display: "flex", gap: "0.5rem" }}>
            <input style={{ ...BW_INPUT, flex: 1 }} type="number" min="1" value={ul} onChange={e => setUl(e.target.value)} placeholder="e.g. 10" required />
            <select style={BW_SELECT} value={ulUnit} onChange={e => setUlUnit(e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
          <span style={{ ...BW_LBL, paddingTop: "0.1rem" }}>Enable Burst?</span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="checkbox" checked={burst} onChange={e => setBurst(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--isp-accent)" }} />
            {burst && <p style={{ fontSize: "0.78rem", color: "#f87171", lineHeight: 1.65, margin: 0 }}><strong>Disclaimer:</strong> Misconfiguring burst can cause connectivity issues. Consult an admin if unsure.</p>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingTop: "0.25rem" }}>
          <button type="submit" disabled={saving}
            style={{ padding: "0.55rem 1.75rem", borderRadius: 8, background: saving ? "rgba(37,99,235,0.6)" : "var(--isp-accent)", color: "white", border: "none", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            {saving && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
            {saving ? "Saving…" : isEdit ? "Update Bandwidth" : "Submit"}
          </button>
          <span style={{ fontSize: "0.85rem", color: "var(--isp-text-muted)" }}>Or</span>
          <button type="button" onClick={onCancel} style={{ padding: 0, background: "none", border: "none", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BANDWIDTH PLAN CARD
═══════════════════════════════════════════════════════════ */
function BandwidthCard({ bw, onEdit, onDelete }: { bw: DbBandwidth; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden", transition: "border-color 0.2s" }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--isp-accent-border)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--isp-border)")}>
      <div style={{ height: 3, background: "var(--isp-accent)" }} />
      <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Gauge style={{ width: 15, height: 15, color: "var(--isp-accent)" }} />
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--isp-text)" }}>{bw.name}</span>
        </div>
        {bw.burst_enabled && <span style={{ fontSize: "0.65rem", color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700 }}>⚡ Burst</span>}
      </div>
      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
          <ArrowDown style={{ width: 13, height: 13, color: "#22c55e" }} />
          <span>Download:</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{bw.speed_down} {bw.speed_down_unit}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "var(--isp-text-sub)" }}>
          <ArrowUp style={{ width: 13, height: 13, color: "#f59e0b" }} />
          <span>Upload:</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{bw.speed_up} {bw.speed_up_unit}</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button onClick={onEdit} style={{ flex: 1, padding: "0.45rem", borderRadius: 8, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.25)", color: "var(--isp-accent)", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Edit style={{ width: 11, height: 11 }} /> Edit
          </button>
          <button onClick={onDelete} style={{ flex: 1, padding: "0.45rem", borderRadius: 8, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
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
  const qc = useQueryClient();
  const { data: bws = [], isLoading } = useQuery({ queryKey: ["isp_bandwidth"], queryFn: fetchBandwidths });
  const [showForm,   setShowForm]   = useState(false);
  const [editingBw,  setEditingBw]  = useState<DbBandwidth | null>(null);
  const [deletingBw, setDeletingBw] = useState<DbBandwidth | null>(null);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("isp_bandwidth").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["isp_bandwidth"] }); setDeletingBw(null); },
  });

  function openEdit(bw: DbBandwidth) { setEditingBw(bw); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditingBw(null); }
  function onSaved() { qc.invalidateQueries({ queryKey: ["isp_bandwidth"] }); closeForm(); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {deletingBw && (
        <DeleteModal name={deletingBw.name} deleting={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deletingBw.id)}
          onCancel={() => setDeletingBw(null)} />
      )}

      {!showForm ? (
        <button onClick={() => { setEditingBw(null); setShowForm(true); }}
          style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1.125rem", borderRadius: 10, background: "var(--isp-accent)", color: "white", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px var(--isp-accent-border)" }}>
          <Plus style={{ width: 15, height: 15 }} /> Add Bandwidth Profile
        </button>
      ) : (
        <AddBandwidthForm initialData={editingBw} onCancel={closeForm} onSaved={onSaved} />
      )}

      <div>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>
          {isLoading ? "Loading…" : `Bandwidth Profiles — ${bws.length}`}
        </div>
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text-muted)", fontSize: "0.875rem", padding: "2rem 0" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading profiles…
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1rem" }}>
            {bws.map(bw => (
              <BandwidthCard key={bw.id} bw={bw}
                onEdit={() => openEdit(bw)}
                onDelete={() => setDeletingBw(bw)} />
            ))}
            {bws.length === 0 && <div style={{ color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>No bandwidth profiles yet. Click <strong>Add Bandwidth Profile</strong> to create one.</div>}
          </div>
        )}
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
  const typeParam   = useTypeParam();
  const qc          = useQueryClient();
  const [activeTab, setActiveTab] = useState(typeParam);
  const [editingPlan,  setEditingPlan]  = useState<DbPlan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<DbPlan | null>(null);
  const [showAddForm,  setShowAddForm]  = useState(false);

  const isBandwidth   = activeTab === "bandwidth";
  const isServicePlan = !isBandwidth;
  const showingForm   = showAddForm || !!editingPlan;

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["isp_plans", activeTab],
    queryFn:  () => fetchPlans(activeTab),
    enabled:  isServicePlan,
  });

  const { data: bandwidths = [] } = useQuery({
    queryKey: ["isp_bandwidth"],
    queryFn:  fetchBandwidths,
  });

  const { data: routers = [] } = useQuery({
    queryKey: ["isp_routers_plans", ADMIN_ID],
    queryFn:  fetchRouters,
  });

  const { data: pools = [] } = useQuery<DbPool[]>({
    queryKey: ["isp_ip_pools_plans", ADMIN_ID],
    queryFn:  fetchPools,
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("isp_plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_plans"] });
      setDeletingPlan(null);
    },
  });

  function closeForm() { setShowAddForm(false); setEditingPlan(null); }
  function onSaved()   { qc.invalidateQueries({ queryKey: ["isp_plans"] }); closeForm(); }

  return (
    <AdminLayout>
      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {deletingPlan && (
        <DeleteModal name={deletingPlan.name} deleting={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deletingPlan.id)}
          onCancel={() => setDeletingPlan(null)} />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">{TAB_LABELS[activeTab] ?? "Plans"}</h1>
          {isServicePlan && !showingForm && (
            <button onClick={() => { setEditingPlan(null); setShowAddForm(true); }}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Plan
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
          {[
            { id: "hotspot",   label: "Hotspot Plans" },
            { id: "pppoe",     label: "PPPoE Plans" },
            { id: "static",    label: "Static IP Plans" },
            { id: "bandwidth", label: "Bandwidth Plans" },
            { id: "trials",    label: "Hotspot Trials" },
            { id: "fup",       label: "FUP" },
          ].map(t => (
            <button key={t.id}
              onClick={() => { setActiveTab(t.id); closeForm(); setDeletingPlan(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-card border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Sync to Router bar (service plans only, not bandwidth) ── */}
        {isServicePlan && !showingForm && (
          <RouterSyncBar
            label={`Sync ${TAB_LABELS[activeTab] ?? "Plans"} to Router`}
            description="Push all visible plans as MikroTik hotspot user profiles or PPPoE profiles with rate-limits — no terminal copy-paste needed."
            icon={<UploadCloud size={18} />}
            endpoint="/api/admin/sync/plans"
            color={activeTab === "pppoe" ? "#8b5cf6" : "var(--isp-accent)"}
            buildPayload={() => ({
              plans: plans.map(p => ({
                id:            p.id,
                name:          p.name,
                type:          p.type,
                speed_down:    p.speed_down,
                speed_up:      p.speed_up,
                speed_down_unit: "Mbps",
                speed_up_unit:   "Mbps",
                validity:      p.validity,
                validity_unit: p.validity_unit,
                shared_users:  p.shared_users,
              })),
            })}
          />
        )}

        {/* Add / Edit form */}
        {isServicePlan && showingForm && (
          <AddServicePlanForm
            planType={activeTab}
            initialData={editingPlan}
            bandwidths={bandwidths}
            routers={routers}
            pools={pools}
            onCancel={closeForm}
            onSaved={onSaved}
          />
        )}

        {/* Bandwidth tab */}
        {isBandwidth && <BandwidthPlansTab />}

        {/* Service plan cards */}
        {isServicePlan && !showingForm && (
          <>
            {plansLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text-muted)", padding: "3rem 0" }}>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Loading plans…
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {plans.map((p) => (
                  <div key={p.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/50 transition-colors group">
                    <div className="h-1 bg-gradient-to-r from-primary to-blue-500" />
                    <div className="p-5 border-b border-border flex justify-between items-center bg-background/50">
                      <h3 className="font-bold text-foreground text-lg">{p.name}</h3>
                      <Badge variant={p.is_active ? "success" : "default"}>{p.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="p-6">
                      <div className="flex items-end gap-2 mb-6">
                        <span className="text-3xl font-black text-foreground">Ksh {p.price}</span>
                        <span className="text-sm font-medium text-muted-foreground mb-1">/ {planValidity(p)}</span>
                      </div>
                      <div className="space-y-3 mb-8">
                        <div className="flex items-center gap-3 text-sm text-slate-300">
                          <Wifi className="w-4 h-4 text-primary" />
                          {planSpeed(p)}
                          {p.burst_limit && <Badge variant="violet" className="ml-auto">Burst</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-300">
                          <Activity className="w-4 h-4 text-primary" />
                          Data: {p.data_limit_mb
                            ? p.data_limit_mb >= 1_000_000
                              ? `${(p.data_limit_mb / 1_000_000).toLocaleString()} TB`
                              : p.data_limit_mb >= 1_000
                              ? `${(p.data_limit_mb / 1_000).toLocaleString()} GB`
                              : `${p.data_limit_mb.toLocaleString()} MB`
                            : "Unlimited"}
                        </div>
                        <div className="pt-4 border-t border-white/5 flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 text-xs" style={{ color: (p.shared_users ?? 1) > 1 ? "#4ade80" : "var(--isp-text-muted)" }}>
                            <Share2 size={11} />
                            {(p.shared_users ?? 1) > 1
                              ? `Sharing allowed — up to ${p.shared_users} devices`
                              : "No sharing — 1 device only"}
                          </div>
                          {p.router_id && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Wifi size={11} />
                              {routers.find(r => r.id === p.router_id)?.name ?? `Router #${p.router_id}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => { setEditingPlan(p); setShowAddForm(false); }}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5"
                          style={{ background: "rgba(37,99,235,0.08)", border: "1px solid var(--isp-accent-border)", color: "var(--isp-accent)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(37,99,235,0.16)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(37,99,235,0.08)"; }}>
                          <Edit size={13} /> Edit
                        </button>
                        <button onClick={() => setDeletingPlan(p)}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5"
                          style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.16)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.08)"; }}>
                          <Trash size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {plans.length === 0 && (
                  <div className="col-span-full text-center py-16 text-muted-foreground text-sm">
                    No {TAB_LABELS[activeTab]?.toLowerCase()} yet. Click <strong>Add Plan</strong> to create one.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
