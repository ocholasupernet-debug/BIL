import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { useTheme } from "@/context/ThemeContext";
import {
  LayoutDashboard, Users, ShieldCheck, Settings, CreditCard, Package,
  Router, Receipt, BarChart3, Lock, Bell, Zap, Database,
  Plug, Gauge, LogOut, Menu, ChevronRight,
  Globe, LogIn, Sun, Moon, Clock, PanelLeftClose,
} from "lucide-react";

interface NavSection {
  label: string;
  items: { name: string; href: string; icon: React.ElementType }[];
}

/* Service order follows the platform owner's working rhythm:
   orient → manage tenants → inspect network → reconcile money → operate platform. */
const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", href: "/super-admin/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Tenants",
    items: [
      { name: "ISP Admins", href: "/super-admin/admins", icon: Users },
      { name: "Roles & Permissions", href: "/super-admin/roles", icon: ShieldCheck },
      { name: "Impersonate Admin", href: "/super-admin/impersonate", icon: LogIn },
    ],
  },
  {
    label: "Network",
    items: [
      { name: "Routers", href: "/super-admin/routers", icon: Router },
      { name: "System Limits", href: "/super-admin/limits", icon: Gauge },
      { name: "System Settings", href: "/super-admin/settings", icon: Settings },
    ],
  },
  {
    label: "Billing",
    items: [
      { name: "Payments & Packages", href: "/super-admin/payment-packages", icon: Package },
      { name: "Payment Gateways", href: "/super-admin/payments", icon: CreditCard },
      { name: "Billing Engine", href: "/super-admin/billing", icon: Receipt },
      { name: "Reports", href: "/super-admin/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { name: "Security Logs", href: "/super-admin/security-logs", icon: Lock },
      { name: "Notifications", href: "/super-admin/notifications", icon: Bell },
      { name: "Automation", href: "/super-admin/automation", icon: Zap },
    ],
  },
  {
    label: "Platform",
    items: [
      { name: "Backups", href: "/super-admin/backups", icon: Database },
      { name: "API & Integrations", href: "/super-admin/api", icon: Plug },
    ],
  },
];

