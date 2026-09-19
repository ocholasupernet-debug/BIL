import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  Network,
  RefreshCw,
  Router as RouterIcon,
  Server,
  ShieldCheck,
  TerminalSquare,
  Wifi,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";

type InstallMode = "greenfield" | "brownfield" | "zero-touch";
type BackendInstallMode = "direct" | "coexist" | "takeover";

type RouterProfile = {
  id: number;
  name: string;
  status: string;
  host?: string | null;
  vpn_ip?: string | null;
  bridge_ip?: string | null;
  bridge_interface?: string | null;
  model?: string | null;
  ros_version?: string | null;
};

type VpnInfo = {
  routerId: number;
  routerName: string;
  configuredHost?: string | null;
  bridgeIp?: string | null;
  vpnIp?: string | null;
  managementTunnel?: {
    connectTo: string;
    primaryPort: number;
    sharedPort: number;
    backupPort: number;
    routerTunnelIp: string;
    routerApiPort: number;
  };
};

type InstallStatus = {
  ok: boolean;
  ready: boolean;
  scriptComplete: boolean;
  connected: boolean;
  vpnConnected: boolean;
  vpnIp?: string | null;
  via?: string | null;
  heartbeat?: { recent: boolean; lastSeen?: string | null };
  router?: {
    id: number;
    name: string;
    status: string;
    model: string;
    rosVersion: string;
    identity: string;
    uptime: string;
  };
  error?: string;
};

type FinishResult = {
  ok: boolean;
  router?: {
    id: number;
    name: string;
    model: string;
    rosVersion: string;
    vpnIp: string;
    identity: string;
    uptime: string;
  };
  error?: string;
};

const MODE_OPTIONS: Array<{
  value: InstallMode;
  backend: BackendInstallMode;
  title: string;
  description: string;
  tone: string;
}> = [
  {
    value: "greenfield",
    backend: "direct",
    title: "Greenfield",
    description: "A clean router dedicated to this ISP.",
    tone: "#38bdf8",
  },
  {
    value: "brownfield",
    backend: "coexist",
    title: "Brownfield",
    description: "Keep existing services and connect the management plane.",
    tone: "#a78bfa",
  },
  {
    value: "zero-touch",
    backend: "takeover",
    title: "Zero-touch",
    description: "Use only when an approved takeover/reset process is in place.",
    tone: "#fb923c",
  },
];

const panel: React.CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--isp-section)",
  color: "var(--isp-text)",
  border: "1px solid var(--isp-border)",
  borderRadius: 8,
  padding: "0.65rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "0.82rem",
  outline: "none",
};

function formatTime(value?: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function backendMode(mode: InstallMode): BackendInstallMode {
  return MODE_OPTIONS.find(option => option.value === mode)?.backend ?? "direct";
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getAdminApiToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `Request failed (${response.status})`);
  }
  return payload as T;
}

function SectionTitle({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 9,
        display: "grid",
        placeItems: "center",
        background: "var(--isp-accent-glow)",
        color: "var(--isp-accent)",
        fontWeight: 800,
        fontSize: "0.78rem",
        flexShrink: 0,
      }}>
        {number}
      </div>
      <div>
        <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.98rem", fontWeight: 750 }}>{title}</h2>
        <p style={{ margin: "0.22rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.76rem", lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
    </div>
  );
}

