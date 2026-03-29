import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Check, Copy, Wifi, Loader2, Router as RouterIcon,
  Zap, Settings2, ArrowRight, Terminal, ChevronRight,
} from "lucide-react";

/* ─── Extra DB type (router_secret not in shared DbRouter) ── */
interface FullRouter extends DbRouter {
  router_secret: string | null;
}

/* ─── Admin type ─────────────────────────────────────────── */
interface DbAdmin { id: number; name: string; subdomain: string | null; }

/* ─── Constants ──────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 12 * 60 * 1000;

/* ─── Helpers ────────────────────────────────────────────── */
function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function isInstalled(r: DbRouter): boolean {
  if (!r.last_seen) return false;
  const fresh = Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
  return fresh && (r.status === "online" || r.status === "connected");
}

/* ─── Copy button ────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      })}
      style={{
        marginTop: "0.5rem",
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.3rem 0.75rem", borderRadius: 6,
        background: copied ? "rgba(6,182,212,0.15)" : "rgba(99,102,241,0.18)",
        border: `1px solid ${copied ? "#06b6d4" : "rgba(99,102,241,0.4)"}`,
        color: copied ? "#06b6d4" : "#a5b4fc",
        fontSize: "0.74rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Command block ──────────────────────────────────────── */
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

/* ═══════════════════════════ MAIN PAGE ══════════════════════════ */
export default function SelfInstall() {
  const qc = useQueryClient();

  /* ── URL params ── */
  const params        = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;

  /* ── Phase state ── */
  // "idle"      → show router name + Generate button
  // "generated" → show script commands + Next button
  const [phase, setPhase]       = useState<"idle" | "generated">(reconfigureId ? "generated" : "idle");
  const [generating, setGenerating] = useState(false);
  const [activeRouterId, setActiveRouterId] = useState<number | null>(reconfigureId);

  /* ── Admin info ── */
  const { data: adminData } = useQuery<DbAdmin>({
    queryKey: ["admin_subdomain_si", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_admins").select("id,name,subdomain").eq("id", ADMIN_ID).single();
      if (error) throw error;
      return data as DbAdmin;
    },
    staleTime: 60_000,
  });

  /* ── Routers ── */
  const { data: routers = [], isLoading: routersLoading } = useQuery<FullRouter[]>({
    queryKey: ["isp_routers_si3", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,last_seen,ros_version,model,router_secret,admin_id,ip_address,router_username,created_at,updated_at")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as FullRouter[];
    },
  });

  /* ── Derive next router info ── */
  const adminSubdomain = adminData?.subdomain ?? slugify(adminData?.name ?? "");
  const scriptHost     = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;

  /* Pending = first router that isn't installed */
  const pendingRouter = routers.find(r => !isInstalled(r)) ?? null;

  /* Next name: if pending router exists in DB use it, else generate new name */
  const installedCount = routers.filter(isInstalled).length;
  const nextNumber     = routers.length + 1;  // next slot if all are installed
  const nameBase       = adminSubdomain || "router";
  const nextName       = pendingRouter
    ? pendingRouter.name
    : `${nameBase}${nextNumber}`;
  const nextSlug = slugify(nextName);

  /* Active router (the one whose commands are shown) */
  const activeRouter = activeRouterId
    ? (routers.find(r => r.id === activeRouterId) ?? null)
    : null;

  const scriptSlug = activeRouter ? slugify(activeRouter.name) : nextSlug;
  const scriptName = `${scriptSlug}.rsc`;
  const fetchCmd   = `/tool fetch url="${scriptHost}/api/scripts/${scriptName}" dst-path=${scriptName} mode=https`;
  const importCmd  = `/import ${scriptName}`;

  /* Is reconfigure mode? */
  const isReconfigure = !!reconfigureId;

  /* Auto-set activeRouterId when reconfiguring */
  useEffect(() => {
    if (reconfigureId && !activeRouterId) setActiveRouterId(reconfigureId);
  }, [reconfigureId, routers.length]);

  /* ── Generate: create router record if needed, then show commands ── */
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      let targetId: number | null = null;

      if (pendingRouter) {
        /* A pending router already exists in DB — just use it */
        targetId = pendingRouter.id;
      } else {
        /* All installed → create new router record with next name */
        const autoSecret = btoa(`${ADMIN_ID}:${Date.now()}:ocholanet`)
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 48);
        const { data, error } = await supabase
          .from("isp_routers")
          .insert({
            admin_id:         ADMIN_ID,
            name:             nextName,
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
        targetId = (data as { id: number }).id;
        qc.invalidateQueries({ queryKey: ["isp_routers_si3", ADMIN_ID] });
      }

      setActiveRouterId(targetId);
      setPhase("generated");
    } catch (err) {
      console.error("Failed to generate config:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 820 }}>

        {/* ── Header ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
              {isReconfigure ? "Reconfigure Router" : "Self Install"}
            </h1>
            {adminSubdomain && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "0.35rem",
                background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.28)",
                borderRadius: 20, padding: "0.18rem 0.7rem",
                fontSize: "0.72rem", color: "#06b6d4", fontWeight: 600,
              }}>
                <Wifi size={11} /> {adminSubdomain}.{BASE_DOMAIN}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>
            {isReconfigure
              ? "Re-apply the setup script on an existing router without creating a new record."
              : `${installedCount} of ${routers.length} router${routers.length !== 1 ? "s" : ""} installed`}
          </p>
        </div>

        <NetworkTabs active="self-install" />

        {/* ═══ PHASE: IDLE — show router name + generate button ═══ */}
        {phase === "idle" && !isReconfigure && (
          <div style={{
            background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
            borderRadius: 14, overflow: "hidden",
          }}>
            {/* Top bar: router to be configured */}
            <div style={{
              padding: "1.125rem 1.5rem",
              background: "rgba(6,182,212,0.05)",
              borderBottom: "1px solid rgba(6,182,212,0.12)",
              display: "flex", alignItems: "center", gap: "0.875rem",
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: "rgba(6,182,212,0.12)", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <RouterIcon size={19} style={{ color: "#06b6d4" }} />
              </div>
              <div>
                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>
                  {pendingRouter ? "Router to configure" : "Next router to add"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--isp-text)" }}>
                    {nextName}
                  </span>
                  <span style={{
                    fontSize: "0.7rem", fontWeight: 700,
                    color: pendingRouter ? "#fbbf24" : "#06b6d4",
                    background: pendingRouter ? "rgba(251,191,36,0.1)" : "rgba(6,182,212,0.1)",
                    border: `1px solid ${pendingRouter ? "rgba(251,191,36,0.3)" : "rgba(6,182,212,0.28)"}`,
                    borderRadius: 5, padding: "0.1rem 0.5rem",
                  }}>
                    {pendingRouter ? "pending" : `router ${nextNumber}`}
                  </span>
                </div>
              </div>

              {routersLoading && (
                <Loader2 size={15} style={{ color: "#64748b", animation: "spin 1s linear infinite", marginLeft: "auto" }} />
              )}
            </div>

            {/* Body */}
            <div style={{ padding: "1.5rem" }}>
              <p style={{ margin: "0 0 1.25rem", fontSize: "0.84rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                Click <strong style={{ color: "var(--isp-text)" }}>Generate Configuration</strong> to create a unique
                setup script for <strong style={{ color: "#06b6d4" }}>{nextName}</strong>.
                The commands will appear below — paste them into your MikroTik terminal to configure and connect the router.
              </p>

              <button
                onClick={handleGenerate}
                disabled={generating || routersLoading}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.65rem 1.75rem", borderRadius: 9,
                  background: generating
                    ? "rgba(255,255,255,0.07)"
                    : "linear-gradient(135deg,#06b6d4,#0284c7)",
                  border: generating ? "1px solid rgba(255,255,255,0.1)" : "none",
                  color: generating ? "var(--isp-text-muted)" : "white",
                  fontWeight: 700, fontSize: "0.9rem",
                  cursor: generating ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: generating ? "none" : "0 4px 16px rgba(6,182,212,0.35)",
                  transition: "all 0.2s",
                }}
              >
                {generating
                  ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Generating…</>
                  : <><Zap size={15} /> Generate Configuration</>
                }
              </button>

              {/* Existing router list (compact) */}
              {routers.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                    Existing routers
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.275rem" }}>
                    {routers.map((r, i) => (
                      <div key={r.id} style={{
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        padding: "0.4rem 0.625rem", borderRadius: 7,
                        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                        fontSize: "0.77rem",
                      }}>
                        <span style={{ color: isInstalled(r) ? "#22c55e" : "#f87171", fontSize: "0.6rem" }}>●</span>
                        <span style={{ color: "var(--isp-text)", fontWeight: 600 }}>{i + 1}. {r.name}</span>
                        <span style={{ fontFamily: "monospace", color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>{slugify(r.name)}.rsc</span>
                        <span style={{ marginLeft: "auto", fontSize: "0.67rem", color: isInstalled(r) ? "#22c55e" : "#64748b" }}>
                          {isInstalled(r) ? "installed" : "pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ PHASE: GENERATED — show commands ═══ */}
        {(phase === "generated" || isReconfigure) && (
          <>
            {/* Reconfigure banner */}
            {isReconfigure && activeRouter && (
              <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.6, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Settings2 size={14} />
                <span>Reconfiguring <strong>{activeRouter.name}</strong> — running the script re-applies all settings without creating a duplicate.</span>
              </div>
            )}

            {/* Router name header */}
            {!isReconfigure && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.875rem",
                padding: "0.875rem 1.25rem",
                background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: 10,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(34,197,94,0.12)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <RouterIcon size={17} style={{ color: "#22c55e" }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.15rem" }}>
                    Configuration generated for
                  </div>
                  <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--isp-text)" }}>
                    {activeRouter?.name ?? nextName}{" "}
                    <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#64748b", fontWeight: 400 }}>
                      ({scriptName})
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setPhase("idle"); setActiveRouterId(null); }}
                  style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--isp-text-muted)", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.25rem 0.625rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ← Back
                </button>
              </div>
            )}

            {/* Commands card */}
            <div style={{
              background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
              borderRadius: 14, padding: "1.5rem 1.75rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.125rem" }}>
                <Terminal size={15} style={{ color: "#06b6d4" }} />
                <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--isp-text)" }}>
                  Paste these commands in Winbox → Terminal
                </span>
              </div>
              <CmdBlock step={1} title="Download configuration" cmd={fetchCmd} />
              <CmdBlock step={2} title="Run configuration"      cmd={importCmd} />
            </div>

            {/* Next button — always active after generation */}
            {!isReconfigure && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "1rem", flexWrap: "wrap",
                background: "var(--isp-card)", border: "1px solid rgba(6,182,212,0.22)",
                borderRadius: 12, padding: "1.125rem 1.5rem",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.87rem", color: "var(--isp-text)", marginBottom: "0.2rem" }}>
                    Configure Bridge Ports
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
                    After running the commands above, the router will connect via OpenVPN.
                    Click <strong style={{ color: "var(--isp-text)" }}>Next</strong> to assign which
                    ports are bridged to the hotspot.
                  </div>
                </div>
                <button
                  onClick={() => {
                    const id = activeRouterId ?? pendingRouter?.id;
                    if (id) window.location.href = `/admin/network/bridge-ports?routerId=${id}`;
                  }}
                  disabled={!activeRouterId && !pendingRouter}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.65rem 1.75rem", borderRadius: 9,
                    background: "linear-gradient(135deg,#06b6d4,#0284c7)",
                    border: "none", color: "white",
                    fontWeight: 700, fontSize: "0.9rem",
                    cursor: "pointer", fontFamily: "inherit",
                    boxShadow: "0 4px 16px rgba(6,182,212,0.35)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Next <ArrowRight size={15} />
                </button>
              </div>
            )}

            {/* Step guide */}
            <div style={{
              display: "flex", gap: "0", flexWrap: "wrap",
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, overflow: "hidden",
            }}>
              {[
                { num: 1, label: "Generate config", done: true },
                { num: 2, label: "Paste in terminal", done: false },
                { num: 3, label: "OVPN connects", done: false },
                { num: 4, label: "Click Next → Ports", done: false },
              ].map((s, i) => (
                <div key={i} style={{
                  flex: 1, minWidth: 120, padding: "0.75rem 1rem",
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  borderRight: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  background: s.done ? "rgba(6,182,212,0.05)" : "transparent",
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: "0.65rem", fontWeight: 800,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: s.done ? "#06b6d4" : "rgba(255,255,255,0.08)",
                    color: s.done ? "white" : "var(--isp-text-muted)",
                  }}>
                    {s.done ? <Check size={11} /> : s.num}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: s.done ? "#06b6d4" : "var(--isp-text-muted)", fontWeight: s.done ? 700 : 400 }}>
                    {s.label}
                  </span>
                  {i < 3 && <ChevronRight size={12} style={{ color: "rgba(255,255,255,0.15)", marginLeft: "auto" }} />}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Note ── */}
        <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: 8, padding: "0.7rem 1rem", fontSize: "0.77rem", color: "#fbbf24", lineHeight: 1.65 }}>
          <strong>Note:</strong> The MikroTik must reach{" "}
          <code style={{ fontFamily: "monospace" }}>{adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}</code> before running Step 1.
          Re-running the script on an existing router updates its config — no duplicate is created.
        </div>

      </div>
    </AdminLayout>
  );
}
