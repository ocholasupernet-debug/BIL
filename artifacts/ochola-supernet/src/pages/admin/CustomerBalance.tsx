import React, { useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Wallet, Search, ArrowUpRight, ArrowDownRight,
  Users, DollarSign, TrendingUp, ArrowRightLeft, X, Plus, Minus,
  Loader2, CheckCircle2,
} from "lucide-react";

interface CustomerWallet {
  id: number;
  name: string;
  username: string;
  phone: string;
  balance: number;
  last_topup: string | null;
  total_spent: number;
}

interface Transaction {
  id: number;
  customer_name: string;
  type: "topup" | "deduction" | "transfer" | "payment";
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

function generateDemoData() {
  const customers: CustomerWallet[] = [
    { id: 1, name: "John Kamau", username: "jkamau4521", phone: "0712345678", balance: 1500, last_topup: new Date(Date.now() - 2 * 86400000).toISOString(), total_spent: 8500 },
    { id: 2, name: "Mary Wanjiku", username: "mwanjiku7890", phone: "0723456789", balance: 350, last_topup: new Date(Date.now() - 5 * 86400000).toISOString(), total_spent: 12000 },
    { id: 3, name: "Peter Ochieng", username: "pochieng3456", phone: "0734567890", balance: 0, last_topup: null, total_spent: 3000 },
    { id: 4, name: "Sarah Akinyi", username: "sakinyi1234", phone: "0745678901", balance: 2800, last_topup: new Date(Date.now() - 1 * 86400000).toISOString(), total_spent: 15000 },
    { id: 5, name: "David Mwangi", username: "dmwangi5678", phone: "0756789012", balance: 750, last_topup: new Date(Date.now() - 10 * 86400000).toISOString(), total_spent: 6000 },
  ];

  const transactions: Transaction[] = [
    { id: 1, customer_name: "Sarah Akinyi", type: "topup", amount: 2000, balance_after: 2800, description: "M-Pesa top-up", created_at: new Date(Date.now() - 1 * 86400000).toISOString() },
    { id: 2, customer_name: "John Kamau", type: "payment", amount: -1000, balance_after: 1500, description: "Plan renewal: Gold 10Mbps", created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 3, customer_name: "John Kamau", type: "topup", amount: 2500, balance_after: 2500, description: "Cash deposit at office", created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 4, customer_name: "Mary Wanjiku", type: "deduction", amount: -650, balance_after: 350, description: "Admin deduction - overpayment correction", created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 5, customer_name: "David Mwangi", type: "transfer", amount: -250, balance_after: 750, description: "Transfer to Mary Wanjiku", created_at: new Date(Date.now() - 4 * 86400000).toISOString() },
    { id: 6, customer_name: "Mary Wanjiku", type: "transfer", amount: 250, balance_after: 1000, description: "Received from David Mwangi", created_at: new Date(Date.now() - 4 * 86400000).toISOString() },
  ];

  return { customers, transactions };
}

function fmtDate(d?: string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtMoney(n: number) {
  return `KES ${Math.abs(n).toLocaleString()}`;
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  topup:     { label: "Top Up",     color: "#34d399", icon: <ArrowDownRight size={12} /> },
  deduction: { label: "Deduction",  color: "#f87171", icon: <ArrowUpRight size={12} /> },
  transfer:  { label: "Transfer",   color: "var(--isp-accent)", icon: <ArrowRightLeft size={12} /> },
  payment:   { label: "Payment",    color: "#f59e0b", icon: <DollarSign size={12} /> },
};

function BalanceActionModal({ customer, onClose }: { customer: CustomerWallet; onClose: () => void }) {
  const [action, setAction] = useState<"topup" | "deduct" | "transfer">("topup");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = () => {
    if (!amount || Number(amount) <= 0) return;
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setDone(true);
      setTimeout(onClose, 1200);
    }, 800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--isp-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: "1rem", fontWeight: 800, color: "var(--isp-text)", margin: 0 }}>Balance Action</h3>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "2px 0 0" }}>{customer.name} — Current: KES {customer.balance.toLocaleString()}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["topup", "deduct", "transfer"] as const).map(a => (
              <button key={a} onClick={() => setAction(a)} style={{
                flex: 1, padding: "0.5rem", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                background: action === a ? "var(--isp-accent-glow)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${action === a ? "var(--isp-accent-border)" : "var(--isp-border)"}`,
                color: action === a ? "var(--isp-accent)" : "var(--isp-text-muted)",
              }}>
                {a === "topup" ? <><Plus size={12} /> Add</> : a === "deduct" ? <><Minus size={12} /> Deduct</> : <><ArrowRightLeft size={12} /> Transfer</>}
              </button>
            ))}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Amount (KES)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500"
              style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.85rem", fontFamily: "inherit" }} />
          </div>

          {action === "transfer" && (
            <div>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Transfer To (Username or Phone)</label>
              <input value={transferTo} onChange={e => setTransferTo(e.target.value)} placeholder="e.g. mwanjiku7890 or 0723456789"
                style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.85rem", fontFamily: "inherit" }} />
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Reason / Note</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. M-Pesa payment, manual correction..."
              style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.85rem", fontFamily: "inherit" }} />
          </div>

          {done ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0.75rem", borderRadius: 8, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399", fontWeight: 700 }}>
              <CheckCircle2 size={16} /> Balance Updated
            </div>
          ) : (
            <button onClick={handleSubmit} disabled={saving || !amount} style={{
              padding: "0.65rem", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", cursor: saving || !amount ? "not-allowed" : "pointer", fontFamily: "inherit",
              background: saving || !amount ? "var(--isp-accent-border)" : "var(--isp-accent)", border: "none", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Wallet size={14} />}
              {saving ? "Processing..." : `${action === "topup" ? "Add" : action === "deduct" ? "Deduct" : "Transfer"} Balance`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomerBalance() {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWallet | null>(null);
  const { customers, transactions } = useMemo(() => generateDemoData(), []);

  const filteredCustomers = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q) || c.username.includes(q) || c.phone.includes(q));
  }, [customers, search]);

  const totalBalance = customers.reduce((s, c) => s + c.balance, 0);
  const totalSpent = customers.reduce((s, c) => s + c.total_spent, 0);

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--isp-text)", margin: 0 }}>Customer Balance</h1>
          <p style={{ fontSize: "0.82rem", color: "var(--isp-text-muted)", margin: "4px 0 0" }}>Manage customer wallets, top-ups, deductions and transfers</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { label: "Total Wallet Balance", value: `KES ${totalBalance.toLocaleString()}`, icon: <Wallet size={18} />, color: "var(--isp-accent)" },
            { label: "Active Wallets", value: customers.filter(c => c.balance > 0).length, icon: <Users size={18} />, color: "#34d399" },
            { label: "Total Spent (All Time)", value: `KES ${totalSpent.toLocaleString()}`, icon: <TrendingUp size={18} />, color: "var(--isp-accent)" },
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers..."
                  style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.75rem 0.55rem 2rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.82rem", fontFamily: "inherit" }} />
              </div>
            </div>

            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--isp-border)" }}>
                <h3 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Customer Wallets</h3>
              </div>
              {filteredCustomers.map(c => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: "1px solid var(--isp-border)", cursor: "pointer" }}
                  onClick={() => setSelectedCustomer(c)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(37,99,235,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.72rem", color: "var(--isp-accent)" }}>
                      {c.name.split(" ").map(w => w[0]).join("").toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--isp-text)", margin: 0 }}>{c.name}</p>
                      <p style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", margin: "1px 0 0" }}>{c.username} | {c.phone}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 800, color: c.balance > 0 ? "#34d399" : "var(--isp-text-muted)", margin: 0 }}>KES {c.balance.toLocaleString()}</p>
                    <p style={{ fontSize: "0.65rem", color: "var(--isp-text-muted)", margin: "1px 0 0" }}>{c.last_topup ? `Last: ${new Date(c.last_topup).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}` : "No top-ups"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--isp-border)" }}>
                <h3 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Recent Transactions</h3>
              </div>
              {transactions.map(t => {
                const meta = TYPE_META[t.type];
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 1rem", borderBottom: "1px solid var(--isp-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: `${meta.color}15`, display: "flex", alignItems: "center", justifyContent: "center", color: meta.color }}>{meta.icon}</div>
                      <div>
                        <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-text)", margin: 0 }}>{t.customer_name}</p>
                        <p style={{ fontSize: "0.65rem", color: "var(--isp-text-muted)", margin: "1px 0 0" }}>{t.description}</p>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: "0.8rem", fontWeight: 700, color: t.amount >= 0 ? "#34d399" : "#f87171", margin: 0 }}>
                        {t.amount >= 0 ? "+" : ""}{fmtMoney(t.amount)}
                      </p>
                      <p style={{ fontSize: "0.6rem", color: "var(--isp-text-muted)", margin: "1px 0 0" }}>{fmtDate(t.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {selectedCustomer && <BalanceActionModal customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />}
      </div>
    </AdminLayout>
  );
}
