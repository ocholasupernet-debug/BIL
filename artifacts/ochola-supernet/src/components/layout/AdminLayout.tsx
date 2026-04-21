import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Ticket, Package, CreditCard,
  Network, Settings, Bell, Wifi, Layers, Shield,
  Globe, Radio, MonitorSmartphone, Sliders, FileCode2, Star,
  Activity, BookOpen, LogOut, Webhook, ChevronRight,
  Zap, MessageSquare, CheckSquare, Search, Sun, Moon, Menu,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useBrand } from "@/context/BrandContext";
import { clearAdminAuth, getAdminName } from "@/lib/supabase";

interface NavChild {
  name: string;
  href: string;
}

interface NavItem {
  name: string;
  href?: string;
  icon: React.ElementType;
  badge?: string;
  children?: NavChild[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Customers",
    items: [
      {
        name: "Customers", icon: Users,
        children: [
          { name: "All Customers", href: "/admin/customers" },
          { name: "Active",        href: "/admin/customers?status=active" },
          { name: "Expired",       href: "/admin/customers?status=expired" },
          { name: "Online Users",  href: "/admin/customers?status=online" },
        ],
      },
      {
        name: "Activation", icon: CheckSquare, badge: "New",
        children: [
          { name: "Pending",       href: "/admin/activation" },
          { name: "Approved",      href: "/admin/activation?status=approved" },
          { name: "Prepaid Users", href: "/admin/activation/prepaid-users" },
        ],
      },
      {
        name: "Hotspot Vouchers", icon: Ticket,
        children: [
          { name: "All Vouchers",  href: "/admin/vouchers" },
          { name: "Generate",      href: "/admin/vouchers?action=generate" },
          { name: "Batches",       href: "/admin/vouchers?tab=batches" },
        ],
      },
      {
        name: "Hotspot Binding", icon: Wifi,
        children: [
          { name: "Bindings",      href: "/admin/hotspot-binding" },
          { name: "Sessions",      href: "/admin/hotspot-binding?tab=sessions" },
        ],
      },
    ],
  },
  {
    label: "Billing",
    items: [
      {
        name: "Packages / Plans", icon: Package,
        children: [
          { name: "Hotspot Plans", href: "/admin/plans?type=hotspot" },
          { name: "PPPoE Plans",   href: "/admin/plans?type=pppoe" },
          { name: "Static IP",     href: "/admin/plans?type=static" },
          { name: "Bandwidth",     href: "/admin/plans?type=bandwidth" },
          { name: "Trials",        href: "/admin/plans?type=trials" },
          { name: "FUP",           href: "/admin/plans?type=fup" },
        ],
      },
      {
        name: "Transactions", icon: CreditCard,
        children: [
          { name: "All",             href: "/admin/transactions" },
          { name: "M-Pesa",          href: "/admin/transactions?method=mpesa" },
          { name: "Voucher Sales",   href: "/admin/transactions?method=voucher" },
          { name: "Graphs",          href: "/admin/transactions/graphs" },
          { name: "Invoices",        href: "/admin/invoices" },
          { name: "Customer Balance",href: "/admin/balance" },
        ],
      },
    ],
  },
  {
    label: "Network",
    items: [
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
        name: "Access Points", icon: MonitorSmartphone, badge: "New",
        children: [
          { name: "All APs",  href: "/admin/access-points" },
          { name: "Add New",  href: "/admin/access-points?action=add" },
        ],
      },
      {
        name: "PPPoE Settings", icon: Sliders,
        children: [
          { name: "General",   href: "/admin/pppoe-settings" },
          { name: "Profiles",  href: "/admin/pppoe-settings?tab=profiles" },
        ],
      },
      {
        name: "Hotspot Settings", icon: Wifi,
        children: [
          { name: "General",    href: "/admin/hotspot-settings" },
          { name: "Login Page", href: "/admin/hotspot-settings?tab=login" },
        ],
      },
    ],
  },
  {
    label: "Tools",
    items: [
      {
        name: "VPN & Remote Access", icon: Shield, badge: "New",
        children: [
          { name: "VPN Dashboard", href: "/admin/vpn" },
          { name: "Remote Access", href: "/admin/vpn/remote-access" },
          { name: "VPN Users",     href: "/admin/vpn/list" },
          { name: "Create VPN",    href: "/admin/vpn/create" },
          { name: "VPN Settings",  href: "/admin/vpn/settings" },
        ],
      },
      {
        name: "Bulk Actions", icon: Layers,
        children: [
          { name: "Renew Expired", href: "/admin/bulk" },
          { name: "Send SMS",      href: "/admin/bulk?action=sms" },
        ],
      },
      {
        name: "UISP", icon: Activity,
        children: [
          { name: "Devices", href: "/admin/uisp" },
          { name: "Sites",   href: "/admin/uisp?tab=sites" },
        ],
      },
      {
        name: "Bonga Points", icon: Star,
        children: [
          { name: "Dashboard", href: "/admin/bonga" },
          { name: "Redeem",    href: "/admin/bonga?tab=redeem" },
        ],
      },
      { name: "Webhooks",    href: "/admin/webhooks",      icon: Webhook },
      { name: "TR069 ACS",   href: "/admin/acs",           icon: Radio },
      { name: "Page Builder",href: "/admin/page-builder",  icon: FileCode2 },
    ],
  },
  {
    label: "Admin",
    items: [
      { name: "Support Tickets", href: "/admin/support", icon: MessageSquare },
      {
        name: "Notifications", icon: Bell,
        children: [
          { name: "All",              href: "/admin/notifications" },
          { name: "Expiry Alerts",    href: "/admin/notifications?type=expiry" },
          { name: "Message Templates",href: "/admin/message-templates" },
        ],
      },
      {
        name: "Logs", icon: BookOpen,
        children: [
          { name: "Auth Logs",   href: "/admin/logs" },
          { name: "System Logs", href: "/admin/logs?type=system" },
        ],
      },
      {
        name: "Extras", icon: Settings,
        children: [
          { name: "SMS Gateway",  href: "/admin/extras/sms" },
          { name: "Email Config", href: "/admin/extras/email" },
        ],
      },
      { name: "FreeRADIUS", href: "/admin/radius",   icon: Shield },
      { name: "Settings",   href: "/admin/settings", icon: Settings },
      { name: "Static Pages",href: "/admin/pages",   icon: Globe },
    ],
  },
];

