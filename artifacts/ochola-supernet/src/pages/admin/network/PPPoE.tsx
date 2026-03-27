import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Network, Wifi, Copy, Download, CheckCircle2, AlertTriangle,
  Loader2, RefreshCw, Save, FileCode2, ChevronDown, ChevronUp,
  Server, Zap, Settings2, PlugZap, ToggleLeft, ToggleRight,
} from "lucide-react";

/* ══════════════════════════ Types ══════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null; ros_version: string;
  ports: string | null; pppoe_mode: string | null; pppoe_interface: string | null;
  pppoe_configured_at: string | null; wan_interface: string | null;
  bridge_interface: string | null; bridge_ip: string | null;
  hotspot_dns_name: string | null; token: string;
}

interface PPPoEConfig {
  mode: "pppoe_only" | "pppoe_over_hotspot";
  // PPPoE Only
  wanInterface: string;
  selectedPorts: string[];
  bridgeName: string;
  bridgeIp: string;
  serviceName: string;
  poolStart: string;
  poolEnd: string;
  localAddress: string;
  dns1: string;
  dns2: string;
  maxMtu: string;
  maxMru: string;
  keepAlive: string;
  // PPPoE over Hotspot shared
  hotspotInterface: string;
  hotspotBridge: string;
  hotspotBridgeIp: string;
  hotspotDnsName: string;
  hotspotPoolStart: string;
  hotspotPoolEnd: string;
  hotspotServiceName: string;
}

/* ══════════════════════════ Consts ══════════════════════════ */
const ETHER_PORTS = ["ether1","ether2","ether3","ether4","ether5","ether6","ether7","ether8","ether9","ether10"];
const SFP_PORTS   = ["sfp1","sfp-sfpplus1"];
const WLAN_PORTS  = ["wlan1","wlan2"];
const ALL_PORTS   = [...ETHER_PORTS, ...SFP_PORTS, ...WLAN_PORTS];

function defaultConfig(router?: DbRouter): PPPoEConfig {
  const savedPorts = router?.ports ? router.ports.split(",").map(s => s.trim()).filter(Boolean) : [];
  return {
    mode: (router?.pppoe_mode as "pppoe_only" | "pppoe_over_hotspot") ?? "pppoe_only",
    wanInterface:       router?.wan_interface      ?? "ether1",
    selectedPorts:      savedPorts.length > 0 ? savedPorts : ["ether2"],
    bridgeName:         router?.bridge_interface   ?? "bridge-pppoe",
    bridgeIp:           router?.bridge_ip          ?? "10.10.0.1",
    serviceName:        "internet",
    poolStart:          "10.10.0.2",
    poolEnd:            "10.10.0.254",
    localAddress:       router?.bridge_ip          ?? "10.10.0.1",
    dns1:               "8.8.8.8",
    dns2:               "1.1.1.1",
    maxMtu:             "1480",
    maxMru:             "1480",
    keepAlive:          "30",
    hotspotInterface:   "ether2",
    hotspotBridge:      router?.bridge_interface   ?? "bridge-hotspot",
    hotspotBridgeIp:    router?.bridge_ip          ?? "192.168.88.1",
    hotspotDnsName:     router?.hotspot_dns_name   ?? "hotspot.local",
    hotspotPoolStart:   "192.168.88.10",
    hotspotPoolEnd:     "192.168.88.200",
    hotspotServiceName: "internet",
  };
}

