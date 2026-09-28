import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import {
  sbInsertStrict,
  sbRpc,
  sbSelect,
  sbSelectStrict,
  sbUpsertStrict,
} from "../../lib/supabase-client.js";
import { logger } from "../../lib/logger.js";

export type SmsFeature =
  | "login"
  | "registrationVerification"
  | "passwordRecovery"
  | "paymentNotifications"
  | "packageNotifications"
  | "ispNotifications"
  | "resellerNotifications"
  | "customerNotifications";
export interface SmsSettings {
  enabled: boolean;
  username: string;
  senderId: string;
  sandbox: boolean;
  defaultCountryCode: string;
  features: Record<SmsFeature, boolean>;
}
export class SmsProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
    public readonly retryable = false,
  ) {
    super(message);
  }
}
const ID = "global_sms";
const FEATURES: SmsFeature[] = [
  "login",
  "registrationVerification",
  "passwordRecovery",
  "paymentNotifications",
  "packageNotifications",
  "ispNotifications",
  "resellerNotifications",
  "customerNotifications",
];
const defaults: SmsSettings = {
  enabled: false,
  username: "",
  senderId: "",
  sandbox: false,
  defaultCountryCode: "254",
  features: Object.fromEntries(FEATURES.map((k) => [k, false])) as Record<
    SmsFeature,
    boolean
  >,
};
type Row = { config: unknown; api_key_encrypted?: string | null };
const secret = () =>
  process.env.SESSION_SECRET?.trim() ||
  process.env.TOKEN_SIGNING_SECRET?.trim() ||
  "";
function key() {
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET is required for SMS credentials.");
  return createHash("sha256").update(`ochola-sms-api-key:v1:${s}`).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
function decrypt(value: string) {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) return "";
  const d = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(body, "base64url")),
    d.final(),
  ]).toString("utf8");
}
const clean = (v: unknown, n = 160) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
function cleanSettings(v: unknown): SmsSettings {
  const x =
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const f =
    x.features && typeof x.features === "object"
      ? (x.features as Record<string, unknown>)
      : {};
  const cc = clean(x.defaultCountryCode, 5).replace(/\D/g, "");
  return {
    enabled: x.enabled === true,
    username: clean(x.username, 80),
    senderId: clean(x.senderId, 20),
    sandbox: x.sandbox === true,
    defaultCountryCode: cc || "254",
    features: Object.fromEntries(
      FEATURES.map((k) => [k, f[k] === true]),
    ) as Record<SmsFeature, boolean>,
  };
}
export async function getSmsSettings() {
  let s = defaults;
  const rows = await sbSelectStrict<Row>(
    "platform_sms_settings",
    `id=eq.${ID}&select=config&limit=1`,
  );
  if (rows[0]) s = cleanSettings(rows[0].config);
  return cleanSettings({
    ...s,
    username: process.env.AT_USERNAME || s.username,
    senderId: process.env.AT_SENDER_ID || s.senderId,
    sandbox: process.env.AT_SANDBOX === "true" ? true : s.sandbox,
    defaultCountryCode:
      process.env.SMS_DEFAULT_COUNTRY_CODE || s.defaultCountryCode,
    enabled: process.env.SMS_ENABLED === "true" ? true : s.enabled,
  });
}
export async function getSmsSecretsStatus() {
  return {
    apiKeyConfigured: !!(
      process.env.AT_API_KEY?.trim() ||
      (
        await sbSelect<Row>(
          "platform_sms_settings",
          `id=eq.${ID}&select=api_key_encrypted&limit=1`,
        )
      )[0]?.api_key_encrypted
    ),
  };
}
async function encryptedKey() {
  const env = process.env.AT_API_KEY?.trim();
  if (env) return env;
  const rows = await sbSelect<Row>(
    "platform_sms_settings",
    `id=eq.${ID}&select=api_key_encrypted&limit=1`,
  );
  return rows[0]?.api_key_encrypted ? decrypt(rows[0].api_key_encrypted) : "";
}
export async function saveSmsSettings(
  input: unknown,
  apiKey?: unknown,
  clearApiKey = false,
) {
  const current = await getSmsSettings();
  const next = cleanSettings({ ...current, ...(input as object) });
  const stored = await sbSelect<Row>(
    "platform_sms_settings",
    `id=eq.${ID}&select=api_key_encrypted&limit=1`,
  );
  let encrypted = stored[0]?.api_key_encrypted || null;
  if (clearApiKey) encrypted = null;
  else if (typeof apiKey === "string" && apiKey.trim())
    encrypted = encrypt(apiKey.trim());
  await sbUpsertStrict("platform_sms_settings", "id", {
    id: ID,
    config: next,
    api_key_encrypted: encrypted,
    updated_at: new Date().toISOString(),
  });
  return next;
}
export const isSmsEnabled = (s: SmsSettings) =>
  process.env.SMS_ENABLED !== "false" && s.enabled;
