import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  LayoutDashboard, Users, Package, CreditCard,
  Network, Settings, Bell, Wifi, Shield, FolderOpen,
  Sliders, BookOpen, LogOut, Webhook, ChevronRight,
  CheckSquare, Search, Sun, Moon, Menu, KeyRound, X, ShieldAlert,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useBrand } from "@/context/BrandContext";
import {
  ADMIN_ID,
  clearAdminAuth,
  getAdminApiToken,
  getAdminName,
  getAdminRole,
  getImpersonatedName,
  getImpersonationSessionId,
  isImpersonating,
  stopImpersonation,
} from "@/lib/supabase";
import { useAdminPageVisibility } from "@/context/AdminPageVisibilityContext";
import {
  getAdminFeatureKeyForPath,
  getAdminPageAuthFeatureKeyForPath,
} from "@/lib/admin-page-visibility";
import { Logo } from "@/components/Logo";
import { AdminInstallButton } from "@/components/pwa/AdminInstallButton";

type PasswordReauthPolicyCache = {
  role: string;
  fetchedAt: number;
  methods: Record<string, PageAuthMethod>;
};

const PASSWORD_REAUTH_POLICY_CACHE_TTL_MS = 60_000;
const passwordReauthPolicyRequests = new Map<string, Promise<PasswordReauthPolicyCache>>();

function passwordReauthPolicyCacheKey(): string {
  return `ochola_page_reauth_policy_${ADMIN_ID}_${getAdminRole()}`;
}

