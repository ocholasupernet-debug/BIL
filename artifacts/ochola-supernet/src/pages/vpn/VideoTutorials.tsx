import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Play, Clock, Tag, Search, BookOpen, Router, Wifi,
  Smartphone, Terminal, Shield, AlertTriangle, ChevronRight,
  MonitorPlay, Youtube,
} from "lucide-react";

const CATEGORIES = ["All", "WireGuard", "OpenVPN", "Remote Access", "MikroTik", "Troubleshooting"];

const TUTORIALS = [
  {
    id: 1, title: "Setting up WireGuard VPN on MikroTik RouterOS 7",
    category: "WireGuard", duration: "14:32", level: "Intermediate",
    desc: "Step-by-step guide to configure a WireGuard VPN server on your MikroTik router and connect clients.",
    thumbColor: "from-purple-500 to-purple-800", icon: Wifi,
    steps: ["Install WireGuard package", "Generate key pairs", "Configure WireGuard interface", "Add peers", "Set up firewall rules"],
  },
  {
    id: 2, title: "MikroTik Remote Access via VPN Tunnel — Full Guide",
    category: "Remote Access", duration: "22:15", level: "Advanced",
    desc: "How to securely manage your MikroTik routers from anywhere in the world using a VPN tunnel with Winbox and WebFig.",
    thumbColor: "from-green-500 to-green-800", icon: Router,
    steps: ["Set up VPN tunnel", "Configure allowed IPs", "Open Winbox through VPN", "WebFig HTTPS setup", "SSH key authentication"],
  },
  {
    id: 3, title: "OpenVPN Setup on MikroTik — Complete Tutorial",
    category: "OpenVPN", duration: "18:47", level: "Intermediate",
    desc: "Configure OpenVPN on MikroTik, generate certificates, and connect Windows, Linux, and Android clients.",
    thumbColor: "from-orange-500 to-orange-800", icon: Shield,
    steps: ["Generate CA and certificates", "Configure OpenVPN server", "Export client certificates", "Connect Windows client", "Connect Android client"],
  },
  {
    id: 4, title: "WireGuard on iPhone & Android — Mobile VPN Setup",
    category: "WireGuard", duration: "8:20", level: "Beginner",
    desc: "Install the WireGuard app on your phone and import the config file to connect to your ISP VPN.",
    thumbColor: "from-indigo-500 to-indigo-800", icon: Smartphone,
    steps: ["Download WireGuard app", "Import config file", "Add tunnel manually", "Scan QR code", "Test connection"],
  },
  {
    id: 5, title: "SSH Key Authentication on MikroTik — Passwordless Login",
    category: "MikroTik", duration: "11:05", level: "Intermediate",
    desc: "Replace password-based SSH access with SSH key pairs for more secure and convenient remote terminal access.",
    thumbColor: "from-gray-600 to-gray-900", icon: Terminal,
    steps: ["Generate SSH key pair", "Upload public key to MikroTik", "Configure SSH service", "Test key login", "Disable password auth"],
  },
  {
    id: 6, title: "Troubleshooting VPN Connection Issues — MikroTik",
    category: "Troubleshooting", duration: "16:30", level: "Advanced",
    desc: "Diagnose and fix common VPN issues including firewall blocks, NAT problems, and routing conflicts.",
    thumbColor: "from-red-500 to-red-800", icon: AlertTriangle,
    steps: ["Check firewall rules", "Verify NAT masquerade", "Inspect routing table", "Test with ping", "Read VPN logs"],
  },
  {
    id: 7, title: "IKEv2 VPN on MikroTik for iPhone Native VPN",
    category: "MikroTik", duration: "13:44", level: "Advanced",
    desc: "Set up IKEv2/IPSec on MikroTik and configure iPhone's built-in VPN client without any extra app.",
    thumbColor: "from-teal-500 to-teal-800", icon: Smartphone,
    steps: ["Configure IKEv2 profile", "Set up IPSec peers", "Generate certificates", "iPhone native VPN settings", "Test auto-reconnect"],
  },
  {
    id: 8, title: "MikroTik Firewall Rules for VPN Security",
    category: "MikroTik", duration: "19:12", level: "Advanced",
    desc: "Properly secure your MikroTik VPN with firewall rules — restrict access to management interfaces through VPN only.",
    thumbColor: "from-blue-600 to-blue-900", icon: Shield,
    steps: ["Drop all WAN management", "Allow VPN subnet access", "Input chain rules", "Forward chain setup", "Test access control"],
  },
];

