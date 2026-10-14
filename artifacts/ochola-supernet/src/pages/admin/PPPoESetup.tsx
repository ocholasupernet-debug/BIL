import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminApiFetch } from "@/lib/api-client";
import { fetchAdminRouterManagementContext } from "@/lib/admin-router-context";
import { ADMIN_ID as AUTH_ADMIN_ID, getSelectedTenantId } from "@/lib/supabase";
import { AlertCircle, Cable, CheckCircle2, Loader2, Settings2, ShieldCheck, Wifi } from "lucide-react";

const ADMIN_ID = getSelectedTenantId() ?? AUTH_ADMIN_ID;
type SetupMode = "hotspot_bridge" | "own_port";

interface RouterOption {
  id: number;
  name: string;
  host?: string | null;
  status?: string | null;
}

interface InterfaceOption {
  name: string;
  running: boolean;
  inBridge: boolean;
  isWan: boolean;
}

interface InterfacePayload {
  routerId: number;
  hotspotBridgeAvailable: boolean;
  ports: InterfaceOption[];
}

interface DeployResult {
  ok: boolean;
  verified: boolean;
  routerName: string;
  mode: SetupMode;
  interfaceName: string;
  serviceName: string;
  fileName: string;
  features: string[];
  message: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await adminApiFetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

const panel: React.CSSProperties = {
  background: "var(--isp-section)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--isp-border)",
  background: "var(--isp-bg)",
  color: "var(--isp-text)",
  font: "inherit",
};

export default function PPPoESetup() {
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [routerId, setRouterId] = useState("");
  const [loadingRouters, setLoadingRouters] = useState(true);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [interfaces, setInterfaces] = useState<InterfacePayload | null>(null);
  const [mode, setMode] = useState<SetupMode>("hotspot_bridge");
  const [portName, setPortName] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DeployResult | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAdminRouterManagementContext()
      .then(({ routers: rows }) => {
        if (!active) return;
        const ready = rows.filter(router =>
          !["setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"].includes(router.status),
        );
        setRouters(ready);
        setRouterId(current => current && ready.some(router => String(router.id) === current)
          ? current
          : ready[0] ? String(ready[0].id) : "");
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Could not load tenant routers."))
      .finally(() => { if (active) setLoadingRouters(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setInterfaces(null);
    setPortName("");
    setError("");
    setResult(null);
    if (!routerId) return;
    setLoadingInterfaces(true);
    void requestJson<InterfacePayload>(
      `/api/router/${encodeURIComponent(routerId)}/pppoe-setup/interfaces?adminId=${encodeURIComponent(String(ADMIN_ID))}`,
      { cache: "no-store" },
    )
      .then(payload => {
        if (!active) return;
        setInterfaces(payload);
        const available = payload.ports.filter(port => !port.inBridge && !port.isWan);
        setPortName(available.find(port => port.running)?.name ?? available[0]?.name ?? "");
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "Router ports could not be loaded.");
      })
      .finally(() => { if (active) setLoadingInterfaces(false); });
    return () => { active = false; };
  }, [routerId]);

  const availablePorts = useMemo(
    () => (interfaces?.ports ?? []).filter(port => !port.inBridge && !port.isWan),
    [interfaces],
  );

  async function deploy() {
    if (!routerId) return;
    if (mode === "hotspot_bridge" && !interfaces?.hotspotBridgeAvailable) {
      setError('This router does not have an enabled "hotspot-bridge".');
      return;
    }
    if (mode === "own_port" && !availablePorts.some(port => port.name === portName)) {
      setError("Select an available unbridged, non-WAN Ethernet port.");
      return;
    }
    const target = mode === "hotspot_bridge" ? "hotspot-bridge" : portName;
    if (!window.confirm(`Import the managed PPPoE setup on ${target} for ${routers.find(router => String(router.id) === routerId)?.name ?? "this router"}? This adds/updates the PPPoE listener, managed pools/profile, forwarding, and NAT. It will not move any port or edit PPPoE users.`)) return;
    setDeploying(true);
    setError("");
    setResult(null);
    try {
      const response = await requestJson<DeployResult>(
        `/api/router/${encodeURIComponent(routerId)}/pppoe-setup/deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminId: ADMIN_ID,
            mode,
            ...(mode === "own_port" ? { interfaceName: portName } : {}),
          }),
        },
      );
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PPPoE setup could not be imported.");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <AdminLayout>
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "30px 26px 48px", color: "var(--isp-text)" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
          <div>
            <div style={{ color: "var(--isp-accent)", fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>PPPoE settings</div>
            <h1 style={{ margin: "7px 0 5px", fontSize: 25, lineHeight: 1.2 }}>PPPoE router setup</h1>
            <p style={{ margin: 0, color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.55, maxWidth: 700 }}>
              Choose where this router should accept PPPoE connections. The generated setup is pushed, imported, then checked against the live RouterOS configuration.
            </p>
          </div>
          <Link href="/admin/pppoe-settings">
            <a style={{ color: "var(--isp-accent)", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Portal appearance settings</a>
          </Link>
        </header>

        <section style={{ ...panel, padding: 20 }}>
          <label style={{ display: "block", maxWidth: 500, fontSize: 12, fontWeight: 700 }}>
            MikroTik router
            <select style={{ ...fieldStyle, display: "block", marginTop: 7 }} value={routerId} onChange={event => setRouterId(event.target.value)} disabled={loadingRouters || deploying}>
              <option value="">{loadingRouters ? "Loading routers…" : "Select a router"}</option>
              {routers.map(router => <option key={router.id} value={router.id}>{router.name}{router.host ? ` · ${router.host}` : ""}</option>)}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 20 }}>
            <button type="button" onClick={() => { setMode("hotspot_bridge"); setError(""); setResult(null); }} style={{ ...panel, padding: 16, textAlign: "left", color: "var(--isp-text)", cursor: "pointer", borderColor: mode === "hotspot_bridge" ? "var(--isp-accent)" : "var(--isp-border)", boxShadow: mode === "hotspot_bridge" ? "0 0 0 2px color-mix(in srgb, var(--isp-accent) 20%, transparent)" : "none" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 14 }}><Wifi size={17} /> PPPoE over Hotspot bridge</span>
              <span style={{ display: "block", marginTop: 8, color: "var(--isp-text-muted)", fontSize: 12, lineHeight: 1.5 }}>Accept PPPoE sessions on the existing hotspot-bridge interface.</span>
            </button>
            <button type="button" onClick={() => { setMode("own_port"); setError(""); setResult(null); }} style={{ ...panel, padding: 16, textAlign: "left", color: "var(--isp-text)", cursor: "pointer", borderColor: mode === "own_port" ? "var(--isp-accent)" : "var(--isp-border)", boxShadow: mode === "own_port" ? "0 0 0 2px color-mix(in srgb, var(--isp-accent) 20%, transparent)" : "none" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 14 }}><Cable size={17} /> PPPoE on its own port</span>
              <span style={{ display: "block", marginTop: 8, color: "var(--isp-text-muted)", fontSize: 12, lineHeight: 1.5 }}>Choose a live, unbridged Ethernet access port. WAN and bridged ports are excluded.</span>
            </button>
          </div>

          {mode === "hotspot_bridge" && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "var(--isp-bg)", color: interfaces?.hotspotBridgeAvailable ? "var(--isp-text-muted)" : "#b45309", fontSize: 12, lineHeight: 1.5 }}>
              {loadingInterfaces ? "Checking the live bridge…" : interfaces?.hotspotBridgeAvailable ? "Target interface: hotspot-bridge" : 'This router does not currently report an enabled "hotspot-bridge".'}
            </div>
          )}

          {mode === "own_port" && (
            <label style={{ display: "block", maxWidth: 500, marginTop: 16, fontSize: 12, fontWeight: 700 }}>
              Ethernet access port
              <select style={{ ...fieldStyle, display: "block", marginTop: 7 }} value={portName} onChange={event => { setPortName(event.target.value); setError(""); setResult(null); }} disabled={loadingInterfaces || deploying || availablePorts.length === 0}>
                <option value="">{loadingInterfaces ? "Reading ports from MikroTik…" : "Select an available port"}</option>
                {availablePorts.map(port => <option key={port.name} value={port.name}>{port.name}{port.running ? " · link up" : " · link down"}</option>)}
              </select>
              {!loadingInterfaces && !availablePorts.length && <span style={{ display: "block", marginTop: 6, color: "var(--isp-text-muted)", fontWeight: 400 }}>No unbridged, non-WAN Ethernet ports are available. Remove a port from its bridge only if you have confirmed doing so will not interrupt its current service.</span>}
            </label>
          )}

          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 18, padding: 12, borderRadius: 8, background: "rgba(245,158,11,.08)", color: "var(--isp-text-muted)", fontSize: 12, lineHeight: 1.5 }}>
            <ShieldCheck size={15} style={{ flex: "none", color: "#d09220" }} />
            <span>This setup provisions the managed active and expired pools, PPP profile, PPPoE listener, WAN forwarding, and NAT. It does not change interface membership or alter existing PPPoE accounts. Each port listener has its own service name.</span>
          </div>

          {error && <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16, padding: 12, borderRadius: 8, border: "1px solid rgba(220,80,65,.3)", background: "rgba(220,80,65,.08)", color: "var(--isp-text)", fontSize: 13 }}><AlertCircle size={16} style={{ flex: "none", color: "#dc5041" }} />{error}</div>}

          {result && (
            <div role="status" style={{ marginTop: 16, padding: 15, borderRadius: 9, border: "1px solid rgba(22,140,120,.35)", background: "rgba(22,140,120,.08)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#11836e", fontWeight: 800, fontSize: 14 }}><CheckCircle2 size={17} /> Setup imported and verified</div>
              <p style={{ margin: "8px 0", fontSize: 13, color: "var(--isp-text)" }}>{result.message}</p>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--isp-text-muted)" }}>{result.routerName} · {result.interfaceName} · service <code>{result.serviceName}</code> · file <code>{result.fileName}</code></p>
              <ul style={{ margin: 0, paddingLeft: 19, color: "var(--isp-text-muted)", fontSize: 12, lineHeight: 1.65 }}>{result.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button type="button" onClick={() => void deploy()} disabled={!routerId || loadingInterfaces || deploying || (mode === "hotspot_bridge" && !interfaces?.hotspotBridgeAvailable) || (mode === "own_port" && !portName)} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 42, padding: "0 16px", border: 0, borderRadius: 8, background: "var(--isp-accent)", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: !routerId || loadingInterfaces || deploying ? .6 : 1 }}>
              {deploying ? <Loader2 size={16} className="animate-spin" /> : <Settings2 size={16} />}
              {deploying ? "Pushing and verifying…" : "Generate, push & import"}
            </button>
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}
