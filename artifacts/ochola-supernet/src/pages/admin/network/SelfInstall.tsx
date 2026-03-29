import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Check, Copy, RefreshCw, Wifi, WifiOff,
  Loader2, Router, Cpu, Zap, Plus, Settings2,
} from "lucide-react";

/* ─── DB types ────────────────────────────────────────────────── */
interface DbAdmin {
  id: number;
  name: string;
  subdomain: string | null;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 12 * 60 * 1000;

function slugify(str: string) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function isFreshlyConnected(r: DbRouter): boolean {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}

/* A router is "installed" if it sent a heartbeat recently AND status is online/connected */
function isInstalled(r: DbRouter): boolean {
  return isFreshlyConnected(r) && (r.status === "online" || r.status === "connected");
}

/* ─── Copy button ─────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      style={{
        marginTop: "0.625rem",
        display: "inline-flex", alignItems: "center", gap: "0.375rem",
        padding: "0.4rem 1rem", borderRadius: 6,
        background: copied ? "rgba(6,182,212,0.15)" : "#1a3a8a",
        border: `1px solid ${copied ? "#06b6d4" : "#1a3a8a"}`,
        color: copied ? "#06b6d4" : "white",
        fontSize: "0.8rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s",
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Command block ───────────────────────────────────────────── */
function CmdBlock({ step, title, command }: { step: number; title: string; command: string }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", background: "#06b6d4",
          color: "white", fontSize: "0.7rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{step}</span>
        {title}
      </h3>
      <div style={{ background: "#0a0f1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.875rem 1.125rem" }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "#e2e8f0", wordBreak: "break-all" }}>
          {command}
        </code>
      </div>
      <CopyBtn text={command} />
    </div>
  );
}

