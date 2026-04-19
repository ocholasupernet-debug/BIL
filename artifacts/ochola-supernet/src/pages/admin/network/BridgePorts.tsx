import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle,
  ChevronDown, Check, Network, Plug, Wifi, Shield, Copy, Plus,
} from "lucide-react";

/* ── Smart error panel ─────────────────────────────────────────── */
function RouterErrorPanel({ error }: { error: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(txt); setTimeout(() => setCopied(null), 2000);
    });
  };

  const e = error.toLowerCase();

  /* Classify the failure */
  const isRefused   = e.includes("refused") || e.includes("econnrefused");
  const isTimeout   = e.includes("timed out") || e.includes("etimedout") || e.includes("did not respond");
  const isAuthFail  = e.includes("login failed") || e.includes("authentication") || e.includes("wrong credentials") || e.includes("bad password");
  const isNoVpn     = e.includes("routing failure") || e.includes("ehostunreach") || e.includes("enetunreach") || e.includes("no host");

  let title  = "Router API Not Reachable";
  let reason = error;
  let hint   = "";
  let cmds: string[] = [];

  if (isAuthFail) {
    title  = "Authentication Failed";
    reason = "The router API is reachable but rejected the username or password.";
    hint   = "Check the router credentials saved in the Routers page and ensure the API user has full access:";
    cmds   = ["/ip service enable api", "/user add name=admin group=full"];
  } else if (isRefused) {
    title  = "API Service Disabled";
    reason = "Port 8728 is reachable on the router (VPN tunnel is up ✓) but the RouterOS API service is turned off.";
    hint   = "Open Winbox → New Terminal and run this single command:";
    cmds   = ["/ip service enable api"];
  } else if (isTimeout) {
    title  = "Port 8728 Blocked by Firewall";
    reason = "The router is reachable but port 8728 is being dropped by a firewall rule.";
    hint   = "Open Winbox → New Terminal and run these two commands:";
    cmds   = [
      "/ip service enable api",
      "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept place-before=0",
    ];
  } else if (isNoVpn) {
    title  = "Router Not Reachable (VPN Down?)";
    reason = "The server cannot reach the router's IP at all. The OpenVPN tunnel may have dropped.";
    hint   = "Re-run the install script on the router to reconnect the VPN, or open Winbox → New Terminal:";
    cmds   = ["/interface ovpn-client enable ovpn-out1"];
  } else {
    hint = "Run these commands in Winbox → New Terminal to enable the API:";
    cmds = [
      "/ip service enable api",
      "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept place-before=0",
    ];
  }

  return (
    <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "1rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#f87171", fontWeight: 700, marginBottom: "0.5rem" }}>
        <AlertTriangle size={15} /> {title}
      </div>
      <p style={{ color: "#fca5a5", margin: "0 0 0.875rem", fontSize: "0.82rem", lineHeight: 1.6 }}>{reason}</p>
      {cmds.length > 0 && (
        <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "0.75rem 1rem" }}>
          <div style={{ color: "#4ade80", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.5rem" }}>{hint}</div>
          {cmds.map((cmd) => (
            <div key={cmd} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.375rem", alignItems: "center" }}>
              <code style={{ flex: 1, fontFamily: "monospace", fontSize: "0.75rem", color: "#67e8f9", background: "rgba(0,0,0,0.35)", padding: "0.3rem 0.6rem", borderRadius: 5, wordBreak: "break-all" }}>{cmd}</code>
              <button onClick={() => copy(cmd)} style={{ background: copied === cmd ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied === cmd ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.1)"}`, borderRadius: 5, color: copied === cmd ? "#4ade80" : "#94a3b8", cursor: "pointer", fontSize: "0.65rem", padding: "0.25rem 0.55rem", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "0.2rem" }}>
                <Copy size={10} /> {copied === cmd ? "Copied!" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      )}
      {isRefused && (
        <div style={{ marginTop: "0.625rem", fontSize: "0.74rem", color: "#64748b", lineHeight: 1.55 }}>
          💡 <strong style={{ color: "#94a3b8" }}>Good news:</strong> the VPN tunnel is up — your router is connected. You only need to enable the API service. After running the command above, click <strong style={{ color: "#94a3b8" }}>Refresh</strong>.
        </div>
      )}
    </div>
  );
}

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
  } catch { /* non-critical */ }
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

interface SbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
  bridge_ip: string | null;
}

interface UnifiedRouter {
  key: string; id: number; name: string;
  host: string; router_username: string; router_secret: string;
  bridge_ip: string | null; source: "supabase"; status: string;
}

/* ── Classify an interface name into a purpose type ── */
type IfaceKind = "bridge" | "hotspot-bridge" | "vpn-main" | "vpn-proxy" | "wlan" | "ether" | "loopback" | "other";

function classifyIface(name: string, type: string): IfaceKind {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  if (t === "loopback") return "loopback";
  if (t === "wlan" || t.startsWith("wlan")) return "wlan";
  if (n === "ocholasuperproxy" || n.includes("superproxy") || n.includes("ovpn-out2") || n.includes("proxy")) return "vpn-proxy";
  if (n.startsWith("ovpn") || n.includes("vpn") || t === "ovpn-client") return "vpn-main";
  if (n.includes("hotspot") || n.includes("hs-bridge") || n.includes("hsbridge")) return "hotspot-bridge";
  if (t === "bridge") return "bridge";
  if (n.startsWith("ether") || t === "ether") return "ether";
  return "other";
}

/* ── icon for interface type ── */
function IfaceIcon({ name, type, running }: { name: string; type: string; running: boolean }) {
  const kind = classifyIface(name, type);
  const color = running ? "var(--isp-accent)" : "#475569";
  if (kind === "wlan") return <Wifi size={14} style={{ color }} />;
  if (kind === "bridge" || kind === "hotspot-bridge") return <Network size={14} style={{ color }} />;
  if (kind === "vpn-main" || kind === "vpn-proxy") return <Shield size={14} style={{ color: running ? "var(--isp-accent)" : "#475569" }} />;
  return <Plug size={14} style={{ color }} />;
}

/* ── Classify a bridge name into a readable type ── */
function bridgeType(bridgeName: string): "hotspot" | "pppoe" | "vpn-proxy" | "vpn-main" | "unknown" {
  const n = bridgeName.toLowerCase();
  if (n === "ocholasuperproxy" || n.includes("superproxy")) return "vpn-proxy";
  if (n.startsWith("ovpn") || n.includes("vpn"))            return "vpn-main";
  if (n.includes("hotspot") || n.includes("hs-bridge") || n.includes("hsbridge")) return "hotspot";
  if (n.includes("pppoe")   || n.includes("ppp"))           return "pppoe";
  return "unknown";
}

/* ── Badge shown beside the port/interface name ── */
function BridgeBadge({ bridge }: { bridge: string | null }) {
  if (!bridge) return null;
  const type = bridgeType(bridge);
  const cfg: Record<string, { bg: string; border: string; color: string; label: string }> = {
    hotspot:   { bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.3)",   color: "#4ade80", label: "Hotspot Bridge"      },
    pppoe:     { bg: "var(--isp-accent-glow)",   border: "var(--isp-accent-border)",   color: "var(--isp-accent)", label: "PPPoE Bridge"        },
    "vpn-main":  { bg: "var(--isp-accent-glow)", border: "var(--isp-accent-border)", color: "var(--isp-accent)", label: "VPN Remote Access"   },
    "vpn-proxy": { bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.3)",  color: "#fb923c", label: "Proxy · ocholasuperproxy" },
    unknown:   { bg: "rgba(251,191,36,0.10)",  border: "rgba(251,191,36,0.3)",  color: "#fbbf24", label: "Unknown Bridge"      },
  };
  const { bg, border, color, label } = cfg[type];
  return (
    <span style={{
      fontSize: "0.63rem", fontWeight: 700, padding: "0.18rem 0.55rem", borderRadius: 4,
      background: bg, border: `1px solid ${border}`, color,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

/* ── Interface kind pill ── */
function IfaceKindBadge({ name, type }: { name: string; type: string }) {
  const kind = classifyIface(name, type);
  const cfg: Record<IfaceKind, { color: string; label: string } | null> = {
    "bridge":        { color: "var(--isp-accent)", label: "Bridge" },
    "hotspot-bridge":{ color: "#4ade80", label: "Hotspot Bridge" },
    "vpn-main":      { color: "var(--isp-accent)", label: "VPN · Remote Access" },
    "vpn-proxy":     { color: "#fb923c", label: "ocholasuperproxy · Backup" },
    "wlan":          { color: "#60a5fa", label: "Wireless" },
    "ether":         null,
    "loopback":      null,
    "other":         null,
  };
  const c = cfg[kind];
  if (!c) return null;
  return (
    <span style={{
      fontSize: "0.6rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 4,
      background: `${c.color}18`, border: `1px solid ${c.color}44`, color: c.color,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {c.label}
    </span>
  );
}

/* Returns the bridge a port is currently member of (from live bridgePorts list) */
function portCurrentBridge(portName: string, bridgePorts: BridgePort[]): string | null {
  return bridgePorts.find(bp => bp.interface === portName)?.bridge ?? null;
}

/* ════════════════════════════════════════════════════════
   Main page
════════════════════════════════════════════════════════ */
function CreateHotspotBridgeBanner({ creating, message, onCreateClick }: {
  creating: boolean;
  message: string | null;
  onCreateClick: () => void;
}) {
  if (message) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: "0.625rem",
        padding: "0.75rem 1.25rem", borderRadius: 10,
        background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)",
        color: "#4ade80", fontSize: "0.85rem", fontWeight: 600,
      }}>
        <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
        {message}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.75rem",
      padding: "0.875rem 1.25rem", borderRadius: 10,
      background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)",
    }}>
      <AlertTriangle size={16} style={{ color: "#fbbf24", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fbbf24" }}>
          No hotspot bridge found
        </span>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
          A separate <code style={{ fontFamily: "monospace", fontWeight: 700, color: "#4ade80" }}>hotspot-bridge</code> is required for the captive portal. Click the button to create it on this router.
        </p>
      </div>
      <button
        onClick={onCreateClick}
        disabled={creating}
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.4rem",
          padding: "0.5rem 1rem", borderRadius: 8, flexShrink: 0,
          background: creating ? "rgba(74,222,128,0.15)" : "linear-gradient(135deg,#22c55e,#16a34a)",
          border: "none", color: creating ? "#4ade80" : "white",
          fontWeight: 700, fontSize: "0.8rem", fontFamily: "inherit",
          cursor: creating ? "not-allowed" : "pointer",
          boxShadow: creating ? "none" : "0 4px 12px rgba(34,197,94,0.3)",
        }}
      >
        {creating
          ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Creating…</>
          : <><Plus size={13} /> Create Hotspot Bridge</>
        }
      </button>
    </div>
  );
}

