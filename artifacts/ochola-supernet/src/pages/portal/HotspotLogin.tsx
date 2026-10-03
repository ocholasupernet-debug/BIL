import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Wifi, Phone, Zap, CheckCircle2, Ticket,
  AlertCircle, Loader2, Shield, Clock,
  ArrowRight, ArrowUpRight, CreditCard, Tv, Sparkles, Database,
} from "lucide-react";
import { useBrand } from "@/context/BrandContext";
import { getCurrencySymbol } from "@/lib/utils";
import {
  forgetHotspotDevice,
  hotspotSavedDevicesStorageKey,
  readSavedHotspotDevices,
  saveHotspotDevice,
  type SavedHotspotDevice,
} from "@/lib/saved-hotspot-devices";
import {
  DEFAULT_HOTSPOT_LOGO_URL,
  DEFAULT_HOTSPOT_PORTAL_CARDS,
  normalizeHotspotPortalCards,
  type HotspotPortalCardVisibility,
} from "@/lib/hotspot-portal-cards";
import {
  HOSTED_PORTAL_LAYOUT_CSS,
  normalizeHotspotPortalLayout,
  type HotspotPortalLayout,
} from "@/lib/hotspot-layouts";

interface Plan {
  id: number; name: string; price: number;
  validity: number; validity_unit: string; validity_days: number;
  speed_down: number; speed_up: number;
  data_limit_mb?: number | null;
  /** What the router should do after the data allowance is exhausted. */
  fup_policy?: "hard_disconnect" | "throttle";
  data_cap_mode?: "disconnect" | "throttle";
  /** Reduced speeds used only when fup_policy is throttle. */
  fup_speed_down?: number | null;
  fup_speed_up?: number | null;
  description: string | null; type?: string;
  router_id?: number | null; port_id?: number | null;
}

interface HotspotRuntimeConfig {
  apiBase: string;
  adminId: number | null;
  routerId: number | null;
  portId: number | null;
  portalContextToken: string;
  previewOnly: boolean;
  portalLayout: HotspotPortalLayout;
  plans: Plan[];
}
interface HotspotCredentials {
  username: string;
  password: string;
}
interface HotspotSession {
  status: "active" | "depleted" | "expired" | "not_found" | "unavailable";
  connected: boolean;
  expiresAt: string | null;
  found?: boolean;
  planName?: string | null;
  username?: string | null;
}
interface ConnectedDevice {
  name: string;
  macAddress: string;
  address: string;
  routerId: number;
  routerName: string;
}
type Tab = "plans" | "tv" | "voucher";

function positivePortalId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRuntimePlan(value: unknown): Plan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = positivePortalId(row.id);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return null;
  const dataLimitMb = row.data_limit_mb === null || row.data_limit_mb === undefined
    ? null
    : Number(row.data_limit_mb);
  const rawPolicy = String(
    row.data_cap_mode ?? row.dataCapMode ?? row.fup_policy ?? row.fup_mode
      ?? row.data_cap_policy ?? row.exhaustion_policy ?? row.quota_policy ?? "",
  ).trim().toLowerCase();
  const fupPolicy: Plan["fup_policy"] = [
    "throttle",
    "reduced_speed",
    "reduced-speed",
    "safaricom",
    "fair_use",
    "fair-use",
  ].includes(rawPolicy)
    ? "throttle"
    : "hard_disconnect";
  const throttleDown = Number(
    row.fup_speed_down ?? row.throttle_speed_down ?? row.speed_after_limit_down ?? row.reduced_speed_down,
  );
  const throttleUp = Number(
    row.fup_speed_up ?? row.throttle_speed_up ?? row.speed_after_limit_up ?? row.reduced_speed_up,
  );
  return {
    id,
    name,
    price: Number(row.price) || 0,
    validity: Number(row.validity) || 0,
    validity_unit: typeof row.validity_unit === "string" ? row.validity_unit : "days",
    validity_days: Number(row.validity_days ?? row.validity) || 0,
    speed_down: Number(row.speed_down) || 0,
    speed_up: Number(row.speed_up) || 0,
    data_limit_mb: dataLimitMb !== null && Number.isFinite(dataLimitMb) && dataLimitMb > 0
      ? dataLimitMb
      : null,
    fup_policy: fupPolicy,
    data_cap_mode: fupPolicy === "throttle" ? "throttle" : "disconnect",
    fup_speed_down: Number.isFinite(throttleDown) && throttleDown > 0 ? throttleDown : null,
    fup_speed_up: Number.isFinite(throttleUp) && throttleUp > 0 ? throttleUp : null,
    description: typeof row.description === "string" ? row.description : null,
    type: typeof row.type === "string" ? row.type : undefined,
    router_id: positivePortalId(row.router_id),
    port_id: positivePortalId(row.port_id),
  };
}

function readHotspotRuntimeConfig(): HotspotRuntimeConfig {
  const raw = typeof window !== "undefined"
    ? (window as Window & { __HOTSPOT_CONFIG__?: Record<string, unknown> }).__HOTSPOT_CONFIG__
    : undefined;
  const apiBase = typeof raw?.apiBase === "string" && /^https?:\/\//i.test(raw.apiBase.trim())
    ? raw.apiBase.trim().replace(/\/+$/, "")
    : "";
  return {
    apiBase,
    adminId: positivePortalId(raw?.adminId),
    routerId: positivePortalId(raw?.routerId),
    portId: positivePortalId(raw?.portId),
    portalContextToken: typeof raw?.portalContextToken === "string" ? raw.portalContextToken.trim() : "",
    previewOnly: raw?.previewOnly === true,
    portalLayout: normalizeHotspotPortalLayout(raw?.portalLayout),
    plans: Array.isArray(raw?.plans)
      ? raw.plans.map(normalizeRuntimePlan).filter((plan): plan is Plan => Boolean(plan))
      : [],
  };
}

const HOTSPOT_RUNTIME_CONFIG = readHotspotRuntimeConfig();

function portalRouterIdentifier(names: string[]): { value: string; supplied: boolean } {
  if (typeof window === "undefined") return { value: "", supplied: false };
  const query = new URLSearchParams(window.location.search);
  const values = names.flatMap(name => query.getAll(name));
  if (!values.length) return { value: "", supplied: false };
  const distinct = [...new Set(values)];
  const value = distinct.length === 1 && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(distinct[0])
    ? distinct[0]
    : "__invalid__";
  return { value, supplied: true };
}

const HOTSPOT_NAS_IDENTIFIER = portalRouterIdentifier(["nasid", "nas-id", "nas_identifier"]);
const HOTSPOT_SERVER_NAME = portalRouterIdentifier(["server", "server-name", "hotspot_server_name", "hotspotServerName"]);

function hotspotApiUrl(path: string): string {
  return `${HOTSPOT_RUNTIME_CONFIG.apiBase}${path}`;
}

function hotspotPortalFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = HOTSPOT_RUNTIME_CONFIG.portalContextToken;
  if (!token && !HOTSPOT_NAS_IDENTIFIER.supplied && !HOTSPOT_SERVER_NAME.supplied) return fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (token) headers.set("X-Hotspot-Portal-Context", token);
  if (token || HOTSPOT_NAS_IDENTIFIER.supplied || HOTSPOT_SERVER_NAME.supplied) {
    headers.set("X-Hotspot-NAS-Identifier", HOTSPOT_NAS_IDENTIFIER.value);
    headers.set("X-Hotspot-Server-Name", HOTSPOT_SERVER_NAME.value);
  }
  return fetch(input, { ...init, headers });
}

type PortalBranding = {
  ispName?: string;
  tagline?: string;
  logoUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
  portalHostname?: string;
  portalCards?: HotspotPortalCardVisibility;
  portalLayout?: HotspotPortalLayout;
};

function formatValidity(plan: Plan): string {
  const days = plan.validity_days ?? plan.validity ?? 0;
  const unit = (plan.validity_unit ?? "days").toLowerCase();
  if (unit === "hours" || unit === "hour") {
    const hours = Number(plan.validity) || 1;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (days === 0) return `${plan.validity ?? 1} hours`;
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (days === 1) return "1 day";
  if (days < 7) return `${days} days`;
  if (days === 7) return "1 Week";
  if (days === 30 || days === 31) return "1 Month";
  if (days === 365) return "1 Year";
  return `${days} days`;
}

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) return `${mbps / 1000} Gbps`;
  return `${mbps} Mbps`;
}

function formatDataLimit(plan: Plan): string | null {
  const limitMb = Number(plan.data_limit_mb);
  if (!Number.isFinite(limitMb) || limitMb <= 0) return null;
  const limit = limitMb >= 1000
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(limitMb / 1000)} GB`
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(limitMb)} MB`;
  if (plan.fup_policy === "throttle" && (plan.fup_speed_down ?? 0) > 0) {
    const down = formatSpeed(plan.fup_speed_down!);
    const up = (plan.fup_speed_up ?? 0) > 0 ? ` / ${formatSpeed(plan.fup_speed_up!)}` : "";
    return `${limit} FUP cap · then ${down}${up}`;
  }
  return `${limit} cap · disconnects when used`;
}

function formatSessionExpiry(value: string | null): string {
  if (!value) return "No expiry time recorded";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Expiry time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function normalizeMacAddress(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) && !/^[0-9a-f]{12}$/i.test(trimmed)) return "";
  const compact = trimmed.replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(compact)) return "";
  return compact.toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

function normalizeClientIp(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return "";
  const octets = trimmed.split(".").map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255) ? trimmed : "";
}

function hotspotLoginStorageKey(adminId: number | null): string {
  const host = typeof window !== "undefined" ? window.location.host : "portal";
  return [
    "ochola_hotspot_login_v1",
    host,
    adminId ? String(adminId) : "tenant",
  ].map(value => encodeURIComponent(value)).join(":");
}

function storeHotspotCredentials(storageKey: string, credentials: HotspotCredentials): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(credentials));
  } catch {}
}

