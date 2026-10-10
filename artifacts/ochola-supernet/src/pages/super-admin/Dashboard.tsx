import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2,
  Database, Gauge, Globe, HardDrive, ReceiptText, RefreshCw, Router, ShieldAlert,
  Users, XCircle,
} from "lucide-react";
import { formatBinaryBytes } from "@/lib/formatBinaryBytes";

interface AdminRecord {
  id: number;
  name: string | null;
  username: string | null;
  email: string | null;
  is_active: boolean | null;
  subdomain: string | null;
  role: string | null;
}
interface RouterRecord {
  id: number;
  name: string | null;
  host: string | null;
  status: string | null;
  admin_id: number | null;
}
interface CustomerRecord {
  id: number;
  admin_id: number | null;
  is_active: boolean | null;
}
interface PlanRecord {
  id: number;
  admin_id: number | null;
  type: string | null;
}
interface PlatformIncomeSummary {
  registrationToday: number;
  registrationMonth: number;
  registrationTotal: number;
  registrationTransactions: number;
  renewalToday: number;
  renewalMonth: number;
  renewalTotal: number;
  renewalTransactions: number;
}
interface PlatformTransaction {
  transactionId: number;
  accountId: number | null;
  accountName: string;
  accountRole: string | null;
  category: "registration" | "renewal";
  amount: number;
  paymentMethod: string;
  status: string;
  createdAt: string | null;
}
interface PhysicalStorageSource {
  source: string;
  status: "available" | "partial" | "unavailable" | "stale";
  freeBytes: number | null;
  usedBytes: number | null;
  capacityBytes: number | null;
  measuredAt: string | null;
}
interface PhysicalStorageSummary {
  physicalSources: PhysicalStorageSource[];
}

