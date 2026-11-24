import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sbRpc } from "../lib/supabase-client.js";
import { sendPlatformEmail } from "../lib/platform-email.js";
import { sendSmsOtp } from "./sms/sms-service.js";

export type IspAdminRecoveryChannel = "email" | "phone";
const OTP_TTL_SECONDS = 5 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim()
    || process.env.TOKEN_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("Admin recovery signing is not configured.");
  return secret;
}

function hmac(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("hex");
}

export function hashIspAdminRecoveryCode(challengeId: string, code: string): string {
  return hmac(`isp-admin-password-reset:otp:v1:${challengeId}:${code}`);
}

export function hashIspAdminRecoveryActionToken(token: string): string {
  return hmac(`isp-admin-password-reset:action:v1:${token}`);
}

export function hashIspAdminRecoveryRequestIp(ipAddress: string): string {
  return hmac(`isp-admin-password-reset:ip:v1:${ipAddress.trim() || "unknown"}`);
}

export function hashIspAdminRecoveryDestination(
  channel: IspAdminRecoveryChannel,
  destination: string,
): string {
  const normalized = channel === "email"
    ? destination.trim().toLowerCase()
    : destination.replace(/\D/g, "");
  return hmac(`isp-admin-password-reset:destination:v1:${channel}:${normalized}`);
}

export function isIspAdminRecoveryChallengeId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isIspAdminRecoveryCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function isIspAdminRecoveryActionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

export function maskIspAdminRecoveryEmail(value: string): string | null {
  const email = value.trim();
  const at = email.lastIndexOf("@");
  if (email.length > 254 || at < 1 || at === email.length - 1 || /\s/.test(email)) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[^\s@]+$/.test(local) || !/^[^\s@.]+(?:\.[^\s@.]+)+$/.test(domain)) return null;
  return `${local[0]}****${local.at(-1)}@${domain}`;
}

export function maskIspAdminRecoveryPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `${digits.slice(0, 6)}****${digits.at(-1)}`;
}

export async function allowIspAdminPasswordRecoveryLookup(ipAddress: string): Promise<boolean> {
  const [result] = await sbRpc<{ allowed: boolean }>(
    "allow_isp_admin_password_reset_lookup",
    { p_ip_hash: hashIspAdminRecoveryRequestIp(ipAddress) },
  );
  return result?.allowed === true;
}

export async function issueIspAdminPasswordRecovery(input: {
  tenantAdminId: number;
  targetAdminId: number;
  channel: IspAdminRecoveryChannel;
  destination: string;
  requestIp: string;
}): Promise<
  | { outcome: "sent"; challengeId: string; expiresInSeconds: number }
  | { outcome: "limited" | "unavailable" | "delivery_failed" }
> {
  const challengeId = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const [issued] = await sbRpc<{ outcome: string }>("issue_isp_admin_password_reset", {
    p_id: challengeId,
    p_tenant_admin_id: input.tenantAdminId,
    p_target_admin_id: input.targetAdminId,
    p_channel: input.channel,
    p_destination_hash: hashIspAdminRecoveryDestination(input.channel, input.destination),
    p_otp_hash: hashIspAdminRecoveryCode(challengeId, code),
    p_ip_hash: hashIspAdminRecoveryRequestIp(input.requestIp),
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });
  if (issued?.outcome === "limited") return { outcome: "limited" };
  if (issued?.outcome !== "issued") return { outcome: "unavailable" };

  try {
    if (input.channel === "email") {
      await sendPlatformEmail({
        fromName: "ISP Administrator Security",
        to: input.destination,
        subject: "Your ISP administrator password reset code",
        text: [
          `Your password reset code is ${code}.`,
          "",
          "It expires in five minutes and can only be used once.",
          "If you did not request this reset, ignore this message.",
        ].join("\n"),
      });
    } else {
      await sendSmsOtp(input.destination, code);
    }
  } catch {
    await sbRpc("invalidate_isp_admin_password_reset", {
      p_id: challengeId,
      p_tenant_admin_id: input.tenantAdminId,
    }).catch(() => []);
    return { outcome: "delivery_failed" };
  }

  return { outcome: "sent", challengeId, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyIspAdminPasswordRecoveryCode(input: {
  challengeId: string;
  code: string;
}): Promise<string | null> {
  if (!isIspAdminRecoveryChallengeId(input.challengeId) || !isIspAdminRecoveryCode(input.code)) {
    return null;
  }
  const resetToken = randomBytes(32).toString("base64url");
  const [verified] = await sbRpc<{ outcome: string }>(
    "verify_isp_admin_password_reset",
    {
      p_id: input.challengeId,
      p_otp_hash: hashIspAdminRecoveryCode(input.challengeId, input.code),
      p_action_token_hash: hashIspAdminRecoveryActionToken(resetToken),
    },
  );
  return verified?.outcome === "verified" ? resetToken : null;
}

export async function consumeIspAdminPasswordRecoveryToken(input: {
  tenantAdminId: number;
  resetToken: string;
}): Promise<number | null> {
  if (!isIspAdminRecoveryActionToken(input.resetToken)) return null;
  const [result] = await sbRpc<{
    consumed: boolean;
    target_admin_id: number;
  }>("consume_isp_admin_password_reset", {
    p_tenant_admin_id: input.tenantAdminId,
    p_action_token_hash: hashIspAdminRecoveryActionToken(input.resetToken),
  });
  const targetAdminId = Number(result?.target_admin_id);
  return result?.consumed && Number.isSafeInteger(targetAdminId) && targetAdminId > 0
    ? targetAdminId
    : null;
}
