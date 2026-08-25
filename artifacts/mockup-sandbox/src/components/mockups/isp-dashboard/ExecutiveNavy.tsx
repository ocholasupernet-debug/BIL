import './_group.css';
import React, { useState } from "react";
import {
  Wifi, WifiOff, Router, DollarSign, TrendingUp, BarChart3, CreditCard,
  LayoutDashboard, Users, Ticket, Network, Settings, LifeBuoy, Zap,
  ArrowUpRight, ArrowDownRight, Clock, ShieldCheck
} from "lucide-react";

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
  { label: "Hotspot", count: 58, color: "#081326" }, // Navy
  { label: "PPPoE",   count: 24, color: "#F59E0B" }, // Amber
  { label: "Static",  count: 9,  color: "#94A3B8" }, // Slate
];

const NAV = [
  { icon: <LayoutDashboard size={18} />, label: "Overview", active: true },
  { icon: <Users size={18} />, label: "Subscribers" },
  { icon: <Ticket size={18} />, label: "Vouchers" },
  { icon: <CreditCard size={18} />, label: "Finances" },
  { icon: <Network size={18} />, label: "Network" },
  { icon: <LifeBuoy size={18} />, label: "Support" },
  { icon: <Settings size={18} />, label: "Settings" },
];

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `KES ${n.toLocaleString()}`;
  return `KES ${n}`;
}

