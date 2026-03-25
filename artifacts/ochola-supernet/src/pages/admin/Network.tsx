import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Server, Wifi, Activity, Terminal, Shield, Plus,
  Copy, Check, Download, ChevronRight, Router, Settings2,
  MonitorSmartphone, QrCode, ClipboardList, RefreshCw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/* ─── Self Install Script Generator ─── */
function generateScript(cfg: {
  hotspotIp: string;
  dnsName: string;
  radiusIp: string;
  radiusSecret: string;
  bridgeInterface: string;
  poolStart: string;
  poolEnd: string;
  profileName: string;
}) {
  return `/ip hotspot profile
add name=${cfg.profileName} \\
  hotspot-address=${cfg.hotspotIp} \\
  dns-name=${cfg.dnsName} \\
  login-by=http-chap,http-pap \\
  use-radius=yes

/ip pool
add name=hspool ranges=${cfg.poolStart}-${cfg.poolEnd}

/ip hotspot
add name=hotspot1 \\
  interface=${cfg.bridgeInterface} \\
  profile=${cfg.profileName} \\
  address-pool=hspool \\
  idle-timeout=none

/radius
add service=hotspot \\
  address=${cfg.radiusIp} \\
  secret=${cfg.radiusSecret} \\
  authentication-port=1812 \\
  accounting-port=1813

/ip hotspot user profile
add name=default shared-users=1 rate-limit="" keepalive-timeout=2m idle-timeout=none

/ip firewall nat
add chain=dstnat protocol=tcp dst-port=80 \\
  action=redirect to-ports=64872 \\
  hotspot=!auth comment="Hotspot redirect"

/system identity set name=OcholaNet-HotspotRouter`.trim();
}

/* ─── Recent Installations ─── */
const RECENT_INSTALLS = [
  { customer: "John Kamau",    router: "latty1",  ip: "192.168.10.1",  time: "Today, 09:14",    status: "success"  },
  { customer: "Mary Wanjiku",  router: "latty2",  ip: "192.168.20.1",  time: "Today, 07:52",    status: "success"  },
  { customer: "Peter Otieno",  router: "latty1",  ip: "192.168.10.5",  time: "Yesterday, 18:30", status: "failed"   },
  { customer: "Grace Muthoni", router: "latty2",  ip: "192.168.20.8",  time: "Yesterday, 14:05", status: "success"  },
  { customer: "David Njoroge", router: "latty1",  ip: "192.168.10.12", time: "Mar 23, 11:22",   status: "pending"  },
];

/* ─── Installation Steps ─── */
const STEPS = [
  { n: 1, title: "Open MikroTik Winbox or WebFig", desc: "Connect to the router via Winbox (recommended) or through its web interface. Use the default admin credentials if this is a new device." },
  { n: 2, title: "Open the Terminal", desc: "In Winbox, click New Terminal. In WebFig, navigate to the Terminal tab. This is where you will paste the generated script." },
  { n: 3, title: "Paste & Run the Script", desc: "Copy the script from the left panel using the Copy button, then paste it into the terminal and press Enter. The script runs all commands sequentially." },
  { n: 4, title: "Verify Hotspot is Active", desc: "After the script completes, go to IP → Hotspot and confirm the hotspot interface is listed as 'Running'. Test with a device on the network." },
  { n: 5, title: "Test Authentication", desc: "Connect a test device to the hotspot SSID. You should be redirected to the login portal at the configured DNS name. Log in with a test voucher." },
];