/* ══════════════════════════ Script generators ══════════════════════════ */
function genPPPoEOnlyScript(router: DbRouter, cfg: PPPoEConfig): string {
  const radiusIp = "YOUR_RADIUS_SERVER_IP"; // replaced with actual server when deployed
  const secret   = router.router_secret ?? "changeme";
  const clientPorts = cfg.selectedPorts.filter(p => p !== cfg.wanInterface);

  return `# ============================================================
# OcholaSupernet — PPPoE Only Configuration Script
# Router : ${router.name} (${router.host})
# Mode   : PPPoE Only
# Generated: ${new Date().toLocaleString("en-KE")}
# RouterOS Version: ${router.ros_version}
# ============================================================
# INSTRUCTIONS: Paste this in Mikrotik Terminal or upload via
#   /system/scripts → run — then /system/reboot if needed.
# ============================================================

# ─── 1. Clean previous PPPoE/bridge config ───────────────────
/interface pppoe-server server remove [find]
/ppp profile remove [find name~"${cfg.serviceName}"]
/ip pool remove [find name~"pppoe"]
/interface bridge remove [find name="${cfg.bridgeName}"]

# ─── 2. WAN interface (uplink to ISP) ────────────────────────
# Ensure ether1 (WAN) has correct address from your ISP
# /ip address add address=YOUR_WAN_IP/PREFIX interface=${cfg.wanInterface}

# ─── 3. Create bridge for PPPoE clients ──────────────────────
/interface bridge add name=${cfg.bridgeName} protocol-mode=none fast-forward=no comment="OcholaSupernet PPPoE bridge"

# ─── 4. Add client-facing ports to bridge ────────────────────
${clientPorts.map(p => `/interface bridge port add bridge=${cfg.bridgeName} interface=${p} comment="${p}"`).join("\n")}

# ─── 5. Assign local IP to bridge (PPPoE gateway) ────────────
/ip address add address=${cfg.localAddress}/24 interface=${cfg.bridgeName}

# ─── 6. IP Pool for PPPoE clients ────────────────────────────
/ip pool add name=pppoe-pool ranges=${cfg.poolStart}-${cfg.poolEnd}

# ─── 7. PPP Profile ──────────────────────────────────────────
/ppp profile add \\
  name=${cfg.serviceName} \\
  local-address=${cfg.localAddress} \\
  use-radius=yes \\
  use-compression=no \\
  use-encryption=no \\
  dns-server=${cfg.dns1},${cfg.dns2} \\
  change-tcp-mss=yes \\
  comment="OcholaSupernet default profile"

# ─── 8. RADIUS Client ────────────────────────────────────────
/radius remove [find service=pppoe]
/radius add \\
  service=pppoe \\
  address=${radiusIp} \\
  secret=${secret} \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3000ms \\
  comment="OcholaSupernet RADIUS"

/radius incoming set accept=yes port=3799

# ─── 9. Enable RADIUS accounting ─────────────────────────────
/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# ─── 10. PPPoE Server ────────────────────────────────────────
/interface pppoe-server server add \\
  service-name=${cfg.serviceName} \\
  interface=${cfg.bridgeName} \\
  default-profile=${cfg.serviceName} \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=${cfg.maxMru} \\
  max-mtu=${cfg.maxMtu} \\
  one-session-per-host=yes \\
  keepalive-timeout=${cfg.keepAlive} \\
  comment="OcholaSupernet PPPoE Server"

# ─── 11. Masquerade (NAT for PPPoE clients) ──────────────────
/ip firewall nat add \\
  chain=srcnat \\
  src-address=${cfg.poolStart.split(".").slice(0,3).join(".")}.0/24 \\
  action=masquerade \\
  out-interface=${cfg.wanInterface} \\
  comment="PPPoE clients masquerade"

# ─── 12. API access for OcholaSupernet ───────────────────────
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="OcholaSupernet API user" disabled=no

# ─── Done ─────────────────────────────────────────────────────
:log info "OcholaSupernet PPPoE Only config applied"
:put "Configuration complete. PPPoE server is running on bridge: ${cfg.bridgeName}"
`;
}

