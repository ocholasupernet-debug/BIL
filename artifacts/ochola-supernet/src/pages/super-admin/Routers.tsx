import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import { Router, Search, Loader2, CheckCircle2, XCircle, Globe, Users } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

interface DbRouter { id: number; name: string; host: string; status: string | null; admin_id: number; model: string | null; ros_version: string | null; created_at: string; }
interface DbAdmin { id: number; name: string; username: string; subdomain: string | null; }

function StatusDot({ status }: { status: string | null }) {
  const online = status === "online" || status === "active";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700,
      background: online ? "rgba(74,222,128,0.12)" : "rgba(100,116,139,0.15)",
      color: online ? "#4ade80" : "#94a3b8",
      border: `1px solid ${online ? "rgba(74,222,128,0.25)" : "rgba(100,116,139,0.2)"}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "#4ade80" : "#64748b" }} />
      {status || "unknown"}
    </span>
  );
}

export default function SuperAdminRouters() {
  const [search, setSearch] = useState("");

  const { data: routers = [], isLoading: loadingRouters } = useQuery<DbRouter[]>({
    queryKey: ["sa_all_routers_detail"],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_routers").select("id,name,host,status,admin_id,model,ros_version,created_at").order("admin_id").order("id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: admins = [] } = useQuery<DbAdmin[]>({
    queryKey: ["sa_admins_mini"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("id,name,username,subdomain");
      return data ?? [];
    },
  });

  const adminMap: Record<number, DbAdmin> = {};
  admins.forEach(a => { adminMap[a.id] = a; });

  const filtered = routers.filter(r =>
    [r.name, r.host, r.model, adminMap[r.admin_id]?.name].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  const onlineCount = routers.filter(r => r.status === "online" || r.status === "active").length;

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1100 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>All Routers</h1>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>All MikroTik routers registered across all ISP accounts.</p>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Total Routers", value: routers.length, color: "#6366f1" },
            { label: "Online", value: onlineCount, color: "#4ade80" },
            { label: "Offline", value: routers.length - onlineCount, color: "#f87171" },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
              <p style={{ fontSize: "0.68rem", color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{s.label}</p>
              <p style={{ fontSize: "1.6rem", fontWeight: 800, color: s.color, margin: "4px 0 0" }}>{loadingRouters ? "…" : s.value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 20, maxWidth: 340 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, host, ISP…"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px 9px 36px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" }} />
        </div>

        {/* Table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {loadingRouters ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
              <p>Loading routers…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Router size={32} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              <p style={{ margin: 0 }}>No routers found.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Router Name", "Host / IP", "Model", "ROS", "ISP Admin", "Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const admin = adminMap[r.admin_id];
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "13px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Router size={14} color="#6366f1" />
                            </div>
                            <span style={{ fontWeight: 700, color: "white" }}>{r.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.75rem", color: C.sub }}>{r.host}</td>
                        <td style={{ padding: "13px 16px", color: C.sub }}>{r.model || "—"}</td>
                        <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: "0.72rem", color: C.sub }}>{r.ros_version || "—"}</td>
                        <td style={{ padding: "13px 16px" }}>
                          {admin ? (
                            <div>
                              <span style={{ fontWeight: 600, color: C.text }}>{admin.name || admin.username}</span>
                              {admin.subdomain && <div style={{ fontSize: "0.68rem", color: C.accent, fontFamily: "monospace" }}>{admin.subdomain}.isplatty.org</div>}
                            </div>
                          ) : <span style={{ color: C.muted }}>Admin #{r.admin_id}</span>}
                        </td>
                        <td style={{ padding: "13px 16px" }}><StatusDot status={r.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
