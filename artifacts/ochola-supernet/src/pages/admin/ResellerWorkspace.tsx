import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Banknote, CheckCircle2, Copy, Gauge, LockKeyhole, PauseCircle, PlayCircle, Plus, ReceiptText, RefreshCw, Router as RouterIcon, ShieldCheck, Users, WalletCards } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID, getAdminApiToken, getAdminRole } from "@/lib/supabase";
import { NetworkTabs } from "./network/NetworkTabs";

type RouterOption = { id: number; name: string; status?: string };
type PortOption = { name: string; type: string; running: boolean; assigned: boolean; macAddress?: string };
type Reseller = { id: number; name: string; company_name?: string; username: string; email?: string; is_active: boolean; created_at: string };
type ConnectionRequest = { id: number; reseller_id: number; note?: string | null; status: "pending" | "approved" | "rejected"; created_at: string; updated_at: string };
type Assignment = {
  id: number; reseller_id?: number; router_id: number; interface_name: string; bridge_name?: string | null;
  assigned_reseller_id?: number | null; vlan_tag?: string | null; hotspot_enabled: boolean; pppoe_enabled: boolean; subnet_range?: string | null;
  bandwidth_cap_mbps: number; reseller_bandwidth_cap?: number | null; status: string; link_status?: "pending" | "active" | "suspended" | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null; handoff_type?: "physical" | "vlan" | null;
  xpon_identifier?: string | null; link_detected?: boolean | null; last_link_checked_at?: string | null;
  link_detection_error?: string | null;
  provisioning_error?: string | null; link_provisioning_error?: string | null;
  router?: { id: number; name: string; status: string } | null;
};
type Sale = { id: number; reseller_port_id: number; client_reference: string; client_ip: string; amount: number; gateway_type: string; payment_reference: string; status: string; created_at: string };
type ResellerResponse = {
  ok: boolean;
  account: { name: string; company_name?: string; username: string } | null;
  ports: Assignment[];
  gateways: { gateway_type: string; is_active: boolean }[];
  sales: Sale[];
  metrics?: {
    revenue: { incomeToday: number; incomeMonth: number; totalRevenue: number; totalTransactions: number };
    users: { total: number; active: number; expired: number; hotspot: number; pppoe: number; static: number };
    analytics: {
      registeredCustomersByMonth: { month: string; label: string; count: number }[];
      consumptionByMonth: { month: string; label: string; dataUsedMb: number }[];
      topConsumers: { id: number; name: string; type: string; dataUsedMb: number }[];
    };
  };
  error?: string;
};
type ResellerPaymentSettings = {
  paymentGateway: string;
  mpesa: { enabled: boolean; merchantIdentifier: string; accountReference: string; destinationType: "till" | "paybill" };
  bank: { enabled: boolean; merchantIdentifier: string; accountReference: string; bankName: string };
};
type ResellerTelemetry = {
  totals: { hotspotActive: number; pppoeActive: number; onlineUsers: number };
};
function authHeaders(): HeadersInit {
  const token = getAdminApiToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function money(value: unknown): string {
  return `KES ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const cardStyle: React.CSSProperties = {
  background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, padding: 16,
  boxShadow: "var(--shadow-sm)",
};

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 38, border: "1px solid var(--isp-input-border)", borderRadius: 6, padding: "8px 10px",
  background: "var(--isp-input-bg)", color: "var(--isp-text)", font: "inherit", fontSize: 13, boxSizing: "border-box",
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="reseller-field" style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--isp-text-muted)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}{children}</label>;
}

function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", borderRadius: 10, padding: "11px 13px", background: error ? "rgba(220,38,38,.08)" : "rgba(22,163,74,.08)", color: error ? "#b91c1c" : "#15803d", fontSize: 13 }}>
      {error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      <span>{error || success}</span>
    </div>
  );
}

function statusClass(status?: string): string {
  if (status === "active" || status === "completed" || status === "running") return "isp-badge-green";
  if (status === "failed" || status === "error" || status === "suspended") return "isp-badge-red";
  if (status === "pending" || status === "provisioning") return "isp-badge-amber";
  return "isp-badge-gray";
}

function StatusBadge({ status }: { status?: string }) {
  const normalized = status || "pending";
  return <span className={`isp-badge ${statusClass(normalized)}`}>{normalized}</span>;
}

function AdminResellerManagement() {
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [portOptions, setPortOptions] = useState<PortOption[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>([]);
  const [requestResellers, setRequestResellers] = useState<Reseller[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [routerId, setRouterId] = useState("");
  const [form, setForm] = useState({
    name: "", companyName: "", username: "", email: "", phone: "", password: "",
    interfaceName: "", bandwidthCapMbps: "30", bridgeName: "", subnetRange: "",
    hotspotTemplatePath: "", pppoeFolderPath: "",
    hotspotEnabled: true, pppoeEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [portsLoading, setPortsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkSaving, setLinkSaving] = useState<number | null>(null);
  const [linkCapDraft, setLinkCapDraft] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [requestBusy, setRequestBusy] = useState<number | null>(null);
  const [handoffRequestId, setHandoffRequestId] = useState<number | null>(null);
  const [handoffRouterId, setHandoffRouterId] = useState("");
  const [handoffType, setHandoffType] = useState<"physical" | "vlan">("physical");
  const [handoffMode, setHandoffMode] = useState<"isp_router" | "vlan_services">("isp_router");
  const [handoffInterfaceName, setHandoffInterfaceName] = useState("");
  const [handoffVlanTag, setHandoffVlanTag] = useState("");
  const [handoffVlanName, setHandoffVlanName] = useState("");
  const [xponIdentifier, setXponIdentifier] = useState("");
  const [handoffCap, setHandoffCap] = useState("30");
  const [handoffPorts, setHandoffPorts] = useState<PortOption[]>([]);
  const [handoffPortsLoading, setHandoffPortsLoading] = useState(false);
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffScriptSaving, setHandoffScriptSaving] = useState(false);
  const [linkChecking, setLinkChecking] = useState<number | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    companyName: string;
    username: string;
    email: string;
    phone: string;
    password: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [routerResult, resellerResult, connectionResult] = await Promise.all([
        apiJson<RouterOption[]>(`/api/routers?adminId=${ADMIN_ID}`),
        apiJson<{ ok: boolean; resellers: Reseller[]; ports: Assignment[] }>("/api/admin/resellers"),
        apiJson<{ ok: boolean; requests: ConnectionRequest[]; resellers: Reseller[] }>("/api/isp/reseller-connection-requests")
          .catch(() => ({ ok: true, requests: [], resellers: [] })),
      ]);
       setRouters(routerResult ?? []);
      setResellers(resellerResult.resellers ?? []);
      setConnectionRequests(connectionResult.requests ?? []);
      setRequestResellers(connectionResult.resellers ?? []);
      setAssignments(resellerResult.ports ?? []);
       if (!routerId && routerResult?.[0]) setRouterId(String(routerResult[0].id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load reseller management.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!routerId) { setPortOptions([]); return; }
    setPortsLoading(true);
    void apiJson<{ ok: boolean; interfaces: PortOption[] }>(`/api/admin/resellers/port-options?routerId=${routerId}`)
      .then((result) => setPortOptions(result.interfaces ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to inspect router ports."))
      .finally(() => setPortsLoading(false));
  }, [routerId]);

  useEffect(() => {
    if (!handoffRouterId || !handoffRequestId) {
      setHandoffPorts([]);
      return;
    }
    setHandoffPortsLoading(true);
    void apiJson<{ ok: boolean; interfaces: PortOption[] }>(`/api/admin/resellers/port-options?routerId=${handoffRouterId}&handoffType=${handoffType}`)
      .then((result) => setHandoffPorts(result.interfaces ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to inspect XPON handoff ports."))
      .finally(() => setHandoffPortsLoading(false));
  }, [handoffRouterId, handoffType, handoffRequestId]);

  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setSubmitting(true);
    const submittedCredentials = { companyName: form.companyName || form.name, username: form.username, email: form.email, phone: form.phone, password: form.password };
    try {
      await apiJson("/api/admin/resellers", { method: "POST", body: JSON.stringify({ ...form, routerId: Number(routerId) }) });
      setCreatedCredentials(submittedCredentials);
      setSuccess("Reseller account created and the physical port was provisioned.");
       setForm((current) => ({ ...current, name: "", companyName: "", username: "", email: "", phone: "", password: "", interfaceName: "", hotspotTemplatePath: "", pppoeFolderPath: "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Provisioning failed."); }
    finally { setSubmitting(false); }
  };
  const respondToConnectionRequest = async (requestId: number, action: "approve" | "reject") => {
    setRequestBusy(requestId); setError(""); setSuccess("");
    try {
      const result = await apiJson<{ message?: string }>(`/api/isp/reseller-connection-requests/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setSuccess(result.message || (action === "approve" ? "Reseller connection approved." : "Reseller connection request rejected."));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update the connection request.");
    } finally { setRequestBusy(null); }
  };
  const copyCredential = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setSuccess("Credential copied to the clipboard.");
  };
  const provisionHandoff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!handoffRequestId) return;
    setHandoffSaving(true); setError(""); setSuccess("");
    try {
      const result = await apiJson<{ message?: string }>(`/api/isp/reseller-connection-requests/${handoffRequestId}/handoff`, {
        method: "POST",
        body: JSON.stringify({
          routerId: Number(handoffRouterId),
          ...(handoffMode === "vlan_services"
            ? { bridgeName: handoffInterfaceName }
            : { interfaceName: handoffInterfaceName }),
          handoffType,
          handoffMode,
          vlanTag: handoffType === "vlan" ? handoffVlanTag : undefined,
          xponIdentifier,
          bandwidthCapMbps: Number(handoffCap),
        }),
      });
      setSuccess(result.message || "ISP router handoff assigned.");
      setHandoffRequestId(null);
      setHandoffInterfaceName("");
      setHandoffVlanTag("");
      setHandoffVlanName("");
      setXponIdentifier("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign the ISP router handoff.");
    } finally { setHandoffSaving(false); }
  };
  const downloadVlanScript = async (portId: number) => {
    setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/admin/reseller-handoffs/${portId}/vlan-script`, { headers: authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Unable to generate the VLAN interface script.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reseller-vlan-${portId}.rsc`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSuccess("VLAN interface script downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download the VLAN interface script.");
    }
  };
  const generateVlanScript = async () => {
    if (!handoffRequestId) return;
    setHandoffScriptSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/isp/reseller-connection-requests/${handoffRequestId}/vlan-script`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          routerId: Number(handoffRouterId),
          bridgeName: handoffInterfaceName,
          vlanTag: handoffVlanTag,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Unable to generate the VLAN interface script.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reseller-vlan-${handoffVlanTag}.rsc`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSuccess("VLAN interface script downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate the VLAN interface script.");
    } finally { setHandoffScriptSaving(false); }
  };
  const checkHandoffLink = async (portId: number) => {
    setLinkChecking(portId); setError(""); setSuccess("");
    try {
      const result = await apiJson<{ link: { detected: boolean; interfaceName: string; error?: string | null } }>(`/api/admin/reseller-handoffs/${portId}/link`);
      setSuccess(result.link.detected
        ? `${result.link.interfaceName}: XPON Ethernet link detected.`
        : `${result.link.interfaceName}: no XPON Ethernet link detected yet${result.link.error ? ` — ${result.link.error}` : "."}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check the XPON link.");
    } finally { setLinkChecking(null); }
  };
  const updateLink = async (port: Assignment, linkStatus: "active" | "suspended") => {
    const resellerId = port.assigned_reseller_id ?? port.reseller_id;
    if (!resellerId) {
      setError("This ISP-owned port has no assigned reseller link.");
      return;
    }
    setError(""); setSuccess(""); setLinkSaving(port.id);
    try {
      await apiJson("/api/admin/reseller-links", {
        method: "POST",
        body: JSON.stringify({
          resellerId,
          targetPortName: port.interface_name,
          maxBandwidthCap: Number(linkCapDraft[port.id] || port.reseller_bandwidth_cap || port.bandwidth_cap_mbps),
          linkStatus,
        }),
      });
      setSuccess(`${port.interface_name} wholesale link ${linkStatus === "active" ? "activated" : "suspended"} and RouterOS services updated.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update the wholesale link.");
    } finally { setLinkSaving(null); }
  };
  const retryVlanPush = async (portId: number) => {
    setLinkSaving(portId); setError(""); setSuccess("");
    try {
      const result = await apiJson<{ message?: string }>(`/api/admin/reseller-handoffs/${portId}/push`, { method: "POST" });
      setSuccess(result.message || "VLAN service pushed to the MikroTik.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to push the VLAN service to the MikroTik.");
    } finally { setLinkSaving(null); }
  };

  return (
    <AdminLayout>
      <NetworkTabs active="resellers" />
      <div className="reseller-workspace reseller-admin">
        <div className="reseller-page-header">
          <div className="reseller-eyebrow">RESELLER OPERATIONS</div>
          <h1>Reseller port provisioning</h1>
           <p>Create scoped reseller accounts and assign either a passive XPON handoff or an ISP-controlled VLAN service.</p>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
        <Notice error={error} success={success} />
        {createdCredentials && (
          <section style={{ ...cardStyle, borderColor: "rgba(34,197,94,.35)", background: "linear-gradient(135deg, rgba(34,197,94,.08), var(--isp-card) 62%)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#15803d", fontWeight: 850 }}><ShieldCheck size={18} /> Reseller credentials ready</div>
                <p style={{ margin: "7px 0 0", color: "var(--isp-text-muted)", fontSize: 13 }}>Share these credentials securely. The password is shown here only because it was just created and cannot be recovered later.</p>
              </div>
              <button type="button" onClick={() => setCreatedCredentials(null)} style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: "7px 10px", background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer", fontSize: 12 }}>Hide credentials</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 16 }}>
              {[
                ["Business", createdCredentials.companyName],
                ["Username", createdCredentials.username],
                ["Email", createdCredentials.email || "Not provided"],
                ["Phone", createdCredentials.phone || "Not provided"],
                ["Initial password", createdCredentials.password],
              ].map(([label, value]) => <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 11px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-input-bg)" }}>
                <div><div style={{ color: "var(--isp-text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div><code style={{ display: "block", marginTop: 4, color: "var(--isp-text)", fontSize: 13 }}>{value}</code></div>
                <button type="button" aria-label={`Copy ${label}`} onClick={() => copyCredential(value)} style={{ border: 0, background: "transparent", color: "var(--isp-accent)", cursor: "pointer", padding: 4 }}><Copy size={15} /></button>
              </div>)}
            </div>
          </section>
        )}
        <a href="/admin/network/carrier-controls" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", alignSelf: "start", width: "fit-content", padding: "10px 13px", borderRadius: 9, background: "var(--isp-accent)", color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 800 }}>
          Open carrier link approvals
        </a>
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div><div style={{ fontWeight: 850, color: "var(--isp-text)" }}>Incoming reseller connection requests</div><div style={{ fontSize: 13, color: "var(--isp-text-muted)", marginTop: 4 }}>Approve an account connection before assigning a physical port or enabling wholesale traffic.</div></div>
            <span className="isp-badge isp-badge-amber">{connectionRequests.filter((request) => request.status === "pending").length} pending</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {connectionRequests.map((request) => {
              const reseller = requestResellers.find((candidate) => candidate.id === request.reseller_id);
              const assignment = assignments.find((candidate) => (candidate.assigned_reseller_id ?? candidate.reseller_id) === request.reseller_id);
              const busy = requestBusy === request.id;
              return <div key={request.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 13px", border: "1px solid var(--isp-border)", borderRadius: 9 }}>
                <div>
                  <div style={{ color: "var(--isp-text)", fontWeight: 800 }}>{reseller?.company_name || reseller?.name || `Reseller #${request.reseller_id}`}</div>
                  <div style={{ color: "var(--isp-text-muted)", fontSize: 12, marginTop: 4 }}>@{reseller?.username || "unknown"} · {reseller?.email || "No email"} · Requested {new Date(request.created_at).toLocaleString()}</div>
                  {request.note && <div style={{ color: "var(--isp-text)", fontSize: 12, marginTop: 7 }}>“{request.note}”</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`isp-badge ${request.status === "approved" ? "isp-badge-green" : request.status === "rejected" ? "isp-badge-red" : "isp-badge-amber"}`}>{request.status}</span>
                  {request.status === "pending" && <><button type="button" disabled={busy} onClick={() => void respondToConnectionRequest(request.id, "approve")} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "#16a34a", color: "#fff", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Approve"}</button><button type="button" disabled={busy} onClick={() => void respondToConnectionRequest(request.id, "reject")} style={{ border: "1px solid rgba(220,38,38,.25)", borderRadius: 8, padding: "8px 10px", background: "rgba(239,68,68,.08)", color: "#b91c1c", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>Reject</button></>}
                  {request.status === "approved" && (assignment?.handoff_mode === "isp_router" || assignment?.handoff_mode === "vlan_services" ? <span style={{ color: "#15803d", fontSize: 12, fontWeight: 800 }}>{assignment.handoff_mode === "vlan_services" ? "VLAN services assigned" : "Handoff assigned"}</span> : <button type="button" onClick={() => { const candidate = requestResellers.find((item) => item.id === request.reseller_id); setHandoffRequestId(request.id); setHandoffRouterId(routerId || String(routers[0]?.id || "")); setHandoffType("physical"); setHandoffMode("isp_router"); setHandoffVlanName(candidate?.username || ""); setHandoffCap("30"); }} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "var(--isp-accent)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Assign ISP service</button>)}
                </div>
              </div>;
            })}
            {!connectionRequests.length && <div style={{ padding: 22, textAlign: "center", color: "var(--isp-text-muted)", fontSize: 13 }}>No reseller connection requests yet.</div>}
          </div>
        </section>
        {handoffRequestId && (
          <form onSubmit={provisionHandoff} style={{ ...cardStyle, borderColor: "rgba(37,99,235,.35)", background: "linear-gradient(135deg, rgba(37,99,235,.08), var(--isp-card) 62%)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                 <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-accent)", fontWeight: 850 }}><RouterIcon size={18} /> {handoffMode === "vlan_services" ? "Create reseller VLAN service" : "Assign ISP router / XPON internet handoff"}</div>
                <p style={{ margin: "7px 0 0", color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                   {handoffMode === "vlan_services"
                     ? "This pushes the VLAN interface, Hotspot, and PPPoE service directly to the selected MikroTik. The VLAN interface name is the reseller username; a script remains available only as a manual fallback."
                     : "This does not install MikroTik packages or configure the reseller account. The selected ISP router interface supplies the reseller&apos;s internet; connect the XPON router to the assigned port."}
                </p>
              </div>
              <button type="button" onClick={() => setHandoffRequestId(null)} style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: "7px 10px", background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer", fontSize: 12 }}>Cancel</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 13, marginTop: 16 }}>
              <Field label="Service mode">
                <select required style={inputStyle} value={handoffMode} onChange={(event) => { const value = event.target.value === "vlan_services" ? "vlan_services" : "isp_router"; setHandoffMode(value); setHandoffType(value === "vlan_services" ? "vlan" : "physical"); setHandoffInterfaceName(""); }}>
                  <option value="isp_router">Passive XPON handoff</option>
                  <option value="vlan_services">VLAN Hotspot + PPPoE service</option>
                </select>
              </Field>
              <Field label="ISP router">
                <select required style={inputStyle} value={handoffRouterId} onChange={(event) => { setHandoffRouterId(event.target.value); setHandoffInterfaceName(""); }}>
                  <option value="">Choose router</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}{router.status ? ` · ${router.status}` : ""}</option>)}
                </select>
              </Field>
              <Field label={handoffMode === "vlan_services" ? "ISP Hotspot bridge" : "Handoff type"}>
                {handoffMode === "vlan_services" ? <select required style={inputStyle} value={handoffInterfaceName} onChange={(event) => setHandoffInterfaceName(event.target.value)} disabled={!handoffRouterId || handoffPortsLoading}>
                  <option value="">Choose Hotspot bridge</option>{handoffPorts.filter((port) => port.type.toLowerCase() === "bridge").map((port) => <option key={port.name} value={port.name}>{port.name}{port.running ? " · running" : ""}</option>)}
                </select> : <select required style={inputStyle} value={handoffType} onChange={(event) => { const value = event.target.value === "vlan" ? "vlan" : "physical"; setHandoffType(value); setHandoffInterfaceName(""); }}>
                  <option value="physical">Physical XPON port</option>
                  <option value="vlan">Tagged VLAN handoff</option>
                </select>}
              </Field>
              {handoffMode === "isp_router" && <Field label={handoffPortsLoading ? "XPON-facing interface (loading…)" : "XPON-facing interface"}>
                <select required style={inputStyle} value={handoffInterfaceName} onChange={(event) => setHandoffInterfaceName(event.target.value)} disabled={!handoffRouterId || handoffPortsLoading}>
                  <option value="">Choose interface</option>{handoffPorts.map((port) => <option key={port.name} value={port.name}>{port.name} · {port.type}{port.running ? " · link detected" : " · no link"}</option>)}
                </select>
              </Field>}
               {handoffMode === "vlan_services" && <Field label="VLAN interface name"><input required readOnly style={{ ...inputStyle, opacity: .8 }} value={handoffVlanName} placeholder="Reseller username" /></Field>}
               {handoffType === "vlan" && <Field label="VLAN ID"><input required min="1" max="4094" type="number" style={inputStyle} value={handoffVlanTag} onChange={(event) => setHandoffVlanTag(event.target.value)} placeholder="e.g. 240" /></Field>}
               {handoffMode === "isp_router" && <Field label="XPON / ONU reference (optional)"><input style={inputStyle} value={xponIdentifier} onChange={(event) => setXponIdentifier(event.target.value)} placeholder="Serial or customer reference" /></Field>}
              <Field label="Bandwidth cap (Mbps)"><input required min="1" max="100000" type="number" style={inputStyle} value={handoffCap} onChange={(event) => setHandoffCap(event.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 13, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,.1)", color: "#92400e", fontSize: 12, lineHeight: 1.5 }}>
               {handoffMode === "vlan_services"
                 ? "The selected MikroTik will receive the VLAN interface, Hotspot, and PPPoE service directly with the locked reseller cap."
                 : "Link detection checks the ISP router&apos;s Ethernet interface. It confirms the XPON router is physically connected; optical registration and internet authentication remain managed by the ISP&apos;s XPON/ISP router equipment."}
            </div>
             <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 15 }}>
               {handoffMode === "vlan_services" && <button disabled={handoffScriptSaving || !handoffRouterId || !handoffInterfaceName || !handoffVlanTag} type="button" onClick={() => void generateVlanScript()} style={{ border: "1px solid var(--isp-accent)", borderRadius: 9, padding: "11px 15px", background: "transparent", color: "var(--isp-accent)", fontWeight: 800, cursor: handoffScriptSaving ? "wait" : "pointer" }}>{handoffScriptSaving ? "Generating…" : "Generate VLAN script"}</button>}
                <button disabled={handoffSaving || !handoffRouterId || !handoffInterfaceName} type="submit" style={{ border: 0, borderRadius: 9, padding: "11px 15px", background: "var(--isp-accent)", color: "#fff", fontWeight: 800, cursor: handoffSaving ? "wait" : "pointer" }}>{handoffSaving ? "Pushing to MikroTik…" : handoffMode === "vlan_services" ? "Push VLAN service to MikroTik" : "Assign internet handoff"}</button>
             </div>
          </form>
        )}
        <div className="reseller-admin-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(300px,.65fr)", gap: 16, alignItems: "start" }}>
          <form onSubmit={submit} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", marginBottom: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-accent)", fontWeight: 800 }}><Users size={18} /> Sub-agent creation</div>
                <p style={{ color: "var(--isp-text-muted)", fontSize: 13, margin: "7px 0 0" }}>The reseller is linked to your ISP tenant and receives no access to other ports or routers.</p>
              </div>
              <ShieldCheck size={25} color="var(--isp-accent)" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
              <Field label="Sub-agent name"><input required style={inputStyle} value={form.name} onChange={(e) => update("name", e.target.value)} /></Field>
              <Field label="Business / company"><input style={inputStyle} value={form.companyName} onChange={(e) => update("companyName", e.target.value)} /></Field>
              <Field label="Username"><input required style={inputStyle} value={form.username} onChange={(e) => update("username", e.target.value)} /></Field>
              <Field label="Email"><input type="email" style={inputStyle} value={form.email} onChange={(e) => update("email", e.target.value)} /></Field>
              <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => update("phone", e.target.value)} /></Field>
              <Field label="Initial password"><input required minLength={10} type="password" style={inputStyle} value={form.password} onChange={(e) => update("password", e.target.value)} /></Field>
            </div>
            <div style={{ borderTop: "1px solid var(--isp-border)", margin: "22px 0", paddingTop: 20 }}>
              <div style={{ color: "var(--isp-text)", fontWeight: 800, marginBottom: 14 }}>Hardware port binding</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
                <Field label="Connected router">
                  <select required style={inputStyle} value={routerId} onChange={(e) => { setRouterId(e.target.value); update("interfaceName", ""); }}>
                    <option value="">Choose router</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name} {router.status ? `· ${router.status}` : ""}</option>)}
                  </select>
                </Field>
                <Field label={portsLoading ? "Physical interface (loading…)" : "Physical interface"}>
                  <select required style={inputStyle} value={form.interfaceName} onChange={(e) => update("interfaceName", e.target.value)} disabled={!routerId || portsLoading}>
                    <option value="">Choose an unassigned port</option>{portOptions.map((port) => <option key={port.name} value={port.name}>{port.name} · {port.type}{port.running ? " · running" : ""}</option>)}
                  </select>
                </Field>
                <Field label="Wholesale bandwidth cap (Mbps)"><input required type="number" min="1" max="100000" style={inputStyle} value={form.bandwidthCapMbps} onChange={(e) => update("bandwidthCapMbps", e.target.value)} /></Field>
                <Field label="Subnet range (optional)"><input placeholder="192.168.30.0/24" style={inputStyle} value={form.subnetRange} onChange={(e) => update("subnetRange", e.target.value)} /></Field>
                <Field label="Bridge name (optional)"><input placeholder="bridge-reseller-1" style={inputStyle} value={form.bridgeName} onChange={(e) => update("bridgeName", e.target.value)} /></Field>
                <Field label="Hotspot page folder (optional)"><input placeholder="hotspot/reseller_port_1" style={inputStyle} value={form.hotspotTemplatePath} onChange={(e) => update("hotspotTemplatePath", e.target.value)} /></Field>
                <Field label="PPPoE landing folder (optional)"><input placeholder="hotspot/pppoe_port_1" style={inputStyle} value={form.pppoeFolderPath} onChange={(e) => update("pppoeFolderPath", e.target.value)} /></Field>
                <div style={{ display: "flex", gap: 18, alignItems: "end", paddingBottom: 10 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--isp-text)" }}><input type="checkbox" checked={form.hotspotEnabled} onChange={(e) => update("hotspotEnabled", e.target.checked)} /> Hotspot</label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--isp-text)" }}><input type="checkbox" checked={form.pppoeEnabled} onChange={(e) => update("pppoeEnabled", e.target.checked)} /> PPPoE</label>
                </div>
              </div>
            </div>
            <button disabled={submitting || loading} type="submit" style={{ border: 0, borderRadius: 10, padding: "12px 17px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Plus size={17} /> {submitting ? "Provisioning…" : "Create sub-agent & provision port"}
            </button>
          </form>

          <div style={{ display: "grid", gap: 16 }}>
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                <div style={{ fontWeight: 800, color: "var(--isp-text)" }}>Provisioning safeguards</div><LockKeyhole size={18} color="var(--isp-accent)" />
              </div>
              {["One physical interface can have one active reseller owner.", "Router credentials stay on the API server.", "A root simple queue is created at the assigned cap.", "Failed RouterOS writes remain visible for retry or review."].map((item) => <div key={item} style={{ display: "flex", gap: 9, fontSize: 13, color: "var(--isp-text-muted)", margin: "12px 0" }}><CheckCircle2 size={16} color="#16a34a" />{item}</div>)}
            </div>
            <div style={{ ...cardStyle, background: "linear-gradient(145deg, var(--isp-accent), #9a3412)", color: "#fff" }}>
              <Gauge size={24} />
              <div style={{ fontSize: 30, fontWeight: 900, marginTop: 14 }}>{assignments.filter((item) => item.status === "active").length}</div>
              <div style={{ opacity: .85, fontSize: 13 }}>active reseller port bindings</div>
            </div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
             <div><div style={{ fontWeight: 800, color: "var(--isp-text)" }}>Resellers and assigned ports</div><div style={{ fontSize: 13, color: "var(--isp-text-muted)", marginTop: 4 }}>Provisioning state is separate from the wholesale payment link. Activate or suspend traffic independently.</div></div>
            <button onClick={() => void load()} style={{ border: "1px solid var(--isp-border)", background: "transparent", color: "var(--isp-text)", borderRadius: 9, padding: 9, cursor: "pointer" }}><RefreshCw size={16} /></button>
          </div>
           <div style={{ overflowX: "auto" }}><table className="isp-table reseller-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Reseller", "Username", "Port", "Cap", "Provisioning", "Wholesale link", "Actions"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "9px 8px", color: "var(--isp-text-muted)", borderBottom: "1px solid var(--isp-border)" }}>{heading}</th>)}</tr></thead><tbody>
             {resellers.map((reseller) => {
               const port = assignments.find((item) => (item.assigned_reseller_id ?? item.reseller_id) === reseller.id);
               const linkStatus = port?.link_status ?? "pending";
               const busy = port ? linkSaving === port.id : false;
               return <tr key={reseller.id}>
                 <td style={{ padding: "10px 8px", color: "var(--isp-text)", fontWeight: 700 }}>{reseller.company_name || reseller.name}</td>
                 <td style={{ padding: "10px 8px", color: "var(--isp-text-muted)" }}>{reseller.username}</td>
                   <td style={{ padding: "10px 8px", color: "var(--isp-text)" }}>{port?.handoff_mode === "vlan_services" ? <><code className="reseller-mono">VLAN {port.vlan_tag}</code><div style={{ marginTop: 5, color: "#15803d", fontSize: 11, fontWeight: 750 }}>Bridge: {port.bridge_name || "—"} · Hotspot + PPPoE service</div></> : <><code className="reseller-mono">{port?.interface_name || "—"}</code>{port?.handoff_mode === "isp_router" && <div style={{ marginTop: 5, color: port.link_detected ? "#15803d" : "#a16207", fontSize: 11, fontWeight: 750 }}>{port.handoff_type === "vlan" ? `VLAN ${port.vlan_tag}` : "ISP router"} · {port.link_detected ? "XPON link detected" : "waiting for XPON"} </div>}</>}</td>
                 <td style={{ padding: "10px 8px", color: "var(--isp-text)" }}>{port ? <div style={{ display: "flex", gap: 5, alignItems: "center" }}><input aria-label={`Maximum bandwidth for ${port.interface_name}`} type="number" min="1" max="100000" value={linkCapDraft[port.id] ?? String(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps)} onChange={(event) => setLinkCapDraft((current) => ({ ...current, [port.id]: event.target.value }))} style={{ ...inputStyle, width: 86, minHeight: 32, padding: "5px 7px" }} /><span>Mbps</span></div> : "—"}</td>
                 <td style={{ padding: "10px 8px" }}><StatusBadge status={port?.status} />{port?.provisioning_error ? <div style={{ color: "#b91c1c", maxWidth: 260, marginTop: 5 }}>{port.provisioning_error}</div> : null}</td>
                 <td style={{ padding: "10px 8px" }}><StatusBadge status={linkStatus} />{port?.link_provisioning_error ? <div style={{ color: "#b91c1c", maxWidth: 260, marginTop: 5 }}>{port.link_provisioning_error}</div> : null}</td>
                  <td style={{ padding: "10px 8px" }}>{port ? <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{port.handoff_mode === "vlan_services" && <>{(port.status === "failed" || port.provisioning_error) && <button type="button" disabled={busy} onClick={() => void retryVlanPush(port.id)} style={{ border: 0, borderRadius: 8, padding: "7px 9px", background: "var(--isp-accent)", color: "#fff", cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 750 }}>{busy ? "Pushing…" : "Push again"}</button>}<button type="button" onClick={() => void downloadVlanScript(port.id)} style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: "7px 9px", background: "transparent", color: "var(--isp-text)", cursor: "pointer", fontSize: 12, fontWeight: 750 }}>Download VLAN script</button></>}{port.handoff_mode === "isp_router" && <button type="button" disabled={linkChecking === port.id} onClick={() => void checkHandoffLink(port.id)} style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: "7px 9px", background: "transparent", color: "var(--isp-text)", cursor: linkChecking === port.id ? "wait" : "pointer", fontSize: 12, fontWeight: 750 }}>{linkChecking === port.id ? "Checking…" : "Check XPON link"}</button>}<button type="button" disabled={busy || port.status !== "active"} onClick={() => void updateLink(port, linkStatus === "active" ? "suspended" : "active")} style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: "7px 9px", background: "transparent", color: "var(--isp-text)", cursor: busy || port.status !== "active" ? "not-allowed" : "pointer", display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 750 }}>{linkStatus === "active" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}{busy ? "Saving…" : linkStatus === "active" ? "Suspend" : "Activate"}</button></div> : "—"}</td>
               </tr>;
             })}
             {!resellers.length && <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--isp-text-muted)" }}>No reseller accounts yet.</td></tr>}
          </tbody></table></div>
        </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function MetricBarChart({ items, valueKey, suffix = "" }: {
  items: Array<{ label: string; count?: number; dataUsedMb?: number }>;
  valueKey: "count" | "dataUsedMb";
  suffix?: string;
}) {
  const max = Math.max(...items.map((item) => Number(item[valueKey] ?? 0)), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))`, gap: 9, alignItems: "end", minHeight: 145 }}>
      {items.length ? items.map((item) => {
        const value = Number(item[valueKey] ?? 0);
        return <div key={item.label} style={{ display: "grid", gap: 6, justifyItems: "center", alignItems: "end", height: "100%" }}>
          <div style={{ color: "var(--isp-text)", fontSize: 11, fontWeight: 800 }}>{value.toLocaleString("en-KE", { maximumFractionDigits: 1 })}{suffix}</div>
          <div title={`${item.label}: ${value.toLocaleString("en-KE", { maximumFractionDigits: 1 })}${suffix}`} style={{ width: "100%", maxWidth: 38, height: `${Math.max(8, (value / max) * 92)}px`, borderRadius: "7px 7px 3px 3px", background: "linear-gradient(180deg, var(--isp-accent), rgba(217,104,53,.35))" }} />
          <div style={{ color: "var(--isp-text-muted)", fontSize: 10, textAlign: "center" }}>{item.label}</div>
        </div>;
      }) : <div style={{ gridColumn: "1 / -1", alignSelf: "center", textAlign: "center", color: "var(--isp-text-muted)", fontSize: 13 }}>No data available yet.</div>}
    </div>
  );
}

function HorizontalMetricBars({ items, suffix = "" }: { items: Array<{ label: string; value: number }>; suffix?: string }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return <div style={{ display: "grid", gap: 12 }}>
    {items.length ? items.map((item) => <div key={item.label}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "var(--isp-text)", fontSize: 12, fontWeight: 750 }}><span>{item.label}</span><span>{item.value.toLocaleString("en-KE", { maximumFractionDigits: 1 })}{suffix}</span></div>
      <div style={{ height: 7, marginTop: 6, borderRadius: 999, background: "var(--isp-input-bg)", overflow: "hidden" }}><div style={{ width: `${Math.max(3, (item.value / max) * 100)}%`, height: "100%", borderRadius: 999, background: "var(--isp-accent)" }} /></div>
    </div>) : <div style={{ color: "var(--isp-text-muted)", fontSize: 13 }}>No data available yet.</div>}
  </div>;
}

function ResellerDashboard() {
  const [data, setData] = useState<ResellerResponse | null>(null);
  const [telemetry, setTelemetry] = useState<ResellerTelemetry | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<ResellerPaymentSettings | null>(null);
  const [selectedPortId, setSelectedPortId] = useState("");
  const [checkout, setCheckout] = useState({ portId: "", clientReference: "", clientIp: "", amount: "0", paymentReference: "", maxLimitMbps: "" });
  const [pppoeClient, setPppoeClient] = useState({ name: "", phone: "", username: "", password: "" });
  const [staticClient, setStaticClient] = useState({ name: "", phone: "", ipAddress: "", username: "", password: "" });
  const [gatewayForm, setGatewayForm] = useState<ResellerPaymentSettings>({
    paymentGateway: "mpesa_paybill",
    mpesa: { enabled: false, merchantIdentifier: "", accountReference: "", destinationType: "paybill" },
    bank: { enabled: false, merchantIdentifier: "", accountReference: "", bankName: "" },
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [pppoeSaving, setPppoeSaving] = useState(false);
  const [staticSaving, setStaticSaving] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);

  const load = async () => {
    try {
      const [dashboard, liveTelemetry] = await Promise.all([
        apiJson<ResellerResponse>("/api/reseller/me"),
        apiJson<ResellerTelemetry>("/api/admin/dashboard/telemetry").catch(() => null),
      ]);
      setData(dashboard);
      setTelemetry(liveTelemetry);
      setSelectedPortId((current) => current || String(dashboard.ports?.[0]?.id ?? ""));
      setCheckout((current) => ({ ...current, portId: current.portId || String(dashboard.ports?.[0]?.id ?? "") }));
      const settings = await apiJson<{ ok: boolean; settings: ResellerPaymentSettings }>("/api/reseller/payment-settings");
      setPaymentSettings(settings.settings);
      setGatewayForm(settings.settings);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load your reseller dashboard."); }
  };
  useEffect(() => { void load(); }, []);
  const provisionClient = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try { await apiJson("/api/reseller/checkout", { method: "POST", body: JSON.stringify({ ...checkout, portId: Number(checkout.portId), amount: Number(checkout.amount), maxLimitMbps: checkout.maxLimitMbps ? Number(checkout.maxLimitMbps) : undefined, gatewayType: "manual" }) }); setSuccess(port?.handoff_mode === "isp_router" ? "Paid client session recorded." : "Paid client session recorded and client queue provisioned."); setCheckout((current) => ({ ...current, clientReference: "", clientIp: "", paymentReference: "" })); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Client queue provisioning failed."); } finally { setSaving(false); }
  };
  const assignPppoeClient = async (event: React.FormEvent) => {
    event.preventDefault(); setPppoeSaving(true); setError(""); setSuccess("");
    try {
      await apiJson("/api/reseller/pppoe-clients", {
        method: "POST",
        body: JSON.stringify({ ...pppoeClient, portId: Number(port?.id) }),
      });
      setSuccess("PPPoE client assigned to your VLAN service.");
      setPppoeClient({ name: "", phone: "", username: "", password: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign the PPPoE client.");
    } finally { setPppoeSaving(false); }
  };
  const assignStaticClient = async (event: React.FormEvent) => {
    event.preventDefault(); setStaticSaving(true); setError(""); setSuccess("");
    try {
      await apiJson("/api/reseller/static-clients", {
        method: "POST",
        body: JSON.stringify({ ...staticClient, portId: Number(selectedPortId) }),
      });
      setSuccess("Static customer assigned and synchronized to the MikroTik service.");
      setStaticClient({ name: "", phone: "", ipAddress: "", username: "", password: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign the static customer.");
    } finally { setStaticSaving(false); }
  };
  const saveGatewaySettings = async (event: React.FormEvent) => {
    event.preventDefault(); setGatewaySaving(true); setError(""); setSuccess("");
    try {
      await apiJson("/api/reseller/payment-settings", { method: "PUT", body: JSON.stringify(gatewayForm) });
      setPaymentSettings(gatewayForm);
      setSuccess("Payment gateway settings saved. Automated prompts will use the selected Daraja-compatible gateway when configured.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save payment gateway settings.");
    } finally { setGatewaySaving(false); }
  };
  const port = data?.ports?.find((item) => String(item.id) === selectedPortId) ?? data?.ports?.[0];
  const linkStatus = port?.link_status ?? "pending";
  const revenue = data?.metrics?.revenue;
  const users = data?.metrics?.users;
  const analytics = data?.metrics?.analytics;
  const accessTypes = [
    { label: "Hotspot", value: users?.hotspot ?? 0 },
    { label: "PPPoE", value: users?.pppoe ?? 0 },
    { label: "Static", value: users?.static ?? 0 },
  ];
  const moneyOrZero = (value: number | undefined) => money(value ?? 0);

  return (
    <AdminLayout>
      <div className="reseller-workspace reseller-dashboard">
        <div className="reseller-page-header">
          <div className="reseller-eyebrow">RESELLER WORKSPACE</div>
          <h1>{data?.account?.company_name || data?.account?.name || "Reseller dashboard"}</h1>
          <p>Monitor your assigned router, customers, paid sessions, and client activity.</p>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
        <Notice error={error} success={success} />
         <div className="reseller-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
             {[
             { label: "Income today", value: moneyOrZero(revenue?.incomeToday), icon: Gauge },
             { label: "Income this month", value: moneyOrZero(revenue?.incomeMonth), icon: WalletCards },
             { label: "Total transactions", value: String(revenue?.totalTransactions ?? 0), icon: ReceiptText },
             { label: "Total revenue", value: moneyOrZero(revenue?.totalRevenue), icon: Banknote },
          ].map(({ label, value, icon: Icon }) => <div key={label} style={cardStyle}><Icon size={18} color="var(--isp-accent)" /><div className="reseller-metric-value">{value}</div><div className="reseller-metric-label">{label}</div></div>)}
        </div>
         <div className="reseller-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
           {[
             { label: "Total users", value: String(users?.total ?? 0), icon: Users },
             { label: "Active users", value: String(users?.active ?? 0), icon: PlayCircle },
             { label: "Expired users", value: String(users?.expired ?? 0), icon: PauseCircle },
             { label: "Online on assigned router", value: String(telemetry?.totals.onlineUsers ?? 0), icon: RouterIcon },
           ].map(({ label, value, icon: Icon }) => <div key={label} style={cardStyle}><Icon size={18} color="var(--isp-accent)" /><div className="reseller-metric-value">{value}</div><div className="reseller-metric-label">{label}</div></div>)}
         </div>
        <div style={{ ...cardStyle, borderColor: "rgba(217,104,53,.35)" }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: 18, fontWeight: 850, color: "var(--isp-text)" }}>{port?.handoff_mode === "isp_router" ? "ISP router / XPON handoff" : port?.handoff_mode === "vlan_services" ? "VLAN Hotspot + PPPoE service" : "Assigned interface"}</div><div style={{ color: "var(--isp-text-muted)", fontSize: 13, marginTop: 5 }}>{port?.handoff_mode === "isp_router" ? "Connect your XPON router to the assigned ISP-router handoff. No MikroTik package or reseller-side RouterOS setup is required." : port?.handoff_mode === "vlan_services" ? "Add the assigned VLAN to your XPON hotspot bridge. The ISP router supplies the reseller portal and PPPoE service under the locked speed cap." : "Only the router connected to your assigned port is shown here."}</div></div><ShieldCheck color="var(--isp-accent)" /></div>
              {port ? <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {data && data.ports.length > 1 && <Field label="Assigned router / service"><select style={inputStyle} value={selectedPortId} onChange={(event) => { setSelectedPortId(event.target.value); setCheckout((current) => ({ ...current, portId: event.target.value })); }}><option value="">Choose an assigned service</option>{data.ports.map((item) => <option key={item.id} value={item.id}>{item.router?.name || "Router"} · {item.interface_name} · {item.handoff_mode === "vlan_services" ? `VLAN ${item.vlan_tag}` : "XPON handoff"}</option>)}</select></Field>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{[port.router?.name ? `Router: ${port.router.name}` : "Router unavailable", `${port.interface_name} · ${port.status}`, `Wholesale link: ${linkStatus}`, `${port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps} Mbps cap`, port.handoff_mode === "vlan_services" ? `VLAN ${port.vlan_tag}` : port.handoff_mode === "isp_router" ? (port.handoff_type === "vlan" ? `VLAN ${port.vlan_tag}` : "Physical ISP handoff") : port.hotspot_enabled ? "Hotspot enabled" : "Hotspot off", port.handoff_mode === "isp_router" ? (port.link_detected ? "XPON link detected" : "Waiting for XPON link") : port.pppoe_enabled ? "PPPoE enabled" : "PPPoE off"].map((text) => <span key={text} className="reseller-technical-chip" style={{ padding: "6px 9px", borderRadius: 999, background: "var(--isp-input-bg)", color: "var(--isp-text)", fontSize: 12, fontWeight: 700 }}>{text}</span>)}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 18, color: "var(--isp-text-muted)", fontSize: 12, fontWeight: 750 }}>
                  <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: port.link_detected ? "#16a34a" : "#f59e0b", marginRight: 6 }} />XPON router {port.link_detected ? "active" : "waiting"}</span>
                  <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: ["active", "online", "connected", "running"].includes(String(port.router?.status || "").toLowerCase()) ? "#16a34a" : "#f59e0b", marginRight: 6 }} />ISP router {["active", "online", "connected", "running"].includes(String(port.router?.status || "").toLowerCase()) ? "active" : "checking"}</span>
                </div>
              </div> : <div style={{ marginTop: 18, color: "#b45309" }}>No active port assignment is available.</div>}
        </div>
         <section style={cardStyle}>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 13 }}>
             <div><div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--isp-text)", fontWeight: 850 }}><RouterIcon size={18} color="var(--isp-accent)" /> Routers status</div><div style={{ color: "var(--isp-text-muted)", fontSize: 12, marginTop: 4 }}>Only routers connected through your assigned reseller port are shown.</div></div>
             <button type="button" onClick={() => void load()} style={{ border: "1px solid var(--isp-border)", background: "transparent", color: "var(--isp-text)", borderRadius: 8, padding: 7, cursor: "pointer" }}><RefreshCw size={15} /></button>
           </div>
           <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
             {data?.ports?.length ? data.ports.map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 9 }}>
               <div><div style={{ color: "var(--isp-text)", fontWeight: 800 }}>{item.router?.name || "Assigned router"}</div><div style={{ color: "var(--isp-text-muted)", fontSize: 11, marginTop: 4 }}>{item.interface_name} · {item.handoff_mode === "isp_router" ? "ISP router handoff" : "Reseller services"}</div></div>
               <StatusBadge status={item.router?.status || item.status} />
             </div>) : <div style={{ color: "var(--isp-text-muted)", fontSize: 13 }}>No router assignment available.</div>}
           </div>
         </section>
          {port?.handoff_mode === "vlan_services" && port.vlan_tag ? (
            <section style={{ ...cardStyle, borderColor: "rgba(37,99,235,.3)", background: "linear-gradient(135deg, rgba(37,99,235,.08), var(--isp-card) 62%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: "var(--isp-text)", fontWeight: 850, display: "flex", alignItems: "center", gap: 8 }}>
                    <RouterIcon size={18} color="var(--isp-accent)" /> Configure your VLAN hotspot
                  </div>
                  <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5, margin: "6px 0 0", maxWidth: 700 }}>
                    Select the assigned router and VLAN {port.vlan_tag} in Hotspot Settings, choose the approved portal asset, and save. The reseller-specific hotspot directory, DNS name, files, firewall rules, NAT, and RouterOS service will be deployed together.
                  </p>
                </div>
                <Link
                  href={`/admin/hotspot-settings?routerId=${encodeURIComponent(String(port.router_id))}&vlan=${encodeURIComponent(String(port.vlan_tag))}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 9, padding: "10px 13px", background: "var(--isp-accent)", color: "#fff", textDecoration: "none", fontWeight: 800, fontSize: 12 }}
                >
                  Open Hotspot Settings
                </Link>
              </div>
            </section>
          ) : null}
         <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
           <section style={cardStyle}>
             <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Monthly registered customers</div>
             <div style={{ color: "var(--isp-text-muted)", fontSize: 12, margin: "4px 0 10px" }}>Customers registered in the last six months.</div>
             <MetricBarChart items={analytics?.registeredCustomersByMonth ?? []} valueKey="count" />
           </section>
           <section style={cardStyle}>
             <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Users by access type</div>
             <div style={{ color: "var(--isp-text-muted)", fontSize: 12, margin: "4px 0 18px" }}>Current customers in your reseller account.</div>
             <HorizontalMetricBars items={accessTypes} />
           </section>
           <section style={cardStyle}>
             <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Monthly data consumption</div>
             <div style={{ color: "var(--isp-text-muted)", fontSize: 12, margin: "4px 0 10px" }}>Current recorded usage grouped by customer registration month.</div>
             <MetricBarChart items={analytics?.consumptionByMonth ?? []} valueKey="dataUsedMb" suffix=" MB" />
           </section>
           <section style={cardStyle}>
             <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Top 5 data consumers</div>
             <div style={{ color: "var(--isp-text-muted)", fontSize: 12, margin: "4px 0 18px" }}>Highest recorded usage across your customers.</div>
             <HorizontalMetricBars items={(analytics?.topConsumers ?? []).map((item) => ({ label: `${item.name} · ${item.type}`, value: item.dataUsedMb }))} suffix=" MB" />
           </section>
         </div>
         <form onSubmit={provisionClient} style={cardStyle}>
           <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><WalletCards size={18} color="var(--isp-accent)" /> Record a paid client session</div>
           <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Record a confirmed manual payment without configuring reseller payment settings. Service-mode ports also receive a child queue; ISP-router handoffs record the paid session for the ISP-controlled router.</p>
           <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 13, marginTop: 17 }}>
              <Field label="Assigned port"><select required style={inputStyle} value={checkout.portId || String(port?.id ?? "")} onChange={(e) => { setCheckout({ ...checkout, portId: e.target.value }); setSelectedPortId(e.target.value); }}><option value="">Choose port</option>{data?.ports?.map((item) => <option key={item.id} value={item.id}>{item.router?.name || "Router"} · {item.interface_name} · {item.status}</option>)}</select></Field>
             <Field label="Client reference"><input required style={inputStyle} value={checkout.clientReference} onChange={(e) => setCheckout({ ...checkout, clientReference: e.target.value })} /></Field>
             <Field label="Client IPv4"><input required placeholder="192.168.30.55" style={inputStyle} value={checkout.clientIp} onChange={(e) => setCheckout({ ...checkout, clientIp: e.target.value })} /></Field>
             <Field label="Amount (KES)"><input required min="0" type="number" style={inputStyle} value={checkout.amount} onChange={(e) => setCheckout({ ...checkout, amount: e.target.value })} /></Field>
             <Field label="Payment reference"><input required placeholder="Receipt or cash reference" style={inputStyle} value={checkout.paymentReference} onChange={(e) => setCheckout({ ...checkout, paymentReference: e.target.value })} /></Field>
             <Field label="Client cap (Mbps)"><input min="1" type="number" placeholder={port ? String(port.bandwidth_cap_mbps) : "5"} style={inputStyle} value={checkout.maxLimitMbps} onChange={(e) => setCheckout({ ...checkout, maxLimitMbps: e.target.value })} /></Field>
           </div>
           <button disabled={saving || !port || linkStatus !== "active"} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}><Plus size={16} /> Record paid session</button>
         </form>
          {port?.handoff_mode === "vlan_services" && (
            <form onSubmit={assignStaticClient} style={{ ...cardStyle, borderColor: "rgba(16,185,129,.3)" }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><RouterIcon size={18} color="#16a34a" /> Assign a static customer</div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Reserve a fixed IPv4 address on the selected reseller service. The customer record and RouterOS queue are written together.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 13, marginTop: 17 }}>
                <Field label="Client name"><input required style={inputStyle} value={staticClient.name} onChange={(e) => setStaticClient({ ...staticClient, name: e.target.value })} /></Field>
                <Field label="Phone"><input required style={inputStyle} value={staticClient.phone} onChange={(e) => setStaticClient({ ...staticClient, phone: e.target.value })} /></Field>
                <Field label="Static IPv4"><input required placeholder="192.168.180.20" style={inputStyle} value={staticClient.ipAddress} onChange={(e) => setStaticClient({ ...staticClient, ipAddress: e.target.value })} /></Field>
                <Field label="Username (optional)"><input style={inputStyle} value={staticClient.username} onChange={(e) => setStaticClient({ ...staticClient, username: e.target.value })} /></Field>
                <Field label="Password (optional)"><input type="password" minLength={8} style={inputStyle} value={staticClient.password} onChange={(e) => setStaticClient({ ...staticClient, password: e.target.value })} /></Field>
              </div>
              <button disabled={staticSaving || linkStatus !== "active"} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "#16a34a", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}><Plus size={16} /> {staticSaving ? "Assigning…" : "Assign static customer"}</button>
            </form>
          )}
          <form onSubmit={saveGatewaySettings} style={{ ...cardStyle, borderColor: "rgba(37,99,235,.28)" }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><WalletCards size={18} color="var(--isp-accent)" /> Payment gateway settings</div>
            <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Configure the merchant destination used for reseller customer payments. Credentials stay server-side; manual receipts remain available for non-automated gateways.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 13, marginTop: 17 }}>
              <Field label="Selected gateway"><select style={inputStyle} value={gatewayForm.paymentGateway} onChange={(e) => setGatewayForm({ ...gatewayForm, paymentGateway: e.target.value })}><option value="mpesa_paybill">M-Pesa PayBill</option><option value="mpesa_till_push">M-Pesa Till</option><option value="bank_stk_push">Bank STK Push</option><option value="manual">Manual / cash</option></select></Field>
              <Field label="M-Pesa Till / PayBill"><input style={inputStyle} value={gatewayForm.mpesa.merchantIdentifier} onChange={(e) => setGatewayForm({ ...gatewayForm, mpesa: { ...gatewayForm.mpesa, merchantIdentifier: e.target.value, enabled: true } })} /></Field>
              <Field label="M-Pesa account reference"><input style={inputStyle} value={gatewayForm.mpesa.accountReference} onChange={(e) => setGatewayForm({ ...gatewayForm, mpesa: { ...gatewayForm.mpesa, accountReference: e.target.value, enabled: true } })} /></Field>
              <Field label="M-Pesa destination"><select style={inputStyle} value={gatewayForm.mpesa.destinationType} onChange={(e) => setGatewayForm({ ...gatewayForm, mpesa: { ...gatewayForm.mpesa, destinationType: e.target.value === "till" ? "till" : "paybill" } })}><option value="paybill">PayBill</option><option value="till">Till</option></select></Field>
              <Field label="Bank name"><input style={inputStyle} value={gatewayForm.bank.bankName} onChange={(e) => setGatewayForm({ ...gatewayForm, bank: { ...gatewayForm.bank, bankName: e.target.value, enabled: true } })} /></Field>
              <Field label="Bank account / merchant"><input style={inputStyle} value={gatewayForm.bank.accountReference} onChange={(e) => setGatewayForm({ ...gatewayForm, bank: { ...gatewayForm.bank, accountReference: e.target.value, enabled: true } })} /></Field>
            </div>
            <button disabled={gatewaySaving} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer" }}>{gatewaySaving ? "Saving…" : "Save payment settings"}</button>
            {paymentSettings && <span style={{ marginLeft: 12, color: "#15803d", fontSize: 12, fontWeight: 750 }}>{paymentSettings.paymentGateway} selected</span>}
          </form>
          {port?.handoff_mode === "vlan_services" && port.pppoe_enabled && (
            <form onSubmit={assignPppoeClient} style={{ ...cardStyle, borderColor: "rgba(37,99,235,.3)" }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><RouterIcon size={18} color="var(--isp-accent)" /> Assign a PPPoE client</div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Create a client login on your assigned VLAN. The client receives the ISP-defined PPPoE profile and remains inside your locked reseller speed cap.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 13, marginTop: 17 }}>
                <Field label="Client name"><input required style={inputStyle} value={pppoeClient.name} onChange={(e) => setPppoeClient({ ...pppoeClient, name: e.target.value })} /></Field>
                <Field label="Phone"><input required style={inputStyle} value={pppoeClient.phone} onChange={(e) => setPppoeClient({ ...pppoeClient, phone: e.target.value })} /></Field>
                <Field label="PPPoE username"><input required pattern="[A-Za-z0-9._-]{3,64}" style={inputStyle} value={pppoeClient.username} onChange={(e) => setPppoeClient({ ...pppoeClient, username: e.target.value })} /></Field>
                <Field label="PPPoE password"><input required minLength={8} type="password" style={inputStyle} value={pppoeClient.password} onChange={(e) => setPppoeClient({ ...pppoeClient, password: e.target.value })} /></Field>
              </div>
              <button disabled={pppoeSaving || linkStatus !== "active"} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}><Plus size={16} /> {pppoeSaving ? "Assigning…" : "Assign PPPoE client"}</button>
            </form>
          )}
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, color: "var(--isp-text)", marginBottom: 12 }}>Recent sales on your port</div>
          <div style={{ overflowX: "auto" }}><table className="isp-table reseller-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Client", "Address", "Gateway", "Amount", "Status", "Date"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "9px 8px", color: "var(--isp-text-muted)", borderBottom: "1px solid var(--isp-border)" }}>{heading}</th>)}</tr></thead><tbody>{data?.sales?.map((sale) => <tr key={sale.id}><td style={{ padding: "10px 8px", color: "var(--isp-text)", fontWeight: 600 }}>{sale.client_reference}</td><td style={{ padding: "10px 8px" }}><code className="reseller-mono">{sale.client_ip}</code></td><td style={{ padding: "10px 8px", color: "var(--isp-text-muted)" }}>{sale.gateway_type}</td><td style={{ padding: "10px 8px", color: "var(--isp-text)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{money(sale.amount)}</td><td style={{ padding: "10px 8px" }}><StatusBadge status={sale.status} /></td><td style={{ padding: "10px 8px", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{new Date(sale.created_at).toLocaleString()}</td></tr>)}{!data?.sales?.length && <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--isp-text-muted)" }}>No sales recorded yet.</td></tr>}</tbody></table></div>
        </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export default function ResellerWorkspace() {
  return getAdminRole() === "reseller" ? <ResellerDashboard /> : <AdminResellerManagement />;
}