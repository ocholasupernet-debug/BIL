import React, { useState } from "react";
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

/* ── Nav structure ──────────────────────────────────────────────── */
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
    ],
  },
  { name: "Support Tickets",  href: "/admin/support",              icon: MessageSquare },
  {
    name: "Notifications", icon: Bell,
    children: [
      { name: "All",            href: "/admin/notifications" },
      { name: "Expiry Alerts",  href: "/admin/notifications?type=expiry" },
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
    name: "Logs", icon: BookOpen,
    children: [
      { name: "Auth Logs",      href: "/admin/logs" },
      { name: "System Logs",    href: "/admin/logs?type=system" },
    ],
  },
  { name: "Settings",         href: "/admin/settings",             icon: Settings },
  { name: "FreeRADIUS",       href: "/admin/radius",               icon: Shield },
];

/* ── Sidebar width ── */
const SIDEBAR_W = 232;

/* ═══════════════════════════════════════════════════════════════════
   AdminLayout
═══════════════════════════════════════════════════════════════════ */
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

  /* ── colour tokens ─────────────────────────────────────────────── */
  const sidebar = {
    bg:         "var(--isp-sidebar)",
    border:     "var(--isp-border)",
    text:       isDark ? "#c0cfe0" : "#374151",
    textActive: isDark ? "#c7d2fe" : "var(--isp-accent)",
    activeBg:   isDark ? "rgba(99,102,241,0.14)" : "rgba(79,70,229,0.08)",
    hoverBg:    isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
    subText:    isDark ? "#94a8c0" : "#6b7280",
    subActive:  isDark ? "#a5b4fc" : "var(--isp-accent)",
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      background: "var(--isp-bg)",
      fontFamily: "'Inter', sans-serif",
      transition: "background 0.2s",
    }}>

      {/* ════════════════════════════════════════════════════════════
          SIDEBAR
      ════════════════════════════════════════════════════════════ */}
      <aside style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        width: sidebarOpen ? SIDEBAR_W : 0,
        overflow: "hidden",
        background: sidebar.bg,
        borderRight: `1px solid ${sidebar.border}`,
        minHeight: "100vh",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        zIndex: 20,
      }}>

        {/* Logo strip */}
        <div style={{
          padding: "16px 16px 14px",
          borderBottom: `1px solid ${sidebar.border}`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <Logo size="sm" />
          <button
            onClick={() => setSidebarOpen(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: sidebar.text, padding: 4, display: "flex", borderRadius: 6, transition: "background 0.12s" }}
            title="Collapse sidebar"
          >
            <X size={14} />
          </button>
        </div>

        {/* Nav scroll area */}
        <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 0 16px" }}>
          {navItems.map((item) => {
            const active      = isActive(item);
            const expanded_   = expanded.includes(item.name);
            const hasChildren = !!(item.children?.length);

            const rowStyle: React.CSSProperties = {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              margin: "1px 8px",
              borderRadius: 8,
              fontSize: "0.795rem",
              fontWeight: active ? 600 : 500,
              color: active ? sidebar.textActive : sidebar.text,
              background: active ? sidebar.activeBg : "transparent",
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
              textDecoration: "none",
              whiteSpace: "nowrap",
              userSelect: "none",
            };

            return (
              <div key={item.name}>
                {item.href && !hasChildren ? (
                  <Link href={item.href}>
                    <div
                      style={rowStyle}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = sidebar.hoverBg; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? sidebar.activeBg : "transparent"; }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <item.icon size={14} style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }} />
                        <span>{item.name}</span>
                      </span>
                    </div>
                  </Link>
                ) : (
                  <div
                    onClick={() => toggleExpand(item.name)}
                    style={rowStyle}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = sidebar.hoverBg; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? sidebar.activeBg : "transparent"; }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <item.icon size={14} style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }} />
                      <span>{item.name}</span>
                      {item.badge && (
                        <span style={{
                          fontSize: "0.55rem", padding: "1px 5px", borderRadius: 99,
                          background: "#6366f1", color: "white", fontWeight: 700,
                          letterSpacing: "0.04em",
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      size={12}
                      style={{
                        flexShrink: 0,
                        opacity: 0.5,
                        transform: expanded_ ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.18s ease",
                      }}
                    />
                  </div>
                )}

                {/* Child items */}
                {hasChildren && expanded_ && (
                  <div style={{
                    marginLeft: 20,
                    paddingLeft: 16,
                    borderLeft: `1px solid ${sidebar.border}`,
                    marginBottom: 2,
                  }}>
                    {item.children!.map((child) => {
                      const childActive = isChildActive(child.href);
                      return (
                        <Link key={child.href} href={child.href}>
                          <div
                            style={{
                              padding: "5px 8px",
                              margin: "1px 0",
                              borderRadius: 6,
                              fontSize: "0.76rem",
                              fontWeight: childActive ? 600 : 400,
                              color: childActive ? sidebar.subActive : sidebar.subText,
                              cursor: "pointer",
                              transition: "color 0.12s ease, background 0.12s ease",
                              whiteSpace: "nowrap",
                              background: childActive ? (isDark ? "rgba(99,102,241,0.08)" : "rgba(79,70,229,0.06)") : "transparent",
                            }}
                            onMouseEnter={e => { if (!childActive) { (e.currentTarget as HTMLElement).style.color = isDark ? "#dde6f5" : "#4f46e5"; (e.currentTarget as HTMLElement).style.background = sidebar.hoverBg; } }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = childActive ? sidebar.subActive : sidebar.subText; (e.currentTarget as HTMLElement).style.background = childActive ? (isDark ? "rgba(99,102,241,0.08)" : "rgba(79,70,229,0.06)") : "transparent"; }}
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
          padding: "10px 12px",
          borderTop: `1px solid ${sidebar.border}`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.75rem", fontWeight: 800, color: "white", flexShrink: 0,
          }}>
            {(adminName || "A").charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <div style={{ fontSize: "0.775rem", fontWeight: 600, color: "var(--isp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {adminName || brand.adminName || "Administrator"}
            </div>
            <div style={{ fontSize: "0.68rem", color: sidebar.subText }}>Admin</div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              flexShrink: 0, background: "none", border: "none", cursor: "pointer",
              color: sidebar.subText, padding: 4, display: "flex", borderRadius: 6,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
            onMouseLeave={e => (e.currentTarget.style.color = sidebar.subText)}
          >
            <LogOut size={14} />
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
          padding: "0 20px",
          height: 54,
          background: "var(--isp-header)",
          borderBottom: `1px solid var(--isp-border-subtle)`,
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: 30,
          backdropFilter: "blur(12px)",
          transition: "background 0.2s",
        }}>

          {/* Hamburger */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              flexShrink: 0, background: "none", border: "none", cursor: "pointer",
              color: "var(--isp-text-muted)", padding: 6, borderRadius: 8, display: "flex",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
          >
            <Menu size={17} />
          </button>

          {/* Brand name (shown when sidebar is collapsed) */}
          {!sidebarOpen && (
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--isp-text)", letterSpacing: "-0.01em", flexShrink: 0 }}>
              {brand.ispName}
            </span>
          )}

          {/* Search */}
          <div style={{
            flex: 1, maxWidth: 360,
            display: "flex", alignItems: "center",
            background: "var(--isp-input-bg)",
            border: "1px solid var(--isp-input-border)",
            borderRadius: 9, overflow: "hidden",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
            onFocusCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--isp-accent)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px var(--isp-accent-glow)";
            }}
            onBlurCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--isp-input-border)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <Search size={13} style={{ color: "var(--isp-text-sub)", marginLeft: 12, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search users…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                color: "var(--isp-text)", fontSize: "0.8rem", padding: "8px 10px",
                fontFamily: "inherit",
              }}
            />
            <kbd style={{
              margin: "0 8px", padding: "2px 6px", borderRadius: 5,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--isp-text-sub)", fontSize: "0.62rem", fontFamily: "inherit",
              flexShrink: 0,
            }}>⌘K</kbd>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

            {/* Quick Actions */}
            <button style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8,
              background: "var(--isp-input-bg)",
              border: "1px solid var(--isp-input-border)",
              color: "var(--isp-text-muted)", fontSize: "0.775rem",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              transition: "all 0.15s",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-input-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
            >
              <Zap size={12} style={{ color: "#fbbf24" }} />
              Quick Actions
              <ChevronDown size={11} style={{ opacity: 0.6 }} />
            </button>

            {/* Region */}
            <button style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 10px", borderRadius: 8,
              background: "var(--isp-input-bg)",
              border: "1px solid var(--isp-input-border)",
              color: "var(--isp-text-muted)", fontSize: "0.75rem",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              transition: "all 0.15s",
            }}>
              🇰🇪 <span>KE</span>
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggle}
              title={isDark ? "Switch to light" : "Switch to dark"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 8,
                background: "var(--isp-input-bg)",
                border: "1px solid var(--isp-input-border)",
                color: "var(--isp-text-muted)", cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--isp-input-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--isp-text-muted)"; }}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Avatar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 10px 4px 4px",
              background: "var(--isp-input-bg)",
              border: "1px solid var(--isp-input-border)",
              borderRadius: 99, cursor: "default",
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: 800, color: "white", flexShrink: 0,
              }}>
                {(adminName || "A").charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: "0.775rem", color: "var(--isp-text-muted)", fontWeight: 500, whiteSpace: "nowrap" }}>
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
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.18)",
                color: "#f87171", fontSize: "0.775rem",
                cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.14)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.3)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.07)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.18)"; }}
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
            padding: "8px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>⚠️</span>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#fde68a" }}>
                Super Admin Mode — Impersonating: <span style={{ color: "white" }}>{impersonatedName}</span>
              </span>
              <span style={{ fontSize: "0.72rem", color: "#fbbf24", opacity: 0.8 }}>
                · All actions are performed under this admin's account
              </span>
            </div>
            <button
              onClick={handleExitImpersonation}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.35)",
                borderRadius: 7, padding: "5px 14px", color: "#fde68a",
                fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                transition: "background 0.15s",
              }}
            >
              <LogOut size={12} /> Exit Impersonation
            </button>
          </div>
        )}

        {/* ── Page content ──────────────────────────────────────── */}
        <main style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px",
          background: "var(--isp-bg)",
          transition: "background 0.2s",
        }}>
          {children}
        </main>
      </div>
    </div>
  );
}
