import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, Copy, Check, Wifi, WifiOff,
  ShieldAlert, KeyRound, Terminal,
} from "lucide-react";

interface DbRouterMin {
  id: number; name: string; host: string; bridge_ip: string | null; status: string;
  router_username: string; router_secret: string | null;
}

/* ── Copy button ── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2200);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.3rem",
        padding: "0.25rem 0.65rem", borderRadius: 5,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.07)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.12)"}`,
        color: copied ? "#4ade80" : "#a5b4fc",
        fontSize: "0.7rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0,
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ── Command row ── */
function CmdRow({ cmd }: { cmd: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: "0.625rem", background: "#040810",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6,
      padding: "0.45rem 0.75rem",
    }}>
      <code style={{
        fontFamily: "monospace", fontSize: "0.75rem", color: "#c7d2fe",
        wordBreak: "break-all", lineHeight: 1.6, flex: 1,
      }}>{cmd}</code>
      <CopyBtn text={cmd} />
    </div>
  );
}

/* ── Error classifier → returns the right fix UI ── */
type ErrKind = "firewall" | "api_disabled" | "auth" | "vpn_down" | "unknown";

function classifyError(err: string): ErrKind {
  const e = err.toLowerCase();
  if (/ehostunreach|enetunreach|no route|unreachable|vpn|routing failure/i.test(e))
    return "vpn_down";
  if (/timed out|etimedout|timeout/i.test(e))
    return "firewall";
  if (/econnrefused|refused/i.test(e))
    return "api_disabled";
  if (/login failed|auth|wrong password|credentials|not authorized|permission/i.test(e))
    return "auth";
  return "unknown";
}

function SyncErrorHint({
  error, host, username, onRetry,
}: {
  error: string; host: string; username: string; onRetry: () => void;
}) {
  const kind = classifyError(error);

  type Fix = { icon: React.ReactNode; title: string; subtitle: string; color: string; border: string; cmds?: string[]; note?: string };

  const fixes: Record<ErrKind, Fix> = {
    firewall: {
      icon: <ShieldAlert size={15} />,
      title: "Port 8728 blocked by firewall",
      subtitle: "Run both commands in Winbox → Terminal, then click Try Again",
      color: "#f97316", border: "rgba(249,115,22,0.35)",
      cmds: [
        "/ip service enable api",
        `/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept place-before=0`,
      ],
    },
    api_disabled: {
      icon: <Wifi size={15} />,
      title: "MikroTik API service is disabled",
      subtitle: "Run in Winbox → Terminal, then click Try Again",
      color: "#f97316", border: "rgba(249,115,22,0.35)",
      cmds: ["/ip service enable api"],
    },
    auth: {
      icon: <KeyRound size={15} />,
      title: "Authentication failed — wrong credentials",
      subtitle: `The app is connecting as "${username}". Check the username and password in Routers settings.`,
      color: "#a78bfa", border: "rgba(167,139,250,0.35)",
      note: `Verify in Winbox: /user print — ensure "${username}" exists with group=full`,
    },
    vpn_down: {
      icon: <WifiOff size={15} />,
      title: "VPN tunnel is down — can't reach router",
      subtitle: `${host} is not reachable. Check the OpenVPN/WireGuard tunnel is connected.`,
      color: "#f87171", border: "rgba(248,113,113,0.35)",
      note: "Run: ping 10.8.0.1 from the server — if it fails, the VPN needs to be restarted.",
    },
    unknown: {
      icon: <Terminal size={15} />,
      title: "Connection failed",
      subtitle: "Unexpected error — see raw detail below",
      color: "#f87171", border: "rgba(248,113,113,0.35)",
    },
  };

  const fix = fixes[kind];

  return (
    <div style={{
      background: "rgba(15,18,28,0.95)",
      border: `1px solid ${fix.border}`,
      borderRadius: 10, overflow: "hidden", margin: "0.625rem 0",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.6rem 0.875rem",
        background: `color-mix(in srgb, ${fix.color} 10%, transparent)`,
        borderBottom: `1px solid ${fix.border}`,
      }}>
        <span style={{ color: fix.color, flexShrink: 0 }}>{fix.icon}</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "0.8rem", color: fix.color }}>
            ✕ {fix.title}
          </p>
          <p style={{ margin: 0, fontSize: "0.71rem", color: "var(--isp-text-muted)", lineHeight: 1.4, marginTop: "0.15rem" }}>
            {fix.subtitle}
          </p>
        </div>
      </div>

      {/* Commands or note */}
      {(fix.cmds || fix.note) && (
        <div style={{ padding: "0.625rem 0.875rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {fix.cmds && (
            <>
              <p style={{ margin: "0 0 0.3rem", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8" }}>
                Run in Winbox → Terminal:
              </p>
              {fix.cmds.map(cmd => <CmdRow key={cmd} cmd={cmd} />)}
            </>
          )}
          {fix.note && (
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.72rem", color: "#94a3b8", fontFamily: "monospace" }}>
              {fix.note}
            </p>
          )}
        </div>
      )}

      {/* Try Again */}
      <div style={{
        padding: "0.5rem 0.875rem",
        borderTop: `1px solid rgba(255,255,255,0.05)`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
      }}>
        <span style={{ fontSize: "0.69rem", color: "#475569" }}>
          After running the commands above, click Try Again
        </span>
        <button
          onClick={onRetry}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.35rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: "linear-gradient(135deg,rgba(6,182,212,0.2),rgba(2,132,199,0.2))",
            border: "1px solid rgba(6,182,212,0.4)",
            color: "#22d3ee", fontWeight: 700, fontSize: "0.75rem",
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          <RefreshCw size={11} /> Try Again
        </button>
      </div>
    </div>
  );
}

