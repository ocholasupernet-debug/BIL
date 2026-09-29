import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  sbInsertStrict,
  sbRpc,
  sbSelect,
  sbSelectStrict,
  sbUpsertStrict,
  sbUpdate,
  supabaseServiceRoleConfigured,
} from "../../lib/supabase-client.js";
import { generateToken } from "../../lib/api-auth.js";
import { logger } from "../../lib/logger.js";
import { RESERVED_SUBDOMAINS, TENANT_BASE_DOMAIN } from "../../lib/tenant-host.js";
import {
  decryptWhatsAppSecret,
  encryptWhatsAppSecret,
  type EncryptedWhatsAppSecret,
} from "./whatsapp-crypto.js";

export type WhatsAppFeature =
  | "login"
  | "registrationVerification"
  | "passwordRecovery"
  | "paymentNotifications"
  | "packageNotifications"
  | "ispNotifications"
  | "resellerNotifications"
  | "customerNotifications"
  | "securityNotifications"
  | "selfService";

export interface WhatsAppSettings {
  enabled: boolean;
  features: Record<WhatsAppFeature, boolean>;
  businessAccountId: string;
  phoneNumberId: string;
  businessPhone: string;
  apiVersion: string;
  defaultCountryCode: string;
  language: string;
  templates: {
    authentication: string;
    payment: string;
    renewal: string;
    expiry: string;
    ispSubscription: string;
    reseller: string;
    welcome: string;
    accountStatus: string;
    security: string;
    suspiciousSignIn: string;
    test: string;
  };
}

interface StoredSettingsRow {
  config: unknown;
}

interface StoredWhatsAppCredentialsRow {
  id: string;
  access_token: EncryptedWhatsAppSecret | null;
  webhook_verify_token: EncryptedWhatsAppSecret | null;
  app_secret: EncryptedWhatsAppSecret | null;
}

export interface WhatsAppServerCredentials {
  accessToken: string;
  webhookVerifyToken: string;
  appSecret: string;
}

type WhatsAppCredentialSource = "super-admin" | "environment" | "missing";

export interface WhatsAppSecretsStatus {
  accessTokenConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  accessTokenSource: WhatsAppCredentialSource;
  webhookVerifyTokenSource: WhatsAppCredentialSource;
  appSecretSource: WhatsAppCredentialSource;
}

export interface WhatsAppMessageResult {
  messageId: string;
}

export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

const SETTINGS_ID = "global_whatsapp";
const FEATURE_KEYS: WhatsAppFeature[] = [
  "login",
  "registrationVerification",
  "passwordRecovery",
  "paymentNotifications",
  "packageNotifications",
  "ispNotifications",
  "resellerNotifications",
  "customerNotifications",
  "securityNotifications",
  "selfService",
];

const DEFAULT_SETTINGS: WhatsAppSettings = {
  enabled: false,
  features: {
    login: false,
    registrationVerification: false,
    passwordRecovery: false,
    paymentNotifications: false,
    packageNotifications: false,
    ispNotifications: false,
    resellerNotifications: false,
    customerNotifications: false,
    securityNotifications: false,
    selfService: false,
  },
  businessAccountId: "",
  phoneNumberId: "",
  businessPhone: "",
  apiVersion: "v23.0",
  defaultCountryCode: "254",
  language: "en",
  templates: {
    authentication: "",
    payment: "",
    renewal: "",
    expiry: "",
    ispSubscription: "",
    reseller: "",
    welcome: "",
    accountStatus: "",
    security: "",
    suspiciousSignIn: "",
    test: "",
  },
};

function sessionSecret(): string {
  return process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "";
}

