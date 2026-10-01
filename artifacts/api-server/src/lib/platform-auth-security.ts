import {
  ADMIN_PAGE_VISIBILITY_CATALOG,
  ADMIN_PAGE_VISIBILITY_KEYS,
} from "./admin-page-visibility.js";
import {
  insertPlatformAuthAudit,
  selectPlatformAuthPolicy,
  upsertPlatformAuthPolicy,
  type PlatformAuthPolicyRow,
} from "./platform-auth-store.js";

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
  ADMIN_PAGE_VISIBILITY_CATALOG.flatMap(section => section.pages.map(page => page.key)),
);

function sanitizeMatrix(raw: unknown): PageAuthMethodMatrix {
  const result: PageAuthMethodMatrix = { isp_admin: {}, reseller: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const source = raw as Record<string, unknown>;
  for (const role of ADMIN_POLICY_ROLES) {
    const roleValue = source[role];
    if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
    for (const [key, value] of Object.entries(roleValue as Record<string, unknown>)) {
      if (!ALL_PAGE_KEYS.has(key)) continue;
      if (typeof value === "boolean") {
        result[role][key] = value ? "password" : "none";
      } else if (
        value === "none" || value === "password" ||
        value === "whatsapp" || value === "sms" || value === "email"
      ) {
        result[role][key] = value;
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
    for (const [key, value] of Object.entries(roleInput as Record<string, unknown>)) {
      if (!ALL_PAGE_KEYS.has(key)) return null;
      if (typeof value === "boolean") {
        normalized[role][key] = value ? "password" : "none";
      } else if (
        value === "none" || value === "password" ||
        value === "whatsapp" || value === "sms" || value === "email"
      ) {
        normalized[role][key] = value;
      } else {
        return null;
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
  return ADMIN_PAGE_VISIBILITY_KEYS.has(feature) && feature !== "overview" && ALL_PAGE_KEYS.has(feature);
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
  ["/settings", "admin.settings"],
  ["/admin-settings", "admin.settings"],
  ["/storage-governance", "admin.settings"],
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