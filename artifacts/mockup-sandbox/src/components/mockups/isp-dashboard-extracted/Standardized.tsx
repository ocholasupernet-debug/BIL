import "./_group.css";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarDays,
  CircleCheck,
  Eye,
  EyeOff,
  Landmark,
  MessageSquare,
  ReceiptText,
  Router,
  Server,
  Signal,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

type RouterFixture = {
  id: number;
  name: string;
  host: string;
  status: "online" | "offline";
  model: string;
  ros_version: string;
};

const routers: RouterFixture[] = [
  { id: 1, name: "Nairobi-Core", host: "102.68.77.12", status: "online", model: "hEX S", ros_version: "7.14.2" },
  { id: 2, name: "Westlands-AP", host: "10.10.0.2", status: "online", model: "RB4011", ros_version: "7.13.5" },
  { id: 3, name: "Kasarani-Node", host: "10.10.0.7", status: "offline", model: "hAP ac²", ros_version: "7.12" },
];

const customers = [
  ...Array.from({ length: 58 }, (_, i) => ({ id: i + 1, type: "hotspot", created_at: `2025-${String((i % 7) + 1).padStart(2, "0")}-12T08:00:00Z` })),
  ...Array.from({ length: 24 }, (_, i) => ({ id: i + 59, type: "pppoe", created_at: `2025-${String((i % 7) + 1).padStart(2, "0")}-19T08:00:00Z` })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: i + 83, type: "static", created_at: `2025-${String((i % 7) + 1).padStart(2, "0")}-23T08:00:00Z` })),
];

const transactions = [
  { id: 1042, reference: "SFK92XQ71P", amount: 1500, payment_method: "mpesa", status: "completed", created_at: "2025-07-25T08:10:00Z" },
  { id: 1041, reference: "SFK88LM20T", amount: 500, payment_method: "mpesa", status: "completed", created_at: "2025-07-25T07:44:00Z" },
  { id: 1040, reference: "SFK71AB93K", amount: 2999, payment_method: "mpesa", status: "completed", created_at: "2025-07-24T21:03:00Z" },
  { id: 1039, reference: "STR-8842", amount: 1200, payment_method: "card", status: "pending", created_at: "2025-07-24T18:31:00Z" },
  { id: 1038, reference: "SFK55QW18Z", amount: 750, payment_method: "mpesa", status: "completed", created_at: "2025-07-24T16:22:00Z" },
];

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (value: number) => `KSh ${value.toLocaleString("en-KE")}`;

function FixtureLink({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <a href="#" className={className} onClick={(event) => event.preventDefault()}>{children}</a>;
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className={`std-metric-card std-tone-${tone}`}>
      <span className="std-metric-icon" aria-hidden="true">{icon}</span>
      <span className="std-metric-copy">
        <span className="std-metric-label">{label}</span>
        <strong className="std-metric-value">{value}</strong>
      </span>
    </article>
  );
}

