import { createHmac, randomInt, randomUUID } from "node:crypto";
import { sbRpc, sbSelectStrict } from "../lib/supabase-client.js";
import { isValidEmailAddress, sendPlatformEmail } from "../lib/platform-email.js";
import { createGatewaySettingsGrant } from "./whatsapp/whatsapp-gateway-settings-otp.js";

const OTP_TTL_SECONDS = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function digest(purpose: string, value: string): string {
  const secret = process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("Email gateway OTP signing is not configured.");
  return createHmac("sha256", secret).update(`ochola-supernet:email-gateway-settings:${purpose}:v1:${value}`).digest("hex");
}
function emailOtpHash(id: string, code: string, session: string): string {
  return digest("otp", `${id}:${code}:${digest("session", session)}`);
}

export async function issueEmailGatewaySettingsOtp(input: {
  accountId: number; requestId: string; sessionToken: string; ip: string;
}): Promise<{ outcome: string; challengeId?: string }> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 || !UUID_PATTERN.test(input.requestId) || !input.sessionToken) return { outcome: "invalid" };
  const account = (await sbSelectStrict<{ email: string | null; is_active: boolean }>(
    "isp_admins", `id=eq.${input.accountId}&select=email,is_active&limit=1`,
  ))[0];
  const email = account?.email?.trim().toLowerCase() ?? "";
  if (!account || account.is_active !== true || !isValidEmailAddress(email)) return { outcome: "email_unavailable" };
  const id = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const issued = await sbRpc<{ outcome: string }>("issue_email_gateway_settings_otp", {
    p_id: id, p_account_id: input.accountId, p_email_address: email,
    p_auth_request_id: input.requestId, p_session_binding_hash: digest("session", input.sessionToken),
    p_otp_hash: emailOtpHash(id, code, input.sessionToken), p_ip_hash: input.ip ? digest("ip", input.ip) : "",
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });
  if (issued[0]?.outcome !== "issued") return { outcome: issued[0]?.outcome ?? "unavailable" };
  try {
    await sendPlatformEmail({ fromName: "BIL Security", to: email, subject: "Payment settings verification code", text: `Your BIL payment-settings code is ${code}.\n\nIt expires in five minutes and can be used once. Do not share it.` });
  } catch {
    return { outcome: "delivery_failed" };
  }
  return { outcome: "issued", challengeId: id };
}

export async function verifyEmailGatewaySettingsOtp(input: {
  accountId: number; email: string; challengeId: string; code: string;
  requestId: string; sessionToken: string;
}): Promise<{ outcome: string; grant?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 || !isValidEmailAddress(email)
    || !UUID_PATTERN.test(input.challengeId) || !UUID_PATTERN.test(input.requestId)
    || !/^\d{6}$/.test(input.code) || !input.sessionToken) return { outcome: "invalid" };
  const result = await sbRpc<{ outcome: string; email_address: string | null }>("verify_email_gateway_settings_otp", {
    p_id: input.challengeId, p_account_id: input.accountId, p_email_address: email,
    p_auth_request_id: input.requestId, p_session_binding_hash: digest("session", input.sessionToken),
    p_otp_hash: emailOtpHash(input.challengeId, input.code, input.sessionToken), p_max_attempts: 5,
  });
  if (result[0]?.outcome !== "verified" || result[0]?.email_address?.toLowerCase() !== email) {
    return { outcome: result[0]?.outcome ?? "invalid" };
  }
  const grant = await createGatewaySettingsGrant({ accountId: input.accountId, requestId: input.requestId, sessionToken: input.sessionToken });
  return { outcome: "verified", grant };
}

export function maskGatewaySettingsEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}
