import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Shield, Wifi, Copy, Download, CheckCircle2,
  Loader2, FileCode2, ChevronDown, ChevronUp, Zap,
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

type Mode = "pppoe_only" | "pppoe_over_hotspot";

/* ══════════════════════════ Script generators ══════════════════════════ */
function genPPPoEOnlyScript(router: DbRouter, companyName: string): string {
  const secret = router.router_secret ?? "changeme";
  return `# ============================================================
# ${companyName} — PPPoE Only Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# ============================================================

# 1. Clean previous config
/interface pppoe-server server remove [find]
/ppp profile remove [find name~"internet"]
/ip pool remove [find name~"pppoe"]
/interface bridge remove [find name="bridge-pppoe"]

# 2. Create bridge for PPPoE clients
/interface bridge add name=bridge-pppoe protocol-mode=none fast-forward=no comment="${companyName} PPPoE bridge"
/interface bridge port add bridge=bridge-pppoe interface=ether2 comment="ether2"
/interface bridge port add bridge=bridge-pppoe interface=ether3 comment="ether3"

# 3. Assign gateway IP to bridge
/ip address add address=10.10.0.1/24 interface=bridge-pppoe

# 4. IP Pool for PPPoE clients
/ip pool add name=pppoe-pool ranges=10.10.0.2-10.10.0.254

# 5. PPP Profile
/ppp profile add \\
  name=internet \\
  local-address=10.10.0.1 \\
  remote-address=pppoe-pool \\
  use-radius=yes \\
  dns-server=8.8.8.8,1.1.1.1 \\
  change-tcp-mss=yes \\
  comment="${companyName} profile"

# 6. RADIUS Client
/radius remove [find service=pppoe]
/radius add \\
  service=pppoe \\
  address=YOUR_RADIUS_IP \\
  secret=${secret} \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3000ms

/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# 7. PPPoE Server
/interface pppoe-server server add \\
  service-name=internet \\
  interface=bridge-pppoe \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 \\
  max-mtu=1480 \\
  one-session-per-host=yes \\
  keepalive-timeout=30 \\
  comment="${companyName} PPPoE Server"

# 8. NAT masquerade
/ip firewall nat add \\
  chain=srcnat src-address=10.10.0.0/24 \\
  action=masquerade out-interface=ether1 \\
  comment="PPPoE clients masquerade"

# 9. API access
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE Only config applied"
:put "Done. PPPoE server running on bridge-pppoe."
`;
}

function genPPPoEOverHotspotScript(router: DbRouter, companyName: string): string {
  const secret = router.router_secret ?? "changeme";
  return `# ============================================================
# ${companyName} — PPPoE over Hotspot Configuration
# Router : ${router.name} (${router.host})
# Generated: ${new Date().toLocaleString("en-KE")}
# ============================================================

# 1. Clean existing config
/interface pppoe-server server remove [find]
/ip hotspot remove [find]
/ip pool remove [find name~"hs-pool"]
/ip pool remove [find name~"pppoe-pool"]
/ppp profile remove [find name~"internet"]
/interface bridge remove [find name="bridge-shared"]

# 2. Create shared bridge
/interface bridge add name=bridge-shared protocol-mode=none fast-forward=no comment="${companyName} shared bridge"
/interface bridge port add bridge=bridge-shared interface=ether2 comment="Client LAN"

# 3. Bridge IP
/ip address add address=192.168.88.1/24 interface=bridge-shared

# 4. DHCP for hotspot clients
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.200
/ip dhcp-server add name=dhcp-hs interface=bridge-shared address-pool=hs-pool disabled=no lease-time=10m
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1

# 5. DNS
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# 6. Hotspot
/ip hotspot profile add \\
  name=hs-profile \\
  dns-name=hotspot.local \\
  hotspot-address=192.168.88.1 \\
  use-radius=yes \\
  login-by=http-chap,mac \\
  mac-auth-mode=mac-as-username \\
  comment="${companyName} hotspot profile"

/ip hotspot add \\
  name=hotspot1 \\
  interface=bridge-shared \\
  profile=hs-profile \\
  address-pool=hs-pool \\
  idle-timeout=5m \\
  disabled=no

# 7. RADIUS (hotspot + PPPoE)
/radius remove [find service=hotspot]
/radius remove [find service=pppoe]
/radius add service=hotspot address=YOUR_RADIUS_IP secret=${secret} authentication-port=1812 accounting-port=1813 timeout=3000ms
/radius add service=pppoe  address=YOUR_RADIUS_IP secret=${secret} authentication-port=1812 accounting-port=1813 timeout=3000ms
/radius incoming set accept=yes port=3799

# 8. PPPoE pool + profile
/ip pool add name=pppoe-pool ranges=10.10.0.2-10.10.0.254
/ppp profile add \\
  name=internet \\
  local-address=192.168.88.1 \\
  remote-address=pppoe-pool \\
  dns-server=8.8.8.8,1.1.1.1 \\
  use-radius=yes \\
  use-compression=no \\
  change-tcp-mss=yes

/ppp aaa set use-radius=yes accounting=yes interim-update=1m

# 9. PPPoE server on shared bridge
/interface pppoe-server server add \\
  service-name=internet \\
  interface=bridge-shared \\
  default-profile=internet \\
  authentication=pap,chap,mschap1,mschap2 \\
  enabled=yes \\
  max-mru=1480 max-mtu=1480 \\
  one-session-per-host=yes \\
  comment="${companyName} PPPoE-over-Hotspot"

# 10. NAT masquerade
/ip firewall nat add \\
  chain=srcnat src-address=192.168.88.0/24 \\
  action=masquerade out-interface=ether1 \\
  comment="PPPoE/Hotspot masquerade"

# 11. API access
/ip service set api address=0.0.0.0/0 disabled=no
/user add name=${router.router_username} password=${secret} group=full \\
  comment="${companyName} API user" disabled=no

:log info "${companyName} PPPoE-over-Hotspot config applied"
:put "Done. Hotspot: hotspot.local | PPPoE server on bridge-shared."
`;
}