const PAGE_CONTEXT: { prefix: string; title: string }[] = [
  { prefix: "/super-admin", title: "Platform overview" },
  { prefix: "/super-admin/dashboard", title: "Platform overview" },
  { prefix: "/super-admin/admins", title: "ISP admins" },
  { prefix: "/super-admin/roles", title: "Roles and permissions" },
  { prefix: "/super-admin/impersonate", title: "Impersonate admin" },
  { prefix: "/super-admin/routers", title: "Routers" },
  { prefix: "/super-admin/limits", title: "System limits" },
  { prefix: "/super-admin/settings", title: "System settings" },
  { prefix: "/super-admin/payment-packages", title: "Payments and packages" },
  { prefix: "/super-admin/payments", title: "Payment gateways" },
  { prefix: "/super-admin/billing", title: "Billing engine" },
  { prefix: "/super-admin/reports", title: "Reports" },
  { prefix: "/super-admin/security-logs", title: "Security logs" },
  { prefix: "/super-admin/notifications", title: "Notifications" },
  { prefix: "/super-admin/automation", title: "Automation" },
  { prefix: "/super-admin/backups", title: "Backups" },
  { prefix: "/super-admin/api", title: "API and integrations" },
];

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const VERIFY_INTERVAL = 5 * 60 * 1000;

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isDark, toggle } = useTheme();
  const [remainingMs, setRemainingMs] = useState<number>(SESSION_TTL_MS);
  const superAdminName = localStorage.getItem("ochola_superadmin_name") || "Super Admin";

  const forceLogout = useCallback((reason: string) => {
    try {
      localStorage.removeItem("ochola_superadmin_token");
      localStorage.removeItem("ochola_superadmin_name");
      localStorage.removeItem("ochola_superadmin_issued_at");
    } catch {}
    setLocation(`/super-admin/login?reason=${reason}`);
  }, [setLocation]);

  const verifySession = useCallback(async (): Promise<boolean> => {
    const token = localStorage.getItem("ochola_superadmin_token");
    if (!token) {
      forceLogout("no_session");
      return false;
    }

    const issuedAt = parseInt(localStorage.getItem("ochola_superadmin_issued_at") ?? "0", 10);
    const elapsed = Date.now() - (issuedAt || 0);
    if (issuedAt && elapsed >= SESSION_TTL_MS) {
      forceLogout("expired");
      return false;
    }
    setRemainingMs(Math.max(0, SESSION_TTL_MS - elapsed));

    try {
      const response = await fetch("/api/super-admin/verify", {
        headers: { "x-sa-token": token },
      });
      const data = await response.json() as { ok: boolean; reason?: string; remainingMs?: number };
      if (!data.ok) {
        forceLogout(data.reason ?? "no_session");
        return false;
      }
      if (data.remainingMs !== undefined) setRemainingMs(data.remainingMs);
    } catch {
      /* Keep the session during a transient network failure. */
    }
    return true;
  }, [forceLogout]);

  useEffect(() => {
    verifySession();
    const tick = setInterval(verifySession, VERIFY_INTERVAL);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "ochola_superadmin_token" && !event.newValue) {
        setLocation("/super-admin/login");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      clearInterval(tick);
      window.removeEventListener("storage", handleStorage);
    };
  }, [setLocation, verifySession]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    const ticker = setInterval(() => {
      const issuedAt = parseInt(localStorage.getItem("ochola_superadmin_issued_at") ?? "0", 10);
      if (!issuedAt) return;
      const ms = Math.max(0, SESSION_TTL_MS - (Date.now() - issuedAt));
      setRemainingMs(ms);
      if (ms === 0) forceLogout("expired");
    }, 60_000);
    return () => clearInterval(ticker);
  }, [forceLogout]);

  const handleLogout = async () => {
    const token = localStorage.getItem("ochola_superadmin_token");
    if (token) {
      try {
        await fetch("/api/super-admin/logout", { method: "POST", headers: { "x-sa-token": token } });
      } catch {
        /* Local cleanup still protects the console when logout cannot reach the server. */
      }
    }
    try {
      localStorage.removeItem("ochola_superadmin_token");
      localStorage.removeItem("ochola_superadmin_name");
      localStorage.removeItem("ochola_superadmin_issued_at");
    } catch {}
    setLocation("/super-admin/login");
  };

  const currentPage = PAGE_CONTEXT.find((page) =>
    location === page.prefix || (page.prefix !== "/super-admin" && location.startsWith(`${page.prefix}/`)),
  );
  const expiryColor =
    remainingMs > 60 * 60 * 1000 ? "var(--isp-green)" :
    remainingMs > 15 * 60 * 1000 ? "#c6852f" : "#dc5b55";

  return (
    <div className="sa-shell">
      <div className={`sa-scrim${mobileOpen ? " is-visible" : ""}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sa-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
        <div className="sa-brand-row">
          {collapsed ? <Logo size="xs" iconOnly /> : <Logo size="sm" />}
          <button
            className="sa-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <Menu size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="sa-nav" aria-label="Super admin navigation">
          {NAV.map((section) => (
            <div className="sa-nav-section" key={section.label}>
              {!collapsed && <p className="sa-nav-label">{section.label}</p>}
              {section.items.map((item) => {
                const active = location === item.href || location.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sa-nav-link${active ? " is-active" : ""}`}
                    title={collapsed ? item.name : undefined}
                  >
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                    <span>{item.name}</span>
                    {!collapsed && active && <ChevronRight className="sa-nav-arrow" size={13} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sa-profile">
          <div className="sa-profile-row">
            <div className="sa-profile-mark">SA</div>
            <div className="sa-profile-copy">
              <p className="sa-profile-name">{superAdminName}</p>
              <p className="sa-profile-role">Platform owner</p>
            </div>
          </div>
          <button className="sa-signout" onClick={handleLogout} title="Sign out">
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="sa-main">
        <header className="sa-topbar">
          <div className="sa-context">
            <button className="sa-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu size={17} />
            </button>
            <Globe size={15} color="var(--isp-accent)" aria-hidden="true" />
            <div>
              <p className="sa-context-kicker">OcholaSupernet / ISPlatty</p>
              <p className="sa-context-title">{currentPage?.title || "Super admin console"}</p>
            </div>
          </div>
          <div className="sa-top-actions">
            <div className="sa-session" title="Session time remaining">
              <Clock size={13} color={expiryColor} />
              <span style={{ color: expiryColor }}>{formatRemaining(remainingMs)} remaining</span>
            </div>
            <button
              className="sa-theme-toggle"
              onClick={toggle}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>
        <div className="sa-content">
          <div className="sa-breadcrumb">
            <span>Platform</span>
            <ChevronRight size={11} />
            <strong>{currentPage?.title || "Console"}</strong>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}