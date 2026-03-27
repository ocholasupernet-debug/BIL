import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/badge";
import { supabase, ADMIN_ID, type DbCustomer } from "@/lib/supabase";
import { Search, Plus, Edit, Trash, Download, Loader2, Users } from "lucide-react";

async function fetchCustomers(): Promise<DbCustomer[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function initials(name?: string): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

const AVATAR_COLORS = ["#06b6d4","#8b5cf6","#f59e0b","#10b981","#ec4899","#f87171","#60a5fa"];
function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }

function fmtExpiry(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Customers() {
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["isp_customers"],
    queryFn: fetchCustomers,
    refetchInterval: 60_000,
  });

  const [searchTerm,    setSearchTerm]    = useState("");
  const [filterStatus,  setFilterStatus]  = useState("all");
  const [filterPlanType,setFilterPlanType]= useState("all");

  const total   = customers.length;
  const active  = customers.filter(c => (c.status ?? "active") === "active").length;
  const expired = customers.filter(c => c.status === "expired").length;

  const filtered = useMemo(() => {
    return customers.filter(c => {
      const term = searchTerm.toLowerCase();
      const matchSearch = !searchTerm ||
        (c.name ?? "").toLowerCase().includes(term) ||
        (c.username ?? "").toLowerCase().includes(term) ||
        (c.phone ?? "").includes(searchTerm) ||
        (c.ip_address ?? "").includes(searchTerm);
      const matchStatus = filterStatus === "all" || (c.status ?? "active") === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [customers, searchTerm, filterStatus]);

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:bg-white/10 transition flex items-center gap-2">
              <Download className="w-4 h-4" /> Export
            </button>
            <button className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 transition flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Customer
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Customers" value={String(total)}   color="cyan"  />
          <StatCard label="Active"          value={String(active)}  color="green" />
          <StatCard label="Expired"         value={String(expired)} color="red"   />
          <StatCard label="Online Now"      value="—"               color="amber" />
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-background/50">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search customers…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-background border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary w-full sm:w-auto">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
              </select>
              <select value={filterPlanType} onChange={e => setFilterPlanType(e.target.value)}
                className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary w-full sm:w-auto">
                <option value="all">All Plans</option>
                <option value="hotspot">Hotspot</option>
                <option value="pppoe">PPPoE</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-background/80 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                <tr>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Contact</th>
                  <th className="px-6 py-4">IP Address</th>
                  <th className="px-6 py-4">Expiry</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading customers…
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-muted-foreground">
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                        <Users size={40} style={{ opacity: 0.2 }} />
                        <div>
                          <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                            {customers.length === 0 ? "No customers yet" : "No customers match your search"}
                          </p>
                          <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                            {customers.length === 0 ? "Customers will appear here once they connect through your hotspot or PPPoE." : "Try adjusting your search or filters."}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map((c) => {
                  const color = avatarColor(c.id);
                  const displayName  = (c.name ?? c.username ?? `User #${c.id}`);
                  const statusVal    = (c.status ?? "active") as string;
                  return (
                    <tr key={c.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                            style={{ backgroundColor: `${color}22`, color }}>
                            {initials(displayName)}
                          </div>
                          <span className="font-semibold text-foreground">{displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-muted-foreground text-xs">
                        {c.phone ?? c.email ?? "—"}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs font-mono text-primary">{(c.ip_address as string) ?? "—"}</p>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">{fmtExpiry(c.expiry_date as string | null)}</td>
                      <td className="px-6 py-4">
                        <Badge variant={statusVal === "active" ? "success" : statusVal === "expired" ? "danger" : "warning"}>
                          {statusVal}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="p-1.5 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-cyan-400/10 transition"><Edit className="w-4 h-4" /></button>
                          <button className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-400/10 transition"><Trash className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!isLoading && (
            <div className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
              {filtered.length} of {customers.length} customer{customers.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
