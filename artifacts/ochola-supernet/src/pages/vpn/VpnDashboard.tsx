import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Bell, Shield, Zap, Lock, Circle, CheckCircle2,
  MonitorPlay, Wifi, Send, Users, ArrowRight,
  RefreshCw, Server, AlertTriangle, Globe,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE ?? "";

function getAdminId() {
  return localStorage.getItem("ochola_admin_id") ?? "1";
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

type VpnUser = { id: number; username: string; is_active: boolean; expires_at?: string; created_at: string };
type IpMapClient = { vpnIp: string; connected: boolean; realAddr?: string; since?: string };
type IpMapResult = {
  clients: Record<string, IpMapClient>;
  total: number;
  connected: number;
  ippPath: string | null;
  statusPath: string | null;
};

const QUICK_LINKS = [
  { label: "Remote Access",   href: "/admin/vpn/remote-access", icon: Wifi,        color: "bg-green-500 hover:bg-green-600",   desc: "Connect to MikroTik routers via VPN tunnel" },
  { label: "Create VPN",      href: "/admin/vpn/create",        icon: Send,        color: "bg-amber-500 hover:bg-amber-600",   desc: "Add a new VPN user and get the .ovpn file" },
  { label: "VPN Users",       href: "/admin/vpn/list",          icon: Users,       color: "bg-blue-600 hover:bg-blue-700",     desc: "View and manage all VPN accounts" },
  { label: "Video Tutorials", href: "/admin/vpn/tutorials",     icon: MonitorPlay, color: "bg-green-600 hover:bg-green-700",   desc: "Learn how to configure VPN and MikroTik" },
];

const ANNOUNCEMENTS = [
  { id: 1, date: "Apr 2026", title: "OpenVPN TCP — AES-256 enabled", body: "All VPN connections now use AES-256-CBC cipher with SHA1 auth. Download fresh .ovpn configs from VPN Users." },
  { id: 2, date: "Mar 2026", title: "Auto IP Sync available", body: "Use 'Remote Access → Auto Fix IPs' to automatically match router names to their VPN tunnel IPs." },
];

function ConnectedClientRow({ name, info }: { name: string; info: IpMapClient }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${info.connected ? "bg-green-500" : "bg-gray-300"}`} />
        <div>
          <p className="text-sm font-semibold text-gray-800 font-mono">{name}</p>
          {info.realAddr && <p className="text-xs text-gray-400">Real: {info.realAddr}</p>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-mono text-gray-600">{info.vpnIp}</p>
        <p className={`text-[11px] font-semibold ${info.connected ? "text-green-500" : "text-gray-400"}`}>
          {info.connected ? "Connected" : "Assigned"}
        </p>
      </div>
    </div>
  );
}

export default function VpnDashboard() {
  const adminId = getAdminId();

  const { data: users = [], isLoading: usersLoading } = useQuery<VpnUser[]>({
    queryKey: ["vpn-users-dash", adminId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/vpn/users?adminId=${adminId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: ipMap, isLoading: ipLoading } = useQuery<IpMapResult>({
    queryKey: ["vpn-ip-map"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/vpn/ip-map`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: vpnStatus } = useQuery<{ ca_cert_available: boolean; server_port: number; proto: string }>({
    queryKey: ["vpn-status"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/vpn/status`);
      return r.json();
    },
  });

  const activeUsers   = users.filter(u => u.is_active).length;
  const connectedNow  = ipMap?.connected ?? 0;
  const totalKnown    = ipMap?.total ?? 0;
  const serverReady   = vpnStatus?.ca_cert_available ?? false;

  const clientEntries = Object.entries(ipMap?.clients ?? {}).slice(0, 8);

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">

          {/* Page title */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800">VPN Management</h1>
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${serverReady ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                <div className={`w-2 h-2 rounded-full ${serverReady ? "bg-green-500" : "bg-gray-400"}`} />
                {serverReady ? "VPN Server Ready" : "Server Not Detected"}
              </div>
            </div>
          </div>

          {/* ── STAT CARDS ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Greeting Card */}
            <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl overflow-hidden p-5 flex flex-col justify-between min-h-[130px]">
              <div className="z-10 relative">
                <p className="text-white font-bold text-lg leading-tight">{getGreeting()}</p>
                <p className="text-blue-100 text-xs mt-1">VPN Remote Access Portal</p>
              </div>
              <div className="flex items-center gap-1.5 mt-4">
                <Globe size={14} className="text-blue-200" />
                <span className="text-blue-200 text-xs font-mono">vpn.isplatty.org</span>
              </div>
            </div>

            {/* VPN Users card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[130px]">
              <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">VPN Users</p>
              {usersLoading
                ? <div className="animate-pulse flex-1 bg-gray-700 rounded mt-2" />
                : <>
                    <span className="text-white font-bold text-3xl">{users.length}</span>
                    <span className="text-green-400 text-xs font-semibold flex items-center gap-1"><CheckCircle2 size={12} /> {activeUsers} active</span>
                  </>
              }
            </div>

            {/* VPN Tunnel card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[130px]">
              <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">Tunnel Clients</p>
              {ipLoading
                ? <div className="animate-pulse flex-1 bg-gray-700 rounded mt-2" />
                : <>
                    <span className={`font-bold text-3xl ${connectedNow > 0 ? "text-green-400" : "text-gray-400"}`}>{connectedNow}</span>
                    <span className="text-gray-400 text-xs">of {totalKnown} connected now</span>
                  </>
              }
            </div>

            {/* Server status card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[130px]">
              <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">OpenVPN Server</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-3 h-3 rounded-full ${serverReady ? "bg-green-500" : "bg-red-500"}`} />
                <span className={`font-bold text-sm ${serverReady ? "text-green-400" : "text-red-400"}`}>
                  {serverReady ? "CA Cert Ready" : "Not Configured"}
                </span>
              </div>
              {vpnStatus && (
                <span className="text-gray-400 text-xs font-mono">Port {vpnStatus.server_port} / {vpnStatus.proto.toUpperCase()}</span>
              )}
              {!serverReady && (
                <Link href="/admin/vpn/settings" className="text-xs text-blue-400 hover:underline mt-1">Setup guide →</Link>
              )}
            </div>
          </div>

          {/* ── QUICK ACCESS CARDS ───────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {QUICK_LINKS.map(ql => {
              const Icon = ql.icon;
              return (
                <Link key={ql.href} href={ql.href}
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all group cursor-pointer block">
                  <div className={`w-10 h-10 rounded-xl ${ql.color} flex items-center justify-center mb-3 transition-transform group-hover:scale-110`}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <p className="font-bold text-gray-800 text-sm">{ql.label}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{ql.desc}</p>
                  <div className="flex items-center gap-1 text-blue-600 text-xs font-semibold mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    Open <ArrowRight size={12} />
                  </div>
                </Link>
              );
            })}
          </div>

          {/* ── BOTTOM PANELS ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Live Tunnel Map */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-4 border-b pb-3">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <Server size={15} className="text-blue-500" /> VPN Tunnel Map
                </h2>
                {ipLoading && <RefreshCw size={13} className="animate-spin text-gray-400" />}
                {ipMap && (
                  <span className="text-xs text-gray-400">{connectedNow}/{totalKnown} connected</span>
                )}
              </div>
              {!ipMap && !ipLoading && (
                <div className="flex flex-col items-center justify-center h-28 text-gray-400 text-center">
                  <AlertTriangle size={24} className="opacity-30 mb-2" />
                  <p className="text-sm">No VPN IP data</p>
                  <p className="text-xs text-gray-400 mt-1">OpenVPN server not configured or <span className="font-mono">ipp.txt</span> not found</p>
                </div>
              )}
              {ipMap && clientEntries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-28 text-gray-400">
                  <Lock size={28} className="opacity-20 mb-2" />
                  <p className="text-sm">No tunnel clients yet</p>
                  <p className="text-xs mt-1">Clients appear here after connecting via OpenVPN</p>
                </div>
              )}
              {clientEntries.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {clientEntries.map(([name, info]) => (
                    <ConnectedClientRow key={name} name={name} info={info} />
                  ))}
                </div>
              )}
              {ipMap && Object.keys(ipMap.clients).length > 8 && (
                <div className="mt-3 text-center">
                  <Link href="/admin/vpn/remote-access" className="text-xs text-blue-600 hover:underline">
                    View all {Object.keys(ipMap.clients).length} clients →
                  </Link>
                </div>
              )}
            </div>

            {/* Announcements */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <h2 className="font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
                <Bell size={16} className="text-blue-500" />
                VPN Announcements
              </h2>
              <div className="space-y-4">
                {ANNOUNCEMENTS.map(a => (
                  <div key={a.id} className="border-l-2 border-blue-400 pl-3">
                    <p className="text-[11px] text-gray-400 mb-0.5">{a.date}</p>
                    <p className="text-sm font-semibold text-gray-700">{a.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.body}</p>
                  </div>
                ))}
              </div>

              {/* Recent VPN users */}
              {users.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Recent VPN Users</p>
                  <div className="space-y-2">
                    {users.slice(0, 4).map(u => (
                      <div key={u.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                            <Shield size={10} className="text-blue-500" />
                          </div>
                          <span className="font-mono font-semibold text-gray-700">{u.username}</span>
                        </div>
                        <span className={`font-semibold px-1.5 py-0.5 rounded-full ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Link href="/admin/vpn/list" className="text-xs text-blue-600 hover:underline mt-3 inline-flex items-center gap-1">
                    All users <ArrowRight size={11} />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Setup warning if not configured */}
          {!serverReady && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">OpenVPN Server Not Configured</p>
                <p className="text-amber-700 text-sm mt-1">
                  The VPN user management system is ready, but your VPS does not yet have OpenVPN installed and the CA certificate is not present.
                  You can still create VPN users and download <span className="font-mono">.ovpn</span> config files —
                  they will work as soon as you configure OpenVPN on your VPS.
                </p>
                <Link href="/admin/vpn/settings" className="text-xs font-semibold text-amber-700 underline mt-2 inline-block">
                  View OpenVPN Server Setup Guide →
                </Link>
              </div>
            </div>
          )}
        </div>
    </AdminLayout>
  );
}
