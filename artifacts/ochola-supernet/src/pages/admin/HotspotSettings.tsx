import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useBrand } from "@/context/BrandContext";
import { useDashboardPreferences } from "@/context/DashboardPreferencesContext";
import {
  PORTAL_BACKGROUND_OPTIONS,
  PORTAL_PACKAGE_SHAPE_OPTIONS,
  type PortalBackground,
  type PortalPackageShape,
} from "@/lib/dashboard-preferences";
import {
  DEFAULT_HOTSPOT_LOGO_URL,
  DEFAULT_HOTSPOT_PORTAL_CARDS,
  HOTSPOT_PORTAL_CARD_OPTIONS,
  normalizeHotspotPortalCards,
  type HotspotPortalCardKey,
  type HotspotPortalCardVisibility,
} from "@/lib/hotspot-portal-cards";
import {
  HOTSPOT_PORTAL_LAYOUTS,
  normalizeHotspotPortalLayout,
  renderStaticPortalLayoutCss,
  type HotspotPortalLayout,
} from "@/lib/hotspot-layouts";
import {
  supabase,
  ADMIN_ID as AUTH_ADMIN_ID,
  getAdminApiToken,
  getAdminRole,
  getSelectedTenantId,
} from "@/lib/supabase";
import type { DbRouter } from "@/lib/supabase";
import { installHotspotFiles } from "@/lib/router-hotspot-files";
import {
  hotspotPortalTargets,
  nextHotspotPortalTarget,
  usesGeneratedHotspotPortal,
} from "@/lib/hotspot-portal-target";
import {
  hotspotApiOriginFromTenantContext,
  resolveHotspotPortalApiOrigin,
} from "@/lib/hotspot-portal-origin";
import {
  AlertCircle, ArrowDownToLine, Check, ChevronDown, CircleHelp, Eye, FolderOpen,
  Image, Info, LayoutTemplate, Link2, Loader2, Mail, Palette, Phone,
  Save, ShieldCheck, Smartphone, Sparkles, Trash2, Upload, Wifi, X,
} from "lucide-react";

const PUBLIC_BASE_DOMAIN = "isplatty.org";

const DEFAULT_COLORS = {
  bgColor: "#0d0415",
  bgColor2: "#1a0735",
  primaryColor: "#8b5cf6",
  accentColor: "#d946ef",
  cardColor: "#1a0f2e",
  buttonColor: "#10b981",
  textColor: "#ffffff",
  inputBgColor: "#000000",
};

type ColorSettings = typeof DEFAULT_COLORS;

interface HSettings {
  ispName: string;
  portalHostname: string;
  freeTrial: string;
  vouchers: string;
  tagline: string;
  routerId: string;
  advertPos: string;
  enableAdvert: string;
  mpesaPrompt: string;
  testimonials: string;
  faqSection: string;
  logoUrl: string;
  advertUrl: string;
  announcement: string;
  paymentInstructions: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  termsUrl: string;
  privacyUrl: string;
  maintenanceMode: string;
  maintenanceMessage: string;
  testimonialText: string;
  faqText: string;
  portalCards: HotspotPortalCardVisibility;
  portalLayout: HotspotPortalLayout;
  colors: ColorSettings;
}

type AssignedHotspotPort = {
  id: number;
  router_id: number;
  vlan_tag?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  assigned_reseller_id?: number | null;
  nas_identifier?: string | null;
  hotspot_server_name?: string | null;
  interface_name: string;
  bridge_name?: string | null;
  hotspot_enabled: boolean;
  hotspot_template_path?: string | null;
  hotspot_folder_path?: string | null;
  hotspot_dns_name?: string | null;
  pppoe_enabled: boolean;
  pppoe_folder_path?: string | null;
  pppoe_dns_name?: string | null;
  subnet_range?: string | null;
  bandwidth_cap_mbps: number;
  reseller_bandwidth_cap?: number | null;
  status: string;
  provisioning_error?: string | null;
};

type AssignedHotspotPortDraft = {
  hotspotEnabled: boolean;
  hotspotFolderPath: string;
  hotspotDnsName: string;
  pppoeEnabled: boolean;
  pppoeFolderPath: string;
  pppoeDnsName: string;
  bridgeName: string;
  subnetRange: string;
  bandwidthCapMbps: string;
  nasIdentifier: string;
};

function adminApiHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getAdminApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const role = localStorage.getItem("ochola_admin_role") || "isp_admin";
    const tenantId = getSelectedTenantId();
    if (role === "superadmin" && tenantId) headers.set("X-Impersonated-Admin-Id", String(tenantId));
  } catch {
    /* The API still enforces tenant ownership from the signed-in session. */
  }
  return headers;
}

async function parseApiResponse<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T & { error?: string };
  } catch {
    const responseKind = raw.trimStart().startsWith("<")
      ? "The server returned an HTML error page, likely because the long-running router deployment timed out."
      : "The server returned a non-JSON response.";
    throw new Error(`${fallback} (HTTP ${response.status}). ${responseKind}`);
  }
}

function draftFromAssignedHotspotPort(port: AssignedHotspotPort): AssignedHotspotPortDraft {
  return {
    hotspotEnabled: port.hotspot_enabled,
    hotspotFolderPath: port.hotspot_folder_path ?? port.hotspot_template_path ?? "",
    hotspotDnsName: port.hotspot_dns_name ?? "",
    pppoeEnabled: port.pppoe_enabled,
    pppoeFolderPath: port.pppoe_folder_path ?? "",
    pppoeDnsName: port.pppoe_dns_name ?? "",
    bridgeName: port.bridge_name ?? "",
    subnetRange: port.subnet_range ?? "",
    bandwidthCapMbps: String(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps ?? 30),
    nasIdentifier: port.nas_identifier ?? "",
  };
}

const DEFAULT_SETTINGS: HSettings = {
  ispName: "OCHOLASUPERNET",
  portalHostname: "",
  freeTrial: "Disable",
  vouchers: "Yes",
  tagline: "Fast, reliable Wi-Fi for the things you love.",
  routerId: "",
  advertPos: "Bottom",
  enableAdvert: "Disable",
  mpesaPrompt: "Enable",
  testimonials: "Disable",
  faqSection: "Disable",
  logoUrl: DEFAULT_HOTSPOT_LOGO_URL,
  advertUrl: "",
  announcement: "",
  paymentInstructions: "Enter your M-Pesa number and approve the prompt to connect instantly.",
  supportPhone: "",
  supportEmail: "",
  whatsappNumber: "",
  termsUrl: "",
  privacyUrl: "",
  maintenanceMode: "Online",
  maintenanceMessage: "We are making a few improvements. Please check back shortly.",
  testimonialText: "Fast, reliable Wi-Fi whenever I need it.",
  faqText: "How do I connect?\nChoose a package, complete payment, then sign in with the credentials you receive.",
  portalCards: DEFAULT_HOTSPOT_PORTAL_CARDS,
  portalLayout: "classic",
  colors: DEFAULT_COLORS,
};

function loadSettings(storageKey: string): HSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        portalCards: { ...DEFAULT_HOTSPOT_PORTAL_CARDS },
        colors: { ...DEFAULT_COLORS },
      };
    }
    const parsed = JSON.parse(raw) as Partial<HSettings>;
    const settings: HSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      portalCards: normalizeHotspotPortalCards(parsed.portalCards, { ...DEFAULT_SETTINGS, ...parsed }),
      portalLayout: normalizeHotspotPortalLayout(parsed.portalLayout),
      colors: { ...DEFAULT_COLORS, ...(parsed.colors ?? {}) },
    };
    settings.logoUrl = typeof parsed.logoUrl === "string" && parsed.logoUrl.trim()
      ? parsed.logoUrl
      : DEFAULT_HOTSPOT_LOGO_URL;
    return settings;
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      portalCards: { ...DEFAULT_HOTSPOT_PORTAL_CARDS },
      colors: { ...DEFAULT_COLORS },
    };
  }
}

function safeText(value: string, fallback = ""): string {
  return value.trim() || fallback;
}

async function embedPortalLogo(value: string): Promise<string> {
  const source = value.trim() || DEFAULT_HOTSPOT_LOGO_URL;
  if (!source || /ocholasupernet-logo\.png(?:$|[?#])/i.test(source)) return "";
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)) return source;

  const response = await fetch(source, { cache: "force-cache" });
  if (!response.ok) throw new Error("The portal logo could not be loaded for the exported page.");
  const blob = await response.blob();
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type.toLowerCase())) {
    throw new Error("The portal logo must be a PNG, JPG, or WebP image.");
  }
  if (blob.size > 2 * 1024 * 1024) throw new Error("Portal logo images must be smaller than 2 MB.");

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The portal logo could not be embedded in the exported page."));
    };
    reader.onerror = () => reject(new Error("The portal logo could not be embedded in the exported page."));
    reader.readAsDataURL(blob);
  });
}

function isValidPublicOrigin(value: string): boolean {
  try {
    hotspotApiOriginFromTenantContext(value);
    return true;
  } catch {
    return false;
  }
}

