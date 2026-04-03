import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import VpnLayout from "./VpnLayout";
import {
  Lock, Shield, Eye, EyeOff, Copy, Check, Download, Trash2,
  Search, Circle, Key, Wifi, Clock,
  CheckCircle2, XCircle, Plus, RefreshCw, ToggleLeft, ToggleRight,
  User, AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";

const API = import.meta.env.VITE_API_BASE ?? "";

function getAdminId() {
  return localStorage.getItem("ochola_admin_id") ?? "1";
}

type VpnUser = {
  id: number;
  username: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  expires_at?: string;
};

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }}
      className="text-gray-400 hover:text-blue-600 transition-colors p-1"
    >
      {done ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function VpnList() {
  const qc = useQueryClient();
  const adminId = getAdminId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "expired">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", password: "ocholasupernet", notes: "" });
  const [showPass, setShowPass] = useState(false);

  const { data: users = [], isLoading, refetch } = useQuery<VpnUser[]>({
    queryKey: ["vpn-users-list", adminId],
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
    onSuccess: () => {
      setShowCreate(false);
      setForm({ username: "", password: "ocholasupernet", notes: "" });
      qc.invalidateQueries({ queryKey: ["vpn-users-list"] });
      qc.invalidateQueries({ queryKey: ["vpn-users"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/api/vpn/users/${id}/toggle`, { method: "PATCH" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vpn-users-list"] });
      qc.invalidateQueries({ queryKey: ["vpn-users"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/api/vpn/users/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vpn-users-list"] });
      qc.invalidateQueries({ queryKey: ["vpn-users"] });
    },
  });

  function downloadOvpn(id: number, username: string) {
    window.open(`${API}/api/vpn/users/${id}/ovpn`, "_blank");
  }

  const filtered = users.filter(v => {
    const matchSearch =
      v.username.toLowerCase().includes(search.toLowerCase()) ||
      (v.notes ?? "").toLowerCase().includes(search.toLowerCase());
    const expired = isExpired(v.expires_at);
    const matchFilter =
      filter === "all" ||
      (filter === "active"   && v.is_active && !expired) ||
      (filter === "inactive" && !v.is_active) ||
      (filter === "expired"  && expired);
    return matchSearch && matchFilter;
  });

  const active   = users.filter(v => v.is_active && !isExpired(v.expires_at)).length;
  const inactive = users.filter(v => !v.is_active).length;
  const expired  = users.filter(v => isExpired(v.expires_at)).length;

  return (
    <VpnLayout breadcrumb="VPN Users">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Lock size={20} className="text-blue-600" /> VPN Users
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage OpenVPN credentials — download configs, revoke or toggle access
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <Plus size={15} /> New VPN User
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total",    value: users.length,  color: "text-gray-800",   border: "border-gray-200"  },
            { label: "Active",   value: active,         color: "text-green-600", border: "border-green-200" },
            { label: "Inactive", value: inactive,       color: "text-orange-500",border: "border-orange-200"},
            { label: "Expired",  value: expired,        color: "text-red-500",   border: "border-red-200"   },
          ].map(c => (
            <div key={c.label} className={`bg-white rounded-xl border ${c.border} p-4 text-center shadow-sm`}>
              <p className={`text-3xl font-black ${c.color}`}>{c.value}</p>
              <p className="text-xs text-gray-400 font-medium mt-1">{c.label}</p>
            </div>
          ))}
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Plus size={15} className="text-blue-500" />
              <span className="font-bold text-gray-800">Create VPN User</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Username <span className="text-red-400">*</span></label>
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <User size={13} className="text-gray-400" />
                    <input
                      value={form.username}
                      onChange={e => setForm(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
                      placeholder="e.g. router-nairobi"
                      className="flex-1 text-sm font-mono outline-none bg-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Password <span className="text-red-400">*</span></label>
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <Key size={13} className="text-gray-400" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={form.password}
                      onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                      className="flex-1 text-sm font-mono outline-none bg-transparent"
                    />
                    <button onClick={() => setShowPass(v => !v)} className="text-gray-400 hover:text-gray-600">
                      {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notes (optional)</label>
                <input
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g. Nairobi office router"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-2 justify-end pt-1">
                <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={() => createMutation.mutate(form)}
                  disabled={!form.username || !form.password || createMutation.isPending}
                  className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? <><RefreshCw size={13} className="animate-spin" /> Creating…</> : <><Plus size={13} /> Create User</>}
                </button>
              </div>
              {createMutation.isError && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {(createMutation.error as Error).message}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Search + filter */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by username or notes…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(["all", "active", "inactive", "expired"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg capitalize transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* VPN users table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              <RefreshCw size={20} className="animate-spin mx-auto mb-2 opacity-40" />
              Loading VPN users…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 text-gray-400">
              <Lock size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">{users.length === 0 ? "No VPN users yet." : "No users match your search."}</p>
              {users.length === 0 && (
                <button onClick={() => setShowCreate(true)} className="text-xs text-blue-600 hover:underline mt-2 inline-block">
                  Create your first VPN user →
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Notes</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Created</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Expires</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(v => {
                  const exp = isExpired(v.expires_at);
                  const statusLabel = exp ? "Expired" : v.is_active ? "Active" : "Inactive";
                  const statusStyle = exp
                    ? "bg-red-100 text-red-500"
                    : v.is_active
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500";
                  const dotColor = exp ? "fill-red-500 text-red-500" : v.is_active ? "fill-green-500 text-green-500" : "fill-gray-400 text-gray-400";

                  return (
                    <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                            <Shield size={14} className="text-blue-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800 text-xs font-mono">{v.username}</p>
                            <p className="text-gray-400 text-[11px]">ID #{v.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span className="text-xs text-gray-500 truncate max-w-[160px] block">{v.notes || <span className="text-gray-300">—</span>}</span>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock size={11} /> {new Date(v.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          {v.expires_at ? (
                            <><Clock size={11} className={exp ? "text-red-400" : ""} /> {new Date(v.expires_at).toLocaleDateString()}</>
                          ) : (
                            <span className="text-gray-300">Never</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${statusStyle}`}>
                          <Circle size={5} className={dotColor} />
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => downloadOvpn(v.id, v.username)}
                            title="Download .ovpn config"
                            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <Download size={12} /> .ovpn
                          </button>
                          <button
                            onClick={() => toggleMutation.mutate(v.id)}
                            title={v.is_active ? "Deactivate" : "Activate"}
                            disabled={toggleMutation.isPending}
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors"
                          >
                            {v.is_active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} />}
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete VPN user "${v.username}"? This cannot be undone.`)) deleteMutation.mutate(v.id); }}
                            title="Revoke & delete"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Protocol info */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "OpenVPN / TCP",  desc: "Works through corporate firewalls. Download .ovpn and import into your OpenVPN client.", color: "bg-orange-50 border-orange-200 text-orange-600" },
            { label: "MikroTik",       desc: "Use the .ovpn file on RouterOS → PPP → Import to bring the router into the VPN tunnel.", color: "bg-blue-50 border-blue-200 text-blue-600" },
            { label: "Windows / Mac",  desc: "Install OpenVPN client, import the .ovpn file, and connect. VPN IPs are in the 10.8.0.x range.", color: "bg-green-50 border-green-200 text-green-600" },
          ].map(p => (
            <div key={p.label} className={`${p.color} border rounded-xl p-4`}>
              <p className={`font-bold text-sm mb-1`}>{p.label}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </VpnLayout>
  );
}
