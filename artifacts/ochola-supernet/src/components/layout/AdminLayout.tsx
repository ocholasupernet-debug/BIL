import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Ticket, Package, CreditCard,
  Network, Server, Settings, Menu, Bell, LogOut, ChevronLeft,
  Zap, MessageSquare, CheckSquare, Wifi, Layers, Shield,
  Search, Sun, ChevronDown, Flag
} from "lucide-react";
import { cn } from "@/lib/utils";

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
      { name: "Hotspot Plans", href: "/admin/plans?type=hotspot" },
      { name: "PPPoE Plans", href: "/admin/plans?type=pppoe" },
      { name: "Bandwidth Plans", href: "/admin/plans?type=bandwidth" },
    ]
  },
  {
    name: "Transactions", icon: CreditCard,
    children: [
      { name: "All Transactions", href: "/admin/transactions" },
      { name: "M-Pesa", href: "/admin/transactions?method=mpesa" },
      { name: "Voucher Sales", href: "/admin/transactions?method=voucher" },
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
      { name: "Routers", href: "/admin/network" },
      { name: "PPPoE Sign In", href: "/admin/network?tab=pppoe" },
      { name: "Queues", href: "/admin/network?tab=queues" },
      { name: "IP Pool", href: "/admin/network?tab=ippool" },
      { name: "Self Install", href: "/admin/network?tab=install" },
    ]
  },
  {
    name: "Bulk Actions", icon: Layers,
    children: [
      { name: "Renew All Expired", href: "/admin/bulk" },
      { name: "Send SMS", href: "/admin/bulk?action=sms" },
    ]
  },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedItems, setExpandedItems] = useState<string[]>(["Network", "Customers"]);

  const toggleExpand = (name: string) => {
    setExpandedItems(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const isActive = (item: NavItem) => {
    if (item.href) return location === item.href || location.startsWith(item.href.split("?")[0] + "?") || location === item.href.split("?")[0];
    return item.children?.some(c => location.startsWith(c.href.split("?")[0]));
  };

  return (
    <div className="min-h-screen flex" style={{ background: "#0d1117", fontFamily: "'Inter', sans-serif" }}>

      {/* Sidebar */}
      <aside
        className="flex-shrink-0 flex flex-col transition-all duration-300"
        style={{
          width: sidebarOpen ? 220 : 0,
          overflow: "hidden",
          background: "#131929",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          minHeight: "100vh"
        }}
      >
        {/* Sidebar header */}
        <div style={{ padding: "1rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#06b6d4,#0891b2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Wifi style={{ width: 14, height: 14, color: "white" }} />
            </div>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 800, color: "white", lineHeight: 1 }}>ISP Admin</p>
              <p style={{ fontSize: "0.55rem", color: "#06b6d4", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>OcholaSupernet</p>
            </div>
          </div>
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.5rem 1rem",
                        fontSize: "0.8125rem",
                        fontWeight: active ? 600 : 400,
                        color: active ? "#06b6d4" : "#7c8ea6",
                        background: active ? "rgba(6,182,212,0.08)" : "transparent",
                        cursor: "pointer",
                        borderLeft: active ? "3px solid #06b6d4" : "3px solid transparent",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                        <item.icon style={{ width: 15, height: 15 }} />
                        <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div
                    onClick={() => toggleExpand(item.name)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.5rem 1rem",
                      fontSize: "0.8125rem",
                      fontWeight: active ? 600 : 400,
                      color: active ? "#06b6d4" : "#7c8ea6",
                      background: active ? "rgba(6,182,212,0.08)" : "transparent",
                      cursor: "pointer",
                      borderLeft: active ? "3px solid #06b6d4" : "3px solid transparent",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                      <item.icon style={{ width: 15, height: 15 }} />
                      <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>
                      {item.badge && (
                        <span style={{ fontSize: "0.55rem", padding: "1px 5px", borderRadius: 4, background: "#10b981", color: "white", fontWeight: 700, letterSpacing: "0.03em" }}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <ChevronLeft
                      style={{
                        width: 13, height: 13, flexShrink: 0,
                        transform: expanded ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.2s"
                      }}
                    />
                  </div>
                )}

                {/* Children */}
                {hasChildren && expanded && (
                  <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: "2rem", paddingLeft: "0.5rem" }}>
                    {item.children!.map((child) => (
                      <Link key={child.href} href={child.href}>
                        <div
                          style={{
                            padding: "0.3rem 0.5rem",
                            fontSize: "0.75rem",
                            color: location.startsWith(child.href.split("?")[0]) ? "#06b6d4" : "#5a6a80",
                            cursor: "pointer",
                            transition: "color 0.15s",
                          }}
                        >
                          {child.name}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Extra items */}
          <div style={{ marginTop: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem" }}>
            <Link href="/admin/radius">
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 1rem", fontSize: "0.8125rem", color: "#7c8ea6", cursor: "pointer", borderLeft: "3px solid transparent" }}>
                <Shield style={{ width: 15, height: 15 }} />
                <span>FreeRADIUS</span>
              </div>
            </Link>
            <Link href="/admin/settings">
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 1rem", fontSize: "0.8125rem", color: "#7c8ea6", cursor: "pointer", borderLeft: "3px solid transparent" }}>
                <Settings style={{ width: 15, height: 15 }} />
                <span>Settings</span>
              </div>
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: "100vh", overflow: "hidden" }}>

        {/* Header */}
        <header style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0 1.25rem",
          height: 56,
          background: "#131929",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          {/* Left: Logo + Hamburger */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#7c8ea6", padding: "0.25rem", display: "flex" }}
            >
              <Menu style={{ width: 18, height: 18 }} />
            </button>
            <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "white", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              OCHOLASUPERNET
            </span>
          </div>

          {/* Center: Search + toggles */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, overflow: "hidden", maxWidth: 320, width: "100%" }}>
              <input
                type="text"
                placeholder="Search users..."
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "white", fontSize: "0.8125rem", padding: "0.5rem 0.75rem", fontFamily: "inherit" }}
              />
              <button style={{ background: "#1a3a8a", border: "none", padding: "0.5rem 0.875rem", cursor: "pointer", color: "white", display: "flex", alignItems: "center" }}>
                <Search style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.4rem 0.75rem", color: "#94a3b8", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              <Sun style={{ width: 13, height: 13 }} />
              Light
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.4rem 0.75rem", color: "#94a3b8", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
              🇰🇪 <span style={{ fontWeight: 600 }}>KE</span>
            </button>
          </div>

          {/* Right: Quick Actions + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
            <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.4rem 0.875rem", color: "#94a3b8", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              <Zap style={{ width: 13, height: 13, color: "#fbbf24" }} />
              Quick Actions
              <ChevronDown style={{ width: 12, height: 12 }} />
            </button>
            <span style={{ fontSize: "1.1rem" }}>🇰🇪</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "0.3rem 0.75rem", cursor: "pointer" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800, color: "white" }}>
                A
              </div>
              <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 500 }}>Administrator</span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
