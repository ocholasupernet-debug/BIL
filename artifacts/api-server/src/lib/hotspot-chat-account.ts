import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const CHAT_USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const CHAT_REMEMBER_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

type ChatRememberClaims = {
  version: 1;
  adminId: number;
  accountId: number;
  mac: string;
  expiresAt: number;
};

export function normalizeChatUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return CHAT_USERNAME_PATTERN.test(username) ? username.toLowerCase() : null;
}

export function hashChatPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
}

export function verifyChatPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!salt || !/^[a-f0-9]{128}$/i.test(expectedHash)) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeRouterMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mac = value.trim().replace(/[:-]/g, "").toUpperCase();
  return /^[A-F0-9]{12}$/.test(mac) ? mac : null;
}

export function createChatRememberToken(
  secret: string,
  accountId: number,
  adminId: number,
  mac: string,
  now = Date.now(),
): string {
  const claims: ChatRememberClaims = {
    version: 1,
    adminId,
    accountId,
    mac,
    expiresAt: Math.floor(now / 1000) + CHAT_REMEMBER_TOKEN_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyChatRememberToken(
  secret: string,
  token: unknown,
  adminId: number,
  mac: string,
  now = Date.now(),
): { accountId: number } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ChatRememberClaims>;
    if (claims.version !== 1 || claims.adminId !== adminId || claims.mac !== mac
        || !Number.isSafeInteger(claims.accountId) || Number(claims.accountId) < 1
        || !Number.isSafeInteger(claims.expiresAt) || Number(claims.expiresAt) <= Math.floor(now / 1000)) {
      return null;
    }
    return { accountId: Number(claims.accountId) };
  } catch {
    return null;
  }
}

export function createTawkIdentity(apiKey: string, userId: string = randomUUID()) {
  return {
    userId,
    hash: createHmac("sha256", apiKey).update(userId, "utf8").digest("hex"),
  };
}
