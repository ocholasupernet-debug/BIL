import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { getAdminApiToken } from "@/lib/supabase";
import {
  Activity, AlertTriangle, CheckCircle2, Copy, Download, KeyRound,
  LockKeyhole, Network, Plus, RefreshCw, Server, Shield, Trash2,
  Users, Wifi,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";
type Technology = "wireguard" | "openvpn" | "ipsec";
type Router = { id: number; name: string; ros_version?: string | null; status?: string };
type Capability = { routerOsVersion: string; wireguard: boolean; openvpn: boolean; ipsec: boolean; reasons?: Partial<Record<Technology, string>> };
type Server = { id: number; router_id: number; technology: Technology; name: string; interface_name?: string | null; listen_port?: number | null; endpoint?: string | null; is_active: boolean; last_status: string };
type Peer = { id: number; server_id: number; customer_id?: number | null; username: string; technology: Technology; public_key?: string | null; assigned_ip?: string | null; allowed_ips?: string[]; endpoint?: string | null; is_active: boolean; expires_at?: string | null; last_status: string; last_handshake_at?: string | null };
type Overview = { summary: { servers: number; peers: number; active: number; technologies: Technology[] }; servers: Server[]; peers: Peer[]; operations: Audit[] };
type Audit = { id: number; technology: Technology; operation: string; mode: string; stage: string; status: string; error?: string | null; created_at: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminApiToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "string" ? body : body.error || "Request failed");
  return body as T;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold ${active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-green-500" : "bg-gray-400"}`} />{label}
  </span>;
}

export default function VpnManagement() {
  const qc = useQueryClient();
  const [routerId, setRouterId] = useState("");
  const [technology, setTechnology] = useState<Technology>("wireguard");
  const [showServerForm, setShowServerForm] = useState(false);
  const [showPeerForm, setShowPeerForm] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [qrPayload, setQrPayload] = useState("");
  const [serverForm, setServerForm] = useState({ name: "", interfaceName: "", listenPort: "13231", address: "", endpoint: "", dnsServers: "" });
  const [peerForm, setPeerForm] = useState({ serverId: "", username: "", secret: "", address: "", allowedIps: "0.0.0.0/0", endpoint: "", customerId: "", expiresAt: "", dryRun: false });

  const adminId = localStorage.getItem("ochola_admin_id") ?? "";
  const routersQuery = useQuery<Router[]>({
    queryKey: ["vpn-management-routers"],
    queryFn: () => api<Router[]>("/api/vpn-management/routers"),
  });
  const overviewQuery = useQuery<Overview>({
    queryKey: ["vpn-management-overview"],
    queryFn: () => api<Overview>("/api/vpn-management/overview"),
    refetchInterval: 15000,
  });
  const capabilityQuery = useQuery<{ capabilities: Capability }>({
    queryKey: ["vpn-management-capabilities", routerId],
    queryFn: () => api(`/api/vpn-management/capabilities?routerId=${routerId}`),
    enabled: !!routerId,
  });
  const overview = overviewQuery.data;
  const routers = routersQuery.data ?? [];
  const servers = overview?.servers ?? [];
  const peers = overview?.peers ?? [];
  const capability = capabilityQuery.data?.capabilities;
  const selectedServer = useMemo(() => servers.find(server => String(server.id) === peerForm.serverId), [servers, peerForm.serverId]);

  const createServer = useMutation({
    mutationFn: () => api("/api/vpn-management/servers", {
      method: "POST",
      body: JSON.stringify({
        routerId: Number(routerId),
        technology,
        name: serverForm.name,
        interfaceName: serverForm.interfaceName || undefined,
        listenPort: technology === "wireguard" ? Number(serverForm.listenPort) : undefined,
        address: serverForm.address || undefined,
        endpoint: serverForm.endpoint || undefined,
        dnsServers: serverForm.dnsServers.split(",").map(s => s.trim()).filter(Boolean),
      }),
    }),
    onSuccess: () => { setMessage({ kind: "ok", text: "VPN server saved after router verification." }); setShowServerForm(false); setServerForm({ name: "", interfaceName: "", listenPort: "13231", address: "", endpoint: "", dnsServers: "" }); qc.invalidateQueries({ queryKey: ["vpn-management-overview"] }); },
    onError: error => setMessage({ kind: "error", text: error.message }),
  });
  const createPeer = useMutation({
    mutationFn: () => api<{ dryRun?: boolean; plan?: { commands: string[][] }; generated?: { publicKey: string } }>("/api/vpn-management/peers", {
      method: "POST",
      body: JSON.stringify({
        serverId: Number(peerForm.serverId),
        username: peerForm.username,
        secret: technology === "wireguard" ? undefined : peerForm.secret,
        address: peerForm.address || undefined,
        allowedIps: peerForm.allowedIps.split(",").map(s => s.trim()).filter(Boolean),
        endpoint: peerForm.endpoint || undefined,
        customerId: peerForm.customerId ? Number(peerForm.customerId) : undefined,
        expiresAt: peerForm.expiresAt || undefined,
        dryRun: peerForm.dryRun,
        technology,
      }),
    }),
    onSuccess: result => {
      if (result.dryRun) setMessage({ kind: "ok", text: `Dry run ready: ${result.plan?.commands.length ?? 0} RouterOS writes would be made.` });
      else { setMessage({ kind: "ok", text: result.generated?.publicKey ? "WireGuard peer created. Download its protected client configuration." : "VPN peer created and verified." }); setShowPeerForm(false); qc.invalidateQueries({ queryKey: ["vpn-management-overview"] }); }
    },
    onError: error => setMessage({ kind: "error", text: error.message }),
  });
  const updatePeer = useMutation({
    mutationFn: ({ peer, enabled }: { peer: Peer; enabled: boolean }) => api(`/api/vpn-management/peers/${peer.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => { setMessage({ kind: "ok", text: "Peer state updated and verified on the router." }); qc.invalidateQueries({ queryKey: ["vpn-management-overview"] }); },
    onError: error => setMessage({ kind: "error", text: error.message }),
  });
  const deletePeer = useMutation({
    mutationFn: (peer: Peer) => api(`/api/vpn-management/peers/${peer.id}`, { method: "DELETE" }),
    onSuccess: () => { setMessage({ kind: "ok", text: "Peer removed from the router and database." }); qc.invalidateQueries({ queryKey: ["vpn-management-overview"] }); },
    onError: error => setMessage({ kind: "error", text: error.message }),
  });
  const reconcile = useMutation({
    mutationFn: () => api<{ changed: number }>("/api/vpn-management/reconcile", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: result => { setMessage({ kind: "ok", text: `Subscription reconciliation completed; ${result.changed} access record(s) changed.` }); qc.invalidateQueries({ queryKey: ["vpn-management-overview"] }); },
    onError: error => setMessage({ kind: "error", text: error.message }),
  });

  async function download(peer: Peer) {
    try {
      const token = getAdminApiToken();
      const response = await fetch(`${API}/api/vpn-management/peers/${peer.id}/config`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${peer.username}.${peer.technology === "wireguard" ? "conf" : "ovpn"}`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setMessage({ kind: "error", text: (error as Error).message }); }
  }

  async function showQr(peer: Peer) {
    try { const result = await api<{ qrPayload: string }>(`/api/vpn-management/peers/${peer.id}/qr-payload`); setQrPayload(result.qrPayload); }
    catch (error) { setMessage({ kind: "error", text: (error as Error).message }); }
  }

  function capabilityEnabled(type: Technology) {
    if (!routerId || !capability) return true;
    return capability[type];
  }

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-blue-600 font-bold uppercase tracking-widest">Network security</p>
            <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2"><Shield className="text-blue-600" size={23} /> VPN Management</h1>
            <p className="text-sm text-gray-500 mt-1">Provision WireGuard, OpenVPN, and IPsec through the selected MikroTik router.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={routerId} onChange={event => setRouterId(event.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select router</option>
              {routers.map(router => <option key={router.id} value={router.id}>{router.name}{router.ros_version ? ` · ROS ${router.ros_version}` : ""}</option>)}
            </select>
            <button onClick={() => reconcile.mutate()} disabled={reconcile.isPending} className="hidden sm:flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:text-blue-600 disabled:opacity-50"><RefreshCw size={14} className={reconcile.isPending ? "animate-spin" : ""} /> Sync access</button>
            <button onClick={() => { overviewQuery.refetch(); routersQuery.refetch(); }} className="p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-blue-600"><RefreshCw size={16} className={overviewQuery.isFetching ? "animate-spin" : ""} /></button>
          </div>
        </div>

        {message && <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}><span>{message.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><span>{message.text}</span><button onClick={() => setMessage(null)} className="ml-auto">×</button></div>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "VPN servers", value: overview?.summary.servers ?? 0, icon: Server, color: "text-blue-600 bg-blue-50" },
            { label: "Users / peers", value: overview?.summary.peers ?? 0, icon: Users, color: "text-purple-600 bg-purple-50" },
            { label: "Active access", value: overview?.summary.active ?? 0, icon: Wifi, color: "text-green-600 bg-green-50" },
            { label: "Audited operations", value: overview?.operations.length ?? 0, icon: Activity, color: "text-orange-600 bg-orange-50" },
          ].map(item => <Card key={item.label} className="p-4"><div className={`w-9 h-9 rounded-lg ${item.color} flex items-center justify-center mb-3`}><item.icon size={17} /></div><p className="text-2xl font-black text-gray-900">{item.value}</p><p className="text-xs text-gray-500 mt-1">{item.label}</p></Card>)}
        </div>

        <Card className="p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div><h2 className="font-bold text-gray-900">Router capabilities</h2><p className="text-xs text-gray-500 mt-1">{routerId ? capabilityQuery.isLoading ? "Reading RouterOS capabilities…" : capability ? `RouterOS ${capability.routerOsVersion} · changes are capability checked before writes` : "Capability check unavailable" : "Select a router to check RouterOS compatibility before provisioning."}</p></div>
            {capability && <div className="flex gap-2 flex-wrap">{(["wireguard", "openvpn", "ipsec"] as Technology[]).map(type => <StatusPill key={type} active={capability[type]} label={`${type}${capability[type] ? " supported" : " unavailable"}`} />)}</div>}
          </div>
        </Card>

        <div className="grid lg:grid-cols-2 gap-5">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div><h2 className="font-bold text-gray-900">Configured VPN servers</h2><p className="text-xs text-gray-500 mt-1">Router-bound control plane records</p></div><button disabled={!routerId} onClick={() => setShowServerForm(value => !value)} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40"><Plus size={14} /> Add server</button></div>
            {showServerForm && <div className="p-5 bg-blue-50/50 border-b border-blue-100 space-y-3">
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Technology<select value={technology} onChange={event => setTechnology(event.target.value as Technology)} className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">{(["wireguard", "openvpn", "ipsec"] as Technology[]).map(type => <option key={type} value={type} disabled={!capabilityEnabled(type)}>{type.toUpperCase()}</option>)}</select></label><label className="text-xs font-semibold text-gray-600">Name<input value={serverForm.name} onChange={event => setServerForm({ ...serverForm, name: event.target.value })} placeholder="branch-vpn" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Interface name<input value={serverForm.interfaceName} onChange={event => setServerForm({ ...serverForm, interfaceName: event.target.value })} placeholder="wg-branch" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-gray-600">Listen port<input type="number" value={serverForm.listenPort} onChange={event => setServerForm({ ...serverForm, listenPort: event.target.value })} className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Address / pool<input value={serverForm.address} onChange={event => setServerForm({ ...serverForm, address: event.target.value })} placeholder="10.20.0.1/24" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-gray-600">Endpoint<input value={serverForm.endpoint} onChange={event => setServerForm({ ...serverForm, endpoint: event.target.value })} placeholder="vpn.example.com:13231" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label></div>
              <label className="text-xs font-semibold text-gray-600 block">DNS servers<input value={serverForm.dnsServers} onChange={event => setServerForm({ ...serverForm, dnsServers: event.target.value })} placeholder="1.1.1.1, 8.8.8.8" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label>
              <div className="flex justify-end gap-2"><button onClick={() => setShowServerForm(false)} className="px-3 py-2 text-xs text-gray-600">Cancel</button><button onClick={() => createServer.mutate()} disabled={!serverForm.name || !routerId || createServer.isPending || !capabilityEnabled(technology)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40">{createServer.isPending ? "Verifying…" : "Create & verify"}</button></div>
            </div>}
            <div className="divide-y divide-gray-100">{servers.length === 0 ? <p className="p-8 text-sm text-gray-400 text-center">No VPN servers registered yet.</p> : servers.map(server => <div key={server.id} className="px-5 py-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center"><Network size={16} className="text-gray-600" /></div><div><p className="font-semibold text-sm text-gray-800">{server.name}</p><p className="text-xs text-gray-500">{server.technology.toUpperCase()} · {server.interface_name || "router-managed"} · router #{server.router_id}</p></div></div><StatusPill active={server.last_status !== "error"} label={server.last_status || "unknown"} /></div>)}</div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div><h2 className="font-bold text-gray-900">Users & peers</h2><p className="text-xs text-gray-500 mt-1">Secrets never appear in this list</p></div><button disabled={servers.length === 0} onClick={() => { setPeerForm({ ...peerForm, serverId: String(servers[0]?.id ?? "") }); setTechnology(servers[0]?.technology ?? "wireguard"); setShowPeerForm(value => !value); }} className="flex items-center gap-1.5 bg-purple-600 text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40"><Plus size={14} /> Add peer</button></div>
            {showPeerForm && <div className="p-5 bg-purple-50/50 border-b border-purple-100 space-y-3">
              <label className="text-xs font-semibold text-gray-600 block">VPN server<select value={peerForm.serverId} onChange={event => { const server = servers.find(item => String(item.id) === event.target.value); setPeerForm({ ...peerForm, serverId: event.target.value }); if (server) setTechnology(server.technology); }} className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">{servers.map(server => <option key={server.id} value={server.id}>{server.name} · {server.technology}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Username<input value={peerForm.username} onChange={event => setPeerForm({ ...peerForm, username: event.target.value })} placeholder="customer-001" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-gray-600">{technology === "wireguard" ? "Password not required" : technology === "ipsec" ? "Pre-shared key" : "Password"}{technology !== "wireguard" && <input type="password" value={peerForm.secret} onChange={event => setPeerForm({ ...peerForm, secret: event.target.value })} className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" />}</label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Assigned address<input value={peerForm.address} onChange={event => setPeerForm({ ...peerForm, address: event.target.value })} placeholder="10.20.0.2/32" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-gray-600">Allowed IPs<input value={peerForm.allowedIps} onChange={event => setPeerForm({ ...peerForm, allowedIps: event.target.value })} className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Endpoint<input value={peerForm.endpoint} onChange={event => setPeerForm({ ...peerForm, endpoint: event.target.value })} placeholder="router.example.com:13231" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-gray-600">Customer ID (optional)<input value={peerForm.customerId} onChange={event => setPeerForm({ ...peerForm, customerId: event.target.value })} placeholder="123" className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label></div>
              <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={peerForm.dryRun} onChange={event => setPeerForm({ ...peerForm, dryRun: event.target.checked })} /> Dry run only — inspect commands without changing the router</label>
              <div className="flex justify-end gap-2"><button onClick={() => setShowPeerForm(false)} className="px-3 py-2 text-xs text-gray-600">Cancel</button><button onClick={() => createPeer.mutate()} disabled={!peerForm.serverId || !peerForm.username || (technology !== "wireguard" && !peerForm.secret) || createPeer.isPending} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40">{createPeer.isPending ? "Processing…" : peerForm.dryRun ? "Preview changes" : "Create & verify"}</button></div>
            </div>}
            <div className="divide-y divide-gray-100 max-h-[420px] overflow-auto">{peers.length === 0 ? <p className="p-8 text-sm text-gray-400 text-center">No users or peers yet.</p> : peers.map(peer => <div key={peer.id} className="px-5 py-3.5 flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><KeyRound size={14} className="text-purple-500 shrink-0" /><p className="text-sm font-semibold text-gray-800 truncate">{peer.username}</p><span className="text-[10px] uppercase font-bold text-gray-400">{peer.technology}</span></div><p className="text-xs text-gray-500 mt-1">{peer.assigned_ip || "No address"} {peer.public_key ? `· ${peer.public_key.slice(0, 10)}…` : ""}</p></div><div className="flex items-center gap-1 shrink-0"><StatusPill active={peer.is_active} label={peer.is_active ? "Active" : "Disabled"} />{peer.technology !== "ipsec" && <button title="Download client config" onClick={() => download(peer)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Download size={14} /></button>}{peer.technology === "wireguard" && <button title="Show QR payload" onClick={() => showQr(peer)} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded"><Copy size={14} /></button>}<button title={peer.is_active ? "Disable" : "Enable"} onClick={() => updatePeer.mutate({ peer, enabled: !peer.is_active })} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"><Wifi size={14} /></button><button title="Delete peer" onClick={() => { if (window.confirm(`Delete ${peer.username}? This changes the router.`)) deletePeer.mutate(peer); }} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button></div></div>)}</div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <button onClick={() => setShowAudit(value => !value)} className="w-full px-5 py-4 flex items-center justify-between text-left"><span className="flex items-center gap-2 font-bold text-gray-900"><Activity size={16} className="text-orange-500" /> Provisioning activity</span><span className="text-xs text-gray-500">{showAudit ? "Hide" : "Show"} recent operations</span></button>
          {showAudit && <div className="border-t border-gray-100 divide-y divide-gray-100">{(overview?.operations ?? []).map(log => <div key={log.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs"><div><span className="font-semibold text-gray-700">{log.operation}</span><span className="text-gray-400 ml-2">{log.technology} · {log.mode}</span><p className="text-gray-400 mt-1">{new Date(log.created_at).toLocaleString()}</p></div><span className={log.status === "succeeded" ? "text-green-600" : log.status === "failed" ? "text-red-600" : "text-orange-600"}>{log.status}{log.error ? ` · ${log.error}` : ""}</span></div>)}</div>}
        </Card>

        {qrPayload && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setQrPayload("")}><Card className="max-w-xl w-full p-5"><div onClick={event => event.stopPropagation()}><div className="flex items-center justify-between mb-3"><h2 className="font-bold text-gray-900 flex items-center gap-2"><LockKeyhole size={16} className="text-purple-600" /> Protected WireGuard payload</h2><button onClick={() => setQrPayload("")} className="text-gray-400 text-xl">×</button></div><p className="text-xs text-gray-500 mb-3">This payload contains the client private key. Use it only with a trusted QR encoder or WireGuard client, and do not share it in logs.</p><pre className="bg-gray-950 text-green-300 rounded-lg p-4 text-[11px] overflow-auto max-h-80 whitespace-pre-wrap">{qrPayload}</pre><button onClick={() => navigator.clipboard.writeText(qrPayload)} className="mt-3 w-full bg-purple-600 text-white rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-2"><Copy size={14} /> Copy payload</button></div></Card></div>}
      </div>
    </AdminLayout>
  );
}