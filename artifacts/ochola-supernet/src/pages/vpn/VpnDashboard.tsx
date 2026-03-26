import { Link } from "wouter";
import { VpnHeader } from "./VpnLayout";
import {
  Bell, Shield, Zap, Lock, Circle, CheckCircle2,
  MonitorPlay, Wifi, Send, Users, ArrowRight,
} from "lucide-react";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function WomanIllustration() {
  return (
    <svg viewBox="0 0 160 160" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const ANNOUNCEMENTS = [
  { id: 1, date: "Mar 20, 2026", title: "WireGuard VPN now available", body: "We have upgraded our VPN infrastructure to support WireGuard protocol for faster and more secure connections." },
  { id: 2, date: "Mar 10, 2026", title: "Scheduled maintenance – Mar 25", body: "VPN servers will undergo maintenance between 2:00 AM – 4:00 AM EAT. Expect brief interruptions." },
];

const QUICK_LINKS = [
  { label: "Remote Access",   href: "/vpn/remote-access", icon: Wifi,        color: "bg-green-500 hover:bg-green-600",   desc: "Connect to MikroTik routers via VPN tunnel" },
  { label: "Create VPN",      href: "/vpn/create",        icon: Send,        color: "bg-amber-500 hover:bg-amber-600",   desc: "Set up a new VPN account" },
  { label: "VPN Lists",       href: "/vpn/list",          icon: Users,       color: "bg-blue-600 hover:bg-blue-700",     desc: "View and manage all VPN accounts" },
  { label: "Video Tutorials", href: "/vpn/tutorials",     icon: MonitorPlay, color: "bg-green-600 hover:bg-green-700",   desc: "Learn how to configure VPN and MikroTik" },
];

export default function VpnDashboard() {
  const userName = "Chrisphine Ochola";
  const shortName = "Chrisphine Och...";

  return (
    <div className="min-h-screen bg-[#eef0f5] font-sans">
      <VpnHeader breadcrumb="Dashboard" />

      <main className="px-6 py-6">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Page title */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800">Your Account Information</h1>
          </div>

          {/* ── STAT CARDS ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Greeting Card */}
            <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl overflow-hidden p-5 flex flex-col justify-between min-h-[150px]">
              <div className="z-10 relative">
                <p className="text-white font-bold text-lg leading-tight">{getGreeting()},<br />{shortName}</p>
                <p className="text-blue-100 text-xs mt-1">Welcome to Remote Access</p>
              </div>
              <div className="absolute bottom-0 right-0 w-32 h-32 opacity-80">
                <WomanIllustration />
              </div>
            </div>

            {/* VPNs card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-3 min-h-[150px]">
              <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">VPNS</p>
              <div className="flex items-center gap-3">
                <span className="text-white font-bold text-sm">No</span>
                <div className="flex-1 h-8 bg-white rounded-md" />
              </div>
              <span className="text-white font-bold text-2xl">0</span>
            </div>

            {/* Account Status card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[150px]">
              <p className="text-gray-400 text-xs font-semibold tracking-wide">Account</p>
              <p className="text-gray-400 text-xs font-semibold">Status</p>
              <div className="flex-1 h-8 bg-white rounded-md" />
              <span className="text-green-400 font-bold text-lg flex items-center gap-1.5">
                <CheckCircle2 size={16} /> Active
              </span>
            </div>

            {/* Domain card */}
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-2 min-h-[150px]">
              <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">Domain</p>
              <p className="text-white font-mono text-sm break-all mt-1">vpn.isplatty.org</p>
              <div className="mt-auto flex items-center gap-2">
                <Shield size={14} className="text-green-400" />
                <span className="text-green-400 text-xs font-medium">Secured</span>
              </div>
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

            {/* Data Usage */}
            <div className="bg-white rounded-xl p-6 min-h-[180px] border border-gray-200 shadow-sm">
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
            <div className="bg-white rounded-xl p-6 min-h-[180px] border border-gray-200 shadow-sm">
              <h2 className="font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
                <Bell size={16} className="text-blue-500" />
                Announcement
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
            </div>
          </div>

          {/* Recent VPN activity strip */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800 flex items-center gap-2"><Lock size={15} className="text-gray-500" /> Recent VPN Activity</h2>
              <Link href="/vpn/list" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                View all <ArrowRight size={11} />
              </Link>
            </div>
            <div className="text-center py-8 text-gray-400">
              <Lock size={32} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No VPN accounts yet.</p>
              <Link href="/vpn/create" className="text-xs text-blue-600 hover:underline mt-1 inline-block">Create your first VPN →</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
