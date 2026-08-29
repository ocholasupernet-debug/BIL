import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CreditCard,
  Landmark,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  ReceiptText,
  Router,
  Server,
  Signal,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  ADMIN_ID,
  supabase,
  type DbRouter,
  type DbTransaction,
} from "@/lib/supabase";
import { fmtMoney, getCurrencySymbol } from "@/lib/utils";
import { useDashboardPreferences } from "@/context/DashboardPreferencesContext";

type LiveCounts = { hotspot: number; pppoe: number };

async function fetchLiveCount(routerId: number): Promise<LiveCounts> {
  const res = await fetch(`/api/router/${routerId}/live`);
  if (!res.ok) return { hotspot: 0, pppoe: 0 };
  const data = await res.json();
  return {
    hotspot: data.hotspotUsers?.length ?? 0,
    pppoe: data.pppoeUsers?.length ?? 0,
  };
}

function routerOnline(router: DbRouter): boolean {
  return router.status === "online" || router.status === "connected";
}

function fmtSince(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

type PaymentSettingsResponse = {
  settings?: {
    paymentGateway?: string;
  };
};

async function fetchConfiguredGateway(): Promise<string> {
  const response = await fetch(`/api/settings/mpesa?adminId=${ADMIN_ID}`);
  if (!response.ok) throw new Error("Could not load payment gateway settings.");
  const data = await response.json() as PaymentSettingsResponse;
  return data.settings?.paymentGateway || "mpesa_paybill";
}

const PAYMENT_GATEWAY_LABELS: Record<string, string> = {
  mpesa_paybill: "M-Pesa PayBill",
  mpesa_till_push: "M-Pesa Till Push",
  bank_stk_push: "BankStkPush",
  airtel: "AirtelMoney",
  azampay: "AzamPay",
  custom_paybill: "CustomPaybill",
  dpo_payments: "DpoPayments",
  flutterwave: "Flutterwave",
  intasend: "Intasend",
  pesapal: "PesaPal",
  stripe: "Stripe",
  paypal: "PayPal",
  tigopesa: "TigoPesa",
  xendit: "XenditEwallet",
  manual: "Cash / Manual",
};

const PAYMENT_GATEWAY_MODES: Record<string, string> = {
  mpesa_paybill: "mpesapaybillstk",
  mpesa_till_push: "mpesatillstk",
  bank_stk_push: "bankstk",
};

function gatewayMode(id: string): string {
  return PAYMENT_GATEWAY_MODES[id] || id.replace(/[_\s-]+/g, "").toLowerCase();
}

function gatewayLabel(id: string): string {
  return PAYMENT_GATEWAY_LABELS[id] || id;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function KpiCard({
  label,
  value,
  icon,
  tone = "accent",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "accent" | "green" | "amber" | "plum";
}) {
  return (
    <article className={`dashboard-kpi dashboard-kpi--${tone}`}>
      <div className="dashboard-kpi-icon" aria-hidden="true">{icon}</div>
      <div className="dashboard-kpi-copy">
        <div className="dashboard-kpi-value">{value}</div>
        <div className="dashboard-kpi-label">{label}</div>
      </div>
    </article>
  );
}

function StatMiniCard({
  label,
  value,
  href,
  icon,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  icon: ReactNode;
  tone: "green" | "accent" | "teal" | "amber";
}) {
  return (
    <Link href={href} className={`dashboard-stat dashboard-stat--${tone}`}>
      <span className="dashboard-stat-icon" aria-hidden="true">{icon}</span>
      <span className="dashboard-stat-copy">
        <span className="dashboard-stat-label">{label}</span>
        <span className="dashboard-stat-value">{value}</span>
      </span>
      <ArrowUpRight className="dashboard-stat-arrow" size={15} aria-hidden="true" />
    </Link>
  );
}

function DonutChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((sum, insight) => sum + insight.count, 0);
  const cx = 80;
  const cy = 80;
  const radius = 55;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <svg className="donut-chart" viewBox="0 0 160 160" role="img" aria-label="No users registered">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--isp-border)" strokeWidth={20} />
        <text x={cx} y={cy - 5} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="700">0</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total users</text>
      </svg>
    );
  }

  let offset = 0;
  const segments = insights.map((insight) => {
    const dash = (insight.count / total) * circumference;
    const segment = { ...insight, dash, offset };
    offset += dash;
    return segment;
  });

  return (
    <svg className="donut-chart" viewBox="0 0 160 160" role="img" aria-label={`${total} total users`}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--isp-border)" strokeWidth={20} />
      {segments.map((segment) => (
        <circle
          key={segment.label}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={segment.color}
          strokeWidth={20}
          strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
          strokeDashoffset={-segment.offset + circumference * 0.25}
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}
      <text x={cx} y={cy - 5} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total users</text>
    </svg>
  );
}

