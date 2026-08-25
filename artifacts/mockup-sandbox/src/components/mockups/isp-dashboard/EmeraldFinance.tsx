import './_group.css';
import React, { useState } from "react";
import { 
  Wifi, 
  WifiOff, 
  Router, 
  DollarSign, 
  TrendingUp, 
  BarChart3, 
  CreditCard, 
  LayoutDashboard, 
  Users, 
  Ticket, 
  Network, 
  Settings, 
  LifeBuoy, 
  Zap,
  Activity,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  MoreHorizontal
} from "lucide-react";

/* ── Emerald Finance Palette ── */
const THEME = {
  bg: "#0A1512",
  sidebar: "#060D0A",
  card: "#0F1F1A",
  cardHover: "#132822",
  border: "#1C362C",
  borderLight: "#2A4F41",
  text: "#E5F4ED",
  textMuted: "#8BAF9F",
  textSubtle: "#567A6B",
  emerald: "#10B981",
  emeraldGlow: "rgba(16, 185, 129, 0.15)",
  mint: "#34D399",
  alert: "#F59E0B",
  danger: "#EF4444",
  chartBlue: "#3B82F6",
  chartPurple: "#8B5CF6",
};

/* ── Mock data ── */
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
  { label: "Hotspot", count: 58, color: THEME.emerald },
  { label: "PPPoE",   count: 24, color: THEME.chartBlue },
  { label: "Static",  count: 9,  color: THEME.chartPurple },
];

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `KES ${n.toLocaleString()}`;
  return `KES ${n}`;
}

const NAV = [
  { icon: <LayoutDashboard size={18} />, label: "Dashboard", active: true },
  { icon: <Users size={18} />, label: "Customers" },
  { icon: <Ticket size={18} />, label: "Vouchers" },
  { icon: <CreditCard size={18} />, label: "Transactions" },
  { icon: <Network size={18} />, label: "Network" },
  { icon: <LifeBuoy size={18} />, label: "Support" },
  { icon: <Settings size={18} />, label: "Settings" },
];