/* ─── Log panel ─── */
function LogPanel({ logs, ok, error, host, username, onClose, onRetry }: {
  logs: string[]; ok: boolean | null; error?: string;
  host: string; username: string;
  onClose: () => void; onRetry: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const borderColor = ok === false ? "rgba(248,113,113,0.3)" : ok === true ? "rgba(74,222,128,0.3)" : "rgba(6,182,212,0.25)";
  const headerBg    = ok === false ? "rgba(248,113,113,0.06)" : ok === true ? "rgba(74,222,128,0.06)" : "rgba(6,182,212,0.05)";
  const iconColor   = ok === false ? "#f87171" : ok === true ? "#4ade80" : "#22d3ee";
  const label       = ok === null ? "Syncing…" : ok === true ? "Sync Complete" : "Sync Failed";

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 1rem", background: headerBg }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {ok === null  && <Loader2 size={14} style={{ color: "#22d3ee", animation: "spin 1s linear infinite" }} />}
          {ok === true  && <CheckCircle2 size={14} style={{ color: "#4ade80" }} />}
          {ok === false && <AlertTriangle size={14} style={{ color: "#f87171" }} />}
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: iconColor }}>{label}</span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem", borderRadius: 5 }}>
          ✕ close
        </button>
      </div>

      {/* Smart error panel — only when sync failed */}
      {ok === false && error && (
        <div style={{ padding: "0 0.75rem" }}>
          <SyncErrorHint error={error} host={host} username={username} onRetry={onRetry} />
        </div>
      )}

      {/* Raw log lines */}
      <div style={{ padding: "0.625rem 1rem", background: "#080c10", maxHeight: 200, overflow: "auto", fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.75 }}>
        {logs.map((line, i) => {
          const c = line.startsWith("✅") ? "#4ade80"
            : line.startsWith("❌") ? "#f87171"
            : line.startsWith("✓")  ? "#a3e635"
            : line.startsWith("▶")  ? "#22d3ee"
            : line.startsWith("  ") ? "#64748b"
            : "#94a3b8";
          return <div key={i} style={{ color: c }}>{line || " "}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ─── Props ─── */
export interface RouterSyncBarProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  buildPayload: (router: DbRouterMin) => Record<string, unknown>;
  color?: string;
}

export function RouterSyncBar({ label, description, icon, endpoint, buildPayload, color = "#06b6d4" }: RouterSyncBarProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [result,     setResult]     = useState<{ logs: string[]; ok: boolean; error?: string } | null>(null);
  const [showMeta,   setShowMeta]   = useState(false);

  const { data: routers = [] } = useQuery<DbRouterMin[]>({
    queryKey: ["isp_routers_sync"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("id,name,host,bridge_ip,status,router_username,router_secret").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouterMin[];
    },
  });

  const selectedRouter = routers.find(r => r.id === selectedId) ?? null;
  const canSync = !!selectedRouter && !!(selectedRouter.host || selectedRouter.bridge_ip);

  const handleSync = async () => {
    if (!selectedRouter || !canSync) return;
    setSyncing(true);
    setResult(null);
    try {
      const payload = {
        host:     selectedRouter.host     || selectedRouter.bridge_ip || "",
        bridgeIp: selectedRouter.bridge_ip || undefined,
        routerId: selectedRouter.id,
        username: selectedRouter.router_username || "admin",
        password: selectedRouter.router_secret   || "",
        ...buildPayload(selectedRouter),
      };
      const res  = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json() as { ok: boolean; logs: string[]; error?: string };
      setResult(data);
    } catch (err) {
      setResult({ ok: false, logs: [], error: String(err) });
    } finally {
      setSyncing(false);
    }
  };

  const selStyle: React.CSSProperties = {
    background: "var(--isp-inner-card,rgba(255,255,255,0.04))",
    border: "1px solid var(--isp-border,rgba(255,255,255,0.1))",
    borderRadius: 8, padding: "0.5rem 0.75rem",
    color: "var(--isp-text,#e2e8f0)", fontSize: "0.8rem",
    flex: "1 1 200px", maxWidth: 280, fontFamily: "inherit",
    cursor: "pointer", outline: "none",
  };

  return (
    <div style={{
      background: `linear-gradient(135deg,${color}10,${color}04)`,
      border: `1px solid ${color}33`,
      borderRadius: 14, padding: "1rem 1.25rem",
    }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* ── Main row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ color, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: "1 1 220px" }}>
          <div style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--isp-text,#e2e8f0)", marginBottom: "0.1rem" }}>{label}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted,#94a3b8)" }}>{description}</div>
        </div>

        <select
          value={selectedId ?? ""}
          onChange={e => { setSelectedId(Number(e.target.value)); setResult(null); }}
          style={selStyle}
        >
          <option value="" disabled>Select router…</option>
          {routers.map(r => (
            <option key={r.id} value={r.id}>{r.name} — {r.host} {r.status === "online" ? "🟢" : "🔴"}</option>
          ))}
        </select>

        <button
          onClick={handleSync}
          disabled={syncing || !canSync}
          style={{
            display: "flex", alignItems: "center", gap: "0.45rem",
            padding: "0.575rem 1.25rem", borderRadius: 10,
            background: syncing || !canSync ? `${color}18` : `linear-gradient(135deg,${color},${color}cc)`,
            border: "none",
            color: syncing || !canSync ? "#94a3b8" : "white",
            fontWeight: 800, fontSize: "0.85rem",
            cursor: syncing || !canSync ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            boxShadow: syncing || !canSync ? "none" : `0 4px 12px ${color}40`,
            transition: "all 0.2s", whiteSpace: "nowrap",
          }}
        >
          {syncing
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Syncing…</>
            : <><RefreshCw size={14} /> Sync Now</>
          }
        </button>
      </div>

      {/* No host warning */}
      {selectedRouter && !selectedRouter.host && !selectedRouter.bridge_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, fontSize: "0.75rem", color: "#fbbf24" }}>
          <AlertTriangle size={13} />
          <span>No IP address found for this router. Make sure it has sent a heartbeat (VPN IP auto-detected) or go to <strong>Routers</strong> and save its IP manually.</span>
        </div>
      )}
      {selectedRouter && !selectedRouter.host && selectedRouter.bridge_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, fontSize: "0.75rem", color: "#22d3ee" }}>
          <span>Using VPN tunnel IP <strong style={{ fontFamily: "monospace" }}>{selectedRouter.bridge_ip}</strong> to reach this router.</span>
        </div>
      )}

      {/* Router metadata strip */}
      {selectedRouter && (
        <div style={{ marginTop: "0.625rem", paddingTop: "0.625rem", borderTop: `1px solid ${color}18` }}>
          <button
            onClick={() => setShowMeta(m => !m)}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted,#94a3b8)", fontSize: "0.72rem", padding: 0, fontFamily: "inherit" }}
          >
            {showMeta ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {selectedRouter.name} — {selectedRouter.host}
            <span style={{ marginLeft: "0.375rem", fontFamily: "monospace", color }}>port 8728</span>
          </button>
          {showMeta && (
            <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.72rem", color: "var(--isp-text-muted,#94a3b8)", marginTop: "0.375rem", flexWrap: "wrap" }}>
              {[
                ["User",   selectedRouter.router_username || "admin"],
                ["Secret", selectedRouter.router_secret ? "••••••••" : "—"],
                ["Status", selectedRouter.status],
              ].map(([k, v]) => (
                <span key={k}><span style={{ fontWeight: 700, color }}>{k}:</span> <span style={{ fontFamily: "monospace" }}>{v}</span></span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log panel */}
      {(syncing || result) && (
        <LogPanel
          logs={result?.logs ?? (syncing ? ["▶ Connecting…"] : [])}
          ok={result ? result.ok : null}
          error={result?.error}
          host={selectedRouter?.host || selectedRouter?.bridge_ip || "router"}
          username={selectedRouter?.router_username || "admin"}
          onClose={() => setResult(null)}
          onRetry={handleSync}
        />
      )}
    </div>
  );
}
