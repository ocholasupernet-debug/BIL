import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Server, RotateCcw, Network, Loader2, WifiOff,
  CheckCircle2, AlertCircle,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────── */
interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string;
  model: string | null;
  ros_version: string | null;
  last_seen: string | null;
  bridge_interface: string | null;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const STALE_MS = 12 * 60 * 1000;
function isFresh(r: DbRouter): boolean {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}
function isOnline(r: DbRouter): boolean {
  return isFresh(r) && (r.status === "online" || r.status === "connected");
}

/* ─── Row ────────────────────────────────────────────────────── */
function RouterRow({ router, index, onReconfigure, onPorts }: {
  router: DbRouter;
  index: number;
  onReconfigure: (id: number) => void;
  onPorts: (id: number) => void;
}) {
  const online = isOnline(router);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "2fr 2fr 1fr auto auto",
      gap: "0.75rem",
      alignItems: "center",
      padding: "0.875rem 1.125rem",
      background: "var(--isp-card)",
      border: `1px solid ${online ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 10,
      transition: "border-color 0.2s",
    }}>

      {/* Name + model */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: online ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${online ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Server size={15} style={{ color: online ? "#22c55e" : "#64748b" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--isp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {index + 1}. {router.name}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>
            {router.model || "MikroTik"}
            {router.ros_version ? ` · ROS v${router.ros_version}` : ""}
          </div>
        </div>
      </div>

      {/* IP / Host */}
      <div style={{ minWidth: 0 }}>
        <code style={{
          fontFamily: "monospace", fontSize: "0.78rem",
          color: router.host ? "var(--isp-text)" : "var(--isp-text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
        }}>
          {router.host || "—"}
        </code>
        {router.bridge_interface && (
          <div style={{ fontSize: "0.67rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>
            bridge: {router.bridge_interface}
          </div>
        )}
      </div>

      {/* Status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        {online
          ? <><CheckCircle2 size={13} style={{ color: "#22c55e" }} /><span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#22c55e" }}>Online</span></>
          : <><AlertCircle  size={13} style={{ color: "#64748b" }} /><span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#64748b" }}>Offline</span></>}
      </div>

      {/* Reconfigure */}
      <button
        onClick={() => onReconfigure(router.id)}
        title="Re-run setup script on this router"
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.375rem",
          padding: "0.45rem 0.875rem", borderRadius: 7,
          background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
          color: "#fbbf24", fontWeight: 700, fontSize: "0.78rem",
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
        onMouseOver={e => (e.currentTarget.style.background = "rgba(251,191,36,0.18)")}
        onMouseOut={e  => (e.currentTarget.style.background = "rgba(251,191,36,0.1)")}
      >
        <RotateCcw size={13} /> Reconfigure
      </button>

      {/* Ports */}
      <button
        onClick={() => onPorts(router.id)}
        title="View and assign bridge ports for this router"
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.375rem",
          padding: "0.45rem 0.875rem", borderRadius: 7,
          background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)",
          color: "#06b6d4", fontWeight: 700, fontSize: "0.78rem",
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
        onMouseOver={e => (e.currentTarget.style.background = "rgba(6,182,212,0.18)")}
        onMouseOut={e  => (e.currentTarget.style.background = "rgba(6,182,212,0.1)")}
      >
        <Network size={13} /> Ports
      </button>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function ReplaceRouter() {
  const [, navigate] = useLocation();

  const { data: routers = [], isLoading } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_rr2", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,model,ros_version,last_seen,bridge_interface")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as DbRouter[];
    },
    refetchInterval: 10_000,
  });

  const onlineCount = routers.filter(isOnline).length;

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 900 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.2rem" }}>
              Routers
            </h1>
            <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>
              {routers.length} router{routers.length !== 1 ? "s" : ""} · {onlineCount} online
            </p>
          </div>
        </div>

        <NetworkTabs active="replace-router" />

        {/* Column headers */}
        {routers.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr auto auto",
            gap: "0.75rem",
            padding: "0 1.125rem",
          }}>
            {["Router Name", "IP / Host", "Status", "Reconfigure", "Ports"].map(h => (
              <div key={h} style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {h}
              </div>
            ))}
          </div>
        )}

        {/* Router rows */}
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "2rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
            Loading routers…
          </div>
        ) : routers.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem",
            padding: "3rem 1.5rem", textAlign: "center",
            background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
            borderRadius: 12,
          }}>
            <WifiOff size={28} style={{ color: "#64748b" }} />
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--isp-text)" }}>No routers yet</div>
            <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
              Use <strong>Self Install</strong> to add your first router.
            </div>
            <button
              onClick={() => navigate("/admin/network/self-install")}
              style={{
                marginTop: "0.25rem", padding: "0.5rem 1.25rem", borderRadius: 7,
                background: "linear-gradient(135deg,#06b6d4,#0284c7)",
                border: "none", color: "white", fontWeight: 700, fontSize: "0.82rem",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Go to Self Install
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {routers.map((r, i) => (
              <RouterRow
                key={r.id}
                router={r}
                index={i}
                onReconfigure={id => navigate(`/admin/network/self-install?reconfigure=${id}`)}
                onPorts={id => navigate(`/admin/network/bridge-ports?routerId=${id}`)}
              />
            ))}
          </div>
        )}

        {/* Help note */}
        <div style={{
          background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)",
          borderRadius: 8, padding: "0.75rem 1rem",
          fontSize: "0.77rem", color: "var(--isp-text-muted)", lineHeight: 1.65,
        }}>
          <strong style={{ color: "#06b6d4" }}>Reconfigure</strong> re-runs the setup script on the existing router (updates hotspot, VPN, portal settings without creating a new record).{" "}
          <strong style={{ color: "#06b6d4" }}>Ports</strong> opens the bridge port assignment for that router.
        </div>

      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </AdminLayout>
  );
}
