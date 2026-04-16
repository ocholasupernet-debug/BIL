import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, Wrench, PowerOff, Copy, Check,
} from "lucide-react";

interface DbRouterMin {
  id: number; name: string; host: string; bridge_ip: string | null; status: string;
  router_username: string; router_secret: string | null;
}

/* ── Tiny copy button (only used in the manual-fallback) ── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.25rem",
        padding: "0.2rem 0.55rem", borderRadius: 4,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.07)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`,
        color: copied ? "#4ade80" : "#94a3b8",
        fontSize: "0.67rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.14s", flexShrink: 0,
      }}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ── Log panel (shared by sync / auto-fix / reboot) ── */
function LogPanel({
  logs, ok, onClose,
}: {
  logs: string[]; ok: boolean | null; onClose: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  const color = ok === null ? "var(--isp-accent)" : ok ? "#4ade80" : "#f87171";
  return (
    <div style={{
      marginTop: "0.5rem",
      border: `1px solid ${ok === null ? "rgba(59,130,246,0.2)" : ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
      borderRadius: 9, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.875rem",
        background: ok === null ? "rgba(59,130,246,0.05)" : ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {ok === null && <Loader2 size={12} style={{ color, animation: "spin 1s linear infinite" }} />}
          {ok === true && <CheckCircle2 size={12} style={{ color }} />}
          {ok === false && <AlertTriangle size={12} style={{ color }} />}
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color }}>
            {ok === null ? "Working…" : ok ? "Done" : "Failed"}
          </span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.67rem", color: "#64748b", background: "none", border: "none", cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: "0.5rem 0.875rem", background: "#060a0f", maxHeight: 160, overflow: "auto", fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 1.8 }}>
        {logs.map((line, i) => {
          const c = line.startsWith("✅") ? "#4ade80"
            : line.startsWith("❌") ? "#f87171"
            : line.startsWith("✓") ? "#a3e635"
            : line.startsWith("▶") ? "var(--isp-accent)"
            : "#64748b";
          return <div key={i} style={{ color: c }}>{line || " "}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ── Error action bar shown after a failed sync ── */
function SyncFailedActions({
  error, host, bridgeIp, username, password, onRetry,
}: {
  error: string; host: string; bridgeIp?: string;
  username: string; password: string; onRetry: () => void;
}) {
  const [fixing,  setFixing]  = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [fixResult,    setFixResult]    = useState<{ ok: boolean; logs: string[]; canConnect?: boolean } | null>(null);
  const [rebootResult, setRebootResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const body = { host, bridgeIp, username, password };

  async function handleAutoFix() {
    setFixing(true); setFixResult(null); setRebootResult(null);
    try {
      const res  = await fetch("/api/admin/router/fix-api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { ok: boolean; logs: string[]; canConnect?: boolean; error?: string };
      setFixResult({ ok: data.ok, logs: data.logs ?? [], canConnect: data.canConnect });
    } catch (e) {
      setFixResult({ ok: false, logs: [`❌ ${String(e)}`], canConnect: false });
    } finally { setFixing(false); }
  }

  async function handleReboot() {
    setRebooting(true); setRebootResult(null); setFixResult(null);
    try {
      const res  = await fetch("/api/admin/router/reboot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      setRebootResult({ ok: data.ok, message: data.ok ? (data.message ?? "Reboot command sent") : (data.error ?? "Failed") });
    } catch (e) {
      setRebootResult({ ok: false, message: String(e) });
    } finally { setRebooting(false); }
  }

  /* Compact one-line error label */
  const isTimeout  = /timed out|etimedout|timeout/i.test(error);
  const isRefused  = /econnrefused|refused/i.test(error) && !isTimeout;
  const isAuth     = /login|auth|password|permission/i.test(error);
  const isVpn      = /ehostunreach|enetunreach|no route|unreachable/i.test(error);

  const errLabel = isTimeout  ? "Port 8728 blocked by firewall"
    : isRefused  ? "API service disabled on router"
    : isAuth     ? "Authentication failed"
    : isVpn      ? "VPN / routing unreachable"
    : "Connection failed";

  /* Manual fallback commands — shown only when auto-fix can't connect */
  const showFallback = fixResult && !fixResult.ok && fixResult.canConnect === false;
  const fallbackCmds = [
    "/ip service enable api",
    "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept place-before=0",
  ];

  return (
    <div style={{
      marginTop: "0.625rem",
      background: "rgba(248,113,113,0.04)",
      border: "1px solid rgba(248,113,113,0.2)",
      borderRadius: 10, padding: "0.625rem 0.875rem",
    }}>
      {/* Error label + action buttons on one line */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        <AlertTriangle size={13} style={{ color: "#f87171", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f87171", flex: 1 }}>
          {errLabel}
        </span>

        <button
          onClick={handleAutoFix}
          disabled={fixing || rebooting}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: fixing ? "rgba(37,99,235,0.08)" : "var(--isp-accent-glow)",
            border: "1px solid var(--isp-accent-border)",
            color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          {fixing
            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Fixing…</>
            : <><Wrench size={11} /> Auto-fix</>
          }
        </button>

        <button
          onClick={handleReboot}
          disabled={fixing || rebooting}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: rebooting ? "rgba(249,115,22,0.08)" : "rgba(249,115,22,0.12)",
            border: "1px solid rgba(249,115,22,0.35)",
            color: "#fb923c", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          {rebooting
            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Rebooting…</>
            : <><PowerOff size={11} /> Reboot</>
          }
        </button>

        <button
          onClick={onRetry}
          disabled={fixing || rebooting}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#94a3b8", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          <RefreshCw size={11} /> Try Again
        </button>
      </div>

      {/* Auto-fix result log */}
      {(fixing || fixResult) && (
        <LogPanel
          logs={fixResult?.logs ?? (fixing ? ["▶ Connecting to router…"] : [])}
          ok={fixResult ? fixResult.ok : null}
          onClose={() => setFixResult(null)}
        />
      )}

      {/* Manual fallback — only shown when auto-fix can't reach the router */}
      {showFallback && (
        <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "rgba(255,255,255,0.03)", borderRadius: 7 }}>
          <p style={{ margin: "0 0 0.4rem", fontSize: "0.69rem", color: "#64748b", fontWeight: 600 }}>
            Router unreachable — run in Winbox Terminal instead:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {fallbackCmds.map(cmd => (
              <div key={cmd} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", background: "#040810", borderRadius: 5, padding: "0.35rem 0.625rem" }}>
                <code style={{ fontFamily: "monospace", fontSize: "0.71rem", color: "#c7d2fe", flex: 1, wordBreak: "break-all", lineHeight: 1.5 }}>{cmd}</code>
                <CopyBtn text={cmd} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reboot result */}
      {rebootResult && (
        <div style={{
          marginTop: "0.5rem", padding: "0.4rem 0.75rem", borderRadius: 7,
          background: rebootResult.ok ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
          border: `1px solid ${rebootResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          fontSize: "0.74rem", fontWeight: 600,
          color: rebootResult.ok ? "#4ade80" : "#f87171",
        }}>
          {rebootResult.ok ? "✓" : "✕"} {rebootResult.message}
          {rebootResult.ok && (
            <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.69rem", marginLeft: "0.5rem" }}>
              — wait ~30s then Try Again
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Log panel for main sync ─── */
function SyncLogPanel({
  logs, ok, error, host, bridgeIp, username, password, onClose, onRetry,
}: {
  logs: string[]; ok: boolean | null; error?: string;
  host: string; bridgeIp?: string; username: string; password: string;
  onClose: () => void; onRetry: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const borderColor = ok === false ? "rgba(248,113,113,0.3)" : ok === true ? "rgba(74,222,128,0.3)" : "rgba(37,99,235,0.25)";
  const headerBg    = ok === false ? "rgba(248,113,113,0.06)" : ok === true ? "rgba(74,222,128,0.06)" : "rgba(37,99,235,0.05)";
  const iconColor   = ok === false ? "#f87171" : ok === true ? "#4ade80" : "var(--isp-accent)";
  const label       = ok === null ? "Syncing…" : ok === true ? "Sync Complete" : "Sync Failed";

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 1rem", background: headerBg }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {ok === null  && <Loader2 size={14} style={{ color: "var(--isp-accent)", animation: "spin 1s linear infinite" }} />}
          {ok === true  && <CheckCircle2 size={14} style={{ color: "#4ade80" }} />}
          {ok === false && <AlertTriangle size={14} style={{ color: "#f87171" }} />}
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: iconColor }}>{label}</span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem", borderRadius: 5 }}>
          ✕ close
        </button>
      </div>

      {/* Raw log lines */}
      <div style={{ padding: "0.625rem 1rem", background: "#080c10", maxHeight: 180, overflow: "auto", fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.75 }}>
        {logs.map((line, i) => {
          const c = line.startsWith("✅") ? "#4ade80"
            : line.startsWith("❌") ? "#f87171"
            : line.startsWith("✓")  ? "#a3e635"
            : line.startsWith("▶")  ? "var(--isp-accent)"
            : line.startsWith("  ") ? "#64748b"
            : "#94a3b8";
          return <div key={i} style={{ color: c }}>{line || " "}</div>;
        })}
        <div ref={bottomRef} />
      </div>

      {/* Action bar — only shown on failure */}
      {ok === false && error && (
        <div style={{ padding: "0 0.75rem 0.75rem" }}>
          <SyncFailedActions
            error={error}
            host={host}
            bridgeIp={bridgeIp}
            username={username}
            password={password}
            onRetry={onRetry}
          />
        </div>
      )}
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

export function RouterSyncBar({ label, description, icon, endpoint, buildPayload, color = "var(--isp-accent)" }: RouterSyncBarProps) {
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
            <option key={r.id} value={r.id}>{r.name} — {r.host || r.bridge_ip || "?"} [{r.status === "online" || r.status === "connected" ? "online" : "offline"}]</option>
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

      {/* Warnings */}
      {selectedRouter && !selectedRouter.host && !selectedRouter.bridge_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, fontSize: "0.75rem", color: "#fbbf24" }}>
          <AlertTriangle size={13} />
          <span>No IP found for this router. Go to <strong>Routers</strong> to save its IP or wait for a heartbeat.</span>
        </div>
      )}
      {selectedRouter && !selectedRouter.host && selectedRouter.bridge_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, fontSize: "0.75rem", color: "var(--isp-accent)" }}>
          <span>Using VPN tunnel IP <strong style={{ fontFamily: "monospace" }}>{selectedRouter.bridge_ip}</strong></span>
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

      {/* Sync log panel */}
      {(syncing || result) && (
        <SyncLogPanel
          logs={result?.logs ?? (syncing ? ["▶ Connecting…"] : [])}
          ok={result ? result.ok : null}
          error={result?.error}
          host={selectedRouter?.host || selectedRouter?.bridge_ip || ""}
          bridgeIp={selectedRouter?.bridge_ip ?? undefined}
          username={selectedRouter?.router_username || "admin"}
          password={selectedRouter?.router_secret || ""}
          onClose={() => setResult(null)}
          onRetry={handleSync}
        />
      )}
    </div>
  );
}
