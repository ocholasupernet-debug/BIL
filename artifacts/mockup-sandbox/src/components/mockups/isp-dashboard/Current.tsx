import './_group.css';
import React, { useState, useMemo } from "react";
import { Loader2, Wifi, WifiOff, Router, DollarSign, TrendingUp, BarChart3, CreditCard, LayoutDashboard, Users, Ticket, Network, Settings, LifeBuoy, Zap } from "lucide-react";

/* ── Mock data (matches Supabase row shapes) ── */
const routers = [
  { id: 1, name: "Nairobi-Core", host: "102.68.77.12", status: "online", model: "hEX S", ros_version: "7.14.2", last_seen: null },
  { id: 2, name: "Westlands-AP", host: "10.10.0.2", status: "online", model: "RB4011", ros_version: "7.13.5", last_seen: null },
  { id: 3, name: "Kasarani-Node", host: "10.10.0.7", status: "offline", model: "hAP ac²", ros_version: "7.12", last_seen: "2026-07-24T18:42:00Z" },
];
const transactions = [
  { id: 1042, reference: "SFK92XQ71P", amount: 1500, payment_method: "mpesa", status: "completed", created_at: "2026-07-25T08:10:00Z" },
  { id: 1041, reference: "SFK88LM20T", amount: 500,  payment_method: "mpesa", status: "completed", created_at: "2026-07-25T07:44:00Z" },
  { id: 1040, reference: "SFK71AB93K", amount: 2999, payment_method: "mpesa", status: "completed", created_at: "2026-07-24T21:03:00Z" },
  { id: 1039, reference: "STR-8842",   amount: 1200, payment_method: "card",  status: "pending",   created_at: "2026-07-24T18:31:00Z" },
  { id: 1038, reference: "SFK55QW18Z", amount: 750,  payment_method: "mpesa", status: "completed", created_at: "2026-07-24T16:22:00Z" },
];
const monthly = [4, 7, 9, 12, 15, 18, 26, 0, 0, 0, 0, 0];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const userInsights = [
  { label: "Hotspot", count: 58, color: "#3B82F6" },
  { label: "PPPoE",   count: 24, color: "#8B5CF6" },
  { label: "Static",  count: 9,  color: "#22C55E" },
];

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `Ksh. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Ksh. ${n.toLocaleString()}`;
  return `Ksh. ${n}`;
}

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div style={{ borderRadius: 14, background: "var(--isp-card)", border: "1px solid var(--isp-border)", padding: "1.125rem 1.25rem", display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: accent ? `${accent}12` : "var(--isp-accent-glow)", border: `1px solid ${accent ? `${accent}25` : "var(--isp-accent-border)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: accent || "var(--isp-accent)" }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", fontWeight: 500, marginTop: "0.25rem" }}>{label}</div>
      </div>
    </div>
  );
}

function StatMiniCard({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
  return (
    <div style={{ borderRadius: 12, background: "var(--isp-card)", border: "1px solid var(--isp-border)", padding: "0.875rem 1rem", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
        {dotColor && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />}
        <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em" }}>{value}</div>
      <div style={{ fontSize: "0.68rem", color: "var(--isp-accent)", fontWeight: 600, marginTop: "0.25rem" }}>View All →</div>
    </div>
  );
}

function DonutChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((a, b) => a + b.count, 0);
  const cx = 80, cy = 80, r = 56;
  const circumference = 2 * Math.PI * r;
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
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--isp-border)" strokeWidth={22} />
      {segments.map(seg => (
        <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={22}
          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
          strokeDashoffset={-seg.offset + circumference * 0.25}
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }} />
      ))}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="800">{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total Users</text>
    </svg>
  );
}

const NAV = [
  { icon: <LayoutDashboard size={15} />, label: "Dashboard", active: true },
  { icon: <Users size={15} />, label: "Customers" },
  { icon: <Ticket size={15} />, label: "Vouchers" },
  { icon: <CreditCard size={15} />, label: "Transactions" },
  { icon: <Network size={15} />, label: "Network" },
  { icon: <LifeBuoy size={15} />, label: "Support" },
  { icon: <Settings size={15} />, label: "Settings" },
];

export function Current() {
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  const maxCount = Math.max(...monthly, 1);
  const onlineRouters = routers.filter(r => r.status === "online").length;
  const incomeToday = 2000, incomeMonth = 48750, totalRevenue = 152300;

  return (
    <div className="isp-mock" style={{ minHeight: "100vh", display: "flex", background: "var(--isp-bg)" }}>
      {/* Sidebar shell */}
      <aside style={{ width: 216, flexShrink: 0, background: "var(--isp-sidebar)", color: "var(--isp-nav-text)", display: "flex", flexDirection: "column", padding: "1rem 0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.25rem 0.5rem 1rem" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Zap size={16} /></div>
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#fff" }}>ISPlatty</div>
            <div style={{ fontSize: "0.6rem", color: "var(--isp-text-sub)" }}>ISP Management</div>
          </div>
        </div>
        {NAV.map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0.75rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600, background: item.active ? "rgba(37,99,235,0.25)" : "transparent", color: item.active ? "#fff" : "var(--isp-nav-text)", marginBottom: 2, cursor: "pointer" }}>
            {item.icon}{item.label}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: "1.5rem", minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingBottom: "1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "3px 12px 3px 8px", borderRadius: 20, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--isp-green)", display: "inline-block" }} />
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Live Dashboard</span>
              </div>
              <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--isp-text)", margin: 0, letterSpacing: "-0.025em", lineHeight: 1.2 }}>Good morning</h1>
              <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>Here's what's happening across your network today.</p>
            </div>
            <div style={{ padding: "6px 14px", borderRadius: 9, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", letterSpacing: "0.03em" }}>
              Saturday, 25 July
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            <KpiCard label="Income Today" value={fmtKsh(incomeToday)} icon={<DollarSign size={20} />} />
            <KpiCard label="Income This Month" value={fmtKsh(incomeMonth)} icon={<TrendingUp size={20} />} accent="#16a34a" />
            <KpiCard label="Total Transactions" value="128" icon={<CreditCard size={20} />} accent="#ea580c" />
            <KpiCard label="Total Revenue" value={fmtKsh(totalRevenue)} icon={<BarChart3 size={20} />} accent="#2563EB" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            <StatMiniCard label="Online Now" value="37" dotColor="var(--isp-green)" />
            <StatMiniCard label="Vouchers Left" value="14" dotColor="var(--isp-accent)" />
            <StatMiniCard label="Support Tickets" value="2" dotColor="#0d9488" />
            <StatMiniCard label="Routers Online" value={String(onlineRouters)} dotColor="#d97706" />
          </div>

          <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--isp-green)", display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: "1rem" }}>🟢</span>
            <span style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem" }}>M-Pesa STK Push</span>
            <span className="isp-badge isp-badge-green" style={{ fontSize: "0.72rem" }}>Active</span>
            <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>Payment gateway configured</span>
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Change →</span>
          </div>

          <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <Router size={16} style={{ color: "var(--isp-accent)" }} />
                <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Router Status</span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="isp-badge isp-badge-green" style={{ fontSize: "0.72rem" }}>{onlineRouters} Online</span>
                <span className="isp-badge isp-badge-red" style={{ fontSize: "0.72rem" }}>{routers.length - onlineRouters} Offline</span>
              </div>
            </div>
            <div style={{ padding: "1rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {routers.map(router => {
                const isOnline = router.status === "online";
                return (
                  <div key={router.id} style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "0.75rem 1rem", minWidth: 185 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem", gap: 10 }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{router.name}</span>
                      {isOnline
                        ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-green)" }}><Wifi size={12} /> Online</span>
                        : <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", color: "var(--isp-text-muted)" }}><WifiOff size={12} /> Since 18:42</span>}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginBottom: "0.25rem", fontFamily: "monospace" }}>{router.host}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>{router.model} · ROS v{router.ros_version}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginRight: "0.5rem" }}>
              <Router size={15} style={{ color: "var(--isp-accent)" }} />
              <span style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Filter by Router:</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {[{ key: "all" as const, label: "All Routers", online: null }, ...routers.map(r => ({ key: r.id, label: r.name, online: r.status === "online" }))].map(opt => {
                const active = selectedRouter === opt.key;
                return (
                  <button key={String(opt.key)} onClick={() => setSelectedRouter(opt.key)}
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.35rem 0.875rem", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: active ? "1.5px solid var(--isp-accent)" : "1.5px solid var(--isp-border)", background: active ? "var(--isp-accent-glow)" : "transparent", color: active ? "var(--isp-accent)" : "var(--isp-text-muted)" }}>
                    {opt.online !== null && <span style={{ width: 7, height: 7, borderRadius: "50%", background: opt.online ? "var(--isp-green)" : "#f87171", display: "inline-block", flexShrink: 0 }} />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}>
            <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)" }}>Monthly Registered Customers</span>
              </div>
              <div style={{ padding: "1rem 1.25rem" }}>
                <svg viewBox={`0 0 ${monthly.length * 36} 140`} width="100%" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" /><stop offset="100%" stopColor="#2563EB" stopOpacity="0.4" />
                    </linearGradient>
                  </defs>
                  {monthly.map((count, i) => {
                    const barH = Math.round((count / maxCount) * 100);
                    const x = i * 36 + 6;
                    const barTop = 100 - barH;
                    return (
                      <g key={MONTHS[i]}>
                        <rect x={x} y={barTop} width={22} height={barH} rx={3} fill="url(#barGrad)" />
                        <text x={x + 11} y={barTop - 4} textAnchor="middle" fill="var(--isp-text-sub)" fontSize="7.5">{count}</text>
                        <text x={x + 11} y={118} textAnchor="middle" fill="var(--isp-text-sub)" fontSize="7.5">{MONTHS[i]}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.75rem" }}>Payment Gateway</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.65rem 0.875rem", borderRadius: 12, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border-subtle)" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "1.2rem" }}>🟢</div>
                  <div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>M-Pesa STK Push</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)", marginTop: "0.1rem" }}>Active payment gateway</div>
                  </div>
                  <span className="isp-badge isp-badge-green" style={{ marginLeft: "auto", fontSize: "0.65rem" }}>Active</span>
                </div>
              </div>
              <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
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
                          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>({Math.round(seg.count / total * 100)}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderRadius: 14, background: "var(--isp-table-bg)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Recent Transactions</span>
              <span style={{ fontSize: "0.75rem", color: "var(--isp-accent)", cursor: "pointer", fontWeight: 600 }}>View All →</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="isp-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr>{["ID", "Reference", "Amount", "Method", "Status", "Date"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.625rem 1.25rem" }}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id}>
                      <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>#{tx.id}</td>
                      <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{tx.reference}</td>
                      <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-green)", fontWeight: 700 }}>Ksh {tx.amount.toLocaleString()}</td>
                      <td style={{ padding: "0.625rem 1.25rem" }}>
                        <span className={`isp-badge ${tx.payment_method === "mpesa" ? "isp-badge-blue" : "isp-badge-amber"}`} style={{ fontSize: "0.6875rem" }}>{tx.payment_method.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: "0.625rem 1.25rem" }}>
                        <span className={`isp-badge ${tx.status === "completed" ? "isp-badge-green" : "isp-badge-amber"}`} style={{ fontSize: "0.6875rem" }}>{tx.status}</span>
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
      </main>
    </div>
  );
}
