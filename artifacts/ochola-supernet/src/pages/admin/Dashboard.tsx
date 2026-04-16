import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Link } from "wouter";
import { supabase, ADMIN_ID, type DbRouter, type DbTransaction, getPaymentGateway, GATEWAY_OPTIONS } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff, Users, Ticket, MessageSquare, Router, DollarSign, TrendingUp, BarChart3, CreditCard } from "lucide-react";

function routerOnline(r: DbRouter): boolean {
  return r.status === "online" || r.status === "connected";
}

function fmtSince(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchRouters(): Promise<DbRouter[]> {
  const { data, error } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

type CustomerBasic = { id: number; type: string | null; status: string; created_at: string };

async function fetchCustomersBasic(): Promise<CustomerBasic[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("id, type, status, created_at")
    .eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactions(customerIds: number[]): Promise<DbTransaction[]> {
  if (customerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("*")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div style={{ borderRadius: 14, background: "var(--isp-card)", border: "1px solid var(--isp-border)", padding: "1.125rem 1.25rem", display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: accent ? `${accent}12` : "var(--isp-accent-glow)", border: `1px solid ${accent ? `${accent}25` : "var(--isp-accent-border)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: accent || "var(--isp-accent)" }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", fontWeight: 500, marginTop: "0.25rem" }}>{label}</div>
      </div>
    </div>
  );
}

function StatMiniCard({ label, value, href, dotColor }: { label: string; value: string; href: string; dotColor?: string }) {
  return (
    <Link href={href}>
      <div style={{ borderRadius: 12, background: "var(--isp-card)", border: "1px solid var(--isp-border)", padding: "0.875rem 1rem", cursor: "pointer", transition: "border-color 0.15s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
          {dotColor && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />}
          <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontWeight: 500 }}>{label}</span>
        </div>
        <div style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.03em" }}>{value}</div>
        <div style={{ fontSize: "0.68rem", color: "var(--isp-accent)", fontWeight: 600, marginTop: "0.25rem" }}>View All →</div>
      </div>
    </Link>
  );
}

function DonutChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((a, b) => a + b.count, 0);
  const cx = 80, cy = 80, r = 56;
  const circumference = 2 * Math.PI * r;
  if (total === 0) {
    return (
      <svg viewBox="0 0 160 160" width={160} height={160} style={{ display: "block" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--isp-border)" strokeWidth={22} />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="800">0</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total Users</text>
      </svg>
    );
  }
  let offset = 0;
  const segments = insights.map(s => {
    const pct = s.count / total;
    const dash = pct * circumference;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });
  return (
    <svg viewBox="0 0 160 160" width={160} height={160} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--isp-border)" strokeWidth={22} />
      {segments.map(seg => (
        <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={22}
          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
          strokeDashoffset={-seg.offset + circumference * 0.25}
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }} />
      ))}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="800">{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total Users</text>
    </svg>
  );
}

function fmtKsh(n: number) {
  if (n >= 1_000_000) return `Ksh. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Ksh. ${n.toLocaleString()}`;
  return `Ksh. ${n}`;
}

export default function Dashboard() {
  const [chartCollapsed,  setChartCollapsed]  = useState(false);
  const [chartMinimized,  setChartMinimized]  = useState(false);
  const [selectedRouter,  setSelectedRouter]  = useState<number | "all">("all");

  const gatewayId   = getPaymentGateway();
  const gatewayInfo = GATEWAY_OPTIONS.find(g => g.id === gatewayId) ?? GATEWAY_OPTIONS[0];

  const { data: routers = [], isLoading: routersLoading } = useQuery({
    queryKey: ["isp_routers", ADMIN_ID],
    queryFn: fetchRouters,
    refetchInterval: 10_000,
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["isp_customers_basic", ADMIN_ID],
    queryFn: fetchCustomersBasic,
    refetchInterval: 60_000,
  });

  const customerIds = useMemo(() => customers.map(c => c.id), [customers]);

  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["isp_transactions_dashboard", customerIds.join(",")],
    queryFn: () => fetchTransactions(customerIds),
    enabled: !customersLoading,
    refetchInterval: 60_000,
  });

  const now = new Date();
  const incomeToday = useMemo(() =>
    transactions.filter(t => t.status === "completed" && new Date(t.created_at).toDateString() === now.toDateString())
      .reduce((s, t) => s + t.amount, 0), [transactions]);

  const incomeMonth = useMemo(() =>
    transactions.filter(t => {
      const d = new Date(t.created_at);
      return t.status === "completed" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, t) => s + t.amount, 0), [transactions]);

  const onlineRouters  = routers.filter(routerOnline).length;
  const offlineRouters = routers.length - onlineRouters;

  const monthlyData = useMemo(() => {
    const year = now.getFullYear();
    return MONTHS.map((month, i) => ({
      month,
      count: customers.filter(c => {
        const d = new Date(c.created_at);
        return d.getFullYear() === year && d.getMonth() === i;
      }).length,
    }));
  }, [customers]);

  const maxCount = Math.max(...monthlyData.map(d => d.count), 1);

  const userInsights = useMemo(() => [
    { label: "Hotspot", count: customers.filter(c => c.type === "hotspot").length, color: "var(--isp-accent)" },
    { label: "PPPoE",   count: customers.filter(c => c.type === "pppoe").length,   color: "var(--isp-accent)" },
    { label: "Static",  count: customers.filter(c => c.type === "static").length,  color: "var(--isp-green)" },
  ], [customers]);

  const routerOptions: { key: number | "all"; label: string; online: boolean | null }[] = [
    { key: "all", label: "All Routers", online: null },
    ...routers.map(r => ({ key: r.id, label: r.name, online: routerOnline(r) })),
  ];

  const selectedRouterObj = selectedRouter === "all" ? null : routers.find(r => r.id === selectedRouter);

  const recentTxs = transactions.slice(0, 5);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <div style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          paddingBottom: "1.25rem",
          borderBottom: "1px solid var(--isp-border-subtle)",
        }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              marginBottom: 6,
              padding: "3px 12px 3px 8px",
              borderRadius: 20,
              background: "var(--isp-accent-glow)",
              border: "1px solid var(--isp-accent-border)",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--isp-green)", display: "inline-block" }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Live Dashboard</span>
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--isp-text)", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
              {greeting} 👋
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
              Here's what's happening across your network today.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{
              padding: "6px 14px", borderRadius: 9,
              background: "var(--isp-inner-card)",
              border: "1px solid var(--isp-border)",
              fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)",
              letterSpacing: "0.03em",
            }}>
              {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <KpiCard label="Income Today" value={txLoading ? "…" : fmtKsh(incomeToday)} icon={<DollarSign size={20} />} />
          <KpiCard label="Income This Month" value={txLoading ? "…" : fmtKsh(incomeMonth)} icon={<TrendingUp size={20} />} accent="#16a34a" />
          <KpiCard label="Total Transactions" value={txLoading ? "…" : String(transactions.length)} icon={<CreditCard size={20} />} accent="#ea580c" />
          <KpiCard label="Total Revenue" value={txLoading ? "…" : fmtKsh(transactions.filter(t => t.status === "completed").reduce((s, t) => s + t.amount, 0))} icon={<BarChart3 size={20} />} accent="var(--isp-accent)" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <StatMiniCard label="Online Now" value="0" href="/admin/customers" dotColor="var(--isp-green)" />
          <StatMiniCard label="Vouchers Left" value="0" href="/admin/vouchers" dotColor="var(--isp-accent)" />
          <StatMiniCard label="Support Tickets" value="0" href="/admin/support" dotColor="#0d9488" />
          <StatMiniCard label="Routers Online" value={routersLoading ? "0" : String(onlineRouters)} href="/admin/network" dotColor="#d97706" />
        </div>

        <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--isp-green)", display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontSize: "1rem" }}>{gatewayInfo.emoji}</span>
          <span style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem" }}>{gatewayInfo.label}</span>
          <span className="isp-badge isp-badge-green" style={{ fontSize: "0.72rem" }}>Active</span>
          <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>Payment gateway configured</span>
          <Link href="/admin/settings" style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--isp-text-muted)", textDecoration: "none" }}>Change →</Link>
        </div>

        <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <Router size={16} style={{ color: "var(--isp-accent)" }} />
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Router Status</span>
            </div>
            {!routersLoading && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="isp-badge isp-badge-green" style={{ fontSize: "0.72rem" }}>{onlineRouters} Online</span>
                <span className="isp-badge isp-badge-red" style={{ fontSize: "0.72rem" }}>{offlineRouters} Offline</span>
              </div>
            )}
          </div>
          <div style={{ padding: "1rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {routersLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text-muted)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading routers…
              </div>
            ) : routers.length === 0 ? (
              <div style={{ color: "var(--isp-text-muted)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
                No routers registered yet. <Link href="/admin/network"><span style={{ color: "var(--isp-accent)", cursor: "pointer" }}>Add one →</span></Link>
              </div>
            ) : routers.map(router => {
              const isOnline = routerOnline(router);
              return (
                <div key={router.id} style={{ background: "var(--isp-inner-card)", border: `1px solid var(--isp-border)`, borderRadius: 12, padding: "0.75rem 1rem", minWidth: 185 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{router.name}</span>
                    {isOnline
                      ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-green)" }}><Wifi size={12} /> Online</span>
                      : <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>
                          <WifiOff size={12} /> {router.last_seen ? `Since ${fmtSince(router.last_seen)}` : "Offline"}
                        </span>
                    }
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginBottom: "0.25rem", fontFamily: "monospace" }}>{router.host}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>{router.model ?? "MikroTik"} {router.ros_version ? `· ROS v${router.ros_version}` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginRight: "0.5rem" }}>
            <Router size={15} style={{ color: "var(--isp-accent)" }} />
            <span style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Filter by Router:</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {routerOptions.map(opt => {
              const active = selectedRouter === opt.key;
              return (
                <button key={String(opt.key)} onClick={() => setSelectedRouter(opt.key)}
                  style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.35rem 0.875rem", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", border: active ? "1.5px solid var(--isp-accent)" : "1.5px solid var(--isp-border)", background: active ? "var(--isp-accent-glow)" : "transparent", color: active ? "var(--isp-accent)" : "var(--isp-text-muted)" }}>
                  {opt.online !== null && <span style={{ width: 7, height: 7, borderRadius: "50%", background: opt.online ? "var(--isp-green)" : "#f87171", display: "inline-block", flexShrink: 0 }} />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {selectedRouter !== "all" && selectedRouterObj && (
            <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--isp-accent)" }}>
              Showing: <strong>{selectedRouterObj.name}</strong> ({selectedRouterObj.status})
              <button onClick={() => setSelectedRouter("all")} style={{ marginLeft: "0.5rem", background: "none", border: "none", color: "var(--isp-text-sub)", cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}>(clear)</button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}>

          <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: chartMinimized ? "none" : "1px solid var(--isp-border-subtle)" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)" }}>Monthly Registered Customers</span>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button onClick={() => setChartCollapsed(c => !c)} style={{ width: 24, height: 24, borderRadius: 5, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-sub)", cursor: "pointer", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
                  {chartCollapsed ? "+" : "−"}
                </button>
                <button onClick={() => setChartMinimized(m => !m)} style={{ width: 24, height: 24, borderRadius: 5, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-sub)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>×</button>
              </div>
            </div>
            {!chartMinimized && !chartCollapsed && (
              <div style={{ padding: "1rem 1.25rem" }}>
                <svg viewBox={`0 0 ${monthlyData.length * 36} 140`} width="100%" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--isp-accent)" /><stop offset="100%" stopColor="var(--isp-accent)" stopOpacity="0.4" />
                    </linearGradient>
                  </defs>
                  {monthlyData.map((d, i) => {
                    const barH = Math.round((d.count / maxCount) * 100);
                    const x = i * 36 + 6;
                    const barTop = 100 - barH;
                    return (
                      <g key={d.month}>
                        <rect x={x} y={barTop} width={22} height={barH} rx={3} fill="url(#barGrad)" />
                        <text x={x + 11} y={barTop - 4} textAnchor="middle" fill="var(--isp-text-sub)" fontSize="7.5">{d.count}</text>
                        <text x={x + 11} y={118} textAnchor="middle" fill="var(--isp-text-sub)" fontSize="7.5">{d.month}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.75rem" }}>Payment Gateway</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.65rem 0.875rem", borderRadius: 12, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border-subtle)" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "1.2rem" }}>
                  {gatewayInfo.emoji}
                </div>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>{gatewayInfo.label}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)", marginTop: "0.1rem" }}>Active payment gateway</div>
                </div>
                <span className="isp-badge isp-badge-green" style={{ marginLeft: "auto", fontSize: "0.65rem" }}>Active</span>
              </div>
            </div>
            <div style={{ borderRadius: 14, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.875rem" }}>All Users Insights</div>
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                <DonutChart insights={userInsights} />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", flex: 1 }}>
                  {userInsights.map(seg => {
                    const total = userInsights.reduce((a, b) => a + b.count, 0);
                    return (
                      <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: "0.775rem", color: "var(--isp-text-muted)", flex: 1 }}>{seg.label}</span>
                        <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "var(--isp-text)" }}>{seg.count}</span>
                        <span style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>({total > 0 ? Math.round(seg.count / total * 100) : 0}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderRadius: 14, background: "var(--isp-table-bg)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Recent Transactions</span>
            <Link href="/admin/transactions">
              <span style={{ fontSize: "0.75rem", color: "var(--isp-accent)", cursor: "pointer", fontWeight: 600 }}>View All →</span>
            </Link>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="isp-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  {["ID", "Reference", "Amount", "Method", "Status", "Date"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.625rem 1.25rem" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading…
                      </div>
                    </td>
                  </tr>
                ) : recentTxs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>No transactions yet.</td>
                  </tr>
                ) : recentTxs.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>#{tx.id}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{tx.reference || "—"}</td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-green)", fontWeight: 700 }}>Ksh {tx.amount.toLocaleString()}</td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span className={`isp-badge ${tx.payment_method === "mpesa" ? "isp-badge-blue" : "isp-badge-amber"}`} style={{ fontSize: "0.6875rem" }}>
                        {tx.payment_method.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 1.25rem" }}>
                      <span className={`isp-badge ${tx.status === "completed" ? "isp-badge-green" : "isp-badge-amber"}`} style={{ fontSize: "0.6875rem" }}>
                        {tx.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                      {new Date(tx.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
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
