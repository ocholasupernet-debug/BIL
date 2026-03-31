import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle, X,
  Server, Edit2, ChevronDown, ChevronUp, Wifi, WifiOff,
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

/* A pair of pools for one router */
interface RouterPools {
  router: DbRouter;
  active:  DbPool | null;
  expired: DbPool | null;
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

async function upsertPool(
  adminId: number, routerId: number, poolName: "active" | "expired",
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
    .insert({ admin_id: adminId, router_id: routerId, name: poolName, range_start: rangeStart, range_end: rangeEnd, created_at: now, updated_at: now });
  return { error: error?.message ?? null };
}

async function deletePool(id: number): Promise<void> {
  await supabase.from("isp_ip_pools").delete().eq("id", id);
}

/* ── Sync pools to a router ── */
async function syncRouter(
  router: DbRouter,
  active: DbPool | null,
  expired: DbPool | null,
  log: (m: string) => void
): Promise<boolean> {
  const host = router.host || router.bridge_ip || "";
  if (!host) { log(`  ⚠ ${router.name} has no IP — skipped`); return false; }
  if (!active && !expired) { log(`  ℹ ${router.name} has no pools — skipped`); return true; }

  log(`\n▶ Syncing ${router.name} (${host})`);
  const pools = [
    ...(active  ? [{ name: "active",  rangeStart: active.range_start,  rangeEnd: active.range_end  }] : []),
    ...(expired ? [{ name: "expired", rangeStart: expired.range_start, rangeEnd: expired.range_end }] : []),
  ];
  const payload = {
    host, bridgeIp: router.bridge_ip || undefined,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    pools,
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

  /* Map pool records to routers — each router has at most 1 active + 1 expired */
  const routerPools = useMemo((): RouterPools[] => {
    const byRouter: Record<number, { active: DbPool | null; expired: DbPool | null }> = {};
    for (const r of routers) byRouter[r.id] = { active: null, expired: null };

    for (const p of pools) {
      if (p.router_id === null) continue;
      if (!byRouter[p.router_id]) byRouter[p.router_id] = { active: null, expired: null };
      /* match by name — "active" wins for active, anything else goes to expired */
      if (p.name === "active")  byRouter[p.router_id].active  = byRouter[p.router_id].active  ?? p;
      if (p.name === "expired") byRouter[p.router_id].expired = byRouter[p.router_id].expired ?? p;
    }

    return routers.map(r => ({ router: r, ...byRouter[r.id] }));
  }, [routers, pools]);

  /* ── Edit modal state ── */
  const [editRouter, setEditRouter] = useState<RouterPools | null>(null);
  const [fActiveStart,  setFActiveStart]  = useState("");
  const [fActiveEnd,    setFActiveEnd]    = useState("");
  const [fExpiredStart, setFExpiredStart] = useState("");
  const [fExpiredEnd,   setFExpiredEnd]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState<string | null>(null);

  function openEdit(rp: RouterPools) {
    setEditRouter(rp);
    setFActiveStart(rp.active?.range_start   ?? "");
    setFActiveEnd(rp.active?.range_end       ?? "");
    setFExpiredStart(rp.expired?.range_start ?? "");
    setFExpiredEnd(rp.expired?.range_end     ?? "");
    setSaveErr(null);
  }

  async function handleSave() {
    if (!editRouter) return;
    if (!fActiveStart.trim() && !fActiveEnd.trim() && !fExpiredStart.trim() && !fExpiredEnd.trim()) {
      setSaveErr("Enter at least one pool range."); return;
    }
    setSaving(true); setSaveErr(null);
    const rid = editRouter.router.id;
    try {
      if (fActiveStart.trim() && fActiveEnd.trim()) {
        const { error } = await upsertPool(ADMIN_ID, rid, "active", fActiveStart.trim(), fActiveEnd.trim(), editRouter.active?.id);
        if (error) { setSaveErr(error); setSaving(false); return; }
      } else if (editRouter.active) {
        await deletePool(editRouter.active.id);
      }
      if (fExpiredStart.trim() && fExpiredEnd.trim()) {
        const { error } = await upsertPool(ADMIN_ID, rid, "expired", fExpiredStart.trim(), fExpiredEnd.trim(), editRouter.expired?.id);
        if (error) { setSaveErr(error); setSaving(false); return; }
      } else if (editRouter.expired) {
        await deletePool(editRouter.expired.id);
      }
      qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
      setEditRouter(null);
    } finally {
      setSaving(false);
    }
  }

  /* ── Sync state ── */
  const [syncLogs, setSyncLogs] = useState<string[] | null>(null);
  const [syncOk,   setSyncOk]   = useState<boolean | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [expandedSync, setExpandedSync] = useState(false);

  async function handleSyncOne(rp: RouterPools) {
    setSyncingId(rp.router.id);
    setSyncLogs([]); setSyncOk(null); setExpandedSync(true);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    const ok = await syncRouter(rp.router, rp.active, rp.expired, log);
    log(ok ? "\n✅ Sync complete." : "\n⚠ Sync had errors.");
    setSyncOk(ok);
    setSyncingId(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true); setSyncLogs([]); setSyncOk(null); setExpandedSync(true);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Syncing all routers…");
    let ok = true;
    for (const rp of routerPools) {
      if (!rp.active && !rp.expired) continue;
      const r2 = await syncRouter(rp.router, rp.active, rp.expired, log);
      if (!r2) ok = false;
    }
    log(ok ? "\n✅ All synced." : "\n⚠ Some routers had errors.");
    setSyncOk(ok);
    setSyncingAll(false);
  }

  /* ── Styles ── */
  const S = {
    btn: (bg: string, color = "white") => ({
      display: "inline-flex" as const, alignItems: "center" as const, gap: "0.35rem",
      padding: "0.42rem 0.9rem", borderRadius: 7, border: "none", background: bg,
      color, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
      transition: "opacity 0.15s", whiteSpace: "nowrap" as const,
    }),
    input: {
      background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
      border: "1px solid var(--isp-border)", borderRadius: 7,
      padding: "0.45rem 0.7rem", color: "var(--isp-text)", fontSize: "0.82rem",
      fontFamily: "inherit", outline: "none", width: "100%",
    } as React.CSSProperties,
    label: { fontSize: "0.7rem", fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: "0.25rem", display: "block" as const },
    poolBadge: (color: string, bg: string, border: string): React.CSSProperties => ({
      display: "inline-flex", alignItems: "center", gap: "0.3rem",
      fontSize: "0.72rem", fontWeight: 700, color, padding: "0.18rem 0.55rem",
      borderRadius: 5, background: bg, border: `1px solid ${border}`,
    }),
  };

  const isLoading = poolsLoading || routersLoading;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1000 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0, flex: 1 }}>
            IP Pools
          </h1>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || routerPools.every(rp => !rp.active && !rp.expired)}
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
        <div style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.78rem", color: "var(--isp-text-muted)", lineHeight: 1.65 }}>
          Each router has an <strong style={{ color: "#22c55e" }}>Active Pool</strong> (for paying customers) and an <strong style={{ color: "#f59e0b" }}>Expired Pool</strong> (for customers whose plan has lapsed).
          Click <strong>Edit</strong> on any router to set its IP ranges. Plans reference these pools by name — <code style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>active</code> and <code style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>expired</code>.
        </div>

        {/* ── Sync log ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(6,182,212,0.2)"}`,
            borderRadius: 10, padding: "0.875rem 1rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: syncOk === false ? "#f87171" : "#06b6d4" }}>
                {syncOk === false ? <AlertTriangle size={13} /> : syncOk ? <CheckCircle2 size={13} /> : <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                Sync Log
              </div>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button onClick={() => setExpandedSync(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                  {expandedSync ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                  <X size={14} />
                </button>
              </div>
            </div>
            {expandedSync && (
              <div style={{ fontFamily: "monospace", fontSize: "0.74rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.12rem", maxHeight: 180, overflowY: "auto" }}>
                {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
              </div>
            )}
          </div>
        )}

        {/* ── Router cards ── */}
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.625rem", padding: "4rem", color: "var(--isp-text-muted)" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
            Loading…
          </div>
        ) : routerPools.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
            <Server size={28} style={{ margin: "0 auto 0.75rem", display: "block", color: "#475569" }} />
            No routers found. Add a router first.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {routerPools.map(rp => {
              const online = rp.router.status === "online";
              const syncing = syncingId === rp.router.id;
              return (
                <div
                  key={rp.router.id}
                  style={{
                    background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                    borderRadius: 12, padding: "1rem 1.125rem",
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                    alignItems: "center", gap: "1rem",
                  }}
                >
                  {/* Router name + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                    {online
                      ? <Wifi size={15} style={{ color: "#22c55e", flexShrink: 0 }} />
                      : <WifiOff size={15} style={{ color: "#475569", flexShrink: 0 }} />}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--isp-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {rp.router.name}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
                        {rp.router.host || rp.router.bridge_ip || "no IP"}
                      </div>
                    </div>
                  </div>

                  {/* Active pool */}
                  <div>
                    <div style={S.label}>Active Pool</div>
                    {rp.active ? (
                      <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#22c55e", fontWeight: 600 }}>
                        {rp.active.range_start}<br />
                        <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>to</span>{" "}
                        {rp.active.range_end}
                      </div>
                    ) : (
                      <span style={S.poolBadge("var(--isp-text-muted)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0.06)")}>
                        not set
                      </span>
                    )}
                  </div>

                  {/* Expired pool */}
                  <div>
                    <div style={S.label}>Expired Pool</div>
                    {rp.expired ? (
                      <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#f59e0b", fontWeight: 600 }}>
                        {rp.expired.range_start}<br />
                        <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>to</span>{" "}
                        {rp.expired.range_end}
                      </div>
                    ) : (
                      <span style={S.poolBadge("var(--isp-text-muted)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0.06)")}>
                        not set
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                    <button
                      onClick={() => openEdit(rp)}
                      style={S.btn("linear-gradient(135deg,#06b6d4,#0284c7)")}
                    >
                      <Edit2 size={12} /> Edit
                    </button>
                    <button
                      onClick={() => handleSyncOne(rp)}
                      disabled={syncing || (!rp.active && !rp.expired)}
                      style={{ ...S.btn("linear-gradient(135deg,#f59e0b,#d97706)"), opacity: syncing || (!rp.active && !rp.expired) ? 0.5 : 1 }}
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
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          onClick={e => { if (e.target === e.currentTarget) setEditRouter(null); }}
        >
          <div style={{
            background: "var(--isp-card)", border: "1px solid var(--isp-border)",
            borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 480,
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                  {editRouter.router.name} — IP Pools
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginTop: "0.15rem" }}>
                  Leave a range blank to remove that pool from this router.
                </div>
              </div>
              <button onClick={() => setEditRouter(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            {/* Active pool section */}
            <div style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 10, padding: "0.875rem 1rem", marginBottom: "0.75rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.8rem", color: "#22c55e", marginBottom: "0.625rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                Active Pool
                <span style={{ fontWeight: 400, color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>— for paying customers</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
                <div>
                  <label style={S.label}>Start IP</label>
                  <input style={S.input} value={fActiveStart} onChange={e => setFActiveStart(e.target.value)} placeholder="e.g. 10.10.0.10" />
                </div>
                <div>
                  <label style={S.label}>End IP</label>
                  <input style={S.input} value={fActiveEnd} onChange={e => setFActiveEnd(e.target.value)} placeholder="e.g. 10.10.0.254" />
                </div>
              </div>
            </div>

            {/* Expired pool section */}
            <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, padding: "0.875rem 1rem", marginBottom: "1rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.8rem", color: "#f59e0b", marginBottom: "0.625rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                Expired Pool
                <span style={{ fontWeight: 400, color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>— for lapsed customers</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
                <div>
                  <label style={S.label}>Start IP</label>
                  <input style={S.input} value={fExpiredStart} onChange={e => setFExpiredStart(e.target.value)} placeholder="e.g. 10.10.1.10" />
                </div>
                <div>
                  <label style={S.label}>End IP</label>
                  <input style={S.input} value={fExpiredEnd} onChange={e => setFExpiredEnd(e.target.value)} placeholder="e.g. 10.10.1.254" />
                </div>
              </div>
            </div>

            {saveErr && (
              <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "#f87171", marginBottom: "0.75rem" }}>
                {saveErr}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
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
