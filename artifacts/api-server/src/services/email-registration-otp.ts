import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sbRpc } from "../lib/supabase-client.js";
import { sendPlatformEmail } from "../lib/platform-email.js";

const OTP_TTL_SECONDS = 10 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CHALLENGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EmailRegistrationOtpRateLimitError extends Error {
  constructor() {
    super("Too many verification code requests. Try again later.");
    this.name = "EmailRegistrationOtpRateLimitError";
  }
}

export class EmailRegistrationOtpDeliveryError extends Error {
  constructor() {
    super("Email verification is currently unavailable. Please try again later.");
    this.name = "EmailRegistrationOtpDeliveryError";
  }
}

function getSigningSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("Email verification signing is not configured.");
  }
  return secret;
}

export function normalizeRegistrationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function isEmailRegistrationChallengeId(value: unknown): value is string {
  return typeof value === "string" && EMAIL_CHALLENGE_ID_PATTERN.test(value);
}

export function isEmailRegistrationCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function hashEmailRegistrationCode(
  challengeId: string,
  email: string,
  code: string,
): string {
  return createHmac("sha256", getSigningSecret())
    .update(`email-registration-otp:v1:${challengeId}:${email}:${code}`)
    .digest("hex");
}

export function hashEmailRegistrationToken(token: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`email-registration-token:v1:${token}`)
    .digest("hex");
}

function hashRequestIp(ipAddress: string): string {
  const ip = ipAddress.trim();
  if (!ip) return "";
  return createHmac("sha256", getSigningSecret())
    .update(`email-registration-ip:v1:${ip}`)
    .digest("hex");
}

export async function requestEmailRegistrationOtp(
  email: string,
  ipAddress: string,
): Promise<{ challengeId: string; expiresInSeconds: number }> {
  const normalizedEmail = normalizeRegistrationEmail(email);
  if (!normalizedEmail) throw new Error("Enter a valid email address.");

  const challengeId = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const [issue] = await sbRpc<{ outcome: string }>("issue_email_registration_otp", {
    p_id: challengeId,
    p_email: normalizedEmail,
    p_otp_hash: hashEmailRegistrationCode(challengeId, normalizedEmail, code),
    p_ip_hash: hashRequestIp(ipAddress),
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });

  if (issue?.outcome === "limited") {
    throw new EmailRegistrationOtpRateLimitError();
  }
  if (issue?.outcome !== "issued") {
    throw new Error("Email verification could not be started.");
  }

  try {
    await sendPlatformEmail({
      to: normalizedEmail,
      subject: "Your OcholaSupernet email verification code",
      text: [
        "Use this code to verify the email address for your OcholaSupernet sign-up:",
        "",
        code,
        "",
        "This code expires in 10 minutes and can only be used once.",
        "Do not share this code. If you did not request it, you can ignore this email.",
      ].join("\n"),
    });
  } catch {
    try {
      await sbRpc("invalidate_email_registration_otp", {
        p_id: challengeId,
        p_email: normalizedEmail,
      });
    } catch {
      // The challenge expires shortly even if best-effort invalidation fails.
    }
    throw new EmailRegistrationOtpDeliveryError();
  }

  return { challengeId, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyEmailRegistrationOtp(input: {
  email: string;
  challengeId: string;
  code: string;
}): Promise<string | null> {
  const email = normalizeRegistrationEmail(input.email);
  if (
    !email ||
    !isEmailRegistrationChallengeId(input.challengeId) ||
    !isEmailRegistrationCode(input.code)
  ) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const [verification] = await sbRpc<{ outcome: string }>(
    "verify_email_registration_otp",
    {
      p_id: input.challengeId,
      p_email: email,
      p_otp_hash: hashEmailRegistrationCode(
        input.challengeId,
        email,
        input.code,
      ),
      p_action_token_hash: hashEmailRegistrationToken(token),
    },
  );

  return verification?.outcome === "verified" ? token : null;
}

export async function consumeEmailRegistrationToken(
  token: string,
  email: string,
): Promise<boolean> {
  const normalizedEmail = normalizeRegistrationEmail(email);
  if (
    !normalizedEmail ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(token)
  ) {
    return false;
  }

  const [result] = await sbRpc<{ consumed: boolean }>(
    "consume_email_registration_token",
    {
      p_email: normalizedEmail,
      p_action_token_hash: hashEmailRegistrationToken(token),
    },
  );
  return result?.consumed === true;
}