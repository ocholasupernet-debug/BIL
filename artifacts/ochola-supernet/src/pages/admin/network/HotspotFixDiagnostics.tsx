import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { fetchAdminRouterManagementContext, type AdminContextRouter } from "@/lib/admin-router-context";
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Loader2, RefreshCw, ShieldCheck, Stethoscope, Wrench, XCircle } from "lucide-react";

type Status = "pass" | "warning" | "fail" | "unknown";
type Check = { id: string; label: string; status: Status; detail: string };
type RepairAction = "enable-server" | "select-profile" | "bind-server" | "enable-dhcp" | "enable-dns";
type Scan = {
  router: { id: number; name: string };
  checkedAt: string;
  checks: Check[];
  partial?: boolean;
  partialIssues?: string[];
  repairTargets: { servers: string[]; profiles: string[]; dhcpServers: string[]; interfaces: string[] };
};
type HistoryRow = { action?: string; subject?: string; details?: { result?: string }; created_at?: string };

const fixedActions: Array<{ id: RepairAction; title: string; help: string; targetKey?: keyof Scan["repairTargets"] }> = [
  { id: "enable-server", title: "Enable Hotspot server", help: "Enables one existing Hotspot server only.", targetKey: "servers" },
  { id: "select-profile", title: "Set Hotspot server profile", help: "Selects an existing profile for one existing Hotspot server.", targetKey: "servers" },
  { id: "bind-server", title: "Repair server interface binding", help: "Changes the selected Hotspot server’s interface to an existing interface.", targetKey: "servers" },
  { id: "enable-dhcp", title: "Enable DHCP server", help: "Enables one existing DHCP server; does not change pools, networks, or leases.", targetKey: "dhcpServers" },
  { id: "enable-dns", title: "Enable router DNS requests", help: "Enables remote DNS requests only; it does not change DNS servers or firewall rules." },
];

const statusStyle: Record<Status, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  pass: { color: "#047857", bg: "#ecfdf5", icon: CheckCircle2, label: "Pass" },
  warning: { color: "#a16207", bg: "#fffbeb", icon: AlertTriangle, label: "Review" },
  fail: { color: "#b91c1c", bg: "#fef2f2", icon: XCircle, label: "Needs attention" },
  unknown: { color: "#475569", bg: "#f1f5f9", icon: CircleHelp, label: "Not checked" },
};