function readPasswordReauthPolicyCache(): PasswordReauthPolicyCache | null {
  try {
    const key = passwordReauthPolicyCacheKey();
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as PasswordReauthPolicyCache;
    const age = Date.now() - cached.fetchedAt;
    if (
      cached.role !== getAdminRole() ||
      !Number.isFinite(cached.fetchedAt) ||
      age < 0 ||
      age > PASSWORD_REAUTH_POLICY_CACHE_TTL_MS ||
      !cached.methods ||
      typeof cached.methods !== "object" ||
      Array.isArray(cached.methods)
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

async function loadPasswordReauthPolicyCache(): Promise<PasswordReauthPolicyCache> {
  const key = passwordReauthPolicyCacheKey();
  const pending = passwordReauthPolicyRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch("/api/auth/admin/password-recheck-policy", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${getAdminApiToken()}` },
    });
    const data = await response.json() as {
      ok?: boolean;
      error?: string;
      role?: string;
      methods?: Record<string, unknown>;
    };
    if (!response.ok || !data.ok || data.role !== getAdminRole() || !data.methods || typeof data.methods !== "object" || Array.isArray(data.methods)) {
      throw new Error(data.error || "Password security policy could not be checked.");
    }

    const methods: Record<string, PageAuthMethod> = {};
    const allowedMethods: PageAuthMethod[] = ["none", "password", "whatsapp", "sms", "email"];
    for (const [feature, method] of Object.entries(data.methods)) {
      if (typeof method !== "string" || !allowedMethods.includes(method as PageAuthMethod)) {
        throw new Error("Page verification policy response was invalid.");
      }
      methods[feature] = method as PageAuthMethod;
    }
    const cache = { role: data.role, fetchedAt: Date.now(), methods };
    try { sessionStorage.setItem(key, JSON.stringify(cache)); } catch {}
    return cache;
  })();
  passwordReauthPolicyRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (passwordReauthPolicyRequests.get(key) === request) passwordReauthPolicyRequests.delete(key);
  }
}

interface NavChild {
  name: string;
  href: string;
}

interface NavItem {
  name: string;
  href?: string;
  icon: React.ElementType;
  visibilityKey?: string;
  badge?: string;
  children?: NavChild[];
}

interface NavSection {
  label: string;
  visibilityKey: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Overview",
    visibilityKey: "overview",
    items: [
      { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Customers",
    visibilityKey: "customers",
    items: [
      {
        name: "Customers", icon: Users, visibilityKey: "customers.customers",
        children: [
          { name: "All Customers", href: "/admin/customers" },
          { name: "Active",        href: "/admin/customers?status=active" },
          { name: "Expired",       href: "/admin/customers?status=expired" },
          { name: "Online Users",  href: "/admin/customers?status=online" },
        ],
      },
      {
        name: "Prepaid Users", icon: CheckSquare, visibilityKey: "customers.activation",
        href: "/admin/activation/prepaid-users",
      },
      {
        name: "Hotspot Binding", icon: Wifi, visibilityKey: "customers.hotspot-binding",
        children: [
          { name: "Bindings",      href: "/admin/hotspot-binding" },
          { name: "Sessions",      href: "/admin/hotspot-binding?tab=sessions" },
        ],
      },
    ],
  },
  {
    label: "Billing",
    visibilityKey: "billing",
    items: [
      {
        name: "Packages / Plans", icon: Package, visibilityKey: "billing.plans",
        children: [
          { name: "Hotspot Plans", href: "/admin/plans?type=hotspot" },
          { name: "PPPoE Plans",   href: "/admin/plans?type=pppoe" },
          { name: "Static IP",     href: "/admin/plans?type=static" },
          { name: "Bandwidth",     href: "/admin/plans?type=bandwidth" },
          { name: "Trials",        href: "/admin/plans?type=trials" },
          { name: "FUP",           href: "/admin/plans?type=fup" },
          { name: "Roaming",       href: "/admin/plans/roaming" },
          { name: "Loyalty points", href: "/admin/plans/loyalty" },
          { name: "Vouchers", href: "/admin/vouchers" },
        ],
      },
      {
        name: "Transactions", icon: CreditCard, visibilityKey: "billing.transactions",
        children: [
          { name: "All",             href: "/admin/transactions" },
          { name: "M-Pesa",          href: "/admin/transactions?method=mpesa" },
          { name: "Paid Hotspot Recovery", href: "/admin/transactions/hotspot-recovery" },
          { name: "Graphs",          href: "/admin/transactions/graphs" },
        ],
      },
    ],
  },
  {
    label: "Network",
    visibilityKey: "network",
    items: [
      {
        name: "Network", icon: Network,
        children: [
          { name: "Routers",        href: "/admin/network/routers" },
          { name: "Self Install",   href: "/admin/network/self-install" },
          { name: "Files",          href: "/admin/network/files" },
          { name: "Resellers",      href: "/admin/network/resellers" },
          { name: "Migration & Recovery", href: "/admin/network/migration" },
          { name: "Multiport",      href: "/admin/network/multiport" },
          { name: "Replace Router", href: "/admin/network/replace-router" },
          { name: "PPP",            href: "/admin/network/ppp" },
          { name: "Wireless",       href: "/admin/network/wireless" },
          { name: "Queues",         href: "/admin/network/queues" },
          { name: "IP Pools",       href: "/admin/network/ip-pools" },
          { name: "API Config",     href: "/admin/network/router-api-config" },
           { name: "Multi-WAN Load Balancing", href: "/admin/network/load-balancing" },
        ],
      },
      {
        name: "PPPoE Settings", icon: Sliders, visibilityKey: "network.pppoe-settings",
        children: [
          { name: "General",   href: "/admin/pppoe-settings" },
          { name: "Profiles",  href: "/admin/pppoe-settings?tab=profiles" },
        ],
      },
      {
        name: "Hotspot Settings", icon: Wifi, visibilityKey: "network.hotspot-settings",
        children: [
          { name: "General",    href: "/admin/hotspot-settings" },
          { name: "Login Page", href: "/admin/hotspot-settings?tab=login" },
        ],
      },
    ],
  },
  {
    label: "Reseller",
    visibilityKey: "network",
    items: [
      {
        name: "Network", icon: Network,
        children: [
          { name: "Connector", href: "/admin/reseller/connector" },
        ],
      },
    ],
  },
  {
    label: "Tools",
    visibilityKey: "tools",
    items: [
      {
        name: "VPN & Remote Access", icon: Shield, badge: "New", visibilityKey: "tools.vpn",
        children: [
          { name: "VPN Dashboard", href: "/admin/vpn" },
          { name: "Remote Access", href: "/admin/vpn/remote-access" },
          { name: "VPN Users",     href: "/admin/vpn/list" },
          { name: "Create VPN",    href: "/admin/vpn/create" },
          { name: "VPN Settings",  href: "/admin/vpn/settings" },
        ],
      },
      { name: "Webhooks",    href: "/admin/webhooks",      icon: Webhook, visibilityKey: "tools.webhooks" },
    ],
  },
  {
    label: "Admin",
    visibilityKey: "admin",
    items: [
       {
         name: "Message Templates", icon: Bell, href: "/admin/message-templates", visibilityKey: "admin.notifications",
       },
       {
         name: "Platform Notifications", icon: Bell, href: "/admin/notifications", visibilityKey: "admin.notifications",
       },
      {
        name: "Logs", icon: BookOpen, visibilityKey: "admin.logs",
        children: [
          { name: "Auth Logs",   href: "/admin/logs" },
          { name: "System Logs", href: "/admin/logs?type=system" },
        ],
      },
      {
        name: "Settings", icon: Settings, visibilityKey: "admin.settings",
        children: [
          { name: "ISP Profile",          href: "/admin/settings?tab=profile" },
          { name: "Billing & M-Pesa",     href: "/admin/settings?tab=billing" },
          { name: "Payment Gateways",     href: "/admin/settings?tab=gateways" },
          { name: "Dashboard Page Builder", href: "/admin/settings?tab=dashboard" },
          { name: "Desired Font",         href: "/admin/settings?tab=typography" },
          { name: "SMS & Email",           href: "/admin/settings?tab=sms" },
          { name: "Network",               href: "/admin/settings?tab=network" },
          { name: "Hotspot",               href: "/admin/settings?tab=hotspot" },
          { name: "Security",              href: "/admin/settings?tab=security" },
          { name: "Notifications",         href: "/admin/settings?tab=notifications" },
          { name: "System",                href: "/admin/settings?tab=system" },
          { name: "Plugins",               href: "/admin/settings?tab=plugins" },
        ],
      },
    ],
  },
];

const SIDEBAR_W = 240;
const SIDEBAR_COLLAPSED_W = 64;

type PlatformBillingState = {
  eligible: boolean;
  paymentsAvailable: boolean;
  invoice?: {
    id?: number;
    amount_due: number;
    due_date: string;
    status: string;
    payment_phone?: string | null;
    sales_total?: number | string;
    sales_threshold?: number | string;
  } | null;
};

function PlatformBillingBanner() {
  const [state, setState] = useState<PlatformBillingState | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const role = getAdminRole();
  const token = getAdminApiToken();

  const load = async () => {
    if (!token || role === "superadmin") return;
    try {
      const response = await fetch("/api/billing/current", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const data = await response.json() as PlatformBillingState;
      setState(data);
      if (data.invoice?.payment_phone) {
        setPhone(currentPhone => currentPhone || data.invoice!.payment_phone!);
      }
    } catch {
      // The dashboard remains usable when the optional billing banner is unavailable.
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const refreshTimer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(refreshTimer);
    };
  }, [token, role]);

  if (role === "superadmin" || !state?.eligible || !state.invoice || state.invoice.status === "paid") return null;

  const dueAt = Date.parse(`${state.invoice.due_date}T00:00:00+03:00`);
  const remaining = Number.isFinite(dueAt) ? Math.max(0, dueAt - now) : 0;
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const countdown = remaining ? `${days}d ${hours}h ${minutes}m` : "Past due";
  const dueDateLabel = new Date(`${state.invoice.due_date}T12:00:00.000Z`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
  const isPastDue = remaining === 0;
  const previousSalesTotal = state.invoice.sales_total == null ? null : Number(state.invoice.sales_total);
  const salesThreshold = state.invoice.sales_threshold == null ? null : Number(state.invoice.sales_threshold);
  const hasPreviousSalesTotal = previousSalesTotal !== null && Number.isFinite(previousSalesTotal);
  const hasSalesThreshold = salesThreshold !== null && Number.isFinite(salesThreshold);

  const renew = async () => {
    setBusy(true);
    setMessage("");
    try {
      const prepare = await fetch("/api/billing/renew", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const prepared = await prepare.json() as { ok?: boolean; paid?: boolean; error?: string; invoiceId?: number; amount?: number; adminId?: number; accountReference?: string };
      if (prepare.ok && prepared.ok && prepared.paid) {
        setMessage("Payment already confirmed. Your account is renewed.");
        await load();
        return;
      }
      if (!prepare.ok || !prepared.ok || !prepared.invoiceId || !prepared.amount) throw new Error(prepared.error || "Could not prepare the payment.");
      const stk = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          amount: prepared.amount,
          adminId: prepared.adminId ?? ADMIN_ID,
          billing_invoice_id: prepared.invoiceId,
          account_ref: prepared.accountReference,
        }),
      });
      const started = await stk.json() as { ok?: boolean; error?: string; CheckoutRequestID?: string };
      if (!stk.ok || !started.ok || !started.CheckoutRequestID) throw new Error(started.error || "Could not send the M-Pesa prompt.");
      setMessage("Prompt sent. Enter your M-Pesa PIN, then wait for confirmation.");
      const checkoutId = started.CheckoutRequestID;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 3000));
        const status = await fetch(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`, { headers: { Authorization: `Bearer ${token}` } });
        const result = await status.json() as { paid?: boolean; status?: string };
        if (result.paid || result.status === "completed") {
          setMessage("Payment confirmed. Your account is renewed.");
          await load();
          return;
        }
        if (result.status === "failed") throw new Error("M-Pesa reported that the payment failed.");
      }
      setMessage("The prompt is still processing. This banner will update when confirmation arrives.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`platform-billing-banner${isPastDue ? " platform-billing-banner--overdue" : ""}`}
      role="status"
      aria-label="Monthly platform renewal reminder"
    >
      <span className="platform-billing-banner__icon" aria-hidden="true"><CreditCard size={19} /></span>
      <div className="platform-billing-banner__copy">
        <div className="platform-billing-banner__heading">
          <div>
            <span className="platform-billing-banner__eyebrow">Monthly platform billing</span>
            <strong>{isPastDue ? "Renewal payment is overdue" : "Your monthly renewal is ready"}</strong>
          </div>
          <span className={`platform-billing-banner__badge${isPastDue ? " platform-billing-banner__badge--overdue" : ""}`}>
            {isPastDue ? "Past due" : `Due in ${countdown}`}
          </span>
        </div>
        <p className="platform-billing-banner__summary">
          {isPastDue ? "Renewal was due at midnight at the start of " : "Pay before midnight at the start of "}
          <strong>{dueDateLabel}</strong> (Nairobi time): KSh {Number(state.invoice.amount_due).toLocaleString("en-KE")}.
        </p>
        {hasPreviousSalesTotal && (
          <p className="platform-billing-banner__summary">
            Previous month’s eligible sales: <strong>KSh {previousSalesTotal.toLocaleString("en-KE")}</strong>
            {hasSalesThreshold && (
              <>
                {" "}({previousSalesTotal > salesThreshold ? "above" : "at or below"} the KSh {salesThreshold.toLocaleString("en-KE")} threshold; renewal fee KSh {Number(state.invoice.amount_due).toLocaleString("en-KE")}).
              </>
            )}
            {!hasSalesThreshold && "."}
          </p>
        )}
        <span className="platform-billing-banner__note">Monthly reminder · available from the 1st of each month</span>
        {!state.paymentsAvailable && <small className="platform-billing-banner__message">Renewal payments are unavailable in this preview.</small>}
        {message && <small className={`platform-billing-banner__message${message.includes("confirmed") ? " platform-billing-banner__message--success" : ""}`}>{message}</small>}
      </div>
      <div className="platform-billing-banner__actions">
        <input
          value={phone}
          onChange={event => setPhone(event.target.value)}
          disabled={!state.paymentsAvailable}
          placeholder="07xx xxx xxx"
          type="tel"
          autoComplete="tel"
          aria-label="M-Pesa phone number"
        />
        <button type="button" onClick={() => void renew()} disabled={!state.paymentsAvailable || busy || !phone.trim()}>
          {busy ? "Waiting…" : "Pay renewal"}
        </button>
      </div>
    </section>
  );
}

type PageAuthMethod = "none" | "password" | "whatsapp" | "sms" | "email";
type PagePasswordStatus = "unknown" | "checking" | "missing" | "configured";
const ROUTER_PAGE_AUTH_FEATURE = "network.routers";

function pageReauthSessionKey(adminId: string | number, role: string, feature: string, method: PageAuthMethod): string {
  const pagePasswordVersion = method === "password"
    ? "_page-password-v1"
    : "";
  return `ochola_reauth_${adminId}_${role}_${feature}_${method}${pagePasswordVersion}`;
}

function pagePasswordLabel(feature: string | null): string {
  if (feature === ROUTER_PAGE_AUTH_FEATURE) return "Routers";
  const label = feature?.split(".").at(-1)?.replace(/[-_]/g, " ").trim();
  if (!label) return "this page";
  return label.replace(/\b\w/g, character => character.toUpperCase());
}

export function AdminLayout({
  children,
  hiddenNavHrefs = [],
}: {
  children: React.ReactNode;
  hiddenNavHrefs?: string[];
}) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const currentRoute = search ? `${location}?${search}` : location;
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 768);
  const [expanded, setExpanded]       = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [reauthStatus, setReauthStatus] = useState<"checking" | "not-required" | "required" | "verified" | "failed">("checking");
  const [reauthCheckedFeature, setReauthCheckedFeature] = useState<string | null>(null);
  const [reauthUntil, setReauthUntil] = useState(0);
  const [reauthMethod, setReauthMethod] = useState<PageAuthMethod>("none");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthChallengeId, setReauthChallengeId] = useState("");
  const [reauthCode, setReauthCode] = useState("");
  const [reauthDestination, setReauthDestination] = useState("");
  const [reauthResendSeconds, setReauthResendSeconds] = useState(0);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthError, setReauthError] = useState("");
  const [pagePasswordStatus, setPagePasswordStatus] = useState<PagePasswordStatus>("unknown");
  const [newPagePassword, setNewPagePassword] = useState("");
  const [confirmPagePassword, setConfirmPagePassword] = useState("");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [endingAccess, setEndingAccess] = useState(false);
  const [reauthRetryKey, setReauthRetryKey] = useState(0);

  useEffect(() => {
    if (reauthResendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setReauthResendSeconds(seconds => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [reauthResendSeconds]);
  const { toggle, isDark }            = useTheme();
  const brand                         = useBrand();
  const adminName                     = getAdminName();
  const isResellerAccount             = getAdminRole() === "reseller";
  const queryClient                   = useQueryClient();
  const { isVisible }                 = useAdminPageVisibility();
  const currentFeatureKey             = getAdminFeatureKeyForPath(currentRoute);
  const currentPageAuthFeatureKey     = getAdminPageAuthFeatureKeyForPath(currentRoute) ?? currentFeatureKey;
  const isOverviewFeature             = !currentPageAuthFeatureKey || currentPageAuthFeatureKey === "overview" || currentPageAuthFeatureKey === "overview.dashboard";
  const requiresReauthGate            = !isOverviewFeature && !isImpersonating();
  const usesPagePassword              = reauthMethod === "password";
  const pagePasswordSetupNeeded        = usesPagePassword && pagePasswordStatus === "missing";
  const pagePasswordStatusPending      = usesPagePassword &&
    reauthStatus === "required" &&
    (pagePasswordStatus === "unknown" || pagePasswordStatus === "checking");
  const currentPagePasswordLabel       = pagePasswordLabel(currentPageAuthFeatureKey);
  const headerUserName                 = getAdminRole() === "superadmin" ||
    (
      currentPageAuthFeatureKey === ROUTER_PAGE_AUTH_FEATURE &&
      requiresReauthGate &&
      reauthStatus !== "verified" &&
      reauthStatus !== "not-required"
    )
      ? "Admin"
      : adminName || brand.adminName || "Admin";
  const reauthCheckPending            = requiresReauthGate && (
    reauthCheckedFeature !== currentPageAuthFeatureKey ||
    reauthStatus === "checking" ||
    pagePasswordStatusPending
  );
  const pageIsVisible                 = !currentFeatureKey || isVisible(currentFeatureKey);
  const isVpnSurface                  = location.startsWith("/admin/vpn");

  const resellerSections = new Set(["Overview", "Customers", "Billing", "Network", "Admin", "Reseller"]);
  const resellerItems: Record<string, Set<string>> = {
    Customers: new Set(["Customers", "Prepaid Users", "Hotspot Binding"]),
    Billing: new Set(["Packages / Plans", "Transactions"]),
    Network: new Set(["Hotspot Settings"]),
    Admin: new Set(["Settings"]),
    Reseller: new Set(["Network"]),
  };

  const visibleNavSections = navSections
     .filter(section => isVisible(section.visibilityKey) && (!isResellerAccount || resellerSections.has(section.label)))
    .map(section => ({
      ...section,
      items: section.items
         .filter(item => (!isResellerAccount || resellerItems[section.label]?.has(item.name) || section.label === "Overview")
           && (!item.visibilityKey || isVisible(item.visibilityKey)))
        .map(item => ({
          ...item,
          children: (isResellerAccount && item.name === "Hotspot Settings"
            ? [{ name: "Assigned VLAN page", href: "/admin/hotspot-settings" }]
             : item.children
          )?.filter(child => {
               if (isResellerAccount && child.href === "/admin/network/self-install") return false;
              if (hiddenNavHrefs.includes(child.href)) return false;
              const childFeatureKey = getAdminFeatureKeyForPath(child.href);
              return !childFeatureKey || isVisible(childFeatureKey);
            }),
        }))
        .filter(item => !item.children || item.children.length > 0),
    }))
    .filter(section => section.items.length > 0);

  const handleLogout = () => {
    if (isImpersonating()) {
      void handleEndAccess();
      return;
    }
    clearAdminAuth();
    queryClient.clear();
    setLocation("/admin/login");
  };

  const handlePasswordRecheck = async (event: React.FormEvent) => {
    event.preventDefault();
    setReauthBusy(true);
    setReauthError("");
    try {
      const response = await fetch("/api/auth/admin/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminApiToken()}` },
        body: JSON.stringify({ feature: currentPageAuthFeatureKey, password: reauthPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.token || !Number.isFinite(data.expiresAt)) {
        throw new Error(data.error || "The password check could not be completed.");
      }
      localStorage.setItem("ochola_api_token", data.token);
      sessionStorage.setItem(
        pageReauthSessionKey(ADMIN_ID, getAdminRole(), currentPageAuthFeatureKey ?? "", "password"),
        String(data.expiresAt),
      );
      window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id: ADMIN_ID } }));
      setReauthUntil(data.expiresAt);
      setReauthPassword("");
      setReauthStatus("verified");
    } catch (cause) {
      setReauthError(cause instanceof Error ? cause.message : "The password check could not be completed.");
    } finally {
      setReauthBusy(false);
    }
  };

  const handlePagePasswordSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setReauthError("");
    if (!currentPageAuthFeatureKey) {
      setReauthError("The current page could not be identified for password setup.");
      return;
    }
    if (newPagePassword.length < 10 || newPagePassword.length > 200) {
      setReauthError("Choose a page password with at least 10 characters.");
      return;
    }
    if (newPagePassword !== confirmPagePassword) {
      setReauthError("The page passwords do not match.");
      return;
    }

    setReauthBusy(true);
    try {
      const response = await fetch("/api/auth/admin/page-password/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminApiToken()}` },
        body: JSON.stringify({
          feature: currentPageAuthFeatureKey,
          password: newPagePassword,
          confirmPassword: confirmPagePassword,
        }),
      });
      const data = await response.json() as { ok?: boolean; token?: string; expiresAt?: number; error?: string };
      const expiresAt = Number(data.expiresAt);
      if (!response.ok || !data.ok || !data.token || !Number.isFinite(expiresAt)) {
        throw new Error(data.error || "The page password could not be created.");
      }
      localStorage.setItem("ochola_api_token", data.token);
      sessionStorage.setItem(
        pageReauthSessionKey(ADMIN_ID, getAdminRole(), currentPageAuthFeatureKey, "password"),
        String(data.expiresAt),
      );
      window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id: ADMIN_ID } }));
      setPagePasswordStatus("configured");
      setNewPagePassword("");
      setConfirmPagePassword("");
      setReauthUntil(expiresAt);
      setReauthStatus("verified");
    } catch (cause) {
      setReauthError(cause instanceof Error ? cause.message : "The page password could not be created.");
    } finally {
      setReauthBusy(false);
    }
  };

  const handlePageOtpRequest = async () => {
    setReauthBusy(true);
    setReauthError("");
    setReauthChallengeId("");
    setReauthCode("");
    setReauthDestination("");
    setReauthResendSeconds(0);
    try {
      const response = await fetch("/api/auth/admin/page-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminApiToken()}` },
        body: JSON.stringify({ feature: currentPageAuthFeatureKey, method: reauthMethod }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.challengeId !== "string") {
        throw new Error(data.error || "The verification code could not be sent.");
      }
      setReauthChallengeId(data.challengeId);
      setReauthDestination(typeof data.destination === "string" ? data.destination : "");
      const resendAfter = Number(data.resendAfterSeconds);
      setReauthResendSeconds(Number.isFinite(resendAfter) && resendAfter > 0 ? Math.ceil(resendAfter) + 1 : 60);
    } catch (cause) {
      setReauthError(cause instanceof Error ? cause.message : "The verification code could not be sent.");
    } finally {
      setReauthBusy(false);
    }
  };

  const handlePageOtpVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setReauthBusy(true);
    setReauthError("");
    try {
      const response = await fetch("/api/auth/admin/page-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminApiToken()}` },
        body: JSON.stringify({
          feature: currentPageAuthFeatureKey,
          method: reauthMethod,
          challengeId: reauthChallengeId,
          code: reauthCode,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.token || !Number.isFinite(data.expiresAt)) {
        throw new Error(data.error || "The verification code could not be confirmed.");
      }
      localStorage.setItem("ochola_api_token", data.token);
      sessionStorage.setItem(
        pageReauthSessionKey(ADMIN_ID, getAdminRole(), currentPageAuthFeatureKey ?? "", reauthMethod),
        String(data.expiresAt),
      );
      window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id: ADMIN_ID } }));
      setReauthUntil(data.expiresAt);
      setReauthCode("");
      setReauthStatus("verified");
    } catch (cause) {
      setReauthError(cause instanceof Error ? cause.message : "The verification code could not be confirmed.");
    } finally {
      setReauthBusy(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    if (!currentPassword.trim()) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("The new password and confirmation do not match.");
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 200) {
      setPasswordError("Choose a password with at least 6 characters.");
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch("/api/auth/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminApiToken()}` },
        body: JSON.stringify({ currentPassword, password: newPassword, confirmPassword: confirmNewPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Your password could not be changed.");
      if (data.token) localStorage.setItem("ochola_api_token", data.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordNotice(data.message || "Your password has been changed.");
      setReauthUntil(0);
      setReauthStatus("not-required");
      try {
        Object.keys(sessionStorage).filter(key => key.startsWith("ochola_reauth_")).forEach(key => sessionStorage.removeItem(key));
      } catch {}
      window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id: ADMIN_ID } }));
      setChangePasswordOpen(false);
      setLocation("/admin/dashboard");
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "Your password could not be changed.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleEndAccess = async () => {
    const sessionId = getImpersonationSessionId();
    if (!sessionId) {
      setNotice("The access session ID is missing. Sign out to end this local session.");
      return;
    }
    setEndingAccess(true);
    try {
      const response = await fetch(`/api/super-admin/admin-access/${encodeURIComponent(sessionId)}/end`, {
        method: "POST",
        headers: { "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "" },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The access session could not be ended.");
      stopImpersonation();
      queryClient.clear();
      setLocation("/super-admin/impersonate");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The access session could not be ended.");
    } finally {
      setEndingAccess(false);
    }
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

  useEffect(() => {
    const disabled = new URLSearchParams(search).get("disabled");
    setNotice(disabled ? "That page is currently unavailable." : "");
  }, [search]);

  useEffect(() => {
    if (!pageIsVisible) {
      setLocation(`/admin/dashboard?disabled=${encodeURIComponent(currentFeatureKey ?? "page")}`);
    }
  }, [currentFeatureKey, pageIsVisible, setLocation]);

  useEffect(() => {
    let cancelled = false;
    const feature = currentPageAuthFeatureKey;
    setReauthError("");
    setPagePasswordStatus("unknown");
    setNewPagePassword("");
    setConfirmPagePassword("");
    if (!feature || feature === "overview" || feature === "overview.dashboard" || isImpersonating()) {
      setReauthUntil(0);
      setReauthMethod("none");
      setReauthStatus("not-required");
      setReauthCheckedFeature(feature ?? null);
      return;
    }
    setReauthCheckedFeature(null);
    setReauthStatus("checking");

    const applyMethodDecision = (method: PageAuthMethod) => {
      setReauthMethod(method);
      setReauthChallengeId("");
      setReauthCode("");
      setReauthDestination("");
      setReauthResendSeconds(0);
      if (method === "none") {
        setReauthUntil(0);
        setReauthStatus("not-required");
        setReauthCheckedFeature(feature);
      } else {
        const cacheKey = pageReauthSessionKey(ADMIN_ID, getAdminRole(), feature, method);
        let storedExpiry = 0;
        try { storedExpiry = Number(sessionStorage.getItem(cacheKey) || 0); } catch {}
        if (Number.isFinite(storedExpiry) && storedExpiry > Date.now()) {
          setReauthUntil(storedExpiry);
          setReauthStatus("verified");
        } else {
          setReauthUntil(0);
          setReauthStatus("required");
        }
        setReauthCheckedFeature(feature);
      }
    };

    const cachedPolicy = readPasswordReauthPolicyCache();
    if (cachedPolicy && Object.prototype.hasOwnProperty.call(cachedPolicy.methods, feature)) {
      applyMethodDecision(cachedPolicy.methods[feature]);
      return;
    }
    const check = async () => {
      try {
        const policyCache = await loadPasswordReauthPolicyCache();
        if (cancelled) return;
        const method = policyCache.methods[feature];
        if (!method) throw new Error("Page verification policy response was incomplete.");
        applyMethodDecision(method);
      } catch (cause) {
        if (cancelled) return;
        setReauthError(cause instanceof Error ? cause.message : "Password security policy could not be checked.");
        setReauthStatus("failed");
        setReauthCheckedFeature(feature);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [currentPageAuthFeatureKey, reauthRetryKey]);
  useEffect(() => {
    let cancelled = false;
    if (!usesPagePassword || !currentPageAuthFeatureKey) {
      setPagePasswordStatus("unknown");
      setNewPagePassword("");
      setConfirmPagePassword("");
      return;
    }
    if (reauthStatus !== "required") return;

    setPagePasswordStatus("checking");
    setReauthError("");
    void (async () => {
      try {
        const response = await fetch(`/api/auth/admin/page-password/status?feature=${encodeURIComponent(currentPageAuthFeatureKey)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${getAdminApiToken()}` },
        });
        const data = await response.json() as { ok?: boolean; configured?: boolean; error?: string };
        if (!response.ok || !data.ok || typeof data.configured !== "boolean") {
          throw new Error(data.error || "The page password status could not be checked.");
        }
        if (cancelled) return;
        setPagePasswordStatus(data.configured ? "configured" : "missing");
      } catch (cause) {
        if (cancelled) return;
        setReauthError(cause instanceof Error ? cause.message : "The page password status could not be checked.");
        setReauthStatus("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [currentPageAuthFeatureKey, usesPagePassword, reauthMethod, reauthStatus, reauthRetryKey]);

  useEffect(() => {
    if (reauthStatus !== "verified" || !reauthUntil) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= reauthUntil) {
        sessionStorage.removeItem(pageReauthSessionKey(ADMIN_ID, getAdminRole(), currentPageAuthFeatureKey ?? "", reauthMethod));
        setReauthStatus("required");
        setReauthUntil(0);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentPageAuthFeatureKey, reauthMethod, reauthStatus, reauthUntil]);

  const toggleExpand = (name: string) =>
    setExpanded(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]);

  const isActive = (item: NavItem) => {
    if (item.href) {
      const base = item.href.split("?")[0];
      return location === item.href || location === base;
    }
    return !!item.children?.some(c => location.startsWith(c.href.split("?")[0]));
  };

  const isChildActive = (href: string) => {
    const [path, query = ""] = href.split("?", 2);
    return location === path && search === query;
  };

  if (!pageIsVisible) {
    return (
      <div className="admin-shell" style={{ minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ maxWidth: 480, textAlign: "center", color: "var(--isp-text)" }}>
          <h1 style={{ fontSize: "1.35rem", marginBottom: 8 }}>Page unavailable</h1>
          <p style={{ color: "var(--isp-text-muted)" }}>This page is currently unavailable. Redirecting to your Dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <style>{adminLayoutStyles}</style>

      {/* ── SIDEBAR ──────────────────────────────────────────────── */}
      <aside className={`admin-sidebar ${sidebarOpen ? "admin-sidebar--open" : "admin-sidebar--closed"}`} style={{ width: sidebarOpen ? SIDEBAR_W : SIDEBAR_COLLAPSED_W }}>

        {/* Logo strip */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-inner">
             <Logo size="sm" />
             <div className="sidebar-brand-sub">Admin Panel</div>
          </div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar">
            <Menu size={14} />
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {visibleNavSections.map((section) => (
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
          <button className="sidebar-logout-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            <LogOut size={13} />
          </button>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── MAIN AREA ─────────────────────────────────────────────── */}
      <div className="admin-main">

        {/* Header */}
        <header className={`admin-header ${isDark ? "admin-header--dark" : "admin-header--light"}`}>

          <button className="header-btn" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar" aria-label="Toggle sidebar">
            <Menu size={16} />
          </button>

          {!sidebarOpen && (
            <Logo size="xs" />
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

            <AdminInstallButton />

            {getAdminRole() !== "superadmin" && !isImpersonating() && (
              <button className="header-btn" onClick={() => { setChangePasswordOpen(true); setPasswordError(""); setPasswordNotice(""); }} title="Change your password" aria-label="Change your password">
                <KeyRound size={15} />
              </button>
            )}

            <button className="header-btn" onClick={toggle} title={isDark ? "Switch to light" : "Switch to dark"} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}>
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button className="header-btn" onClick={() => { window.location.href = "/admin/notifications"; }} title="Notifications" aria-label="Open notifications">
              <Bell size={15} />
            </button>

            <div className="header-user-pill">
              <div className="header-avatar">
                {(headerUserName || "A").charAt(0).toUpperCase()}
              </div>
              <span className="header-user-name">
                {headerUserName}
              </span>
            </div>

            <button className="header-logout-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className={`admin-content ${isVpnSurface ? "admin-vpn-surface" : ""}`} aria-busy={reauthCheckPending}>
          {isImpersonating() && (
            <div role="status" style={{ marginBottom: 16, border: "1px solid rgba(249,115,22,0.45)", background: "rgba(124,45,18,0.2)", color: "#fed7aa", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span><ShieldAlert size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />Session expires at {new Date(localStorage.getItem("ochola_impersonation_expires_at") || Date.now()).toLocaleTimeString()}.</span>
              <button type="button" onClick={() => void handleEndAccess()} disabled={endingAccess} style={{ border: "1px solid rgba(254,215,170,0.5)", borderRadius: 7, padding: "7px 11px", background: "rgba(124,45,18,0.45)", color: "#ffedd5", fontWeight: 700, cursor: "pointer" }}>
                {endingAccess ? "Ending…" : "End access"}
              </button>
            </div>
          )}
          {notice && (
            <div role="status" style={{ marginBottom: 18, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.1)", color: "#fbbf24", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontWeight: 600 }}>
              {notice}
            </div>
          )}
          <PlatformBillingBanner />
          {requiresReauthGate && !reauthCheckPending && reauthStatus !== "verified" && reauthStatus !== "not-required" ? (
            <div role="dialog" aria-modal="true" aria-labelledby="reauth-title" style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(5,10,20,0.78)", display: "grid", placeItems: "center", padding: 20 }}>
              <form onSubmit={pagePasswordSetupNeeded ? handlePagePasswordSetup : reauthMethod === "password" ? handlePasswordRecheck : handlePageOtpVerify} style={{ width: "min(100%, 420px)", background: "var(--isp-card)", color: "var(--isp-text)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: 24, boxShadow: "0 20px 70px rgba(0,0,0,0.4)" }}>
                <h2 id="reauth-title" style={{ margin: "0 0 8px", fontSize: 19 }}>
                  {reauthStatus === "checking"
                    ? "Checking page security…"
                    : reauthStatus === "failed"
                      ? "Unable to check security policy"
                      : reauthMethod === "password"
                        ? pagePasswordSetupNeeded
                          ? `Create a ${currentPagePasswordLabel} page password`
                          : `Enter your ${currentPagePasswordLabel} page password`
                        : `Verify with ${reauthMethod === "email" ? "email" : reauthMethod === "whatsapp" ? "WhatsApp" : "SMS"}`}
                </h2>
                {reauthStatus === "checking" ? (
                  <p style={{ color: "var(--isp-text-muted)" }}>Checking the verification method assigned to this page…</p>
                ) : reauthStatus === "failed" ? (
                  <>
                    <p role="alert" style={{ color: "#dc2626", fontSize: 13, margin: "0 0 16px" }}>{reauthError}</p>
                    <button type="button" onClick={() => { setReauthCheckedFeature(null); setReauthStatus("checking"); setReauthRetryKey(value => value + 1); }} style={{ border: 0, borderRadius: 9, padding: "10px 15px", background: "var(--isp-accent)", color: "white", fontWeight: 700, cursor: "pointer" }}>Try again</button>
                  </>
                ) : (
                  <>
                    <p style={{ color: "var(--isp-text-muted)", fontSize: 14 }}>
                      {pagePasswordSetupNeeded
                        ? "Choose a unique password for this page, different from your sign-in password and other protected pages."
                        : `Enter the unique password for this page to continue.`}
                    </p>
                    {(currentPageAuthFeatureKey === "network.routers" || currentPageAuthFeatureKey === "network.files") && (
                      <p style={{ color: "var(--isp-text-muted)", fontSize: 13, marginTop: -4 }}>
                        {currentPageAuthFeatureKey === "network.routers"
                          ? "This verification applies only to the Routers page. Files access is controlled separately."
                          : "This verification applies only to the Files page. Routers access is controlled separately."}
                      </p>
                    )}
                    {reauthMethod === "password" ? (
                      pagePasswordSetupNeeded ? (
                        <>
                          <label htmlFor="page-password-new" style={{ display: "block", fontWeight: 600, margin: "14px 0 7px" }}>New {currentPagePasswordLabel} page password</label>
                          <input id="page-password-new" name={`page-password-${currentPageAuthFeatureKey}`} type="password" autoComplete="new-password" minLength={10} maxLength={200} value={newPagePassword} onChange={event => setNewPagePassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
                          <label htmlFor="page-password-confirm" style={{ display: "block", fontWeight: 600, margin: "14px 0 7px" }}>Confirm {currentPagePasswordLabel} page password</label>
                          <input id="page-password-confirm" name={`page-password-confirm-${currentPageAuthFeatureKey}`} type="password" autoComplete="new-password" minLength={10} maxLength={200} value={confirmPagePassword} onChange={event => setConfirmPagePassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
                        </>
                      ) : (
                        <>
                          <label htmlFor="page-reauth-password" style={{ display: "block", fontWeight: 600, margin: "14px 0 7px" }}>{currentPagePasswordLabel} page password</label>
                          <input id="page-reauth-password" name={`page-password-${currentPageAuthFeatureKey}`} type="password" autoComplete="new-password" value={reauthPassword} onChange={event => setReauthPassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
                        </>
                      )
                    ) : reauthChallengeId ? (
                      <>
                        <p style={{ color: "var(--isp-text-muted)", fontSize: 13 }}>
                          Code sent to {reauthDestination || "the contact saved on your account"}. Enter it within five minutes.
                        </p>
                        <label htmlFor="page-reauth-code" style={{ display: "block", fontWeight: 600, margin: "14px 0 7px" }}>Six-digit code</label>
                        <input
                          id="page-reauth-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={reauthCode}
                          onChange={event => setReauthCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)", letterSpacing: 4 }}
                          required
                        />
                      </>
                    ) : (
                      <p style={{ color: "var(--isp-text-muted)", fontSize: 14 }}>
                        We’ll send a one-time code to the {reauthMethod === "email" ? "email" : "phone number"} saved on your account.
                      </p>
                    )}
                    {reauthError && <p role="alert" style={{ color: "#dc2626", fontSize: 13 }}>{reauthError}</p>}
                    {reauthMethod !== "password" && reauthChallengeId && (
                      <button type="button" onClick={() => void handlePageOtpRequest()} disabled={reauthBusy || reauthResendSeconds > 0} style={{ marginTop: 12, border: 0, background: "none", color: "var(--isp-accent)", cursor: reauthBusy || reauthResendSeconds > 0 ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
                        {reauthResendSeconds > 0 ? `Send a new code in ${reauthResendSeconds}s` : "Send a new code"}
                      </button>
                    )}
                    <button
                      type={reauthMethod !== "password" && !reauthChallengeId ? "button" : "submit"}
                      onClick={reauthMethod !== "password" && !reauthChallengeId ? () => void handlePageOtpRequest() : undefined}
                      disabled={reauthBusy || (reauthMethod === "password" && (pagePasswordSetupNeeded
                        ? !newPagePassword || !confirmPagePassword
                        : !reauthPassword)) || (reauthMethod !== "password" && !!reauthChallengeId && reauthCode.length !== 6)}
                      style={{ marginTop: 14, border: 0, borderRadius: 8, padding: "10px 15px", background: "var(--isp-accent)", color: "white", fontWeight: 700, cursor: "pointer", opacity: reauthBusy ? 0.6 : 1 }}
                    >
                      {reauthBusy
                        ? reauthMethod === "password"
                          ? pagePasswordSetupNeeded ? "Creating…" : "Checking…"
                          : reauthChallengeId ? "Verifying…" : "Sending…"
                        : reauthMethod === "password"
                          ? pagePasswordSetupNeeded ? "Create password and continue" : "Continue to page"
                          : reauthChallengeId
                            ? "Verify code"
                            : "Send verification code"}
                    </button>
                  </>
                )}
              </form>
            </div>
          ) : reauthCheckPending ? null : (
            children
          )}
        </main>

        {changePasswordOpen && (
          <div role="dialog" aria-modal="true" aria-labelledby="change-password-title" style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(5,10,20,0.78)", display: "grid", placeItems: "center", padding: 20 }}>
            <form onSubmit={handleChangePassword} noValidate style={{ width: "min(100%, 440px)", background: "var(--isp-card)", color: "var(--isp-text)", border: "1px solid var(--isp-border)", borderRadius: 16, padding: 24, boxShadow: "0 20px 70px rgba(0,0,0,0.4)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <h2 id="change-password-title" style={{ margin: 0, fontSize: 19 }}>Change password</h2>
                <button type="button" aria-label="Close password change" onClick={() => setChangePasswordOpen(false)} style={{ border: 0, background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: 13 }}>Enter your current password, then choose and confirm a new password of at least 6 characters.</p>
              <label style={{ display: "block", fontSize: 13, marginBottom: 5 }}>Current password</label>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 12, border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
              <label style={{ display: "block", fontSize: 13, marginBottom: 5 }}>New password</label>
              <input type="password" autoComplete="new-password" minLength={6} value={newPassword} onChange={event => setNewPassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 12, border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
              <label style={{ display: "block", fontSize: 13, marginBottom: 5 }}>Confirm new password</label>
              <input type="password" autoComplete="new-password" minLength={6} value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-bg)", color: "var(--isp-text)" }} required />
              {passwordError && <p role="alert" style={{ color: "#dc2626", fontSize: 13 }}>{passwordError}</p>}
              {passwordNotice && <p role="status" style={{ color: "#15803d", fontSize: 13 }}>{passwordNotice}</p>}
              <button type="submit" disabled={passwordBusy} style={{ marginTop: 15, border: 0, borderRadius: 8, padding: "10px 15px", background: "var(--isp-accent)", color: "white", fontWeight: 700, cursor: "pointer", opacity: passwordBusy ? 0.6 : 1 }}>
                {passwordBusy ? "Saving…" : "Update password"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

const adminLayoutStyles = `
.admin-shell {
  min-height: 100vh;
  display: flex;
  background: var(--isp-bg);
  font-family: var(--isp-font-family, 'Inter', system-ui, sans-serif);
}

/* ── SIDEBAR ─────────────────────────────────────────── */
.admin-sidebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--isp-sidebar);
  overflow: hidden;
  transition: width 0.18s cubic-bezier(0.4,0,0.2,1);
  position: relative;
  z-index: 20;
  box-shadow: 1px 0 0 rgba(185,210,201,0.08);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-logo-inner {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-logo-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--isp-sidebar-strip);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
   box-shadow: 0 5px 13px rgba(37,99,235,0.22);
}

.sidebar-brand-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #eef4ef;
  letter-spacing: -0.01em;
  line-height: 1.15;
  white-space: nowrap;
}

.sidebar-brand-sub {
  font-size: 0.625rem;
  color: #7c9690;
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
  padding: 6px 0 10px;
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
  padding: 11px 16px 4px;
  white-space: nowrap;
}

/* Nav row (top-level item) */
.nav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin: 1px 6px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 400;
  color: #a8bdb6;
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
  background: var(--isp-accent-glow);
  color: var(--isp-accent) !important;
  font-weight: 600;
  border-left-color: var(--isp-accent);
}

.nav-icon {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255,255,255,0.04);
  color: #64748B;
  transition: background 0.13s, color 0.13s;
}
.nav-row:hover .nav-icon {
  background: rgba(255,255,255,0.07);
  color: #94A3B8;
}
.nav-icon--active {
  background: var(--isp-accent-glow) !important;
  color: var(--isp-accent) !important;
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
  font-weight: 600;
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
  margin: 1px 6px 2px 28px;
  padding-left: 12px;
  border-left: 1px solid rgba(148,163,184,0.18);
}

.nav-child-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  margin: 1px 0;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 400;
  color: #94A3B8;
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
  color: var(--isp-accent) !important;
  font-weight: 600;
  background: var(--isp-accent-glow);
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
.nav-child-row--active .nav-child-dot { background: var(--isp-accent) !important; }

/* ── SIDEBAR USER STRIP ──────────────────────────────── */
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--isp-sidebar-strip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 600;
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
  padding: 0 16px;
  height: 52px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
}
.admin-header--light {
  background: var(--isp-header);
  border-bottom: 1px solid var(--isp-border);
  box-shadow: var(--shadow-sm);
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
  width: 32px;
  height: 32px;
  border-radius: 6px;
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
  font-weight: 600;
  color: var(--isp-text);
  letter-spacing: -0.01em;
  flex-shrink: 0;
}

.admin-install-wrap {
  position: relative;
  flex-shrink: 0;
}
.admin-install-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--isp-accent-border);
  border-radius: 8px;
  background: var(--isp-accent-glow);
  color: var(--isp-accent);
  cursor: pointer;
  font: 600 0.72rem/1 var(--isp-font-family, 'Inter'), system-ui, sans-serif;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.admin-install-button:hover {
  background: var(--isp-accent);
  border-color: var(--isp-accent);
  color: white;
}
.admin-install-button--installed {
  color: var(--isp-green);
  border-color: rgba(34,197,94,0.25);
  background: var(--isp-green-glow);
  cursor: default;
}
.admin-install-button--installed:hover {
  color: var(--isp-green);
  border-color: rgba(34,197,94,0.25);
  background: var(--isp-green-glow);
}
.admin-install-help {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 60;
  width: 260px;
  padding: 13px 14px;
  border: 1px solid var(--isp-border);
  border-radius: 11px;
  background: var(--isp-card);
  color: var(--isp-text-muted);
  box-shadow: 0 14px 35px rgba(0,0,0,0.22);
}
.admin-install-help-title {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-right: 18px;
  color: var(--isp-text);
  font-size: 0.75rem;
  font-weight: 700;
}
.admin-install-help-title svg { color: var(--isp-accent); flex-shrink: 0; }
.admin-install-help p {
  margin: 7px 0 0;
  font-size: 0.7rem;
  line-height: 1.5;
}
.admin-install-help-close {
  position: absolute;
  top: 9px;
  right: 9px;
  display: grid;
  place-items: center;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--isp-text-sub);
  cursor: pointer;
}
.admin-install-help-close:hover { color: var(--isp-text); }
@media (max-width: 720px) {
  .admin-install-label { display: none; }
  .admin-install-button { width: 34px; padding: 0; }
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
  background: var(--isp-sidebar-strip);
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
  padding: 16px 20px;
  overflow-y: auto;
}

.admin-sidebar--closed .sidebar-logo {
  justify-content: center;
  padding-inline: 8px;
}
.admin-sidebar--closed .sidebar-logo-inner {
  justify-content: center;
}
.admin-sidebar--closed .sidebar-brand-sub,
.admin-sidebar--closed .sidebar-close-btn,
.admin-sidebar--closed .nav-section-label,
.admin-sidebar--closed .nav-label,
.admin-sidebar--closed .nav-badge,
.admin-sidebar--closed .nav-chevron,
.admin-sidebar--closed .nav-children,
.admin-sidebar--closed .sidebar-user-info,
.admin-sidebar--closed .sidebar-logout-btn {
  display: none;
}
.admin-sidebar--closed .nav-row {
  justify-content: center;
  padding: 6px;
  margin-inline: 8px;
}
.admin-sidebar--closed .nav-icon {
  width: 30px;
  height: 30px;
}
.admin-sidebar--closed .sidebar-user {
  justify-content: center;
  padding-inline: 8px;
}

@media (max-width: 768px) {
  .admin-content { padding: 12px; }
  .header-search { max-width: 180px; }
  .header-live-pill { display: none; }
  .header-logout-btn span { display: none; }
  .admin-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 50;
    width: ${SIDEBAR_W}px !important;
    transform: translateX(-100%);
    box-shadow: 12px 0 30px rgba(0,0,0,0.28);
  }
  .admin-sidebar--open { transform: translateX(0); }
  .admin-sidebar--closed { width: 0 !important; }
  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    background: rgba(15,23,42,0.48);
    border: 0;
    cursor: pointer;
  }
  .admin-main { width: 100%; }
}
@media (min-width: 769px) {
  .sidebar-backdrop { display: none; }
}
`;
