import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sbRpc } from "../lib/supabase-client.js";
import { sendPlatformEmail } from "../lib/platform-email.js";
import { sendSmsOtp } from "./sms/sms-service.js";

export type HotspotRecoveryChannel = "email" | "phone";
const OTP_TTL_SECONDS = 5 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryLookupWindows = new Map<string, { startedAt: number; count: number }>();

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim()
    || process.env.TOKEN_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("Password recovery signing is not configured.");
  return secret;
}

function hmac(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("hex");
}

export function hashHotspotRecoveryCode(challengeId: string, code: string): string {
  return hmac(`hotspot-customer-password-reset:otp:v1:${challengeId}:${code}`);
}

export function hashHotspotRecoveryActionToken(token: string): string {
  return hmac(`hotspot-customer-password-reset:action:v1:${token}`);
}

export function hashHotspotRecoveryRequestIp(ipAddress: string): string {
  return hmac(`hotspot-customer-password-reset:ip:v1:${ipAddress.trim() || "unknown"}`);
}

export function hashHotspotRecoveryDestination(
  channel: HotspotRecoveryChannel,
  destination: string,
): string {
  const normalized = channel === "email"
    ? destination.trim().toLowerCase()
    : destination.replace(/\D/g, "");
  return hmac(`hotspot-customer-password-reset:destination:v1:${channel}:${normalized}`);
}

export function isHotspotRecoveryChallengeId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isHotspotRecoveryCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function isHotspotRecoveryActionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

export function maskRecoveryEmail(value: string): string | null {
  const email = value.trim();
  const at = email.lastIndexOf("@");
  if (email.length > 254 || at < 1 || at === email.length - 1 || /\s/.test(email)) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[^\s@]+$/.test(local) || !/^[^\s@.]+(?:\.[^\s@.]+)+$/.test(domain)) return null;
  const maskedLocal = local.length === 1
    ? `${local[0]}***`
    : `${local[0]}****${local.at(-1)}`;
  return `${maskedLocal}@${domain}`;
}

export function maskRecoveryPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `${digits.slice(0, 6)}****${digits.at(-1)}`;
}

export function allowHotspotRecoveryLookup(
  ipAddress: string,
  now = Date.now(),
): boolean {
  const key = hmac(`hotspot-customer-password-reset:lookup-ip:v1:${ipAddress.trim() || "unknown"}`);
  const windowMs = 15 * 60 * 1000;
  const entry = recoveryLookupWindows.get(key);
  if (!entry || now - entry.startedAt >= windowMs) {
    recoveryLookupWindows.set(key, { startedAt: now, count: 1 });
    if (recoveryLookupWindows.size > 10_000) {
      for (const [oldKey, oldEntry] of recoveryLookupWindows) {
        if (now - oldEntry.startedAt >= windowMs) recoveryLookupWindows.delete(oldKey);
      }
    }
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

export async function allowHotspotPasswordRecoveryLookup(ipAddress: string): Promise<boolean> {
  const ipHash = hashHotspotRecoveryRequestIp(ipAddress);
  const [result] = await sbRpc<{ allowed: boolean }>(
    "allow_hotspot_customer_password_reset_lookup",
    { p_ip_hash: ipHash },
  );
  return result?.allowed === true;
}

export async function issueHotspotPasswordRecovery(input: {
  tenantAdminId: number;
  customerAdminId: number;
  customerId: number;
  channel: HotspotRecoveryChannel;
  destination: string;
  requestIp: string;
}): Promise<
  | { outcome: "sent"; challengeId: string; expiresInSeconds: number }
  | { outcome: "limited" | "unavailable" | "delivery_failed" }
> {
  const challengeId = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const ipHash = hashHotspotRecoveryRequestIp(input.requestIp);
  const [issued] = await sbRpc<{ outcome: string }>("issue_hotspot_customer_password_reset", {
    p_id: challengeId,
    p_tenant_admin_id: input.tenantAdminId,
    p_customer_admin_id: input.customerAdminId,
    p_customer_id: input.customerId,
    p_channel: input.channel,
    p_destination_hash: hashHotspotRecoveryDestination(input.channel, input.destination),
    p_otp_hash: hashHotspotRecoveryCode(challengeId, code),
    p_ip_hash: ipHash,
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });
  if (issued?.outcome === "limited") return { outcome: "limited" };
  if (issued?.outcome !== "issued") return { outcome: "unavailable" };

  try {
    const text = [
      `Your OCHOLASUPERNET Hotspot password reset code is ${code}.`,
      "",
      "This code expires in five minutes and can only be used once.",
      "If you did not request a password reset, ignore this message.",
    ].join("\n");
    if (input.channel === "email") {
      await sendPlatformEmail({
        fromName: "OcholaSupernet Billing Security",
        to: input.destination,
        subject: "Hotspot password reset code",
        text,
      });
    } else {
      await sendSmsOtp(input.destination, code);
    }
  } catch {
    await sbRpc("invalidate_hotspot_customer_password_reset", {
      p_id: challengeId,
      p_tenant_admin_id: input.tenantAdminId,
    }).catch(() => []);
    return { outcome: "delivery_failed" };
  }

  return { outcome: "sent", challengeId, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyHotspotPasswordRecoveryCode(input: {
  challengeId: string;
  code: string;
}): Promise<string | null> {
  if (!isHotspotRecoveryChallengeId(input.challengeId) || !isHotspotRecoveryCode(input.code)) {
    return null;
  }
  const resetToken = randomBytes(32).toString("base64url");
  const [verified] = await sbRpc<{ outcome: string }>(
    "verify_hotspot_customer_password_reset",
    {
      p_id: input.challengeId,
      p_otp_hash: hashHotspotRecoveryCode(input.challengeId, input.code),
      p_action_token_hash: hashHotspotRecoveryActionToken(resetToken),
    },
  );
  return verified?.outcome === "verified" ? resetToken : null;
}

export async function consumeHotspotPasswordRecoveryToken(input: {
  tenantAdminId: number;
  resetToken: string;
}): Promise<{ customerAdminId: number; customerId: number } | null> {
  if (!isHotspotRecoveryActionToken(input.resetToken)) return null;
  const [result] = await sbRpc<{
    consumed: boolean;
    customer_admin_id: number;
    customer_id: number;
  }>("consume_hotspot_customer_password_reset", {
    p_tenant_admin_id: input.tenantAdminId,
    p_action_token_hash: hashHotspotRecoveryActionToken(input.resetToken),
  });
  if (!result?.consumed) return null;
  return {
    customerAdminId: Number(result.customer_admin_id),
    customerId: Number(result.customer_id),
  };
}

export async function invalidateHotspotPasswordRecoveryChallenge(
  challengeId: string,
  tenantAdminId: number,
): Promise<void> {
  if (!isHotspotRecoveryChallengeId(challengeId)) return;
  await sbRpc("invalidate_hotspot_customer_password_reset", {
    p_id: challengeId,
    p_tenant_admin_id: tenantAdminId,
  });
}

