import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import {
  getAdminApiToken,
  getAdminRole,
  getSelectedTenantId,
} from "@/lib/supabase";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, Copy,
  Download, HelpCircle, Info, Loader2, Network, Plug, RefreshCw, Server,
  Settings, Shield, Terminal, Wifi, X,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";
const CONFIG_CATEGORIES = [
  { id: "plans", label: "Plans", detail: "Hotspot and PPPoE service profiles" },
  { id: "ipPools", label: "IP pools", detail: "Named RouterOS address pools" },
  { id: "pppoe", label: "PPPoE settings", detail: "PPPoE secrets and profiles" },
  { id: "users", label: "Users", detail: "Hotspot and PPPoE customer accounts" },
] as const;
type ConfigCategory = typeof CONFIG_CATEGORIES[number]["id"];
type Phase = "idle" | "install" | "ports" | "success";
type CertificateMode = "verified" | "unverified";
type InstallationMode = "coexist" | "takeover";

interface RouterSummary {
  id: number;
  admin_id: number;
  name: string;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  status: string;
  last_seen: string | null;
  model: string | null;
  ros_version: string | null;
}

interface InstallStatus {
  ok: boolean;
  ready: boolean;
  scriptComplete: boolean;
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

interface InstallStep {
  step: number;
  name: string;
  phase: "downloading" | "applied" | "failed";
  error?: string;
}

interface InstallProgress {
  routerId: number;
  done: boolean;
  failures: number;
  steps: InstallStep[];
}

interface Iface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string;
  comment: string;
}

interface Bridge {
  name: string;
  running: boolean;
}

interface BridgePort {
  bridge: string;
  interface: string;
  id: string;
}

interface PortsPayload {
  ok: boolean;
  error?: string;
  connectedVia?: string;
  interfaces: Iface[];
  bridges: Bridge[];
  bridgePorts: BridgePort[];
}

interface CopyResult {
  ok: boolean;
  sourceRouter?: { id: number; name: string };
  targetRouter?: { id: number; name: string };
  categories?: Record<string, { ok: boolean; count: number; logs: string[]; error?: string }>;
  logs?: string[];
  error?: string;
}

interface TakeoverPreparation {
  ok: boolean;
  grantToken?: string;
  confirmation?: string;
  expiresInSeconds?: number;
  removalPlan?: string[];
  error?: string;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminApiToken();
  const selectedTenantId = getSelectedTenantId();
  const authHeaders: Record<string, string> = {};
  if (token) authHeaders.Authorization = `Bearer ${token}`;
  if (getAdminRole() === "superadmin" && selectedTenantId) {
    authHeaders["X-Impersonated-Admin-Id"] = String(selectedTenantId);
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
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

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function coexistenceBridgeName(routerId: number): string {
  return `ochola-hs-${routerId}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
        padding: "0.32rem 0.65rem", borderRadius: 6,
        background: copied ? "rgba(34,197,94,.14)" : "rgba(255,255,255,.07)",
        border: `1px solid ${copied ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.12)"}`,
        color: copied ? "#4ade80" : "#94a3b8", fontSize: "0.68rem",
        fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span style={{
    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
    background: active ? "#4ade80" : "#64748b",
    boxShadow: active ? "0 0 0 4px rgba(74,222,128,.12)" : "none",
  }} />;
}

function modelAsset(model: string): { src: string; label: string } {
  const value = model.toLowerCase();
  if (/hap[\s-]*(lite|ac\s*lite)|rb?941|hap\s*lite/.test(value)) {
    return { src: "/images/router-models/hap-lite.svg", label: "MikroTik hAP lite" };
  }
  if (/rb951|951|hap\s*ac2/.test(value)) {
    return { src: "/images/router-models/rb951.svg", label: "MikroTik RB951 family" };
  }
  return { src: "/images/router-models/generic-mikrotik.svg", label: "MikroTik router" };
}

function ifaceKind(iface: Iface): "wlan" | "ether" | "protected" | "other" {
  const name = iface.name.toLowerCase();
  const type = iface.type.toLowerCase();
  if (type === "wlan" || name.startsWith("wlan") || name.startsWith("wifi")) return "wlan";
  if (name === "ether1" || name.includes("ovpn") || name.includes("vpn") ||
      type === "bridge" || type === "loopback") return "protected";
  if (type === "ether" || name.startsWith("ether") || name.startsWith("sfp")) return "ether";
  return "other";
}

function bridgeForPort(name: string, memberships: BridgePort[]): string | null {
  return memberships.find(item => item.interface === name)?.bridge ?? null;
}

function panelStyle(): React.CSSProperties {
  return {
    background: "var(--isp-card)", border: "1px solid var(--isp-border)",
    borderRadius: 12, overflow: "hidden",
  };
}

function primaryButton(disabled = false): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "0.68rem 1.35rem", borderRadius: 9, border: "none",
    background: disabled ? "rgba(20,184,166,.18)" : "linear-gradient(135deg,#14b8a6,#0d9488)",
    color: disabled ? "#5eead4" : "white", fontWeight: 800, fontSize: "0.86rem",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    boxShadow: disabled ? "none" : "0 4px 14px rgba(20,184,166,.28)",
  };
}

function RouterRecovery({
  error,
  routerId,
  installationMode,
}: {
  error?: string;
  routerId?: number | null;
  installationMode?: InstallationMode;
}) {
  const interfaceName = installationMode === "coexist" && routerId
    ? `ochola-mgmt-vpn-${routerId}`
    : "corebillingvpn";
  return (
    <div style={{
      background: "rgba(248,113,113,.06)", border: "1px solid rgba(248,113,113,.25)",
      borderRadius: 10, padding: "0.9rem 1rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#f87171", fontSize: "0.83rem", fontWeight: 800 }}>
        <AlertTriangle size={15} /> Waiting for the router-management VPN
      </div>
      <p style={{ margin: "0.45rem 0 0", color: "#fca5a5", fontSize: "0.76rem", lineHeight: 1.6 }}>
        {error || "The router has not connected to the isolated 10.8.5.x management network yet."}
        {" "}Confirm the router has internet, re-run the downloaded script in Winbox Terminal, and wait for the VPN client to reconnect.
      </p>
      <code style={{
        display: "block", marginTop: "0.65rem", color: "#67e8f9", background: "rgba(0,0,0,.28)",
        borderRadius: 6, padding: "0.5rem 0.65rem", fontSize: "0.7rem",
      }}>
        /interface ovpn-client enable {interfaceName}
      </code>
    </div>
  );
}

