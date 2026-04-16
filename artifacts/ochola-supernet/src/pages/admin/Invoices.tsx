import React, { useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  FileText, Search, Download, Eye, Send,
  CheckCircle2, Clock, AlertTriangle, X, Printer,
  DollarSign, TrendingUp,
} from "lucide-react";

interface Invoice {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  plan_name: string;
  amount: number;
  tax: number;
  total: number;
  status: "paid" | "unpaid" | "overdue" | "cancelled";
  invoice_number: string;
  created_at: string;
  due_date: string;
  paid_date: string | null;
  payment_method: string | null;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  paid:      { label: "Paid",      color: "#34d399", bg: "rgba(16,185,129,0.12)", icon: <CheckCircle2 size={11} /> },
  unpaid:    { label: "Unpaid",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: <Clock size={11} /> },
  overdue:   { label: "Overdue",   color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: <AlertTriangle size={11} /> },
  cancelled: { label: "Cancelled", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", icon: <X size={11} /> },
};

function generateDemoInvoices(): Invoice[] {
  const names = ["John Kamau", "Mary Wanjiku", "Peter Ochieng", "Sarah Akinyi", "David Mwangi", "Grace Njeri", "James Kiprop", "Lucy Adhiambo"];
  const plans = ["Silver 5Mbps", "Gold 10Mbps", "Platinum 20Mbps", "Basic 2Mbps", "Enterprise 50Mbps"];
  const statuses: Invoice["status"][] = ["paid", "paid", "paid", "unpaid", "unpaid", "overdue", "paid", "cancelled"];
  const methods = ["M-Pesa", "Cash", "Bank Transfer", null];

  return names.map((name, i) => {
    const price = [500, 1000, 2000, 300, 5000][i % 5];
    const tax = Math.round(price * 0.16);
    const created = new Date(Date.now() - (i * 3 + 1) * 86400000);
    const due = new Date(created.getTime() + 7 * 86400000);
    const status = statuses[i];
    return {
      id: `inv-${i + 1}`,
      customer_name: name,
      customer_email: `${name.split(" ")[0].toLowerCase()}@example.com`,
      customer_phone: `07${String(10000000 + Math.floor(Math.random() * 89999999))}`,
      plan_name: plans[i % plans.length],
      amount: price,
      tax,
      total: price + tax,
      status,
      invoice_number: `INV-${String(1000 + i).padStart(6, "0")}`,
      created_at: created.toISOString(),
      due_date: due.toISOString(),
      paid_date: status === "paid" ? new Date(created.getTime() + Math.random() * 5 * 86400000).toISOString() : null,
      payment_method: status === "paid" ? methods[i % methods.length] : null,
    };
  });
}

function fmtDate(d?: string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtMoney(n: number) {
  return `KES ${n.toLocaleString()}`;
}

function InvoicePreview({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--isp-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--isp-text)", margin: 0 }}>Invoice {invoice.invoice_number}</h2>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "6px", cursor: "pointer", color: "var(--isp-text-muted)" }}><X size={16} /></button>
          </div>
        </div>
        <div style={{ padding: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <p style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", textTransform: "uppercase", fontWeight: 700, margin: "0 0 4px" }}>Bill To</p>
              <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>{invoice.customer_name}</p>
              <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: "2px 0" }}>{invoice.customer_email}</p>
              <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>{invoice.customer_phone}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", textTransform: "uppercase", fontWeight: 700, margin: "0 0 4px" }}>Invoice Details</p>
              <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: "2px 0" }}>Date: {fmtDate(invoice.created_at)}</p>
              <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: "2px 0" }}>Due: {fmtDate(invoice.due_date)}</p>
              {invoice.paid_date && <p style={{ fontSize: "0.78rem", color: "#34d399", margin: "2px 0" }}>Paid: {fmtDate(invoice.paid_date)}</p>}
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--isp-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" }}>Description</th>
                <th style={{ textAlign: "right", padding: "8px 0", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--isp-border)" }}>
                <td style={{ padding: "10px 0" }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--isp-text)", margin: 0 }}>{invoice.plan_name}</p>
                  <p style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", margin: "2px 0 0" }}>Monthly Internet Subscription</p>
                </td>
                <td style={{ textAlign: "right", fontSize: "0.85rem", color: "var(--isp-text)", fontWeight: 600 }}>{fmtMoney(invoice.amount)}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--isp-border)" }}>
                <td style={{ padding: "10px 0", fontSize: "0.82rem", color: "var(--isp-text-muted)" }}>VAT (16%)</td>
                <td style={{ textAlign: "right", fontSize: "0.82rem", color: "var(--isp-text-muted)" }}>{fmtMoney(invoice.tax)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td style={{ padding: "12px 0", fontSize: "0.95rem", fontWeight: 800, color: "var(--isp-text)" }}>Total</td>
                <td style={{ textAlign: "right", fontSize: "0.95rem", fontWeight: 800, color: "var(--isp-accent)" }}>{fmtMoney(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>

          {invoice.payment_method && (
            <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: "0 0 1rem" }}>
              Payment Method: <strong style={{ color: "var(--isp-text)" }}>{invoice.payment_method}</strong>
            </p>
          )}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={{ flex: 1, padding: "0.6rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Printer size={14} /> Print
            </button>
            <button style={{ flex: 1, padding: "0.6rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Download size={14} /> Download PDF
            </button>
            <button style={{ flex: 1, padding: "0.6rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)", color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Send size={14} /> Email
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [preview, setPreview] = useState<Invoice | null>(null);

  const invoices = useMemo(() => generateDemoInvoices(), []);

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return inv.customer_name.toLowerCase().includes(q) ||
               inv.invoice_number.toLowerCase().includes(q) ||
               inv.plan_name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [invoices, search, statusFilter]);

  const stats = useMemo(() => {
    const total = invoices.reduce((s, i) => s + i.total, 0);
    const paid = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0);
    const unpaid = invoices.filter(i => i.status === "unpaid" || i.status === "overdue").reduce((s, i) => s + i.total, 0);
    return { total, paid, unpaid, count: invoices.length };
  }, [invoices]);

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--isp-text)", margin: 0 }}>Invoices</h1>
            <p style={{ fontSize: "0.82rem", color: "var(--isp-text-muted)", margin: "4px 0 0" }}>Generate and manage customer invoices</p>
          </div>
          <button style={{ padding: "0.55rem 1.25rem", borderRadius: 10, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <FileText size={14} /> Generate Invoice
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { label: "Total Invoices", value: stats.count, icon: <FileText size={18} />, color: "var(--isp-accent)" },
            { label: "Total Revenue", value: fmtMoney(stats.total), icon: <DollarSign size={18} />, color: "#34d399" },
            { label: "Collected", value: fmtMoney(stats.paid), icon: <TrendingUp size={18} />, color: "var(--isp-accent)" },
            { label: "Outstanding", value: fmtMoney(stats.unpaid), icon: <AlertTriangle size={18} />, color: "#f59e0b" },
          ].map((s, i) => (
            <div key={i} style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center", color: s.color }}>{s.icon}</div>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" }}>{s.label}</span>
              </div>
              <p style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--isp-text)", margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search invoices..."
              style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem 0.55rem 2rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.82rem", fontFamily: "inherit" }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "0.55rem 1rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.82rem", fontFamily: "inherit" }}>
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--isp-border)" }}>
                {["Invoice #", "Customer", "Plan", "Amount", "Status", "Date", "Due", "Actions"].map(h => (
                  <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const sm = STATUS_META[inv.status];
                return (
                  <tr key={inv.id} style={{ borderBottom: "1px solid var(--isp-border)" }}>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.82rem", fontWeight: 700, color: "var(--isp-accent)", fontFamily: "monospace" }}>{inv.invoice_number}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--isp-text)", margin: 0 }}>{inv.customer_name}</p>
                      <p style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", margin: "1px 0 0" }}>{inv.customer_email}</p>
                    </td>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.82rem", color: "var(--isp-text)" }}>{inv.plan_name}</td>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.82rem", fontWeight: 700, color: "var(--isp-text)" }}>{fmtMoney(inv.total)}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: sm.bg, color: sm.color, fontSize: "0.72rem", fontWeight: 700 }}>
                        {sm.icon} {sm.label}
                      </span>
                    </td>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>{fmtDate(inv.created_at)}</td>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>{fmtDate(inv.due_date)}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setPreview(inv)} style={{ padding: "5px 8px", borderRadius: 6, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", color: "var(--isp-accent)", cursor: "pointer" }} title="View">
                          <Eye size={13} />
                        </button>
                        <button style={{ padding: "5px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer" }} title="Download">
                          <Download size={13} />
                        </button>
                        <button style={{ padding: "5px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer" }} title="Send Email">
                          <Send size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>No invoices found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {preview && <InvoicePreview invoice={preview} onClose={() => setPreview(null)} />}
      </div>
    </AdminLayout>
  );
}
