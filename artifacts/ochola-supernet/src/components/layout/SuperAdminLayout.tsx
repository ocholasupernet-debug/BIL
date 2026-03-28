import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { useTheme } from "@/hooks/use-theme";
import {
  LayoutDashboard, Users, ShieldCheck, Settings, CreditCard,
  Router, Receipt, BarChart3, Lock, Bell, Zap, Database,
  Plug, Gauge, LogOut, Menu, X, ChevronRight,
  Globe, LogIn, Sun, Moon,
} from "lucide-react";

/* ── Theme-aware colour tokens ───────────────────────────────── */
const DARK = {
  bg:      "#070b14",
  sidebar: "#0c1120",
  border:  "rgba(99,102,241,0.15)",
  accent:  "#6366f1",
  text:    "#e2e8f0",
  muted:   "#64748b",
  card:    "rgba(255,255,255,0.04)",
  navActive:   "rgba(99,102,241,0.15)",
  navActiveBorder: "rgba(99,102,241,0.25)",
  navActiveText:   "#a5b4fc",
  navHover:    "rgba(255,255,255,0.05)",
  footerBg:    "#0c1120",
};

const LIGHT = {
  bg:      "#f1f5f9",
  sidebar: "#ffffff",
  border:  "rgba(99,102,241,0.2)",
  accent:  "#6366f1",
  text:    "#1e293b",
  muted:   "#64748b",
  card:    "rgba(0,0,0,0.03)",
  navActive:   "rgba(99,102,241,0.1)",
  navActiveBorder: "rgba(99,102,241,0.3)",
  navActiveText:   "#6366f1",
  navHover:    "rgba(0,0,0,0.04)",
  footerBg:    "#ffffff",
};

interface NavSection {
  label: string;
  items: { name: string; href: string; icon: React.ElementType }[];
}

const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/super-admin/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Admins",              href: "/super-admin/admins",       icon: Users       },
      { name: "Impersonate Admin",   href: "/super-admin/impersonate",  icon: LogIn       },
      { name: "Roles & Permissions", href: "/super-admin/roles",        icon: ShieldCheck },
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
      { name: "Security Logs", href: "/super-admin/security-logs", icon: Lock },
      { name: "Notifications", href: "/super-admin/notifications", icon: Bell },
      { name: "Automation",    href: "/super-admin/automation",    icon: Zap  },
    ],
  },
  {
    label: "DevOps",
    items: [
      { name: "Backups",            href: "/super-admin/backups", icon: Database },
      { name: "API & Integrations", href: "/super-admin/api",     icon: Plug     },
    ],
  },
];

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [location]  = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { isDark, toggle } = useTheme();
  const S = isDark ? DARK : LIGHT;

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: S.bg, color: S.text, fontFamily: "system-ui, sans-serif" }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: collapsed ? 64 : 240, flexShrink: 0, display: "flex", flexDirection: "column",
        background: S.sidebar, borderRight: `1px solid ${S.border}`,
        transition: "width 0.2s", overflow: "hidden",
        position: "sticky", top: 0, height: "100vh",
        boxShadow: isDark ? "none" : "1px 0 8px rgba(0,0,0,0.06)",
      }}>

        {/* Logo row */}
        <div style={{
          padding: collapsed ? "14px 10px" : "14px 16px",
          borderBottom: `1px solid ${S.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          {collapsed ? <Logo size="xs" iconOnly /> : <Logo size="sm" />}
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{ background: "none", border: "none", color: S.muted, cursor: "pointer", padding: 4, flexShrink: 0 }}
          >
            {collapsed ? <Menu size={16} /> : <X size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {NAV.map(section => (
            <div key={section.label} style={{ marginBottom: 8 }}>
              {!collapsed && (
                <p style={{
                  fontSize: "0.6rem", fontWeight: 700, color: S.muted,
                  textTransform: "uppercase", letterSpacing: "0.1em",
                  padding: "8px 12px 4px", margin: 0,
                }}>
                  {section.label}
                </p>
              )}
              {section.items.map(item => {
                const active = location === item.href || location.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: collapsed ? "10px 14px" : "9px 12px",
                      borderRadius: 8, marginBottom: 2, textDecoration: "none",
                      background: active ? S.navActive : "transparent",
                      border: `1px solid ${active ? S.navActiveBorder : "transparent"}`,
                      color: active ? S.navActiveText : S.muted,
                      fontWeight: active ? 700 : 500,
                      fontSize: "0.8rem",
                      transition: "all 0.15s",
                      cursor: "pointer",
                      justifyContent: collapsed ? "center" : "flex-start",
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { if (!active) { (e.currentTarget as HTMLElement).style.background = S.navHover; (e.currentTarget as HTMLElement).style.color = S.text; }}}
                    onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = S.muted; }}}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon size={15} style={{ flexShrink: 0 }} />
                    {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{item.name}</span>}
                    {!collapsed && active && <ChevronRight size={12} style={{ marginLeft: "auto", opacity: 0.6 }} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: collapsed ? "12px 8px" : "16px 16px", borderTop: `1px solid ${S.border}`, flexShrink: 0, background: S.footerBg }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "white" }}>SA</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.78rem", fontWeight: 700, color: S.text, margin: 0 }}>Super Admin</p>
                <p style={{ fontSize: "0.65rem", color: S.accent, margin: 0 }}>Platform Owner</p>
              </div>
            </div>
          )}
          <Link
            href="/admin/login"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              justifyContent: collapsed ? "center" : "flex-start",
              padding: "8px 10px", borderRadius: 8, textDecoration: "none",
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            <LogOut size={14} />
            {!collapsed && "Sign Out"}
          </Link>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: "auto", background: S.bg }}>

        {/* Top bar */}
        <div style={{
          padding: "16px 32px",
          borderBottom: `1px solid ${S.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, background: S.bg, zIndex: 10,
          backdropFilter: isDark ? "none" : "blur(8px)",
        }}>
          {/* Left: breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={14} color={S.muted} />
            <span style={{ fontSize: "0.75rem", color: S.muted }}>isplatty.org</span>
            <span style={{ color: S.border }}>·</span>
            <span style={{ fontSize: "0.75rem", color: S.accent, fontWeight: 600 }}>Super Admin Console</span>
          </div>

          {/* Right: status + theme toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
              <span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 600 }}>All Systems Operational</span>
            </div>

            {/* Light / Dark toggle */}
            <button
              onClick={toggle}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 8, cursor: "pointer",
                border: `1px solid ${S.border}`,
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(99,102,241,0.08)",
                color: isDark ? "#94a3b8" : "#6366f1",
                transition: "all 0.2s",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.12)" : "rgba(99,102,241,0.15)";
                e.currentTarget.style.color = isDark ? "#e2e8f0" : "#6366f1";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.06)" : "rgba(99,102,241,0.08)";
                e.currentTarget.style.color = isDark ? "#94a3b8" : "#6366f1";
              }}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>

        <div style={{ padding: "32px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
