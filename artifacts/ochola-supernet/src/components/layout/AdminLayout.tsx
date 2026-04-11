import React, { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, Users, Ticket, Package, CreditCard,
  Network, Settings, Bell, Wifi, Layers, Shield,
  Globe, Radio, MonitorSmartphone, Sliders, FileCode2, Star,
  Activity, BookOpen, LogOut, Webhook, ChevronDown, ChevronRight,
  Zap, MessageSquare, CheckSquare, Search, Sun, Moon, Menu, X,
} from "lucide-react";
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
  { name: "Dashboard",        href: "/admin/dashboard",            icon: LayoutDashboard },
  {
    name: "Customers", icon: Users,
    children: [
      { name: "All Customers",  href: "/admin/customers" },
      { name: "Active",         href: "/admin/customers?status=active" },
      { name: "Expired",        href: "/admin/customers?status=expired" },
      { name: "Online Users",   href: "/admin/customers?status=online" },
    ],
  },
  {
    name: "Activation", icon: CheckSquare, badge: "New",
    children: [
      { name: "Pending",        href: "/admin/activation" },
      { name: "Approved",       href: "/admin/activation?status=approved" },
      { name: "Prepaid Users",  href: "/admin/activation/prepaid-users" },
    ],
  },
  {
    name: "Hotspot Vouchers", icon: Ticket,
    children: [
      { name: "All Vouchers",   href: "/admin/vouchers" },
      { name: "Generate",       href: "/admin/vouchers?action=generate" },
      { name: "Batches",        href: "/admin/vouchers?tab=batches" },
    ],
  },
  {
    name: "Hotspot Binding", icon: Wifi,
    children: [
      { name: "Bindings",       href: "/admin/hotspot-binding" },
      { name: "Sessions",       href: "/admin/hotspot-binding?tab=sessions" },
    ],
  },
  {
    name: "Packages / Plans", icon: Package,
    children: [
      { name: "Hotspot Plans",  href: "/admin/plans?type=hotspot" },
      { name: "PPPoE Plans",    href: "/admin/plans?type=pppoe" },
      { name: "Static IP",      href: "/admin/plans?type=static" },
      { name: "Bandwidth",      href: "/admin/plans?type=bandwidth" },
      { name: "Trials",         href: "/admin/plans?type=trials" },
      { name: "FUP",            href: "/admin/plans?type=fup" },
    ],
  },
  {
    name: "Transactions", icon: CreditCard,
    children: [
      { name: "All",            href: "/admin/transactions" },
      { name: "M-Pesa",         href: "/admin/transactions?method=mpesa" },
      { name: "Voucher Sales",  href: "/admin/transactions?method=voucher" },
      { name: "Graphs",         href: "/admin/transactions/graphs" },
      { name: "Invoices",       href: "/admin/invoices" },
      { name: "Customer Balance", href: "/admin/balance" },
    ],
  },
  { name: "Support Tickets",  href: "/admin/support",              icon: MessageSquare },
  {
    name: "Notifications", icon: Bell,
    children: [
      { name: "All",            href: "/admin/notifications" },
      { name: "Expiry Alerts",  href: "/admin/notifications?type=expiry" },
      { name: "Message Templates", href: "/admin/message-templates" },
    ],
  },
  {
    name: "Network", icon: Network,
    children: [
      { name: "Routers",        href: "/admin/network/routers" },
      { name: "Add Router",     href: "/admin/network/add-router" },
      { name: "Replace Router", href: "/admin/network/replace-router" },
      { name: "PPPoE",          href: "/admin/network/pppoe" },
      { name: "PPP",            href: "/admin/network/ppp" },
      { name: "Wireless",       href: "/admin/network/wireless" },
      { name: "Queues",         href: "/admin/network/queues" },
      { name: "IP Pools",       href: "/admin/network/ip-pools" },
      { name: "API Config",     href: "/admin/network/router-api-config" },
    ],
  },
  {
    name: "Bulk Actions", icon: Layers,
    children: [
      { name: "Renew Expired",  href: "/admin/bulk" },
      { name: "Send SMS",       href: "/admin/bulk?action=sms" },
    ],
  },
  { name: "Static Pages",     href: "/admin/pages",                icon: Globe },
  { name: "TR069 ACS",        href: "/admin/acs",                  icon: Radio },
  {
    name: "Access Points", icon: MonitorSmartphone, badge: "New",
    children: [
      { name: "All APs",        href: "/admin/access-points" },
      { name: "Add New",        href: "/admin/access-points?action=add" },
    ],
  },
  {
    name: "PPPoE Settings", icon: Sliders,
    children: [
      { name: "General",        href: "/admin/pppoe-settings" },
      { name: "Profiles",       href: "/admin/pppoe-settings?tab=profiles" },
    ],
  },
  {
    name: "Hotspot Settings", icon: Wifi,
    children: [
      { name: "General",        href: "/admin/hotspot-settings" },
      { name: "Login Page",     href: "/admin/hotspot-settings?tab=login" },
    ],
  },
  { name: "Webhooks",         href: "/admin/webhooks",             icon: Webhook },
  { name: "Page Builder",     href: "/admin/page-builder",         icon: FileCode2 },
  {
    name: "Bonga Points", icon: Star,
    children: [
      { name: "Dashboard",      href: "/admin/bonga" },
      { name: "Redeem",         href: "/admin/bonga?tab=redeem" },
    ],
  },
  {
    name: "Extras", icon: Settings,
    children: [
      { name: "SMS Gateway",    href: "/admin/extras/sms" },
      { name: "Email Config",   href: "/admin/extras/email" },
    ],
  },
  {
    name: "UISP", icon: Activity,
    children: [
      { name: "Devices",        href: "/admin/uisp" },
      { name: "Sites",          href: "/admin/uisp?tab=sites" },
    ],
  },
  {
    name: "VPN & Remote Access", icon: Shield, badge: "New",
    children: [
      { name: "VPN Dashboard",  href: "/admin/vpn" },
      { name: "Remote Access",  href: "/admin/vpn/remote-access" },
      { name: "VPN Users",      href: "/admin/vpn/list" },
      { name: "Create VPN",     href: "/admin/vpn/create" },
      { name: "VPN Settings",   href: "/admin/vpn/settings" },
    ],
  },
  {
    name: "Logs", icon: BookOpen,
    children: [
      { name: "Auth Logs",      href: "/admin/logs" },
      { name: "System Logs",    href: "/admin/logs?type=system" },
    ],
  },
  { name: "Settings",         href: "/admin/settings",             icon: Settings },
  { name: "FreeRADIUS",       href: "/admin/radius",               icon: Shield },
];