function cleanString(value: unknown, maxLength = 160): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanSettings(value: unknown): WhatsAppSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const features = input.features && typeof input.features === "object" && !Array.isArray(input.features)
    ? input.features as Record<string, unknown>
    : {};
  const templates = input.templates && typeof input.templates === "object" && !Array.isArray(input.templates)
    ? input.templates as Record<string, unknown>
    : {};
  const apiVersion = cleanString(input.apiVersion, 12);
  const countryCode = cleanString(input.defaultCountryCode, 5).replace(/\D/g, "");
  return {
    enabled: input.enabled === true,
    features: Object.fromEntries(FEATURE_KEYS.map(key => [key, features[key] === true])) as Record<WhatsAppFeature, boolean>,
    businessAccountId: cleanString(input.businessAccountId, 80),
    phoneNumberId: cleanString(input.phoneNumberId, 80),
    businessPhone: cleanString(input.businessPhone, 32),
    apiVersion: /^v\d+\.\d+$/.test(apiVersion) ? apiVersion : DEFAULT_SETTINGS.apiVersion,
    defaultCountryCode: countryCode.length >= 1 && countryCode.length <= 4 ? countryCode : "254",
    language: /^[a-z]{2}(?:_[A-Z]{2})?$/.test(cleanString(input.language, 10))
      ? cleanString(input.language, 10)
      : "en",
    templates: {
      authentication: cleanString(templates.authentication, 100),
      payment: cleanString(templates.payment, 100),
      renewal: cleanString(templates.renewal, 100),
      expiry: cleanString(templates.expiry, 100),
      ispSubscription: cleanString(templates.ispSubscription, 100),
      reseller: cleanString(templates.reseller, 100),
      welcome: cleanString(templates.welcome, 100),
      accountStatus: cleanString(templates.accountStatus, 100),
      security: cleanString(templates.security, 100),
      suspiciousSignIn: cleanString(templates.suspiciousSignIn, 100),
      test: cleanString(templates.test, 100),
    },
  };
}

function environmentSettings(): Partial<WhatsAppSettings> {
  return {
    enabled: process.env.WHATSAPP_ENABLED === "true" ? true : undefined,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessPhone: process.env.WHATSAPP_BUSINESS_PHONE,
    apiVersion: process.env.WHATSAPP_API_VERSION,
    defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE,
    templates: {
      authentication: process.env.WHATSAPP_AUTHENTICATION_TEMPLATE ?? "",
      payment: process.env.WHATSAPP_PAYMENT_TEMPLATE ?? "",
      renewal: process.env.WHATSAPP_RENEWAL_TEMPLATE ?? "",
      expiry: process.env.WHATSAPP_EXPIRY_TEMPLATE ?? "",
      ispSubscription: process.env.WHATSAPP_ISP_SUBSCRIPTION_TEMPLATE ?? "",
      reseller: process.env.WHATSAPP_RESELLER_TEMPLATE ?? "",
      welcome: process.env.WHATSAPP_WELCOME_TEMPLATE ?? "",
      accountStatus: process.env.WHATSAPP_ACCOUNT_STATUS_TEMPLATE ?? "",
      security: process.env.WHATSAPP_SECURITY_TEMPLATE ?? "",
      suspiciousSignIn: process.env.WHATSAPP_SUSPICIOUS_SIGN_IN_TEMPLATE ?? "",
      test: process.env.WHATSAPP_TEST_TEMPLATE ?? "",
    },
  };
}

function overlayEnvironment(stored: WhatsAppSettings, hasStoredConfig: boolean): WhatsAppSettings {
  const env = environmentSettings();
  const envTemplates = env.templates ?? {};
  return cleanSettings({
    ...stored,
    ...Object.fromEntries(
      ["businessAccountId", "phoneNumberId", "businessPhone", "apiVersion", "defaultCountryCode"]
        .filter(key => !!env[key as keyof typeof env])
        .map(key => [key, env[key as keyof typeof env]]),
    ),
    enabled: process.env.WHATSAPP_ENABLED === "false"
      ? false
      : !hasStoredConfig && process.env.WHATSAPP_ENABLED === "true"
        ? true
        : stored.enabled,
    templates: Object.fromEntries(
      Object.keys(stored.templates).map(key => [
        key,
        envTemplates[key as keyof typeof envTemplates] || stored.templates[key as keyof typeof stored.templates],
      ]),
    ),
  });
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  let stored = DEFAULT_SETTINGS;
  let hasStoredConfig = false;
  const rows = await sbSelectStrict<StoredSettingsRow>(
    "platform_whatsapp_settings",
    `id=eq.${SETTINGS_ID}&select=config&limit=1`,
  );
  if (rows[0]) {
    stored = cleanSettings(rows[0].config);
    hasStoredConfig = true;
  }
  return overlayEnvironment(stored, hasStoredConfig);
}

