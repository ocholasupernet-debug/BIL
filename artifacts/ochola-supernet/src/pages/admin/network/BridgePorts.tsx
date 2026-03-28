import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle,
  Plug, Network, Wifi, Check, ChevronDown,
} from "lucide-react";

/* ── types ── */
interface Iface {
  name: string; type: string; running: boolean;
  disabled: boolean; macAddress: string; comment: string;
}
interface Bridge { name: string; running: boolean; }
interface BridgePort { bridge: string; interface: string; id: string; }

interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
}

interface PortsPayload {
  ok: boolean; error?: string;
  interfaces: Iface[];
  bridges: Bridge[];
  bridgePorts: BridgePort[];
}

/* ── icon for interface type ── */
function IfaceIcon({ type, running }: { type: string; running: boolean }) {
  const color = running ? "#22d3ee" : "#475569";
  if (type === "wlan" || type.startsWith("wlan")) return <Wifi size={14} style={{ color }} />;
  if (type === "bridge") return <Network size={14} style={{ color }} />;
  return <Plug size={14} style={{ color }} />;
}

/* ── port row ── */
function PortRow({
  iface, inBridge, selected, onToggle,
}: {
  iface: Iface; inBridge: boolean; selected: boolean; onToggle: () => void;
}) {
  const isBridgeType = iface.type === "bridge" || iface.type === "loopback";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.875rem",
      padding: "0.75rem 1rem",
      borderBottom: "1px solid var(--isp-border-subtle)",
      opacity: isBridgeType ? 0.45 : 1,
    }}>
      {/* checkbox */}
      <button
        onClick={onToggle}
        disabled={isBridgeType}
        style={{
          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
          background: selected ? "#06b6d4" : "rgba(255,255,255,0.06)",
          border: `2px solid ${selected ? "#06b6d4" : "rgba(255,255,255,0.2)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: isBridgeType ? "not-allowed" : "pointer",
          transition: "all 0.15s",
        }}
      >
        {selected && <Check size={11} strokeWidth={3} color="white" />}
      </button>

      {/* icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
        <IfaceIcon type={iface.type} running={iface.running} />
        <span style={{ fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 700, color: "var(--isp-text)" }}>
          {iface.name}
        </span>
        {iface.comment && (
          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>— {iface.comment}</span>
        )}
      </div>

      {/* type badge */}
      <span style={{
        fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.07em", padding: "0.15rem 0.5rem", borderRadius: 4,
        background: "rgba(255,255,255,0.06)", color: "var(--isp-text-muted)",
      }}>
        {iface.type || "ether"}
      </span>

      {/* running dot */}
      <span style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: iface.running ? "#4ade80" : "#475569",
      }} />

      {/* MAC */}
      {iface.macAddress && (
        <span style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "#475569" }}>
          {iface.macAddress}
        </span>
      )}

      {/* currently-in-bridge badge */}
      {inBridge && (
        <span style={{
          fontSize: "0.65rem", fontWeight: 700, padding: "0.2rem 0.5rem",
          borderRadius: 4, background: "rgba(6,182,212,0.15)",
          border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4",
        }}>
          In bridge
        </span>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Main page
════════════════════════════════════════════════════════ */
export default function BridgePorts() {
  const [location] = useLocation();

  /* Parse routerId from query string */
  const params = new URLSearchParams(window.location.search);
  const routerIdParam = params.get("routerId");

  const [selectedId, setSelectedId] = useState<number | null>(
    routerIdParam ? Number(routerIdParam) : null
  );

  /* loaded data */
  const [payload, setPayload]         = useState<PortsPayload | null>(null);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);

  /* bridge + port selection */
  const [selectedBridge, setSelectedBridge] = useState<string>("");
  const [selectedPorts, setSelectedPorts]   = useState<Set<string>>(new Set());

  /* apply result */
  const [applying, setApplying]     = useState(false);
  const [applyLogs, setApplyLogs]   = useState<string[] | null>(null);
  const [applyOk, setApplyOk]       = useState<boolean | null>(null);

  /* load routers from Supabase */
  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,router_username,router_secret")
        .eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouter[];
    },
  });

  /* auto-fetch ports when router selected */
  useEffect(() => {
    if (selectedId) fetchPorts(selectedId);
  }, [selectedId]);

  /* auto-select first bridge */
  useEffect(() => {
    if (payload?.bridges?.length && !selectedBridge) {
      setSelectedBridge(payload.bridges[0].name);
    }
  }, [payload]);

  /* pre-tick ports that are already in the selected bridge */
  useEffect(() => {
    if (!payload || !selectedBridge) return;
    const inBridge = new Set(
      payload.bridgePorts
        .filter(bp => bp.bridge === selectedBridge)
        .map(bp => bp.interface)
    );
    setSelectedPorts(inBridge);
  }, [selectedBridge, payload]);

  const router = routers.find(r => r.id === selectedId) ?? null;

  async function fetchPorts(id: number) {
    const r = routers.find(x => x.id === id);
    if (!r) return;
    setLoading(true);
    setLoadError(null);
    setPayload(null);
    setApplyLogs(null);
    setApplyOk(null);
    try {
      const res = await fetch("/api/admin/router/ports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     r.host,
          username: r.router_username || "admin",
          password: r.router_secret  || "",
        }),
      });
      const data = await res.json() as PortsPayload;
      if (data.ok) setPayload(data);
      else setLoadError(data.error ?? "Failed to load ports");
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function applyChanges() {
    if (!router || !selectedBridge || !payload) return;
    setApplying(true);
    setApplyLogs(null);
    setApplyOk(null);

    /* Determine what to add and remove */
    const wasMember = new Set(
      payload.bridgePorts
        .filter(bp => bp.bridge === selectedBridge)
        .map(bp => bp.interface)
    );
    const addPorts    = [...selectedPorts].filter(p => !wasMember.has(p));
    const removePorts = [...wasMember].filter(p => !selectedPorts.has(p));

    try {
      const res = await fetch("/api/admin/router/bridge-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     router.host,
          username: router.router_username || "admin",
          password: router.router_secret  || "",
          bridge:   selectedBridge,
          addPorts, removePorts,
        }),
      });
      const data = await res.json() as { ok: boolean; logs: string[]; error?: string };
      setApplyLogs(data.logs ?? []);
      setApplyOk(data.ok);
      if (data.ok) fetchPorts(selectedId!);
    } catch (e) {
      setApplyLogs([`❌ ${e}`]);
      setApplyOk(false);
    } finally {
      setApplying(false);
    }
  }

  const togglePort = (name: string) => {
    setSelectedPorts(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /* ports that are NOT the bridge type or loopback — the ones a user can assign */
  const physicalPorts = (payload?.interfaces ?? []).filter(
    i => i.type !== "bridge" && i.type !== "loopback"
  );

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 860 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Assign Bridge Ports
          </h1>
          {router && (
            <span style={{
              background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
              color: "#06b6d4", borderRadius: 6, padding: "0.2rem 0.625rem",
              fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
            }}>
              {router.name} — {router.host}
            </span>
          )}
        </div>

        <NetworkTabs active="self-install" />

        {/* ── Router + Bridge selectors ── */}
        <div style={{
          display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center",
          background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
          borderRadius: 10, padding: "0.875rem 1.125rem",
        }}>
          {/* Router dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Router</span>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                value={selectedId ?? ""}
                onChange={e => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setSelectedId(id);
                  setPayload(null);
                  setSelectedBridge("");
                  setSelectedPorts(new Set());
                }}
                style={{
                  background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                  borderRadius: 7, padding: "0.4rem 2rem 0.4rem 0.75rem",
                  color: "var(--isp-text)", fontSize: "0.8rem", cursor: "pointer",
                  fontFamily: "inherit", outline: "none", appearance: "none",
                }}
              >
                <option value="">— select router —</option>
                {routers.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.host}) {r.status === "online" ? "🟢" : "🔴"}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            </div>
          </div>

          {/* Bridge dropdown — only show when data is loaded */}
          {payload && payload.bridges.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Bridge</span>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <select
                  value={selectedBridge}
                  onChange={e => setSelectedBridge(e.target.value)}
                  style={{
                    background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                    borderRadius: 7, padding: "0.4rem 2rem 0.4rem 0.75rem",
                    color: "#06b6d4", fontSize: "0.8rem", fontWeight: 700,
                    cursor: "pointer", fontFamily: "monospace", outline: "none", appearance: "none",
                  }}
                >
                  {payload.bridges.map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", color: "#06b6d4", pointerEvents: "none" }} />
              </div>
            </div>
          )}

          {/* Refresh button */}
          {selectedId && (
            <button
              onClick={() => fetchPorts(selectedId!)}
              disabled={loading}
              style={{
                marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.375rem",
                padding: "0.4rem 0.875rem", borderRadius: 7,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                color: "var(--isp-text-muted)", fontSize: "0.75rem", fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >
              <RefreshCw size={12} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
              {loading ? "Loading…" : "Refresh"}
            </button>
          )}
        </div>

        {/* ── States ── */}

        {/* Not selected */}
        {!selectedId && (
          <div style={{
            textAlign: "center", padding: "3rem 1rem",
            color: "var(--isp-text-muted)", fontSize: "0.875rem",
          }}>
            Select a router above to load its interfaces.
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem", justifyContent: "center",
            padding: "2.5rem 1rem", color: "#22d3ee", fontSize: "0.875rem",
          }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
            Connecting to router and reading interfaces…
          </div>
        )}

        {/* Error */}
        {loadError && !loading && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: "0.625rem",
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: 10, padding: "0.875rem 1.125rem",
            color: "#f87171", fontSize: "0.82rem",
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{loadError}</span>
          </div>
        )}

        {/* Port list */}
        {payload && !loading && (
          <>
            {/* no bridges */}
            {payload.bridges.length === 0 && (
              <div style={{
                background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 8, padding: "0.75rem 1.125rem", fontSize: "0.8rem", color: "#fbbf24",
              }}>
                No bridge interfaces found on this router. Create a bridge first via
                <code style={{ fontFamily: "monospace", marginLeft: "0.25rem" }}>
                  /interface bridge add name=bridge1
                </code>
              </div>
            )}

            {payload.bridges.length > 0 && (
              <>
                {/* Legend */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  fontSize: "0.72rem", color: "var(--isp-text-muted)",
                }}>
                  <span>
                    {physicalPorts.length} interface{physicalPorts.length !== 1 ? "s" : ""} —
                    {" "}{selectedPorts.size} selected for <strong style={{ color: "#06b6d4" }}>{selectedBridge}</strong>
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => setSelectedPorts(new Set(physicalPorts.map(p => p.name)))}
                      style={{ background: "none", border: "none", color: "#06b6d4", fontSize: "0.72rem", cursor: "pointer", fontWeight: 600 }}
                    >
                      Select all
                    </button>
                    <span style={{ color: "var(--isp-border)" }}>|</span>
                    <button
                      onClick={() => setSelectedPorts(new Set())}
                      style={{ background: "none", border: "none", color: "var(--isp-text-muted)", fontSize: "0.72rem", cursor: "pointer", fontWeight: 600 }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Port rows */}
                <div style={{
                  background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
                  borderRadius: 10, overflow: "hidden",
                }}>
                  {payload.interfaces.map(iface => {
                    const inBridge = payload.bridgePorts.some(
                      bp => bp.bridge === selectedBridge && bp.interface === iface.name
                    );
                    return (
                      <PortRow
                        key={iface.name}
                        iface={iface}
                        inBridge={inBridge}
                        selected={selectedPorts.has(iface.name)}
                        onToggle={() => togglePort(iface.name)}
                      />
                    );
                  })}
                </div>

                {/* Apply button */}
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <button
                    onClick={applyChanges}
                    disabled={applying}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.625rem 1.75rem", borderRadius: 8,
                      background: applying
                        ? "rgba(6,182,212,0.15)"
                        : "linear-gradient(135deg,#06b6d4,#0284c7)",
                      border: "none", color: applying ? "#94a3b8" : "white",
                      fontWeight: 700, fontSize: "0.875rem",
                      cursor: applying ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      boxShadow: applying ? "none" : "0 4px 12px rgba(6,182,212,0.3)",
                    }}
                  >
                    {applying
                      ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Applying…</>
                      : <>Apply to Router</>
                    }
                  </button>
                  <span style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
                    Changes are applied live on the MikroTik router via API
                  </span>
                </div>

                {/* Apply result log */}
                {applyLogs && (
                  <div style={{
                    border: `1px solid ${applyOk ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
                    borderRadius: 10, overflow: "hidden",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.625rem 1rem",
                      background: applyOk ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
                    }}>
                      {applyOk
                        ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                        : <AlertTriangle size={14} style={{ color: "#f87171" }} />
                      }
                      <span style={{ fontWeight: 700, fontSize: "0.8rem", color: applyOk ? "#4ade80" : "#f87171" }}>
                        {applyOk ? "Applied successfully" : "Apply failed"}
                      </span>
                    </div>
                    <div style={{
                      padding: "0.75rem 1rem", background: "#080c10",
                      fontFamily: "monospace", fontSize: "0.73rem", lineHeight: 1.75,
                      maxHeight: 220, overflow: "auto",
                    }}>
                      {applyLogs.map((line, i) => (
                        <div key={i} style={{
                          color: line.startsWith("✅") || line.startsWith("✓") ? "#4ade80"
                            : line.startsWith("❌") ? "#f87171"
                            : "#94a3b8",
                        }}>
                          {line || " "}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
