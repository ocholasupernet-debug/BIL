import React from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { useIsps } from "@/hooks/use-mock-api";
import { Building, TrendingUp, Key, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SuperAdminDashboard() {
  const { data: isps = [] } = useIsps();

  return (
    <SuperAdminLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Platform Overview</h1>
          <p className="text-indigo-300 mt-1">OcholaSupernet Global Command Center</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard label="Total ISPs" value="28" color="indigo" subValue="3 pending approval" />
          <StatCard label="Active Licenses" value="25" color="violet" subValue="2 expiring soon" />
          <StatCard label="Platform Revenue" value="KES 140k" color="green" subValue="This month" />
          <StatCard label="Total End Users" value="3,842" color="blue" subValue="Across all platforms" />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-800/50 border border-white/10 rounded-3xl p-6 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Building className="text-indigo-400" /> Registered ISPs
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-slate-400 text-xs uppercase font-semibold border-b border-white/10">
                  <tr>
                    <th className="pb-4 font-medium">ISP Name</th>
                    <th className="pb-4 font-medium">Customers</th>
                    <th className="pb-4 font-medium">Revenue</th>
                    <th className="pb-4 font-medium">Status</th>
                    <th className="pb-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isps.map(isp => (
                    <tr key={isp.id} className="hover:bg-white/5 transition-colors group">
                      <td className="py-4">
                        <p className="font-bold text-white group-hover:text-indigo-300 transition-colors">{isp.name}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{isp.slug}.isplatty.org</p>
                      </td>
                      <td className="py-4 text-slate-300">{isp.customers}</td>
                      <td className="py-4 font-semibold text-emerald-400">KES {isp.revenue.toLocaleString()}</td>
                      <td className="py-4">
                        <Badge variant={isp.status === 'active' ? 'success' : 'warning'}>{isp.status}</Badge>
                      </td>
                      <td className="py-4 text-right">
                        <button className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-indigo-300 transition-colors">
                          Impersonate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-white/10 rounded-3xl p-6 backdrop-blur-xl flex flex-col">
            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Activity className="text-indigo-400" /> System Activity
            </h3>
            <div className="flex-1 space-y-4">
              {[
                { action: "FastNet Kenya approved", time: "10:12 AM", type: "success" },
                { action: "Generated new license key", time: "09:55 AM", type: "info" },
                { type: "warning", action: "Server CPU spike detected", time: "08:30 AM" },
                { type: "info", action: "System backup completed", time: "02:00 AM" }
              ].map((log, i) => (
                <div key={i} className="flex gap-3 items-start pb-4 border-b border-white/5 last:border-0">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${log.type === 'success' ? 'bg-emerald-400' : log.type === 'warning' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-200">{log.action}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{log.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
              View All Logs
            </button>
          </div>
        </div>

      </div>
    </SuperAdminLayout>
  );
}
