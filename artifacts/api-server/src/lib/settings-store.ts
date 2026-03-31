/**
 * Simple JSON file–backed settings store.
 * All values can be overridden at runtime by environment variables.
 * File is written to <cwd>/data/settings.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
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
