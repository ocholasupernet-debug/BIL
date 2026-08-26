import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PREFIX = "scrypt";

function deriveScryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Hashes newly-created ISP admin passwords without adding a native dependency. */
export async function hashIspAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await deriveScryptKey(password, salt);
  return `${SCRYPT_PREFIX}$${salt}$${derivedKey.toString("base64url")}`;
}

/**
 * Supports existing plaintext ISP-admin passwords while new registrations use
 * scrypt. Legacy values are not returned to browser clients.
 */
export async function verifyIspAdminPassword(stored: unknown, supplied: string): Promise<boolean> {
  if (typeof stored !== "string" || !supplied) return false;
  const [scheme, salt, encodedKey, ...extra] = stored.split("$");
  if (scheme === SCRYPT_PREFIX && salt && encodedKey && extra.length === 0) {
    try {
      return safeEqual(
        Buffer.from(encodedKey, "base64url"),
        await deriveScryptKey(supplied, salt),
      );
    } catch {
      return false;
    }
  }
  return safeEqual(Buffer.from(stored), Buffer.from(supplied));
}