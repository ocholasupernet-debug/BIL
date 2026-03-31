import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Check, Copy, Wifi, Loader2, Router as RouterIcon,
  Zap, Settings2, ArrowRight, Terminal, ChevronRight,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────── */
interface FullRouter extends DbRouter { router_secret: string | null; }
interface DbAdmin { id: number; name: string; subdomain: string | null; }

/* ─── Constants ─────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 12 * 60 * 1000;

/* ─── Helpers ────────────────────────────────────────────────── */
function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function isInstalled(r: DbRouter) {
  if (!r.last_seen) return false;
  return (Date.now() - new Date(r.last_seen).getTime() < STALE_MS)
    && (r.status === "online" || r.status === "connected");
}

/* ─── Copy button ────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2200);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.35rem 0.875rem", borderRadius: 6,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(99,102,241,0.18)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : "rgba(99,102,241,0.4)"}`,
        color: copied ? "#4ade80" : "#a5b4fc",
        fontSize: "0.74rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Command block ──────────────────────────────────────────── */
function CmdBlock({ step, title, cmd }: { step: number; title: string; cmd: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "linear-gradient(135deg,#06b6d4,#0284c7)",
          color: "white", fontSize: "0.68rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{step}</span>
        <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text)" }}>{title}</span>
      </div>
      <div style={{
        background: "#060b12",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8, padding: "0.875rem 1rem",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem",
      }}>
        <code style={{
          fontFamily: "monospace", fontSize: "0.8rem", color: "#c7d2fe",
          wordBreak: "break-all", lineHeight: 1.7, flex: 1,
        }}>
          {cmd}
        </code>
        <div style={{ flexShrink: 0, paddingTop: "0.1rem" }}>
          <CopyBtn text={cmd} />
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════ PAGE ════════════════════════════ */
export default function SelfInstall() {
  const qc = useQueryClient();

  /* URL params */
  const params        = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;

  /* Phase: idle → generated */
  const [phase, setPhase]             = useState<"idle" | "generated">(reconfigureId ? "generated" : "idle");
  const [activeRouterId, setActiveRouterId] = useState<number | null>(reconfigureId);

  /* Admin */
  const { data: adminData } = useQuery<DbAdmin>({
    queryKey: ["admin_si_sub", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins").select("id,name,subdomain").eq("id", ADMIN_ID).single();
      if (error) throw error;
      return data as DbAdmin;
    },
    staleTime: 60_000,
  });

  /* Routers — poll every 8 s so Next button gets the routerId once record appears */
  const { data: routers = [], isLoading: routersLoading } = useQuery<FullRouter[]>({
    queryKey: ["isp_routers_si4", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,last_seen,ros_version,model,router_secret,admin_id,ip_address,router_username,created_at,updated_at")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as FullRouter[];
    },
    refetchInterval: 8_000,
  });

  /* Computed values */
  const adminSubdomain = adminData?.subdomain ?? "";
  const nameBase       = slugify(adminData?.name ?? "") || adminSubdomain || "router";
  const scriptHost     = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;

  const installedCount = routers.filter(isInstalled).length;
  const nextNumber     = routers.length + 1;
  const nextName       = `${nameBase}${nextNumber}`;
  const nextSlug       = slugify(nextName);

  /* The router whose config is being shown */
  const activeRouter = activeRouterId
    ? (routers.find(r => r.id === activeRouterId) ?? null)
    : null;

  const displayName = activeRouter?.name ?? nextName;
  const displaySlug = activeRouter ? slugify(activeRouter.name) : nextSlug;
  const scriptFile  = `${displaySlug}.rsc`;
  const fetchCmd    = `/tool fetch url="${scriptHost}/api/scripts/${scriptFile}" dst-path=${scriptFile} mode=https`;
  const importCmd   = `/import ${scriptFile}`;

  /* When reconfiguring, pre-set activeRouterId from URL param */
  useEffect(() => {
    if (reconfigureId && routers.length > 0 && !activeRouterId) {
      setActiveRouterId(reconfigureId);
    }
  }, [reconfigureId, routers.length]);

  /* After generate: poll for the router record to appear (for the Next button routerId) */
  useEffect(() => {
    if (phase !== "generated" || activeRouterId || !routers.length) return;
    const match = routers.find(r => slugify(r.name) === nextSlug);
    if (match) setActiveRouterId(match.id);
  }, [routers, phase, nextSlug, activeRouterId]);

  /* ── Generate: show commands + create router record via server endpoint ── */
  const handleGenerate = async () => {
    /* Show commands immediately so the UI is responsive */
    setPhase("generated");

    /* Call the server-side ensure endpoint (bypasses Supabase RLS) */
    try {
      const res = await fetch("/api/admin/router/ensure", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ adminId: ADMIN_ID, routerName: nextName }),
      });
      const json = await res.json() as { ok: boolean; router?: { id: number } };
      if (json.ok && json.router?.id) {
        setActiveRouterId(json.router.id);
      }
    } catch {
      /* If the endpoint fails, the scripts-route will auto-create when MikroTik fetches */
    } finally {
      qc.invalidateQueries({ queryKey: ["isp_routers_si4", ADMIN_ID] });
    }
  };

  const isReconfigure = !!reconfigureId;
  const routerIdForNext = activeRouterId ?? pendingRouter?.id ?? null;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem", maxWidth: 820 }}>

        {/* ── Header ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
              {isReconfigure ? "Reconfigure Router" : "Add Router"}
            </h1>
            {adminSubdomain && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "0.35rem",
                background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.28)",
                borderRadius: 20, padding: "0.18rem 0.7rem",
                fontSize: "0.72rem", color: "#06b6d4", fontWeight: 600,
              }}>
                <Wifi size={11} />{adminSubdomain}.{BASE_DOMAIN}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>
            {isReconfigure
              ? "Re-apply the setup script on an existing router."
              : `${installedCount} of ${routers.length} router${routers.length !== 1 ? "s" : ""} installed`}
          </p>
        </div>

        <NetworkTabs active="add-router" />

        {/* ═══ IDLE: name card + generate button ═══ */}
        {phase === "idle" && !isReconfigure && (
          <div style={{
            background: "var(--isp-card)",
            border: "1px solid var(--isp-border-subtle)",
            borderRadius: 14, overflow: "hidden",
          }}>
            {/* Router name banner */}
            <div style={{
              padding: "1rem 1.375rem",
              background: "rgba(6,182,212,0.05)",
              borderBottom: "1px solid rgba(6,182,212,0.12)",
              display: "flex", alignItems: "center", gap: "0.875rem",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(6,182,212,0.12)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <RouterIcon size={18} style={{ color: "#06b6d4" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.18rem" }}>
                  Next router to add
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {routersLoading
                    ? <Loader2 size={14} style={{ color: "#64748b", animation: "spin 1s linear infinite" }} />
                    : <span style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--isp-text)" }}>{nextName}</span>
                  }
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700,
                    color: "#06b6d4",
                    background: "rgba(6,182,212,0.1)",
                    border: "1px solid rgba(6,182,212,0.28)",
                    borderRadius: 5, padding: "0.1rem 0.45rem",
                  }}>
                    router {nextNumber}
                  </span>
                </div>
              </div>
            </div>

            {/* Generate button area */}
            <div style={{ padding: "1.375rem 1.5rem" }}>
              <p style={{ margin: "0 0 1.125rem", fontSize: "0.84rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                Click the button below to generate the MikroTik setup commands for{" "}
                <strong style={{ color: "#06b6d4" }}>{nextName}</strong>.
                Copy the commands and paste them into your router's terminal.
              </p>
              <button
                onClick={handleGenerate}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.7rem 2rem", borderRadius: 9,
                  background: "linear-gradient(135deg,#06b6d4,#0284c7)",
                  border: "none", color: "white",
                  fontWeight: 700, fontSize: "0.95rem",
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 4px 18px rgba(6,182,212,0.4)",
                }}
              >
                <Zap size={16} /> Generate Configuration
              </button>

              {/* Compact router list */}
              {routers.length > 0 && (
                <div style={{ marginTop: "1.375rem" }}>
                  <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.45rem" }}>
                    Existing routers
                  </div>
                  {routers.map((r, i) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: 6, marginBottom: "0.2rem", background: "rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize: "0.55rem", color: isInstalled(r) ? "#22c55e" : "#f87171" }}>●</span>
                      <span style={{ fontSize: "0.77rem", color: "var(--isp-text)", fontWeight: 600 }}>{i + 1}. {r.name}</span>
                      <span style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>{slugify(r.name)}.rsc</span>
                      <span style={{ marginLeft: "auto", fontSize: "0.67rem", color: isInstalled(r) ? "#22c55e" : "#64748b" }}>
                        {isInstalled(r) ? "installed" : "pending"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ GENERATED: commands + next button ═══ */}
        {(phase === "generated" || isReconfigure) && (
          <>
            {/* Reconfigure banner */}
            {isReconfigure && activeRouter && (
              <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.6, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Settings2 size={14} />
                <span>Reconfiguring <strong>{activeRouter.name}</strong> — re-applying settings without creating a duplicate.</span>
              </div>
            )}

            {/* Router name strip */}
            {!isReconfigure && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.875rem",
                padding: "0.875rem 1.25rem",
                background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: 10,
              }}>
                <RouterIcon size={17} style={{ color: "#22c55e" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.1rem" }}>
                    Configuration generated for
                  </div>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--isp-text)" }}>
                    {displayName}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#64748b", marginLeft: "0.5rem" }}>
                    ({scriptFile})
                  </span>
                </div>
                <button
                  onClick={() => { setPhase("idle"); setActiveRouterId(null); }}
                  style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.25rem 0.625rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ← Back
                </button>
              </div>
            )}

            {/* ── Commands ── */}
            <div style={{
              background: "var(--isp-card)",
              border: "1px solid rgba(6,182,212,0.2)",
              borderRadius: 14, overflow: "hidden",
            }}>
              <div style={{ padding: "0.875rem 1.25rem", background: "rgba(6,182,212,0.05)", borderBottom: "1px solid rgba(6,182,212,0.12)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Terminal size={14} style={{ color: "#06b6d4" }} />
                <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text)" }}>
                  Paste in Winbox → Terminal
                </span>
              </div>

              <div style={{ padding: "1.375rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <CmdBlock step={1} title="Download configuration" cmd={fetchCmd} />
                <CmdBlock step={2} title="Run configuration"      cmd={importCmd} />
              </div>
            </div>

            {/* ── Next → Ports button (shown for both Add Router and Reconfigure) ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "1rem", flexWrap: "wrap",
              background: "var(--isp-card)",
              border: "1px solid rgba(6,182,212,0.22)",
              borderRadius: 12, padding: "1.125rem 1.5rem",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.87rem", color: "var(--isp-text)", marginBottom: "0.2rem" }}>
                  {isReconfigure ? "Reassign Bridge Ports" : "Load Router Ports"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
                  {isReconfigure
                    ? "After re-running the script, click Next to verify and reassign the bridge ports."
                    : <>After running the commands above the router connects via OpenVPN.
                        Click <strong style={{ color: "var(--isp-text)" }}>Next</strong> to load its physical ports and assign them to the hotspot bridge.</>
                  }
                </div>
              </div>
              <button
                onClick={() => {
                  const id = routerIdForNext ?? (isReconfigure ? reconfigureId : null);
                  if (id) window.location.href = `/admin/network/bridge-ports?routerId=${id}`;
                }}
                disabled={!routerIdForNext && !(isReconfigure && reconfigureId)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.65rem 1.875rem", borderRadius: 9,
                  background: (routerIdForNext || (isReconfigure && reconfigureId))
                    ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                    : "rgba(255,255,255,0.07)",
                  border: (routerIdForNext || (isReconfigure && reconfigureId)) ? "none" : "1px solid rgba(255,255,255,0.1)",
                  color: (routerIdForNext || (isReconfigure && reconfigureId)) ? "white" : "var(--isp-text-muted)",
                  fontWeight: 700, fontSize: "0.9rem",
                  cursor: (routerIdForNext || (isReconfigure && reconfigureId)) ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  boxShadow: (routerIdForNext || (isReconfigure && reconfigureId)) ? "0 4px 16px rgba(6,182,212,0.35)" : "none",
                  transition: "all 0.2s", whiteSpace: "nowrap",
                }}
              >
                <>Next <ArrowRight size={15} /></>
              </button>
            </div>

            {/* Step tracker */}
            <div style={{ display: "flex", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
              {[
                { label: "Generate config", done: true },
                { label: "Paste in terminal", done: false },
                { label: "OVPN connects", done: false },
                { label: "Next → Ports", done: false },
              ].map((s, i, arr) => (
                <div key={i} style={{
                  flex: 1, minWidth: 100, padding: "0.7rem 0.875rem",
                  display: "flex", alignItems: "center", gap: "0.45rem",
                  borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  background: s.done ? "rgba(6,182,212,0.05)" : "transparent",
                }}>
                  <span style={{
                    width: 19, height: 19, borderRadius: "50%", flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.62rem", fontWeight: 800,
                    background: s.done ? "#06b6d4" : "rgba(255,255,255,0.07)",
                    color: s.done ? "white" : "var(--isp-text-muted)",
                  }}>
                    {s.done ? <Check size={10} /> : i + 1}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: s.done ? "#06b6d4" : "var(--isp-text-muted)", fontWeight: s.done ? 700 : 400 }}>
                    {s.label}
                  </span>
                  {i < arr.length - 1 && <ChevronRight size={11} style={{ color: "rgba(255,255,255,0.13)", marginLeft: "auto" }} />}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Note */}
        <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: 8, padding: "0.7rem 1rem", fontSize: "0.77rem", color: "#fbbf24", lineHeight: 1.65 }}>
          <strong>Note:</strong> The MikroTik must have internet access to reach{" "}
          <code style={{ fontFamily: "monospace" }}>{adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}</code> before running Step 1.
          Re-running the script updates its config — no duplicate is created.
        </div>

      </div>
    </AdminLayout>
  );
}