function SelfInstallTab() {
  const [cfg, setCfg] = useState({
    hotspotIp: "192.168.1.1",
    dnsName: "hotspot.isplatty.org",
    radiusIp: "10.0.0.1",
    radiusSecret: "supersecret",
    bridgeInterface: "bridge1",
    poolStart: "192.168.2.2",
    poolEnd: "192.168.2.254",
    profileName: "hsprof1",
    routerTarget: "latty1",
  });
  const [copied, setCopied] = useState(false);
  const script = generateScript(cfg);

  const handleCopy = () => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ochola-hotspot-${cfg.routerTarget}.rsc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const update = (key: string, val: string) => setCfg(c => ({ ...c, [key]: val }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Hotspot Self-Install Script Generator</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", marginTop: "0.2rem" }}>
            Configure parameters and generate a ready-to-run MikroTik RouterOS script.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleCopy}
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.45rem 0.875rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: copied ? "rgba(34,197,94,0.12)" : "rgba(6,182,212,0.10)", border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(6,182,212,0.25)"}`, color: copied ? "#22c55e" : "#06b6d4", transition: "all 0.2s" }}
          >
            {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
            {copied ? "Copied!" : "Copy Script"}
          </button>
          <button
            onClick={handleDownload}
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.45rem 0.875rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.25)", color: "#a78bfa", transition: "all 0.2s" }}
          >
            <Download style={{ width: 14, height: 14 }} />
            Download .rsc
          </button>
        </div>
      </div>

      {/* Two-column layout: config + script */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.25rem", alignItems: "start" }}>

        {/* Left: Configuration panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Router target */}
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.125rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>Target Router</div>
            <select
              value={cfg.routerTarget}
              onChange={e => update("routerTarget", e.target.value)}
              style={{ width: "100%", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit", outline: "none", cursor: "pointer" }}
            >
              <option value="latty1">latty1 — L009UiGS-2HaxD (Online)</option>
              <option value="latty2">latty2 — hAP lite (Online)</option>
              <option value="latty3">latty3 — RB750Gr3 (Offline)</option>
            </select>
          </div>

          {/* Config fields */}
          {[
            { key: "hotspotIp",      label: "Hotspot IP Address",  placeholder: "192.168.1.1"          },
            { key: "dnsName",        label: "DNS / Portal Name",   placeholder: "hotspot.isplatty.org" },
            { key: "bridgeInterface",label: "Bridge Interface",    placeholder: "bridge1"               },
            { key: "poolStart",      label: "IP Pool Start",       placeholder: "192.168.2.2"           },
            { key: "poolEnd",        label: "IP Pool End",         placeholder: "192.168.2.254"         },
            { key: "profileName",    label: "Profile Name",        placeholder: "hsprof1"               },
          ].map(field => (
            <div key={field.key} style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.875rem 1.125rem" }}>
              <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.375rem" }}>
                {field.label}
              </label>
              <input
                type="text"
                value={(cfg as any)[field.key]}
                onChange={e => update(field.key, e.target.value)}
                placeholder={field.placeholder}
                style={{ width: "100%", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
              />
            </div>
          ))}

          {/* RADIUS config */}
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.125rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>RADIUS Server</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                type="text"
                value={cfg.radiusIp}
                onChange={e => update("radiusIp", e.target.value)}
                placeholder="RADIUS IP"
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.45rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "monospace", outline: "none" }}
              />
              <input
                type="text"
                value={cfg.radiusSecret}
                onChange={e => update("radiusSecret", e.target.value)}
                placeholder="RADIUS Secret"
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.45rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "monospace", outline: "none" }}
              />
            </div>
          </div>
        </div>

        {/* Right: Generated script */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ borderRadius: 10, background: "#0a0e1a", border: "1px solid rgba(6,182,212,0.2)", overflow: "hidden" }}>
            {/* Terminal header bar */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f87171", display: "inline-block" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24", display: "inline-block" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
              </div>
              <span style={{ fontSize: "0.7rem", color: "#64748b", marginLeft: "0.25rem", fontFamily: "monospace" }}>
                MikroTik Terminal — {cfg.routerTarget}
              </span>
              <button
                onClick={handleCopy}
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.25rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.25rem 0.625rem", fontSize: "0.7rem", color: copied ? "#4ade80" : "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, transition: "all 0.2s" }}
              >
                {copied ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre style={{ margin: 0, padding: "1.25rem 1.25rem", fontFamily: "monospace", fontSize: "0.775rem", color: "#4ade80", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all", overflowX: "auto" }}>
              {script}
            </pre>
          </div>

          {/* Tips callout */}
          <div style={{ borderRadius: 10, background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.18)", padding: "0.875rem 1.125rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <Settings2 style={{ width: 14, height: 14, color: "#06b6d4" }} />
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#06b6d4" }}>Before you run the script</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.125rem", fontSize: "0.775rem", color: "var(--isp-text-muted)", lineHeight: 1.75, display: "flex", flexDirection: "column", gap: "0.1rem" }}>
              <li>Ensure the router is online and reachable via Winbox or WebFig.</li>
              <li>Verify the bridge interface name matches your router's actual configuration.</li>
              <li>The RADIUS secret must match what is configured in your FreeRADIUS server.</li>
              <li>Run on a freshly reset router to avoid conflicts with existing hotspot configs.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step-by-step installation guide */}
      <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ClipboardList style={{ width: 15, height: 15, color: "#06b6d4" }} />
          <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Installation Guide</span>
        </div>
        <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {STEPS.map((step) => (
            <div key={step.n} style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(6,182,212,0.12)", border: "1.5px solid rgba(6,182,212,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.75rem", fontWeight: 800, color: "#06b6d4" }}>
                {step.n}
              </div>
              <div>
                <div style={{ fontSize: "0.8375rem", fontWeight: 700, color: "var(--isp-text)", marginBottom: "0.2rem" }}>{step.title}</div>
                <div style={{ fontSize: "0.775rem", color: "var(--isp-text-muted)", lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Installations */}
      <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <RefreshCw style={{ width: 14, height: 14, color: "#06b6d4" }} />
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--isp-text)" }}>Recent Installations</span>
          </div>
          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>Last 5 self-install events</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                {["Customer", "Router", "Device IP", "Time", "Status", "Action"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0.6rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RECENT_INSTALLS.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                  <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text)", fontWeight: 600 }}>{r.customer}</td>
                  <td style={{ padding: "0.625rem 1.25rem" }}>
                    <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: "rgba(6,182,212,0.08)", color: "#22d3ee", fontWeight: 700, fontFamily: "monospace" }}>{r.router}</span>
                  </td>
                  <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{r.ip}</td>
                  <td style={{ padding: "0.625rem 1.25rem", color: "var(--isp-text-sub)", fontSize: "0.75rem" }}>{r.time}</td>
                  <td style={{ padding: "0.625rem 1.25rem" }}>
                    <span style={{
                      fontSize: "0.6875rem", padding: "0.2rem 0.5rem", borderRadius: 4, fontWeight: 600,
                      background: r.status === "success" ? "rgba(74,222,128,0.1)" : r.status === "failed" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
                      color: r.status === "success" ? "#4ade80" : r.status === "failed" ? "#f87171" : "#fbbf24",
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.625rem 1.25rem" }}>
                    <button style={{ fontSize: "0.7rem", color: "#06b6d4", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
                      Re-run →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

/* ─── Main Network Page ─── */
export default function Network() {
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get("tab") || "routers";
  const [activeTab, setActiveTab] = useState(tab);

  const tabs = [
    { id: "routers",      name: "Routers",      icon: Server   },
    { id: "pppoe",        name: "PPPoE Sign In", icon: Shield   },
    { id: "self-install", name: "Self Install",  icon: Terminal },
    { id: "queues",       name: "Queues",        icon: Activity },
    { id: "ippool",       name: "IP Pool",       icon: Server   },
  ];

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Page title */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Network — <span style={{ textTransform: "capitalize" }}>{tabs.find(t => t.id === activeTab)?.name ?? activeTab}</span>
          </h1>
          {activeTab === "routers" && (
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "#06b6d4", border: "none", borderRadius: 8, padding: "0.5rem 1rem", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <Plus style={{ width: 15, height: 15 }} /> Add Router
            </button>
          )}
          {activeTab === "self-install" && (
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 8, padding: "0.5rem 1rem", color: "#a78bfa", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <MonitorSmartphone style={{ width: 15, height: 15 }} /> New Device Setup
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.45rem 1rem", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600,
                  whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                  background: active ? "rgba(6,182,212,0.1)" : "var(--isp-section)",
                  border: active ? "1px solid rgba(6,182,212,0.3)" : "1px solid var(--isp-border)",
                  color: active ? "#06b6d4" : "var(--isp-text-muted)",
                }}
              >
                <t.icon style={{ width: 14, height: 14 }} />
                {t.name}
              </button>
            );
          })}
        </div>

        {/* Routers Tab */}
        {activeTab === "routers" && (
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                    {["Name", "IP Address", "Model", "Status", "Uptime", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Router 01 — Nairobi HQ", ip: "192.168.1.1",  model: "RB4011iGS+5HacQ2HnD", online: true,  uptime: "14d 3h"  },
                    { name: "Router 02 — Karen Branch", ip: "192.168.2.1", model: "RB2011UiAS-2HnD",      online: true,  uptime: "7d 12h"  },
                    { name: "Router 03 — Westlands",   ip: "10.0.3.1",    model: "hEX S",                online: false, uptime: "—"       },
                  ].map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</td>
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{r.ip}</td>
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)" }}>{r.model}</td>
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: r.online ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)", color: r.online ? "#22c55e" : "#f87171" }}>
                          {r.online ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{r.uptime}</td>
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <button style={{ fontSize: "0.75rem", color: r.online ? "#06b6d4" : "var(--isp-text-sub)", background: "none", border: "none", cursor: r.online ? "pointer" : "not-allowed", fontWeight: 600, fontFamily: "inherit" }}>
                          Connect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Self Install Tab */}
        {activeTab === "self-install" && <SelfInstallTab />}

        {/* Coming Soon for other tabs */}
        {(activeTab === "pppoe" || activeTab === "queues" || activeTab === "ippool") && (
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "4rem 2rem", textAlign: "center" }}>
            <Activity style={{ width: 44, height: 44, color: "var(--isp-text-sub)", margin: "0 auto 1rem", opacity: 0.5 }} />
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.5rem" }}>Coming Soon</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", margin: 0 }}>This module is currently under active development.</p>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
