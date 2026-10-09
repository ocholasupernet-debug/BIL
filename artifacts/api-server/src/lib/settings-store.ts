/**
 * Local JSON storage for non-secret settings.
 * Daraja credentials and configuration are encrypted and stored in Supabase.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { logger } from "./logger.js";
import {
  platformSecureSettingsConfigured,
  platformSecureSettingsInsert,
  platformSecureSettingsSelect,
  platformSecureSettingsUpsert,
} from "./platform-billing-store.js";
import {
  sbSelect,
  supabaseConfigured,
} from "./supabase-client.js";

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
  paymentDestinations?: PaymentDestinationSettings & {
    registrationFeeDefaultVersion?: number;
  };
}

function readFile(): SettingsFile {
  try {
    if (!existsSync(STORE_FILE)) return {};
    return JSON.parse(readFileSync(STORE_FILE, "utf8")) as SettingsFile;
  } catch {
    return {};
  }
}

function writeFile(data: SettingsFile): boolean {
  let temporaryFile: string | undefined;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    temporaryFile = path.join(DATA_DIR, `settings.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryFile, STORE_FILE);
    temporaryFile = undefined;
    return true;
  } catch (e) {
    logger.error({ err: e }, "[settings-store] failed to write settings file");
    if (temporaryFile) {
      try {
        unlinkSync(temporaryFile);
      } catch {
        // Preserve and report the original write error.
      }
    }
    return false;
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

export interface EncryptedDarajaSettings {
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

export class MpesaSettingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpesaSettingsUnavailableError";
  }
}

function hasCompleteDarajaSettings(settings: MpesaSettings): boolean {
  return !!(settings.consumerKey && settings.consumerSecret && settings.shortcode && settings.passkey);
}

function emptyMpesaSettings(): MpesaSettings {
  return {
    consumerKey: "",
    consumerSecret: "",
    shortcode: "",
    passkey: "",
    callbackUrl: "",
    env: "sandbox",
    tillNumber: "",
  };
}

function submittedValue(value: unknown): string {
  return typeof value === "string" && value.trim() !== "**hidden**" ? value.trim() : "";
}

/**
 * The encrypted Super Admin record is authoritative. Keep saved credentials
 * when a caller submits blank fields or the UI's masked-secret placeholder.
 */
export function mergeMpesaSettingsPreservingCredentials(
  current: MpesaSettings,
  incoming: Partial<MpesaSettings>,
): MpesaSettings {
  const normalised = normaliseMpesaSettings(incoming);
  const keepOrReplace = (field: keyof Pick<MpesaSettings, "consumerKey" | "consumerSecret" | "shortcode" | "passkey">): string =>
    submittedValue(incoming[field]) ? normalised[field] : current[field];

  return {
    consumerKey: keepOrReplace("consumerKey"),
    consumerSecret: keepOrReplace("consumerSecret"),
    shortcode: keepOrReplace("shortcode"),
    passkey: keepOrReplace("passkey"),
    callbackUrl: normalised.callbackUrl || current.callbackUrl,
    env: incoming.env === "production" || incoming.env === "sandbox" ? incoming.env : current.env,
    // A blank Till is an intentional way to remove the optional destination.
    tillNumber: typeof incoming.tillNumber === "string" ? normalised.tillNumber : current.tillNumber,
  };
}

export interface MpesaSettingsWriteAdapter {
  readCurrent(): Promise<EncryptedDarajaSettings | null>;
  decrypt(record: EncryptedDarajaSettings): MpesaSettings;
  archive(record: EncryptedDarajaSettings): Promise<void>;
  write(settings: MpesaSettings): Promise<void>;
}

/** Shared fail-closed persistence flow, exported so its no-overwrite rule is testable. */
export async function persistMpesaSettingsSafely(
  incoming: MpesaSettings,
  storage: MpesaSettingsWriteAdapter,
): Promise<void> {
  const record = await storage.readCurrent();
  let current = emptyMpesaSettings();
  if (record) {
    try {
      current = storage.decrypt(record);
    } catch {
      throw new MpesaSettingsUnavailableError(
        "Saved Super Admin Daraja settings could not be decrypted by this API. No changes were saved and the encrypted record was left intact. Verify this server uses the same SESSION_SECRET that was used when the settings were saved.",
      );
    }
  }

  const next = mergeMpesaSettingsPreservingCredentials(current, incoming);
  if (record) await storage.archive(record);
  await storage.write(next);
}

async function archiveEncryptedMpesaSettings(record: EncryptedDarajaSettings): Promise<void> {
  const archived = await platformSecureSettingsInsert<EncryptedDarajaSettings>({
    id: `${DARAJA_SETTINGS_ID}_backup_${Date.now()}_${randomUUID()}`,
    ciphertext: record.ciphertext,
    iv: record.iv,
    auth_tag: record.auth_tag,
    updated_at: new Date().toISOString(),
  });
  if (!archived[0]) {
    throw new MpesaSettingsUnavailableError(
      "The existing encrypted Daraja settings could not be backed up. No changes were saved.",
    );
  }
}

