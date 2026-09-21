import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  EthernetPort,
  Layers3,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";

type Mode = "shared" | "multiport";
type RouterOption = { id: number; name: string; status?: string; model?: string | null };
type PortOption = { name: string; type: string; running: boolean; assigned?: boolean };
type PortAssignment = {
  id: number;
  router_id: number;
  interface_name: string;
  bridge_name?: string | null;
  hotspot_enabled: boolean;
  hotspot_template_path?: string | null;
  hotspot_folder_path?: string | null;
  pppoe_enabled: boolean;
  pppoe_folder_path?: string | null;
  hotspot_dns_name?: string | null;
  pppoe_dns_name?: string | null;
  subnet_range?: string | null;
  bandwidth_cap_mbps: number;
  reseller_bandwidth_cap?: number | null;
  status: string;
  provisioning_error?: string | null;
};

type Draft = {
  hotspotEnabled: boolean;
  hotspotFolderPath: string;
  hotspotDnsName: string;
  pppoeEnabled: boolean;
  pppoeFolderPath: string;
  pppoeDnsName: string;
  bridgeName: string;
  subnetRange: string;
  bandwidthCapMbps: string;
};

const panel: React.CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "var(--shadow-sm)",
};

const input: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  boxSizing: "border-box",
  border: "1px solid var(--isp-input-border)",
  borderRadius: 8,
  padding: "9px 11px",
  background: "var(--isp-input-bg)",
  color: "var(--isp-text)",
  font: "inherit",
};

