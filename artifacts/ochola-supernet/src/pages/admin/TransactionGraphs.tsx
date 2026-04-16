import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase } from "@/lib/supabase";
import type { DbTransaction } from "@/lib/supabase";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

/* ─── Types ─── */
interface PlanRow  { id: number; router_id: number | null }
interface RouterRow { id: number; name: string }

/* ─── Data fetchers ─── */
async function fetchTransactions(): Promise<DbTransaction[]> {
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("id,amount,status,plan_id,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbTransaction[];
}
async function fetchPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("isp_plans")
    .select("id,router_id");
  if (error) throw error;
  return (data ?? []) as PlanRow[];
}
async function fetchRouters(): Promise<RouterRow[]> {
  const { data, error } = await supabase
    .from("isp_routers")
    .select("id,name");
  if (error) throw error;
  return (data ?? []) as RouterRow[];
}

/* ─── Date helpers ─── */
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function isoWeekKey(d: Date): string {
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(wn).padStart(2, "0")}`;
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMonth(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" });
}
function fmtWeek(key: string) {
  return key.replace("-", " ");
}
function fmtDay(key: string) {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

const PIE_COLORS = ["var(--isp-accent)", "#4ade80", "#f59e0b", "#f87171", "var(--isp-accent)", "#fb923c", "#34d399"];

/* ─── Comparison card ─── */
function CompareCard({ title, current, previous, unit = "Ksh" }: {
  title: string;
  current: number;
  previous: number;
  unit?: string;
}) {
  const pct = previous === 0
    ? current > 0 ? 100 : 0
    : ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isDown = pct < 0;
  const CARD: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: "28px 32px",
    flex: 1,
    minWidth: 220,
  };
  return (
    <div style={CARD}>
      <p style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ color: "#e2e8f0", fontSize: 13 }}>
          Current: <strong style={{ color: "#f1f5f9" }}>{unit} {current.toLocaleString()}</strong>
        </p>
        <p style={{ color: "#e2e8f0", fontSize: 13 }}>
          Previous: <strong style={{ color: "#f1f5f9" }}>{unit} {previous.toLocaleString()}</strong>
        </p>
        <p style={{ color: "#e2e8f0", fontSize: 13, marginTop: 4 }}>Change:</p>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 999, width: "fit-content",
          background: isUp ? "rgba(74,222,128,0.12)" : isDown ? "rgba(248,113,113,0.12)" : "rgba(148,163,184,0.1)",
          color: isUp ? "#4ade80" : isDown ? "#f87171" : "#94a3b8",
          fontSize: 13, fontWeight: 700,
        }}>
          {isUp ? <TrendingUp size={14} /> : isDown ? <TrendingDown size={14} /> : <Minus size={14} />}
          {Math.abs(pct).toFixed(2)}% {isUp ? "Increase" : isDown ? "Decrease" : "No change"}
        </div>
      </div>
    </div>
  );
}

/* ─── Chart card wrapper ─── */
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16,
      padding: "24px 28px",
    }}>
      <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{title}</h3>
      {children}
    </div>
  );
}

/* ─── Custom tooltip ─── */
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e293b",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 10,
      padding: "10px 16px",
      color: "#f1f5f9",
      fontSize: 13,
    }}>
      <p style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: "#4ade80" }}>Ksh {Number(p.value).toLocaleString()}</p>
      ))}
    </div>
  );
}

/* ─── Main page ─── */
export default function TransactionGraphs() {
  const now = new Date();

  const { data: txns = [], isLoading: loadingTxns, refetch } = useQuery({
    queryKey: ["txn_graphs"],
    queryFn: fetchTransactions,
    refetchInterval: 60_000,
  });
  const { data: plans = [] } = useQuery({ queryKey: ["plans_slim"], queryFn: fetchPlans });
  const { data: routers = [] } = useQuery({ queryKey: ["routers_slim"], queryFn: fetchRouters });

  /* Use only completed transactions for revenue numbers */
  const completed = useMemo(() =>
    txns.filter(t => t.status === "completed"),
    [txns]);

  /* ─── Comparison windows ─── */
  const todayStr     = toDateStr(now);
  const yesterday    = new Date(now); yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);
  const thisWeekKey  = isoWeekKey(now);
  const lastWeekDate = new Date(now); lastWeekDate.setDate(now.getDate() - 7);
  const lastWeekKey  = isoWeekKey(lastWeekDate);
  const thisMonthKey = monthKey(now);
  const lastMonthDate = new Date(now); lastMonthDate.setMonth(now.getMonth() - 1);
  const lastMonthKey = monthKey(lastMonthDate);

  const sumWhere = (fn: (t: DbTransaction) => boolean) =>
    completed.filter(fn).reduce((s, t) => s + t.amount, 0);

  const todayTotal     = sumWhere(t => toDateStr(new Date(t.created_at)) === todayStr);
  const yesterdayTotal = sumWhere(t => toDateStr(new Date(t.created_at)) === yesterdayStr);
  const thisWeekTotal  = sumWhere(t => isoWeekKey(new Date(t.created_at)) === thisWeekKey);
  const lastWeekTotal  = sumWhere(t => isoWeekKey(new Date(t.created_at)) === lastWeekKey);
  const thisMonthTotal = sumWhere(t => monthKey(new Date(t.created_at)) === thisMonthKey);
  const lastMonthTotal = sumWhere(t => monthKey(new Date(t.created_at)) === lastMonthKey);

  /* ─── Daily chart — last 30 days ─── */
  const dailyData = useMemo(() => {
    const map: Record<string, number> = {};
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const k = toDateStr(d);
      map[k] = 0;
      days.push(k);
    }
    completed.forEach(t => {
      const k = toDateStr(new Date(t.created_at));
      if (k in map) map[k] += t.amount;
    });
    return days.map(k => ({ label: fmtDay(k), total: map[k] }));
  }, [completed]);

  /* ─── Weekly chart — last 12 weeks ─── */
  const weeklyData = useMemo(() => {
    const map: Record<string, number> = {};
    const weeks: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      const k = isoWeekKey(d);
      if (!map[k]) { map[k] = 0; weeks.push(k); }
    }
    completed.forEach(t => {
      const k = isoWeekKey(new Date(t.created_at));
      if (k in map) map[k] += t.amount;
    });
    const seen = new Set<string>();
    return weeks.filter(k => { if (seen.has(k)) return false; seen.add(k); return true; })
      .map(k => ({ label: fmtWeek(k), total: map[k] }));
  }, [completed]);

  /* ─── Monthly chart — last 12 months ─── */
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      map[k] = 0;
      months.push(k);
    }
    completed.forEach(t => {
      const k = monthKey(new Date(t.created_at));
      if (k in map) map[k] += t.amount;
    });
    return months.map(k => ({ label: fmtMonth(k), total: map[k] }));
  }, [completed]);

  /* ─── By Router (current month) ─── */
  const routerPieData = useMemo(() => {
    const planMap: Record<number, number | null> = {};
    plans.forEach(p => { planMap[p.id] = p.router_id; });
    const routerMap: Record<number, string> = {};
    routers.forEach(r => { routerMap[r.id] = r.name; });

    const byRouter: Record<string, number> = {};
    completed
      .filter(t => monthKey(new Date(t.created_at)) === thisMonthKey)
      .forEach(t => {
        const rid = t.plan_id != null ? planMap[t.plan_id] : null;
        const label = rid != null && routerMap[rid]
          ? routerMap[rid]
          : "Unassigned";
        byRouter[label] = (byRouter[label] ?? 0) + t.amount;
      });

    return Object.entries(byRouter)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [completed, plans, routers, thisMonthKey]);

  const nowStr = now.toLocaleString("en-KE", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return (
    <AdminLayout>
      <div style={{ padding: "32px 40px", maxWidth: 1280, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <h1 style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 26, margin: 0 }}>
              Transactions Overview
            </h1>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>As of {nowStr}</p>
          </div>
          <button
            onClick={() => refetch()}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 18px", borderRadius: 10,
              background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)",
              color: "var(--isp-accent)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loadingTxns ? (
          <div style={{ color: "#64748b", textAlign: "center", padding: "60px 0" }}>Loading transactions…</div>
        ) : (
          <>
            {/* Comparison cards */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 32 }}>
              <CompareCard title="Today vs Yesterday"        current={todayTotal}     previous={yesterdayTotal} />
              <CompareCard title="This Week vs Last Week"    current={thisWeekTotal}  previous={lastWeekTotal} />
              <CompareCard title="This Month vs Last Month"  current={thisMonthTotal} previous={lastMonthTotal} />
            </div>

            {/* Charts grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24 }}>

              {/* Daily */}
              <ChartCard title="Daily Transactions">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={dailyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--isp-accent)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--isp-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} interval={4} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" name="Total Amount" stroke="var(--isp-accent)" fill="url(#gBlue)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Weekly */}
              <ChartCard title="Weekly Transactions">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={weeklyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="total" name="Total Amount" fill="#4ade80" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Monthly */}
              <ChartCard title="Monthly Transactions">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gCyan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--isp-accent)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--isp-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" name="Total Amount" stroke="var(--isp-accent)" fill="url(#gCyan)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* By Router — current month */}
              <ChartCard title="Transactions by Router (Current Month)">
                {routerPieData.length === 0 ? (
                  <div style={{ color: "#64748b", textAlign: "center", paddingTop: 80, fontSize: 13 }}>
                    No data for this month yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={routerPieData}
                        cx="50%" cy="50%"
                        innerRadius={60} outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ stroke: "#475569", strokeWidth: 1 }}
                      >
                        {routerPieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [`Ksh ${v.toLocaleString()}`, "Revenue"]}
                        contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#f1f5f9" }}
                      />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
