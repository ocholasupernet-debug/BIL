import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required for VPN secret storage.");
  return createHash("sha256")
    .update(`ochola-supernet:vpn-secrets:v1:${secret}`)
    .digest();
}

export function encryptVpnSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptVpnSecret(record: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}