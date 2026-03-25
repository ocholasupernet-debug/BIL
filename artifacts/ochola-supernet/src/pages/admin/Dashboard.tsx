import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Link } from "wouter";

/* ─── Router Status Data ─── */
const ROUTER_STATUS = [
  { name: "latty1", online: true, uptime: "Up: 2d9h30m51s", model: "L009UiGS-2HaxD" },
  { name: "latty2", online: true, uptime: "Up: 1d4h12m08s", model: "hAP lite" },
  { name: "latty3", online: false, uptime: "Offline", model: "RB750Gr3" },
];

/* ─── Per-Router Income & Stats ─── */
type RouterKey = "all" | "latty1" | "latty2" | "latty3";

const ROUTER_INCOME: Record<RouterKey, {
  incomeToday: string;
  incomeMonth: string;
  active: number;
  expired: number;
  total: number;
  online: number;
  hotspotOnline: number;
  pppoeOnline: number;
  staticOnline: number;
}> = {
  all: {
    incomeToday: "Ksh. 4",
    incomeMonth: "Ksh. 20,988",
    active: 16,
    expired: 651,
    total: 812,
    online: 10,
    hotspotOnline: 7,
    pppoeOnline: 2,
    staticOnline: 1,
  },
  latty1: {
    incomeToday: "Ksh. 4",
    incomeMonth: "Ksh. 12,500",
    active: 14,
    expired: 487,
    total: 501,
    online: 7,
    hotspotOnline: 6,
    pppoeOnline: 1,
    staticOnline: 0,
  },
  latty2: {
    incomeToday: "Ksh. 0",
    incomeMonth: "Ksh. 8,488",
    active: 2,
    expired: 164,
    total: 166,
    online: 3,
    hotspotOnline: 1,
    pppoeOnline: 1,
    staticOnline: 1,
  },
  latty3: {
    incomeToday: "Ksh. 0",
    incomeMonth: "Ksh. 0",
    active: 0,
    expired: 0,
    total: 0,
    online: 0,
    hotspotOnline: 0,
    pppoeOnline: 0,
    staticOnline: 0,
  },
};

const ROUTER_ONLINE_COUNT = ROUTER_STATUS.filter(r => r.online).length;
const ROUTER_OFFLINE_COUNT = ROUTER_STATUS.filter(r => !r.online).length;


/* ─── KPI Row 2 ─── */
const KPI_ROW2 = [
  {
    label: "Online Now",
    value: "10",
    link: "View All",
    href: "/admin/customers",
    gradient: "linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <circle cx="32" cy="32" r="10"/>
        <path d="M12 32a20 20 0 1 0 40 0A20 20 0 0 0 12 32" fillOpacity="0" stroke="white" strokeWidth="4"/>
        <path d="M4 32a28 28 0 1 0 56 0A28 28 0 0 0 4 32" fillOpacity="0" stroke="white" strokeWidth="4" strokeOpacity="0.5"/>
      </svg>
    ),
  },
  {
    label: "Vouchers Left",
    value: "1",
    link: "View All",
    href: "/admin/vouchers",
    gradient: "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <rect x="4" y="20" width="56" height="24" rx="4"/>
        <circle cx="20" cy="32" r="4" fill="#ffffff66"/>
        <rect x="28" y="28" width="24" height="4" rx="2" fill="#ffffff66"/>
        <rect x="28" y="34" width="16" height="3" rx="1.5" fill="#ffffff44"/>
      </svg>
    ),
  },
  {
    label: "Support Tickets",
    value: "0",
    link: "View All",
    href: "/admin/support",
    gradient: "linear-gradient(135deg,#f093fb 0%,#f5576c 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <path d="M8 8h48a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H16L4 60V12a4 4 0 0 1 4-4z"/>
      </svg>
    ),
  },
  {
    label: "Routers Online",
    value: "11",
    link: "View All",
    href: "/admin/network",
    gradient: "linear-gradient(135deg,#43e97b 0%,#52d9c4 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <rect x="8" y="24" width="48" height="16" rx="4"/>
        <circle cx="16" cy="32" r="3" fill="#ffffff88"/>
        <circle cx="26" cy="32" r="3" fill="#ffffff88"/>
        <line x1="44" y1="24" x2="44" y2="12" stroke="white" strokeWidth="3"/>
        <line x1="52" y1="24" x2="52" y2="12" stroke="white" strokeWidth="3"/>
      </svg>
    ),
  },
];


/* ─── Monthly Registered Customers ─── */
const MONTHLY_DATA = [
  { month: "Jan", count: 12 },
  { month: "Feb", count: 18 },
  { month: "Mar", count: 9 },
  { month: "Apr", count: 24 },
  { month: "May", count: 31 },
  { month: "Jun", count: 20 },
  { month: "Jul", count: 15 },
  { month: "Aug", count: 28 },
  { month: "Sep", count: 22 },
  { month: "Oct", count: 35 },
  { month: "Nov", count: 19 },
  { month: "Dec", count: 27 },
];