const SIDEBAR_W = 240;

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen]     = useState(true);
  const [expanded,    setExpanded]        = useState<string[]>(["Network", "Customers"]);
  const { toggle, isDark }               = useTheme();
  const brand                            = useBrand();
  const adminName                        = getAdminName();
  const queryClient                      = useQueryClient();
  const impersonating                    = isImpersonating();
  const impersonatedName                 = getImpersonatedName();

  const handleLogout = () => {
    clearAdminAuth();
    queryClient.clear();
    setLocation("/admin/login");
  };

  useEffect(() => {
    const id = localStorage.getItem("ochola_admin_id");
    if (!id) {
      setLocation("/admin/login");
      return;
    }
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "ochola_admin_id" && !e.newValue) {
        clearAdminAuth();
        queryClient.clear();
        setLocation("/admin/login");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleExitImpersonation = () => {
    stopImpersonation();
    queryClient.clear();
    setLocation("/super-admin/admins");
  };

  const toggleExpand = (name: string) =>
    setExpanded(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]);

  const isActive = (item: NavItem) => {
    if (item.href) {
      const base = item.href.split("?")[0];
      return location === item.href || location === base;
    }
    return !!item.children?.some(c => location.startsWith(c.href.split("?")[0]));
  };

  const isChildActive = (href: string) => location.startsWith(href.split("?")[0]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      background: "var(--isp-bg)",
      fontFamily: "'Inter', sans-serif",
    }}>

      {/* ════════════════════════════════════════════════════════════
          SIDEBAR — always dark navy
      ════════════════════════════════════════════════════════════ */}
      <aside style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        width: sidebarOpen ? SIDEBAR_W : 0,
        overflow: "hidden",
        background: "#0F172A",
        minHeight: "100vh",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        zIndex: 20,
        boxShadow: "2px 0 8px rgba(0,0,0,0.15)",
      }}>

        {/* Logo strip */}
        <div style={{
          padding: "16px 16px 14px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 2px 8px rgba(37,99,235,0.4)",
            }}>
              <Zap size={16} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#F1F5F9", letterSpacing: "-0.01em", lineHeight: 1.1 }}>
                {brand.ispName || "ISPlatty"}
              </div>
              <div style={{ fontSize: "0.6rem", color: "#475569", fontWeight: 500 }}>
                Admin Panel
              </div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              cursor: "pointer", color: "#64748B", padding: "4px 6px",
              display: "flex", borderRadius: 6, transition: "all 0.15s",
              flexShrink: 0,
            }}
            title="Collapse sidebar"
          >
            <X size={13} />
          </button>
        </div>

        {/* Nav scroll area */}
        <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 0 16px" }}>
          {navItems.map((item) => {
            const active      = isActive(item);
            const expanded_   = expanded.includes(item.name);
            const hasChildren = !!(item.children?.length);

            return (
              <div key={item.name}>
                {item.href && !hasChildren ? (
                  <Link href={item.href}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "7px 10px 7px 14px",
                        margin: "1px 8px",
                        borderRadius: 8,
                        fontSize: "0.8rem",
                        fontWeight: active ? 600 : 400,
                        color: active ? "#93C5FD" : "#94A3B8",
                        background: active ? "rgba(37,99,235,0.18)" : "transparent",
                        borderLeft: active ? "2px solid #3B82F6" : "2px solid transparent",
                        cursor: "pointer",
                        transition: "all 0.13s ease",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                      }}
                      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#CBD5E1"; }}}
                      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#94A3B8"; }}}
                    >
                      <span style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: active ? "rgba(59,130,246,0.20)" : "rgba(255,255,255,0.04)",
                      }}>
                        <item.icon size={12} style={{ color: active ? "#60A5FA" : "#64748B" }} />
                      </span>
                      <span>{item.name}</span>
                    </div>
                  </Link>
                ) : (
                  <div
                    onClick={() => toggleExpand(item.name)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px 7px 14px",
                      margin: "1px 8px",
                      borderRadius: 8,
                      fontSize: "0.8rem",
                      fontWeight: active ? 600 : 400,
                      color: active ? "#93C5FD" : "#94A3B8",
                      background: active ? "rgba(37,99,235,0.18)" : "transparent",
                      borderLeft: active ? "2px solid #3B82F6" : "2px solid transparent",
                      cursor: "pointer",
                      transition: "all 0.13s ease",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                    onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#CBD5E1"; }}}
                    onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#94A3B8"; }}}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: active ? "rgba(59,130,246,0.20)" : "rgba(255,255,255,0.04)",
                      }}>
                        <item.icon size={12} style={{ color: active ? "#60A5FA" : "#64748B" }} />
                      </span>
                      <span>{item.name}</span>
                      {item.badge && (
                        <span style={{
                          fontSize: "0.5rem", padding: "1px 5px", borderRadius: 99,
                          background: "#2563EB", color: "white",
                          fontWeight: 800, letterSpacing: "0.06em",
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      size={11}
                      style={{
                        flexShrink: 0, color: "#475569",
                        transform: expanded_ ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.18s ease",
                      }}
                    />
                  </div>
                )}

                {/* Child items */}
                {hasChildren && expanded_ && (
                  <div style={{
                    marginLeft: 24,
                    paddingLeft: 12,
                    borderLeft: "1px solid rgba(255,255,255,0.06)",
                    marginBottom: 2,
                  }}>
                    {item.children!.map((child) => {
                      const childActive = isChildActive(child.href);
                      return (
                        <Link key={child.href} href={child.href}>
                          <div
                            style={{
                              padding: "5px 10px",
                              margin: "1px 0",
                              borderRadius: 6,
                              fontSize: "0.755rem",
                              fontWeight: childActive ? 600 : 400,
                              color: childActive ? "#93C5FD" : "#64748B",
                              cursor: "pointer",
                              transition: "color 0.12s ease, background 0.12s ease",
                              whiteSpace: "nowrap",
                              background: childActive ? "rgba(37,99,235,0.14)" : "transparent",
                            }}
                            onMouseEnter={e => { if (!childActive) { (e.currentTarget as HTMLElement).style.color = "#CBD5E1"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = childActive ? "#93C5FD" : "#64748B"; (e.currentTarget as HTMLElement).style.background = childActive ? "rgba(37,99,235,0.14)" : "transparent"; }}
                          >
                            {child.name}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom: user strip */}
        <div style={{
          padding: "12px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg,#2563EB,#1E40AF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.78rem", fontWeight: 700, color: "white", flexShrink: 0,
          }}>
            {(adminName || "A").charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <div style={{ fontSize: "0.765rem", fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {adminName || brand.adminName || "Administrator"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: "0.62rem", color: "#22C55E", fontWeight: 600 }}>Online</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              flexShrink: 0, background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.18)",
              cursor: "pointer", color: "#F87171",
              padding: "5px 7px", display: "flex", borderRadius: 7,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget.style.background = "rgba(239,68,68,0.16)"); (e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"); }}
            onMouseLeave={e => { (e.currentTarget.style.background = "rgba(239,68,68,0.08)"); (e.currentTarget.style.borderColor = "rgba(239,68,68,0.18)"); }}
          >
            <LogOut size={13} />
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════════════════════════
          MAIN AREA
      ════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: "100vh" }}>

        {/* ── HEADER ─────────────────────────────────────────────── */}
        <header style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 24px",
          height: 56,
          background: isDark ? "var(--isp-header)" : "#FFFFFF",
          borderBottom: isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #E2E8F0",
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: 30,
          boxShadow: isDark ? "0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.4)" : "0 1px 4px rgba(0,0,0,0.06)",
        }}>

          {/* Hamburger */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "1px solid var(--isp-border)",
              cursor: "pointer", color: "var(--isp-text-muted)",
              padding: "6px 8px", borderRadius: 8, display: "flex", transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
          >
            <Menu size={16} />
          </button>

          {/* Brand when sidebar collapsed */}
          {!sidebarOpen && (
            <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--isp-text)", letterSpacing: "-0.01em", flexShrink: 0 }}>
              {brand.ispName || "ISPlatty"}
            </span>
          )}

          {/* Search */}
          <div style={{
            flex: 1, maxWidth: 360,
            display: "flex", alignItems: "center",
            background: isDark ? "var(--isp-input-bg)" : "#F8FAFC",
            border: "1px solid var(--isp-border)",
            borderRadius: 9, overflow: "hidden",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
            onFocusCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "#2563EB";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)";
            }}
            onBlurCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--isp-border)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <Search size={13} style={{ color: "var(--isp-text-sub)", marginLeft: 11, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search customers, routers…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                color: "var(--isp-text)", fontSize: "0.8rem", padding: "7px 10px",
                fontFamily: "inherit",
              }}
            />
            <kbd style={{
              margin: "0 8px", padding: "2px 6px", borderRadius: 5,
              background: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9",
              border: "1px solid var(--isp-border)",
              color: "var(--isp-text-sub)", fontSize: "0.62rem", fontFamily: "inherit", flexShrink: 0,
            }}>⌘K</kbd>
          </div>

          <div style={{ flex: 1 }} />

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

            {/* System status pill */}
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 11px", borderRadius: 20,
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.18)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#16A34A", letterSpacing: "0.04em" }}>LIVE</span>
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggle}
              title={isDark ? "Switch to light" : "Switch to dark"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--isp-border)",
                color: "var(--isp-text-muted)", cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Notifications */}
            <button
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--isp-border)",
                color: "var(--isp-text-muted)", cursor: "pointer",
                transition: "all 0.15s", position: "relative",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
            >
              <Bell size={14} />
            </button>

            {/* Avatar pill */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 12px 4px 4px",
              background: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC",
              border: "1px solid var(--isp-border)",
              borderRadius: 99, cursor: "default",
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: "linear-gradient(135deg,#2563EB,#1E40AF)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.72rem", fontWeight: 700, color: "white", flexShrink: 0,
              }}>
                {(adminName || "A").charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                {adminName || brand.adminName || "Administrator"}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sign out"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px", borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--isp-border)",
                color: "var(--isp-text-muted)", fontSize: "0.775rem",
                cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--isp-border)"; }}
            >
              <LogOut size={13} />
              Logout
            </button>
          </div>
        </header>

        {/* ── Impersonation banner ─────────────────────────────── */}
        {impersonating && (
          <div style={{
            background: "linear-gradient(90deg,#92400e,#78350f)",
            borderBottom: "1px solid rgba(251,191,36,0.3)",
            padding: "8px 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>⚠️</span>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#fde68a" }}>
                Super Admin Mode — Impersonating: <span style={{ color: "white" }}>{impersonatedName}</span>
              </span>
            </div>
            <button
              onClick={handleExitImpersonation}
              style={{
                padding: "4px 14px", borderRadius: 8,
                background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.4)",
                color: "#fde68a", fontSize: "0.75rem", fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Exit Impersonation
            </button>
          </div>
        )}

        {/* ── Page content ────────────────────────────────────── */}
        <main style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
