import { createHmac } from "node:crypto";
import { decryptVpnSecret, encryptVpnSecret } from "./vpn-crypto.js";

const ENCRYPTED_PREFIX = "enc:v1:";

function lookupKey(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required for router credential storage.");
  return secret;
}

export function encryptRouterApiSecret(value: string): string {
  if (!value || value.startsWith(ENCRYPTED_PREFIX)) return value;
  const encrypted = encryptVpnSecret(value);
  return `${ENCRYPTED_PREFIX}${encrypted.iv}:${encrypted.auth_tag}:${encrypted.ciphertext}`;
}

export function decryptRouterApiSecret(value: string | null | undefined): string {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value ?? "";
  const [iv, auth_tag, ciphertext, ...extra] = value.slice(ENCRYPTED_PREFIX.length).split(":");
  if (!iv || !auth_tag || !ciphertext || extra.length) {
    throw new Error("Stored router API credential has an invalid encrypted format.");
  }
  return decryptVpnSecret({ iv, auth_tag, ciphertext });
}

export function routerApiSecretLookupHash(value: string): string {
  return createHmac("sha256", lookupKey())
    .update(`ochola-supernet:router-api-secret-lookup:v1:${value}`)
    .digest("hex");
}
