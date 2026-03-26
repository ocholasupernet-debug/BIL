import { useState } from "react";
import VpnLayout from "./VpnLayout";
import {
  Lock, Shield, Eye, EyeOff, Copy, Check, Download, Trash2,
  RefreshCw, Search, Filter, Circle, Key, Wifi, Clock,
  CheckCircle2, XCircle, Plus,
} from "lucide-react";
import { Link } from "wouter";

const ALL_VPNS = [
  { id: 1,  name: "Kenya-VPN-01",    owner: "Chrisphine Ochola", server: "ke1.vpn.isplatty.org",  protocol: "WireGuard", status: "active",  created: "2026-01-10", expires: "2026-07-10", bandwidth: "10 Mbps",  key: "wgkey-01-abc123def456xyz7890qrstuv" },
  { id: 2,  name: "Kenya-VPN-02",    owner: "Chrisphine Ochola", server: "ke2.vpn.isplatty.org",  protocol: "OpenVPN",   status: "active",  created: "2026-02-05", expires: "2026-08-05", bandwidth: "20 Mbps",  key: "ovpnkey-02-pqr789stu012vwx345yz" },
  { id: 3,  name: "Nairobi-Staff-01",owner: "Jane Wanjiku",      server: "nbi.vpn.isplatty.org",  protocol: "WireGuard", status: "active",  created: "2026-03-01", expires: "2026-09-01", bandwidth: "5 Mbps",   key: "wgkey-03-lmnopq456rst789uvw012" },
  { id: 4,  name: "Kisumu-Mgr-VPN",  owner: "Otieno Fred",       server: "ksm.vpn.isplatty.org",  protocol: "IKEv2",     status: "expired", created: "2025-06-01", expires: "2026-01-01", bandwidth: "10 Mbps",  key: "ikev2-04-zyxwvutsrqponmlkjih" },
  { id: 5,  name: "Nakuru-Tech-01",  owner: "Kamau Brian",       server: "nkr.vpn.isplatty.org",  protocol: "WireGuard", status: "active",  created: "2026-03-10", expires: "2026-09-10", bandwidth: "20 Mbps",  key: "wgkey-05-abcdef789ghijkl012mnop" },
];

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }}
      className="text-gray-400 hover:text-blue-600 transition-colors p-1">
      {done ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

export default function VpnList() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expired">("all");
  const [visibleKey, setVisibleKey] = useState<number | null>(null);

  const vpns = ALL_VPNS.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
                        v.owner.toLowerCase().includes(search.toLowerCase()) ||
                        v.protocol.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || v.status === filter;
    return matchSearch && matchFilter;
  });

  const active  = ALL_VPNS.filter(v => v.status === "active").length;
  const expired = ALL_VPNS.filter(v => v.status === "expired").length;

  function downloadConfig(vpn: typeof ALL_VPNS[0]) {
    const cfg = vpn.protocol === "WireGuard"
      ? `[Interface]\nPrivateKey = ${vpn.key}\nAddress = 10.8.0.2/24\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = SERVER_PUBLIC_KEY\nEndpoint = ${vpn.server}:51820\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25`
      : `client\ndev tun\nproto udp\nremote ${vpn.server} 1194\nresolv-retry infinite\nnobind\npersist-key\npersist-tun\nca ca.crt\ncert client.crt\nkey client.key\nverb 3`;
    const blob = new Blob([cfg], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${vpn.name}.${vpn.protocol === "WireGuard" ? "conf" : "ovpn"}`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <VpnLayout breadcrumb="VPN Lists">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Lock size={20} className="text-blue-600" /> VPN Accounts
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">All VPN accounts under your ISP — manage, download configs, revoke access</p>
          </div>
          <Link href="/vpn/create"
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm">
            <Plus size={15} /> New VPN
          </Link>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-gray-800">{ALL_VPNS.length}</p>
            <p className="text-xs text-gray-400 font-medium mt-1">Total VPNs</p>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-green-600">{active}</p>
            <p className="text-xs text-gray-400 font-medium mt-1 flex items-center justify-center gap-1"><CheckCircle2 size={11} className="text-green-500" /> Active</p>
          </div>
          <div className="bg-white rounded-xl border border-red-200 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-red-500">{expired}</p>
            <p className="text-xs text-gray-400 font-medium mt-1 flex items-center justify-center gap-1"><XCircle size={11} className="text-red-400" /> Expired</p>
          </div>
        </div>

        {/* Search + filter */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, owner, protocol…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            {(["all", "active", "expired"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg capitalize transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* VPN table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">VPN Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Protocol</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Server</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Expires</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Key</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vpns.map(v => (
                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Shield size={13} className="text-blue-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 text-xs">{v.name}</p>
                        <p className="text-gray-400 text-[11px]">{v.owner}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${v.protocol === "WireGuard" ? "bg-purple-100 text-purple-700" : v.protocol === "OpenVPN" ? "bg-orange-100 text-orange-700" : "bg-teal-100 text-teal-700"}`}>
                      {v.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <span className="font-mono text-xs text-gray-500">{v.server}</span>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock size={11} /> {v.expires}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${v.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-500"}`}>
                      <Circle size={5} className={v.status === "active" ? "fill-green-500" : "fill-red-500"} />
                      {v.status === "active" ? "Active" : "Expired"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1 max-w-[140px]">
                      <Key size={10} className="text-gray-400 shrink-0" />
                      <span className="font-mono text-[10px] text-gray-500 truncate flex-1">
                        {visibleKey === v.id ? v.key : "••••••••••••••••"}
                      </span>
                      <button onClick={() => setVisibleKey(k => k === v.id ? null : v.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
                        {visibleKey === v.id ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                      <CopyBtn text={v.key} />
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => downloadConfig(v)} title="Download config" className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors">
                        <Download size={14} />
                      </button>
                      <button title="Revoke VPN" className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {vpns.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                    <Lock size={36} className="mx-auto mb-2 opacity-20" />
                    No VPN accounts match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bandwidth info */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "WireGuard", desc: "Fastest protocol — recommended for MikroTik VPNs", color: "bg-purple-50 border-purple-200", icon: "text-purple-600" },
            { label: "OpenVPN",   desc: "Most compatible — works on all platforms and firewalls", color: "bg-orange-50 border-orange-200", icon: "text-orange-600" },
            { label: "IKEv2",     desc: "Best for mobile — reconnects automatically on network change", color: "bg-teal-50 border-teal-200", icon: "text-teal-600" },
          ].map(p => (
            <div key={p.label} className={`${p.color} border rounded-xl p-4`}>
              <p className={`font-bold text-sm ${p.icon} mb-1`}>{p.label}</p>
              <p className="text-xs text-gray-500">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </VpnLayout>
  );
}
