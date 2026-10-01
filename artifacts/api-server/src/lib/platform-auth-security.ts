import {
  ADMIN_PAGE_VISIBILITY_CATALOG,
  type AdminVisibilitySection,
} from "./admin-page-visibility.js";
import {
  insertPlatformAuthAudit,
  selectPlatformAuthPolicy,
  upsertPlatformAuthPolicy,
  type PlatformAuthPolicyRow,
} from "./platform-auth-store.js";

const SETTINGS_AUTH_PAGES = [
  { key: "settings.profile", label: "ISP Profile", description: "Company identity, portal branding, and support details." },
  { key: "settings.billing", label: "Billing & M-Pesa", description: "Billing preferences and M-Pesa configuration." },
  { key: "settings.gateways", label: "Payment Gateways", description: "Payment gateway connections and routing." },
  { key: "settings.dashboard", label: "Dashboard Page Builder", description: "Configure the customer dashboard page." },
  { key: "settings.typography", label: "Desired Font", description: "Choose the application font and typography." },
  { key: "settings.sms", label: "SMS & Email", description: "Configure SMS, email, and delivery settings." },
  { key: "settings.network", label: "Network", description: "Configure network-related ISP settings." },
  { key: "settings.hotspot", label: "Hotspot", description: "Configure hotspot behavior and portal defaults." },
  { key: "settings.security", label: "Security", description: "Configure security and account protections." },
  { key: "settings.notifications", label: "Notifications", description: "Configure system and customer notifications." },
  { key: "settings.system", label: "System", description: "Manage system, storage, and backup settings." },
  { key: "settings.plugins", label: "Plugins", description: "Manage optional platform plugins." },
];

const LEGACY_SETTINGS_AUTH_KEY = "admin.settings";

export const ADMIN_PAGE_AUTH_CATALOG: AdminVisibilitySection[] = [
  ...ADMIN_PAGE_VISIBILITY_CATALOG
    .map(section => section.key === "admin"
      ? { ...section, pages: section.pages.filter(page => page.key !== LEGACY_SETTINGS_AUTH_KEY) }
      : section)
    .filter(section => section.pages.length > 0),
  {
    key: "settings",
    label: "Settings",
    description: "Each settings page has its own verification policy.",
    pages: SETTINGS_AUTH_PAGES,
  },
];

export type OtpChannel = "whatsapp" | "sms" | "email";
export type AdminPolicyRole = "isp_admin" | "reseller";
export type PageAuthMethod = "none" | "password" | OtpChannel;
export type PageAuthMethodMatrix = Record<AdminPolicyRole, Record<string, PageAuthMethod>>;

export interface PlatformAuthPolicy {
  otp: {
    allEnabled: boolean;
    channels: Record<OtpChannel, boolean>;
  };
  pageMethods: PageAuthMethodMatrix;
}

export const ADMIN_POLICY_ROLES: AdminPolicyRole[] = ["isp_admin", "reseller"];
export const PLATFORM_AUTH_POLICY_DEFAULTS: PlatformAuthPolicy = {
  otp: {
    allEnabled: false,
    channels: { whatsapp: false, sms: false, email: false },
  },
  pageMethods: {
    isp_admin: {},
    reseller: {},
  },
};

const ALL_PAGE_KEYS = new Set(
  ADMIN_PAGE_AUTH_CATALOG.flatMap(section => section.pages.map(page => page.key)),
);
const SETTINGS_AUTH_PAGE_KEYS = SETTINGS_AUTH_PAGES.map(page => page.key);

function parsePageAuthMethod(value: unknown): PageAuthMethod | null {
  if (typeof value === "boolean") return value ? "password" : "none";
  if (
    value === "none" || value === "password" ||
    value === "whatsapp" || value === "sms" || value === "email"
  ) return value;
  return null;
}

function sanitizeMatrix(raw: unknown): PageAuthMethodMatrix {
  const result: PageAuthMethodMatrix = { isp_admin: {}, reseller: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const source = raw as Record<string, unknown>;
  for (const role of ADMIN_POLICY_ROLES) {
    const roleValue = source[role];
    if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
    const rolePages = roleValue as Record<string, unknown>;
    for (const [key, value] of Object.entries(rolePages)) {
      if (!ALL_PAGE_KEYS.has(key)) continue;
      const method = parsePageAuthMethod(value);
      if (method) result[role][key] = method;
    }
    const legacySettingsMethod = parsePageAuthMethod(rolePages[LEGACY_SETTINGS_AUTH_KEY]);
    if (legacySettingsMethod) {
      for (const key of SETTINGS_AUTH_PAGE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(rolePages, key)) {
          result[role][key] = legacySettingsMethod;
        }
      }
    }
  }
  return result;
}

export function normalizePlatformAuthPolicy(row?: PlatformAuthPolicyRow): PlatformAuthPolicy {
  if (!row) return structuredClone(PLATFORM_AUTH_POLICY_DEFAULTS);
  return {
    otp: {
      allEnabled: row.otp_all_enabled === true,
      channels: {
        whatsapp: row.otp_whatsapp_enabled === true,
        sms: row.otp_sms_enabled === true,
        email: row.otp_email_enabled === true,
      },
    },
    pageMethods: sanitizeMatrix(row.password_reauth),
  };
}

export async function getPlatformAuthPolicy(): Promise<PlatformAuthPolicy> {
  const rows = await selectPlatformAuthPolicy();
  return normalizePlatformAuthPolicy(rows[0]);
}

export async function isOtpChannelEnabled(channel: OtpChannel): Promise<boolean> {
  const policy = await getPlatformAuthPolicy();
  return policy.otp.allEnabled && policy.otp.channels[channel];
}