/* ══════════════════════════ Script block ══════════════════════════ */
function ScriptBlock({ code, filename }: { code: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });
  };
  const download = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ border: "1px solid rgba(6,182,212,0.25)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1rem",
        background: "rgba(6,182,212,0.06)",
        borderBottom: expanded ? "1px solid rgba(6,182,212,0.15)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <FileCode2 size={14} style={{ color: "#22d3ee" }} />
          <span style={{ fontWeight: 700, fontSize: "0.8125rem", color: "var(--isp-text)", fontFamily: "monospace" }}>
            {filename}
          </span>
          <span style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)" }}>
            {code.split("\n").length} lines
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={copy} style={{
            display: "flex", alignItems: "center", gap: "0.35rem",
            padding: "0.35rem 0.875rem", borderRadius: 7,
            background: copied ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${copied ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.12)"}`,
            color: copied ? "#4ade80" : "var(--isp-text-muted)",
            fontWeight: 600, fontSize: "0.75rem", cursor: "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}>
            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={download} style={{
            display: "flex", alignItems: "center", gap: "0.35rem",
            padding: "0.35rem 0.875rem", borderRadius: 7,
            background: "linear-gradient(135deg,#06b6d4,#0284c7)",
            border: "none", color: "white",
            fontWeight: 700, fontSize: "0.75rem", cursor: "pointer",
            fontFamily: "inherit",
          }}>
            <Download size={12} /> Download .rsc
          </button>
          <button onClick={() => setExpanded(e => !e)} style={{
            display: "flex", alignItems: "center", padding: "0.35rem 0.5rem",
            borderRadius: 7, background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--isp-text-muted)", cursor: "pointer",
          }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <pre style={{
            margin: 0, padding: "1rem 1.25rem",
            background: "#070b10",
            fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.75,
            color: "#e2e8f0", whiteSpace: "pre",
          }}>
            {code.split("\n").map((line, i) => {
              let color = "#e2e8f0";
              if (line.trim().startsWith("#")) color = "#4b5563";
              else if (line.trim().startsWith("/")) color = "#22d3ee";
              else if (line.includes("=")) color = "#a5f3fc";
              return <span key={i} style={{ display: "block", color }}>{line || " "}</span>;
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
export default function PPPoE() {
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("pppoe_only");
  const [script, setScript] = useState("");

  const { data: adminInfo } = useQuery({
    queryKey: ["admin_info", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("name").eq("id", ADMIN_ID).single();
      return data as { name: string } | null;
    },
  });
  const companyName = adminInfo?.name ?? "ISP";

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["isp_routers_pppoe", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  useEffect(() => {
    if (routers.length > 0 && selectedRouterId === null) {
      setSelectedRouterId(routers[0].id);
    }
  }, [routers, selectedRouterId]);

  const router = useMemo(() => routers.find(r => r.id === selectedRouterId) ?? null, [routers, selectedRouterId]);

  const handleGenerate = () => {
    if (!router) return;
    const code = mode === "pppoe_only"
      ? genPPPoEOnlyScript(router, companyName)
      : genPPPoEOverHotspotScript(router, companyName);
    setScript(code);

    /* Also trigger immediate download */
    const filename = mode === "pppoe_only"
      ? `pppoe-only-${router.name}.rsc`
      : `pppoe-hotspot-${router.name}.rsc`;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const filename = router
    ? (mode === "pppoe_only" ? `pppoe-only-${router.name}.rsc` : `pppoe-hotspot-${router.name}.rsc`)
    : "script.rsc";

  const MODES: { id: Mode; label: string; sub: string; icon: React.ReactNode; color: string; border: string }[] = [
    {
      id: "pppoe_only",
      label: "PPPoE Only",
      sub: "Pure PPPoE dial-up. Clients authenticate via username & password. Best for fiber/cable subscribers.",
      icon: <Shield size={22} style={{ color: "#06b6d4" }} />,
      color: "rgba(6,182,212,0.08)",
      border: "rgba(6,182,212,0.35)",
    },
    {
      id: "pppoe_over_hotspot",
      label: "PPPoE over Hotspot",
      sub: "Combines a hotspot captive portal with a PPPoE server on the same bridge. Supports both auth methods simultaneously.",
      icon: <Wifi size={22} style={{ color: "#a78bfa" }} />,
      color: "rgba(139,92,246,0.08)",
      border: "rgba(139,92,246,0.35)",
    },
  ];

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
          PPPoE Configuration
        </h1>

        <NetworkTabs active="pppoe" />

        {/* ── Compact generator card ── */}
        <div style={{
          maxWidth: 720,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          borderRadius: 14, overflow: "hidden",
        }}>

          {/* Router selector row */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.875rem",
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
              Router
            </span>
            <select
              value={selectedRouterId ?? ""}
              onChange={e => { setSelectedRouterId(Number(e.target.value)); setScript(""); }}
              disabled={loadingRouters}
              style={{
                flex: 1, background: "var(--isp-inner-card)",
                border: "1px solid var(--isp-border)", borderRadius: 8,
                padding: "0.45rem 0.75rem", color: "var(--isp-text)",
                fontSize: "0.8125rem", fontFamily: "inherit", outline: "none",
                cursor: "pointer",
              }}
            >
              {loadingRouters && <option>Loading…</option>}
              {routers.length === 0 && !loadingRouters && <option>No routers found</option>}
              {routers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.host || "no IP"} {r.status === "online" ? "🟢" : "🔴"}
                </option>
              ))}
            </select>
            {router && (
              <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                ROS {router.ros_version || "—"}
              </span>
            )}
          </div>

          {/* Mode selection */}
          <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Select type
            </span>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {MODES.map(m => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setMode(m.id); setScript(""); }}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start",
                      gap: "0.5rem", padding: "1rem 1.125rem",
                      background: active ? m.color : "var(--isp-inner-card)",
                      border: `${active ? "2px" : "1px"} solid ${active ? m.border : "var(--isp-border)"}`,
                      borderRadius: 10, cursor: "pointer", textAlign: "left",
                      fontFamily: "inherit", transition: "all 0.15s",
                      boxShadow: active ? `0 0 0 3px ${m.color}` : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                      {m.icon}
                      <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--isp-text)" }}>
                        {m.label}
                      </span>
                      {active && (
                        <span style={{
                          marginLeft: "auto", fontSize: "0.65rem", fontWeight: 700,
                          color: mode === "pppoe_only" ? "#06b6d4" : "#a78bfa",
                          background: mode === "pppoe_only" ? "rgba(6,182,212,0.12)" : "rgba(139,92,246,0.12)",
                          border: `1px solid ${mode === "pppoe_only" ? "rgba(6,182,212,0.3)" : "rgba(139,92,246,0.3)"}`,
                          borderRadius: 4, padding: "0.1rem 0.45rem",
                        }}>Selected</span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.55 }}>
                      {m.sub}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!router}
              style={{
                marginTop: "0.25rem",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                padding: "0.7rem 1.5rem", borderRadius: 9,
                background: router ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.06)",
                border: "none",
                color: router ? "white" : "var(--isp-text-muted)",
                fontWeight: 700, fontSize: "0.9rem",
                cursor: router ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                boxShadow: router ? "0 4px 18px rgba(6,182,212,0.35)" : "none",
                transition: "all 0.2s",
              }}
            >
              {router
                ? <><Zap size={15} /> Generate &amp; Download Script</>
                : <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Select a router first</>
              }
            </button>

            {!router && !loadingRouters && routers.length === 0 && (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#f87171", textAlign: "center" }}>
                No routers found.{" "}
                <a href="/admin/network/add-router" style={{ color: "#06b6d4", fontWeight: 600 }}>Add a router first →</a>
              </p>
            )}
          </div>
        </div>

        {/* ── Generated script viewer ── */}
        {script && (
          <div style={{ maxWidth: 720, animation: "fadeIn 0.2s ease" }}>
            <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            <div style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              marginBottom: "0.625rem", fontSize: "0.8rem",
              color: "#4ade80",
            }}>
              <CheckCircle2 size={14} />
              <span style={{ fontWeight: 600 }}>Script generated — file downloaded automatically.</span>
              <span style={{ color: "var(--isp-text-muted)" }}>You can also copy or re-download below.</span>
            </div>
            <ScriptBlock code={script} filename={filename} />
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