const muted: React.CSSProperties = { color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.55 };

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getAdminApiToken()}`,
    "Content-Type": "application/json",
  };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function routerRows(payload: RouterOption[] | { routers?: RouterOption[] }): RouterOption[] {
  return Array.isArray(payload) ? payload : payload.routers ?? [];
}

function safeSegment(value: string, fallback: string): string {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return segment.slice(0, 42) || fallback;
}

function hostnameSegment(value: string, fallback: string): string {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return segment.slice(0, 42) || fallback;
}

function nextAvailableSubnet(assignments: PortAssignment[]): string {
  const used = new Set(
    assignments
      .map((assignment) => assignment.subnet_range?.match(/^10\.250\.(\d+)\.0\/24$/)?.[1])
      .filter((octet): octet is string => Boolean(octet))
      .map(Number),
  );
  for (let octet = 1; octet <= 254; octet += 1) {
    if (!used.has(octet)) return `10.250.${octet}.0/24`;
  }
  return "10.250.254.0/24";
}

function autoDraftForPort(router: RouterOption, port: PortOption, assignments: PortAssignment[]): Draft {
  const portSegment = safeSegment(port.name, "port");
  const portHostnameSegment = hostnameSegment(port.name, "port");
  const routerSegment = hostnameSegment(router.name, `router-${router.id}`);
  return {
    hotspotEnabled: true,
    hotspotFolderPath: "login.html",
    hotspotDnsName: `hotspot-${routerSegment}-${portHostnameSegment}.lan`,
    pppoeEnabled: false,
    pppoeFolderPath: "login.html",
    pppoeDnsName: `pppoe-${routerSegment}-${portHostnameSegment}.lan`,
    bridgeName: `${routerSegment}-bridge-${portSegment}`,
    subnetRange: nextAvailableSubnet(assignments),
    bandwidthCapMbps: "30",
  };
}

function draftFromAssignment(port: PortAssignment, router: RouterOption, assignments: PortAssignment[]): Draft {
  const defaults = autoDraftForPort(
    router,
    { name: port.interface_name, type: "ether", running: true },
    assignments.filter((assignment) => assignment.id !== port.id),
  );
  return {
    hotspotEnabled: port.hotspot_enabled,
    hotspotFolderPath: port.hotspot_folder_path ?? port.hotspot_template_path ?? "",
    hotspotDnsName: port.hotspot_dns_name ?? defaults.hotspotDnsName,
    pppoeEnabled: port.pppoe_enabled,
    pppoeFolderPath: port.pppoe_folder_path ?? "",
    pppoeDnsName: port.pppoe_dns_name ?? defaults.pppoeDnsName,
    bridgeName: port.bridge_name ?? defaults.bridgeName,
    subnetRange: port.subnet_range ?? defaults.subnetRange,
    bandwidthCapMbps: String(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps ?? 30),
  };
}

function defaultDraft(): Draft {
  return {
    hotspotEnabled: true,
    hotspotFolderPath: "",
    hotspotDnsName: "",
    pppoeEnabled: false,
    pppoeFolderPath: "",
    pppoeDnsName: "",
    bridgeName: "",
    subnetRange: "",
    bandwidthCapMbps: "30",
  };
}

function statusColor(status: string): string {
  if (status === "active" || status === "completed") return "#15803d";
  if (status === "failed" || status === "error") return "#b91c1c";
  if (status === "pending" || status === "provisioning") return "#b45309";
  return "var(--isp-text-muted)";
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <span style={{ color: "var(--isp-text-muted)", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
      {hint ? <span style={{ ...muted, fontSize: 11 }}>{hint}</span> : null}
    </label>
  );
}

export default function Multiport() {
  const [mode, setMode] = useState<Mode>("multiport");
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [routerId, setRouterId] = useState("");
  const [assignments, setAssignments] = useState<PortAssignment[]>([]);
  const [portOptions, setPortOptions] = useState<PortOption[]>([]);
  const [selectedPortKey, setSelectedPortKey] = useState("");
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [loading, setLoading] = useState(true);
  const [portsLoading, setPortsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedAssignment = useMemo(() => {
    if (!selectedPortKey.startsWith("assigned:")) return null;
    return assignments.find((port) => String(port.id) === selectedPortKey.slice("assigned:".length)) ?? null;
  }, [assignments, selectedPortKey]);

  const selectedNewPort = useMemo(() => {
    if (!selectedPortKey.startsWith("new:")) return null;
    return portOptions.find((port) => port.name === selectedPortKey.slice("new:".length)) ?? null;
  }, [portOptions, selectedPortKey]);
  const selectedRouter = useMemo(
    () => routers.find((router) => String(router.id) === routerId) ?? null,
    [routerId, routers],
  );

  const loadRouters = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiJson<RouterOption[] | { routers?: RouterOption[] }>(`/api/routers?adminId=${ADMIN_ID}`);
      const rows = routerRows(payload);
      setRouters(rows);
      if (!routerId && rows[0]) setRouterId(String(rows[0].id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load routers.");
    } finally {
      setLoading(false);
    }
  };

  const loadPorts = async (id: string) => {
    if (!id) {
      setAssignments([]);
      setPortOptions([]);
      setSelectedPortKey("");
      return;
    }
    setPortsLoading(true);
    setError("");
    try {
      const [serviceResult, optionResult] = await Promise.allSettled([
        apiJson<{ ok: boolean; ports: PortAssignment[] }>(`/api/admin/port-services?routerId=${encodeURIComponent(id)}`),
        apiJson<{ ok: boolean; interfaces: PortOption[] }>(`/api/admin/resellers/port-options?routerId=${encodeURIComponent(id)}`),
      ]);
      if (serviceResult.status === "rejected") throw serviceResult.reason;
      setAssignments(serviceResult.value.ports ?? []);
      if (optionResult.status === "fulfilled") {
        setPortOptions(optionResult.value.interfaces ?? []);
      } else {
        setPortOptions([]);
        setError(optionResult.reason instanceof Error
          ? `Existing assignments loaded, but unassigned ports could not be inspected: ${optionResult.reason.message}`
          : "Existing assignments loaded, but unassigned ports could not be inspected.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to inspect the router ports.");
    } finally {
      setPortsLoading(false);
    }
  };

  useEffect(() => { void loadRouters(); }, []);
  useEffect(() => { void loadPorts(routerId); }, [routerId]);

  useEffect(() => {
    if (selectedPortKey) {
      const assignment = assignments.find((port) => `assigned:${port.id}` === selectedPortKey);
      if (assignment && selectedRouter) {
        setDraft(draftFromAssignment(assignment, selectedRouter, assignments));
        return;
      }
      const option = portOptions.find((port) => `new:${port.name}` === selectedPortKey);
      if (option && selectedRouter) {
        setDraft(autoDraftForPort(selectedRouter, option, assignments));
        return;
      }
    }
    const firstAssignment = assignments[0];
    const firstOption = portOptions[0];
    if (firstAssignment) setSelectedPortKey(`assigned:${firstAssignment.id}`);
    else if (firstOption) setSelectedPortKey(`new:${firstOption.name}`);
    else setSelectedPortKey("");
  }, [assignments, portOptions, selectedPortKey, selectedRouter]);

  const allPortChoices = useMemo(() => [
    ...assignments.map((port) => ({ key: `assigned:${port.id}`, label: `${port.interface_name} · assigned`, assigned: true })),
    ...portOptions
      .filter((option) => !assignments.some((port) => port.interface_name === option.name))
      .map((option) => ({ key: `new:${option.name}`, label: `${option.name} · ${option.type}${option.running ? " · running" : ""}`, assigned: false })),
  ], [assignments, portOptions]);

  const setDraftValue = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (mode !== "multiport") {
      setSuccess("Normal shared service selected. Use Hotspot and PPPoE Settings to manage the shared service.");
      return;
    }
    if (!routerId || (!selectedAssignment && !selectedNewPort)) {
      setError("Choose a router and physical port first.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        routerId: Number(routerId),
        interfaceName: selectedNewPort?.name,
        hotspotEnabled: draft.hotspotEnabled,
        hotspotFolderPath: draft.hotspotFolderPath,
         hotspotDnsName: draft.hotspotDnsName,
        pppoeEnabled: draft.pppoeEnabled,
        pppoeFolderPath: draft.pppoeFolderPath,
         pppoeDnsName: draft.pppoeDnsName,
        bridgeName: draft.bridgeName,
        subnetRange: draft.subnetRange,
        bandwidthCapMbps: Number(draft.bandwidthCapMbps),
      };
      const result = selectedAssignment
        ? await apiJson<{ ok: boolean; port: PortAssignment }>(`/api/admin/port-services/${selectedAssignment.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiJson<{ ok: boolean; port: PortAssignment }>("/api/admin/port-services", { method: "POST", body: JSON.stringify(payload) });
      const savedPortId = result.port?.id ?? selectedAssignment?.id;
      const savedPortName = result.port?.interface_name ?? selectedNewPort?.name ?? selectedAssignment?.interface_name ?? "port";
      let deploymentError = "";
      if (savedPortId && (draft.hotspotEnabled || draft.pppoeEnabled)) {
        try {
          await apiJson(`/api/admin/port-services/${savedPortId}/deploy`, { method: "POST", body: JSON.stringify({}) });
        } catch (cause) {
          deploymentError = cause instanceof Error ? cause.message : "Router deployment failed.";
        }
      }
      await loadPorts(routerId);
      if (savedPortId) setSelectedPortKey(`assigned:${savedPortId}`);
      if (deploymentError) {
        setError(`Saved ${savedPortName}, but the router deployment failed: ${deploymentError}`);
      } else if (draft.hotspotEnabled || draft.pppoeEnabled) {
        setSuccess(`Saved and deployed ${savedPortName} service configuration.`);
      } else {
        setSuccess(`Saved ${savedPortName} service configuration. Deployment was skipped because both services are disabled.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the port service.");
    } finally {
      setSaving(false);
    }
  };

  const deploy = async () => {
    if (!selectedAssignment) {
      setError("Save the port assignment before deploying it.");
      return;
    }
    setError("");
    setSuccess("");
    setDeploying(true);
    try {
      await apiJson(`/api/admin/port-services/${selectedAssignment.id}/deploy`, { method: "POST", body: JSON.stringify({}) });
      setSuccess(`${selectedAssignment.interface_name} was deployed to the router.`);
      await loadPorts(routerId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deployment failed.");
    } finally {
      setDeploying(false);
    }
  };

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1200, display: "flex", flexDirection: "column", gap: 16 }}>
        <NetworkTabs active="multiport" />
        <header>
          <div style={{ color: "var(--isp-accent)", fontSize: 11, fontWeight: 900, letterSpacing: ".12em" }}>NETWORK SERVICE MODE</div>
          <h1 style={{ margin: "6px 0 5px", color: "var(--isp-text)", fontSize: "1.5rem", fontWeight: 850 }}>Multiport services</h1>
          <p style={{ ...muted, margin: 0, maxWidth: 780 }}>
            Choose the existing shared Hotspot/PPPoE service or give individual physical router ports their own isolated service identity, network, portal assets, and bandwidth ceiling.
          </p>
        </header>

        {error || success ? (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", borderRadius: 10, padding: "11px 13px", background: error ? "rgba(220,38,38,.08)" : "rgba(22,163,74,.08)", color: error ? "#b91c1c" : "#15803d", fontSize: 13 }}>
            {error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <span>{error || success}</span>
          </div>
        ) : null}

        <section style={{ ...panel, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <ShieldCheck size={19} color="var(--isp-accent)" />
            <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Choose how this ISP serves customers</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
            {([
              ["shared", "Normal shared service", "Keep the current shared Hotspot and PPPoE service. Manage its common settings from the existing Hotspot Settings and PPPoE Settings pages."],
              ["multiport", "Multiport isolated service", "Assign physical ports one at a time. Each selected port gets its own bridge, private /24, service names, portal folders, queues, NAT, and walled garden."],
            ] as const).map(([value, title, description]) => (
              <button key={value} type="button" onClick={() => setMode(value)} style={{ textAlign: "left", borderRadius: 10, padding: 14, cursor: "pointer", border: mode === value ? "2px solid var(--isp-accent)" : "1px solid var(--isp-border)", background: mode === value ? "rgba(37,99,235,.08)" : "var(--isp-section)", color: "var(--isp-text)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 850 }}>
                  {value === "shared" ? <Wifi size={17} /> : <Layers3 size={17} />}
                  {title}
                </div>
                <div style={{ ...muted, marginTop: 7 }}>{description}</div>
              </button>
            ))}
          </div>
        </section>

        {mode === "shared" ? (
          <section style={{ ...panel, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Wifi size={21} color="var(--isp-accent)" />
            <div>
              <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Shared mode is unchanged</div>
              <p style={{ ...muted, margin: "5px 0 0" }}>No isolated port assignment is changed while Normal shared service is selected. Continue using the shared Hotspot and PPPoE configuration pages for that mode.</p>
            </div>
          </section>
        ) : (
          <>
            <section style={{ ...panel, display: "grid", gridTemplateColumns: "minmax(220px,.7fr) minmax(260px,1fr) auto", gap: 12, alignItems: "end" }}>
              <Field label="Connected router">
                <select style={input} value={routerId} onChange={(event) => { setRouterId(event.target.value); setSelectedPortKey(""); }} disabled={loading}>
                  <option value="">Choose router</option>
                  {routers.map((router) => <option key={router.id} value={router.id}>{router.name}{router.status ? ` · ${router.status}` : ""}</option>)}
                </select>
              </Field>
              <Field label={portsLoading ? "Physical port (loading…)" : "Physical port"} hint="Assigned ports are editable; unassigned ports are available for a new isolated service.">
                <select style={input} value={selectedPortKey} onChange={(event) => setSelectedPortKey(event.target.value)} disabled={portsLoading || !routerId}>
                  <option value="">Choose a physical port</option>
                  {allPortChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
                </select>
              </Field>
              <button type="button" onClick={() => void loadPorts(routerId)} disabled={portsLoading || !routerId} style={{ minHeight: 40, border: "1px solid var(--isp-border)", borderRadius: 8, background: "transparent", color: "var(--isp-text)", cursor: "pointer", padding: "0 13px", display: "inline-flex", alignItems: "center", gap: 7 }}>
                <RefreshCw size={15} /> Refresh
              </button>
            </section>

            <form onSubmit={save} style={{ ...panel, display: "grid", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 850 }}><EthernetPort size={18} color="var(--isp-accent)" /> Isolated port configuration</div>
                  <p style={{ ...muted, margin: "5px 0 0" }}>
                    {selectedNewPort
                      ? "Defaults were generated from this router and physical port. Review or change any field before saving and deploying."
                      : "Enable one or both services. The API validates the asset paths and keeps router credentials server-side."}
                  </p>
                </div>
                {selectedAssignment ? <span style={{ color: statusColor(selectedAssignment.status), fontSize: 12, fontWeight: 850 }}>{selectedAssignment.status}</span> : null}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
                <Field label="Service / bridge name" hint="Generated per physical port; you can rename it before saving.">
                  <input style={input} value={draft.bridgeName} onChange={(event) => setDraftValue("bridgeName", event.target.value)} placeholder="router-bridge-ether2" />
                </Field>
                <Field label="Private service subnet" hint="Generated from the next available isolated range. Must remain a private .0/24.">
                  <input style={input} value={draft.subnetRange} onChange={(event) => setDraftValue("subnetRange", event.target.value)} placeholder="10.250.12.0/24" />
                </Field>
                <Field label="Bandwidth ceiling (Mbps)" hint="Applied to the isolated parent queue.">
                  <input required min="1" max="100000" type="number" style={input} value={draft.bandwidthCapMbps} onChange={(event) => setDraftValue("bandwidthCapMbps", event.target.value)} />
                </Field>
                <div style={{ display: "flex", gap: 18, alignItems: "center", paddingTop: 19 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--isp-text)", fontSize: 13 }}><input type="checkbox" checked={draft.hotspotEnabled} onChange={(event) => setDraftValue("hotspotEnabled", event.target.checked)} /> Hotspot sign-in</label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--isp-text)", fontSize: 13 }}><input type="checkbox" checked={draft.pppoeEnabled} onChange={(event) => setDraftValue("pppoeEnabled", event.target.checked)} /> PPPoE service</label>
                </div>
                <Field label="Hotspot portal asset" hint="Defaults to the approved login.html asset; replace it with another approved asset if needed.">
                  <input style={input} value={draft.hotspotFolderPath} onChange={(event) => setDraftValue("hotspotFolderPath", event.target.value)} placeholder="login.html" disabled={!draft.hotspotEnabled} />
                </Field>
                <Field label="Hotspot name / DNS" hint="Generated from the router and port; replace it with your public hostname if needed.">
                  <input style={input} value={draft.hotspotDnsName} onChange={(event) => setDraftValue("hotspotDnsName", event.target.value)} placeholder="hotspot-router-ether2.lan" disabled={!draft.hotspotEnabled} />
                </Field>
                <Field label="PPPoE landing asset" hint="Defaults to the approved login.html asset; PPPoE uses a landing/status page, not a captive Hotspot login.">
                  <input style={input} value={draft.pppoeFolderPath} onChange={(event) => setDraftValue("pppoeFolderPath", event.target.value)} placeholder="login.html" disabled={!draft.pppoeEnabled} />
                </Field>
                <Field label="PPPoE name / DNS" hint="Generated from the router and port; replace it with your public hostname if needed.">
                  <input style={input} value={draft.pppoeDnsName} onChange={(event) => setDraftValue("pppoeDnsName", event.target.value)} placeholder="pppoe-router-ether2.lan" disabled={!draft.pppoeEnabled} />
                </Field>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="submit" disabled={saving || portsLoading || !selectedPortKey} style={{ border: 0, borderRadius: 9, minHeight: 41, padding: "0 16px", color: "#fff", background: "var(--isp-accent)", fontWeight: 850, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {saving ? "Saving…" : selectedAssignment ? "Save configuration" : "Assign & save port"}
                </button>
                <button type="button" onClick={() => void deploy()} disabled={deploying || saving || !selectedAssignment} style={{ border: "1px solid var(--isp-border)", borderRadius: 9, minHeight: 41, padding: "0 16px", color: "var(--isp-text)", background: "transparent", fontWeight: 850, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {deploying ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} {deploying ? "Deploying…" : "Deploy to router"}
                </button>
              </div>
            </form>

            <section style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Port service status</div>
                  <div style={{ ...muted, marginTop: 3 }}>Each row shows the persisted service identity and the last deployment error, if any.</div>
                </div>
                <span style={{ ...muted, whiteSpace: "nowrap" }}>{assignments.length} assigned</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="isp-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>{["Port", "Services", "Network", "Bandwidth", "Status", "Deployment error"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "9px 8px", color: "var(--isp-text-muted)", borderBottom: "1px solid var(--isp-border)" }}>{heading}</th>)}</tr></thead>
                  <tbody>
                    {assignments.map((port) => (
                      <tr key={port.id} onClick={() => setSelectedPortKey(`assigned:${port.id}`)} style={{ cursor: "pointer", background: selectedAssignment?.id === port.id ? "rgba(37,99,235,.06)" : "transparent" }}>
                        <td style={{ padding: "10px 8px", color: "var(--isp-text)", fontWeight: 750 }}>{port.interface_name}<div style={{ ...muted, fontSize: 11 }}>{port.bridge_name || "bridge generated on deploy"}</div></td>
                        <td style={{ padding: "10px 8px", color: "var(--isp-text-muted)" }}>{[port.hotspot_enabled ? "Hotspot" : "", port.pppoe_enabled ? "PPPoE" : ""].filter(Boolean).join(" + ") || "Disabled"}</td>
                        <td style={{ padding: "10px 8px", color: "var(--isp-text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{port.subnet_range || "generated /24"}</td>
                        <td style={{ padding: "10px 8px", color: "var(--isp-text)", whiteSpace: "nowrap" }}>{port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps} Mbps</td>
                        <td style={{ padding: "10px 8px", color: statusColor(port.status), fontWeight: 750 }}>{port.status}</td>
                        <td style={{ padding: "10px 8px", color: port.provisioning_error ? "#b91c1c" : "var(--isp-text-muted)", maxWidth: 300 }}>{port.provisioning_error || "—"}</td>
                      </tr>
                    ))}
                    {!assignments.length ? <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--isp-text-muted)" }}>{routerId ? "No isolated ports assigned on this router yet." : "Choose a router to view port services."}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}