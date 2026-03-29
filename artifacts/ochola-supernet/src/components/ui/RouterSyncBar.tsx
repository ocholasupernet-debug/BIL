import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

/* ─── Router type from Supabase ─── */
interface DbRouterMin {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
}

/* ─── Log panel ─── */
function LogPanel({ logs, ok, error, onClose }: {
  logs: string[]; ok: boolean | null; error?: string; onClose: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const borderColor = ok === false ? "rgba(248,113,113,0.3)" : ok === true ? "rgba(74,222,128,0.3)" : "rgba(6,182,212,0.25)";
  const headerBg    = ok === false ? "rgba(248,113,113,0.06)" : ok === true ? "rgba(74,222,128,0.06)" : "rgba(6,182,212,0.05)";
  const iconColor   = ok === false ? "#f87171" : ok === true ? "#4ade80" : "#22d3ee";
  const label       = ok === null ? "Syncing…" : ok === true ? "Sync Complete" : "Sync Failed";

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", background: headerBg }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {ok === null  && <Loader2 size={14} style={{ color: "#22d3ee", animation: "spin 1s linear infinite" }} />}
          {ok === true  && <CheckCircle2 size={14} style={{ color: "#4ade80" }} />}
          {ok === false && <AlertTriangle size={14} style={{ color: "#f87171" }} />}
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: iconColor }}>{label}</span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem", borderRadius: 5 }}>✕ close</button>
      </div>
      {error && (
        <div style={{ padding: "0.5rem 1rem", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.15)", fontSize: "0.75rem", color: "#f87171", lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      <div style={{ padding: "0.625rem 1rem", background: "#080c10", maxHeight: 220, overflow: "auto", fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.75 }}>
        {logs.map((line, i) => {
          const c = line.startsWith("✅") ? "#4ade80" : line.startsWith("❌") ? "#f87171" : line.startsWith("✓") ? "#a3e635" : line.startsWith("▶") ? "#22d3ee" : line.startsWith("  ") ? "#64748b" : "#94a3b8";
          return <div key={i} style={{ color: c }}>{line || " "}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ─── Props ─── */
export interface RouterSyncBarProps {
  /** Label shown in the bar */
  label: string;
  /** Short description */
  description: string;
  /** Icon element */
  icon: React.ReactNode;
  /** API endpoint to POST to (relative) */
  endpoint: string;
  /** Function that builds the body payload given the selected router */
  buildPayload: (router: DbRouterMin) => Record<string, unknown>;
  /** Colour accent */
  color?: string;
}

export function RouterSyncBar({ label, description, icon, endpoint, buildPayload, color = "#06b6d4" }: RouterSyncBarProps) {
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [syncing,    setSyncing]        = useState(false);
  const [result,     setResult]         = useState<{ logs: string[]; ok: boolean; error?: string } | null>(null);
  const [showMeta,   setShowMeta]       = useState(false);

  const { data: routers = [] } = useQuery<DbRouterMin[]>({
    queryKey: ["isp_routers_sync"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("id,name,host,status,router_username,router_secret").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouterMin[];
    },
  });

  const selectedRouter = routers.find(r => r.id === selectedId) ?? null;

  const handleSync = async () => {
    if (!selectedRouter) return;
    setSyncing(true);
    setResult(null);
    try {
      const payload = {
        host:     selectedRouter.host,
        username: selectedRouter.router_username || "admin",
        password: selectedRouter.router_secret   || "",
        ...buildPayload(selectedRouter),
      };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json() as { ok: boolean; logs: string[]; error?: string };
      setResult(data);
    } catch (err) {
      setResult({ ok: false, logs: [], error: String(err) });
    } finally {
      setSyncing(false);
    }
  };

  const selStyle: React.CSSProperties = {
    background: "var(--isp-inner-card,rgba(255,255,255,0.04))", border: "1px solid var(--isp-border,rgba(255,255,255,0.1))",
    borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text,#e2e8f0)", fontSize: "0.8rem",
    flex: "1 1 200px", maxWidth: 280, fontFamily: "inherit", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ background: `linear-gradient(135deg,${color}10,${color}04)`, border: `1px solid ${color}33`, borderRadius: 14, padding: "1rem 1.25rem" }}>
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
          disabled={syncing || !selectedRouter || !selectedRouter.host}
          style={{
            display: "flex", alignItems: "center", gap: "0.45rem",
            padding: "0.575rem 1.25rem", borderRadius: 10,
            background: syncing || !selectedRouter || !selectedRouter.host ? `${color}18` : `linear-gradient(135deg,${color},${color}cc)`,
            border: "none", color: syncing || !selectedRouter || !selectedRouter.host ? "#94a3b8" : "white",
            fontWeight: 800, fontSize: "0.85rem", cursor: syncing || !selectedRouter || !selectedRouter.host ? "not-allowed" : "pointer",
            fontFamily: "inherit", boxShadow: syncing || !selectedRouter || !selectedRouter.host ? "none" : `0 4px 12px ${color}40`,
            transition: "all 0.2s", whiteSpace: "nowrap",
          }}
        >
          {syncing
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Syncing…</>
            : <><RefreshCw size={14} /> Sync Now</>
          }
        </button>
      </div>

      {/* ── No host warning ── */}
      {selectedRouter && !selectedRouter.host && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.625rem", padding: "0.5rem 0.875rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, fontSize: "0.75rem", color: "#fbbf24" }}>
          <AlertTriangle size={13} />
          <span>No API host set for this router — open <strong>Settings → Routers</strong>, expand the API panel and save the router's IP address.</span>
        </div>
      )}

      {/* ── Router metadata strip ── */}
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

      {/* ── Log panel ── */}
      {(syncing || result) && (
        <LogPanel
          logs={result?.logs ?? (syncing ? ["▶ Connecting…"] : [])}
          ok={result ? result.ok : null}
          error={result?.error}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
