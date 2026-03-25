import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Users, Ticket, Package, CreditCard, 
  Network, Server, Settings, Menu, X, Bell, LogOut, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminLayout({ children, portalName = "ISP Admin", subtitle = "Management" }: { children: React.ReactNode, portalName?: string, subtitle?: string }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [networkOpen, setNetworkOpen] = useState(location.includes("/network"));

  const navItems = [
    { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { name: "Customers", href: "/admin/customers", icon: Users },
    { name: "Hotspot Vouchers", href: "/admin/vouchers", icon: Ticket },
    { name: "Packages / Plans", href: "/admin/plans", icon: Package },
    { name: "Transactions", href: "/admin/transactions", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile Sidebar Overlay */}
      {!sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(true)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed md:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-white/10 transition-transform duration-300 flex flex-col",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden"
        )}
      >
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Server className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">{portalName}</p>
              <p className="text-[10px] text-primary font-bold uppercase tracking-widest">{subtitle}</p>
            </div>
          </div>
          <button className="md:hidden text-muted-foreground" onClick={() => setSidebarOpen(true)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  active 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}

          {/* Network Expandable Menu */}
          <div>
            <button 
              onClick={() => setNetworkOpen(!networkOpen)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                location.includes("/network") ? "text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-3">
                <Network className="w-4 h-4" />
                Network
              </div>
              <ChevronRight className={cn("w-4 h-4 transition-transform", networkOpen && "rotate-90")} />
            </button>
            {networkOpen && (
              <div className="pl-10 pr-3 py-1 space-y-1 mt-1 border-l border-white/10 ml-5">
                {['Routers', 'PPPoE Sign In', 'Self Install', 'Queues', 'IP Pool'].map((sub) => {
                  const href = `/admin/network?tab=${sub.toLowerCase().replace(/ /g, '-')}`;
                  const active = location.includes("/network");
                  return (
                    <Link key={sub} href={href} className="block py-1.5 text-xs text-muted-foreground hover:text-foreground">
                      {sub}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          <Link 
            href="/admin/radius"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mt-2",
              location === "/admin/radius" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            )}
          >
            <Server className="w-4 h-4" /> FreeRADIUS
          </Link>
          <Link 
            href="/admin/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
              location === "/admin/settings" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            )}
          >
            <Settings className="w-4 h-4" /> Settings
          </Link>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 cursor-pointer transition">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-xs font-bold text-white">
              A
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">Admin User</p>
              <p className="text-[10px] text-muted-foreground truncate">admin@isp.local</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="flex items-center gap-4 px-6 py-4 border-b border-white/10 bg-sidebar/50 backdrop-blur-md">
          <button 
            className="md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <h1 className="text-base font-bold text-foreground capitalize">
            {location.split('/').pop() || "Dashboard"}
          </h1>
          
          <div className="ml-auto flex items-center gap-3">
            <button className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-white/5 relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-background"></span>
            </button>
            <Link href="/admin/login" className="text-muted-foreground hover:text-destructive transition-colors p-2 rounded-full hover:bg-destructive/10">
              <LogOut className="w-4 h-4" />
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
