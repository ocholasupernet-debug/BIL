import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/badge";
import { useCustomers, MOCK_CUSTOMERS } from "@/hooks/use-mock-api";
import { Search, Plus, MoreHorizontal, Edit, Trash, Download } from "lucide-react";

export default function Customers() {
  const { data: customers = MOCK_CUSTOMERS, isLoading } = useCustomers();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.phone?.includes(searchTerm) || 
    c.ip?.includes(searchTerm)
  );

  return (
    <AdminLayout>
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Customers" value="72" color="cyan" />
          <StatCard label="Active" value="47" color="green" />
          <StatCard label="Expired" value="12" color="red" />
          <StatCard label="Hotspot / PPPoE" value="28 / 44" color="amber" />
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-background/50">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text"
                placeholder="Search customers..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-background border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <select className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary w-full sm:w-auto">
                <option>All Status</option>
                <option>Active</option>
                <option>Expired</option>
              </select>
              <select className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary w-full sm:w-auto">
                <option>All Plans</option>
                <option>Hotspot</option>
                <option>PPPoE</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-background/80 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                <tr>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Contact</th>
                  <th className="px-6 py-4">Plan & IP</th>
                  <th className="px-6 py-4">Expiry</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs" style={{ backgroundColor: `${c.color}22`, color: c.color }}>
                          {c.initials}
                        </div>
                        <span className="font-semibold text-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">{c.phone}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-foreground">{c.plan}</p>
                      <p className="text-xs font-mono text-primary mt-0.5">{c.ip}</p>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{c.expiry}</td>
                    <td className="px-6 py-4">
                      <Badge variant={c.status === 'Active' ? 'success' : c.status === 'Expired' ? 'danger' : 'warning'}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button className="p-1.5 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-cyan-400/10 transition"><Edit className="w-4 h-4" /></button>
                        <button className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-400/10 transition"><Trash className="w-4 h-4" /></button>
                      </div>
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
