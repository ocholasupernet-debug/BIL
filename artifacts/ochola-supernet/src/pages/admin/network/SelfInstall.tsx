import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import { Check, Copy, ChevronDown, RefreshCw, Wifi } from "lucide-react";

/* ─── DB types ──────────────────────────────────────────────── */
interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string;
  router_username: string;
  router_secret: string | null;
  ros_version: string | null;
}

interface DbAdmin {
  id: number;
  name: string;
  subdomain: string | null;
}

/* ─── Helpers ───────────────────────────────────────────────── */
const BASE_DOMAIN = "isplatty.org";

function slugify(str: string) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* ─── Copy button ───────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handle}
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

/* ─── Step block ────────────────────────────────────────────── */
function StepBlock({
  number, title, command,
}: { number: number; title: string; command: string }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.875rem" }}>
        Step {number}: {title}
      </h3>
      <div style={{
        background: "#0a0f1a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8, padding: "0.875rem 1.125rem",
      }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "#e2e8f0", wordBreak: "break-all" }}>
          {command}
        </code>
      </div>
      <CopyBtn text={command} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────── */
export default function SelfInstall() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  /* ── 1. Fetch current admin's subdomain (keyed on ADMIN_ID → live) ── */
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

  /* ── 2. Fetch routers for this admin (keyed on ADMIN_ID → live) ── */
  const { data: routers = [], isLoading: routersLoading } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_si", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,router_username,router_secret,ros_version")
        .eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouter[];
    },
  });

  /* ── Derived values ── */
  const router = routers.find(r => r.id === selectedId) ?? null;

  /* Script filename: use selected router's slug or "mainhotspot" */
  const scriptName = router
    ? slugify(router.name) + ".rsc"
    : "mainhotspot.rsc";

  /* Admin's actual subdomain from DB → always correct per admin */
  const adminSubdomain = adminData?.subdomain
    ?? slugify(adminData?.name ?? "")
    ?? "";

  const scriptHost   = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;

  const scriptBase   = `${scriptHost}/api/scripts`;
  const fetchCmd     = `/tool fetch url="${scriptBase}/${scriptName}" dst-path=${scriptName} mode=https`;
  const importCmd    = `/import ${scriptName}`;

  const isLoading    = adminLoading || routersLoading;

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 860 }}>

        {/* ── Page header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
            Self Install — Profile:
          </h1>
          <span style={{
            background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)",
            color: "#06b6d4", borderRadius: 6, padding: "0.25rem 0.75rem",
            fontFamily: "monospace", fontSize: "0.875rem", fontWeight: 700,
          }}>
            {scriptName}
          </span>

          {/* Live subdomain badge */}
          {adminLoading ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20, padding: "0.2rem 0.75rem", fontSize: "0.75rem", color: "var(--isp-text-muted)",
            }}>
              <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> loading…
            </span>
          ) : adminSubdomain ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)",
              borderRadius: 20, padding: "0.2rem 0.75rem", fontSize: "0.75rem",
              color: "#06b6d4", fontWeight: 600,
            }}>
              <Wifi size={11} />
              {adminSubdomain}.{BASE_DOMAIN}
            </span>
          ) : null}
        </div>

        <NetworkTabs active="self-install" />

        {/* ── Router selector ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Router:</span>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <select
              value={selectedId ?? ""}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              disabled={routersLoading}
              style={{
                background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                borderRadius: 8, padding: "0.45rem 2.25rem 0.45rem 0.875rem",
                color: "var(--isp-text)", fontSize: "0.8rem", cursor: routersLoading ? "wait" : "pointer",
                fontFamily: "inherit", outline: "none", appearance: "none",
                opacity: routersLoading ? 0.6 : 1,
              }}
            >
              <option value="">— select router —</option>
              {routers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.host}) {r.status === "online" ? "🟢" : "🔴"}
                </option>
              ))}
            </select>
            <ChevronDown size={13} style={{ position: "absolute", right: "0.625rem", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
          </div>
        </div>

        {/* ── Status banner ── */}
        {isLoading ? (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "0.75rem 1.125rem",
            color: "var(--isp-text-muted)", fontSize: "0.875rem", fontWeight: 600,
          }}>
            <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
            Fetching your configuration…
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            background: "rgba(20,184,166,0.12)", border: "1px solid rgba(20,184,166,0.35)",
            borderRadius: 8, padding: "0.75rem 1.125rem",
            color: "#2dd4bf", fontSize: "0.875rem", fontWeight: 600,
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "rgba(20,184,166,0.25)", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Check size={13} strokeWidth={3} />
            </span>
            Profile ready — {adminSubdomain
              ? `served from ${adminSubdomain}.${BASE_DOMAIN}`
              : "profile generated on server"}
          </div>
        )}

        {/* ── Instructions ── */}
        <div style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Your configuration files have been generated. Follow these steps to configure your MikroTik router:
          </p>
          <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>Copy and paste the first command into the MikroTik CLI to download the configuration script.</li>
            <li>Copy and paste the second command to execute the script and apply the configuration.</li>
            <li>Click <strong style={{ color: "var(--isp-text)" }}>"Next"</strong> to add the router to the billing system after configuration.</li>
          </ol>
        </div>

        {/* ── Steps card ── */}
        <div style={{
          background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
          borderRadius: 12, padding: "1.5rem 1.75rem",
          opacity: isLoading ? 0.5 : 1, transition: "opacity 0.2s",
        }}>
          <StepBlock
            number={1}
            title="Download configuration script"
            command={fetchCmd}
          />
          <StepBlock
            number={2}
            title="Import configuration"
            command={importCmd}
          />

          {/* Step 3 */}
          <div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.875rem" }}>
              Step 3: Add router to billing system
            </h3>
            <p style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", margin: "0 0 0.875rem" }}>
              After running the commands above, click <strong style={{ color: "var(--isp-text)" }}>Next</strong> to register this router in the billing system and assign plans to customers.
            </p>
            <button
              onClick={() => {
                const dest = selectedId
                  ? `/admin/network/bridge-ports?routerId=${selectedId}`
                  : "/admin/network/bridge-ports";
                window.location.href = dest;
              }}
              style={{
                padding: "0.625rem 1.75rem", borderRadius: 8,
                background: "linear-gradient(135deg,#06b6d4,#0284c7)",
                border: "none", color: "white", fontWeight: 700,
                fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit",
                boxShadow: "0 4px 12px rgba(6,182,212,0.3)",
              }}
            >
              Next →
            </button>
          </div>
        </div>

        {/* ── Note box ── */}
        <div style={{
          background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
          borderRadius: 8, padding: "0.75rem 1.125rem",
          fontSize: "0.78rem", color: "#fbbf24", lineHeight: 1.6,
        }}>
          <strong>Note:</strong> The MikroTik router must have internet access to fetch the script.
          Ensure the router is online and can reach{" "}
          <code style={{ fontFamily: "monospace" }}>
            {adminSubdomain ? `${adminSubdomain}.${BASE_DOMAIN}` : window.location.host}
          </code>{" "}
          before running Step 1.
        </div>

      </div>

      {/* Spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}