export async function savePlatformAuthPolicy(
  policy: PlatformAuthPolicy,
  actorName: string,
): Promise<void> {
  await upsertPlatformAuthPolicy({
    otpAllEnabled: policy.otp.allEnabled,
    otpWhatsappEnabled: policy.otp.channels.whatsapp,
    otpSmsEnabled: policy.otp.channels.sms,
    otpEmailEnabled: policy.otp.channels.email,
    passwordReauth: policy.pageMethods,
    updatedBy: actorName,
  });
}

export function validatePlatformAuthPolicy(input: unknown): PlatformAuthPolicy | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  const otp = candidate.otp as Record<string, unknown> | undefined;
  const channels = otp?.channels as Record<string, unknown> | undefined;
  if (
    !otp || typeof otp.allEnabled !== "boolean" ||
    !channels || ["whatsapp", "sms", "email"].some(key => typeof channels[key] !== "boolean")
  ) return null;

  const matrixInput = candidate.pageMethods ?? candidate.passwordReauth;
  if (!matrixInput || typeof matrixInput !== "object" || Array.isArray(matrixInput)) return null;
  const matrix = matrixInput as Record<string, unknown>;
  const normalized: PageAuthMethodMatrix = { isp_admin: {}, reseller: {} };
  for (const role of ADMIN_POLICY_ROLES) {
    const roleInput = matrix[role];
    if (!roleInput || typeof roleInput !== "object" || Array.isArray(roleInput)) return null;
    const rolePages = roleInput as Record<string, unknown>;
    let legacySettingsMethod: PageAuthMethod | null = null;
    for (const [key, value] of Object.entries(rolePages)) {
      if (key !== LEGACY_SETTINGS_AUTH_KEY && !ALL_PAGE_KEYS.has(key)) return null;
      const method = parsePageAuthMethod(value);
      if (!method) return null;
      if (key === LEGACY_SETTINGS_AUTH_KEY) {
        legacySettingsMethod = method;
      } else {
        normalized[role][key] = method;
      }
    }
    if (legacySettingsMethod) {
      for (const key of SETTINGS_AUTH_PAGE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(rolePages, key)) {
          normalized[role][key] = legacySettingsMethod;
        }
      }
    }
  }

  return {
    otp: {
      allEnabled: otp.allEnabled,
      channels: {
        whatsapp: channels.whatsapp as boolean,
        sms: channels.sms as boolean,
        email: channels.email as boolean,
      },
    },
    pageMethods: normalized,
  };
}

export async function recordPlatformAuthAudit(input: {
  actorName: string;
  action: string;
  targetAdminId?: number | null;
  impersonationSessionId?: string | null;
  details?: Record<string, unknown>;
  sourceIp?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await insertPlatformAuthAudit(input);
}

export function isSupportedPasswordReauthFeature(feature: string): boolean {
  return feature === LEGACY_SETTINGS_AUTH_KEY || ALL_PAGE_KEYS.has(feature);
}

const API_REAUTH_PREFIXES: Array<[string, string]> = [
  ["/router-migrations", "network.migration"],
  ["/router-user-snapshots", "network.migration"],
  ["/self-install", "network.self-install"],
  ["/replace-router", "network.replace-router"],
  ["/load-balancing", "network.load-balancing"],
  ["/port-services", "network.multiport"],
  ["/multiport", "network.multiport"],
  ["/resellers", "network.resellers"],
  ["/customers", "customers.customers"],
  ["/customer", "customers.customers"],
  ["/activation", "customers.activation"],
  ["/prepaid", "customers.activation"],
  ["/vouchers", "customers.vouchers"],
  ["/plans", "billing.plans"],
  ["/transactions", "billing.transactions"],
  ["/billing", "billing.transactions"],
  ["/invoices", "billing.transactions"],
  ["/routers", "network.routers"],
  ["/mikrotik", "network.routers"],
  ["/vpn", "tools.vpn"],
  ["/pppoe", "network.pppoe"],
  ["/ppp", "network.ppp"],
  ["/wireless", "network.wireless"],
  ["/queues", "network.queues"],
  ["/ip-pools", "network.ip-pools"],
  ["/router-api-config", "network.router-api-config"],
  ["/bridge", "network.bridge-ports"],
  ["/access-points", "network.access-points"],
  ["/hotspot", "network.hotspot-settings"],
  ["/reseller", "network.resellers"],
  ["/files", "network.files"],
  ["/webhooks", "tools.webhooks"],
  ["/bulk", "tools.bulk"],
  ["/uisp", "tools.uisp"],
  ["/bonga", "tools.bonga"],
  ["/acs", "tools.acs"],
  ["/page-builder", "tools.page-builder"],
  ["/support", "admin.support"],
  ["/notifications", "admin.notifications"],
  ["/logs", "admin.logs"],
  ["/sms", "admin.extras"],
  ["/whatsapp", "admin.extras"],
  ["/settings/mpesa", "settings.billing"],
  ["/admin-settings", "settings.profile"],
  ["/storage-governance", "settings.system"],
  ["/radius", "admin.radius"],
  ["/static-pages", "admin.pages"],
];

export function getAdminApiReauthFeature(path: string): string | null {
  const pathname = path.split("?")[0].replace(/^\/api(?=\/)/, "");
  const match = API_REAUTH_PREFIXES.find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}-`),
  );
  return match?.[1] ?? null;
}

export async function getPageAuthMethod(
  role: AdminPolicyRole,
  feature: string,
): Promise<PageAuthMethod> {
  if (!isSupportedPasswordReauthFeature(feature)) return "none";
  const policy = await getPlatformAuthPolicy();
  return policy.pageMethods[role][feature] ?? "none";
}