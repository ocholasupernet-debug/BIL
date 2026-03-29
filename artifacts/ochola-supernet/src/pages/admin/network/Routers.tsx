import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import { RouterLiveStats } from "@/components/router/RouterLiveStats";
import {
  Loader2, RefreshCw, Wifi, WifiOff, ArrowRight,
  Cpu, Clock,
  ChevronDown, ChevronRight, Zap, PlugZap, Trash2, Shield,
} from "lucide-react";
import { useLocation } from "wouter";

/* ── Probe result shape ── */
interface ProbeData {
  version: string;
  model: string;
  boardName: string;
  serial: string;
  firmware: string;
  uptime: string;
  cpuLoad: number;
  freeMem: number;
  totalMem: number;
  cpuCount: number;
  platform: string;
  arch: string;
  identity: string;
  ipAddresses: Array<{ address: string; interface: string }>;
  interfaces: Array<{ name: string; type: string; running: boolean }>;
}
interface ProbeState {
  loading: boolean;
  ok: boolean | null;
  data: ProbeData | null;
  error?: string;
  logs: string[];
  connectedVia?: string;
}

/* ── Helpers ── */
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

function fmtMB(bytes: number) {
  if (!bytes) return "—";
  return bytes >= 1_073_741_824
    ? `${(bytes / 1_073_741_824).toFixed(1)} GB`
    : `${(bytes / 1_048_576).toFixed(0)} MB`;
}

function MemBar({ free, total }: { free: number; total: number }) {
  if (!total) return <span style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>—</span>;
  const used = total - free;
  const pct  = Math.round((used / total) * 100);
  const col  = pct > 85 ? "#f87171" : pct > 60 ? "#f59e0b" : "#4ade80";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--isp-text-muted)", marginBottom: "0.2rem" }}>
        <span>{fmtMB(used)} used</span><span>{pct}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <div style={{ fontSize: "0.65rem", color: "var(--isp-text-muted)", marginTop: "0.15rem" }}>{fmtMB(total)} total</div>
    </div>
  );
}

