import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import { BarChart3, Users, Router, Loader2, TrendingUp, Globe, FileText } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

function Kpi({ label, value, sub, color, icon: Icon, loading }: { label: string; value: string | number; sub?: string; color: string; icon: React.ElementType; loading?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={{ fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{label}</p>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} color={color} />
        </div>
      </div>
      <p style={{ fontSize: "1.8rem", fontWeight: 800, color: "white", margin: 0, lineHeight: 1 }}>
        {loading ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color }} /> : value}
      </p>
      {sub && <p style={{ fontSize: "0.7rem", color: C.sub, margin: "5px 0 0" }}>{sub}</p>}
    </div>
  );
}

export default function SuperAdminReports() {
  const { data: admins = [], isLoading: la } = useQuery({ queryKey: ["sa_rpt_admins"], queryFn: async () => { const { data } = await supabase.from("isp_admins").select("id,name,is_active,created_at"); return data ?? []; } });
  const { data: routers = [], isLoading: lr } = useQuery({ queryKey: ["sa_rpt_routers"], queryFn: async () => { const { data } = await supabase.from("isp_routers").select("id,admin_id,status,created_at"); return data ?? []; } });
  const { data: customers = [], isLoading: lc } = useQuery({ queryKey: ["sa_rpt_customers"], queryFn: async () => { const { data } = await supabase.from("isp_customers").select("id,admin_id,is_active,type,created_at"); return data ?? []; } });
  const { data: plans = [], isLoading: lp } = useQuery({ queryKey: ["sa_rpt_plans"], queryFn: async () => { const { data } = await supabase.from("isp_plans").select("id,admin_id,type,price"); return data ?? []; } });

  const activeAdmins = admins.filter(a => a.is_active !== false).length;
  const activeCustomers = customers.filter(c => c.is_active !== false).length;
  const onlineRouters = routers.filter(r => r.status === "online" || r.status === "active").length;
  const hotspotPlans = plans.filter(p => p.type === "hotspot").length;
  const pppoeCustomers = customers.filter(c => c.type === "pppoe").length;

  const adminRouterMap: Record<number, number> = {};
  routers.forEach(r => { adminRouterMap[r.admin_id] = (adminRouterMap[r.admin_id] || 0) + 1; });

  const adminCustomerMap: Record<number, number> = {};
  customers.forEach(c => { adminCustomerMap[c.admin_id] = (adminCustomerMap[c.admin_id] || 0) + 1; });

  const topAdmins = admins
    .map(a => ({ ...a, customers: adminCustomerMap[a.id] || 0, routers: adminRouterMap[a.id] || 0 }))
    .sort((a, b) => b.customers - a.customers)
    .slice(0, 8);

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1100 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Platform Reports</h1>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Live statistics aggregated across all ISP accounts.</p>
        </div>

        {/* KPI Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
          <Kpi label="Total ISPs" value={admins.length} sub={`${activeAdmins} active`} color="var(--isp-accent)" icon={Users} loading={la} />
          <Kpi label="Total Customers" value={customers.length} sub={`${activeCustomers} active`} color="var(--isp-accent)" icon={Globe} loading={lc} />
          <Kpi label="Total Routers" value={routers.length} sub={`${onlineRouters} online`} color="#8b5cf6" icon={Router} loading={lr} />
          <Kpi label="Total Plans" value={plans.length} sub={`${hotspotPlans} hotspot`} color="#f59e0b" icon={BarChart3} loading={lp} />
          <Kpi label="PPPoE Customers" value={pppoeCustomers} sub="across all ISPs" color="#10b981" icon={TrendingUp} loading={lc} />
          <Kpi label="Hotspot Plans" value={hotspotPlans} sub={`of ${plans.length} total`} color="#f97316" icon={FileText} loading={lp} />
        </div>

        {/* ISP Breakdown Table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={16} color={C.accent} />
            <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem" }}>ISP Breakdown</span>
            <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: C.muted }}>Sorted by customer count</span>
          </div>
          {(la || lc || lr) ? (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
              <Loader2 size={22} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
              <p>Loading…</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["#", "ISP Name", "Customers", "Routers", "Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 18px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topAdmins.map((a, i) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "12px 18px", color: C.muted, fontWeight: 700 }}>#{i + 1}</td>
                      <td style={{ padding: "12px 18px" }}>
                        <span style={{ fontWeight: 700, color: "white" }}>{a.name || "Unnamed"}</span>
                      </td>
                      <td style={{ padding: "12px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, maxWidth: 100, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 3, background: "var(--isp-accent)", width: `${Math.min(100, (a.customers / Math.max(1, ...topAdmins.map(x => x.customers))) * 100)}%` }} />
                          </div>
                          <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{a.customers}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 18px" }}>
                        <span style={{ fontWeight: 600, color: a.routers > 0 ? "#8b5cf6" : C.muted }}>{a.routers}</span>
                      </td>
                      <td style={{ padding: "12px 18px" }}>
                        <span style={{
                          padding: "3px 10px", borderRadius: 12, fontSize: "0.68rem", fontWeight: 700,
                          background: a.is_active !== false ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
                          color: a.is_active !== false ? "#4ade80" : "#f87171",
                        }}>
                          {a.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Customer Type Split */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <p style={{ fontWeight: 700, color: "white", margin: "0 0 16px", fontSize: "0.9rem" }}>Customer Types</p>
            {lc ? <div style={{ color: C.muted, textAlign: "center" }}>Loading…</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Hotspot", count: customers.filter(c => c.type === "hotspot" || !c.type).length, color: "var(--isp-accent)" },
                  { label: "PPPoE", count: customers.filter(c => c.type === "pppoe").length, color: "#8b5cf6" },
                  { label: "Other", count: customers.filter(c => c.type && c.type !== "hotspot" && c.type !== "pppoe").length, color: "#f59e0b" },
                ].map(t => (
                  <div key={t.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: "0.78rem", color: C.sub }}>{t.label}</span>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: t.color }}>{t.count}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 3, background: t.color, width: `${customers.length ? (t.count / customers.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <p style={{ fontWeight: 700, color: "white", margin: "0 0 16px", fontSize: "0.9rem" }}>Plan Types</p>
            {lp ? <div style={{ color: C.muted, textAlign: "center" }}>Loading…</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Hotspot", count: plans.filter(p => p.type === "hotspot").length, color: "var(--isp-accent)" },
                  { label: "PPPoE", count: plans.filter(p => p.type === "pppoe").length, color: "#8b5cf6" },
                  { label: "Data", count: plans.filter(p => p.type === "data").length, color: "#10b981" },
                  { label: "Other", count: plans.filter(p => !["hotspot","pppoe","data"].includes(p.type)).length, color: "#f59e0b" },
                ].map(t => (
                  <div key={t.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: "0.78rem", color: C.sub }}>{t.label}</span>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: t.color }}>{t.count}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 3, background: t.color, width: `${plans.length ? (t.count / plans.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