function portalOriginFromBrand(domain: string): string {
  const value = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!value) return `https://${PUBLIC_BASE_DOMAIN}`;
  const hostname = value.toLowerCase();
  if (hostname === PUBLIC_BASE_DOMAIN || hostname.endsWith(`.${PUBLIC_BASE_DOMAIN}`)) {
    return `https://${hostname}`;
  }
  if (hostname === "admin") return `https://${PUBLIC_BASE_DOMAIN}`;
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) {
    return `https://${hostname}.${PUBLIC_BASE_DOMAIN}`;
  }
  const candidate = `https://${value}`;
  return isValidPublicOrigin(candidate) ? candidate : `https://${PUBLIC_BASE_DOMAIN}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function safeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function validateSettings(settings: HSettings): string | null {
  if (!safeText(settings.ispName)) return "Enter an ISP name before exporting the portal.";
  if (!safeText(settings.tagline)) return "Enter a short tagline before exporting the portal.";
  for (const [label, value] of [
    ["Terms URL", settings.termsUrl],
    ["Privacy URL", settings.privacyUrl],
  ] as const) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return `${label} must use HTTPS.`;
    } catch {
      return `${label} must be a valid HTTPS link.`;
    }
  }
  return null;
}

type ExportConfig = {
  adminId: number;
  routerId: number;
  portId: number;
  previewOnly: boolean;
  apiBase: string;
  plans: PortalPlan[];
  ispName: string;
  tagline: string;
  logoUrl: string;
  advertUrl: string;
  advertEnabled: boolean;
  advertPosition: string;
  mpesaPromptEnabled: boolean;
  vouchersEnabled: boolean;
  freeTrialEnabled: boolean;
  announcement: string;
  paymentInstructions: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  termsUrl: string;
  privacyUrl: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  testimonialsEnabled: boolean;
  testimonialText: string;
  faqEnabled: boolean;
  faqText: string;
  portalCards: HotspotPortalCardVisibility;
  portalLayout: HotspotPortalLayout;
  colors: ColorSettings;
  portalBackground: string;
  portalPackageShape: string;
};

type PortalPlan = {
  id: number;
  name: string;
  price: number;
  validity: number;
  validity_unit: string;
};

const PORTAL_BACKGROUND_KEYS = new Set(["midnight", "ocean", "aurora", "forest", "sunset", "sand"]);
const PORTAL_PACKAGE_SHAPE_KEYS = new Set(["rounded", "soft-square", "compact", "square", "circle", "pill", "hexagon", "octagon", "squircle"]);

function safePortalBackground(value: unknown): string {
  return typeof value === "string" && PORTAL_BACKGROUND_KEYS.has(value) ? value : "midnight";
}

function safePortalPackageShape(value: unknown): string {
  return typeof value === "string" && PORTAL_PACKAGE_SHAPE_KEYS.has(value) ? value : "rounded";
}

function renderStaticPlanCards(plans: PortalPlan[], packageShape: string): string {
  const safeShape = safePortalPackageShape(packageShape);
  return plans.map((plan, index) => {
    const name = escapeHtml(plan.name);
    const unit = escapeHtml(plan.validity_unit);
    const price = Number.isFinite(plan.price) ? String(plan.price) : "0";
    const validity = Number.isFinite(plan.validity) ? String(plan.validity) : "0";
    return `<div class="plan-card package-shape-${safeShape}" data-plan-id="${plan.id}" style="border:1px solid rgba(167,139,250,.25);background:rgba(17,25,54,.92);overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:1.5rem 1rem 1.25rem;text-align:center;flex:1;background:linear-gradient(160deg,rgba(244,114,182,.1),rgba(124,58,237,.18));border-top:2px solid rgba(167,139,250,.5)">
        <span style="display:inline-block;padding:.25rem .75rem;border-radius:9999px;font-size:.625rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:white;margin-bottom:1rem;background:#4c1d95">${name}</span>
        <div style="font-size:2.375rem;font-weight:900;color:white;line-height:1;letter-spacing:-.03em"><span style="font-size:.8125rem;font-weight:600;color:#a78bfa">Ksh</span>&nbsp;${price}</div>
        <p style="font-size:.75rem;color:rgba(255,255,255,.5);margin-top:.625rem;font-weight:400">${validity} ${unit} Unlimited</p>
      </div>
      <button type="button" class="plan-connect-button" data-plan-index="${index}" style="width:100%;padding:.875rem;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:white;background:linear-gradient(135deg,#2f6fed,#7c3aed);border:none;cursor:pointer;font-family:inherit">Connect Now</button>
    </div>`;
  }).join("");
}

function makeExportConfig(
  settings: HSettings,
  adminId: number,
  apiBase: string,
  plans: PortalPlan[],
  appearance: { portalBackground?: unknown; portalPackageShape?: unknown; portalLayout?: unknown } = {},
  portId = 0,
  previewOnly = false,
): ExportConfig {
  const portalCards = normalizeHotspotPortalCards(settings.portalCards, settings);
  return {
    adminId,
    routerId: Number.isSafeInteger(Number(settings.routerId)) && Number(settings.routerId) > 0
      ? Number(settings.routerId)
      : 0,
    portId: Number.isSafeInteger(Number(portId)) && Number(portId) > 0 ? Number(portId) : 0,
    previewOnly,
    apiBase,
    plans,
    ispName: safeText(settings.ispName, DEFAULT_SETTINGS.ispName),
    tagline: safeText(settings.tagline, DEFAULT_SETTINGS.tagline),
    logoUrl: settings.logoUrl.trim() || DEFAULT_HOTSPOT_LOGO_URL,
    advertUrl: settings.advertUrl,
    advertEnabled: portalCards.advert && !!settings.advertUrl,
    advertPosition: settings.advertPos,
    mpesaPromptEnabled: settings.mpesaPrompt === "Enable",
    vouchersEnabled: settings.vouchers === "Yes" && portalCards.voucher,
    freeTrialEnabled: settings.freeTrial === "Enable",
    announcement: settings.announcement.trim(),
    paymentInstructions: safeText(settings.paymentInstructions, DEFAULT_SETTINGS.paymentInstructions),
    supportPhone: settings.supportPhone.trim(),
    supportEmail: settings.supportEmail.trim(),
    whatsappNumber: settings.whatsappNumber.trim(),
    termsUrl: settings.termsUrl.trim(),
    privacyUrl: settings.privacyUrl.trim(),
    maintenanceMode: settings.maintenanceMode === "Maintenance",
    maintenanceMessage: safeText(settings.maintenanceMessage, DEFAULT_SETTINGS.maintenanceMessage),
    testimonialsEnabled: portalCards.testimonials,
    testimonialText: safeText(settings.testimonialText, DEFAULT_SETTINGS.testimonialText),
    faqEnabled: portalCards.faq,
    faqText: safeText(settings.faqText, DEFAULT_SETTINGS.faqText),
    portalCards,
    colors: { ...DEFAULT_COLORS, ...settings.colors },
    portalBackground: safePortalBackground(appearance.portalBackground),
    portalPackageShape: safePortalPackageShape(appearance.portalPackageShape),
    portalLayout: normalizeHotspotPortalLayout(appearance.portalLayout ?? settings.portalLayout),
  };
}

async function resolvePortalAppearance(domain: string, adminId: number): Promise<{
  apiBase: string;
  portalBackground: string;
  portalPackageShape: string;
}> {
  try {
    const response = await fetch(`/api/public/typography?adminId=${encodeURIComponent(String(adminId))}`, {
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json() as { apiBase?: unknown; portalBackground?: unknown; portalPackageShape?: unknown };
      return {
        apiBase: typeof data.apiBase === "string" && isValidPublicOrigin(data.apiBase)
          ? data.apiBase.replace(/\/$/, "")
          : portalOriginFromBrand(domain),
        portalBackground: safePortalBackground(data.portalBackground),
        portalPackageShape: safePortalPackageShape(data.portalPackageShape),
      };
    }
  } catch {
    /* The tenant-derived public origin below remains deterministic offline. */
  }
  return { apiBase: portalOriginFromBrand(domain), portalBackground: "midnight", portalPackageShape: "rounded" };
}

export async function buildPortalHtml(
  settings: HSettings,
  domain: string,
  appearanceOverride: { portalBackground?: unknown; portalPackageShape?: unknown; portalLayout?: unknown } = {},
  scope: { portId?: number; previewOnly?: boolean } = {},
): Promise<string> {
  const adminId = getSelectedTenantId() ?? AUTH_ADMIN_ID;
  const response = await fetch("/hotspot/login.html", { cache: "no-store" });
  if (!response.ok) throw new Error("The captive-portal template could not be loaded.");
  const template = await response.text();
  const resolvedAppearance = await resolvePortalAppearance(domain, adminId);
  // Keep a custom portal/API hostname only when its public health endpoint
  // proves it serves this app. Otherwise use the tenant-resolved API origin.
  const apiOrigin = scope.previewOnly === true
    ? {
        apiBase: hotspotApiOriginFromTenantContext(resolvedAppearance.apiBase),
        source: "tenant_context" as const,
      }
    : await resolveHotspotPortalApiOrigin(
        settings.portalHostname,
        resolvedAppearance.apiBase,
        PUBLIC_BASE_DOMAIN,
      );
  const apiBase = apiOrigin.apiBase;
  const appearance = {
    ...resolvedAppearance,
    apiBase,
    portalBackground: safePortalBackground(appearanceOverride.portalBackground ?? resolvedAppearance.portalBackground),
    portalPackageShape: safePortalPackageShape(appearanceOverride.portalPackageShape ?? resolvedAppearance.portalPackageShape),
    portalLayout: normalizeHotspotPortalLayout(
      appearanceOverride.portalLayout ?? settings.portalLayout,
    ),
  };
  const routerId = Number(settings.routerId);
  let plans: PortalPlan[] = [];
  try {
    const routerQuery = Number.isSafeInteger(routerId) && routerId > 0
      ? `&routerId=${encodeURIComponent(String(routerId))}`
      : "";
    const portId = Number(scope.portId);
    const portQuery = Number.isSafeInteger(portId) && portId > 0
      ? `&portId=${encodeURIComponent(String(portId))}`
      : "";
    const plansResponse = await fetch(`/api/plans?adminId=${encodeURIComponent(String(adminId))}&type=hotspot&activeOnly=true&purchasableOnly=true${routerQuery}${portQuery}`, {
      cache: "no-store",
    });
    if (!plansResponse.ok && portQuery) {
      throw new Error(`The selected service's plans could not be loaded (HTTP ${plansResponse.status}).`);
    }
    if (plansResponse.ok) {
      const data = await plansResponse.json() as unknown;
      if (!Array.isArray(data) && portQuery) {
        throw new Error("The selected service's plans returned an invalid response.");
      }
      if (Array.isArray(data)) {
        plans = data
          .filter((plan): plan is Record<string, unknown> => !!plan && typeof plan === "object")
          .map((plan) => ({
            id: Number(plan.id) || 0,
            name: typeof plan.name === "string" ? plan.name : "",
            price: Number(plan.price) || 0,
            validity: Number(plan.validity) || 0,
            validity_unit: typeof plan.validity_unit === "string" ? plan.validity_unit : "days",
          }))
          .filter((plan) => plan.id > 0 && plan.name);
      }
    }

    /*
     * The generated router file must stay strictly scoped to its router or
     * VLAN port. The admin preview is different: it should still show an
     * existing package when the selected router has no router-wide package
     * (for example, when the package was created against another assigned
     * hotspot port). Use the authenticated admin plan context only for that
     * local preview fallback; never use it for an exported/deployed bundle.
     */
    // ISP-owned assigned services use the authoritative public port query.
    // Resellers retain their authenticated context fallback (their browser
    // account id differs from the parent ISP id), but only for this exact port.
    if (
      !plans.length
      && scope.previewOnly
      && (!(Number(scope.portId) > 0) || getAdminRole() === "reseller")
      && Number.isSafeInteger(routerId)
      && routerId > 0
    ) {
      const contextQuery = new URLSearchParams({
        hotspotPreview: "true",
        routerId: String(routerId),
      });
      if (Number.isSafeInteger(portId) && portId > 0) {
        contextQuery.set("portId", String(portId));
      }
      const contextResponse = await fetch(`/api/plans/admin-context?${contextQuery.toString()}`, {
        headers: adminApiHeaders(),
        cache: "no-store",
      });
      if (contextResponse.ok) {
        const context = await contextResponse.json() as {
          plans?: Array<Record<string, unknown>>;
        };
        const selectedRouterId = Number(settings.routerId);
        const selectedPortId = Number(scope.portId);
        const candidates = (context.plans ?? [])
          .filter(plan => ["hotspot", "trials", "trial"].includes(String(plan.type ?? "").toLowerCase()))
          .filter(plan => plan.is_active !== false && plan.client_can_purchase !== false)
          .filter(plan => Number(plan.router_id) === selectedRouterId)
          .filter(plan => selectedPortId > 0
            ? Number(plan.port_id) === selectedPortId
            : plan.port_id != null);
        plans = candidates
          .map(plan => ({
            id: Number(plan.id) || 0,
            name: typeof plan.name === "string" ? plan.name : "",
            price: Number(plan.price) || 0,
            validity: Number(plan.validity) || 0,
            validity_unit: typeof plan.validity_unit === "string" ? plan.validity_unit : "days",
          }))
          .filter(plan => plan.id > 0 && plan.name);
      }
    }
  } catch (error) {
    if (scope.previewOnly || Number(scope.portId) > 0) {
      throw new Error(error instanceof Error ? error.message : "The selected service's plans could not be loaded.");
    }
    /* The API fallback remains available when the admin panel is offline. */
  }
  const exportSettings = {
    ...settings,
    logoUrl: await embedPortalLogo(settings.logoUrl),
    portalCards: normalizeHotspotPortalCards(settings.portalCards, settings),
  };
  const config = makeExportConfig(exportSettings, adminId, appearance.apiBase, plans, appearance, scope.portId, scope.previewOnly === true);
  const layoutCss = renderStaticPortalLayoutCss(config.portalLayout);
  const bootstrap = `${layoutCss ? `<style id="hotspot-portal-layout">${layoutCss}</style>` : ""}<script>window.__HOTSPOT_CONFIG__=${safeEmbeddedJson(config)};document.documentElement.setAttribute("data-portal-layout",window.__HOTSPOT_CONFIG__.portalLayout);</script>`;
  const configuredTitle = escapeHtml(config.ispName);
  const staticPlanCards = renderStaticPlanCards(plans, appearance.portalPackageShape);
  const templateWithStaticPlans = staticPlanCards
    ? template.replace(
      /(<div id="plansGrid"[^>]*>)\s*<div[^>]*>Loading plans…<\/div>\s*(<\/div>)/,
      `$1${staticPlanCards}$2`,
    )
    : template;
  return templateWithStaticPlans
    .replace("</head>", `${bootstrap}\n</head>`)
    .replace(/\$\(login-title\)/g, configuredTitle);
}

