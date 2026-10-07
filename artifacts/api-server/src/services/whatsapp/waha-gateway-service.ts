import {
  sbSelectStrict,
  sbUpsertStrict,
  supabaseServiceRoleConfigured,
} from "../../lib/supabase-client.js";
import {
  decryptWahaSecret,
  encryptWahaSecret,
  type EncryptedWahaSecret,
} from "./waha-crypto.js";

export type WahaOtpProvider = "whatsapp_cloud" | "waha";
export type WahaOtpFeature =
  | "login"
  | "registrationVerification"
  | "pageVerification"
  | "gatewaySettings";

export interface WahaGatewaySettings {
  enabled: boolean;
  baseUrl: string;
  sessionId: string;
  otpProvider: WahaOtpProvider;
  features: Record<WahaOtpFeature, boolean>;
}

export interface WahaGatewaySecretStatus {
  apiKeyConfigured: boolean;
  apiKeySource: "super-admin" | "environment" | "missing";
}

export interface WahaGatewayRuntimeConfig extends WahaGatewaySettings {
  apiKey: string;
}

interface StoredSettingsRow {
  config: unknown;
}

interface StoredCredentialsRow {
  id: string;
  api_key: EncryptedWahaSecret | null;
}

export interface WahaSendResult {
  messageId: string | null;
}

export class WahaGatewayError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "WahaGatewayError";
  }
}

const SETTINGS_ID = "global_waha";
const FEATURE_KEYS: WahaOtpFeature[] = [
  "login",
  "registrationVerification",
  "pageVerification",
  "gatewaySettings",
];

const DEFAULT_SETTINGS: WahaGatewaySettings = {
  enabled: false,
  baseUrl: process.env.WAHA_BASE_URL?.trim() || "http://localhost:3000",
  sessionId: process.env.WAHA_SESSION_ID?.trim() || "default",
  otpProvider: "whatsapp_cloud",
  features: {
    login: false,
    registrationVerification: false,
    pageVerification: false,
    gatewaySettings: false,
  },
};

function cleanString(value: unknown, maxLength = 160): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function validateWahaBaseUrl(value: unknown): string {
  const candidate = cleanString(value, 512);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid WAHA base URL, such as http://localhost:3000.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("WAHA URL must be an HTTP(S) address without credentials, query parameters, or a fragment.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "169.254.169.254" ||
    hostname === "169.254.170.2" ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("That host is reserved and cannot be used as a WAHA URL.");
  }
  return candidate.replace(/\/+$/, "");
}

function cleanSettings(value: unknown): WahaGatewaySettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const features = input.features && typeof input.features === "object" && !Array.isArray(input.features)
    ? input.features as Record<string, unknown>
    : {};
  const sessionId = cleanString(input.sessionId, 64);
  const provider: WahaOtpProvider = input.otpProvider === "waha"
    ? "waha"
    : "whatsapp_cloud";
  const baseUrl = cleanString(input.baseUrl, 512);
  return {
    enabled: input.enabled === true,
    baseUrl,
    sessionId: /^[A-Za-z0-9._-]{1,64}$/.test(sessionId) ? sessionId : "default",
    otpProvider: provider,
    features: Object.fromEntries(FEATURE_KEYS.map(key => [
      key,
      features[key] === true,
    ])) as Record<WahaOtpFeature, boolean>,
  };
}