function AccessChart({ insights }: { insights: { label: string; count: number; color: string }[] }) {
  const total = insights.reduce((sum, item) => sum + item.count, 0);
  const radius = 53;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="std-access-content">
      <svg className="std-donut" viewBox="0 0 160 160" role="img" aria-label={`${total} total users`}>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--isp-border)" strokeWidth="18" />
        {insights.map((item) => {
          const dash = (item.count / total) * circumference;
          const segmentOffset = offset;
          offset += dash;
          return (
            <circle
              key={item.label}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth="18"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-segmentOffset + circumference * 0.25}
              style={{ transform: "rotate(-90deg)", transformOrigin: "80px 80px" }}
            />
          );
        })}
        <text x="80" y="75" textAnchor="middle" fill="var(--isp-text)" fontSize="18" fontWeight="700">{total}</text>
        <text x="80" y="94" textAnchor="middle" fill="var(--isp-text-muted)" fontSize="10">Total users</text>
      </svg>
      <div className="std-access-legend">
        {insights.map((item) => (
          <div className="std-access-row" key={item.label}>
            <span className="std-swatch" style={{ background: item.color }} />
            <span>{item.label}</span>
            <strong>{item.count}</strong>
            <small>{Math.round((item.count / total) * 100)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function RenewalReminder() {
  const [phone, setPhone] = useState("0712 345 678");
  const [message, setMessage] = useState("");

  return (
    <section className="std-renewal" aria-label="Monthly platform renewal reminder">
      <span className="std-renewal-icon"><CalendarDays size={18} /></span>
      <div className="std-renewal-copy">
        <strong>Platform renewal due</strong>
        <span>KSh 2,500 due by 31 Jul. Time left: 5d 4h 20m</span>
        <small>{message || "Monthly platform renewal reminder"}</small>
      </div>
      <form
        className="std-renewal-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("Payment prompt simulated in this preview.");
        }}
      >
        <label className="sr-only" htmlFor="renewal-phone">M-Pesa phone number</label>
        <input
          id="renewal-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          aria-label="M-Pesa phone number"
          placeholder="07xx xxx xxx"
        />
        <button type="submit">Renew</button>
      </form>
    </section>
  );
}

export function Standardized() {
  const [selectedRouter, setSelectedRouter] = useState<number | "all">("all");
  const [hideAmounts, setHideAmounts] = useState(false);
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const onlineRouterCount = routers.filter((router) => router.status === "online").length;
  const visibleRouters = selectedRouter === "all" ? routers : routers.filter((router) => router.id === selectedRouter);
  const insights = [
    { label: "Hotspot", count: 58, color: "var(--isp-accent)" },
    { label: "PPPoE", count: 24, color: "#8879b7" },
    { label: "Static", count: 9, color: "var(--isp-green)" },
  ];
  const monthlyCustomers = useMemo(
    () => months.map((month, index) => ({
      month,
      count: customers.filter((customer) => new Date(customer.created_at).getMonth() === index).length,
    })),
    [],
  );
  const maxMonthlyCount = Math.max(...monthlyCustomers.map((month) => month.count), 1);

  return (
    <div className="std-variant">
      <div className="admin-shell isp-mock std-shell">
        <aside className={`admin-sidebar std-sidebar ${phoneMenuOpen ? "std-mobile-open" : ""}`}>
          <div className="sidebar-logo">
            <div className="sidebar-logo-inner">
              <div className="sidebar-logo-icon"><Router size={16} /></div>
              <div><div className="sidebar-brand-name">Ochola SuperNet</div><div className="sidebar-brand-sub">Admin Panel</div></div>
            </div>
            <button className="sidebar-close-btn" type="button" aria-label="Toggle navigation" onClick={() => setPhoneMenuOpen(!phoneMenuOpen)}>
              <SlidersHorizontal size={14} />
            </button>
          </div>
          <nav className={`sidebar-nav ${phoneMenuOpen ? "std-nav-open" : ""}`} aria-label="Main navigation">
            {["Overview", "Customers", "Billing", "Network", "Tools", "Admin"].map((section) => (
              <div className="nav-section" key={section}>
                <div className="nav-section-label">{section}</div>
                <FixtureLink className={`nav-row ${section === "Overview" ? "nav-row--active" : ""}`}>
                  <span className="nav-icon"><Activity size={14} /></span>
                  <span className="nav-label">{section === "Overview" ? "Dashboard" : section}</span>
                </FixtureLink>
              </div>
            ))}
          </nav>
          <div className="sidebar-user">
            <div className="sidebar-avatar">A</div>
            <div className="sidebar-user-info"><div className="sidebar-user-name">Administrator</div><div className="sidebar-user-status"><span className="status-dot" /> Online</div></div>
          </div>
        </aside>

        <div className="admin-main">
          <header className="admin-header std-header">
            <button className="header-btn std-menu-toggle" type="button" aria-label="Open navigation" onClick={() => setPhoneMenuOpen(!phoneMenuOpen)}>
              <SlidersHorizontal size={16} />
            </button>
            <div className="header-search">
              <span className="header-search-icon" aria-hidden="true">⌕</span>
              <input className="header-search-input" aria-label="Search" placeholder="Search customers, routers…" />
              <kbd className="header-search-kbd">⌘K</kbd>
            </div>
            <div className="header-spacer" />
            <div className="header-actions">
              <div className="header-live-pill"><span className="live-dot" /> LIVE</div>
              <button className="header-btn" type="button" aria-label="Messages"><MessageSquare size={15} /></button>
              <div className="header-user-pill"><div className="header-avatar">A</div><span className="header-user-name">Administrator</span></div>
            </div>
          </header>

          <main className="admin-content std-content">
            <RenewalReminder />
            <div className="dashboard-page std-dashboard" style={{ "--dashboard-accent": "#2563eb" } as CSSProperties}>
              <header className="dashboard-hero std-hero">
                <div>
                  <div className="dashboard-eyebrow"><span className="dashboard-live-mark"><Activity size={12} /></span>Live operations</div>
                  <h1>Good morning, Administrator</h1>
                  <p>Network pulse, customer activity, and cashflow in one view.</p>
                </div>
                <div className="dashboard-date"><CalendarDays size={15} /> Friday, 25 July</div>
              </header>

              <section className="std-section" aria-labelledby="std-financial-title">
                <div className="std-section-heading">
                  <div><h2 id="std-financial-title">Financial pulse</h2><p>Updated from live payment activity</p></div>
                  <button className="std-amount-toggle" type="button" onClick={() => setHideAmounts((hidden) => !hidden)} aria-pressed={hideAmounts}>
                    {hideAmounts ? <Eye size={14} /> : <EyeOff size={14} />}
                    {hideAmounts ? "Show amounts" : "Hide amounts"}
                  </button>
                </div>
                <div className="std-metrics-grid std-financial-grid">
                  <MetricCard label="Income today" value={hideAmounts ? "••••" : money(2000)} icon={<Banknote size={18} />} tone="green" />
                  <MetricCard label="Income this month" value={hideAmounts ? "••••" : money(48750)} icon={<TrendingUp size={18} />} tone="green" />
                  <MetricCard label="Total transactions" value="128" icon={<ReceiptText size={18} />} tone="amber" />
                  <MetricCard label="Total revenue" value={hideAmounts ? "••••" : money(152300)} icon={<BarChart3 size={18} />} tone="plum" />
                </div>
              </section>

              <section className="std-section" aria-labelledby="std-network-title">
                <div className="std-section-heading">
                  <div><h2 id="std-network-title">Network overview</h2><p>Current subscriber and reseller activity</p></div>
                </div>
                <div className="std-metrics-grid std-network-grid">
                  <MetricCard label="Total online users" value="37" icon={<Users size={17} />} tone="green" />
                  <MetricCard label="PPPoE online" value="18" icon={<Wifi size={17} />} tone="blue" />
                  <MetricCard label="Hotspot online" value="14" icon={<Signal size={17} />} tone="teal" />
                  <MetricCard label="VLAN users online" value="3" icon={<Wifi size={17} />} tone="blue" />
                  <MetricCard label="Static online" value="2" icon={<Server size={17} />} tone="amber" />
                  <MetricCard label="Active / expired users" value="90/1" icon={<CircleCheck size={17} />} tone="green" />
                  <MetricCard label="Active resellers" value="6" icon={<Users size={17} />} tone="blue" />
                  <MetricCard label="Online resellers" value="4" icon={<Wifi size={17} />} tone="teal" />
                </div>
                <div className="std-gateway">
                  <span className="std-gateway-icon"><Landmark size={18} /></span>
                  <div className="std-gateway-copy"><strong>mpesapaybillstk</strong><span>M-Pesa PayBill · Payment gateway</span></div>
                  <span className="isp-badge isp-badge-green"><CircleCheck size={12} /> Active</span>
                  <FixtureLink className="gateway-link">Manage gateway <ArrowUpRight size={13} /></FixtureLink>
                </div>
              </section>

              <section className="std-section" aria-labelledby="std-health-title">
                <div className="std-section-heading">
                  <div><h2 id="std-health-title">Network health</h2><p>Router heartbeat window · 10 seconds</p></div>
                  <div className="std-health-counts">
                    <span className="isp-badge isp-badge-green"><span className="status-dot" />{onlineRouterCount} online</span>
                    <span className="isp-badge isp-badge-red"><span className="std-status-dot std-status-off" />{routers.length - onlineRouterCount} offline</span>
                  </div>
                </div>
                <section className="std-panel" aria-label="Router status">
                  <div className="std-panel-heading">
                    <span className="std-panel-icon"><Router size={16} /></span>
                    <div><h3>Router status</h3><p>Online only after a recent RouterOS API heartbeat</p></div>
                  </div>
                  <div className="std-router-grid">
                    {visibleRouters.map((router) => (
                      <article className={`std-router-card ${router.status === "offline" ? "is-offline" : ""}`} key={router.id}>
                        <div className="std-router-topline">
                          <strong>{router.name}</strong>
                          <span className={`std-router-status ${router.status}`}>
                            {router.status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {router.status === "online" ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className="std-router-host">{router.host}</div>
                        <div className="std-router-meta">{router.model} · ROS v{router.ros_version}</div>
                        {router.status === "offline" && <div className="std-router-seen">Last seen Yesterday 18:42</div>}
                      </article>
                    ))}
                  </div>
                </section>
                <div className="std-router-filter" aria-label="Filter dashboard by router">
                  <span><SlidersHorizontal size={15} /> Filter by router</span>
                  <div className="std-filter-options">
                    {[{ key: "all" as const, label: "All routers" }, ...routers.map((router) => ({ key: router.id, label: router.name }))].map((option) => (
                      <button
                        key={String(option.key)}
                        type="button"
                        className={selectedRouter === option.key ? "is-selected" : ""}
                        aria-pressed={selectedRouter === option.key}
                        onClick={() => setSelectedRouter(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {selectedRouter !== "all" && (
                    <button className="std-clear-filter" type="button" onClick={() => setSelectedRouter("all")} aria-label="Clear router filter">
                      Clear <X size={13} />
                    </button>
                  )}
                </div>
                <section className="std-panel std-telemetry" aria-label="Network telemetry overview">
                  <div className="std-panel-heading std-panel-heading-between">
                    <div className="std-heading-with-icon">
                      <span className="std-panel-icon"><Activity size={16} /></span>
                      <div><h3>Network telemetry overview</h3><p>Live Hotspot leases and PPPoE sessions, filtered on the server</p></div>
                    </div>
                    <span className="std-updated">Updated 09:42</span>
                  </div>
                  <div className="std-telemetry-filters">
                    <label>Filter by router<select value={selectedRouter} onChange={(event) => setSelectedRouter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All routers</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select></label>
                    <label>Filter by port<select defaultValue="all"><option value="all">All physical ports</option><option>ether1</option><option>ether2</option></select></label>
                    <label>Filter by reseller<select defaultValue="all"><option value="all">All resellers</option><option>Ochola Partners</option></select></label>
                  </div>
                  <div className="std-telemetry-totals">
                    <div><span>System-wide online users</span><strong>37</strong></div>
                    <div><span>Active PPPoE sessions</span><strong>18</strong></div>
                    <div><span>Active Hotspot leases</span><strong>14</strong></div>
                  </div>
                  <div className="transaction-table-wrap">
                    <table className="isp-table std-table">
                      <thead><tr><th>Physical port</th><th>Online</th><th>PPPoE</th><th>Hotspot</th><th>Router state</th></tr></thead>
                      <tbody>
                        {routers.map((router) => (
                          <tr key={router.id}>
                            <td className="table-mono">ether{router.id}</td><td>12</td><td>6</td><td>5</td>
                            <td><span className={`isp-badge ${router.status === "online" ? "isp-badge-green" : "isp-badge-amber"}`}>{router.status === "online" ? "Available" : "Unavailable"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>

              <section className="std-section" aria-labelledby="std-customer-title">
                <div className="std-section-heading">
                  <div><h2 id="std-customer-title">Customer intelligence</h2><p>Accounts, access mix, and payment flow</p></div>
                </div>
                <div className="std-customer-grid">
                  <section className="std-panel" aria-label="Monthly registered customers">
                    <div className="std-panel-heading">
                      <span className="std-panel-icon"><Users size={16} /></span>
                      <div><h3>Monthly registered customers</h3><p>New accounts in 2025</p></div>
                    </div>
                    <div className="std-chart-wrap">
                      <svg className="std-customer-chart" viewBox="0 0 600 170" role="img" aria-label="Monthly registered customer counts">
                        {monthlyCustomers.map((month, index) => {
                          const height = month.count ? Math.max((month.count / maxMonthlyCount) * 104, 3) : 3;
                          const x = index * 49 + 7;
                          return (
                            <g key={month.month}>
                              <title>{`${month.month}: ${month.count} registered customers`}</title>
                              <line x1={x} y1="132" x2={x + 30} y2="132" stroke="var(--isp-border)" />
                              <rect x={x} y={132 - height} width="30" height={height} rx="4" fill="var(--isp-accent)" opacity=".82" />
                              <text x={x + 15} y="153" textAnchor="middle">{month.month}</text>
                              <text className="std-bar-count" x={x + 15} y={126 - height} textAnchor="middle">{month.count}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </section>
                  <section className="std-panel" aria-label="Users by access type">
                    <div className="std-panel-heading">
                      <span className="std-panel-icon"><Activity size={16} /></span>
                      <div><h3>Users by access type</h3><p>Registered customer mix</p></div>
                    </div>
                    <AccessChart insights={insights} />
                  </section>
                </div>
              </section>

              <section className="std-section" aria-labelledby="std-activity-title">
                <div className="std-section-heading">
                  <div><h2 id="std-activity-title">Payment activity</h2><p>Most recent subscriber transactions</p></div>
                  <FixtureLink className="std-view-all">View all <ArrowUpRight size={14} /></FixtureLink>
                </div>
                <section className="std-panel std-transactions" aria-label="Recent transactions">
                  <div className="std-panel-heading">
                    <span className="std-panel-icon"><ReceiptText size={16} /></span>
                    <div><h3>Recent transactions</h3><p>Latest payment activity across subscribers</p></div>
                  </div>
                  <div className="transaction-table-wrap">
                    <table className="isp-table std-table">
                      <thead><tr>{["ID", "Reference", "Amount", "Method", "Status", "Date"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td className="table-mono">#{transaction.id}</td>
                            <td className="table-mono">{transaction.reference}</td>
                            <td className="table-amount">{money(transaction.amount)}</td>
                            <td><span className={`isp-badge ${transaction.payment_method === "mpesa" ? "isp-badge-blue" : "isp-badge-amber"}`}>{transaction.payment_method.toUpperCase()}</span></td>
                            <td><span className={`isp-badge ${transaction.status === "completed" ? "isp-badge-green" : "isp-badge-amber"}`}>{transaction.status}</span></td>
                            <td className="table-date">{new Date(transaction.created_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>
            </div>
          </main>
        </div>
      </div>
      <style>{`
        .std-variant { min-height: 100dvh; background: var(--isp-bg); }
        .std-variant .std-shell { min-height: 100dvh; }
        .std-variant .std-sidebar { display:flex; flex-direction:column; flex:0 0 236px; }
        .std-variant .sidebar-nav { flex:1; }
        .std-variant .nav-row { text-decoration:none; }
        .std-variant .std-header { position:sticky; top:0; z-index:5; min-height:62px; }
        .std-variant .std-menu-toggle { display:none; }
        .std-variant .std-content { width:100%; max-width:1480px; padding:24px clamp(16px,2.4vw,34px) 48px; }
        .std-variant .std-renewal {
          display:flex; align-items:center; gap:14px; margin:0 auto 22px; padding:13px 15px;
          border:1px solid rgba(197,139,48,.34); border-radius:10px;
          background:color-mix(in srgb, #f5c768 12%, var(--isp-card)); box-shadow:var(--shadow-card);
        }
        .std-variant .std-renewal-icon { display:grid; width:36px; height:36px; place-items:center; flex:0 0 auto; border-radius:9px; color:#9c6b16; background:rgba(197,139,48,.13); }
        .std-variant .std-renewal-copy { min-width:0; flex:1; }
        .std-variant .std-renewal-copy strong { display:block; color:var(--isp-text); font-size:.82rem; }
        .std-variant .std-renewal-copy span,.std-variant .std-renewal-copy small { display:block; margin-top:3px; color:var(--isp-text-muted); font-size:.72rem; }
        .std-variant .std-renewal-copy small { color:var(--isp-text-sub); font-size:.65rem; }
        .std-variant .std-renewal-actions { display:flex; gap:8px; }
        .std-variant .std-renewal-actions input { width:150px; padding:8px 10px; border:1px solid var(--isp-border); border-radius:7px; color:var(--isp-text); background:var(--isp-card); font:inherit; font-size:.72rem; }
        .std-variant .std-renewal-actions button { padding:8px 13px; border:1px solid #b47d20; border-radius:7px; color:#fff; background:#a87319; cursor:pointer; font-family:inherit; font-size:.72rem; font-weight:600; }
        .std-variant .std-dashboard { gap:22px; }
        .std-variant .std-hero { padding:2px 0 1px; }
        .std-variant .std-hero h1 { font-size:1.55rem; }
        .std-variant .std-section { display:flex; flex-direction:column; gap:12px; }
        .std-variant .std-section-heading { display:flex; min-height:38px; align-items:center; justify-content:space-between; gap:14px; }
        .std-variant .std-section-heading h2 { margin:0; color:var(--isp-text); font-size:.89rem; font-weight:750; letter-spacing:-.01em; }
        .std-variant .std-section-heading p { margin:3px 0 0; color:var(--isp-text-muted); font-size:.69rem; }
        .std-variant .std-amount-toggle,.std-variant .std-clear-filter { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--isp-border); border-radius:7px; padding:7px 10px; color:var(--isp-text-muted); background:var(--isp-card); cursor:pointer; font-family:inherit; font-size:.67rem; font-weight:600; }
        .std-variant .std-metrics-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:11px; }
        .std-variant .std-metric-card { display:flex; min-width:0; min-height:76px; align-items:center; gap:11px; padding:12px 13px; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-card); box-shadow:var(--shadow-card); }
        .std-variant .std-metric-icon { display:grid; width:34px; height:34px; place-items:center; flex:0 0 auto; border-radius:8px; color:var(--metric-color,var(--isp-accent)); background:color-mix(in srgb,var(--metric-color,var(--isp-accent)) 10%,transparent); }
        .std-variant .std-metric-copy { display:flex; min-width:0; flex-direction:column; gap:5px; }
        .std-variant .std-metric-label { color:var(--isp-text-muted); font-size:.66rem; line-height:1.3; }
        .std-variant .std-metric-value { color:var(--isp-text); font-size:1.02rem; font-weight:750; line-height:1.1; font-variant-numeric:tabular-nums; }
        .std-variant .std-tone-green { --metric-color:#0f9d78; }
        .std-variant .std-tone-amber { --metric-color:#b78329; }
        .std-variant .std-tone-plum { --metric-color:#8275a9; }
        .std-variant .std-tone-blue { --metric-color:#2563eb; }
        .std-variant .std-tone-teal { --metric-color:#168c9a; }
        .std-variant .std-network-grid .std-metric-card { min-height:68px; padding:10px 12px; }
        .std-variant .std-network-grid .std-metric-value { font-size:.98rem; }
        .std-variant .std-gateway { display:flex; min-height:58px; align-items:center; gap:11px; padding:10px 13px; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-card); box-shadow:var(--shadow-card); }
        .std-variant .std-gateway-icon { display:grid; width:32px; height:32px; place-items:center; border-radius:8px; color:var(--isp-accent); background:var(--isp-accent-glow); }
        .std-variant .std-gateway-copy { display:flex; min-width:0; flex:1; flex-direction:column; gap:3px; }
        .std-variant .std-gateway-copy strong { font-size:.75rem; }
        .std-variant .std-gateway-copy span { color:var(--isp-text-muted); font-size:.67rem; }
        .std-variant .std-health-counts { display:flex; gap:7px; }
        .std-variant .std-status-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#dc2626; }
        .std-variant .std-panel { overflow:hidden; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-card); box-shadow:var(--shadow-card); }
        .std-variant .std-panel-heading { display:flex; min-height:55px; align-items:center; gap:10px; padding:10px 13px; border-bottom:1px solid var(--isp-border-subtle); }
        .std-variant .std-heading-with-icon { display:flex; align-items:center; gap:10px; }
        .std-variant .std-panel-icon { display:grid; width:29px; height:29px; place-items:center; flex:0 0 auto; border-radius:8px; color:var(--isp-accent); background:var(--isp-accent-glow); }
        .std-variant .std-panel-heading h3 { margin:0; color:var(--isp-text); font-size:.78rem; font-weight:700; }
        .std-variant .std-panel-heading p { margin:4px 0 0; color:var(--isp-text-muted); font-size:.65rem; }
        .std-variant .std-panel-heading-between { justify-content:space-between; }
        .std-variant .std-updated { color:var(--isp-text-sub); font-size:.65rem; }
        .std-variant .std-router-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:12px 13px 13px; }
        .std-variant .std-router-card { min-width:0; padding:11px 12px; border:1px solid var(--isp-border); border-left:3px solid #0f9d78; border-radius:8px; background:var(--isp-inner-card); }
        .std-variant .std-router-card.is-offline { border-left-color:#d65252; }
        .std-variant .std-router-topline { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .std-variant .std-router-topline strong { overflow:hidden; font-size:.73rem; text-overflow:ellipsis; white-space:nowrap; }
        .std-variant .std-router-status { display:inline-flex; align-items:center; gap:4px; font-size:.63rem; font-weight:700; }
        .std-variant .std-router-status.online { color:#14815f; }
        .std-variant .std-router-status.offline,.std-variant .std-router-seen { color:#c33f3f; }
        .std-variant .std-router-host { margin-top:8px; color:var(--isp-text-muted); font: .66rem "JetBrains Mono",monospace; }
        .std-variant .std-router-meta,.std-variant .std-router-seen { margin-top:5px; color:var(--isp-text-sub); font-size:.64rem; }
        .std-variant .std-router-filter { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:10px 12px; border:1px solid var(--isp-border); border-radius:9px; background:var(--isp-card); }
        .std-variant .std-router-filter > span { display:inline-flex; align-items:center; gap:6px; color:var(--isp-text-muted); font-size:.68rem; font-weight:700; }
        .std-variant .std-filter-options { display:flex; flex:1; flex-wrap:wrap; gap:6px; }
        .std-variant .std-filter-options button { padding:5px 9px; border:1px solid var(--isp-border); border-radius:999px; color:var(--isp-text-muted); background:transparent; cursor:pointer; font-family:inherit; font-size:.64rem; font-weight:600; }
        .std-variant .std-filter-options button.is-selected { color:var(--isp-accent); border-color:var(--isp-accent); background:var(--isp-accent-glow); }
        .std-variant .std-clear-filter { padding:5px 8px; }
        .std-variant .std-telemetry-filters { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:12px 13px 0; }
        .std-variant .std-telemetry-filters label { color:var(--isp-text-muted); font-size:.65rem; font-weight:650; }
        .std-variant .std-telemetry-filters select { display:block; width:100%; margin-top:5px; padding:7px 8px; border:1px solid var(--isp-border); border-radius:7px; color:var(--isp-text); background:var(--isp-inner-card); font:inherit; font-size:.68rem; }
        .std-variant .std-telemetry-totals { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; padding:12px 13px; }
        .std-variant .std-telemetry-totals > div { padding:9px 11px; border:1px solid var(--isp-border-subtle); border-left:3px solid var(--isp-accent); border-radius:7px; background:var(--isp-inner-card); }
        .std-variant .std-telemetry-totals > div:first-child { border-left-color:#0f9d78; }
        .std-variant .std-telemetry-totals > div:last-child { border-left-color:#168c9a; }
        .std-variant .std-telemetry-totals span { display:block; color:var(--isp-text-muted); font-size:.63rem; }
        .std-variant .std-telemetry-totals strong { display:block; margin-top:4px; font-size:1rem; font-variant-numeric:tabular-nums; }
        .std-variant .std-table { font-size:.69rem; }
        .std-variant .std-table th { padding:9px 12px; font-size:.6rem; }
        .std-variant .std-table td { padding:9px 12px; }
        .std-variant .std-customer-grid { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(280px,1fr); gap:12px; }
        .std-variant .std-chart-wrap { padding:13px 17px 9px; }
        .std-variant .std-customer-chart { display:block; width:100%; height:auto; }
        .std-variant .std-customer-chart text { fill:var(--isp-text-sub); font:10px Inter,system-ui,sans-serif; }
        .std-variant .std-customer-chart .std-bar-count { fill:var(--isp-text-muted); font-size:9px; }
        .std-variant .std-access-content { display:flex; min-height:180px; align-items:center; gap:12px; padding:10px 15px; }
        .std-variant .std-donut { width:145px; flex:0 0 145px; }
        .std-variant .std-access-legend { display:flex; min-width:0; flex:1; flex-direction:column; gap:10px; }
        .std-variant .std-access-row { display:flex; align-items:center; gap:7px; color:var(--isp-text-muted); font-size:.68rem; }
        .std-variant .std-access-row strong { margin-left:auto; color:var(--isp-text); }
        .std-variant .std-access-row small { width:32px; color:var(--isp-text-sub); text-align:right; }
        .std-variant .std-swatch { width:9px; height:9px; flex:0 0 auto; border-radius:50%; }
        .std-variant .std-view-all { display:flex; align-items:center; gap:4px; color:var(--isp-accent); font-size:.68rem; text-decoration:none; }
        .std-variant .std-transactions .std-panel-heading { border-bottom:0; }
        @media (max-width: 1000px) {
          .std-variant .std-metrics-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .std-variant .std-customer-grid { grid-template-columns:1fr; }
        }
        @media (max-width: 720px) {
          .std-variant .std-sidebar { display:none; }
          .std-variant .std-sidebar.std-mobile-open { display:flex; position:fixed; z-index:12; inset:0 auto 0 0; width:250px; }
          .std-variant .std-menu-toggle { display:grid; }
          .std-variant .std-header { gap:9px; padding-inline:12px; }
          .std-variant .header-search { width:auto; flex:1; }
          .std-variant .header-search-kbd,.std-variant .header-user-name { display:none; }
          .std-variant .std-content { padding:14px 12px 30px; }
          .std-variant .std-renewal { align-items:flex-start; flex-wrap:wrap; }
          .std-variant .std-renewal-copy { flex:1 1 calc(100% - 52px); }
          .std-variant .std-renewal-actions { width:100%; padding-left:50px; }
          .std-variant .std-renewal-actions input { min-width:0; flex:1; }
          .std-variant .std-hero { display:block; }
          .std-variant .std-hero h1 { font-size:1.35rem; }
          .std-variant .dashboard-date { width:max-content; margin-top:12px; }
          .std-variant .std-section-heading { align-items:flex-start; }
          .std-variant .std-health-counts { flex-direction:column; align-items:flex-end; }
          .std-variant .std-router-grid { grid-template-columns:1fr; }
          .std-variant .std-telemetry-filters,.std-variant .std-telemetry-totals { grid-template-columns:1fr; }
          .std-variant .std-access-content { flex-direction:column; }
          .std-variant .std-donut { align-self:center; }
          .std-variant .std-updated { display:none; }
        }
      `}</style>
    </div>
  );
}