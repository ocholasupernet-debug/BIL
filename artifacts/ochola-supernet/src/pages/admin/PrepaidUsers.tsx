import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase, ADMIN_ID, type DbCustomer } from "@/lib/supabase";
import {
  Search, Loader2, RefreshCw, Wifi, Network, Globe,
  Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, Filter, Download, UploadCloud, Eye,
  X, Phone, Mail, CalendarDays, Server,
} from "lucide-react";

const API      = import.meta.env.VITE_API_BASE ?? "";
const PAGE_SIZE = 20;

/* ══════════════════════════════ Types ══════════════════════════════ */
interface Plan   { id: number; name: string; type: string; price: number; speed_down: number; speed_up: number; }
interface Router { id: number; name: string; host: string; status: string; router_username: string; router_secret: string | null; bridge_ip: string | null; }

interface Customer extends DbCustomer { router_id?: number | null; }

type StatusFilter = "all" | "active" | "expired" | "suspended" | "online";

/* ══════════════════════════════ Helpers ══════════════════════════════ */
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}
function isExpiringSoon(d?: string | null) {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000; // 3 days
}
function isExpired(d?: string | null) {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

const TYPE_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hotspot: { label: "Hotspot", color: "#22d3ee", bg: "rgba(6,182,212,0.12)",  icon: <Wifi    size={10} /> },
  pppoe:   { label: "PPPoE",   color: "#a78bfa", bg: "rgba(139,92,246,0.12)", icon: <Network size={10} /> },
  static:  { label: "Static",  color: "#34d399", bg: "rgba(16,185,129,0.12)", icon: <Globe   size={10} /> },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  active:    { label: "Active",    color: "#4ade80", bg: "rgba(34,197,94,0.12)",    border: "rgba(34,197,94,0.3)",    icon: <CheckCircle2 size={10} /> },
  expired:   { label: "Expired",   color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)",   icon: <XCircle      size={10} /> },
  suspended: { label: "Suspended", color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)",    icon: <AlertTriangle size={10} /> },
  online:    { label: "Online",    color: "#22d3ee", bg: "rgba(6,182,212,0.12)",   border: "rgba(6,182,212,0.3)",     icon: <Wifi size={10} /> },
  offline:   { label: "Offline",   color: "#64748b", bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.25)",  icon: <Clock size={10} /> },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.62rem", fontWeight: 700, padding: "0.18rem 0.55rem",
      borderRadius: 4, background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      whiteSpace: "nowrap",
    }}>
      {m.icon} {m.label}
    </span>
  );
}

function TypeBadge({ type }: { type?: string | null }) {
  const m = TYPE_META[type ?? ""] ?? { label: type ?? "?", color: "#94a3b8", bg: "rgba(255,255,255,0.06)", icon: null };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.62rem", fontWeight: 700, padding: "0.18rem 0.5rem",
      borderRadius: 4, background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>
      {m.icon} {m.label}
    </span>
  );
}

function Avt({ name, id }: { name?: string | null; id: number }) {
  const COLORS = ["#06b6d4","#8b5cf6","#f59e0b","#10b981","#ec4899","#f87171","#60a5fa"];
  const bg = COLORS[id % COLORS.length];
  const ini = (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: 34, height: 34, borderRadius: "50%", background: bg, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.72rem", fontWeight: 800, color: "white",
    }}>{ini}</div>
  );
}

/* ══════════════════════════════ Fetch helpers ══════════════════════════════ */
async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Customer[];
}
async function fetchPlans(): Promise<Plan[]> {
  const { data } = await supabase
    .from("isp_plans")
    .select("id,name,type,price,speed_down,speed_up")
    .eq("admin_id", ADMIN_ID);
  return (data ?? []) as Plan[];
}
async function fetchRouters(): Promise<Router[]> {
  const { data } = await supabase
    .from("isp_routers")
    .select("id,name,host,status,router_username,router_secret,bridge_ip")
    .eq("admin_id", ADMIN_ID);
  return (data ?? []) as Router[];
}

