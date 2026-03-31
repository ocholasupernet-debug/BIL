import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Check, Copy, Loader2, Settings, ArrowRight, Terminal,
  ChevronRight, Info, HelpCircle, AlertTriangle,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────── */
interface FullRouter extends DbRouter { router_secret: string | null; }
interface DbAdmin { id: number; name: string; subdomain: string | null; }

/* ─── Constants ──────────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 12 * 60 * 1000;
const ONLINE_STATUSES = new Set(["online", "connected", "active"]);

/* ─── Helpers ─────────────────────────────────────────────────────── */
function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* A router is "installed" if its status is online/connected/active,
   OR if it has pinged within the stale window. */
function isInstalled(r: DbRouter) {
  if (ONLINE_STATUSES.has(r.status ?? "")) return true;
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}

/* Human-readable label for the router's current status */
function routerStatusLabel(r: DbRouter): string {
  const s = (r.status ?? "").toLowerCase();
  if (s === "online"    || s === "connected") return "✓ online";
  if (s === "active")                          return "✓ active";
  if (s === "offline")                         return "offline";
  if (!r.last_seen)                            return "pending";
  const ageMin = Math.floor((Date.now() - new Date(r.last_seen).getTime()) / 60_000);
  return ageMin < 60 ? `seen ${ageMin}m ago` : "inactive";
}

function routerStatusColor(r: DbRouter): string {
  const s = (r.status ?? "").toLowerCase();
  if (ONLINE_STATUSES.has(s)) return "#22c55e";
  if (s === "offline")        return "#f87171";
  return "#64748b";
}

/* ─── Copy button ─────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2200);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.3rem 0.75rem", borderRadius: 5,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.08)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.12)"}`,
        color: copied ? "#4ade80" : "#94a3b8",
        fontSize: "0.72rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Command block ───────────────────────────────────────────────── */
function CmdBlock({ step, title, cmd }: { step: number; title: string; cmd: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg,#14b8a6,#0d9488)",
          color: "white", fontSize: "0.68rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{step}</span>
        <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text)" }}>{title}</span>
      </div>
      <div style={{
        background: "#0a0f1a", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 8, padding: "0.875rem 1rem",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem",
      }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#7dd3fc", wordBreak: "break-all", lineHeight: 1.7, flex: 1 }}>
          {cmd}
        </code>
        <CopyBtn text={cmd} />
      </div>
    </div>
  );
}

