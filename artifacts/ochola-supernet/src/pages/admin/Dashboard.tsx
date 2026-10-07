import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Eye,
  EyeOff,
  Landmark,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  ReceiptText,
  RefreshCw,
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
  getAdminDisplayName,
  getAdminApiToken,
  supabase,
  type DbRouter,
  type DbTransaction,
} from "@/lib/supabase";
import { fmtMoney, getCurrencySymbol } from "@/lib/utils";
import { useDashboardPreferences } from "@/context/DashboardPreferencesContext";
import { transactionDisplayId } from "@/lib/transaction-reference";
import { mergeCustomerServiceIdentities } from "@/lib/customer-identities";
import { getCustomerServiceStatus } from "@/lib/customer-service-status";
import {
  buildLivePresenceByRouter,
  customerIsOnline,
  prepaidServiceType,
} from "@/lib/prepaid-live-presence";
import { usePrepaidLiveQueries } from "@/lib/prepaid-live-queries";

type RevenueSummary = {
  incomeToday: number;
  incomeMonth: number;
  totalRevenue: number;
  totalTransactions: number;
};
type ResellerSummary = {
  activeResellers: number;
  onlineResellers: number;
  totalResellers: number;
};

async function fetchRevenueSummary(): Promise<RevenueSummary> {
  const token = (() => {
    try { return localStorage.getItem("ochola_api_token") || ""; } catch { return ""; }
  })();
  const response = await fetch("/api/billing/revenue-summary", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json() as RevenueSummary & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not load revenue totals.");
  return data;
}

async function fetchResellerSummary(): Promise<ResellerSummary> {
  const token = getAdminApiToken();
  const response = await fetch("/api/admin/dashboard/reseller-summary", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json() as ResellerSummary & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not load reseller totals.");
  return data;
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--isp-inner-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 8,
  padding: "0.58rem 0.7rem",
  color: "var(--isp-text)",
  fontSize: "0.75rem",
  fontFamily: "inherit",
};

type TelemetryRow = {
  portId: number;
  routerId: number;
  interfaceName: string;
  resellerId: number | null;
  hotspotActive: number;
  pppoeActive: number;
  onlineUsers: number;
  routerAvailable: boolean;
  routerError: string | null;
};

type TelemetryResponse = {
  totals: { hotspotActive: number; pppoeActive: number; onlineUsers: number };
  rows: TelemetryRow[];
  filters: {
    routers: { id: number; name: string; status: string }[];
    ports: { id: number; routerId: number; interfaceName: string }[];
    resellers: { id: number; name: string }[];
  };
  fetchedAt: string;
};

async function fetchNetworkTelemetry(routerId: number | "all", portId: number | "all", resellerId: number | "all"): Promise<TelemetryResponse> {
  const params = new URLSearchParams();
  if (routerId !== "all") params.set("routerId", String(routerId));
  if (portId !== "all") params.set("portId", String(portId));
  if (resellerId !== "all") params.set("resellerId", String(resellerId));
  const response = await fetch(`/api/admin/dashboard/telemetry?${params.toString()}`);
  const data = await response.json() as Partial<TelemetryResponse> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not load network telemetry.");
  return data as TelemetryResponse;
}

const ROUTER_HEARTBEAT_MAX_AGE_MS = 15 * 60 * 1000;

function routerOnline(router: DbRouter): boolean {
  if (router.status !== "online" && router.status !== "connected") return false;
  if (!router.last_seen) return false;
  const lastSeen = Date.parse(router.last_seen);
  return Number.isFinite(lastSeen)
    && lastSeen <= Date.now()
    && Date.now() - lastSeen <= ROUTER_HEARTBEAT_MAX_AGE_MS;
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
  const { data, error } = await supabase
    .from("isp_routers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .not("status", "in", "(setup,awaiting_ports,awaiting_sync,awaiting_connection)");
  if (error) throw error;
  return data ?? [];
}

type CustomerBasic = {
  id: number;
  type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  depletion_reason: string | null;
  plan_id: number | null;
  router_id: number | null;
  port_id: number | null;
  mac_address: string | null;
  phone: string | null;
  pppoe_username: string | null;
  username: string | null;
  ip_address: string | null;
  service_online: boolean | null;
};
type CustomerPlanScope = { id: number; router_id: number | null; port_id: number | null };

async function fetchCustomersBasic(): Promise<CustomerBasic[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("id,type,status,created_at,updated_at,expires_at,depletion_reason,plan_id,router_id,port_id,mac_address,phone,pppoe_username,username,ip_address,service_online")
    .eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

async function fetchCustomerPlanScopes(): Promise<CustomerPlanScope[]> {
  const { data, error } = await supabase
    .from("isp_plans")
    .select("id,router_id,port_id")
    .eq("admin_id", ADMIN_ID)
    .is("owner_reseller_id", null);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactions(customerIds: number[]): Promise<DbTransaction[]> {
  if (customerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("*")
    .in("customer_id", customerIds)
    .not("payment_method", "in", "(mpesa_registration,manual_registration,mpesa_platform_billing)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

type PaymentSettingsResponse = {
  configured?: boolean;
  settings?: {
    paymentGateway?: string;
    destinationConfigured?: boolean;
  };
};

type ConfiguredGateway = {
  id: string;
  configured: boolean;
  destinationConfigured: boolean;
};

async function fetchConfiguredGateway(): Promise<ConfiguredGateway> {
  const response = await fetch(`/api/settings/mpesa?adminId=${ADMIN_ID}`);
  if (!response.ok) throw new Error("Could not load payment gateway settings.");
  const data = await response.json() as PaymentSettingsResponse;
  return {
    id: data.settings?.paymentGateway || "mpesa_paybill",
    configured: data.configured === true,
    destinationConfigured: data.settings?.destinationConfigured === true,
  };
}

type MpesaStkPushHealth = {
  status: "available" | "down";
  paymentGateway: string;
  checkedAt: string;
};

async function fetchMpesaStkPushHealth(): Promise<MpesaStkPushHealth | null> {
  const token = getAdminApiToken();
  const response = await fetch("/api/admin/dashboard/mpesa-stk-health", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  const data = await response.json() as { health?: MpesaStkPushHealth | null; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not load M-Pesa STK Push status.");
  return data.health ?? null;
}

function isMpesaStkGateway(gatewayId: string): boolean {
  return gatewayId === "mpesa_paybill" || gatewayId === "mpesa_till_push";
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
  description,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "accent" | "green" | "amber" | "plum" | "slate" | "rust";
  description?: string;
}) {
  return (
    <article className={`dashboard-kpi dashboard-kpi--${tone}`}>
      <div className="dashboard-kpi-icon" aria-hidden="true">{icon}</div>
      <div className="dashboard-kpi-copy">
        <div className="dashboard-kpi-label">{label}</div>
        <div className="dashboard-kpi-value">{value}</div>
        {description && <div className="dashboard-kpi-description">{description}</div>}
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
  tone: "green" | "accent" | "teal" | "amber" | "plum" | "deep-teal" | "indigo";
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
  const { preferences, saving: preferencesSaving, savePreferences } = useDashboardPreferences();
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartMinimized, setChartMinimized] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  const [selectedTelemetryPort, setSelectedTelemetryPort] = useState<number | "all">("all");
  const [selectedTelemetryReseller, setSelectedTelemetryReseller] = useState<number | "all">("all");

  const now = new Date();

  const {
    data: gatewaySettings,
    isLoading: gatewayLoading,
    isError: gatewayError,
  } = useQuery({
    queryKey: ["isp_payment_gateway", ADMIN_ID],
    queryFn: fetchConfiguredGateway,
    refetchOnWindowFocus: true,
  });
  const {
    data: mpesaStkHealth,
    isLoading: mpesaStkHealthLoading,
    isError: mpesaStkHealthError,
  } = useQuery({
    queryKey: ["mpesa-stk-push-health", ADMIN_ID],
    queryFn: fetchMpesaStkPushHealth,
    refetchInterval: 15_000,
    retry: false,
  });
  const {
    data: revenueSummary,
    isLoading: revenueLoading,
    isError: revenueError,
    refetch: refetchRevenue,
  } = useQuery({
    queryKey: ["immutable-revenue-summary", ADMIN_ID],
    queryFn: fetchRevenueSummary,
    refetchInterval: 60_000,
  });
  const {
    data: resellerSummary,
    isLoading: resellerSummaryLoading,
    isError: resellerSummaryError,
  } = useQuery({
    queryKey: ["isp_reseller_summary", ADMIN_ID],
    queryFn: fetchResellerSummary,
    refetchInterval: 15_000,
  });

  const gatewayId = gatewaySettings?.id || "";
  const currentGatewayMode = gatewayLoading ? "Loading…" : gatewayError ? "Unavailable" : gatewayMode(gatewayId);
  const currentGatewayLabel = gatewayId ? gatewayLabel(gatewayId) : "Payment gateway";
  const isMpesaPushGateway = isMpesaStkGateway(gatewayId);
  const gatewayIsConfigured = gatewaySettings?.configured === true && gatewaySettings.destinationConfigured;
  const healthMatchesGateway = mpesaStkHealth?.paymentGateway === gatewayId;
  const mpesaPushStatus = !isMpesaPushGateway
    ? null
    : gatewayLoading || mpesaStkHealthLoading
      ? "checking"
      : gatewayError || mpesaStkHealthError
        ? "unknown"
        : !gatewayIsConfigured
          ? "not_configured"
          : healthMatchesGateway
            ? mpesaStkHealth.status
            : "not_checked";
  const mpesaPushBadge = mpesaPushStatus === "available"
    ? { label: "Available", className: "isp-badge-green", detail: `Safaricom accepted the last STK request ${fmtSince(mpesaStkHealth?.checkedAt)}` }
    : mpesaPushStatus === "down"
      ? { label: "Down", className: "isp-badge-red", detail: `The last STK request failed ${fmtSince(mpesaStkHealth?.checkedAt)}` }
      : mpesaPushStatus === "checking"
        ? { label: "Checking", className: "isp-badge-amber", detail: "Loading the latest STK Push result…" }
        : mpesaPushStatus === "not_configured"
          ? { label: "Not configured", className: "isp-badge-amber", detail: "Check M-Pesa credentials and the selected Till or PayBill." }
          : mpesaPushStatus === "not_checked"
            ? { label: "Not checked", className: "isp-badge-amber", detail: "Waiting for a real STK Push request to confirm availability." }
            : mpesaPushStatus === "unknown"
              ? { label: "Status unavailable", className: "isp-badge-amber", detail: "Could not load the latest STK Push result." }
              : null;
  const genericGatewayStatus = gatewayError
    ? { label: "Unavailable", className: "isp-badge-red" }
    : gatewayIsConfigured
      ? { label: "Configured", className: "isp-badge-green" }
      : { label: "Not configured", className: "isp-badge-amber" };
  const displayedGatewayStatus = mpesaPushBadge ?? genericGatewayStatus;
  const displayedGatewayDetail = mpesaPushBadge?.detail
    ?? (gatewayIsConfigured ? "Payment method settings are complete." : "Complete payment gateway setup to accept payments.");

  const {
    data: routers = [],
    isLoading: routersLoading,
    isFetching: routersFetching,
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
    queryKey: ["isp_customers_dashboard", ADMIN_ID],
    queryFn: fetchCustomersBasic,
    refetchInterval: 60_000,
  });
  const {
    data: customerPlanScopes = [],
    isLoading: customerPlanScopesLoading,
    isError: customerPlanScopesError,
    refetch: refetchCustomerPlanScopes,
  } = useQuery({
    queryKey: ["dashboard_customer_plan_scopes", ADMIN_ID],
    queryFn: fetchCustomerPlanScopes,
    refetchInterval: 60_000,
    staleTime: 30_000,
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

  const incomeToday = revenueSummary?.incomeToday ?? 0;
  const incomeMonth = revenueSummary?.incomeMonth ?? 0;

  const onlineRouters = routers.filter(routerOnline).length;
  const offlineRouters = routers.length - onlineRouters;
  const liveQueries = usePrepaidLiveQueries(routers);
  const livePresenceByRouter = useMemo(
    () => buildLivePresenceByRouter(routers, liveQueries),
    [routers, liveQueries],
  );
  const liveCountUnavailable = liveQueries.some(result => result.isError);
  const liveCountRefreshing = liveQueries.some(result => result.isFetching);
  const customerPlanScopeMap = useMemo(
    () => Object.fromEntries(customerPlanScopes.map(plan => [plan.id, plan])),
    [customerPlanScopes],
  );
  const uniqueServiceCustomers = useMemo(
    () => mergeCustomerServiceIdentities(customers, customerPlanScopeMap),
    [customers, customerPlanScopeMap],
  );
  const onlineServiceCustomers = useMemo(
    () => uniqueServiceCustomers.filter(customer =>
      customerIsOnline(customer, livePresenceByRouter, customerPlanScopeMap),
    ),
    [uniqueServiceCustomers, livePresenceByRouter, customerPlanScopeMap],
  );
  const onlineHotspotUsers = onlineServiceCustomers.filter(
    customer => prepaidServiceType(customer.type) === "hotspot",
  ).length;
  const onlinePppoeUsers = onlineServiceCustomers.filter(
    customer => prepaidServiceType(customer.type) === "pppoe",
  ).length;
  const onlineVlanUsers = onlineServiceCustomers.filter(
    customer => prepaidServiceType(customer.type) === "vlan",
  ).length;
  const onlineStaticUsers = onlineServiceCustomers.filter(
    customer => prepaidServiceType(customer.type) === "static",
  ).length;
  const activeUsers = uniqueServiceCustomers.filter((customer) => getCustomerServiceStatus(customer) === "active").length;
  const expiredUsers = uniqueServiceCustomers.filter((customer) => getCustomerServiceStatus(customer) === "expired").length;
  const serviceCountsLoading = customersLoading || customerPlanScopesLoading;
  const serviceCountsUnavailable = (customersError && customers.length === 0)
    || (customerPlanScopesError && customerPlanScopes.length === 0);
  const activeExpiredValue = serviceCountsLoading ? "…" : serviceCountsUnavailable ? "—" : `${activeUsers}/${expiredUsers}`;
  const onlineCountValue = (count: number) => serviceCountsLoading
    ? "…"
    : serviceCountsUnavailable
      ? "—"
      : String(count);
  const totalOnlineValue = onlineCountValue(onlineServiceCustomers.length);
  const onlineHotspotValue = onlineCountValue(onlineHotspotUsers);
  const onlinePppoeValue = onlineCountValue(onlinePppoeUsers);
  const onlineVlanValue = onlineCountValue(onlineVlanUsers);
  const onlineStaticValue = onlineCountValue(onlineStaticUsers);
  const refreshOnlineUsers = async () => {
    await Promise.all([
      refetchRouters(),
      ...liveQueries.map(result => result.refetch()),
    ]);
  };

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
  const telemetryQuery = useQuery({
    queryKey: ["network-telemetry", selectedRouter, selectedTelemetryPort, selectedTelemetryReseller],
    queryFn: () => fetchNetworkTelemetry(selectedRouter, selectedTelemetryPort, selectedTelemetryReseller),
    refetchInterval: 15_000,
    retry: false,
  });
  const telemetry = telemetryQuery.data;
  const telemetryPorts = telemetry?.filters.ports.filter((port) => selectedRouter === "all" || port.routerId === selectedRouter) ?? [];
  const recentTxs = transactions.slice(0, 5);
  const completedRevenue = revenueSummary?.totalRevenue ?? 0;
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const displayName = getAdminDisplayName();
  const hasError = routersError || customersError || customerPlanScopesError || txError || revenueError || resellerSummaryError || liveCountUnavailable;
  const dashboardStyle = {
    "--dashboard-accent": preferences.accentColor,
    "--dashboard-accent-glow": `${preferences.accentColor}1a`,
    "--dashboard-accent-border": `${preferences.accentColor}45`,
  } as CSSProperties;

  const toggleAmounts = () => {
    void savePreferences({
      ...preferences,
      hideAmounts: !preferences.hideAmounts,
    }).catch(() => undefined);
  };

  return (
    <AdminLayout>
      <div className={`dashboard-page dashboard-page--${preferences.layout} dashboard-shape--${preferences.cardShape}`} style={dashboardStyle}>
        <header className="dashboard-hero">
          <div>
            <div className="dashboard-eyebrow">
              <span className="dashboard-live-mark"><Activity size={12} /></span>
              Live operations
            </div>
             <h1>{displayName ? `${greeting}, ${displayName}` : greeting}</h1>
            <p>Network pulse, customer activity, and cashflow in one view.</p>
          </div>
          <div className="dashboard-header-actions">
            <button
              type="button"
              className="dashboard-refresh-button"
              onClick={() => void refreshOnlineUsers()}
              disabled={liveCountRefreshing || routersFetching}
              aria-label="Refresh online user counts"
              title="Refresh router list and online session counts now"
            >
              <RefreshCw size={13} className={liveCountRefreshing || routersFetching ? "animate-spin" : ""} />
              Refresh online users
            </button>
            <div className="dashboard-date">
              <CalendarDays size={15} />
              {now.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Nairobi" })}
            </div>
          </div>
        </header>

        {hasError && (
          <div className="dashboard-error" role="alert">
            <CircleAlert size={17} />
            <span>Some live data could not be loaded. Your last available figures remain visible.</span>
            <button
              type="button"
              className="dashboard-error-retry"
               onClick={() => { void refetchRouters(); void refetchCustomers(); void refetchCustomerPlanScopes(); void refetchTransactions(); void refetchRevenue(); }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          Financial pulse
          <span className="dashboard-section-meta">Updated from live payment activity</span>
          <button
            type="button"
            className="dashboard-amount-toggle"
            aria-pressed={preferences.hideAmounts}
            aria-label={preferences.hideAmounts ? "Show financial amounts" : "Hide financial amounts"}
            title={preferences.hideAmounts ? "Show financial amounts" : "Hide financial amounts"}
            onClick={toggleAmounts}
            disabled={preferencesSaving}
          >
            {preferences.hideAmounts ? <Eye size={13} /> : <EyeOff size={13} />}
            <span>{preferences.hideAmounts ? "Show amounts" : "Hide amounts"}</span>
          </button>
        </div>
        <section className="dashboard-kpi-grid" aria-label="Revenue overview">
            <KpiCard label="Income today" value={preferences.hideAmounts ? "••••" : revenueLoading ? "…" : fmtMoney(incomeToday)} icon={<Banknote size={19} />} tone="slate" description="Since midnight · EAT" />
            <KpiCard label="Income this month" value={preferences.hideAmounts ? "••••" : revenueLoading ? "…" : fmtMoney(incomeMonth)} icon={<TrendingUp size={19} />} tone="green" description="Month to date · resets on the 1st" />
           <KpiCard label="Total transactions" value={revenueLoading ? "…" : String(revenueSummary?.totalTransactions ?? 0)} icon={<ReceiptText size={19} />} tone="amber" description="All time" />
            <KpiCard label="Total revenue" value={preferences.hideAmounts ? "••••" : revenueLoading ? "…" : fmtMoney(completedRevenue)} icon={<BarChart3 size={19} />} tone="rust" description="All time" />
        </section>

        <section className="dashboard-stat-grid" aria-label="Network quick stats">
          <StatMiniCard label="Total online users" value={totalOnlineValue} href="/admin/customers" icon={<Users size={16} />} tone="teal" />
          <StatMiniCard label="PPPoE online" value={onlinePppoeValue} href="/admin/customers?type=pppoe" icon={<Wifi size={16} />} tone="plum" />
          <StatMiniCard label="Hotspot online" value={onlineHotspotValue} href="/admin/customers?type=hotspot" icon={<Signal size={16} />} tone="deep-teal" />
          <StatMiniCard label="VLAN users online" value={onlineVlanValue} href="/admin/customers?type=vlan" icon={<Wifi size={16} />} tone="indigo" />
          <StatMiniCard label="Static online" value={onlineStaticValue} href="/admin/customers?type=static" icon={<Server size={16} />} tone="green" />
           <StatMiniCard label="Active / expired accounts" value={activeExpiredValue} href="/admin/customers" icon={<CircleCheck size={16} />} tone="amber" />
           <StatMiniCard label="Active resellers" value={resellerSummaryLoading ? "…" : String(resellerSummary?.activeResellers ?? 0)} href="/admin/network/resellers" icon={<Users size={16} />} tone="accent" />
           <StatMiniCard label="Online resellers" value={resellerSummaryLoading ? "…" : String(resellerSummary?.onlineResellers ?? 0)} href="/admin/network/resellers" icon={<Wifi size={16} />} tone="teal" />
        </section>

        <section className="gateway-strip" aria-label="Payment gateway status">
          <span className="gateway-icon" aria-hidden="true"><Landmark size={17} /></span>
          <span className="gateway-copy">
            <strong>{isMpesaPushGateway ? "M-Pesa STK Push" : currentGatewayMode}</strong>
            <span>{isMpesaPushGateway ? displayedGatewayDetail : currentGatewayLabel}</span>
          </span>
          <span className={`isp-badge ${displayedGatewayStatus.className}`}>
            {mpesaPushStatus === "down" || gatewayError
              ? <CircleAlert size={12} />
              : mpesaPushStatus === "available" || (mpesaPushStatus === null && gatewayIsConfigured)
                ? <CircleCheck size={12} />
                : <Activity size={12} />}
            {displayedGatewayStatus.label}
          </span>
        </section>

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
          Network health
          <span>Heartbeat window · 10 seconds</span>
        </div>

        <section className="section-card dashboard-router-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="panel-title-icon"><Router size={16} /></span>
              <div>
                <h2>Router status</h2>
                <p>Online only after a recent RouterOS API heartbeat</p>
              </div>
            </div>
            <div className="panel-heading-meta">
              {!routersLoading && (
                <>
                <span className="isp-badge isp-badge-green"><span className="status-dot status-dot--green" />{onlineRouters} online</span>
                <span className="isp-badge isp-badge-red"><span className="status-dot status-dot--red" />{offlineRouters} offline</span>
                </>
              )}
              <button
                type="button"
                className="dashboard-refresh-button"
                onClick={() => { void Promise.all([refetchRouters(), telemetryQuery.refetch()]); }}
                disabled={routersFetching || telemetryQuery.isFetching}
                aria-label="Refresh router status"
                title="Refresh router status and live telemetry"
              >
                <RefreshCw size={13} className={routersFetching || telemetryQuery.isFetching ? "animate-spin" : ""} />
                Refresh routers
              </button>
            </div>
          </div>
          <div className="router-card-grid">
            {routersLoading ? (
              <div className="dashboard-loading"><Loader2 size={16} className="animate-spin" /> Loading router fleet…</div>
            ) : routers.length === 0 ? (
              <div className="dashboard-empty">
                <Server size={19} />
                <span>No routers registered yet.</span>
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

        <section className="section-card" aria-label="Network telemetry overview" style={{ marginTop: "1rem" }}>
          <div className="panel-heading">
            <div className="panel-title">
              <span className="panel-title-icon panel-title-icon--soft"><Activity size={16} /></span>
              <div>
                <h2>Network telemetry overview</h2>
                <p>Live Hotspot leases and PPPoE sessions, filtered on the server</p>
              </div>
            </div>
            {telemetry?.fetchedAt && <span className="panel-heading-meta">Updated {new Date(telemetry.fetchedAt).toLocaleTimeString()}</span>}
          </div>
          <div className="dashboard-telemetry-filters">
            <label style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", fontWeight: 650 }}>
              Filter by router
              <select value={selectedRouter} onChange={(event) => { setSelectedRouter(event.target.value === "all" ? "all" : Number(event.target.value)); setSelectedTelemetryPort("all"); }} style={{ ...inputStyle, marginTop: "0.3rem" }}>
                <option value="all">All routers</option>
                {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
              </select>
            </label>
            <label style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", fontWeight: 650 }}>
              Filter by port
              <select value={selectedTelemetryPort} onChange={(event) => setSelectedTelemetryPort(event.target.value === "all" ? "all" : Number(event.target.value))} style={{ ...inputStyle, marginTop: "0.3rem" }}>
                <option value="all">All physical ports</option>
                {telemetryPorts.map((port) => <option key={port.id} value={port.id}>{port.interfaceName}</option>)}
              </select>
            </label>
            <label style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", fontWeight: 650 }}>
              Filter by reseller
              <select value={selectedTelemetryReseller} onChange={(event) => setSelectedTelemetryReseller(event.target.value === "all" ? "all" : Number(event.target.value))} style={{ ...inputStyle, marginTop: "0.3rem" }}>
                <option value="all">All resellers</option>
                {(telemetry?.filters.resellers ?? []).map((reseller) => <option key={reseller.id} value={reseller.id}>{reseller.name}</option>)}
              </select>
            </label>
          </div>
          {telemetryQuery.isLoading ? (
            <div className="dashboard-loading"><Loader2 size={16} className="animate-spin" /> Reading active sessions…</div>
          ) : telemetryQuery.error ? (
            <div className="dashboard-empty"><CircleAlert size={17} /><span>{(telemetryQuery.error as Error).message}</span></div>
          ) : telemetry ? (
            <>
              <div className="dashboard-telemetry-totals">
                {[
                  { label: "System-wide online users", value: telemetry.totals.onlineUsers, tone: "green" },
                  { label: "Active PPPoE sessions", value: telemetry.totals.pppoeActive, tone: "accent" },
                  { label: "Active Hotspot leases", value: telemetry.totals.hotspotActive, tone: "teal" },
                ].map(({ label, value, tone }) => (
                  <div key={label} className={`dashboard-telemetry-total dashboard-telemetry-total--${tone}`}>
                    <span>{label}</span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="isp-table">
                  <thead><tr><th>Physical port</th><th>Online</th><th>PPPoE</th><th>Hotspot</th><th>Router state</th></tr></thead>
                  <tbody>
                    {telemetry.rows.length === 0 ? (
                      <tr><td colSpan={5}>No assigned port telemetry matches the selected filters.</td></tr>
                    ) : telemetry.rows.map((row) => (
                      <tr key={row.portId}>
                        <td className="table-mono">{row.interfaceName}</td>
                        <td>{row.onlineUsers}</td>
                        <td>{row.pppoeActive}</td>
                        <td>{row.hotspotActive}</td>
                        <td>
                          <span
                            className={`isp-badge ${row.routerAvailable ? "isp-badge-green" : "isp-badge-amber"}`}
                            title={row.routerAvailable ? undefined : (row.routerError ?? "Live RouterOS data is unavailable.")}
                          >
                            {row.routerAvailable ? "Available" : "Unavailable"}
                          </span>
                          {!row.routerAvailable && row.routerError && (
                            <small style={{ display: "block", marginTop: "0.2rem", color: "var(--isp-text-muted)", maxWidth: 260 }}>
                              {row.routerError}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        <div className="dashboard-section-kicker" role="heading" aria-level={2}>
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
                        <title>{`${month.month}: ${month.count} registered customers`}</title>
                        <line x1={x} y1="112" x2={x + 22} y2="112" stroke="var(--isp-border)" strokeWidth="1" />
                        <rect
                          x={x}
                          y={barTop}
                          width={22}
                          height={barHeight}
                          rx={4}
                          fill="url(#customerBarGradient)"
                          data-tooltip={`${month.month}: ${month.count} registered customers`}
                          aria-label={`${month.month}: ${month.count} registered customers`}
                        />
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
                <span className={`isp-badge ${displayedGatewayStatus.className}`}>
                  {mpesaPushStatus === "down" || gatewayError
                    ? <CircleAlert size={12} />
                    : mpesaPushStatus === "available" || (mpesaPushStatus === null && gatewayIsConfigured)
                      ? <CircleCheck size={12} />
                      : <Activity size={12} />}
                  {displayedGatewayStatus.label}
                </span>
              </div>
              <div className="gateway-detail">
                <span className="gateway-detail-icon"><Banknote size={18} /></span>
                <div>
                  <strong>{isMpesaPushGateway ? "M-Pesa STK Push" : currentGatewayMode}</strong>
                  <span>{displayedGatewayDetail}</span>
                </div>
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
              <thead><tr>{["Transaction ID", "Amount", "Method", "Status", "Date"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
              <tbody>
                {txLoading ? (
                  <tr><td colSpan={5}><div className="dashboard-loading dashboard-loading--center"><Loader2 size={16} className="animate-spin" /> Loading transactions…</div></td></tr>
                ) : recentTxs.length === 0 ? (
                  <tr><td colSpan={5}><div className="dashboard-empty dashboard-empty--center"><ReceiptText size={19} /><span>No transactions yet.</span></div></td></tr>
                ) : recentTxs.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="table-mono" title={transactionDisplayId(transaction)}>
                      {transactionDisplayId(transaction)}
                    </td>
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