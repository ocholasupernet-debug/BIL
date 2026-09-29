import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function secretMatches(provided: string, configured: string): boolean {
  if (!provided || !configured) return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const configuredDigest = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

export function verifyStripeSignature(
  rawBody: Uint8Array | null | undefined,
  signatureHeader: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!rawBody?.byteLength || !signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith("t="))?.slice(2) ?? "";
  const timestampSeconds = Number(timestamp);
  if (
    !/^\d+$/.test(timestamp)
    || !Number.isSafeInteger(timestampSeconds)
    || Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > 300
  ) {
    return false;
  }

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(rawBody)]);
  const expected = createHmac("sha256", secret).update(signedPayload).digest();
  const signatures = parts
    .filter(part => part.startsWith("v1="))
    .map(part => part.slice(3))
    .filter(signature => /^[a-f0-9]{64}$/i.test(signature));

  return signatures.some(signature => {
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}