/** Loads the single global Daraja configuration managed by Super Admin. */
export async function getMpesaSettings(): Promise<MpesaSettings> {
  const bootstrap = bootstrapMpesaSettings();
  if (!platformSecureSettingsConfigured()) {
    if (!supabaseConfigured) return bootstrap;
    throw new MpesaSettingsUnavailableError(
      "Super Admin Daraja settings require the server-only Supabase service key. No settings were changed.",
    );
  }
  if (!encryptionKey()) {
    throw new MpesaSettingsUnavailableError(
      "Super Admin Daraja settings are unavailable because SESSION_SECRET is missing on this API. No settings were changed.",
    );
  }

  let rows: EncryptedDarajaSettings[];
  try {
    rows = await platformSecureSettingsSelect<EncryptedDarajaSettings>(
      `id=eq.${DARAJA_SETTINGS_ID}&select=id,ciphertext,iv,auth_tag&limit=1`,
    );
  } catch (err) {
    logger.error({ err }, "[settings-store] could not load global Daraja settings");
    throw new MpesaSettingsUnavailableError(
      "Super Admin Daraja settings could not be loaded from secure storage. No settings were changed.",
    );
  }

  const record = rows[0];
  if (record) {
    try {
      const settings = decryptMpesaSettings(record);
      scrubLegacyDarajaSecrets();
      return settings;
    } catch (err) {
      logger.error({ err }, "[settings-store] could not decrypt Daraja settings");
      throw new MpesaSettingsUnavailableError(
        "Saved Super Admin Daraja settings could not be decrypted by this API. No settings were changed. Verify that this server uses the same SESSION_SECRET that was used when the settings were saved.",
      );
    }
  }

  if (hasCompleteDarajaSettings(bootstrap)) {
    // Legacy environment values are only accepted as a one-time bootstrap
    // after the complete configuration has been persisted centrally.
    await saveMpesaSettings(bootstrap);
    logger.info("[settings-store] complete Daraja settings securely bootstrapped to Supabase");
  }
  return bootstrap;
}

/** Archives, merges, encrypts, and saves the global Super Admin Daraja record. */
export async function saveMpesaSettings(settings: MpesaSettings): Promise<void> {
  if (!platformSecureSettingsConfigured()) {
    throw new MpesaSettingsUnavailableError(
      "A server-only Supabase service key is required for secure Daraja storage.",
    );
  }
  if (!encryptionKey()) {
    throw new MpesaSettingsUnavailableError("SESSION_SECRET is required to encrypt Daraja settings.");
  }

  await persistMpesaSettingsSafely(settings, {
    readCurrent: async () => {
      try {
        const rows = await platformSecureSettingsSelect<EncryptedDarajaSettings>(
          `id=eq.${DARAJA_SETTINGS_ID}&select=id,ciphertext,iv,auth_tag&limit=1`,
        );
        return rows[0] ?? null;
      } catch (err) {
        logger.error({ err }, "[settings-store] could not verify current Daraja settings before save");
        throw new MpesaSettingsUnavailableError(
          "Secure M-Pesa storage could not be checked. No settings were changed; try again when the database is available.",
        );
      }
    },
    decrypt: record => {
      try {
        return decryptMpesaSettings(record);
      } catch (err) {
        logger.error({ err }, "[settings-store] refusing to overwrite unreadable Daraja settings");
        throw err;
      }
    },
    archive: archiveEncryptedMpesaSettings,
    write: async normalised => {
      const encrypted = encryptMpesaSettings(normalised);
      const saved = await platformSecureSettingsUpsert<EncryptedDarajaSettings>(
        "id",
        { id: DARAJA_SETTINGS_ID, ...encrypted, updated_at: new Date().toISOString() },
      );
      if (!saved[0]) {
        throw new Error("Could not save encrypted Daraja settings to Supabase. Apply the secure settings migration first.");
      }
    },
  });
  scrubLegacyDarajaSecrets();
  logger.info("[settings-store] encrypted global Daraja settings saved to Supabase");
}

export function isMpesaConfigured(settings: MpesaSettings): boolean {
  return hasCompleteDarajaSettings(settings);
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
  registrationFee: number;
  registrationDestinationId: string;
  renewalDestinationId: string;
  registrationWhatsappNumber: string;
  destinations: PaymentDestination[];
}

export const DEFAULT_REGISTRATION_WHATSAPP_NUMBER = "+254798088650";
export const DEFAULT_REGISTRATION_FEE = 700;
const REGISTRATION_FEE_DEFAULT_VERSION = 1;
const LEGACY_STUCK_REGISTRATION_FEE = 10;

const EMPTY_DESTINATIONS: PaymentDestinationSettings = {
  registrationFee: DEFAULT_REGISTRATION_FEE,
  registrationDestinationId: "",
  renewalDestinationId: "",
  registrationWhatsappNumber: DEFAULT_REGISTRATION_WHATSAPP_NUMBER,
  destinations: [],
};

const MAX_REGISTRATION_FEE = 1_000_000;

export function normaliseRegistrationFee(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_REGISTRATION_FEE
    ? value
    : EMPTY_DESTINATIONS.registrationFee;
}

