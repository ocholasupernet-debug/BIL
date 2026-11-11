import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  platformSecureSettingsConfigured,
  platformSecureSettingsSelect,
  platformSecureSettingsUpsert,
} from "./platform-billing-store.js";
import { logger } from "./logger.js";

export interface PlatformRadiusSettings {
  enabled: boolean;
  host: string;
  authenticationPort: number;
  accountingPort: number;
  secret: string;
}

export interface PublicPlatformRadiusSettings extends Omit<PlatformRadiusSettings, "secret"> {
  hasSecret: boolean;
  configured: boolean;
  source: "database" | "environment" | "none";
}

interface EncryptedRadiusSettings {
  id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

const SETTINGS_ID = "global_radius";
const EMPTY_SETTINGS: PlatformRadiusSettings = {
  enabled: false,
  host: "",
  authenticationPort: 1812,
  accountingPort: 1813,
  secret: "",
};

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) throw new Error("SESSION_SECRET is required to encrypt RADIUS credentials.");
  return createHash("sha256")
    .update(`ochola-supernet:platform-radius-settings:v1:${sessionSecret}`)
    .digest();
}

function normalizePort(value: unknown, fallback: number, label: string): number {
  const port = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a whole number between 1 and 65535.`);
  }
  return port;
}

function normalizeHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  if (host.length > 253 || (host && !/^[A-Za-z0-9:._-]+$/u.test(host))) {
    throw new Error("Enter a valid RADIUS server hostname or IP address.");
  }
  return host;
}

function normalizeSecret(value: unknown, existing: string): string {
  const secret = typeof value === "string" && value.length > 0 ? value : existing;
  if (secret.length > 256 || /[\u0000-\u001F\u007F"]/u.test(secret)) {
    throw new Error("RADIUS shared secret is too long or contains unsupported characters.");
  }
  return secret;
}

export function normalizePlatformRadiusSettings(
  input: unknown,
  existingSecret = "",
): PlatformRadiusSettings {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const settings: PlatformRadiusSettings = {
    enabled: body.enabled === true,
    host: normalizeHost(body.host),
    authenticationPort: normalizePort(body.authenticationPort, 1812, "RADIUS authentication port"),
    accountingPort: normalizePort(body.accountingPort, 1813, "RADIUS accounting port"),
    secret: normalizeSecret(body.secret, existingSecret),
  };
  if (settings.enabled && (!settings.host || !settings.secret)) {
    throw new Error("Enter the RADIUS host and shared secret before enabling platform RADIUS.");
  }
  return settings;
}

function encryptSettings(settings: PlatformRadiusSettings): Omit<EncryptedRadiusSettings, "id"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSettings(record: EncryptedRadiusSettings): PlatformRadiusSettings {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return normalizePlatformRadiusSettings(JSON.parse(plaintext) as unknown);
}

function environmentSettings(): PlatformRadiusSettings {
  const host = process.env.RADIUS_SERVER_IP?.trim() ?? "";
  const secret = process.env.RADIUS_SHARED_SECRET ?? process.env.RADIUS_SECRET ?? "";
  return normalizePlatformRadiusSettings({
    enabled: Boolean(host && secret),
    host,
    authenticationPort: process.env.RADIUS_AUTHENTICATION_PORT ?? process.env.RADIUS_PORT,
    accountingPort: process.env.RADIUS_ACCOUNTING_PORT,
    secret,
  });
}

export async function readPlatformRadiusSettings(): Promise<{
  settings: PlatformRadiusSettings;
  source: PublicPlatformRadiusSettings["source"];
}> {
  if (platformSecureSettingsConfigured()) {
    let rows: EncryptedRadiusSettings[];
    try {
      rows = await platformSecureSettingsSelect<EncryptedRadiusSettings>(
        `id=eq.${SETTINGS_ID}&select=id,ciphertext,iv,auth_tag&limit=1`,
      );
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "[platform-radius] secure settings read failed",
      );
      throw new Error("Secure RADIUS settings are unavailable. Apply the platform RADIUS migration.");
    }
    if (rows[0]) {
      try {
        return { settings: decryptSettings(rows[0]), source: "database" };
      } catch (error) {
        logger.error(
          { errorType: error instanceof Error ? error.name : "unknown" },
          "[platform-radius] secure settings could not be decrypted",
        );
        throw new Error("Saved RADIUS settings could not be decrypted. Check the server encryption configuration.");
      }
    }
  }
  const envSettings = environmentSettings();
  return {
    settings: envSettings,
    source: envSettings.enabled ? "environment" : "none",
  };
}

export async function savePlatformRadiusSettings(input: unknown): Promise<PlatformRadiusSettings> {
  if (!platformSecureSettingsConfigured()) {
    throw new Error("Secure platform settings require Supabase service-role configuration.");
  }
  const current = await readPlatformRadiusSettings();
  const settings = normalizePlatformRadiusSettings(input, current.settings.secret);
  const saved = await platformSecureSettingsUpsert<EncryptedRadiusSettings>("id", {
    id: SETTINGS_ID,
    ...encryptSettings(settings),
    updated_at: new Date().toISOString(),
  });
  if (!saved[0]) {
    throw new Error("RADIUS settings could not be saved. Apply the platform RADIUS migration.");
  }
  return settings;
}

export function publicPlatformRadiusSettings(
  settings: PlatformRadiusSettings,
  source: PublicPlatformRadiusSettings["source"],
): PublicPlatformRadiusSettings {
  const { secret, ...publicSettings } = settings;
  return {
    ...publicSettings,
    hasSecret: secret.length > 0,
    configured: settings.enabled && Boolean(settings.host && secret),
    source,
  };
}
