import { createHash, createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_BYTES = 64;
const EMPLOYEE_COOKIE = "bil_employee_session";

export const employeeSessionCookieName = EMPLOYEE_COOKIE;

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("Employee secure storage is unavailable.");
  return createHash("sha256").update(`bil:employee-payout:v1:${secret}`).digest();
}

export async function hashEmployeePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptAsync(password, salt, KEY_BYTES) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyEmployeePassword(stored: string, supplied: string): Promise<boolean> {
  const [scheme, salt, encoded, ...extra] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !encoded || extra.length) return false;
  try {
    const actual = Buffer.from(encoded, "base64url");
    const candidate = await scryptAsync(supplied, salt, KEY_BYTES) as Buffer;
    return actual.length === candidate.length && timingSafeEqual(actual, candidate);
  } catch {
    return false;
  }
}

export function hashEmployeeSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptEmployeePayoutDetails(value: Record<string, unknown>): {
  ciphertext: string;
  iv: string;
  auth_tag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptEmployeePayoutDetails(input: {
  ciphertext: string;
  iv: string;
  auth_tag: string;
}): Record<string, unknown> {
  let iv = input.iv;
  let authTag = input.auth_tag;
  let ciphertext = input.ciphertext;
  if (ciphertext.startsWith("v1:")) {
    const [, encodedIv, encodedTag, encodedCiphertext, ...extra] = ciphertext.split(":");
    if (!encodedIv || !encodedTag || !encodedCiphertext || extra.length) {
      throw new Error("Employee secure storage is unavailable.");
    }
    iv = encodedIv;
    authTag = encodedTag;
    ciphertext = encodedCiphertext;
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(clear);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Employee secure storage is unavailable.");
  }
  return parsed as Record<string, unknown>;
}

export function newEmployeeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newEmployeeAwardCode(): string {
  return `ISPLAT-AWARD-${randomBytes(24).toString("hex").toUpperCase()}`;
}

export function normalizeEmployeeAwardCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^ISPLAT-AWARD-[A-F0-9]{48}$/.test(code) ? code : null;
}

export function isMoneyString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value);
}

export function validEmployeeSubdomain(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.toLowerCase())
    && value.length <= 63;
}

export function maskedPayoutLabel(type: string, details: Record<string, unknown>): string {
  const raw = String(
    details.phone ?? details.accountNumber ?? details.paybillNumber ?? details.tillNumber ??
      details.paybill ?? details.till ?? details.businessNumber ?? "",
  ).replace(/\s+/g, "");
  if (!raw || raw.length < 4) return `${type} destination`;
  return `${type} ending ${raw.slice(-4)}`;
}

export function normalizePayoutDestination(
  type: unknown,
  value: unknown,
): { type: "bank" | "mpesa_b2c" | "pochi" | "paybill" | "till"; details: Record<string, string> } | null {
  if (!["bank", "mpesa_b2c", "pochi", "paybill", "till"].includes(String(type))) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const text = (key: string, max = 120) => {
    const result = typeof input[key] === "string" ? input[key].trim() : "";
    return result.length <= max ? result : "";
  };
  const kind = String(type) as "bank" | "mpesa_b2c" | "pochi" | "paybill" | "till";
  if (kind === "bank") {
    const accountName = text("accountName");
    const bankName = text("bankName");
    const accountNumber = text("accountNumber", 34).replace(/\s+/g, "");
    const branch = text("branch");
    if (accountName.length < 2 || bankName.length < 2 || !/^[A-Za-z0-9-]{5,34}$/.test(accountNumber)) return null;
    return { type: kind, details: { accountName, bankName, accountNumber, branch } };
  }
  if (kind === "mpesa_b2c" || kind === "pochi") {
    const raw = text("phone", 20).replace(/[\s()+-]/g, "");
    const phone = raw.startsWith("0") && /^0[17]\d{8}$/.test(raw) ? `254${raw.slice(1)}` : raw;
    if (!/^254[17]\d{8}$/.test(phone)) return null;
    const businessName = text("businessName");
    return { type: kind, details: { phone, businessName } };
  }
  if (kind === "paybill") {
    const paybillNumber = text("paybillNumber", 16).replace(/\s+/g, "");
    const accountReference = text("accountReference", 32).replace(/\s+/g, "");
    if (!/^\d{5,16}$/.test(paybillNumber) || accountReference.length < 1 || accountReference.length > 13) return null;
    return { type: kind, details: { paybillNumber, accountReference } };
  }
  const tillNumber = text("tillNumber", 16).replace(/\s+/g, "");
  if (!/^\d{5,16}$/.test(tillNumber)) return null;
  return { type: kind, details: { tillNumber, businessName: text("businessName") } };
}