async function storedWhatsAppCredentials(): Promise<StoredWhatsAppCredentialsRow | null> {
  const rows = await sbSelectStrict<StoredWhatsAppCredentialsRow>(
    "platform_whatsapp_credentials",
    `id=eq.${SETTINGS_ID}&select=id,access_token,webhook_verify_token,app_secret&limit=1`,
  );
  return rows[0] ?? null;
}

function credentialSource(
  stored: EncryptedWhatsAppSecret | null | undefined,
  environmentValue: string | undefined,
): WhatsAppCredentialSource {
  if (stored?.ciphertext) return "super-admin";
  if (environmentValue?.trim()) return "environment";
  return "missing";
}

export async function getWhatsAppSecretsStatus(): Promise<WhatsAppSecretsStatus> {
  const stored = await storedWhatsAppCredentials();
  const accessTokenSource = credentialSource(stored?.access_token, process.env.WHATSAPP_ACCESS_TOKEN);
  const webhookVerifyTokenSource = credentialSource(
    stored?.webhook_verify_token,
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
  const appSecretSource = credentialSource(stored?.app_secret, process.env.WHATSAPP_APP_SECRET);
  return {
    accessTokenConfigured: accessTokenSource !== "missing",
    webhookVerifyTokenConfigured: webhookVerifyTokenSource !== "missing",
    appSecretConfigured: appSecretSource !== "missing",
    accessTokenSource,
    webhookVerifyTokenSource,
    appSecretSource,
  };
}

function decryptStoredCredential(
  encrypted: EncryptedWhatsAppSecret | null | undefined,
  environmentValue: string | undefined,
): string {
  if (encrypted?.ciphertext) {
    try {
      return decryptWhatsAppSecret(encrypted);
    } catch {
      throw new WhatsAppProviderError(
        "Stored WhatsApp credentials could not be decrypted. Re-enter them in Super Admin settings.",
      );
    }
  }
  return environmentValue?.trim() ?? "";
}

export async function getWhatsAppServerCredentials(): Promise<WhatsAppServerCredentials> {
  const stored = await storedWhatsAppCredentials();
  return {
    accessToken: decryptStoredCredential(stored?.access_token, process.env.WHATSAPP_ACCESS_TOKEN),
    webhookVerifyToken: decryptStoredCredential(
      stored?.webhook_verify_token,
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    ),
    appSecret: decryptStoredCredential(stored?.app_secret, process.env.WHATSAPP_APP_SECRET),
  };
}

export async function saveWhatsAppCredentials(input: unknown): Promise<WhatsAppSecretsStatus> {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const values = {
    access_token: typeof body.accessToken === "string" ? body.accessToken.trim() : "",
    webhook_verify_token: typeof body.webhookVerifyToken === "string" ? body.webhookVerifyToken.trim() : "",
    app_secret: typeof body.appSecret === "string" ? body.appSecret.trim() : "",
  };
  if (Object.values(values).every(value => !value)) {
    throw new Error("Enter at least one WhatsApp credential to save.");
  }
  if (values.access_token.length > 4096 ||
      values.webhook_verify_token.length > 1024 ||
      values.app_secret.length > 1024) {
    throw new Error("One or more WhatsApp credentials exceed the allowed length.");
  }

  const current = await storedWhatsAppCredentials();
  await sbUpsertStrict<StoredWhatsAppCredentialsRow>(
    "platform_whatsapp_credentials",
    "id",
    {
      id: SETTINGS_ID,
      access_token: values.access_token
        ? encryptWhatsAppSecret(values.access_token)
        : current?.access_token ?? null,
      webhook_verify_token: values.webhook_verify_token
        ? encryptWhatsAppSecret(values.webhook_verify_token)
        : current?.webhook_verify_token ?? null,
      app_secret: values.app_secret
        ? encryptWhatsAppSecret(values.app_secret)
        : current?.app_secret ?? null,
      updated_at: new Date().toISOString(),
    },
  );
  return getWhatsAppSecretsStatus();
}

export async function clearWhatsAppCredentials(): Promise<WhatsAppSecretsStatus> {
  await sbUpsertStrict<StoredWhatsAppCredentialsRow>(
    "platform_whatsapp_credentials",
    "id",
    {
      id: SETTINGS_ID,
      access_token: null,
      webhook_verify_token: null,
      app_secret: null,
      updated_at: new Date().toISOString(),
    },
  );
  return getWhatsAppSecretsStatus();
}

export async function saveWhatsAppSettings(input: unknown): Promise<WhatsAppSettings> {
  const current = await getWhatsAppSettings();
  const candidate = cleanSettings(input);
  const next = cleanSettings({
    ...current,
    ...candidate,
    features: candidate.features,
    templates: candidate.templates,
  });
  if (!supabaseServiceReady()) {
    throw new Error("Supabase service-role access is required to save WhatsApp settings.");
  }
  await sbUpsertStrict<StoredSettingsRow>("platform_whatsapp_settings", "id", {
    id: SETTINGS_ID,
    config: next,
    updated_at: new Date().toISOString(),
  });
  return overlayEnvironment(next, true);
}

function supabaseServiceReady(): boolean {
  return !!(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim()
  );
}

export function isWhatsAppEnabled(settings: WhatsAppSettings): boolean {
  return process.env.WHATSAPP_ENABLED !== "false" && settings.enabled;
}

export function isWhatsAppFeatureEnabled(
  settings: WhatsAppSettings,
  feature: WhatsAppFeature,
): boolean {
  return isWhatsAppEnabled(settings) && settings.features[feature];
}

async function requireProviderConfiguration(settings: WhatsAppSettings): Promise<{
  accessToken: string;
  phoneNumberId: string;
}> {
  const { accessToken } = await getWhatsAppServerCredentials();
  if (!isWhatsAppEnabled(settings)) throw new WhatsAppProviderError("WhatsApp is disabled.");
  if (!accessToken || !settings.phoneNumberId) {
    throw new WhatsAppProviderError("WhatsApp Cloud API credentials are not configured.");
  }
  return { accessToken, phoneNumberId: settings.phoneNumberId };
}

async function graphRequest(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const settings = await getWhatsAppSettings();
  const { accessToken } = await requireProviderConfiguration(settings);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${settings.apiVersion}/${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const providerError = body.error && typeof body.error === "object"
        ? body.error as Record<string, unknown>
        : {};
      const code = providerError.code === undefined ? null : String(providerError.code);
      const retryable = response.status === 429 || response.status >= 500;
      throw new WhatsAppProviderError(
        retryable
          ? `WhatsApp provider temporarily rejected the request (HTTP ${response.status}).`
          : `WhatsApp provider rejected the request${code ? ` (code ${code})` : ""}.`,
        code,
        retryable,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof WhatsAppProviderError) throw error;
    const retryable = error instanceof Error && error.name === "AbortError";
    throw new WhatsAppProviderError(
      retryable ? "WhatsApp provider request timed out." : "WhatsApp provider request failed.",
      null,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function recipientNumber(phoneE164: string): string {
  return phoneE164.replace(/^\+/, "");
}

export function normalizeWhatsAppPhone(
  input: string,
  countryCode = "254",
): string | null {
  const value = input.trim();
  if (!value || value.length > 40) return null;
  let digits = value.replace(/[^\d]/g, "");
  if (!digits || digits.length > 15) return null;

  if (value.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
    return `+${digits}`;
  }
  const code = countryCode.replace(/\D/g, "");
  if (!code) return null;
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")
      ? `+${digits}`
      : null;
  }
  if (digits.startsWith(code) && digits.length >= 10) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  const normalized = `${code}${digits}`;
  return normalized.length >= 8 && normalized.length <= 15 ? `+${normalized}` : null;
}

export function generateWhatsAppOtp(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function hashWhatsAppOtp(challengeId: string, code: string): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("A token-signing secret is required for WhatsApp OTP.");
  return createHmac("sha256", secret)
    .update(`whatsapp-otp:v1:${challengeId}:${code}`)
    .digest("hex");
}

export function hashWhatsAppActionToken(token: string): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("A token-signing secret is required for WhatsApp actions.");
  return createHmac("sha256", secret).update(`whatsapp-action:v1:${token}`).digest("hex");
}

export function compareSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOpaqueActionToken(): string {
  return randomUUID() + randomUUID().replace(/-/g, "");
}

export async function sendWhatsAppText(
  to: string,
  text: string,
): Promise<WhatsAppMessageResult> {
  const settings = await getWhatsAppSettings();
  const phoneNumberId = settings.phoneNumberId;
  if (!phoneNumberId) throw new WhatsAppProviderError("WhatsApp phone number ID is not configured.");
  const result = await graphRequest(`${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientNumber(to),
      type: "text",
      text: { preview_url: false, body: text.slice(0, 4000) },
    },
  });
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const message = messages[0] && typeof messages[0] === "object"
    ? messages[0] as Record<string, unknown>
    : {};
  if (typeof message.id !== "string") {
    throw new WhatsAppProviderError("WhatsApp did not return a message ID.", null, true);
  }
  return { messageId: message.id };
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  parameters: string[],
  language?: string,
): Promise<WhatsAppMessageResult> {
  const settings = await getWhatsAppSettings();
  const phoneNumberId = settings.phoneNumberId;
  if (!phoneNumberId) throw new WhatsAppProviderError("WhatsApp phone number ID is not configured.");
  if (!/^[a-z0-9_]{1,100}$/i.test(templateName)) {
    throw new WhatsAppProviderError("A valid approved WhatsApp template name is required.");
  }
  const components = parameters.length
    ? [{
        type: "body",
        parameters: parameters.slice(0, 10).map(text => ({ type: "text", text: String(text).slice(0, 1024) })),
      }]
    : undefined;
  const result = await graphRequest(`${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientNumber(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: language || settings.language },
        ...(components ? { components } : {}),
      },
    },
  });
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const message = messages[0] && typeof messages[0] === "object"
    ? messages[0] as Record<string, unknown>
    : {};
  if (typeof message.id !== "string") {
    throw new WhatsAppProviderError("WhatsApp did not return a message ID.", null, true);
  }
  return { messageId: message.id };
}

