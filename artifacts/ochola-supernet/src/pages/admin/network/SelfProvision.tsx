import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  ADMIN_ID,
  getAdminApiToken,
  getAdminRole,
  getSelectedTenantId,
  supabase,
} from "@/lib/supabase";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Network,
  Plug,
  RefreshCw,
  Server,
  Shield,
  Users,
  Wifi,
} from "lucide-react";

const BASE_DOMAIN = "isplatty.org";
const HOTSPOT_BRIDGE = "hotspot-bridge";

type Phase = "script" | "ports" | "sync" | "complete";
type SyncCategory = "plans" | "ipPools" | "users" | "pppoe";

interface AdminAccount {
  name: string | null;
  subdomain: string | null;
}

interface RouterRecord {
  id: number;
  name: string;
  host: string | null;
  vpn_ip: string | null;
  bridge_ip: string | null;
  model: string | null;
  ros_version: string | null;
  router_username: string | null;
  status: string;
}

interface RouterInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string;
  comment: string;
}

interface RouterBridge {
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
  interfaces: RouterInterface[];
  bridges: RouterBridge[];
  bridgePorts: BridgePort[];
}

interface SyncCategoryResult {
  ok: boolean;
  count: number;
  logs: string[];
  error?: string;
}

interface SyncResult {
  ok: boolean;
  sourceRouter?: { id: number; name: string };
  targetRouter?: { id: number; name: string };
  categories?: Partial<Record<SyncCategory, SyncCategoryResult>>;
  logs?: string[];
  error?: string;
}

const SYNC_CATEGORIES: Array<{ id: SyncCategory; label: string; detail: string; icon: React.ReactNode }> = [
  { id: "ipPools", label: "IP pools", detail: "Address ranges used by subscribers", icon: <Network size={14} /> },
  { id: "plans", label: "Plans", detail: "Hotspot and PPPoE profiles", icon: <Server size={14} /> },
  { id: "users", label: "Users", detail: "Hotspot and PPPoE subscriber accounts", icon: <Users size={14} /> },
  { id: "pppoe", label: "PPPoE settings", detail: "PPPoE secrets and assignments", icon: <Wifi size={14} /> },
];

const DEFAULT_SYNC_CATEGORIES = new Set<SyncCategory>(["ipPools", "plans", "users", "pppoe"]);

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminApiToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (getAdminRole() === "superadmin") {
    const selectedTenantId = getSelectedTenantId();
    if (selectedTenantId) headers["X-Impersonated-Admin-Id"] = String(selectedTenantId);
  }

  const response = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
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

function isProtectedPort(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "ether1"
    || normalized.includes("ovpn")
    || normalized.includes("wireguard")
    || normalized.includes("ipsec")
    || normalized.includes("corebilling")
    || normalized.includes("ocholasuper");
}

function portKind(iface: RouterInterface): "ether" | "wlan" | "other" {
  const normalized = `${iface.type} ${iface.name}`.toLowerCase();
  if (normalized.includes("wlan") || normalized.includes("wifi")) return "wlan";
  if (normalized.includes("ether") || normalized.includes("sfp") || normalized.includes("combo") || normalized.includes("lte")) return "ether";
  return "other";
}

const panelStyle: React.CSSProperties = {
  background: "var(--isp-section)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
  padding: "1.1rem",
};

const primaryButton = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: disabled ? "rgba(20,184,166,.18)" : "linear-gradient(135deg,#14b8a6,#0d9488)",
  border: "none",
  borderRadius: 9,
  color: "white",
  padding: "0.72rem 1rem",
  fontWeight: 800,
  fontSize: "0.78rem",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.7 : 1,
});