export default function HotspotFixDiagnostics() {
  const [routers, setRouters] = useState<AdminContextRouter[]>([]);
  const [routerId, setRouterId] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingRouters, setLoadingRouters] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [bindingInterfaces, setBindingInterfaces] = useState<Record<string, string>>({});

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const token = getAdminApiToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }, []);

  const loadRouters = useCallback(async () => {
    setLoadingRouters(true);
    setError("");
    try {
      const context = await fetchAdminRouterManagementContext();
      const available = context.routers.filter(item => !["setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"].includes(String(item.status)));
      setRouters(available);
      setRouterId(current => current || String(available[0]?.id ?? ""));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Router list could not be loaded.");
    } finally {
      setLoadingRouters(false);
    }
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const body = await request(`/api/router/${encodeURIComponent(id)}/hotspot-fix/history?adminId=${ADMIN_ID}`);
      setHistory(Array.isArray(body.history) ? body.history : []);
    } catch { setHistory([]); }
  }, [request]);

  const runScan = useCallback(async () => {
    if (!routerId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await request(`/api/router/${encodeURIComponent(routerId)}/hotspot-fix/diagnostics?adminId=${ADMIN_ID}`);
      setScan(body as Scan);
      await loadHistory(routerId);
    } catch (reason) {
      setScan(null);
      setError(reason instanceof Error ? reason.message : "The router scan failed. Check the connection and retry.");
    } finally { setBusy(false); }
  }, [loadHistory, request, routerId]);

  useEffect(() => { void loadRouters(); }, [loadRouters]);
  useEffect(() => { setScan(null); setHistory([]); }, [routerId]);

  const issues = useMemo(() => scan?.checks.filter(item => item.status === "fail" || item.status === "warning") ?? [], [scan]);

  const executeRepair = async (action: RepairAction, target = "", value = "") => {
    if (!routerId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const preview = await request(`/api/router/${routerId}/hotspot-fix/repair`, {
        method: "POST", body: JSON.stringify({ adminId: ADMIN_ID, action, target, value, mode: "preview" }),
      });
      if (!window.confirm(`${preview.preview}\n\nAffected item: ${preview.resource}\nCurrent state: ${preview.currentState}\n\nApply this specific change?`)) return;
      const result = await request(`/api/router/${routerId}/hotspot-fix/repair`, {
        method: "POST", body: JSON.stringify({ adminId: ADMIN_ID, action, target, value, mode: "apply", confirmed: true, confirmationToken: preview.confirmationToken }),
      });
      setNotice(result.message || "Repair applied.");
      await runScan();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Repair could not be completed."); }
    finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: "var(--isp-card, #fff)", border: "1px solid var(--isp-border, #e5e7eb)", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--isp-text-muted, #64748b)", marginBottom: 7 };

  return <AdminLayout>
    <div style={{ padding: "clamp(16px, 3vw, 28px)", maxWidth: 1200, margin: "0 auto", display: "grid", gap: 18 }}>
      <NetworkTabs active="hotspot-diagnostics" />
      <header style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", background: "#eff6ff", color: "#2563eb" }}><Stethoscope size={23}/></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(22px, 4vw, 30px)", color: "var(--isp-text, #0f172a)" }}>Hotspot Fix &amp; Diagnostics</h1>
          <p style={{ margin: "6px 0 0", color: "var(--isp-text-muted, #64748b)", lineHeight: 1.5 }}>Run a read-only router scan, review issues, then preview and confirm any narrow repair.</p>
        </div>
      </header>

      <section style={{ ...card, display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto auto", gap: 10, alignItems: "end" }}>
        <label><span style={labelStyle}>Router</span><select value={routerId} disabled={loadingRouters || busy} onChange={event => setRouterId(event.target.value)} style={{ width: "100%", padding: 11, borderRadius: 9, border: "1px solid #cbd5e1", background: "var(--isp-input, #fff)", color: "inherit" }}>
          {loadingRouters && <option>Loading routers…</option>}
          {!loadingRouters && !routers.length && <option value="">No assigned routers available</option>}
          {routers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button disabled={!routerId || busy || loadingRouters} onClick={() => void runScan()} style={{ padding: "11px 15px", border: 0, borderRadius: 9, background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}>
          {busy ? <Loader2 size={16} className="animate-spin"/> : <Activity size={16}/>} Run diagnostics
        </button>
        <button disabled={!routerId || busy} onClick={() => void runScan()} style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 9, background: "transparent", color: "inherit", fontWeight: 650, cursor: "pointer", display: "inline-flex", gap: 7, alignItems: "center" }}><RefreshCw size={15}/> Recheck</button>
      </section>

      {error && <div role="alert" style={{ ...card, borderColor: "#fecaca", color: "#b91c1c", background: "#fff7f7" }}>{error}</div>}
      {notice && <div role="status" style={{ ...card, borderColor: "#a7f3d0", color: "#047857", background: "#f0fdf4" }}>{notice}</div>}
      {!scan && !error && <div style={{ ...card, color: "#64748b", display: "flex", alignItems: "center", gap: 10 }}><ShieldCheck size={20}/> Choose a router and run diagnostics. The scan does not change router configuration.</div>}

      {scan && <>
        <section style={{ ...card, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div><strong style={{ fontSize: 17 }}>{scan.router.name}</strong><div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>Scanned {new Date(scan.checkedAt).toLocaleString()} · {issues.length} item(s) need review</div></div>
          <span style={{ fontSize: 12, color: "#475569" }}>PPPoE is context only; Hotspot repairs do not change PPPoE.</span>
        </section>
        {scan.partial && <div role="status" style={{ ...card, borderColor: "#fde68a", background: "#fffbeb", color: "#92400e" }}>
          Some checks were incomplete: {(scan.partialIssues ?? []).join(" ")} Completed results are still shown; use Recheck after restoring access.
        </div>}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))", gap: 12 }}>
          {scan.checks.map(item => {
            const style = statusStyle[item.status]; const Icon = style.icon;
            return <article key={item.id} style={{ ...card, padding: 15 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <strong>{item.label}</strong><span style={{ background: style.bg, color: style.color, borderRadius: 99, padding: "4px 8px", fontSize: 11, fontWeight: 700, display: "inline-flex", gap: 5, alignItems: "center" }}><Icon size={13}/>{style.label}</span>
              </div><p style={{ color: "#64748b", margin: "10px 0 0", lineHeight: 1.5, fontSize: 13 }}>{item.detail}</p>
            </article>;
          })}
        </section>

        <section style={{ ...card }}>
          <h2 style={{ margin: "0 0 5px", fontSize: 18 }}>Repair actions</h2>
          <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>Each available action previews the exact resource and requires confirmation. DNS and DHCP changes are intentionally limited; firewall/NAT, payment, and customer activation use their dedicated workflows.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10 }}>
            {fixedActions.map(action => {
              const options = action.targetKey ? scan.repairTargets[action.targetKey] : [];
              const secondaryOptions = action.id === "bind-server" ? scan.repairTargets.interfaces : action.id === "select-profile" ? scan.repairTargets.profiles : [];
              const target = targets[action.id] || options[0] || "";
              const value = action.id === "bind-server" || action.id === "select-profile" ? bindingInterfaces[action.id] || secondaryOptions[0] || "" : "";
              return <div key={action.id} style={{ border: "1px solid #e2e8f0", borderRadius: 11, padding: 13 }}>
                <strong style={{ fontSize: 14 }}>{action.title}</strong><p style={{ margin: "5px 0 10px", color: "#64748b", fontSize: 12, lineHeight: 1.45 }}>{action.help}</p>
                {action.targetKey && <label><span style={labelStyle}>Existing resource</span><select value={target} onChange={event => setTargets(current => ({ ...current, [action.id]: event.target.value }))} style={{ width: "100%", padding: 9, borderRadius: 8, border: "1px solid #cbd5e1", marginBottom: 9, background: "#fff" }}>
                  {options.map(option => <option value={option} key={option}>{option}</option>)}
                </select></label>}
                {(action.id === "bind-server" || action.id === "select-profile") && <label><span style={labelStyle}>{action.id === "bind-server" ? "Bind to existing interface" : "Choose existing Hotspot profile"}</span><select value={value} onChange={event => setBindingInterfaces(current => ({ ...current, [action.id]: event.target.value }))} style={{ width: "100%", padding: 9, borderRadius: 8, border: "1px solid #cbd5e1", marginBottom: 9, background: "#fff" }}>
                  {secondaryOptions.map(option => <option value={option} key={option}>{option}</option>)}
                </select></label>}
                <button disabled={busy || Boolean(action.targetKey && !options.length) || Boolean((action.id === "bind-server" || action.id === "select-profile") && !secondaryOptions.length)} onClick={() => void executeRepair(action.id, target, value)} style={{ border: "1px solid #cbd5e1", background: "white", padding: "8px 10px", borderRadius: 8, display: "inline-flex", gap: 7, alignItems: "center", cursor: "pointer", fontWeight: 650, color: "#1e293b" }}><Wrench size={14}/> Preview repair</button>
              </div>;
            })}
          </div>
        </section>

        <section style={{ ...card }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Dedicated repair workflows</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 10 }}>
            <Link href="/admin/hotspot-settings"><div style={{ border: "1px solid #e2e8f0", padding: 13, borderRadius: 10, cursor: "pointer" }}><strong>Login page / layout sync</strong><p style={{ margin: "5px 0", color: "#64748b", fontSize: 12 }}>Open Hotspot Settings to preview and sync only the selected independent layout.</p><ExternalLink size={14}/></div></Link>
            <Link href="/admin/transactions/hotspot-recovery"><div style={{ border: "1px solid #e2e8f0", padding: 13, borderRadius: 10, cursor: "pointer" }}><strong>Payment and activation</strong><p style={{ margin: "5px 0", color: "#64748b", fontSize: 12 }}>Verify a purchase and use the existing paid Hotspot recovery flow.</p><ExternalLink size={14}/></div></Link>
            <Link href="/admin/network/routers"><div style={{ border: "1px solid #e2e8f0", padding: 13, borderRadius: 10, cursor: "pointer" }}><strong>Reconnect / router API</strong><p style={{ margin: "5px 0", color: "#64748b", fontSize: 12 }}>Re-test connectivity and manage the router using the existing secure router tools.</p><ExternalLink size={14}/></div></Link>
            <Link href="/admin/activation/prepaid-users"><div style={{ border: "1px solid #e2e8f0", padding: 13, borderRadius: 10, cursor: "pointer" }}><strong>Customer activation / sync</strong><p style={{ margin: "5px 0", color: "#64748b", fontSize: 12 }}>Review the affected account and use its existing activation controls; no user is changed from this page.</p><ExternalLink size={14}/></div></Link>
            <Link href="/admin/webhooks"><div style={{ border: "1px solid #e2e8f0", padding: 13, borderRadius: 10, cursor: "pointer" }}><strong>Payment callback validation</strong><p style={{ margin: "5px 0", color: "#64748b", fontSize: 12 }}>Inspect existing callback/webhook status. Do not replay a payment callback without confirming its transaction.</p><ExternalLink size={14}/></div></Link>
          </div>
          <details style={{ marginTop: 14, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Manual-only / advanced checks</summary>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.55 }}>Firewall/NAT rule order, payment callback delivery, RADIUS entitlement, and customer-specific account status need contextual review. This page will not rewrite firewall rules, change WAN settings, delete users, or modify customer records. Check the affected router, payment transaction, and tenant-scoped customer record before using the established repair tools.</p>
          </details>
        </section>
        <section style={{ ...card }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Repair history</h2>
          {history.length ? history.map((row, index) => <div key={`${row.created_at}-${index}`} style={{ padding: "9px 0", borderTop: "1px solid #eef2f7", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <span>{row.action?.replaceAll("_", " ") || "Hotspot action"} · {row.details?.result || "recorded"}</span><time style={{ color: "#64748b" }}>{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</time>
          </div>) : <p style={{ color: "#64748b", fontSize: 13 }}>No repair activity recorded for this router yet.</p>}
        </section>
      </>}
    </div>
  </AdminLayout>;
}
