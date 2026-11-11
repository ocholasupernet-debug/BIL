import React, { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { NetworkTabs } from "./NetworkTabs";

type RouterOption = { id: number; name: string; model?: string | null; ros_version?: string | null };
type EnrollmentResponse = {
  release: string;
  routerId: number;
  entryUrl: string;
  command: string;
  mode: "preflight-only";
  warning: string;
};

export default function RouterInstallerV2() {
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [routerId, setRouterId] = useState("");
  const [enrollment, setEnrollment] = useState<EnrollmentResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadRouters = useCallback(async () => {
    const token = getAdminApiToken();
    const response = await fetch(`/api/routers?adminId=${encodeURIComponent(String(ADMIN_ID))}&includeSetup=true`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error("Router list could not be loaded.");
    const rows = await response.json() as RouterOption[];
    setRouters(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    void loadRouters().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Router list could not be loaded.");
    });
  }, [loadRouters]);

  const issueCommand = async () => {
    if (!routerId) return;
    setBusy(true);
    setError("");
    setEnrollment(null);
    setCopied(false);
    try {
      const token = getAdminApiToken();
      const response = await fetch(`/api/router/${encodeURIComponent(routerId)}/installer-v2/enrollment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ adminId: ADMIN_ID }),
      });
      const result = await response.json() as EnrollmentResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not prepare the v2 preflight command.");
      setEnrollment(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the v2 preflight command.");
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = async () => {
    if (!enrollment?.command) return;
    await navigator.clipboard.writeText(enrollment.command);
    setCopied(true);
  };

  const card: React.CSSProperties = {
    background: "var(--isp-card, #fff)",
    border: "1px solid var(--isp-border, #e5e7eb)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,.05)",
  };

  return (
    <AdminLayout>
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 16 }}>
        <NetworkTabs active="installer-v2" />
        <header>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 5 }}>Network / RouterOS</div>
          <h1 style={{ margin: 0, fontSize: 26, color: "var(--isp-text, #172b3a)" }}>OCHOLASUPERNET Installer v2</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", lineHeight: 1.5 }}>
            Separate from Self Install. This release only backs up and inventories a router; it does not apply configuration.
          </p>
        </header>

        <section style={card} aria-labelledby="v2-preflight-title">
          <h2 id="v2-preflight-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Prepare a preflight command</h2>
          <p style={{ margin: "0 0 16px", color: "#64748b", lineHeight: 1.5 }}>
            Choose a tenant router. Its company-specific HTTPS URL is public and contains no token. Anyone can download this
            preflight file, so only run it on a router you control; it creates a local backup and inventory but does not apply
            configuration. The router must already trust the site certificate.
          </p>
          <label htmlFor="installer-v2-router" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Router</label>
          <select
            id="installer-v2-router"
            value={routerId}
            onChange={event => { setRouterId(event.target.value); setEnrollment(null); }}
            style={{ width: "100%", maxWidth: 520, padding: 10, borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            <option value="">Select a router</option>
            {routers.map(router => (
              <option key={router.id} value={router.id}>
                {router.name}{router.model ? ` · ${router.model}` : ""}{router.ros_version ? ` · RouterOS ${router.ros_version}` : ""}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => void issueCommand()}
              disabled={!routerId || busy}
              style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: "#1769e0", color: "#fff", fontWeight: 700, cursor: !routerId || busy ? "not-allowed" : "pointer", opacity: !routerId || busy ? .6 : 1 }}
            >
              {busy ? "Preparing…" : "Generate preflight command"}
            </button>
          </div>
          {error && <p role="alert" style={{ color: "#b42318", marginBottom: 0 }}>{error}</p>}
        </section>

        {enrollment && (
          <section style={card} aria-live="polite">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Preflight command · v{enrollment.release}</h2>
                <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>
                  Router {enrollment.routerId} · company-specific installer host
                </p>
              </div>
              <button type="button" onClick={() => void copyCommand()} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", fontWeight: 600 }}>
                {copied ? "Copied" : "Copy command"}
              </button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 14, background: "#101923", color: "#e2e8f0", borderRadius: 8, margin: "14px 0", fontSize: 12 }}>
              {enrollment.command}
            </pre>
            <p style={{ margin: 0, color: "#854d0e", lineHeight: 1.5 }}>{enrollment.warning}</p>
          </section>
        )}
      </main>
    </AdminLayout>
  );
}
