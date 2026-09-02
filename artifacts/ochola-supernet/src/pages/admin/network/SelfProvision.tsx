import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { getAdminApiToken } from "@/lib/supabase";
import { Check, Copy, Download, FileCode2, Loader2, AlertTriangle } from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): HeadersInit {
  const token = getAdminApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AddRouterScript() {
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState("");

  const generateConfiguration = async () => {
    setLoading(true);
    setError("");
    setScript("");
    setCopyState("idle");
    try {
      const response = await fetch(`${API}/api/admin/isp-configuration/mainhotspot.rsc`, {
        headers: authHeaders(),
      });
      const content = await response.text();
      if (!response.ok) {
        throw new Error(content.replace(/^#\s?/gm, "").trim() || `Configuration generation failed (${response.status}).`);
      }
      setScript(content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the configuration.");
    } finally {
      setLoading(false);
    }
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
            Add a router using the standalone Main ISP configuration script.
          </p>
        </div>

        <section style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1.1rem" }}>
          <button
            onClick={() => void generateConfiguration()}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: loading ? "rgba(20,184,166,.18)" : "linear-gradient(135deg,#14b8a6,#0d9488)",
              border: "none",
              borderRadius: 9,
              color: "white",
              padding: "0.8rem 1.1rem",
              fontWeight: 800,
              fontSize: "0.82rem",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileCode2 size={16} />}
            {loading ? "Generating configuration…" : "Generate configuration"}
          </button>

          {error && (
            <div style={{ marginTop: "0.85rem", display: "flex", alignItems: "flex-start", gap: 7, color: "#fca5a5", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 8, padding: "0.65rem 0.7rem", fontSize: "0.7rem", lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
            </div>
          )}

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