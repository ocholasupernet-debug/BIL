import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle, X,
  Search, Plus, Trash2, Edit2, HelpCircle,
  ChevronDown, Server,
} from "lucide-react";

const API      = import.meta.env.VITE_API_BASE ?? "";
const PAGE_SIZE = 15;

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

const REQUIRED_POOL_TYPES = ["active", "pppoe", "expired"] as const;
type RequiredPoolType = typeof REQUIRED_POOL_TYPES[number];
type RangeField = "start" | "end";
type RouterPoolForm = Record<RequiredPoolType, { start: string; end: string }>;

const POOL_TYPE_LABELS: Record<RequiredPoolType, { label: string; detail: string; color: string }> = {
  active:  { label: "Active",  detail: "Connected subscribers", color: "#22c55e" },
  pppoe:   { label: "PPPoE",   detail: "PPPoE subscriber addresses", color: "var(--isp-accent)" },
  expired: { label: "Expired", detail: "Recovery / lapsed subscribers", color: "#f59e0b" },
};

function emptyRouterPoolForm(): RouterPoolForm {
  return {
    active:  { start: "", end: "" },
    pppoe:   { start: "", end: "" },
    expired: { start: "", end: "" },
  };
}

function buildRouterPoolForms(routers: DbRouter[], pools: DbPool[]): Record<number, RouterPoolForm> {
  return Object.fromEntries(routers.map(router => {
    const form = emptyRouterPoolForm();
    for (const type of REQUIRED_POOL_TYPES) {
      const pool = pools.find(p =>
        p.router_id === router.id && p.name.trim().toLowerCase() === type
      );
      if (pool) form[type] = { start: pool.range_start, end: pool.range_end };
    }
    return [router.id, form];
  }));
}

function ipv4Number(value: string): number | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return null;
  return octets.reduce((number, octet) => number * 256 + octet, 0);
}

