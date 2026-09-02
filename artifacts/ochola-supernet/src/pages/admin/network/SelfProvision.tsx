import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID, supabase } from "@/lib/supabase";
import { Check, Copy, Download, FileCode2, Loader2, AlertTriangle } from "lucide-react";

const BASE_DOMAIN = "isplatty.org";

interface AdminAccount {
  name: string | null;
  subdomain: string | null;
}

export default function AddRouterScript() {
  const [script, setScript] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const { data: account, isLoading: loadingAccount, error: accountError } = useQuery({
    queryKey: ["add_router_script_account", ADMIN_ID],
    enabled: Number.isFinite(ADMIN_ID) && ADMIN_ID > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins")
        .select("name, subdomain")
        .eq("id", ADMIN_ID)
        .single();
      if (error) throw error;
      return data as AdminAccount;
    },
  });

  const accountSubdomain = account?.subdomain?.trim().toLowerCase() ?? "";
  const companyHost = accountSubdomain ? `${accountSubdomain}.${BASE_DOMAIN}` : "";
  const mainhotspotUrl = companyHost ? `https://${companyHost}/scripts/mainhotspot.rsc` : "";
  const bootstrapCommand = mainhotspotUrl
    ? `/tool fetch url="${mainhotspotUrl}" dst-path=mainhotspot.rsc mode=https; /import mainhotspot.rsc`
    : "";

  const generateConfiguration = () => {
    if (!bootstrapCommand) return;
    setScript(bootstrapCommand);
    setCopyState("idle");
  };

  const copyScript = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 2_000);
  };

  const downloadScript = () => {
    if (!script) return;
    const blobUrl = URL.createObjectURL(new Blob([script], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "mainhotspot.rsc";
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <AdminLayout hiddenNavHrefs={["/admin/network/self-install"]}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1120 }}>
        <div>
          <h1 style={{ color: "var(--isp-text)", fontSize: "1.35rem", margin: 0, fontWeight: 800 }}>Add Router (Script)</h1>
          <p style={{ color: "var(--isp-text-muted)", margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
            Generate the company-hosted Main ISP bootstrap command for a new router.
          </p>
        </div>

        <section style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1.1rem" }}>
          <div style={{ marginBottom: "0.9rem", padding: "0.75rem 0.8rem", borderRadius: 8, background: "rgba(20,184,166,.07)", border: "1px solid rgba(20,184,166,.2)" }}>
            <div style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>
              Company script host
            </div>
            <div style={{ marginTop: "0.25rem", color: "var(--isp-accent)", fontFamily: "monospace", fontSize: "0.82rem", wordBreak: "break-all" }}>
              {loadingAccount ? "Loading company account…" : companyHost || "No company subdomain configured"}
            </div>
          </div>

          {accountError && (
            <div style={{ marginBottom: "0.85rem", display: "flex", alignItems: "flex-start", gap: 7, color: "#fca5a5", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 8, padding: "0.65rem 0.7rem", fontSize: "0.7rem", lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Could not load the signed-in company subdomain.
            </div>
          )}

          {!loadingAccount && !accountError && !companyHost && (
            <div style={{ marginBottom: "0.85rem", display: "flex", alignItems: "flex-start", gap: 7, color: "#fcd34d", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.25)", borderRadius: 8, padding: "0.65rem 0.7rem", fontSize: "0.7rem", lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Add a company subdomain before generating a router script.
            </div>
          )}

          <button
            onClick={() => void generateConfiguration()}
            disabled={loadingAccount || !bootstrapCommand}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: loadingAccount || !bootstrapCommand ? "rgba(20,184,166,.18)" : "linear-gradient(135deg,#14b8a6,#0d9488)",
              border: "none",
              borderRadius: 9,
              color: "white",
              padding: "0.8rem 1.1rem",
              fontWeight: 800,
              fontSize: "0.82rem",
              cursor: loadingAccount ? "wait" : "pointer",
            }}
          >
            {loadingAccount ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileCode2 size={16} />}
            {loadingAccount ? "Loading company…" : "Generate router command"}
          </button>

          {script && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: "0.65rem" }}>
                <button onClick={downloadScript} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--isp-accent)", border: "none", borderRadius: 7, color: "white", padding: "0.5rem 0.75rem", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer" }}>
                  <Download size={13} /> Download mainhotspot.rsc
                </button>
                <button onClick={() => void copyScript()} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 7, color: "var(--isp-text)", padding: "0.5rem 0.75rem", fontSize: "0.72rem", fontWeight: 750, cursor: "pointer" }}>
                  {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
                  {copyState === "copied" ? "Copied" : "Copy script"}
                </button>
              </div>
              <pre style={{ margin: 0, maxHeight: "58vh", overflow: "auto", background: "#0a0f1a", borderRadius: 8, padding: "0.85rem", color: "#cbd5e1", fontSize: "0.7rem", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {script}
              </pre>
            </div>
          )}
        </section>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </AdminLayout>
  );
}