/* ─── All Users Insights ─── */
const USER_INSIGHTS = [
  { label: "Hotspot", count: 521, color: "#06b6d4" },
  { label: "PPPoE", count: 214, color: "#8b5cf6" },
  { label: "Static", count: 77, color: "#10b981" },
];
const INSIGHTS_TOTAL = USER_INSIGHTS.reduce((a, b) => a + b.count, 0);

/* ─── Recent Transactions ─── */
const RECENT_TXS = [
  { name: "John Kamau",    plan: "Hotspot 10Mbps", amount: 500,  method: "MPESA", status: "completed" },
  { name: "Mary Wanjiku",  plan: "PPPoE 20Mbps",   amount: 1200, method: "MPESA", status: "completed" },
  { name: "Peter Otieno",  plan: "Hotspot 5Mbps",  amount: 300,  method: "MPESA", status: "pending"   },
  { name: "Grace Muthoni", plan: "PPPoE 10Mbps",   amount: 800,  method: "CASH",  status: "completed" },
  { name: "David Njoroge", plan: "Hotspot 10Mbps", amount: 500,  method: "MPESA", status: "completed" },
];

/* ─── Helpers ─── */
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
        <div style={{
          marginLeft: "-1.25rem",
          marginRight: "-1.25rem",
          padding: "0.5rem 1.25rem",
          background: "rgba(0,0,0,0.18)",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "rgba(255,255,255,0.9)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          marginTop: "1rem",
        }}>
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
        <div style={{
          marginLeft: "-1.25rem",
          marginRight: "-1.25rem",
          padding: "0.45rem 1.25rem",
          background: "rgba(0,0,0,0.18)",
          fontSize: "0.72rem",
          fontWeight: 600,
          color: "rgba(255,255,255,0.9)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          marginTop: "0.875rem",
        }}>
          View All <span style={{ marginLeft: "auto" }}>→</span>
        </div>
      </Link>
    </div>
  );
}

