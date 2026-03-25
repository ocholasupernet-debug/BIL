import React from "react";
import { Link, useLocation } from "wouter";
import { BarChart, Building, Users, Key, DollarSign, ScrollText, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { name: "Overview", href: "/super-admin/dashboard", icon: BarChart },
    { name: "ISPs", href: "/super-admin/isps", icon: Building },
    { name: "Users", href: "/super-admin/users", icon: Users },
    { name: "Licenses", href: "/super-admin/licenses", icon: Key },
    { name: "Revenue", href: "/super-admin/revenue", icon: DollarSign },
    { name: "Logs", href: "/super-admin/logs", icon: ScrollText },
    { name: "Settings", href: "/super-admin/settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-slate-900 text-slate-200">
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-white/10 shadow-2xl bg-gradient-to-b from-indigo-950 to-indigo-900">
        <div className="px-6 py-6 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <ServerIcon className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg text-white tracking-wide">Platform Admin</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1.5">
          {navItems.map((item) => {
            const active = location === item.href || (location === '/super-admin' && item.href === '/super-admin/dashboard');
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200",
                  active 
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm" 
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-5 border-t border-white/10">
          <div className="flex items-center gap-3">
            <img src="https://ui-avatars.com/api/?name=Super+Admin&background=6366f1&color=fff" className="w-10 h-10 rounded-full border-2 border-white/20" alt="Super Admin" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">Super Admin</p>
              <p className="text-xs text-indigo-300">Platform Owner</p>
            </div>
            <Link href="/super-admin/login" className="text-red-400 hover:text-red-300 p-2">
              <LogOut className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-900 to-slate-800 p-8">
        {children}
      </main>
    </div>
  );
}

function ServerIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
      <line x1="6" y1="6" x2="6.01" y2="6"></line>
      <line x1="6" y1="18" x2="6.01" y2="18"></line>
    </svg>
  );
}
