import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Check, Copy, Wifi, WifiOff,
  Loader2, Router, Cpu, Zap, Settings2, ArrowRight,
} from "lucide-react";

/* ─── DB types ─────────────────────────────────────────────── */
interface DbAdmin { id: number; name: string; subdomain: string | null; }

/* ─── Constants ─────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 12 * 60 * 1000;

/* ─── Helpers ─────────────────────────────────────────────── */
function isFreshlyConnected(r: DbRouter): boolean {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}

function isInstalled(r: DbRouter): boolean {
  return isFreshlyConnected(r) && (r.status === "online" || r.status === "connected");
}

/* ─── Copy button ─────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      })}
      style={{
        marginTop: "0.5rem",
        display: "inline-flex", alignItems: "center", gap: "0.375rem",
        padding: "0.35rem 0.875rem", borderRadius: 6,
        background: copied ? "rgba(6,182,212,0.15)" : "rgba(99,102,241,0.2)",
        border: `1px solid ${copied ? "#06b6d4" : "rgba(99,102,241,0.4)"}`,
        color: copied ? "#06b6d4" : "#a5b4fc",
        fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Command block ─────────────────────────────────────────── */
function CmdBlock({ step, title, cmd }: { step: number; title: string; cmd: string }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{
          width: 20, height: 20, borderRadius: "50%",
          background: "linear-gradient(135deg,#06b6d4,#0284c7)",
          color: "white", fontSize: "0.65rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{step}</span>
        <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--isp-text)" }}>{title}</span>
      </div>
      <div style={{ background: "#070c14", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, padding: "0.75rem 1rem" }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#c7d2fe", wordBreak: "break-all", lineHeight: 1.6 }}>
          {cmd}
        </code>
      </div>
      <CopyBtn text={cmd} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────── */
export default function SelfInstall() {
  /* ── Query params ── */
  const params        = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;

  /* ── Track which router we're currently watching (latch so it stays visible after connect) ── */
  const [watchId, setWatchId] = useState<number | null>(null);

  /* ── Admin subdomain ── */
  const { data: adminData } = useQuery<DbAdmin>({
    queryKey: ["admin_subdomain_si", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_admins").select("id,name,subdomain").eq("id", ADMIN_ID).single();
      if (error) throw error;
      return data as DbAdmin;
    },
    staleTime: 60_000,
  });

  /* ── Routers — auto-refetch every 6 s ── */
  const { data: routers = [], isLoading } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_si2", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,last_seen,ros_version,model")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as DbRouter[];
    },
    refetchInterval: 6_000,
  });

  /* ── Find the pending router (first one not yet installed) ── */
  const pendingRouter = routers.find(r => !isInstalled(r)) ?? null;

  /* ── Latch onto the first pending router we see ── */
  useEffect(() => {
    if (!reconfigureId && pendingRouter && !watchId) {
      setWatchId(pendingRouter.id);
    }
  }, [pendingRouter?.id]);

  /* ── Target router: reconfigure param > latched pending > latest pending ── */
  const targetRouter: DbRouter | null =
    reconfigureId
      ? (routers.find(r => r.id === reconfigureId) ?? null)
      : (watchId ? (routers.find(r => r.id === watchId) ?? pendingRouter) : pendingRouter);

  const connected    = targetRouter ? isInstalled(targetRouter) : false;
  const isReconfigure = !!reconfigureId;

  /* ── Script URL (always mainhotspot.rsc) ── */
  const adminSubdomain = adminData?.subdomain ?? "";
  const scriptHost     = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;
  const fetchCmd  = `/tool fetch url="${scriptHost}/api/scripts/mainhotspot.rsc" dst-path=mainhotspot.rsc mode=https`;
  const importCmd = `/import mainhotspot.rsc`;

  const installedCount = routers.filter(isInstalled).length;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 820 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            {isReconfigure ? "Reconfigure Router" : "Self Install"}
          </h1>
          {adminSubdomain && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)",
              borderRadius: 20, padding: "0.2rem 0.75rem",
              fontSize: "0.72rem", color: "#06b6d4", fontWeight: 600,
            }}>
              <Wifi size={11} />{adminSubdomain}.{BASE_DOMAIN}
            </span>
          )}
          {!isReconfigure && routers.length > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 20, padding: "0.2rem 0.75rem",
              fontSize: "0.72rem", color: "var(--isp-text-muted)", fontWeight: 600,
            }}>
              {installedCount}/{routers.length} installed
            </span>
          )}
        </div>

        <NetworkTabs active="self-install" />

        {/* ── Reconfigure banner ── */}
        {isReconfigure && targetRouter && (
          <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.6, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Settings2 size={14} />
            <span>Reconfiguring <strong>{targetRouter.name}</strong> — running the script re-applies all settings without creating a duplicate record.</span>
          </div>
        )}

        {/* ── Commands ── */}
        <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)", borderRadius: 12, padding: "1.5rem 1.75rem", opacity: isLoading ? 0.6 : 1, transition: "opacity 0.2s" }}>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.83rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
            {isReconfigure
              ? <>Open <strong style={{ color: "var(--isp-text)" }}>Winbox → Terminal</strong> on <strong style={{ color: "var(--isp-text)" }}>{targetRouter?.name}</strong> and run:</>
              : <>Open <strong style={{ color: "var(--isp-text)" }}>Winbox → Terminal</strong> or <strong style={{ color: "var(--isp-text)" }}>SSH</strong> into the MikroTik and run these two commands:</>}
          </p>
          <CmdBlock step={1} title="Download configuration" cmd={fetchCmd} />
          <CmdBlock step={2} title="Run configuration"      cmd={importCmd} />
        </div>

        {/* ── Connection status (not shown for reconfigure) ── */}
        {!isReconfigure && (
          <div style={{
            background: "var(--isp-section)",
            border: `1px solid ${connected ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 12, padding: "1.25rem 1.5rem",
            transition: "border-color 0.4s",
          }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.875rem" }}>
              Connection Status
            </div>

            {connected && targetRouter ? (
              /* ── Connected card ── */
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, padding: "1rem 1.125rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(34,197,94,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Router size={20} style={{ color: "#22c55e" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                    <Zap size={13} style={{ color: "#22c55e" }} />
                    <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#22c55e" }}>Router Connected!</span>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--isp-text)", fontWeight: 600 }}>{targetRouter.name}</div>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                    {targetRouter.model && (
                      <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>
                        <Cpu size={10} style={{ display: "inline", marginRight: 3 }} />{targetRouter.model}
                      </span>
                    )}
                    {targetRouter.ros_version && (
                      <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>
                        RouterOS v{targetRouter.ros_version}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ── Waiting ── */
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                {targetRouter ? (
                  <Loader2 size={15} style={{ color: "#06b6d4", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                ) : (
                  <WifiOff size={15} style={{ color: "#64748b", flexShrink: 0 }} />
                )}
                <div style={{ fontSize: "0.83rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
                  {targetRouter
                    ? <span>Waiting for <strong style={{ color: "var(--isp-text)" }}>{targetRouter.name}</strong> to connect… checking every 6 s</span>
                    : <span>Run the commands above — the router will appear here automatically once it connects.</span>
                  }
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Next button ── */}
        {!isReconfigure && (
          <div style={{
            background: "var(--isp-card)", border: `1px solid ${connected ? "rgba(6,182,212,0.25)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 12, padding: "1.125rem 1.5rem",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
            transition: "border-color 0.4s",
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--isp-text)", marginBottom: "0.2rem" }}>
                Configure Bridge Ports
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
                Assign router ports to the hotspot bridge — activates once the router is connected.
              </div>
            </div>
            <button
              disabled={!connected || !targetRouter}
              onClick={() => { if (targetRouter) window.location.href = `/admin/network/bridge-ports?routerId=${targetRouter.id}`; }}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.625rem 1.625rem", borderRadius: 8,
                background: connected && targetRouter
                  ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                  : "rgba(255,255,255,0.06)",
                border: connected && targetRouter ? "none" : "1px solid rgba(255,255,255,0.1)",
                color: connected && targetRouter ? "white" : "var(--isp-text-muted)",
                fontWeight: 700, fontSize: "0.875rem",
                cursor: connected && targetRouter ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                boxShadow: connected && targetRouter ? "0 4px 14px rgba(6,182,212,0.35)" : "none",
                transition: "all 0.25s", whiteSpace: "nowrap",
              }}
            >
              Next <ArrowRight size={15} />
            </button>
          </div>
        )}

        {/* ── Router list ── */}
        {routers.length > 0 && (
          <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border-subtle)", borderRadius: 12, padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
              {routers.length} Router{routers.length !== 1 ? "s" : ""} on this account
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {routers.map((r, i) => {
                const inst = isInstalled(r);
                const isCurrent = targetRouter?.id === r.id;
                return (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: "0.625rem",
                    padding: "0.45rem 0.75rem", borderRadius: 8,
                    background: isCurrent ? "rgba(6,182,212,0.05)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isCurrent ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.05)"}`,
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                      background: inst ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.1)",
                      border: `1px solid ${inst ? "rgba(34,197,94,0.4)" : "rgba(248,113,113,0.3)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {inst
                        ? <Check size={9} strokeWidth={3} style={{ color: "#22c55e" }} />
                        : <span style={{ fontSize: "0.45rem", color: "#f87171", lineHeight: 1 }}>●</span>}
                    </span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text)", minWidth: 80 }}>
                      {i + 1}. {r.name}
                    </span>
                    <span style={{ fontSize: "0.68rem", color: inst ? "#22c55e" : "#94a3b8", fontFamily: "monospace" }}>
                      {inst ? "installed" : "pending"}
                    </span>
                    {isCurrent && (
                      <span style={{ marginLeft: "auto", fontSize: "0.62rem", fontWeight: 700, color: "#06b6d4", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 4, padding: "0.1rem 0.4rem" }}>
                        current
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Note ── */}
        <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.77rem", color: "#fbbf24", lineHeight: 1.65 }}>
          <strong>Note:</strong> The router must have internet access to reach{" "}
          <code style={{ fontFamily: "monospace" }}>{adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}</code>.
          Re-running the script on an existing router updates its config without creating a duplicate.
        </div>

      </div>
    </AdminLayout>
  );
}