function DonutChart() {
  const cx = 80, cy = 80, r = 56;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = USER_INSIGHTS.map(s => {
    const pct = s.count / INSIGHTS_TOTAL;
    const dash = pct * circumference;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });

  return (
    <svg viewBox="0 0 160 160" width={160} height={160} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={22} />
      {segments.map((seg) => (
        <circle
          key={seg.label}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={seg.color}
          strokeWidth={22}
          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
          strokeDashoffset={-seg.offset + circumference * 0.25}
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="18" fontWeight="800">{INSIGHTS_TOTAL}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">Total Users</text>
    </svg>
  );
}

export default function Dashboard() {
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartMinimized, setChartMinimized] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState<RouterKey>("all");

  const stats = ROUTER_INCOME[selectedRouter];
  const maxCount = Math.max(...MONTHLY_DATA.map(d => d.count));

  const routerOptions: { key: RouterKey; label: string; online: boolean | null }[] = [
    { key: "all", label: "All Routers", online: null },
    ...ROUTER_STATUS.map(r => ({ key: r.name as RouterKey, label: r.name, online: r.online })),
  ];

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Page heading */}
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Dashboard</h1>

        {/* Online User Stat Cards — dynamic per router */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <OnlineStatCard label="Hotspot Online Users" value={String(stats.hotspotOnline)} gradient="linear-gradient(135deg,#00b4d8 0%,#0077b6 100%)" href="/admin/customers?status=online&type=hotspot" />
          <OnlineStatCard label="PPPoE Online Users"   value={String(stats.pppoeOnline)}   gradient="linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)" href="/admin/customers?status=online&type=pppoe" />
          <OnlineStatCard label="Static Online Users"  value={String(stats.staticOnline)}  gradient="linear-gradient(135deg,#0d9488 0%,#2dd4bf 100%)" href="/admin/customers?status=online&type=static" />
          <OnlineStatCard label="Total Online Users"   value={String(stats.online)}        gradient="linear-gradient(135deg,#d97706 0%,#f59e0b 100%)" href="/admin/customers?status=online" />
        </div>

        {/* M-Pesa STK Push Status Bar */}
        <div style={{
          borderRadius: 10,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", background: "#22c55e",
            display: "inline-block", flexShrink: 0,
            boxShadow: "0 0 6px #22c55e",
          }} />
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem" }}>M-Pesa STK Push Service</span>
          <span style={{ fontSize: "0.75rem", padding: "0.15rem 0.6rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>Live</span>
          <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>Safaricom is working</span>
        </div>

        {/* Router Status */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="none" stroke="#60a5fa" strokeWidth="2">
                <rect x="2" y="8" width="20" height="8" rx="2"/>
                <line x1="6" y1="12" x2="6" y2="12" strokeWidth="3" strokeLinecap="round"/>
                <line x1="10" y1="12" x2="10" y2="12" strokeWidth="3" strokeLinecap="round"/>
                <line x1="18" y1="8" x2="18" y2="4"/>
                <line x1="20" y1="8" x2="20" y2="4"/>
              </svg>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Router Status</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.72rem", padding: "0.2rem 0.65rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>
                {ROUTER_ONLINE_COUNT} Online
              </span>
              <span style={{ fontSize: "0.72rem", padding: "0.2rem 0.65rem", borderRadius: 20, background: "rgba(248,113,113,0.15)", color: "#f87171", fontWeight: 700 }}>
                {ROUTER_OFFLINE_COUNT} Offline
              </span>
            </div>
          </div>
          <div style={{ padding: "1rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {ROUTER_STATUS.map(router => (
              <div
                key={router.name}
                style={{
                  background: "var(--isp-inner-card)",
                  border: `1px solid ${router.online ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.2)"}`,
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  minWidth: 185,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{router.name}</span>
                  <span style={{
                    fontSize: "0.65rem", padding: "0.15rem 0.5rem", borderRadius: 20,
                    background: router.online ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)",
                    color: router.online ? "#22c55e" : "#f87171",
                    fontWeight: 700,
                  }}>
                    {router.online ? "Online" : "Offline"}
                  </span>
                </div>
                <div style={{ fontSize: "0.72rem", color: router.online ? "#4ade80" : "#94a3b8", marginBottom: "0.25rem", fontFamily: "monospace" }}>
                  {router.uptime}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>{router.model}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Router Income Filter ── */}
        <div style={{
          borderRadius: 10,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          padding: "0.875rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginRight: "0.5rem" }}>
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} fill="none" stroke="#60a5fa" strokeWidth="2">
              <rect x="2" y="8" width="20" height="8" rx="2"/>
              <line x1="6" y1="12" x2="6" y2="12" strokeWidth="3" strokeLinecap="round"/>
              <line x1="10" y1="12" x2="10" y2="12" strokeWidth="3" strokeLinecap="round"/>
              <line x1="18" y1="8" x2="18" y2="4"/>
              <line x1="20" y1="8" x2="20" y2="4"/>
            </svg>
            <span style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
              Filter by Router:
            </span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {routerOptions.map(opt => {
              const active = selectedRouter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setSelectedRouter(opt.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    padding: "0.35rem 0.875rem",
                    borderRadius: 20,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                    border: active ? "1.5px solid #06b6d4" : "1.5px solid rgba(255,255,255,0.1)",
                    background: active ? "rgba(6,182,212,0.15)" : "rgba(255,255,255,0.04)",
                    color: active ? "#22d3ee" : "#7c8ea6",
                  }}
                >
                  {opt.online !== null && (
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: opt.online ? "#22c55e" : "#f87171",
                      display: "inline-block", flexShrink: 0,
                    }} />
                  )}
                  {opt.label}
                </button>
              );
            })}
          </div>

          {selectedRouter !== "all" && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#22d3ee" }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Showing stats for <strong>{selectedRouter}</strong>
              <button
                onClick={() => setSelectedRouter("all")}
                style={{ marginLeft: "0.25rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.7rem", padding: 0, fontFamily: "inherit" }}
              >
                (clear)
              </button>
            </div>
          )}
        </div>

        {/* KPI Row 1 — income & user stats (dynamic per router) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <KpiCard
            label="Income Today"
            value={stats.incomeToday}
            link="View Reports"
            href="/admin/transactions"
            gradient="linear-gradient(135deg,#0fb8ad 0%,#1fc8db 51%,#2cb5e8 75%)"
            icon={
              <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
                <path d="M32 4C16.6 4 4 16.6 4 32s12.6 28 28 28 28-12.6 28-28S47.4 4 32 4zm4 42h-8V36h8v10zm0-18h-8V18h8v10z"/>
                <rect x="18" y="36" width="8" height="12" rx="1"/>
                <rect x="38" y="28" width="8" height="20" rx="1"/>
              </svg>
            }
          />
          <KpiCard
            label="Income This Month"
            value={stats.incomeMonth}
            link="View Reports"
            href="/admin/transactions"
            gradient="linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)"
            icon={
              <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
                <rect x="8" y="40" width="10" height="16" rx="2"/>
                <rect x="22" y="28" width="10" height="28" rx="2"/>
                <rect x="36" y="20" width="10" height="36" rx="2"/>
                <rect x="50" y="12" width="10" height="44" rx="2"/>
              </svg>
            }
          />
          <KpiCard
            label="Active/Expired"
            value={`${stats.active}/${stats.expired}`}
            link="View All"
            href="/admin/customers"
            gradient="linear-gradient(135deg,#f7971e 0%,#ffd200 100%)"
            icon={
              <svg viewBox="0 0 64 64" style={{ width: 72, height: 72, opacity: 0.25 }} fill="white">
                <circle cx="32" cy="20" r="12"/>
                <path d="M8 56c0-13.3 10.7-24 24-24s24 10.7 24 24H8z"/>
              </svg>
            }
          />
          <KpiCard
            label="Total Users"
            value={String(stats.total)}
            link="View All"
            href="/admin/customers"
            gradient="linear-gradient(135deg,#f953c6 0%,#b91d73 100%)"
            icon={
              <svg viewBox="0 0 80 64" style={{ width: 80, height: 64, opacity: 0.25 }} fill="white">
                <circle cx="28" cy="20" r="10"/>
                <path d="M4 52c0-11 10.7-20 24-20s24 9 24 20H4z"/>
                <circle cx="56" cy="22" r="8" opacity="0.7"/>
                <path d="M40 54c0-9 7-17 16-17s16 8 16 17H40z" opacity="0.7"/>
              </svg>
            }
          />
        </div>

        {/* KPI Row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {KPI_ROW2.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        {/* Two-column lower section */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* Left: Monthly Registered Customers bar chart */}
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: chartMinimized ? "none" : "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)" }}>Monthly Registered Customers</span>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button
                  onClick={() => setChartCollapsed(c => !c)}
                  style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8", cursor: "pointer", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
                  title={chartCollapsed ? "Expand" : "Collapse"}
                >
                  {chartCollapsed ? "+" : "−"}
                </button>
                <button
                  onClick={() => setChartMinimized(m => !m)}
                  style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
                  title={chartMinimized ? "Restore" : "Minimize"}
                >
                  ×
                </button>
              </div>
            </div>
            {!chartMinimized && !chartCollapsed && (
                <div style={{ padding: "1rem 1.25rem" }}>
                  <svg viewBox={`0 0 ${MONTHLY_DATA.length * 36} 140`} width="100%" style={{ display: "block", overflow: "visible" }}>
                    {MONTHLY_DATA.map((d, i) => {
                      const barH = Math.round((d.count / maxCount) * 100);
                      const x = i * 36 + 6;
                      const barTop = 100 - barH;
                      return (
                        <g key={d.month}>
                          <rect
                            x={x}
                            y={barTop}
                            width={22}
                            height={barH}
                            rx={3}
                            fill="url(#barGrad)"
                          />
                          <text
                            x={x + 11}
                            y={barTop - 4}
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize="7.5"
                          >
                            {d.count}
                          </text>
                          <text
                            x={x + 11}
                            y={118}
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="7.5"
                          >
                            {d.month}
                          </text>
                        </g>
                      );
                    })}
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#0284c7" stopOpacity="0.6" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              )}
            </div>

          {/* Right: Payment Gateway + All Users Insights */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Payment Gateway */}
            <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.75rem" }}>Payment Gateway</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.65rem 0.875rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border-subtle)" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="2"/>
                    <line x1="2" y1="10" x2="22" y2="10"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>BankStkPush</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)", marginTop: "0.1rem" }}>Active payment gateway</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: "0.65rem", padding: "0.2rem 0.55rem", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 700 }}>Active</span>
              </div>
            </div>

            {/* All Users Insights */}
            <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.875rem" }}>All Users Insights</div>
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                <DonutChart />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", flex: 1 }}>
                  {USER_INSIGHTS.map(seg => (
                    <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontSize: "0.775rem", color: "var(--isp-text-muted)", flex: 1 }}>{seg.label}</span>
                      <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "var(--isp-text)" }}>{seg.count}</span>
                      <span style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>({Math.round(seg.count / INSIGHTS_TOTAL * 100)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Transactions table */}
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
                  {["Customer", "Plan", "Amount", "Method", "Status"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.625rem 1.25rem", color: "#475569", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECENT_TXS.map((tx, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text)", fontWeight: 600 }}>{tx.name}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)" }}>{tx.plan}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "#4ade80", fontWeight: 700 }}>Ksh {tx.amount.toLocaleString()}</td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span style={{ fontSize: "0.6875rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: tx.method === "MPESA" ? "rgba(6,182,212,0.1)" : "rgba(251,191,36,0.1)", color: tx.method === "MPESA" ? "#22d3ee" : "#fbbf24", fontWeight: 700 }}>
                        {tx.method}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span style={{ fontSize: "0.6875rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: tx.status === "completed" ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)", color: tx.status === "completed" ? "#4ade80" : "#fbbf24", fontWeight: 600 }}>
                        {tx.status}
                      </span>
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
