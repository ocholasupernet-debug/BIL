/**
 * Local JSON storage for non-secret settings.
 * Daraja credentials and configuration are encrypted and stored in Supabase.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { logger } from "./logger.js";
import { sbSelect, sbUpsert, supabaseConfigured } from "./supabase-client.js";

const DATA_DIR  = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "settings.json");

export interface MpesaSettings {
  consumerKey:    string;
  consumerSecret: string;
  shortcode:      string;
  passkey:        string;
  callbackUrl:    string;
  env:            "sandbox" | "production";
  tillNumber:     string;
}

interface SettingsFile {
  mpesa?: MpesaSettings;
  paymentDestinations?: PaymentDestinationSettings;
}

function readFile(): SettingsFile {
  try {
    if (!existsSync(STORE_FILE)) return {};
    return JSON.parse(readFileSync(STORE_FILE, "utf8")) as SettingsFile;
  } catch {
    return {};
  }
}

function writeFile(data: SettingsFile): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    logger.error({ err: e }, "[settings-store] failed to write settings file");
  }
}

function scrubLegacyDarajaSecrets(): void {
  const data = readFile();
  if (!data.mpesa) return;
  const existing = normaliseMpesaSettings(data.mpesa);
  data.mpesa = {
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    shortcode: existing.shortcode,
    callbackUrl: existing.callbackUrl,
    env: existing.env,
    tillNumber: existing.tillNumber,
  };
  writeFile(data);
  logger.info("[settings-store] scrubbed legacy Daraja secrets from local settings");
}

/* ── M-Pesa ── */

const DARAJA_SETTINGS_ID = "global_daraja";

interface EncryptedDarajaSettings {
  id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

function encryptionKey(): Buffer | null {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) return null;
  return createHash("sha256")
    .update(`ochola-supernet:daraja-settings:v1:${sessionSecret}`)
    .digest();
}

function normaliseMpesaSettings(input: Partial<MpesaSettings>): MpesaSettings {
  const callbackUrl = typeof input.callbackUrl === "string" ? input.callbackUrl.trim() : "";
  const hasValidCallback = (() => {
    try {
      const parsed = new URL(callbackUrl);
      return parsed.protocol === "https:" &&
        !!parsed.hostname &&
        parsed.pathname === "/api/mpesa/callback";
    } catch {
      return false;
    }
  })();
  return {
    consumerKey: typeof input.consumerKey === "string" ? input.consumerKey.trim() : "",
    consumerSecret: typeof input.consumerSecret === "string" ? input.consumerSecret.trim() : "",
    shortcode: typeof input.shortcode === "string" ? input.shortcode.trim() : "",
    passkey: typeof input.passkey === "string" ? input.passkey.trim() : "",
    callbackUrl: hasValidCallback ? callbackUrl : "",
    env: input.env === "production" ? "production" : "sandbox",
    tillNumber: typeof input.tillNumber === "string" ? input.tillNumber.trim() : "",
  };
}

function bootstrapMpesaSettings(): MpesaSettings {
  const stored = (readFile().mpesa ?? {}) as Partial<MpesaSettings>;
  return normaliseMpesaSettings({
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE || stored.shortcode,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL || stored.callbackUrl,
    env: process.env.MPESA_ENV === "production" ? "production" : stored.env,
    tillNumber: process.env.MPESA_TILL_NUMBER || stored.tillNumber,
  });
}