const SIDEBAR_W = 248;

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expanded, setExpanded]       = useState<string[]>(["Network", "Customers"]);
  const { toggle, isDark }            = useTheme();
  const brand                         = useBrand();
  const adminName                     = getAdminName();
  const queryClient                   = useQueryClient();

  const handleLogout = () => {
    clearAdminAuth();
    queryClient.clear();
    setLocation("/admin/login");
  };

  useEffect(() => {
    const id = localStorage.getItem("ochola_admin_id");
    if (!id) { setLocation("/admin/login"); return; }
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
    <div className="admin-shell">
      <style>{adminLayoutStyles}</style>

      {/* ── SIDEBAR ──────────────────────────────────────────────── */}
      <aside className="admin-sidebar" style={{ width: sidebarOpen ? SIDEBAR_W : 0 }}>

        {/* Logo strip */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-inner">
            <div className="sidebar-logo-icon">
              <Zap size={16} color="white" />
            </div>
            <div>
              <div className="sidebar-brand-name">{brand.ispName || "ISPlatty"}</div>
              <div className="sidebar-brand-sub">Admin Panel</div>
            </div>
          </div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar">
            <Menu size={14} />
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.label} className="nav-section">
              <div className="nav-section-label">{section.label}</div>

              {section.items.map((item) => {
                const active      = isActive(item);
                const expanded_   = expanded.includes(item.name);
                const hasChildren = !!(item.children?.length);

                return (
                  <div key={item.name}>
                    {item.href && !hasChildren ? (
                      <Link href={item.href}>
                        <div className={`nav-row ${active ? "nav-row--active" : ""}`}>
                          <span className={`nav-icon ${active ? "nav-icon--active" : ""}`}>
                            <item.icon size={14} />
                          </span>
                          <span className="nav-label">{item.name}</span>
                        </div>
                      </Link>
                    ) : (
                      <>
                        <div
                          className={`nav-row ${active ? "nav-row--active" : ""}`}
                          onClick={() => toggleExpand(item.name)}
                        >
                          <span className={`nav-icon ${active ? "nav-icon--active" : ""}`}>
                            <item.icon size={14} />
                          </span>
                          <span className="nav-label">{item.name}</span>
                          {item.badge && (
                            <span className="nav-badge">{item.badge}</span>
                          )}
                          <ChevronRight
                            size={12}
                            className={`nav-chevron ${expanded_ ? "nav-chevron--open" : ""}`}
                          />
                        </div>

                        {expanded_ && (
                          <div className="nav-children">
                            {item.children!.map((child) => {
                              const childActive = isChildActive(child.href);
                              return (
                                <Link key={child.href} href={child.href}>
                                  <div className={`nav-child-row ${childActive ? "nav-child-row--active" : ""}`}>
                                    <span className="nav-child-dot" />
                                    {child.name}
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User strip */}
        <div className="sidebar-user">
          <div className="sidebar-avatar">
            {(adminName || "A").charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">
              {adminName || brand.adminName || "Administrator"}
            </div>
            <div className="sidebar-user-status">
              <span className="status-dot" />
              Online
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={handleLogout} title="Sign out">
            <LogOut size={13} />
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────────── */}
      <div className="admin-main">

        {/* Header */}
        <header className={`admin-header ${isDark ? "admin-header--dark" : "admin-header--light"}`}>

          <button className="header-btn" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
            <Menu size={16} />
          </button>

          {!sidebarOpen && (
            <span className="header-brand">{brand.ispName || "ISPlatty"}</span>
          )}

          <div className="header-search">
            <Search size={13} className="header-search-icon" />
            <input
              type="text"
              placeholder="Search customers, routers…"
              className="header-search-input"
            />
            <kbd className="header-search-kbd">⌘K</kbd>
          </div>

          <div className="header-spacer" />

          <div className="header-actions">
            <div className="header-live-pill">
              <span className="live-dot" />
              <span className="live-label">LIVE</span>
            </div>

            <button className="header-btn" onClick={toggle} title={isDark ? "Switch to light" : "Switch to dark"}>
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button className="header-btn" title="Notifications">
              <Bell size={15} />
            </button>

            <div className="header-user-pill">
              <div className="header-avatar">
                {(adminName || "A").charAt(0).toUpperCase()}
              </div>
              <span className="header-user-name">
                {adminName || brand.adminName || "Admin"}
              </span>
            </div>

            <button className="header-logout-btn" onClick={handleLogout} title="Sign out">
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}

const adminLayoutStyles = `
.admin-shell {
  min-height: 100vh;
  display: flex;
  background: var(--isp-bg);
  font-family: 'Inter', sans-serif;
}

/* ── SIDEBAR ─────────────────────────────────────────── */
.admin-sidebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #0F172A;
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.4,0,0.2,1);
  position: relative;
  z-index: 20;
  box-shadow: 1px 0 0 rgba(255,255,255,0.05);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 16px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-logo-inner {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sidebar-logo-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--isp-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(37,99,235,0.4);
}

.sidebar-brand-name {
  font-size: 0.875rem;
  font-weight: 700;
  color: #F1F5F9;
  letter-spacing: -0.01em;
  line-height: 1.15;
  white-space: nowrap;
}

.sidebar-brand-sub {
  font-size: 0.625rem;
  color: #475569;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sidebar-close-btn {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  color: #475569;
  padding: 5px 7px;
  display: flex;
  border-radius: 6px;
  transition: all 0.15s;
  flex-shrink: 0;
}
.sidebar-close-btn:hover {
  background: rgba(255,255,255,0.06);
  color: #94A3B8;
}

/* ── NAV SCROLL ──────────────────────────────────────── */
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0 12px;
}
.sidebar-nav::-webkit-scrollbar { width: 3px; }
.sidebar-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 99px; }

.nav-section {
  margin-bottom: 4px;
}

.nav-section-label {
  font-size: 0.595rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #334155;
  padding: 10px 20px 4px;
  white-space: nowrap;
}

/* Nav row (top-level item) */
.nav-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px 7px 14px;
  margin: 1px 8px;
  border-radius: 7px;
  font-size: 0.8125rem;
  font-weight: 400;
  color: #6E84A3;
  background: transparent;
  cursor: pointer;
  transition: background 0.13s ease, color 0.13s ease;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
  border-left: 2px solid transparent;
}
.nav-row:hover {
  background: rgba(255,255,255,0.05);
  color: #CBD5E1;
}
.nav-row--active {
  background: rgba(37,99,235,0.15);
  color: #93C5FD !important;
  font-weight: 600;
  border-left-color: #3B82F6;
}

.nav-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255,255,255,0.04);
  color: #475569;
  transition: background 0.13s, color 0.13s;
}
.nav-row:hover .nav-icon {
  background: rgba(255,255,255,0.07);
  color: #94A3B8;
}
.nav-icon--active {
  background: rgba(59,130,246,0.2) !important;
  color: #60A5FA !important;
}

.nav-label {
  flex: 1;
}

.nav-badge {
  font-size: 0.5rem;
  padding: 1.5px 5px;
  border-radius: 99px;
  background: var(--isp-accent);
  color: white;
  font-weight: 800;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.nav-chevron {
  flex-shrink: 0;
  color: #334155;
  transition: transform 0.18s ease, color 0.13s;
}
.nav-row:hover .nav-chevron { color: #475569; }
.nav-chevron--open { transform: rotate(90deg); }

/* Sub-items */
.nav-children {
  margin: 1px 8px 2px 28px;
  padding-left: 14px;
  border-left: 1px solid rgba(255,255,255,0.06);
}

.nav-child-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5.5px 10px;
  margin: 1px 0;
  border-radius: 6px;
  font-size: 0.775rem;
  font-weight: 400;
  color: #4E637D;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
  white-space: nowrap;
  text-decoration: none;
  user-select: none;
}
.nav-child-row:hover {
  color: #CBD5E1;
  background: rgba(255,255,255,0.04);
}
.nav-child-row--active {
  color: #93C5FD !important;
  font-weight: 600;
  background: rgba(37,99,235,0.12);
}

.nav-child-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #334155;
  flex-shrink: 0;
  transition: background 0.12s;
}
.nav-child-row:hover .nav-child-dot { background: #64748B; }
.nav-child-row--active .nav-child-dot { background: #60A5FA !important; }

/* ── SIDEBAR USER STRIP ──────────────────────────────── */
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--isp-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.sidebar-user-info {
  flex: 1;
  overflow: hidden;
  min-width: 0;
}

.sidebar-user-name {
  font-size: 0.775rem;
  font-weight: 600;
  color: #E2E8F0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-user-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
  font-size: 0.625rem;
  color: #22C55E;
  font-weight: 600;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
  flex-shrink: 0;
}

.sidebar-logout-btn {
  flex-shrink: 0;
  background: rgba(239,68,68,0.06);
  border: 1px solid rgba(239,68,68,0.15);
  cursor: pointer;
  color: #94A3B8;
  padding: 5px 7px;
  display: flex;
  border-radius: 7px;
  transition: all 0.15s;
}
.sidebar-logout-btn:hover {
  background: rgba(239,68,68,0.14);
  border-color: rgba(239,68,68,0.28);
  color: #F87171;
}

/* ── MAIN AREA ───────────────────────────────────────── */
.admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
}

/* ── HEADER ──────────────────────────────────────────── */
.admin-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  height: 56px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
}
.admin-header--light {
  background: #FFFFFF;
  border-bottom: 1px solid #E8EDF4;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.admin-header--dark {
  background: var(--isp-header);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  box-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.35);
}

.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--isp-border);
  color: var(--isp-text-muted);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.header-btn:hover {
  background: var(--isp-hover);
  color: var(--isp-text);
}

.header-brand {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--isp-text);
  letter-spacing: -0.01em;
  flex-shrink: 0;
}

.header-search {
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 340px;
  background: var(--isp-input-bg);
  border: 1px solid var(--isp-border);
  border-radius: 9px;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.header-search:focus-within {
  border-color: var(--isp-accent);
  box-shadow: 0 0 0 3px var(--isp-accent-glow);
}

.header-search-icon {
  color: var(--isp-text-sub);
  margin-left: 10px;
  flex-shrink: 0;
}

.header-search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--isp-text);
  font-size: 0.8rem;
  padding: 7px 10px;
  font-family: inherit;
}
.header-search-input::placeholder { color: var(--isp-text-sub); }

.header-search-kbd {
  margin: 0 8px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--isp-hover);
  border: 1px solid var(--isp-border);
  color: var(--isp-text-sub);
  font-size: 0.62rem;
  font-family: inherit;
  flex-shrink: 0;
}

.header-spacer { flex: 1; }

.header-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.header-live-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.18);
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
}
.live-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: #16A34A;
  letter-spacing: 0.06em;
}

.header-user-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px 4px 4px;
  background: var(--isp-hover);
  border: 1px solid var(--isp-border);
  border-radius: 99px;
}
.header-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--isp-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}
.header-user-name {
  font-size: 0.775rem;
  color: var(--isp-text-muted);
  font-weight: 600;
  white-space: nowrap;
}

.header-logout-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--isp-border);
  color: var(--isp-text-muted);
  font-size: 0.775rem;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  transition: all 0.15s;
}
.header-logout-btn:hover {
  background: rgba(239,68,68,0.07);
  color: #DC2626;
  border-color: rgba(239,68,68,0.22);
}

/* ── PAGE CONTENT ────────────────────────────────────── */
.admin-content {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .admin-content { padding: 16px; }
  .header-search { max-width: 180px; }
  .header-live-pill { display: none; }
  .header-logout-btn span { display: none; }
}
`;
