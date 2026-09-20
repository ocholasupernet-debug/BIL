import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { supabase, ADMIN_ID, type DbPlan, type DbBandwidth, type DbRouter } from "@/lib/supabase";
import { Plus, Wifi, Activity, Edit, Trash, Copy, Gauge, ArrowDown, ArrowUp, Users, X, Loader2, UploadCloud, Share2, Database, Search } from "lucide-react";
import { RouterSyncBar } from "@/components/ui/RouterSyncBar";
import { getCurrencySymbol } from "@/lib/utils";

interface DbPool { id: number; name: string; range_start: string; range_end: string; router_id: number | null; }
interface DbPort { id: number; router_id: number; interface_name: string; status: string; }

function useTypeParam() {
  const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
  return raw ?? "hotspot";
}

/* ─── Supabase query helpers ─── */
async function fetchPlans(type?: string): Promise<DbPlan[]> {
  let q = supabase.from("isp_plans").select("*").eq("admin_id", ADMIN_ID).order("created_at", { ascending: true });
  if (type && !["bandwidth", "all"].includes(type)) q = q.eq("type", type);
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
    .not("status", "in", "(setup,awaiting_ports,awaiting_sync,awaiting_connection)")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbRouter[];
}

async function fetchPorts(): Promise<DbPort[]> {
  const { data, error } = await supabase
    .from("isp_reseller_ports")
    .select("id,router_id,interface_name,status")
    .eq("admin_id", ADMIN_ID)
    .order("interface_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbPort[];
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
  ports: DbPort[];
  pools: DbPool[];
  onCancel: () => void;
  onSaved: () => void;
}

function AddServicePlanForm({ planType, initialData, bandwidths, routers, ports, pools, onCancel, onSaved }: ServicePlanFormProps) {
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
  const [portId,        setPortId]        = useState(initialData?.port_id?.toString() ?? "");
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
      if (isEdit && initialData) {
        const response = await fetch(`/api/plans/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminId: ADMIN_ID,
            name,
            type: planType,
            speedDown,
            speedUp,
            price: parseFloat(price) || 0,
            validity: parseInt(validity) || 1,
            validityUnit: valUnit,
            description: null,
            sharedUsers,
            routerId: parseInt(routerId),
            portId: portId ? parseInt(portId) : null,
            dataLimitMb,
            isActive: status === "enable",
            clientCanPurchase: canBuy === "yes",
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? `Plan update failed (${response.status}).`);
        }
      } else {
        /*
         * Create through the API proxy instead of inserting the full UI
         * payload directly into Supabase. The UI still carries fields used by
         * newer plan variants, but the deployed isp_plans schema is narrower
         * than that form payload. The proxy normalizes the supported fields
         * and keeps the tenant context explicit.
         */
        const response = await fetch("/api/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminId: ADMIN_ID,
            name,
            type: planType,
            speedDown,
            speedUp,
            price: parseFloat(price) || 0,
            validity: parseInt(validity) || 1,
             validityUnit: valUnit,
            description: null,
            sharedUsers,
            routerId: routerId ? parseInt(routerId) : null,
            portId: portId ? parseInt(portId) : null,
            dataLimitMb,
            isActive: status === "enable",
          }),
        });
        if (!response.ok) {
          let detail = `Plan creation failed (${response.status}).`;
          try {
            const body = await response.json() as { error?: unknown };
            if (typeof body.error === "string" && body.error.trim()) detail = body.error;
          } catch {
            /* Keep the useful HTTP status when the server did not return JSON. */
          }
          throw new Error(detail);
        }
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
            <span style={{ padding: "0.5rem 0.625rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: "0.825rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{getCurrencySymbol()}</span>
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
          <span style={LBL_CYAN}>Scope</span>
          <div style={{ flex: 1 }}>
            {routers.length === 0 ? (
              <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.18)", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                No routers configured. A plan must be attached to a router before it can be saved.{" "}
                <a href="/admin/network/self-install" style={{ color: "var(--isp-accent)", textDecoration: "underline" }}>use Self Install</a> anytime later.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <select required style={{ ...SELECT, width: "100%" }} value={routerId} onChange={e => { setRouterId(e.target.value); setPortId(""); }}>
                  <option value="">Choose a router</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.model ? ` — ${r.model}` : ""}{r.host ? ` (${r.host})` : ""}
                      {r.status && r.status !== "online" && r.status !== "connected" ? " [offline]" : ""}
                    </option>
                  ))}
                </select>
                <select style={{ ...SELECT, width: "100%" }} value={portId} onChange={e => setPortId(e.target.value)} disabled={!routerId}>
                  <option value="">Router-wide — available on this router</option>
                  {ports.filter(p => p.router_id === Number(routerId) && p.status !== "disabled").map(p => (
                    <option key={p.id} value={p.id}>Port only — {p.interface_name}</option>
                  ))}
                </select>
              </div>
            )}
            <p style={HINT}>
              Every plan is isolated to one router. Choose a port to make it available only on that physical interface; leave the port set to Router-wide to share it across that router's ports.
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

function CopyPlanModal({
  plan,
  routers,
  ports,
  onCopied,
  onCancel,
}: {
  plan: DbPlan;
  routers: DbRouter[];
  ports: DbPort[];
  onCopied: () => void;
  onCancel: () => void;
}) {
  const [routerId, setRouterId] = useState("");
  const [portId, setPortId] = useState("");
  const [name, setName] = useState(`${plan.name} (Copy)`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetPorts = ports.filter((port) => port.router_id === Number(routerId) && port.status !== "disabled");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/plans/${plan.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminId: ADMIN_ID,
          name: name.trim(),
          targetRouterId: Number(routerId),
          targetPortId: portId ? Number(portId) : null,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Copy failed (${response.status}).`);
      onCopied();
    } catch (copyError: unknown) {
      setError(copyError instanceof Error ? copyError.message : "Copy failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div style={{ background: "var(--isp-card, #1a2440)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", maxWidth: 500, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
          <div>
            <h3 style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: "1rem", margin: 0 }}>Copy plan</h3>
            <p style={{ color: "var(--isp-text-muted)", fontSize: "0.82rem", lineHeight: 1.5, margin: "6px 0 0" }}>
              Copy <strong style={{ color: "var(--isp-text)" }}>{plan.name}</strong> to another router or isolated port.
            </p>
          </div>
          <button type="button" onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}><X size={18} /></button>
        </div>
        {error && <div style={{ padding: "0.625rem 0.75rem", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "0.82rem", marginBottom: 12 }}>{error}</div>}
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 700 }}>
            New plan name
            <input style={INPUT} value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 700 }}>
            Target router
            <select required style={{ ...SELECT, width: "100%" }} value={routerId} onChange={(event) => { setRouterId(event.target.value); setPortId(""); }}>
              <option value="">Choose a router</option>
              {routers.map((router) => <option key={router.id} value={router.id}>{router.name}{router.model ? ` — ${router.model}` : ""}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 700 }}>
            Target scope
            <select style={{ ...SELECT, width: "100%" }} value={portId} onChange={(event) => setPortId(event.target.value)} disabled={!routerId}>
              <option value="">Router-wide — available on this router</option>
              {targetPorts.map((port) => <option key={port.id} value={port.id}>Port only — {port.interface_name}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 6 }}>
            <button type="button" onClick={onCancel} style={{ padding: "0.55rem 1rem", borderRadius: 8, background: "transparent", color: "var(--isp-text-muted)", border: "1px solid var(--isp-border)", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="submit" disabled={saving || !routerId} style={{ padding: "0.55rem 1rem", borderRadius: 8, background: saving ? "rgba(37,99,235,0.6)" : "var(--isp-accent)", color: "white", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
              {saving && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
              {saving ? "Copying…" : "Copy plan"}
            </button>
          </div>
        </form>
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
        name:            name.trim(),
        speed_down:      parseFloat(dl),
        speed_up:        parseFloat(ul),
        speed_down_unit: dlUnit,
        speed_up_unit:   ulUnit,
        burst_enabled:   burst,
        updated_at:      new Date().toISOString(),
      };
      if (!payload.name || !Number.isFinite(payload.speed_down) || payload.speed_down <= 0 ||
          !Number.isFinite(payload.speed_up) || payload.speed_up <= 0) {
        throw new Error("Enter a name and positive download and upload rates.");
      }
      if (isEdit && initialData) {
        const { error: err } = await supabase.from("isp_bandwidth").update(payload)
          .eq("id", initialData.id)
          .eq("admin_id", ADMIN_ID);
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
      const { error } = await supabase.from("isp_bandwidth").delete().eq("id", id).eq("admin_id", ADMIN_ID);
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
  all: "All Plans", hotspot: "Hotspot Plans", pppoe: "PPPoE Plans", static: "Static IP Plans",
  bandwidth: "Bandwidth Plans", trials: "Hotspot Trials", fup: "FUP",
};

export default function Plans() {
  const typeParam   = useTypeParam();
  const qc          = useQueryClient();
  const [activeTab, setActiveTab] = useState(typeParam);
  const [editingPlan,  setEditingPlan]  = useState<DbPlan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<DbPlan | null>(null);
  const [copyingPlan,  setCopyingPlan] = useState<DbPlan | null>(null);
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [planSearch, setPlanSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<"all" | "pppoe" | "hotspot">("all");
  const [sortBy, setSortBy] = useState<"name" | "price" | "speed">("name");
  const [sortAscending, setSortAscending] = useState(true);

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

  const { data: ports = [] } = useQuery<DbPort[]>({
    queryKey: ["isp_reseller_ports_plans", ADMIN_ID],
    queryFn: fetchPorts,
    staleTime: 30_000,
  });

  const { data: pools = [] } = useQuery<DbPool[]>({
    queryKey: ["isp_ip_pools_plans", ADMIN_ID],
    queryFn:  fetchPools,
    staleTime: 30_000,
  });

  const visiblePlans = useMemo(() => {
    const query = planSearch.trim().toLowerCase();
    const filtered = plans.filter((plan) => {
      const normalizedType = plan.type === "pppoe" ? "pppoe" : plan.type === "hotspot" || plan.type === "trials" ? "hotspot" : "other";
      const matchesService = serviceFilter === "all" || normalizedType === serviceFilter;
      const matchesSearch = !query || [plan.name, plan.type, String(plan.speed_down), String(plan.speed_up), String(plan.price)]
        .some((value) => value.toLowerCase().includes(query));
      return matchesService && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      const direction = sortAscending ? 1 : -1;
      if (sortBy === "price") return (Number(a.price ?? 0) - Number(b.price ?? 0)) * direction;
      if (sortBy === "speed") return (Number(a.speed_down ?? 0) - Number(b.speed_down ?? 0)) * direction;
      return a.name.localeCompare(b.name) * direction;
    });
  }, [planSearch, plans, serviceFilter, sortAscending, sortBy]);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/plans/${id}?adminId=${encodeURIComponent(String(ADMIN_ID))}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Delete failed (${response.status}).`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_plans"] });
      setDeletingPlan(null);
    },
  });

  function closeForm() { setShowAddForm(false); setEditingPlan(null); }
  function onSaved()   { qc.invalidateQueries({ queryKey: ["isp_plans"] }); closeForm(); }
  function onCopied()  { qc.invalidateQueries({ queryKey: ["isp_plans"] }); setCopyingPlan(null); }

  return (
    <AdminLayout>
      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {deletingPlan && (
        <DeleteModal name={deletingPlan.name} deleting={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deletingPlan.id)}
          onCancel={() => setDeletingPlan(null)} />
      )}
      {copyingPlan && (
        <CopyPlanModal
          plan={copyingPlan}
          routers={routers}
          ports={ports}
          onCopied={onCopied}
          onCancel={() => setCopyingPlan(null)}
        />
      )}

      <div className="plans-page space-y-6">
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
            { id: "all",       label: "All Plans" },
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

        {isServicePlan && !showingForm && (
          <div className="plans-toolbar" role="region" aria-label="Plan list filters">
            <label className="plans-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search plans</span>
              <input
                value={planSearch}
                onChange={(event) => setPlanSearch(event.target.value)}
                placeholder="Search plans, speed, or price"
                type="search"
              />
            </label>
            <label className="plans-filter">
              <span>Service</span>
              <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value as "all" | "pppoe" | "hotspot")}>
                <option value="all">All services</option>
                <option value="pppoe">PPPoE</option>
                <option value="hotspot">Hotspot</option>
              </select>
            </label>
            <button
              type="button"
              className="plans-sort-button"
              onClick={() => {
                if (sortBy === "name") setSortBy("price");
                else if (sortBy === "price") setSortBy("speed");
                else setSortBy("name");
                setSortAscending(true);
              }}
              title="Cycle plan sort order"
            >
              {sortAscending ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
              Sort: {sortBy === "name" ? "Name" : sortBy === "price" ? "Price" : "Speed"}
            </button>
            <button
              type="button"
              className="plans-direction-button"
              onClick={() => setSortAscending((ascending) => !ascending)}
              aria-label={`Sort ${sortAscending ? "descending" : "ascending"}`}
              title={`Sort ${sortAscending ? "descending" : "ascending"}`}
            >
              {sortAscending ? "A–Z" : "Z–A"}
            </button>
            <span className="plans-result-count">{visiblePlans.length} of {plans.length}</span>
          </div>
        )}

        {/* Add / Edit form */}
        {isServicePlan && showingForm && (
          <AddServicePlanForm
            planType={activeTab}
            initialData={editingPlan}
            bandwidths={bandwidths}
            routers={routers}
            ports={ports}
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
              <div className="plans-list" role="table" aria-label={`${TAB_LABELS[activeTab] ?? "Plans"} list`}>
                <div className="plans-list-header" role="row">
                  <span>Service</span><span>Plan / scope</span><span>Speed</span><span>Price</span><span>Validity</span><span>Status</span><span className="plans-actions-heading">Actions</span>
                </div>
                {visiblePlans.map((p) => {
                  const serviceType = p.type === "pppoe" ? "pppoe" : p.type === "hotspot" || p.type === "trials" ? "hotspot" : "other";
                  const serviceLabel = serviceType === "pppoe" ? "PPPoE" : serviceType === "hotspot" ? "Hotspot" : p.type;
                  const speed = p.speed_down === p.speed_up ? `${p.speed_down} Mbps` : `${p.speed_down}/${p.speed_up} Mbps`;
                  const router = routers.find((item) => item.id === p.router_id);
                  const port = p.port_id ? ports.find((item) => item.id === p.port_id) : null;
                  const scopeLabel = port
                    ? `${router?.name ?? "Router"} · ${port.interface_name}`
                    : router?.name ?? "Unassigned — assign a router";
                  return (
                    <div className={`plans-row plans-row--${serviceType}`} key={p.id} role="row">
                      <span className={`plans-service-badge plans-service-badge--${serviceType}`}>{serviceLabel}</span>
                      <span className="plans-row-name" title={p.name}>
                        <strong>{p.name}</strong>
                        <small>{scopeLabel}</small>
                      </span>
                      <span className="plans-row-speed">{speed}</span>
                      <span className="plans-row-price">{getCurrencySymbol()} {Number(p.price ?? 0).toLocaleString()}</span>
                      <span className="plans-row-validity">{planValidity(p)}</span>
                      <span><Badge variant={p.is_active ? "success" : "default"}>{p.is_active ? "Active" : "Inactive"}</Badge></span>
                      <span className="plans-row-actions">
                        <button type="button" onClick={() => setCopyingPlan(p)} aria-label={`Copy ${p.name}`} title={`Copy ${p.name}`}><Copy size={13} /></button>
                        <button type="button" onClick={() => { setEditingPlan(p); setShowAddForm(false); }} aria-label={`Edit ${p.name}`} title={`Edit ${p.name}`}><Edit size={13} /></button>
                        <button type="button" onClick={() => setDeletingPlan(p)} aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`}><Trash size={13} /></button>
                      </span>
                    </div>
                  );
                })}
                {visiblePlans.length === 0 && (
                  <div className="plans-empty">
                    No matching plans. Adjust the search or service filter, or click <strong>Add Plan</strong> to create one.
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
