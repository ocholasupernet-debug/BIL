import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Link } from "wouter";

/* ─── Router View Data ─── */
const ROUTERS = [
  { name: "latty1", online: 10, active: 14, expired: 487 },
  { name: "latty2", online: 1,  active: 2,  expired: 164 },
];

/* ─── KPI Row 1 ─── */
const KPI_ROW1 = [
  {
    label: "Income Today",
    value: "Ksh. 4",
    sub: "",
    link: "View Reports",
    href: "/admin/transactions",
    gradient: "linear-gradient(135deg,#0fb8ad 0%,#1fc8db 51%,#2cb5e8 75%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <path d="M32 4C16.6 4 4 16.6 4 32s12.6 28 28 28 28-12.6 28-28S47.4 4 32 4zm4 42h-8V36h8v10zm0-18h-8V18h8v10z"/>
        <rect x="18" y="36" width="8" height="12" rx="1"/>
        <rect x="38" y="28" width="8" height="20" rx="1"/>
      </svg>
    ),
  },
  {
    label: "Income This Month",
    value: "Ksh. 20,988",
    sub: "",
    link: "View Reports",
    href: "/admin/transactions",
    gradient: "linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, opacity: 0.25 }} fill="white">
        <rect x="8" y="40" width="10" height="16" rx="2"/>
        <rect x="22" y="28" width="10" height="28" rx="2"/>
        <rect x="36" y="20" width="10" height="36" rx="2"/>
        <rect x="50" y="12" width="10" height="44" rx="2"/>
      </svg>
    ),
  },
  {
    label: "Active/Expired",
    value: "16/651",
    sub: "",
    link: "View All",
    href: "/admin/customers",
    gradient: "linear-gradient(135deg,#f7971e 0%,#ffd200 100%)",
    icon: (
      <svg viewBox="0 0 64 64" style={{ width: 72, height: 72, opacity: 0.25 }} fill="white">
        <circle cx="32" cy="20" r="12"/>
        <path d="M8 56c0-13.3 10.7-24 24-24s24 10.7 24 24H8z"/>
      </svg>
    ),
  },
  {
    label: "Total Users",
    value: "812",
    sub: "",
    link: "View All",
    href: "/admin/customers",
    gradient: "linear-gradient(135deg,#f953c6 0%,#b91d73 100%)",
    icon: (
      <svg viewBox="0 0 80 64" style={{ width: 80, height: 64, opacity: 0.25 }} fill="white">
        <circle cx="28" cy="20" r="10"/>
        <path d="M4 52c0-11 10.7-20 24-20s24 9 24 20H4z"/>
        <circle cx="56" cy="22" r="8" opacity="0.7"/>
        <path d="M40 54c0-9 7-17 16-17s16 8 16 17H40z" opacity="0.7"/>
      </svg>
    ),
  },
];

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

/* ─── Recent Transactions ─── */
const RECENT_TXS = [
  { name: "John Kamau",   plan: "Hotspot 10Mbps", amount: 500,   method: "MPESA",   status: "completed" },
  { name: "Mary Wanjiku", plan: "PPPoE 20Mbps",   amount: 1200,  method: "MPESA",   status: "completed" },
  { name: "Peter Otieno", plan: "Hotspot 5Mbps",  amount: 300,   method: "MPESA",   status: "pending"   },
  { name: "Grace Muthoni",plan: "PPPoE 10Mbps",   amount: 800,   method: "CASH",    status: "completed" },
  { name: "David Njoroge",plan: "Hotspot 10Mbps", amount: 500,   method: "MPESA",   status: "completed" },
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

export default function Dashboard() {
  const [routerFilter, setRouterFilter] = useState("All Routers - System Wide");

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Page heading */}
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "white", margin: 0 }}>Dashboard</h1>

        {/* Router View */}
        <div style={{ borderRadius: 10, background: "#1a2645", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {/* Router View Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <div style={{ width: 20, height: 20, background: "rgba(59,130,246,0.2)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }} fill="none" stroke="#60a5fa" strokeWidth="2">
                  <rect x="2" y="8" width="20" height="8" rx="2"/><line x1="6" y1="12" x2="6" y2="12" strokeWidth="3" strokeLinecap="round"/><line x1="10" y1="12" x2="10" y2="12" strokeWidth="3" strokeLinecap="round"/><line x1="18" y1="8" x2="18" y2="4"/><line x1="20" y1="8" x2="20" y2="4"/>
                </svg>
              </div>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "white" }}>Router View</span>
            </div>
            <select
              value={routerFilter}
              onChange={e => setRouterFilter(e.target.value)}
              style={{ fontSize: "0.8125rem", color: "#94a3b8", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "0.375rem 0.75rem", outline: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              <option>All Routers - System Wide</option>
              {ROUTERS.map(r => <option key={r.name}>{r.name}</option>)}
            </select>
          </div>

          {/* Router Cards */}
          <div style={{ padding: "1rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {ROUTERS.map(router => (
              <div
                key={router.name}
                style={{ background: "#0f1923", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.75rem 1rem", minWidth: 160 }}
              >
                <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "white", marginBottom: "0.5rem" }}>{router.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.75rem", fontWeight: 700 }}>
                  <span style={{ color: "#4ade80", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                    {router.online}
                  </span>
                  <span style={{ color: "#60a5fa", display: "flex", alignItems: "center", gap: "0.2rem" }}>
                    ✓ {router.active}
                  </span>
                  <span style={{ color: "#f87171", display: "flex", alignItems: "center", gap: "0.2rem" }}>
                    ✗ {router.expired}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* KPI Row 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {KPI_ROW1.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        {/* KPI Row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {KPI_ROW2.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        {/* Recent Transactions table */}
        <div style={{ borderRadius: 10, background: "#161b22", border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "white" }}>Recent Transactions</span>
            <Link href="/admin/transactions">
              <span style={{ fontSize: "0.75rem", color: "#06b6d4", cursor: "pointer", fontWeight: 600 }}>View All →</span>
            </Link>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Customer", "Plan", "Amount", "Method", "Status"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.625rem 1.25rem", color: "#475569", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECENT_TXS.map((tx, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "0.625rem 1.25rem", color: "white", fontWeight: 600 }}>{tx.name}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "#94a3b8" }}>{tx.plan}</td>
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
