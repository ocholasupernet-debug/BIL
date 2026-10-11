import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const CHAT_USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

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

export function createTawkIdentity(apiKey: string, userId: string = randomUUID()) {
  return {
    userId,
    hash: createHmac("sha256", apiKey).update(userId, "utf8").digest("hex"),
  };
}