function rangeError(range: { start: string; end: string }): string | null {
  const start = ipv4Number(range.start);
  const end = ipv4Number(range.end);
  if (start === null || end === null) return "use valid IPv4 addresses";
  if (start > end) return "start IP must not be after end IP";
  return null;
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
async function syncRouterPools(
  router: DbRouter, pools: DbPool[], log: (m: string) => void
): Promise<boolean> {
  const rPools = pools.filter(p => p.router_id === router.id);
  if (!rPools.length) { log(`  ℹ No pools assigned to ${router.name}`); return true; }
  const host = router.host || router.bridge_ip || "";
  if (!host) { log(`  ⚠ ${router.name} has no IP — skipped`); return false; }
  log(`\n▶ ${router.name} (${host})`);
  const payload = {
    host, bridgeIp: router.bridge_ip || undefined,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    pools: rPools.map(p => ({ name: p.name, rangeStart: p.range_start, rangeEnd: p.range_end })),
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
    log(`  ✗ ${e instanceof Error ? e.message : e}`);
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

  const routerMap = useMemo(() =>
    Object.fromEntries(routers.map(r => [r.id, r])), [routers]);

  const initialRouterPoolForms = useMemo(
    () => buildRouterPoolForms(routers, pools),
    [routers, pools],
  );

  /* ── UI state ── */
  const [search,  setSearch]  = useState("");
  const [page,    setPage]    = useState(1);
  const [showHelp, setShowHelp] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  /* Sync state */
  const [syncingAll,       setSyncingAll]       = useState(false);
  const [syncingRouter,    setSyncingRouter]     = useState(false);
  const [showRouterPicker, setShowRouterPicker]  = useState(false);
  const [pickedRouter,     setPickedRouter]      = useState("");
  const [syncLogs,         setSyncLogs]          = useState<string[] | null>(null);
  const [syncOk,           setSyncOk]            = useState<boolean | null>(null);

  /* Add / Edit modal */
  const [showForm, setShowForm] = useState(false);
  const [editPool, setEditPool] = useState<DbPool | null>(null);
  const [fName,      setFName]      = useState("");
  const [fStart,     setFStart]     = useState("");
  const [fEnd,       setFEnd]       = useState("");
  const [fRouterId,  setFRouterId]  = useState("");
  const [saving,     setSaving]     = useState(false);
  const [saveErr,    setSaveErr]    = useState<string | null>(null);
  const [routerPoolForms, setRouterPoolForms] = useState<Record<number, RouterPoolForm>>({});
  const [savingRouterId, setSavingRouterId] = useState<number | null>(null);
  const [routerPoolErrors, setRouterPoolErrors] = useState<Record<number, string | null>>({});

  useEffect(() => {
    if (poolsLoading || routersLoading) return;
    setRouterPoolForms(current => {
      const next = { ...current };
      for (const router of routers) {
        if (!next[router.id]) next[router.id] = initialRouterPoolForms[router.id] ?? emptyRouterPoolForm();
      }
      return next;
    });
  }, [initialRouterPoolForms, poolsLoading, routers, routersLoading]);

  /* ── Filtered + paginated ── */
  const filtered = useMemo(() =>
    pools.filter(p =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      `${p.range_start}-${p.range_end}`.includes(search)
    ), [pools, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagePools  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ── CRUD ── */
  function openAdd() {
    setEditPool(null);
    setFName(""); setFStart(""); setFEnd(""); setFRouterId("");
    setSaveErr(null); setShowForm(true);
  }
  function openEdit(p: DbPool) {
    setEditPool(p);
    setFName(p.name); setFStart(p.range_start); setFEnd(p.range_end);
    setFRouterId(p.router_id ? String(p.router_id) : "");
    setSaveErr(null); setShowForm(true);
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
    setShowForm(false); setSaving(false);
  }
  async function deletePool(id: number) {
    setDeleting(id);
    await supabase.from("isp_ip_pools").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
    setDeleting(null);
  }

  function updateRouterPoolField(routerId: number, type: RequiredPoolType, field: RangeField, value: string) {
    setRouterPoolForms(current => {
      const form = current[routerId] ?? emptyRouterPoolForm();
      return {
        ...current,
        [routerId]: {
          ...form,
          [type]: { ...form[type], [field]: value },
        },
      };
    });
  }

  async function saveRouterPools(routerId: number) {
    const form = routerPoolForms[routerId] ?? emptyRouterPoolForm();
    const missing = REQUIRED_POOL_TYPES.find(type => !form[type].start.trim() || !form[type].end.trim());
    if (missing) {
      setRouterPoolErrors(current => ({
        ...current,
        [routerId]: `${POOL_TYPE_LABELS[missing].label} pool start and end IPs are required.`,
      }));
      return;
    }
    const invalid = REQUIRED_POOL_TYPES.find(type => rangeError(form[type]));
    if (invalid) {
      setRouterPoolErrors(current => ({
        ...current,
        [routerId]: `${POOL_TYPE_LABELS[invalid].label} pool ${rangeError(form[invalid])}.`,
      }));
      return;
    }

    setSavingRouterId(routerId);
    setRouterPoolErrors(current => ({ ...current, [routerId]: null }));
    try {
      const now = new Date().toISOString();
      for (const type of REQUIRED_POOL_TYPES) {
        const range = form[type];
        const existing = pools.find(p =>
          p.router_id === routerId && p.name.trim().toLowerCase() === type
        );
        const payload = {
          name: type,
          range_start: range.start.trim(),
          range_end: range.end.trim(),
          router_id: routerId,
          updated_at: now,
        };
        const result = existing
          ? await supabase.from("isp_ip_pools").update(payload).eq("id", existing.id)
          : await supabase.from("isp_ip_pools").insert({ ...payload, admin_id: ADMIN_ID, created_at: now });
        if (result.error) throw result.error;
      }
      await qc.invalidateQueries({ queryKey: ["isp_ip_pools", ADMIN_ID] });
    } catch (error) {
      setRouterPoolErrors(current => ({
        ...current,
        [routerId]: error instanceof Error ? error.message : "Could not save this router's pools.",
      }));
    } finally {
      setSavingRouterId(null);
    }
  }

  /* ── Sync handlers ── */
  async function handleSyncAll() {
    setSyncingAll(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Syncing all routers…");
    const rids = [...new Set(pools.filter(p => p.router_id).map(p => p.router_id!))];
    if (!rids.length) { log("No pools assigned to any router."); setSyncOk(true); setSyncingAll(false); return; }
    let ok = true;
    for (const rid of rids) {
      const r = routerMap[rid];
      if (r) { const r2 = await syncRouterPools(r, pools, log); if (!r2) ok = false; }
    }
    log(ok ? "\n✅ All synced." : "\n⚠ Some routers had errors.");
    setSyncOk(ok); setSyncingAll(false);
  }

  async function handleSyncByRouter() {
    if (!pickedRouter) return;
    setSyncingRouter(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    const r = routerMap[Number(pickedRouter)];
    if (!r) { log("Router not found."); setSyncOk(false); setSyncingRouter(false); return; }
    const ok = await syncRouterPools(r, pools, log);
    log(ok ? "\n✅ Done." : "\n⚠ Errors (see above).");
    setSyncOk(ok); setSyncingRouter(false); setShowRouterPicker(false);
  }

  /* ── Styles ── */
  const btn = (bg: string, color = "#fff") => ({
    display: "inline-flex" as const, alignItems: "center" as const, gap: "0.35rem",
    padding: "0.42rem 1rem", borderRadius: 6, border: "none", background: bg,
    color, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  });
  const INPUT: React.CSSProperties = {
    background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
    border: "1px solid var(--isp-border)", borderRadius: 6,
    padding: "0.45rem 0.75rem", color: "var(--isp-text)", fontSize: "0.84rem",
    fontFamily: "inherit", outline: "none", width: "100%",
  };
  const LBL: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: "0.25rem", display: "block" };

  const TH: React.CSSProperties = {
    padding: "0.6rem 0.875rem", fontSize: "0.72rem", fontWeight: 800,
    color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em",
    textAlign: "left", background: "rgba(255,255,255,0.025)",
    borderBottom: "1px solid var(--isp-border)",
  };
  const TD: React.CSSProperties = {
    padding: "0.65rem 0.875rem", fontSize: "0.83rem", color: "var(--isp-text)",
    borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "middle",
  };

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", maxWidth: 1100 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--isp-text)", margin: 0, flex: 1 }}>
            IP Pool
          </h1>

          {/* Sync All */}
          <button onClick={handleSyncAll} disabled={syncingAll || pools.length === 0}
            style={{ ...btn("linear-gradient(135deg,#f43f5e,#e11d48)"), opacity: syncingAll ? 0.7 : 1 }}>
            {syncingAll ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={13} />}
            Sync All
          </button>

          {/* Sync by Router */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowRouterPicker(v => !v)} disabled={syncingRouter}
              style={btn("var(--isp-accent)")}>
              {syncingRouter ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Server size={13} />}
              Sync by Router
              <ChevronDown size={12} />
            </button>
            {showRouterPicker && (
              <div style={{
                position: "absolute", top: "110%", right: 0, zIndex: 50,
                background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                borderRadius: 10, padding: "0.875rem", minWidth: 230,
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.5rem" }}>
                  Select router to sync
                </div>
                <select value={pickedRouter} onChange={e => setPickedRouter(e.target.value)}
                  style={{ ...INPUT, marginBottom: "0.5rem" }}>
                  <option value="">— choose router —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"}
                    </option>
                  ))}
                </select>
                <button onClick={handleSyncByRouter} disabled={!pickedRouter || syncingRouter}
                  style={{ ...btn(pickedRouter ? "var(--isp-accent)" : "rgba(255,255,255,0.06)"), width: "100%", justifyContent: "center" }}>
                  {syncingRouter ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={13} />}
                  Sync
                </button>
              </div>
            )}
          </div>

          {/* Need Help */}
          <button onClick={() => setShowHelp(v => !v)}
            style={btn("linear-gradient(135deg,#22c55e,#16a34a)")}>
            <HelpCircle size={13} /> Need Help?
          </button>
        </div>

        <NetworkTabs active="ip-pools" />

        {/* ── Required per-router PPPoE pools ── */}
        <div style={{
          background: "var(--isp-card)", border: "1px solid var(--isp-border)",
          borderRadius: 10, padding: "1rem",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
            <div>
              <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.95rem", fontWeight: 800 }}>
                Router pool assignments
              </h2>
              <p style={{ margin: "0.3rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.75rem" }}>
                Assign the active, PPPoE, and expired address ranges separately for every router.
              </p>
            </div>
            <span style={{
              color: "#fbbf24", background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.2)", borderRadius: 6,
              padding: "0.25rem 0.55rem", fontSize: "0.68rem", fontWeight: 700,
            }}>
              3 required pools per router
            </span>
          </div>

          {routers.length === 0 ? (
            <div style={{ padding: "1rem 0 0.25rem", color: "var(--isp-text-muted)", fontSize: "0.78rem" }}>
              Add a router first. Its three pool ranges will appear here.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: "0.75rem" }}>
              {routers.map(router => {
                const form = routerPoolForms[router.id] ?? emptyRouterPoolForm();
                const isSaving = savingRouterId === router.id;
                return (
                  <div key={router.id} style={{
                    border: "1px solid var(--isp-border)", borderRadius: 9,
                    background: "var(--isp-section)", padding: "0.8rem",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.7rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--isp-text)", fontSize: "0.82rem", fontWeight: 800 }}>
                          <Server size={13} style={{ color: "var(--isp-accent)", flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{router.name}</span>
                        </div>
                        <div style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", marginTop: "0.18rem", paddingLeft: "1.05rem" }}>
                          {router.host || router.bridge_ip || "No router IP"}
                        </div>
                      </div>
                      <span style={{ color: router.status === "online" ? "#4ade80" : "var(--isp-text-muted)", fontSize: "0.65rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {router.status === "online" ? "● Online" : "● Offline"}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                      {REQUIRED_POOL_TYPES.map(type => {
                        const metadata = POOL_TYPE_LABELS[type];
                        return (
                          <div key={type}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                              <span style={{ color: metadata.color, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {metadata.label}
                              </span>
                              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.64rem" }}>{metadata.detail}</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                              {(["start", "end"] as const).map(field => (
                                <input
                                  key={field}
                                  value={form[type][field]}
                                  onChange={event => updateRouterPoolField(router.id, type, field, event.target.value)}
                                  placeholder={field === "start" ? "Start IP" : "End IP"}
                                  aria-label={`${metadata.label} ${field} IP for ${router.name}`}
                                  style={{ ...INPUT, fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box" }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {routerPoolErrors[router.id] && (
                      <div style={{ marginTop: "0.65rem", color: "#f87171", fontSize: "0.7rem" }}>
                        {routerPoolErrors[router.id]}
                      </div>
                    )}
                    <button
                      onClick={() => void saveRouterPools(router.id)}
                      disabled={isSaving}
                      style={{ ...btn("var(--isp-accent)"), width: "100%", justifyContent: "center", marginTop: "0.75rem", opacity: isSaving ? 0.7 : 1 }}
                    >
                      {isSaving ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={12} />}
                      {isSaving ? "Saving ranges…" : "Save router pools"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Help panel ── */}
        {showHelp && (
          <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10, padding: "0.875rem 1rem", fontSize: "0.79rem", color: "#4ade80", lineHeight: 1.75 }}>
            <strong>IP Pool Guide</strong><br />
            • Every router should have one <code style={{ fontFamily: "monospace" }}>active</code>, <code style={{ fontFamily: "monospace" }}>pppoe</code>, and <code style={{ fontFamily: "monospace" }}>expired</code> pool assignment.<br />
            • <strong>Active</strong> — connected subscribers. <strong>PPPoE</strong> — PPPoE subscriber addresses. <strong>Expired</strong> — recovery / lapsed subscribers.<br />
            • Save the router card first, then click <strong>Sync All</strong> or <strong>Sync by Router</strong> to push its ranges.
          </div>
        )}

        {/* ── Sync log ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(37,99,235,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(37,99,235,0.2)"}`,
            borderRadius: 10, padding: "0.75rem 1rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: syncOk === false ? "#f87171" : "var(--isp-accent)" }}>
                {syncOk === false ? <AlertTriangle size={13} /> : syncOk ? <CheckCircle2 size={13} /> : <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                Sync Log
              </div>
              <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.73rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.1rem", maxHeight: 180, overflowY: "auto" }}>
              {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </div>
        )}

        {/* ── Search + New Pool ── */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by Name…"
              style={{ ...INPUT, paddingLeft: "2.25rem" }}
            />
          </div>
          <button onClick={openAdd} style={btn("var(--isp-accent)")}>
            <Plus size={14} /> New Pool
          </button>
        </div>

        {/* ── Table ── */}
        <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={TH}>Name Pool</th>
                <th style={TH}>Range IP</th>
                <th style={TH}>Routers</th>
                <th style={TH}>Manage</th>
                <th style={{ ...TH, textAlign: "right" }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {poolsLoading ? (
                <tr>
                  <td colSpan={5} style={{ ...TD, textAlign: "center", padding: "3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.625rem", color: "var(--isp-text-muted)" }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--isp-accent)" }} /> Loading…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...TD, textAlign: "center", padding: "3rem", color: "var(--isp-text-muted)" }}>
                    {search ? "No pools match your search." : "No IP pools yet — click + New Pool to create one."}
                  </td>
                </tr>
              ) : (
                pagePools.map(pool => {
                  const router = pool.router_id ? routerMap[pool.router_id] : null;
                  /* Color-code by pool name */
                  const nameColor =
                    pool.name === "active"  ? "#22c55e" :
                    pool.name === "pppoe"   ? "var(--isp-accent)" :
                    pool.name === "expired" ? "#f59e0b" :
                    "var(--isp-text)";
                  return (
                    <tr key={pool.id}
                      style={{ transition: "background 0.1s" }}
                      onMouseOver={e => (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.02)"}
                      onMouseOut={e  => (e.currentTarget as HTMLTableRowElement).style.background = "transparent"}
                    >
                      <td style={{ ...TD, fontWeight: 700, color: nameColor, fontFamily: "monospace", textTransform: "uppercase" }}>
                        {pool.name}
                      </td>
                      <td style={{ ...TD, fontFamily: "monospace", color: "var(--isp-accent)", fontWeight: 600 }}>
                        {pool.range_start}–{pool.range_end}
                      </td>
                      <td style={TD}>
                        {router ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "0.3rem",
                            fontSize: "0.75rem", fontWeight: 700,
                            background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)",
                            color: "var(--isp-accent)", borderRadius: 5, padding: "0.18rem 0.55rem",
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: router.status === "online" ? "#22c55e" : "#475569" }} />
                            {router.name}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontStyle: "italic" }}>— unassigned —</span>
                        )}
                      </td>
                      <td style={TD}>
                        <div style={{ display: "flex", gap: "0.35rem" }}>
                          <button onClick={() => openEdit(pool)}
                            style={{ ...btn("linear-gradient(135deg,#22c55e,#16a34a)"), padding: "0.32rem 0.75rem", fontSize: "0.75rem" }}>
                            <Edit2 size={11} /> Edit
                          </button>
                          <button onClick={() => deletePool(pool.id)} disabled={deleting === pool.id}
                            style={{ ...btn("linear-gradient(135deg,#ef4444,#dc2626)"), padding: "0.32rem 0.6rem", fontSize: "0.75rem" }}>
                            {deleting === pool.id
                              ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                              : <Trash2 size={11} />}
                          </button>
                        </div>
                      </td>
                      <td style={{ ...TD, textAlign: "right", fontSize: "0.72rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
                        {pool.id}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                style={{
                  ...btn(p === page ? "var(--isp-accent)" : "rgba(255,255,255,0.05)", p === page ? "white" : "var(--isp-text-muted)"),
                  border: `1px solid ${p === page ? "transparent" : "var(--isp-border)"}`,
                  padding: "0.32rem 0.7rem", minWidth: 32,
                }}>
                {p}
              </button>
            ))}
            <span style={{ fontSize: "0.71rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              {filtered.length} pool{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ══════════════════════ Add / Edit Modal ══════════════════════ */}
      {showForm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                {editPool ? "Edit Pool" : "New IP Pool"}
              </div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label style={LBL}>Pool Name</label>
                <select value={fName} onChange={e => setFName(e.target.value)} style={{ ...INPUT, cursor: "pointer" }}>
                  <option value="">— select type —</option>
                  <option value="active">active — hotspot / general clients</option>
                  <option value="pppoe">pppoe — PPPoE subscriber IPs</option>
                  <option value="expired">expired — lapsed customers</option>
                  <option value="__custom">Custom name…</option>
                </select>
                {fName === "__custom" && (
                  <input style={{ ...INPUT, marginTop: "0.4rem" }} placeholder="Enter pool name" onChange={e => setFName(e.target.value)} autoFocus />
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
                <div>
                  <label style={LBL}>Start IP</label>
                  <input style={INPUT} value={fStart} onChange={e => setFStart(e.target.value)} placeholder="e.g. 10.10.0.10" />
                </div>
                <div>
                  <label style={LBL}>End IP</label>
                  <input style={INPUT} value={fEnd} onChange={e => setFEnd(e.target.value)} placeholder="e.g. 10.10.0.254" />
                </div>
              </div>

              <div>
                <label style={LBL}>Assign to Router</label>
                <select value={fRouterId} onChange={e => setFRouterId(e.target.value)} style={{ ...INPUT, cursor: "pointer" }}>
                  <option value="">— unassigned —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"} — {r.host || r.bridge_ip || "no IP"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {saveErr && (
              <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>
                {saveErr}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button onClick={() => setShowForm(false)} style={btn("rgba(255,255,255,0.06)", "var(--isp-text-muted)")}>
                Cancel
              </button>
              <button onClick={savePool} disabled={saving} style={{ ...btn("var(--isp-accent)"), opacity: saving ? 0.7 : 1 }}>
                {saving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={13} />}
                {editPool ? "Update Pool" : "Save Pool"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