/* ══════════════════════════════ Sync ══════════════════════════════ */
async function syncUsersToRouter(
  router: Router,
  users:  Customer[],
  plans:  Plan[],
  log:    (m: string) => void,
): Promise<boolean> {
  const host = router.host || router.bridge_ip || "";
  if (!host) { log(`  ⚠ ${router.name}: no IP address — skipped`); return false; }
  log(`\n▶ ${router.name} (${host})`);
  const planMap = Object.fromEntries(plans.map(p => [p.id, p]));
  const payload = {
    host,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    bridgeIp: router.bridge_ip || undefined,
    users: users.map(u => ({
      username:     u.pppoe_username || u.username || "",
      password:     u.password || "",
      type:         u.type || "hotspot",
      status:       u.status,
      macAddress:   u.mac_address || undefined,
      plan:         u.plan_id ? planMap[u.plan_id]?.name : undefined,
      speedDown:    u.plan_id ? planMap[u.plan_id]?.speed_down : undefined,
      speedUp:      u.plan_id ? planMap[u.plan_id]?.speed_up   : undefined,
      ipAddress:    u.ip_address || undefined,
    })),
  };
  try {
    const res  = await fetch(`${API}/api/admin/sync/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { ok: boolean; logs?: string[] };
    (data.logs ?? []).forEach((l: string) => log(l));
    return data.ok;
  } catch (e) {
    log(`  ✗ ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/* ══════════════════════════════ Page ══════════════════════════════ */
export default function PrepaidUsers() {
  const qc = useQueryClient();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["prepaid_customers", ADMIN_ID],
    queryFn:  fetchCustomers,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const { data: plans   = [] } = useQuery<Plan[]>({
    queryKey: ["prepaid_plans", ADMIN_ID],
    queryFn:  fetchPlans,
    staleTime: 60_000,
  });
  const { data: routers = [] } = useQuery<Router[]>({
    queryKey: ["prepaid_routers", ADMIN_ID],
    queryFn:  fetchRouters,
    staleTime: 30_000,
  });

  const planMap   = useMemo(() => Object.fromEntries(plans.map(p   => [p.id,   p  ])), [plans]);
  const routerMap = useMemo(() => Object.fromEntries(routers.map(r => [r.id,   r  ])), [routers]);

  /* ── UI state ── */
  const [search,      setSearch]      = useState("");
  const [statusTab,   setStatusTab]   = useState<StatusFilter>("all");
  const [typeFilter,  setTypeFilter]  = useState("");
  const [page,        setPage]        = useState(1);
  const [detailUser,  setDetailUser]  = useState<Customer | null>(null);

  /* Sync state */
  const [showSyncPicker,  setShowSyncPicker]  = useState(false);
  const [pickedRouter,    setPickedRouter]     = useState("");
  const [syncing,         setSyncing]         = useState(false);
  const [syncLogs,        setSyncLogs]        = useState<string[] | null>(null);
  const [syncOk,          setSyncOk]          = useState<boolean | null>(null);

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:     customers.length,
    active:    customers.filter(c => c.status === "active").length,
    expired:   customers.filter(c => c.status === "expired").length,
    suspended: customers.filter(c => c.status === "suspended").length,
  }), [customers]);

  /* ── Filter ── */
  const filtered = useMemo(() => {
    let list = customers;
    if (statusTab !== "all") list = list.filter(c => c.status === statusTab);
    if (typeFilter)          list = list.filter(c => c.type  === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.name   ?? "").toLowerCase().includes(q) ||
        (c.username ?? "").toLowerCase().includes(q) ||
        (c.pppoe_username ?? "").toLowerCase().includes(q) ||
        (c.phone  ?? "").includes(q) ||
        (c.email  ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [customers, statusTab, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ── Sync handler ── */
  async function handleSync() {
    if (!pickedRouter) return;
    const router = routers.find(r => String(r.id) === pickedRouter);
    if (!router) return;
    setSyncing(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Starting user sync…");
    const ok = await syncUsersToRouter(router, customers.filter(c => (c as any).router_id === router.id || true), plans, log);
    log(ok ? "\n✅ Sync complete." : "\n⚠ Sync finished with errors.");
    setSyncOk(ok);
    setSyncing(false);
    setShowSyncPicker(false);
  }

  /* ── Export CSV ── */
  function exportCSV() {
    const header = "Name,Username,Phone,Type,Plan,Status,Expires";
    const rows   = filtered.map(c => [
      c.name ?? "", c.username ?? c.pppoe_username ?? "", c.phone ?? "",
      c.type ?? "", c.plan_id ? (planMap[c.plan_id]?.name ?? "") : "",
      c.status, c.expires_at ? fmtDate(c.expires_at) : "",
    ].map(v => `"${v}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = "prepaid_users.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Styles ── */
  const BTN = (bg: string, color = "#fff"): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    padding: "0.42rem 1rem", borderRadius: 6, border: "none",
    background: bg, color, fontWeight: 700, fontSize: "0.8rem",
    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  });
  const INPUT: React.CSSProperties = {
    background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
    border: "1px solid var(--isp-border)", borderRadius: 6,
    padding: "0.42rem 0.75rem", color: "var(--isp-text)",
    fontSize: "0.82rem", fontFamily: "inherit", outline: "none",
  };
  const TH: React.CSSProperties = {
    padding: "0.55rem 0.875rem", fontSize: "0.68rem", fontWeight: 800,
    color: "var(--isp-text-muted)", textTransform: "uppercase",
    letterSpacing: "0.06em", textAlign: "left",
    background: "rgba(255,255,255,0.025)",
    borderBottom: "1px solid var(--isp-border)",
  };
  const TD: React.CSSProperties = {
    padding: "0.7rem 0.875rem", fontSize: "0.8rem",
    color: "var(--isp-text)", borderBottom: "1px solid rgba(255,255,255,0.03)",
    verticalAlign: "middle",
  };

  const TABS: { key: StatusFilter; label: string; count: number; color: string }[] = [
    { key: "all",       label: "All",       count: stats.total,     color: "#94a3b8" },
    { key: "active",    label: "Active",    count: stats.active,    color: "#4ade80" },
    { key: "expired",   label: "Expired",   count: stats.expired,   color: "#f87171" },
    { key: "suspended", label: "Suspended", count: stats.suspended, color: "#fbbf24" },
  ];

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1200 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--isp-text)", margin: "0 0 0.1rem" }}>
              Prepaid Users
            </h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: 0 }}>
              All WiFi subscribers — hotspot, PPPoE & static
            </p>
          </div>

          {/* Sync by Router */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSyncPicker(v => !v)} disabled={syncing}
              style={BTN("linear-gradient(135deg,#3b82f6,#2563eb)")}>
              {syncing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <UploadCloud size={13} />}
              Sync by Router <ChevronDown size={11} />
            </button>
            {showSyncPicker && (
              <div style={{
                position: "absolute", top: "110%", right: 0, zIndex: 50,
                background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                borderRadius: 10, padding: "0.875rem", minWidth: 240,
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.5rem" }}>
                  Select router
                </div>
                <select value={pickedRouter} onChange={e => setPickedRouter(e.target.value)}
                  style={{ ...INPUT, width: "100%", marginBottom: "0.5rem", cursor: "pointer" }}>
                  <option value="">— choose —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"}
                    </option>
                  ))}
                </select>
                <button onClick={handleSync} disabled={!pickedRouter || syncing}
                  style={{ ...BTN(pickedRouter ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.06)"), width: "100%", justifyContent: "center" }}>
                  {syncing ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={12} />}
                  Sync Users
                </button>
              </div>
            )}
          </div>

          <button onClick={exportCSV} style={BTN("linear-gradient(135deg,#22c55e,#16a34a)")}>
            <Download size={13} /> Export CSV
          </button>

          <button onClick={() => qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] })}
            style={BTN("rgba(255,255,255,0.06)", "var(--isp-text-muted)")}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "0.625rem" }}>
          {[
            { label: "Total Users",  value: stats.total,     color: "#06b6d4", icon: <Users      size={18} /> },
            { label: "Active",       value: stats.active,    color: "#4ade80", icon: <CheckCircle2 size={18} /> },
            { label: "Expired",      value: stats.expired,   color: "#f87171", icon: <XCircle     size={18} /> },
            { label: "Suspended",    value: stats.suspended, color: "#fbbf24", icon: <AlertTriangle size={18} /> },
          ].map(s => (
            <div key={s.label} style={{
              background: "var(--isp-card)", border: "1px solid var(--isp-border)",
              borderRadius: 10, padding: "0.875rem 1rem",
              display: "flex", alignItems: "center", gap: "0.75rem",
            }}>
              <div style={{ color: s.color, opacity: 0.85 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: "1.35rem", fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: "0.67rem", color: "var(--isp-text-muted)", fontWeight: 600, marginTop: "0.2rem" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Sync log ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(6,182,212,0.2)"}`,
            borderRadius: 10, padding: "0.75rem 1rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: syncOk === false ? "#f87171" : "#06b6d4" }}>
                Sync Log
              </span>
              <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.1rem", maxHeight: 160, overflowY: "auto" }}>
              {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </div>
        )}

        {/* ── Status tabs + filters ── */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Status tabs */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.25rem" }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => { setStatusTab(t.key); setPage(1); }}
                style={{
                  padding: "0.3rem 0.75rem", borderRadius: 6, border: "none", fontFamily: "inherit",
                  fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
                  background: statusTab === t.key ? "rgba(255,255,255,0.1)" : "transparent",
                  color: statusTab === t.key ? t.color : "var(--isp-text-muted)",
                  transition: "all 0.15s",
                }}>
                {t.label}
                <span style={{
                  marginLeft: "0.35rem", fontSize: "0.6rem", fontWeight: 700,
                  background: statusTab === t.key ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)",
                  padding: "0.1rem 0.4rem", borderRadius: 3,
                  color: statusTab === t.key ? t.color : "var(--isp-text-muted)",
                }}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div style={{ position: "relative" }}>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              style={{ ...INPUT, paddingRight: "1.75rem", cursor: "pointer", appearance: "none" }}>
              <option value="">All types</option>
              <option value="hotspot">Hotspot</option>
              <option value="pppoe">PPPoE</option>
              <option value="static">Static IP</option>
            </select>
            <Filter size={11} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
          </div>

          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, username, phone…"
              style={{ ...INPUT, paddingLeft: "2rem", width: "100%" }} />
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={TH}>User</th>
                <th style={TH}>Type</th>
                <th style={TH}>Plan</th>
                <th style={TH}>Router</th>
                <th style={TH}>Status</th>
                <th style={TH}>Expires</th>
                <th style={{ ...TH, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} style={{ ...TD, textAlign: "center", padding: "3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", color: "var(--isp-text-muted)" }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} /> Loading users…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...TD, textAlign: "center", padding: "3rem", color: "var(--isp-text-muted)" }}>
                    {search || typeFilter || statusTab !== "all"
                      ? "No users match this filter."
                      : "No prepaid users yet. Add customers from the Customers section."}
                  </td>
                </tr>
              ) : (
                pageRows.map(user => {
                  const plan   = user.plan_id ? planMap[user.plan_id] : null;
                  const router = (user as any).router_id ? routerMap[(user as any).router_id] : null;
                  const expiring = isExpiringSoon(user.expires_at);
                  const expired  = isExpired(user.expires_at);
                  const displayName = user.name || user.username || user.pppoe_username || `User #${user.id}`;
                  const displaySub  = user.pppoe_username || user.username || "";
                  return (
                    <tr key={user.id}
                      onMouseOver={e => (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.02)"}
                      onMouseOut={e  => (e.currentTarget as HTMLTableRowElement).style.background = "transparent"}
                      style={{ transition: "background 0.1s" }}
                    >
                      {/* User */}
                      <td style={TD}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                          <Avt name={user.name} id={user.id} />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--isp-text)" }}>{displayName}</div>
                            {displaySub && displaySub !== displayName && (
                              <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>{displaySub}</div>
                            )}
                            {user.phone && (
                              <div style={{ fontSize: "0.66rem", color: "#64748b" }}>{user.phone}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td style={TD}><TypeBadge type={user.type} /></td>

                      {/* Plan */}
                      <td style={TD}>
                        {plan ? (
                          <div>
                            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--isp-text)" }}>{plan.name}</div>
                            <div style={{ fontSize: "0.65rem", color: "#06b6d4", fontFamily: "monospace" }}>
                              {plan.speed_down}/{plan.speed_up} Mbps
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontStyle: "italic" }}>no plan</span>
                        )}
                      </td>

                      {/* Router */}
                      <td style={TD}>
                        {router ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "0.3rem",
                            fontSize: "0.72rem", fontWeight: 700,
                            background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.18)",
                            color: "#06b6d4", borderRadius: 5, padding: "0.18rem 0.5rem",
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: router.status === "online" ? "#22c55e" : "#475569" }} />
                            {router.name}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontStyle: "italic" }}>—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={TD}>
                        <StatusBadge status={user.status} />
                        {user.mac_address && (
                          <div style={{ fontSize: "0.62rem", fontFamily: "monospace", color: "#475569", marginTop: "0.2rem" }}>
                            {user.mac_address}
                          </div>
                        )}
                      </td>

                      {/* Expires */}
                      <td style={TD}>
                        <span style={{
                          fontSize: "0.74rem", fontWeight: 600,
                          color: expiring ? "#fbbf24" : expired ? "#f87171" : "var(--isp-text-muted)",
                        }}>
                          {fmtDate(user.expires_at)}
                        </span>
                        {expiring && !expired && (
                          <div style={{ fontSize: "0.6rem", color: "#fbbf24", fontWeight: 700 }}>⚠ expiring soon</div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ ...TD, textAlign: "right" }}>
                        <button onClick={() => setDetailUser(user)}
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, padding: "0.28rem 0.6rem", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                          <Eye size={12} />
                        </button>
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                style={{
                  padding: "0.3rem 0.65rem", borderRadius: 5, border: "1px solid",
                  borderColor: p === page ? "transparent" : "var(--isp-border)",
                  background: p === page ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.04)",
                  color: p === page ? "white" : "var(--isp-text-muted)",
                  fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit",
                }}>
                {p}
              </button>
            ))}
            <span style={{ fontSize: "0.69rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              {filtered.length} user{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ════════════════ Detail Modal ════════════════ */}
      {detailUser && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setDetailUser(null); }}
        >
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 500, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem", marginBottom: "1.25rem" }}>
              <Avt name={detailUser.name} id={detailUser.id} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                  {detailUser.name || detailUser.username || `User #${detailUser.id}`}
                </div>
                <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  <TypeBadge type={detailUser.type} />
                  <StatusBadge status={detailUser.status} />
                </div>
              </div>
              <button onClick={() => setDetailUser(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[
                { icon: <Users size={13} />,       label: "Username",   value: detailUser.pppoe_username || detailUser.username || "—" },
                { icon: <Phone size={13} />,       label: "Phone",      value: detailUser.phone || "—" },
                { icon: <Mail  size={13} />,       label: "Email",      value: detailUser.email || "—" },
                { icon: <Server size={13} />,      label: "IP Address", value: detailUser.ip_address || "—" },
                { icon: <Wifi  size={13} />,       label: "MAC",        value: detailUser.mac_address || "—" },
                { icon: <CalendarDays size={13} />,label: "Expires",    value: fmtDate(detailUser.expires_at) },
                { icon: <CalendarDays size={13} />,label: "Created",    value: fmtDate(detailUser.created_at) },
                { icon: <Network size={13} />,     label: "Data Used",  value: `${(detailUser.data_used_mb ?? 0).toFixed(1)} MB` },
              ].map(row => (
                <div key={row.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.625rem 0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
                    {row.icon} {row.label}
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--isp-text)", fontFamily: ["IP Address","MAC"].includes(row.label) ? "monospace" : "inherit" }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            {detailUser.plan_id && planMap[detailUser.plan_id] && (
              <div style={{ marginTop: "0.75rem", background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, padding: "0.625rem 0.75rem" }}>
                <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>Plan</div>
                <div style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.85rem" }}>
                  {planMap[detailUser.plan_id].name}
                  <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#06b6d4", marginLeft: "0.5rem" }}>
                    {planMap[detailUser.plan_id].speed_down}/{planMap[detailUser.plan_id].speed_up} Mbps
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