export async function sendWhatsAppOtp(
  to: string,
  code: string,
): Promise<WhatsAppMessageResult> {
  const settings = await getWhatsAppSettings();
  if (!settings.templates.authentication) {
    throw new WhatsAppProviderError("The approved authentication template is not configured.");
  }
  return sendWhatsAppTemplate(to, settings.templates.authentication, [code], settings.language);
}

export async function checkWhatsAppConnection(): Promise<{
  status: "CONNECTED" | "NOT CONFIGURED" | "ERROR";
  displayPhoneNumber?: string;
  verifiedName?: string;
  error?: string;
}> {
  const settings = await getWhatsAppSettings();
  const secrets = await getWhatsAppSecretsStatus();
  if (!isWhatsAppEnabled(settings) || !settings.phoneNumberId || !secrets.accessTokenConfigured) {
    return { status: "NOT CONFIGURED" };
  }
  try {
    const result = await graphRequest(
      `${encodeURIComponent(settings.phoneNumberId)}?fields=display_phone_number,verified_name`,
    );
    return {
      status: "CONNECTED",
      ...(typeof result.display_phone_number === "string" ? { displayPhoneNumber: result.display_phone_number } : {}),
      ...(typeof result.verified_name === "string" ? { verifiedName: result.verified_name } : {}),
    };
  } catch (error) {
    return {
      status: "ERROR",
      error: error instanceof WhatsAppProviderError ? error.message : "WhatsApp connection check failed.",
    };
  }
}

