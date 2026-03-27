import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import { useBrand } from "@/context/BrandContext";
import { Check, Copy, ChevronDown } from "lucide-react";

interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string;
  router_username: string;
  router_secret: string | null;
  ros_version: string | null;
}

/* ── small copy button ── */
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

/* ── step block ── */
function StepBlock({ number, title, command }: { number: number; title: string; command: string }) {
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

export default function SelfInstall() {
  const brand = useBrand();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_si"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,router_username,router_secret,ros_version")
        .eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouter[];
    },
  });

  const router = routers.find(r => r.id === selectedId) ?? null;

  /* Derive a safe script filename from the router name */
  const scriptName = router
    ? router.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + ".rsc"
    : "mainhotspot.rsc";

  const domain = brand.domain || "isplatty.org";
  const fetchCmd  = `/tool fetch url="https://${domain}/scripts/${scriptName}" dst-path=${scriptName} mode=https`;
  const importCmd = `/import ${scriptName}`;

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
        </div>

        <NetworkTabs active="self-install" />

        {/* ── Router selector ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--isp-text-muted)" }}>Router:</span>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <select
              value={selectedId ?? ""}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              style={{
                background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                borderRadius: 8, padding: "0.45rem 2.25rem 0.45rem 0.875rem",
                color: "var(--isp-text)", fontSize: "0.8rem", cursor: "pointer",
                fontFamily: "inherit", outline: "none", appearance: "none",
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

        {/* ── Green "profile ready" banner ── */}
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
          Profile already generated on server
        </div>

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

        {/* ── Steps ── */}
        <div style={{
          background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
          borderRadius: 12, padding: "1.5rem 1.75rem",
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

          {/* Step 3 — Next button */}
          <div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.875rem" }}>
              Step 3: Add router to billing system
            </h3>
            <p style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", margin: "0 0 0.875rem" }}>
              After running the commands above, click <strong style={{ color: "var(--isp-text)" }}>Next</strong> to register this router in the billing system and assign plans to customers.
            </p>
            <button
              onClick={() => window.location.href = "/admin/network/routers"}
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
          Ensure the router is online and can reach <code style={{ fontFamily: "monospace" }}>https://{domain}</code> before running Step 1.
        </div>

      </div>
    </AdminLayout>
  );
}