const PLAN_GRADIENTS = [
  { bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", light: "#667eea" },
  { bg: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)", light: "#f093fb" },
  { bg: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)", light: "#4facfe" },
  { bg: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)", light: "#43e97b" },
  { bg: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)", light: "#fa709a" },
  { bg: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)", light: "#a18cd1" },
  { bg: "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)", light: "#fccb90" },
  { bg: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)", light: "#e0c3fc" },
  { bg: "linear-gradient(135deg, #f5576c 0%, #ff6f61 100%)", light: "#f5576c" },
  { bg: "linear-gradient(135deg, #0acffe 0%, #495aff 100%)", light: "#0acffe" },
];

function isDarajaGateway(paymentGateway: string): boolean {
  return paymentGateway === "mpesa_paybill"
    || paymentGateway === "mpesa_till_push"
    || paymentGateway === "bank_stk_push";
}

type CheckoutPaymentStatus = {
  configured: boolean;
  destinationConfigured: boolean;
  paymentGateway: string;
};

function isPaymentMethodReady(status: CheckoutPaymentStatus | null): boolean {
  return Boolean(
    status?.configured
    && status.destinationConfigured
    && isDarajaGateway(status.paymentGateway),
  );
}

function checkoutPaymentLabel(paymentGateway: string): string {
  if (paymentGateway === "bank_stk_push") return "Bank STK Push";
  if (paymentGateway === "mpesa_till_push") return "M-Pesa Till";
  return "M-Pesa PayBill";
}

export function HotspotTroubleshootPage() {
  return <HotspotLoginView initialTroubleshootOpen />;
}

export default function HotspotLogin() {
  return <HotspotLoginView />;
}

function HotspotLoginView({
  troubleshootingOnly = false,
  initialTroubleshootOpen = false,
}: {
  troubleshootingOnly?: boolean;
  initialTroubleshootOpen?: boolean;
} = {}) {
  const brand = useBrand();
  const [portalBranding, setPortalBranding] = useState<PortalBranding>({
    portalLayout: HOTSPOT_RUNTIME_CONFIG.portalLayout,
  });
  useEffect(() => {
    if (!HOTSPOT_RUNTIME_CONFIG.adminId) return;
    let cancelled = false;
    hotspotPortalFetch(hotspotApiUrl(`/api/public/hotspot-branding?adminId=${encodeURIComponent(String(HOTSPOT_RUNTIME_CONFIG.adminId))}`), {
      cache: "no-store",
    })
      .then(response => response.ok ? response.json() as Promise<{ branding?: { portalHostname?: unknown; settings?: unknown } }> : null)
      .then(payload => {
        const settings = payload?.branding?.settings;
        if (cancelled || !settings || typeof settings !== "object" || Array.isArray(settings)) return;
        const row = settings as Record<string, unknown>;
        setPortalBranding({
          ispName: typeof row.ispName === "string" ? row.ispName : undefined,
          tagline: typeof row.tagline === "string" ? row.tagline : undefined,
          logoUrl: typeof row.logoUrl === "string" && row.logoUrl.length <= 2_000_000 ? row.logoUrl : undefined,
          supportPhone: typeof row.supportPhone === "string" ? row.supportPhone : undefined,
          supportEmail: typeof row.supportEmail === "string" ? row.supportEmail : undefined,
          portalHostname: typeof payload?.branding?.portalHostname === "string" ? payload.branding.portalHostname : undefined,
          portalCards: normalizeHotspotPortalCards(row.portalCards, row),
          portalLayout: typeof row.portalLayout === "string"
            ? normalizeHotspotPortalLayout(row.portalLayout)
            : HOTSPOT_RUNTIME_CONFIG.portalLayout,
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const portalBrand = {
    ...brand,
    ispName: portalBranding.ispName || brand.ispName,
    phone: portalBranding.supportPhone || brand.phone,
    supportEmail: portalBranding.supportEmail || brand.supportEmail,
    domain: portalBranding.portalHostname || brand.domain,
  };
  const portalCards = portalBranding.portalCards ?? DEFAULT_HOTSPOT_PORTAL_CARDS;
  const [activeTab, setActiveTab] = useState<Tab>("plans");
  useEffect(() => {
    const availableTabs: Tab[] = [
      ...(portalCards.packages ? ["plans", "tv"] as const : []),
      ...(portalCards.voucher ? ["voucher"] as const : []),
    ];
    if (availableTabs.length && !availableTabs.includes(activeTab)) setActiveTab(availableTabs[0]);
  }, [activeTab, portalCards.packages, portalCards.voucher]);

  const portalContext = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        mac: normalizeMacAddress(params.get("mac") ?? params.get("mac-address") ?? ""),
        ip: normalizeClientIp(params.get("ip") ?? ""),
        linkLogin: params.get("link-login-only") ?? params.get("link-login") ?? "",
        linkOrig: params.get("link-orig") ?? "",
      };
    } catch {
      return { mac: "", ip: "", linkLogin: "", linkOrig: "" };
    }
  })();

  const adminId: number | null = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qId = params.get("adminId") ?? params.get("ispId");
      return positivePortalId(qId) ?? HOTSPOT_RUNTIME_CONFIG.adminId;
    } catch { return null; }
  })();
  const portalScope = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const routerId = Number(params.get("routerId") ?? "");
      const portId = Number(params.get("portId") ?? "");
      return {
        routerId: positivePortalId(routerId) ?? HOTSPOT_RUNTIME_CONFIG.routerId,
        portId: positivePortalId(portId) ?? HOTSPOT_RUNTIME_CONFIG.portId,
      };
    } catch {
      return {
        routerId: HOTSPOT_RUNTIME_CONFIG.routerId,
        portId: HOTSPOT_RUNTIME_CONFIG.portId,
      };
    }
  })();
  const planScopeQuery = [
    adminId ? `adminId=${encodeURIComponent(String(adminId))}` : "",
    portalScope.routerId ? `routerId=${encodeURIComponent(String(portalScope.routerId))}` : "",
    portalScope.portId ? `portId=${encodeURIComponent(String(portalScope.portId))}` : "",
  ].filter(Boolean).map(value => `&${value}`).join("");
  const savedTvDevicesStorageKey = hotspotSavedDevicesStorageKey(
    typeof window !== "undefined" ? window.location.host : "portal",
    adminId,
    portalScope.routerId,
    portalScope.portId,
  );

  const [plans, setPlans] = useState<Plan[]>(HOTSPOT_RUNTIME_CONFIG.plans);
  const [plansLoading, setPlansLoading] = useState(
    HOTSPOT_RUNTIME_CONFIG.previewOnly !== true && HOTSPOT_RUNTIME_CONFIG.plans.length === 0,
  );
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentMode, setPaymentMode] = useState<"data" | "tv">("data");
  const [phone, setPhone] = useState("");
  const [deviceMacAddress, setDeviceMacAddress] = useState(portalContext.mac);
  const [deviceName, setDeviceName] = useState("");
  const [tvDialogOpen, setTvDialogOpen] = useState(false);
  const [tvDevices, setTvDevices] = useState<ConnectedDevice[]>([]);
  const [tvDevicesLoading, setTvDevicesLoading] = useState(false);
  const [tvDeviceChoice, setTvDeviceChoice] = useState("");
  const [tvMacAddress, setTvMacAddress] = useState(portalContext.mac);
  const [tvDeviceName, setTvDeviceName] = useState("");
  const [savedTvDevices, setSavedTvDevices] = useState<SavedHotspotDevice[]>(
    () => readSavedHotspotDevices(savedTvDevicesStorageKey),
  );
  const [rememberTvDevice, setRememberTvDevice] = useState(false);
  const [tvDeviceSaveNotice, setTvDeviceSaveNotice] = useState("");
  const [showTvSuccess, setShowTvSuccess] = useState(false);
  const [paidAccessExpiresAt, setPaidAccessExpiresAt] = useState<string | null>(null);
  const [tvPlanId, setTvPlanId] = useState("");
  const [tvPhone, setTvPhone] = useState("");
  const [tvDialogError, setTvDialogError] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [stkSent, setStkSent] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [portalHandoffReady, setPortalHandoffReady] = useState(false);
  const [accessRetrying, setAccessRetrying] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [hotspotCredentials, setHotspotCredentials] = useState<HotspotCredentials | null>(null);
  const bindingInFlight = useRef(false);
  const statusPollInFlight = useRef(false);
  const [mpesaStatus, setMpesaStatus] = useState<{
    configured: boolean;
    env: string;
    shortcode: string;
    hasTillNumber: boolean;
    destinationConfigured: boolean;
    paymentGateway: string;
  } | null>(null);
  const [paymentStatusLoaded, setPaymentStatusLoaded] = useState(false);
  const loginCredentialsStorageKey = hotspotLoginStorageKey(adminId);
  const [loginSession, setLoginSession] = useState<HotspotSession | null>(null);
  const [troubleshootLoading, setTroubleshootLoading] = useState(false);
  const [troubleshootMessage, setTroubleshootMessage] = useState("");
  const [troubleshootError, setTroubleshootError] = useState("");
  const [troubleshootAction, setTroubleshootAction] = useState<"check" | "login" | null>(null);
  const troubleshootInFlight = useRef(false);
  const autoTroubleshootKey = useRef("");
  const [troubleshootDialogOpen, setTroubleshootDialogOpen] = useState(() => (
    initialTroubleshootOpen
    || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("page") === "troubleshoot")
  ));
  const troubleshootTriggerRef = useRef<HTMLButtonElement | null>(null);
  const troubleshootDialogRef = useRef<HTMLDivElement | null>(null);
  const [mpesaMessage, setMpesaMessage] = useState("");
  const [mpesaReconnectLoading, setMpesaReconnectLoading] = useState(false);
  const [mpesaReconnectError, setMpesaReconnectError] = useState("");

  useEffect(() => {
    if (!troubleshootDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const dialog = troubleshootDialogRef.current;
    const closeButton = dialog?.querySelector<HTMLElement>(".hp-troubleshoot-close");
    (closeButton ?? dialog)?.focus();

    const handleDialogKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTroubleshootDialogOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeydown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeydown);
      document.body.style.overflow = previousOverflow;
      const trigger = troubleshootTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else previousFocus?.focus();
    };
  }, [troubleshootDialogOpen]);

  useEffect(() => {
    setSavedTvDevices(readSavedHotspotDevices(savedTvDevicesStorageKey));
  }, [savedTvDevicesStorageKey]);

  useEffect(() => {
    if (troubleshootingOnly) {
      setPlansLoading(false);
      setPaymentStatusLoaded(true);
      return;
    }
    if (HOTSPOT_RUNTIME_CONFIG.previewOnly) {
      setPlansLoading(false);
      setPaymentStatusLoaded(true);
      return;
    }
    setPaymentStatusLoaded(false);
    (async () => {
      try {
        const [plansRes, mpesaRes] = await Promise.all([
          hotspotPortalFetch(hotspotApiUrl(`/api/plans?type=hotspot&activeOnly=true&purchasableOnly=true${planScopeQuery}`)),
          hotspotPortalFetch(hotspotApiUrl(`/api/settings/mpesa?${[
            adminId ? `adminId=${encodeURIComponent(String(adminId))}` : "",
            portalScope.routerId ? `routerId=${encodeURIComponent(String(portalScope.routerId))}` : "",
            portalScope.portId ? `portId=${encodeURIComponent(String(portalScope.portId))}` : "",
          ].filter(Boolean).join("&")}`)).catch(() => null),
        ]);
        if (plansRes.ok) {
          const plansData = await plansRes.json() as unknown;
          if (Array.isArray(plansData)) {
            setPlans(plansData.map(normalizeRuntimePlan).filter((plan): plan is Plan => Boolean(plan)));
          }
        }

        if (mpesaRes?.ok) {
          const mpesaData = await mpesaRes.json();
          setMpesaStatus({
            configured: mpesaData.configured,
            env: mpesaData.settings?.env ?? "sandbox",
            shortcode: mpesaData.settings?.shortcode ?? "",
            hasTillNumber: mpesaData.settings?.hasTillNumber === true,
            destinationConfigured: mpesaData.settings?.destinationConfigured === true,
            paymentGateway: typeof mpesaData.settings?.paymentGateway === "string" ? mpesaData.settings.paymentGateway : "mpesa_paybill",
          });
        }
      } catch {
        // Keep the package list embedded during deployment if the live API is
        // temporarily unreachable from the RouterOS client network.
      }
      finally {
        setPlansLoading(false);
        setPaymentStatusLoaded(true);
      }
    })();
  }, [adminId, planScopeQuery, troubleshootingOnly]);

  useEffect(() => {
    if (!tvDialogOpen) return;
    setTvDevicesLoading(true);
    setTvDialogError("");
    const deviceQuery = [
      adminId ? `adminId=${encodeURIComponent(String(adminId))}` : "",
      portalScope.routerId ? `routerId=${encodeURIComponent(String(portalScope.routerId))}` : "",
    ].filter(Boolean).join("&");
    hotspotPortalFetch(hotspotApiUrl(`/api/mpesa/hotspot-devices${deviceQuery ? `?${deviceQuery}` : ""}`))
      .then(async response => {
        const data = await response.json() as { ok?: boolean; devices?: ConnectedDevice[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "Connected devices could not be loaded.");
        setTvDevices(Array.isArray(data.devices) ? data.devices : []);
      })
      .catch(error => {
        setTvDevices([]);
        setTvDialogError(error instanceof Error ? error.message : "Connected devices could not be loaded.");
      })
      .finally(() => setTvDevicesLoading(false));
  }, [adminId, portalScope.routerId, tvDialogOpen]);

  const [pollTimedOut, setPollTimedOut] = useState(false);

  const bindPaidHotspotAccess = useCallback(async (activeCheckoutId: string, retryRouter = false): Promise<boolean> => {
    setAccessRetrying(true);
    try {
      const accessResponse = await hotspotPortalFetch(hotspotApiUrl("/api/mpesa/hotspot-mac-access"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_id: activeCheckoutId,
          ...(retryRouter ? { retry: true } : {}),
          ...(adminId ? { adminId } : {}),
          ...(portalScope.routerId ? { router_id: portalScope.routerId } : {}),
          ...(portalScope.portId ? { port_id: portalScope.portId } : {}),
          mac_address: deviceMacAddress,
          device_name: deviceName,
          ...(!retryRouter && paymentMode !== "tv" && (portalContext.linkLogin || portalContext.linkOrig)
            ? { portal_login_handoff: true }
            : {}),
          ...(paymentMode === "tv" ? { target_device: true } : portalContext.ip ? { client_ip: portalContext.ip } : {}),
        }),
      });
      const accessData = await accessResponse.json() as {
        ok?: boolean;
        error?: string;
        credentials?: HotspotCredentials;
        connected?: boolean;
        portal_login_handoff?: boolean;
        expires_at?: string;
        message?: string;
      };
      if (!accessResponse.ok || !accessData.ok || !accessData.credentials?.username || !accessData.credentials.password) {
        throw new Error(accessData.error || "Payment confirmed, but the hotspot router could not be updated yet.");
      }
      setHotspotCredentials(accessData.credentials);
      storeHotspotCredentials(loginCredentialsStorageKey, accessData.credentials);
      const connected = accessData.connected === true;
      const portalHandoff = accessData.portal_login_handoff === true;
      setAccessReady(connected);
      setPortalHandoffReady(portalHandoff);
      setPaidAccessExpiresAt(accessData.expires_at ?? null);
      setShowTvSuccess(connected && paymentMode === "tv");
      if (connected && paymentMode === "tv") {
        const macAddress = normalizeMacAddress(deviceMacAddress);
        const wasSaved = savedTvDevices.some(device => device.macAddress === macAddress);
        let saved = wasSaved;
        if (rememberTvDevice) {
          saved = saveHotspotDevice(savedTvDevicesStorageKey, {
            macAddress,
            name: deviceName,
          });
          if (saved) setSavedTvDevices(readSavedHotspotDevices(savedTvDevicesStorageKey));
        }
        setTvDeviceSaveNotice(
          saved
            ? "This TV is saved in this browser for next time."
            : rememberTvDevice
              ? "The TV is connected, but this browser could not save it."
              : "",
        );
      } else {
        setTvDeviceSaveNotice("");
      }
      setPaymentConfirmed(true);
      setPayError(connected
        ? null
        : portalHandoff
          ? null
          : accessData.message || "Payment is confirmed, but the router has not confirmed this device's login yet.");
      return connected || portalHandoff;
    } catch (error) {
      setPaymentConfirmed(true);
      setAccessReady(false);
      setPortalHandoffReady(false);
      setShowTvSuccess(false);
      setPayError(error instanceof Error ? error.message : "The hotspot router could not be updated yet.");
      return false;
    } finally {
      setAccessRetrying(false);
      bindingInFlight.current = false;
    }
  }, [
    adminId,
    deviceMacAddress,
    deviceName,
    loginCredentialsStorageKey,
    paymentMode,
    portalContext.ip,
    rememberTvDevice,
    savedTvDevices,
    savedTvDevicesStorageKey,
  ]);

  useEffect(() => {
    if (!checkoutId || paymentConfirmed || paymentFailed) return;
    setPollTimedOut(false);
    const start = Date.now();
    const maxPollMs = 3 * 60 * 1000;
    const interval = setInterval(async () => {
      if (Date.now() - start > maxPollMs) {
        setPollTimedOut(true);
        clearInterval(interval);
        return;
      }
      if (statusPollInFlight.current) return;
      statusPollInFlight.current = true;
      try {
        const res = await hotspotPortalFetch(hotspotApiUrl(`/api/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`));
        const data = await res.json();
        if (data.paid && !bindingInFlight.current) {
          bindingInFlight.current = true;
          setPaymentConfirmed(true);
          clearInterval(interval);
          await bindPaidHotspotAccess(checkoutId);
        } else if (data.status === "failed") {
          setPayError(data.failureReason || "M-Pesa cancelled or declined the payment prompt.");
          setPaymentFailed(true);
          clearInterval(interval);
        }
      } catch {
        // Keep polling through brief network failures.
      } finally {
        statusPollInFlight.current = false;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [checkoutId, paymentConfirmed, paymentFailed, adminId, bindPaidHotspotAccess]);

  useEffect(() => {
    if (!accessReady && !portalHandoffReady) return;
    if (paymentMode === "tv") return;
    const destination = portalContext.linkLogin || portalContext.linkOrig;
    if (!/^https?:\/\//i.test(destination) || !hotspotCredentials) {
      if (!troubleshootingOnly) {
        setTroubleshootDialogOpen(true);
      } else {
        setTroubleshootMessage("Your account is ready. Return to the Wi-Fi sign-in page to finish connecting.");
      }
      return;
    }
    const destinationWithoutHash = destination.split("#", 1)[0];
    const credentialHash = new URLSearchParams({
      hotspot_username: hotspotCredentials.username,
      hotspot_password: hotspotCredentials.password,
    }).toString();
    const redirectTimer = window.setTimeout(
      () => window.location.assign(`${destinationWithoutHash}#${credentialHash}`),
      portalHandoffReady ? 80 : 250,
    );
    return () => window.clearTimeout(redirectTimer);
  }, [accessReady, portalHandoffReady, hotspotCredentials, paymentMode, troubleshootingOnly]);

  const startPayment = async (options: {
    plan: Plan;
    phoneValue: string;
    macValue: string;
    deviceNameValue?: string;
    deviceRouterId?: number;
    targetDevice?: boolean;
    rememberDevice?: boolean;
  }) => {
    const {
      plan,
      phoneValue,
      macValue,
      deviceNameValue = "",
      deviceRouterId,
      targetDevice = false,
      rememberDevice = false,
    } = options;
    const macAddress = normalizeMacAddress(macValue);
    const normalizedDeviceName = deviceNameValue.trim().replace(/\s+/g, " ").slice(0, 64);
    setSelectedPlan(plan);
    setPaymentMode(targetDevice ? "tv" : "data");
    setRememberTvDevice(rememberDevice);
    setTvDeviceSaveNotice("");
    setPhone(phoneValue);
    setDeviceMacAddress(macAddress);
    setDeviceName(normalizedDeviceName);
    setPayLoading(true); setPayError(null); setPaymentFailed(false); setPaymentConfirmed(false); setAccessReady(false); setPortalHandoffReady(false); setShowTvSuccess(false); setPaidAccessExpiresAt(null); setHotspotCredentials(null); setPollTimedOut(false);
    bindingInFlight.current = false;
    try {
      const intentResponse = await hotspotPortalFetch(hotspotApiUrl("/api/mpesa/intent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneValue.trim(),
          plan_id: plan.id,
          ...(adminId ? { adminId } : {}),
          ...(portalScope.routerId ? { router_id: portalScope.routerId } : {}),
          ...(portalScope.portId ? { port_id: portalScope.portId } : {}),
          ...(macAddress ? { mac_address: macAddress } : {}),
          ...(normalizedDeviceName ? { device_name: normalizedDeviceName } : {}),
          ...(deviceRouterId ? { device_router_id: deviceRouterId } : {}),
          ...(!targetDevice && portalContext.ip ? { client_ip: portalContext.ip } : {}),
        }),
      });
      const intentData = await intentResponse.json() as { ok?: boolean; error?: string; paymentIntent?: string; amount?: number; deviceMacAddress?: string };
      if (!intentResponse.ok || !intentData.ok || !intentData.paymentIntent || !intentData.amount) {
        setPayError(intentData.error ?? "Could not start a secure payment checkout. Please try again.");
        return;
      }
      if (intentData.deviceMacAddress) setDeviceMacAddress(intentData.deviceMacAddress);
      const res = await hotspotPortalFetch(hotspotApiUrl("/api/mpesa/stk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneValue.trim(),
          amount: intentData.amount,
          plan_id: plan.id,
          ...(adminId ? { adminId } : {}),
          ...(portalScope.routerId ? { router_id: portalScope.routerId } : {}),
          ...(portalScope.portId ? { port_id: portalScope.portId } : {}),
          account_ref: portalBrand.ispName,
          paymentIntent: intentData.paymentIntent,
          ...(macAddress ? { mac_address: macAddress } : {}),
          ...(normalizedDeviceName ? { device_name: normalizedDeviceName } : {}),
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string; CheckoutRequestID?: string };
      if (!res.ok || !data.ok) setPayError(data.error ?? "Failed to send STK push. Please try again.");
      else {
        setStkSent(true);
        if (data.CheckoutRequestID) setCheckoutId(data.CheckoutRequestID);
      }
    } catch { setPayError("Could not reach the payment server. Please try again."); }
    finally { setPayLoading(false); }
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !phone.trim()) return;
    await startPayment({
      plan: selectedPlan,
      phoneValue: phone.trim(),
      macValue: deviceMacAddress,
      deviceNameValue: deviceName,
    });
  };

  const openTvDialog = () => {
    setTvDialogOpen(true);
    setTvDialogError("");
    const preferredDevice = savedTvDevices[0];
    setTvDeviceChoice(preferredDevice?.macAddress ?? "");
    setTvMacAddress(preferredDevice?.macAddress ?? "");
    setTvDeviceName(preferredDevice?.name ?? "");
    setRememberTvDevice(Boolean(preferredDevice));
    setTvDeviceSaveNotice("");
    setTvPlanId(selectedPlan ? String(selectedPlan.id) : plans[0] ? String(plans[0].id) : "");
    setTvPhone("");
  };

  const handleTvDeviceChoice = (value: string) => {
    setTvDeviceChoice(value);
    const device = savedTvDevices.find(item => item.macAddress === value)
      ?? tvDevices.find(item => item.macAddress === value);
    if (device) {
      setTvMacAddress(device.macAddress);
      setTvDeviceName(device.name);
      setRememberTvDevice(savedTvDevices.some(item => item.macAddress === value));
    } else {
      setTvMacAddress("");
      setTvDeviceName("");
      setRememberTvDevice(false);
    }
  };

  const handleUseSavedTvDevice = (device: SavedHotspotDevice) => {
    setTvDeviceChoice(device.macAddress);
    setTvMacAddress(device.macAddress);
    setTvDeviceName(device.name);
    setRememberTvDevice(true);
    setTvDialogError("");
  };

  const handleForgetSavedTvDevice = (device: SavedHotspotDevice) => {
    if (!forgetHotspotDevice(savedTvDevicesStorageKey, device.macAddress)) {
      setTvDialogError("This browser could not remove the saved TV. Check its storage settings and try again.");
      return;
    }
    setSavedTvDevices(readSavedHotspotDevices(savedTvDevicesStorageKey));
    if (normalizeMacAddress(tvMacAddress) === normalizeMacAddress(device.macAddress)) {
      setTvDeviceChoice("");
      setTvMacAddress("");
      setTvDeviceName("");
      setRememberTvDevice(false);
    }
  };

  const handleTvBindPay = async (e: React.FormEvent) => {
    e.preventDefault();
    const plan = plans.find(item => String(item.id) === tvPlanId);
    const macAddress = normalizeMacAddress(tvMacAddress);
    if (!plan) {
      setTvDialogError("Choose a package before continuing.");
      return;
    }
    if (!macAddress) {
      setTvDialogError("Enter a valid TV MAC address, for example AA:BB:CC:DD:EE:FF.");
      return;
    }
    if (!tvDeviceName.trim()) {
      setTvDialogError("Give the device a name so you can recognize it later.");
      return;
    }
    if (!tvPhone.trim()) {
      setTvDialogError("Enter the phone number that will receive the M-Pesa prompt.");
      return;
    }
    setActiveTab("tv");
    setPaymentMode("tv");
    setTvDialogOpen(false);
    await startPayment({
      plan,
      phoneValue: tvPhone.trim(),
      macValue: macAddress,
      deviceNameValue: tvDeviceName,
      deviceRouterId: tvDevices.find(item => item.macAddress === macAddress)?.routerId,
      targetDevice: true,
      rememberDevice: rememberTvDevice,
    });
  };

  const handleTabChange = (tab: Tab) => {
    if (stkSent) return;
    if (tab === "tv") {
      openTvDialog();
      return;
    }
    setActiveTab(tab);
    setSelectedPlan(null);
    setPhone("");
    setPayError(null);
    if (tab === "plans") setPaymentMode("data");
  };

  const selectPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    setPaymentMode(activeTab === "tv" ? "tv" : "data");
    setPhone("");
    setPayError(null);
  };

  type TroubleshootResult = {
    found: boolean;
    status: "active" | "depleted" | "expired" | "not_found" | "unavailable";
    connected: boolean;
    expiresAt: string | null;
    planName: string | null;
    username: string | null;
    error?: string;
  };

  const requestHotspotTroubleshoot = useCallback(async (action: "check" | "login", expiryOnly = false): Promise<TroubleshootResult | null> => {
    if (!adminId || !portalContext.mac) {
      setTroubleshootError("This hotspot page did not provide a device MAC address. Reopen the Wi-Fi sign-in page and try again.");
      return null;
    }
    try {
      const res = await hotspotPortalFetch(hotspotApiUrl("/api/customers/hotspot-troubleshoot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminId,
          action,
          ...(expiryOnly ? { expiry_only: true } : {}),
          ...(portalContext.ip ? { client_ip: portalContext.ip } : {}),
          mac_address: portalContext.mac,
        }),
      });
      const data = await res.json() as {
        ok?: boolean;
        found?: boolean;
        status?: "active" | "depleted" | "expired" | "not_found" | "unavailable";
        connected?: boolean;
        expiresAt?: string | null;
        planName?: string | null;
        username?: string | null;
        error?: string;
      };
      if (!res.ok && !data.status) {
        setTroubleshootError(data.error ?? "Could not verify the latest hotspot purchase.");
        return null;
      }
      const result: TroubleshootResult = {
        found: data.found === true,
        connected: data.connected === true,
        status: data.status === "active" || data.status === "depleted" || data.status === "expired" || data.status === "not_found"
          ? data.status
          : "unavailable",
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
        planName: typeof data.planName === "string" ? data.planName : null,
        username: typeof data.username === "string" ? data.username : null,
        error: data.error,
      };
      setLoginSession({
        found: result.found,
        status: result.status,
        connected: result.connected,
        expiresAt: result.expiresAt,
        planName: result.planName,
        username: result.username,
      });
      setTroubleshootError("");
      setTroubleshootMessage(
        result.status === "active" || result.status === "depleted" || result.status === "unavailable"
          ? result.error ?? ""
          : "",
      );
      if (action === "login" && result.connected) {
        setTroubleshootMessage("");
      }
      return result;
    } catch {
      setTroubleshootError("Could not reach the server. Please try again.");
      return null;
    }
  }, [adminId, portalContext.ip, portalContext.mac]);

  useEffect(() => {
    if (!loginSession || loginSession.status !== "active" || !loginSession.expiresAt) return;
    const expiry = Date.parse(loginSession.expiresAt);
    if (!Number.isFinite(expiry)) return;
    let timer = 0;
    const expireWhenDue = () => {
      const remaining = expiry - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(expireWhenDue, Math.min(remaining, 2_147_000_000));
        return;
      }
      setLoginSession(current =>
        current?.expiresAt === loginSession.expiresAt
          ? { ...current, status: "expired", connected: false }
          : current,
      );
    };
    expireWhenDue();
    return () => window.clearTimeout(timer);
  }, [loginSession?.expiresAt, loginSession?.status]);

  useEffect(() => {
    if (!accessReady || !paidAccessExpiresAt) return;
    const expiry = Date.parse(paidAccessExpiresAt);
    if (!Number.isFinite(expiry)) return;
    let timer = 0;
    const expireWhenDue = () => {
      const remaining = expiry - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(expireWhenDue, Math.min(remaining, 2_147_000_000));
        return;
      }
      setShowTvSuccess(false);
      setAccessReady(false);
      setPortalHandoffReady(false);
      setPaymentConfirmed(false);
      setStkSent(false);
      setCheckoutId(null);
      setActiveTab("plans");
      setLoginSession({
        found: true,
        status: "expired",
        connected: false,
        expiresAt: paidAccessExpiresAt,
        planName: selectedPlan?.name ?? null,
        username: hotspotCredentials?.username ?? null,
      });
    };
    expireWhenDue();
    return () => window.clearTimeout(timer);
  }, [accessReady, hotspotCredentials?.username, paidAccessExpiresAt, selectedPlan?.name]);

  const handleTroubleshoot = async () => {
    if (troubleshootInFlight.current) return;
    troubleshootInFlight.current = true;
    setTroubleshootLoading(true);
    setLoginSession(null);
    setTroubleshootMessage("");
    setTroubleshootError("");
    setTroubleshootAction("check");
    try {
      await requestHotspotTroubleshoot("check");
    } finally {
      troubleshootInFlight.current = false;
      setTroubleshootLoading(false);
      setTroubleshootAction(null);
    }
  };

  useEffect(() => {
    if (!troubleshootingOnly && (HOTSPOT_RUNTIME_CONFIG.previewOnly || !adminId || !portalContext.mac)) return;
    const lookupKey = `${adminId ?? "missing"}:${portalContext.mac || "missing"}`;
    if (autoTroubleshootKey.current === lookupKey) return;
    autoTroubleshootKey.current = lookupKey;
    troubleshootInFlight.current = true;
    if (troubleshootingOnly) {
      setTroubleshootLoading(true);
      setTroubleshootAction("check");
    }
    void requestHotspotTroubleshoot("check", !troubleshootingOnly).finally(() => {
      troubleshootInFlight.current = false;
      if (troubleshootingOnly) {
        setTroubleshootLoading(false);
        setTroubleshootAction(null);
      }
    });
  }, [troubleshootingOnly, adminId, portalContext.mac, requestHotspotTroubleshoot]);

  useEffect(() => {
    if (!troubleshootDialogOpen) return;
    let retryTimer = 0;
    const runCheck = () => {
      if (HOTSPOT_RUNTIME_CONFIG.previewOnly) {
        setTroubleshootError("Connection checks are available when this page is opened from an active hotspot device.");
        return;
      }
      if (!adminId || !portalContext.mac) {
        setTroubleshootError("This hotspot page did not provide a device MAC address. Reopen the Wi-Fi sign-in page and try again.");
        return;
      }
      if (troubleshootInFlight.current) {
        retryTimer = window.setTimeout(runCheck, 150);
        return;
      }
      troubleshootInFlight.current = true;
      setLoginSession(null);
      setTroubleshootLoading(true);
      setTroubleshootError("");
      setTroubleshootMessage("");
      setTroubleshootAction("check");
      void requestHotspotTroubleshoot("check").finally(() => {
        troubleshootInFlight.current = false;
        setTroubleshootLoading(false);
        setTroubleshootAction(null);
      });
    };
    runCheck();
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [troubleshootDialogOpen, adminId, portalContext.mac, requestHotspotTroubleshoot]);

  const handlePlanLogin = async () => {
    if (troubleshootInFlight.current) return;
    troubleshootInFlight.current = true;
    setTroubleshootLoading(true);
    setTroubleshootAction("login");
    setTroubleshootError("");
    try {
      const result = await requestHotspotTroubleshoot("login");
      if (result && result.status === "active" && !result.connected && !result.error) {
        setTroubleshootMessage("The router did not confirm the login. Tap Login now to retry.");
      }
    } finally {
      troubleshootInFlight.current = false;
      setTroubleshootLoading(false);
      setTroubleshootAction(null);
    }
  };

  const handleMpesaReconnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = mpesaMessage.trim();
    if (!message) return;
    setMpesaReconnectError("");
    setMpesaReconnectLoading(true);
    try {
      const res = await hotspotPortalFetch(hotspotApiUrl("/api/mpesa/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          ...(adminId ? { adminId } : {}),
          ...(deviceMacAddress ? { mac_address: deviceMacAddress } : {}),
          ...(portalContext.ip ? { client_ip: portalContext.ip } : {}),
        }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        credentials?: HotspotCredentials;
      };
      if (!res.ok || !data.ok || !data.credentials?.username || !data.credentials.password) {
        throw new Error(data.error || "That M-Pesa payment could not be matched to a hotspot account.");
      }
      setHotspotCredentials(data.credentials);
      storeHotspotCredentials(loginCredentialsStorageKey, data.credentials);
      setPortalHandoffReady(Boolean(portalContext.linkLogin || portalContext.linkOrig));
      setAccessReady(!portalContext.linkLogin && !portalContext.linkOrig);
      setTroubleshootMessage("Payment verified. Your hotspot sign-in is being restored.");
      setMpesaMessage("");
    } catch (error) {
      setMpesaReconnectError(error instanceof Error ? error.message : "Could not reconnect this M-Pesa payment.");
    } finally {
      setMpesaReconnectLoading(false);
    }
  };

  const mpesaReconnectCard = (
    <div className="hp-glass" style={{ marginTop: 16 }}>
      <div className="hp-glass-header">
        <div className="hp-glass-icon" style={{ background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)" }}>
          <Shield size={16} color="var(--isp-accent)" />
        </div>
        <div>
          <div className="hp-glass-title">Reconnect with M-Pesa</div>
          <div className="hp-glass-desc">We look up completed payments on your account and only reconnect the device registered to that purchase while its package is active.</div>
        </div>
      </div>
      <div className="hp-glass-body">
        <form onSubmit={handleMpesaReconnect}>
          <div className="hp-input-group">
            <label className="hp-label" htmlFor="mpesa-reconnect-message">M-Pesa confirmation message</label>
            <textarea
              id="mpesa-reconnect-message"
              className="hp-input hp-textarea"
              rows={4}
              maxLength={1000}
              placeholder="Paste the full confirmation message"
              value={mpesaMessage}
              onChange={event => { setMpesaMessage(event.target.value); setMpesaReconnectError(""); }}
              required
            />
          </div>
          {mpesaReconnectError && (
            <div className="hp-error" role="alert">
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {mpesaReconnectError}
            </div>
          )}
          <button type="submit" disabled={mpesaReconnectLoading} className="hp-btn hp-btn-ghost">
            {mpesaReconnectLoading
              ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Verifying payment...</>
              : <><Shield size={16} /> Verify and reconnect</>}
          </button>
        </form>
      </div>
    </div>
  );

  const [voucherCode, setVoucherCode] = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [voucherSuccess, setVoucherSuccess] = useState(false);
  const [voucherInfo, setVoucherInfo] = useState<Record<string, unknown> | null>(null);

  const handleVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoucherError(""); setVoucherLoading(true);
    try {
      const res = await hotspotPortalFetch(hotspotApiUrl("/api/vouchers/redeem"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(adminId ? { adminId } : {}), code: voucherCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) setVoucherError(data.error ?? "Voucher redemption failed");
      else { setVoucherInfo(data.voucher); setVoucherSuccess(true); }
    } catch { setVoucherError("Could not reach the server. Please try again."); }
    finally { setVoucherLoading(false); }
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "plans", label: "Buy Data", icon: <CreditCard size={16} /> },
    { id: "tv", label: "Buy for TV", icon: <Tv size={16} /> },
    { id: "voucher", label: "Voucher", icon: <Ticket size={16} /> },
  ];
  const visibleTabs = TABS.filter(tab => tab.id === "voucher" ? portalCards.voucher : portalCards.packages);
  const isTvMode = paymentMode === "tv";
  const voucherPlanName = voucherInfo?.plan_name == null ? "" : String(voucherInfo.plan_name);
  const voucherDuration = voucherInfo?.duration == null ? "" : String(voucherInfo.duration);
  const troubleshootStatus = loginSession
    ? {
        active: {
          label: "Plan active",
          detail: loginSession.expiresAt
            ? `Your plan is active and expires ${formatSessionExpiry(loginSession.expiresAt)}.`
            : "Your plan is active. No expiry time is recorded.",
        },
        expired: {
          label: "Plan expired",
          detail: `Your plan expired${loginSession.expiresAt ? ` on ${formatSessionExpiry(loginSession.expiresAt)}` : ""}. Renew a package to reconnect.`,
        },
        depleted: {
          label: "Data allowance used",
          detail: "Your package data allowance has been used. Purchase a new package to reconnect.",
        },
        not_found: {
          label: "No package found",
          detail: "No successfully purchased hotspot package matches this device MAC address.",
        },
        unavailable: {
          label: "Purchase needs help",
          detail: "A purchase was found, but its hotspot account could not be confirmed. Contact support.",
        },
      }[loginSession.status]
    : null;
  const troubleshootStatusTone = loginSession?.status === "active"
    ? "active"
    : loginSession?.status === "expired" || loginSession?.status === "depleted"
      ? "warning"
      : "help";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

        .hp-root {
          min-height: 100vh;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
           /* The portal uses a dark glass layout even when the admin app is
              in its light theme. Keep its contrast self-contained so plan
              names and prices do not render white-on-white. */
           background:
             radial-gradient(circle at 50% -10%, var(--isp-accent-glow), transparent 34%),
             radial-gradient(circle at 100% 70%, rgba(14,165,233,0.09), transparent 28%),
             #02090f;
          color: #fff;
          overflow-x: hidden;
          position: relative;
           isolation: isolate;
        }

         .hp-root::before {
           content: "";
           position: absolute; inset: 0; z-index: -1; pointer-events: none;
           opacity: 0.35;
           background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
             linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
           background-size: 42px 42px;
           mask-image: linear-gradient(to bottom, black, transparent 80%);
         }

         .hp-bg-orb {
           position: absolute; border-radius: 50%; filter: blur(2px);
           opacity: 0.6; pointer-events: none; z-index: -1;
           animation: float 7s ease-in-out infinite;
         }

        .hp-header {
          position: sticky; top: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
           padding: 0 max(20px, calc((100vw - 1120px) / 2)); height: 72px;
           background: rgba(3,11,20,0.72);
          backdrop-filter: blur(24px);
           border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .hp-logo { display: flex; align-items: center; gap: 12px; }
         .hp-logo-image { width: 128px; height: 54px; object-fit: contain; flex: 0 0 auto; display: block; }
        .hp-logo-sub { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 500; }

        .hp-status {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 14px; border-radius: 100px;
          background: rgba(52,211,153,0.1);
          border: 1px solid rgba(52,211,153,0.2);
          font-size: 12px; font-weight: 700; color: #34d399;
        }
        .hp-status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 10px #34d399;
        }

         .hp-main {
          position: relative; z-index: 1;
           max-width: 720px; margin: 0 auto;
           padding: 54px 20px 72px;
        }

         .hp-hero { text-align: center; margin-bottom: 32px; animation: fadeUp 0.5s ease-out; }

        .hp-wifi-wrap {
           position: relative; width: 104px; height: 104px;
           margin: 0 auto 24px;
        }
         .hp-wifi-wrap::before, .hp-wifi-wrap::after {
           content: ""; position: absolute; border: 1px solid var(--isp-accent-border);
           border-radius: 50%; inset: -12px; opacity: 0.55;
         }
         .hp-wifi-wrap::after { inset: -24px; opacity: 0.18; }
        .hp-wifi-box {
           width: 104px; height: 104px; border-radius: 30px;
           background: linear-gradient(145deg, var(--isp-accent-glow), rgba(14,165,233,0.12));
          border: 1.5px solid var(--isp-accent-border);
          display: flex; align-items: center; justify-content: center;
          position: relative; z-index: 2;
          animation: float 5s ease-in-out infinite;
        }

        .hp-title {
           font-size: clamp(34px, 7vw, 48px); font-weight: 900; color: #fff;
          letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 8px;
           background: linear-gradient(135deg, #fff 20%, #b9d9ff 80%);
           -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
         .hp-subtitle { max-width: 440px; margin: 0 auto 18px; font-size: 15px; color: rgba(255,255,255,0.52); font-weight: 500; line-height: 1.6; }

         .hp-badges { display: flex; justify-content: center; gap: 22px; flex-wrap: wrap; }
        .hp-badge {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: rgba(255,255,255,0.35); font-weight: 600;
        }

        .hp-tabs {
           display: flex; gap: 4px;
           background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 4px;
           margin-bottom: 22px;
          animation: fadeUp 0.5s 0.1s ease-out both;
           box-shadow: 0 16px 40px rgba(0,0,0,0.18);
        }
        .hp-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 11px 8px; border-radius: 10px;
          border: none; cursor: pointer;
           font-size: 12px; font-weight: 700;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: all 0.25s ease;
          background: transparent; color: rgba(255,255,255,0.35);
        }
        .hp-tab.active {
          background: var(--isp-accent);
          color: #fff;
        }
        .hp-tab:not(.active):hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }
         .hp-tab:disabled { cursor: not-allowed; opacity: 0.65; }

        .hp-section { animation: fadeUp 0.4s ease-out; }

        .hp-glass {
           background: linear-gradient(145deg, rgba(255,255,255,0.065), rgba(255,255,255,0.025));
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          overflow: hidden;
           box-shadow: 0 24px 70px rgba(0,0,0,0.16);
        }

        .hp-glass-header {
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; gap: 12px;
        }
        .hp-glass-icon {
          width: 36px; height: 36px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .hp-glass-title { font-size: 14px; font-weight: 700; color: #fff; }
        .hp-glass-desc { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 500; margin-top: 1px; }
        .hp-glass-body { padding: 20px; }

         .hp-purchase-hero {
           display: flex; align-items: center; justify-content: space-between; gap: 20px;
           padding: 22px; margin-bottom: 14px; border-radius: 20px;
           background: linear-gradient(135deg, var(--isp-accent-glow), rgba(14,165,233,0.05));
           border: 1px solid var(--isp-accent-border);
           color: #fff;
         }
         .hp-kicker {
           color: var(--isp-accent); font-size: 10px; font-weight: 800;
           text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 7px;
         }
         .hp-purchase-title { color: #fff; font-size: 22px; line-height: 1.2; font-weight: 850; margin-bottom: 7px; }
         .hp-purchase-copy { color: rgba(255,255,255,0.5); font-size: 12px; line-height: 1.6; max-width: 480px; }
         .hp-purchase-icon {
           width: 58px; height: 58px; flex: 0 0 58px; border-radius: 18px;
           display: flex; align-items: center; justify-content: center;
           color: var(--isp-accent); background: rgba(255,255,255,0.1);
           border: 1px solid rgba(255,255,255,0.12);
         }
         .hp-trust-row {
           display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px;
         }
         .hp-trust-item {
           display: flex; align-items: center; gap: 8px; min-width: 0;
           padding: 10px 11px; border-radius: 12px;
           color: rgba(255,255,255,0.48); background: rgba(255,255,255,0.03);
           border: 1px solid rgba(255,255,255,0.05); font-size: 11px; font-weight: 700;
         }
         .hp-trust-item svg { color: #34d399; flex-shrink: 0; }

         .hp-device-card {
           display: flex; align-items: center; gap: 10px; min-width: 0;
           padding: 11px 12px; margin-bottom: 14px; border-radius: 12px;
           background: rgba(14,165,233,0.06);
           border: 1px solid rgba(14,165,233,0.16);
         }
         .hp-device-icon {
           width: 32px; height: 32px; flex: 0 0 32px; border-radius: 9px;
           display: flex; align-items: center; justify-content: center;
           color: #67e8f9; background: rgba(14,165,233,0.12);
         }
         .hp-device-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
         .hp-device-kicker {
           color: rgba(255,255,255,0.38); font-size: 9px; font-weight: 800;
           letter-spacing: 0.12em; text-transform: uppercase;
         }
         .hp-device-copy strong {
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
           color: #fff; font-family: 'JetBrains Mono', 'Fira Code', monospace;
           font-size: 12px; letter-spacing: 0.04em;
         }
         .hp-device-copy small { color: rgba(255,255,255,0.34); font-size: 10px; }
         .hp-device-state {
           display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
           flex: 0 0 auto; color: #34d399; font-size: 10px; font-weight: 800;
         }
         .hp-tv-trigger {
           display: inline-flex; align-items: center; justify-content: center; gap: 8px;
           margin-top: 14px; padding: 11px 16px; border-radius: 11px;
           border: 1px solid var(--isp-accent-border); background: var(--isp-accent-glow);
           color: #fff; font: 800 12px 'Plus Jakarta Sans', sans-serif; cursor: pointer;
           transition: transform .2s ease, background .2s ease;
         }
         .hp-tv-trigger:hover { transform: translateY(-1px); background: var(--isp-accent-border); }
         .hp-modal-backdrop {
           position: fixed; inset: 0; z-index: 100; display: flex; align-items: center;
           justify-content: center; padding: 18px; background: rgba(0,5,12,.78);
           backdrop-filter: blur(12px);
         }
         .hp-tv-modal {
           width: min(100%, 520px); max-height: min(760px, calc(100vh - 36px)); overflow: auto;
           border: 1px solid rgba(255,255,255,.12); border-radius: 22px;
           background: linear-gradient(145deg, #0b1a29, #07111d);
           box-shadow: 0 30px 90px rgba(0,0,0,.5); color: #fff;
         }
          @keyframes hp-troubleshoot-drift {
            0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
            50% { transform: translate3d(-10px, 12px, 0) scale(1.08); }
          }
          @keyframes hp-troubleshoot-sheen {
            0%, 48%, 100% { transform: translateX(-180%) rotate(18deg); }
            70% { transform: translateX(440%) rotate(18deg); }
          }
          @keyframes hp-troubleshoot-modal-in {
            from { opacity: 0; transform: translate(-50%, -46%) scale(.96); }
            to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
          @keyframes hp-troubleshoot-modal-out {
            from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            to { opacity: 0; transform: translate(-50%, -46%) scale(.96); }
          }
          @keyframes hp-troubleshoot-overlay-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .hp-troubleshoot-card {
            position: relative; isolation: isolate; overflow: hidden;
            display: flex; align-items: center; justify-content: space-between; gap: 18px;
            padding: 20px; margin-top: 14px;
            border: 1px solid var(--isp-accent-border);
            border-radius: 28px 15px 28px 15px;
            background: linear-gradient(125deg, rgba(9,31,48,.96), rgba(7,17,29,.96) 60%, rgba(9,29,34,.96));
            box-shadow: 0 20px 48px rgba(0,0,0,.22), inset 0 1px rgba(255,255,255,.05);
          }
          .hp-troubleshoot-card::before {
            content: ""; position: absolute; z-index: -1; inset: -55%;
            pointer-events: none; opacity: .58;
            background:
              radial-gradient(ellipse at 25% 38%, var(--isp-accent-glow), transparent 42%),
              radial-gradient(ellipse at 72% 65%, rgba(52,211,153,.13), transparent 38%);
            animation: hp-troubleshoot-drift 9s ease-in-out infinite;
          }
          .hp-troubleshoot-card::after {
            content: ""; position: absolute; z-index: 0; top: -70%; bottom: -70%; left: 0;
            width: 28%; pointer-events: none;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent);
            animation: hp-troubleshoot-sheen 9s ease-in-out infinite;
          }
          .hp-troubleshoot-card-copy {
            position: relative; z-index: 1; display: flex; align-items: center; gap: 14px; min-width: 0;
          }
          .hp-troubleshoot-card-icon {
            display: grid; place-items: center; flex: 0 0 46px; width: 46px; height: 46px;
            border: 1px solid var(--isp-accent-border);
            border-radius: 16px 9px 16px 9px;
            color: var(--isp-accent); background: rgba(255,255,255,.07);
            box-shadow: 0 8px 24px var(--isp-accent-glow);
          }
          .hp-troubleshoot-eyebrow {
            margin-bottom: 4px; color: var(--isp-accent); font-size: 9px; font-weight: 900;
            letter-spacing: .16em; text-transform: uppercase;
          }
          .hp-troubleshoot-card h3 { margin: 0 0 5px; color: #fff; font-size: 14px; font-weight: 800; }
          .hp-troubleshoot-card p { max-width: 340px; margin: 0; color: rgba(255,255,255,.53); font-size: 11px; line-height: 1.55; }
          .hp-troubleshoot-card-action {
            position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center;
            flex: 0 0 auto; gap: 8px; min-height: 42px; padding: 0 15px;
            border: 1px solid rgba(255,255,255,.14); border-radius: 13px 8px 13px 8px;
            color: #fff; background: linear-gradient(135deg, var(--isp-accent), rgba(14,165,233,.76));
            box-shadow: 0 8px 22px var(--isp-accent-glow);
            font: 800 11px 'Plus Jakarta Sans', sans-serif; cursor: pointer;
            transition: transform .2s ease, filter .2s ease, box-shadow .2s ease;
          }
          .hp-troubleshoot-card-action:hover:not(:disabled) {
            transform: translateY(-2px); filter: brightness(1.08);
            box-shadow: 0 12px 26px var(--isp-accent-glow);
          }
          .hp-troubleshoot-card-action:focus-visible,
          .hp-troubleshoot-modal-action:focus-visible,
          .hp-troubleshoot-close:focus-visible {
            outline: 2px solid #fff; outline-offset: 3px;
          }
          .hp-troubleshoot-card-action:disabled { opacity: .55; cursor: not-allowed; }
          .hp-troubleshoot-overlay {
            position: fixed; inset: 0; z-index: 200;
            background: rgba(0,5,12,.76); backdrop-filter: blur(13px);
            animation: hp-troubleshoot-overlay-in .22s ease-out both;
          }
          .hp-troubleshoot-dialog {
            position: fixed; top: 50%; left: 50%; z-index: 201;
            width: min(520px, calc(100vw - 32px)); max-height: min(780px, calc(100dvh - 32px));
            overflow: hidden; outline: none; color: #fff;
            border: 1px solid rgba(255,255,255,.13);
            border-radius: 30px 17px 30px 17px;
            background: linear-gradient(145deg, #0c1c2a 0%, #07111d 58%, #0a191b 100%);
            box-shadow: 0 34px 110px rgba(0,0,0,.64), 0 0 50px var(--isp-accent-glow);
            transform: translate(-50%, -50%);
          }
          .hp-troubleshoot-dialog[data-state="open"] { animation: hp-troubleshoot-modal-in .28s cubic-bezier(.2,.8,.2,1) both; }
          .hp-troubleshoot-dialog[data-state="closed"] { animation: hp-troubleshoot-modal-out .18s ease-in both; }
          .hp-troubleshoot-dialog-ambient {
            position: absolute; z-index: 0; top: -110px; right: -95px; width: 290px; height: 290px;
            border-radius: 42% 58% 63% 37% / 45% 42% 58% 55%;
            background:
              radial-gradient(ellipse at 35% 35%, var(--isp-accent-glow), transparent 66%),
              radial-gradient(ellipse at 70% 70%, rgba(52,211,153,.15), transparent 54%);
            filter: blur(5px); pointer-events: none;
            animation: hp-troubleshoot-drift 8s ease-in-out infinite;
          }
          .hp-troubleshoot-dialog-inner {
            position: relative; z-index: 1; max-height: min(780px, calc(100dvh - 32px));
            overflow-y: auto; overscroll-behavior: contain; padding: 27px;
          }
          .hp-troubleshoot-dialog-head {
            display: flex; align-items: flex-start; gap: 13px; padding-right: 36px; margin-bottom: 19px;
          }
          .hp-troubleshoot-dialog-icon {
            display: grid; place-items: center; flex: 0 0 46px; width: 46px; height: 46px;
            border: 1px solid var(--isp-accent-border); border-radius: 17px 10px 17px 10px;
            color: var(--isp-accent); background: var(--isp-accent-glow);
          }
          .hp-troubleshoot-dialog-kicker {
            margin: 1px 0 5px; color: var(--isp-accent); font-size: 9px; font-weight: 900;
            letter-spacing: .17em; text-transform: uppercase;
          }
          .hp-troubleshoot-dialog-title { margin: 0 0 6px; color: #fff; font-size: 20px; font-weight: 850; letter-spacing: -.02em; }
          .hp-troubleshoot-dialog-description { max-width: 380px; color: rgba(255,255,255,.5); font-size: 11px; line-height: 1.55; }
          .hp-troubleshoot-close {
            position: absolute; z-index: 2; top: 16px; right: 16px;
            display: grid; place-items: center; width: 34px; height: 34px;
            border: 1px solid rgba(255,255,255,.1); border-radius: 12px 7px 12px 7px;
            color: rgba(255,255,255,.7); background: rgba(255,255,255,.055); cursor: pointer;
            transition: color .2s ease, background .2s ease;
          }
          .hp-troubleshoot-close:hover { color: #fff; background: rgba(255,255,255,.12); }
          .hp-troubleshoot-device {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            padding: 10px 12px; margin-bottom: 14px;
            border: 1px solid rgba(255,255,255,.075); border-radius: 12px 8px 12px 8px;
            background: rgba(255,255,255,.035);
          }
          .hp-troubleshoot-device-label { color: rgba(255,255,255,.4); font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
          .hp-troubleshoot-device strong { overflow: hidden; color: rgba(255,255,255,.83); font: 700 11px 'JetBrains Mono', monospace; text-overflow: ellipsis; white-space: nowrap; }
          .hp-troubleshoot-status {
            padding: 16px; border: 1px solid rgba(255,255,255,.1);
            border-radius: 20px 11px 20px 11px; background: rgba(255,255,255,.035);
          }
          .hp-troubleshoot-status[data-tone="active"] { border-color: rgba(52,211,153,.24); background: linear-gradient(145deg, rgba(16,185,129,.1), rgba(255,255,255,.025)); }
          .hp-troubleshoot-status[data-tone="warning"] { border-color: rgba(245,158,11,.22); background: linear-gradient(145deg, rgba(245,158,11,.09), rgba(255,255,255,.025)); }
          .hp-troubleshoot-status[data-tone="help"] { border-color: rgba(248,113,113,.2); background: linear-gradient(145deg, rgba(239,68,68,.08), rgba(255,255,255,.025)); }
          .hp-troubleshoot-status-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
          .hp-troubleshoot-status-heading strong { color: #fff; font-size: 13px; font-weight: 850; }
          .hp-troubleshoot-status-mark {
            display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px;
            border-radius: 11px 7px 11px 7px; color: #fca5a5; background: rgba(239,68,68,.1);
          }
          .hp-troubleshoot-status[data-tone="active"] .hp-troubleshoot-status-mark { color: #6ee7b7; background: rgba(52,211,153,.11); }
          .hp-troubleshoot-status[data-tone="warning"] .hp-troubleshoot-status-mark { color: #fcd34d; background: rgba(245,158,11,.11); }
          .hp-troubleshoot-status-copy { margin: 0; color: rgba(255,255,255,.6); font-size: 11px; line-height: 1.6; }
          .hp-troubleshoot-session-meta {
            display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 13px;
          }
          .hp-troubleshoot-session-meta > div {
            min-width: 0; padding: 10px 11px; border: 1px solid rgba(255,255,255,.07);
            border-radius: 12px 8px 12px 8px; background: rgba(255,255,255,.035);
          }
          .hp-troubleshoot-session-meta span { display: block; margin-bottom: 5px; color: rgba(255,255,255,.35); font-size: 8px; font-weight: 900; letter-spacing: .11em; text-transform: uppercase; }
          .hp-troubleshoot-session-meta strong { display: block; overflow: hidden; color: rgba(255,255,255,.8); font-size: 10px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
          .hp-troubleshoot-note {
            padding: 10px 12px; margin-top: 10px; border: 1px solid rgba(255,255,255,.07);
            border-radius: 11px 7px 11px 7px; color: rgba(255,255,255,.56);
            background: rgba(255,255,255,.035); font-size: 10px; line-height: 1.55;
          }
          .hp-troubleshoot-error {
            display: flex; align-items: flex-start; gap: 9px; padding: 13px;
            border: 1px solid rgba(248,113,113,.2); border-radius: 14px 9px 14px 9px;
            color: #fecaca; background: rgba(239,68,68,.08); font-size: 11px; line-height: 1.55;
          }
          .hp-troubleshoot-loading {
            display: grid; justify-items: center; gap: 12px; padding: 27px 14px;
            border: 1px solid rgba(255,255,255,.08); border-radius: 20px 11px 20px 11px;
            color: rgba(255,255,255,.62); background: rgba(255,255,255,.035); font-size: 11px;
          }
          .hp-troubleshoot-loading-icon {
            display: grid; place-items: center; width: 48px; height: 48px;
            border: 1px solid var(--isp-accent-border); border-radius: 17px 10px 17px 10px;
            color: var(--isp-accent); background: var(--isp-accent-glow);
          }
          .hp-troubleshoot-modal-actions { display: flex; gap: 9px; margin-top: 15px; }
          .hp-troubleshoot-modal-action {
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 42px; padding: 0 14px; border: 1px solid rgba(255,255,255,.12);
            border-radius: 13px 8px 13px 8px; color: #fff; background: rgba(255,255,255,.06);
            font: 800 11px 'Plus Jakarta Sans', sans-serif; cursor: pointer; transition: transform .2s ease, background .2s ease;
          }
          .hp-troubleshoot-modal-action:hover:not(:disabled) { transform: translateY(-1px); background: rgba(255,255,255,.11); }
          .hp-troubleshoot-modal-action:disabled { opacity: .55; cursor: not-allowed; }
          .hp-troubleshoot-modal-action.primary {
            flex: 1; border-color: var(--isp-accent-border);
            background: linear-gradient(135deg, var(--isp-accent), rgba(14,165,233,.76));
          }
          .hp-troubleshoot-modal-footnote { margin-top: 13px; color: rgba(255,255,255,.34); font-size: 9px; line-height: 1.55; text-align: center; }
         .hp-tv-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:22px 22px 16px; border-bottom:1px solid rgba(255,255,255,.07); }
         .hp-tv-modal-head h3 { font-size:18px; font-weight:850; margin-bottom:5px; }
         .hp-tv-modal-head p { color:rgba(255,255,255,.46); font-size:12px; line-height:1.5; }
         .hp-tv-modal-close { border:0; background:rgba(255,255,255,.06); color:rgba(255,255,255,.7); width:32px; height:32px; border-radius:9px; cursor:pointer; font-size:20px; line-height:1; }
         .hp-tv-modal-body { padding:20px 22px 22px; }
         .hp-tv-field { margin-bottom:15px; }
         .hp-tv-label { display:block; margin-bottom:7px; color:rgba(255,255,255,.56); font-size:11px; font-weight:800; letter-spacing:.04em; }
         .hp-tv-select, .hp-tv-input { width:100%; border:1px solid rgba(255,255,255,.1); border-radius:11px; padding:12px 13px; color:#fff; background:rgba(255,255,255,.055); font:600 13px 'Plus Jakarta Sans', sans-serif; outline:none; }
         .hp-tv-select:focus, .hp-tv-input:focus { border-color:var(--isp-accent-border); box-shadow:0 0 0 3px var(--isp-accent-glow); }
         .hp-tv-select option { color:#0b1420; background:#fff; }
         .hp-tv-help { margin-top:6px; color:rgba(255,255,255,.3); font-size:10px; line-height:1.45; }
         .hp-tv-device-list { display:grid; gap:7px; margin-top:9px; max-height:130px; overflow:auto; }
         .hp-tv-device-row { display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:10px; background:rgba(52,211,153,.06); border:1px solid rgba(52,211,153,.14); }
         .hp-tv-device-row strong { display:block; font-size:11px; color:#fff; }
         .hp-tv-device-row span { display:block; margin-top:2px; color:rgba(255,255,255,.42); font:10px monospace; }
         .hp-tv-device-actions { margin-left:auto; display:flex; gap:6px; }
         .hp-tv-device-action { border:1px solid rgba(255,255,255,.14); border-radius:7px; padding:5px 8px; color:rgba(255,255,255,.76); background:rgba(255,255,255,.06); font:600 10px 'Plus Jakarta Sans',sans-serif; cursor:pointer; }
         .hp-tv-device-action:hover { background:rgba(255,255,255,.12); }
         .hp-tv-save-device { display:flex; align-items:flex-start; gap:9px; padding:11px 12px; border-radius:10px; background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.08); cursor:pointer; }
         .hp-tv-save-device input { margin:2px 0 0; accent-color:#34d399; }
         .hp-tv-save-device strong { display:block; color:rgba(255,255,255,.82); font-size:11px; }
         .hp-tv-save-device span { color:rgba(255,255,255,.42); font-size:10px; line-height:1.45; }
         .hp-tv-saved-notice { color:#a7f3d0 !important; font-size:12px !important; margin-top:10px !important; }
         .hp-tv-actions { display:flex; gap:9px; margin-top:20px; }
         .hp-tv-actions .hp-btn { flex:1; }
         .hp-tv-cancel { background:rgba(255,255,255,.06); color:rgba(255,255,255,.65); border:1px solid rgba(255,255,255,.1); box-shadow:none; }

        .hp-plans-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          margin-bottom: 16px;
        }
        .hp-plans-grid.has-expanded {
          grid-template-columns: 1fr;
        }

        .hp-plan {
          position: relative; padding: 0; border: none; cursor: pointer;
          border-radius: 16px; overflow: hidden;
          text-align: left; font-family: 'Plus Jakarta Sans', sans-serif;
          color: #fff; transition: all 0.3s ease;
           background: rgba(255,255,255,0.045);
          border: 1.5px solid rgba(255,255,255,0.07);
           box-shadow: 0 10px 28px rgba(0,0,0,0.1);
        }
        .hp-plan:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.12); }
        .hp-plan.expanded { grid-column: 1 / -1; cursor: default; }
        .hp-plan.expanded:hover { transform: none; }
        .hp-plan.collapsed { display: none; }

        .hp-plan-accent { height: 4px; }
        .hp-plan-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0; cursor: pointer; }
        .hp-plan-body { padding: 6px 16px 16px; }

        .hp-plan-name {
          font-size: 10px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.08em; margin-bottom: 6px; opacity: 0.9;
        }
        .hp-plan-price {
          font-size: 30px; font-weight: 900; line-height: 1;
          margin-bottom: 12px; color: #fff;
        }
        .hp-plan-price span { font-size: 12px; font-weight: 500; opacity: 0.5; }

        .hp-plan-meta { display: flex; flex-direction: column; gap: 5px; }
        .hp-plan-meta-row {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.55);
        }
         .hp-plan-action {
           display: flex; align-items: center; justify-content: space-between;
           margin-top: 16px; padding-top: 12px;
           border-top: 1px solid rgba(255,255,255,0.06);
           color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 700;
         }
         .hp-plan-action svg { color: rgba(255,255,255,0.55); transition: transform 0.2s ease; }
         .hp-plan:hover .hp-plan-action svg { transform: translate(2px, -2px); color: #fff; }

        .hp-plan-check {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .hp-plan-pay {
          margin-top: 14px; padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,0.06);
          animation: fadeUp 0.3s ease-out;
        }
        .hp-plan-pay .hp-input {
          background: rgba(0,0,0,0.2);
          border-color: rgba(255,255,255,0.1);
        }
        .hp-plan-change {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; color: rgba(255,255,255,0.4);
          font-size: 12px; font-weight: 600; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          padding: 0; margin-top: 10px;
          transition: color 0.2s;
        }
        .hp-plan-change:hover { color: rgba(255,255,255,0.7); }

        .hp-input-group { margin-bottom: 14px; }
        .hp-label {
          display: block; font-size: 12px; font-weight: 700;
          color: rgba(255,255,255,0.5); margin-bottom: 7px;
        }
        .hp-input-wrap { position: relative; }
        .hp-input-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: rgba(255,255,255,0.25); pointer-events: none;
        }
        .hp-input {
          width: 100%; padding: 13px 16px;
          background: rgba(255,255,255,0.05);
          border: 1.5px solid rgba(255,255,255,0.08);
          border-radius: 12px; color: #fff;
          font-size: 14px; font-weight: 600;
          font-family: 'Plus Jakarta Sans', sans-serif;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .hp-input:focus {
          border-color: var(--isp-accent-border);
          box-shadow: 0 0 0 4px var(--isp-accent-glow);
        }
        .hp-input::placeholder { color: rgba(255,255,255,0.2); font-weight: 500; }
        .hp-input-left { padding-left: 42px; }
        .hp-input-phone { padding-left: 62px; }
        .hp-textarea { min-height: 104px; resize: vertical; line-height: 1.5; }

        .hp-btn {
          width: 100%; padding: 14px; border: none; border-radius: 12px;
          font-size: 14px; font-weight: 800;
          font-family: 'Plus Jakarta Sans', sans-serif;
          cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.25s ease;
        }
        .hp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .hp-btn:not(:disabled):hover { transform: translateY(-1px); }

        .hp-btn-mpesa {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: #fff; box-shadow: 0 4px 24px rgba(22,163,74,0.35);
        }
        .hp-btn-primary {
          background: var(--isp-accent);
          color: #fff; box-shadow: 0 4px 24px var(--isp-accent-border);
        }
        .hp-btn-voucher {
          background: linear-gradient(135deg, #f59e0b, #f97316);
          color: #fff; box-shadow: 0 4px 24px rgba(245,158,11,0.3);
        }
        .hp-btn-ghost {
          background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6);
          box-shadow: none; border: 1px solid rgba(255,255,255,0.08);
        }
        .hp-btn-disabled {
          background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.2);
          cursor: not-allowed; box-shadow: none;
        }

        .hp-error {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 11px 14px; border-radius: 12px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.15);
          font-size: 13px; color: #fca5a5; font-weight: 500;
          margin-bottom: 14px;
        }

        .hp-plan-inline-meta {
          display: flex; align-items: center; gap: 14px;
          flex-wrap: wrap;
        }
        .hp-plan-inline-meta .hp-plan-meta-row { flex-direction: row; }

        .hp-success { text-align: center; padding: 32px 20px; animation: fadeUp 0.4s ease-out; }
        .hp-success-icon {
          width: 72px; height: 72px; border-radius: 50%;
          background: rgba(52,211,153,0.1); border: 2px solid rgba(52,211,153,0.25);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          box-shadow: 0 0 32px rgba(52,211,153,0.15);
        }
        .hp-success h3 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
        .hp-success p { color: rgba(255,255,255,0.45); font-size: 14px; margin-bottom: 6px; }

        .hp-tv-success-screen {
          position: fixed; inset: 0; z-index: 10000;
          display: grid; place-items: center; padding: 24px;
          background: radial-gradient(circle at 50% 35%, rgba(139,90,43,0.2), transparent 42%), #100d0a;
          color: #fff; text-align: center;
        }
        .hp-tv-success-card {
          width: min(100%, 460px); position: relative; overflow: hidden;
          padding: 42px 28px 30px; border-radius: 24px;
          background: linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.025));
          border: 1px solid rgba(173,121,69,0.34);
          box-shadow: 0 28px 90px rgba(0,0,0,0.5);
        }
        .hp-tv-watermark {
          position: absolute; left: 50%; top: 24px; transform: translateX(-50%);
          white-space: nowrap; color: rgba(167,112,59,0.16);
          font-size: clamp(15px, 5vw, 25px); font-weight: 900; letter-spacing: 0.16em;
          pointer-events: none;
        }
        .hp-tv-success-icon {
          width: 76px; height: 76px; display: grid; place-items: center;
          margin: 20px auto 22px; border-radius: 50%;
          background: rgba(147,96,48,0.16); border: 1px solid rgba(182,127,72,0.48);
          color: #c89057; box-shadow: 0 0 44px rgba(147,96,48,0.2);
        }
        .hp-tv-success-brand {
          margin: 0 0 9px; color: #bd8957; font-size: 10px; font-weight: 900;
          letter-spacing: 0.2em;
        }
        .hp-tv-success-card h1 { margin: 0 0 10px; font-size: clamp(28px, 7vw, 38px); font-weight: 850; }
        .hp-tv-success-card p { color: rgba(255,255,255,0.62); font-size: 14px; line-height: 1.6; }
        .hp-tv-success-card .hp-tv-expiry { margin: 8px 0 22px; color: rgba(255,255,255,0.42); font-size: 12px; }
        .hp-tv-success-card .hp-tv-dismiss {
          min-width: 130px; padding: 11px 20px; border-radius: 12px;
          border: 1px solid rgba(182,127,72,0.45); background: rgba(147,96,48,0.2);
          color: #f2d7b8; font: inherit; font-weight: 750; cursor: pointer;
        }

        .hp-secured {
          display: flex; align-items: center; justify-content: center; gap: 5px;
          margin-top: 14px; font-size: 11px; color: rgba(255,255,255,0.2); font-weight: 500;
        }

        .hp-footer {
           text-align: center; margin-top: 38px;
          font-size: 11px; color: rgba(255,255,255,0.15); font-weight: 500;
        }

        .hp-connected-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2);
          border-radius: 100px; padding: 5px 14px; margin-bottom: 24px;
          font-size: 12px; font-weight: 700; color: #34d399;
        }

        .hp-voucher-hint {
          padding: 18px; border-radius: 14px;
          background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.1);
          text-align: center; margin-bottom: 16px;
        }

        .hp-voucher-input {
          text-align: center; font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 20px; letter-spacing: 0.15em; font-weight: 700;
          color: #fbbf24; padding: 16px;
          border-color: rgba(245,158,11,0.15);
        }
        .hp-voucher-input:focus { border-color: rgba(245,158,11,0.4); box-shadow: 0 0 0 4px rgba(245,158,11,0.08); }

        @media (max-width: 400px) {
          .hp-plans-grid { grid-template-columns: 1fr; }
          .hp-plan-price { font-size: 26px; }
          .hp-title { font-size: 26px; }
        }
         @media (max-width: 560px) {
           .hp-header { padding: 0 14px; }
           .hp-logo-sub { display: none; }
           .hp-status { padding: 6px 10px; }
           .hp-main { padding: 42px 14px 56px; }
           .hp-tabs { gap: 2px; }
           .hp-tab { padding: 10px 4px; font-size: 10px; gap: 4px; }
           .hp-tab svg { width: 14px; height: 14px; }
           .hp-purchase-hero { padding: 18px; }
           .hp-purchase-title { font-size: 19px; }
           .hp-purchase-icon { width: 48px; height: 48px; flex-basis: 48px; border-radius: 15px; }
           .hp-trust-row { grid-template-columns: 1fr; }
            .hp-device-state { display: none; }
            .hp-troubleshoot-card { align-items: stretch; flex-direction: column; }
            .hp-troubleshoot-card-action { width: 100%; }
            .hp-troubleshoot-dialog-inner { padding: 23px 18px 20px; }
            .hp-troubleshoot-modal-actions { flex-direction: column; }
            .hp-troubleshoot-modal-action { width: 100%; }
         }
          @media (prefers-reduced-motion: reduce) {
            .hp-troubleshoot-card::before, .hp-troubleshoot-card::after,
            .hp-troubleshoot-dialog-ambient { animation: none !important; }
            .hp-troubleshoot-dialog[data-state="open"],
            .hp-troubleshoot-dialog[data-state="closed"],
            .hp-troubleshoot-overlay { animation: none !important; }
            .hp-troubleshoot-card-action:hover:not(:disabled),
            .hp-troubleshoot-modal-action:hover:not(:disabled) { transform: none; }
          }
      ${HOSTED_PORTAL_LAYOUT_CSS}
      `}</style>

      <div className="hp-root" data-portal-layout={portalBranding.portalLayout ?? HOTSPOT_RUNTIME_CONFIG.portalLayout}>
        {showTvSuccess && paymentMode === "tv" && accessReady && (
          <div className="hp-tv-success-screen" role="status" aria-live="polite">
            <div className="hp-tv-success-card">
              <div className="hp-tv-watermark" aria-hidden="true">OCHOLASUPERNET</div>
              <div className="hp-tv-success-icon"><CheckCircle2 size={38} strokeWidth={1.8} /></div>
              <p className="hp-tv-success-brand">OCHOLASUPERNET</p>
              <h1>You’re logged in.</h1>
              <p>{deviceName || "Your TV"} is connected to the hotspot.</p>
              {selectedPlan && <p>Package: <strong>{selectedPlan.name}</strong></p>}
              {paidAccessExpiresAt && (
                <p className="hp-tv-expiry">Access expires {formatSessionExpiry(paidAccessExpiresAt)}.</p>
              )}
              {tvDeviceSaveNotice && <p className="hp-tv-saved-notice">{tvDeviceSaveNotice}</p>}
              <button className="hp-tv-dismiss" onClick={() => setShowTvSuccess(false)}>Done</button>
            </div>
          </div>
        )}
        {/* Ambient background orbs */}
        <div className="hp-bg-orb" style={{ width: 400, height: 400, top: -100, left: -100, background: "var(--isp-accent-glow)" }} />
        <div className="hp-bg-orb" style={{ width: 350, height: 350, bottom: -80, right: -80, background: "var(--isp-accent-glow)", animationDelay: "4s" }} />
        <div className="hp-bg-orb" style={{ width: 250, height: 250, top: "40%", left: "60%", background: "rgba(236,72,153,0.06)", animationDelay: "2s" }} />

        {/* Header */}
        {portalCards.header && (
          <header className="hp-header">
            <div className="hp-logo">
              <img className="hp-logo-image" src={portalBranding.logoUrl || DEFAULT_HOTSPOT_LOGO_URL} alt={portalBrand.ispName} />
              <div>
                <div className="hp-logo-sub">{portalBrand.domain}</div>
              </div>
            </div>
            <div className="hp-status">
              <span className="hp-status-dot" />
              Online
            </div>
          </header>
        )}

        {/* Main */}
        <main className="hp-main">
          {/* Hero */}
          {portalCards.hero && (
            <div className="hp-hero">
              <div className="hp-wifi-wrap">
                <div className="hp-wifi-box">
                  <Wifi size={36} color="var(--isp-accent)" strokeWidth={2} />
                </div>
              </div>
              <h1 className="hp-title">{troubleshootingOnly ? "Connection help" : "Your world, connected."}</h1>
              <p className="hp-subtitle">{troubleshootingOnly
                ? "Check your package and router session, then retry the connection if needed."
                : portalBranding.tagline || `Fast, reliable internet for your phone, home and TV — powered by ${portalBrand.ispName}.`}</p>
              <div className="hp-badges">
                <span className="hp-badge"><Shield size={12} /> Secure</span>
                <span className="hp-badge"><Zap size={12} /> Instant</span>
                <span className="hp-badge"><Clock size={12} /> 24/7</span>
              </div>
            </div>
          )}

          {!troubleshootingOnly && portalCards.expiryNotice && (loginSession?.status === "expired" || loginSession?.status === "depleted") && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                maxWidth: 840,
                margin: "0 auto 20px",
                padding: "16px 18px",
                borderRadius: 14,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.32)",
                color: "rgba(255,255,255,0.92)",
              }}
            >
              <AlertCircle size={20} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong style={{ display: "block", color: "#fcd34d", marginBottom: 4 }}>
                  {loginSession.status === "expired" ? "Your package has expired" : "Your package data allowance has been used"}
                </strong>
                <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 1.5 }}>
                  {loginSession.status === "expired"
                    ? `Your hotspot session has ended${loginSession.expiresAt ? ` on ${formatSessionExpiry(loginSession.expiresAt)}` : ""}. Choose a new package below to sign in again.`
                    : "Your hotspot session has ended because the package data allowance was used. Choose a new package below to reconnect."}
                </p>
                <button
                  type="button"
                  className="hp-troubleshoot-modal-action primary"
                  style={{ marginTop: 12 }}
                  onClick={() => document.getElementById("hp-plan-tabs")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  <CreditCard size={15} /> Sign in again with a package
                </button>
              </div>
            </div>
          )}

          {troubleshootingOnly ? (
            <section className="hp-section" style={{ maxWidth: 540, margin: "0 auto" }}>
              <button
                type="button"
                className="hp-troubleshoot-modal-action"
                style={{ marginBottom: 14 }}
                onClick={() => window.location.assign(`/hotspot-login${window.location.search}`)}
              >
                <ArrowRight size={15} style={{ transform: "rotate(180deg)" }} /> Back to packages
              </button>

              <div className="hp-glass">
                <div className="hp-glass-header">
                  <div className="hp-troubleshoot-dialog-icon" aria-hidden="true"><Wifi size={21} /></div>
                  <div>
                    <div className="hp-glass-title">Connection check</div>
                    <div className="hp-glass-desc">We’ll check this device’s latest package and router session.</div>
                  </div>
                </div>
                <div className="hp-glass-body">
                  <div className="hp-troubleshoot-device">
                    <span className="hp-troubleshoot-device-label">Checking this device</span>
                    <strong>{portalContext.mac || "Device MAC unavailable"}</strong>
                  </div>

                  {troubleshootLoading ? (
                    <div className="hp-troubleshoot-loading" role="status" aria-live="polite">
                      <span className="hp-troubleshoot-loading-icon">
                        <Loader2 size={21} style={{ animation: "spin 1s linear infinite" }} />
                      </span>
                      <span>{troubleshootAction === "login" ? "Asking the router to log in…" : "Checking your package and router…"}</span>
                    </div>
                  ) : troubleshootError ? (
                    <div className="hp-troubleshoot-error" role="alert">
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{troubleshootError}</span>
                    </div>
                  ) : troubleshootStatus && loginSession ? (
                    <div className="hp-troubleshoot-result" role="status" aria-live="polite">
                      <div className="hp-troubleshoot-status" data-tone={troubleshootStatusTone}>
                        <div className="hp-troubleshoot-status-heading">
                          <span className="hp-troubleshoot-status-mark" aria-hidden="true">
                            {loginSession.status === "active" && loginSession.connected
                              ? <CheckCircle2 size={17} />
                              : <AlertCircle size={17} />}
                          </span>
                          <strong>{loginSession.connected ? "Connected" : troubleshootStatus.label}</strong>
                        </div>
                        {loginSession.planName && (
                          <p className="hp-troubleshoot-status-copy" style={{ marginBottom: 4 }}>
                            Package: <strong>{loginSession.planName}</strong>
                          </p>
                        )}
                        <p className="hp-troubleshoot-status-copy">{troubleshootStatus.detail}</p>
                        {loginSession.status === "active" && (
                          <div className="hp-troubleshoot-session-meta">
                            {loginSession.username && (
                              <div><span>Hotspot account</span><strong>{loginSession.username}</strong></div>
                            )}
                            <div><span>Router session</span><strong>{loginSession.connected ? "Confirmed" : "Login required"}</strong></div>
                          </div>
                        )}
                        {troubleshootMessage && <div className="hp-troubleshoot-note">{troubleshootMessage}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="hp-troubleshoot-note" role="status">
                      The connection check result will appear here.
                    </div>
                  )}

                  <div className="hp-troubleshoot-modal-actions">
                    {loginSession?.status === "active" && !loginSession.connected && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={handlePlanLogin}
                        disabled={troubleshootLoading}
                      >
                        {troubleshootLoading
                          ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Logging in…</>
                          : <><Wifi size={15} /> Login now</>}
                      </button>
                    )}
                    {(loginSession?.status === "expired" || loginSession?.status === "depleted" || loginSession?.status === "not_found") && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={() => window.location.assign(`/hotspot-login${window.location.search}`)}
                      >
                        <CreditCard size={15} /> Browse packages
                      </button>
                    )}
                    <button
                      type="button"
                      className="hp-troubleshoot-modal-action"
                      onClick={handleTroubleshoot}
                      disabled={troubleshootLoading}
                    >
                      {troubleshootLoading
                        ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Checking…</>
                        : <><ArrowRight size={15} /> Check again</>}
                    </button>
                  </div>
                  <p className="hp-troubleshoot-modal-footnote">Package details are matched to this device’s MAC address.</p>
                </div>
              </div>

              {portalCards.paymentRecovery && mpesaReconnectCard}
            </section>
          ) : (
            <>
          {/* Tabs */}
          {visibleTabs.length > 0 && (
          <div className="hp-tabs" id="hp-plan-tabs">
            {visibleTabs.map(tab => (
               <button key={tab.id} onClick={() => handleTabChange(tab.id)} disabled={stkSent}
                 className={`hp-tab${activeTab === tab.id ? " active" : ""}`} aria-pressed={activeTab === tab.id}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          )}

          {/* ── BUY DATA ── */}
           {portalCards.packages && (activeTab === "plans" || activeTab === "tv") && (
            <div className="hp-section">
              {stkSent ? (
                <div className="hp-glass">
                  <div className="hp-success">
                    {paymentConfirmed ? (
                      <>
                        <div className="hp-success-icon">
                          <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                        </div>
                          <h3>{accessReady ? (isTvMode ? "TV is ready to stream!" : "Device connected!") : portalHandoffReady ? "Connecting your device…" : "Payment Confirmed"}</h3>
                         <p>Your payment of <strong style={{ color: "#fff" }}>{getCurrencySymbol()} {selectedPlan?.price}</strong> has been received.</p>
                          <p style={{ fontSize: 12, marginBottom: 8 }}>{accessReady ? (isTvMode ? "Your TV session was confirmed by the hotspot." : "Your device has been authorized by the hotspot. Use the credentials below for the next sign-in.") : portalHandoffReady ? "Your package is ready. Finishing hotspot sign-in now." : "Your payment is confirmed, but the hotspot still needs to be updated."}</p>
                          {hotspotCredentials && (
                            <div style={{ display: "grid", gap: 8, textAlign: "left", margin: "0 auto 16px", maxWidth: 320 }}>
                              <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: ".08em" }}>Username</div>
                                <strong style={{ color: "#fff", fontSize: 14 }}>{hotspotCredentials.username}</strong>
                              </div>
                              <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: ".08em" }}>Password</div>
                                <strong style={{ color: "#fff", fontSize: 14 }}>{hotspotCredentials.password}</strong>
                              </div>
                            </div>
                          )}
                        <div className="hp-connected-badge" style={{ marginTop: 16, marginBottom: 24 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                            {accessReady ? "Connected" : portalHandoffReady ? "Connecting" : "Payment received"}
                        </div>
                          {!accessReady && payError && (
                            <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 16 }}>{payError}</p>
                          )}
                        {mpesaStatus?.shortcode && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16 }}>
                            Daraja shortcode: {mpesaStatus.shortcode} {mpesaStatus.env === "sandbox" ? "(Sandbox)" : ""}
                          </p>
                        )}
                        <button className="hp-btn hp-btn-ghost" disabled={accessRetrying || portalHandoffReady} style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => {
                            const destination = portalContext.linkOrig || portalContext.linkLogin;
                            if (accessReady && isTvMode) {
                              setShowTvSuccess(true);
                              return;
                            }
                            if (accessReady && /^https?:\/\//i.test(destination)) window.location.assign(destination);
                            else if (checkoutId && !accessRetrying) { bindingInFlight.current = true; void bindPaidHotspotAccess(checkoutId, true); }
                          }}>
                          {accessReady ? (isTvMode ? "Show login confirmation" : "Continue online") : portalHandoffReady ? "Connecting…" : accessRetrying ? "Retrying connection…" : "Retry connection"}
                        </button>
                      </>
                    ) : paymentFailed ? (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "2px solid rgba(245,158,11,0.22)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <AlertCircle size={30} color="#fbbf24" strokeWidth={2} />
                        </div>
                        <h3>Payment Not Completed</h3>
                        <p>The M-Pesa prompt was cancelled or declined. No payment was confirmed and your plan has not been activated.</p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 20 }}>Check M-Pesa before retrying if you believe the amount was deducted.</p>
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          Try Again
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--isp-accent-glow)", border: "2px solid var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1.5s linear infinite" }} />
                        </div>
                        <h3>{payError ? "Connecting your device" : "Waiting for Payment"}</h3>
                        <p>An STK push has been sent to <strong style={{ color: "#fff" }}>{phone}</strong></p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 13, marginBottom: 4 }}>
                          Enter your PIN on your phone to pay <strong style={{ color: "#34d399" }}>{getCurrencySymbol()} {selectedPlan?.price}</strong>
                        </p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
                          {mpesaStatus?.shortcode && <>Daraja shortcode: {mpesaStatus.shortcode} &middot; </>}
                          {mpesaStatus?.env === "sandbox" ? "Sandbox Mode" : "Live Payment"}
                        </p>
                        {pollTimedOut ? (
                          <div style={{ padding: 14, borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", marginBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, textAlign: "center" }}>
                            <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                            <p style={{ margin: 0 }}>Payment not confirmed yet. If you already entered your PIN, it may take a moment to process.</p>
                            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Try again or contact support if the amount was deducted.</p>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 24, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                            <Loader2 size={12} style={{ animation: "spin 2s linear infinite" }} />
                            Checking payment status...
                          </div>
                        )}
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                           onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          {pollTimedOut ? "Try Again" : "Cancel & Start Over"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                   ) : (
                <>
                   <div className="hp-purchase-hero">
                     <div>
                       <div className="hp-kicker">{isTvMode ? "TV CONNECT" : "HOTSPOT ACCESS"}</div>
                       <h2 className="hp-purchase-title">{isTvMode ? "Bring streaming to life." : "Pick your perfect plan."}</h2>
                       <p className="hp-purchase-copy">{isTvMode ? "Choose a plan for your smart TV or streaming device. Pay from your phone and connect instantly." : "Simple packages, instant activation, and no contracts. Choose a plan and get online in seconds."}</p>
                     </div>
                     <div className="hp-purchase-icon">
                       {isTvMode ? <Tv size={27} strokeWidth={1.8} /> : <Sparkles size={27} strokeWidth={1.8} />}
                     </div>
                   </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                      <button type="button" className="hp-tv-trigger" onClick={openTvDialog}>
                        <Tv size={15} /> Connect to TV
                      </button>
                    </div>
                   <div className="hp-trust-row">
                     <div className="hp-trust-item"><CheckCircle2 size={14} /> Instant access</div>
                     <div className="hp-trust-item"><Shield size={14} /> Secure payment</div>
                     <div className="hp-trust-item"><Zap size={14} /> No contracts</div>
                   </div>
                  {plansLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                      <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  ) : plans.length === 0 ? (
                    <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: "48px 0", fontSize: 14 }}>
                      No plans available at the moment.
                    </p>
                  ) : (
                    <div className={`hp-plans-grid${selectedPlan ? " has-expanded" : ""}`}>
                      {plans.map((plan, i) => {
                        const grad = PLAN_GRADIENTS[i % PLAN_GRADIENTS.length];
                        const isExpanded = selectedPlan?.id === plan.id;
                        const isCollapsed = selectedPlan && !isExpanded;
                        const dataLimitLabel = formatDataLimit(plan);
                        return (
                          <div key={plan.id}
                            className={`hp-plan${isExpanded ? " expanded" : ""}${isCollapsed ? " collapsed" : ""}`}
                            style={isExpanded ? { borderColor: grad.light + "44", boxShadow: `0 4px 32px ${grad.light}15` } : {}}>

                            <div className="hp-plan-accent" style={{ background: grad.bg }} />

                            {isExpanded ? (
                              <div className="hp-plan-body">
                                <div className="hp-plan-top" onClick={() => setSelectedPlan(null)} style={{ padding: 0, marginBottom: 4 }}>
                                  <div>
                                    <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                    <div className="hp-plan-price" style={{ marginBottom: 6 }}>
                                      <span>{getCurrencySymbol()} </span>{plan.price}
                                    </div>
                                  </div>
                                  <div className="hp-plan-check" style={{ background: grad.bg }}>
                                    <CheckCircle2 size={12} color="#fff" strokeWidth={3} />
                                  </div>
                                </div>
                                <div className="hp-plan-inline-meta" style={{ marginBottom: 0 }}>
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                  {dataLimitLabel && (
                                    <div className="hp-plan-meta-row">
                                      <Database size={12} color={grad.light} /> {dataLimitLabel}
                                    </div>
                                  )}
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>

                                <div className="hp-plan-pay">
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      {isPaymentMethodReady(mpesaStatus)
                                        ? <Phone size={14} color="#22c55e" />
                                        : <AlertCircle size={14} color="#f59e0b" />}
                                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                                        {isPaymentMethodReady(mpesaStatus)
                                          ? `${isTvMode ? "Pay for TV with" : "Pay with"} ${checkoutPaymentLabel(mpesaStatus?.paymentGateway ?? "")}`
                                          : paymentStatusLoaded ? "Online payment unavailable" : "Checking payment options…"}
                                      </span>
                                    </div>
                                    {mpesaStatus && isPaymentMethodReady(mpesaStatus) && (
                                      <span style={{
                                        fontSize: 10, fontWeight: 700,
                                        padding: "3px 8px", borderRadius: 6,
                                          background: "rgba(52,211,153,0.1)",
                                          color: "#34d399",
                                          border: "1px solid rgba(52,211,153,0.2)",
                                      }}>
                                         {mpesaStatus.env === "sandbox" ? "SANDBOX" : "LIVE"}
                                      </span>
                                    )}
                                  </div>

                                  {!paymentStatusLoaded ? (
                                    <div style={{
                                      padding: 14, borderRadius: 10, textAlign: "center",
                                      background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
                                      fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
                                    }}>
                                      Checking available payment methods…
                                    </div>
                                  ) : !isPaymentMethodReady(mpesaStatus) ? (
                                    <div style={{
                                      padding: 14, borderRadius: 10, textAlign: "center",
                                      background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
                                      fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
                                    }}>
                                      <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                                       <p style={{ margin: 0 }}>No connected online payment method is currently available for this service.</p>
                                       <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Please contact the network administrator for payment options.</p>
                                    </div>
                                  ) : (
                                    <form onSubmit={handlePay}>
                                      <div className="hp-input-group">
                                        <div className="hp-input-wrap">
                                          <span className="hp-input-icon" style={{ fontSize: 13, fontWeight: 700, left: 14 }}>+254</span>
                                          <input className="hp-input hp-input-phone" type="tel"
                                            placeholder="7XX XXX XXX" required
                                            value={phone} onChange={e => setPhone(e.target.value)} />
                                        </div>
                                      </div>

                                      {payError && (
                                        <div className="hp-error">
                                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                          {payError}
                                        </div>
                                      )}

                                       <button type="submit" disabled={payLoading} className="hp-btn hp-btn-mpesa">
                                        {payLoading ? (
                                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Sending STK Push...</>
                                        ) : (
                                           <><Phone size={16} /> Pay {getCurrencySymbol()} {plan.price}{isTvMode ? " for TV" : ""}</>
                                        )}
                                      </button>
                                    </form>
                                  )}

                                     <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                                    <div className="hp-secured" style={{ margin: 0 }}>
                                      <Shield size={11} />
                                      {isPaymentMethodReady(mpesaStatus)
                                        ? mpesaStatus?.paymentGateway === "bank_stk_push"
                                          ? <>Bank STK Push &middot; Safaricom Daraja</>
                                          : mpesaStatus?.paymentGateway === "mpesa_till_push" && mpesaStatus.hasTillNumber
                                            ? <>Buy Goods &amp; Services Till &middot; Safaricom Daraja</>
                                            : mpesaStatus?.shortcode
                                              ? <>Daraja shortcode {mpesaStatus.shortcode} &middot; Safaricom Daraja</>
                                              : <>Secured by Safaricom M-Pesa</>
                                        : paymentStatusLoaded
                                          ? <>No connected payment method</>
                                          : <>Checking payment methods</>}
                                    </div>
                                      <button className="hp-plan-change" onClick={() => { setSelectedPlan(null); setPhone(""); setPayError(null); }}>
                                      <ArrowRight size={12} style={{ transform: "rotate(180deg)" }} /> Change plan
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                             <div className="hp-plan-body" onClick={() => selectPlan(plan)} style={{ cursor: "pointer" }}>
                                <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                <div className="hp-plan-price">
                                  <span>{getCurrencySymbol()} </span>{plan.price}
                                </div>
                                <div className="hp-plan-meta">
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                  {dataLimitLabel && (
                                    <div className="hp-plan-meta-row">
                                      <Database size={12} color={grad.light} /> {dataLimitLabel}
                                    </div>
                                  )}
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>
                                 <div className="hp-plan-action">
                                   <span>{isTvMode ? "Choose for TV" : "Choose plan"}</span>
                                   <ArrowUpRight size={15} />
                                 </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── VOUCHER ── */}
          {portalCards.voucher && activeTab === "voucher" && (
            <div className="hp-section">
              <div className="hp-glass">
                <div className="hp-glass-header">
                  <div className="hp-glass-icon" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    <Ticket size={16} color="#fbbf24" />
                  </div>
                  <div>
                    <div className="hp-glass-title">Redeem Voucher</div>
                    <div className="hp-glass-desc">Enter your voucher code below</div>
                  </div>
                </div>
                <div className="hp-glass-body">
                  {voucherSuccess ? (
                    <div className="hp-success">
                      <div className="hp-success-icon">
                        <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                      </div>
                      <h3>Voucher Activated!</h3>
                      {voucherPlanName && (
                        <p>Plan: <strong style={{ color: "#fff" }}>{voucherPlanName}</strong></p>
                      )}
                      {voucherDuration && (
                        <p style={{ marginBottom: 16 }}>Duration: <strong style={{ color: "#fff" }}>{voucherDuration}</strong></p>
                      )}
                      <div className="hp-connected-badge">
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                        Connected
                      </div>
                      <br />
                      <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                        onClick={() => { setVoucherSuccess(false); setVoucherCode(""); setVoucherInfo(null); }}>
                        Redeem Another
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleVoucher}>
                      <div className="hp-voucher-hint">
                        <Ticket size={20} color="#fbbf24" style={{ marginBottom: 6 }} />
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
                          Enter the code from your voucher card
                        </p>
                      </div>

                      {voucherError && (
                        <div className="hp-error">
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {voucherError}
                        </div>
                      )}

                      <div className="hp-input-group">
                        <input className="hp-input hp-voucher-input" type="text"
                          placeholder="XXXX-XXXX-XXXX" required
                          value={voucherCode} onChange={e => setVoucherCode(e.target.value.toUpperCase())} />
                      </div>

                      <button type="submit" disabled={voucherLoading} className="hp-btn hp-btn-voucher">
                        {voucherLoading ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Validating...</>
                        ) : (
                          <><ArrowRight size={16} /> Activate Voucher</>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {portalCards.connectionSupport && (
          <div className="hp-troubleshoot-card" style={{ maxWidth: 840, margin: "14px auto 12px" }}>
            <div className="hp-troubleshoot-card-copy">
              <div className="hp-troubleshoot-card-icon" aria-hidden="true"><Wifi size={20} /></div>
              <div>
                <div className="hp-troubleshoot-eyebrow">Connection support</div>
                <h3>Having trouble connecting?</h3>
                <p>Check your package and router session, then retry sign-in if needed.</p>
              </div>
            </div>
            <button
              ref={troubleshootTriggerRef}
              type="button"
              className="hp-troubleshoot-card-action"
              aria-haspopup="dialog"
              aria-expanded={troubleshootDialogOpen}
              onClick={() => setTroubleshootDialogOpen(true)}
            >
              <Wifi size={15} /> Troubleshoot connection <ArrowRight size={15} />
            </button>
          </div>
          )}

          {portalCards.paymentRecovery && (
            <div style={{ maxWidth: 840, margin: "0 auto 20px" }}>
              {mpesaReconnectCard}
            </div>
          )}

          {portalCards.connectionSupport && troubleshootDialogOpen && (
            <div
              className="hp-troubleshoot-overlay"
              role="presentation"
              onMouseDown={event => {
                if (event.target === event.currentTarget) setTroubleshootDialogOpen(false);
              }}
            >
              <div
                ref={troubleshootDialogRef}
                className="hp-troubleshoot-dialog"
                data-state="open"
                role="dialog"
                aria-modal="true"
                aria-labelledby="hp-troubleshoot-dialog-title"
                aria-describedby="hp-troubleshoot-dialog-description"
                tabIndex={-1}
              >
                <div className="hp-troubleshoot-dialog-ambient" aria-hidden="true" />
                <button
                  type="button"
                  className="hp-troubleshoot-close"
                  aria-label="Close troubleshooting"
                  onClick={() => setTroubleshootDialogOpen(false)}
                >
                  ×
                </button>
                <div className="hp-troubleshoot-dialog-inner">
                  <div className="hp-troubleshoot-dialog-head">
                    <div className="hp-troubleshoot-dialog-icon" aria-hidden="true"><Wifi size={21} /></div>
                    <div>
                      <div className="hp-troubleshoot-dialog-kicker">Connection assistant</div>
                      <h2 id="hp-troubleshoot-dialog-title" className="hp-troubleshoot-dialog-title">Troubleshoot connection</h2>
                      <p id="hp-troubleshoot-dialog-description" className="hp-troubleshoot-dialog-description">
                        Check this device’s latest package and see whether the router confirmed access.
                      </p>
                    </div>
                  </div>

                  <div className="hp-troubleshoot-device">
                    <span className="hp-troubleshoot-device-label">Checking this device</span>
                    <strong>{portalContext.mac || "Device MAC unavailable"}</strong>
                  </div>

                  {troubleshootLoading ? (
                    <div className="hp-troubleshoot-loading" role="status" aria-live="polite">
                      <span className="hp-troubleshoot-loading-icon">
                        <Loader2 size={21} style={{ animation: "spin 1s linear infinite" }} />
                      </span>
                      <span>{troubleshootAction === "login" ? "Asking the router to log in…" : "Checking your package and router…"}</span>
                    </div>
                  ) : troubleshootError ? (
                    <div className="hp-troubleshoot-error" role="alert">
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{troubleshootError}</span>
                    </div>
                  ) : troubleshootStatus && loginSession ? (
                    <div className="hp-troubleshoot-result" role="status" aria-live="polite">
                      <div className="hp-troubleshoot-status" data-tone={troubleshootStatusTone}>
                        <div className="hp-troubleshoot-status-heading">
                          <span className="hp-troubleshoot-status-mark" aria-hidden="true">
                            {loginSession.status === "active" && loginSession.connected
                              ? <CheckCircle2 size={17} />
                              : <AlertCircle size={17} />}
                          </span>
                          <strong>{loginSession.connected ? "Connected" : troubleshootStatus.label}</strong>
                        </div>
                        {loginSession.planName && (
                          <p className="hp-troubleshoot-status-copy" style={{ marginBottom: 4 }}>
                            Package: <strong>{loginSession.planName}</strong>
                          </p>
                        )}
                        <p className="hp-troubleshoot-status-copy">{troubleshootStatus.detail}</p>
                        {loginSession.status === "active" && (
                          <div className="hp-troubleshoot-session-meta">
                            {loginSession.username && (
                              <div><span>Hotspot account</span><strong>{loginSession.username}</strong></div>
                            )}
                            <div><span>Router session</span><strong>{loginSession.connected ? "Confirmed" : "Login required"}</strong></div>
                          </div>
                        )}
                        {troubleshootMessage && <div className="hp-troubleshoot-note">{troubleshootMessage}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="hp-troubleshoot-note" role="status">
                      {troubleshootMessage || "The connection check result will appear here."}
                    </div>
                  )}

                  <div className="hp-troubleshoot-modal-actions">
                    {loginSession?.status === "active" && !loginSession.connected && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={handlePlanLogin}
                        disabled={troubleshootLoading}
                      >
                        {troubleshootLoading
                          ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Logging in…</>
                          : <><Wifi size={15} /> Login now</>}
                      </button>
                    )}
                    {(loginSession?.status === "expired" || loginSession?.status === "depleted" || loginSession?.status === "not_found") && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={() => {
                          setTroubleshootDialogOpen(false);
                          window.setTimeout(() => document.getElementById("hp-plan-tabs")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
                        }}
                      >
                        <CreditCard size={15} /> Browse packages
                      </button>
                    )}
                    <button
                      type="button"
                      className="hp-troubleshoot-modal-action"
                      onClick={handleTroubleshoot}
                      disabled={troubleshootLoading}
                    >
                      {troubleshootLoading
                        ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Checking…</>
                        : <><ArrowRight size={15} /> Check again</>}
                    </button>
                  </div>
                  <p className="hp-troubleshoot-modal-footnote">Package details are matched to this device’s MAC address.</p>
                </div>
              </div>
            </div>
          )}

          {tvDialogOpen && (
            <div className="hp-modal-backdrop" role="presentation">
              <div className="hp-tv-modal" role="dialog" aria-modal="true" aria-labelledby="connect-tv-title">
                <div className="hp-tv-modal-head">
                  <div>
                    <h3 id="connect-tv-title">Connect to TV</h3>
                    <p>Add a TV or streaming device, choose its package, and pay securely with M-Pesa.</p>
                  </div>
                  <button type="button" className="hp-tv-modal-close" onClick={() => setTvDialogOpen(false)} aria-label="Close">×</button>
                </div>
                <form className="hp-tv-modal-body" onSubmit={handleTvBindPay}>
                  {savedTvDevices.length > 0 && (
                    <div className="hp-tv-field">
                      <label className="hp-tv-label">SAVED ON THIS BROWSER</label>
                      <div className="hp-tv-device-list" aria-label="Saved devices on this browser">
                        {savedTvDevices.map(device => (
                          <div className="hp-tv-device-row" key={`saved-${device.macAddress}`}>
                            <Tv size={14} color="#34d399" />
                            <div>
                              <strong>{device.name}</strong>
                              <span>{device.macAddress}</span>
                            </div>
                            <div className="hp-tv-device-actions">
                              <button
                                type="button"
                                className="hp-tv-device-action"
                                onClick={() => handleUseSavedTvDevice(device)}
                              >
                                Use
                              </button>
                              <button
                                type="button"
                                className="hp-tv-device-action"
                                onClick={() => handleForgetSavedTvDevice(device)}
                              >
                                Forget
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hp-tv-help">Saved devices stay in this browser and can be removed here.</div>
                    </div>
                  )}

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-connected-device">CONNECTED DEVICES</label>
                    <select
                      id="tv-connected-device"
                      className="hp-tv-select"
                      value={tvDeviceChoice}
                      onChange={e => handleTvDeviceChoice(e.target.value)}
                    >
                      <option value="">Add a TV manually</option>
                      {savedTvDevices.map(device => (
                        <option key={`saved-option-${device.macAddress}`} value={device.macAddress}>
                          {device.name} — {device.macAddress} · Saved
                        </option>
                      ))}
                      {tvDevices.filter(device => !savedTvDevices.some(saved => saved.macAddress === device.macAddress)).map(device => (
                        <option key={`${device.routerId}-${device.macAddress}`} value={device.macAddress}>
                          {device.name} — {device.macAddress}{device.address ? ` · ${device.address}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="hp-tv-help">
                      {tvDevicesLoading
                        ? "Checking the connected devices on your hotspot router…"
                        : tvDevices.length > 0
                         ? "Every device reported by the router is listed with its MAC address. Select one or add a TV manually."
                         : "No devices were reported by the router. Add the TV MAC address manually."}
                    </div>
                    {!tvDevicesLoading && tvDevices.length > 0 && (
                      <div className="hp-tv-device-list" aria-label="Available connected devices">
                        {tvDevices.map(device => (
                          <div className="hp-tv-device-row" key={`device-${device.routerId}-${device.macAddress}`}>
                            <Tv size={14} color="#34d399" />
                            <div>
                              <strong>{device.name}</strong>
                              <span>{device.macAddress}{device.address ? ` · ${device.address}` : ""}{device.routerName ? ` · ${device.routerName}` : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-mac-address">DEVICE MAC ADDRESS</label>
                    <input
                      id="tv-mac-address"
                      className="hp-tv-input"
                      value={tvMacAddress}
                      onChange={e => {
                        const value = e.target.value.toUpperCase();
                        const macAddress = normalizeMacAddress(value);
                        setTvMacAddress(value);
                        setTvDeviceChoice(savedTvDevices.some(device => device.macAddress === macAddress)
                          || tvDevices.some(device => device.macAddress === macAddress)
                          ? macAddress
                          : "");
                        setRememberTvDevice(savedTvDevices.some(device => device.macAddress === macAddress));
                      }}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      inputMode="text"
                      autoCapitalize="characters"
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-device-name">DEVICE NAME</label>
                    <input
                      id="tv-device-name"
                      className="hp-tv-input"
                      value={tvDeviceName}
                      onChange={e => setTvDeviceName(e.target.value)}
                      placeholder="e.g. Living Room TV"
                      maxLength={64}
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-save-device">
                      <input
                        type="checkbox"
                        checked={rememberTvDevice}
                        onChange={e => setRememberTvDevice(e.target.checked)}
                      />
                      <span>
                        <strong>Remember this TV on this browser</strong>
                        Saved devices stay on this browser only. You can remove them at any time.
                      </span>
                    </label>
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-package">PACKAGE TO PURCHASE</label>
                    <select
                      id="tv-package"
                      className="hp-tv-select"
                      value={tvPlanId}
                      onChange={e => setTvPlanId(e.target.value)}
                      required
                    >
                      <option value="" disabled>Choose a package</option>
                      {plans.map(plan => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — {getCurrencySymbol()} {plan.price} · {formatValidity(plan)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-phone">PHONE NUMBER</label>
                    <input
                      id="tv-phone"
                      className="hp-tv-input"
                      type="tel"
                      value={tvPhone}
                      onChange={e => setTvPhone(e.target.value)}
                      placeholder="7XX XXX XXX"
                      inputMode="tel"
                      required
                    />
                    <div className="hp-tv-help">The M-Pesa payment prompt will be sent to this number.</div>
                  </div>

                  {tvDialogError && (
                    <div className="hp-error" role="alert">
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {tvDialogError}
                    </div>
                  )}

                  <div className="hp-tv-actions">
                    <button type="button" className="hp-btn hp-tv-cancel" onClick={() => setTvDialogOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="hp-btn hp-btn-mpesa" disabled={payLoading || plansLoading}>
                      {payLoading ? (
                        <><Loader2 size={16} style={{ animation: "spin 1.5s linear infinite" }} /> Starting…</>
                      ) : (
                        <><Tv size={16} /> Bind &amp; Pay</>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {portalCards.deviceIdentity && (
            <div style={{ padding: "0 0 16px", textAlign: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
                Your MAC address:
                <strong style={{ color: "rgba(255,255,255,0.78)", fontFamily: "monospace", fontWeight: 700 }}>
                  {deviceMacAddress || "Resolved by router"}
                </strong>
              </span>
            </div>
          )}
          {portalCards.footer && (
            <div className="hp-footer">
              {new Date().getFullYear()} {portalBrand.ispName} &middot; {portalBrand.domain}
            </div>
          )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
