import React, { useState, useRef, useEffect } from "react";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, Wrench, PowerOff, Copy, Check, HardDrive,
} from "lucide-react";
import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { useAdminRouterContext, type AdminContextRouter } from "@/lib/admin-router-context";
import { installHotspotFiles, type HotspotFileDeploymentResult } from "@/lib/router-hotspot-files";

type DbRouterMin = AdminContextRouter;
const INCOMPLETE_ROUTER_STATUSES = new Set([
  "setup",
  "awaiting_connection",
  "awaiting_sync",
  "awaiting_ports",
]);

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
  error, host, bridgeIp, username, password, routerId, routerName, routerStatus, onRetry,
}: {
  error: string; host: string; bridgeIp?: string;
  routerId?: number; routerName?: string; routerStatus?: string;
  username: string; password: string; onRetry: () => void;
}) {
  const [fixing,  setFixing]  = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [deployingFiles, setDeployingFiles] = useState(false);
  const [fixResult,    setFixResult]    = useState<{ ok: boolean; logs: string[]; canConnect?: boolean } | null>(null);
  const [rebootResult, setRebootResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [fileDeployment, setFileDeployment] = useState<HotspotFileDeploymentResult | null>(null);
  const [fileDeploymentError, setFileDeploymentError] = useState("");

  const body = { host, bridgeIp, username, password };
  const canRepairFiles = Boolean(
    routerId
    && routerStatus
    && !INCOMPLETE_ROUTER_STATUSES.has(routerStatus.toLowerCase()),
  );

  async function handleAutoFix() {
    setFixing(true); setFixResult(null); setRebootResult(null);
    try {
      const res  = await fetch(apiUrl("/api/admin/router/fix-api"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await parseJsonResponse<{ ok: boolean; logs?: string[]; canConnect?: boolean; error?: string }>(res);
      setFixResult({ ok: data.ok, logs: data.logs ?? [], canConnect: data.canConnect });
    } catch (e) {
      setFixResult({ ok: false, logs: [`❌ ${String(e)}`], canConnect: false });
    } finally { setFixing(false); }
  }

  async function handleReboot() {
    setRebooting(true); setRebootResult(null); setFixResult(null);
    try {
      const res  = await fetch(apiUrl("/api/admin/router/reboot"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await parseJsonResponse<{ ok: boolean; message?: string; error?: string }>(res);
      setRebootResult({ ok: data.ok, message: data.ok ? (data.message ?? "Reboot command sent") : (data.error ?? "Failed") });
    } catch (e) {
      setRebootResult({ ok: false, message: String(e) });
    } finally { setRebooting(false); }
  }

  async function handleInstallHotspotFiles() {
    if (!routerId || !canRepairFiles || deployingFiles) return;
    if (!window.confirm(
      `Add missing approved Hotspot files to ${routerName || "this installed router"}? Existing files will be kept; this does not replace or run files.`,
    )) return;
    setDeployingFiles(true);
    setFileDeployment(null);
    setFileDeploymentError("");
    try {
      const result = await installHotspotFiles(
        routerId,
        ADMIN_ID,
        getAdminApiToken(),
        progress => setFileDeployment(progress),
      );
      setFileDeployment(result);
      if (result.status === "failed" || result.failed.length > 0 || result.error) {
        setFileDeploymentError(result.error || `${result.failed.length} Hotspot file(s) could not be transferred.`);
      }
    } catch (cause) {
      setFileDeploymentError(cause instanceof Error ? cause.message : "Hotspot files could not be transferred.");
    } finally {
      setDeployingFiles(false);
    }
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
    "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.5.0/24 action=accept place-before=0",
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
          disabled={fixing || rebooting || deployingFiles}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: fixing ? "rgba(37,99,235,0.08)" : "var(--isp-accent-glow)",
            border: "1px solid var(--isp-accent-border)",
            color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting || deployingFiles ? "not-allowed" : "pointer",
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
          disabled={fixing || rebooting || deployingFiles}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: rebooting ? "rgba(249,115,22,0.08)" : "rgba(249,115,22,0.12)",
            border: "1px solid rgba(249,115,22,0.35)",
            color: "#fb923c", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting || deployingFiles ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          {rebooting
            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Rebooting…</>
            : <><PowerOff size={11} /> Reboot</>
          }
        </button>

        {canRepairFiles && (
          <button
            onClick={() => void handleInstallHotspotFiles()}
            disabled={fixing || rebooting || deployingFiles}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.3rem",
              padding: "0.3rem 0.75rem", borderRadius: 7,
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(74,222,128,0.3)",
              color: "#86efac", fontWeight: 700, fontSize: "0.76rem",
              cursor: fixing || rebooting || deployingFiles ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
          >
            {deployingFiles
              ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Pushing files…</>
              : <><HardDrive size={11} /> Repair Hotspot files</>}
          </button>
        )}

        <button
          onClick={onRetry}
          disabled={fixing || rebooting || deployingFiles}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.3rem 0.875rem", borderRadius: 7,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#94a3b8", fontWeight: 700, fontSize: "0.76rem",
            cursor: fixing || rebooting || deployingFiles ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >
          <RefreshCw size={11} /> Try Again
        </button>
      </div>

      {(deployingFiles || fileDeployment || fileDeploymentError) && (
        <div style={{ marginTop: "0.5rem", padding: "0.55rem 0.7rem", borderRadius: 7, background: fileDeploymentError ? "rgba(248,113,113,0.06)" : "rgba(34,197,94,0.06)", border: `1px solid ${fileDeploymentError ? "rgba(248,113,113,0.2)" : "rgba(74,222,128,0.18)"}` }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 750, color: fileDeploymentError ? "#fca5a5" : "#86efac" }}>
            {deployingFiles
              ? `Hotspot file repair ${fileDeployment?.status ?? "starting"}`
              : fileDeploymentError
                ? "Hotspot file repair finished with errors"
                : "Hotspot file repair complete"}
          </div>
          {fileDeployment && (
            <div style={{ marginTop: "0.25rem", color: "#94a3b8", fontSize: "0.67rem" }}>
              {fileDeployment.deployed.length} added · {fileDeployment.skipped.length} already present · {fileDeployment.failed.length} failed · {fileDeployment.processed} of {fileDeployment.total} processed
            </div>
          )}
          {fileDeploymentError && (
            <div style={{ marginTop: "0.25rem", color: "#fca5a5", fontSize: "0.67rem" }}>{fileDeploymentError}</div>
          )}
          {fileDeployment && (fileDeployment.deployed.length > 0 || fileDeployment.skipped.length > 0 || fileDeployment.failed.length > 0) ? (
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.05rem", color: "#cbd5e1", fontSize: "0.66rem", lineHeight: 1.45 }}>
              {fileDeployment.deployed.map(file => (
                <li key={`deployed:${file.destinationPath}`}>{file.destinationPath}: added</li>
              ))}
              {fileDeployment.skipped.map(file => (
                <li key={`skipped:${file.destinationPath}`}>{file.destinationPath}: {file.reason || "already present"}</li>
              ))}
              {fileDeployment.failed.map(file => (
                <li key={`failed:${file.destinationPath}:${file.error}`} style={{ color: "#fca5a5" }}>{file.destinationPath}: {file.error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

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
  logs, ok, error, host, bridgeIp, username, password, routerId, routerName, routerStatus, onClose, onRetry,
}: {
  logs: string[]; ok: boolean | null; error?: string;
  host: string; bridgeIp?: string; username: string; password: string;
  routerId?: number; routerName?: string; routerStatus?: string;
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
            routerId={routerId}
            routerName={routerName}
            routerStatus={routerStatus}
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

  const { data: context, isLoading: routersLoading, error: routersError } = useAdminRouterContext();
  const routers = context?.routers ?? [];
  const assignedPortsByRouter = new Map<number, string[]>();
  (context?.ports ?? []).forEach(port => {
    const current = assignedPortsByRouter.get(port.router_id) ?? [];
    current.push(port.interface_name);
    assignedPortsByRouter.set(port.router_id, current);
  });

  const selectedRouter = routers.find(r => r.id === selectedId) ?? null;
  const canSync = !!selectedRouter && !!(selectedRouter.host || selectedRouter.vpn_ip);

  const handleSync = async () => {
    if (!selectedRouter || !canSync) return;
    setSyncing(true);
    setResult(null);
    try {
      const payload = {
        host:     selectedRouter.host     || selectedRouter.vpn_ip || "",
        bridgeIp: selectedRouter.vpn_ip || undefined,
        routerId: selectedRouter.id,
        username: selectedRouter.router_username || "admin",
        password: selectedRouter.router_secret   || "",
        ...buildPayload(selectedRouter),
      };
       const token = getAdminApiToken();
       const res  = await fetch(apiUrl(endpoint), { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      const data = await parseJsonResponse<{ ok: boolean; logs?: string[]; error?: string }>(res);
      if (!res.ok) {
        setResult({
          ok: false,
          logs: data.logs ?? [],
          error: data.error || `Sync failed (HTTP ${res.status}).`,
        });
        return;
      }
      setResult({
        ok: data.ok === true && res.ok,
        logs: data.logs ?? [],
        error: data.ok === true && res.ok ? undefined : (data.error || `Sync failed (HTTP ${res.status}).`),
      });
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
           disabled={routersLoading || !!routersError}
        >
          <option value="" disabled>
            {routersLoading ? "Loading assigned routers…" : routersError ? "Routers unavailable" : "Select router…"}
           </option>
          {routers.map(r => (
            <option key={r.id} value={r.id}>
              {r.name}{context?.reseller && assignedPortsByRouter.get(r.id)?.length
                ? ` · VLAN ${assignedPortsByRouter.get(r.id)!.join(", ")}`
                : ""} — {r.host || r.vpn_ip || "?"} [{r.status === "online" || r.status === "connected" ? "online" : "offline"}]
            </option>
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

      {routersError && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, fontSize: "0.75rem", color: "#f87171" }}>
          <AlertTriangle size={13} />
          <span>{routersError instanceof Error ? routersError.message : "Assigned routers could not be loaded."}</span>
        </div>
      )}
      {!routersLoading && !routersError && routers.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, fontSize: "0.75rem", color: "#fbbf24" }}>
          <AlertTriangle size={13} />
          <span>No active router is available for this account&apos;s assigned VLAN service.</span>
        </div>
      )}

      {/* Warnings */}
      {selectedRouter && !selectedRouter.host && !selectedRouter.vpn_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, fontSize: "0.75rem", color: "#fbbf24" }}>
          <AlertTriangle size={13} />
          <span>No IP found for this router. Go to <strong>Routers</strong> to save its IP or wait for a heartbeat.</span>
        </div>
      )}
      {selectedRouter && !selectedRouter.host && selectedRouter.vpn_ip && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, fontSize: "0.75rem", color: "var(--isp-accent)" }}>
          <span>Using management VPN IP <strong style={{ fontFamily: "monospace" }}>{selectedRouter.vpn_ip}</strong></span>
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
          host={selectedRouter?.host || selectedRouter?.vpn_ip || ""}
          bridgeIp={selectedRouter?.vpn_ip ?? undefined}
          username={selectedRouter?.router_username || "admin"}
          password={selectedRouter?.router_secret || ""}
          routerId={selectedRouter?.id}
          routerName={selectedRouter?.name}
          routerStatus={selectedRouter?.status}
          onClose={() => setResult(null)}
          onRetry={handleSync}
        />
      )}
    </div>
  );
}
