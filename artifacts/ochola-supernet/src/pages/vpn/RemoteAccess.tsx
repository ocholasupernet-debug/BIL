import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import VpnLayout from "./VpnLayout";
import {
  Router, Wifi, Terminal, Globe, Key, Eye, EyeOff, Copy, Check,
  RefreshCw, Circle, AlertTriangle, Plus, Trash2, Download,
  User, Lock, FileText, ShieldCheck, ChevronDown, ChevronUp,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";

function getAdminId() {
  return localStorage.getItem("ochola_admin_id") ?? "1";
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); }}
      title={`Copy ${label}`} className="text-gray-400 hover:text-blue-600 transition-colors">
      {done ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const on = status === "online";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${on ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
      <Circle size={6} className={on ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"} />
      {on ? "Online" : "Offline"}
    </span>
  );
}

type DbRouter = {
  id: number; name: string; host: string; bridge_ip: string;
  router_username: string; status: string; model?: string;
  ros_version?: string; last_seen?: string;
};

function RouterCard({ r }: { r: DbRouter }) {
  const [expanded, setExpanded] = useState(false);
  const online = r.status === "online";
  const vpnIp = r.bridge_ip || r.host || "—";

  return (
    <div className={`bg-white rounded-xl shadow-sm border ${online ? "border-gray-200" : "border-red-200"} overflow-hidden`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${online ? "bg-blue-50" : "bg-red-50"}`}>
            <Router size={20} className={online ? "text-blue-600" : "text-red-400"} />
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">{r.name}</p>
            <p className="text-xs text-gray-400 font-mono">{vpnIp}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={r.status} />
          <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-wrap gap-2">
        <a href={`winbox://${vpnIp}:8291`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none"}`}>
          <Router size={12} /> Winbox
        </a>
        <a href={online ? `http://${vpnIp}` : "#"} target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-green-500 hover:bg-green-600 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none"}`}>
          <Globe size={12} /> WebFig
        </a>
        <button onClick={() => online && alert(`ssh ${r.router_username || "admin"}@${vpnIp}`)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-gray-700 hover:bg-gray-800 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
          disabled={!online}>
          <Terminal size={12} /> SSH
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Key size={11} /> Access Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {[
              { label: "VPN Tunnel IP", value: r.bridge_ip || "—" },
              { label: "Public WAN IP", value: r.host || "—" },
              { label: "Username", value: r.router_username || "admin" },
              { label: "Model", value: r.model || "—" },
              { label: "RouterOS", value: r.ros_version || "—" },
              { label: "Last Seen", value: r.last_seen ? new Date(r.last_seen).toLocaleString() : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-gray-400 font-medium mb-0.5">{label}</p>
                <div className="flex items-center gap-1.5 bg-white border rounded px-2 py-1 font-mono text-gray-700">
                  <span className="flex-1 truncate">{value}</span>
                  {value !== "—" && <CopyBtn text={value} label={label} />}
                </div>
              </div>
            ))}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mt-2">
            <p className="font-semibold mb-1 flex items-center gap-1"><ShieldCheck size={12} /> VPN Required</p>
            <p>Connect via the VPN tunnel before using Winbox or WebFig. The VPN IP (<span className="font-mono">{r.bridge_ip}</span>) is only reachable through the tunnel.</p>
          </div>
        </div>
      )}
    </div>
  );
}

type VpnUser = {
  id: number; username: string; notes?: string;
  is_active: boolean; created_at: string; expires_at?: string;
};

const DEFAULT_PASSWORD = "ocholasupernet";

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function VpnUsersSection({ routers }: { routers: DbRouter[] }) {
  const qc = useQueryClient();
  const adminId = getAdminId();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", password: DEFAULT_PASSWORD, notes: "" });
  const [showPass, setShowPass] = useState(false);
  const [visiblePasses, setVisiblePasses] = useState<Record<number, boolean>>({});
  const [userPasswords, setUserPasswords] = useState<Record<number, string>>({});
  const [bulkCreating, setBulkCreating] = useState(false);

  const { data: users = [], isLoading, refetch } = useQuery<VpnUser[]>({
    queryKey: ["vpn-users", adminId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/vpn/users?adminId=${adminId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch(`${API}/api/vpn/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, ...data }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (created) => {
      setUserPasswords(p => ({ ...p, [created.id]: form.password }));
      setShowCreate(false);
      setForm({ username: "", password: DEFAULT_PASSWORD, notes: "" });
      qc.invalidateQueries({ queryKey: ["vpn-users"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/api/vpn/users/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vpn-users"] }),
  });

  async function bulkCreateFromRouters() {
    if (!routers.length) return;
    setBulkCreating(true);
    for (const r of routers) {
      const username = slugify(r.name);
      try {
        await fetch(`${API}/api/vpn/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminId, username, password: DEFAULT_PASSWORD, notes: `Auto — ${r.name}` }),
        });
      } catch { /* skip duplicates */ }
    }
    setBulkCreating(false);
    qc.invalidateQueries({ queryKey: ["vpn-users"] });
  }

  function downloadOvpn(user: VpnUser) {
    window.open(`${API}/api/vpn/users/${user.id}/ovpn`, "_blank");
  }

  function pickRouter(name: string) {
    setForm(p => ({ ...p, username: slugify(name), notes: `Router — ${name}` }));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-blue-500" />
          <span className="font-bold text-gray-800">VPN Users</span>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{users.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100">
            <RefreshCw size={14} />
          </button>
          {routers.length > 0 && (
            <button onClick={bulkCreateFromRouters} disabled={bulkCreating}
              className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
              {bulkCreating ? <RefreshCw size={12} className="animate-spin" /> : <Router size={12} />}
              {bulkCreating ? "Creating…" : "All Routers"}
            </button>
          )}
          <button onClick={() => { setShowCreate(true); setForm({ username: "", password: DEFAULT_PASSWORD, notes: "" }); }}
            className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={13} /> New User
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border-b border-gray-100 bg-blue-50/50 px-5 py-4 space-y-3">
          <p className="text-sm font-bold text-gray-700 flex items-center gap-2"><Plus size={14} className="text-blue-500" /> Create VPN User</p>

          {/* Router quick-pick */}
          {routers.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Pick a router (auto-fills username)</label>
              <div className="flex flex-wrap gap-2">
                {routers.map(r => (
                  <button key={r.id} onClick={() => pickRouter(r.name)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors font-mono ${form.username === slugify(r.name) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"}`}>
                    <Router size={11} /> {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Username</label>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <User size={13} className="text-gray-400" />
                <input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  placeholder="e.g. come1"
                  className="flex-1 text-sm font-mono outline-none bg-transparent" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Password</label>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <Lock size={13} className="text-gray-400" />
                <input type={showPass ? "text" : "password"} value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  className="flex-1 text-sm font-mono outline-none bg-transparent" />
                <button onClick={() => setShowPass(v => !v)} className="text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button onClick={() => setForm(p => ({ ...p, password: DEFAULT_PASSWORD }))}
                  title="Reset to default" className="text-gray-400 hover:text-blue-600 text-[10px] font-bold">
                  reset
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Notes (optional)</label>
            <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="e.g. come1 router access"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowCreate(false)}
              className="px-4 py-1.5 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={() => createMutation.mutate(form)}
              disabled={!form.username || !form.password || createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors">
              {createMutation.isPending ? "Creating…" : <><Plus size={13} /> Create</>}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{(createMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <div className="px-5 py-8 text-center text-gray-400 text-sm">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <Key size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No VPN users yet</p>
          <p className="text-xs text-gray-400 mt-1">Create a user to generate a .ovpn config file</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {users.map(u => {
            const pass = userPasswords[u.id];
            const passVisible = visiblePasses[u.id];
            return (
              <div key={u.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <User size={15} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800 text-sm font-mono">{u.username}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {u.notes && <p className="text-xs text-gray-400 truncate">{u.notes}</p>}
                  {pass && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-gray-400">Password:</span>
                      <span className="font-mono text-xs text-gray-700">{passVisible ? pass : "•".repeat(pass.length)}</span>
                      <button onClick={() => setVisiblePasses(p => ({ ...p, [u.id]: !p[u.id] }))} className="text-gray-400 hover:text-gray-600">
                        {passVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                      <CopyBtn text={pass} label="password" />
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">Created {new Date(u.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => downloadOvpn(u)} title="Download .ovpn config"
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors">
                    <Download size={12} /> .ovpn
                  </button>
                  <button onClick={() => { if (confirm(`Delete VPN user "${u.username}"?`)) deleteMutation.mutate(u.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-5 py-3 bg-amber-50 border-t border-amber-100">
        <p className="text-xs text-amber-700 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>After creating users, add <span className="font-mono font-bold">auth-user-pass-verify /etc/openvpn/check-auth.sh via-file</span> and <span className="font-mono font-bold">script-security 2</span> to your OpenVPN server config, then restart OpenVPN.</span>
        </p>
      </div>
    </div>
  );
}

export default function RemoteAccess() {
  const adminId = getAdminId();
  const [tab, setTab] = useState<"routers" | "users">("routers");

  const { data: routers = [], isLoading, refetch } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_remote", adminId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/routers?adminId=${adminId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const online = routers.filter(r => r.status === "online").length;

  return (
    <VpnLayout breadcrumb="Remote Access">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Wifi size={20} className="text-green-500" /> Remote Access
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage routers and VPN user credentials</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center bg-white rounded-xl px-4 py-2 shadow-sm border border-gray-200">
              <p className="text-xs text-gray-400 font-medium">Online</p>
              <p className="font-bold text-green-600 text-lg">{online}/{routers.length}</p>
            </div>
            <button onClick={() => refetch()} className="flex items-center gap-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-lg transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {/* VPN banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">VPN Connection Required</p>
            <p className="text-amber-700 text-xs mt-0.5">
              Router VPN IPs (<span className="font-mono">10.8.0.x</span>) are only reachable through the OpenVPN tunnel.
              Connect your device to the VPN before accessing Winbox or WebFig.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {([["routers", Router, "Routers"], ["users", Key, "VPN Users"]] as const).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key as any)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Routers tab */}
        {tab === "routers" && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-10 text-gray-400 text-sm">Loading routers…</div>
            ) : routers.length === 0 ? (
              <div className="text-center py-10">
                <Router size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No routers added yet</p>
              </div>
            ) : (
              routers.map(r => <RouterCard key={r.id} r={r} />)
            )}

            {/* Connection methods info */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><FileText size={15} className="text-gray-500" /> Connection Methods</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { Icon: Router, title: "Winbox", color: "bg-orange-100 text-orange-500", desc: "Native MikroTik app. Best for full router management." },
                  { Icon: Globe, title: "WebFig", color: "bg-green-100 text-green-500", desc: "Browser-based management, no software install required." },
                  { Icon: Terminal, title: "SSH", color: "bg-gray-100 text-gray-600", desc: "Command-line access. Great for scripting and automation." },
                  { Icon: Key, title: "VPN .ovpn", color: "bg-blue-100 text-blue-500", desc: "OpenVPN config file for secure remote access anywhere." },
                ].map(({ Icon, title, color, desc }) => (
                  <div key={title} className="flex items-start gap-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 ${color}`}><Icon size={12} /></div>
                    <div><p className="font-semibold text-gray-700">{title}</p><p className="text-xs text-gray-500">{desc}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VPN Users tab */}
        {tab === "users" && <VpnUsersSection routers={routers} />}
      </div>
    </VpnLayout>
  );
}
