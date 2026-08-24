import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Wifi, Activity, ArrowDown, ArrowUp, WifiOff, Copy, Download } from "lucide-react";

/* ─── Types matching backend response ────────────────────────────────────── */
interface HotspotUser {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  server: string;
}

interface PPPoEUser {
  id: string;
  name: string;
  address: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  service: string;
}

interface RouterInterface {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string;
  comment: string;
}

interface TrafficStat {
  iface: string;
  rxBitsPerSecond: number;
  txBitsPerSecond: number;
}

interface LiveData {
  routerId: number;
  hotspotUsers: HotspotUser[];
  pppoeUsers: PPPoEUser[];
  interfaces: RouterInterface[];
  traffic: TrafficStat[];
  fetchedAt: string;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function fmtBits(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024) return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

/* ─── Props ───────────────────────────────────────────────────────────────── */
interface RouterLiveStatsProps {
  /** Local DB router ID — used when router was added via the local API */
  routerId?: number | string;
  /** Router host/IP — used when sourced from Supabase */
  routerHost?: string;
  routerUsername?: string;
  routerPort?: number;
  routerName?: string;
  refetchIntervalMs?: number;
}

/* ─── CopyCmd: inline code block with one-click copy ─────────────────────── */
function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
      <code style={{ flex: 1, fontFamily: "monospace", fontSize: "0.68rem", color: "#67e8f9", background: "rgba(0,0,0,0.35)", padding: "0.2rem 0.5rem", borderRadius: 5, wordBreak: "break-all" }}>
        {cmd}
      </code>
      <button
        onClick={doCopy}
        style={{ flexShrink: 0, background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 4, color: copied ? "#4ade80" : "#64748b", cursor: "pointer", fontSize: "0.6rem", padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.15rem", fontFamily: "inherit" }}
      >
        <Copy size={8} />{copied ? "✓" : "copy"}
      </button>
    </div>
  );
}

/* ─── Component ───────────────────────────────────────────────────────────── */
export function RouterLiveStats({
  routerId,
  routerHost,
  routerUsername,
  routerPort,
  routerName,
  refetchIntervalMs = 7000,
}: RouterLiveStatsProps) {
  const queryKey = routerId ? ["router-live", routerId] : ["router-live-host", routerHost];

  const { data, isLoading, isError, error, dataUpdatedAt, isFetching } = useQuery<LiveData>({
    queryKey,
    queryFn: async () => {
      let url: string;
      if (routerId) {
        url = `/api/router/${routerId}/live`;
      } else if (routerHost) {
        const params = new URLSearchParams({ host: routerHost });
        if (routerUsername) params.set("username", routerUsername);
        if (routerPort) params.set("port", String(routerPort));
        url = `/api/router/live-by-host?${params}`;
      } else {
        throw new Error("Either routerId or routerHost is required");
      }
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: !!(routerId || routerHost),
    refetchInterval: refetchIntervalMs,
    retry: 1,
    staleTime: 0,
  });

  /* ── Styles ── */
  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "1rem 1.25rem",
    flex: 1,
    minWidth: 150,
  };
  const label: React.CSSProperties = {
    fontSize: "0.68rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--isp-text-muted, #94a3b8)",
    marginBottom: "0.4rem",
  };
  const bigNum: React.CSSProperties = {
    fontSize: "2rem",
    fontWeight: 800,
    color: "#e2e8f0",
    lineHeight: 1,
  };
  const sub: React.CSSProperties = {
    fontSize: "0.7rem",
    color: "var(--isp-text-muted, #94a3b8)",
    marginTop: "0.25rem",
  };

  /* ── Offline / loading ── */
  if (isLoading) {
    return (
      <div style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "0.6rem", color: "#64748b", fontSize: "0.8rem" }}>
        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
        Connecting to router API…
      </div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    const msgLow = msg.toLowerCase();
    const offline = msgLow.includes("offline") || msgLow.includes("unreachable") ||
                    msgLow.includes("timed out") || msgLow.includes("etimedout") ||
                    msgLow.includes("econnrefused") || msgLow.includes("ehostunreach");
    const badCreds = msgLow.includes("login failed") || msgLow.includes("authentication") || msgLow.includes("bad password");
    const apiDisabled = msgLow.includes("econnrefused");

    /* Derive fix label + MikroTik commands */
    const fix = badCreds
      ? { label: "Wrong API credentials", cmds: ["/user set admin password=YOUR_PASSWORD"], note: "Update the password in the Routers page to match." }
      : apiDisabled
        ? { label: "API service disabled", cmds: ["/ip service enable api"], note: "Run in Winbox → Terminal, then retry." }
        : offline
          ? {
              label: "Port 8728 blocked or router unreachable",
              /* Restrict to VPN subnet only — never open to 0.0.0.0/0 */
              cmds: [
                "/ip service enable api",
                "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept comment=\"ISP-API\" place-before=0",
              ],
              note: "Replace 10.8.0.0/16 with your VPS VPN subnet if different. Download the auto-generated script below for a complete, ready-to-paste ruleset.",
            }
          : null;

    return (
      <div style={{ padding: "1rem 1.25rem", background: "rgba(248,113,113,0.06)", borderTop: "1px solid rgba(248,113,113,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: fix ? "0.75rem" : 0 }}>
          <WifiOff size={16} color="#f87171" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f87171" }}>
              {offline ? "Router Offline or Unreachable" : badCreds ? "Authentication Failed" : "MikroTik API Error"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.15rem" }}>{msg}</div>
          </div>
        </div>

        {fix && (
          <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "0.65rem 0.875rem" }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.4rem" }}>
              Fix: {fix.label}
            </div>
            {fix.note && (
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginBottom: "0.4rem" }}>{fix.note}</div>
            )}
            {fix.cmds.map(cmd => (
              <CopyCmd key={cmd} cmd={cmd} />
            ))}
            {routerId && offline && (
              <div style={{ marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "0.68rem", color: "#94a3b8", marginBottom: "0.35rem" }}>
                  Or download the auto-generated firewall script (paste into MikroTik terminal):
                </div>
                <a
                  href={`/api/router/${routerId}/firewall-script?vpsIp=YOUR_VPS_IP`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.7rem", fontWeight: 600, color: "var(--isp-accent, #38bdf8)", textDecoration: "none", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "0.3rem 0.65rem" }}
                >
                  <Download size={11} /> Download firewall-script.rsc
                </a>
                <span style={{ fontSize: "0.65rem", color: "#475569", marginLeft: "0.5rem" }}>
                  Replace YOUR_VPS_IP with your server's public IP
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!data) return null;

  const totalActive = data.hotspotUsers.length + data.pppoeUsers.length;
  const runningIfaces = data.interfaces.filter((i) => i.running && !i.disabled);
  const totalRx = data.traffic.reduce((s, t) => s + t.rxBitsPerSecond, 0);
  const totalTx = data.traffic.reduce((s, t) => s + t.txBitsPerSecond, 0);
  const updatedSec = dataUpdatedAt ? Math.round((Date.now() - dataUpdatedAt) / 1000) : null;

  return (
    <div style={{ borderTop: "1px solid var(--isp-accent-glow)", padding: "1rem 1.25rem 1.25rem" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Activity size={13} color="var(--isp-accent)" />
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Live Stats {routerName ? `— ${routerName}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.65rem", color: "#64748b" }}>
          {isFetching && <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />}
          {updatedSec !== null && <span>updated {updatedSec}s ago</span>}
          <span style={{ color: "#334155" }}>• auto-refreshes every {refetchIntervalMs / 1000}s</span>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {/* Active Users */}
        <div style={{ ...card, borderColor: totalActive > 0 ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)" }}>
          <div style={label}><Users size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Active Users</div>
          <div style={{ ...bigNum, color: totalActive > 0 ? "#4ade80" : "#e2e8f0" }}>{totalActive}</div>
          <div style={sub}>
            {data.hotspotUsers.length} hotspot · {data.pppoeUsers.length} PPPoE
          </div>
        </div>

        {/* Running Interfaces */}
        <div style={card}>
          <div style={label}><Wifi size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Interfaces</div>
          <div style={bigNum}>{runningIfaces.length}</div>
          <div style={sub}>of {data.interfaces.length} total running</div>
        </div>

        {/* Download */}
        <div style={card}>
          <div style={label}><ArrowDown size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Download</div>
          <div style={{ ...bigNum, fontSize: "1.4rem", color: "#38bdf8" }}>{fmtBits(totalRx)}</div>
          <div style={sub}>total inbound traffic</div>
        </div>

        {/* Upload */}
        <div style={card}>
          <div style={label}><ArrowUp size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Upload</div>
          <div style={{ ...bigNum, fontSize: "1.4rem", color: "var(--isp-accent)" }}>{fmtBits(totalTx)}</div>
          <div style={sub}>total outbound traffic</div>
        </div>
      </div>

      {/* Per-interface traffic table */}
      {data.traffic.length > 0 && (
        <div style={{ marginBottom: "0.875rem" }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#64748b", marginBottom: "0.4rem" }}>
            Per-Interface Traffic
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {data.traffic.map((t) => {
              const totalBps = t.rxBitsPerSecond + t.txBitsPerSecond;
              const maxBps = Math.max(...data.traffic.map((x) => x.rxBitsPerSecond + x.txBitsPerSecond), 1);
              const pct = Math.round((totalBps / maxBps) * 100);
              return (
                <div key={t.iface} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#94a3b8", minWidth: 90, flexShrink: 0 }}>{t.iface}</span>
                  <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--isp-accent)", borderRadius: 3, transition: "width 0.6s ease" }} />
                  </div>
                  <span style={{ fontSize: "0.68rem", color: "#38bdf8", minWidth: 72, textAlign: "right", fontFamily: "monospace" }}>
                    ↓{fmtBits(t.rxBitsPerSecond)}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "var(--isp-accent)", minWidth: 72, textAlign: "right", fontFamily: "monospace" }}>
                    ↑{fmtBits(t.txBitsPerSecond)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active user list */}
      {totalActive > 0 && (
        <div>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#64748b", marginBottom: "0.4rem" }}>
            Active Sessions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxHeight: 200, overflowY: "auto" }}>
            {data.hotspotUsers.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.35rem 0.6rem", background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: "0.72rem" }}>
                <span style={{ color: "#4ade80", fontSize: "0.6rem", fontWeight: 700, background: "rgba(74,222,128,0.12)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>HS</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600, minWidth: 100 }}>{u.user}</span>
                <span style={{ color: "#64748b", fontFamily: "monospace" }}>{u.address}</span>
                <span style={{ color: "#94a3b8", marginLeft: "auto" }}>{u.uptime}</span>
                <span style={{ color: "#38bdf8", fontFamily: "monospace", fontSize: "0.65rem" }}>↓{fmtBytes(u.bytesIn)} ↑{fmtBytes(u.bytesOut)}</span>
              </div>
            ))}
            {data.pppoeUsers.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.35rem 0.6rem", background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: "0.72rem" }}>
                <span style={{ color: "var(--isp-accent)", fontSize: "0.6rem", fontWeight: 700, background: "var(--isp-accent-glow)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>PPP</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600, minWidth: 100 }}>{u.name}</span>
                <span style={{ color: "#64748b", fontFamily: "monospace" }}>{u.address}</span>
                <span style={{ color: "#94a3b8", marginLeft: "auto" }}>{u.uptime}</span>
                <span style={{ color: "#38bdf8", fontFamily: "monospace", fontSize: "0.65rem" }}>↓{fmtBytes(u.bytesIn)} ↑{fmtBytes(u.bytesOut)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
