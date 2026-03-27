import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import { Plus, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";

async function fetchRouters(): Promise<DbRouter[]> {
  const { data, error } = await supabase
    .from("isp_routers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function timeSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Routers() {
  const { data: routers = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["isp_routers"],
    queryFn: fetchRouters,
    refetchInterval: 30_000,
  });

  const online  = routers.filter(r => r.status === "online").length;
  const offline = routers.filter(r => r.status !== "online").length;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Routers</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
              {isLoading ? "Loading…" : `${routers.length} router${routers.length !== 1 ? "s" : ""} registered · ${online} online · ${offline} offline`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.875rem", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <RefreshCw style={{ width: 13, height: 13, animation: isFetching ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "#06b6d4", border: "none", borderRadius: 8, padding: "0.5rem 1rem", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <Plus style={{ width: 15, height: 15 }} /> Add Router
            </button>
          </div>
        </div>

        <NetworkTabs active="routers" />

        {/* Summary badges */}
        {!isLoading && routers.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.72rem", padding: "0.25rem 0.75rem", borderRadius: 20, background: "rgba(34,197,94,0.12)", color: "#22c55e", fontWeight: 700, border: "1px solid rgba(34,197,94,0.2)" }}>
              {online} Online
            </span>
            <span style={{ fontSize: "0.72rem", padding: "0.25rem 0.75rem", borderRadius: 20, background: "rgba(248,113,113,0.12)", color: "#f87171", fontWeight: 700, border: "1px solid rgba(248,113,113,0.2)" }}>
              {offline} Offline
            </span>
          </div>
        )}

        {/* Table */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3rem 2rem", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading routers from database…
            </div>
          ) : error ? (
            <div style={{ padding: "2rem", color: "#f87171", fontSize: "0.875rem" }}>Failed to load routers. Check your connection.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                    {["Name", "Host / IP", "Model", "ROS", "Status", "Last Seen", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {routers.map(r => {
                    const isOnline = r.status === "online";
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {isOnline
                              ? <Wifi size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                              : <WifiOff size={13} style={{ color: "#f87171", flexShrink: 0 }} />}
                            <span style={{ color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                          {r.host}{r.ip_address ? ` / ${r.ip_address}` : ""}
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)" }}>
                          {r.model ?? "MikroTik"}
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                          {r.ros_version ? `v${r.ros_version}` : "—"}
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: isOnline ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)", color: isOnline ? "#22c55e" : "#f87171" }}>
                            {isOnline ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>
                          {timeSince(r.last_seen)}
                        </td>
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <button style={{ fontSize: "0.75rem", color: isOnline ? "#06b6d4" : "var(--isp-text-sub)", background: "none", border: "none", cursor: isOnline ? "pointer" : "not-allowed", fontWeight: 600, fontFamily: "inherit" }}>
                            {isOnline ? "Connect" : "Offline"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {routers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "3rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
                        No routers registered yet. Click <strong>Add Router</strong> to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </AdminLayout>
  );
}
