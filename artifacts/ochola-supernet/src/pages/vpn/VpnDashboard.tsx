import { useState } from "react";
import { Link } from "wouter";
import {
  Bell,
  Mail,
  Moon,
  Globe,
  ChevronDown,
  Home,
  ChevronRight,
  MonitorPlay,
  Wifi,
  Send,
  Users,
  Plus,
  List,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
  Shield,
  Zap,
  Lock,
} from "lucide-react";

const MOCK_VPNS = [
  { id: 1, name: "Kenya-VPN-01", server: "ke.vpn.isplatty.org", protocol: "WireGuard", status: "active", expires: "2026-06-30", bandwidth: "10 Mbps" },
  { id: 2, name: "Kenya-VPN-02", server: "ke2.vpn.isplatty.org", protocol: "OpenVPN", status: "active", expires: "2026-08-15", bandwidth: "20 Mbps" },
];

const ANNOUNCEMENTS = [
  { id: 1, date: "Mar 20, 2026", title: "WireGuard VPN now available", body: "We have upgraded our VPN infrastructure to support WireGuard protocol for faster and more secure connections." },
  { id: 2, date: "Mar 10, 2026", title: "Scheduled maintenance – Mar 25", body: "VPN servers will undergo maintenance between 2:00 AM – 4:00 AM EAT. Expect brief interruptions." },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function WomanIllustration() {
  return (
    <svg viewBox="0 0 160 160" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="90" width="140" height="8" rx="4" fill="rgba(255,255,255,0.2)" />
      <rect x="60" y="88" width="80" height="60" rx="4" fill="rgba(255,255,255,0.15)" />
      <rect x="68" y="96" width="64" height="40" rx="2" fill="rgba(255,255,255,0.25)" />
      <rect x="72" y="100" width="56" height="30" rx="1" fill="rgba(30,80,200,0.4)" />
      <line x1="76" y1="104" x2="120" y2="104" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      <line x1="76" y1="108" x2="114" y2="108" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <line x1="76" y1="112" x2="118" y2="112" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <line x1="76" y1="116" x2="110" y2="116" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      <ellipse cx="38" cy="55" rx="13" ry="13" fill="#FDDCB5" />
      <path d="M25 42 Q38 30 51 42" fill="#3B1F0A" />
      <path d="M26 52 Q25 70 20 85 Q30 88 38 88 Q46 88 56 85 Q51 70 50 52" fill="#fff" />
      <path d="M26 52 Q20 55 18 70 Q22 75 28 73 Q28 65 30 58" fill="#e8e8e8" />
      <path d="M50 52 Q56 55 58 70 Q54 75 48 73 Q48 65 46 58" fill="#e8e8e8" />
      <rect x="55" y="95" width="8" height="3" rx="1.5" fill="#FDDCB5" />
      <rect x="18" y="95" width="8" height="3" rx="1.5" fill="#FDDCB5" />
      <rect x="25" y="85" width="26" height="12" rx="2" fill="#1a2e6b" />
    </svg>
  );
}

export default function VpnDashboard() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVpnList, setShowVpnList] = useState(false);
  const [showSecret, setShowSecret] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);

  const userName = "Chrisphine Ochola";
  const shortName = userName.split(" ").slice(0, 2).join(" ").substring(0, 14) + "...";

  function copyToClip(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  return (
    <div className="min-h-screen bg-[#eef0f5] font-sans">

      {/* ── TOP HEADER ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-500">Balance,</span>
          <span className="font-bold text-gray-800">No 0</span>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-gray-500 hover:text-gray-700 transition-colors">
            <Moon size={18} />
          </button>
          <button className="text-gray-500 hover:text-gray-700 transition-colors">
            <Globe size={18} />
          </button>

          {/* Mail badge */}
          <button className="relative text-gray-500 hover:text-gray-700 transition-colors">
            <Mail size={18} />
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">10</span>
          </button>

          {/* Bell badge */}
          <button
            className="relative text-gray-500 hover:text-gray-700 transition-colors"
            onClick={() => setNotifOpen(v => !v)}
          >
            <Bell size={18} />
            <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">8</span>
          </button>

          {/* Avatar + name */}
          <button className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">CO</div>
            <span className="text-sm font-medium text-gray-700 hidden sm:block">{userName}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>
        </div>
      </header>

      {/* ── BREADCRUMB ─────────────────────────────────────────── */}
      <div className="px-6 py-3 flex items-center gap-1.5 text-sm">
        <Home size={14} className="text-blue-500" />
        <ChevronRight size={12} className="text-gray-400" />
        <span className="text-blue-500 hover:underline cursor-pointer">{userName}</span>
        <ChevronRight size={12} className="text-gray-400" />
        <span className="text-gray-600 font-medium">Dashboard</span>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────────── */}
      <main className="px-6 pb-10">

        {/* Title + Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-bold text-gray-800">Your Account Information</h1>

          <div className="flex flex-wrap gap-2">
            <button className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors">
              <MonitorPlay size={15} />
              Video Tutorials
            </button>
            <button className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors">
              <Wifi size={15} />
              Remote Access
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
            >
              <Send size={15} />
              Create VPNs
            </button>
            <button
              onClick={() => setShowVpnList(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
            >
              <Users size={15} />
              VPN Lists
            </button>
          </div>
        </div>

        {/* ── STAT CARDS ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

          {/* Greeting Card */}
          <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl overflow-hidden p-5 flex flex-col justify-between min-h-[140px]">
            <div className="z-10 relative">
              <p className="text-white font-bold text-lg leading-tight">{getGreeting()},<br />{shortName}</p>
              <p className="text-blue-100 text-xs mt-1">Welcome to Remote Access</p>
            </div>
            <div className="absolute bottom-0 right-0 w-32 h-32 opacity-80">
              <WomanIllustration />
            </div>
          </div>

          {/* VPNs card */}
          <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-3 min-h-[140px]">
            <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">VPNS</p>
            <div className="flex items-center gap-3">
              <span className="text-white font-bold text-sm">No</span>
              <div className="flex-1 h-8 bg-white rounded-md" />
            </div>
            <span className="text-white font-bold text-2xl">0</span>
          </div>

          {/* Account Status card */}
          <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-3 min-h-[140px]">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-xs font-semibold tracking-wide">Account</p>
            </div>
            <p className="text-gray-400 text-xs font-semibold">Status</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-8 bg-white rounded-md" />
            </div>
            <span className="text-green-400 font-bold text-lg">Active</span>
          </div>

          {/* Data / Quick Info card */}
          <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[140px]">
            <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">Domain</p>
            <p className="text-white font-mono text-sm break-all">vpn.isplatty.org</p>
            <div className="mt-auto flex items-center gap-2">
              <Shield size={14} className="text-green-400" />
              <span className="text-green-400 text-xs font-medium">Secured</span>
            </div>
          </div>
        </div>

        {/* ── BOTTOM PANELS ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Data Usage */}
          <div className="bg-white rounded-xl p-6 min-h-[180px]">
            <h2 className="font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />
              Data Usage
              <span className="ml-2 text-xs bg-amber-100 text-amber-600 font-semibold px-2 py-0.5 rounded-full">Coming Soon</span>
            </h2>
            <div className="flex flex-col items-center justify-center h-28 text-gray-400">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                <Zap size={28} className="text-gray-300" />
              </div>
              <p className="text-sm">Data usage tracking coming soon</p>
            </div>
          </div>

          {/* Announcements */}
          <div className="bg-white rounded-xl p-6 min-h-[180px]">
            <h2 className="font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
              <Bell size={16} className="text-blue-500" />
              Announcement
            </h2>
            <div className="space-y-4">
              {ANNOUNCEMENTS.map(a => (
                <div key={a.id} className="border-l-2 border-blue-400 pl-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] text-gray-400">{a.date}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-700">{a.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* ── CREATE VPN MODAL ────────────────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-500" />
                Create New VPN
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">VPN Name</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Kenya-VPN-03" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Protocol</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>WireGuard</option>
                  <option>OpenVPN</option>
                  <option>IKEv2</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bandwidth Limit</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>10 Mbps</option>
                  <option>20 Mbps</option>
                  <option>50 Mbps</option>
                  <option>Unlimited</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Validity</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>1 Month</option>
                  <option>3 Months</option>
                  <option>6 Months</option>
                  <option>1 Year</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
              <button className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-semibold transition-colors">Create VPN</button>
            </div>
          </div>
        </div>
      )}

      {/* ── VPN LIST MODAL ──────────────────────────────────────── */}
      {showVpnList && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <List size={18} className="text-blue-600" />
                My VPN Accounts
              </h3>
              <button onClick={() => setShowVpnList(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {MOCK_VPNS.map(vpn => (
                <div key={vpn.id} className="border rounded-xl p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Lock size={14} className="text-blue-600" />
                      <span className="font-bold text-gray-800">{vpn.name}</span>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${vpn.status === "active" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
                      {vpn.status === "active" ? "Active" : "Expired"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1.5 text-xs text-gray-600 mb-3">
                    <div><span className="text-gray-400">Protocol:</span> <span className="font-medium">{vpn.protocol}</span></div>
                    <div><span className="text-gray-400">Bandwidth:</span> <span className="font-medium">{vpn.bandwidth}</span></div>
                    <div><span className="text-gray-400">Expires:</span> <span className="font-medium">{vpn.expires}</span></div>
                    <div><span className="text-gray-400">Server:</span> <span className="font-medium font-mono">{vpn.server}</span></div>
                  </div>
                  <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
                    <span className="flex-1 font-mono text-xs text-gray-500 truncate">
                      {showSecret === vpn.id ? `wg-key-${vpn.id}-abc123def456xyz789` : "••••••••••••••••••••••••••••"}
                    </span>
                    <button onClick={() => setShowSecret(v => v === vpn.id ? null : vpn.id)} className="text-gray-400 hover:text-gray-600">
                      {showSecret === vpn.id ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button onClick={() => copyToClip(`wg-key-${vpn.id}-abc123def456xyz789`, `vpn-${vpn.id}`)} className="text-gray-400 hover:text-blue-600">
                      {copied === `vpn-${vpn.id}` ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              ))}
              {MOCK_VPNS.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Lock size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No VPN accounts yet. Create one above.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