function genPPPoEOverHotspotScript(router: DbRouter, cfg: PPPoEConfig): string {
  const radiusIp = "YOUR_RADIUS_SERVER_IP";
  const secret   = router.router_secret ?? "changeme";
  const cidr     = `${cfg.hotspotBridgeIp}/24`;
  const network  = cfg.hotspotBridgeIp.split(".").slice(0,3).join(".") + ".0";

  return `# ============================================================
# OcholaSupernet — PPPoE over Hotspot Configuration Script
# Router : ${router.name} (${router.host})
# Mode   : PPPoE over Hotspot
# Generated: ${new Date().toLocaleString("en-KE")}
# RouterOS Version: ${router.ros_version}
# ============================================================
# This sets up a Hotspot captive portal AND a PPPoE server
# running on the same bridge — users authenticate via either
# the hotspot portal (prepaid vouchers) or via PPPoE dial-up.
# ============================================================

# ─── 1. Clean existing config ────────────────────────────────
/interface pppoe-server server remove [find]
/ip hotspot remove [find]
/ip pool remove [find name~"hs-pool"]
/ip pool remove [find name~"pppoe-pool"]
/ppp profile remove [find name~"${cfg.hotspotServiceName}"]
/interface bridge remove [find name="${cfg.hotspotBridge}"]

# ─── 2. Create shared bridge ─────────────────────────────────
/interface bridge add name=${cfg.hotspotBridge} protocol-mode=none fast-forward=no comment="OcholaSupernet shared bridge"
/interface bridge port add bridge=${cfg.hotspotBridge} interface=${cfg.hotspotInterface} comment="Client LAN"

# ─── 3. Bridge IP address ────────────────────────────────────
/ip address add address=${cidr} interface=${cfg.hotspotBridge}

# ─── 4. DHCP for hotspot clients ─────────────────────────────
/ip pool add name=hs-pool ranges=${cfg.hotspotPoolStart}-${cfg.hotspotPoolEnd}
/ip dhcp-server add \\
  name=dhcp-hs \\
  interface=${cfg.hotspotBridge} \\
  address-pool=hs-pool \\
  disabled=no \\
  lease-time=10m
/ip dhcp-server network add \\
  address=${network}/24 \\
  gateway=${cfg.hotspotBridgeIp} \\
  dns-server=${cfg.hotspotBridgeIp}

# ─── 5. DNS ──────────────────────────────────────────────────
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# ─── 6. Hotspot setup ────────────────────────────────────────
/ip hotspot profile add \\
  name=hs-profile \\
  dns-name=${cfg.hotspotDnsName} \\
  hotspot-address=${cfg.hotspotBridgeIp} \\
  use-radius=yes \\
  radius-password=${secret} \\
  login-by=http-chap,mac \\
  html-directory=hotspot \\
  mac-auth-mode=mac-as-username \\
  comment="OcholaSupernet hotspot profile"

/ip hotspot add \\
  name=hotspot-${router.name.replace(/\s+/g,"-").toLowerCase()} \\
  interface=${cfg.hotspotBridge} \\
  profile=hs-profile \\
  address-pool=hs-pool \\
  idle-timeout=5m \\
  keepalive-timeout=none \\
  disabled=no

# ─── 7. RADIUS client (shared for hotspot + PPPoE) ───────────
/radius remove [find service=hotspot]
/radius remove [find service=pppoe]
/radius add \\
  service=hotspot \\
  address=${radiusIp} \\
  secret=${secret} \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3000ms

/radius add \\
  service=pppoe \\
  address=${radiusIp} \\
  secret=${secret} \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3000ms

/radius incoming set accept=yes port=3799

# ─── 8. PPPoE IP pool ────────────────────────────────────────
/ip pool add name=pppoe-pool ranges=${cfg.poolStart}-${cfg.poolEnd}

# ─── 9. PPP Profile ──────────────────────────────────────────
/ppp profile add \\
  name=${cfg.hotspotServiceName} \\
  local-address=${cfg.hotspotBridgeIp} \\
  remote-address=pppoe-pool \\
  dns-server=8.8.8.8,1.1.1.1 \\
  use-radius=yes \\
  use-compression=no \\
  change-tcp-mss=yes

/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# ─── 10. PPPoE Server on bridge ──────────────────────────────
/interface pppoe-server server add \\
  service-name=${cfg.hotspotServiceName} \\
  interface=${cfg.hotspotBridge} \\
  default-profile=${cfg.hotspotServiceName} \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=${cfg.maxMru} \\
  max-mtu=${cfg.maxMtu} \\
  one-session-per-host=yes \\
  comment="OcholaSupernet PPPoE-over-Hotspot"

# ─── 11. NAT masquerade ──────────────────────────────────────
/ip firewall nat add \\
  chain=srcnat src-address=${network}/24 \\
  action=masquerade out-interface=ether1 \\
  comment="PPPoE/Hotspot clients masquerade"

# ─── 12. API access for OcholaSupernet ───────────────────────
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="OcholaSupernet API user" disabled=no

# ─── Done ─────────────────────────────────────────────────────
:log info "OcholaSupernet PPPoE-over-Hotspot config applied"
:put "Done. Hotspot DNS: ${cfg.hotspotDnsName} | PPPoE server on ${cfg.hotspotBridge}"
`;
}