const LEVEL_COLOR: Record<string, string> = {
  Beginner: "bg-green-100 text-green-700",
  Intermediate: "bg-amber-100 text-amber-700",
  Advanced: "bg-red-100 text-red-600",
};

export default function VideoTutorials() {
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<number | null>(null);

  const filtered = TUTORIALS.filter(t => {
    const matchCat = cat === "All" || t.category === cat;
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) ||
                        t.category.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <MonitorPlay size={20} className="text-green-500" /> Video Tutorials
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Learn how to set up and manage VPN and MikroTik remote access — step by step</p>
        </div>

        {/* Search + categories */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search tutorials…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${cat === c ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Video player modal */}
        {playing !== null && (() => {
          const t = TUTORIALS.find(t => t.id === playing)!;
          const Icon = t.icon;
          return (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
                <div className={`h-52 bg-gradient-to-br ${t.thumbColor} flex items-center justify-center relative`}>
                  <div className="text-center text-white">
                    <Icon size={48} className="mx-auto mb-3 opacity-80" />
                    <div className="flex items-center gap-2 justify-center opacity-70 text-sm">
                      <Youtube size={16} /> Video Player Preview
                    </div>
                    <p className="text-xs mt-1 opacity-50">Connect to YouTube or your video host to embed</p>
                  </div>
                  <button onClick={() => setPlaying(null)} className="absolute top-3 right-3 bg-black/40 hover:bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg font-bold transition-colors">×</button>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-bold text-gray-800">{t.title}</h3>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${LEVEL_COLOR[t.level]}`}>{t.level}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">{t.desc}</p>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1"><BookOpen size={11} /> What you'll learn</p>
                    <ol className="space-y-1.5">
                      {t.steps.map((s, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">{i + 1}</span>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Tutorial grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => {
            const Icon = t.icon;
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                {/* Thumbnail */}
                <div className={`h-36 bg-gradient-to-br ${t.thumbColor} relative flex items-center justify-center cursor-pointer`}
                  onClick={() => setPlaying(t.id)}>
                  <div className="text-center text-white">
                    <Icon size={32} className="mx-auto mb-2 opacity-70" />
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
                      <Play size={18} className="text-gray-800 ml-0.5" fill="currentColor" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded font-mono flex items-center gap-1">
                    <Clock size={10} /> {t.duration}
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Tag size={9} /> {t.category}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${LEVEL_COLOR[t.level]}`}>{t.level}</span>
                  </div>
                  <h3 className="font-bold text-gray-800 text-sm leading-snug mb-1 line-clamp-2">{t.title}</h3>
                  <p className="text-xs text-gray-500 line-clamp-2 mb-3">{t.desc}</p>
                  <button onClick={() => setPlaying(t.id)}
                    className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold py-2 rounded-lg transition-colors">
                    <Play size={12} fill="currentColor" /> Watch Tutorial
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-gray-400">
              <MonitorPlay size={40} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No tutorials match your search.</p>
            </div>
          )}
        </div>

        {/* Request a tutorial CTA */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-6 text-white flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="font-bold text-lg">Don't see what you need?</p>
            <p className="text-blue-100 text-sm mt-0.5">Request a tutorial on a specific MikroTik or VPN topic</p>
          </div>
          <button className="flex items-center gap-2 bg-white text-blue-700 font-bold px-5 py-2.5 rounded-lg text-sm hover:bg-blue-50 transition-colors">
            Request Tutorial <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
