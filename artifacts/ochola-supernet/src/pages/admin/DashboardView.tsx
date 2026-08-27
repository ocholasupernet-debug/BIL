import React, { useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDot,
  CreditCard,
  DollarSign,
  Minus,
  Network,
  Plus,
  Router as RouterIcon,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { DbRouter, DbTransaction } from "@/lib/supabase";
import { fmtMoney, getCurrencySymbol } from "@/lib/utils";

type RouterSelection = number | "all";

interface DashboardViewProps {
  routers: DbRouter[];
  routersLoading: boolean;
  onlineRouters: number;
  offlineRouters: number;
  routerOptions: { key: RouterSelection; label: string; online: boolean | null }[];
  selectedRouter: RouterSelection;
  selectedRouterObj: DbRouter | null | undefined;
  setSelectedRouter: (router: RouterSelection) => void;
  monthlyData: { month: string; count: number }[];
  maxCount: number;
  userInsights: { label: string; count: number; color: string }[];
  gatewayLabel: string;
  txLoading: boolean;
  recentTxs: DbTransaction[];
  transactionCount: number;
  incomeToday: number;
  incomeMonth: number;
  totalRevenue: number;
  totalOnlineNow: number;
  liveCountLoading: boolean;
  greeting: string;
}

function formatSince(iso: string | null | undefined): string {
  if (!iso) return "No recent heartbeat";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No recent heartbeat";
  return date.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KpiCell({
  label,
  value,
  highlight = false,
  icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
  icon?: React.ReactNode;
  href?: string;
}) {
  const cell = (
    <div className="isp-dashboard-kpi-cell">
      <div className="isp-dashboard-kpi-label">
        <span>{label}</span>
        {icon && <span className={`isp-dashboard-kpi-icon ${highlight ? "isp-dashboard-kpi-icon--accent" : ""}`}>{icon}</span>}
      </div>
      <div className={`isp-dashboard-kpi-value ${highlight ? "isp-dashboard-kpi-value--accent" : ""}`}>{value}</div>
    </div>
  );

  return href ? <Link href={href} className="isp-dashboard-kpi-link">{cell}</Link> : cell;
}

function DonutChart({ insights }: { insights: DashboardViewProps["userInsights"] }) {
  const total = insights.reduce((sum, segment) => sum + segment.count, 0);
  const cx = 60;
  const cy = 60;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 120 120" className="isp-dashboard-donut" role="img" aria-label={`${total} users by access type`}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--isp-dashboard-track)" strokeWidth={14} />
      {total > 0 && insights.map((segment) => {
        const dash = (segment.count / total) * circumference;
        const currentOffset = offset;
        offset += dash;
        return (
          <circle
            key={segment.label}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={14}
            strokeDasharray={`${Math.max(dash - 2, 0)} ${circumference - dash + 2}`}
            strokeDashoffset={-currentOffset + circumference * 0.25}
            strokeLinecap="round"
            style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
          />
        );
      })}
      <text x={cx} y={cy + 2} textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="9">Users</text>
    </svg>
  );
}

function StatusBadge({ online }: { online: boolean }) {
  return online ? (
    <span className="isp-dashboard-status isp-dashboard-status--online"><Wifi size={12} /> Online</span>
  ) : (
    <span className="isp-dashboard-status isp-dashboard-status--offline"><WifiOff size={12} /> Offline</span>
  );
}

function RouterTable({
  routers,
  selectedRouter,
}: {
  routers: DbRouter[];
  selectedRouter: RouterSelection;
}) {
  const visibleRouters = routers.filter((router) => selectedRouter === "all" || router.id === selectedRouter);

  if (visibleRouters.length === 0) {
    return <div className="isp-dashboard-empty">No routers match the current filter.</div>;
  }

  return (
    <div className="isp-dashboard-table-wrap">
      <table className="isp-dashboard-table">
        <thead>
          <tr>
            <th>Router</th>
            <th>Status</th>
            <th>Host IP</th>
            <th>Model</th>
            <th>RouterOS</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {visibleRouters.map((router) => {
            const online = router.status === "online" || router.status === "connected";
            return (
              <tr key={router.id}>
                <td>
                  <span className="isp-dashboard-router-name"><RouterIcon size={14} /> {router.name}</span>
                </td>
                <td><StatusBadge online={online} /></td>
                <td className="isp-dashboard-mono">{router.host}</td>
                <td>{router.model || "MikroTik"}</td>
                <td className="isp-dashboard-mono">{router.ros_version ? `v${router.ros_version}` : "—"}</td>
                <td className="isp-dashboard-muted">
                  {online ? "Healthy" : router.last_seen ? formatSince(router.last_seen) : "No heartbeat"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardView({
  routers,
  routersLoading,
  onlineRouters,
  offlineRouters,
  routerOptions,
  selectedRouter,
  selectedRouterObj,
  setSelectedRouter,
  monthlyData,
  maxCount,
  userInsights,
  gatewayLabel,
  txLoading,
  recentTxs,
  transactionCount,
  incomeToday,
  incomeMonth,
  totalRevenue,
  totalOnlineNow,
  liveCountLoading,
  greeting,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "network">("overview");
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartMinimized, setChartMinimized] = useState(false);
  const totalUsers = userInsights.reduce((sum, segment) => sum + segment.count, 0);

  return (
    <div className="isp-dashboard-page">
      <header className="isp-dashboard-page-header">
        <div>
          <div className="isp-dashboard-eyebrow"><span className="isp-dashboard-live-dot" /> Live overview</div>
          <h1>{greeting}</h1>
          <p>Real-time network and revenue telemetry for today.</p>
        </div>
        <div className="isp-dashboard-system-pill"><span className="isp-dashboard-live-dot" /> System healthy</div>
      </header>

      <section className="isp-dashboard-kpi-strip" aria-label="Performance summary">
        <KpiCell label="Income today" value={txLoading ? "…" : fmtMoney(incomeToday)} icon={<DollarSign size={14} />} />
        <KpiCell label="This month" value={txLoading ? "…" : fmtMoney(incomeMonth)} icon={<TrendingUp size={14} />} />
        <KpiCell label="Transactions" value={txLoading ? "…" : transactionCount} href="/admin/transactions" icon={<CreditCard size={14} />} />
        <KpiCell label="Total revenue" value={txLoading ? "…" : fmtMoney(totalRevenue)} href="/admin/transactions" icon={<BarChart3 size={14} />} />
        <KpiCell label="Online now" value={liveCountLoading && totalOnlineNow === 0 ? "…" : totalOnlineNow} href="/admin/customers" highlight icon={<CircleDot size={14} />} />
        <KpiCell label="Vouchers left" value="0" href="/admin/vouchers" icon={<Ticket size={14} />} />
        <KpiCell label="Support tickets" value="0" href="/admin/support" icon={<AlertCircle size={14} />} />
        <KpiCell label="Routers online" value={routersLoading ? "…" : `${onlineRouters} / ${routers.length}`} href="/admin/network" icon={<RouterIcon size={14} />} />
      </section>

      <section className="isp-dashboard-section">
        <div className="isp-dashboard-tabs" role="tablist" aria-label="Dashboard sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            className={activeTab === "overview" ? "isp-dashboard-tab isp-dashboard-tab--active" : "isp-dashboard-tab"}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "network"}
            className={activeTab === "network" ? "isp-dashboard-tab isp-dashboard-tab--active" : "isp-dashboard-tab"}
            onClick={() => setActiveTab("network")}
          >
            Network health
          </button>
        </div>

        {activeTab === "overview" ? (
          <div className="isp-dashboard-overview-grid">
            <section className="isp-dashboard-card isp-dashboard-chart-card">
              <div className="isp-dashboard-card-header">
                <div>
                  <span className="isp-dashboard-card-kicker">Customer growth</span>
                  <h2>Registered customers</h2>
                </div>
                <div className="isp-dashboard-card-actions">
                  <button type="button" className="isp-dashboard-icon-button" onClick={() => setChartCollapsed((collapsed) => !collapsed)} aria-label={chartCollapsed ? "Expand chart" : "Collapse chart"}>
                    {chartCollapsed ? <Plus size={15} /> : <Minus size={15} />}
                  </button>
                  <button type="button" className="isp-dashboard-icon-button" onClick={() => setChartMinimized((minimized) => !minimized)} aria-label={chartMinimized ? "Show chart" : "Hide chart"}>
                    <ChevronRight size={15} className={chartMinimized ? "" : "isp-dashboard-icon-button--rotated"} />
                  </button>
                </div>
              </div>
              {!chartMinimized && !chartCollapsed && (
                <div className="isp-dashboard-chart" aria-label="Monthly registered customers chart">
                  {monthlyData.every((item) => item.count === 0) ? (
                    <div className="isp-dashboard-empty">No customer registrations recorded for this year yet.</div>
                  ) : (
                    <svg viewBox={`0 0 ${monthlyData.length * 40} 140`} preserveAspectRatio="none">
                      {monthlyData.map((item, index) => {
                        const barHeight = item.count === 0 ? 1 : Math.round((item.count / maxCount) * 110);
                        const x = index * 40 + 8;
                        const barTop = 120 - barHeight;
                        return (
                          <g key={item.month}>
                            <rect x={x} y={barTop} width={24} height={barHeight} rx={2} fill="var(--isp-dashboard-accent)" />
                            <text x={x + 12} y={barTop - 8} textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">{item.count}</text>
                            <text x={x + 12} y={138} textAnchor="middle" fill="var(--isp-text-sub)" fontSize="11">{item.month}</text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>
              )}
            </section>

            <div className="isp-dashboard-side-stack">
              <section className="isp-dashboard-card">
                <div className="isp-dashboard-card-header isp-dashboard-card-header--compact">
                  <div>
                    <span className="isp-dashboard-card-kicker">Payments</span>
                    <h2>Payment gateway</h2>
                  </div>
                  <ShieldCheck size={17} className="isp-dashboard-accent-icon" />
                </div>
                <div className="isp-dashboard-gateway">
                  <div className="isp-dashboard-gateway-icon"><DollarSign size={16} /></div>
                  <div>
                    <strong>{gatewayLabel}</strong>
                    <span>Configured and ready to process</span>
                  </div>
                  <span className="isp-dashboard-active-badge"><span className="isp-dashboard-live-dot" /> Active</span>
                  <Link href="/admin/settings" className="isp-dashboard-gateway-link" aria-label="Open payment gateway settings"><ArrowUpRight size={14} /></Link>
                </div>
              </section>

              <section className="isp-dashboard-card isp-dashboard-insights-card">
                <div className="isp-dashboard-card-header isp-dashboard-card-header--compact">
                  <div>
                    <span className="isp-dashboard-card-kicker">Access mix</span>
                    <h2>User distribution</h2>
                  </div>
                  <Users size={17} className="isp-dashboard-accent-icon" />
                </div>
                <div className="isp-dashboard-insights">
                  <DonutChart insights={userInsights} />
                  <div className="isp-dashboard-insight-list">
                    {userInsights.map((segment) => (
                      <div key={segment.label} className="isp-dashboard-insight-row">
                        <span className="isp-dashboard-insight-label"><span className="isp-dashboard-insight-dot" style={{ background: segment.color }} /> {segment.label}</span>
                        <span className="isp-dashboard-insight-value">{segment.count} <small>{totalUsers ? Math.round((segment.count / totalUsers) * 100) : 0}%</small></span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <section className="isp-dashboard-network-panel">
            <div className="isp-dashboard-filter-row">
              <span className="isp-dashboard-filter-label">Filter routers</span>
              <div className="isp-dashboard-filter-options">
                {routerOptions.map((option) => {
                  const active = selectedRouter === option.key;
                  return (
                    <button key={String(option.key)} type="button" className={active ? "isp-dashboard-filter-chip isp-dashboard-filter-chip--active" : "isp-dashboard-filter-chip"} onClick={() => setSelectedRouter(option.key)}>
                      {option.online !== null && <span className={`isp-dashboard-filter-dot ${option.online ? "isp-dashboard-filter-dot--online" : "isp-dashboard-filter-dot--offline"}`} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {selectedRouter !== "all" && selectedRouterObj && (
                <button type="button" className="isp-dashboard-clear-filter" onClick={() => setSelectedRouter("all")}>
                  Clear {selectedRouterObj.name}
                </button>
              )}
            </div>
            <div className="isp-dashboard-card isp-dashboard-network-card">
              <div className="isp-dashboard-card-header">
                <div>
                  <span className="isp-dashboard-card-kicker">Infrastructure</span>
                  <h2>Router fleet status</h2>
                </div>
                <div className="isp-dashboard-status-summary">
                  <span className="isp-dashboard-active-badge">{onlineRouters} Online</span>
                  <span className="isp-dashboard-offline-badge">{offlineRouters} Offline</span>
                </div>
              </div>
              {routersLoading ? (
                <div className="isp-dashboard-empty">Loading routers…</div>
              ) : routers.length === 0 ? (
                <div className="isp-dashboard-empty">No routers registered yet. <Link href="/admin/network/routers">Add a router <ArrowUpRight size={13} /></Link></div>
              ) : (
                <RouterTable routers={routers} selectedRouter={selectedRouter} />
              )}
            </div>
          </section>
        )}
      </section>

      <section className="isp-dashboard-card isp-dashboard-transactions-card">
        <div className="isp-dashboard-card-header">
          <div>
            <span className="isp-dashboard-card-kicker">Cash flow</span>
            <h2>Recent transactions</h2>
          </div>
          <Link href="/admin/transactions" className="isp-dashboard-view-all">View all <ArrowUpRight size={14} /></Link>
        </div>
        <div className="isp-dashboard-table-wrap">
          <table className="isp-dashboard-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th className="isp-dashboard-align-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {txLoading ? (
                <tr><td colSpan={6} className="isp-dashboard-table-message">Loading transactions…</td></tr>
              ) : recentTxs.length === 0 ? (
                <tr><td colSpan={6} className="isp-dashboard-table-message">No transactions yet.</td></tr>
              ) : recentTxs.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="isp-dashboard-muted isp-dashboard-mono">#{transaction.id}</td>
                  <td className="isp-dashboard-mono">{transaction.reference || "—"}</td>
                  <td className="isp-dashboard-amount">{getCurrencySymbol()} {transaction.amount.toLocaleString()}</td>
                  <td><span className={transaction.payment_method === "mpesa" ? "isp-dashboard-method isp-dashboard-method--mpesa" : "isp-dashboard-method"}>{transaction.payment_method}</span></td>
                  <td><span className={transaction.status === "completed" ? "isp-dashboard-transaction-status isp-dashboard-transaction-status--complete" : "isp-dashboard-transaction-status"}><span /> {transaction.status}</span></td>
                  <td className="isp-dashboard-muted isp-dashboard-align-right">{new Date(transaction.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}