export default function AddRouterScript() {
  const [adminId, setAdminId] = useState(ADMIN_ID);
  const [script, setScript] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [phase, setPhase] = useState<Phase>("script");
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [createdRouter, setCreatedRouter] = useState<RouterRecord | null>(null);
  const [creatingRouter, setCreatingRouter] = useState(false);
  const [ports, setPorts] = useState<PortsPayload | null>(null);
  const [selectedPorts, setSelectedPorts] = useState<Set<string>>(new Set());
  const [portsLoading, setPortsLoading] = useState(false);
  const [assigningPorts, setAssigningPorts] = useState(false);
  const [syncCategories, setSyncCategories] = useState<Set<SyncCategory>>(new Set(DEFAULT_SYNC_CATEGORIES));
  const [sourceRouterId, setSourceRouterId] = useState<number | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    const syncTenant = () => setAdminId(getSelectedTenantId() || ADMIN_ID);
    window.addEventListener("ochola-auth-change", syncTenant);
    syncTenant();
    return () => window.removeEventListener("ochola-auth-change", syncTenant);
  }, []);

  const { data: account, isLoading: loadingAccount, error: accountError } = useQuery({
    queryKey: ["add_router_script_account", adminId],
    enabled: Number.isFinite(adminId) && adminId > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins")
        .select("name, subdomain")
        .eq("id", adminId)
        .single();
      if (error) throw error;
      return data as AdminAccount;
    },
  });

  const { data: routers = [], refetch: refetchRouters } = useQuery({
    queryKey: ["add_router_script_routers", adminId],
    enabled: Number.isFinite(adminId) && adminId > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_routers")
        .select("id, name, host, vpn_ip, bridge_ip, model, ros_version, router_username, status")
        .eq("admin_id", adminId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RouterRecord[];
    },
  });

  useEffect(() => {
    if (!selectedRouterId && routers.length > 0) setSelectedRouterId(routers[0].id);
    if (selectedRouterId && !routers.some(router => router.id === selectedRouterId)) setSelectedRouterId(routers[0]?.id ?? null);
  }, [routers, selectedRouterId]);

  const selectedRouter = createdRouter?.id === selectedRouterId
    ? createdRouter
    : routers.find(router => router.id === selectedRouterId) ?? null;
  const sourceRouters = routers.filter(router => router.id !== selectedRouterId);
  const sourceRouter = sourceRouters.find(router => router.id === sourceRouterId) ?? sourceRouters[0] ?? null;
  const accountSubdomain = account?.subdomain?.trim().toLowerCase() ?? "";
  const companyHost = accountSubdomain ? `${accountSubdomain}.${BASE_DOMAIN}` : "";
  const buildBootstrapCommand = (routerId?: number, installerGrant?: string) => {
    if (!companyHost) return "";
    const routerQuery = routerId && installerGrant
      ? `?rid=${routerId}&adminId=${adminId}&grant=${encodeURIComponent(installerGrant)}`
      : "";
    return `/tool fetch url="https://${companyHost}/scripts/mainhotspot.rsc${routerQuery}" dst-path=mainhotspot.rsc mode=https; /import mainhotspot.rsc`;
  };
  const bootstrapCommand = buildBootstrapCommand();
  const canGenerate = !!bootstrapCommand;

  const hotspotBridgeExists = !!ports?.bridges.some(bridge => bridge.name === HOTSPOT_BRIDGE);
  const currentBridgePorts = useMemo(
    () => new Set((ports?.bridgePorts ?? []).filter(item => item.bridge === HOTSPOT_BRIDGE).map(item => item.interface)),
    [ports],
  );
  const portsDirty = selectedPorts.size !== currentBridgePorts.size
    || [...selectedPorts].some(port => !currentBridgePorts.has(port));
  const liveInterfaces = (ports?.interfaces ?? []).filter(iface => !["bridge", "loopback"].includes(iface.type.toLowerCase()));

  const generateConfiguration = async () => {
    if (!canGenerate || !adminId) return;
    setCreatingRouter(true);
    setPageError("");
    setSelectedRouterId(null);
    setCreatedRouter(null);
    try {
      const result = await jsonRequest<{ ok: boolean; router?: RouterRecord; error?: string }>("/api/admin/router/ensure", {
        method: "POST",
        body: JSON.stringify({ adminId }),
      });
      if (!result.ok || !result.router?.id || !result.router.name) {
        throw new Error(result.error || "The router profile could not be created.");
      }
      const prepared = await jsonRequest<{ ok: boolean; grantToken?: string; error?: string }>("/api/admin/router/self-install/grant", {
        method: "POST",
        body: JSON.stringify({ routerId: result.router.id, adminId }),
      });
      if (!prepared.ok || !prepared.grantToken) {
        throw new Error(prepared.error || "Installer authorization could not be prepared.");
      }
      setCreatedRouter(result.router);
      setSelectedRouterId(result.router.id);
      setScript(buildBootstrapCommand(result.router.id, prepared.grantToken));
      setCopyState("idle");
      await refetchRouters();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not create the router profile.");
    } finally {
      setCreatingRouter(false);
    }
  };

  const loadPorts = async () => {
    if (!selectedRouter || !adminId) {
      setPageError("Select the router profile that ran the script before loading its ports.");
      return;
    }
    setPortsLoading(true);
    setPageError("");
    try {
      const result = await jsonRequest<PortsPayload>("/api/admin/router/self-install/ports", {
        method: "POST",
        body: JSON.stringify({ adminId, routerId: selectedRouter.id }),
      });
      const bridgePorts = new Set(result.bridgePorts.filter(item => item.bridge === HOTSPOT_BRIDGE).map(item => item.interface));
      setPorts(result);
      setSelectedPorts(bridgePorts);
      setPhase("ports");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load the MikroTik ports.");
    } finally {
      setPortsLoading(false);
    }
  };

  const assignHotspotPorts = async () => {
    if (!selectedRouter || !ports || !hotspotBridgeExists) {
      setPageError(`The ${HOTSPOT_BRIDGE} bridge was not found on this router. Run the Main ISP script first, then reload the ports.`);
      return;
    }
    const desiredPorts = [...selectedPorts].filter(port => !isProtectedPort(port));
    const currentPorts = [...currentBridgePorts];
    const addPorts = desiredPorts.filter(port => !currentBridgePorts.has(port));
    const removePorts = currentPorts.filter(port => !selectedPorts.has(port));
    if (desiredPorts.length === 0) {
      setPageError(`Select at least one assignable port for ${HOTSPOT_BRIDGE}.`);
      return;
    }
    setAssigningPorts(true);
    setPageError("");
    try {
      await jsonRequest<{ ok: boolean }>("/api/admin/router/self-install/bridge-assign", {
        method: "POST",
        body: JSON.stringify({
          adminId,
          routerId: selectedRouter.id,
          bridge: HOTSPOT_BRIDGE,
          addPorts,
          removePorts,
          desiredPorts,
        }),
      });
      await loadPorts();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "The router rejected the hotspot bridge assignment.");
    } finally {
      setAssigningPorts(false);
    }
  };

  const goToSync = () => {
    if (!hotspotBridgeExists) {
      setPageError(`The ${HOTSPOT_BRIDGE} bridge must be available before continuing.`);
      return;
    }
    if (portsDirty) {
      setPageError("Apply the selected ports to hotspot-bridge before continuing.");
      return;
    }
    if (selectedPorts.size === 0) {
      setPageError(`Select at least one port for ${HOTSPOT_BRIDGE} before continuing.`);
      return;
    }
    setPageError("");
    setPhase("sync");
  };

  const runSync = async () => {
    if (!selectedRouter || !sourceRouter || syncCategories.size === 0) {
      setPageError("Select a source router and at least one sync category.");
      return;
    }
    setSyncLoading(true);
    setSyncResult(null);
    setPageError("");
    try {
      const result = await jsonRequest<SyncResult>("/api/admin/router/sync-copy", {
        method: "POST",
        body: JSON.stringify({
          adminId,
          sourceRouterId: sourceRouter.id,
          targetRouterId: selectedRouter.id,
          categories: [...syncCategories],
        }),
      });
      setSyncResult(result);
      if (result.ok) setPhase("complete");
      else setPageError(result.error || "Some configuration categories could not be synced.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not sync router configuration.");
    } finally {
      setSyncLoading(false);
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

  const resetFlow = () => {
    setPhase("script");
    setScript("");
    setCreatedRouter(null);
    setSelectedRouterId(null);
    setPorts(null);
    setSelectedPorts(new Set());
    setSyncResult(null);
    setPageError("");
  };

  return (
    <AdminLayout hiddenNavHrefs={["/admin/network/self-install"]}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1120 }}>
        <div>
          <h1 style={{ color: "var(--isp-text)", fontSize: "1.35rem", margin: 0, fontWeight: 800 }}>Add Router (Script)</h1>
          <p style={{ color: "var(--isp-text-muted)", margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
            Run the Main ISP script, assign the hotspot bridge ports, then sync the account configuration.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", background: "rgba(20,184,166,.05)", border: "1px solid rgba(20,184,166,.18)", borderRadius: 10, padding: ".65rem .8rem" }}>
          {["Script", "Router ports", "Account sync", "Complete"].map((label, index) => {
            const activeIndex = phase === "script" ? 0 : phase === "ports" ? 1 : phase === "sync" ? 2 : 3;
            const done = index < activeIndex;
            const active = index === activeIndex;
            return (
              <React.Fragment key={label}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
                  <span style={{ width: 21, height: 21, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: done || active ? "var(--isp-accent)" : "rgba(255,255,255,.08)", color: done || active ? "white" : "var(--isp-text-muted)", fontSize: ".63rem", fontWeight: 800 }}>
                    {done ? <Check size={11} /> : index + 1}
                  </span>
                  <span style={{ color: done || active ? "var(--isp-accent)" : "var(--isp-text-muted)", fontSize: ".7rem", fontWeight: active ? 800 : 500 }}>{label}</span>
                </div>
                {index < 3 && <ChevronRight size={12} style={{ color: "rgba(255,255,255,.18)", margin: "0 .35rem", flexShrink: 0 }} />}
              </React.Fragment>
            );
          })}
        </div>

        {pageError && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "#fca5a5", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 9, padding: ".75rem 1rem", fontSize: ".75rem", lineHeight: 1.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {pageError}
          </div>
        )}

        {phase === "script" && (
          <section style={panelStyle}>
            <div style={{ marginBottom: "0.9rem", padding: "0.75rem 0.8rem", borderRadius: 8, background: "rgba(20,184,166,.07)", border: "1px solid rgba(20,184,166,.2)" }}>
              <div style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>Company script host</div>
              <div style={{ marginTop: "0.25rem", color: "var(--isp-accent)", fontFamily: "monospace", fontSize: "0.82rem", wordBreak: "break-all" }}>
                {loadingAccount ? "Loading company account…" : companyHost || "No company subdomain configured"}
              </div>
            </div>

            {accountError && (
              <div style={{ marginBottom: "0.85rem", display: "flex", alignItems: "flex-start", gap: 7, color: "#fca5a5", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 8, padding: "0.65rem 0.7rem", fontSize: "0.7rem" }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Could not load the signed-in company subdomain.
              </div>
            )}

            <div style={{ marginBottom: ".9rem", display: "flex", alignItems: "flex-start", gap: 8, color: "var(--isp-text-muted)", fontSize: ".7rem", lineHeight: 1.5 }}>
              <Server size={15} color="var(--isp-accent)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Generating the command automatically creates or resumes the next company router profile and reserves its management address. The returned router name will be shown below.</span>
            </div>

            <button onClick={() => void generateConfiguration()} disabled={loadingAccount || creatingRouter || !canGenerate} style={primaryButton(loadingAccount || creatingRouter || !canGenerate)}>
              {loadingAccount || creatingRouter ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileCode2 size={16} />}
              {loadingAccount ? "Loading company…" : creatingRouter ? "Creating router profile…" : "Create profile & generate command"}
            </button>

            {script && (
              <div style={{ marginTop: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: ".65rem", flexWrap: "wrap" }}>
                  <button onClick={downloadScript} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--isp-accent)", border: "none", borderRadius: 7, color: "white", padding: ".5rem .75rem", fontSize: ".72rem", fontWeight: 800, cursor: "pointer" }}>
                    <Download size={13} /> Download mainhotspot.rsc
                  </button>
                  <button onClick={() => void copyScript()} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 7, color: "var(--isp-text)", padding: ".5rem .75rem", fontSize: ".72rem", fontWeight: 750, cursor: "pointer" }}>
                    {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
                    {copyState === "copied" ? "Copied" : "Copy command"}
                  </button>
                </div>
                <pre style={{ margin: 0, background: "#0a0f1a", borderRadius: 8, padding: ".85rem", color: "#cbd5e1", fontSize: ".7rem", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{script}</pre>
                {selectedRouter && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: ".75rem", padding: ".65rem .75rem", borderRadius: 8, background: "rgba(20,184,166,.07)", border: "1px solid rgba(20,184,166,.2)", color: "var(--isp-text-muted)", fontSize: ".7rem" }}>
                    <CheckCircle2 size={15} color="#4ade80" />
                    <span>Router profile ready: <strong style={{ color: "var(--isp-text)" }}>{selectedRouter.name}</strong>{selectedRouter.vpn_ip ? ` · management ${selectedRouter.vpn_ip}` : ""}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: ".85rem" }}>
                  <button onClick={() => void loadPorts()} disabled={!selectedRouter || portsLoading || creatingRouter} style={primaryButton(!selectedRouter || portsLoading || creatingRouter)}>
                    {portsLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ChevronRight size={15} />}
                    {portsLoading ? "Loading MikroTik ports…" : "Next — load router ports"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {phase === "ports" && selectedRouter && ports && (
          <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, display: "grid", placeItems: "center", background: "rgba(20,184,166,.1)", borderRadius: 10 }}>
                <Server size={19} color="var(--isp-accent)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--isp-text-muted)", fontSize: ".65rem", textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 800 }}>Connected router</div>
                <div style={{ color: "var(--isp-text)", fontSize: "1rem", fontWeight: 800, marginTop: ".15rem" }}>{selectedRouter.name}</div>
                <div style={{ color: "var(--isp-text-muted)", fontSize: ".7rem", marginTop: ".2rem" }}>
                  {selectedRouter.model || "MikroTik"} · {selectedRouter.ros_version || "RouterOS"} · {ports.connectedVia || selectedRouter.vpn_ip || selectedRouter.host || "management connection"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#4ade80", fontSize: ".72rem", fontWeight: 800 }}><CheckCircle2 size={15} /> Ports loaded</div>
            </div>

            <div style={{ ...panelStyle, padding: "1rem 1.15rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: ".8rem" }}>
                <Plug size={16} color="var(--isp-accent)" style={{ marginTop: 2 }} />
                <div>
                  <h2 style={{ color: "var(--isp-text)", fontSize: ".9rem", margin: 0 }}>Assign ports to hotspot-bridge</h2>
                  <p style={{ color: "var(--isp-text-muted)", fontSize: ".72rem", margin: ".3rem 0 0", lineHeight: 1.5 }}>
                    Select the LAN ports that should carry hotspot traffic. WAN and management interfaces remain protected.
                  </p>
                </div>
              </div>

              {!hotspotBridgeExists && (
                <div style={{ marginBottom: ".8rem", display: "flex", gap: 7, color: "#fcd34d", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.25)", borderRadius: 8, padding: ".65rem .7rem", fontSize: ".7rem", lineHeight: 1.5 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} /> The router does not report a <strong>hotspot-bridge</strong>. Run the Main ISP script on this router before assigning ports.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--isp-border)", borderRadius: 8, overflow: "hidden" }}>
                {liveInterfaces.length === 0 ? (
                  <div style={{ padding: "1.4rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: ".78rem" }}>No assignable interfaces were returned.</div>
                ) : liveInterfaces.map((iface, index) => {
                  const protectedPort = isProtectedPort(iface.name);
                  const selected = selectedPorts.has(iface.name);
                  const currentBridge = ports.bridgePorts.find(item => item.interface === iface.name)?.bridge;
                  const kind = portKind(iface);
                  return (
                    <label key={iface.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: ".7rem .85rem", borderBottom: index < liveInterfaces.length - 1 ? "1px solid var(--isp-border)" : "none", background: selected ? "rgba(20,184,166,.07)" : "transparent", opacity: protectedPort ? .55 : 1, cursor: protectedPort ? "not-allowed" : "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={protectedPort || !hotspotBridgeExists || assigningPorts}
                        onChange={() => setSelectedPorts(current => {
                          const next = new Set(current);
                          if (next.has(iface.name)) next.delete(iface.name); else next.add(iface.name);
                          return next;
                        })}
                        style={{ width: 16, height: 16, accentColor: "var(--isp-accent)" }}
                      />
                      {kind === "wlan" ? <Wifi size={15} color={iface.running ? "#60a5fa" : "#64748b"} /> : kind === "ether" ? <Plug size={15} color={iface.running ? "var(--isp-accent)" : "#64748b"} /> : <Shield size={15} color="#64748b" />}
                      <span style={{ color: "var(--isp-text)", fontFamily: "monospace", fontSize: ".8rem", fontWeight: 800, flex: 1 }}>{iface.name}</span>
                      <span style={{ color: "var(--isp-text-muted)", fontSize: ".63rem", textTransform: "uppercase" }}>{iface.type || kind}</span>
                      {currentBridge && <span style={{ color: currentBridge === HOTSPOT_BRIDGE ? "#86efac" : "#fbbf24", background: currentBridge === HOTSPOT_BRIDGE ? "rgba(34,197,94,.1)" : "rgba(251,191,36,.1)", border: `1px solid ${currentBridge === HOTSPOT_BRIDGE ? "rgba(34,197,94,.25)" : "rgba(251,191,36,.25)"}`, borderRadius: 4, padding: ".15rem .4rem", fontSize: ".61rem", fontWeight: 700 }}>{currentBridge}</span>}
                      {protectedPort ? <span style={{ color: "#fbbf24", fontSize: ".61rem", fontWeight: 700 }}>Protected</span> : iface.running ? <span style={{ color: "#4ade80", fontSize: ".61rem", fontWeight: 700 }}>Running</span> : <span style={{ color: "#64748b", fontSize: ".61rem" }}>Down</span>}
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: ".85rem", flexWrap: "wrap" }}>
                <span style={{ color: "var(--isp-text-muted)", fontSize: ".7rem" }}>{selectedPorts.size} port{selectedPorts.size === 1 ? "" : "s"} selected for {HOTSPOT_BRIDGE}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => void loadPorts()} disabled={portsLoading || assigningPorts} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", borderRadius: 7, padding: ".55rem .75rem", fontSize: ".7rem", cursor: "pointer" }}><RefreshCw size={13} /> Refresh</button>
                  <button onClick={() => void assignHotspotPorts()} disabled={!hotspotBridgeExists || !portsDirty || assigningPorts} style={primaryButton(!hotspotBridgeExists || !portsDirty || assigningPorts)}>
                    {assigningPorts ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plug size={14} />}
                    {assigningPorts ? "Assigning ports…" : "Apply hotspot-bridge"}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={goToSync} disabled={portsDirty || assigningPorts || !hotspotBridgeExists} style={primaryButton(portsDirty || assigningPorts || !hotspotBridgeExists)}>
                <ChevronRight size={15} /> Next — sync IP pools, users and plans
              </button>
            </div>
          </section>
        )}

        {phase === "sync" && selectedRouter && (
          <section style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Network size={18} color="var(--isp-accent)" style={{ marginTop: 2 }} />
              <div>
                <h2 style={{ color: "var(--isp-text)", fontSize: ".95rem", margin: 0 }}>Sync account configuration</h2>
                <p style={{ color: "var(--isp-text-muted)", fontSize: ".73rem", margin: ".3rem 0 0", lineHeight: 1.5 }}>
                  Copy selected ISP configuration from an existing router to <strong style={{ color: "var(--isp-text)" }}>{selectedRouter.name}</strong>. The source router is not changed.
                </p>
              </div>
            </div>

            {sourceRouters.length === 0 ? (
              <div style={{ display: "flex", gap: 7, color: "#fcd34d", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.25)", borderRadius: 8, padding: ".7rem .75rem", fontSize: ".72rem", lineHeight: 1.5 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> No other installed router is available as a sync source. Add or install another router first.
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: "block", color: "var(--isp-text-muted)", fontSize: ".67rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: ".35rem" }}>Sync from router</label>
                  <select value={sourceRouter?.id ?? ""} onChange={event => setSourceRouterId(Number(event.target.value) || null)} style={{ width: "100%", boxSizing: "border-box", background: "var(--isp-input-bg,rgba(255,255,255,.05))", color: "var(--isp-text)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: ".62rem .75rem", fontFamily: "inherit", fontSize: ".75rem" }}>
                    {sourceRouters.map(router => <option key={router.id} value={router.id}>{router.name} · {router.model || "MikroTik"} · {router.status}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 }}>
                  {SYNC_CATEGORIES.map(category => {
                    const checked = syncCategories.has(category.id);
                    return (
                      <button key={category.id} onClick={() => setSyncCategories(current => {
                        const next = new Set(current);
                        if (next.has(category.id)) next.delete(category.id); else next.add(category.id);
                        return next;
                      })} style={{ display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left", background: checked ? "rgba(20,184,166,.08)" : "rgba(255,255,255,.025)", border: `1px solid ${checked ? "var(--isp-accent-border)" : "var(--isp-border)"}`, borderRadius: 8, color: "var(--isp-text)", padding: ".65rem .7rem", cursor: "pointer", fontFamily: "inherit" }}>
                        <span style={{ width: 17, height: 17, borderRadius: 4, display: "grid", placeItems: "center", flexShrink: 0, background: checked ? "var(--isp-accent)" : "transparent", border: `1px solid ${checked ? "var(--isp-accent)" : "rgba(255,255,255,.2)"}` }}>{checked && <Check size={11} color="white" />}</span>
                        <span>{category.icon}<strong style={{ display: "block", fontSize: ".71rem", marginTop: ".25rem" }}>{category.label}</strong><small style={{ color: "var(--isp-text-muted)", fontSize: ".62rem", lineHeight: 1.35 }}>{category.detail}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button onClick={() => setPhase("ports")} style={{ background: "transparent", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", borderRadius: 8, padding: ".62rem .9rem", fontFamily: "inherit", fontSize: ".74rem", fontWeight: 700, cursor: "pointer" }}>Back to ports</button>
                  <button onClick={() => void runSync()} disabled={syncLoading || !sourceRouter || syncCategories.size === 0} style={primaryButton(syncLoading || !sourceRouter || syncCategories.size === 0)}>
                    {syncLoading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />}
                    {syncLoading ? "Syncing router data…" : "Next — sync selected data"}
                  </button>
                </div>
              </>
            )}
            {sourceRouters.length === 0 && <button onClick={() => void refetchRouters()} style={{ ...primaryButton(false), alignSelf: "flex-end" }}><RefreshCw size={14} /> Refresh router profiles</button>}
          </section>
        )}

        {phase === "complete" && selectedRouter && (
          <section style={{ ...panelStyle, background: "linear-gradient(135deg,rgba(20,184,166,.12),rgba(34,197,94,.05))", borderColor: "rgba(34,197,94,.3)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <CheckCircle2 size={26} color="#4ade80" style={{ flexShrink: 0 }} />
              <div>
                <h2 style={{ color: "#86efac", fontSize: "1rem", margin: 0 }}>Router setup and sync complete</h2>
                <p style={{ color: "var(--isp-text-muted)", fontSize: ".76rem", margin: ".35rem 0 0", lineHeight: 1.55 }}>
                  <strong style={{ color: "var(--isp-text)" }}>{selectedRouter.name}</strong> has its hotspot ports assigned and the selected ISP configuration was synced.
                </p>
              </div>
            </div>
            {syncResult?.categories && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 7, marginTop: "1rem" }}>
                {Object.entries(syncResult.categories).map(([name, result]) => (
                  <div key={name} style={{ background: "rgba(255,255,255,.035)", borderRadius: 7, padding: ".6rem .7rem", color: result?.ok ? "#86efac" : "#fca5a5", fontSize: ".69rem", fontWeight: 700 }}>
                    {result?.ok ? "✓" : "✗"} {name}: {result?.count ?? 0} item{result?.count === 1 ? "" : "s"}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button onClick={resetFlow} style={{ ...primaryButton(false), background: "rgba(255,255,255,.08)", border: "1px solid var(--isp-border)" }}><RefreshCw size={14} /> Add another router</button>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}