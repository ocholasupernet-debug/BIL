import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Plus, Search, Edit2, Trash2, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, X, Database, Server,
  ChevronDown, HelpCircle,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";
const PAGE_SIZE = 10;

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

/* ── Supabase helpers ── */
async function fetchPools(): Promise<DbPool[]> {
  const { data } = await supabase
    .from("isp_ip_pools")
    .select("id,name,range_start,range_end,router_id,created_at")
    .eq("admin_id", ADMIN_ID)
    .order("id", { ascending: false });
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

/* ── Sync one router's pools ── */
async function syncRouter(
  router: DbRouter,
  pools: DbPool[],
  log: (m: string) => void
): Promise<boolean> {
  const rPools = pools.filter(p => p.router_id === router.id);
  if (!rPools.length) {
    log(`  ℹ No pools assigned to ${router.name} — skipped`);
    return true;
  }
  const host     = router.host || router.bridge_ip || "";
  const bridgeIp = router.bridge_ip || undefined;
  if (!host) {
    log(`  ⚠ ${router.name} has no IP — skipped`);
    return false;
  }
  log(`\n▶ Router: ${router.name} (${host})`);
  const payload = {
    host, bridgeIp,
    username: router.router_username || "admin",
    password: router.router_secret  || "",
    pools: rPools.map(p => ({ name: p.name, rangeStart: p.range_start, rangeEnd: p.range_end })),
  };
  const res  = await fetch(`${API}/api/admin/sync/ip-pools`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { ok: boolean; logs: string[] };
  (data.logs ?? []).forEach(l => log(l));
  return data.ok;
}

/* ══════════════════════════════════════════════════════ Page ══ */
export default function IPPool() {
  const qc = useQueryClient();

  const { data: pools = [], isLoading: poolsLoading } = useQuery<DbPool[]>({
    queryKey: ["isp_ip_pools", ADMIN_ID],
    queryFn: fetchPools,
    staleTime: 10_000,
  });

  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_pools", ADMIN_ID],
    queryFn: fetchRouters,
    staleTime: 15_000,
  });

  /* ── UI state ── */
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(1);
  const [showForm, setShowForm]     = useState(false);
  const [editPool, setEditPool]     = useState<DbPool | null>(null);
  const [deleting, setDeleting]     = useState<number | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveErr, setSaveErr]       = useState<string | null>(null);

  /* Sync state */
  const [syncingAll, setSyncingAll]           = useState(false);
  const [showRouterPicker, setShowRouterPicker] = useState(false);
  const [pickedRouter, setPickedRouter]       = useState<string>("");
  const [syncingRouter, setSyncingRouter]     = useState(false);
  const [syncLogs, setSyncLogs]               = useState<string[] | null>(null);
  const [syncOk, setSyncOk]                   = useState<boolean | null>(null);
  const [showHelp, setShowHelp]               = useState(false);

  /* Form state */
  const [fName, setFName]         = useState("");
  const [fStart, setFStart]       = useState("");
  const [fEnd, setFEnd]           = useState("");
  const [fRouterId, setFRouterId] = useState<string>("");

  /* ── Filtered + paginated data ── */
  const filtered = useMemo(() =>
    pools.filter(p =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      `${p.range_start}-${p.range_end}`.includes(search)
    ), [pools, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagePools  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const routerMap = useMemo(() =>
    Object.fromEntries(routers.map(r => [r.id, r])), [routers]);

  /* ── CRUD helpers ── */
  function openAdd() {
    setEditPool(null);
    setFName(""); setFStart(""); setFEnd(""); setFRouterId("");
    setSaveErr(null);
    setShowForm(true);
  }

  function openEdit(p: DbPool) {
    setEditPool(p);
    setFName(p.name); setFStart(p.range_start); setFEnd(p.range_end);
    setFRouterId(p.router_id ? String(p.router_id) : "");
    setSaveErr(null);
    setShowForm(true);
  }

  async function savePool() {
    if (!fName.trim() || !fStart.trim() || !fEnd.trim()) {
      setSaveErr("Pool name and IP range are required."); return;
    }
    setSaving(true); setSaveErr(null);
    const row = {
      admin_id:    ADMIN_ID,
      name:        fName.trim(),
      range_start: fStart.trim(),
      range_end:   fEnd.trim(),
      router_id:   fRouterId ? Number(fRouterId) : null,
      updated_at:  new Date().toISOString(),
    };
    const { error } = editPool
      ? await supabase.from("isp_ip_pools").update(row).eq("id", editPool.id)
      : await supabase.from("isp_ip_pools").insert({ ...row, created_at: new Date().toISOString() });
    if (error) { setSaveErr(error.message); setSaving(false); return; }
    qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
    setShowForm(false);
    setSaving(false);
  }

  async function deletePool(id: number) {
    setDeleting(id);
    await supabase.from("isp_ip_pools").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
    setDeleting(null);
  }

  /* ── Sync helpers ── */
  async function handleSyncAll() {
    setSyncingAll(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Syncing all IP pools to their assigned routers…");
    let ok = true;
    const assignedRouterIds = [...new Set(pools.filter(p => p.router_id).map(p => p.router_id!))];
    if (!assignedRouterIds.length) { log("No pools have routers assigned."); setSyncOk(true); setSyncingAll(false); return; }
    for (const rid of assignedRouterIds) {
      const r = routerMap[rid];
      if (r) { const r2 = await syncRouter(r, pools, log); if (!r2) ok = false; }
    }
    log(ok ? "\n✅ All pools synced successfully." : "\n⚠ Some routers had errors (see above).");
    setSyncOk(ok);
    setSyncingAll(false);
  }

  async function handleSyncByRouter() {
    if (!pickedRouter) return;
    setSyncingRouter(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    const r = routerMap[Number(pickedRouter)];
    if (!r) { log("Router not found."); setSyncOk(false); setSyncingRouter(false); return; }
    const ok = await syncRouter(r, pools, log);
    setSyncOk(ok);
    setSyncingRouter(false);
    setShowRouterPicker(false);
  }

  /* ── Styles ── */
  const S = {
    btn: (bg: string, color = "white") => ({
      display: "inline-flex" as const, alignItems: "center" as const, gap: "0.375rem",
      padding: "0.45rem 1rem", borderRadius: 7, border: "none", background: bg,
      color, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
      transition: "opacity 0.15s",
    }),
    input: {
      background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
      border: "1px solid var(--isp-border)", borderRadius: 7,
      padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.84rem",
      fontFamily: "inherit", outline: "none", width: "100%",
    } as React.CSSProperties,
    label: { fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: "0.3rem", display: "block" as const },
  };

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1100 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0, flex: 1 }}>
            IP Pools
          </h1>

          {/* Sync All */}
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || pools.length === 0}
            style={{ ...S.btn("linear-gradient(135deg,#f59e0b,#d97706)"), opacity: syncingAll ? 0.7 : 1 }}
          >
            {syncingAll
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <RefreshCw size={13} />}
            Sync All
          </button>

          {/* Sync by Router */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowRouterPicker(v => !v)}
              disabled={syncingRouter}
              style={{ ...S.btn("linear-gradient(135deg,#f59e0b,#d97706)") }}
            >
              {syncingRouter
                ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                : <Server size={13} />}
              Sync by Router
              <ChevronDown size={12} />
            </button>
            {showRouterPicker && (
              <div style={{
                position: "absolute", top: "110%", right: 0, zIndex: 50,
                background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                borderRadius: 10, padding: "0.875rem", minWidth: 230,
                boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
              }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.5rem" }}>
                  Select router to sync pools
                </div>
                <select
                  value={pickedRouter}
                  onChange={e => setPickedRouter(e.target.value)}
                  style={{ ...S.input, marginBottom: "0.625rem" }}
                >
                  <option value="">— choose router —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSyncByRouter}
                  disabled={!pickedRouter || syncingRouter}
                  style={{ ...S.btn(pickedRouter ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.06)"), width: "100%", justifyContent: "center" }}
                >
                  {syncingRouter ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={13} />}
                  Sync
                </button>
              </div>
            )}
          </div>

          {/* Need Help */}
          <button
            onClick={() => setShowHelp(v => !v)}
            style={{ ...S.btn("linear-gradient(135deg,#22c55e,#16a34a)") }}
          >
            <HelpCircle size={13} /> Need Help?
          </button>
        </div>

        <NetworkTabs active="ip-pools" />

        {/* ── Help panel ── */}
        {showHelp && (
          <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10, padding: "0.875rem 1rem", fontSize: "0.8rem", color: "#4ade80", lineHeight: 1.75 }}>
            <strong>IP Pool Guide</strong><br />
            • Create pools with a name and IP range (e.g., 192.168.10.5–192.168.10.254).<br />
            • Assign each pool to a router — this links it for sync.<br />
            • Click <strong>Sync All</strong> to push all pools to their assigned routers.<br />
            • Click <strong>Sync by Router</strong> to push only the pools for one specific router.<br />
            • Syncing runs <code style={{ fontFamily: "monospace" }}>/ip pool add/set</code> on the router — safe to re-run.
          </div>
        )}

        {/* ── Sync log output ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(6,182,212,0.2)"}`,
            borderRadius: 10, padding: "0.875rem 1rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.82rem", color: syncOk === false ? "#f87171" : "#06b6d4" }}>
                {syncOk === false ? <AlertTriangle size={13} /> : syncOk ? <CheckCircle2 size={13} /> : <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                Sync Log
              </div>
              <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.74rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.15rem", maxHeight: 200, overflowY: "auto" }}>
              {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </div>
        )}

        {/* ── Search + New Pool ── */}
        <div style={{ display: "flex", gap: "0.625rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or IP range…"
              style={{ ...S.input, paddingLeft: "2.25rem" }}
            />
          </div>
          <button onClick={openAdd} style={{ ...S.btn("linear-gradient(135deg,#06b6d4,#0284c7)"), whiteSpace: "nowrap" }}>
            <Plus size={14} /> New Pool
          </button>
        </div>

        {/* ── Table ── */}
        <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 160px 130px 60px",
            padding: "0.6rem 1.125rem",
            background: "rgba(6,182,212,0.05)", borderBottom: "1px solid var(--isp-border)",
            fontSize: "0.68rem", fontWeight: 800, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            <div>Name Pool</div>
            <div>Range IP</div>
            <div>Router</div>
            <div>Manage</div>
            <div style={{ textAlign: "right" }}>ID</div>
          </div>

          {poolsLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.625rem", padding: "3rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "3.5rem 1.5rem", textAlign: "center" }}>
              <Database size={28} style={{ color: "#475569", margin: "0 auto 0.75rem" }} />
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--isp-text)", marginBottom: "0.35rem" }}>
                {search ? "No pools match your search" : "No IP pools yet"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", marginBottom: "1rem" }}>
                {search ? "Try a different search term." : "Create your first IP pool and assign it to a router."}
              </div>
              {!search && (
                <button onClick={openAdd} style={{ ...S.btn("linear-gradient(135deg,#06b6d4,#0284c7)") }}>
                  <Plus size={13} /> New Pool
                </button>
              )}
            </div>
          ) : (
            pagePools.map((pool, idx) => {
              const router = pool.router_id ? routerMap[pool.router_id] : null;
              const isLast = idx === pagePools.length - 1;
              return (
                <div
                  key={pool.id}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr 160px 130px 60px",
                    padding: "0.75rem 1.125rem", alignItems: "center",
                    borderBottom: isLast ? "none" : "1px solid var(--isp-border-subtle)",
                    transition: "background 0.1s",
                  }}
                  onMouseOver={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"}
                  onMouseOut={e  => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                >
                  {/* Name */}
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--isp-text)", fontFamily: "monospace" }}>
                    {pool.name}
                  </div>
                  {/* Range */}
                  <div style={{ fontSize: "0.82rem", color: "#06b6d4", fontFamily: "monospace", fontWeight: 600 }}>
                    {pool.range_start}–{pool.range_end}
                  </div>
                  {/* Router */}
                  <div>
                    {router ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: "0.35rem",
                        fontSize: "0.75rem", fontWeight: 700,
                        background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)",
                        color: "#06b6d4", borderRadius: 5, padding: "0.2rem 0.6rem",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: router.status === "online" ? "#22c55e" : "#475569" }} />
                        {router.name}
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontStyle: "italic" }}>— unassigned —</span>
                    )}
                  </div>
                  {/* Manage */}
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <button
                      onClick={() => openEdit(pool)}
                      style={{ ...S.btn("linear-gradient(135deg,#22c55e,#16a34a)"), padding: "0.35rem 0.75rem", fontSize: "0.75rem" }}
                    >
                      <Edit2 size={11} /> Edit
                    </button>
                    <button
                      onClick={() => deletePool(pool.id)}
                      disabled={deleting === pool.id}
                      style={{ ...S.btn("linear-gradient(135deg,#ef4444,#dc2626)"), padding: "0.35rem 0.625rem", fontSize: "0.75rem" }}
                    >
                      {deleting === pool.id
                        ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                        : <Trash2 size={11} />}
                    </button>
                  </div>
                  {/* ID */}
                  <div style={{ textAlign: "right", fontSize: "0.72rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
                    {pool.id}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              style={{ ...S.btn("rgba(255,255,255,0.06)", "var(--isp-text-muted)"), border: "1px solid var(--isp-border)", padding: "0.35rem 0.6rem" }}
            >
              <ChevronLeft size={13} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  ...S.btn(
                    p === page ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.04)",
                    p === page ? "white" : "var(--isp-text-muted)"
                  ),
                  border: `1px solid ${p === page ? "transparent" : "var(--isp-border)"}`,
                  padding: "0.35rem 0.75rem", minWidth: 34,
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{ ...S.btn("rgba(255,255,255,0.06)", "var(--isp-text-muted)"), border: "1px solid var(--isp-border)", padding: "0.35rem 0.6rem" }}
            >
              <ChevronRight size={13} />
            </button>
            <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              {filtered.length} pool{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ══════════════════════ Add / Edit Modal ══════════════════════ */}
      {showForm && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{
            background: "var(--isp-card)", border: "1px solid var(--isp-border)",
            borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 480,
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}>
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Database size={16} style={{ color: "#06b6d4" }} />
                <span style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                  {editPool ? "Edit IP Pool" : "New IP Pool"}
                </span>
              </div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)", padding: "0.2rem" }}>
                <X size={16} />
              </button>
            </div>

            {/* Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label style={S.label}>Pool Name</label>
                <input
                  value={fName} onChange={e => setFName(e.target.value)}
                  placeholder="e.g. PPPOE ACTIVE POOL"
                  style={S.input}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
                <div>
                  <label style={S.label}>Range Start</label>
                  <input
                    value={fStart} onChange={e => setFStart(e.target.value)}
                    placeholder="192.168.10.5"
                    style={{ ...S.input, fontFamily: "monospace" }}
                  />
                </div>
                <div>
                  <label style={S.label}>Range End</label>
                  <input
                    value={fEnd} onChange={e => setFEnd(e.target.value)}
                    placeholder="192.168.10.254"
                    style={{ ...S.input, fontFamily: "monospace" }}
                  />
                </div>
              </div>

              <div>
                <label style={S.label}>Assign to Router</label>
                <select
                  value={fRouterId} onChange={e => setFRouterId(e.target.value)}
                  style={{ ...S.input }}
                >
                  <option value="">— no router assigned —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"} ({r.host || "no IP"})
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", marginTop: "0.3rem" }}>
                  Assign to sync this pool to a specific router.
                </div>
              </div>

              {saveErr && (
                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 7, padding: "0.6rem 0.875rem", fontSize: "0.78rem", color: "#f87171" }}>
                  <AlertTriangle size={12} style={{ display: "inline", marginRight: "0.3rem" }} />
                  {saveErr}
                </div>
              )}
            </div>

            {/* Modal actions */}
            <div style={{ display: "flex", gap: "0.625rem", marginTop: "1.375rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowForm(false)}
                style={{ ...S.btn("rgba(255,255,255,0.06)", "var(--isp-text-muted)"), border: "1px solid var(--isp-border)" }}
              >
                Cancel
              </button>
              <button
                onClick={savePool}
                disabled={saving}
                style={{ ...S.btn("linear-gradient(135deg,#06b6d4,#0284c7)"), opacity: saving ? 0.7 : 1, minWidth: 90 }}
              >
                {saving
                  ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
                  : <><CheckCircle2 size={13} /> {editPool ? "Save Changes" : "Create Pool"}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