async function storedCredentials(): Promise<StoredCredentialsRow | null> {
  const rows = await sbSelectStrict<StoredCredentialsRow>(
    "platform_waha_gateway_credentials",
    `id=eq.${SETTINGS_ID}&select=id,api_key&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getWahaGatewaySettings(): Promise<WahaGatewaySettings> {
  const rows = await sbSelectStrict<StoredSettingsRow>(
    "platform_waha_gateway_settings",
    `id=eq.${SETTINGS_ID}&select=config&limit=1`,
  );
  return rows[0] ? cleanSettings(rows[0].config) : cleanSettings(DEFAULT_SETTINGS);
}

async function getStoredApiKey(): Promise<string> {
  const row = await storedCredentials();
  if (!row?.api_key?.ciphertext) return "";
  try {
    return decryptWahaSecret(row.api_key);
  } catch {
    throw new WahaGatewayError(
      "The saved WAHA API key could not be decrypted. Re-enter it in Super Admin settings.",
    );
  }
}

export async function getWahaGatewaySecretStatus(): Promise<WahaGatewaySecretStatus> {
  const row = await storedCredentials();
  const apiKeySource = row?.api_key?.ciphertext
    ? "super-admin"
    : process.env.WAHA_API_KEY?.trim()
      ? "environment"
      : "missing";
  return { apiKeyConfigured: apiKeySource !== "missing", apiKeySource };
}

export async function getWahaGatewayRuntimeConfig(): Promise<WahaGatewayRuntimeConfig> {
  const [settings, storedApiKey] = await Promise.all([
    getWahaGatewaySettings(),
    getStoredApiKey(),
  ]);
  let baseUrl: string;
  try {
    baseUrl = validateWahaBaseUrl(settings.baseUrl);
  } catch {
    throw new WahaGatewayError("The WAHA base URL is invalid. Correct it in Super Admin settings.");
  }
  const apiKey = storedApiKey || process.env.WAHA_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new WahaGatewayError("The WAHA API key is not configured.");
  }
  return { ...settings, baseUrl, apiKey };
}

export async function saveWahaGatewaySettings(input: unknown): Promise<WahaGatewaySettings> {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const baseUrl = validateWahaBaseUrl(body.baseUrl);
  const sessionId = cleanString(body.sessionId, 64);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(sessionId)) {
    throw new Error("Enter a WAHA session ID containing only letters, numbers, dots, underscores, or hyphens.");
  }
  if (body.otpProvider !== "whatsapp_cloud" && body.otpProvider !== "waha") {
    throw new Error("Choose WhatsApp Cloud API or WAHA as the OTP provider.");
  }
  if (typeof body.enabled !== "boolean") {
    throw new Error("Choose whether the WAHA gateway is enabled.");
  }
  const featuresInput = body.features && typeof body.features === "object" && !Array.isArray(body.features)
    ? body.features as Record<string, unknown>
    : {};
  if (FEATURE_KEYS.some(key => typeof featuresInput[key] !== "boolean")) {
    throw new Error("Provide all WAHA OTP feature switches.");
  }
  const settings: WahaGatewaySettings = {
    enabled: body.enabled,
    baseUrl,
    sessionId,
    otpProvider: body.otpProvider,
    features: Object.fromEntries(FEATURE_KEYS.map(key => [
      key,
      featuresInput[key] === true,
    ])) as Record<WahaOtpFeature, boolean>,
  };
  if (!supabaseServiceRoleConfigured) {
    throw new Error("Supabase service-role access is required to save WAHA settings.");
  }
  await sbUpsertStrict<StoredSettingsRow>("platform_waha_gateway_settings", "id", {
    id: SETTINGS_ID,
    config: settings,
    updated_at: new Date().toISOString(),
  });
  return settings;
}

export async function saveWahaGatewayCredentials(input: unknown): Promise<WahaGatewaySecretStatus> {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) throw new Error("Enter a WAHA API key to save.");
  if (apiKey.length > 4096) throw new Error("The WAHA API key exceeds the allowed length.");
  if (!supabaseServiceRoleConfigured) {
    throw new Error("Supabase service-role access is required to save WAHA credentials.");
  }
  await sbUpsertStrict<StoredCredentialsRow>("platform_waha_gateway_credentials", "id", {
    id: SETTINGS_ID,
    api_key: encryptWahaSecret(apiKey),
    updated_at: new Date().toISOString(),
  });
  return getWahaGatewaySecretStatus();
}

export async function clearWahaGatewayCredentials(): Promise<WahaGatewaySecretStatus> {
  if (!supabaseServiceRoleConfigured) {
    throw new Error("Supabase service-role access is required to clear WAHA credentials.");
  }
  await sbUpsertStrict<StoredCredentialsRow>("platform_waha_gateway_credentials", "id", {
    id: SETTINGS_ID,
    api_key: null,
    updated_at: new Date().toISOString(),
  });
  return getWahaGatewaySecretStatus();
}

export function normalizeWahaPhone(
  phoneNumber: string,
  countryCode = process.env.WAHA_DEFAULT_COUNTRY_CODE?.trim() || "254",
): string | null {
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) return null;
  const country = countryCode.replace(/\D/g, "");
  if (!country || country.length > 4 || country.startsWith("0")) return null;
  const trimmed = phoneNumber.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (trimmed.startsWith("+")) {
    // Keep the supplied international calling code.
  } else if (digits.startsWith(country) && digits.length > country.length) {
    // The value already includes the configured country calling code.
  } else if (digits.startsWith("0")) {
    digits = `${country}${digits.slice(1)}`;
  } else {
    digits = `${country}${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 && /^[1-9]\d+$/.test(digits)
    ? digits
    : null;
}

function responseMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    const nestedId = (record.data as Record<string, unknown>).id;
    if (typeof nestedId === "string") return nestedId;
  }
  return null;
}

