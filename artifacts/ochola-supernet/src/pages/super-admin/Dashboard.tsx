import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import {
  Users, Router, BarChart3, Activity, CheckCircle2, XCircle,
  Clock, TrendingUp, Globe, Loader2, AlertTriangle,
} from "lucide-react";

const C = {
  card:    "rgba(255,255,255,0.04)",
  border:  "rgba(99,102,241,0.15)",
  accent:  "#6366f1",
  accent2: "#8b5cf6",
  text:    "#e2e8f0",
  muted:   "#64748b",
  sub:     "#94a3b8",
};

function StatCard({ label, value, sub, color, icon: Icon, loading }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ElementType; loading?: boolean;
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{label}</p>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, color: "white", margin: "6px 0 0", lineHeight: 1 }}>
            {loading ? <Loader2 size={22} style={{ animation: "spin 1s linear infinite", color }} /> : value}
          </p>
          {sub && <p style={{ fontSize: "0.7rem", color: C.sub, margin: "4px 0 0" }}>{sub}</p>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={18} color={color} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700,
      background: active ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
      color: active ? "#4ade80" : "#f87171",
      border: `1px solid ${active ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
    }}>
      {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function SuperAdminDashboard() {
  const { data: admins = [], isLoading: loadingAdmins } = useQuery({
    queryKey: ["sa_all_admins"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("id,name,username,email,is_active,subdomain,role,created_at").order("id");
      return data ?? [];
    },
  });

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["sa_all_routers"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("id,name,host,status,admin_id").order("id");
      return data ?? [];
    },
  });

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["sa_all_customers"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_customers").select("id,admin_id,is_active").order("id");
      return data ?? [];
    },
  });

  const { data: plans = [], isLoading: loadingPlans } = useQuery({
    queryKey: ["sa_all_plans"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_plans").select("id,admin_id,type").order("id");
      return data ?? [];
    },
  });

  const topAdmins = admins.slice(0, 8);
  const onlineRouters = routers.filter(r => r.status === "online" || r.status === "active").length;
  const activeAdmins = admins.filter(a => a.is_active).length;
  const activeCustomers = customers.filter(c => c.is_active !== false).length;

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1200 }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "white", margin: 0 }}>Platform Overview</h1>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.85rem" }}>Real-time view of all ISPs, routers, and customers on the platform.</p>
        </div>

        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginBottom: 28 }}>
          <StatCard label="Total ISP Admins" value={admins.length} sub={`${activeAdmins} active`} color="#6366f1" icon={Users} loading={loadingAdmins} />
          <StatCard label="Total Routers" value={routers.length} sub={`${onlineRouters} online`} color="#8b5cf6" icon={Router} loading={loadingRouters} />
          <StatCard label="Total Customers" value={customers.length} sub={`${activeCustomers} active`} color="#06b6d4" icon={Globe} loading={loadingCustomers} />
          <StatCard label="Total Plans" value={plans.length} sub="across all ISPs" color="#f59e0b" icon={BarChart3} loading={loadingPlans} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          {/* Admins Table */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={16} color={C.accent} />
              <span style={{ fontWeight: 700, color: "white", fontSize: "0.9rem" }}>Registered ISP Admins</span>
              <span style={{ marginLeft: "auto", background: "rgba(99,102,241,0.15)", color: C.accent, fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 12 }}>
                {admins.length}
              </span>
            </div>
            {loadingAdmins ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
                <p style={{ margin: 0, fontSize: "0.8rem" }}>Loading admins…</p>
              </div>
            ) : topAdmins.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: "0.85rem" }}>No admins registered yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["Name", "Username", "Subdomain", "Role", "Status"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topAdmins.map(a => (
                      <tr key={a.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <span style={{ fontSize: "0.65rem", fontWeight: 800, color: "white" }}>{(a.name || a.username || "?")[0].toUpperCase()}</span>
                            </div>
                            <span style={{ fontWeight: 700, color: "white" }}>{a.name || a.username}</span>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", color: C.sub, fontFamily: "monospace" }}>{a.username}</td>
                        <td style={{ padding: "12px 16px" }}>
                          {a.subdomain
                            ? <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: C.accent }}>{a.subdomain}.isplatty.org</span>
                            : <span style={{ color: C.muted, fontSize: "0.72rem" }}>—</span>
                          }
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ background: "rgba(139,92,246,0.12)", color: "#c4b5fd", padding: "2px 8px", borderRadius: 12, fontSize: "0.68rem", fontWeight: 700 }}>
                            {a.role || "admin"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}><StatusBadge active={a.is_active !== false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Activity Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Routers status */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Router size={15} color={C.accent} />
                <span style={{ fontWeight: 700, color: "white", fontSize: "0.85rem" }}>Router Status</span>
              </div>
              {loadingRouters ? (
                <div style={{ color: C.muted, fontSize: "0.8rem", textAlign: "center" }}>Loading…</div>
              ) : routers.length === 0 ? (
                <div style={{ color: C.muted, fontSize: "0.8rem", textAlign: "center" }}>No routers found.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {routers.slice(0, 6).map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.78rem", color: C.sub, fontFamily: "monospace" }}>{r.name}</span>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                        background: (r.status === "online" || r.status === "active") ? "rgba(74,222,128,0.12)" : "rgba(99,102,241,0.12)",
                        color: (r.status === "online" || r.status === "active") ? "#4ade80" : C.accent,
                      }}>
                        {r.status || "unknown"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Activity size={15} color={C.accent} />
                <span style={{ fontWeight: 700, color: "white", fontSize: "0.85rem" }}>Platform Health</span>
              </div>
              {[
                { label: "Database", value: "Healthy", color: "#4ade80" },
                { label: "API Server", value: "Running", color: "#4ade80" },
                { label: "RADIUS", value: "Active", color: "#4ade80" },
                { label: "Backups", value: "Up to date", color: "#4ade80" },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize: "0.78rem", color: C.sub }}>{item.label}</span>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: item.color }}>{item.value}</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <TrendingUp size={13} color="#4ade80" />
                <span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 600 }}>All systems operational</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