/* ══════════════════════════ UI helpers ══════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8,
  padding: "0.55rem 0.875rem", color: "var(--isp-text)", fontSize: "0.8125rem",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const sel: React.CSSProperties = { ...inp };

function Field({ label, children, hint, span }: { label: string; children: React.ReactNode; hint?: string; span?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.325rem", gridColumn: span ? "1 / -1" : undefined }}>
      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "0.65rem", color: "var(--isp-text-sub)", lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", marginBottom: "0.25rem" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid rgba(6,182,212,0.15)", paddingBottom: "0.35rem" }}>{title}</div>
      {subtitle && <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>{subtitle}</div>}
    </div>
  );
}

/* ── Port toggle button ── */
function PortBtn({ label, active, isWan, disabled, onClick }: { label: string; active: boolean; isWan: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} title={isWan ? "WAN port (reserved)" : label}
      style={{
        padding: "0.5rem 0.375rem", borderRadius: 8, fontFamily: "inherit", fontWeight: 700,
        fontSize: "0.68rem", cursor: disabled ? "not-allowed" : "pointer", textAlign: "center",
        border: isWan ? "1.5px solid #f59e0b" : active ? "1.5px solid #22d3ee" : "1.5px solid var(--isp-border)",
        background: isWan ? "rgba(245,158,11,0.08)" : active ? "rgba(34,211,238,0.1)" : "rgba(255,255,255,0.02)",
        color: isWan ? "#f59e0b" : active ? "#22d3ee" : "var(--isp-text-sub)",
        transition: "all 0.14s", minWidth: 60,
      }}>
      <div style={{ fontSize: "0.9rem", marginBottom: "0.15rem" }}>{isWan ? "🌐" : active ? "🔵" : "⚫"}</div>
      {label}
      {isWan && <div style={{ fontSize: "0.55rem", marginTop: "0.1rem", opacity: 0.8 }}>WAN</div>}
      {!isWan && active && <div style={{ fontSize: "0.55rem", marginTop: "0.1rem", color: "#22d3ee" }}>CLIENT</div>}
    </button>
  );
}