export async function enqueueWhatsAppExpiryNotifications(): Promise<void> {
  const settings = await getWhatsAppSettings();
  if (
    !isWhatsAppFeatureEnabled(settings, "packageNotifications") &&
    !isWhatsAppFeatureEnabled(settings, "ispNotifications") &&
    !isWhatsAppFeatureEnabled(settings, "resellerNotifications")
  ) return;
  await sbRpc("enqueue_whatsapp_expiry_notifications", {});
}

export type WhatsAppLoginAccountType = "admin" | "customer";

export interface WhatsAppSignInRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

function sanitizeSignInContextValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return sanitized || null;
}

export function sanitizeWhatsAppSignInContext(
  ipAddress: unknown,
  userAgent: unknown,
): WhatsAppSignInRequestContext {
  return {
    ipAddress: sanitizeSignInContextValue(ipAddress, 64),
    userAgent: sanitizeSignInContextValue(userAgent, 180),
  };
}

export async function recordWhatsAppSignInFailure(
  accountType: WhatsAppLoginAccountType,
  accountId: number,
  ipAddress: unknown,
  userAgent: unknown,
): Promise<boolean> {
  const context = sanitizeWhatsAppSignInContext(ipAddress, userAgent);
  const result: unknown = await sbRpc<unknown>("record_whatsapp_login_failure", {
    p_account_type: accountType,
    p_account_id: accountId,
    p_ip_address: context.ipAddress,
    p_user_agent: context.userAgent,
  });
  const first = Array.isArray(result) ? result[0] : result;
  return first === true ||
    (first !== null && typeof first === "object" &&
      (first as Record<string, unknown>).alert_queued === true);
}