export default function BridgePorts() {
  const [, navigate] = useLocation();

  const params        = new URLSearchParams(window.location.search);
  const routerIdParam = params.get("routerId");
  const isReplaceMode = !!routerIdParam;

  const [selectedKey, setSelectedKey]       = useState<string | null>(null);
  const [payload, setPayload]               = useState<PortsPayload | null>(null);
  const [loading, setLoading]               = useState(false);
  const [loadError, setLoadError]           = useState<string | null>(null);
  const [selectedBridge, setSelectedBridge] = useState<string>("");
  const [selectedPorts, setSelectedPorts]   = useState<Set<string>>(new Set());
  const [connectedVia, setConnectedVia]     = useState<string | null>(null);
  const [applying, setApplying]             = useState(false);
  const [applyLogs, setApplyLogs]           = useState<string[] | null>(null);
  const [applyOk, setApplyOk]               = useState<boolean | null>(null);
  const [creatingBridge, setCreatingBridge] = useState(false);
  const [bridgeCreateMsg, setBridgeCreateMsg] = useState<string | null>(null);

  /* ── Load routers from Supabase ── */
  const { data: sbRouters = [] } = useQuery<SbRouter[]>({
    queryKey: ["sb_routers_bp", ADMIN_ID],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("isp_routers")
          .select("id,name,host,status,router_username,router_secret,bridge_ip")
          .eq("admin_id", ADMIN_ID);
        return (data ?? []) as SbRouter[];
      } catch { return []; }
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

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

  /* ── Auto-select router from URL param ── */
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!routerIdParam || autoSelectedRef.current || routers.length === 0) return;
    const numId = Number(routerIdParam);
    const match = routers.find(r => r.id === numId);
    if (match) {
      autoSelectedRef.current = true;
      setSelectedKey(match.key);
    }
  }, [routers, routerIdParam]);

  /* ── Auto-fetch when selected ── */
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

  /* ── Pre-tick ports already in bridge ── */
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
    const cn   = slugify(r.name);
    if (!host && !cn) {
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
          routerCn: cn,
          routerId: r.id,
        }),
      });
      const data = await res.json() as PortsPayload & { connectedVia?: string };
      if (data.ok) {
        setPayload(data);
        if (data.connectedVia) setConnectedVia(data.connectedVia);
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
    autoFetchedRef.current = false;
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
      if (data.ok) {
        fetchPorts(selectedKey!);
        /* If this router was in "setup" (freshly created, awaiting bridge config),
           now mark it as "offline" so heartbeats can promote it to "online". */
        if (activeRouter.status === "setup") {
          supabase
            .from("isp_routers")
            .update({ status: "offline" })
            .eq("id", activeRouter.id)
            .eq("status", "setup")
            .then(() => console.log(`[bridge-ports] router ${activeRouter.id} promoted from setup → offline`))
            .catch((e: unknown) => console.warn("[bridge-ports] status update failed", e));
        }
      }
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
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  /* Physical ports excluding ether1 (WAN) and bridge/loopback types */
  const physicalPorts = (payload?.interfaces ?? []).filter(
    i => i.type !== "bridge" && i.type !== "loopback" && i.name !== "ether1"
  );

  const hasHotspotBridge = (payload?.bridges ?? []).some(
    b => bridgeType(b.name) === "hotspot"
  );

  async function handleCreateHotspotBridge() {
    if (!activeRouter || creatingBridge) return;
    setCreatingBridge(true);
    setLoadError(null);
    setBridgeCreateMsg(null);
    try {
      const res = await fetch("/api/admin/router/bridge-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: effectiveHost(activeRouter),
          username: activeRouter.router_username || "admin",
          password: activeRouter.router_secret   || "",
          bridgeName: "hotspot-bridge",
          bridgeIp: activeRouter.bridge_ip || undefined,
        }),
      });
      if (!res.ok && !res.headers.get("content-type")?.includes("json")) {
        setLoadError(`Server error (${res.status}) while creating hotspot-bridge.`);
        return;
      }
      const data = await res.json() as { ok: boolean; created: boolean; message: string; error?: string };
      if (data.ok) {
        setBridgeCreateMsg(data.message);
        fetchPorts(selectedKey!);
      } else {
        setLoadError(data.error || "Failed to create hotspot-bridge.");
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setCreatingBridge(false);
    }
  }

  const connectedIp = connectedVia || activeRouter?.bridge_ip || activeRouter?.host || "";
  const profileName = activeRouter ? `${slugify(activeRouter.name)}.ovpn` : "";
  const bridgeLabel = selectedBridge ? `*${selectedBridge.replace(/hotspot-?/i, "").replace(/bridge/i, "B") || "B"}` : "*B";

  /* ══════════════════════════════════════════════════════
     REPLACE ROUTER MODE — clean UI matching the screenshot
  ══════════════════════════════════════════════════════ */
  if (isReplaceMode) {
    return (
      <AdminLayout>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", maxWidth: 860 }}>

          {/* Title */}
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Replace Router
          </h1>

          {/* Blue profile banner */}
          {activeRouter && (
            <div style={{
              background: "linear-gradient(135deg,#1e40af,#1d4ed8)",
              borderRadius: 10, padding: "0.875rem 1.25rem",
              display: "flex", alignItems: "center", gap: "0.625rem",
            }}>
              <Network size={16} style={{ color: "#93c5fd", flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "white" }}>
                Replace Router — Profile:{" "}
              </span>
              <span style={{
                fontFamily: "monospace", fontWeight: 800, fontSize: "0.9rem",
                background: "rgba(255,255,255,0.15)", padding: "0.15rem 0.625rem",
                borderRadius: 5, color: "#e0f2fe",
              }}>
                {profileName}
              </span>
            </div>
          )}

          {/* Loading spinner */}
          {loading && (
            <div style={{
              display: "flex", alignItems: "center", gap: "0.75rem",
              padding: "1rem 1.25rem", borderRadius: 10,
              background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)",
              color: "var(--isp-accent)", fontSize: "0.875rem",
            }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
              Connecting to router and reading interfaces…
            </div>
          )}

          {/* Connected IP banner */}
          {!loading && connectedIp && payload?.ok && (
            <div style={{
              display: "flex", alignItems: "center", gap: "0.625rem",
              padding: "0.75rem 1.25rem", borderRadius: 10,
              background: "rgba(20,184,166,0.12)", border: "1px solid rgba(20,184,166,0.3)",
              color: "#2dd4bf",
            }}>
              <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Connected router IP:</span>
              <span style={{
                fontFamily: "monospace", fontWeight: 800, fontSize: "0.875rem",
                background: "rgba(20,184,166,0.2)", padding: "0.1rem 0.5rem",
                borderRadius: 5, color: "#5eead4",
              }}>
                {connectedIp}
              </span>
            </div>
          )}

          {/* Load error */}
          {loadError && !loading && <RouterErrorPanel error={loadError} />}

          {/* No router selected yet */}
          {!activeRouter && !loading && routers.length === 0 && (
            <div style={{ padding: "2rem 1.25rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
              Loading router data…
            </div>
          )}

          {/* Create Hotspot Bridge banner (Replace mode) */}
          {payload && !loading && !hasHotspotBridge && (
            <CreateHotspotBridgeBanner creating={creatingBridge} message={bridgeCreateMsg} onCreateClick={handleCreateHotspotBridge} />
          )}

          {/* Instructions + port list (shown once ports are loaded) */}
          {payload && !loading && (
            <>
              {/* Two-bridge architecture info banner */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                background: "rgba(255,255,255,0.02)", border: "1px solid var(--isp-accent-glow)",
                borderRadius: 10, padding: "12px 14px",
              }}>
                {[
                  {
                    color: "var(--isp-accent)",
                    icon: <Network size={12} style={{ color: "var(--isp-accent)", flexShrink: 0 }} />,
                    label: "bridge",
                    pill: "Normal Internet",
                    pillColor: "#64748b",
                    desc: "All LAN ports live here. Provides standard internet to wired & wireless clients. Do not put WAN here.",
                  },
                  {
                    color: "#4ade80",
                    icon: <Wifi size={12} style={{ color: "#4ade80", flexShrink: 0 }} />,
                    label: "hotspot-bridge",
                    pill: "Captive Portal",
                    pillColor: "#4ade80",
                    desc: "Completely separate bridge that carries the hotspot login page. Hotspot subscribers authenticate here before getting internet.",
                  },
                ].map(({ color, icon, label, pill, pillColor, desc }) => (
                  <div key={label} style={{
                    borderLeft: `3px solid ${color}`, borderRadius: 6,
                    background: `${color}08`, padding: "9px 12px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                      {icon}
                      <code style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 800, color }}>{label}</code>
                      <span style={{
                        fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                        background: `${pillColor}18`, border: `1px solid ${pillColor}33`, color: pillColor,
                        textTransform: "uppercase" as const, letterSpacing: "0.05em",
                      }}>{pill}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 10, color: "var(--isp-text-muted)", lineHeight: 1.5 }}>{desc}</p>
                  </div>
                ))}
              </div>

              {/* Instruction box */}
              <div style={{
                background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.25)",
                borderRadius: 10, padding: "0.875rem 1.25rem",
                fontSize: "0.82rem", color: "#67e8f9", lineHeight: 1.7,
              }}>
                <Shield size={13} style={{ display: "inline", marginRight: "0.4rem", color: "var(--isp-accent)" }} />
                Select which ports to assign to <strong>{selectedBridge || "hotspot-bridge"}</strong>. WAN (<strong>ether1</strong>) is always excluded.
                After you click <strong>Finish</strong>, to re-add your customers please do this in order:{" "}
                <strong>Step 1</strong>: Networks → pools and sync by router &nbsp;
                <strong>Step 2</strong>: Packages → hotspot &amp; PPPoE and sync by router &nbsp;
                <strong>Step 3</strong>: Activation → Prepaid users and sync by router.
              </div>

              {/* Bridge selector (if multiple bridges detected) */}
              {payload.bridges.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Assign ports to bridge:</span>
                  <div style={{ position: "relative" }}>
                    <select
                      value={selectedBridge}
                      onChange={e => setSelectedBridge(e.target.value)}
                      style={{
                        background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
                        border: "1px solid var(--isp-accent-border)",
                        borderRadius: 7, padding: "0.4rem 2rem 0.4rem 0.75rem",
                        color: "var(--isp-accent)", fontSize: "0.82rem", fontWeight: 700,
                        fontFamily: "monospace", outline: "none", cursor: "pointer", appearance: "none",
                      }}
                    >
                      {payload.bridges.map(b => {
                        const isHotspot = b.name.toLowerCase().includes("hotspot");
                        return (
                          <option key={b.name} value={b.name}>
                            {b.name}{isHotspot ? " (hotspot — captive portal)" : " (main — normal internet)"}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-accent)", pointerEvents: "none" }} />
                  </div>
                </div>
              )}

              {/* Port list */}
              <div style={{
                background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                borderRadius: 10, overflow: "hidden",
              }}>
                {physicalPorts.length === 0 ? (
                  <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
                    No assignable ports found (ether1 excluded).
                  </div>
                ) : physicalPorts.map((iface, idx) => {
                  const inBridge = selectedPorts.has(iface.name);
                  const isLast   = idx === physicalPorts.length - 1;
                  return (
                    <div
                      key={iface.name}
                      onClick={() => togglePort(iface.name)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.875rem",
                        padding: "0.85rem 1.25rem",
                        borderBottom: isLast ? "none" : "1px solid var(--isp-border-subtle)",
                        cursor: "pointer",
                        background: inBridge ? "rgba(37,99,235,0.04)" : "transparent",
                        transition: "background 0.15s",
                      }}
                      onMouseOver={e => { if (!inBridge) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"; }}
                      onMouseOut={e  => { if (!inBridge) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        background: inBridge ? "var(--isp-accent)" : "rgba(255,255,255,0.06)",
                        border: `2px solid ${inBridge ? "var(--isp-accent)" : "rgba(255,255,255,0.18)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                        {inBridge && <Check size={11} strokeWidth={3} color="white" />}
                      </div>

                      {/* Interface icon */}
                      <IfaceIcon name={iface.name} type={iface.type} running={iface.running} />

                      {/* Name */}
                      <span style={{
                        fontFamily: "monospace", fontSize: "0.9rem", fontWeight: 700,
                        color: "var(--isp-text)", flex: 1,
                      }}>
                        {iface.name}
                      </span>

                      {/* Bridge type badge */}
                      <BridgeBadge bridge={portCurrentBridge(iface.name, payload!.bridgePorts)} />

                      {/* Running dot */}
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: iface.running ? "#4ade80" : "#475569", flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>

              {/* Apply result */}
              {applyLogs && (
                <div style={{
                  background: applyOk ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.06)",
                  border: `1px solid ${applyOk ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.25)"}`,
                  borderRadius: 10, padding: "0.875rem 1.25rem",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", color: applyOk ? "#22c55e" : "#f87171", fontWeight: 700, fontSize: "0.85rem" }}>
                    {applyOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {applyOk ? "Bridge ports updated successfully!" : "Failed to update bridge ports"}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    {applyLogs.map((l, i) => <span key={i}>{l}</span>)}
                  </div>
                </div>
              )}

              {/* Action buttons — Finish · Back · Refresh */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                <button
                  onClick={applyChanges}
                  disabled={applying || !selectedBridge}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.45rem",
                    padding: "0.65rem 1.875rem", borderRadius: 9,
                    background: applying || !selectedBridge
                      ? "rgba(20,184,166,0.15)"
                      : "linear-gradient(135deg,#0d9488,#0f766e)",
                    border: "none",
                    color: applying || !selectedBridge ? "#5eead4" : "white",
                    fontWeight: 800, fontSize: "0.9rem",
                    cursor: applying || !selectedBridge ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    boxShadow: applying || !selectedBridge ? "none" : "0 4px 14px rgba(13,148,136,0.4)",
                    transition: "all 0.2s",
                  }}
                >
                  {applying
                    ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Applying…</>
                    : <><Check size={15} /> Finish</>
                  }
                </button>

                <button
                  onClick={() => navigate("/admin/network/replace-router")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.45rem",
                    padding: "0.65rem 1.25rem", borderRadius: 9,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
                    color: "var(--isp-text-muted)", fontWeight: 700, fontSize: "0.875rem",
                    cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                  }}
                >
                  ← Back
                </button>

                <button
                  onClick={() => { if (selectedKey) fetchPorts(selectedKey); }}
                  disabled={loading}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.45rem",
                    padding: "0.65rem 1.25rem", borderRadius: 9,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
                    color: "var(--isp-text-muted)", fontWeight: 700, fontSize: "0.875rem",
                    cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
                  }}
                >
                  <RefreshCw size={13} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
                  Refresh
                </button>
              </div>
            </>
          )}

          {/* Standalone Refresh (before ports load) */}
          {!payload && !loading && activeRouter && !loadError && (
            <button
              onClick={() => fetchPorts(selectedKey!)}
              style={{
                alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "0.45rem",
                padding: "0.6rem 1.25rem", borderRadius: 8,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <RefreshCw size={13} /> Retry
            </button>
          )}
        </div>
      </AdminLayout>
    );
  }

  /* ══════════════════════════════════════════════════════
     STANDALONE MODE — full router selector UI
  ══════════════════════════════════════════════════════ */
  const physicalPortsAll = (payload?.interfaces ?? []).filter(
    i => i.type !== "bridge" && i.type !== "loopback"
  );

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 860 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Assign Bridge Ports
          </h1>
          {activeRouter && (
            <span style={{
              background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)",
              color: "var(--isp-accent)", borderRadius: 6, padding: "0.2rem 0.625rem",
              fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
            }}>
              {activeRouter.name}{effectiveHost(activeRouter) ? ` — ${effectiveHost(activeRouter)}` : " — IP needed"}
            </span>
          )}
        </div>

        <NetworkTabs active="add-router" />

        {/* Router + Bridge selectors */}
        <div style={{
          display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center",
          background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
          borderRadius: 10, padding: "0.875rem 1.125rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Router</span>
            <div style={{ position: "relative" }}>
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
                  background: "var(--isp-input-bg,rgba(255,255,255,0.05))", border: "1px solid var(--isp-border)",
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
              <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            </div>
          </div>

          {payload && payload.bridges.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Bridge</span>
              <div style={{ position: "relative" }}>
                <select
                  value={selectedBridge}
                  onChange={e => setSelectedBridge(e.target.value)}
                  style={{
                    background: "var(--isp-input-bg,rgba(255,255,255,0.05))", border: "1px solid var(--isp-accent-border)",
                    borderRadius: 7, padding: "0.4rem 2rem 0.4rem 0.75rem",
                    color: "var(--isp-accent)", fontSize: "0.8rem", fontWeight: 700,
                    cursor: "pointer", fontFamily: "monospace", outline: "none", appearance: "none",
                  }}
                >
                  {payload.bridges.map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-accent)", pointerEvents: "none" }} />
              </div>
            </div>
          )}

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

        {/* VPN badge */}
        {connectedVia && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.72rem", color: "var(--isp-accent)", background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)", borderRadius: 6, padding: "0.3rem 0.75rem", alignSelf: "flex-start" }}>
            <Shield size={11} /> Connected via {connectedVia}
          </div>
        )}

        {!selectedKey && (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
            Select a router above to load its interfaces.
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", justifyContent: "center", padding: "2.5rem 1rem", color: "var(--isp-accent)", fontSize: "0.875rem" }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
            Connecting to router and reading interfaces…
          </div>
        )}

        {loadError && !loading && <RouterErrorPanel error={loadError} />}

        {/* Create Hotspot Bridge banner (Standalone mode) */}
        {payload && !loading && !hasHotspotBridge && (
          <CreateHotspotBridgeBanner creating={creatingBridge} message={bridgeCreateMsg} onCreateClick={handleCreateHotspotBridge} />
        )}

        {payload && !loading && (
          <>
            <div style={{
              background: "var(--isp-card)", border: "1px solid var(--isp-border)",
              borderRadius: 10, overflow: "hidden",
            }}>
              {physicalPortsAll.map((iface, idx) => {
                const isBridgeType = iface.type === "bridge" || iface.type === "loopback";
                const inBridge = selectedPorts.has(iface.name);
                return (
                  <div
                    key={iface.name}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.875rem",
                      padding: "0.75rem 1rem",
                      borderBottom: idx < physicalPortsAll.length - 1 ? "1px solid var(--isp-border-subtle)" : "none",
                      opacity: isBridgeType ? 0.45 : 1,
                    }}
                  >
                    <button
                      onClick={() => !isBridgeType && togglePort(iface.name)}
                      disabled={isBridgeType}
                      style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        background: inBridge ? "var(--isp-accent)" : "rgba(255,255,255,0.06)",
                        border: `2px solid ${inBridge ? "var(--isp-accent)" : "rgba(255,255,255,0.2)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: isBridgeType ? "not-allowed" : "pointer", transition: "all 0.15s",
                      }}
                    >
                      {inBridge && <Check size={11} strokeWidth={3} color="white" />}
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                      <IfaceIcon name={iface.name} type={iface.type} running={iface.running} />
                      <span style={{ fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 700, color: "var(--isp-text)" }}>{iface.name}</span>
                      {iface.comment && <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>— {iface.comment}</span>}
                      <IfaceKindBadge name={iface.name} type={iface.type} />
                    </div>
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", padding: "0.15rem 0.5rem", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "var(--isp-text-muted)" }}>{iface.type || "ether"}</span>
                    <BridgeBadge bridge={portCurrentBridge(iface.name, payload!.bridgePorts)} />
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: iface.running ? "#4ade80" : "#475569" }} />
                  </div>
                );
              })}
            </div>

            {applyLogs && (
              <div style={{
                background: applyOk ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.06)",
                border: `1px solid ${applyOk ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.25)"}`,
                borderRadius: 10, padding: "0.875rem 1.25rem",
              }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                  {applyLogs.map((l, i) => <span key={i}>{l}</span>)}
                </div>
              </div>
            )}

            <button
              onClick={applyChanges}
              disabled={applying || !selectedBridge}
              style={{
                alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.65rem 1.875rem", borderRadius: 9,
                background: applying ? "var(--isp-accent-glow)" : "var(--isp-accent)",
                border: "none", color: applying ? "#67e8f9" : "white",
                fontWeight: 700, fontSize: "0.9rem",
                cursor: applying || !selectedBridge ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                boxShadow: applying ? "none" : "0 4px 14px var(--isp-accent-border)",
              }}
            >
              {applying
                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Applying…</>
                : <><Check size={14} /> Apply Bridge Ports</>
              }
            </button>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
