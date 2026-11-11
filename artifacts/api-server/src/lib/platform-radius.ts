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
import type { RadiusDiscovery } from "./radius-discovery.js";

export interface PlatformRadiusSettings {
  enabled: boolean;
  host: string;
  authenticationPort: number;
  accountingPort: number;
  secret: string;
}

export interface PublicPlatformRadiusSettings extends Omit<
  PlatformRadiusSettings,
  "secret" | "host" | "authenticationPort" | "accountingPort"
> {
  host: string;
  authenticationPort: number | null;
  accountingPort: number | null;
  hasSecret: boolean;
  configured: boolean;
  source: "database" | "environment" | "none";
  vpsDiscovery: RadiusDiscovery | null;
  secretSynchronized: boolean;
}

interface StoredRadiusEnvelope {
  settings: PlatformRadiusSettings;
  vpsDiscovery: RadiusDiscovery | null;
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

function encryptSettings(
  settings: PlatformRadiusSettings,
  vpsDiscovery: RadiusDiscovery | null,
): Omit<EncryptedRadiusSettings, "id"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ settings, vpsDiscovery }), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSettings(record: EncryptedRadiusSettings): StoredRadiusEnvelope {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as unknown;
  const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  // Preserve compatibility with the original encrypted settings object.
  if (value.settings && typeof value.settings === "object") {
    return {
      settings: normalizePlatformRadiusSettings(value.settings),
      vpsDiscovery: (value.vpsDiscovery && typeof value.vpsDiscovery === "object"
        ? value.vpsDiscovery
        : null) as RadiusDiscovery | null,
    };
  }
  return { settings: normalizePlatformRadiusSettings(parsed), vpsDiscovery: null };
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
  vpsDiscovery: RadiusDiscovery | null;
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
        const stored = decryptSettings(rows[0]);
        return { ...stored, source: "database" };
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
    vpsDiscovery: null,
  };
}

export async function savePlatformRadiusSettings(input: unknown): Promise<PlatformRadiusSettings> {
  if (!platformSecureSettingsConfigured()) {
    throw new Error("Secure platform settings require Supabase service-role configuration.");
  }
  const current = await readPlatformRadiusSettings();
  const discovery = current.vpsDiscovery;
  if (!discovery?.endpointVerified || !discovery.radiusHost
    || !discovery.authenticationPort || !discovery.accountingPort) {
    throw new Error("Run a successful configured VPS RADIUS check before saving an endpoint.");
  }
  const safeInput = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const { secret: _ignoredSecret, ...settingsInput } = safeInput;
  const settings = normalizePlatformRadiusSettings({
    ...settingsInput,
    host: discovery.radiusHost,
    authenticationPort: discovery.authenticationPort,
    accountingPort: discovery.accountingPort,
  }, current.settings.secret);
  if (settings.enabled && current.vpsDiscovery?.secretSynchronized !== true) {
    throw new Error("Provision the shared secret to selected routers before enabling platform RADIUS.");
  }
  const saved = await platformSecureSettingsUpsert<EncryptedRadiusSettings>("id", {
    id: SETTINGS_ID,
    ...encryptSettings(settings, current.vpsDiscovery),
    updated_at: new Date().toISOString(),
  });
  if (!saved[0]) {
    throw new Error("RADIUS settings could not be saved. Apply the platform RADIUS migration.");
  }
  return settings;
}

export function generatePlatformRadiusSecret(): string {
  return randomBytes(48).toString("base64url");
}

export async function createOrRotatePlatformRadiusSecret(
  rotate: boolean,
): Promise<string> {
  if (!platformSecureSettingsConfigured()) {
    throw new Error("Secure platform settings require Supabase service-role configuration.");
  }
  const current = await readPlatformRadiusSettings();
  if (rotate && !current.settings.secret) {
    throw new Error("Create the initial RADIUS secret before rotating it.");
  }
  if (!rotate && current.settings.secret) {
    throw new Error("A RADIUS secret already exists. Use the explicit rotation action.");
  }
  const secret = generatePlatformRadiusSecret();
  const settings = { ...current.settings, secret, enabled: false };
  const discovery = current.vpsDiscovery
    ? { ...current.vpsDiscovery, secretSynchronized: false }
    : null;
  const saved = await platformSecureSettingsUpsert<EncryptedRadiusSettings>("id", {
    id: SETTINGS_ID,
    ...encryptSettings(settings, discovery),
    updated_at: new Date().toISOString(),
  });
  if (!saved[0]) throw new Error("RADIUS secret could not be saved securely.");
  return secret;
}

export async function savePlatformRadiusDiscovery(
  discovery: RadiusDiscovery,
): Promise<void> {
  if (!platformSecureSettingsConfigured()) {
    throw new Error("Secure platform settings require Supabase service-role configuration.");
  }
  const current = await readPlatformRadiusSettings();
  const saved = await platformSecureSettingsUpsert<EncryptedRadiusSettings>("id", {
    id: SETTINGS_ID,
    ...encryptSettings(current.settings, discovery),
    updated_at: new Date().toISOString(),
  });
  if (!saved[0]) throw new Error("RADIUS discovery status could not be saved.");
}

export function publicPlatformRadiusSettings(
  settings: PlatformRadiusSettings,
  source: PublicPlatformRadiusSettings["source"],
  vpsDiscovery: RadiusDiscovery | null = null,
): PublicPlatformRadiusSettings {
  const { secret, ...publicSettings } = settings;
  const endpointVerified = vpsDiscovery?.endpointVerified === true;
  return {
    ...publicSettings,
    host: endpointVerified ? vpsDiscovery.radiusHost ?? "" : "",
    authenticationPort: endpointVerified ? vpsDiscovery.authenticationPort : null,
    accountingPort: endpointVerified ? vpsDiscovery.accountingPort : null,
    hasSecret: secret.length > 0,
    configured: endpointVerified
      && vpsDiscovery.secretSynchronized === true
      && Boolean(vpsDiscovery.radiusHost && secret),
    source,
    vpsDiscovery,
    secretSynchronized: vpsDiscovery?.secretSynchronized === true,
  };
}