let lastLoginAttemptPruneAt = 0;
async function pruneWhatsAppLoginAttempts(): Promise<void> {
  if (!supabaseServiceRoleConfigured || Date.now() - lastLoginAttemptPruneAt < 5 * 60 * 1000) return;
  lastLoginAttemptPruneAt = Date.now();
  await sbRpc("prune_whatsapp_login_attempts", {}).catch(error => {
    logger.warn({ err: error }, "[whatsapp] sign-in attempt cleanup failed");
  });
}

export function createWhatsAppWelcomeSetupUrl(
  adminId: number,
  subdomainValue: unknown,
  mustChangePassword: boolean,
): string {
  const subdomain = cleanString(subdomainValue, 63).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) ||
      RESERVED_SUBDOMAINS.has(subdomain) ||
      !TENANT_BASE_DOMAIN) {
    throw new WhatsAppProviderError("A secure account setup link could not be generated.");
  }
  const path = mustChangePassword ? "/admin/set-password" : "/admin/login";
  const url = new URL(path, `https://${subdomain}.${TENANT_BASE_DOMAIN}`);
  if (mustChangePassword) {
    url.hash = new URLSearchParams({
      setupToken: generateToken("p", String(adminId)),
    }).toString();
  }
  return url.toString();
}

export async function processWhatsAppOutboxBatch(limit = 10): Promise<number> {
  await pruneWhatsAppLoginAttempts();
  const settings = await getWhatsAppSettings();
  if (!isWhatsAppEnabled(settings)) return 0;
  const customerNotifications = isWhatsAppFeatureEnabled(settings, "customerNotifications");
  const securityNotifications = isWhatsAppFeatureEnabled(settings, "securityNotifications");
  const eventTypes = [
    ...(customerNotifications && isWhatsAppFeatureEnabled(settings, "paymentNotifications") ? ["payment"] : []),
    ...(customerNotifications && isWhatsAppFeatureEnabled(settings, "packageNotifications") ? ["renewal", "expiry"] : []),
    ...(customerNotifications ? ["account_activated", "account_suspended", "account_reactivated"] : []),
    ...(securityNotifications ? ["password_changed", "suspicious_sign_in"] : []),
    ...(isWhatsAppFeatureEnabled(settings, "ispNotifications") ? ["isp_subscription", "isp_welcome"] : []),
    ...(isWhatsAppFeatureEnabled(settings, "resellerNotifications") ? ["reseller_subscription", "reseller_welcome"] : []),
  ];
  if (eventTypes.length === 0) return 0;
  const claimed = await sbRpc<{
    id: string;
    dedupe_key: string;
    event_type: string;
    customer_id: number | null;
    admin_id: number | null;
    phone_e164: string | null;
    payload: Record<string, unknown>;
    attempts: number;
  }>("claim_whatsapp_outbox", {
    p_limit: Math.max(1, Math.min(50, limit)),
    p_event_types: eventTypes,
  });

  for (const item of claimed) {
    try {
      let phone = item.phone_e164 ?? "";
      let customer: Record<string, unknown> | undefined;
      let admin: Record<string, unknown> | undefined;
      let planName = "";
      if (item.customer_id) {
        const customers = await sbSelect<Record<string, unknown>>(
          "isp_customers",
          `id=eq.${encodeURIComponent(String(item.customer_id))}&select=*&limit=1`,
        );
        customer = customers[0];
        phone = phone || cleanString(customer?.phone_e164, 32);
        if (customer?.phone_verified !== true) {
          throw new WhatsAppProviderError("The WhatsApp recipient is not phone-verified.");
        }
        if (customer?.plan_id) {
          const plans = await sbSelect<Record<string, unknown>>(
            "isp_plans",
            `id=eq.${encodeURIComponent(String(customer.plan_id))}&select=*&limit=1`,
          );
          const plan = plans[0];
          planName = cleanString(plan?.name ?? plan?.plan_name ?? plan?.title, 100);
        }
      } else if (item.admin_id) {
        const admins = await sbSelect<Record<string, unknown>>(
          "isp_admins",
          `id=eq.${encodeURIComponent(String(item.admin_id))}&select=*&limit=1`,
        );
        admin = admins[0];
        phone = phone || cleanString(admin?.phone_e164, 32);
        if (admin?.phone_verified !== true) {
          throw new WhatsAppProviderError("The WhatsApp recipient is not phone-verified.");
        }
        planName = cleanString(admin?.plan_name, 100);
      }
      if (!phone || (!customer && !admin)) {
        throw new WhatsAppProviderError("The WhatsApp recipient account is unavailable.");
      }

      const templateName = item.event_type === "payment"
        ? settings.templates.payment
        : item.event_type === "renewal"
          ? settings.templates.renewal || settings.templates.payment
          : item.event_type === "expiry"
            ? settings.templates.expiry
            : item.event_type === "reseller_subscription"
              ? settings.templates.reseller
              : item.event_type === "isp_subscription"
                ? settings.templates.ispSubscription
                : item.event_type === "isp_welcome" || item.event_type === "reseller_welcome"
                  ? settings.templates.welcome
                  : item.event_type === "account_activated" ||
                      item.event_type === "account_suspended" ||
                      item.event_type === "account_reactivated"
                    ? settings.templates.accountStatus
                    : item.event_type === "password_changed"
                      ? settings.templates.security
                      : item.event_type === "suspicious_sign_in"
                        ? settings.templates.suspiciousSignIn
                : "";
      if (!templateName) throw new WhatsAppProviderError("The required approved notification template is not configured.");
      const payload = item.payload ?? {};
      const recipientName = cleanString(
        customer?.fullname ?? customer?.name ?? admin?.fullname ?? admin?.name ?? admin?.company_name,
        100,
      );
      const params = item.event_type === "payment"
        ? [
            String(payload.amount ?? ""),
            planName,
            String(payload.reference ?? ""),
            String(payload.paid_at ?? new Date().toISOString().slice(0, 10)),
          ]
        : item.event_type === "renewal" || item.event_type === "expiry"
          ? [
            planName,
            String(payload.days_remaining ?? ""),
            String(payload.expires_at ?? ""),
          ]
          : item.event_type === "isp_welcome" || item.event_type === "reseller_welcome"
            ? [
                recipientName,
                createWhatsAppWelcomeSetupUrl(
                  Number(item.admin_id),
                  admin?.subdomain,
                  admin?.must_change_password === true || admin?.must_change_password === "true",
                ),
              ]
            : item.event_type === "account_activated" ||
                item.event_type === "account_suspended" ||
                item.event_type === "account_reactivated"
              ? [
                  recipientName,
                  String(payload.previous_status ?? ""),
                  String(payload.status ?? item.event_type.replace("account_", "")),
                  planName,
                ]
              : item.event_type === "password_changed"
                ? [
                    recipientName,
                    String(payload.changed_at ?? new Date().toISOString()),
                  ]
                : item.event_type === "suspicious_sign_in"
                  ? [
                      recipientName,
                      String(payload.attempted_at ?? new Date().toISOString()),
                      String(payload.ip_address ?? "Unavailable"),
                      String(payload.user_agent ?? "Unavailable"),
                    ]
          : [
            String(payload.billing_period ?? ""),
            String(payload.amount ?? ""),
            String(payload.status ?? ""),
          ];
      const sent = await sendWhatsAppTemplate(phone, templateName, params, settings.language);
      await sbRpc("complete_whatsapp_outbox", {
        p_id: item.id,
        p_status: "sent",
        p_message_id: sent.messageId,
        p_error_code: null,
        p_error_message: null,
        p_retryable: false,
      });
    } catch (error) {
      const providerError = error instanceof WhatsAppProviderError
        ? error
        : new WhatsAppProviderError("WhatsApp notification delivery failed.", null, true);
      logger.warn(
        { eventType: item.event_type, errorCode: providerError.code },
        "[whatsapp] notification delivery failed",
      );
      await sbRpc("complete_whatsapp_outbox", {
        p_id: item.id,
        p_status: "failed",
        p_message_id: null,
        p_error_code: providerError.code,
        p_error_message: providerError.message.slice(0, 200),
        p_retryable: providerError.retryable,
      }).catch(error => {
        logger.warn({ err: error, messageId: item.id }, "[whatsapp] outbox retry update failed");
      });
    }
  }
  return claimed.length;
}