function formatKes(amount: number | undefined): string {
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount ?? 0)}`;
}

function isRouterOnline(status: string | null): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === "online" || normalized === "active";
}

function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={`sa-status ${active ? "is-good" : "is-bad"}`}>
      {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {label || (active ? "Active" : "Inactive")}
    </span>
  );
}

function MetricCard({
  label, value, detail, tone, icon: Icon, loading,
}: {
  label: string;
  value: string | number;
  detail: React.ReactNode;
  tone: "accent" | "green" | "amber" | "teal";
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <div className="sa-metric-card" data-tone={tone}>
      <div className="sa-metric-top">
        <p className="sa-metric-label">{label}</p>
        <div className="sa-metric-icon"><Icon size={16} /></div>
      </div>
      <p className="sa-metric-value">
        {loading ? <span className="sa-metric-skeleton" role="status" aria-label={`Loading ${label}`} /> : value}
      </p>
      <p className="sa-metric-sub">{detail}</p>
    </div>
  );
}

function CardHeading({
  icon: Icon, title, description, count,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  count?: number;
}) {
  return (
    <div className="sa-card-head">
      <div className="sa-card-head-icon"><Icon size={14} /></div>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {count !== undefined && <span className="sa-card-head-count">{count}</span>}
    </div>
  );
}

export default function SuperAdminDashboard() {
  const [lastRefresh, setLastRefresh] = React.useState(() => new Date());
  const [transactionSearch, setTransactionSearch] = React.useState("");

  const adminsQuery = useQuery<AdminRecord[]>({
    queryKey: ["sa_all_admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins")
        .select("id,name,username,email,is_active,subdomain,role,created_at")
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const routersQuery = useQuery<RouterRecord[]>({
    queryKey: ["sa_all_routers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,admin_id")
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const customersQuery = useQuery<CustomerRecord[]>({
    queryKey: ["sa_all_customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_customers")
        .select("id,admin_id,is_active")
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const plansQuery = useQuery<PlanRecord[]>({
    queryKey: ["sa_all_plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_plans")
        .select("id,admin_id,type")
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const incomeQuery = useQuery<PlatformIncomeSummary>({
    queryKey: ["sa_platform_income"],
    queryFn: async () => {
      const token = localStorage.getItem("ochola_superadmin_token") || "";
      const response = await fetch("/api/super-admin/billing/income-summary", {
        headers: { "x-sa-token": token },
      });
      const result = await response.json() as { ok?: boolean; error?: string; summary?: PlatformIncomeSummary };
      if (!response.ok || !result.ok || !result.summary) {
        throw new Error(result.error || "Could not load platform income.");
      }
      return result.summary;
    },
  });
  const platformTransactionsQuery = useQuery<PlatformTransaction[]>({
    queryKey: ["sa_platform_transactions"],
    queryFn: async () => {
      const token = localStorage.getItem("ochola_superadmin_token") || "";
      const response = await fetch("/api/super-admin/billing/platform-transactions", {
        headers: { "x-sa-token": token },
      });
      const result = await response.json() as { ok?: boolean; error?: string; transactions?: PlatformTransaction[] };
      if (!response.ok || !result.ok || !result.transactions) {
        throw new Error(result.error || "Could not load platform transactions.");
      }
      return result.transactions;
    },
    refetchInterval: 60_000,
  });
  const storageSummaryQuery = useQuery<PhysicalStorageSummary>({
    queryKey: ["sa_vps_storage_summary"],
    queryFn: async () => {
      const token = localStorage.getItem("ochola_superadmin_token") || "";
      const response = await fetch("/api/super-admin/storage/physical-summary", {
        headers: { "x-sa-token": token },
      });
      const result = await response.json() as { ok?: boolean; error?: string; physicalSources?: PhysicalStorageSource[] };
      if (!response.ok || !result.ok || !result.physicalSources) {
        throw new Error(result.error || "Could not load VPS disk availability.");
      }
      return { physicalSources: result.physicalSources };
    },
    staleTime: 60_000,
  });

  const admins = adminsQuery.data ?? [];
  const routers = routersQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const platformTransactions = platformTransactionsQuery.data ?? [];
  const filteredPlatformTransactions = useMemo(() => {
    const needle = transactionSearch.trim();
    if (!needle) return platformTransactions;
    return platformTransactions.filter(transaction => String(transaction.transactionId).includes(needle));
  }, [platformTransactions, transactionSearch]);
  const hasError = adminsQuery.isError || routersQuery.isError || customersQuery.isError || plansQuery.isError || incomeQuery.isError || platformTransactionsQuery.isError || storageSummaryQuery.isError;
  const vpsDisk = storageSummaryQuery.data?.physicalSources.find(source => source.source === "vps_filesystem");

  const activeAdmins = admins.filter((admin) => admin.is_active !== false).length;
  const inactiveAdmins = admins.filter((admin) => admin.is_active === false);
  const onlineRouters = routers.filter((router) => isRouterOnline(router.status)).length;
  const offlineRouters = routers.filter((router) => !isRouterOnline(router.status));
  const activeCustomers = customers.filter((customer) => customer.is_active !== false).length;
  const routerAvailability = routers.length ? `${Math.round((onlineRouters / routers.length) * 100)}%` : "—";
  const planOwners = new Set(
    plans.map((plan) => plan.admin_id).filter((adminId): adminId is number => adminId !== null),
  ).size;

  const adminCustomerCounts = useMemo(() => {
    const counts = new Map<number, number>();
    customers.forEach((customer) => {
      if (customer.admin_id !== null) counts.set(customer.admin_id, (counts.get(customer.admin_id) || 0) + 1);
    });
    return counts;
  }, [customers]);

  const adminRouterCounts = useMemo(() => {
    const counts = new Map<number, number>();
    routers.forEach((router) => {
      if (router.admin_id !== null) counts.set(router.admin_id, (counts.get(router.admin_id) || 0) + 1);
    });
    return counts;
  }, [routers]);

  const visibleAdmins = useMemo(() => {
    return [...admins]
      .sort((a, b) => Number(a.is_active !== false) - Number(b.is_active !== false) || a.id - b.id)
      .slice(0, 8);
  }, [admins]);

  const retryAll = () => {
    void Promise.all([
      adminsQuery.refetch(),
      routersQuery.refetch(),
      customersQuery.refetch(),
      plansQuery.refetch(),
      incomeQuery.refetch(),
      platformTransactionsQuery.refetch(),
      storageSummaryQuery.refetch(),
    ]).then(() => setLastRefresh(new Date()));
  };

  return (
    <SuperAdminLayout>
      <div className="sa-dashboard">
        <div className="sa-page-head">
          <div>
            <p className="sa-eyebrow"><span className="sa-eyebrow-mark" /> Control room</p>
            <h1>Platform overview</h1>
            <p>One view across tenants, network infrastructure, customers, and platform income. Registration and renewal receipts are reported separately from ISP and reseller revenue.</p>
          </div>
          <div className="sa-snapshot" title="Time this dashboard last requested its data">
            <Database size={12} />
            <span>Snapshot {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <button type="button" onClick={retryAll} aria-label="Refresh dashboard data" title="Refresh dashboard data" style={{ display: "inline-flex", border: 0, padding: 0, color: "inherit", background: "transparent", cursor: "pointer" }}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {hasError && (
          <div className="dashboard-error" role="alert">
            <AlertTriangle size={15} />
            <span>Some platform data could not be read. Existing values may be incomplete.</span>
            <button className="dashboard-error-retry" onClick={retryAll}>Retry</button>
          </div>
        )}

        <div className="sa-command-grid">
          <MetricCard
            label="ISP admins"
            value={adminsQuery.isError ? "—" : admins.length}
            detail={adminsQuery.isError ? "Data unavailable" : <><strong>{activeAdmins}</strong> active · {inactiveAdmins.length} inactive</>}
            tone="accent"
            icon={Users}
            loading={adminsQuery.isLoading}
          />
          <MetricCard
            label="Routers"
            value={routersQuery.isError ? "—" : routers.length}
            detail={routersQuery.isError ? "Data unavailable" : <><strong>{onlineRouters}</strong> online · {offlineRouters.length} not online</>}
            tone="green"
            icon={Router}
            loading={routersQuery.isLoading}
          />
          <MetricCard
            label="Customers"
            value={customersQuery.isError ? "—" : customers.length}
            detail={customersQuery.isError ? "Data unavailable" : <><strong>{activeCustomers}</strong> active records</>}
            tone="teal"
            icon={Globe}
            loading={customersQuery.isLoading}
          />
          <MetricCard
            label="Plans"
            value={plansQuery.isError ? "—" : plans.length}
            detail={plansQuery.isError ? "Data unavailable" : <><strong>{planOwners}</strong> ISP admins with plans</>}
            tone="amber"
            icon={BarChart3}
            loading={plansQuery.isLoading}
          />
        </div>

        <div className="sa-command-grid" style={{ marginTop: 16 }}>
          <MetricCard
            label="Registration income · this month"
            value={incomeQuery.isError ? "—" : formatKes(incomeQuery.data?.registrationMonth)}
            detail={incomeQuery.isError
              ? "Income data unavailable"
              : <><strong>{formatKes(incomeQuery.data?.registrationToday)}</strong> today · {formatKes(incomeQuery.data?.registrationTotal)} all time · {incomeQuery.data?.registrationTransactions ?? 0} payments</>}
            tone="accent"
            icon={Users}
            loading={incomeQuery.isLoading}
          />
          <MetricCard
            label="Renewal income · this month"
            value={incomeQuery.isError ? "—" : formatKes(incomeQuery.data?.renewalMonth)}
            detail={incomeQuery.isError
              ? "Income data unavailable"
              : <><strong>{formatKes(incomeQuery.data?.renewalToday)}</strong> today · {formatKes(incomeQuery.data?.renewalTotal)} all time · {incomeQuery.data?.renewalTransactions ?? 0} payments</>}
            tone="green"
            icon={Activity}
            loading={incomeQuery.isLoading}
          />
        </div>

        <section className="sa-card" style={{ marginTop: 16 }}>
          <CardHeading
            icon={ReceiptText}
            title="Registration and renewal transactions"
            description="Platform payments are listed here by transaction ID and excluded from ISP and reseller transaction views."
            count={platformTransactions.length}
          />
          <div style={{ padding: "0 20px 14px" }}>
            <input
              aria-label="Search platform transactions by transaction ID"
              placeholder="Search by transaction ID"
              value={transactionSearch}
              onChange={event => setTransactionSearch(event.target.value.replace(/\D/g, ""))}
              style={{
                width: "100%",
                maxWidth: 320,
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid var(--isp-accent-glow)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--isp-text)",
                font: "inherit",
              }}
            />
          </div>
          {platformTransactionsQuery.isLoading ? (
            <div className="sa-empty">Loading platform transactions…</div>
          ) : platformTransactionsQuery.isError ? (
            <div className="sa-empty">Platform transactions are unavailable. Use Refresh to try again.</div>
          ) : filteredPlatformTransactions.length === 0 ? (
            <div className="sa-empty">
              {platformTransactions.length ? "No transaction IDs match this search." : "No registration or renewal transactions recorded yet."}
            </div>
          ) : (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Payment method</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlatformTransactions.map(transaction => {
                    const normalizedStatus = transaction.status.toLowerCase();
                    const statusColor = ["completed", "paid", "success"].includes(normalizedStatus)
                      ? "#34d399"
                      : ["pending", "initiating"].includes(normalizedStatus) ? "#fbbf24" : "#f87171";
                    return (
                      <tr key={transaction.transactionId}>
                        <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>#{transaction.transactionId}</td>
                        <td>
                          <div>{transaction.accountName}</div>
                          <small style={{ color: "var(--isp-text-muted)" }}>
                            {transaction.accountRole || "Account"}{transaction.accountId ? ` · #${transaction.accountId}` : ""}
                          </small>
                        </td>
                        <td>{transaction.category === "registration" ? "Registration" : "Renewal"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatKes(transaction.amount)}</td>
                        <td>{transaction.paymentMethod.replaceAll("_", " ")}</td>
                        <td style={{ color: statusColor, textTransform: "capitalize" }}>{transaction.status}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {transaction.createdAt
                            ? new Date(transaction.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="sa-empty" style={{ textAlign: "left", paddingTop: 10 }}>
            Showing the latest {platformTransactions.length} platform transaction{platformTransactions.length === 1 ? "" : "s"}.
          </div>
        </section>

        <div className="sa-attention">
          <div className={`sa-attention-item${inactiveAdmins.length ? " is-alert" : ""}`}>
            <div className="sa-attention-icon">
              {inactiveAdmins.length ? <ShieldAlert size={15} /> : <CheckCircle2 size={15} />}
            </div>
            <div className="sa-attention-copy">
              <p className="sa-attention-label">Admin attention</p>
              <p className="sa-attention-value">{adminsQuery.isError ? "Admin data unavailable" : inactiveAdmins.length ? `${inactiveAdmins.length} inactive admin${inactiveAdmins.length === 1 ? "" : "s"}` : "No inactive admins recorded"}</p>
            </div>
          </div>
          <div className={`sa-attention-item${offlineRouters.length ? " is-alert" : ""}`}>
            <div className="sa-attention-icon">
              {offlineRouters.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            </div>
            <div className="sa-attention-copy">
              <p className="sa-attention-label">Router attention</p>
              <p className="sa-attention-value">{routersQuery.isError ? "Router data unavailable" : offlineRouters.length ? `${offlineRouters.length} router${offlineRouters.length === 1 ? "" : "s"} not online` : "All recorded routers are online"}</p>
            </div>
          </div>
        </div>

        <div className="sa-columns">
          <section className="sa-card">
            <CardHeading icon={Users} title="ISP admin register" description="Tenant owners and observed resource counts" count={admins.length} />
            {adminsQuery.isLoading ? (
              <div aria-label="Loading admins">
                {[1, 2, 3, 4].map((item) => <div className="sa-skeleton" key={item} />)}
              </div>
            ) : visibleAdmins.length === 0 ? (
              <div className="sa-empty">No ISP admin records are available.</div>
            ) : (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Admin</th>
                      <th>Tenant</th>
                      <th>Resources</th>
                      <th>Status</th>
                      <th aria-label="Open admin management" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAdmins.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <div className="sa-admin-cell">
                            <div className="sa-admin-mark">{(admin.name || admin.username || "?")[0].toUpperCase()}</div>
                            <div>
                              <div className="sa-admin-name">{admin.name || admin.username || "Unnamed admin"}</div>
                              <div className="sa-mono">{admin.username || "no username"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="sa-mono">{admin.subdomain ? `${admin.subdomain}.isplatty.org` : "—"}</td>
                        <td className="sa-mono">{adminCustomerCounts.get(admin.id) || 0} customers · {adminRouterCounts.get(admin.id) || 0} routers</td>
                        <td><StatusBadge active={admin.is_active !== false} /></td>
                        <td><Link className="sa-table-link" href="/super-admin/admins">Manage <ArrowUpRight size={12} /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {admins.length > visibleAdmins.length && (
              <div style={{ padding: "12px 17px", borderTop: "1px solid var(--sa-line)", textAlign: "right" }}>
                <Link className="sa-table-link" href="/super-admin/admins">View all {admins.length} admins <ArrowUpRight size={12} /></Link>
              </div>
            )}
          </section>

          <div className="sa-side-stack">
            <section className="sa-card">
              <CardHeading icon={Router} title="Router watch" description="Status values reported by router records" count={routers.length} />
              {routersQuery.isLoading ? (
                <div aria-label="Loading routers">{[1, 2, 3].map((item) => <div className="sa-skeleton" key={item} />)}</div>
              ) : routers.length === 0 ? (
                <div className="sa-empty">No router records are available.</div>
              ) : (
                <div className="sa-list">
                  {[...offlineRouters, ...routers.filter((router) => isRouterOnline(router.status))].slice(0, 6).map((router) => {
                    const online = isRouterOnline(router.status);
                    return (
                      <div className="sa-list-row" key={router.id}>
                        <div className="sa-list-main">
                          <span className={`sa-list-dot${online ? " is-good" : ""}`} />
                          <div>
                            <p className="sa-list-name">{router.name || router.host || `Router ${router.id}`}</p>
                            <p className="sa-list-meta">{router.host || "Host not recorded"}</p>
                          </div>
                        </div>
                        <span className="sa-list-state">{router.status || "unknown"}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ padding: "0 17px 16px", textAlign: "right" }}>
                <Link className="sa-table-link" href="/super-admin/routers">Open router management <ArrowUpRight size={12} /></Link>
              </div>
            </section>

            <section className="sa-card">
              <CardHeading icon={HardDrive} title="VPS storage" description="Physical server disk reading" />
              {storageSummaryQuery.isLoading ? (
                <div className="sa-empty" role="status">Loading VPS disk reading…</div>
              ) : storageSummaryQuery.isError ? (
                <div className="sa-empty">VPS disk reading is unavailable. Open Storage Governance to review.</div>
              ) : !vpsDisk || vpsDisk.freeBytes === null ? (
                <div className="sa-empty">No VPS filesystem reading is available.</div>
              ) : (
                <div style={{ padding: "0 17px 14px" }}>
                  <div className="sa-list-row">
                    <div className="sa-list-main">
                      <HardDrive size={14} color={vpsDisk.status === "available" ? "#34d399" : "#fbbf24"} />
                      <p className="sa-list-name">Disk free</p>
                    </div>
                    <span className="sa-list-state">{formatBinaryBytes(vpsDisk.freeBytes)}</span>
                  </div>
                  <p className="sa-list-meta" style={{ margin: "8px 0 0" }}>
                    {vpsDisk.status === "available" ? "Current reading" : `Last reading · ${vpsDisk.status}`}
                    {vpsDisk.measuredAt ? ` · ${new Date(vpsDisk.measuredAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                  </p>
                  {vpsDisk.capacityBytes !== null && (
                    <p className="sa-list-meta" style={{ margin: "4px 0 0" }}>
                      {formatBinaryBytes(vpsDisk.usedBytes)} used of {formatBinaryBytes(vpsDisk.capacityBytes)}
                    </p>
                  )}
                </div>
              )}
              <div style={{ padding: "0 17px 14px", textAlign: "right" }}>
                <Link className="sa-table-link" href="/super-admin/storage">Open Storage Governance <ArrowUpRight size={12} /></Link>
              </div>
            </section>

            <section className="sa-card">
              <CardHeading icon={Activity} title="Observed signals" description="Measurable records available in this view" />
              <div className="sa-list">
                <div className="sa-list-row">
                  <div className="sa-list-main"><Gauge size={14} color="var(--isp-accent)" /><p className="sa-list-name">Router availability</p></div>
                  <span className="sa-list-state">{routersQuery.isError ? "unavailable" : routerAvailability}</span>
                </div>
                <div className="sa-list-row">
                  <div className="sa-list-main"><Users size={14} color="var(--isp-accent)" /><p className="sa-list-name">Active admin share</p></div>
                  <span className="sa-list-state">{adminsQuery.isError ? "unavailable" : admins.length ? `${Math.round((activeAdmins / admins.length) * 100)}%` : "—"}</span>
                </div>
                <div className="sa-list-row">
                  <div className="sa-list-main"><Globe size={14} color="var(--isp-accent)" /><p className="sa-list-name">Active customer share</p></div>
                  <span className="sa-list-state">{customersQuery.isError ? "unavailable" : customers.length ? `${Math.round((activeCustomers / customers.length) * 100)}%` : "—"}</span>
                </div>
              </div>
              <div className="sa-health-note">
                <Activity size={13} />
                <span>This dashboard reports database records and router status values. It does not run separate API, RADIUS, or backup health checks.</span>
              </div>
            </section>

            <section className="sa-card">
              <CardHeading icon={ArrowUpRight} title="Jump to service" description="Open the existing management surfaces" />
              <div className="sa-quick-links">
                <Link className="sa-quick-link" href="/super-admin/admins"><Users size={14} /> ISP admins</Link>
                <Link className="sa-quick-link" href="/super-admin/routers"><Router size={14} /> Routers</Link>
                <Link className="sa-quick-link" href="/super-admin/payment-packages"><BarChart3 size={14} /> Packages</Link>
                <Link className="sa-quick-link" href="/super-admin/reports"><Database size={14} /> Reports</Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </SuperAdminLayout>
  );
}