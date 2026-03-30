import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";

const API = import.meta.env.VITE_API_BASE ?? "";
const DEFAULT_VPN_PASSWORD = "ocholasupernet";

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function ensureVpnUser(routerName: string): Promise<void> {
  try {
    await fetch(`${API}/api/vpn/users`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminId:  ADMIN_ID,
        username: slugify(routerName),
        password: DEFAULT_VPN_PASSWORD,
        notes:    `Auto — router: ${routerName}`,
      }),
    });
  } catch { /* non-critical — VPN user can be created manually later */ }
}

/* ── types ── */
interface Iface {
  name: string; type: string; running: boolean;
  disabled: boolean; macAddress: string; comment: string;
}
interface Bridge { name: string; running: boolean; }
interface BridgePort { bridge: string; interface: string; id: string; }

interface PortsPayload {
  ok: boolean; error?: string;
  interfaces: Iface[];
  bridges: Bridge[];
  bridgePorts: BridgePort[];
}

/* Unified router type — sourced from local DB or Supabase */
interface UnifiedRouter {
  key: string;
  id: number;
  name: string;
  host: string;
  router_username: string;
  router_secret: string;
  bridge_ip: string | null;
  source: "local" | "supabase";
  status: string;
}

/* Supabase isp_routers shape */
interface SbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
  bridge_ip: string | null;
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

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
        <IfaceIcon type={iface.type} running={iface.running} />
        <span style={{ fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 700, color: "var(--isp-text)" }}>
          {iface.name}
        </span>
        {iface.comment && (
          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>— {iface.comment}</span>
        )}
      </div>

      <span style={{
        fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.07em", padding: "0.15rem 0.5rem", borderRadius: 4,
        background: "rgba(255,255,255,0.06)", color: "var(--isp-text-muted)",
      }}>
        {iface.type || "ether"}
      </span>

      <span style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: iface.running ? "#4ade80" : "#475569",
      }} />

      {iface.macAddress && (
        <span style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "#475569" }}>
          {iface.macAddress}
        </span>
      )}

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
  useLocation();

  /* Parse routerId from query string — may be a local DB id or Supabase id */
  const params = new URLSearchParams(window.location.search);
  const routerIdParam = params.get("routerId");

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  /* server outbound IP — fetched once for firewall-rule instructions */
  const [serverIp, setServerIp] = useState<string>("34.145.0.87");
  useEffect(() => {
    fetch("/api/admin/server-info")
      .then(r => r.json())
      .then((d: { ok: boolean; serverIp: string }) => { if (d.serverIp) setServerIp(d.serverIp); })
      .catch(() => {});
  }, []);

  /* loaded data */
  const [payload, setPayload]         = useState<PortsPayload | null>(null);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);

  /* bridge + port selection */
  const [selectedBridge, setSelectedBridge] = useState<string>("");
  const [selectedPorts, setSelectedPorts]   = useState<Set<string>>(new Set());

  /* connection method */
  const [connectedVia, setConnectedVia] = useState<string | null>(null);

  /* apply result */
  const [applying, setApplying]     = useState(false);
  const [applyLogs, setApplyLogs]   = useState<string[] | null>(null);
  const [applyOk, setApplyOk]       = useState<boolean | null>(null);

    /* ── Load routers from Supabase isp_routers ── */
  const { data: sbRouters = [] } = useQuery<SbRouter[]>({
    queryKey: ["sb_routers_bp", ADMIN_ID],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("isp_routers")
          .select("id,name,host,status,router_username,router_secret,bridge_ip")
          .eq("admin_id", ADMIN_ID);
        return (data ?? []) as SbRouter[];
      } catch {
        return [];
      }
    },
    staleTime: 5_000,
    refetchInterval: 15_000, /* pick up WAN IP auto-saved by heartbeat */
  });

  /* ── Build unified list from Supabase ── */
  const routers: UnifiedRouter[] = sbRouters.map(r => ({
    key:             `sb:${r.id}`,
    id:              r.id,
    name:            r.name,
    host:            r.host ?? "",
    router_username: r.router_username ?? "admin",
    router_secret:   r.router_secret ?? "",
    bridge_ip:       r.bridge_ip ?? null,
    source:          "supabase" as const,
    status:          r.status,
  }));

  /* ── Auto-select router from URL param once data is loaded ── */
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!routerIdParam || autoSelectedRef.current || routers.length === 0) return;
    const numId = Number(routerIdParam);

    /* Prefer local DB match first */
    const localMatch = routers.find(r => r.source === "local" && r.id === numId);
    if (localMatch) {
      autoSelectedRef.current = true;
      setSelectedKey(localMatch.key);
      return;
    }

    /* Fall back to Supabase match */
    const sbMatch = routers.find(r => r.source === "supabase" && r.id === numId);
    if (sbMatch) {
      autoSelectedRef.current = true;
      setSelectedKey(sbMatch.key);
    }
  }, [routers, routerIdParam]);

  /* ── Auto-fetch ports when a router is selected ── */
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (!selectedKey || autoFetchedRef.current) return;
    const r = routers.find(x => x.key === selectedKey);
    if (!r) return;
    autoFetchedRef.current = true;

    fetchPortsForRouter(r);
  }, [selectedKey, routers.length]);

  /* ── Auto-select first bridge ── */
  useEffect(() => {
    if (payload?.bridges?.length && !selectedBridge) {
      setSelectedBridge(payload.bridges[0].name);
    }
  }, [payload]);

  /* ── Pre-tick ports already in the selected bridge ── */
  useEffect(() => {
    if (!payload || !selectedBridge) return;
    const inBridge = new Set(
      payload.bridgePorts
        .filter(bp => bp.bridge === selectedBridge)
        .map(bp => bp.interface)
    );
    setSelectedPorts(inBridge);
  }, [selectedBridge, payload]);

  const activeRouter = routers.find(r => r.key === selectedKey) ?? null;

  function effectiveHost(r: UnifiedRouter): string {
    return r.host || r.bridge_ip || "";
  }

  async function fetchPortsForRouter(r: UnifiedRouter) {
    const host = effectiveHost(r);
    if (!host) {
      setLoadError("No IP address available for this router. It will be set automatically once the VPN tunnel connects.");
      return;
    }
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
          host,
          username: r.router_username || "admin",
          password: r.router_secret   || "",
          bridgeIp: r.bridge_ip || undefined,
        }),
      });
      const data = await res.json() as PortsPayload & { connectedVia?: string };
      if (data.ok) {
        setPayload(data);
        if (data.connectedVia) setConnectedVia(data.connectedVia);
        /* Router is confirmed online + interfaces fetched — create VPN user now */
        void ensureVpnUser(r.name);
      } else {
        setLoadError(
          (data.error && data.error.trim()) ||
          "Could not connect to router — API service may not be enabled on port 8728."
        );
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchPorts(key: string) {
    const r = routers.find(x => x.key === key);
    if (!r) return;
    fetchPortsForRouter(r);
  }

  async function applyChanges() {
    if (!activeRouter || !selectedBridge || !payload) return;
    setApplying(true);
    setApplyLogs(null);
    setApplyOk(null);

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
          host:     effectiveHost(activeRouter),
          username: activeRouter.router_username || "admin",
          password: activeRouter.router_secret   || "",
          bridge:   selectedBridge,
          addPorts, removePorts,
          bridgeIp: activeRouter.bridge_ip || undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; logs: string[]; error?: string };
      setApplyLogs(data.logs ?? []);
      setApplyOk(data.ok);
      if (data.ok) fetchPorts(selectedKey!);
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
          {activeRouter && (
            <span style={{
              background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
              color: "#06b6d4", borderRadius: 6, padding: "0.2rem 0.625rem",
              fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
            }}>
              {activeRouter.name}
              {effectiveHost(activeRouter) ? ` — ${effectiveHost(activeRouter)}` : " — IP needed"}
            </span>
          )}
        </div>

        <NetworkTabs active="add-router" />

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
                value={selectedKey ?? ""}
                onChange={e => {
                  const key = e.target.value || null;
                  setSelectedKey(key);
                  setPayload(null);
                  setSelectedBridge("");
                  setSelectedPorts(new Set());
                  setConnectedVia(null);
                  setLoadError(null);
                  autoFetchedRef.current = false;
                  if (key) {
                    const r = routers.find(x => x.key === key);
                    if (r) setTimeout(() => fetchPortsForRouter(r), 0);
                  }
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
                  <option key={r.key} value={r.key}>
                    {r.name} ({r.host || "no IP"}) {r.status === "online" ? "🟢" : "🔴"}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            </div>
          </div>

          {/* Bridge dropdown */}
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

          {/* Refresh */}
          {selectedKey && (
            <button
              onClick={() => { autoFetchedRef.current = false; fetchPorts(selectedKey!); }}
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

        {/* VPN connection badge */}
        {connectedVia?.includes("VPN") && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.72rem", color: "#a78bfa", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 6, padding: "0.3rem 0.75rem", alignSelf: "flex-start" }}>
            <Shield size={11} /> Connected via VPN tunnel — direct connection unavailable
          </div>
        )}

        {/* ── States ── */}

        {!selectedKey && (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
            Select a router above to load its interfaces.
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", justifyContent: "center", padding: "2.5rem 1rem", color: "#22d3ee", fontSize: "0.875rem" }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
            Connecting to router and reading interfaces…
          </div>
        )}

        {loadError && !loading && (() => {
          const isConnErr = /cannot reach|timed out|timeout|ECONNREFUSED|api.*disabled|connect/i.test(loadError);
          const activeRouter = routers.find(r => r.key === selectedKey);
          const routerHost   = activeRouter ? (activeRouter.host || activeRouter.bridge_ip || "?") : "?";
          return (
            <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "1rem 1.25rem", fontSize: "0.82rem" }}>
              {/* header */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#f87171", fontWeight: 700, marginBottom: isConnErr ? "0.875rem" : 0 }}>
                <AlertTriangle size={15} />
                {isConnErr ? "Router API Not Reachable" : "Error Loading Ports"}
              </div>

              {/* generic message when NOT a connection error */}
              {!isConnErr && (
                <div style={{ color: "#fca5a5", marginTop: "0.4rem" }}>{loadError}</div>
              )}

              {/* detailed setup guide when it IS a connection error */}
              {isConnErr && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  <p style={{ color: "#fca5a5", margin: 0, lineHeight: 1.6 }}>
                    The server can see your router is <strong style={{ color: "#4ade80" }}>online</strong> (heartbeat ✓),
                    but could not open an API connection to <code style={{ fontFamily: "monospace", background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "1px 5px" }}>{routerHost}:8728</code>.
                    The server tried both the WAN IP and the VPN tunnel IP automatically — all failed.
                    Choose one of the two fixes below:
                  </p>

                  {/* ── Option A: VPN (recommended) ── */}
                  <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                    <div style={{ color: "#4ade80", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "0.04em" }}>
                      ✦ OPTION A — Allow API through the VPN tunnel (recommended — no WAN exposure)
                    </div>
                    <p style={{ color: "#86efac", margin: "0 0 0.5rem", fontSize: "0.78rem", lineHeight: 1.5 }}>
                      Run these two commands once on the router. The server will then connect via the VPN tunnel (<code style={{ fontFamily: "monospace" }}>10.8.0.x:8728</code>) — no public firewall hole needed:
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <code style={{ fontFamily: "monospace", color: "#67e8f9", fontSize: "0.78rem", display: "block", background: "rgba(0,0,0,0.35)", borderRadius: 5, padding: "0.4rem 0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {"/ip service enable api"}
                      </code>
                      <code style={{ fontFamily: "monospace", color: "#67e8f9", fontSize: "0.78rem", display: "block", background: "rgba(0,0,0,0.35)", borderRadius: 5, padding: "0.4rem 0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {"/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept place-before=0"}
                      </code>
                    </div>
                    <p style={{ color: "#6ee7b7", margin: "0.5rem 0 0", fontSize: "0.72rem" }}>
                      After running, click <strong>Refresh</strong>. The server reads the VPN status file automatically to find your router's tunnel IP.
                    </p>
                  </div>

                  {/* ── Option B: WAN firewall ── */}
                  <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "0.04em" }}>
                      OPTION B — Allow API from the server's public IP (direct WAN access)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <code style={{ fontFamily: "monospace", color: "#67e8f9", fontSize: "0.78rem", display: "block", background: "rgba(0,0,0,0.35)", borderRadius: 5, padding: "0.4rem 0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {"/ip service enable api"}
                      </code>
                      <code style={{ fontFamily: "monospace", color: "#67e8f9", fontSize: "0.78rem", display: "block", background: "rgba(0,0,0,0.35)", borderRadius: 5, padding: "0.4rem 0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {`/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${serverIp} action=accept place-before=0`}
                      </code>
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.71rem", marginTop: "0.35rem" }}>
                      Server IP: <strong style={{ color: "#a5b4fc" }}>{serverIp}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Port list */}
        {payload && !loading && (
          <>
            {payload.bridges.length === 0 && (
              <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "0.75rem 1.125rem", fontSize: "0.8rem", color: "#fbbf24" }}>
                No bridge interfaces found on this router. Create a bridge first via
                <code style={{ fontFamily: "monospace", marginLeft: "0.25rem" }}>
                  /interface bridge add name=bridge1
                </code>
              </div>
            )}

            {payload.bridges.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
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

                <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)", borderRadius: 10, overflow: "hidden" }}>
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

                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <button
                    onClick={applyChanges}
                    disabled={applying}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.625rem 1.75rem", borderRadius: 8,
                      background: applying ? "rgba(6,182,212,0.15)" : "linear-gradient(135deg,#06b6d4,#0284c7)",
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

                {applyLogs && (
                  <div style={{ border: `1px solid ${applyOk ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem", background: applyOk ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)" }}>
                      {applyOk
                        ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                        : <AlertTriangle size={14} style={{ color: "#f87171" }} />
                      }
                      <span style={{ fontWeight: 700, fontSize: "0.8rem", color: applyOk ? "#4ade80" : "#f87171" }}>
                        {applyOk ? "Applied successfully" : "Apply failed"}
                      </span>
                    </div>
                    <div style={{ padding: "0.75rem 1rem", background: "#080c10", fontFamily: "monospace", fontSize: "0.73rem", lineHeight: 1.75, maxHeight: 220, overflow: "auto" }}>
                      {applyLogs.map((line, i) => (
                        <div key={i} style={{ color: line.startsWith("✅") || line.startsWith("✓") ? "#4ade80" : line.startsWith("❌") ? "#f87171" : "#94a3b8" }}>
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
