import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/badge";
import { supabase, type DbTransaction } from "@/lib/supabase";
import { Search, Download, Loader2 } from "lucide-react";

async function fetchTransactions(): Promise<DbTransaction[]> {
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtKsh(n: number) {
  return `Ksh ${n.toLocaleString()}`;
}

export default function Transactions() {
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["isp_transactions"],
    queryFn: fetchTransactions,
    refetchInterval: 30_000,
  });

  const [searchTerm,  setSearchTerm]  = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");

  /* ─── Totals ─── */
  const totalRevenue = useMemo(() =>
    transactions.filter(t => t.status === "completed").reduce((s, t) => s + t.amount, 0),
    [transactions]);

  const now = new Date();
  const thisMonth = useMemo(() =>
    transactions.filter(t => {
      const d = new Date(t.created_at);
      return t.status === "completed" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, t) => s + t.amount, 0),
    [transactions]);

  const today = useMemo(() =>
    transactions.filter(t => {
      const d = new Date(t.created_at);
      return t.status === "completed" && d.toDateString() === now.toDateString();
    }).reduce((s, t) => s + t.amount, 0),
    [transactions]);

  /* ─── Filter ─── */
  const filtered = useMemo(() => {
    return transactions.filter(t => {
      const matchSearch = !searchTerm ||
        t.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.notes ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(t.id).includes(searchTerm);
      const matchStatus = filterStatus === "all" || t.status === filterStatus;
      const matchMethod = filterMethod === "all" || t.payment_method.toLowerCase() === filterMethod;
      return matchSearch && matchStatus && matchMethod;
    });
  }, [transactions, searchTerm, filterStatus, filterMethod]);

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
          <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:bg-white/10 transition flex items-center gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Total Revenue"  value={fmtKsh(totalRevenue)} color="green" subValue="All completed" />
          <StatCard label="This Month"     value={fmtKsh(thisMonth)}    color="cyan"  subValue={now.toLocaleString("en-KE", { month: "long", year: "numeric" })} />
          <StatCard label="Today"          value={fmtKsh(today)}        color="amber" subValue={now.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })} />
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-background/50">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by ID or reference…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-background border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary">
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
              <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)}
                className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary">
                <option value="all">All Methods</option>
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-background/80 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                <tr>
                  <th className="px-6 py-4">ID</th>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Method</th>
                  <th className="px-6 py-4">Notes</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading transactions…
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      {transactions.length === 0 ? "No transactions yet." : "No transactions match your search."}
                    </td>
                  </tr>
                ) : filtered.map((tx) => (
                  <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground font-mono">#{tx.id}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{tx.reference || "—"}</td>
                    <td className="px-6 py-4 font-bold text-emerald-400">{fmtKsh(tx.amount)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-bold uppercase tracking-wider ${tx.payment_method === "mpesa" ? "text-emerald-400" : "text-slate-400"}`}>
                        {tx.payment_method}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-xs">{tx.notes || "—"}</td>
                    <td className="px-6 py-4">
                      <Badge variant={tx.status === "completed" ? "success" : tx.status === "pending" ? "warning" : "danger"}>
                        {tx.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap text-xs">{fmtDate(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isLoading && (
            <div className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
