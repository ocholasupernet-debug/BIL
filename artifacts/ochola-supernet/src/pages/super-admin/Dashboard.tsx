import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import {
  Users, Router, BarChart3, Activity, CheckCircle2, XCircle,
  TrendingUp, Globe, Loader2,
} from "lucide-react";

/* ── Theme tokens for page content ──────────────────────────── */
const DARK_C = {
  card:   "rgba(255,255,255,0.04)",
  border: "var(--isp-accent-glow)",
  text:   "white",
  muted:  "#64748b",
  sub:    "#94a3b8",
  accent: "var(--isp-accent)",
  rowHover: "rgba(255,255,255,0.02)",
  rowBorder: "rgba(255,255,255,0.04)",
};
const LIGHT_C = {
  card:   "#ffffff",
  border: "var(--isp-accent-glow)",
  text:   "#0f172a",
  muted:  "#64748b",
  sub:    "#475569",
  accent: "var(--isp-accent)",
  rowHover: "rgba(0,0,0,0.02)",
  rowBorder: "rgba(0,0,0,0.05)",
};

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon: Icon, loading, C }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ElementType; loading?: boolean;
  C: typeof DARK_C;
}) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 16, padding: "20px 24px",
      boxShadow: C.card === "#ffffff" ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{label}</p>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, color: C.text, margin: "6px 0 0", lineHeight: 1 }}>
            {loading ? <Loader2 size={22} className="animate-spin" style={{ color }} /> : value}
          </p>
          {sub && <p style={{ fontSize: "0.7rem", color: C.sub, margin: "4px 0 0" }}>{sub}</p>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

/* ── Status Badge ────────────────────────────────────────────── */
function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.68rem] font-bold bg-green-400/10 text-green-500 border border-green-400/25">
      <CheckCircle2 size={10} /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.68rem] font-bold bg-red-400/10 text-red-500 border border-red-400/25">
      <XCircle size={10} /> Inactive
    </span>
  );
}

/* ── Main Page ───────────────────────────────────────────────── */
export default function SuperAdminDashboard() {
  const { isDark } = useTheme();
  const C = isDark ? DARK_C : LIGHT_C;

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

  const topAdmins       = admins.slice(0, 8);
  const onlineRouters   = routers.filter(r => r.status === "online" || r.status === "active").length;
  const activeAdmins    = admins.filter(a => a.is_active).length;
  const activeCustomers = customers.filter(c => c.is_active !== false).length;

  const healthItems = [
    { label: "Database",   value: "Healthy"    },
    { label: "API Server", value: "Running"    },
    { label: "RADIUS",     value: "Active"     },
    { label: "Backups",    value: "Up to date" },
  ];

  const cardStyle = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    boxShadow: !isDark ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1200 }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: C.text, margin: 0 }}>Platform Overview</h1>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.85rem" }}>
            Real-time view of all ISPs, routers, and customers on the platform.
          </p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16, marginBottom: 28 }}>
          <StatCard C={C} label="Total ISP Admins" value={admins.length}    sub={`${activeAdmins} active`}    color="var(--isp-accent)" icon={Users}    loading={loadingAdmins}    />
          <StatCard C={C} label="Total Routers"    value={routers.length}   sub={`${onlineRouters} online`}   color="#8b5cf6" icon={Router}   loading={loadingRouters}   />
          <StatCard C={C} label="Total Customers"  value={customers.length} sub={`${activeCustomers} active`} color="var(--isp-accent)" icon={Globe}    loading={loadingCustomers} />
          <StatCard C={C} label="Total Plans"      value={plans.length}     sub="across all ISPs"             color="#f59e0b" icon={BarChart3} loading={loadingPlans}     />
        </div>

        {/* ── Two-column body ── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>

          {/* ── Admins Table ── */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={16} color={C.accent} />
              <span style={{ fontWeight: 700, color: C.text, fontSize: "0.9rem" }}>Registered ISP Admins</span>
              <span style={{ marginLeft: "auto", background: "var(--isp-accent-glow)", color: C.accent, fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 12 }}>
                {admins.length}
              </span>
            </div>

            {loadingAdmins ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                <Loader2 size={24} className="animate-spin mx-auto mb-2" />
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
                      <tr key={a.id} style={{ borderBottom: `1px solid ${C.rowBorder}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.rowHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,var(--isp-accent),#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <span style={{ fontSize: "0.65rem", fontWeight: 800, color: "white" }}>{(a.name || a.username || "?")[0].toUpperCase()}</span>
                            </div>
                            <span style={{ fontWeight: 700, color: C.text }}>{a.name || a.username}</span>
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
                          <span style={{ background: "rgba(139,92,246,0.12)", color: "#8b5cf6", padding: "2px 8px", borderRadius: 12, fontSize: "0.68rem", fontWeight: 700 }}>
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

          {/* ── Right Column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Router Status */}
            <div style={{ ...cardStyle, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Router size={15} color={C.accent} />
                <span style={{ fontWeight: 700, color: C.text, fontSize: "0.85rem" }}>Router Status</span>
              </div>
              {loadingRouters ? (
                <p style={{ color: C.muted, fontSize: "0.8rem", textAlign: "center" }}>Loading…</p>
              ) : routers.length === 0 ? (
                <p style={{ color: C.muted, fontSize: "0.8rem", textAlign: "center" }}>No routers found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {routers.slice(0, 6).map(r => {
                    const isOnline = r.status === "online" || r.status === "active";
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "0.78rem", color: C.sub, fontFamily: "monospace" }}>{r.name}</span>
                        <span style={{
                          fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                          background: isOnline ? "rgba(74,222,128,0.12)" : "var(--isp-accent-glow)",
                          color: isOnline ? "#16a34a" : C.accent,
                        }}>
                          {r.status || "unknown"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Platform Health */}
            <div style={{ ...cardStyle, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Activity size={15} color={C.accent} />
                <span style={{ fontWeight: 700, color: C.text, fontSize: "0.85rem" }}>Platform Health</span>
              </div>
              <div>
                {healthItems.map((item, i) => (
                  <div key={item.label} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    paddingBottom: 10, marginBottom: i < healthItems.length - 1 ? 10 : 0,
                    borderBottom: i < healthItems.length - 1 ? `1px solid ${C.rowBorder}` : "none",
                  }}>
                    <span style={{ fontSize: "0.78rem", color: C.sub }}>{item.label}</span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16a34a" }}>{item.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
                <TrendingUp size={13} color="#16a34a" />
                <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600 }}>All systems operational</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </SuperAdminLayout>
  );
}
