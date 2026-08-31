import React, { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID, supabase } from "@/lib/supabase";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Scale,
  ShieldCheck,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";

type RouterOsVersion = "auto" | "6" | "7";

interface WanLink {
  id?: number;
  name: string;
  interfaceName: string;
  gateway: string;
  weight: number;
  healthCheckIp: string;
  enabled: boolean;
  position: number;
}

interface LoadBalancingConfig {
  routerId: number;
  adminId: number;
  enabled: boolean;
  lanInterface: string;
  routerOsVersion: RouterOsVersion;
  wans: WanLink[];
}

interface RouterOption {
  id: number;
  name: string;
  host: string | null;
  ros_version: string | null;
  status: string;
}

interface LoadBalancingResponse {
  ok: boolean;
  config: LoadBalancingConfig;
  script: string;
  effectiveVersion: "6" | "7";
  activeWanCount: number;
  totalWeight: number;
  applied?: boolean;
  routerName?: string;
  connectedHost?: string;
  error?: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--isp-input-bg,#0f1923)",
  border: "1px solid var(--isp-input-border,rgba(255,255,255,0.1))",
  borderRadius: 8,
  padding: "0.58rem 0.7rem",
  color: "var(--isp-text)",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  color: "var(--isp-text-muted)",
  fontSize: "0.68rem",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

function emptyWan(position: number): WanLink {
  return {
    name: `WAN ${position + 1}`,
    interfaceName: "",
    gateway: "",
    weight: 1,
    healthCheckIp: position === 0 ? "1.1.1.1" : position === 1 ? "8.8.8.8" : "",
    enabled: true,
    position,
  };
}

function emptyConfig(routerId: number): LoadBalancingConfig {
  return {
    routerId,
    adminId: ADMIN_ID,
    enabled: false,
    lanInterface: "bridge",
    routerOsVersion: "auto",
    wans: [emptyWan(0), emptyWan(1)],
  };
}

function validIpv4(value: string): boolean {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every(part => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function localValidation(config: LoadBalancingConfig): string[] {
  const errors: string[] = [];
  if (!config.lanInterface.trim()) errors.push("Enter the customer LAN interface.");
  if (config.wans.length < 2) errors.push("Add at least two WAN links.");
  const interfaces = new Set<string>();
  const targets = new Set<string>();
  config.wans.forEach((wan, index) => {
    const label = wan.name.trim() || `WAN ${index + 1}`;
    if (!wan.interfaceName.trim()) errors.push(`${label}: interface is required.`);
    if (wan.interfaceName.trim() === config.lanInterface.trim()) errors.push(`${label}: cannot be the LAN interface.`);
    if (interfaces.has(wan.interfaceName.trim())) errors.push(`${label}: interface is duplicated.`);
    interfaces.add(wan.interfaceName.trim());
    if (!validIpv4(wan.gateway)) errors.push(`${label}: enter a valid gateway.`);
    if (!validIpv4(wan.healthCheckIp)) errors.push(`${label}: enter a valid health-check IP.`);
    if (targets.has(wan.healthCheckIp.trim())) errors.push(`${label}: health-check IP must be unique.`);
    targets.add(wan.healthCheckIp.trim());
    if (!Number.isInteger(Number(wan.weight)) || Number(wan.weight) < 1 || Number(wan.weight) > 100) {
      errors.push(`${label}: weight must be between 1 and 100.`);
    }
  });
  if (config.enabled && config.wans.filter(wan => wan.enabled).length < 2) {
    errors.push("Enable at least two WAN links before turning on load balancing.");
  }
  return errors;
}

async function getResponse(
  url: string,
  options?: RequestInit,
): Promise<LoadBalancingResponse> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json() as LoadBalancingResponse;
  if (!response.ok) throw new Error(body.error || "Load-balancing request failed.");
  return body;
}

function ActionButton({
  children,
  onClick,
  disabled,
  secondary = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "0.55rem 0.82rem",
        borderRadius: 8,
        border: secondary
          ? "1px solid var(--isp-border)"
          : `1px solid ${danger ? "rgba(248,113,113,0.3)" : "var(--isp-accent-border)"}`,
        background: secondary ? "var(--isp-section)" : danger ? "rgba(248,113,113,0.1)" : "var(--isp-accent)",
        color: secondary ? "var(--isp-text-muted)" : danger ? "#f87171" : "#fff",
        fontFamily: "inherit",
        fontSize: "0.76rem",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export default function LoadBalancing() {
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [routerId, setRouterId] = useState<number | null>(null);
  const [config, setConfig] = useState<LoadBalancingConfig | null>(null);
  const [script, setScript] = useState("");
  const [effectiveVersion, setEffectiveVersion] = useState<"6" | "7">("7");
  const [loadingRouters, setLoadingRouters] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [busy, setBusy] = useState<"save" | "preview" | "apply" | "download" | "">("");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingRouters(true);
      const { data, error } = await supabase
        .from("isp_routers")
        .select("id,name,host,ros_version,status")
        .eq("admin_id", ADMIN_ID)
        .not("status", "in", "(setup,awaiting_ports,awaiting_sync,awaiting_connection)")
        .order("name");
      if (cancelled) return;
      const rows = (data ?? []) as RouterOption[];
      setRouters(rows);
      setRouterId(current => current ?? rows[0]?.id ?? null);
      setLoadingRouters(false);
      if (error) setMessage({ type: "error", text: error.message });
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!routerId) {
      setConfig(null);
      setScript("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingConfig(true);
      setMessage(null);
      try {
        const response = await getResponse(`/api/router/${routerId}/load-balancing?adminId=${ADMIN_ID}`);
        if (cancelled) return;
        setConfig(response.config);
        setScript(response.script);
        setEffectiveVersion(response.effectiveVersion);
      } catch (error) {
        if (cancelled) return;
        setConfig(emptyConfig(routerId));
        setScript("");
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load settings." });
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();
    return () => { cancelled = true; };
  }, [routerId]);

  const selectedRouter = routers.find(router => router.id === routerId);
  const activeWans = config?.wans.filter(wan => wan.enabled) ?? [];
  const totalWeight = activeWans.reduce((sum, wan) => sum + Number(wan.weight || 0), 0);
  const errors = useMemo(() => config ? localValidation(config) : [], [config]);

  function updateConfig(patch: Partial<LoadBalancingConfig>) {
    setConfig(current => current ? { ...current, ...patch } : current);
    setMessage(null);
  }

  function updateWan(index: number, patch: Partial<WanLink>) {
    setConfig(current => {
      if (!current) return current;
      return { ...current, wans: current.wans.map((wan, i) => i === index ? { ...wan, ...patch } : wan) };
    });
    setMessage(null);
  }

  function moveWan(index: number, direction: -1 | 1) {
    setConfig(current => {
      if (!current) return current;
      const next = [...current.wans];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, wans: next.map((wan, position) => ({ ...wan, position })) };
    });
  }

  async function preview() {
    if (!config) return;
    if (errors.length) {
      setMessage({ type: "error", text: errors[0] });
      return;
    }
    setBusy("preview");
    try {
      const response = await getResponse(`/api/router/${config.routerId}/load-balancing/preview`, {
        method: "POST",
        body: JSON.stringify(config),
      });
      setScript(response.script);
      setEffectiveVersion(response.effectiveVersion);
      setMessage({ type: "success", text: `Generated RouterOS ${response.effectiveVersion} configuration.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Preview failed." });
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!config) return;
    if (errors.length) {
      setMessage({ type: "error", text: errors[0] });
      return;
    }
    setBusy("save");
    try {
      const response = await getResponse(`/api/router/${config.routerId}/load-balancing`, {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(response.config);
      setScript(response.script);
      setEffectiveVersion(response.effectiveVersion);
      setMessage({ type: "success", text: "Load-balancing settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Save failed." });
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!config) return;
    if (errors.length) {
      setMessage({ type: "error", text: errors[0] });
      return;
    }
    if (!config.enabled || activeWans.length < 2) {
      setMessage({ type: "error", text: "Enable load balancing and at least two WAN links before applying." });
      return;
    }
    const confirmed = window.confirm(
      "Apply this multi-WAN configuration to the selected MikroTik router? Existing sessions are not bonded; new sessions will be distributed across the configured WANs.",
    );
    if (!confirmed) return;
    setBusy("apply");
    try {
      const response = await getResponse(`/api/router/${config.routerId}/load-balancing/apply`, {
        method: "POST",
        body: JSON.stringify({ ...config, confirm: true }),
      });
      setConfig(response.config);
      setScript(response.script);
      setEffectiveVersion(response.effectiveVersion);
      setMessage({
        type: "success",
        text: `Applied to ${response.routerName ?? selectedRouter?.name ?? "router"} via ${response.connectedHost ?? "RouterOS API"}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Apply failed." });
    } finally {
      setBusy("");
    }
  }

  function download() {
    if (!script) {
      setMessage({ type: "info", text: "Generate a preview before downloading the RouterOS script." });
      return;
    }
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `isplatty-load-balancing-router-${routerId ?? "config"}.rsc`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage({ type: "success", text: "RouterOS script downloaded." });
  }

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", maxWidth: 1220 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, color: "var(--isp-text)", fontSize: "1.25rem", fontWeight: 800 }}>Load Balancing</h1>
            <p style={{ margin: "0.35rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem", maxWidth: 700 }}>
              Distribute new customer connections across multiple internet uplinks with PCC, health checks, and automatic failover.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton secondary disabled={!config || busy !== ""} onClick={preview}>
              {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
            </ActionButton>
            <ActionButton secondary disabled={!script || busy !== ""} onClick={download}>
              <Download size={14} /> Download .rsc
            </ActionButton>
            <ActionButton disabled={!config || busy !== ""} onClick={save}>
              {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </ActionButton>
            <ActionButton disabled={!config || busy !== ""} onClick={apply}>
              {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} Apply to router
            </ActionButton>
          </div>
        </div>

        <NetworkTabs active="load-balancing" />

        {message && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 9, borderRadius: 9, padding: "0.75rem 0.9rem",
            background: message.type === "success" ? "rgba(74,222,128,0.08)" : message.type === "error" ? "rgba(248,113,113,0.08)" : "rgba(56,189,248,0.08)",
            border: `1px solid ${message.type === "success" ? "rgba(74,222,128,0.22)" : message.type === "error" ? "rgba(248,113,113,0.22)" : "rgba(56,189,248,0.22)"}`,
            color: message.type === "success" ? "#4ade80" : message.type === "error" ? "#f87171" : "#38bdf8",
            fontSize: "0.78rem", lineHeight: 1.5,
          }}>
            {message.type === "success" ? <CheckCircle2 size={15} /> : message.type === "error" ? <XCircle size={15} /> : <AlertTriangle size={15} />}
            <span>{message.text}</span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "1rem", alignItems: "start" }}>
          <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Scale size={16} style={{ color: "var(--isp-accent)" }} />
                <div>
                  <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.93rem", fontWeight: 800 }}>Router policy</h2>
                  <p style={{ margin: "0.2rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>These settings are saved separately for each router.</p>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.3fr) minmax(150px,1fr) minmax(150px,1fr) auto", gap: 12, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>Target router</label>
                  <select
                    value={routerId ?? ""}
                    onChange={event => setRouterId(Number(event.target.value) || null)}
                    disabled={loadingRouters}
                    style={inputStyle}
                  >
                    <option value="">{loadingRouters ? "Loading routers…" : "Select a router"}</option>
                    {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Customer LAN interface</label>
                  <input value={config?.lanInterface ?? ""} onChange={event => updateConfig({ lanInterface: event.target.value })} placeholder="bridge" style={inputStyle} disabled={!config} />
                </div>
                <div>
                  <label style={labelStyle}>RouterOS syntax</label>
                  <select value={config?.routerOsVersion ?? "auto"} onChange={event => updateConfig({ routerOsVersion: event.target.value as RouterOsVersion })} style={inputStyle} disabled={!config}>
                    <option value="auto">Auto-detect ({selectedRouter?.ros_version || "defaults to 7"})</option>
                    <option value="6">RouterOS 6</option>
                    <option value="7">RouterOS 7</option>
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, color: "var(--isp-text)", fontSize: "0.78rem", fontWeight: 700, cursor: config ? "pointer" : "default" }}>
                  <input type="checkbox" checked={config?.enabled ?? false} onChange={event => updateConfig({ enabled: event.target.checked })} disabled={!config} style={{ width: 16, height: 16, accentColor: "var(--isp-accent)" }} />
                  Enabled
                </label>
              </div>
            </div>

            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "1rem 1.1rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
                <div>
                  <h2 style={{ margin: 0, color: "var(--isp-text)", fontSize: "0.93rem", fontWeight: 800 }}>Internet uplinks</h2>
                  <p style={{ margin: "0.2rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>PCC assigns each new connection to an enabled WAN based on its weight.</p>
                </div>
                <ActionButton secondary disabled={!config || config.wans.length >= 4} onClick={() => config && updateConfig({ wans: [...config.wans, emptyWan(config.wans.length)] })}>
                  <Plus size={14} /> Add WAN
                </ActionButton>
              </div>

              {loadingConfig ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "3rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}><Loader2 size={16} className="animate-spin" /> Loading router settings…</div>
              ) : !config ? (
                <div style={{ padding: "3rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>Select a router to configure its internet uplinks.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0.85rem" }}>
                  {config.wans.map((wan, index) => (
                    <div key={`${wan.id ?? "new"}-${index}`} style={{ border: `1px solid ${wan.enabled ? "var(--isp-border)" : "rgba(148,163,184,0.12)"}`, borderRadius: 10, padding: "0.85rem", background: wan.enabled ? "var(--isp-inner-card)" : "rgba(15,23,42,0.18)", opacity: wan.enabled ? 1 : 0.68 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}>
                          <input type="checkbox" checked={wan.enabled} onChange={event => updateWan(index, { enabled: event.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--isp-accent)" }} />
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 7, background: "rgba(37,99,235,0.12)", color: "var(--isp-accent)", fontSize: "0.72rem" }}>{index + 1}</span>
                          {wan.name || `WAN ${index + 1}`}
                        </label>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" title="Move up" disabled={index === 0} onClick={() => moveWan(index, -1)} style={{ ...iconButton, opacity: index === 0 ? 0.3 : 1 }}><ArrowUp size={14} /></button>
                          <button type="button" title="Move down" disabled={index === config.wans.length - 1} onClick={() => moveWan(index, 1)} style={{ ...iconButton, opacity: index === config.wans.length - 1 ? 0.3 : 1 }}><ArrowDown size={14} /></button>
                          <button type="button" title="Remove WAN" disabled={config.wans.length <= 2} onClick={() => updateConfig({ wans: config.wans.filter((_, i) => i !== index).map((item, position) => ({ ...item, position })) })} style={{ ...iconButton, color: "#f87171" }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(140px,1fr) minmax(140px,1fr) 90px minmax(140px,1fr)", gap: 10 }}>
                        <div><label style={labelStyle}>Label</label><input value={wan.name} onChange={event => updateWan(index, { name: event.target.value })} placeholder={`WAN ${index + 1}`} style={inputStyle} /></div>
                        <div><label style={labelStyle}>WAN interface</label><input value={wan.interfaceName} onChange={event => updateWan(index, { interfaceName: event.target.value })} placeholder="ether1" style={inputStyle} /></div>
                        <div><label style={labelStyle}>Gateway</label><input value={wan.gateway} onChange={event => updateWan(index, { gateway: event.target.value })} placeholder="192.168.1.1" style={{ ...inputStyle, fontFamily: "monospace" }} /></div>
                        <div><label style={labelStyle}>Weight</label><input type="number" min={1} max={100} value={wan.weight} onChange={event => updateWan(index, { weight: Number(event.target.value) })} style={{ ...inputStyle, fontFamily: "monospace" }} /></div>
                        <div><label style={labelStyle}>Health-check IP</label><input value={wan.healthCheckIp} onChange={event => updateWan(index, { healthCheckIp: event.target.value })} placeholder="1.1.1.1" style={{ ...inputStyle, fontFamily: "monospace" }} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Active WANs", value: activeWans.length, icon: Wifi, color: "#4ade80" },
                { label: "Total weight", value: totalWeight || "—", icon: Scale, color: "#60a5fa" },
                { label: "Effective syntax", value: `ROS ${effectiveVersion}`, icon: Activity, color: "#c084fc" },
                { label: "Failover", value: config?.enabled && activeWans.length > 1 ? "Ready" : "Off", icon: ShieldCheck, color: config?.enabled && activeWans.length > 1 ? "#4ade80" : "#94a3b8" },
              ].map(card => (
                <div key={card.label} style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 10, padding: "0.75rem" }}>
                  <card.icon size={15} style={{ color: card.color, marginBottom: 9 }} />
                  <div style={{ color: "var(--isp-text)", fontSize: "0.95rem", fontWeight: 800 }}>{card.value}</div>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem", marginTop: 3 }}>{card.label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 11, padding: "0.9rem" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <ShieldCheck size={16} style={{ color: "#38bdf8", flexShrink: 0, marginTop: 1 }} />
                <div style={{ color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.65 }}>
                  <strong style={{ color: "#38bdf8" }}>Safe by design</strong>
                  <p style={{ margin: "0.35rem 0 0" }}>The generated script owns only resources tagged <code style={{ fontFamily: "monospace", color: "var(--isp-text)" }}>ISPlatty-LB</code>. It leaves hotspot, PPPoE, VPN, and unrelated firewall rules untouched.</p>
                </div>
              </div>
            </div>

            <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 11, padding: "0.9rem" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={16} style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }} />
                <div style={{ color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.65 }}>
                  <strong style={{ color: "#fbbf24" }}>Connection-based balancing</strong>
                  <p style={{ margin: "0.35rem 0 0" }}>PCC distributes new connections, not packets. Existing sessions keep their connection mark and continue through the same uplink.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {errors.length > 0 && config && (
          <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "0.85rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#f87171", fontSize: "0.78rem", fontWeight: 800, marginBottom: 6 }}><AlertTriangle size={14} /> Configuration needs attention</div>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "var(--isp-text-muted)", fontSize: "0.73rem", lineHeight: 1.6 }}>
              {errors.slice(0, 5).map(error => <li key={error}>{error}</li>)}
            </ul>
          </div>
        )}

        <section style={{ background: "#0a0e1a", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0.75rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={15} style={{ color: "#4ade80" }} />
              <span style={{ color: "#e2e8f0", fontSize: "0.8rem", fontWeight: 800 }}>RouterOS configuration preview</span>
              <span style={{ color: "#64748b", fontSize: "0.68rem", fontFamily: "monospace" }}>ROS {effectiveVersion}</span>
            </div>
            {script && <button type="button" onClick={preview} disabled={busy !== ""} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: 0, background: "transparent", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: "0.7rem" }}><RefreshCw size={12} /> Regenerate</button>}
          </div>
          <pre style={{ minHeight: 160, maxHeight: 520, overflow: "auto", margin: 0, padding: "1rem", color: script ? "#4ade80" : "#64748b", fontSize: "0.7rem", lineHeight: 1.65, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {script || "# Choose a router and click Preview to generate an idempotent multi-WAN RouterOS configuration."}
          </pre>
        </section>
      </div>
    </AdminLayout>
  );
}

const iconButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 27,
  height: 27,
  padding: 0,
  borderRadius: 6,
  border: "1px solid var(--isp-border)",
  background: "var(--isp-section)",
  color: "var(--isp-text-muted)",
  cursor: "pointer",
};