import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle, X,
  Edit2, ChevronDown, ChevronUp, Wifi, WifiOff,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";

/* ── Types ── */
interface DbPool {
  id: number;
  name: string;
  range_start: string;
  range_end: string;
  router_id: number | null;
  created_at: string;
}

interface DbRouter {
  id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
  status: string;
}

interface RouterPools {
  router:  DbRouter;
  active:  DbPool | null;   /* pool name = "active"  */
  pppoe:   DbPool | null;   /* pool name = "pppoe"   */
  expired: DbPool | null;   /* pool name = "expired" */
}

/* ── Supabase helpers ── */
async function fetchPools(): Promise<DbPool[]> {
  const { data } = await supabase
    .from("isp_ip_pools")
    .select("id,name,range_start,range_end,router_id,created_at")
    .eq("admin_id", ADMIN_ID);
  return (data ?? []) as DbPool[];
}

async function fetchRouters(): Promise<DbRouter[]> {
  const { data } = await supabase
    .from("isp_routers")
    .select("id,name,host,bridge_ip,router_username,router_secret,status")
    .eq("admin_id", ADMIN_ID)
    .order("name");
  return (data ?? []) as DbRouter[];
}

type PoolSlot = "active" | "pppoe" | "expired";

async function upsertPool(
  adminId: number, routerId: number, poolName: PoolSlot,
  rangeStart: string, rangeEnd: string, existingId?: number
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  if (existingId) {
    const { error } = await supabase
      .from("isp_ip_pools")
      .update({ name: poolName, range_start: rangeStart, range_end: rangeEnd, updated_at: now })
      .eq("id", existingId);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase
    .from("isp_ip_pools")
    .insert({ admin_id: adminId, router_id: routerId, name: poolName,
              range_start: rangeStart, range_end: rangeEnd, created_at: now, updated_at: now });
  return { error: error?.message ?? null };
}

async function deletePool(id: number): Promise<void> {
  await supabase.from("isp_ip_pools").delete().eq("id", id);
}

/* ── Sync pools to a router ── */
async function syncRouter(
  router: DbRouter, active: DbPool | null, pppoe: DbPool | null, expired: DbPool | null,
  log: (m: string) => void
): Promise<boolean> {
  const host = router.host || router.bridge_ip || "";
  if (!host) { log(`  ⚠ ${router.name} has no IP — skipped`); return false; }
  if (!active && !pppoe && !expired) { log(`  ℹ ${router.name} has no pools — skipped`); return true; }
  log(`\n▶ Syncing ${router.name} (${host})`);
  const poolsList = [
    ...(active  ? [{ name: "active",  rangeStart: active.range_start,  rangeEnd: active.range_end  }] : []),
    ...(pppoe   ? [{ name: "pppoe",   rangeStart: pppoe.range_start,   rangeEnd: pppoe.range_end   }] : []),
    ...(expired ? [{ name: "expired", rangeStart: expired.range_start, rangeEnd: expired.range_end }] : []),
  ];
  const payload = {
    host, bridgeIp: router.bridge_ip || undefined,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    pools: poolsList,
  };
  try {
    const res  = await fetch(`${API}/api/admin/sync/ip-pools`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { ok: boolean; logs: string[] };
    (data.logs ?? []).forEach((l: string) => log(l));
    return data.ok;
  } catch (e) {
    log(`  ✗ Network error: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════ */
export default function IPPool() {
  const qc = useQueryClient();

  const { data: pools = [],   isLoading: poolsLoading  } = useQuery<DbPool[]>({
    queryKey: ["isp_ip_pools", ADMIN_ID],
    queryFn:  fetchPools,
    staleTime: 10_000,
  });
  const { data: routers = [], isLoading: routersLoading } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_pools", ADMIN_ID],
    queryFn:  fetchRouters,
    staleTime: 15_000,
  });

  /* Map pool records to routers — active / pppoe / expired per router */
  const routerPools = useMemo((): RouterPools[] => {
    const byRouter: Record<number, { active: DbPool | null; pppoe: DbPool | null; expired: DbPool | null }> = {};
    for (const r of routers) byRouter[r.id] = { active: null, pppoe: null, expired: null };
    for (const p of pools) {
      if (p.router_id === null) continue;
      if (!byRouter[p.router_id]) byRouter[p.router_id] = { active: null, pppoe: null, expired: null };
      if (p.name === "active"  && !byRouter[p.router_id].active)  byRouter[p.router_id].active  = p;
      if (p.name === "pppoe"   && !byRouter[p.router_id].pppoe)   byRouter[p.router_id].pppoe   = p;
      if (p.name === "expired" && !byRouter[p.router_id].expired)  byRouter[p.router_id].expired = p;
    }
    return routers.map(r => ({ router: r, ...byRouter[r.id] }));
  }, [routers, pools]);

  /* ── Edit modal state ── */
  const [editRouter,    setEditRouter]    = useState<RouterPools | null>(null);
  const [fActiveStart,  setFActiveStart]  = useState("");
  const [fActiveEnd,    setFActiveEnd]    = useState("");
  const [fPppoeStart,   setFPppoeStart]   = useState("");
  const [fPppoeEnd,     setFPppoeEnd]     = useState("");
  const [fExpiredStart, setFExpiredStart] = useState("");
  const [fExpiredEnd,   setFExpiredEnd]   = useState("");
  const [saving,        setSaving]        = useState(false);
  const [saveErr,       setSaveErr]       = useState<string | null>(null);

  function openEdit(rp: RouterPools) {
    setEditRouter(rp);
    setFActiveStart(rp.active?.range_start   ?? "");
    setFActiveEnd(rp.active?.range_end       ?? "");
    setFPppoeStart(rp.pppoe?.range_start     ?? "");
    setFPppoeEnd(rp.pppoe?.range_end         ?? "");
    setFExpiredStart(rp.expired?.range_start ?? "");
    setFExpiredEnd(rp.expired?.range_end     ?? "");
    setSaveErr(null);
  }

  async function handleSave() {
    if (!editRouter) return;
    setSaving(true); setSaveErr(null);
    const rid = editRouter.router.id;

    const save = async (slot: PoolSlot, start: string, end: string, existing: DbPool | null) => {
      if (start.trim() && end.trim()) {
        const { error } = await upsertPool(ADMIN_ID, rid, slot, start.trim(), end.trim(), existing?.id);
        if (error) throw new Error(error);
      } else if (existing) {
        await deletePool(existing.id);
      }
    };

    try {
      await save("active",  fActiveStart,  fActiveEnd,  editRouter.active);
      await save("pppoe",   fPppoeStart,   fPppoeEnd,   editRouter.pppoe);
      await save("expired", fExpiredStart, fExpiredEnd, editRouter.expired);
      qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
      setEditRouter(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /* ── Sync state ── */
  const [syncLogs,    setSyncLogs]    = useState<string[] | null>(null);
  const [syncOk,      setSyncOk]      = useState<boolean | null>(null);
  const [syncingId,   setSyncingId]   = useState<number | null>(null);
  const [syncingAll,  setSyncingAll]  = useState(false);
  const [expandSync,  setExpandSync]  = useState(false);

  async function handleSyncOne(rp: RouterPools) {
    setSyncingId(rp.router.id);
    setSyncLogs([]); setSyncOk(null); setExpandSync(true);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    const ok = await syncRouter(rp.router, rp.active, rp.pppoe, rp.expired, log);
    log(ok ? "\n✅ Sync complete." : "\n⚠ Sync had errors.");
    setSyncOk(ok);
    setSyncingId(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true); setSyncLogs([]); setSyncOk(null); setExpandSync(true);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Syncing all routers…");
    let ok = true;
    for (const rp of routerPools) {
      if (!rp.active && !rp.pppoe && !rp.expired) continue;
      const r2 = await syncRouter(rp.router, rp.active, rp.pppoe, rp.expired, log);
      if (!r2) ok = false;
    }
    log(ok ? "\n✅ All synced." : "\n⚠ Some routers had errors.");
    setSyncOk(ok);
    setSyncingAll(false);
  }

  /* ── Shared styles ── */
  const S = {
    btn: (bg: string, color = "white") => ({
      display: "inline-flex" as const, alignItems: "center" as const, gap: "0.35rem",
      padding: "0.42rem 0.9rem", borderRadius: 7, border: "none", background: bg,
      color, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
      whiteSpace: "nowrap" as const,
    }),
    input: {
      background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
      border: "1px solid var(--isp-border)", borderRadius: 7,
      padding: "0.42rem 0.65rem", color: "var(--isp-text)", fontSize: "0.8rem",
      fontFamily: "inherit", outline: "none", width: "100%",
    } as React.CSSProperties,
    lbl: { fontSize: "0.67rem", fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: "0.2rem", display: "block" as const },
    notSet: {
      display: "inline-block", fontSize: "0.7rem", color: "var(--isp-text-muted)",
      fontStyle: "italic", background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4,
      padding: "0.15rem 0.45rem",
    } as React.CSSProperties,
  };

  const PoolValue = ({ pool, color }: { pool: DbPool | null; color: string }) =>
    pool ? (
      <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color, fontWeight: 600, lineHeight: 1.5 }}>
        {pool.range_start}<br />
        <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem" }}>–</span>{" "}
        {pool.range_end}
      </div>
    ) : <span style={S.notSet}>not set</span>;

  const isLoading = poolsLoading || routersLoading;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1100 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0, flex: 1 }}>
            IP Pools
          </h1>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || routerPools.every(rp => !rp.active && !rp.pppoe && !rp.expired)}
            style={{ ...S.btn("linear-gradient(135deg,#f59e0b,#d97706)"), opacity: syncingAll ? 0.7 : 1 }}
          >
            {syncingAll
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <RefreshCw size={13} />}
            Sync All
          </button>
        </div>

        <NetworkTabs active="ip-pools" />

        {/* ── Info banner ── */}
        <div style={{
          background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)",
          borderRadius: 10, padding: "0.65rem 1rem", fontSize: "0.76rem",
          color: "var(--isp-text-muted)", lineHeight: 1.65,
        }}>
          Each router supports three pools —{" "}
          <strong style={{ color: "#22c55e" }}>Active</strong> (hotspot / general clients),{" "}
          <strong style={{ color: "#06b6d4" }}>PPPoE</strong> (PPPoE subscribers), and{" "}
          <strong style={{ color: "#f59e0b" }}>Expired</strong> (lapsed customers).
          Click <strong>Edit</strong> to set IP ranges. Plans reference these pools as{" "}
          <code style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>active</code>,{" "}
          <code style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>pppoe</code>, or{" "}
          <code style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>expired</code>.
        </div>

        {/* ── Sync log ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(6,182,212,0.2)"}`,
            borderRadius: 10, padding: "0.75rem 1rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: syncOk === false ? "#f87171" : "#06b6d4" }}>
                {syncOk === false ? <AlertTriangle size={13} /> : syncOk ? <CheckCircle2 size={13} /> : <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                Sync Log
              </div>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button onClick={() => setExpandSync(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                  {expandSync ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                  <X size={14} />
                </button>
              </div>
            </div>
            {expandSync && (
              <div style={{ fontFamily: "monospace", fontSize: "0.73rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.1rem", maxHeight: 170, overflowY: "auto" }}>
                {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
              </div>
            )}
          </div>
        )}

        {/* ── Table header ── */}
        {!isLoading && routerPools.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 140px",
            padding: "0.45rem 1.125rem",
            fontSize: "0.66rem", fontWeight: 800, color: "var(--isp-text-muted)",
            textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            <div>Router</div>
            <div style={{ color: "#22c55e" }}>Active Pool</div>
            <div style={{ color: "#06b6d4" }}>PPPoE Pool</div>
            <div style={{ color: "#f59e0b" }}>Expired Pool</div>
            <div />
          </div>
        )}

        {/* ── Router rows ── */}
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.625rem", padding: "4rem", color: "var(--isp-text-muted)" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
            Loading…
          </div>
        ) : routerPools.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
            No routers found. Add a router first.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {routerPools.map((rp, idx) => {
              const online  = rp.router.status === "online";
              const syncing = syncingId === rp.router.id;
              const hasAny  = !!(rp.active || rp.pppoe || rp.expired);
              return (
                <div
                  key={rp.router.id}
                  style={{
                    background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                    borderRadius: 11, padding: "0.875rem 1.125rem",
                    display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 140px",
                    alignItems: "center", gap: "1rem",
                    borderLeft: `3px solid ${online ? "#22c55e" : "#334155"}`,
                  }}
                >
                  {/* Router name */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
                    {online
                      ? <Wifi size={14} style={{ color: "#22c55e", flexShrink: 0 }} />
                      : <WifiOff size={14} style={{ color: "#475569", flexShrink: 0 }} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--isp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {rp.router.name}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace", marginTop: "0.1rem" }}>
                        {rp.router.host || rp.router.bridge_ip || "no IP"}
                      </div>
                    </div>
                  </div>

                  {/* Active pool */}
                  <PoolValue pool={rp.active}  color="#22c55e" />

                  {/* PPPoE pool */}
                  <PoolValue pool={rp.pppoe}   color="#06b6d4" />

                  {/* Expired pool */}
                  <PoolValue pool={rp.expired} color="#f59e0b" />

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
                    <button onClick={() => openEdit(rp)} style={S.btn("linear-gradient(135deg,#06b6d4,#0284c7)")}>
                      <Edit2 size={12} /> Edit
                    </button>
                    <button
                      onClick={() => handleSyncOne(rp)}
                      disabled={syncing || !hasAny}
                      style={{ ...S.btn("linear-gradient(135deg,#f59e0b,#d97706)"), opacity: syncing || !hasAny ? 0.5 : 1 }}
                    >
                      {syncing
                        ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                        : <RefreshCw size={12} />}
                      Sync
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══════════════════════ Edit Modal ══════════════════════ */}
      {editRouter && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setEditRouter(null); }}
        >
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 500, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.125rem" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                  {editRouter.router.name} — IP Pools
                </div>
                <div style={{ fontSize: "0.71rem", color: "var(--isp-text-muted)", marginTop: "0.15rem" }}>
                  Leave a range blank to remove that pool from this router.
                </div>
              </div>
              <button onClick={() => setEditRouter(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            {/* Active pool */}
            <PoolSection
              label="Active Pool" sublabel="Hotspot / general clients" color="#22c55e" bg="rgba(34,197,94,0.04)" border="rgba(34,197,94,0.15)"
              startVal={fActiveStart} endVal={fActiveEnd}
              onStart={setFActiveStart} onEnd={setFActiveEnd}
              startPH="e.g. 192.168.0.10" endPH="e.g. 192.168.0.200"
              inp={S.input} lbl={S.lbl}
            />

            {/* PPPoE pool */}
            <PoolSection
              label="PPPoE Pool" sublabel="PPPoE subscriber IPs" color="#06b6d4" bg="rgba(6,182,212,0.04)" border="rgba(6,182,212,0.15)"
              startVal={fPppoeStart} endVal={fPppoeEnd}
              onStart={setFPppoeStart} onEnd={setFPppoeEnd}
              startPH="e.g. 10.20.0.10" endPH="e.g. 10.20.0.254"
              inp={S.input} lbl={S.lbl}
            />

            {/* Expired pool */}
            <PoolSection
              label="Expired Pool" sublabel="Lapsed / unpaid customers" color="#f59e0b" bg="rgba(245,158,11,0.04)" border="rgba(245,158,11,0.15)"
              startVal={fExpiredStart} endVal={fExpiredEnd}
              onStart={setFExpiredStart} onEnd={setFExpiredEnd}
              startPH="e.g. 10.10.1.10" endPH="e.g. 10.10.1.254"
              inp={S.input} lbl={S.lbl}
            />

            {saveErr && (
              <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: "0.77rem", color: "#f87171", marginBottom: "0.75rem" }}>
                {saveErr}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end", marginTop: "0.25rem" }}>
              <button onClick={() => setEditRouter(null)} style={S.btn("rgba(255,255,255,0.06)", "var(--isp-text-muted)")}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} style={{ ...S.btn("linear-gradient(135deg,#06b6d4,#0284c7)"), opacity: saving ? 0.7 : 1 }}>
                {saving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={13} />}
                Save Pools
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

/* ── Reusable pool section in the edit modal ── */
function PoolSection({
  label, sublabel, color, bg, border,
  startVal, endVal, onStart, onEnd,
  startPH, endPH, inp, lbl,
}: {
  label: string; sublabel: string; color: string; bg: string; border: string;
  startVal: string; endVal: string;
  onStart: (v: string) => void; onEnd: (v: string) => void;
  startPH: string; endPH: string;
  inp: React.CSSProperties; lbl: React.CSSProperties;
}) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "0.8rem 1rem", marginBottom: "0.625rem" }}>
      <div style={{ fontWeight: 700, fontSize: "0.78rem", color, marginBottom: "0.55rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
        {label}
        <span style={{ fontWeight: 400, color: "var(--isp-text-muted)", fontSize: "0.68rem" }}>— {sublabel}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <div>
          <label style={lbl}>Start IP</label>
          <input style={inp} value={startVal} onChange={e => onStart(e.target.value)} placeholder={startPH} />
        </div>
        <div>
          <label style={lbl}>End IP</label>
          <input style={inp} value={endVal} onChange={e => onEnd(e.target.value)} placeholder={endPH} />
        </div>
      </div>
    </div>
  );
}