export function ExecutiveNavy() {
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  const maxCount = Math.max(...monthly, 1);
  const onlineRouters = routers.filter(r => r.status === "online").length;
  
  const incomeToday = 2000;
  const incomeMonth = 48750;
  const totalRevenue = 152300;
  
  const displayedRouters = selectedRouter === "all" ? routers : routers.filter(r => r.id === selectedRouter);

  return (
    <div className="flex h-screen bg-[#F1F5F9] font-sans overflow-hidden text-slate-800">
      
      {/* Sidebar */}
      <aside className="w-64 bg-[#081326] flex flex-col shrink-0 z-20 border-r border-[#122340]">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-[#081326] shadow-[0_0_15px_rgba(245,158,11,0.3)]">
            <Zap size={18} className="fill-current" />
          </div>
          <div>
            <div className="text-lg font-bold text-white tracking-wide">ISPlatty</div>
            <div className="text-[0.65rem] text-slate-400 uppercase tracking-widest font-semibold">Executive</div>
          </div>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 mt-4">
          {NAV.map(item => (
            <button
              key={item.label}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                item.active 
                  ? "bg-[#122340] text-amber-400" 
                  : "text-slate-400 hover:text-white hover:bg-[#0B1B33]"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        
        <div className="p-6 border-t border-[#122340]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-700 border-2 border-[#122340] overflow-hidden">
              <img src="https://api.dicebear.com/7.x/initials/svg?seed=Admin&backgroundColor=0B1B33" alt="Admin" className="w-full h-full object-cover" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">Admin User</div>
              <div className="text-xs text-slate-400">admin@ochola.net</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative flex flex-col">
        
        {/* Header Band */}
        <div className="bg-[#081326] pt-8 px-10 pb-28 shrink-0 relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')] opacity-20" style={{ maskImage: "linear-gradient(to bottom, white, transparent)", WebkitMaskImage: "linear-gradient(to bottom, white, transparent)" }}></div>
          <div className="relative z-10 flex justify-between items-end">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-amber-400 text-xs font-semibold tracking-wider uppercase mb-4 backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Live Status
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Performance Overview</h1>
              <p className="text-slate-400 mt-2 text-sm">Real-time network and revenue telemetry for today.</p>
            </div>
            <div className="text-right">
              <div className="text-slate-300 text-sm font-medium">Saturday, 25 July 2026</div>
              <div className="text-white text-xl font-semibold mt-1">10:42 AM EAT</div>
            </div>
          </div>
        </div>

        {/* Content Wrapper */}
        <div className="px-10 -mt-20 pb-12 relative z-10 flex-1 max-w-[1600px] w-full mx-auto space-y-6">
          
          {/* Hero Revenue Banner */}
          <div className="bg-white rounded-xl shadow-md shadow-slate-200/50 border border-slate-200 grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            {/* KPI 1 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Income Today</div>
                <div className="w-8 h-8 rounded bg-amber-50 text-amber-600 flex items-center justify-center">
                  <DollarSign size={16} />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#081326]">{fmtKsh(incomeToday)}</div>
              <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <ArrowUpRight size={14} /> <span>+12.5%</span> <span className="text-slate-400 font-normal">vs yesterday</span>
              </div>
            </div>
            
            {/* KPI 2 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">This Month</div>
                <div className="w-8 h-8 rounded bg-blue-50 text-blue-600 flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#081326]">{fmtKsh(incomeMonth)}</div>
              <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <ArrowUpRight size={14} /> <span>+8.2%</span> <span className="text-slate-400 font-normal">vs last month</span>
              </div>
            </div>

            {/* KPI 3 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Transactions</div>
                <div className="w-8 h-8 rounded bg-purple-50 text-purple-600 flex items-center justify-center">
                  <CreditCard size={16} />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#081326]">128</div>
              <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <ArrowUpRight size={14} /> <span>+4.1%</span> <span className="text-slate-400 font-normal">growth</span>
              </div>
            </div>

            {/* KPI 4 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Revenue</div>
                <div className="w-8 h-8 rounded bg-slate-50 text-slate-600 flex items-center justify-center">
                  <BarChart3 size={16} />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#081326]">{fmtKsh(totalRevenue)}</div>
              <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-slate-500">
                <span>All time accumulation</span>
              </div>
            </div>
          </div>

          {/* 2-Column Grid */}
          <div className="grid grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: Network & Health */}
            <div className="col-span-12 xl:col-span-7 space-y-6">
              
              {/* Quick Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Online Now
                  </div>
                  <div className="text-2xl font-bold text-[#081326]">37</div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> Vouchers Left
                  </div>
                  <div className="text-2xl font-bold text-[#081326]">14</div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500" /> Support Tickets
                  </div>
                  <div className="text-2xl font-bold text-[#081326]">2</div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" /> Routers Online
                  </div>
                  <div className="text-2xl font-bold text-[#081326]">{onlineRouters}/{routers.length}</div>
                </div>
              </div>

              {/* Network Health Card */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#081326] text-white flex items-center justify-center">
                      <Network size={16} />
                    </div>
                    <h2 className="text-lg font-bold text-[#081326]">Router Fleet Status</h2>
                  </div>
                  <div className="flex gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">{onlineRouters} Online</span>
                    <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 text-xs font-bold border border-rose-200">{routers.length - onlineRouters} Offline</span>
                  </div>
                </div>
                
                {/* Router Filter */}
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 overflow-x-auto">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Filter:</span>
                  <div className="flex gap-2">
                    {[{ key: "all" as const, label: "All Routers", online: null }, ...routers.map(r => ({ key: r.id, label: r.name, online: r.status === "online" }))].map(opt => {
                      const active = selectedRouter === opt.key;
                      return (
                        <button
                          key={String(opt.key)}
                          onClick={() => setSelectedRouter(opt.key)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                            active 
                              ? "bg-[#081326] text-white border-[#081326]" 
                              : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {opt.online !== null && <span className={`w-2 h-2 rounded-full ${opt.online ? "bg-emerald-500" : "bg-rose-500"}`} />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Router List */}
                <div className="p-5 flex flex-col gap-3">
                  {displayedRouters.map(router => {
                    const isOnline = router.status === "online";
                    return (
                      <div key={router.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`w-2 h-10 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
                          <div>
                            <div className="font-bold text-[#081326] flex items-center gap-2">
                              {router.name}
                              {isOnline 
                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 uppercase tracking-wider"><Wifi size={10} /> Online</span>
                                : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 uppercase tracking-wider"><WifiOff size={10} /> Offline</span>
                              }
                            </div>
                            <div className="text-sm font-medium text-slate-500 mt-1 flex items-center gap-2">
                              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{router.host}</span>
                              <span>•</span>
                              <span>{router.model}</span>
                              <span>•</span>
                              <span>ROS v{router.ros_version}</span>
                            </div>
                          </div>
                        </div>
                        {!isOnline && router.last_seen && (
                          <div className="text-right flex flex-col items-end">
                            <span className="text-xs font-semibold text-rose-600">Last seen</span>
                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Clock size={12} /> {new Date(router.last_seen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                        )}
                        {isOnline && (
                          <div className="text-right flex flex-col items-end">
                            <span className="text-xs font-semibold text-emerald-600">Healthy</span>
                            <span className="text-xs text-slate-500 mt-0.5">Uptime: 14d 6h</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Transactions Table */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h2 className="text-lg font-bold text-[#081326]">Recent Transactions</h2>
                  <button className="text-sm font-semibold text-amber-600 hover:text-amber-700">View All →</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100">
                        {["Ref", "Amount", "Method", "Status", "Date"].map(h => (
                          <th key={h} className="py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-5 text-sm font-mono text-slate-600">{tx.reference}</td>
                          <td className="py-3 px-5 text-sm font-bold text-[#081326]">KES {tx.amount.toLocaleString()}</td>
                          <td className="py-3 px-5">
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                              tx.payment_method === "mpesa" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                            }`}>
                              {tx.payment_method}
                            </span>
                          </td>
                          <td className="py-3 px-5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                              tx.status === "completed" ? "text-emerald-600" : "text-amber-600"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${tx.status === "completed" ? "bg-emerald-500" : "bg-amber-500"}`} />
                              {tx.status}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-xs font-medium text-slate-500 whitespace-nowrap">
                            {new Date(tx.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Charts & Analytics */}
            <div className="col-span-12 xl:col-span-5 space-y-6">
              
              {/* Payment Gateway Status */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[#081326]">M-Pesa Gateway</div>
                    <div className="text-xs text-slate-500 mt-0.5">STK Push is actively processing</div>
                  </div>
                </div>
                <div className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 uppercase tracking-wider">
                  Active
                </div>
              </div>

              {/* Monthly Growth Chart */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-base font-bold text-[#081326] mb-6">Subscriber Acquisition</h2>
                <div className="h-48 relative flex items-end justify-between gap-2 px-2">
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6">
                    {[30, 20, 10, 0].map(gridVal => (
                      <div key={gridVal} className="border-b border-slate-100 w-full flex items-end">
                        <span className="text-[10px] text-slate-400 font-medium -translate-y-2">{gridVal}</span>
                      </div>
                    ))}
                  </div>
                  {monthly.map((count, i) => {
                    const heightPct = (count / 30) * 100; // max Y axis is 30
                    return (
                      <div key={MONTHS[i]} className="flex flex-col items-center flex-1 z-10 group cursor-default">
                        <div className="w-full flex justify-center h-40 items-end pb-1 relative">
                          <div 
                            className="w-full max-w-[24px] bg-[#081326] rounded-t-sm transition-all duration-300 group-hover:bg-amber-500" 
                            style={{ height: `${heightPct}%` }}
                          />
                          {/* Tooltip on hover */}
                          <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-[#081326] text-white text-xs font-bold px-2 py-1 rounded shadow-lg pointer-events-none transition-opacity whitespace-nowrap">
                            {count} users
                          </div>
                        </div>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase mt-2">{MONTHS[i]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Composition Donut */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-base font-bold text-[#081326] mb-6">Network Composition</h2>
                
                <div className="flex items-center gap-8">
                  {/* SVG Donut */}
                  <div className="relative w-32 h-32 shrink-0">
                    <svg viewBox="0 0 160 160" className="w-full h-full transform -rotate-90">
                      <circle cx="80" cy="80" r="64" fill="none" stroke="#F1F5F9" strokeWidth="24" />
                      {(() => {
                        const total = userInsights.reduce((a, b) => a + b.count, 0);
                        const r = 64;
                        const circ = 2 * Math.PI * r;
                        let offset = 0;
                        return userInsights.map((seg, i) => {
                          const val = (seg.count / total) * circ;
                          const currOffset = offset;
                          offset += val;
                          return (
                            <circle
                              key={seg.label}
                              cx="80" cy="80" r="64"
                              fill="none"
                              stroke={seg.color}
                              strokeWidth="24"
                              strokeDasharray={`${val} ${circ - val}`}
                              strokeDashoffset={-currOffset}
                              className="transition-all duration-500 hover:stroke-[28px] cursor-pointer"
                            />
                          );
                        });
                      })()}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-2xl font-extrabold text-[#081326] leading-none">
                        {userInsights.reduce((a, b) => a + b.count, 0)}
                      </div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase mt-1">Total</div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="flex flex-col gap-4 flex-1">
                    {userInsights.map(seg => {
                      const total = userInsights.reduce((a, b) => a + b.count, 0);
                      const pct = Math.round((seg.count / total) * 100);
                      return (
                        <div key={seg.label} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: seg.color }} />
                            <span className="text-sm font-semibold text-slate-600">{seg.label}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-[#081326]">{seg.count}</span>
                            <span className="text-xs font-semibold text-slate-400 w-8 text-right">{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
              
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
