import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Link } from "wouter";
import { supabase, ADMIN_ID, type DbRouter, type DbTransaction, getPaymentGateway, GATEWAY_OPTIONS } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

/* ─── Router online check — trusts the status field written by the backend.
 * No time-window check: the sweep/ping endpoints are the source of truth. ─── */
function routerOnline(r: DbRouter): boolean {
  return r.status === "online" || r.status === "connected";
}

/* ─── Format last_seen timestamp in local time ─── */
function fmtSince(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ─── Supabase fetchers ─── */
async function fetchRouters(): Promise<DbRouter[]> {
  const { data, error } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

type CustomerBasic = { id: number; type: string | null; status: string; created_at: string };

async function fetchCustomersBasic(): Promise<CustomerBasic[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("id, type, status, created_at")
    .eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactions(customerIds: number[]): Promise<DbTransaction[]> {
  if (customerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("*")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const KPI_ROW2 = [
  {
    label: "Online Now", value: "0",
    link: "View All", href: "/admin/customers",
    gradient: "linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)",
    icon: <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><circle cx="32" cy="32" r="10"/><path d="M12 32a20 20 0 1 0 40 0A20 20 0 0 0 12 32" fillOpacity="0" stroke="white" strokeWidth="4"/></svg>,
  },
  {
    label: "Vouchers Left", value: "0",
    link: "View All", href: "/admin/vouchers",
    gradient: "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)",
    icon: <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><rect x="4" y="20" width="56" height="24" rx="4"/><circle cx="20" cy="32" r="4" fill="#ffffff66"/><rect x="28" y="28" width="24" height="4" rx="2" fill="#ffffff66"/></svg>,
  },
  {
    label: "Support Tickets", value: "0",
    link: "View All", href: "/admin/support",
    gradient: "linear-gradient(135deg,#f093fb 0%,#f5576c 100%)",
    icon: <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><path d="M8 8h48a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H16L4 60V12a4 4 0 0 1 4-4z"/></svg>,
  },
  {
    label: "Routers Online", value: "0",
    link: "View All", href: "/admin/network",
    gradient: "linear-gradient(135deg,#43e97b 0%,#52d9c4 100%)",
    icon: <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><rect x="8" y="24" width="48" height="16" rx="4"/><circle cx="16" cy="32" r="3" fill="#ffffff88"/><circle cx="26" cy="32" r="3" fill="#ffffff88"/><line x1="44" y1="24" x2="44" y2="12" stroke="white" strokeWidth="3"/><line x1="52" y1="24" x2="52" y2="12" stroke="white" strokeWidth="3"/></svg>,
  },
];

/* ─── Helper components ─── */
function KpiCard({ label, value, link, href, gradient, icon }: { label: string; value: string; link: string; href: string; gradient: string; icon: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 10, background: gradient, padding: "1.125rem 1.25rem 0", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 130 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "1.625rem", fontWeight: 800, color: "white", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)", fontWeight: 600, marginTop: "0.25rem" }}>{label}</div>
        </div>
        <div style={{ position: "absolute", right: "0.75rem", top: "0.5rem" }}>{icon}</div>
      </div>
      <Link href={href}>
        <div style={{ marginLeft: "-1.25rem", marginRight: "-1.25rem", padding: "0.5rem 1.25rem", background: "rgba(0,0,0,0.18)", fontSize: "0.75rem", fontWeight: 600, color: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "1rem" }}>
          {link} <span style={{ marginLeft: "auto" }}>→</span>
        </div>
      </Link>
    </div>
  );
}

function OnlineStatCard({ label, value, gradient, href }: { label: string; value: string; gradient: string; href: string }) {
  return (
    <div style={{ borderRadius: 10, background: gradient, padding: "1rem 1.25rem 0", display: "flex", flexDirection: "column", minHeight: 110, overflow: "hidden" }}>
      <div style={{ fontSize: "1.875rem", fontWeight: 800, color: "white", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: "0.775rem", color: "rgba(255,255,255,0.85)", fontWeight: 600, marginTop: "0.2rem" }}>{label}</div>
      <Link href={href}>
        <div style={{ marginLeft: "-1.25rem", marginRight: "-1.25rem", padding: "0.45rem 1.25rem", background: "rgba(0,0,0,0.18)", fontSize: "0.72rem", fontWeight: 600, color: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", marginTop: "0.875rem" }}>
          View All <span style={{ marginLeft: "auto" }}>→</span>
        </div>
      </Link>
    </div>
  );
}

function DonutChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((a, b) => a + b.count, 0);
  const cx = 80, cy = 80, r = 56;
  const circumference = 2 * Math.PI * r;
  if (total === 0) {
    return (
      <svg viewBox="0 0 160 160" width={160} height={160} style={{ display: "block" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={22} />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="18" fontWeight="800">0</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">Total Users</text>
      </svg>
    );
  }
  let offset = 0;
  const segments = insights.map(s => {
    const pct = s.count / total;
    const dash = pct * circumference;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });
  return (
    <svg viewBox="0 0 160 160" width={160} height={160} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={22} />
      {segments.map(seg => (
        <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={22}
          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
          strokeDashoffset={-seg.offset + circumference * 0.25}
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }} />
      ))}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="18" fontWeight="800">{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">Total Users</text>
    </svg>
  );
}

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `Ksh. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Ksh. ${n.toLocaleString()}`;
  return `Ksh. ${n}`;
}

/* ─── Main Dashboard ─── */
export default function Dashboard() {
  const [chartCollapsed,  setChartCollapsed]  = useState(false);
  const [chartMinimized,  setChartMinimized]  = useState(false);
  const [selectedRouter,  setSelectedRouter]  = useState<number | "all">("all");

  const gatewayId   = getPaymentGateway();
  const gatewayInfo = GATEWAY_OPTIONS.find(g => g.id === gatewayId) ?? GATEWAY_OPTIONS[0];

  const { data: routers = [], isLoading: routersLoading } = useQuery({
    queryKey: ["isp_routers", ADMIN_ID],
    queryFn: fetchRouters,
    refetchInterval: 10_000,
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["isp_customers_basic", ADMIN_ID],
    queryFn: fetchCustomersBasic,
    refetchInterval: 60_000,
  });

  const customerIds = useMemo(() => customers.map(c => c.id), [customers]);

  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["isp_transactions_dashboard", customerIds.join(",")],
    queryFn: () => fetchTransactions(customerIds),
    enabled: !customersLoading,
    refetchInterval: 60_000,
  });

  /* ─── Derived stats ─── */
  const now = new Date();
  const incomeToday = useMemo(() =>
    transactions.filter(t => t.status === "completed" && new Date(t.created_at).toDateString() === now.toDateString())
      .reduce((s, t) => s + t.amount, 0), [transactions]);

  const incomeMonth = useMemo(() =>
    transactions.filter(t => {
      const d = new Date(t.created_at);
      return t.status === "completed" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, t) => s + t.amount, 0), [transactions]);

  const onlineRouters  = routers.filter(routerOnline).length;
  const offlineRouters = routers.length - onlineRouters;

  /* ─── Real monthly customer signups (current year) ─── */
  const monthlyData = useMemo(() => {
    const year = now.getFullYear();
    return MONTHS.map((month, i) => ({
      month,
      count: customers.filter(c => {
        const d = new Date(c.created_at);
        return d.getFullYear() === year && d.getMonth() === i;
      }).length,
    }));
  }, [customers]);

  const maxCount = Math.max(...monthlyData.map(d => d.count), 1);

  /* ─── Real user type breakdown ─── */
  const userInsights = useMemo(() => [
    { label: "Hotspot", count: customers.filter(c => c.type === "hotspot").length, color: "#06b6d4" },
    { label: "PPPoE",   count: customers.filter(c => c.type === "pppoe").length,   color: "#8b5cf6" },
    { label: "Static",  count: customers.filter(c => c.type === "static").length,  color: "#10b981" },
  ], [customers]);

  /* ─── Router filter options ─── */
  const routerOptions: { key: number | "all"; label: string; online: boolean | null }[] = [
    { key: "all", label: "All Routers", online: null },
    ...routers.map(r => ({ key: r.id, label: r.name, online: routerOnline(r) })),
  ];

  const selectedRouterObj = selectedRouter === "all" ? null : routers.find(r => r.id === selectedRouter);

  /* ─── Recent 5 transactions ─── */
  const recentTxs = transactions.slice(0, 5);

  const kpiRow2WithLive = KPI_ROW2.map(k => {
    if (k.label === "Routers Online") return { ...k, value: routersLoading ? "0" : String(onlineRouters) };
    return k;
  });

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Dashboard</h1>

        {/* Online User Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <OnlineStatCard label="Hotspot Online Users" value="0" gradient="linear-gradient(135deg,#00b4d8 0%,#0077b6 100%)" href="/admin/customers?status=online&type=hotspot" />
          <OnlineStatCard label="PPPoE Online Users"   value="0" gradient="linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)" href="/admin/customers?status=online&type=pppoe" />
          <OnlineStatCard label="Static Online Users"  value="0" gradient="linear-gradient(135deg,#0d9488 0%,#2dd4bf 100%)" href="/admin/customers?status=online&type=static" />
          <OnlineStatCard label="Total Online Users"   value="0" gradient="linear-gradient(135deg,#d97706 0%,#f59e0b 100%)" href="/admin/customers?status=online" />
        </div>

        {/* Payment Gateway Status Bar */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0, boxShadow: "0 0 6px #22c55e" }} />
          <span style={{ fontSize: "1rem" }}>{gatewayInfo.emoji}</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem" }}>{gatewayInfo.label}</span>
          <span style={{ fontSize: "0.75rem", padding: "0.15rem 0.6rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>Active</span>
          <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>Payment gateway configured</span>
          <Link href="/admin/settings" style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--isp-text-muted)", textDecoration: "none" }}>Change →</Link>
        </div>

        {/* Router Status */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="none" stroke="#60a5fa" strokeWidth="2">
                <rect x="2" y="8" width="20" height="8" rx="2"/><line x1="6" y1="12" x2="6" y2="12" strokeWidth="3" strokeLinecap="round"/>
                <line x1="10" y1="12" x2="10" y2="12" strokeWidth="3" strokeLinecap="round"/>
                <line x1="18" y1="8" x2="18" y2="4"/><line x1="20" y1="8" x2="20" y2="4"/>
              </svg>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Router Status</span>
            </div>
            {!routersLoading && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.72rem", padding: "0.2rem 0.65rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>{onlineRouters} Online</span>
                <span style={{ fontSize: "0.72rem", padding: "0.2rem 0.65rem", borderRadius: 20, background: "rgba(248,113,113,0.15)", color: "#f87171", fontWeight: 700 }}>{offlineRouters} Offline</span>
              </div>
            )}
          </div>
          <div style={{ padding: "1rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {routersLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text-muted)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading routers…
              </div>
            ) : routers.length === 0 ? (
              <div style={{ color: "var(--isp-text-muted)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
                No routers registered yet. <Link href="/admin/network"><span style={{ color: "#06b6d4", cursor: "pointer" }}>Add one →</span></Link>
              </div>
            ) : routers.map(router => {
              const isOnline = routerOnline(router);
              return (
                <div key={router.id} style={{ background: "var(--isp-inner-card)", border: `1px solid ${isOnline ? "rgba(34,197,94,0.18)" : "rgba(100,116,139,0.2)"}`, borderRadius: 8, padding: "0.75rem 1rem", minWidth: 185 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{router.name}</span>
                    {isOnline
                      ? <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#22c55e" }}>Online</span>
                      : <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>
                          {router.last_seen ? `Since ${fmtSince(router.last_seen)}` : "Offline"}
                        </span>
                    }
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginBottom: "0.25rem", fontFamily: "monospace" }}>{router.host}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>{router.model ?? "MikroTik"} {router.ros_version ? `· ROS v${router.ros_version}` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Router Filter */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginRight: "0.5rem" }}>
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} fill="none" stroke="#60a5fa" strokeWidth="2">
              <rect x="2" y="8" width="20" height="8" rx="2"/><line x1="6" y1="12" x2="6" y2="12" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Filter by Router:</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {routerOptions.map(opt => {
              const active = selectedRouter === opt.key;
              return (
                <button key={String(opt.key)} onClick={() => setSelectedRouter(opt.key)}
                  style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.35rem 0.875rem", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", border: active ? "1.5px solid #06b6d4" : "1.5px solid rgba(255,255,255,0.1)", background: active ? "rgba(6,182,212,0.15)" : "rgba(255,255,255,0.04)", color: active ? "#22d3ee" : "#7c8ea6" }}>
                  {opt.online !== null && <span style={{ width: 7, height: 7, borderRadius: "50%", background: opt.online ? "#22c55e" : "#f87171", display: "inline-block", flexShrink: 0 }} />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {selectedRouter !== "all" && selectedRouterObj && (
            <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#22d3ee" }}>
              Showing: <strong>{selectedRouterObj.name}</strong> ({selectedRouterObj.status})
              <button onClick={() => setSelectedRouter("all")} style={{ marginLeft: "0.5rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}>(clear)</button>
            </div>
          )}
        </div>

        {/* KPI Row 1 — income from real transactions */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <KpiCard label="Income Today" value={txLoading ? "…" : fmtKsh(incomeToday)} link="View Reports" href="/admin/transactions"
            gradient="linear-gradient(135deg,#0fb8ad 0%,#1fc8db 51%,#2cb5e8 75%)"
            icon={<svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><rect x="18" y="36" width="8" height="12" rx="1"/><rect x="28" y="28" width="8" height="20" rx="1"/><rect x="38" y="20" width="8" height="28" rx="1"/></svg>} />
          <KpiCard label="Income This Month" value={txLoading ? "…" : fmtKsh(incomeMonth)} link="View Reports" href="/admin/transactions"
            gradient="linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)"
            icon={<svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white"><rect x="8" y="40" width="10" height="16" rx="2"/><rect x="22" y="28" width="10" height="28" rx="2"/><rect x="36" y="20" width="10" height="36" rx="2"/><rect x="50" y="12" width="10" height="44" rx="2"/></svg>} />
          <KpiCard label="Total Transactions" value={txLoading ? "…" : String(transactions.length)} link="View All" href="/admin/transactions"
            gradient="linear-gradient(135deg,#f7971e 0%,#ffd200 100%)"
            icon={<svg viewBox="0 0 64 64" style={{ width: 72, height: 72, opacity: 0.25 }} fill="white"><circle cx="32" cy="20" r="12"/><path d="M8 56c0-13.3 10.7-24 24-24s24 10.7 24 24H8z"/></svg>} />
          <KpiCard label="Total Revenue" value={txLoading ? "…" : fmtKsh(transactions.filter(t => t.status === "completed").reduce((s, t) => s + t.amount, 0))} link="View All" href="/admin/transactions"
            gradient="linear-gradient(135deg,#f953c6 0%,#b91d73 100%)"
            icon={<svg viewBox="0 0 80 64" style={{ width: 80, height: 64, opacity: 0.25 }} fill="white"><circle cx="28" cy="20" r="10"/><path d="M4 52c0-11 10.7-20 24-20s24 9 24 20H4z"/><circle cx="56" cy="22" r="8" opacity="0.7"/></svg>} />
        </div>

        {/* KPI Row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {kpiRow2WithLive.map(k => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* Charts + Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* Monthly bar chart */}
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: chartMinimized ? "none" : "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)" }}>Monthly Registered Customers</span>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button onClick={() => setChartCollapsed(c => !c)} style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8", cursor: "pointer", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
                  {chartCollapsed ? "+" : "−"}
                </button>
                <button onClick={() => setChartMinimized(m => !m)} style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>×</button>
              </div>
            </div>
            {!chartMinimized && !chartCollapsed && (
              <div style={{ padding: "1rem 1.25rem" }}>
                <svg viewBox={`0 0 ${monthlyData.length * 36} 140`} width="100%" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#0284c7" stopOpacity="0.6" />
                    </linearGradient>
                  </defs>
                  {monthlyData.map((d, i) => {
                    const barH = Math.round((d.count / maxCount) * 100);
                    const x = i * 36 + 6;
                    const barTop = 100 - barH;
                    return (
                      <g key={d.month}>
                        <rect x={x} y={barTop} width={22} height={barH} rx={3} fill="url(#barGrad)" />
                        <text x={x + 11} y={barTop - 4} textAnchor="middle" fill="#94a3b8" fontSize="7.5">{d.count}</text>
                        <text x={x + 11} y={118} textAnchor="middle" fill="#64748b" fontSize="7.5">{d.month}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>

          {/* Right: Payment Gateway + User Insights */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.75rem" }}>Payment Gateway</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.65rem 0.875rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border-subtle)" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg,${gatewayInfo.color},${gatewayInfo.color}99)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "1.2rem" }}>
                  {gatewayInfo.emoji}
                </div>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>{gatewayInfo.label}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)", marginTop: "0.1rem" }}>Active payment gateway</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: "0.65rem", padding: "0.2rem 0.55rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>Active</span>
              </div>
            </div>
            <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.875rem" }}>All Users Insights</div>
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                <DonutChart insights={userInsights} />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", flex: 1 }}>
                  {userInsights.map(seg => {
                    const total = userInsights.reduce((a, b) => a + b.count, 0);
                    return (
                      <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: "0.775rem", color: "var(--isp-text-muted)", flex: 1 }}>{seg.label}</span>
                        <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "var(--isp-text)" }}>{seg.count}</span>
                        <span style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>({total > 0 ? Math.round(seg.count / total * 100) : 0}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div style={{ borderRadius: 10, background: "var(--isp-table-bg)", border: "1px solid var(--isp-border-subtle)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Recent Transactions</span>
            <Link href="/admin/transactions">
              <span style={{ fontSize: "0.75rem", color: "#06b6d4", cursor: "pointer", fontWeight: 600 }}>View All →</span>
            </Link>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                  {["ID", "Reference", "Amount", "Method", "Status", "Date"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.625rem 1.25rem", color: "#475569", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading…
                      </div>
                    </td>
                  </tr>
                ) : recentTxs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>No transactions yet.</td>
                  </tr>
                ) : recentTxs.map(tx => (
                  <tr key={tx.id} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>#{tx.id}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{tx.reference || "—"}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "#4ade80", fontWeight: 700 }}>Ksh {tx.amount.toLocaleString()}</td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span style={{ fontSize: "0.6875rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: tx.payment_method === "mpesa" ? "rgba(6,182,212,0.1)" : "rgba(251,191,36,0.1)", color: tx.payment_method === "mpesa" ? "#22d3ee" : "#fbbf24", fontWeight: 700 }}>
                        {tx.payment_method.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span style={{ fontSize: "0.6875rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: tx.status === "completed" ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)", color: tx.status === "completed" ? "#4ade80" : "#fbbf24", fontWeight: 600 }}>
                        {tx.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                      {new Date(tx.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
