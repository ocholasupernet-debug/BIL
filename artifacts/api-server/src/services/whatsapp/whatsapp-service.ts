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
} from "../../lib/supabase-client.js";
import { logger } from "../../lib/logger.js";

export type WhatsAppFeature =
  | "login"
  | "registrationVerification"
  | "passwordRecovery"
  | "paymentNotifications"
  | "packageNotifications"
  | "ispNotifications"
  | "resellerNotifications"
  | "customerNotifications"
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
    test: string;
  };
}

interface StoredSettingsRow {
  config: unknown;
}

export interface WhatsAppSecretsStatus {
  accessTokenConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
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

export function getWhatsAppSecretsStatus(): WhatsAppSecretsStatus {
  return {
    accessTokenConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    webhookVerifyTokenConfigured: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
    appSecretConfigured: !!process.env.WHATSAPP_APP_SECRET?.trim(),
  };
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

function requireProviderConfiguration(settings: WhatsAppSettings): {
  accessToken: string;
  phoneNumberId: string;
} {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
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
  const { accessToken } = requireProviderConfiguration(settings);
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
  const { phoneNumberId } = requireProviderConfiguration(settings);
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
  const { phoneNumberId } = requireProviderConfiguration(settings);
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
  const secrets = getWhatsAppSecretsStatus();
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

export async function processWhatsAppOutboxBatch(limit = 10): Promise<number> {
  const settings = await getWhatsAppSettings();
  if (!isWhatsAppEnabled(settings)) return 0;
  const customerNotifications = isWhatsAppFeatureEnabled(settings, "customerNotifications");
  const eventTypes = [
    ...(customerNotifications && isWhatsAppFeatureEnabled(settings, "paymentNotifications") ? ["payment"] : []),
    ...(customerNotifications && isWhatsAppFeatureEnabled(settings, "packageNotifications") ? ["renewal", "expiry"] : []),
    ...(isWhatsAppFeatureEnabled(settings, "ispNotifications") ? ["isp_subscription"] : []),
    ...(isWhatsAppFeatureEnabled(settings, "resellerNotifications") ? ["reseller_subscription"] : []),
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
                : "";
      if (!templateName) throw new WhatsAppProviderError("The required approved notification template is not configured.");
      const payload = item.payload ?? {};
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

export async function recordWhatsAppWebhookMessage(
  providerMessageId: string,
  senderPhone: string,
  eventType: string,
): Promise<boolean> {
  const result = await sbRpc<{ is_new: boolean }>("record_whatsapp_webhook_message", {
    p_provider_message_id: providerMessageId,
    p_sender_phone: senderPhone,
    p_event_type: eventType,
  });
  return result[0]?.is_new === true;
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