export class WAHAGatewayService {
  constructor(
    private readonly loadConfig: () => Promise<WahaGatewayRuntimeConfig> = getWahaGatewayRuntimeConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async sendOTP(phoneNumber: string, code: string): Promise<WahaSendResult> {
    if (!/^\d{6}$/.test(code)) {
      throw new WahaGatewayError("WAHA OTP must be a six-digit numeric code.");
    }
    const config = await this.loadConfig();
    if (!config.enabled || config.otpProvider !== "waha") {
      throw new WahaGatewayError("WAHA is not enabled as the OTP provider.");
    }
    const text = `Your OcholaSuperNet verification code is: ${code}. Valid for 5 minutes.`;
    return this.postText(config, phoneNumber, text);
  }

  async sendText(
    phoneNumber: string,
    text: string,
    options: { allowWhenDisabled?: boolean } = {},
  ): Promise<WahaSendResult> {
    const config = await this.loadConfig();
    if (!config.enabled && !options.allowWhenDisabled) {
      throw new WahaGatewayError("The WAHA gateway is disabled.");
    }
    return this.postText(config, phoneNumber, text);
  }

  private async postText(
    config: WahaGatewayRuntimeConfig,
    phoneNumber: string,
    text: string,
  ): Promise<WahaSendResult> {
    const chatNumber = normalizeWahaPhone(phoneNumber);
    if (!chatNumber) throw new WahaGatewayError("Enter a valid WhatsApp phone number.");
    const bodyText = text.trim();
    if (!bodyText || bodyText.length > 4000) {
      throw new WahaGatewayError("WAHA text must contain 1–4000 characters.");
    }
    if (!config.apiKey) throw new WahaGatewayError("The WAHA API key is not configured.");

    const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/api/sendText`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let response: Response;
      try {
        response = await this.fetcher(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": config.apiKey,
          },
          body: JSON.stringify({
            session: config.sessionId,
            chatId: `${chatNumber}@c.us`,
            text: bodyText,
          }),
          signal: controller.signal,
          redirect: "error",
        });
      } catch {
        throw new WahaGatewayError("Could not connect to the WAHA server.");
      }
      if (!response.ok) {
        throw new WahaGatewayError(`WAHA rejected the message (HTTP ${response.status}).`, response.status);
      }
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        // Some WAHA versions return an empty body after accepting a message.
      }
      return { messageId: responseMessageId(responseBody) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const wahaGatewayService = new WAHAGatewayService();