/* ── Script display ── */
function ScriptBlock({ code, title }: { code: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const copyScript = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  const downloadScript = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${title.toLowerCase().replace(/\s+/g,"-")}.rsc`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ border: "1px solid var(--isp-border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", background: "rgba(6,182,212,0.05)", borderBottom: expanded ? "1px solid var(--isp-border-subtle)" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <FileCode2 size={15} style={{ color: "#22d3ee" }} />
          <span style={{ fontWeight: 700, fontSize: "0.8125rem", color: "var(--isp-text)" }}>{title}</span>
          <span style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
            {code.split("\n").length} lines
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={copyScript} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.35rem 0.75rem", borderRadius: 7, background: copied ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "rgba(74,222,128,0.3)" : "var(--isp-border)"}`, color: copied ? "#4ade80" : "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={downloadScript} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.35rem 0.75rem", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
            <Download size={12} /> .rsc
          </button>
          <button onClick={() => setExpanded(e => !e)} style={{ display: "flex", alignItems: "center", padding: "0.35rem 0.5rem", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <pre style={{ margin: 0, padding: "1rem 1.25rem", background: "#0a0f14", fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.7, color: "#e2e8f0", whiteSpace: "pre" }}>
            {code.split("\n").map((line, i) => {
              let color = "#e2e8f0";
              if (line.trim().startsWith("#")) color = "#64748b";
              else if (line.trim().startsWith("/")) color = "#22d3ee";
              else if (line.includes(":=") || line.includes("=")) {
                const [k, v] = line.split(/(?:=|\s+)(.+)/);
                return (
                  <span key={i} style={{ display: "block" }}>
                    <span style={{ color: "#94a3b8" }}>{k}</span>
                    <span style={{ color: "#e2e8f0" }}>=</span>
                    <span style={{ color: "#a78bfa" }}>{v}</span>
                  </span>
                );
              }
              return <span key={i} style={{ display: "block", color }}>{line}</span>;
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
export default function PPPoE() {
  const qc = useQueryClient();
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [cfg, setCfg] = useState<PPPoEConfig>(defaultConfig());
  const [script, setScript] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["isp_routers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  // Auto-select first router
  useEffect(() => {
    if (routers.length > 0 && selectedRouterId === null) {
      const first = routers[0];
      setSelectedRouterId(first.id);
      setCfg(defaultConfig(first));
    }
  }, [routers, selectedRouterId]);

  const router = useMemo(() => routers.find(r => r.id === selectedRouterId) ?? null, [routers, selectedRouterId]);

  const handleRouterChange = (id: number) => {
    setSelectedRouterId(id);
    const r = routers.find(x => x.id === id);
    if (r) setCfg(defaultConfig(r));
    setScript("");
  };

  const set = (k: keyof PPPoEConfig, v: string | string[]) =>
    setCfg(f => ({ ...f, [k]: v }));

  const togglePort = (port: string) => {
    if (port === cfg.wanInterface) return; // can't select WAN as client port
    const already = cfg.selectedPorts.includes(port);
    set("selectedPorts", already ? cfg.selectedPorts.filter(p => p !== port) : [...cfg.selectedPorts, port]);
  };

  const generateScript = () => {
    if (!router) return;
    const s = cfg.mode === "pppoe_only"
      ? genPPPoEOnlyScript(router, cfg)
      : genPPPoEOverHotspotScript(router, cfg);
    setScript(s);
  };

  const saveConfig = async () => {
    if (!router) return;
    setSaving(true);
    const { error } = await supabase.from("isp_routers").update({
      pppoe_mode:       cfg.mode,
      pppoe_interface:  cfg.mode === "pppoe_only" ? cfg.bridgeName : cfg.hotspotBridge,
      ports:            cfg.selectedPorts.join(","),
      bridge_interface: cfg.mode === "pppoe_only" ? cfg.bridgeName : cfg.hotspotBridge,
      bridge_ip:        cfg.mode === "pppoe_only" ? cfg.bridgeIp   : cfg.hotspotBridgeIp,
      wan_interface:    cfg.wanInterface,
      hotspot_dns_name: cfg.hotspotDnsName,
      pppoe_configured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", router.id);
    setSaving(false);
    if (error) showToast(`Save failed: ${error.message}`, false);
    else { showToast("Configuration saved"); qc.invalidateQueries({ queryKey: ["isp_routers"] }); }
  };

  const scriptTitle = cfg.mode === "pppoe_only"
    ? `PPPoE-Only — ${router?.name ?? "Router"}.rsc`
    : `PPPoE-over-Hotspot — ${router?.name ?? "Router"}.rsc`;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes slideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {toast && (
        <div style={{ position: "fixed", top: 20, right: 24, zIndex: 2000, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderRadius: 10, background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${toast.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`, color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.875rem", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "slideIn 0.2s ease" }}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — PPPoE Sign In</h1>
        <NetworkTabs active="pppoe" />

        {/* ─── Router picker ─── */}
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flex: "1 1 260px" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>ROUTER</label>
            <select value={selectedRouterId ?? ""} onChange={e => handleRouterChange(Number(e.target.value))}
              style={{ ...sel, flex: 1 }} disabled={loadingRouters}>
              {routers.map(r => (
                <option key={r.id} value={r.id}>{r.name} — {r.host} {r.status === "online" ? "🟢" : "🔴"}</option>
              ))}
            </select>
          </div>
          {router && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
              <span style={{ fontFamily: "monospace", color: "#22d3ee" }}>{router.host}</span>
              <span>·</span>
              <span>ROS {router.ros_version}</span>
              {router.pppoe_configured_at && (
                <><span>·</span><span style={{ color: "#4ade80" }}>Configured {new Date(router.pppoe_configured_at).toLocaleDateString("en-KE")}</span></>
              )}
            </div>
          )}
        </div>

        {/* ─── Mode Selector ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
          {([
            { mode: "pppoe_only" as const, icon: <PlugZap size={20} />, title: "PPPoE Only", desc: "Pure PPPoE server for DSL, fibre or dedicated links. Admin assigns specific ethernet ports for client connections." },
            { mode: "pppoe_over_hotspot" as const, icon: <Wifi size={20} />, title: "PPPoE over Hotspot", desc: "PPPoE server running alongside a MikroTik Hotspot on the same bridge. Supports both prepaid vouchers and PPPoE dial-up." },
          ]).map(({ mode, icon, title, desc }) => {
            const active = cfg.mode === mode;
            return (
              <button key={mode} onClick={() => { set("mode", mode); setScript(""); }}
                style={{ padding: "1.125rem", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", border: active ? "2px solid #22d3ee" : "1.5px solid var(--isp-border)", background: active ? "rgba(6,182,212,0.07)" : "rgba(255,255,255,0.02)", textAlign: "left", transition: "all 0.14s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.5rem" }}>
                  <span style={{ color: active ? "#22d3ee" : "var(--isp-text-sub)" }}>{icon}</span>
                  <span style={{ fontWeight: 800, fontSize: "0.9rem", color: active ? "var(--isp-text)" : "var(--isp-text-muted)" }}>{title}</span>
                  {active && <span style={{ marginLeft: "auto", fontSize: "0.65rem", fontWeight: 700, color: "#22d3ee", background: "rgba(6,182,212,0.12)", padding: "0.15rem 0.5rem", borderRadius: 20 }}>SELECTED</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>{desc}</div>
              </button>
            );
          })}
        </div>

        {/* ═══════════ PPPoE ONLY CONFIG ═══════════ */}
        {cfg.mode === "pppoe_only" && router && (
          <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

            {/* Port assignment */}
            <div>
              <SectionHead title="Port Assignment" subtitle="Select which physical ports clients will plug into. The WAN port is reserved for uplink." />
              <div style={{ marginTop: "0.875rem" }}>
                <div style={{ marginBottom: "0.625rem" }}>
                  <Field label="WAN (Uplink) Port">
                    <select style={{ ...sel, maxWidth: 200 }} value={cfg.wanInterface}
                      onChange={e => { set("wanInterface", e.target.value); set("selectedPorts", cfg.selectedPorts.filter(p => p !== e.target.value)); }}>
                      {ALL_PORTS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>
                </div>

                <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: "0.5rem" }}>CLIENT PORTS — click to toggle</div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {ETHER_PORTS.map(p => (
                    <PortBtn key={p} label={p} active={cfg.selectedPorts.includes(p)} isWan={p === cfg.wanInterface} disabled={p === cfg.wanInterface} onClick={() => togglePort(p)} />
                  ))}
                  {SFP_PORTS.map(p => (
                    <PortBtn key={p} label={p} active={cfg.selectedPorts.includes(p)} isWan={p === cfg.wanInterface} disabled={p === cfg.wanInterface} onClick={() => togglePort(p)} />
                  ))}
                  {WLAN_PORTS.map(p => (
                    <PortBtn key={p} label={p} active={cfg.selectedPorts.includes(p)} isWan={p === cfg.wanInterface} disabled={p === cfg.wanInterface} onClick={() => togglePort(p)} />
                  ))}
                </div>

                {cfg.selectedPorts.length > 0 && (
                  <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.875rem", background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 8, fontSize: "0.75rem" }}>
                    <span style={{ color: "var(--isp-text-muted)" }}>Client ports: </span>
                    <span style={{ fontFamily: "monospace", color: "#22d3ee", fontWeight: 700 }}>
                      {cfg.selectedPorts.filter(p => p !== cfg.wanInterface).join(", ") || "—"}
                    </span>
                    {" "}
                    <span style={{ color: "var(--isp-text-muted)" }}>→ added to bridge </span>
                    <span style={{ fontFamily: "monospace", color: "#22d3ee" }}>{cfg.bridgeName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bridge settings */}
            <div>
              <SectionHead title="Bridge Settings" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem", marginTop: "0.75rem" }}>
                <Field label="Bridge Name" hint="Created automatically on the router">
                  <input style={inp} value={cfg.bridgeName} onChange={e => set("bridgeName", e.target.value)} placeholder="bridge-pppoe" />
                </Field>
                <Field label="Bridge / Gateway IP" hint="IP the router assigns itself as PPPoE gateway">
                  <input style={inp} value={cfg.bridgeIp} onChange={e => { set("bridgeIp", e.target.value); set("localAddress", e.target.value); }} placeholder="10.10.0.1" />
                </Field>
              </div>
            </div>

            {/* PPPoE server */}
            <div>
              <SectionHead title="PPPoE Server" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginTop: "0.75rem" }}>
                <Field label="Service Name">
                  <input style={inp} value={cfg.serviceName} onChange={e => set("serviceName", e.target.value)} placeholder="internet" />
                </Field>
                <Field label="Max MTU">
                  <input style={inp} value={cfg.maxMtu} onChange={e => set("maxMtu", e.target.value)} placeholder="1480" />
                </Field>
                <Field label="Max MRU">
                  <input style={inp} value={cfg.maxMru} onChange={e => set("maxMru", e.target.value)} placeholder="1480" />
                </Field>
                <Field label="Client Pool Start">
                  <input style={inp} value={cfg.poolStart} onChange={e => set("poolStart", e.target.value)} placeholder="10.10.0.2" />
                </Field>
                <Field label="Client Pool End">
                  <input style={inp} value={cfg.poolEnd} onChange={e => set("poolEnd", e.target.value)} placeholder="10.10.0.254" />
                </Field>
                <Field label="Keepalive (sec)">
                  <input style={inp} value={cfg.keepAlive} onChange={e => set("keepAlive", e.target.value)} placeholder="30" />
                </Field>
                <Field label="DNS Primary">
                  <input style={inp} value={cfg.dns1} onChange={e => set("dns1", e.target.value)} placeholder="8.8.8.8" />
                </Field>
                <Field label="DNS Secondary">
                  <input style={inp} value={cfg.dns2} onChange={e => set("dns2", e.target.value)} placeholder="1.1.1.1" />
                </Field>
              </div>
            </div>

            {/* RADIUS info */}
            <div style={{ background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 10, padding: "0.875rem 1rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>RADIUS (auto-configured)</div>
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                {[
                  ["Router API User", router.router_username],
                  ["RADIUS Secret", router.router_secret ? "••••••••" : "—"],
                  ["Auth Port", "1812"],
                  ["Acct Port", "1813"],
                  ["CoA Port", "3799"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: "0.62rem", color: "#a78bfa", fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ PPPoE OVER HOTSPOT CONFIG ═══════════ */}
        {cfg.mode === "pppoe_over_hotspot" && router && (
          <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

            {/* Hotspot bridge */}
            <div>
              <SectionHead title="Hotspot Bridge" subtitle="Shared bridge used by both hotspot clients and PPPoE dial-up users." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginTop: "0.75rem" }}>
                <Field label="LAN Interface" hint="Ethernet port facing clients">
                  <select style={sel} value={cfg.hotspotInterface} onChange={e => set("hotspotInterface", e.target.value)}>
                    {ALL_PORTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Bridge Name">
                  <input style={inp} value={cfg.hotspotBridge} onChange={e => set("hotspotBridge", e.target.value)} placeholder="bridge-hotspot" />
                </Field>
                <Field label="Bridge IP / Hotspot Address">
                  <input style={inp} value={cfg.hotspotBridgeIp} onChange={e => set("hotspotBridgeIp", e.target.value)} placeholder="192.168.88.1" />
                </Field>
              </div>
            </div>

            {/* Hotspot settings */}
            <div>
              <SectionHead title="Hotspot Settings" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginTop: "0.75rem" }}>
                <Field label="DNS Name" hint="Shown in browser when client connects">
                  <input style={inp} value={cfg.hotspotDnsName} onChange={e => set("hotspotDnsName", e.target.value)} placeholder="hotspot.local" />
                </Field>
                <Field label="DHCP Pool Start">
                  <input style={inp} value={cfg.hotspotPoolStart} onChange={e => set("hotspotPoolStart", e.target.value)} placeholder="192.168.88.10" />
                </Field>
                <Field label="DHCP Pool End">
                  <input style={inp} value={cfg.hotspotPoolEnd} onChange={e => set("hotspotPoolEnd", e.target.value)} placeholder="192.168.88.200" />
                </Field>
              </div>
            </div>

            {/* PPPoE on top */}
            <div>
              <SectionHead title="PPPoE Server (on Hotspot bridge)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginTop: "0.75rem" }}>
                <Field label="Service Name">
                  <input style={inp} value={cfg.hotspotServiceName} onChange={e => set("hotspotServiceName", e.target.value)} placeholder="internet" />
                </Field>
                <Field label="PPPoE Pool Start" hint="Separate pool from DHCP">
                  <input style={inp} value={cfg.poolStart} onChange={e => set("poolStart", e.target.value)} placeholder="10.10.0.2" />
                </Field>
                <Field label="PPPoE Pool End">
                  <input style={inp} value={cfg.poolEnd} onChange={e => set("poolEnd", e.target.value)} placeholder="10.10.0.100" />
                </Field>
                <Field label="Max MTU">
                  <input style={inp} value={cfg.maxMtu} onChange={e => set("maxMtu", e.target.value)} placeholder="1480" />
                </Field>
                <Field label="Max MRU">
                  <input style={inp} value={cfg.maxMru} onChange={e => set("maxMru", e.target.value)} placeholder="1480" />
                </Field>
              </div>
            </div>

            {/* RADIUS info */}
            <div style={{ background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 10, padding: "0.875rem 1rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>RADIUS (shared for Hotspot + PPPoE)</div>
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                {[
                  ["Services", "hotspot + pppoe"],
                  ["Auth Port", "1812"],
                  ["Acct Port", "1813"],
                  ["CoA / DM Port", "3799"],
                  ["Secret", router.router_secret ? "configured" : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: "0.62rem", color: "#a78bfa", fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)", fontFamily: "monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Action buttons ─── */}
        {router && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button onClick={saveConfig} disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1.25rem", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 700, fontSize: "0.8125rem", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
              Save Config to Router
            </button>
            <button onClick={generateScript}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1.5rem", borderRadius: 10, background: "linear-gradient(135deg,#06b6d4,#0284c7)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(6,182,212,0.3)" }}>
              <FileCode2 size={14} /> Generate RouterOS Script
            </button>
          </div>
        )}

        {/* ─── Script output ─── */}
        {script && <ScriptBlock code={script} title={scriptTitle} />}

        {/* ─── How to apply ─── */}
        {script && (
          <div style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)", borderRadius: 12, padding: "1.125rem 1.25rem" }}>
            <div style={{ fontWeight: 700, color: "#22d3ee", fontSize: "0.8rem", marginBottom: "0.625rem" }}>How to apply this script to your MikroTik</div>
            <ol style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {[
                "Open Winbox and connect to your router",
                "Go to System → Scripts → Add new script",
                "Paste the script content and click Run, OR",
                "Open Terminal and paste the script directly",
                "Alternatively: drag and drop the .rsc file onto the Files section, then run /import filename.rsc",
              ].map((step, i) => (
                <li key={i} style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>{step}</li>
              ))}
            </ol>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