/* ═══════════════════════════ PAGE ═══════════════════════════════ */
export default function SelfInstall() {
  const qc = useQueryClient();

  const params        = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;

  const [phase, setPhase]               = useState<"idle" | "generated">(reconfigureId ? "generated" : "idle");
  const [activeRouterId, setActiveRouterId] = useState<number | null>(reconfigureId);
  const [generating, setGenerating]     = useState(false);
  const [showHelp, setShowHelp]         = useState(false);

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

  /* Routers */
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

  const nextNumber = routers.length + 1;
  const nextName   = `${nameBase}${nextNumber}`;
  const nextSlug   = slugify(nextName);

  const activeRouter  = activeRouterId ? (routers.find(r => r.id === activeRouterId) ?? null) : null;
  const displayName   = activeRouter?.name ?? nextName;
  const displaySlug   = activeRouter ? slugify(activeRouter.name) : nextSlug;
  const profileFile   = `${displaySlug}.ovpn`;
  const scriptFile    = `${displaySlug}.rsc`;
  const fetchCmd      = `/tool fetch url="${scriptHost}/api/scripts/${scriptFile}" dst-path=${scriptFile} mode=https`;
  const importCmd     = `/import ${scriptFile}`;

  const isReconfigure   = !!reconfigureId;
  const routerIdForNext = activeRouterId ?? null;

  useEffect(() => {
    if (reconfigureId && routers.length > 0 && !activeRouterId) {
      setActiveRouterId(reconfigureId);
    }
  }, [reconfigureId, routers.length]);

  useEffect(() => {
    if (phase !== "generated" || activeRouterId || !routers.length) return;
    const match = routers.find(r => slugify(r.name) === nextSlug);
    if (match) setActiveRouterId(match.id);
  }, [routers, phase, nextSlug, activeRouterId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setPhase("generated");
    try {
      const res = await fetch("/api/admin/router/ensure", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ adminId: ADMIN_ID, routerName: nextName }),
      });
      const json = await res.json() as { ok: boolean; router?: { id: number } };
      if (json.ok && json.router?.id) setActiveRouterId(json.router.id);
    } catch { /* auto-create on script fetch */ }
    finally {
      setGenerating(false);
      qc.invalidateQueries({ queryKey: ["isp_routers_si4", ADMIN_ID] });
    }
  };

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem", maxWidth: 820 }}>

        {/* ── Page title ── */}
        <div>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.15rem" }}>
            {isReconfigure ? "Reconfigure Router" : "Self install"}
          </h1>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>
            {isReconfigure
              ? "Re-apply the setup script on an existing router."
              : `Set up a new MikroTik router with VPN, hotspot, and PPPoE`}
          </p>
        </div>

        <NetworkTabs active="add-router" />

        {/* ── Blue profile banner ── */}
        <div style={{
          background: "linear-gradient(135deg,#1e40af 0%,#2563eb 60%,#1d4ed8 100%)",
          borderRadius: 10, padding: "0.875rem 1.25rem",
          display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: "1rem", color: "white", whiteSpace: "nowrap" }}>
              Self Install — Profile:
            </span>
            {routersLoading && phase === "idle" ? (
              <Loader2 size={14} style={{ color: "#93c5fd", animation: "spin 1s linear infinite" }} />
            ) : (
              <span style={{
                fontFamily: "monospace", fontWeight: 800, fontSize: "0.9rem",
                background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.25)",
                padding: "0.2rem 0.75rem", borderRadius: 5, color: "#e0f2fe", whiteSpace: "nowrap",
              }}>
                {phase === "generated" || isReconfigure ? profileFile : `${nextSlug}.ovpn`}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowHelp(v => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              padding: "0.4rem 1rem", borderRadius: 6,
              background: showHelp ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white", fontWeight: 700, fontSize: "0.8rem",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <HelpCircle size={13} /> Need Help?
          </button>
        </div>

        {/* ── Help panel ── */}
        {showHelp && (
          <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, padding: "0.875rem 1rem", fontSize: "0.8rem", color: "#fbbf24", lineHeight: 1.75 }}>
            <strong>Quick Guide:</strong><br />
            1. Reset your MikroTik router to factory defaults (System → Reset Configuration, keep defaults).<br />
            2. Plug in the WAN cable and verify internet: open a terminal and run <code style={{ fontFamily: "monospace" }}>ping 8.8.8.8</code>.<br />
            3. Go to <strong>System → Certificates</strong> and delete any existing certificates.<br />
            4. Open <strong>Winbox → New Terminal</strong>, paste Step 1, then Step 2 from the commands below.<br />
            5. Wait ~30 s — the router will reboot and connect automatically.
          </div>
        )}

        {/* ═══ IDLE: info box + generate button ═══ */}
        {phase === "idle" && !isReconfigure && (
          <>
            {/* Info box */}
            <div style={{
              background: "rgba(59,130,246,0.07)",
              border: "1px solid rgba(59,130,246,0.22)",
              borderRadius: 10, padding: "1rem 1.125rem",
              display: "flex", alignItems: "flex-start", gap: "0.75rem",
            }}>
              <Info size={18} style={{ color: "#60a5fa", flexShrink: 0, marginTop: "0.05rem" }} />
              <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--isp-text-muted)", lineHeight: 1.75 }}>
                No configuration profile exists yet. Click the button below to generate the configuration files,
                which will include VPN, hotspot, PPPoE, and user settings for your MikroTik router.
                We advise resetting your router, giving it internet, then in a new terminal run{" "}
                <code style={{ fontFamily: "monospace", color: "#93c5fd", fontSize: "0.82rem" }}>"ping 8.8.8.8"</code>{" "}
                to confirm internet before generating.{" "}
                <strong style={{ color: "var(--isp-text)" }}>Important:</strong> go to System → Certificates
                and delete any certificates there before running the installation script.
              </p>
            </div>

            {/* Generate button */}
            <div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.6rem",
                  padding: "0.75rem 2.25rem", borderRadius: 9,
                  background: generating
                    ? "rgba(20,184,166,0.4)"
                    : "linear-gradient(135deg,#14b8a6,#0d9488)",
                  border: "none", color: "white",
                  fontWeight: 700, fontSize: "0.95rem",
                  cursor: generating ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: generating ? "none" : "0 4px 18px rgba(20,184,166,0.4)",
                  transition: "all 0.2s",
                }}
              >
                {generating
                  ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                  : <Settings size={16} />
                }
                {generating ? "Generating…" : "Generate configuration files"}
              </button>
            </div>

            {/* Existing routers list */}
            {routers.length > 0 && (
              <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "0.625rem 1rem", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--isp-border)", fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Existing routers ({routers.length})
                </div>
                {routers.map((r, i) => {
                  const colour = routerStatusColor(r);
                  const label  = routerStatusLabel(r);
                  return (
                    <div key={r.id} style={{
                      display: "flex", alignItems: "center", gap: "0.625rem",
                      padding: "0.6rem 1rem",
                      borderBottom: i < routers.length - 1 ? "1px solid var(--isp-border-subtle)" : "none",
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: colour }} />
                      <span style={{ fontSize: "0.8rem", color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</span>
                      <code style={{ fontSize: "0.72rem", color: "#64748b", fontFamily: "monospace" }}>{slugify(r.name)}.rsc</code>
                      {r.host && (
                        <code style={{ fontSize: "0.7rem", color: "#475569", fontFamily: "monospace" }}>{r.host}</code>
                      )}
                      <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: colour, fontWeight: 600 }}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ GENERATED / RECONFIGURE ═══ */}
        {(phase === "generated" || isReconfigure) && (
          <>
            {/* Reconfigure banner */}
            {isReconfigure && activeRouter && (
              <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.6, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <AlertTriangle size={14} />
                <span>Reconfiguring <strong>{activeRouter.name}</strong> — re-applying settings without creating a duplicate.</span>
              </div>
            )}

            {/* Generated for banner */}
            {!isReconfigure && (
              <div style={{ background: "rgba(20,184,166,0.06)", border: "1px solid rgba(20,184,166,0.22)", borderRadius: 10, padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.15rem" }}>
                    Configuration generated for
                  </div>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--isp-text)" }}>{displayName}</span>
                  <code style={{ fontFamily: "monospace", fontSize: "0.73rem", color: "#64748b", marginLeft: "0.5rem" }}>({scriptFile})</code>
                </div>
                <button
                  onClick={() => { setPhase("idle"); setActiveRouterId(null); }}
                  style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.25rem 0.625rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ← Back
                </button>
              </div>
            )}

            {/* Commands card */}
            <div style={{ background: "var(--isp-card)", border: "1px solid rgba(20,184,166,0.2)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "0.875rem 1.25rem", background: "rgba(20,184,166,0.05)", borderBottom: "1px solid rgba(20,184,166,0.12)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Terminal size={14} style={{ color: "#14b8a6" }} />
                <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text)" }}>
                  Paste in Winbox → Terminal
                </span>
              </div>
              <div style={{ padding: "1.375rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.125rem" }}>
                <CmdBlock step={1} title="Download configuration" cmd={fetchCmd} />
                <CmdBlock step={2} title="Run configuration"      cmd={importCmd} />
              </div>
            </div>

            {/* Next → Ports */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "1rem", flexWrap: "wrap",
              background: "var(--isp-card)", border: "1px solid rgba(20,184,166,0.2)",
              borderRadius: 12, padding: "1.125rem 1.5rem",
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: "0.87rem", color: "var(--isp-text)", marginBottom: "0.25rem" }}>
                  {isReconfigure ? "Reassign Bridge Ports" : "Load Router Ports"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.55 }}>
                  {isReconfigure
                    ? "After re-running the script, click Next to verify and reassign the bridge ports."
                    : <>After running the commands above the router connects via OpenVPN. Click{" "}
                        <strong style={{ color: "var(--isp-text)" }}>Next</strong> to load its physical ports
                        and assign them to the hotspot bridge.</>
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
                    ? "linear-gradient(135deg,#14b8a6,#0d9488)"
                    : "rgba(255,255,255,0.07)",
                  border: "none",
                  color: (routerIdForNext || (isReconfigure && reconfigureId)) ? "white" : "var(--isp-text-muted)",
                  fontWeight: 700, fontSize: "0.9rem",
                  cursor: (routerIdForNext || (isReconfigure && reconfigureId)) ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  boxShadow: (routerIdForNext || (isReconfigure && reconfigureId)) ? "0 4px 16px rgba(20,184,166,0.35)" : "none",
                  transition: "all 0.2s", whiteSpace: "nowrap",
                }}
              >
                Next <ArrowRight size={15} />
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
                  flex: 1, minWidth: 80, padding: "0.7rem 0.75rem",
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  background: s.done ? "rgba(20,184,166,0.05)" : "transparent",
                }}>
                  <span style={{
                    width: 19, height: 19, borderRadius: "50%", flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.62rem", fontWeight: 800,
                    background: s.done ? "#14b8a6" : "rgba(255,255,255,0.07)",
                    color: s.done ? "white" : "var(--isp-text-muted)",
                  }}>
                    {s.done ? <Check size={10} /> : i + 1}
                  </span>
                  <span style={{ fontSize: "0.71rem", color: s.done ? "#14b8a6" : "var(--isp-text-muted)", fontWeight: s.done ? 700 : 400, lineHeight: 1.3 }}>
                    {s.label}
                  </span>
                  {i < arr.length - 1 && <ChevronRight size={10} style={{ color: "rgba(255,255,255,0.13)", marginLeft: "auto", flexShrink: 0 }} />}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Note */}
        <div style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 8, padding: "0.7rem 1rem", fontSize: "0.77rem", color: "#fbbf24", lineHeight: 1.65 }}>
          <strong>Note:</strong> The MikroTik must have internet access to reach{" "}
          <code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
            {adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}
          </code>{" "}
          before running Step 1. Re-running the script updates its config — no duplicate is created.
        </div>

      </div>
    </AdminLayout>
  );
}
