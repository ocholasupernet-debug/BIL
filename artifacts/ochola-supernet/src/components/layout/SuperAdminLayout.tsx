import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, ShieldCheck, Settings, CreditCard,
  Router, Receipt, BarChart3, Lock, Bell, Zap, Database,
  Plug, Gauge, LogOut, Menu, X, ChevronRight,
  Server, Globe,
} from "lucide-react";

const S = {
  bg:      "#070b14",
  sidebar: "#0c1120",
  border:  "rgba(99,102,241,0.15)",
  accent:  "#6366f1",
  accent2: "#8b5cf6",
  text:    "#e2e8f0",
  muted:   "#64748b",
  card:    "rgba(255,255,255,0.04)",
};

interface NavSection {
  label: string;
  items: { name: string; href: string; icon: React.ElementType }[];
}

const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard",     href: "/super-admin/dashboard",  icon: LayoutDashboard },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Admins",              href: "/super-admin/admins",   icon: Users        },
      { name: "Roles & Permissions", href: "/super-admin/roles",    icon: ShieldCheck  },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { name: "System Settings", href: "/super-admin/settings", icon: Settings },
      { name: "Routers",         href: "/super-admin/routers",  icon: Router   },
      { name: "System Limits",   href: "/super-admin/limits",   icon: Gauge    },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Payment Gateways", href: "/super-admin/payments", icon: CreditCard },
      { name: "Billing Engine",   href: "/super-admin/billing",  icon: Receipt    },
      { name: "Reports",          href: "/super-admin/reports",  icon: BarChart3  },
    ],
  },
  {
    label: "Operations",
    items: [
      { name: "Security Logs",  href: "/super-admin/security-logs",  icon: Lock },
      { name: "Notifications",  href: "/super-admin/notifications",  icon: Bell },
      { name: "Automation",     href: "/super-admin/automation",     icon: Zap  },
    ],
  },
  {
    label: "DevOps",
    items: [
      { name: "Backups",           href: "/super-admin/backups", icon: Database },
      { name: "API & Integrations",href: "/super-admin/api",     icon: Plug     },
    ],
  },
];

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: S.bg, color: S.text, fontFamily: "system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside style={{
        width: collapsed ? 64 : 240, flexShrink: 0, display: "flex", flexDirection: "column",
        background: S.sidebar, borderRight: `1px solid ${S.border}`,
        transition: "width 0.2s", overflow: "hidden",
        position: "sticky", top: 0, height: "100vh",
      }}>
        {/* Logo */}
        <div style={{ padding: collapsed ? "20px 12px" : "20px 20px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Server size={18} color="white" />
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 800, fontSize: "0.875rem", color: "white", margin: 0, whiteSpace: "nowrap" }}>Super Admin</p>
              <p style={{ fontSize: "0.65rem", color: S.accent, margin: 0 }}>isplatty.org</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{ background: "none", border: "none", color: S.muted, cursor: "pointer", padding: 4, flexShrink: 0, marginLeft: "auto" }}
          >
            {collapsed ? <Menu size={16} /> : <X size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {NAV.map(section => (
            <div key={section.label} style={{ marginBottom: 8 }}>
              {!collapsed && (
                <p style={{ fontSize: "0.6rem", fontWeight: 700, color: S.muted, textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 12px 4px" }}>
                  {section.label}
                </p>
              )}
              {section.items.map(item => {
                const active = location === item.href || location.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href}>
                    <a style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: collapsed ? "10px 14px" : "9px 12px",
                      borderRadius: 8, marginBottom: 2, textDecoration: "none",
                      background: active ? "rgba(99,102,241,0.15)" : "transparent",
                      border: active ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                      color: active ? "#a5b4fc" : S.muted,
                      fontWeight: active ? 700 : 500,
                      fontSize: "0.8rem",
                      transition: "all 0.15s",
                      cursor: "pointer",
                      justifyContent: collapsed ? "center" : "flex-start",
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = S.text; }}}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = S.muted; }}}
                    title={collapsed ? item.name : undefined}
                    >
                      <item.icon size={15} style={{ flexShrink: 0 }} />
                      {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>}
                      {!collapsed && active && <ChevronRight size={12} style={{ marginLeft: "auto", opacity: 0.6 }} />}
                    </a>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: collapsed ? "12px 8px" : "16px 16px", borderTop: `1px solid ${S.border}`, flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "white" }}>SA</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "white", margin: 0 }}>Super Admin</p>
                <p style={{ fontSize: "0.65rem", color: S.accent, margin: 0 }}>Platform Owner</p>
              </div>
            </div>
          )}
          <Link href="/admin/login">
            <a style={{
              display: "flex", alignItems: "center", gap: 8, justifyContent: collapsed ? "center" : "flex-start",
              padding: "8px 10px", borderRadius: 8, textDecoration: "none",
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
            }}>
              <LogOut size={14} />
              {!collapsed && "Sign Out"}
            </a>
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: "auto", background: S.bg }}>
        {/* Top bar */}
        <div style={{ padding: "16px 32px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: S.bg, zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={14} color={S.muted} />
            <span style={{ fontSize: "0.75rem", color: S.muted }}>isplatty.org</span>
            <span style={{ color: S.border }}>·</span>
            <span style={{ fontSize: "0.75rem", color: S.accent, fontWeight: 600 }}>Super Admin Console</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 600 }}>All Systems Operational</span>
          </div>
        </div>

        <div style={{ padding: "32px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
