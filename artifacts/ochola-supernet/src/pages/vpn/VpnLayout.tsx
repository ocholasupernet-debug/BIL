import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell, Mail, Moon, Globe, ChevronDown, Home, ChevronRight,
  MonitorPlay, Wifi, Send, Users, LayoutDashboard, Sun,
} from "lucide-react";

interface VpnLayoutProps {
  children: React.ReactNode;
  breadcrumb?: string;
}

const NAV = [
  { label: "Dashboard",      href: "/vpn",               icon: LayoutDashboard, color: "text-blue-500"  },
  { label: "Video Tutorials",href: "/vpn/tutorials",      icon: MonitorPlay,     color: "text-green-500" },
  { label: "Remote Access",  href: "/vpn/remote-access",  icon: Wifi,            color: "text-green-500" },
  { label: "Create VPNs",    href: "/vpn/create",         icon: Send,            color: "text-amber-500" },
  { label: "VPN Lists",      href: "/vpn/list",           icon: Users,           color: "text-blue-600"  },
];

export function VpnHeader({ breadcrumb }: { breadcrumb?: string }) {
  const [dark, setDark] = useState(false);
  const [location] = useLocation();

  return (
    <>
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-500">Balance,</span>
          <span className="font-bold text-gray-800">No 0</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setDark(d => !d)} className="text-gray-500 hover:text-gray-700 transition-colors">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="text-gray-500 hover:text-gray-700"><Globe size={18} /></button>
          <button className="relative text-gray-500 hover:text-gray-700">
            <Mail size={18} />
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">10</span>
          </button>
          <button className="relative text-gray-500 hover:text-gray-700">
            <Bell size={18} />
            <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">8</span>
          </button>
          <button className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">CO</div>
            <span className="text-sm font-medium text-gray-700 hidden sm:block">Chrisphine Ochola</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>
        </div>
      </header>

      {/* Breadcrumb */}
      <div className="px-6 py-2.5 flex items-center gap-1.5 text-sm bg-white border-b border-gray-100">
        <Home size={13} className="text-blue-500" />
        <ChevronRight size={11} className="text-gray-400" />
        <Link href="/vpn" className="text-blue-500 hover:underline">Chrisphine Ochola</Link>
        {breadcrumb && (
          <>
            <ChevronRight size={11} className="text-gray-400" />
            <span className="text-gray-600 font-medium">{breadcrumb}</span>
          </>
        )}
      </div>

      {/* Action buttons row */}
      <div className="px-6 pt-5 pb-1 flex flex-wrap items-center gap-2">
        {NAV.filter(n => n.href !== "/vpn").map(n => {
          const active = location === n.href;
          const Icon = n.icon;
          const bg =
            n.color === "text-green-500" ? (active ? "bg-green-600" : "bg-green-500 hover:bg-green-600") :
            n.color === "text-amber-500" ? (active ? "bg-amber-600" : "bg-amber-500 hover:bg-amber-600") :
            (active ? "bg-blue-700" : "bg-blue-600 hover:bg-blue-700");
          return (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-2 ${bg} text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors shadow-sm ${active ? "ring-2 ring-offset-1 ring-white/50" : ""}`}>
              <Icon size={14} />
              {n.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

export default function VpnLayout({ children, breadcrumb }: VpnLayoutProps) {
  return (
    <div className="min-h-screen bg-[#eef0f5] font-sans">
      <VpnHeader breadcrumb={breadcrumb} />
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