const STYLES = `
  .hs-page { max-width: 1220px; margin: 0 auto; padding: 30px 34px 56px; }
  .hs-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:26px; }
  .hs-eyebrow { display:flex; align-items:center; gap:8px; color:var(--isp-accent); font-size:.68rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; margin-bottom:8px; }
  .hs-title { margin:0; color:var(--isp-text); font-size:1.65rem; line-height:1.15; font-weight:850; letter-spacing:-.04em; }
  .hs-subtitle { margin:8px 0 0; color:var(--isp-text-muted); font-size:.85rem; max-width:590px; line-height:1.55; }
  .hs-actions { display:flex; align-items:center; justify-content:flex-end; gap:9px; flex-wrap:wrap; }
  .hs-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:8px 14px; border-radius:9px; border:1px solid transparent; font:600 .78rem inherit; cursor:pointer; transition:all .16s ease; white-space:nowrap; }
  .hs-btn:disabled { cursor:not-allowed; opacity:.55; }
  .hs-btn-primary { background:var(--isp-accent); border-color:var(--isp-accent); color:#fff; box-shadow:0 4px 13px var(--isp-accent-glow); }
  .hs-btn-primary:hover:not(:disabled) { background:var(--isp-accent-strong); transform:translateY(-1px); }
  .hs-btn-soft { background:var(--isp-accent-glow); border-color:var(--isp-accent-border); color:var(--isp-accent-strong); }
  .hs-btn-soft:hover:not(:disabled) { background:var(--isp-accent-border); }
  .hs-btn-quiet { background:var(--isp-input-bg); border-color:var(--isp-border); color:var(--isp-text-muted); }
  .hs-btn-quiet:hover:not(:disabled) { color:var(--isp-text); background:var(--isp-hover); }
  .hs-grid { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr); gap:18px; align-items:start; }
  .hs-stack { display:flex; flex-direction:column; gap:18px; }
  .hs-card { background:var(--isp-section); border:1px solid var(--isp-border); border-radius:15px; box-shadow:var(--shadow-card); overflow:hidden; }
  .hs-card-head { display:flex; align-items:flex-start; gap:12px; padding:17px 20px 15px; border-bottom:1px solid var(--isp-border-subtle); }
  .hs-card-icon { display:flex; align-items:center; justify-content:center; flex:0 0 32px; width:32px; height:32px; border-radius:9px; color:var(--isp-accent); background:var(--isp-accent-glow); border:1px solid var(--isp-accent-border); }
  .hs-card-title { margin:0; color:var(--isp-text); font-size:.92rem; font-weight:800; }
  .hs-card-desc { margin:3px 0 0; color:var(--isp-text-muted); font-size:.72rem; line-height:1.45; }
  .hs-card-body { padding:4px 20px 8px; }
  .hs-field { display:grid; grid-template-columns:minmax(150px,.62fr) minmax(0,1.38fr); gap:20px; padding:17px 0; border-bottom:1px solid var(--isp-border-subtle); }
  .hs-field:last-child { border-bottom:0; }
  .hs-label { display:block; color:var(--isp-text); font-size:.78rem; font-weight:750; line-height:1.3; }
  .hs-help { margin:5px 0 0; color:var(--isp-text-sub); font-size:.68rem; line-height:1.45; }
  .hs-control { min-width:0; }
  .hs-input, .hs-select, .hs-textarea { width:100%; color:var(--isp-text); background:var(--isp-input-bg); border:1px solid var(--isp-input-border); border-radius:8px; padding:10px 12px; font:500 .78rem inherit; outline:none; transition:border-color .15s, box-shadow .15s; }
  .hs-input:focus, .hs-select:focus, .hs-textarea:focus { border-color:var(--isp-accent); box-shadow:0 0 0 3px var(--isp-accent-glow); }
  .hs-input::placeholder, .hs-textarea::placeholder { color:var(--isp-text-sub); }
  .hs-textarea { min-height:80px; resize:vertical; line-height:1.5; }
  .hs-select-wrap { position:relative; }
  .hs-select { appearance:none; padding-right:34px; cursor:pointer; }
  .hs-select-wrap svg { position:absolute; right:11px; top:50%; transform:translateY(-50%); pointer-events:none; color:var(--isp-text-sub); }
  .hs-upload { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .hs-file { display:none; }
  .hs-file-preview { display:flex; align-items:center; gap:8px; color:var(--isp-text-muted); font-size:.7rem; }
  .hs-file-preview img { width:42px; height:32px; border-radius:6px; border:1px solid var(--isp-border); object-fit:contain; background:#061416; }
  .hs-status { display:flex; align-items:flex-start; gap:9px; padding:11px 13px; border-radius:9px; font-size:.74rem; line-height:1.45; }
  .hs-status-error { color:#fca5a5; background:rgba(239,68,68,.09); border:1px solid rgba(239,68,68,.22); }
  .hs-status-success { color:#86efac; background:rgba(34,197,94,.09); border:1px solid rgba(34,197,94,.2); }
  .hs-status-info { color:var(--isp-text-muted); background:var(--isp-input-bg); border:1px solid var(--isp-border); }
  .hs-status strong { color:inherit; }
  .hs-color-grid { display:grid; grid-template-columns:repeat(4,minmax(68px,1fr)); gap:16px 12px; padding:19px 0 8px; }
  .hs-color { text-align:center; min-width:0; }
  .hs-color input { display:block; width:100%; height:42px; padding:3px; border:1px solid var(--isp-border); border-radius:8px; background:var(--isp-input-bg); cursor:pointer; }
  .hs-color label { display:block; margin-top:6px; color:var(--isp-text-muted); font-size:.63rem; line-height:1.25; }
  .hs-color code { display:block; margin-top:3px; color:var(--isp-text-sub); font-size:.58rem; }
  .hs-presets { display:flex; gap:8px; flex-wrap:wrap; padding:15px 0 8px; border-top:1px solid var(--isp-border-subtle); }
  .hs-preset { display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--isp-border); border-radius:8px; background:var(--isp-input-bg); color:var(--isp-text-muted); font:600 .67rem inherit; cursor:pointer; }
  .hs-preset:hover { color:var(--isp-text); border-color:var(--isp-accent-border); }
  .hs-swatches { display:flex; gap:3px; }
  .hs-swatches i { display:block; width:11px; height:11px; border-radius:3px; }
  .hs-choice-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
  .hs-choice { display:flex; align-items:center; gap:10px; min-width:0; padding:9px; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-input-bg); color:var(--isp-text-muted); text-align:left; cursor:pointer; transition:border-color .15s,background .15s,transform .15s; }
  .hs-choice:hover { border-color:var(--isp-accent-border); transform:translateY(-1px); }
  .hs-choice.active { border-color:var(--isp-accent); background:var(--isp-accent-glow); box-shadow:0 0 0 2px var(--isp-accent-glow); }
  .hs-choice > span:last-child { min-width:0; display:grid; gap:3px; }
  .hs-choice strong { color:var(--isp-text); font-size:.71rem; font-weight:800; }
  .hs-choice small { color:var(--isp-text-sub); font-size:.61rem; line-height:1.25; }
  .hs-visibility-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:14px 0 8px; }
  .hs-visibility-card { display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; padding:12px; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-input-bg); color:var(--isp-text); text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
  .hs-visibility-card:hover { border-color:var(--isp-accent-border); }
  .hs-visibility-card:focus-visible { outline:2px solid var(--isp-accent); outline-offset:2px; }
  .hs-visibility-card[aria-checked="true"] { border-color:var(--isp-accent-border); background:var(--isp-accent-glow); }
  .hs-visibility-copy { display:grid; gap:4px; min-width:0; }
  .hs-visibility-copy strong { color:var(--isp-text); font-size:.72rem; font-weight:800; }
  .hs-visibility-copy small { color:var(--isp-text-sub); font-size:.62rem; line-height:1.35; }
  .hs-visibility-switch { position:relative; flex:0 0 34px; width:34px; height:20px; border-radius:999px; background:rgba(148,163,184,.26); transition:background .15s; }
  .hs-visibility-switch > span { position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s; }
  .hs-visibility-card[aria-checked="true"] .hs-visibility-switch { background:var(--isp-accent); }
  .hs-visibility-card[aria-checked="true"] .hs-visibility-switch > span { transform:translateX(14px); }
  .hs-choice-preview { display:block; flex:0 0 46px; width:46px; height:34px; border-radius:7px; border:1px solid rgba(255,255,255,.18); }
  .hs-shape-preview { display:block; flex:0 0 auto; }
  .hs-layout-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
  .hs-layout-choice { display:flex; align-items:center; gap:10px; min-width:0; min-height:76px; padding:9px; border:1px solid var(--isp-border); border-radius:10px; background:var(--isp-input-bg); color:var(--isp-text-muted); text-align:left; cursor:pointer; transition:border-color .15s,background .15s,transform .15s; }
  .hs-layout-choice:hover { border-color:var(--isp-accent-border); transform:translateY(-1px); }
  .hs-layout-choice.active { border-color:var(--isp-accent); background:var(--isp-accent-glow); box-shadow:0 0 0 2px var(--isp-accent-glow); }
  .hs-layout-copy { min-width:0; display:grid; gap:4px; }
  .hs-layout-copy strong { color:var(--isp-text); font-size:.72rem; font-weight:800; }
  .hs-layout-copy small { color:var(--isp-text-sub); font-size:.61rem; line-height:1.3; }
  .hs-layout-thumb { display:grid; flex:0 0 62px; width:62px; height:48px; overflow:hidden; gap:3px; padding:4px; border:1px solid rgba(255,255,255,.14); border-radius:7px; background:var(--layout-preview-bg); }
  .hs-layout-thumb i { display:block; min-width:0; min-height:0; border-radius:2px; }
  .hs-layout-thumb-header { grid-column:1/-1; background:var(--layout-preview-accent); opacity:.9; }
  .hs-layout-thumb-hero { background:var(--layout-preview-panel); }
  .hs-layout-thumb-plans { background:linear-gradient(90deg,var(--layout-preview-accent) 0 22%,var(--layout-preview-panel) 22% 100%); }
  .hs-layout-thumb-classic { grid-template-columns:1fr; grid-template-rows:5px 1fr 1fr; }
  .hs-layout-thumb-classic .hs-layout-thumb-hero { width:45%; justify-self:center; }
  .hs-layout-thumb-split-horizon { grid-template-columns:.8fr 1.2fr; grid-template-rows:5px 1fr; }
  .hs-layout-thumb-split-horizon .hs-layout-thumb-header { grid-column:1/-1; }
  .hs-layout-thumb-split-horizon .hs-layout-thumb-hero { grid-column:1; grid-row:2; }
  .hs-layout-thumb-split-horizon .hs-layout-thumb-plans { grid-column:2; grid-row:2; }
  .hs-layout-thumb-coastal-light { grid-template-columns:1fr; grid-template-rows:5px 1fr 1.2fr; border-radius:11px; }
  .hs-layout-thumb-coastal-light .hs-layout-thumb-hero { width:68%; justify-self:center; background:var(--layout-preview-panel); }
  .hs-layout-thumb-signal-grid { grid-template-columns:1fr 1fr; grid-template-rows:5px 1fr; border-radius:3px; }
  .hs-layout-thumb-signal-grid .hs-layout-thumb-hero { grid-column:1; grid-row:2; }
  .hs-layout-thumb-signal-grid .hs-layout-thumb-plans { grid-column:2; grid-row:2; }
  .hs-layout-thumb-warm-studio { grid-template-columns:1fr; grid-template-rows:5px 1fr 1.1fr; border-radius:11px; }
  .hs-layout-thumb-warm-studio .hs-layout-thumb-hero { width:56%; justify-self:center; }
  .hs-layout-thumb-forest-pulse { grid-template-columns:1fr; grid-template-rows:5px 1.2fr 1fr; }
  .hs-layout-thumb-forest-pulse .hs-layout-thumb-hero { width:74%; justify-self:center; }
  @media (max-width: 760px) { .hs-layout-grid { grid-template-columns:1fr; } }
  .hs-side-card { background:linear-gradient(155deg,var(--isp-card),var(--isp-inner-card)); }
  .hs-side-body { padding:17px 18px 19px; }
  .hs-preview-screen { min-height:270px; overflow:hidden; border-radius:11px; border:1px solid var(--isp-border); background:linear-gradient(145deg,#081018,#122137); position:relative; }
  .hs-preview-screen::before { content:""; position:absolute; inset:0; opacity:.35; background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px); background-size:26px 26px; }
  .hs-mini-content { position:relative; padding:17px 14px; text-align:center; color:#fff; }
  .hs-mini-logo { width:116px; height:48px; margin:0 auto 10px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:transparent; }
  .hs-mini-logo img { width:100%; height:100%; object-fit:contain; }
  .hs-mini-content h3 { color:#fff; margin:0; font-size:1rem; font-weight:850; }
  .hs-mini-content p { color:rgba(255,255,255,.55); margin:5px auto 16px; font-size:.65rem; line-height:1.4; }
  .hs-mini-plans { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; text-align:left; }
  .hs-mini-plan { padding:9px; border-radius:8px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1); }
  .hs-mini-plan b { display:block; color:#fff; font-size:.66rem; }
  .hs-mini-plan span { display:block; color:var(--mini-primary); margin-top:5px; font-size:.62rem; font-weight:700; }
  .hs-mini-button { margin-top:12px; padding:9px; border-radius:8px; background:var(--mini-button); color:#fff; font-size:.65rem; font-weight:800; }
  .hs-side-note { display:flex; align-items:flex-start; gap:8px; margin-top:13px; color:var(--isp-text-muted); font-size:.69rem; line-height:1.45; }
  .hs-checklist { display:flex; flex-direction:column; gap:10px; margin:0; padding:0; list-style:none; }
  .hs-checklist li { display:flex; align-items:flex-start; gap:8px; color:var(--isp-text-muted); font-size:.72rem; line-height:1.4; }
  .hs-checklist svg { flex:0 0 auto; margin-top:1px; color:var(--isp-green); }
  .hs-foot-actions { display:flex; align-items:center; justify-content:flex-end; gap:9px; padding-top:4px; }
  .hs-modal-backdrop { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:22px; background:rgba(1,7,9,.82); backdrop-filter:blur(8px); }
  .hs-modal { width:min(1180px,96vw); height:min(88vh,820px); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#081416; box-shadow:0 30px 100px rgba(0,0,0,.55); }
  .hs-modal-head { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:13px 16px; border-bottom:1px solid rgba(255,255,255,.1); background:#102426; }
  .hs-modal-title { display:flex; align-items:center; gap:9px; color:#e7efea; font-size:.82rem; font-weight:800; }
  .hs-modal-copy { color:#8da09d; font-size:.67rem; margin:3px 0 0; }
  .hs-modal-close { display:flex; align-items:center; gap:6px; padding:7px 10px; border-radius:7px; border:1px solid rgba(248,113,113,.25); background:rgba(248,113,113,.08); color:#fca5a5; font:700 .68rem inherit; cursor:pointer; }
  .hs-modal-frame { flex:1; min-height:0; border:0; background:#02090f; }
  @media (max-width: 900px) { .hs-grid { grid-template-columns:1fr; } .hs-side { display:grid; grid-template-columns:1fr 1fr; gap:18px; } }
  @media (max-width: 680px) { .hs-page { padding:22px 15px 42px; } .hs-hero { display:block; } .hs-actions { justify-content:flex-start; margin-top:18px; } .hs-field { grid-template-columns:1fr; gap:8px; } .hs-card-body { padding-inline:15px; } .hs-card-head { padding-inline:15px; } .hs-color-grid { grid-template-columns:repeat(4,1fr); gap:12px 7px; } .hs-choice-grid, .hs-visibility-grid { grid-template-columns:1fr; } .hs-side { display:flex; flex-direction:column; } .hs-foot-actions { justify-content:stretch; } .hs-foot-actions .hs-btn { flex:1; } }
`;

