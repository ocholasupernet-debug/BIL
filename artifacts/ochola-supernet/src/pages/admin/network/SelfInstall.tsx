import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Check, Copy, RefreshCw, Wifi, WifiOff,
  Loader2, Router, Cpu, Zap,
} from "lucide-react";

/* ─── DB types ───────────────────────────────────────────────── */
interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string;
  last_seen: string | null;
  router_secret: string | null;
  ros_version: string | null;
  model: string | null;
}

interface DbAdmin {
  id: number;
  name: string;
  subdomain: string | null;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";
const STALE_MS    = 5 * 60 * 1000; // 5 min — freshly registered

function slugify(str: string) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function isFreshlyConnected(r: DbRouter): boolean {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}

/* ─── Copy button ────────────────────────────────────────────── */
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

/* ─── Command block ──────────────────────────────────────────── */
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

/* ─── Router detected card ───────────────────────────────────── */
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

/* ─── Main page ──────────────────────────────────────────────── */
export default function SelfInstall() {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polling, setPolling] = useState(false);

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

  /* 2. Router list — refetch every 6 s to detect when it connects */
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

  /* Derived: first router for this admin */
  const router = routers[0] ?? null;

  /* Is a router freshly connected (registered within last 5 min)? */
  const connected = router ? isFreshlyConnected(router) : false;

  /* Script values */
  const adminSubdomain = adminData?.subdomain ?? slugify(adminData?.name ?? "") ?? "";
  const scriptHost = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;
  const scriptBase = `${scriptHost}/api/scripts`;

  /* If a router exists, use its slug. Otherwise use "mainhotspot"
     (the script generator will auto-create a router record for this admin). */
  const scriptName = router ? slugify(router.name) + ".rsc" : "mainhotspot.rsc";
  const fetchCmd   = `/tool fetch url="${scriptBase}/${scriptName}" dst-path=${scriptName} mode=https`;
  const importCmd  = `/import ${scriptName}`;

  /* Start polling indicator when admin clicks "I've run the commands" */
  const startPolling = () => {
    setPolling(true);
    refetchRouters();
  };

  /* Cleanup interval on unmount */
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const isLoading = adminLoading || routersLoading;

  return (
    <AdminLayout>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 860 }}>

        {/* ── Page header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Self Install
          </h1>
          <span style={{
            background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)",
            color: "#06b6d4", borderRadius: 6, padding: "0.2rem 0.7rem",
            fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
          }}>
            {isLoading ? "…" : scriptName}
          </span>
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

        {/* ── Intro ── */}
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
          Run the two commands below inside your MikroTik terminal (
          <strong style={{ color: "var(--isp-text)" }}>Winbox → Terminal</strong>
          {" "}or{" "}
          <strong style={{ color: "var(--isp-text)" }}>SSH</strong>). The script will automatically configure your router
          and link it to the billing system — the model and name will be detected automatically.
        </p>

        {/* ── Commands card ── */}
        <div style={{
          background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
          borderRadius: 12, padding: "1.5rem 1.75rem",
          opacity: isLoading ? 0.5 : 1, transition: "opacity 0.2s",
        }}>
          <CmdBlock step={1} title="Download configuration" command={fetchCmd} />
          <CmdBlock step={2} title="Run configuration" command={importCmd} />

          {/* I've run it */}
          {!connected && (
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

        {/* ── Connection status ── */}
        <div style={{
          background: "var(--isp-section)", border: `1px solid ${connected ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 12, padding: "1.25rem 1.5rem",
          transition: "border-color 0.4s",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.875rem" }}>
            Connection Status
          </div>

          {connected && router ? (
            <RouterCard router={router} />
          ) : polling || routersLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
              <span>Waiting for your router to connect…</span>
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

        {/* ── Step 3: Next ── */}
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
            disabled={!connected || !router}
            onClick={() => {
              if (router) window.location.href = `/admin/network/bridge-ports?routerId=${router.id}`;
            }}
            style={{
              padding: "0.625rem 1.75rem", borderRadius: 8,
              background: connected && router
                ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                : "rgba(255,255,255,0.07)",
              border: connected && router ? "none" : "1px solid rgba(255,255,255,0.12)",
              color: connected && router ? "white" : "var(--isp-text-muted)",
              fontWeight: 700, fontSize: "0.875rem",
              cursor: connected && router ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              boxShadow: connected && router ? "0 4px 12px rgba(6,182,212,0.3)" : "none",
              transition: "all 0.2s",
            }}
          >
            {connected && router ? "Next → Configure Ports" : "Waiting for router…"}
          </button>
        </div>

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
          before running Step 1. The script detects your router's model, ROS version, and identity automatically.
        </div>

      </div>
    </AdminLayout>
  );
}
