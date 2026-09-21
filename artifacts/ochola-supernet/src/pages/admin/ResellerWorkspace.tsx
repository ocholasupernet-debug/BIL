import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Gauge, LockKeyhole, Plus, RefreshCw, Router as RouterIcon, Save, ShieldCheck, Users, WalletCards } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID, getAdminApiToken, getAdminRole } from "@/lib/supabase";

type RouterOption = { id: number; name: string; status?: string };
type PortOption = { name: string; type: string; running: boolean; assigned: boolean };
type Reseller = { id: number; name: string; company_name?: string; username: string; email?: string; is_active: boolean; earnings_balance: number; created_at: string };
type Assignment = {
  id: number; reseller_id?: number; router_id: number; interface_name: string; bridge_name?: string | null;
  hotspot_enabled: boolean; pppoe_enabled: boolean; subnet_range?: string | null; bandwidth_cap_mbps: number; status: string; provisioning_error?: string | null;
};
type Sale = { id: number; reseller_port_id: number; client_reference: string; client_ip: string; amount: number; gateway_type: string; payment_reference: string; status: string; created_at: string };
type ResellerResponse = { ok: boolean; account: { name: string; company_name?: string; username: string; earnings_balance: number } | null; ports: Assignment[]; gateways: { gateway_type: string; is_active: boolean }[]; sales: Sale[]; error?: string };

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
  if (status === "failed" || status === "error") return "isp-badge-red";
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [routerResult, resellerResult] = await Promise.all([
        apiJson<{ ok: boolean; routers: RouterOption[] }>(`/api/routers?adminId=${ADMIN_ID}`),
        apiJson<{ ok: boolean; resellers: Reseller[]; ports: Assignment[] }>("/api/admin/resellers"),
      ]);
      setRouters(routerResult.routers ?? []);
      setResellers(resellerResult.resellers ?? []);
      setAssignments(resellerResult.ports ?? []);
      if (!routerId && routerResult.routers?.[0]) setRouterId(String(routerResult.routers[0].id));
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

  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setSubmitting(true);
    try {
      await apiJson("/api/admin/resellers", { method: "POST", body: JSON.stringify({ ...form, routerId: Number(routerId) }) });
      setSuccess("Reseller account created and the physical port was provisioned.");
       setForm((current) => ({ ...current, name: "", companyName: "", username: "", email: "", phone: "", password: "", interfaceName: "", hotspotTemplatePath: "", pppoeFolderPath: "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Provisioning failed."); }
    finally { setSubmitting(false); }
  };

  return (
    <AdminLayout>
      <div className="reseller-workspace reseller-admin">
        <div className="reseller-page-header">
          <div className="reseller-eyebrow">RESELLER OPERATIONS</div>
          <h1>Reseller port provisioning</h1>
          <p>Create scoped reseller accounts and bind them to an available physical interface.</p>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
        <Notice error={error} success={success} />
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
            <div><div style={{ fontWeight: 800, color: "var(--isp-text)" }}>Resellers and assigned ports</div><div style={{ fontSize: 13, color: "var(--isp-text-muted)", marginTop: 4 }}>Tenant-scoped accounts and provisioning state.</div></div>
            <button onClick={() => void load()} style={{ border: "1px solid var(--isp-border)", background: "transparent", color: "var(--isp-text)", borderRadius: 9, padding: 9, cursor: "pointer" }}><RefreshCw size={16} /></button>
          </div>
          <div style={{ overflowX: "auto" }}><table className="isp-table reseller-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Reseller", "Username", "Port", "Cap", "Status", "Wallet"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "9px 8px", color: "var(--isp-text-muted)", borderBottom: "1px solid var(--isp-border)" }}>{heading}</th>)}</tr></thead><tbody>
            {resellers.map((reseller) => { const port = assignments.find((item) => item.reseller_id === reseller.id); return <tr key={reseller.id}><td style={{ padding: "10px 8px", color: "var(--isp-text)", fontWeight: 700 }}>{reseller.company_name || reseller.name}</td><td style={{ padding: "10px 8px", color: "var(--isp-text-muted)" }}>{reseller.username}</td><td style={{ padding: "10px 8px", color: "var(--isp-text)" }}><code className="reseller-mono">{port?.interface_name || "—"}</code></td><td style={{ padding: "10px 8px", color: "var(--isp-text)" }}><code className="reseller-mono">{port ? `${port.bandwidth_cap_mbps} Mbps` : "—"}</code></td><td style={{ padding: "10px 8px" }}><StatusBadge status={port?.status} />{port?.provisioning_error ? <div style={{ color: "#b91c1c", maxWidth: 260, marginTop: 5 }}>{port.provisioning_error}</div> : null}</td><td style={{ padding: "10px 8px", color: "var(--isp-text)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{money(reseller.earnings_balance)}</td></tr>; })}
            {!resellers.length && <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--isp-text-muted)" }}>No reseller accounts yet.</td></tr>}
          </tbody></table></div>
        </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function ResellerDashboard() {
  const [data, setData] = useState<ResellerResponse | null>(null);
  const [gatewayType, setGatewayType] = useState("mpesa");
  const [gatewayConfig, setGatewayConfig] = useState({ merchantId: "", apiKey: "", secret: "" });
  const [checkout, setCheckout] = useState({ portId: "", clientReference: "", clientIp: "", amount: "0", paymentReference: "", maxLimitMbps: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setData(await apiJson<ResellerResponse>("/api/reseller/me")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load your reseller dashboard."); }
  };
  useEffect(() => { void load(); }, []);
  const totalRevenue = useMemo(() => (data?.sales ?? []).filter((sale) => sale.status === "completed").reduce((sum, sale) => sum + Number(sale.amount), 0), [data]);
  const saveGateway = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try { await apiJson("/api/reseller/gateway", { method: "PUT", body: JSON.stringify({ gatewayType, config: gatewayConfig }) }); setSuccess("Gateway settings saved securely."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to save gateway settings."); } finally { setSaving(false); }
  };
  const provisionClient = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try { await apiJson("/api/reseller/checkout", { method: "POST", body: JSON.stringify({ ...checkout, portId: Number(checkout.portId), amount: Number(checkout.amount), maxLimitMbps: checkout.maxLimitMbps ? Number(checkout.maxLimitMbps) : undefined, gatewayType }) }); setSuccess("Payment recorded and client queue provisioned."); setCheckout((current) => ({ ...current, clientReference: "", clientIp: "", paymentReference: "" })); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Client queue provisioning failed."); } finally { setSaving(false); }
  };
  const port = data?.ports?.[0];

  return (
    <AdminLayout>
      <div className="reseller-workspace reseller-dashboard">
        <div className="reseller-page-header">
          <div className="reseller-eyebrow">RESELLER WORKSPACE</div>
          <h1>{data?.account?.company_name || data?.account?.name || "Reseller dashboard"}</h1>
          <p>Monitor your assigned interface, payment gateway, and client queue activity.</p>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
        <Notice error={error} success={success} />
        <div className="reseller-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
          {[
            { label: "Earnings balance", value: money(data?.account?.earnings_balance), icon: WalletCards },
            { label: "Completed revenue", value: money(totalRevenue), icon: Gauge },
            { label: "Port ceiling", value: port ? `${port.bandwidth_cap_mbps} Mbps` : "Not assigned", icon: RouterIcon },
          ].map(({ label, value, icon: Icon }) => <div key={label} style={cardStyle}><Icon size={18} color="var(--isp-accent)" /><div className="reseller-metric-value">{value}</div><div className="reseller-metric-label">{label}</div></div>)}
        </div>
        <div style={{ ...cardStyle, borderColor: "rgba(217,104,53,.35)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: 18, fontWeight: 850, color: "var(--isp-text)" }}>Assigned interface</div><div style={{ color: "var(--isp-text-muted)", fontSize: 13, marginTop: 5 }}>All operations are guarded against ports outside this assignment.</div></div><ShieldCheck color="var(--isp-accent)" /></div>
           {port ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{[`${port.interface_name} · ${port.status}`, `${port.bandwidth_cap_mbps} Mbps cap`, port.hotspot_enabled ? "Hotspot enabled" : "Hotspot off", port.pppoe_enabled ? "PPPoE enabled" : "PPPoE off"].map((text) => <span key={text} className="reseller-technical-chip" style={{ padding: "6px 9px", borderRadius: 999, background: "var(--isp-input-bg)", color: "var(--isp-text)", fontSize: 12, fontWeight: 700 }}>{text}</span>)}</div> : <div style={{ marginTop: 18, color: "#b45309" }}>No active port assignment is available.</div>}
        </div>
        <div className="reseller-forms-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,.85fr) minmax(0,1.15fr)", gap: 16, alignItems: "start" }}>
          <form onSubmit={saveGateway} style={cardStyle}>
            <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><LockKeyhole size={18} color="var(--isp-accent)" /> Independent payment gateway</div>
            <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Credentials are accepted by the API and never returned to this dashboard.</p>
            <div style={{ display: "grid", gap: 13, marginTop: 17 }}>
              <Field label="Gateway"><select style={inputStyle} value={gatewayType} onChange={(e) => setGatewayType(e.target.value)}><option value="mpesa">M-Pesa</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option></select></Field>
              <Field label="Merchant / account id"><input style={inputStyle} value={gatewayConfig.merchantId} onChange={(e) => setGatewayConfig({ ...gatewayConfig, merchantId: e.target.value })} /></Field>
              <Field label="API key"><input type="password" style={inputStyle} value={gatewayConfig.apiKey} onChange={(e) => setGatewayConfig({ ...gatewayConfig, apiKey: e.target.value })} /></Field>
              <Field label="API secret"><input type="password" style={inputStyle} value={gatewayConfig.secret} onChange={(e) => setGatewayConfig({ ...gatewayConfig, secret: e.target.value })} /></Field>
            </div>
            <button disabled={saving} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}><Save size={16} /> Save gateway</button>
          </form>
          <form onSubmit={provisionClient} style={cardStyle}>
            <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-text)", fontWeight: 800 }}><WalletCards size={18} color="var(--isp-accent)" /> Record a paid client session</div>
            <p style={{ color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Use this server-side step after the selected gateway confirms payment. It creates a child queue under your port root.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 13, marginTop: 17 }}>
              <Field label="Assigned port"><select required style={inputStyle} value={checkout.portId || String(port?.id ?? "")} onChange={(e) => setCheckout({ ...checkout, portId: e.target.value })}><option value="">Choose port</option>{data?.ports?.map((item) => <option key={item.id} value={item.id}>{item.interface_name} · {item.status}</option>)}</select></Field>
              <Field label="Client reference"><input required style={inputStyle} value={checkout.clientReference} onChange={(e) => setCheckout({ ...checkout, clientReference: e.target.value })} /></Field>
              <Field label="Client IPv4"><input required placeholder="192.168.30.55" style={inputStyle} value={checkout.clientIp} onChange={(e) => setCheckout({ ...checkout, clientIp: e.target.value })} /></Field>
              <Field label="Amount (KES)"><input required min="0" type="number" style={inputStyle} value={checkout.amount} onChange={(e) => setCheckout({ ...checkout, amount: e.target.value })} /></Field>
              <Field label="Payment reference"><input required style={inputStyle} value={checkout.paymentReference} onChange={(e) => setCheckout({ ...checkout, paymentReference: e.target.value })} /></Field>
              <Field label="Client cap (Mbps)"><input min="1" type="number" placeholder={port ? String(port.bandwidth_cap_mbps) : "5"} style={inputStyle} value={checkout.maxLimitMbps} onChange={(e) => setCheckout({ ...checkout, maxLimitMbps: e.target.value })} /></Field>
            </div>
            <button disabled={saving || !port} type="submit" style={{ marginTop: 17, border: 0, borderRadius: 10, padding: "11px 15px", color: "#fff", background: "var(--isp-accent)", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}><Plus size={16} /> Provision client queue</button>
          </form>
        </div>
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