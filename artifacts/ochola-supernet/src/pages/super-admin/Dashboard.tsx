import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import {
  Users, Router, BarChart3, Activity, CheckCircle2, XCircle,
  TrendingUp, Globe, Loader2,
} from "lucide-react";

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon: Icon, loading }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ElementType; loading?: boolean;
}) {
  return (
    <div className="bg-white/[0.04] border border-indigo-500/15 rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[0.68rem] font-bold text-slate-500 uppercase tracking-widest m-0">
            {label}
          </p>
          <p className="text-[1.75rem] font-extrabold text-white mt-1.5 leading-none">
            {loading
              ? <Loader2 size={22} className="animate-spin" style={{ color }} />
              : value}
          </p>
          {sub && <p className="text-[0.7rem] text-slate-400 mt-1">{sub}</p>}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

/* ── Status Badge ────────────────────────────────────────────── */
function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.68rem] font-bold bg-green-400/10 text-green-400 border border-green-400/25">
      <CheckCircle2 size={10} /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.68rem] font-bold bg-red-400/10 text-red-400 border border-red-400/25">
      <XCircle size={10} /> Inactive
    </span>
  );
}

/* ── Main Page ───────────────────────────────────────────────── */
export default function SuperAdminDashboard() {
  const { data: admins = [], isLoading: loadingAdmins } = useQuery({
    queryKey: ["sa_all_admins"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_admins")
        .select("id,name,username,email,is_active,subdomain,role,created_at")
        .order("id");
      return data ?? [];
    },
  });

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["sa_all_routers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,admin_id")
        .order("id");
      return data ?? [];
    },
  });

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["sa_all_customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_customers")
        .select("id,admin_id,is_active")
        .order("id");
      return data ?? [];
    },
  });

  const { data: plans = [], isLoading: loadingPlans } = useQuery({
    queryKey: ["sa_all_plans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_plans")
        .select("id,admin_id,type")
        .order("id");
      return data ?? [];
    },
  });

  const topAdmins      = admins.slice(0, 8);
  const onlineRouters  = routers.filter(r => r.status === "online" || r.status === "active").length;
  const activeAdmins   = admins.filter(a => a.is_active).length;
  const activeCustomers = customers.filter(c => c.is_active !== false).length;

  const healthItems = [
    { label: "Database",   value: "Healthy"     },
    { label: "API Server", value: "Running"     },
    { label: "RADIUS",     value: "Active"      },
    { label: "Backups",    value: "Up to date"  },
  ];

  return (
    <SuperAdminLayout>
      <div className="max-w-[1200px]">

        {/* ── Header ── */}
        <div className="mb-7">
          <h1 className="text-2xl font-extrabold text-white m-0">Platform Overview</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Real-time view of all ISPs, routers, and customers on the platform.
          </p>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 mb-7">
          <StatCard label="Total ISP Admins" value={admins.length}    sub={`${activeAdmins} active`}    color="#6366f1" icon={Users}    loading={loadingAdmins}    />
          <StatCard label="Total Routers"    value={routers.length}   sub={`${onlineRouters} online`}   color="#8b5cf6" icon={Router}   loading={loadingRouters}   />
          <StatCard label="Total Customers"  value={customers.length} sub={`${activeCustomers} active`} color="#06b6d4" icon={Globe}    loading={loadingCustomers} />
          <StatCard label="Total Plans"      value={plans.length}     sub="across all ISPs"             color="#f59e0b" icon={BarChart3} loading={loadingPlans}     />
        </div>

        {/* ── Two-column body ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-5">

          {/* ── Admins Table ── */}
          <div className="bg-white/[0.04] border border-indigo-500/15 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="px-6 py-[18px] border-b border-indigo-500/15 flex items-center gap-2">
              <Users size={16} className="text-indigo-400" />
              <span className="font-bold text-white text-[0.9rem]">Registered ISP Admins</span>
              <span className="ml-auto bg-indigo-500/15 text-indigo-400 text-[0.7rem] font-bold px-2 py-0.5 rounded-xl">
                {admins.length}
              </span>
            </div>

            {loadingAdmins ? (
              <div className="p-10 text-center text-slate-500">
                <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                <p className="m-0 text-sm">Loading admins…</p>
              </div>
            ) : topAdmins.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-sm">
                No admins registered yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.8rem]">
                  <thead>
                    <tr className="border-b border-indigo-500/15">
                      {["Name", "Username", "Subdomain", "Role", "Status"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold text-[0.65rem] uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topAdmins.map(a => (
                      <tr key={a.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
                              <span className="text-[0.62rem] font-extrabold text-white">
                                {(a.name || a.username || "?")[0].toUpperCase()}
                              </span>
                            </div>
                            <span className="font-bold text-white">{a.name || a.username}</span>
                          </div>
                        </td>
                        {/* Username */}
                        <td className="px-4 py-3 text-slate-400 font-mono">{a.username}</td>
                        {/* Subdomain */}
                        <td className="px-4 py-3">
                          {a.subdomain
                            ? <span className="font-mono text-[0.72rem] text-indigo-400">{a.subdomain}.isplatty.org</span>
                            : <span className="text-slate-600 text-[0.72rem]">—</span>
                          }
                        </td>
                        {/* Role */}
                        <td className="px-4 py-3">
                          <span className="bg-violet-500/10 text-violet-300 px-2 py-0.5 rounded-xl text-[0.68rem] font-bold">
                            {a.role || "admin"}
                          </span>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge active={a.is_active !== false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Right Column ── */}
          <div className="flex flex-col gap-4">

            {/* Router Status */}
            <div className="bg-white/[0.04] border border-indigo-500/15 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Router size={15} className="text-indigo-400" />
                <span className="font-bold text-white text-[0.85rem]">Router Status</span>
              </div>

              {loadingRouters ? (
                <p className="text-slate-500 text-sm text-center">Loading…</p>
              ) : routers.length === 0 ? (
                <p className="text-slate-500 text-sm text-center">No routers found.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {routers.slice(0, 6).map(r => {
                    const isOnline = r.status === "online" || r.status === "active";
                    return (
                      <div key={r.id} className="flex items-center justify-between">
                        <span className="text-[0.78rem] text-slate-400 font-mono">{r.name}</span>
                        <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${
                          isOnline
                            ? "bg-green-400/10 text-green-400"
                            : "bg-indigo-500/10 text-indigo-400"
                        }`}>
                          {r.status || "unknown"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Platform Health */}
            <div className="bg-white/[0.04] border border-indigo-500/15 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity size={15} className="text-indigo-400" />
                <span className="font-bold text-white text-[0.85rem]">Platform Health</span>
              </div>

              <div className="flex flex-col divide-y divide-white/[0.04]">
                {healthItems.map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2.5">
                    <span className="text-[0.78rem] text-slate-400">{item.label}</span>
                    <span className="text-[0.72rem] font-bold text-green-400">{item.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5 mt-3">
                <TrendingUp size={13} className="text-green-400" />
                <span className="text-[0.72rem] text-green-400 font-semibold">All systems operational</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </SuperAdminLayout>
  );
}
