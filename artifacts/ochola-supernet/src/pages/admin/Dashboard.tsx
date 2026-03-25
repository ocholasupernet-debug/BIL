import React from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Wifi, Users, Router, Activity, ShieldCheck, ShieldAlert } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MOCK_TRANSACTIONS } from "@/hooks/use-mock-api";

const data = [
  { name: 'Oct', value: 8 },
  { name: 'Nov', value: 14 },
  { name: 'Dec', value: 11 },
  { name: 'Jan', value: 18 },
  { name: 'Feb', value: 22 },
  { name: 'Mar', value: 15 },
];

export default function Dashboard() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        
        {/* Routers Status Banner */}
        <div className="bg-card border border-border rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Router className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Router Status Overview</h3>
              <p className="text-xs text-muted-foreground">All core routers are responding</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            <div className="flex-1 md:flex-none bg-background border border-border rounded-xl p-3 px-4 flex items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold text-foreground">Router 01 - HQ</p>
                <div className="flex items-center gap-2 mt-1 text-[10px]">
                  <span className="text-emerald-400 font-bold">● 47 Online</span>
                  <span className="text-muted-foreground">Up 14d</span>
                </div>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="flex-1 md:flex-none bg-background border border-border rounded-xl p-3 px-4 flex items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold text-foreground">Router 02 - Karen</p>
                <div className="flex items-center gap-2 mt-1 text-[10px]">
                  <span className="text-emerald-400 font-bold">● 23 Online</span>
                  <span className="text-muted-foreground">Up 7d</span>
                </div>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Income Today" value="Ksh 12,500" color="cyan" trend="+14%" trendUp={true} />
          <StatCard label="Income This Month" value="Ksh 248,300" color="green" trend="+5%" trendUp={true} />
          <StatCard label="Total Users" value="72" color="violet" subValue="47 Active / 12 Expired" />
          <StatCard label="Online Now" value="47" color="amber" subValue="29 PPPoE / 18 Hotspot" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm p-5">
            <h3 className="font-bold text-foreground mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Customer Growth
            </h3>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111820', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    itemStyle={{ color: '#06b6d4' }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={3} dot={{ fill: '#06b6d4', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent TXs */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h3 className="font-bold text-foreground">Recent Payments</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {MOCK_TRANSACTIONS.map((tx, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{tx.customer}</p>
                    <p className="text-xs text-muted-foreground">{tx.plan}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400">Ksh {tx.amount}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">{tx.method}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
