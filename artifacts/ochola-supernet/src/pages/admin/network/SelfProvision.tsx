import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { getAdminApiToken, getAdminRole, getSelectedTenantId } from "@/lib/supabase";
import { getHostSubdomain } from "@/lib/subdomain";
import {
  AlertTriangle, Check, CheckCircle2, Copy, Download, ExternalLink,
  FileCode2, Loader2, Network, RefreshCw, Server, ShieldCheck,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";

interface RouterSummary {
  id: number;
  name: string;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  status: string;
  last_seen: string | null;
  model: string | null;
  ros_version: string | null;
}

interface RouterStatus {
  ok: boolean;
  ready: boolean;
  connected: boolean;
  vpnConnected: boolean;
  vpnIp: string | null;
  via: string | null;
  error?: string;
  heartbeat: { recent: boolean; lastSeen: string | null };
  router: {
    id: number;
    name: string;
    status: string;
    model: string;
    rosVersion: string;
    identity: string;
    uptime: string;
  };
}

interface InstallerGrant {
  ok: boolean;
  grantToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminApiToken();
  const selectedTenantId = getSelectedTenantId();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (getAdminRole() === "superadmin" && selectedTenantId) {
    headers["X-Impersonated-Admin-Id"] = String(selectedTenantId);
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  const body = await response.text();
  let data: T & { error?: string } = {} as T & { error?: string };
  try {
    data = JSON.parse(body) as T & { error?: string };
  } catch {
    if (body.trim()) data.error = body.replace(/^#\s?/gm, "").trim();
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function authHeaders(): HeadersInit {
  const token = getAdminApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const panel: React.CSSProperties = {
  background: "var(--isp-section)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
};

export default function SelfProvision() {
  const [adminId, setAdminId] = useState<number | null>(() => getSelectedTenantId());
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [script, setScript] = useState("");
  const [scriptExpiresIn, setScriptExpiresIn] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const syncTenant = () => {
      setAdminId(getSelectedTenantId());
      setSelectedRouterId(null);
      setStatus(null);
      setScript("");
    };
    window.addEventListener("ochola-auth-change", syncTenant);
    syncTenant();
    return () => window.removeEventListener("ochola-auth-change", syncTenant);
  }, []);

  const routersQuery = useQuery<RouterSummary[]>({
    queryKey: ["self-provision-routers", adminId],
    queryFn: () => {
      if (!adminId) throw new Error("Sign in to an ISP account before starting self provision.");
      return jsonRequest<RouterSummary[]>(`/api/routers?adminId=${adminId}`);
    },
    enabled: !!adminId,
    refetchInterval: 15_000,
  });

  const routers = useMemo(
    () => (routersQuery.data ?? []).filter(router => !["setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"].includes(router.status)),
    [routersQuery.data],
  );
  const selectedRouter = routers.find(router => router.id === selectedRouterId) ?? null;

  useEffect(() => {
    if (!selectedRouterId && routers[0]) setSelectedRouterId(routers[0].id);
    if (selectedRouterId && !selectedRouter) {
      setSelectedRouterId(routers[0]?.id ?? null);
      setStatus(null);
      setScript("");
    }
  }, [routers, selectedRouter, selectedRouterId]);

  const checkReadiness = async () => {
    if (!adminId || !selectedRouterId) return;
    setStatusLoading(true);
    setError("");
    try {
      const result = await jsonRequest<RouterStatus>(
        `/api/admin/router/install-status/${selectedRouterId}?adminId=${adminId}&mode=coexist`,
      );
      setStatus(result);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Could not check router readiness.");
    } finally {
      setStatusLoading(false);
    }
  };

  const generateProvisioningBundle = async () => {
    if (!adminId || !selectedRouter) {
      setError("Choose an installed router before generating a provisioning bundle.");
      return;
    }
    setProvisioning(true);
    setError("");
    setScript("");
    setCopyState("idle");
    try {
      const grant = await jsonRequest<InstallerGrant>("/api/admin/router/self-install/grant", {
        method: "POST",
        body: JSON.stringify({ routerId: selectedRouter.id, adminId }),
      });
      if (!grant.ok || !grant.grantToken) throw new Error(grant.error || "Provisioning authorization could not be prepared.");
      const publicApiOrigin = (
        getHostSubdomain() ? window.location.origin : (API || window.location.origin)
      ).replace(/\/$/, "");
      const url = `${publicApiOrigin}/scripts/mainhotspot.rsc?rid=${selectedRouter.id}&adminId=${adminId}&grant=${encodeURIComponent(grant.grantToken)}&mode=coexist&certificate=on`;
      const response = await fetch(url, { headers: authHeaders() });
      const content = await response.text();
      if (!response.ok) throw new Error(content.replace(/^#\s?/gm, "").trim() || `Bundle generation failed (${response.status}).`);
      setScript(content);
      setScriptExpiresIn(grant.expiresInSeconds ?? 1_800);
      await checkReadiness();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the provisioning bundle.");
    } finally {
      setProvisioning(false);
    }
  };

  const downloadBundle = () => {
    if (!script || !selectedRouter) return;
    const blobUrl = URL.createObjectURL(new Blob([script], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `ochola-self-provision-${selectedRouter.name.replace(/[^a-z0-9_-]/gi, "-")}.rsc`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  };

  const copyBundle = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 2_000);
  };

  const readinessColor = status?.ready ? "#4ade80" : status?.vpnConnected ? "#fbbf24" : "#94a3b8";

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1120 }}>
        <div>
          <h1 style={{ color: "var(--isp-text)", fontSize: "1.35rem", margin: 0, fontWeight: 800 }}>Self Provision</h1>
          <p style={{ color: "var(--isp-text-muted)", margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
            Apply an authorized Ochola service bundle to a router that is already installed in this ISP account.
          </p>
        </div>

        <NetworkTabs active="self-provision" />

        <div className="self-provision-grid" style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.8fr) minmax(360px, 1.2fr)", gap: "1rem", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <section style={{ ...panel, padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 750, fontSize: "0.9rem" }}>
                <Server size={16} color="var(--isp-accent)" /> 1. Choose installed router
              </div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.5, margin: "0.5rem 0 0.85rem" }}>
                Self Provision does not create a new router record. Unfinished self-installs stay in the Self Install recovery flow.
              </p>
              {routersQuery.isLoading ? (
                <div style={{ color: "var(--isp-text-muted)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 7 }}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading routers…</div>
              ) : routers.length === 0 ? (
                <div style={{ border: "1px dashed var(--isp-border)", borderRadius: 8, padding: "0.8rem", color: "var(--isp-text-muted)", fontSize: "0.75rem" }}>
                  No installed routers are available. <Link href="/admin/network/self-install" style={{ color: "var(--isp-accent)" }}>Open Self Install</Link> to onboard one.
                </div>
              ) : (
                <select
                  value={selectedRouterId ?? ""}
                  onChange={event => { setSelectedRouterId(Number(event.target.value)); setStatus(null); setScript(""); setError(""); }}
                  style={{ width: "100%", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.65rem 0.7rem", color: "var(--isp-text)", fontSize: "0.78rem", fontFamily: "inherit" }}
                >
                  {routers.map(router => <option key={router.id} value={router.id}>{router.name} · {router.status} · {router.model || "MikroTik"}</option>)}
                </select>
              )}
              {selectedRouter && (
                <div style={{ marginTop: "0.8rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["Status", selectedRouter.status],
                    ["RouterOS", selectedRouter.ros_version || "Not reported"],
                    ["Management IP", selectedRouter.vpn_ip || "Pending"],
                    ["Last seen", formatDate(selectedRouter.last_seen)],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: "var(--isp-inner-card)", borderRadius: 7, padding: "0.55rem 0.65rem" }}>
                      <div style={{ color: "var(--isp-text-muted)", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                      <div style={{ color: "var(--isp-text)", fontSize: "0.72rem", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ ...panel, padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 750, fontSize: "0.9rem" }}>
                <ShieldCheck size={16} color="var(--isp-accent)" /> 2. Verify management access
              </div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.5, margin: "0.5rem 0 0.85rem" }}>
                The check uses only the isolated router-management VPN and RouterOS API. It never falls back to a public or LAN address.
              </p>
              <button onClick={() => void checkReadiness()} disabled={!selectedRouter || statusLoading} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)", borderRadius: 8, color: "var(--isp-accent)", padding: "0.6rem 0.8rem", fontWeight: 750, fontSize: "0.76rem", cursor: !selectedRouter || statusLoading ? "not-allowed" : "pointer", opacity: !selectedRouter ? 0.55 : 1 }}>
                {statusLoading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />} {statusLoading ? "Checking…" : "Check readiness"}
              </button>
              {status && (
                <div style={{ marginTop: "0.8rem", borderRadius: 8, padding: "0.7rem", background: status.ready ? "rgba(74,222,128,0.08)" : "rgba(251,191,36,0.08)", border: `1px solid ${status.ready ? "rgba(74,222,128,0.25)" : "rgba(251,191,36,0.25)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, color: readinessColor, fontSize: "0.76rem", fontWeight: 800 }}>
                    {status.ready ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {status.ready ? "Ready through management VPN" : "Router needs attention"}
                  </div>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: 4 }}>{status.error || `${status.router.identity || status.router.name} · ${status.router.rosVersion || "RouterOS version pending"}`}</div>
                </div>
              )}
            </section>
          </div>

          <section style={{ ...panel, padding: "1rem 1.1rem", minHeight: 340 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 750, fontSize: "0.9rem" }}>
              <FileCode2 size={16} color="var(--isp-accent)" /> 3. Generate provisioning bundle
            </div>
            <p style={{ color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.5, margin: "0.5rem 0 0.85rem" }}>
              The bundle is scoped to the selected router and ISP account. It is authorized for a short period and contains the RouterOS commands needed to apply the service configuration.
            </p>
            <button onClick={() => void generateProvisioningBundle()} disabled={!selectedRouter || provisioning} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: provisioning ? "rgba(20,184,166,.18)" : "linear-gradient(135deg,#14b8a6,#0d9488)", border: "none", borderRadius: 8, color: "white", padding: "0.68rem 0.8rem", fontWeight: 800, fontSize: "0.78rem", cursor: !selectedRouter || provisioning ? "not-allowed" : "pointer", opacity: !selectedRouter ? 0.55 : 1 }}>
              {provisioning ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Network size={14} />} {provisioning ? "Preparing secure bundle…" : "Generate Self Provision bundle"}
            </button>
            {script && (
              <div style={{ marginTop: "1rem", borderRadius: 9, background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.25)", padding: "0.8rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#4ade80", fontWeight: 800, fontSize: "0.78rem" }}><CheckCircle2 size={14} /> Bundle ready for {selectedRouter?.name}</div>
                <p style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", lineHeight: 1.5, margin: "0.45rem 0 0.75rem" }}>
                  Download it, open MikroTik Winbox or WebFig Terminal, paste it, and wait for the success log before closing the terminal. The authorization expires in about {Math.round((scriptExpiresIn ?? 1800) / 60)} minutes.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button onClick={downloadBundle} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--isp-accent)", border: "none", borderRadius: 7, color: "white", padding: "0.5rem 0.75rem", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer" }}><Download size={13} /> Download .rsc</button>
                  <button onClick={() => void copyBundle()} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 7, color: "var(--isp-text)", padding: "0.5rem 0.75rem", fontSize: "0.72rem", fontWeight: 750, cursor: "pointer" }}>{copyState === "copied" ? <Check size={13} /> : <Copy size={13} />} {copyState === "copied" ? "Copied" : "Copy commands"}</button>
                </div>
              </div>
            )}
            {error && <div style={{ marginTop: "0.85rem", display: "flex", alignItems: "flex-start", gap: 7, color: "#fca5a5", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 8, padding: "0.65rem 0.7rem", fontSize: "0.7rem", lineHeight: 1.5 }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}</div>}
            <div style={{ marginTop: "1.3rem", paddingTop: "0.8rem", borderTop: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontSize: "0.68rem", lineHeight: 1.55 }}>
              Need to onboard a new device instead? <Link href="/admin/network/self-install" style={{ color: "var(--isp-accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>Use Self Install <ExternalLink size={11} /></Link>
            </div>
          </section>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@media(max-width:760px){.self-provision-grid{grid-template-columns:1fr!important}}`}</style>
    </AdminLayout>
  );
}