function CpuBar({ pct }: { pct: number }) {
  const col = pct > 85 ? "#f87171" : pct > 50 ? "#f59e0b" : "#4ade80";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--isp-text-muted)", marginBottom: "0.2rem" }}>
        <span>CPU load</span><span style={{ color: col, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

/* ── Probe detail panel ── */
function ProbePanel({ d, logs, onClose }: { d: ProbeData; logs: string[]; onClose: () => void }) {
  const [showLog, setShowLog] = useState(false);
  const kv = (label: string, val: string | number | undefined, mono = false) => (
    <div>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>{label}</div>
      <div style={{ fontSize: "0.8rem", fontFamily: mono ? "monospace" : "inherit", color: "var(--isp-text)" }}>{val || "—"}</div>
    </div>
  );

  return (
    <tr>
      <td colSpan={7} style={{ padding: 0 }}>
        <div style={{ background: "rgba(6,182,212,0.04)", borderTop: "1px solid rgba(6,182,212,0.15)", borderBottom: "1px solid rgba(6,182,212,0.15)", padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <PlugZap size={14} style={{ color: "#06b6d4" }} />
              <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "#06b6d4" }}>Live Router Info — {d.identity || d.model}</span>
            </div>
            <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem" }}>✕ close</button>
          </div>

          {/* Grid of details */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "1rem 1.5rem", marginBottom: "1rem" }}>
            {kv("Model / Board",    d.model || d.boardName)}
            {kv("RouterOS Version", d.version, true)}
            {kv("Serial Number",    d.serial, true)}
            {kv("Firmware",         d.firmware, true)}
            {kv("Platform",         `${d.platform}${d.arch ? ` / ${d.arch}` : ""}`)}
            {kv("CPU Cores",        String(d.cpuCount || 1))}
            {kv("Identity",         d.identity, true)}
            {kv("Uptime",           d.uptime, true)}
          </div>

          {/* CPU + Memory bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem", maxWidth: 480 }}>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.75rem" }}>
              <CpuBar pct={d.cpuLoad} />
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.75rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>Memory</div>
              <MemBar free={d.freeMem} total={d.totalMem} />
            </div>
          </div>

          {/* IPs */}
          {d.ipAddresses.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>IP Addresses</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {d.ipAddresses.map((a, i) => (
                  <span key={i} style={{ fontFamily: "monospace", fontSize: "0.72rem", padding: "0.2rem 0.6rem", borderRadius: 5, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "#06b6d4" }}>
                    {a.address} <span style={{ color: "var(--isp-text-muted)" }}>({a.interface})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interfaces */}
          {d.interfaces.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>Interfaces</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {d.interfaces.map((ifc, i) => (
                  <span key={i} style={{ fontFamily: "monospace", fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 5, background: ifc.running ? "rgba(34,197,94,0.07)" : "rgba(255,255,255,0.04)", border: `1px solid ${ifc.running ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.1)"}`, color: ifc.running ? "#4ade80" : "var(--isp-text-muted)" }}>
                    {ifc.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Log toggle */}
          <button onClick={() => setShowLog(v => !v)} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0", fontFamily: "inherit" }}>
            {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showLog ? "Hide" : "Show"} probe log ({logs.length} lines)
          </button>
          {showLog && (
            <div style={{ marginTop: "0.5rem", background: "#080c10", borderRadius: 8, padding: "0.75rem", fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 1.8, maxHeight: 220, overflow: "auto" }}>
              {logs.map((l, i) => {
                const col = l.startsWith("✅") ? "#4ade80" : l.startsWith("❌") ? "#f87171" : l.startsWith("✓") ? "#a3e635" : "#64748b";
                return <div key={i} style={{ color: col }}>{l || " "}</div>;
              })}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main page
══════════════════════════════════════════════════════════════ */
export default function Routers() {
  const [, navigate]   = useLocation();
  const qc             = useQueryClient();

  /* Per-router probe state */
  const [probeStates, setProbeStates] = useState<Record<number, ProbeState>>({});
  /* Which router's panel is expanded */
  const [expanded, setExpanded] = useState<number | null>(null);
  /* Delete confirmation state: "idle" | "confirm" | "deleting" */
  const [deleteState, setDeleteState] = useState<Record<number, "idle" | "confirm" | "deleting">>({});

  const { data: routers = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["isp_routers"],
    queryFn: fetchRouters,
    refetchInterval: 30_000,
  });

  /* Staleness threshold: router is only considered "online" if its last heartbeat
     was received within the last 10 minutes AND the service is confirmed running. */
  const STALE_MS  = 10 * 60 * 1000;
  const isRouterOnline = (r: DbRouter) => {
    const ms = r.last_seen ? Date.now() - new Date(r.last_seen).getTime() : Infinity;
    return ms < STALE_MS && r.status === "online";
  };
  const isRouterConnected = (r: DbRouter) => {
    const ms = r.last_seen ? Date.now() - new Date(r.last_seen).getTime() : Infinity;
    return ms < STALE_MS && r.status === "connected";
  };
  const online    = routers.filter(isRouterOnline).length;
  const connected = routers.filter(isRouterConnected).length;
  const offline   = routers.length - online - connected;

  /* ── Probe a single router (tries direct first, VPN bridge IP as fallback) ── */
  const probeRouter = async (r: DbRouter) => {
    setProbeStates(prev => ({ ...prev, [r.id]: { loading: true, ok: null, data: null, logs: [] } }));
    setExpanded(r.id);

    try {
      const res = await fetch("/api/admin/router/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     r.host,
          username: r.router_username || "admin",
          password: (r as unknown as Record<string, string>).router_secret || "",
          routerId: r.id,
          bridgeIp: (r as unknown as Record<string, string>).bridge_ip || undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; data?: ProbeData; logs: string[]; error?: string; connectedVia?: string };

      if (json.ok && json.data) {
        const patch: Record<string, string | number> = {
          status:      "online",
          last_seen:   new Date().toISOString(),
          ros_version: json.data.version,
        };
        if (json.data.model)   patch.model  = json.data.model;
        if (json.data.serial)  patch.serial = json.data.serial;
        await supabase.from("isp_routers").update(patch).eq("id", r.id);
        qc.invalidateQueries({ queryKey: ["isp_routers"] });

        setProbeStates(prev => ({ ...prev, [r.id]: { loading: false, ok: true, data: json.data!, logs: json.logs, connectedVia: json.connectedVia } }));
      } else {
        setProbeStates(prev => ({ ...prev, [r.id]: { loading: false, ok: false, data: null, logs: json.logs, error: json.error } }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProbeStates(prev => ({ ...prev, [r.id]: { loading: false, ok: false, data: null, logs: [`❌ ${msg}`], error: msg } }));
    }
  };

  /* ── Delete a router ── */
  const deleteRouter = async (r: DbRouter) => {
    setDeleteState(prev => ({ ...prev, [r.id]: "deleting" }));
    try {
      await supabase.from("isp_routers").delete().eq("id", r.id);
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
    } catch {
      setDeleteState(prev => ({ ...prev, [r.id]: "idle" }));
    }
  };

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Routers</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
              {isLoading ? "Loading…" : `${routers.length} router${routers.length !== 1 ? "s" : ""} · ${online} online · ${connected} connected · ${offline} offline`}
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
          </div>
        </div>

        <NetworkTabs active="routers" />

        {/* Summary badges */}
        {!isLoading && routers.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.72rem", padding: "0.25rem 0.75rem", borderRadius: 20, background: "rgba(34,197,94,0.12)", color: "#22c55e", fontWeight: 700, border: "1px solid rgba(34,197,94,0.2)" }}>
              {online} Online
            </span>
            {connected > 0 && (
              <span style={{ fontSize: "0.72rem", padding: "0.25rem 0.75rem", borderRadius: 20, background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontWeight: 700, border: "1px solid rgba(251,191,36,0.2)" }}>
                {connected} Connected
              </span>
            )}
            <span style={{ fontSize: "0.72rem", padding: "0.25rem 0.75rem", borderRadius: 20, background: "rgba(248,113,113,0.12)", color: "#f87171", fontWeight: 700, border: "1px solid rgba(248,113,113,0.2)" }}>
              {offline} Offline
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              · green = service active · yellow = router up, service unconfirmed
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
                    {["", "Name", "Host / IP", "Model", "ROS Version", "Status", "Last Seen", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "0.75rem 1rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {routers.map(r => {
                    /* Green only if heartbeat was received within the last 10 min
                       AND the router reported its hotspot/PPPoE service as running.
                       This ensures the light reflects real connectivity, not stale DB data. */
                    const STALE_MS   = 10 * 60 * 1000;
                    const lastSeenMs = r.last_seen ? Date.now() - new Date(r.last_seen).getTime() : Infinity;
                    const isFresh    = lastSeenMs < STALE_MS;
                    /* "online"    = heartbeat + hotspot confirmed running  → green
                       "connected" = heartbeat only (hotspot unconfirmed)   → yellow
                       anything else / stale                                → red   */
                    const isOnline    = isFresh && r.status === "online";
                    const isConnected = isFresh && r.status === "connected";
                    const ps          = probeStates[r.id];
                    const isProbing = ps?.loading;
                    const isOpen   = expanded === r.id;

                    return (
                      <React.Fragment key={r.id}>
                        <tr style={{ borderBottom: isOpen ? "none" : "1px solid var(--isp-border-subtle)", background: isOpen ? "rgba(6,182,212,0.03)" : "transparent" }}>

                          {/* Expand toggle */}
                          <td style={{ padding: "0.75rem 0.5rem 0.75rem 1rem", width: 28 }}>
                            {isOpen
                              ? <ChevronDown size={14} style={{ color: "#06b6d4", cursor: "pointer" }} onClick={() => setExpanded(null)} />
                              : <ChevronRight size={14} style={{ color: "var(--isp-text-muted)", cursor: "pointer" }} onClick={() => setExpanded(r.id)} />}
                          </td>

                          {/* Name */}
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              {isOnline
                                ? <Wifi size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                                : isConnected
                                ? <Wifi size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />
                                : <WifiOff size={13} style={{ color: "#f87171", flexShrink: 0 }} />}
                              <span style={{ color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</span>
                            </div>
                            {ps?.data?.identity && ps.data.identity !== r.name && (
                              <div style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>id: {ps.data.identity}</div>
                            )}
                          </td>

                          {/* Host */}
                          <td style={{ padding: "0.75rem 1rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {r.host}
                            {ps?.data?.ipAddresses?.[0] && (
                              <div style={{ fontSize: "0.67rem", color: "#06b6d4", marginTop: "0.1rem" }}>{ps.data.ipAddresses[0].address}</div>
                            )}
                          </td>

                          {/* Model */}
                          <td style={{ padding: "0.75rem 1rem", color: "var(--isp-text-muted)" }}>
                            {ps?.data?.model || r.model || "—"}
                            {ps?.data?.boardName && ps.data.boardName !== ps?.data?.model && (
                              <div style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>{ps.data.boardName}</div>
                            )}
                          </td>

                          {/* ROS Version */}
                          <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {ps?.data?.version
                              ? <span style={{ color: "#4ade80" }}>v{ps.data.version}</span>
                              : <span style={{ color: "var(--isp-text-muted)" }}>{r.ros_version ? `v${r.ros_version}` : "—"}</span>}
                          </td>

                          {/* Status */}
                          <td style={{ padding: "0.75rem 1rem" }}>
                            {isProbing
                              ? <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "#22d3ee" }}>
                                  <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Probing…
                                </span>
                              : ps?.ok === true
                              ? <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: "rgba(74,222,128,0.1)", color: "#4ade80", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                  <Zap size={10} /> Connected
                                </span>
                              : ps?.ok === false
                              ? <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: "rgba(248,113,113,0.1)", color: "#f87171" }}>
                                  Unreachable
                                </span>
                              : isOnline
                              ? <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: "rgba(34,197,94,0.1)", color: "#22c55e", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                  <Zap size={10} /> Online
                                </span>
                              : isConnected
                              ? <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: "rgba(251,191,36,0.12)", color: "#fbbf24", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                  <Wifi size={10} /> Connected
                                </span>
                              : <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: "rgba(248,113,113,0.1)", color: "#f87171" }}>
                                  Offline
                                </span>}
                          </td>

                          {/* Last seen */}
                          <td style={{ padding: "0.75rem 1rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>
                            {timeSince(r.last_seen)}
                          </td>

                          {/* Actions */}
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              {/* Probe / Connect */}
                              <button
                                onClick={() => probeRouter(r)}
                                disabled={isProbing}
                                style={{
                                  display: "flex", alignItems: "center", gap: "0.3rem",
                                  fontSize: "0.72rem", fontWeight: 700, fontFamily: "inherit",
                                  padding: "0.25rem 0.7rem", borderRadius: 6, cursor: isProbing ? "wait" : "pointer",
                                  background: ps?.ok === true ? "rgba(74,222,128,0.1)" : "rgba(6,182,212,0.1)",
                                  border: `1px solid ${ps?.ok === true ? "rgba(74,222,128,0.25)" : "rgba(6,182,212,0.25)"}`,
                                  color: ps?.ok === true ? "#4ade80" : "#06b6d4",
                                }}
                              >
                                {isProbing
                                  ? <><Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Probing</>
                                  : ps?.ok === true
                                  ? <><PlugZap size={11} /> Re-probe</>
                                  : <><PlugZap size={11} /> Probe</>}
                              </button>

                              {/* Replace */}
                              <button
                                onClick={() => navigate(`/admin/network/replace-router?router=${r.id}`)}
                                title="Replace this router with a new one"
                                style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "#94a3b8", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.2rem 0.6rem", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                                <ArrowRight size={11} /> Replace
                              </button>

                              {/* Delete */}
                              {deleteState[r.id] === "confirm"
                                ? <>
                                    <button
                                      onClick={() => deleteRouter(r)}
                                      style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.72rem", fontWeight: 700, fontFamily: "inherit", padding: "0.2rem 0.6rem", borderRadius: 6, cursor: "pointer", background: "rgba(248,113,113,0.18)", border: "1px solid rgba(248,113,113,0.5)", color: "#f87171" }}>
                                      <Trash2 size={10} /> Yes, delete
                                    </button>
                                    <button
                                      onClick={() => setDeleteState(prev => ({ ...prev, [r.id]: "idle" }))}
                                      style={{ fontSize: "0.72rem", fontWeight: 600, fontFamily: "inherit", padding: "0.2rem 0.5rem", borderRadius: 6, cursor: "pointer", background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)" }}>
                                      Cancel
                                    </button>
                                  </>
                                : deleteState[r.id] === "deleting"
                                ? <span style={{ fontSize: "0.72rem", color: "#f87171", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                    <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Deleting…
                                  </span>
                                : <button
                                    onClick={() => setDeleteState(prev => ({ ...prev, [r.id]: "confirm" }))}
                                    title="Delete this router"
                                    style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.72rem", fontWeight: 700, fontFamily: "inherit", padding: "0.2rem 0.55rem", borderRadius: 6, cursor: "pointer", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
                                    <Trash2 size={10} />
                                  </button>}
                            </div>

                            {/* VPN badge — shown when probe connected via VPN */}
                            {ps?.ok === true && ps.connectedVia?.includes("VPN") && (
                              <div style={{ marginTop: "0.35rem", display: "inline-flex", alignItems: "center", gap: "0.2rem", fontSize: "0.63rem", color: "#a78bfa", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 4, padding: "0.1rem 0.4rem" }}>
                                <Shield size={9} /> via VPN tunnel
                              </div>
                            )}

                            {/* Probe error */}
                            {ps?.ok === false && ps.error && (
                              <div style={{ marginTop: "0.4rem", fontSize: "0.65rem", color: "#f87171", maxWidth: 240, lineHeight: 1.4 }}>{ps.error}</div>
                            )}

                            {/* Quick stats after probe */}
                            {ps?.ok === true && ps.data && (
                              <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                <span title="Uptime" style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.63rem", color: "var(--isp-text-muted)" }}>
                                  <Clock size={9} /> {ps.data.uptime}
                                </span>
                                <span title="CPU" style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.63rem", color: ps.data.cpuLoad > 80 ? "#f87171" : "var(--isp-text-muted)" }}>
                                  <Cpu size={9} /> {ps.data.cpuLoad}%
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>

                        {/* Expanded probe panel */}
                        {isOpen && ps?.ok === true && ps.data && (
                          <ProbePanel d={ps.data} logs={ps.logs} onClose={() => setExpanded(null)} />
                        )}

                        {/* Live stats panel — shown whenever the row is expanded */}
                        {isOpen && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <RouterLiveStats
                                routerHost={r.host || r.ip_address || undefined}
                                routerUsername={r.router_username || "admin"}
                                routerName={r.name}
                                refetchIntervalMs={7000}
                              />
                            </td>
                          </tr>
                        )}

                        {/* Expanded error state */}
                        {isOpen && ps?.ok === false && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div style={{ background: "rgba(248,113,113,0.04)", borderTop: "1px solid rgba(248,113,113,0.15)", padding: "0.875rem 1.25rem", fontSize: "0.8rem", color: "#f87171" }}>
                                <strong>Could not reach router:</strong> {ps.error}
                                <div style={{ marginTop: "0.5rem" }}>
                                  <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.35rem" }}>Checklist</div>
                                  {["RouterOS API service enabled: IP → Services → api (port 8728)", "Firewall not blocking port 8728 from this server", "Correct IP / hostname and credentials in router record", "Router is powered on and reachable"].map((item, i) => (
                                    <div key={i} style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginBottom: "0.2rem" }}>· {item}</div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Expanded + loading */}
                        {isOpen && isProbing && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div style={{ background: "rgba(6,182,212,0.03)", borderTop: "1px solid rgba(6,182,212,0.12)", padding: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", color: "#22d3ee", fontSize: "0.8rem" }}>
                                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                                Connecting to {r.host}:8728 and reading system info…
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {routers.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: "3rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
                        No routers connected yet.{" "}
                        <a href="/admin/network/self-install" style={{ color: "#06b6d4", textDecoration: "underline", fontWeight: 600 }}>
                          Go to Self Install
                        </a>{" "}
                        to link your first router.
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