export async function claimWhatsAppWebhookEvent(
  providerMessageId: string,
  senderPhone: string,
  eventType: string,
): Promise<{ shouldProcess: boolean; attempts: number; processingStatus: string | null }> {
  const result = await sbRpc<{
    should_process: boolean;
    attempts: number;
    processing_status: string;
  }>("claim_whatsapp_webhook_event", {
    p_provider_event_id: providerMessageId,
    p_sender_phone: senderPhone,
    p_event_type: eventType,
  });
  return {
    shouldProcess: result[0]?.should_process === true,
    attempts: Number(result[0]?.attempts ?? 0),
    processingStatus: result[0]?.processing_status ?? null,
  };
}

export async function completeWhatsAppWebhookEvent(providerEventId: string): Promise<void> {
  await sbRpc("complete_whatsapp_webhook_event", { p_provider_event_id: providerEventId });
}

export async function failWhatsAppWebhookEvent(
  providerEventId: string,
  failureCode: string,
): Promise<void> {
  await sbRpc("fail_whatsapp_webhook_event", {
    p_provider_event_id: providerEventId,
    p_failure_code: failureCode,
  });
}

export async function createWhatsAppActionToken(
  phone: string,
  purpose: "registration" | "recovery",
  accountType: "admin" | "customer" | null,
  accountId: number | null,
): Promise<string> {
  const token = createOpaqueActionToken();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await sbInsertStrict("whatsapp_action_tokens", {
    token_hash: hashWhatsAppActionToken(token),
    phone_e164: phone,
    purpose,
    account_type: accountType,
    account_id: accountId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  return token;
}

export async function consumeWhatsAppActionToken(
  token: string,
  phone: string,
  purpose: "registration" | "recovery",
): Promise<{
  accountType: "admin" | "customer" | null;
  accountId: number | null;
} | null> {
  const rows = await sbRpc<{
    consumed: boolean;
    account_type: "admin" | "customer" | null;
    account_id: number | null;
  }>("consume_whatsapp_action_token", {
    p_token_hash: hashWhatsAppActionToken(token),
    p_phone_e164: phone,
    p_purpose: purpose,
  });
  const row = rows[0];
  return row?.consumed
    ? { accountType: row.account_type, accountId: row.account_id }
    : null;
}

export async function getWhatsAppDashboardStats(): Promise<Record<string, unknown>> {
  const rows = await sbRpc<Record<string, unknown>>("whatsapp_dashboard_stats", {});
  return rows[0] ?? {};
}

export async function noteWhatsAppDeliveryStatus(
  providerMessageId: string,
  status: string,
): Promise<void> {
  await sbUpdate(
    "whatsapp_outbox",
    `provider_message_id=eq.${encodeURIComponent(providerMessageId)}`,
    { provider_status: status, provider_status_at: new Date().toISOString() },
  );
}