export function resolveStoredRegistrationFee(value: unknown, defaultVersion: unknown): number {
  // The prior live default was saved as 10. Upgrade that legacy default once,
  // while allowing Super Admin to intentionally set KSh 10 after this version.
  if (defaultVersion !== REGISTRATION_FEE_DEFAULT_VERSION && value === LEGACY_STUCK_REGISTRATION_FEE) {
    return DEFAULT_REGISTRATION_FEE;
  }
  return normaliseRegistrationFee(value);
}

export function normaliseRegistrationWhatsappNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const number = value.trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null;
}

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
    registrationFee: resolveStoredRegistrationFee(
      stored.registrationFee,
      stored.registrationFeeDefaultVersion,
    ),
    registrationDestinationId: validIds.has(stored.registrationDestinationId) ? stored.registrationDestinationId : "",
    renewalDestinationId: validIds.has(stored.renewalDestinationId) ? stored.renewalDestinationId : "",
    registrationWhatsappNumber:
      normaliseRegistrationWhatsappNumber(stored.registrationWhatsappNumber) ?? DEFAULT_REGISTRATION_WHATSAPP_NUMBER,
    destinations,
  };
}

export function savePaymentDestinations(settings: PaymentDestinationSettings): void {
  const data = readFile();
  const storedSettings = {
    ...settings,
    registrationFee: normaliseRegistrationFee(settings.registrationFee),
    registrationWhatsappNumber:
      normaliseRegistrationWhatsappNumber(settings.registrationWhatsappNumber) ?? DEFAULT_REGISTRATION_WHATSAPP_NUMBER,
    registrationFeeDefaultVersion: REGISTRATION_FEE_DEFAULT_VERSION,
  };
  data.paymentDestinations = storedSettings;
  if (!writeFile(data)) {
    throw new Error("Payment settings could not be persisted.");
  }
  const persisted = readFile().paymentDestinations;
  if (
    persisted?.registrationFee !== storedSettings.registrationFee ||
    persisted.registrationFeeDefaultVersion !== REGISTRATION_FEE_DEFAULT_VERSION
  ) {
    throw new Error("Payment settings could not be verified after saving.");
  }
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
  const next = {
    ...current,
    registrationDestinationId: !destination.active && current.registrationDestinationId === destination.id
      ? ""
      : current.registrationDestinationId,
    renewalDestinationId: !destination.active && current.renewalDestinationId === destination.id
      ? ""
      : current.renewalDestinationId,
    destinations,
  };
  savePaymentDestinations(next);
  return next;
}

/**
 * Makes a separately configured M-Pesa Till usable for registration when an
 * administrator has not selected a separate registration destination yet.
 * The Daraja business shortcode is an API credential, not a PayBill destination.
 */
export function ensureMpesaRegistrationDestination(settings: Pick<MpesaSettings, "shortcode" | "tillNumber">): PaymentDestinationSettings {
  let current = getPaymentDestinations();
  const selected = current.destinations.find(row =>
    row.id === current.registrationDestinationId && row.active,
  );

  const isGeneratedShortcodeDestination = !!selected &&
    selected.type === "paybill" &&
    selected.accountReference === "ISP Registration" &&
    (selected.name === `M-Pesa PayBill ${selected.number}` ||
      selected.name === `M-Pesa Business Shortcode ${selected.number}`);
  if (isGeneratedShortcodeDestination) {
    current = {
      ...current,
      registrationDestinationId: "",
      destinations: current.destinations.filter(row => row.id !== selected.id),
    };
    savePaymentDestinations(current);
  }

  const activeSelection = current.destinations.find(row =>
    row.id === current.registrationDestinationId && row.active,
  );
  if (activeSelection) return current;

  const number = settings.tillNumber.trim();
  if (!number) return current;

  const type: PaymentDestinationType = "till";
  const existing = current.destinations.find(row =>
    row.active && row.type === type && row.number === number,
  );
  const now = new Date().toISOString();
  const destination: PaymentDestination = existing ?? {
    id: `destination_${randomUUID()}`,
    type,
    name: `M-Pesa Till ${number}`,
    number,
    accountReference: "ISP Registration",
    instructions: "",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const next: PaymentDestinationSettings = {
    ...current,
    registrationDestinationId: destination.id,
    destinations: existing ? current.destinations : [...current.destinations, destination],
  };
  savePaymentDestinations(next);
  logger.info({ type, number }, "[settings-store] selected configured M-Pesa destination for registration");
  return next;
}

export function deletePaymentDestination(id: string): PaymentDestinationSettings {
  const current = getPaymentDestinations();
  const next = {
    registrationFee: current.registrationFee,
    registrationDestinationId: current.registrationDestinationId === id ? "" : current.registrationDestinationId,
    renewalDestinationId: current.renewalDestinationId === id ? "" : current.renewalDestinationId,
    registrationWhatsappNumber: current.registrationWhatsappNumber,
    destinations: current.destinations.filter(row => row.id !== id),
  };
  savePaymentDestinations(next);
  return next;
}
