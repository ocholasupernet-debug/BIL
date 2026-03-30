import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, Users, Ticket, Package, CreditCard,
  Network, Settings, Menu, Bell, ChevronLeft,
  Zap, MessageSquare, CheckSquare, Wifi, Layers, Shield,
  Search, Sun, Moon, ChevronDown, Globe, Radio,
  MonitorSmartphone, Sliders, FileCode2, Star, MoreHorizontal,
  Activity, BookOpen, LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useBrand } from "@/context/BrandContext";
import { clearAdminAuth, getAdminName, isImpersonating, getImpersonatedName, stopImpersonation } from "@/lib/supabase";

interface NavItem {
  name: string;
  href?: string;
  icon: React.ElementType;
  badge?: string;
  children?: { name: string; href: string }[];
}

const navItems: NavItem[] = [
  { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  {
    name: "Customers", icon: Users,
    children: [
      { name: "All Customers", href: "/admin/customers" },
      { name: "Active", href: "/admin/customers?status=active" },
      { name: "Expired", href: "/admin/customers?status=expired" },
      { name: "Online Users", href: "/admin/customers?status=online" },
    ]
  },
  {
    name: "Activation", icon: CheckSquare, badge: "New",
    children: [
      { name: "Pending", href: "/admin/activation" },
      { name: "Approved", href: "/admin/activation?status=approved" },
    ]
  },
  {
    name: "Hotspot Vouchers", icon: Ticket,
    children: [
      { name: "All Vouchers", href: "/admin/vouchers" },
      { name: "Generate", href: "/admin/vouchers?action=generate" },
      { name: "Batches", href: "/admin/vouchers?tab=batches" },
    ]
  },
  {
    name: "Hotspot Binding", icon: Wifi,
    children: [
      { name: "Bindings", href: "/admin/hotspot-binding" },
      { name: "Sessions", href: "/admin/hotspot-binding?tab=sessions" },
    ]
  },
  {
    name: "Packages/Plans", icon: Package,
    children: [
      { name: "Hotspot Plans",  href: "/admin/plans?type=hotspot" },
      { name: "PPPOE Plans",    href: "/admin/plans?type=pppoe" },
      { name: "Static ip plans",href: "/admin/plans?type=static" },
      { name: "Bandwidth Plans",href: "/admin/plans?type=bandwidth" },
      { name: "Hotspot Trials", href: "/admin/plans?type=trials" },
      { name: "FUP",            href: "/admin/plans?type=fup" },
    ]
  },
  {
    name: "Transactions", icon: CreditCard,
    children: [
      { name: "All Transactions",   href: "/admin/transactions" },
      { name: "M-Pesa",             href: "/admin/transactions?method=mpesa" },
      { name: "Voucher Sales",      href: "/admin/transactions?method=voucher" },
      { name: "Comparisons/Graphs", href: "/admin/transactions/graphs" },
    ]
  },
  { name: "Support Ticket", href: "/admin/support", icon: MessageSquare },
  {
    name: "Notifications", icon: Bell,
    children: [
      { name: "All Notifications", href: "/admin/notifications" },
      { name: "Expiry Alerts", href: "/admin/notifications?type=expiry" },
    ]
  },
  {
    name: "Network", icon: Network,
    children: [
      { name: "Routers",     href: "/admin/network/routers"    },
      { name: "Add Router",  href: "/admin/network/add-router" },
      { name: "PPPoE",       href: "/admin/network/pppoe"      },
      { name: "PPP",         href: "/admin/network/ppp"        },
      { name: "Wireless",    href: "/admin/network/wireless"   },
      { name: "Queues",      href: "/admin/network/queues"     },
      { name: "IP Pools",    href: "/admin/network/ip-pools"   },
    ]
  },
  {
    name: "Bulk Actions", icon: Layers,
    children: [
      { name: "Renew All Expired", href: "/admin/bulk" },
      { name: "Send SMS", href: "/admin/bulk?action=sms" },
    ]
  },
  { name: "Static Pages", href: "/admin/pages", icon: Globe },
  { name: "TR069 ACS", href: "/admin/acs", icon: Radio },
  {
    name: "Access Points", icon: MonitorSmartphone, badge: "New",
    children: [
      { name: "All APs", href: "/admin/access-points" },
      { name: "Add New", href: "/admin/access-points?action=add" },
    ]
  },
  {
    name: "PPPoE Settings", icon: Sliders,
    children: [
      { name: "General", href: "/admin/pppoe-settings" },
      { name: "Profiles", href: "/admin/pppoe-settings?tab=profiles" },
    ]
  },
  {
    name: "Hotspot Settings", icon: Wifi,
    children: [
      { name: "General", href: "/admin/hotspot-settings" },
      { name: "Login Page", href: "/admin/hotspot-settings?tab=login" },
    ]
  },
  { name: "Page Builder", href: "/admin/page-builder", icon: FileCode2 },
  {
    name: "Bonga Points", icon: Star,
    children: [
      { name: "Dashboard", href: "/admin/bonga" },
      { name: "Redeem", href: "/admin/bonga?tab=redeem" },
    ]
  },
  {
    name: "Extras", icon: MoreHorizontal,
    children: [
      { name: "SMS Gateway", href: "/admin/extras/sms" },
      { name: "Email Config", href: "/admin/extras/email" },
    ]
  },
  {
    name: "Uisp", icon: Activity,
    children: [
      { name: "Devices", href: "/admin/uisp" },
      { name: "Sites", href: "/admin/uisp?tab=sites" },
    ]
  },
  {
    name: "Logs", icon: BookOpen,
    children: [
      { name: "Auth Logs", href: "/admin/logs" },
      { name: "System Logs", href: "/admin/logs?type=system" },
    ]
  },
  { name: "Settings", href: "/admin/settings", icon: Settings },
  { name: "FreeRADIUS", href: "/admin/radius", icon: Shield },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedItems, setExpandedItems] = useState<string[]>(["Network", "Customers"]);
  const { theme, toggle, isDark } = useTheme();
  const brand = useBrand();
  const adminName = getAdminName();
  const queryClient = useQueryClient();
  const impersonating = isImpersonating();
  const impersonatedName = getImpersonatedName();

  const handleLogout = () => {
    clearAdminAuth();
    queryClient.clear();
    setLocation("/admin/login");
  };

  const handleExitImpersonation = () => {
    stopImpersonation();
    queryClient.clear();
    setLocation("/super-admin/admins");
  };

  const toggleExpand = (name: string) => {
    setExpandedItems(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const isActive = (item: NavItem): boolean => {
    if (item.href) {
      const base = item.href.split("?")[0];
      return location === item.href || location === base;
    }
    return !!item.children?.some(c => location.startsWith(c.href.split("?")[0]));
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--isp-bg)", fontFamily: "'Inter', sans-serif", transition: "background 0.25s, color 0.25s" }}>

      {/* Sidebar — always dark for ISP style */}
      <aside
        style={{
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          transition: "width 0.3s",
          width: sidebarOpen ? 220 : 0,
          overflow: "hidden",
          background: "#131929",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          minHeight: "100vh",
        }}
      >
        {/* Sidebar logo */}
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <Logo size="sm" />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
          {navItems.map((item) => {
            const active = isActive(item);
            const expanded = expandedItems.includes(item.name);
            const hasChildren = item.children && item.children.length > 0;

            return (
              <div key={item.name}>
                {item.href && !hasChildren ? (
                  <Link href={item.href}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "0.45rem 1rem", fontSize: "0.8rem", fontWeight: active ? 600 : 400,
                      color: active ? "#06b6d4" : "#7c8ea6",
                      background: active ? "rgba(6,182,212,0.08)" : "transparent",
                      cursor: "pointer",
                      borderLeft: active ? "3px solid #06b6d4" : "3px solid transparent",
                      transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                        <item.icon style={{ width: 14, height: 14 }} />
                        <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div
                    onClick={() => toggleExpand(item.name)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "0.45rem 1rem", fontSize: "0.8rem", fontWeight: active ? 600 : 400,
                      color: active ? "#06b6d4" : "#7c8ea6",
                      background: active ? "rgba(6,182,212,0.08)" : "transparent",
                      cursor: "pointer",
                      borderLeft: active ? "3px solid #06b6d4" : "3px solid transparent",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                      <item.icon style={{ width: 14, height: 14 }} />
                      <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>
                      {item.badge && (
                        <span style={{ fontSize: "0.5rem", padding: "1px 5px", borderRadius: 4, background: "#10b981", color: "white", fontWeight: 700 }}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <ChevronLeft style={{ width: 12, height: 12, flexShrink: 0, transform: expanded ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
                  </div>
                )}

                {hasChildren && expanded && (
                  <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: "2rem", paddingLeft: "0.5rem" }}>
                    {item.children!.map((child) => (
                      <Link key={child.href} href={child.href}>
                        <div style={{ padding: "0.28rem 0.5rem", fontSize: "0.725rem", color: location.startsWith(child.href.split("?")[0]) ? "#06b6d4" : "#5a6a80", cursor: "pointer", transition: "color 0.15s" }}>
                          {child.name}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: "100vh", overflow: "hidden" }}>

        {/* Header */}
        <header style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0 1.25rem",
          height: 56,
          background: "var(--isp-header)",
          borderBottom: "1px solid var(--isp-border-subtle)",
          flexShrink: 0,
          transition: "background 0.25s, border-color 0.25s",
        }}>
          {/* Left: hamburger + logo text */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)", padding: "0.25rem", display: "flex", transition: "color 0.2s" }}
            >
              <Menu style={{ width: 18, height: 18 }} />
            </button>
            <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "var(--isp-text)", letterSpacing: "0.05em", textTransform: "uppercase", transition: "color 0.25s" }}>
              {brand.ispName.toUpperCase()}
            </span>
          </div>

          {/* Center: Search + Light/Dark toggle + KE flag */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)", borderRadius: 8, overflow: "hidden", maxWidth: 320, width: "100%", transition: "background 0.25s, border-color 0.25s" }}>
              <input
                type="text"
                placeholder="Search users..."
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--isp-text)", fontSize: "0.8125rem", padding: "0.5rem 0.75rem", fontFamily: "inherit", transition: "color 0.25s" }}
              />
              <button style={{ background: "#1a3a8a", border: "none", padding: "0.5rem 0.875rem", cursor: "pointer", color: "white", display: "flex", alignItems: "center" }}>
                <Search style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* Light / Dark toggle button */}
            <button
              onClick={toggle}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex", alignItems: "center", gap: "0.375rem",
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"}`,
                borderRadius: 8, padding: "0.4rem 0.75rem",
                color: isDark ? "#94a3b8" : "#475569",
                fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                transition: "all 0.2s",
              }}
            >
              {isDark
                ? <><Sun style={{ width: 13, height: 13 }} /> Light</>
                : <><Moon style={{ width: 13, height: 13 }} /> Dark</>
              }
            </button>

            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)", borderRadius: 8, padding: "0.4rem 0.75rem", color: "var(--isp-text-muted)", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
              🇰🇪 <span style={{ fontWeight: 600 }}>KE</span>
            </button>
          </div>

          {/* Right: Quick Actions + avatar + logout */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)", borderRadius: 8, padding: "0.4rem 0.875rem", color: "var(--isp-text-muted)", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              <Zap style={{ width: 13, height: 13, color: "#fbbf24" }} />
              Quick Actions
              <ChevronDown style={{ width: 12, height: 12 }} />
            </button>
            <span style={{ fontSize: "1.1rem" }}>🇰🇪</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--isp-input-bg)", borderRadius: 8, padding: "0.3rem 0.75rem" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800, color: "white" }}>
                {(adminName || "A").charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)", fontWeight: 500 }}>{adminName || brand.adminName || "Administrator"}</span>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "0.4rem 0.75rem", color: "#f87171", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, transition: "all 0.2s" }}
            >
              <LogOut style={{ width: 13, height: 13 }} />
              Logout
            </button>
          </div>
        </header>

        {/* Impersonation banner */}
        {impersonating && (
          <div style={{ background: "linear-gradient(90deg,#92400e,#78350f)", borderBottom: "1px solid rgba(251,191,36,0.3)", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1rem" }}>⚠️</span>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#fde68a" }}>
                Super Admin Mode — Impersonating: <span style={{ color: "white" }}>{impersonatedName}</span>
              </span>
              <span style={{ fontSize: "0.72rem", color: "#fbbf24", opacity: 0.8 }}>
                · All actions are performed under this admin's account
              </span>
            </div>
            <button
              onClick={handleExitImpersonation}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 7, padding: "5px 14px", color: "#fde68a", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              <LogOut style={{ width: 12, height: 12 }} /> Exit Impersonation
            </button>
          </div>
        )}

        {/* Page content */}
        <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem", background: "var(--isp-bg)", transition: "background 0.25s" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