function Section({
  icon, title, description, children, className = "",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hs-card ${className}`}>
      <div className="hs-card-head">
        <div className="hs-card-icon">{icon}</div>
        <div>
          <h2 className="hs-card-title">{title}</h2>
          <p className="hs-card-desc">{description}</p>
        </div>
      </div>
      <div className="hs-card-body">{children}</div>
    </section>
  );
}

function Field({
  label, help, children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hs-field">
      <div>
        <label className="hs-label">{label}</label>
        {help && <p className="hs-help">{help}</p>}
      </div>
      <div className="hs-control">{children}</div>
    </div>
  );
}

function SelectField({
  value, onChange, options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="hs-select-wrap">
      <select className="hs-select" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}

function FilePicker({
  label, value, accept, onSelect,
}: {
  label: string;
  value: string;
  accept: string;
  onSelect: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="hs-upload">
      <button type="button" className="hs-btn hs-btn-quiet" onClick={() => ref.current?.click()}>
        <Upload size={14} /> {label}
      </button>
      <input
        ref={ref}
        className="hs-file"
        type="file"
        accept={accept}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.currentTarget.value = "";
        }}
      />
      <div className="hs-file-preview">
        {value && <img src={value} alt="" />}
        <span>{value ? "Image ready" : "No image selected"}</span>
      </div>
    </div>
  );
}

function ColorPicker({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="hs-color">
      <input aria-label={label} type="color" value={value} onChange={event => onChange(event.target.value)} />
      <label>{label}</label>
      <code>{value}</code>
    </div>
  );
}

function portalShapePreviewStyle(shape: PortalPackageShape): React.CSSProperties {
  const common: React.CSSProperties = {
    width: 54,
    height: 38,
    background: "linear-gradient(135deg,#8b5cf6,#2563eb)",
    border: "1px solid rgba(255,255,255,.28)",
  };
  if (shape === "soft-square") return { ...common, borderRadius: 10 };
  if (shape === "compact") return { ...common, borderRadius: 4 };
  if (shape === "square") return { ...common, borderRadius: 0 };
  if (shape === "circle") return { ...common, width: 42, height: 42, borderRadius: "50%" };
  if (shape === "pill") return { ...common, borderRadius: 999 };
  if (shape === "hexagon") return { ...common, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" };
  if (shape === "octagon") return { ...common, clipPath: "polygon(15% 0,85% 0,100% 15%,100% 85%,85% 100%,15% 100%,0 85%,0 15%)" };
  if (shape === "squircle") return { ...common, borderRadius: "28%" };
  return { ...common, borderRadius: 16 };
}

function PreviewModal({
  url, loading, onClose,
}: {
  url: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="hs-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hotspot portal preview">
      <div className="hs-modal">
        <div className="hs-modal-head">
          <div>
            <div className="hs-modal-title"><Eye size={15} /> Captive-portal preview</div>
            <p className="hs-modal-copy">If this router has no router-wide packages, the preview includes eligible packages from its assigned hotspot ports. Downloads and deployed portals remain service-scoped.</p>
          </div>
          <button type="button" className="hs-modal-close" onClick={onClose}><X size={13} /> Close</button>
        </div>
        {loading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#a3b5af", gap: 9 }}>
            <Loader2 size={18} className="animate-spin" /> Preparing preview…
          </div>
        )}
        {!loading && url && (
          <iframe className="hs-modal-frame" title="Generated hotspot portal" src={url} sandbox="allow-forms allow-modals allow-scripts allow-same-origin" />
        )}
      </div>
    </div>
  );
}

export default function HotspotSettings() {
  const brand = useBrand();
  const adminId = getSelectedTenantId() ?? AUTH_ADMIN_ID;
  const storageKey = `hotspot_settings_${adminId}`;
  const isResellerAccount = getAdminRole() === "reseller";
  const {
    preferences,
    loading: appearanceLoading,
    saving: appearanceSaving,
    savePreferences,
  } = useDashboardPreferences();
  const [settings, setSettings] = useState<HSettings>(() => loadSettings(storageKey));
  const [portalBackground, setPortalBackground] = useState<PortalBackground>(preferences.portalBackground);
  const [portalPackageShape, setPortalPackageShape] = useState<PortalPackageShape>(preferences.portalPackageShape);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [installingHotspotFiles, setInstallingHotspotFiles] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [assignedPorts, setAssignedPorts] = useState<AssignedHotspotPort[]>([]);
  const [portDrafts, setPortDrafts] = useState<Record<number, AssignedHotspotPortDraft>>({});
  const [selectedAssignedPortId, setSelectedAssignedPortId] = useState("");
  const [portsLoading, setPortsLoading] = useState(false);
  const [savingPortId, setSavingPortId] = useState<number | null>(null);
  const [deletingPortId, setDeletingPortId] = useState<number | null>(null);

  useEffect(() => {
    if (appearanceSaving) return;
    setPortalBackground(preferences.portalBackground);
    setPortalPackageShape(preferences.portalPackageShape);
  }, [appearanceSaving, preferences.portalBackground, preferences.portalPackageShape]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/hotspot-branding", { headers: adminApiHeaders(), cache: "no-store" })
      .then(async response => {
        const data = await parseApiResponse<{ branding?: { portalHostname?: unknown; settings?: unknown } }>(
          response, "Hotspot branding could not be loaded.",
        );
        if (!response.ok) throw new Error(data.error || "Hotspot branding could not be loaded.");
        return data.branding;
      })
      .then(branding => {
        if (cancelled || !branding) return;
        const persisted = branding.settings && typeof branding.settings === "object" && !Array.isArray(branding.settings)
          ? branding.settings as Partial<HSettings> : {};
        setSettings(previous => {
          const merged: HSettings = {
            ...previous,
            ...persisted,
            portalHostname: typeof branding.portalHostname === "string" ? branding.portalHostname : previous.portalHostname,
            colors: { ...DEFAULT_COLORS, ...(persisted.colors ?? {}) },
            portalCards: normalizeHotspotPortalCards(persisted.portalCards, { ...previous, ...persisted }),
            portalLayout: normalizeHotspotPortalLayout(persisted.portalLayout ?? previous.portalLayout),
          };
          merged.logoUrl = typeof persisted.logoUrl === "string" && persisted.logoUrl.trim()
            ? persisted.logoUrl
            : DEFAULT_HOTSPOT_LOGO_URL;
          return merged;
        });
      })
      .catch(() => {
        /* Local storage remains an offline fallback for older deployments. */
      });
    return () => { cancelled = true; };
  }, [adminId]);

  useEffect(() => {
    const requestedRouterId = new URLSearchParams(window.location.search).get("routerId");
    if (requestedRouterId && /^\d+$/.test(requestedRouterId)) {
      setSettings(previous => ({ ...previous, routerId: requestedRouterId }));
    }
  }, []);

  const { data: routers = [], isLoading: routersLoading } = useQuery<DbRouter[]>({
    queryKey: ["routers_for_hotspot_settings", adminId],
    queryFn: async () => {
      const response = await fetch("/api/routers", { headers: adminApiHeaders(), cache: "no-store" });
      const data = await parseApiResponse<DbRouter[] | { error?: string }>(response, "Routers could not be loaded.");
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Routers could not be loaded.");
      return data;
    },
  });

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    const routerId = Number(settings.routerId);
    if (!isResellerAccount && (!Number.isSafeInteger(routerId) || routerId < 1)) {
      setAssignedPorts([]);
      setPortDrafts({});
      setSelectedAssignedPortId("");
      return;
    }
    let cancelled = false;
    setPortsLoading(true);
    const routerQuery = isResellerAccount
      ? ""
      : `?routerId=${encodeURIComponent(String(routerId))}`;
    fetch(`/api/admin/port-services${routerQuery}`, {
      headers: adminApiHeaders(),
      cache: "no-store",
    })
      .then(async response => {
        const data = await parseApiResponse<{ ok?: boolean; ports?: AssignedHotspotPort[] }>(response, "Assigned hotspot ports could not be loaded.");
        if (!response.ok) throw new Error(data.error || "Assigned hotspot ports could not be loaded.");
        return data.ports ?? [];
      })
      .then(ports => {
        if (cancelled) return;
        setAssignedPorts(ports);
        setPortDrafts(Object.fromEntries(ports.map(port => [port.id, draftFromAssignedHotspotPort(port)])));
        setSelectedAssignedPortId(current => nextHotspotPortalTarget(current, ports, isResellerAccount));
        if (isResellerAccount) {
          setSettings(previous => {
            const selected = ports.find(port => String(port.id) === selectedAssignedPortId) ?? ports[0];
            return selected && String(selected.router_id) !== previous.routerId
              ? { ...previous, routerId: String(selected.router_id) }
              : previous;
          });
        }
      })
      .catch(error => {
        if (!cancelled) setNotice({ type: "error", text: error instanceof Error ? error.message : "Assigned hotspot ports could not be loaded." });
      })
      .finally(() => {
        if (!cancelled) setPortsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isResellerAccount, settings.routerId]);

  useEffect(() => {
    if (!isResellerAccount || routersLoading) return;
    setSettings(previous => {
      const current = Number(previous.routerId);
      const stillAssigned = routers.some(router => router.id === current);
      if (stillAssigned) return previous;
      return { ...previous, routerId: routers[0] ? String(routers[0].id) : "" };
    });
  }, [isResellerAccount, routers, routersLoading]);

  const update = <K extends keyof HSettings>(key: K, value: HSettings[K]) => {
    setSettings(previous => ({ ...previous, [key]: value }));
    setNotice(null);
  };
  const updatePortalCard = (key: HotspotPortalCardKey, enabled: boolean) => {
    setSettings(previous => {
      const legacyValues: Partial<HSettings> = key === "voucher"
        ? { vouchers: enabled ? "Yes" : "No" }
        : key === "advert"
          ? { enableAdvert: enabled ? "Enable" : "Disable" }
          : key === "testimonials"
            ? { testimonials: enabled ? "Enable" : "Disable" }
            : key === "faq"
              ? { faqSection: enabled ? "Enable" : "Disable" }
              : {};
      return {
        ...previous,
        ...legacyValues,
        portalCards: {
          ...normalizeHotspotPortalCards(previous.portalCards, previous),
          [key]: enabled,
        },
      };
    });
    setNotice(null);
  };
  const updateColor = (key: keyof ColorSettings, value: string) => {
    setSettings(previous => ({ ...previous, colors: { ...previous.colors, [key]: value } }));
    setNotice(null);
  };

  const updateAssignedPort = <K extends keyof AssignedHotspotPortDraft>(portId: number, key: K, value: AssignedHotspotPortDraft[K]) => {
    setPortDrafts(previous => ({
      ...previous,
      [portId]: { ...previous[portId], [key]: value },
    }));
    setNotice(null);
  };

  const portalTargets = hotspotPortalTargets(assignedPorts, isResellerAccount);
  const selectedPortalPort = portalTargets.find(port => String(port.id) === selectedAssignedPortId);

  const buildTargetPortal = (port: AssignedHotspotPort | undefined, previewOnly = false) =>
    buildPortalHtml(
      port ? { ...settings, routerId: String(port.router_id) } : settings,
      brand.domain,
      { portalBackground, portalPackageShape },
      { portId: port?.id, previewOnly },
    );

  const waitForPortDeployment = async (portId: number): Promise<AssignedHotspotPort | null> => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 2000));
      const response = await fetch("/api/admin/port-services", {
        headers: adminApiHeaders(),
        cache: "no-store",
      });
      const data = await parseApiResponse<{ ok?: boolean; ports?: AssignedHotspotPort[] }>(
        response,
        "The router deployment status could not be loaded.",
      );
      if (!response.ok) throw new Error(data.error || "The router deployment status could not be loaded.");
      const latest = (data.ports ?? []).find(item => item.id === portId);
      if (!latest) continue;
      setAssignedPorts(previous => previous.map(item => item.id === latest.id ? latest : item));
      setPortDrafts(previous => ({ ...previous, [latest.id]: draftFromAssignedHotspotPort(latest) }));
      if (["active", "completed", "failed", "error"].includes(latest.status)) return latest;
    }
    return null;
  };

  const saveAssignedPort = async (port: AssignedHotspotPort) => {
    const draft = portDrafts[port.id];
    if (!draft) return false;
    const allowHotspotReplace = draft.hotspotEnabled
      && window.confirm(
        "Confirm replacing existing Hotspot portal files for this assigned service? Cancel keeps existing files unchanged while still allowing missing files to be added.",
      );
    setSavingPortId(port.id);
    setNotice(null);
    try {
      const portalHtml = draft.hotspotEnabled
        && (isResellerAccount || (!port.assigned_reseller_id && usesGeneratedHotspotPortal(draft.hotspotFolderPath)))
        ? await buildTargetPortal(port)
        : "";
      const response = await fetch(`/api/admin/port-services/${port.id}`, {
        method: "PUT",
        headers: adminApiHeaders(),
        body: JSON.stringify({
          hotspotEnabled: draft.hotspotEnabled,
          hotspotFolderPath: draft.hotspotFolderPath,
          hotspotDnsName: draft.hotspotDnsName,
          pppoeEnabled: draft.pppoeEnabled,
          pppoeFolderPath: draft.pppoeFolderPath,
          pppoeDnsName: draft.pppoeDnsName,
          bridgeName: draft.bridgeName,
          subnetRange: draft.subnetRange,
          bandwidthCapMbps: Number(draft.bandwidthCapMbps),
          ...(!isResellerAccount ? { nasIdentifier: draft.nasIdentifier } : {}),
        }),
      });
      const data = await parseApiResponse<{ ok?: boolean; port?: AssignedHotspotPort }>(response, "The assigned hotspot port could not be saved.");
      if (!response.ok || !data.port) throw new Error(data.error || "The assigned hotspot port could not be saved.");
      if (draft.hotspotEnabled || draft.pppoeEnabled) {
        const deployResponse = await fetch(`/api/admin/port-services/${port.id}/deploy`, {
          method: "POST",
          headers: adminApiHeaders(),
          body: JSON.stringify({
            ...(portalHtml ? { portalHtml } : {}),
            portalFileReplacementConsent: allowHotspotReplace,
          }),
        });
        const deployData = await parseApiResponse<{ status?: string; accepted?: boolean }>(
          deployResponse,
          "The assigned hotspot port deployment failed.",
        );
        if (!deployResponse.ok) throw new Error(deployData.error || "The router service deployment failed.");
        if (deployResponse.status === 202 || deployData.accepted || deployData.status === "provisioning") {
          const completed = await waitForPortDeployment(port.id);
          if (completed?.status === "failed" || completed?.status === "error") {
            throw new Error(completed.provisioning_error || "The router service deployment failed.");
          }
          if (!completed) {
            setAssignedPorts(previous => previous.map(item => item.id === port.id ? data.port! : item));
            setPortDrafts(previous => ({ ...previous, [port.id]: draftFromAssignedHotspotPort(data.port!) }));
            setNotice({
              type: "info",
              text: `The router deployment is still running. Existing Hotspot files ${
                allowHotspotReplace ? "may be replaced as confirmed." : "will remain unchanged."
              }`,
            });
            return false;
          }
          data.port = completed;
        }
      }
      setAssignedPorts(previous => previous.map(item => item.id === port.id ? data.port! : item));
      setPortDrafts(previous => ({ ...previous, [port.id]: draftFromAssignedHotspotPort(data.port!) }));
      if (!isResellerAccount && !data.port.hotspot_enabled) {
        setSelectedAssignedPortId(current => current === String(port.id) ? "" : current);
      }
      setNotice({
        type: "success",
        text: `${port.interface_name} hotspot settings were saved and deployed to the router. ${
          allowHotspotReplace
            ? "Existing Hotspot files may have been replaced as confirmed."
            : "Existing Hotspot files were left unchanged."
        }`,
      });
      return true;
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The assigned hotspot port could not be saved." });
      return false;
    } finally {
      setSavingPortId(null);
    }
  };

  const deleteAssignedPort = async (port: AssignedHotspotPort) => {
    setDeletingPortId(port.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/port-services/${port.id}`, {
        method: "DELETE",
        headers: adminApiHeaders(),
      });
      const data = await parseApiResponse<{ ok?: boolean; interfaceName?: string }>(response, "The assigned hotspot port could not be deleted.");
      if (!response.ok) throw new Error(data.error || "The assigned hotspot port could not be deleted.");
      setAssignedPorts(previous => previous.filter(item => item.id !== port.id));
      setSelectedAssignedPortId(current => current === String(port.id) ? "" : current);
      setPortDrafts(previous => {
        const next = { ...previous };
        delete next[port.id];
        return next;
      });
      setNotice({ type: "success", text: `${data.interfaceName || port.interface_name} was deleted and its RouterOS resources were removed.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The assigned hotspot port could not be deleted." });
    } finally {
      setDeletingPortId(null);
    }
  };

  const handleFile = (key: "logoUrl" | "advertUrl", file: File) => {
    const limit = key === "advertUrl" ? 500 * 1024 : 2 * 1024 * 1024;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice({ type: "error", text: "Use a PNG, JPG, or WebP image for portal branding." });
      return;
    }
    if (file.size > limit) {
      setNotice({ type: "error", text: `${key === "advertUrl" ? "Advert" : "Logo"} images must be smaller than ${key === "advertUrl" ? "500 KB" : "2 MB"}.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const value = event.target?.result;
      if (typeof value === "string") update(key, value);
    };
    reader.onerror = () => setNotice({ type: "error", text: "That image could not be read. Choose it again." });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    const error = validateSettings(settings);
    if (error) {
      setNotice({ type: "error", text: error });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      const brandingResponse = await fetch("/api/admin/hotspot-branding", {
        method: "PUT",
        headers: adminApiHeaders(),
        body: JSON.stringify({ branding: { portalHostname: settings.portalHostname, settings } }),
      });
      const brandingData = await parseApiResponse<{ ok?: boolean }>(brandingResponse, "Hotspot branding could not be saved.");
      if (!brandingResponse.ok) throw new Error(brandingData.error || "Hotspot branding could not be saved.");
      await savePreferences({
        ...preferences,
        portalBackground,
        portalPackageShape,
      });
      if (isResellerAccount || selectedAssignedPortId) {
        const selectedPort = selectedPortalPort;
        if (!selectedPort) {
          throw new Error("Choose an assigned Hotspot service before syncing.");
        }
        if (!await saveAssignedPort(selectedPort)) return;
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
        return;
      }
      const routerId = Number(settings.routerId);
       const selectedRouter = routers.find((router) => router.id === routerId);
       const adminId = selectedRouter?.admin_id ?? getSelectedTenantId();
      let noticeText = "Hotspot settings saved on this admin workspace.";

       const canRefreshPortal = Number.isSafeInteger(routerId) && routerId > 0 && Boolean(adminId);
       if (canRefreshPortal && !window.confirm(
         "Saving these settings will replace the existing login.html and rlogin.html files on the selected router. Continue?",
       )) {
         noticeText = "Settings saved. Router portal files were left unchanged.";
       } else if (canRefreshPortal) {
         const html = await buildPortalHtml(settings, brand.domain, { portalBackground, portalPackageShape }, {
           portId: isResellerAccount ? Number(selectedAssignedPortId) : undefined,
         });
        const headers = new Headers({ "Content-Type": "application/json" });
        let token = "";
        let role = "";
        try {
          token = localStorage.getItem("ochola_api_token")
            || localStorage.getItem("ochola_superadmin_token")
            || "";
          role = localStorage.getItem("ochola_admin_role") || "isp_admin";
        } catch {
          /* The API enforces tenant ownership server-side. */
        }
        if (token) headers.set("Authorization", `Bearer ${token}`);
        if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));

        const response = await fetch(`/api/router/${routerId}/hotspot-portal/deploy`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            adminId,
            html,
            overwrite: true,
            portalFileReplacementConsent: true,
            destinationDirectory: "flash/hotspot",
          }),
        });
        let data: { error?: string; detail?: string; destinationPath?: string } = {};
        try {
          data = await response.json();
        } catch {
          /* Use the HTTP status below when the server did not return JSON. */
        }
        if (!response.ok) {
          const serverMessage = [data.error, data.detail]
            .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
            .join(": ");
          throw new Error(serverMessage || `Portal refresh failed (HTTP ${response.status})`);
        }
        noticeText = "Settings saved and the hotspot page was refreshed with the latest plans.";
      } else {
       noticeText = "Settings saved. Select a linked router to refresh its hotspot page automatically.";
      }

      setSaved(true);
      setNotice({ type: "success", text: noticeText });
      window.setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setNotice({ type: "error", text: "Settings could not be saved in this browser. Check available storage and try again." });
      if (error instanceof Error && error.message !== "Failed to fetch") {
        setNotice({ type: "error", text: error.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const createExport = async () => {
    const error = validateSettings(settings);
    if (error) {
      setNotice({ type: "error", text: error });
      return null;
    }
    if ((isResellerAccount || selectedAssignedPortId) && !selectedPortalPort) {
      throw new Error("The selected Hotspot service is no longer available. Choose a service again.");
    }
    return buildTargetPortal(selectedPortalPort);
  };

  const handleDownload = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const html = await createExport();
      if (!html) return;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = safeText(settings.ispName, "hotspot-portal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hotspot-portal";
      anchor.href = url;
      const portSlug = selectedPortalPort?.interface_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      anchor.download = `${slug}${portSlug ? `-${portSlug}` : ""}-hotspot-login.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ type: "success", text: selectedPortalPort
        ? `${selectedPortalPort.interface_name}'s port-scoped login.html is ready for its isolated Hotspot folder.`
        : "Your tenant-branded login.html is ready to upload to the router hotspot folder." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The portal HTML could not be generated." });
    } finally {
      setExporting(false);
    }
  };

  const handleDeploy = async () => {
    if (selectedAssignedPortId) {
      if (!selectedPortalPort) {
        setNotice({ type: "error", text: "The selected Hotspot service is no longer available. Choose a service again." });
        return;
      }
      setDeploying(true);
      try {
        await savePreferences({ ...preferences, portalBackground, portalPackageShape });
        await saveAssignedPort(selectedPortalPort);
      } catch (error) {
        setNotice({ type: "error", text: error instanceof Error ? error.message : "The service portal could not be deployed." });
      } finally {
        setDeploying(false);
      }
      return;
    }
    const routerId = Number(settings.routerId);
     const selectedRouter = routers.find((router) => router.id === routerId);
     const adminId = selectedRouter?.admin_id ?? getSelectedTenantId();
    if (!Number.isSafeInteger(routerId) || routerId < 1) {
      setNotice({ type: "error", text: "Choose a linked router before deploying the portal." });
      return;
    }
    if (!adminId) {
      setNotice({ type: "error", text: "Sign in to an ISP account before deploying the portal." });
      return;
    }
    if (!window.confirm(
        "Deploy the current branded portal to this router? The server will transfer login.html and rlogin.html. You will be asked before existing files are replaced.",
    )) return;

    setDeploying(true);
    setNotice(null);
    try {
      await savePreferences({
        ...preferences,
        portalBackground,
        portalPackageShape,
      });
      const html = await createExport();
      if (!html) return;

      const deploy = async (overwrite: boolean) => {
        const headers = new Headers({ "Content-Type": "application/json" });
        let token = "";
        let role = "";
        try {
          token = localStorage.getItem("ochola_api_token")
            || localStorage.getItem("ochola_superadmin_token")
            || "";
          role = localStorage.getItem("ochola_admin_role") || "isp_admin";
        } catch {
          /* The API also enforces tenant ownership server-side. */
        }
        if (token) headers.set("Authorization", `Bearer ${token}`);
        if (role === "superadmin") headers.set("X-Impersonated-Admin-Id", String(adminId));
        const response = await fetch(`/api/router/${routerId}/hotspot-portal/deploy`, {
          method: "POST",
          headers,
           body: JSON.stringify({
             adminId,
             html,
             overwrite,
             portalFileReplacementConsent: overwrite,
             destinationDirectory: "flash/hotspot",
           }),
        });
        let data: {
          error?: string;
           detail?: string;
           hint?: string;
          destinationPath?: string;
          replaced?: boolean;
          existingFile?: { name: string; size: number; type: string };
        } = {};
        try {
          data = await response.json();
        } catch {
          /* Use the HTTP status below when the server did not return JSON. */
        }
        return { response, data };
      };

      let result = await deploy(false);
      if (result.response.status === 409 && result.data.existingFile) {
        const existing = result.data.existingFile;
        if (!window.confirm(
          `Replace the existing ${existing.name} (${existing.size} bytes) on the router?`,
        )) {
          setNotice({ type: "info", text: "Deployment cancelled. The existing router portal was left unchanged." });
          return;
        }
        result = await deploy(true);
      }

      if (!result.response.ok) {
        const serverMessage = [result.data.error, result.data.detail]
          .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
          .join(": ");
        throw new Error(serverMessage || `Portal deployment failed (HTTP ${result.response.status})`);
      }
      setNotice({
        type: "success",
        text: result.data.replaced
          ? `${result.data.destinationPath ?? "hotspot/login.html"} was replaced successfully.`
          : `${result.data.destinationPath ?? "hotspot/login.html"} was deployed successfully.`,
      });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The portal could not be deployed." });
    } finally {
      setDeploying(false);
    }
  };

  const handleInstallHotspotFiles = async () => {
    const routerId = Number(settings.routerId);
    const adminId = getSelectedTenantId();
    if (!Number.isSafeInteger(routerId) || routerId < 1) {
      setNotice({ type: "error", text: "Choose a linked router before installing hotspot files." });
      return;
    }
    if (!adminId) {
      setNotice({ type: "error", text: "Sign in to an ISP account before installing hotspot files." });
      return;
    }
    if (!window.confirm(
      "Install the approved hotspot files on this router? Existing files will be kept and skipped; only missing files in flash/hotspot will be added.",
    )) return;

    setInstallingHotspotFiles(true);
    setNotice(null);
    try {
      const result = await installHotspotFiles(routerId, adminId, getAdminApiToken());
      if (result.status !== "complete" || result.failed.length > 0 || result.error) {
        const firstFailure = result.failed[0];
        const detail = result.error
          || (firstFailure ? `${firstFailure.destinationPath}: ${firstFailure.error}` : "");
        const summary = `${result.deployed.length} added, ${result.skipped.length} already present, ${result.failed.length} failed`;
        setNotice({
          type: "error",
          text: `Hotspot file installation did not complete (${summary}).${detail ? ` ${detail}` : ""}`,
        });
      } else {
        setNotice({ type: "success", text: `Hotspot files installed: ${result.deployed.length} added, ${result.skipped.length} already present in flash/hotspot.` });
      }
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Hotspot files could not be installed." });
    } finally {
      setInstallingHotspotFiles(false);
    }
  };

  const handlePreview = async (port = selectedPortalPort) => {
    setShowPreview(true);
    setPreviewLoading(true);
    setNotice(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    try {
       if ((isResellerAccount || selectedAssignedPortId) && !port) {
         throw new Error("The selected Hotspot service is no longer available. Choose a service again.");
       }
       const html = await buildTargetPortal(port, true);
       if (!html) {
         setShowPreview(false);
         return;
       }
      setPreviewUrl(URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })));
    } catch (error) {
      setShowPreview(false);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "The portal preview could not be generated." });
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setShowPreview(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const presets = [
    { name: "Signal Orange", colors: { bgColor: "#081416", bgColor2: "#173638", primaryColor: "#d96835", accentColor: "#f09562", cardColor: "#12292b", buttonColor: "#168c78", textColor: "#ffffff", inputBgColor: "#0b1d1f" } },
    { name: "Purple Night", colors: DEFAULT_COLORS },
    { name: "Ocean Blue", colors: { bgColor: "#020b18", bgColor2: "#051e38", primaryColor: "#0ea5e9", accentColor: "#2563eb", cardColor: "#0c2340", buttonColor: "#10b981", textColor: "#ffffff", inputBgColor: "#020b18" } },
    { name: "Forest Green", colors: { bgColor: "#051a0e", bgColor2: "#0d2e1a", primaryColor: "#22c55e", accentColor: "#4ade80", cardColor: "#0d2e1a", buttonColor: "#f59e0b", textColor: "#ffffff", inputBgColor: "#040d07" } },
  ];

  const previewStyle = {
    "--mini-primary": settings.colors.primaryColor,
    "--mini-accent": settings.colors.accentColor,
    "--mini-button": settings.colors.buttonColor,
  } as React.CSSProperties;
  const visibleAssignedPorts = isResellerAccount && selectedAssignedPortId
    ? assignedPorts.filter(port => String(port.id) === selectedAssignedPortId)
    : assignedPorts;

  return (
    <AdminLayout>
      <style>{STYLES}</style>
      {showPreview && <PreviewModal url={previewUrl} loading={previewLoading} onClose={closePreview} />}
      <div className="hs-page">
        <header className="hs-hero">
          <div>
            <div className="hs-eyebrow"><Wifi size={13} /> Customer access experience</div>
            <h1 className="hs-title">{isResellerAccount ? "Assigned VLAN hotspot" : "Hotspot portal"}</h1>
            <p className="hs-subtitle">
              {isResellerAccount
                ? "Edit only the hotspot page assigned to your ISP-linked VLAN. Saving generates reseller-specific files and pushes them to the ISP MikroTik service directory."
                : <>Shape what customers see when they join your Wi-Fi, then export one ready-to-upload <strong> login.html</strong> with the same payment and RouterOS behavior.</>}
            </p>
          </div>
          <div className="hs-actions">
            <button type="button" className="hs-btn hs-btn-quiet" onClick={() => void handlePreview()} disabled={previewLoading || portsLoading}>
              {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
            </button>
            <button type="button" className="hs-btn hs-btn-soft" onClick={handleDownload} disabled={exporting || portsLoading}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />} Download HTML
            </button>
            {!isResellerAccount && <button type="button" className="hs-btn hs-btn-primary" onClick={handleDeploy} disabled={deploying || exporting || portsLoading || savingPortId !== null}>
              {deploying ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {deploying ? "Deploying…" : "Deploy to router"}
            </button>}
            {!isResellerAccount && <button type="button" className="hs-btn hs-btn-soft" onClick={handleInstallHotspotFiles} disabled={installingHotspotFiles || deploying || exporting}>
              {installingHotspotFiles ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />} {installingHotspotFiles ? "Installing files…" : "Install hotspot files"}
            </button>}
            {!isResellerAccount && <Link href="/admin/network/files" className="hs-btn hs-btn-quiet">
              <FolderOpen size={14} /> View router files
            </Link>}
            <button type="button" className="hs-btn hs-btn-primary" onClick={handleSave} disabled={saving || portsLoading || deploying || savingPortId !== null}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Syncing…" : saved ? "Synced" : isResellerAccount ? "Sync to MikroTik" : "Save settings"}
            </button>
          </div>
        </header>

        {notice && (
          <div className={`hs-status hs-status-${notice.type}`} style={{ marginBottom: 18 }}>
            {notice.type === "error" ? <AlertCircle size={16} /> : notice.type === "success" ? <Check size={16} /> : <Info size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="hs-grid">
          <main className="hs-stack">
            <Section icon={<LayoutTemplate size={16} />} title="Portal identity" description="Set the first impression customers get when they join your hotspot.">
              <Field label="ISP name" help="Used in the page title, header, footer, and downloaded filename.">
                <input className="hs-input" value={settings.ispName} maxLength={80} onChange={event => update("ispName", event.target.value)} placeholder="Your ISP name" />
              </Field>
               <Field label="Customer portal hostname" help="Point DNS to the shared application; HTTPS is provisioned after it resolves. New exports use this host only if its API health check passes, otherwise they use the tenant API address. Saving does not update existing router files.">
                 <input className="hs-input" value={settings.portalHostname} maxLength={253} onChange={event => update("portalHostname", event.target.value)} placeholder="wifi.example.com" inputMode="url" />
               </Field>
              <Field label="Tagline" help="A short promise shown below the portal title.">
                <input className="hs-input" value={settings.tagline} maxLength={120} onChange={event => update("tagline", event.target.value)} placeholder="Fast and reliable internet" />
              </Field>
               <Field label={isResellerAccount ? "Assigned MikroTik VLAN interface" : "Linked router"} help={isResellerAccount ? "Use the VLAN interface name assigned on the MikroTik. Syncing this service writes changes to that VLAN interface." : "Keeps this workspace’s hotspot export associated with the selected router."}>
                 {(!isResellerAccount && routersLoading) ? <div className="hs-status hs-status-info"><Loader2 size={14} className="animate-spin" /> Loading routers…</div> : (
                  <div className="hs-select-wrap">
                     <select
                       className="hs-select"
                       value={isResellerAccount ? selectedAssignedPortId : settings.routerId}
                       onChange={event => {
                         if (!isResellerAccount) {
                            setSelectedAssignedPortId("");
                            setAssignedPorts([]);
                           update("routerId", event.target.value);
                           return;
                         }
                         const selected = assignedPorts.find(port => String(port.id) === event.target.value);
                         setSelectedAssignedPortId(event.target.value);
                         if (selected) update("routerId", String(selected.router_id));
                       }}
                       disabled={isResellerAccount && (portsLoading || assignedPorts.length === 0)}
                     >
                       <option value="">{isResellerAccount ? "No assigned VLAN interface found" : "Choose a router (optional)"}</option>
                       {isResellerAccount
                         ? assignedPorts.map(port => (
                           <option key={port.id} value={port.id}>
                             {port.interface_name}{port.vlan_tag ? ` · VLAN ${port.vlan_tag}` : ""}{port.status ? ` · ${port.status}` : ""}
                           </option>
                         ))
                         : routers.map(router => (
                           <option key={router.id} value={router.id}>
                             {router.name}{router.host ? ` — ${router.host}` : ""}
                           </option>
                         ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                )}
              </Field>
               {!isResellerAccount && portalTargets.length > 0 && (
                 <Field label="Portal service" help="Preview, download, save, and deploy use this exact service's plans and isolated Hotspot folder.">
                   <div className="hs-select-wrap">
                     <select className="hs-select" value={selectedAssignedPortId} onChange={event => setSelectedAssignedPortId(event.target.value)} disabled={portsLoading}>
                       <option value="">Router-wide portal (no assigned-port plans)</option>
                       {portalTargets.map(port => (
                         <option key={port.id} value={port.id}>{port.interface_name} · service #{port.id}</option>
                       ))}
                     </select>
                     <ChevronDown size={14} />
                   </div>
                 </Field>
               )}
              <Field label="Portal status" help="Maintenance mode keeps the page available while replacing purchases with your message.">
                <SelectField value={settings.maintenanceMode} onChange={value => update("maintenanceMode", value)} options={["Online", "Maintenance"]} />
              </Field>
              {settings.maintenanceMode === "Maintenance" && (
                <Field label="Maintenance message" help="Shown to visitors while new purchases are paused.">
                  <textarea className="hs-textarea" value={settings.maintenanceMessage} maxLength={240} onChange={event => update("maintenanceMessage", event.target.value)} />
                </Field>
              )}
              <Field label="Logo" help="PNG, JPG, or WebP. The file is embedded in the exported HTML.">
                <FilePicker label="Choose logo" value={settings.logoUrl} accept=".png,.jpg,.jpeg,.webp" onSelect={file => handleFile("logoUrl", file)} />
              </Field>
            </Section>

            <Section icon={<Wifi size={16} />} title={isResellerAccount ? "Your assigned VLAN hotspot" : "Assigned hotspot ports"} description={isResellerAccount ? "This is the only VLAN service and hotspot page this reseller account can edit. Save to create isolated login.html and rlogin.html files on the ISP MikroTik." : "View and edit the isolated services assigned to the selected router. New ports use separate /24 networks from 192.168.180.0/22."}>
               {!settings.routerId && !isResellerAccount ? (
                <div className="hs-status hs-status-info"><Info size={15} /> Choose a linked router above to load its assigned physical ports.</div>
              ) : portsLoading ? (
                <div className="hs-status hs-status-info"><Loader2 size={15} className="animate-spin" /> Loading assigned ports…</div>
               ) : visibleAssignedPorts.length === 0 ? (
                 <div className="hs-status hs-status-info"><Info size={15} /> {isResellerAccount ? "No VLAN interface has been assigned to this reseller yet." : "No physical port services are assigned to this router yet. Use Multiport to assign one."}</div>
              ) : (
                <div style={{ display: "grid", gap: 14, padding: "14px 0 8px" }}>
                   {visibleAssignedPorts.map(port => {
                    const draft = portDrafts[port.id];
                    if (!draft) return null;
                    const statusColor = port.status === "active" || port.status === "completed"
                      ? "#86efac"
                      : port.status === "failed" || port.status === "error"
                        ? "#fca5a5"
                        : "#fcd34d";
                    return (
                      <div key={port.id} style={{ border: "1px solid var(--isp-border)", borderRadius: 11, padding: 14, background: "var(--isp-input-bg)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                          <div>
                            <div style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: ".82rem" }}>{port.interface_name}</div>
                             <div style={{ color: "var(--isp-text-sub)", fontSize: ".67rem", marginTop: 3 }}>
                               Port service #{port.id}
                               {port.vlan_tag ? ` · VLAN ${port.vlan_tag}` : ""}
                               {draft.pppoeEnabled ? " · PPPoE enabled" : ""}
                             </div>
                          </div>
                          <span style={{ color: statusColor, fontSize: ".68rem", fontWeight: 800, textTransform: "capitalize" }}>{port.status}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontSize: ".75rem", fontWeight: 700 }}>
                            <input type="checkbox" checked={draft.hotspotEnabled} onChange={event => updateAssignedPort(port.id, "hotspotEnabled", event.target.checked)} />
                            Hotspot portal enabled
                          </label>
                          <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                            Portal DNS name
                            <input className="hs-input" value={draft.hotspotDnsName} onChange={event => updateAssignedPort(port.id, "hotspotDnsName", event.target.value)} placeholder="hotspot.example.com" />
                          </label>
                          {port.handoff_mode === "vlan_services" && port.assigned_reseller_id && (
                            <>
                              {isResellerAccount ? (
                                <div style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                                  MikroTik NAS identity
                                  <div style={{ color: "var(--isp-text)", fontSize: ".76rem", fontWeight: 700 }}>
                                    {draft.nasIdentifier || "Detected during ISP portal deployment"}
                                  </div>
                                </div>
                              ) : (
                                <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                                  MikroTik NAS identity (auto-detected; manual fallback)
                                  <input
                                    className="hs-input"
                                    value={draft.nasIdentifier}
                                    maxLength={128}
                                    pattern="[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}"
                                    title="Use 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens."
                                    onChange={event => updateAssignedPort(port.id, "nasIdentifier", event.target.value)}
                                    placeholder="Detected from router on deployment"
                                  />
                                  <span style={{ color: "var(--isp-text-sub)", fontWeight: 400, lineHeight: 1.4 }}>
                                    Read from the router during portal deployment. A saved value is used if the identity cannot be read; the unique HotSpot server name still identifies each VLAN.
                                  </span>
                                </label>
                              )}
                              <div style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                                HotSpot server name
                                <div style={{ color: "var(--isp-text)", fontSize: ".76rem", fontWeight: 700 }}>
                                  {port.hotspot_server_name || "Generated during VLAN provisioning"}
                                </div>
                              </div>
                            </>
                          )}
                            {port.handoff_mode === "vlan_services" ? (
                             <div style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                               Reseller hotspot files
                               <div style={{ color: "var(--isp-text)", fontSize: ".76rem", fontWeight: 700 }}>Generated as login.html + rlogin.html in an isolated VLAN folder.</div>
                             </div>
                           ) : (
                             <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                               Hotspot asset path
                               <input className="hs-input" value={draft.hotspotFolderPath} onChange={event => updateAssignedPort(port.id, "hotspotFolderPath", event.target.value)} placeholder="login.html" />
                             </label>
                           )}
                          <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                            Service bridge
                            <input className="hs-input" value={draft.bridgeName} onChange={event => updateAssignedPort(port.id, "bridgeName", event.target.value)} placeholder="router-bridge-ether2" />
                          </label>
                          <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                            Private service subnet
                            <input className="hs-input" value={draft.subnetRange} onChange={event => updateAssignedPort(port.id, "subnetRange", event.target.value)} placeholder="192.168.180.0/24" />
                          </label>
                          <label style={{ display: "grid", gap: 5, color: "var(--isp-text-muted)", fontSize: ".68rem" }}>
                            Bandwidth cap (Mbps)
                            <input className="hs-input" type="number" min="1" max="100000" value={draft.bandwidthCapMbps} onChange={event => updateAssignedPort(port.id, "bandwidthCapMbps", event.target.value)} />
                          </label>
                        </div>
                        {port.handoff_mode === "vlan_services" && port.assigned_reseller_id && !draft.nasIdentifier && (
                          <div className="hs-status hs-status-info" style={{ marginTop: 11 }}>
                            <Info size={14} /> The next portal deployment will detect and map the router identity automatically. If it cannot be read, the ISP administrator can enter it here.
                          </div>
                        )}
                        {port.provisioning_error && (
                          <div className="hs-status hs-status-error" style={{ marginTop: 11 }}>
                            <AlertCircle size={14} /> <span>{port.provisioning_error}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, flexWrap: "wrap", marginTop: 12 }}>
                           {portalTargets.some(target => target.id === port.id) && (
                             <button type="button" className="hs-btn hs-btn-quiet" onClick={() => {
                               setSelectedAssignedPortId(String(port.id));
                               void handlePreview(port);
                             }} disabled={previewLoading || savingPortId === port.id}>
                               <Eye size={14} /> Preview {port.interface_name}
                             </button>
                           )}
                          <button type="button" className="hs-btn hs-btn-primary" onClick={() => void saveAssignedPort(port)} disabled={savingPortId === port.id || deletingPortId === port.id}>
                            {savingPortId === port.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                             {savingPortId === port.id ? "Syncing…" : isResellerAccount ? "Sync to MikroTik" : "Save port changes"}
                          </button>
                          <button type="button" className="hs-btn" onClick={() => void deleteAssignedPort(port)} disabled={savingPortId === port.id || deletingPortId === port.id} style={{ color: "#b91c1c", borderColor: "rgba(220,38,38,.35)", background: "rgba(220,38,38,.06)" }}>
                            {deletingPortId === port.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            {deletingPortId === port.id ? "Deleting…" : "Delete assignment"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section icon={<Palette size={16} />} title="Visual system" description="Use a consistent palette across plans, checkout, forms, and support content.">
              <div className="hs-color-grid">
                <ColorPicker label="Top background" value={settings.colors.bgColor} onChange={value => updateColor("bgColor", value)} />
                <ColorPicker label="Bottom background" value={settings.colors.bgColor2} onChange={value => updateColor("bgColor2", value)} />
                <ColorPicker label="Primary" value={settings.colors.primaryColor} onChange={value => updateColor("primaryColor", value)} />
                <ColorPicker label="Secondary" value={settings.colors.accentColor} onChange={value => updateColor("accentColor", value)} />
                <ColorPicker label="Cards" value={settings.colors.cardColor} onChange={value => updateColor("cardColor", value)} />
                <ColorPicker label="Action button" value={settings.colors.buttonColor} onChange={value => updateColor("buttonColor", value)} />
                <ColorPicker label="Text" value={settings.colors.textColor} onChange={value => updateColor("textColor", value)} />
                <ColorPicker label="Inputs" value={settings.colors.inputBgColor} onChange={value => updateColor("inputBgColor", value)} />
              </div>
              <div className="hs-presets">
                {presets.map(preset => (
                  <button key={preset.name} type="button" className="hs-preset" onClick={() => update("colors", { ...preset.colors })}>
                    <span className="hs-swatches">
                      {[preset.colors.bgColor, preset.colors.primaryColor, preset.colors.accentColor, preset.colors.buttonColor].map(color => <i key={color} style={{ background: color }} />)}
                    </span>
                    {preset.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section icon={<Sparkles size={16} />} title="Captive portal appearance" description="Choose a full-page layout, then set the background and package-card shape independently.">
              {appearanceLoading ? (
                <div className="hs-status hs-status-info"><Loader2 size={14} className="animate-spin" /> Loading portal appearance…</div>
              ) : (
                <>
                  <Field label="Full-page layout" help="This changes the customer page's overall composition and treatment. Your selected background and package-card shape remain independent.">
                    <div className="hs-layout-grid" role="group" aria-label="Hotspot sign-in page layout">
                      {HOTSPOT_PORTAL_LAYOUTS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className={`hs-layout-choice ${normalizeHotspotPortalLayout(settings.portalLayout) === option.value ? "active" : ""}`}
                          aria-pressed={normalizeHotspotPortalLayout(settings.portalLayout) === option.value}
                          aria-label={`${option.label}. ${option.description}`}
                          onClick={() => { update("portalLayout", option.value); setNotice(null); }}
                        >
                          <span
                            className={`hs-layout-thumb hs-layout-thumb-${option.value}`}
                            style={{
                              "--layout-preview-bg": option.background,
                              "--layout-preview-panel": option.panel,
                              "--layout-preview-accent": option.accent,
                            } as React.CSSProperties}
                            aria-hidden="true"
                          >
                            <i className="hs-layout-thumb-header" />
                            <i className="hs-layout-thumb-hero" />
                            <i className="hs-layout-thumb-plans" />
                          </span>
                          <span className="hs-layout-copy">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Portal background" help="This controls the main background of the generated hotspot page.">
                    <div className="hs-choice-grid">
                      {PORTAL_BACKGROUND_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className={`hs-choice ${portalBackground === option.value ? "active" : ""}`}
                          onClick={() => { setPortalBackground(option.value); setNotice(null); }}
                        >
                          <span className="hs-choice-preview" style={{ background: option.gradient }} />
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Package card shape" help="This changes the silhouette of each plan card in the customer portal.">
                    <div className="hs-choice-grid hs-shape-grid">
                      {PORTAL_PACKAGE_SHAPE_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className={`hs-choice ${portalPackageShape === option.value ? "active" : ""}`}
                          onClick={() => { setPortalPackageShape(option.value); setNotice(null); }}
                        >
                          <span className="hs-shape-preview" style={portalShapePreviewStyle(option.value)} />
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </Section>

            <Section icon={<Eye size={16} />} title="Sign-in page cards" description="Show or hide each customer-facing card on the hotspot sign-in page.">
              <p style={{ margin: "12px 0 0", color: "var(--isp-text-muted)", fontSize: ".7rem", lineHeight: 1.5 }}>
                Hiding a card removes it from the customer page without deleting its content or changing router configuration.
              </p>
              <div className="hs-visibility-grid">
                {HOTSPOT_PORTAL_CARD_OPTIONS.map(card => {
                  const enabled = settings.portalCards[card.key];
                  return (
                    <button
                      key={card.key}
                      type="button"
                      className="hs-visibility-card"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${card.label} visibility`}
                      onClick={() => updatePortalCard(card.key, !enabled)}
                    >
                      <span className="hs-visibility-copy">
                        <strong>{card.label}</strong>
                        <small>{card.description}</small>
                      </span>
                      <span className="hs-visibility-switch" aria-hidden="true"><span /></span>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section icon={<Smartphone size={16} />} title="Checkout & access" description="Choose which access paths appear and make the payment step easy to understand.">
              <Field label="M-Pesa STK prompt" help="Show the phone-number checkout that sends a PIN approval prompt to the customer's M-Pesa line.">
                <SelectField value={settings.mpesaPrompt} onChange={value => update("mpesaPrompt", value)} options={["Enable", "Disable"]} />
              </Field>
              <Field label="Free trial" help="Keep the existing free-trial setting available to the portal installer.">
                <SelectField value={settings.freeTrial} onChange={value => update("freeTrial", value)} options={["Disable", "Enable"]} />
              </Field>
              <Field label="Payment instructions" help="Shown in the M-Pesa checkout dialog before a customer approves the prompt.">
                <textarea className="hs-textarea" value={settings.paymentInstructions} maxLength={240} onChange={event => update("paymentInstructions", event.target.value)} />
              </Field>
              <Field label="Announcement" help="Optional notice for outages, promotions, or location-specific guidance.">
                <textarea className="hs-textarea" value={settings.announcement} maxLength={240} onChange={event => update("announcement", event.target.value)} placeholder="e.g. Weekend offer: get 2 hours for Ksh 20." />
              </Field>
              <Field label="Advert banner" help="Optional banner embedded in the page. Maximum 500 KB.">
                <FilePicker label="Choose banner" value={settings.advertUrl} accept=".png,.jpg,.jpeg,.webp" onSelect={file => handleFile("advertUrl", file)} />
              </Field>
              <Field label="Advert position" help="Choose where the enabled banner appears.">
                <SelectField value={settings.advertPos} onChange={value => update("advertPos", value)} options={["Top", "Middle", "Bottom"]} />
              </Field>
            </Section>

            <Section icon={<CircleHelp size={16} />} title="Trust & support" description="Give customers a clear way to get help and understand your service.">
              <Field label="Support phone" help="Shown as a call-to-action in the portal header and footer.">
                <div style={{ position: "relative" }}><Phone size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} value={settings.supportPhone} maxLength={30} onChange={event => update("supportPhone", event.target.value)} placeholder="07XX XXX XXX" /></div>
              </Field>
              <Field label="Support email" help="Optional support mailbox for the portal footer.">
                <div style={{ position: "relative" }}><Mail size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="email" value={settings.supportEmail} maxLength={120} onChange={event => update("supportEmail", event.target.value)} placeholder="support@example.com" /></div>
              </Field>
              <Field label="WhatsApp number" help="Digits only or a country-code number; used for the floating support button.">
                <div style={{ position: "relative" }}><Smartphone size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} value={settings.whatsappNumber} maxLength={20} onChange={event => update("whatsappNumber", event.target.value)} placeholder="2547XXXXXXXX" /></div>
              </Field>
              <Field label="Terms link" help="Optional HTTPS link displayed in the footer.">
                <div style={{ position: "relative" }}><Link2 size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="url" value={settings.termsUrl} maxLength={300} onChange={event => update("termsUrl", event.target.value)} placeholder="https://example.com/terms" /></div>
              </Field>
              <Field label="Privacy link" help="Optional HTTPS link displayed in the footer.">
                <div style={{ position: "relative" }}><ShieldCheck size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--isp-text-sub)" }} /><input className="hs-input" style={{ paddingLeft: 32 }} type="url" value={settings.privacyUrl} maxLength={300} onChange={event => update("privacyUrl", event.target.value)} placeholder="https://example.com/privacy" /></div>
              </Field>
              {settings.portalCards.testimonials && (
                <Field label="Customer quote">
                  <textarea className="hs-textarea" value={settings.testimonialText} maxLength={300} onChange={event => update("testimonialText", event.target.value)} />
                </Field>
              )}
              {settings.portalCards.faq && (
                <Field label="FAQ content" help="Use a new line between the question and answer.">
                  <textarea className="hs-textarea" value={settings.faqText} maxLength={700} onChange={event => update("faqText", event.target.value)} />
                </Field>
              )}
            </Section>

            <div className="hs-foot-actions">
              <button type="button" className="hs-btn hs-btn-quiet" onClick={() => void handlePreview()} disabled={previewLoading || portsLoading}><Eye size={14} /> Preview portal</button>
              <button type="button" className="hs-btn hs-btn-primary" onClick={handleSave} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? "Saving…" : "Save settings"}</button>
            </div>
          </main>

          <aside className="hs-stack hs-side">
            <section className="hs-card hs-side-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><Sparkles size={16} /></div>
                <div><h2 className="hs-card-title">Live design snapshot</h2><p className="hs-card-desc">A quick look at your current identity.</p></div>
              </div>
              <div className="hs-side-body">
                <div className="hs-preview-screen" style={previewStyle}>
                  <div className="hs-mini-content">
                    <div className="hs-mini-logo">
                      {settings.logoUrl
                        ? <img src={settings.logoUrl} alt="" />
                        : <Wifi size={22} aria-hidden="true" />}
                    </div>
                    <h3>{safeText(settings.ispName, "Your ISP")}</h3>
                    <p>{safeText(settings.tagline, "Fast and reliable internet")}</p>
                    <div className="hs-mini-plans">
                      <div className="hs-mini-plan"><b>Hourly</b><span>From Ksh 20</span></div>
                      <div className="hs-mini-plan"><b>Daily</b><span>Instant access</span></div>
                    </div>
                    <div className="hs-mini-button">Connect with M-Pesa</div>
                  </div>
                </div>
                <div className="hs-side-note"><Info size={14} /> Preview and download use the same generated portal template, including the configured tenant API origin.</div>
              </div>
            </section>

            <section className="hs-card hs-side-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><ArrowDownToLine size={16} /></div>
                <div><h2 className="hs-card-title">Export checklist</h2><p className="hs-card-desc">What the HTML export keeps intact.</p></div>
              </div>
              <div className="hs-side-body">
                <ul className="hs-checklist">
                  <li><Check size={14} /> RouterOS redirect variables and login form conventions</li>
                  <li><Check size={14} /> Tenant-scoped plan loading and M-Pesa status polling</li>
                  <li><Check size={14} /> Paid-device MAC access, voucher, and member login paths</li>
                  <li><Check size={14} /> Branding and content embedded safely in the downloaded file</li>
                  <li><Check size={14} /> No router credentials, payment secrets, or VPN keys</li>
                </ul>
              </div>
            </section>

            <section className="hs-card">
              <div className="hs-card-head">
                <div className="hs-card-icon"><ShieldCheck size={16} /></div>
                <div><h2 className="hs-card-title">Safe publishing</h2><p className="hs-card-desc">Keep the write boundary clear.</p></div>
              </div>
              <div className="hs-side-body">
                 <div className="hs-status hs-status-info">
                  <Info size={15} />
                   <span>Download keeps a local <strong>login.html</strong> copy. Deploy sends this exact export to the selected router only after confirmation; an existing file is never replaced without a second confirmation.</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}