export default function SelfInstall() {
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const reconfigureId = params.get("reconfigure") ? Number(params.get("reconfigure")) : null;
  const [adminId, setAdminId] = useState<number | null>(() => getSelectedTenantId());
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeRouterId, setActiveRouterId] = useState<number | null>(reconfigureId);
  const [generating, setGenerating] = useState(false);
  const [certificateMode, setCertificateMode] = useState<CertificateMode>("verified");
  const [installationMode, setInstallationMode] = useState<InstallationMode>("coexist");
  const [takeoverConfirmation, setTakeoverConfirmation] = useState("");
  const [takeoverGrant, setTakeoverGrant] = useState("");
  const [takeoverPlan, setTakeoverPlan] = useState<string[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [ports, setPorts] = useState<PortsPayload | null>(null);
  const [selectedBridge, setSelectedBridge] = useState("");
  const [selectedPorts, setSelectedPorts] = useState<Set<string>>(new Set());
  const [portState, setPortState] = useState<Record<string, "pending" | "applied" | "failed">>({});
  const [portError, setPortError] = useState<string | null>(null);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeRouter, setCompleteRouter] = useState<InstallStatus["router"] | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [sourceRouterId, setSourceRouterId] = useState<number | null>(null);
  const [copyCategories, setCopyCategories] = useState<Set<ConfigCategory>>(
    new Set(CONFIG_CATEGORIES.map(category => category.id)),
  );
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [copySkipped, setCopySkipped] = useState(false);

  useEffect(() => {
    const syncTenant = () => setAdminId(getSelectedTenantId());
    window.addEventListener("ochola-auth-change", syncTenant);
    syncTenant();
    return () => window.removeEventListener("ochola-auth-change", syncTenant);
  }, []);

  const routersQuery = useQuery<RouterSummary[]>({
    queryKey: ["self-install-routers", adminId],
    queryFn: async () => {
      if (!adminId) throw new Error("Sign in to an ISP account before starting router self-install.");
       return jsonRequest<RouterSummary[]>(`/api/routers?adminId=${adminId}`);
    },
    enabled: !!adminId,
    refetchInterval: 6_000,
  });
  const routers = routersQuery.data ?? [];
  const activeRouter = routers.find(router => router.id === activeRouterId) ?? null;
  const sourceRouters = routers.filter(router => router.id !== activeRouterId && router.status !== "setup");
  const selectedSource = sourceRouters.find(router => router.id === sourceRouterId) ?? sourceRouters[0] ?? null;

  useEffect(() => {
    if (sourceRouters.length > 0 && !sourceRouterId) setSourceRouterId(sourceRouters[0].id);
  }, [sourceRouters.length, sourceRouterId]);

  const statusQuery = useQuery<InstallStatus>({
    queryKey: ["self-install-status", adminId, activeRouterId],
    queryFn: () => {
      if (!adminId) throw new Error("Sign in to an ISP account before checking router installation.");
       return jsonRequest<InstallStatus>(`/api/admin/router/install-status/${activeRouterId}?adminId=${adminId}&mode=${installationMode}`);
    },
    enabled: !!adminId && !!activeRouterId && phase === "install",
    refetchInterval: phase === "install" ? 4_000 : false,
  });
  const progressQuery = useQuery<{ ok: boolean; installs: InstallProgress[] }>({
    queryKey: ["self-install-progress", adminId, activeRouterId],
    queryFn: () => {
      if (!adminId) throw new Error("Sign in to an ISP account before checking installer progress.");
      return jsonRequest<{ ok: boolean; installs: InstallProgress[] }>(`/api/admin/router/install-progress?adminId=${adminId}`);
    },
    enabled: !!adminId && !!activeRouterId && phase === "install",
    refetchInterval: phase === "install" ? 4_000 : false,
  });
  const progress = progressQuery.data?.installs.find(item => item.routerId === activeRouterId);
  const status = statusQuery.data;
  const identityReady = !!status?.ready;

  const handleGenerate = async (mode: CertificateMode) => {
    if (!adminId) {
      setPageError("Your ISP session is missing a tenant account. Sign in again before creating a router profile.");
      return;
    }
    if (reconfigureId && !activeRouter) {
      setPageError("The router selected for reconfiguration is not available in this ISP account.");
      return;
    }
    setGenerating(true);
    setCertificateMode(mode);
    setPageError(null);
    try {
      const result = await jsonRequest<{ ok: boolean; router?: RouterSummary }>("/api/admin/router/ensure", {
        method: "POST",
        body: JSON.stringify({ adminId, routerName: activeRouter?.name || `router${routers.length + 1}` }),
      });
      if (!result.ok || !result.router?.id) throw new Error("The router profile could not be created.");
      if (installationMode === "takeover") {
        const prepared = await jsonRequest<TakeoverPreparation>("/api/admin/router/self-install/takeover/prepare", {
          method: "POST",
          body: JSON.stringify({
            routerId: result.router.id,
            adminId,
            confirmation: takeoverConfirmation,
          }),
        });
        if (!prepared.ok || !prepared.grantToken) {
          throw new Error(prepared.error || "Takeover authorization could not be prepared.");
        }
        setTakeoverGrant(prepared.grantToken);
        setTakeoverPlan(prepared.removalPlan ?? []);
      } else {
        const prepared = await jsonRequest<{ ok: boolean; grantToken?: string; error?: string }>(
          "/api/admin/router/self-install/grant",
          {
            method: "POST",
            body: JSON.stringify({ routerId: result.router.id, adminId }),
          },
        );
        if (!prepared.ok || !prepared.grantToken) {
          throw new Error(prepared.error || "Installer authorization could not be prepared.");
        }
        setTakeoverGrant(prepared.grantToken);
        setTakeoverPlan([]);
      }
      let vpnWarning = "";
      try {
        await jsonRequest<{ ok: boolean; ready: boolean }>(
          `/api/scripts/router-vpn/readiness?rid=${result.router.id}&adminId=${adminId}`,
        );
      } catch (error) {
        vpnWarning = error instanceof Error ? error.message : String(error);
      }
      setActiveRouterId(result.router.id);
      setPhase("install");
      if (vpnWarning) {
        setPageError(`Profile created. The installer is available, but router-management VPN provisioning is pending: ${vpnWarning}`);
      }
      qc.invalidateQueries({ queryKey: ["self-install-routers", adminId] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const routerName = activeRouter?.name || status?.router.name || `router${routers.length + 1}`;
  const certificateQuery = certificateMode === "unverified" ? "&certificate=off" : "";
  const modeQuery = `&mode=${installationMode}${takeoverGrant ? `&grant=${encodeURIComponent(takeoverGrant)}` : ""}`;
  const publicApiOrigin = (API || window.location.origin).replace(/\/$/, "");
  const scriptUrl = `${publicApiOrigin}/api/scripts/mainhotspot.rsc?rid=${activeRouterId ?? ""}&adminId=${adminId ?? ""}${modeQuery}${certificateQuery}`;
  const caUrl = `${publicApiOrigin}/api/scripts/ochola-isrg-root-x1.pem`;
  const fetchCommand = certificateMode === "verified"
    ? `:if ([:len [/certificate find name="ochola-isrg-root-x1"]] = 0) do={ /tool fetch url="${caUrl}" dst-path=ochola-isrg-root-x1.pem keep-result=yes mode=https check-certificate=no; /certificate import file-name=ochola-isrg-root-x1.pem name=ochola-isrg-root-x1 trusted=yes; /file remove [find name=ochola-isrg-root-x1.pem] }; /tool fetch url="${scriptUrl}" dst-path=mainhotspot.rsc keep-result=yes mode=https check-certificate=yes`
    : `/tool fetch url="${scriptUrl}" dst-path=mainhotspot.rsc keep-result=yes mode=https check-certificate=no`;

  const loadPorts = async () => {
    if (!activeRouterId) return;
    setPortsLoading(true);
    setPageError(null);
    setPortError(null);
    try {
      const data = await jsonRequest<PortsPayload>("/api/admin/router/self-install/ports", {
        method: "POST",
        body: JSON.stringify({ routerId: activeRouterId, adminId, installationMode }),
      });
      if (!data.ok) throw new Error(data.error || "Could not read the router interfaces.");
      setPorts(data);
      const bridge = installationMode === "coexist"
        ? data.bridges.find(item => item.name === coexistenceBridgeName(activeRouterId))
        : data.bridges.find(item => /hotspot/i.test(item.name)) ?? data.bridges[0];
      if (!bridge) throw new Error("The router has no bridge available. Create a bridge in RouterOS, then retry.");
      setSelectedBridge(bridge.name);
      setSelectedPorts(new Set(data.bridgePorts.filter(item => item.bridge === bridge.name).map(item => item.interface)));
      setPortState({});
      setPhase("ports");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      setPortsLoading(false);
    }
  };

  const togglePort = async (iface: Iface) => {
    if (!activeRouterId || !ports || !selectedBridge || ifaceKind(iface) === "protected" || portState[iface.name] === "pending") return;
    const currentBridge = bridgeForPort(iface.name, ports.bridgePorts);
    if (installationMode === "coexist" && currentBridge && currentBridge !== selectedBridge) {
      setPortError(`${iface.name} is assigned to ${currentBridge}, so Coexistence will not move it from the other billing system.`);
      return;
    }
    const wasSelected = selectedPorts.has(iface.name);
    const next = new Set(selectedPorts);
    if (wasSelected) next.delete(iface.name); else next.add(iface.name);
    setSelectedPorts(next);
    setPortState(state => ({ ...state, [iface.name]: "pending" }));
    setPortError(null);
    try {
      const result = await jsonRequest<{ ok: boolean; logs?: string[]; error?: string }>(
        "/api/admin/router/self-install/bridge-assign",
        {
          method: "POST",
          body: JSON.stringify({
            routerId: activeRouterId,
            adminId,
            bridge: selectedBridge,
            installationMode,
            addPorts: wasSelected ? [] : [iface.name],
            removePorts: wasSelected ? [iface.name] : [],
            desiredPorts: [...next].filter(name => name !== "ether1"),
          }),
        },
      );
      if (!result.ok) throw new Error(result.error || result.logs?.join(" ") || "The router rejected this port change.");
      setPortState(state => ({ ...state, [iface.name]: "applied" }));
      setPorts(current => current ? {
        ...current,
        bridgePorts: [
          ...current.bridgePorts.filter(item => !(item.bridge === selectedBridge && item.interface === iface.name)),
          ...(wasSelected ? [] : [{ bridge: selectedBridge, interface: iface.name, id: `local-${iface.name}` }]),
        ],
      } : current);
    } catch (error) {
      setSelectedPorts(previous => {
        const restored = new Set(previous);
        if (wasSelected) restored.add(iface.name); else restored.delete(iface.name);
        return restored;
      });
      setPortState(state => ({ ...state, [iface.name]: "failed" }));
      setPortError(error instanceof Error ? error.message : String(error));
    }
  };

  const finishInstallation = async () => {
    if (!activeRouterId || !status?.ready || Object.values(portState).some(value => value === "pending")) return;
    if (installationMode === "coexist" && selectedPorts.size === 0) {
      setPortError("Select at least one unassigned physical port for the isolated OcholaSuperNet bridge before finishing.");
      return;
    }
    setCompleteLoading(true);
    setPageError(null);
    try {
      const result = await jsonRequest<{ ok: boolean; router: InstallStatus["router"] }>("/api/admin/router/install-complete", {
        method: "POST",
        body: JSON.stringify({
          routerId: activeRouterId,
          adminId,
          bridge: selectedBridge,
          installationMode,
          ports: [...selectedPorts],
        }),
      });
      if (!result.ok) throw new Error("The router did not pass the final VPN verification.");
      setCompleteRouter(result.router);
      setPhase("success");
      qc.invalidateQueries({ queryKey: ["self-install-routers", adminId] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompleteLoading(false);
    }
  };

  const runCopy = async () => {
    if (!activeRouterId || !selectedSource || copyCategories.size === 0) return;
    setCopyLoading(true);
    setCopyResult(null);
    setCopySkipped(false);
    try {
      const result = await jsonRequest<CopyResult>("/api/admin/router/sync-copy", {
        method: "POST",
        body: JSON.stringify({
          adminId,
          sourceRouterId: selectedSource.id,
          targetRouterId: activeRouterId,
          categories: [...copyCategories],
        }),
      });
      setCopyResult(result);
    } catch (error) {
      setCopyResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setCopyLoading(false);
    }
  };

  const asset = modelAsset(completeRouter?.model || status?.router.model || activeRouter?.model || "");
  const liveInterfaces = (ports?.interfaces ?? []).filter(iface => !["bridge", "loopback"].includes(iface.type.toLowerCase()));
  const stepLabels = ["Generate profile", "Run installer", "VPN + heartbeat", "Router ports", "Installed"];
  const currentStep = phase === "idle" ? 0 : phase === "install" ? (identityReady ? 3 : 2) : phase === "ports" ? 4 : 5;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 900 }}>
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--isp-text)", margin: "0 0 .2rem" }}>
            {reconfigureId ? "Reconfigure Router" : "Self Install"}
          </h1>
          <p style={{ fontSize: ".8rem", color: "var(--isp-text-muted)", margin: 0 }}>
            Connect a MikroTik through the management VPN, choose its live ports, and finish setup without leaving this flow.
          </p>
        </div>
        <NetworkTabs active="self-install" />

        <div style={{
          display: "flex", alignItems: "center", gap: 0, overflowX: "auto",
          background: "rgba(20,184,166,.05)", border: "1px solid rgba(20,184,166,.18)",
          borderRadius: 10, padding: ".65rem .8rem",
        }}>
          {stepLabels.map((label, index) => {
            const done = currentStep > index;
            const active = currentStep === index;
            return (
              <React.Fragment key={label}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
                  <span style={{
                    width: 21, height: 21, borderRadius: "50%", display: "inline-flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: done || active ? "var(--isp-accent)" : "rgba(255,255,255,.08)",
                    color: done || active ? "white" : "var(--isp-text-muted)", fontSize: ".63rem", fontWeight: 800,
                  }}>{done ? <Check size={11} /> : index + 1}</span>
                  <span style={{ color: done || active ? "var(--isp-accent)" : "var(--isp-text-muted)", fontSize: ".7rem", fontWeight: active ? 800 : 500 }}>
                    {label}
                  </span>
                </div>
                {index < stepLabels.length - 1 && <ChevronRight size={12} style={{ color: "rgba(255,255,255,.18)", margin: "0 .35rem", flexShrink: 0 }} />}
              </React.Fragment>
            );
          })}
        </div>

        {pageError && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fca5a5", background: "rgba(248,113,113,.07)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 9, padding: ".75rem 1rem", fontSize: ".78rem" }}>
            <AlertTriangle size={15} /> {pageError}
            <button onClick={() => setPageError(null)} style={{ marginLeft: "auto", background: "none", border: 0, color: "#fca5a5", cursor: "pointer" }}><X size={14} /></button>
          </div>
        )}

        {phase === "idle" && (
          <>
            <div style={{ ...panelStyle(), padding: "1.1rem 1.2rem" }}>
              <div style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: ".86rem", marginBottom: ".45rem" }}>
                Choose how this router should join the ISP
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 9 }}>
                {([
                  {
                    mode: "coexist" as const,
                    title: "Coexistence · recommended",
                    detail: "Preserves another billing system and customer access. Audits the router, adds only isolated management resources, and stops on required-resource conflicts.",
                    color: "#5eead4",
                  },
                  {
                    mode: "takeover" as const,
                    title: "Takeover · destructive",
                    detail: "Replaces the router's Ochola-tagged service configuration after a verified backup/export. Supabase customers and billing records are never deleted.",
                    color: "#fbbf24",
                  },
                ]).map(option => {
                  const selected = installationMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      onClick={() => {
                        setInstallationMode(option.mode);
                        if (option.mode === "coexist") {
                          setTakeoverConfirmation("");
                          setTakeoverGrant("");
                          setTakeoverPlan([]);
                        }
                      }}
                      style={{
                        textAlign: "left", padding: ".75rem .8rem", borderRadius: 9,
                        border: `1px solid ${selected ? option.color : "var(--isp-border)"}`,
                        background: selected ? `${option.color}12` : "rgba(255,255,255,.02)",
                        color: "var(--isp-text)", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: ".76rem", color: selected ? option.color : "var(--isp-text)" }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${selected ? option.color : "rgba(255,255,255,.25)"}`, display: "inline-block", boxShadow: selected ? `inset 0 0 0 3px var(--isp-card), inset 0 0 0 7px ${option.color}` : "none" }} />
                        {option.title}
                      </div>
                      <div style={{ color: "var(--isp-text-muted)", fontSize: ".68rem", lineHeight: 1.55, marginTop: ".4rem" }}>{option.detail}</div>
                    </button>
                  );
                })}
              </div>
              {installationMode === "takeover" && (
                <div style={{ marginTop: ".85rem", padding: ".75rem .8rem", borderRadius: 8, background: "rgba(251,191,36,.07)", border: "1px solid rgba(251,191,36,.25)" }}>
                  <div style={{ color: "#fbbf24", fontSize: ".72rem", fontWeight: 800 }}>Destructive confirmation required</div>
                  <p style={{ color: "#fcd34d", fontSize: ".68rem", lineHeight: 1.5, margin: ".3rem 0 .55rem" }}>
                    The installer will create and verify a MikroTik backup/export before replacing router service resources. Type <strong>TAKE CONTROL</strong> to continue.
                  </p>
                  <input
                    value={takeoverConfirmation}
                    onChange={event => setTakeoverConfirmation(event.target.value)}
                    placeholder="TAKE CONTROL"
                    aria-label="Type TAKE CONTROL to authorize takeover"
                    style={{ width: "100%", boxSizing: "border-box", background: "#0a0f1a", color: "#fde68a", border: "1px solid rgba(251,191,36,.35)", borderRadius: 7, padding: ".55rem .65rem", fontFamily: "monospace", fontSize: ".75rem" }}
                  />
                </div>
              )}
            </div>
            <div style={{ ...panelStyle(), padding: "1.2rem 1.3rem", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Info size={18} style={{ color: "#60a5fa", flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "var(--isp-text)", fontSize: ".88rem" }}>Create a router-specific installation profile</strong>
                <p style={{ color: "var(--isp-text-muted)", fontSize: ".78rem", lineHeight: 1.65, margin: ".35rem 0 0" }}>
                  The profile is scoped to the selected ISP account and uses the isolated 10.8.5.x management VPN. The selected mode controls whether existing router services are preserved or replaced.
                  After the router reports its identity and heartbeat, this page unlocks the live port step.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              <button onClick={() => void handleGenerate("verified")} disabled={generating || (installationMode === "takeover" && takeoverConfirmation !== "TAKE CONTROL")} style={{ ...primaryButton(generating || (installationMode === "takeover" && takeoverConfirmation !== "TAKE CONTROL")), alignSelf: "flex-start" }}>
                {generating && certificateMode === "verified" ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Shield size={15} />}
                {generating && certificateMode === "verified" ? "Creating secure profile…" : "Generate with certificate"}
              </button>
              <button onClick={() => void handleGenerate("unverified")} disabled={generating || (installationMode === "takeover" && takeoverConfirmation !== "TAKE CONTROL")} style={{
                ...primaryButton(generating || (installationMode === "takeover" && takeoverConfirmation !== "TAKE CONTROL")),
                alignSelf: "flex-start",
                background: generating ? "rgba(148,163,184,.12)" : "rgba(148,163,184,.14)",
                color: generating ? "#94a3b8" : "#cbd5e1",
                border: "1px solid rgba(148,163,184,.25)",
                boxShadow: "none",
              }}>
                {generating && certificateMode === "unverified" ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Terminal size={15} />}
                {generating && certificateMode === "unverified" ? "Creating fallback profile…" : "Generate without certificate"}
              </button>
            </div>
            {routers.filter(router => router.status !== "setup").length > 0 && (
              <div style={{ ...panelStyle(), padding: "1rem 1.15rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--isp-text)", fontWeight: 700, fontSize: ".8rem", marginBottom: ".6rem" }}>
                  <Server size={14} style={{ color: "var(--isp-accent)" }} /> Existing routers
                </div>
                {routers.filter(router => router.status !== "setup").map(router => (
                  <div key={router.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: ".5rem 0", borderTop: "1px solid var(--isp-border-subtle)", fontSize: ".76rem" }}>
                    <StatusDot active={router.status === "online" || router.status === "connected"} />
                    <span style={{ color: "var(--isp-text)", fontWeight: 700 }}>{router.name}</span>
                    <span style={{ color: "var(--isp-text-muted)", marginLeft: "auto" }}>{router.model || "MikroTik"}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "install" && activeRouterId && (
          <>
            <div style={{ ...panelStyle(), padding: "1rem 1.15rem", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(20,184,166,.12)", color: "var(--isp-accent)" }}><Server size={18} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: ".9rem" }}>{routerName}</div>
                <div style={{ color: "var(--isp-text-muted)", fontSize: ".73rem", marginTop: 2 }}>Persistent management address: <code style={{ color: "#5eead4" }}>{status?.vpnIp || activeRouter?.vpn_ip || "assigning…"}</code></div>
              </div>
              <span style={{ color: installationMode === "takeover" ? "#fbbf24" : "#5eead4", border: `1px solid ${installationMode === "takeover" ? "rgba(251,191,36,.3)" : "rgba(94,234,212,.25)"}`, background: installationMode === "takeover" ? "rgba(251,191,36,.08)" : "rgba(94,234,212,.06)", borderRadius: 999, padding: ".25rem .55rem", fontSize: ".63rem", fontWeight: 800 }}>
                {installationMode === "takeover" ? "TAKEOVER" : "COEXISTENCE"}
              </span>
              <button onClick={() => setShowHelp(value => !value)} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--isp-text-muted)", background: "transparent", border: "1px solid var(--isp-border)", borderRadius: 7, padding: ".38rem .65rem", fontSize: ".7rem", cursor: "pointer", fontFamily: "inherit" }}>
                <HelpCircle size={13} /> Help
              </button>
            </div>
            {showHelp && (
              <div style={{ background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.22)", borderRadius: 9, padding: ".8rem 1rem", color: "#fbbf24", fontSize: ".75rem", lineHeight: 1.65 }}>
                Reset the MikroTik, give it internet, open Winbox → New Terminal, then run Download configuration followed by Run installer. Leave the terminal open until the final “Setup complete” message appears.
              </div>
            )}
            {installationMode === "takeover" && takeoverPlan.length > 0 && (
              <div style={{ ...panelStyle(), padding: "1rem 1.15rem", background: "rgba(251,191,36,.05)", borderColor: "rgba(251,191,36,.25)" }}>
                <div style={{ color: "#fbbf24", fontWeight: 800, fontSize: ".82rem" }}>Takeover removal/replacement summary</div>
                <ul style={{ color: "#fcd34d", fontSize: ".7rem", lineHeight: 1.6, margin: ".45rem 0 0", paddingLeft: "1.1rem" }}>
                  {takeoverPlan.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            <div style={{ ...panelStyle(), padding: "1rem 1.15rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--isp-text)", fontWeight: 800, fontSize: ".84rem", marginBottom: ".75rem" }}>
                <Terminal size={14} style={{ color: "var(--isp-accent)" }} /> Run the installer in Winbox Terminal
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: ".65rem" }}>
                <div>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: ".7rem", fontWeight: 700, marginBottom: ".35rem" }}>
                    1. {certificateMode === "verified" ? "Install HTTPS trust and download configuration" : "Download configuration without certificate validation"}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#0a0f1a", borderRadius: 7, padding: ".6rem .7rem" }}>
                    <code style={{ color: "#7dd3fc", fontSize: ".7rem", lineHeight: 1.55, wordBreak: "break-all", flex: 1 }}>{fetchCommand}</code>
                    <CopyButton text={fetchCommand} />
                  </div>
                </div>
                {certificateMode === "unverified" && (
                  <div style={{ color: "#fbbf24", fontSize: ".7rem", lineHeight: 1.5 }}>
                    Certificate validation is disabled for this installer. HTTPS encryption remains enabled, but use this only until the production certificate is corrected.
                  </div>
                )}
                <div>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: ".7rem", fontWeight: 700, marginBottom: ".35rem" }}>2. Run configuration</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0a0f1a", borderRadius: 7, padding: ".6rem .7rem" }}>
                    <code style={{ color: "#7dd3fc", fontSize: ".72rem", flex: 1 }}>/import mainhotspot.rsc</code>
                    <CopyButton text="/import mainhotspot.rsc" />
                  </div>
                </div>
              </div>
              <a href={scriptUrl} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: ".8rem", color: "#93c5fd", fontSize: ".72rem", fontWeight: 700, textDecoration: "none" }}><Download size={13} /> Download .rsc file</a>
            </div>

            <div style={{ ...panelStyle(), padding: "1rem 1.15rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ".8rem" }}>
                {statusQuery.isFetching ? <Loader2 size={15} style={{ color: "var(--isp-accent)", animation: "spin 1s linear infinite" }} /> : <Shield size={15} style={{ color: status?.vpnConnected ? "#4ade80" : "#64748b" }} />}
                <span style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: ".84rem" }}>Connection verification</span>
                {status?.vpnConnected && <span style={{ marginLeft: "auto", color: "#4ade80", fontSize: ".7rem", fontWeight: 700 }}>VPN tunnel detected</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[
                  ["Installer finished", !!status?.scriptComplete],
                  ["Management VPN", !!status?.vpnConnected],
                  ["Identity verified", !!(status?.connected && status.router.identity)],
                ].map(([label, done]) => (
                  <div key={String(label)} style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,.025)", borderRadius: 7, padding: ".6rem .65rem" }}>
                    {done ? <CheckCircle2 size={14} color="#4ade80" /> : <Loader2 size={14} color="#64748b" style={{ animation: statusQuery.isFetching ? "spin 1s linear infinite" : undefined }} />}
                    <span style={{ color: done ? "#86efac" : "var(--isp-text-muted)", fontSize: ".7rem", fontWeight: 700 }}>{label}</span>
                  </div>
                ))}
              </div>
              {status?.connected && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: ".75rem", color: "var(--isp-text-muted)", fontSize: ".7rem" }}>
                  <span>Identity: <strong style={{ color: "var(--isp-text)" }}>{status.router.identity || "—"}</strong></span>
                  <span>Model: <strong style={{ color: "var(--isp-text)" }}>{status.router.model || "—"}</strong></span>
                  <span>RouterOS: <strong style={{ color: "var(--isp-text)" }}>{status.router.rosVersion || "—"}</strong></span>
                  <span>Heartbeat: <strong style={{ color: status.heartbeat.recent ? "#4ade80" : "#fbbf24" }}>{status.heartbeat.recent ? "recent" : "waiting"}</strong></span>
                </div>
              )}
            </div>
            {!identityReady && !statusQuery.isLoading && (
              <RouterRecovery
                error={status?.error || statusQuery.error?.message}
                routerId={activeRouterId}
                installationMode={installationMode}
              />
            )}
            <button onClick={loadPorts} disabled={!identityReady || portsLoading || completeLoading} style={{ ...primaryButton(!identityReady || portsLoading || completeLoading), alignSelf: "flex-end" }}>
              {portsLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowRight size={15} />}
              {portsLoading ? "Loading isolated service ports…" : "Next — view router and ports"}
            </button>
            {progress && (
              <div style={{ color: "var(--isp-text-muted)", fontSize: ".68rem", display: "flex", gap: 10, flexWrap: "wrap" }}>
                Installer progress: {progress.steps.filter(step => step.phase === "applied").length}/7 stages applied
                {progress.failures > 0 && <span style={{ color: "#f87171" }}>{progress.failures} stage failure(s)</span>}
                  {(() => {
                    const vpnSteps = progress.steps.filter(step => step.name.startsWith("vpn"));
                    const selected = vpnSteps.find(step => step.phase === "applied" && step.name !== "vpn");
                    const label = selected?.name.replace(/^vpn-/, "").toUpperCase();
                    const allFailed = vpnSteps.some(step => step.name === "vpn" && step.phase === "failed");
                    return vpnSteps.length > 0 ? (
                      <span style={{ color: selected ? "#86efac" : allFailed ? "#f87171" : "#fbbf24" }}>
                        VPN fallback: OpenVPN → WireGuard → IPsec · {selected ? `selected ${label}` : allFailed ? "all protocols failed" : "attempting"}
                      </span>
                    ) : null;
                  })()}
              </div>
            )}
          </>
        )}

        {phase === "ports" && activeRouterId && ports && (
          <>
            <div style={{ ...panelStyle(), padding: "1rem 1.15rem", display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 170, height: 96, display: "grid", placeItems: "center", background: "rgba(255,255,255,.025)", borderRadius: 9, overflow: "hidden" }}>
                <img src={asset.src} alt={asset.label} style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: ".65rem", fontWeight: 800 }}>Connected router</div>
                <h2 style={{ color: "var(--isp-text)", fontSize: "1.05rem", margin: ".18rem 0 .35rem" }}>{status?.router.name || routerName}</h2>
                <div style={{ color: "var(--isp-accent)", fontSize: ".77rem", fontWeight: 800 }}>{asset.label}</div>
                <div style={{ color: "var(--isp-text-muted)", fontSize: ".7rem", marginTop: ".25rem" }}>{status?.router.rosVersion || "RouterOS"} · VPN {status?.vpnIp || activeRouter?.vpn_ip}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#4ade80", fontSize: ".72rem", fontWeight: 800 }}><StatusDot active /> Live</div>
            </div>
            <div style={{ background: "rgba(37,99,235,.06)", border: "1px solid rgba(37,99,235,.22)", borderRadius: 9, padding: ".75rem 1rem", color: "#93c5fd", fontSize: ".75rem", lineHeight: 1.55 }}>
              <Wifi size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {installationMode === "coexist"
                ? "The OcholaSuperNet bridge is isolated from the existing billing bridge. Only unassigned ports can be added; ports already owned by the other billing system remain protected."
                : "All live ethernet and WLAN interfaces are shown below. Click a port to apply it to the selected bridge. WAN and management interfaces remain protected."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ color: "var(--isp-text-muted)", fontSize: ".75rem", fontWeight: 700 }}>Bridge</span>
              {installationMode === "coexist" && <span style={{ color: "#5eead4", fontSize: ".7rem", fontWeight: 800 }}>OcholaSuperNet · existing billing bridges protected</span>}
              <select disabled={installationMode === "coexist"} value={selectedBridge} onChange={event => {
                const bridge = event.target.value;
                setSelectedBridge(bridge);
                setSelectedPorts(new Set(ports.bridgePorts.filter(item => item.bridge === bridge).map(item => item.interface)));
                setPortState({});
              }} style={{ background: "var(--isp-input-bg,rgba(255,255,255,.05))", color: "var(--isp-accent)", border: "1px solid var(--isp-accent-border)", borderRadius: 7, padding: ".42rem .7rem", fontFamily: "monospace", fontSize: ".76rem", fontWeight: 800 }}>
                {(installationMode === "coexist"
                  ? ports.bridges.filter(bridge => bridge.name === coexistenceBridgeName(activeRouterId))
                  : ports.bridges
                ).map(bridge => <option key={bridge.name} value={bridge.name}>{bridge.name}</option>)}
              </select>
              {installationMode === "coexist" && <span style={{ color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                {selectedPorts.size} Ochola port{selectedPorts.size === 1 ? "" : "s"} · other billing ports stay where they are
              </span>}
              <button onClick={loadPorts} disabled={portsLoading} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", borderRadius: 7, padding: ".4rem .65rem", fontSize: ".7rem", cursor: "pointer", fontFamily: "inherit" }}><RefreshCw size={12} /> Refresh</button>
            </div>
            <div style={panelStyle()}>
              {liveInterfaces.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: ".8rem" }}>No live assignable interfaces were returned.</div>
              ) : liveInterfaces.map((iface, index) => {
                const kind = ifaceKind(iface);
                const selected = selectedPorts.has(iface.name);
                const currentBridge = bridgeForPort(iface.name, ports.bridgePorts);
                const state = portState[iface.name];
                const protectedPort = kind === "protected";
                 const ownedByOtherBilling = installationMode === "coexist" && !!currentBridge && currentBridge !== selectedBridge;
                return (
                   <div key={iface.name} onClick={() => {
                     if (!ownedByOtherBilling) void togglePort(iface);
                   }} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: ".72rem 1rem",
                    borderBottom: index < liveInterfaces.length - 1 ? "1px solid var(--isp-border-subtle)" : "none",
                    background: selected ? "rgba(20,184,166,.07)" : "transparent",
                     cursor: protectedPort || ownedByOtherBilling ? "not-allowed" : state === "pending" ? "wait" : "pointer",
                     opacity: protectedPort || ownedByOtherBilling ? .55 : 1,
                  }}>
                    <div style={{ width: 21, height: 21, borderRadius: 5, display: "grid", placeItems: "center", background: selected ? "var(--isp-accent)" : "rgba(255,255,255,.06)", border: `2px solid ${selected ? "var(--isp-accent)" : "rgba(255,255,255,.18)"}` }}>
                      {state === "pending" ? <Loader2 size={12} color="white" style={{ animation: "spin 1s linear infinite" }} /> : selected && <Check size={12} color="white" strokeWidth={3} />}
                    </div>
                    {kind === "wlan" ? <Wifi size={15} color={iface.running ? "#60a5fa" : "#475569"} /> : kind === "ether" ? <Plug size={15} color={iface.running ? "var(--isp-accent)" : "#475569"} /> : <Shield size={15} color="#64748b" />}
                    <span style={{ color: "var(--isp-text)", fontFamily: "monospace", fontSize: ".82rem", fontWeight: 800, flex: 1 }}>{iface.name}</span>
                    <span style={{ color: "var(--isp-text-muted)", fontSize: ".65rem", textTransform: "uppercase" }}>{iface.type || kind}</span>
                     {currentBridge && <span style={{ color: ownedByOtherBilling ? "#fbbf24" : "#86efac", background: ownedByOtherBilling ? "rgba(251,191,36,.1)" : "rgba(34,197,94,.1)", border: `1px solid ${ownedByOtherBilling ? "rgba(251,191,36,.25)" : "rgba(34,197,94,.25)"}`, borderRadius: 4, padding: ".17rem .45rem", fontSize: ".62rem", fontWeight: 700 }}>{ownedByOtherBilling ? `Other billing · ${currentBridge}` : currentBridge}</span>}
                     {protectedPort || ownedByOtherBilling ? <span style={{ color: "#fbbf24", fontSize: ".62rem", fontWeight: 700 }}>Protected</span> : state === "applied" ? <CheckCircle2 size={14} color="#4ade80" /> : state === "failed" ? <AlertTriangle size={14} color="#f87171" /> : <StatusDot active={iface.running} />}
                  </div>
                );
              })}
            </div>
            {portError && (
              <RouterRecovery
                error={portError}
                routerId={activeRouterId}
                installationMode={installationMode}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => { setPhase("install"); setPorts(null); }} style={{ background: "transparent", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", borderRadius: 8, padding: ".62rem 1rem", fontFamily: "inherit", fontSize: ".76rem", fontWeight: 700, cursor: "pointer" }}>Back</button>
               <button onClick={finishInstallation} disabled={!status?.ready || completeLoading || Object.values(portState).some(value => value === "pending") || (installationMode === "coexist" && selectedPorts.size === 0)} style={primaryButton(!status?.ready || completeLoading || Object.values(portState).some(value => value === "pending") || (installationMode === "coexist" && selectedPorts.size === 0))}>
                {completeLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />}
                 {completeLoading ? "Verifying installation…" : installationMode === "coexist" && selectedPorts.size === 0 ? "Select a port to continue" : "Next — finish installation"}
              </button>
            </div>
          </>
        )}

        {phase === "success" && (
          <>
            <div style={{ ...panelStyle(), padding: "1.35rem", background: "linear-gradient(135deg,rgba(20,184,166,.12),rgba(34,197,94,.05))", borderColor: "rgba(34,197,94,.3)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <CheckCircle2 size={27} color="#4ade80" style={{ flexShrink: 0 }} />
                <div>
                  <h2 style={{ color: "#86efac", fontSize: "1.08rem", margin: "0 0 .3rem" }}>Installation successful</h2>
                  <p style={{ color: "var(--isp-text-muted)", fontSize: ".78rem", margin: 0, lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--isp-text)" }}>{completeRouter?.name || routerName}</strong> is connected and ready through its management VPN.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: "1rem", paddingTop: ".85rem", borderTop: "1px solid rgba(34,197,94,.18)", color: "var(--isp-text-muted)", fontSize: ".72rem" }}>
                <span>Model <strong style={{ color: "var(--isp-text)" }}>{completeRouter?.model || asset.label}</strong></span>
                <span>RouterOS <strong style={{ color: "var(--isp-text)" }}>{completeRouter?.rosVersion || "—"}</strong></span>
                <span>VPN <code style={{ color: "#5eead4" }}>{status?.vpnIp || "—"}</code></span>
                <span>Identity <strong style={{ color: "var(--isp-text)" }}>{completeRouter?.identity || "verified"}</strong></span>
              </div>
            </div>

            {sourceRouters.length > 0 && !copySkipped && (
              <div style={{ ...panelStyle(), padding: "1.05rem 1.15rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                  <Network size={16} style={{ color: "var(--isp-accent)", marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: "var(--isp-text)", fontSize: ".88rem", margin: 0 }}>Copy configuration from another router?</h3>
                    <p style={{ color: "var(--isp-text-muted)", fontSize: ".74rem", margin: ".3rem 0 .85rem", lineHeight: 1.55 }}>
                      Choose an existing router and explicitly select what should be copied to {routerName}. Existing router configuration is not changed.
                    </p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,.7fr) 1fr", gap: 12 }}>
                  <select value={selectedSource?.id ?? ""} onChange={event => setSourceRouterId(Number(event.target.value))} style={{ alignSelf: "start", background: "var(--isp-input-bg,rgba(255,255,255,.05))", color: "var(--isp-text)", border: "1px solid var(--isp-border)", borderRadius: 7, padding: ".55rem .65rem", fontFamily: "inherit", fontSize: ".75rem" }}>
                    {sourceRouters.map(router => <option key={router.id} value={router.id}>{router.name} · {router.model || "MikroTik"}</option>)}
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                    {CONFIG_CATEGORIES.map(category => {
                      const checked = copyCategories.has(category.id);
                      return (
                        <button key={category.id} onClick={() => setCopyCategories(current => {
                          const next = new Set(current);
                          if (checked) next.delete(category.id); else next.add(category.id);
                          return next;
                        })} style={{ display: "flex", alignItems: "flex-start", gap: 7, textAlign: "left", background: checked ? "rgba(20,184,166,.08)" : "rgba(255,255,255,.025)", border: `1px solid ${checked ? "var(--isp-accent-border)" : "var(--isp-border)"}`, borderRadius: 7, color: "var(--isp-text)", padding: ".55rem .6rem", cursor: "pointer", fontFamily: "inherit" }}>
                          <span style={{ width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center", flexShrink: 0, background: checked ? "var(--isp-accent)" : "transparent", border: `1px solid ${checked ? "var(--isp-accent)" : "rgba(255,255,255,.2)"}` }}>{checked && <Check size={10} color="white" />}</span>
                          <span><strong style={{ display: "block", fontSize: ".7rem" }}>{category.label}</strong><small style={{ color: "var(--isp-text-muted)", fontSize: ".62rem" }}>{category.detail}</small></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: ".9rem", flexWrap: "wrap" }}>
                  <button onClick={() => setCopySkipped(true)} style={{ background: "transparent", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", borderRadius: 7, padding: ".55rem .9rem", fontFamily: "inherit", fontSize: ".72rem", fontWeight: 700, cursor: "pointer" }}>Skip</button>
                  <button onClick={() => void runCopy()} disabled={copyLoading || !selectedSource || copyCategories.size === 0} style={primaryButton(copyLoading || !selectedSource || copyCategories.size === 0)}>
                    {copyLoading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />}
                    {copyLoading ? "Syncing selected configuration…" : "Copy selected configuration"}
                  </button>
                </div>
                {copyResult && (
                  <div style={{ marginTop: ".9rem", background: copyResult.ok ? "rgba(34,197,94,.06)" : "rgba(248,113,113,.06)", border: `1px solid ${copyResult.ok ? "rgba(34,197,94,.25)" : "rgba(248,113,113,.25)"}`, borderRadius: 8, padding: ".7rem .8rem" }}>
                    <div style={{ color: copyResult.ok ? "#4ade80" : "#f87171", fontWeight: 800, fontSize: ".75rem" }}>{copyResult.ok ? "Configuration copy complete" : "Configuration copy needs attention"}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: ".4rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: ".65rem" }}>
                      {Object.entries(copyResult.categories ?? {}).map(([name, result]) => <span key={name} style={{ color: result.ok ? "#86efac" : "#fca5a5" }}>{result.ok ? "✓" : "✗"} {name}: {result.count} item(s)</span>)}
                      {copyResult.error && <span>{copyResult.error}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
            {sourceRouters.length === 0 && <div style={{ color: "var(--isp-text-muted)", fontSize: ".75rem", padding: ".5rem" }}>No other installed routers are available for configuration copying.</div>}
            {copySkipped && <div style={{ color: "#94a3b8", fontSize: ".74rem", display: "flex", alignItems: "center", gap: 6 }}><Check size={13} color="#4ade80" /> Skipped. Existing router configuration was not changed.</div>}
          </>
        )}
      </div>
    </AdminLayout>
  );
}