export const isSmsFeatureEnabled = (s: SmsSettings, f: SmsFeature) =>
  isSmsEnabled(s) && s.features[f];
export function normalizeSmsPhone(input: string, country = "254") {
  const v = input.trim();
  let d = v.replace(/[^\d]/g, "");
  if (v.startsWith("+"))
    return d.length >= 8 && d.length <= 15 && !d.startsWith("0")
      ? `+${d}`
      : null;
  if (d.startsWith("00")) {
    d = d.slice(2);
    return d.length >= 8 && d.length <= 15 && !d.startsWith("0")
      ? `+${d}`
      : null;
  }
  if (d.startsWith("0")) d = d.slice(1);
  if (d.startsWith(country) && d.length >= 8) return `+${d}`;
  d = country.replace(/\D/g, "") + d;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
export const generateSmsOtp = () => String(randomInt(100000, 1000000));
export function hashSmsOtp(id: string, code: string) {
  if (!secret()) throw new Error("A token-signing secret is required.");
  return createHmac("sha256", secret())
    .update(`sms-otp:v1:${id}:${code}`)
    .digest("hex");
}
export function hashSmsActionToken(token: string) {
  if (!secret()) throw new Error("A token-signing secret is required.");
  return createHmac("sha256", secret())
    .update(`sms-action:v1:${token}`)
    .digest("hex");
}
export const createOpaqueSmsActionToken = () =>
  randomUUID() + randomUUID().replace(/-/g, "");
export async function createSmsActionToken(
  phone: string,
  purpose: "registration" | "recovery",
  accountType: "admin" | "customer" | null,
  accountId: number | null,
) {
  const token = createOpaqueSmsActionToken();
  await sbInsertStrict("sms_action_tokens", {
    token_hash: hashSmsActionToken(token),
    phone_e164: phone,
    purpose,
    account_type: accountType,
    account_id: accountId,
    expires_at: new Date(Date.now() + 300000).toISOString(),
    created_at: new Date().toISOString(),
  });
  return token;
}
export async function consumeSmsActionToken(
  token: string,
  phone: string,
  purpose: string,
) {
  const r = await sbRpc<{
    consumed: boolean;
    account_type: "admin" | "customer" | null;
    account_id: number | null;
  }>("consume_sms_action_token", {
    p_token_hash: hashSmsActionToken(token),
    p_phone_e164: phone,
    p_purpose: purpose,
  });
  const x = r[0];
  return x?.consumed
    ? { accountType: x.account_type, accountId: x.account_id }
    : null;
}
export async function sendSms(to: string, message: string) {
  const s = await getSmsSettings();
  const apiKey = await encryptedKey();
  if (!isSmsEnabled(s) || !apiKey || !s.username)
    throw new SmsProviderError("SMS credentials are not configured.");
  const normalizedNumber = normalizeSmsPhone(to, s.defaultCountryCode);
  if (!normalizedNumber)
    throw new SmsProviderError("A valid international phone number is required.");
  const host = s.sandbox
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
  const form = new URLSearchParams({
    username: s.username,
    to: normalizedNumber,
    message: message.slice(0, 1600),
  });
  if (s.senderId) form.set("from", s.senderId);
  const r = await fetch(`${host}/version1/messaging`, {
    method: "POST",
    headers: {
      apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const b = await r.text();
  if (!r.ok)
    throw new SmsProviderError(
      "SMS provider rejected the request.",
      String(r.status),
      [500, 501, 502].includes(r.status),
    );
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(b);
  } catch {
    throw new SmsProviderError(
      "SMS provider returned an invalid response.",
      null,
      true,
    );
  }
  const envelope =
    data.SMSMessageData && typeof data.SMSMessageData === "object"
      ? (data.SMSMessageData as Record<string, unknown>)
      : {};
  const recipients = Array.isArray(envelope.Recipients)
    ? envelope.Recipients
    : [];
  const recipient =
    recipients[0] && typeof recipients[0] === "object"
      ? (recipients[0] as Record<string, unknown>)
      : null;
  const statusCode =
    recipient?.statusCode === undefined ? null : Number(recipient.statusCode);
  if (
    !recipient ||
    statusCode === null ||
    ![100, 101, 102].includes(statusCode)
  )
    throw new SmsProviderError(
      "Africa's Talking rejected the SMS recipient.",
      statusCode === null ? null : String(statusCode),
      statusCode === null || [500, 501, 502].includes(statusCode),
    );
  const messageId = String(recipient.messageId || "");
  if (!messageId)
    throw new SmsProviderError(
      "Africa's Talking did not return a message ID.",
      null,
      true,
    );
  return { messageId };
}
export async function sendSmsOtp(to: string, code: string) {
  return sendSms(to, `Your verification code is ${code}. It expires soon.`);
}
export async function checkSmsConnection() {
  const s = await getSmsSettings();
  const apiKey = await encryptedKey();
  if (!isSmsEnabled(s) || !s.username || !apiKey)
    return { status: "NOT CONFIGURED" as const };
  const host = s.sandbox
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
  try {
    const response = await fetch(
      `${host}/version1/user?username=${encodeURIComponent(s.username)}`,
      {
        headers: {
          apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const rawUserData = data.userData ?? data.UserData;
    const userData =
      rawUserData && typeof rawUserData === "object"
        ? (rawUserData as Record<string, unknown>)
        : {};
    const balance =
      typeof userData.balance === "string" ? userData.balance.trim() : "";
    if (!response.ok || !/^[A-Z]{3}\s+-?\d+(?:\.\d+)?$/i.test(balance)) {
      return {
        status: "ERROR" as const,
        error: "Africa's Talking credentials were rejected.",
      };
    }
    return { status: "CONNECTED" as const };
  } catch {
    return {
      status: "ERROR" as const,
      error: "Africa's Talking connection check failed.",
    };
  }
}
export async function getSmsDashboardStats() {
  try {
    const r = await sbRpc<Record<string, unknown>>("sms_dashboard_stats", {});
    return r[0] || {};
  } catch {
    return {};
  }
}
export async function enqueueSmsExpiryNotifications() {
  try {
    await sbRpc("enqueue_sms_expiry_notifications", {});
  } catch (error) {
    logger.warn({ err: error }, "[sms] expiry enqueue failed");
  }
}
export async function processSmsOutboxBatch(limit = 10) {
  const s = await getSmsSettings();
  if (!isSmsEnabled(s)) return 0;
  const events = [
    ...(isSmsFeatureEnabled(s, "customerNotifications") &&
    isSmsFeatureEnabled(s, "paymentNotifications")
      ? ["payment"]
      : []),
    ...(isSmsFeatureEnabled(s, "customerNotifications") &&
    isSmsFeatureEnabled(s, "packageNotifications")
      ? ["renewal", "expiry"]
      : []),
    ...(isSmsFeatureEnabled(s, "ispNotifications") ? ["isp_subscription"] : []),
    ...(isSmsFeatureEnabled(s, "resellerNotifications")
      ? ["reseller_subscription"]
      : []),
  ];
  if (!events.length) return 0;
  const items = await sbRpc<any>("claim_sms_outbox", {
    p_limit: Math.max(1, Math.min(50, limit)),
    p_event_types: events,
  });
  for (const item of items) {
    try {
      let phone = item.phone_e164 || "";
      let name = "";
      let verified = false;
      if (item.customer_id) {
        const rows = await sbSelect<any>(
          "isp_customers",
          `id=eq.${item.customer_id}&select=*&limit=1`,
        );
        const c = rows[0];
        phone = phone || c?.phone_e164 || "";
        verified = c?.phone_verified === true;
        if (c?.plan_id) {
          const p = await sbSelect<any>(
            "isp_plans",
            `id=eq.${c.plan_id}&select=*&limit=1`,
          );
          name = p[0]?.name || p[0]?.plan_name || "";
        }
      } else if (item.admin_id) {
        const rows = await sbSelect<any>(
          "isp_admins",
          `id=eq.${item.admin_id}&select=*&limit=1`,
        );
        const a = rows[0];
        phone = phone || a?.phone_e164 || "";
        verified = a?.phone_verified === true;
        name = a?.name || "";
      }
      if (!phone || !verified)
        throw new SmsProviderError("The SMS recipient is not phone-verified.");
      const p = item.payload || {};
      const text =
        item.event_type === "payment"
          ? `Payment received: KSh ${p.amount ?? ""}. Reference ${p.reference ?? ""}. Thank you.`
          : item.event_type === "renewal"
            ? `Your ${name} package has been renewed. It expires ${p.expires_at ?? ""}.`
            : item.event_type === "expiry"
              ? `Your ${name} package expires ${p.expires_at ?? ""}. Please renew to stay connected.`
              : `${item.event_type === "reseller_subscription" ? "Reseller" : "ISP"} subscription ${p.status ?? ""}: KSh ${p.amount ?? ""}, period ${p.billing_period ?? ""}, due ${p.due_date ?? ""}.`;
      const sent = await sendSms(phone, text);
      await sbRpc("complete_sms_outbox", {
        p_id: item.id,
        p_status: "sent",
        p_message_id: sent.messageId,
        p_error_code: null,
        p_error_message: null,
        p_retryable: false,
      });
    } catch (e) {
      const x =
        e instanceof SmsProviderError
          ? e
          : new SmsProviderError("SMS delivery failed.", null, true);
      await sbRpc("complete_sms_outbox", {
        p_id: item.id,
        p_status: "failed",
        p_message_id: null,
        p_error_code: x.code,
        p_error_message: x.message,
        p_retryable: x.retryable,
      }).catch(() => {});
    }
  }
  return items.length;
}