export function EmeraldFinance() {
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  const maxCount = Math.max(...monthly, 1);
  const onlineRouters = routers.filter(r => r.status === "online").length;
  const incomeToday = 2000, incomeMonth = 48750, totalRevenue = 152300;

  return (
    <div style={{ 
      minHeight: "100vh", 
      display: "flex", 
      background: THEME.bg, 
      color: THEME.text,
      fontFamily: "'Inter', sans-serif"
    }}>
      
      {/* Sidebar */}
      <aside style={{ 
        width: 240, 
        flexShrink: 0, 
        background: THEME.sidebar, 
        borderRight: `1px solid ${THEME.border}`,
        display: "flex", 
        flexDirection: "column", 
        padding: "1.5rem" 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2.5rem" }}>
          <div style={{ 
            width: 36, 
            height: 36, 
            borderRadius: 10, 
            background: `linear-gradient(135deg, ${THEME.emerald}, #059669)`, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            color: "#fff",
            boxShadow: `0 0 15px ${THEME.emeraldGlow}`
          }}>
            <Zap size={20} />
          </div>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: THEME.text, letterSpacing: "-0.02em" }}>ISPlatty</div>
            <div style={{ fontSize: "0.7rem", color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Terminal</div>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {NAV.map(item => (
            <div key={item.label} style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 12, 
              padding: "0.75rem 1rem", 
              borderRadius: 8, 
              fontSize: "0.875rem", 
              fontWeight: 500, 
              background: item.active ? THEME.card : "transparent", 
              color: item.active ? THEME.emerald : THEME.textMuted, 
              borderLeft: item.active ? `3px solid ${THEME.emerald}` : "3px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s"
            }}>
              {item.icon}
              {item.label}
            </div>
          ))}
        </nav>

        <div style={{ marginTop: "auto", background: THEME.card, padding: "1rem", borderRadius: 12, border: `1px solid ${THEME.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: THEME.emerald, boxShadow: `0 0 8px ${THEME.emerald}` }} />
            <span style={{ fontSize: "0.75rem", color: THEME.textMuted, fontWeight: 600, textTransform: "uppercase" }}>System Status</span>
          </div>
          <div style={{ fontSize: "0.8125rem", color: THEME.text }}>All services operational</div>
          <div style={{ fontSize: "0.7rem", color: THEME.textSubtle, marginTop: 4 }}>Last checked: Just now</div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: "2rem", minWidth: 0, overflowY: "auto", height: "100vh" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header */}
          <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingBottom: "1.5rem", borderBottom: `1px solid ${THEME.border}` }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "4px 12px", borderRadius: 20, background: THEME.emeraldGlow, border: `1px solid rgba(16, 185, 129, 0.3)` }}>
                <Activity size={12} style={{ color: THEME.emerald }} />
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: THEME.emerald, letterSpacing: "0.05em", textTransform: "uppercase" }}>Live Dashboard</span>
              </div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>Command Center</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.75rem", color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Market Time</div>
                <div style={{ fontSize: "0.875rem", fontWeight: 500, fontFamily: "monospace" }}>10:42:05 EAT</div>
              </div>
              <div style={{ width: 1, height: 32, background: THEME.border }} />
              <div style={{ padding: "8px 16px", borderRadius: 8, background: THEME.card, border: `1px solid ${THEME.border}`, fontSize: "0.8125rem", fontWeight: 500 }}>
                Saturday, 25 July
              </div>
            </div>
          </header>

          {/* Revenue Sparkline Hero */}
          <div style={{ 
            background: `linear-gradient(to bottom, ${THEME.card}, transparent)`, 
            border: `1px solid ${THEME.border}`, 
            borderRadius: 16, 
            padding: "1.5rem",
            position: "relative",
            overflow: "hidden"
          }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
               <div>
                  <div style={{ fontSize: "0.75rem", color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Total Revenue (MTD)</div>
                  <div style={{ fontSize: "2.5rem", fontWeight: 600, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 12 }}>
                    {fmtKsh(incomeMonth)}
                    <span style={{ fontSize: "1rem", color: THEME.emerald, display: "flex", alignItems: "center", background: THEME.emeraldGlow, padding: "2px 8px", borderRadius: 12 }}>
                      <ArrowUpRight size={16} /> 12.4%
                    </span>
                  </div>
               </div>
               <div style={{ display: "flex", gap: "1rem" }}>
                 <div style={{ background: THEME.card, padding: "0.75rem 1rem", borderRadius: 8, border: `1px solid ${THEME.border}` }}>
                    <div style={{ fontSize: "0.7rem", color: THEME.textMuted, marginBottom: 4 }}>Today's Income</div>
                    <div style={{ fontSize: "1.125rem", fontWeight: 500 }}>{fmtKsh(incomeToday)}</div>
                 </div>
                 <div style={{ background: THEME.card, padding: "0.75rem 1rem", borderRadius: 8, border: `1px solid ${THEME.border}` }}>
                    <div style={{ fontSize: "0.7rem", color: THEME.textMuted, marginBottom: 4 }}>Total Tx</div>
                    <div style={{ fontSize: "1.125rem", fontWeight: 500 }}>128</div>
                 </div>
               </div>
             </div>
             
             {/* Fake Area Chart */}
             <div style={{ height: 100, width: "100%" }}>
                <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                  <defs>
                    <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={THEME.emerald} stopOpacity="0.2" />
                      <stop offset="100%" stopColor={THEME.emerald} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path 
                    d="M0,80 Q50,70 100,90 T200,60 T300,70 T400,40 T500,50 T600,30 T700,40 T800,20 T900,30 T1000,10 L1000,100 L0,100 Z" 
                    fill="url(#emeraldGrad)" 
                  />
                  <path 
                    d="M0,80 Q50,70 100,90 T200,60 T300,70 T400,40 T500,50 T600,30 T700,40 T800,20 T900,30 T1000,10" 
                    fill="none" 
                    stroke={THEME.emerald} 
                    strokeWidth="2" 
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
             </div>
          </div>

          {/* Quick Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            {[
              { label: "Online Customers", value: "37", sub: "Active sessions", icon: <Users size={16} />, color: THEME.mint },
              { label: "Available Vouchers", value: "14", sub: "Low stock", icon: <Ticket size={16} />, color: THEME.alert },
              { label: "Open Tickets", value: "2", sub: "Needs attention", icon: <LifeBuoy size={16} />, color: THEME.chartPurple },
              { label: "Active Routers", value: `${onlineRouters}/${routers.length}`, sub: "Nodes online", icon: <Router size={16} />, color: THEME.chartBlue }
            ].map((stat, i) => (
              <div key={i} style={{ 
                background: THEME.card, 
                border: `1px solid ${THEME.border}`, 
                borderRadius: 12, 
                padding: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: THEME.textMuted }}>{stat.label}</span>
                  <div style={{ color: stat.color }}>{stat.icon}</div>
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{stat.value}</div>
                <div style={{ fontSize: "0.7rem", color: THEME.textSubtle }}>{stat.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem", alignItems: "start" }}>
            
            {/* Left Column: Network & Transactions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              
              {/* Router Status */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: `1px solid ${THEME.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ background: THEME.borderLight, padding: 6, borderRadius: 6 }}><Network size={16} style={{ color: THEME.text }} /></div>
                    <span style={{ fontSize: "1rem", fontWeight: 500 }}>Infrastructure Health</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", background: THEME.emeraldGlow, color: THEME.emerald, padding: "2px 8px", borderRadius: 12, border: `1px solid rgba(16,185,129,0.2)` }}>{onlineRouters} Online</span>
                    {routers.length - onlineRouters > 0 && (
                      <span style={{ fontSize: "0.75rem", background: "rgba(239,68,68,0.1)", color: THEME.danger, padding: "2px 8px", borderRadius: 12, border: `1px solid rgba(239,68,68,0.2)` }}>{routers.length - onlineRouters} Offline</span>
                    )}
                  </div>
                </div>
                
                <div style={{ padding: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  {routers.map(router => {
                    const isOnline = router.status === "online";
                    return (
                      <div key={router.id} style={{ 
                        background: THEME.bg, 
                        border: `1px solid ${isOnline ? THEME.border : 'rgba(239,68,68,0.3)'}`, 
                        borderRadius: 12, 
                        padding: "1rem",
                        position: "relative",
                        overflow: "hidden"
                      }}>
                        {isOnline && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: THEME.emerald }} />}
                        {!isOnline && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: THEME.danger }} />}
                        
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>{router.name}</span>
                          {isOnline 
                            ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: THEME.emerald, boxShadow: `0 0 8px ${THEME.emerald}` }} />
                            : <span style={{ width: 8, height: 8, borderRadius: "50%", background: THEME.danger, boxShadow: `0 0 8px ${THEME.danger}` }} />
                          }
                        </div>
                        <div style={{ fontSize: "0.75rem", color: THEME.textMuted, fontFamily: "monospace", marginBottom: "0.5rem" }}>{router.host}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", color: THEME.textSubtle }}>
                          <span>{router.model}</span>
                          <span>v{router.ros_version}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Transactions */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: `1px solid ${THEME.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ background: THEME.borderLight, padding: 6, borderRadius: 6 }}><CreditCard size={16} style={{ color: THEME.text }} /></div>
                    <span style={{ fontSize: "1rem", fontWeight: 500 }}>Recent Transactions</span>
                  </div>
                  <button style={{ background: "transparent", border: "none", color: THEME.textMuted, fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                    View All <ArrowRight size={14} />
                  </button>
                </div>
                
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: THEME.bg, fontSize: "0.75rem", color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      <th style={{ padding: "0.75rem 1.5rem", fontWeight: 500 }}>Reference</th>
                      <th style={{ padding: "0.75rem 1.5rem", fontWeight: 500 }}>Amount</th>
                      <th style={{ padding: "0.75rem 1.5rem", fontWeight: 500 }}>Method</th>
                      <th style={{ padding: "0.75rem 1.5rem", fontWeight: 500 }}>Status</th>
                      <th style={{ padding: "0.75rem 1.5rem", fontWeight: 500 }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                        <td style={{ padding: "1rem 1.5rem", fontSize: "0.8125rem", fontFamily: "monospace" }}>{tx.reference}</td>
                        <td style={{ padding: "1rem 1.5rem", fontSize: "0.875rem", fontWeight: 600, color: THEME.emerald }}>{tx.amount.toLocaleString()}</td>
                        <td style={{ padding: "1rem 1.5rem" }}>
                          <span style={{ 
                            fontSize: "0.7rem", 
                            padding: "2px 8px", 
                            borderRadius: 4, 
                            background: tx.payment_method === 'mpesa' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                            color: tx.payment_method === 'mpesa' ? THEME.emerald : THEME.chartBlue,
                            border: `1px solid ${tx.payment_method === 'mpesa' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`,
                            textTransform: "uppercase"
                          }}>
                            {tx.payment_method}
                          </span>
                        </td>
                        <td style={{ padding: "1rem 1.5rem" }}>
                           <span style={{ 
                            fontSize: "0.7rem", 
                            padding: "2px 8px", 
                            borderRadius: 4, 
                            background: tx.status === 'completed' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: tx.status === 'completed' ? THEME.mint : THEME.alert,
                            textTransform: "capitalize"
                          }}>
                            {tx.status}
                          </span>
                        </td>
                        <td style={{ padding: "1rem 1.5rem", fontSize: "0.75rem", color: THEME.textMuted }}>
                          {new Date(tx.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

            {/* Right Column: Insights & Integrations */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              
              {/* Payment Gateway Status */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "1.5rem" }}>
                 <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Active Integrations</span>
                    <Settings size={14} style={{ color: THEME.textMuted }} />
                 </div>
                 
                 <div style={{ background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: "1rem", display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ background: THEME.emeraldGlow, padding: 8, borderRadius: 8, color: THEME.emerald }}>
                      <ShieldCheck size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>M-Pesa STK</span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: THEME.emerald, boxShadow: `0 0 6px ${THEME.emerald}` }} />
                      </div>
                      <div style={{ fontSize: "0.75rem", color: THEME.textMuted, marginBottom: 8 }}>C2B payments operational</div>
                      <div style={{ fontSize: "0.7rem", color: THEME.textSubtle }}>Last sync: 2 mins ago</div>
                    </div>
                 </div>
              </div>

              {/* Monthly Registrations */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "1.5rem" }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "1.5rem" }}>Registrations (YTD)</div>
                <div style={{ height: 140, display: "flex", alignItems: "flex-end", gap: 4 }}>
                  {monthly.map((count, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ 
                        width: "100%", 
                        height: `${Math.max((count / maxCount) * 100, 2)}%`, 
                        background: count > 0 ? THEME.emerald : THEME.border,
                        opacity: count > 0 ? 0.8 : 0.3,
                        borderRadius: "2px 2px 0 0",
                        transition: "height 0.3s"
                      }} />
                      <span style={{ fontSize: "0.6rem", color: THEME.textSubtle }}>{MONTHS[i]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* User Distribution */}
              <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "1.5rem" }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "1.5rem" }}>Service Distribution</div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {userInsights.map(insight => {
                    const total = userInsights.reduce((a, b) => a + b.count, 0);
                    const percent = Math.round((insight.count / total) * 100);
                    return (
                      <div key={insight.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: 6 }}>
                          <span style={{ color: THEME.textMuted }}>{insight.label}</span>
                          <span style={{ fontWeight: 600 }}>{insight.count} <span style={{ color: THEME.textSubtle }}>({percent}%)</span></span>
                        </div>
                        <div style={{ height: 4, background: THEME.bg, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${percent}%`, background: insight.color, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