function Property({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value || value === "—") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{
      padding: "0.72rem 0.8rem",
      borderRadius: 9,
      background: "var(--isp-section)",
      border: "1px solid var(--isp-border-subtle)",
      minWidth: 0,
    }}>
      <div style={{
        color: "var(--isp-text-muted)",
        fontSize: "0.64rem",
        fontWeight: 750,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: "0.28rem",
      }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
        <code style={{
          color: "var(--isp-text)",
          fontSize: "0.8rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }} title={value}>
          {value || "—"}
        </code>
        {copyable && value && value !== "—" && (
          <button
            type="button"
            onClick={copy}
            title="Copy value"
            style={{
              border: 0,
              background: "transparent",
              color: copied ? "#34d399" : "var(--isp-text-muted)",
              cursor: "pointer",
              padding: 2,
              display: "grid",
              placeItems: "center",
            }}
          >
            {copied ? <Check size={13} /> : <Clipboard size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

function CheckLine({
  label,
  ok,
  pending = false,
}: {
  label: string;
  ok: boolean;
  pending?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", color: ok ? "#34d399" : pending ? "#fbbf24" : "var(--isp-text-muted)", fontSize: "0.78rem" }}>
      {ok ? <CheckCircle2 size={15} /> : pending ? <Loader2 size={15} style={{ animation: "self-install-spin 1.1s linear infinite" }} /> : <XCircle size={15} />}
      <span>{label}</span>
    </div>
  );
}

export default function SelfInstall() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<InstallMode>("greenfield");
  const [routerName, setRouterName] = useState("");
  const [bridgeInterface, setBridgeInterface] = useState("bridge");
  const [bridgeName, setBridgeName] = useState("hotspot-bridge");
  const [ports, setPorts] = useState("");
  const [router, setRouter] = useState<RouterProfile | null>(null);
  const [vpnInfo, setVpnInfo] = useState<VpnInfo | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [finished, setFinished] = useState<FinishResult["router"] | null>(null);
  const [busy, setBusy] = useState<"creating" | "loading" | "finishing" | "script" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reconfigureId, setReconfigureId] = useState<number | null>(null);
  const [routerOsMajor, setRouterOsMajor] = useState<6 | 7>(6);
  const [scriptText, setScriptText] = useState("");
  const [scriptCopied, setScriptCopied] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const rawId = Number(query.get("reconfigure"));
    if (Number.isInteger(rawId) && rawId > 0) setReconfigureId(rawId);
  }, []);

  const loadVpnInfo = useCallback(async (routerId: number) => {
    setBusy("loading");
    try {
      const info = await readJson<VpnInfo>(`/api/router/${routerId}/vpn-info?adminId=${ADMIN_ID}`);
      setVpnInfo(info);
    } finally {
      setBusy("");
    }
  }, []);

  const loadRouter = useCallback(async (routerId: number) => {
    setBusy("loading");
    try {
      const routers = await readJson<RouterProfile[]>(`/api/routers?adminId=${ADMIN_ID}&includeSetup=true`);
      const found = routers.find(item => item.id === routerId);
      if (!found) throw new Error("That router could not be found for this ISP account.");
      setRouter(found);
      setRouterName(found.name);
      setBridgeInterface(found.bridge_interface || "bridge");
      setBridgeName(found.bridge_interface || "hotspot-bridge");
      if (found.ros_version?.startsWith("7.")) setRouterOsMajor(7);
      await loadVpnInfo(found.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the router profile.");
      setBusy("");
    }
  }, [loadVpnInfo]);

  useEffect(() => {
    if (reconfigureId) void loadRouter(reconfigureId);
  }, [loadRouter, reconfigureId]);

  const refreshStatus = useCallback(async () => {
    if (!router) return;
    try {
      const result = await readJson<InstallStatus>(
        `/api/admin/router/install-status/${router.id}?adminId=${ADMIN_ID}&mode=${backendMode(mode)}`,
      );
      setInstallStatus(result);
      if (result.router?.rosVersion?.startsWith("7.")) setRouterOsMajor(7);
      if (result.router?.rosVersion && !result.router.rosVersion.startsWith("7.")) setRouterOsMajor(6);
      if (result.vpnIp && vpnInfo && vpnInfo.managementTunnel?.routerTunnelIp !== result.vpnIp) {
        setVpnInfo(current => current ? {
          ...current,
          vpnIp: result.vpnIp,
          managementTunnel: current.managementTunnel
            ? { ...current.managementTunnel, routerTunnelIp: result.vpnIp! }
            : current.managementTunnel,
        } : current);
      }
    } catch (cause) {
      setInstallStatus(current => current ?? {
        ok: false,
        ready: false,
        scriptComplete: false,
        connected: false,
        vpnConnected: false,
        error: cause instanceof Error ? cause.message : "Readiness check failed.",
      });
    }
  }, [mode, router, vpnInfo]);

  useEffect(() => {
    if (!router || finished) return;
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [finished, refreshStatus, router]);

  const createProfile = async () => {
    setBusy("creating");
    setError("");
    setNotice("");
    setFinished(null);
    try {
      const result = await readJson<{ ok: boolean; router: RouterProfile }>(
        "/api/admin/router/ensure",
        {
          method: "POST",
          body: JSON.stringify({
            adminId: ADMIN_ID,
            routerName: routerName.trim() || undefined,
            bridgeInterface: bridgeInterface.trim() || "bridge",
          }),
        },
      );
      setRouter(result.router);
      setRouterName(result.router.name);
      setBridgeInterface(result.router.bridge_interface || bridgeInterface || "bridge");
      await loadVpnInfo(result.router.id);
      setNotice(result.router.status === "setup"
        ? "The router profile is ready. Use the displayed VPS properties to connect the router, then verify it here."
        : "Existing router profile resumed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the router profile.");
    } finally {
      setBusy("");
    }
  };

  const finishInstall = async () => {
    if (!router) return;
    const desiredPorts = ports.split(",").map(value => value.trim()).filter(Boolean);
    const verifiedBridge = bridgeName.trim();
    if (mode === "brownfield" && verifiedBridge !== "co-hotspot-bridge") {
      setError('Brownfield requires the isolated bridge name "co-hotspot-bridge".');
      return;
    }
    if (mode === "brownfield" && desiredPorts.length === 0) {
      setError("Brownfield requires at least one physical port assigned to the isolated Ochola bridge.");
      return;
    }
    setBusy("finishing");
    setError("");
    try {
      const result = await readJson<FinishResult>(
        "/api/admin/router/install-complete",
        {
          method: "POST",
          body: JSON.stringify({
            adminId: ADMIN_ID,
            routerId: router.id,
            installationMode: backendMode(mode),
            bridge: verifiedBridge || undefined,
            ports: desiredPorts,
          }),
        },
      );
      if (!result.ok || !result.router) throw new Error(result.error || "The router could not be promoted.");
      setFinished(result.router);
      setInstallStatus(current => current ? { ...current, ready: true, connected: true } : current);
      setNotice("The router is verified and now appears in the active Routers list.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Final router verification failed.");
    } finally {
      setBusy("");
    }
  };

  const fetchSelfInstallScript = async (): Promise<string> => {
    if (!router) throw new Error("Create the router profile before generating a Self Install script.");
    const params = new URLSearchParams({
      adminId: String(ADMIN_ID),
      mode: backendMode(mode),
      rosMajor: String(routerOsMajor),
      bridgeName: bridgeName.trim() || (mode === "brownfield" ? "co-hotspot-bridge" : "hotspot-bridge"),
      ports,
    });
    const token = getAdminApiToken();
    const response = await fetch(`/api/router/${router.id}/self-install-script?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.detail || `Script generation failed (${response.status})`);
    }
    const text = await response.text();
    if (!text.trim()) throw new Error("The generated Self Install script was empty.");
    setScriptText(text);
    setScriptCopied(false);
    return text;
  };

  const downloadSelfInstallScript = async () => {
    if (!router) return;
    setBusy("script");
    setError("");
    setNotice("");
    try {
      const text = await fetchSelfInstallScript();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `router-self-install${router.id}.rsc`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("The minimal Self Install script is ready. Copy it into the MikroTik terminal or use the downloaded .rsc file.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the Self Install script.");
    } finally {
      setBusy("");
    }
  };

  const copySelfInstallScript = async () => {
    if (!router) return;
    setBusy("script");
    setError("");
    setNotice("");
    try {
      const text = scriptText || await fetchSelfInstallScript();
      await navigator.clipboard.writeText(text);
      setScriptCopied(true);
      setNotice("The complete RouterOS script was copied. Paste it directly into the MikroTik terminal and run it once.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy the Self Install script.");
    } finally {
      setBusy("");
    }
  };

  const tunnel = vpnInfo?.managementTunnel;
  const live = installStatus;
  const connected = Boolean(live?.connected || finished);
  const assignedTunnelIp = live?.vpnIp || tunnel?.routerTunnelIp || vpnInfo?.vpnIp || router?.vpn_ip || "Pending allocation";
  const selectedMode = MODE_OPTIONS.find(option => option.value === mode)!;
  const pageStep = finished ? 4 : router ? (connected ? 3 : 2) : 1;
  const endpointReady = Boolean(tunnel?.connectTo && !tunnel.connectTo.startsWith("SET_"));

  const checklist = useMemo(() => [
    { label: "Tenant-owned router profile", ok: Boolean(router) },
    { label: "VPS management endpoint available", ok: endpointReady },
    { label: "Router management VPN connected", ok: Boolean(live?.vpnConnected || finished), pending: Boolean(router && !live?.vpnConnected && !finished) },
    { label: "RouterOS API identity and version verified", ok: connected },
  ], [connected, endpointReady, finished, live?.vpnConnected, router]);

  return (
    <AdminLayout>
      <style>{`@keyframes self-install-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: 1060, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <RouterIcon size={21} style={{ color: "var(--isp-accent)" }} />
            <h1 style={{ margin: 0, color: "var(--isp-text)", fontSize: "1.25rem", fontWeight: 800 }}>Self Install</h1>
          </div>
          <p style={{ margin: "0.35rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem", maxWidth: 720, lineHeight: 1.55 }}>
             Register a MikroTik router, generate the limited management script, and verify the live RouterOS API connection.
             The script only provisions the management VPN, hotspot bridge, scoped firewall/NAT rules, API account, and completion callback.
          </p>
        </div>

        <NetworkTabs active="self-install" />

        <div style={{ ...panel, padding: "0.8rem 1rem", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
          {[
            ["1", "Profile", pageStep >= 1],
            ["2", "Endpoint", pageStep >= 2],
            ["3", "Verify", pageStep >= 3],
            ["4", "Complete", pageStep >= 4],
          ].map(([number, label, active]) => (
            <div key={String(number)} style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: active ? "var(--isp-text)" : "var(--isp-text-muted)", fontSize: "0.74rem", fontWeight: 700 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center",
                background: active ? "var(--isp-accent)" : "var(--isp-section)",
                color: active ? "#fff" : "var(--isp-text-muted)",
                fontSize: "0.68rem",
              }}>{number}</span>
              {label}
            </div>
          ))}
        </div>

        {error && (
          <div style={{ ...panel, padding: "0.8rem 1rem", borderColor: "rgba(248,113,113,0.35)", background: "rgba(127,29,29,0.16)", color: "#fca5a5", display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "0.78rem" }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div style={{ ...panel, padding: "0.8rem 1rem", borderColor: "rgba(52,211,153,0.3)", background: "rgba(6,78,59,0.15)", color: "#6ee7b7", display: "flex", gap: "0.55rem", alignItems: "flex-start", fontSize: "0.78rem" }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}

        <section style={{ ...panel, padding: "1.15rem" }}>
          <SectionTitle
            number={1}
            title="Choose the router profile"
            description="The server assigns the tenant-safe router name and reserves an address from the isolated 10.8.5.x management pool."
          />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "1rem", marginTop: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Router name</span>
              <input
                value={routerName}
                onChange={event => setRouterName(event.target.value)}
                placeholder="Leave blank to choose the next company router number"
                disabled={Boolean(router) || Boolean(reconfigureId)}
                style={inputStyle}
              />
              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>Names are allocated as company1, company2, and so on.</span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Router bridge interface</span>
              <input value={bridgeInterface} onChange={event => setBridgeInterface(event.target.value)} disabled={Boolean(router)} style={inputStyle} />
              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>Stored as the preferred bridge for later API operations.</span>
            </label>
          </div>

          <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.6rem" }}>
            {MODE_OPTIONS.map(option => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                   onClick={() => {
                     setMode(option.value);
                     if (bridgeName === "hotspot-bridge" || bridgeName === "co-hotspot-bridge") {
                       setBridgeName(option.value === "brownfield" ? "co-hotspot-bridge" : "hotspot-bridge");
                     }
                   }}
                  style={{
                    textAlign: "left",
                    padding: "0.75rem",
                    borderRadius: 9,
                    border: `1px solid ${selected ? option.tone : "var(--isp-border)"}`,
                    background: selected ? `${option.tone}16` : "var(--isp-section)",
                    color: "var(--isp-text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong style={{ fontSize: "0.78rem" }}>{option.title}</strong>
                    {selected && <Check size={14} style={{ color: option.tone }} />}
                  </div>
                  <div style={{ marginTop: "0.3rem", color: "var(--isp-text-muted)", fontSize: "0.7rem", lineHeight: 1.4 }}>{option.description}</div>
                </button>
              );
            })}
          </div>

          {!router && (
            <button
              type="button"
              onClick={() => void createProfile()}
              disabled={busy !== "" || Boolean(reconfigureId)}
              style={{ marginTop: "1rem", display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.62rem 1rem", border: 0, borderRadius: 8, background: "var(--isp-accent)", color: "#fff", fontFamily: "inherit", fontWeight: 750, fontSize: "0.8rem", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy === "creating" ? <Loader2 size={15} style={{ animation: "self-install-spin 1s linear infinite" }} /> : <Network size={15} />}
              Create connection profile
            </button>
          )}
          {reconfigureId && !router && busy === "loading" && (
            <div style={{ marginTop: "1rem", color: "var(--isp-text-muted)", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
              <Loader2 size={14} style={{ animation: "self-install-spin 1s linear infinite" }} /> Loading router profile…
            </div>
          )}
        </section>

        {router && (
          <>
            <section style={{ ...panel, padding: "1.15rem" }}>
              <SectionTitle
                number={2}
                title="VPS connection properties"
                description="Use these values in the router's approved management configuration. The endpoint is tenant-independent; the tunnel IP is reserved for this router."
              />
              <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.6rem" }}>
                <Property label="Router profile" value={router.name} copyable />
                <Property label="VPS endpoint" value={tunnel?.connectTo || "Waiting for VPS configuration"} copyable />
                <Property label="Primary VPN port" value={tunnel ? `${tunnel.primaryPort}/tcp` : "—"} copyable />
                <Property label="Backup VPN port" value={tunnel ? `${tunnel.backupPort}/tcp` : "—"} copyable />
                <Property label="Router management IP" value={assignedTunnelIp} copyable />
                <Property label="RouterOS API port" value={tunnel ? String(tunnel.routerApiPort) : "8728"} copyable />
              </div>
              <div style={{ marginTop: "0.8rem", padding: "0.8rem", borderRadius: 9, background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.18)", display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
                <ShieldCheck size={17} style={{ color: "var(--isp-accent)", flexShrink: 0 }} />
                <div style={{ color: "var(--isp-text-muted)", fontSize: "0.74rem", lineHeight: 1.55 }}>
                  <strong style={{ color: "var(--isp-text)" }}>Connection boundary:</strong> the VPS reaches the router through the isolated management VPN, then uses RouterOS API port 8728. Public and LAN addresses are not used for the final verification.
                </div>
              </div>
               <div style={{ marginTop: "0.9rem", padding: "0.85rem", borderRadius: 9, background: "var(--isp-section)", border: "1px solid var(--isp-border-subtle)" }}>
                 <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--isp-text)", fontWeight: 750, fontSize: "0.78rem" }}>
                   <TerminalSquare size={14} style={{ color: "var(--isp-accent)" }} /> Generate the one-run RouterOS script
                 </div>
                 <div style={{ marginTop: "0.35rem", color: "var(--isp-text-muted)", fontSize: "0.72rem", lineHeight: 1.5 }}>
                    It creates the management OVPN client tagged <code>mainbillingvpn</code>, creates or reuses the hotspot bridge, adds the selected ports, adds the management API account, and applies only the related firewall/NAT rules. You can copy the complete script and paste it directly into the MikroTik terminal.
                 </div>
                 <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "end", gap: "0.65rem", flexWrap: "wrap" }}>
                   <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 180, flex: "1 1 180px" }}>
                     <span style={{ color: "var(--isp-text-muted)", fontSize: "0.66rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Hotspot bridge</span>
                     <input
                       value={bridgeName}
                       onChange={event => setBridgeName(event.target.value)}
                       placeholder={mode === "brownfield" ? "co-hotspot-bridge" : "hotspot-bridge"}
                       style={inputStyle}
                     />
                   </label>
                   <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 220, flex: "1 1 220px" }}>
                     <span style={{ color: "var(--isp-text-muted)", fontSize: "0.66rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Physical ports</span>
                     <input
                       value={ports}
                       onChange={event => setPorts(event.target.value)}
                       placeholder="ether2, ether3"
                       style={inputStyle}
                     />
                   </label>
                   <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 150 }}>
                     <span style={{ color: "var(--isp-text-muted)", fontSize: "0.66rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>RouterOS major</span>
                     <select value={routerOsMajor} onChange={event => setRouterOsMajor(Number(event.target.value) === 7 ? 7 : 6)} style={inputStyle}>
                       <option value={6}>RouterOS 6</option>
                       <option value={7}>RouterOS 7</option>
                     </select>
                   </label>
                   <button
                     type="button"
                     onClick={() => void downloadSelfInstallScript()}
                     disabled={busy !== "" || !endpointReady}
                     style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.62rem 1rem", border: 0, borderRadius: 8, background: endpointReady && busy === "" ? "var(--isp-accent)" : "var(--isp-section)", color: endpointReady && busy === "" ? "#fff" : "var(--isp-text-muted)", fontFamily: "inherit", fontWeight: 750, fontSize: "0.8rem", cursor: endpointReady && busy === "" ? "pointer" : "not-allowed" }}
                   >
                     {busy === "script" ? <Loader2 size={15} style={{ animation: "self-install-spin 1.1s linear infinite" }} /> : <Download size={15} />}
                     Generate and download script
                   </button>
                    <button
                      type="button"
                      onClick={() => void copySelfInstallScript()}
                      disabled={busy !== "" || !endpointReady}
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.62rem 1rem", border: "1px solid var(--isp-border)", borderRadius: 8, background: endpointReady && busy === "" ? "var(--isp-section)" : "var(--isp-section)", color: endpointReady && busy === "" ? "var(--isp-text)" : "var(--isp-text-muted)", fontFamily: "inherit", fontWeight: 750, fontSize: "0.8rem", cursor: endpointReady && busy === "" ? "pointer" : "not-allowed" }}
                    >
                      {scriptCopied ? <Check size={15} /> : <Clipboard size={15} />}
                      {scriptCopied ? "Copied to clipboard" : "Copy script"}
                    </button>
                 </div>
                  {scriptText && (
                    <div style={{ marginTop: "0.8rem" }}>
                      <div style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", lineHeight: 1.5, marginBottom: "0.4rem" }}>
                        Select the text below if needed, or use <strong style={{ color: "var(--isp-text)" }}>Copy script</strong>, then paste it into the MikroTik terminal and run it once.
                      </div>
                      <textarea
                        readOnly
                        value={scriptText}
                        aria-label="Generated RouterOS Self Install script"
                        spellCheck={false}
                        rows={14}
                        style={{ ...inputStyle, minHeight: 240, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.7rem", lineHeight: 1.45 }}
                      />
                    </div>
                  )}
                 {!endpointReady && (
                   <div style={{ marginTop: "0.55rem", color: "#fbbf24", fontSize: "0.7rem" }}>Generate the connection profile first so the VPS endpoint and tunnel credentials are ready.</div>
                 )}
               </div>
              {!endpointReady && (
                <div style={{ marginTop: "0.75rem", color: "#fbbf24", fontSize: "0.74rem", display: "flex", gap: "0.45rem", alignItems: "center" }}>
                  <AlertCircle size={14} /> VPS endpoint is not configured yet. Set ROUTER_OPENVPN_ENDPOINT or VPS_HOST before connecting a router.
                </div>
              )}
            </section>

            <section style={{ ...panel, padding: "1.15rem" }}>
              <SectionTitle
                number={3}
                title="Connect and verify"
                description="After the router-side management VPN and API are configured, keep this page open while the VPS observes the tunnel."
              />
              <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "1rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                  <CheckLine label="Tenant-owned router profile created" ok={Boolean(router)} />
                  <CheckLine label="VPS management endpoint selected" ok={endpointReady} />
                  <CheckLine label={`Management VPN tunnel${assignedTunnelIp !== "Pending allocation" ? ` · ${assignedTunnelIp}` : ""}`} ok={Boolean(live?.vpnConnected || finished)} pending={Boolean(!live?.vpnConnected && !finished)} />
                  <CheckLine label="RouterOS API identity and version" ok={connected} pending={Boolean(live?.vpnConnected && !connected)} />
                  {live?.heartbeat?.lastSeen && (
                    <div style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", marginTop: "0.1rem" }}>
                      Last heartbeat: {formatTime(live.heartbeat.lastSeen)}
                    </div>
                  )}
                </div>
                <div style={{ padding: "0.8rem", borderRadius: 9, background: "var(--isp-section)", border: "1px solid var(--isp-border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--isp-text)", fontWeight: 750, fontSize: "0.78rem" }}>
                    <TerminalSquare size={14} style={{ color: selectedMode.tone }} /> Router-side checklist
                  </div>
                   <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", color: "var(--isp-text-muted)", fontSize: "0.72rem", lineHeight: 1.7 }}>
                     <li>Download the generated script and run it once in the MikroTik terminal.</li>
                     <li>It creates the management VPN interface and requested hotspot bridge/ports.</li>
                     <li>It adds the management API user and only the related firewall/NAT rules.</li>
                     <li>Return here while the tunnel, callback, and API verification complete.</li>
                   </ul>
                </div>
              </div>
              <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <button type="button" onClick={() => void refreshStatus()} disabled={busy !== ""} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 0.85rem", borderRadius: 8, border: "1px solid var(--isp-border)", background: "var(--isp-section)", color: "var(--isp-text)", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.76rem" }}>
                  <RefreshCw size={14} /> Check now
                </button>
                {live?.via && <span style={{ color: "#34d399", fontSize: "0.72rem" }}>Connected via {live.via}</span>}
                {live?.error && !connected && <span style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{live.error}</span>}
              </div>
            </section>

            <section style={{ ...panel, padding: "1.15rem" }}>
              <SectionTitle
                number={4}
                title="Finish router installation"
                description="The server re-checks the management VPN, RouterOS identity, bridge membership, and default pools before promoting this router."
              />
              <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Verified bridge name (optional)</span>
                  <input value={bridgeName} onChange={event => setBridgeName(event.target.value)} placeholder={mode === "brownfield" ? "co-hotspot-bridge" : "bridge"} style={inputStyle} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.05em" }}>Verified physical ports (optional)</span>
                  <input value={ports} onChange={event => setPorts(event.target.value)} placeholder="ether2, ether3" style={inputStyle} />
                </label>
              </div>
              <div style={{ marginTop: "0.85rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Wifi size={14} style={{ color: connected ? "#34d399" : "#fbbf24" }} />
                  {connected ? "RouterOS API is responding." : "Waiting for a verified RouterOS API connection."}
                </div>
                <button
                  type="button"
                  onClick={() => void finishInstall()}
                  disabled={!connected || busy !== "" || Boolean(finished)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.62rem 1rem", border: 0, borderRadius: 8, background: connected && !finished ? "var(--isp-accent)" : "var(--isp-section)", color: connected && !finished ? "#fff" : "var(--isp-text-muted)", fontFamily: "inherit", fontWeight: 750, fontSize: "0.8rem", cursor: connected && !finished ? "pointer" : "not-allowed" }}
                >
                  {busy === "finishing" ? <Loader2 size={15} style={{ animation: "self-install-spin 1s linear infinite" }} /> : <CheckCircle2 size={15} />}
                  {finished ? "Installation complete" : "Verify and add router"}
                </button>
              </div>
            </section>

            {finished && (
              <div style={{ ...panel, padding: "1rem 1.15rem", borderColor: "rgba(52,211,153,0.3)", background: "rgba(6,78,59,0.16)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                  <CheckCircle2 size={21} style={{ color: "#34d399", marginTop: 1 }} />
                  <div>
                    <strong style={{ display: "block", color: "#a7f3d0", fontSize: "0.84rem" }}>{finished.name} is ready</strong>
                    <span style={{ color: "#6ee7b7", fontSize: "0.72rem" }}>RouterOS {finished.rosVersion || "version detected"} · {finished.identity || "identity verified"} · API reachable via {finished.vpnIp}</span>
                  </div>
                </div>
                <button type="button" onClick={() => navigate("/admin/network/routers")} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 0.85rem", borderRadius: 8, border: "1px solid rgba(167,243,208,0.35)", background: "rgba(16,185,129,0.1)", color: "#a7f3d0", cursor: "pointer", fontFamily: "inherit", fontWeight: 750, fontSize: "0.76rem" }}>
                  View active routers <ExternalLink size={13} />
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ ...panel, padding: "0.9rem 1rem", display: "flex", gap: "0.65rem", alignItems: "flex-start", color: "var(--isp-text-muted)", fontSize: "0.72rem", lineHeight: 1.55 }}>
          <Globe2 size={16} style={{ color: "var(--isp-accent)", flexShrink: 0 }} />
          <span><strong style={{ color: "var(--isp-text)" }}>VPS requirement:</strong> the router-management OpenVPN service must be provisioned on the VPS, its endpoint must have a trusted public certificate, and the management API must be reachable only through the isolated tunnel.</span>
        </div>
      </div>
    </AdminLayout>
  );
}