function encryptMpesaSettings(settings: MpesaSettings): Omit<EncryptedDarajaSettings, "id"> {
  const key = encryptionKey();
  if (!key) throw new Error("SESSION_SECRET is required to encrypt Daraja settings.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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

function decryptMpesaSettings(record: EncryptedDarajaSettings): MpesaSettings {
  const key = encryptionKey();
  if (!key) throw new Error("SESSION_SECRET is required to decrypt Daraja settings.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return normaliseMpesaSettings(JSON.parse(decrypted) as Partial<MpesaSettings>);
}

function hasDarajaCredentials(settings: MpesaSettings): boolean {
  return !!(settings.consumerKey && settings.consumerSecret && settings.passkey);
}

/** Loads Daraja configuration from encrypted Supabase storage. */
export async function getMpesaSettings(): Promise<MpesaSettings> {
  const bootstrap = bootstrapMpesaSettings();
  if (!supabaseConfigured || !encryptionKey()) return bootstrap;

  const rows = await sbSelect<EncryptedDarajaSettings>(
    "platform_secure_settings",
    `id=eq.${DARAJA_SETTINGS_ID}&select=id,ciphertext,iv,auth_tag&limit=1`,
  );
  const record = rows[0];
  if (record) {
    try {
      const settings = decryptMpesaSettings(record);
      scrubLegacyDarajaSecrets();
      return settings;
    } catch (err) {
      logger.error({ err }, "[settings-store] could not decrypt Daraja settings");
      return normaliseMpesaSettings({
        shortcode: bootstrap.shortcode,
        callbackUrl: bootstrap.callbackUrl,
        env: bootstrap.env,
        tillNumber: bootstrap.tillNumber,
      });
    }
  }

  if (hasDarajaCredentials(bootstrap)) {
    try {
      await saveMpesaSettings(bootstrap);
      logger.info("[settings-store] Daraja settings securely bootstrapped to Supabase");
    } catch (err) {
      logger.warn({ err }, "[settings-store] Daraja settings bootstrap pending Supabase migration");
    }
  }
  return bootstrap;
}

/** Encrypts and saves Daraja configuration to Supabase. */
export async function saveMpesaSettings(settings: MpesaSettings): Promise<void> {
  if (!supabaseConfigured) throw new Error("Supabase must be configured to save Daraja settings.");
  const normalised = normaliseMpesaSettings(settings);
  const encrypted = encryptMpesaSettings(normalised);
  const saved = await sbUpsert<EncryptedDarajaSettings>(
    "platform_secure_settings",
    "id",
    { id: DARAJA_SETTINGS_ID, ...encrypted, updated_at: new Date().toISOString() },
  );
  if (!saved[0]) {
    throw new Error("Could not save encrypted Daraja settings to Supabase. Apply the secure settings migration first.");
  }
  scrubLegacyDarajaSecrets();
  logger.info("[settings-store] encrypted Daraja settings saved to Supabase");
}

export function isMpesaConfigured(settings: MpesaSettings): boolean {
  return !!(settings.consumerKey && settings.consumerSecret && settings.shortcode && settings.passkey);
}

export type PaymentDestinationType = "bank" | "till" | "paybill";

export interface PaymentDestination {
  id: string;
  type: PaymentDestinationType;
  name: string;
  number: string;
  accountReference: string;
  instructions: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDestinationSettings {
  registrationDestinationId: string;
  renewalDestinationId: string;
  destinations: PaymentDestination[];
}

const EMPTY_DESTINATIONS: PaymentDestinationSettings = {
  registrationDestinationId: "",
  renewalDestinationId: "",
  destinations: [],
};

function isDestinationType(value: unknown): value is PaymentDestinationType {
  return value === "bank" || value === "till" || value === "paybill";
}

function cleanDestination(value: unknown): PaymentDestination | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim() || !isDestinationType(row.type)) return null;
  if (typeof row.name !== "string" || typeof row.number !== "string") return null;
  return {
    id: row.id.trim(),
    type: row.type,
    name: row.name.trim(),
    number: row.number.trim(),
    accountReference: typeof row.accountReference === "string" ? row.accountReference.trim() : "",
    instructions: typeof row.instructions === "string" ? row.instructions.trim() : "",
    active: row.active !== false,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

export function getPaymentDestinations(): PaymentDestinationSettings {
  const stored = readFile().paymentDestinations;
  if (!stored || typeof stored !== "object") return { ...EMPTY_DESTINATIONS, destinations: [] };
  const destinations = Array.isArray(stored.destinations)
    ? stored.destinations.map(cleanDestination).filter((row): row is PaymentDestination => !!row)
    : [];
  const validIds = new Set(destinations.map(row => row.id));
  return {
    registrationDestinationId: validIds.has(stored.registrationDestinationId) ? stored.registrationDestinationId : "",
    renewalDestinationId: validIds.has(stored.renewalDestinationId) ? stored.renewalDestinationId : "",
    destinations,
  };
}

export function savePaymentDestinations(settings: PaymentDestinationSettings): void {
  const data = readFile();
  data.paymentDestinations = settings;
  writeFile(data);
  logger.info("[settings-store] payment destinations saved");
}

export function upsertPaymentDestination(input: {
  id?: string;
  type: PaymentDestinationType;
  name: string;
  number: string;
  accountReference?: string;
  instructions?: string;
  active?: boolean;
}): PaymentDestinationSettings {
  const current = getPaymentDestinations();
  const now = new Date().toISOString();
  const existing = input.id ? current.destinations.find(row => row.id === input.id) : undefined;
  const destination: PaymentDestination = {
    id: existing?.id ?? `destination_${randomUUID()}`,
    type: input.type,
    name: input.name.trim(),
    number: input.number.trim(),
    accountReference: input.accountReference?.trim() ?? "",
    instructions: input.instructions?.trim() ?? "",
    active: input.active !== false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const destinations = existing
    ? current.destinations.map(row => row.id === destination.id ? destination : row)
    : [...current.destinations, destination];
  const next = { ...current, destinations };
  savePaymentDestinations(next);
  return next;
}

export function deletePaymentDestination(id: string): PaymentDestinationSettings {
  const current = getPaymentDestinations();
  const next = {
    registrationDestinationId: current.registrationDestinationId === id ? "" : current.registrationDestinationId,
    renewalDestinationId: current.renewalDestinationId === id ? "" : current.renewalDestinationId,
    destinations: current.destinations.filter(row => row.id !== id),
  };
  savePaymentDestinations(next);
  return next;
}