export default function Dashboard() {
  const { preferences } = useDashboardPreferences();
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartMinimized, setChartMinimized] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");

  const now = new Date();

  const {
    data: configuredGatewayId,
    isLoading: gatewayLoading,
    isError: gatewayError,
  } = useQuery({
    queryKey: ["isp_payment_gateway", ADMIN_ID],
    queryFn: fetchConfiguredGateway,
    refetchOnWindowFocus: true,
  });

  const gatewayId = configuredGatewayId || "";
  const currentGatewayMode = gatewayLoading ? "Loading…" : gatewayError ? "Unavailable" : gatewayMode(gatewayId);
  const currentGatewayLabel = gatewayId ? gatewayLabel(gatewayId) : "Payment gateway";

  const {
    data: routers = [],
    isLoading: routersLoading,
    isError: routersError,
    refetch: refetchRouters,
  } = useQuery({
    queryKey: ["isp_routers", ADMIN_ID],
    queryFn: fetchRouters,
    refetchInterval: 10_000,
  });
  const {
    data: customers = [],
    isLoading: customersLoading,
    isError: customersError,
    refetch: refetchCustomers,
  } = useQuery({
    queryKey: ["isp_customers_basic", ADMIN_ID],
    queryFn: fetchCustomersBasic,
    refetchInterval: 60_000,
  });

  const customerIds = useMemo(() => customers.map((customer) => customer.id), [customers]);
  const {
    data: transactions = [],
    isLoading: txLoading,
    isError: txError,
    refetch: refetchTransactions,
  } = useQuery({
    queryKey: ["isp_transactions_dashboard", customerIds.join(",")],
    queryFn: () => fetchTransactions(customerIds),
    enabled: !customersLoading,
    refetchInterval: 60_000,
  });

  const incomeToday = useMemo(
    () => transactions
      .filter((transaction) => transaction.status === "completed" && new Date(transaction.created_at).toDateString() === now.toDateString())
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    [transactions, now],
  );
  const incomeMonth = useMemo(
    () => transactions
      .filter((transaction) => {
        const date = new Date(transaction.created_at);
        return transaction.status === "completed" && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      })
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    [transactions, now],
  );

  const onlineRouters = routers.filter(routerOnline).length;
  const offlineRouters = routers.length - onlineRouters;
  const onlineRouterIds = useMemo(() => routers.filter(routerOnline).map((router) => router.id), [routers]);
  const liveCountResults = useQueries({
    queries: onlineRouterIds.map((id) => ({
      queryKey: ["router-live-count", id],
      queryFn: () => fetchLiveCount(id),
      refetchInterval: 15_000,
      staleTime: 0,
      retry: false,
    })),
  });
  const onlineHotspotUsers = liveCountResults.reduce((sum, result) => sum + (result.data?.hotspot ?? 0), 0);
  const onlinePppoeUsers = liveCountResults.reduce((sum, result) => sum + (result.data?.pppoe ?? 0), 0);
  const onlineStaticUsers = customers.filter((customer) => customer.type === "static" && customer.status === "active").length;
  const totalOnlineNow = onlineHotspotUsers + onlinePppoeUsers + onlineStaticUsers;
  const liveCountLoading = liveCountResults.some((result) => result.isLoading);

  const monthlyData = useMemo(() => MONTHS.map((month, index) => ({
    month,
    count: customers.filter((customer) => {
      const date = new Date(customer.created_at);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === index;
    }).length,
  })), [customers, now]);
  const maxCount = Math.max(...monthlyData.map((month) => month.count), 1);
  const userInsights = useMemo(() => [
    { label: "Hotspot", count: customers.filter((customer) => customer.type === "hotspot").length, color: "var(--dashboard-accent, var(--isp-accent))" },
    { label: "PPPoE", count: customers.filter((customer) => customer.type === "pppoe").length, color: "#8879b7" },
    { label: "Static", count: customers.filter((customer) => customer.type === "static").length, color: "var(--isp-green)" },
  ], [customers]);
  const routerOptions: { key: number | "all"; label: string; online: boolean | null }[] = [
    { key: "all", label: "All routers", online: null },
    ...routers.map((router) => ({ key: router.id, label: router.name, online: routerOnline(router) })),
  ];
  const selectedRouterObj = selectedRouter === "all" ? null : routers.find((router) => router.id === selectedRouter);
  const visibleRouters = selectedRouter === "all" ? routers : routers.filter((router) => router.id === selectedRouter);
  const recentTxs = transactions.slice(0, 5);
  const completedRevenue = transactions
    .filter((transaction) => transaction.status === "completed")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const hasError = routersError || customersError || txError;
  const dashboardStyle = {
    "--dashboard-accent": preferences.accentColor,
    "--dashboard-accent-glow": `${preferences.accentColor}1a`,
    "--dashboard-accent-border": `${preferences.accentColor}45`,
  } as CSSProperties;

  return (
    <AdminLayout>
      <div className={`dashboard-page dashboard-page--${preferences.layout} dashboard-shape--${preferences.cardShape}`} style={dashboardStyle}>
        <header className="dashboard-hero">
          <div>
            <div className="dashboard-eyebrow">
              <span className="dashboard-live-mark"><Activity size={12} /></span>
              Live operations
            </div>
            <h1>{greeting}</h1>
            <p>Network pulse, customer activity, and cashflow in one view.</p>
          </div>
          <div className="dashboard-date">
            <CalendarDays size={15} />
            {now.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </header>

        {hasError && (
          <div className="dashboard-error" role="alert">
            <CircleAlert size={17} />
            <span>Some live data could not be loaded. Your last available figures remain visible.</span>
            <button
              type="button"
              className="dashboard-error-retry"
              onClick={() => { void refetchRouters(); void refetchCustomers(); void refetchTransactions(); }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          <span>01</span>
          Financial pulse
          <span>Updated from live payment activity</span>
        </div>
        <section className="dashboard-kpi-grid" aria-label="Revenue overview">
          <KpiCard label="Income today" value={preferences.hideAmounts ? "••••" : txLoading ? "…" : fmtMoney(incomeToday)} icon={<Banknote size={19} />} />
          <KpiCard label="Income this month" value={preferences.hideAmounts ? "••••" : txLoading ? "…" : fmtMoney(incomeMonth)} icon={<TrendingUp size={19} />} tone="green" />
          <KpiCard label="Total transactions" value={txLoading ? "…" : String(transactions.length)} icon={<ReceiptText size={19} />} tone="amber" />
          <KpiCard label="Total revenue" value={preferences.hideAmounts ? "••••" : txLoading ? "…" : fmtMoney(completedRevenue)} icon={<BarChart3 size={19} />} tone="plum" />
        </section>

        <section className="dashboard-stat-grid" aria-label="Network quick stats">
          <StatMiniCard label="Total online users" value={liveCountLoading && totalOnlineNow === 0 ? "…" : String(totalOnlineNow)} href="/admin/customers" icon={<Users size={16} />} tone="green" />
          <StatMiniCard label="PPPoE online" value={liveCountLoading && onlinePppoeUsers === 0 ? "…" : String(onlinePppoeUsers)} href="/admin/customers?type=pppoe" icon={<Wifi size={16} />} tone="accent" />
          <StatMiniCard label="Hotspot online" value={liveCountLoading && onlineHotspotUsers === 0 ? "…" : String(onlineHotspotUsers)} href="/admin/customers?type=hotspot" icon={<Signal size={16} />} tone="teal" />
          <StatMiniCard label="Static online" value={customersLoading ? "…" : String(onlineStaticUsers)} href="/admin/customers?type=static" icon={<Server size={16} />} tone="amber" />
        </section>

        <section className="gateway-strip" aria-label="Payment gateway status">
          <span className="gateway-icon" aria-hidden="true"><Landmark size={17} /></span>
          <span className="gateway-copy">
            <strong>{currentGatewayMode}</strong>
            <span>{currentGatewayLabel}</span>
          </span>
          <span className={`isp-badge ${gatewayError ? "isp-badge-red" : "isp-badge-green"}`}>
            {gatewayError ? <CircleAlert size={12} /> : <CircleCheck size={12} />}
            {gatewayError ? "Unavailable" : "Active"}
          </span>
          <Link href="/admin/settings" className="gateway-link">Manage gateway <ArrowUpRight size={13} /></Link>
        </section>

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          <span>02</span>
          Network health
          <span>Heartbeat window · 10 seconds</span>
        </div>

        <section className="section-card dashboard-router-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="panel-title-icon"><Router size={16} /></span>
              <div>
                <h2>Router status</h2>
                <p>Heartbeat updated every 10 seconds</p>
              </div>
            </div>
            {!routersLoading && (
              <div className="panel-heading-meta">
                <span className="isp-badge isp-badge-green"><span className="status-dot status-dot--green" />{onlineRouters} online</span>
                <span className="isp-badge isp-badge-red"><span className="status-dot status-dot--red" />{offlineRouters} offline</span>
              </div>
            )}
          </div>
          <div className="router-card-grid">
            {routersLoading ? (
              <div className="dashboard-loading"><Loader2 size={16} className="animate-spin" /> Loading router fleet…</div>
            ) : routers.length === 0 ? (
              <div className="dashboard-empty">
                <Server size={19} />
                <span>No routers registered yet.</span>
                <Link href="/admin/network/self-install">Self Install <ArrowUpRight size={13} /></Link>
              </div>
            ) : visibleRouters.map((router) => {
              const isOnline = routerOnline(router);
              return (
                <article className={`router-card ${isOnline ? "router-card--online" : "router-card--offline"}`} key={router.id}>
                  <div className="router-card-topline">
                    <span className="router-card-name">{router.name}</span>
                    <span className={`router-health ${isOnline ? "router-health--online" : "router-health--offline"}`}>
                      {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {isOnline ? "Online" : "Offline"}
                    </span>
                  </div>
                  <div className="router-host">{router.host}</div>
                  <div className="router-meta">{router.model ?? "MikroTik"} {router.ros_version ? `· ROS v${router.ros_version}` : ""}</div>
                  {!isOnline && <div className="router-seen">{router.last_seen ? `Last seen ${fmtSince(router.last_seen)}` : "No heartbeat recorded"}</div>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="router-filter-bar" aria-label="Filter dashboard by router">
          <div className="router-filter-label"><SlidersHorizontal size={15} /> Filter by router</div>
          <div className="router-filter-options">
            {routerOptions.map((option) => {
              const active = selectedRouter === option.key;
              return (
                <button
                  type="button"
                  key={String(option.key)}
                  className={`router-filter-pill ${active ? "router-filter-pill--active" : ""}`}
                  onClick={() => setSelectedRouter(option.key)}
                  aria-pressed={active}
                >
                  {option.online !== null && <span className={`status-dot ${option.online ? "status-dot--green" : "status-dot--red"}`} />}
                  {option.label}
                </button>
              );
            })}
          </div>
          {selectedRouterObj && (
            <div className="router-filter-selected">
              Showing <strong>{selectedRouterObj.name}</strong>
              <button type="button" onClick={() => setSelectedRouter("all")} title="Clear router filter" aria-label="Clear router filter"><X size={13} /></button>
            </div>
          )}
        </section>

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          <span>03</span>
          Customer intelligence
          <span>Accounts, access mix, and payment flow</span>
        </div>
        <div className="dashboard-main-grid">
          <section className="section-card chart-panel">
            <div className={`panel-heading ${chartMinimized ? "panel-heading--quiet" : ""}`}>
              <div className="panel-title">
                <span className="panel-title-icon panel-title-icon--soft"><Users size={16} /></span>
                <div><h2>Monthly registered customers</h2><p>New accounts in {now.getFullYear()}</p></div>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setChartCollapsed((collapsed) => !collapsed)}
                  title={chartCollapsed ? "Expand chart" : "Collapse chart"}
                  aria-label={chartCollapsed ? "Expand chart" : "Collapse chart"}
                >
                  {chartCollapsed ? <Plus size={15} /> : <Minus size={15} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setChartMinimized((minimized) => !minimized)}
                  title={chartMinimized ? "Restore chart" : "Minimize chart"}
                  aria-label={chartMinimized ? "Restore chart" : "Minimize chart"}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
            {!chartMinimized && !chartCollapsed && (
              <div className="chart-body">
                <svg className="customer-chart" viewBox={`0 0 ${monthlyData.length * 36} 150`} role="img" aria-label="Monthly registered customer counts">
                  <defs>
                    <linearGradient id="customerBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--isp-accent)" />
                      <stop offset="100%" stopColor="var(--isp-accent)" stopOpacity="0.35" />
                    </linearGradient>
                  </defs>
                  {monthlyData.map((month, index) => {
                    const barHeight = Math.max(month.count ? Math.round((month.count / maxCount) * 104) : 2, 2);
                    const x = index * 36 + 6;
                    const barTop = 112 - barHeight;
                    return (
                      <g key={month.month}>
                        <line x1={x} y1="112" x2={x + 22} y2="112" stroke="var(--isp-border)" strokeWidth="1" />
                        <rect x={x} y={barTop} width={22} height={barHeight} rx={4} fill="url(#customerBarGradient)" />
                        <text x={x + 11} y={barTop - 6} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="8">{month.count}</text>
                        <text x={x + 11} y="133" textAnchor="middle" fill="var(--isp-text-sub)" fontSize="8">{month.month}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </section>

          <div className="dashboard-side-stack">
            <section className="section-card gateway-card">
              <div className="panel-heading panel-heading--compact">
                <div className="panel-title"><span className="panel-title-icon panel-title-icon--soft"><CreditCard size={16} /></span><h2>Payment gateway</h2></div>
                <span className="isp-badge isp-badge-green"><CircleCheck size={12} /> Active</span>
              </div>
              <div className="gateway-detail">
                <span className="gateway-detail-icon"><Banknote size={18} /></span>
                <div><strong>{currentGatewayMode}</strong><span>{currentGatewayLabel} · Ready to accept payments</span></div>
              </div>
            </section>
            <section className="section-card insight-card">
              <div className="panel-heading panel-heading--compact">
                <div className="panel-title"><span className="panel-title-icon panel-title-icon--soft"><Activity size={16} /></span><h2>Users by access type</h2></div>
              </div>
              <div className="insight-content">
                <DonutChart insights={userInsights} />
                <div className="insight-legend">
                  {userInsights.map((segment) => {
                    const total = userInsights.reduce((sum, insight) => sum + insight.count, 0);
                    return (
                      <div className="insight-row" key={segment.label}>
                        <span className="insight-swatch" style={{ background: segment.color }} />
                        <span>{segment.label}</span>
                        <strong>{segment.count}</strong>
                        <small>{total > 0 ? Math.round((segment.count / total) * 100) : 0}%</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          <span>04</span>
          Payment activity
          <span>Most recent subscriber transactions</span>
        </div>
        <section className="section-card transaction-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="panel-title-icon panel-title-icon--soft"><ReceiptText size={16} /></span>
              <div><h2>Recent transactions</h2><p>Latest payment activity across subscribers</p></div>
            </div>
            <Link href="/admin/transactions" className="panel-link">View all <ArrowUpRight size={13} /></Link>
          </div>
          <div className="transaction-table-wrap">
            <table className="isp-table transaction-table">
              <thead><tr>{["ID", "Reference", "Amount", "Method", "Status", "Date"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
              <tbody>
                {txLoading ? (
                  <tr><td colSpan={6}><div className="dashboard-loading dashboard-loading--center"><Loader2 size={16} className="animate-spin" /> Loading transactions…</div></td></tr>
                ) : recentTxs.length === 0 ? (
                  <tr><td colSpan={6}><div className="dashboard-empty dashboard-empty--center"><ReceiptText size={19} /><span>No transactions yet.</span></div></td></tr>
                ) : recentTxs.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="table-mono">#{transaction.id}</td>
                    <td className="table-mono">{transaction.reference || "—"}</td>
                    <td className="table-amount">{getCurrencySymbol()} {transaction.amount.toLocaleString()}</td>
                    <td><span className={`isp-badge ${transaction.payment_method === "mpesa" ? "isp-badge-blue" : "isp-badge-amber"}`}>{transaction.payment_method.toUpperCase()}</span></td>
                    <td><span className={`isp-badge ${transaction.status === "completed" ? "isp-badge-green" : "isp-badge-amber"}`}>{transaction.status}</span></td>
                    <td className="table-date">{new Date(transaction.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}