import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/badge";
import { useTransactions, MOCK_TRANSACTIONS } from "@/hooks/use-mock-api";
import { Search, Download, Calendar } from "lucide-react";

export default function Transactions() {
  const { data: transactions = MOCK_TRANSACTIONS } = useTransactions();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredTx = transactions.filter(t => 
    t.customer.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.ref.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
          <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:bg-white/10 transition flex items-center gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Total Revenue" value="Ksh 248,300" color="green" subValue="All time" />
          <StatCard label="This Month" value="Ksh 48,500" color="cyan" subValue="March 2026" />
          <StatCard label="Today" value="Ksh 12,500" color="amber" subValue="24 Mar 2026" />
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-background/50">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text"
                placeholder="Search by customer or reference..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-background border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <select className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary">
                <option>All Status</option>
                <option>Completed</option>
                <option>Pending</option>
              </select>
              <select className="bg-background border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-primary">
                <option>All Methods</option>
                <option>M-Pesa</option>
                <option>Cash</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-background/80 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                <tr>
                  <th className="px-6 py-4">ID</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Plan</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Method</th>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTx.map((tx) => (
                  <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground font-mono">#{tx.id}</td>
                    <td className="px-6 py-4 font-bold text-foreground">{tx.customer}</td>
                    <td className="px-6 py-4 text-slate-300">{tx.plan}</td>
                    <td className="px-6 py-4 font-bold text-emerald-400">Ksh {tx.amount}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-bold uppercase tracking-wider ${tx.method === 'mpesa' ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {tx.method}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{tx.ref}</td>
                    <td className="px-6 py-4">
                      <Badge variant={tx.status === 'completed' ? 'success' : tx.status === 'pending' ? 'warning' : 'danger'}>
                        {tx.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">{tx.date}</td>
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