/* ─── Router detected card ────────────────────────────────────── */
function RouterCard({ router }: { router: DbRouter }) {
  const model = router.model || "MikroTik Router";
  return (
    <div style={{
      background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)",
      borderRadius: 12, padding: "1.125rem 1.375rem",
      display: "flex", alignItems: "center", gap: "1.125rem",
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: "rgba(34,197,94,0.12)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Router size={22} style={{ color: "#22c55e" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
          <Zap size={13} style={{ color: "#22c55e" }} />
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#22c55e" }}>Router Connected!</span>
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--isp-text)", fontWeight: 600 }}>{router.name}</div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
            <Cpu size={10} style={{ display: "inline", marginRight: 3 }} />
            {model}
          </span>
          {router.ros_version && (
            <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
              RouterOS v{router.ros_version}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */
export default function SelfInstall() {
  const qc       = useQueryClient();
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polling, setPolling] = useState(false);

  /* Read query params */
  const params        = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;

  /* New router name input (used when all existing routers are installed) */
  const [newName, setNewName]       = useState("");
  const [creating, setCreating]     = useState(false);
  const [createdId, setCreatedId]   = useState<number | null>(null);

  /* 1. Admin subdomain */
  const { data: adminData, isLoading: adminLoading } = useQuery<DbAdmin>({
    queryKey: ["admin_subdomain", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins")
        .select("id, name, subdomain")
        .eq("id", ADMIN_ID)
        .single();
      if (error) throw error;
      return data as DbAdmin;
    },
    staleTime: 60_000,
  });

  /* 2. Router list — refetch every 6 s */
  const { data: routers = [], isLoading: routersLoading, refetch: refetchRouters } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_si", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,last_seen,router_secret,ros_version,model")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as DbRouter[];
    },
    refetchInterval: 6_000,
  });

  /* ── Determine which router to install ──────────────────────────
     Priority:
     1. ?reconfigure=<id>  → specific router the admin wants to re-run setup for
     2. createdId           → just created via the new-router form
     3. First pending router (never connected OR stale)
     4. null               → all existing routers are installed, show new-router form
  ─────────────────────────────────────────────────────────────── */
  const reconfigureRouter = reconfigureId ? (routers.find(r => r.id === reconfigureId) ?? null) : null;
  const createdRouter     = createdId     ? (routers.find(r => r.id === createdId)     ?? null) : null;
  const pendingRouter     = routers.find(r => !isInstalled(r)) ?? null;

  const targetRouter: DbRouter | null =
    reconfigureRouter ?? createdRouter ?? pendingRouter ?? null;

  const allInstalled  = routers.length > 0 && !pendingRouter;
  const showNewForm   = !reconfigureId && !createdId && allInstalled;
  const isReconfigure = !!reconfigureId;

  /* Is the target router freshly connected? */
  const connected = targetRouter ? isFreshlyConnected(targetRouter) : false;

  /* Script values */
  const adminSubdomain = adminData?.subdomain ?? slugify(adminData?.name ?? "") ?? "";
  const scriptHost     = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;
  const scriptBase = `${scriptHost}/api/scripts`;

  const scriptSlug = targetRouter ? slugify(targetRouter.name) : "mainhotspot";
  const scriptName = `${scriptSlug}.rsc`;
  const fetchCmd   = `/tool fetch url="${scriptBase}/${scriptName}" dst-path=${scriptName} mode=https`;
  const importCmd  = `/import ${scriptName}`;

  /* Default new router name suggestion */
  useEffect(() => {
    if (!newName && routers.length > 0) {
      setNewName(`Router ${routers.length + 1}`);
    }
  }, [routers.length]);

  /* Create a new router record in Supabase */
  const createNewRouter = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const autoSecret = btoa(`${ADMIN_ID}:${Date.now()}:ocholanet`)
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 48);
      const { data, error } = await supabase
        .from("isp_routers")
        .insert({
          admin_id:         ADMIN_ID,
          name:             newName.trim(),
          host:             "",
          router_username:  "admin",
          router_secret:    autoSecret,
          bridge_interface: "bridge",
          bridge_ip:        "192.168.88.1",
          status:           "offline",
        })
        .select("id")
        .single();
      if (error) throw error;
      setCreatedId((data as { id: number }).id);
      qc.invalidateQueries({ queryKey: ["isp_routers_si", ADMIN_ID] });
    } finally {
      setCreating(false);
    }
  };

  /* Start polling */
  const startPolling = () => {
    setPolling(true);
    refetchRouters();
  };

  /* Cleanup */
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const isLoading = adminLoading || routersLoading;
  const installedCount = routers.filter(isInstalled).length;

  return (
    <AdminLayout>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 860 }}>

        {/* ── Page header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            {isReconfigure ? "Reconfigure Router" : "Self Install"}
          </h1>
          {targetRouter && (
            <span style={{
              background: isReconfigure ? "rgba(251,191,36,0.12)" : "rgba(6,182,212,0.15)",
              border: `1px solid ${isReconfigure ? "rgba(251,191,36,0.35)" : "rgba(6,182,212,0.35)"}`,
              color: isReconfigure ? "#fbbf24" : "#06b6d4",
              borderRadius: 6, padding: "0.2rem 0.7rem",
              fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
            }}>
              {isReconfigure ? <Settings2 size={11} style={{ display: "inline", marginRight: 4 }} /> : null}
              {scriptName}
            </span>
          )}
          {/* Router N of M counter */}
          {!isReconfigure && routers.length > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20, padding: "0.2rem 0.75rem",
              fontSize: "0.72rem", color: "var(--isp-text-muted)", fontWeight: 600,
            }}>
              {installedCount} of {routers.length + (showNewForm && createdId === null ? 0 : 0)} installed
            </span>
          )}
          {adminSubdomain && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)",
              borderRadius: 20, padding: "0.2rem 0.75rem",
              fontSize: "0.75rem", color: "#06b6d4", fontWeight: 600,
            }}>
              <Wifi size={11} /> {adminSubdomain}.{BASE_DOMAIN}
            </span>
          )}
        </div>

        <NetworkTabs active="self-install" />

        {/* ── Reconfigure notice ── */}
        {isReconfigure && targetRouter && (
          <div style={{
            background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 10, padding: "0.875rem 1.125rem",
            fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.6,
          }}>
            <strong>Reconfiguring:</strong> {targetRouter.name} — re-running the setup script will
            re-apply hotspot, VPN, and portal settings without creating a duplicate router record.
          </div>
        )}

        {/* ── New router form (when all existing are installed) ── */}
        {showNewForm && (
          <div style={{
            background: "var(--isp-card)", border: "1px solid rgba(6,182,212,0.25)",
            borderRadius: 12, padding: "1.25rem 1.5rem",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Plus size={12} /> Add New Router ({routers.length + 1}{routers.length === 1 ? "st" : routers.length === 2 ? "nd" : routers.length === 3 ? "rd" : "th"} router)
            </div>
            <p style={{ margin: "0 0 0.875rem", fontSize: "0.82rem", color: "var(--isp-text-muted)", lineHeight: 1.6 }}>
              All existing {routers.length} router{routers.length !== 1 ? "s" : ""} are installed.
              Enter a name for the new router — this creates its record and generates a unique setup script.
            </p>
            <div style={{ display: "flex", gap: "0.625rem", alignItems: "center" }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={`Router ${routers.length + 1}`}
                style={{
                  background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                  borderRadius: 7, padding: "0.5rem 0.875rem",
                  color: "var(--isp-text)", fontSize: "0.85rem",
                  fontFamily: "inherit", outline: "none", minWidth: 220,
                }}
                onKeyDown={e => e.key === "Enter" && createNewRouter()}
              />
              <button
                onClick={createNewRouter}
                disabled={creating || !newName.trim()}
                style={{
                  display: "flex", alignItems: "center", gap: "0.375rem",
                  padding: "0.5rem 1.125rem", borderRadius: 7,
                  background: creating || !newName.trim()
                    ? "rgba(255,255,255,0.07)"
                    : "linear-gradient(135deg,#06b6d4,#0284c7)",
                  border: "none",
                  color: creating || !newName.trim() ? "var(--isp-text-muted)" : "white",
                  fontWeight: 700, fontSize: "0.82rem",
                  cursor: creating || !newName.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {creating
                  ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Creating…</>
                  : <><Plus size={13} /> Create Router</>}
              </button>
            </div>
          </div>
        )}

        {/* ── Intro / commands ── */}
        {(targetRouter || routers.length === 0) && (
          <>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
              {isReconfigure
                ? <>Run these commands on <strong style={{ color: "var(--isp-text)" }}>{targetRouter?.name}</strong> to re-apply the full configuration.</>
                : <>Run the two commands below inside your MikroTik terminal (
                    <strong style={{ color: "var(--isp-text)" }}>Winbox → Terminal</strong>
                    {" "}or{" "}
                    <strong style={{ color: "var(--isp-text)" }}>SSH</strong>). The script will automatically configure your router
                    and link it to the billing system.</>
              }
            </p>

            <div style={{
              background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
              borderRadius: 12, padding: "1.5rem 1.75rem",
              opacity: isLoading ? 0.5 : 1, transition: "opacity 0.2s",
            }}>
              <CmdBlock step={1} title="Download configuration" command={fetchCmd} />
              <CmdBlock step={2} title="Run configuration" command={importCmd} />

              {!connected && !isReconfigure && (
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    onClick={startPolling}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.55rem 1.25rem", borderRadius: 8,
                      background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
                      color: "#06b6d4", fontWeight: 700, fontSize: "0.82rem",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <Check size={14} /> I've run the commands — check connection
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Connection status (skip for reconfigure) ── */}
        {!isReconfigure && targetRouter && (
          <div style={{
            background: "var(--isp-section)", border: `1px solid ${connected ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 12, padding: "1.25rem 1.5rem",
            transition: "border-color 0.4s",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.875rem" }}>
              Connection Status
            </div>

            {connected && targetRouter ? (
              <RouterCard router={targetRouter} />
            ) : polling || routersLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
                <span>Waiting for <strong style={{ color: "var(--isp-text)" }}>{targetRouter.name}</strong> to connect…</span>
                <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginLeft: "auto" }}>
                  checking every 6 s
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
                <WifiOff size={15} style={{ color: "#64748b" }} />
                <span>Not connected yet — run the commands above, then click "I've run the commands".</span>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Next (only shown if target router exists and not reconfigure) ── */}
        {!isReconfigure && targetRouter && (
          <div style={{
            background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
            borderRadius: 12, padding: "1.25rem 1.5rem",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
              Step 3: Configure Bridge Ports
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--isp-text-muted)", margin: "0 0 1rem", lineHeight: 1.6 }}>
              Once your router is connected, click <strong style={{ color: "var(--isp-text)" }}>Next</strong> to
              load the router's physical ports and configure which ones are bridged to the hotspot.
            </p>
            <button
              disabled={!connected || !targetRouter}
              onClick={() => {
                if (targetRouter) window.location.href = `/admin/network/bridge-ports?routerId=${targetRouter.id}`;
              }}
              style={{
                padding: "0.625rem 1.75rem", borderRadius: 8,
                background: connected && targetRouter
                  ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                  : "rgba(255,255,255,0.07)",
                border: connected && targetRouter ? "none" : "1px solid rgba(255,255,255,0.12)",
                color: connected && targetRouter ? "white" : "var(--isp-text-muted)",
                fontWeight: 700, fontSize: "0.875rem",
                cursor: connected && targetRouter ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                boxShadow: connected && targetRouter ? "0 4px 12px rgba(6,182,212,0.3)" : "none",
                transition: "all 0.2s",
              }}
            >
              {connected && targetRouter ? "Next → Configure Ports" : "Waiting for router…"}
            </button>
          </div>
        )}

        {/* ── Existing routers list ── */}
        {routers.length > 0 && (
          <div style={{
            background: "var(--isp-section)", border: "1px solid var(--isp-border-subtle)",
            borderRadius: 12, padding: "1rem 1.25rem",
          }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
              {routers.length} Router{routers.length !== 1 ? "s" : ""} on this account
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {routers.map((r, i) => {
                const inst = isInstalled(r);
                const isCurrent = targetRouter?.id === r.id;
                return (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: "0.625rem",
                    padding: "0.5rem 0.75rem", borderRadius: 8,
                    background: isCurrent ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isCurrent ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      background: inst ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.12)",
                      border: `1px solid ${inst ? "rgba(34,197,94,0.35)" : "rgba(248,113,113,0.3)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {inst
                        ? <Check size={10} strokeWidth={3} style={{ color: "#22c55e" }} />
                        : <span style={{ fontSize: "0.5rem", color: "#f87171" }}>●</span>}
                    </span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text)" }}>
                      Router {i + 1}: {r.name}
                    </span>
                    <span style={{ fontSize: "0.68rem", fontFamily: "monospace", color: "var(--isp-text-muted)" }}>
                      {slugify(r.name)}.rsc
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: "0.63rem", fontWeight: 700, color: "#06b6d4", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 4, padding: "0.1rem 0.4rem", marginLeft: "auto" }}>
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
        <div style={{
          background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
          borderRadius: 8, padding: "0.75rem 1.125rem",
          fontSize: "0.78rem", color: "#fbbf24", lineHeight: 1.6,
        }}>
          <strong>Note:</strong> The MikroTik must have internet access to download and run the script.
          Ensure it can reach{" "}
          <code style={{ fontFamily: "monospace" }}>
            {adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}
          </code>{" "}
          before running Step 1. Each router gets a unique script — re-running the script on an existing router updates its config without creating a duplicate.
        </div>

      </div>
    </AdminLayout>
  );
}
