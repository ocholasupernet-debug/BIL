import './_group.css';
import React, { useState } from "react";
import { Wifi, WifiOff, Router, DollarSign, TrendingUp, BarChart3, CreditCard, LayoutDashboard, Users, Ticket, Network, Settings, LifeBuoy, Zap, ChevronRight, Activity, CircleDot, AlertCircle } from "lucide-react";

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
  { label: "Hotspot", count: 58, color: "#0F766E" }, // Teal 600
  { label: "PPPoE",   count: 24, color: "#334155" }, // Slate 700
  { label: "Static",  count: 9,  color: "#10B981" }, // Emerald 500
];

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `Ksh ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Ksh ${n.toLocaleString()}`;
  return `Ksh ${n}`;
}

const NAV = [
  { icon: <LayoutDashboard />, label: "Dashboard", active: true },
  { icon: <Users />, label: "Customers" },
  { icon: <Ticket />, label: "Vouchers" },
  { icon: <CreditCard />, label: "Transactions" },
  { icon: <Network />, label: "Network" },
  { icon: <LifeBuoy />, label: "Support" },
  { icon: <Settings />, label: "Settings" },
];

/* ── Components ── */
function KpiCell({ label, value, highlight = false }: { label: string; value: string | React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-[120px]">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</div>
      <div className={`text-[15px] font-semibold tracking-tight ${highlight ? 'text-teal-700' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function DonutChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((a, b) => a + b.count, 0);
  const cx = 60, cy = 60, r = 44;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  
  return (
    <svg viewBox="0 0 120 120" width={120} height={120} className="block drop-shadow-sm">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={14} />
      {insights.map(seg => {
        const pct = seg.count / total;
        const dash = pct * circumference;
        const currentOffset = offset;
        offset += dash;
        return (
          <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={14}
            strokeDasharray={`${dash - 2} ${circumference - dash + 2}`}
            strokeDashoffset={-currentOffset + circumference * 0.25}
            strokeLinecap="round"
            className="transition-all duration-500"
            style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }} />
        );
      })}
      <text x={cx} y={cy + 2} textAnchor="middle" fill="#0F172A" fontSize="18" fontWeight="600" letterSpacing="-0.05em">{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="#64748B" fontSize="9" fontWeight="500">Users</text>
    </svg>
  );
}

export function SlateProfessional() {
  const [activeTab, setActiveTab] = useState<'overview' | 'network'>('overview');
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  
  const maxCount = Math.max(...monthly, 1);
  const onlineRouters = routers.filter(r => r.status === "online").length;
  
  const incomeToday = 2000, incomeMonth = 48750, totalRevenue = 152300;

  return (
    <div className="bg-[#F8FAFC] text-slate-900 font-sans flex min-h-screen selection:bg-teal-100 selection:text-teal-900">
      {/* Sidebar */}
      <aside className="w-56 border-r border-slate-200 bg-white flex flex-col shrink-0 relative z-10">
        <div className="h-[60px] flex items-center px-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-teal-600 rounded flex items-center justify-center text-white shadow-sm">
              <Zap size={14} strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-[15px] tracking-tight text-slate-900">ISPlatty</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-5 space-y-1">
          {NAV.map(item => (
            <a key={item.label} href="#" 
               className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                 item.active 
                   ? 'bg-slate-100 text-slate-900' 
                   : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
               }`}>
              {React.cloneElement(item.icon, { size: 16, strokeWidth: item.active ? 2 : 1.5, className: item.active ? "text-teal-600" : "text-slate-400" })}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold">
              JD
            </div>
            <div>
              <div className="text-[12px] font-semibold text-slate-900">John Doe</div>
              <div className="text-[11px] text-slate-500">Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Header */}
        <header className="h-[60px] bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Dashboard</span>
            <ChevronRight size={14} className="text-slate-400" />
            <span className="font-semibold text-slate-900">Live Overview</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 relative">
                <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
              </div>
              System Healthy
            </div>
          </div>
        </header>

        <div className="p-8 flex flex-col gap-8 max-w-[1280px] w-full mx-auto">
          
          {/* KPI Strip */}
          <section>
            <div className="flex flex-wrap lg:flex-nowrap w-full border border-slate-200 bg-white rounded-lg overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              <KpiCell label="Income Today" value={fmtKsh(incomeToday)} />
              <KpiCell label="This Month" value={fmtKsh(incomeMonth)} />
              <KpiCell label="Transactions" value="128" />
              <KpiCell label="Total Revenue" value={fmtKsh(totalRevenue)} />
              <KpiCell label="Online Now" value={
                <span className="flex items-center gap-1.5">
                  <CircleDot size={12} className="text-teal-600" /> 37
                </span>
              } highlight />
              <KpiCell label="Vouchers Left" value="14" />
              <KpiCell label="Support Tickets" value="2" />
              <KpiCell label="Routers Online" value={`${onlineRouters} / ${routers.length}`} />
            </div>
          </section>

          {/* Middle Section: Tabs */}
          <section className="flex flex-col gap-5">
            <div className="border-b border-slate-200 flex gap-6 px-1">
              <button 
                onClick={() => setActiveTab('overview')} 
                className={`pb-3 text-[13px] font-semibold transition-colors relative ${activeTab === 'overview' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Overview
                {activeTab === 'overview' && <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-teal-600" />}
              </button>
              <button 
                onClick={() => setActiveTab('network')} 
                className={`pb-3 text-[13px] font-semibold transition-colors relative ${activeTab === 'network' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Network Health
                {activeTab === 'network' && <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-teal-600" />}
              </button>
            </div>

            {/* Tab: Overview */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                
                {/* Monthly Chart */}
                <div className="lg:col-span-2 border border-slate-200 bg-white rounded-lg p-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-6">Registered Customers</h3>
                  <div className="h-[200px] w-full pt-4">
                    <svg viewBox={`0 0 ${monthly.length * 40} 140`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                      {monthly.map((count, i) => {
                        const barH = count === 0 ? 0 : Math.round((count / maxCount) * 110);
                        const x = i * (100/monthly.length) + "%";
                        const barTop = 120 - barH;
                        return (
                          <g key={MONTHS[i]}>
                            {barH > 0 && <rect x={x} y={barTop} width="4%" height={barH} fill="#0F766E" rx={1} className="transition-all duration-500 hover:opacity-80" />}
                            {barH === 0 && <rect x={x} y={119} width="4%" height={1} fill="#E2E8F0" />}
                            <text x={`calc(${x} + 2%)`} y={barTop - 8} textAnchor="middle" fill="#64748B" fontSize="10" className="font-mono">{count}</text>
                            <text x={`calc(${x} + 2%)`} y={138} textAnchor="middle" fill="#94A3B8" fontSize="11" fontWeight="500">{MONTHS[i]}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                {/* Right Column: Insights & Gateway */}
                <div className="flex flex-col gap-6">
                  {/* Gateway */}
                  <div className="border border-slate-200 bg-white rounded-lg p-5">
                    <h3 className="text-sm font-semibold text-slate-900 mb-4">Payment Gateway</h3>
                    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-md bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-white border border-slate-200 flex items-center justify-center text-teal-600">
                          <DollarSign size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-slate-900 leading-tight">M-Pesa STK</div>
                          <div className="text-[11px] text-slate-500">Configured</div>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    </div>
                  </div>

                  {/* Users Donut */}
                  <div className="border border-slate-200 bg-white rounded-lg p-5 flex-1">
                    <h3 className="text-sm font-semibold text-slate-900 mb-6">User Distribution</h3>
                    <div className="flex items-center gap-6">
                      <DonutChart insights={userInsights} />
                      <div className="flex flex-col gap-3 flex-1">
                        {userInsights.map(seg => {
                          const total = userInsights.reduce((a, b) => a + b.count, 0);
                          return (
                            <div key={seg.label} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                <span className="text-[12px] font-medium text-slate-600">{seg.label}</span>
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-[13px] font-bold text-slate-900">{seg.count}</span>
                                <span className="text-[10px] text-slate-400 font-mono w-6 text-right">{Math.round(seg.count / total * 100)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Network Health */}
            {activeTab === 'network' && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium text-slate-500">Filter:</span>
                  <div className="flex items-center gap-2">
                    {[{ key: "all" as const, label: "All Routers", status: null }, ...routers.map(r => ({ key: r.id, label: r.name, status: r.status }))].map(opt => {
                      const active = selectedRouter === opt.key;
                      return (
                        <button key={String(opt.key)} onClick={() => setSelectedRouter(opt.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors border ${
                            active 
                              ? 'bg-slate-900 border-slate-900 text-white' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}>
                          {opt.status && (
                            <span className={`w-1.5 h-1.5 rounded-full ${opt.status === 'online' ? (active ? 'bg-emerald-400' : 'bg-emerald-500') : (active ? 'bg-rose-400' : 'bg-rose-500')}`} />
                          )}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Router Name</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Host IP</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Model</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">ROS Ver</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[13px]">
                      {routers.filter(r => selectedRouter === 'all' || r.id === selectedRouter).map(router => {
                        const isOnline = router.status === "online";
                        return (
                          <tr key={router.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-3.5 font-medium text-slate-900 flex items-center gap-2">
                              <Router size={14} className="text-slate-400" />
                              {router.name}
                            </td>
                            <td className="px-5 py-3.5">
                              {isOnline ? (
                                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium text-xs">
                                  <Wifi size={14} /> Online
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-rose-600 font-medium text-xs">
                                  <AlertCircle size={14} /> Offline
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 font-mono text-xs">{router.host}</td>
                            <td className="px-5 py-3.5 text-slate-600">{router.model}</td>
                            <td className="px-5 py-3.5 text-slate-600 font-mono text-xs">v{router.ros_version}</td>
                            <td className="px-5 py-3.5 text-slate-500 text-xs">
                              {router.last_seen ? new Date(router.last_seen).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Bottom Section: Transactions */}
          <section className="flex flex-col mt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent Transactions</h2>
              <button className="text-[12px] font-medium text-teal-600 hover:text-teal-700 transition-colors">View all →</button>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Reference</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Method</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[13px]">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">#{tx.id}</td>
                      <td className="px-5 py-3 text-slate-900 font-mono text-xs font-medium">{tx.reference}</td>
                      <td className="px-5 py-3 text-slate-900 font-semibold tracking-tight">Ksh {tx.amount.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                          tx.payment_method === 'mpesa' 
                            ? 'bg-teal-50 border-teal-200 text-teal-700' 
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}>
                          {tx.payment_method}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                         <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${tx.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>
                           <span className={`w-1.5 h-1.5 rounded-full ${tx.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                           {tx.status}
                         </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-[12px] text-right">
                        {new Date(tx.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
