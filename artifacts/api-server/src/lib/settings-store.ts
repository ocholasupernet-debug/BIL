/**
 * Simple JSON file–backed settings store.
 * All values can be overridden at runtime by environment variables.
 * File is written to <cwd>/data/settings.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

const DATA_DIR  = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "settings.json");

export interface MpesaSettings {
  consumerKey:    string;
  consumerSecret: string;
  shortcode:      string;
  passkey:        string;
  callbackUrl:    string;
  env:            "sandbox" | "production";
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

/* ── M-Pesa ── */

/** Returns effective M-Pesa config: env vars take precedence over stored values. */
export function getMpesaSettings(): MpesaSettings {
  const stored = (readFile().mpesa ?? {}) as Partial<MpesaSettings>;
  return {
    consumerKey:    process.env.MPESA_CONSUMER_KEY    || stored.consumerKey    || "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || stored.consumerSecret || "",
    shortcode:      process.env.MPESA_SHORTCODE       || stored.shortcode      || "",
    passkey:        process.env.MPESA_PASSKEY         || stored.passkey        || "",
    callbackUrl:    process.env.MPESA_CALLBACK_URL    || stored.callbackUrl    || "",
    env:            (process.env.MPESA_ENV as MpesaSettings["env"]) || stored.env || "sandbox",
  };
}

/** Saves M-Pesa credentials to the store file. */
export function saveMpesaSettings(settings: MpesaSettings): void {
  const data = readFile();
  data.mpesa = settings;
  writeFile(data);
  logger.info("[settings-store] M-Pesa settings saved");
}

export function isMpesaConfigured(): boolean {
  const s = getMpesaSettings();
  return !!(s.consumerKey && s.consumerSecret && s.shortcode && s.passkey);
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
