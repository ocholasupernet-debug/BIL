import {
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  sbInsertStrict,
  sbRpc,
  sbSelectStrict,
} from "../../lib/supabase-client.js";
import {
  generateWhatsAppOtp,
  sendWhatsAppOtp,
} from "./whatsapp-service.js";

const OTP_TTL_SECONDS = 5 * 60;
const GRANT_TTL_SECONDS = 10 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GatewayOtpChallengeRow {
  outcome: string;
}

interface GatewayOtpVerifyRow {
  outcome: string;
  phone_e164: string | null;
}

interface GatewayGrantRow {
  grant_hash: string;
}

function digest(purpose: string, value: string): string {
  const secret = process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("A token-signing secret is required for WhatsApp gateway-settings OTP.");
  return createHmac("sha256", secret)
    .update(`ochola-supernet:whatsapp-gateway-settings:${purpose}:v1:${value}`)
    .digest("hex");
}

function sessionBindingHash(sessionToken: string): string {
  return digest("session", sessionToken);
}

function challengeOtpHash(challengeId: string, code: string): string {
  return digest("otp", `${challengeId}:${code}`);
}

function grantHash(grant: string): string {
  return digest("grant", grant);
}

function requestIpHash(ip: string): string {
  return ip ? digest("request-ip", ip) : "";
}

export async function issueWhatsAppGatewaySettingsOtp(input: {
  accountId: number;
  phone: string;
  requestId: string;
  sessionToken: string;
  ip: string;
}): Promise<{ outcome: string; challengeId?: string }> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 ||
      !/^\+[1-9][0-9]{7,14}$/.test(input.phone) ||
      !UUID_PATTERN.test(input.requestId) ||
      !input.sessionToken) {
    return { outcome: "invalid" };
  }

  const challengeId = randomUUID();
  const code = generateWhatsAppOtp();
  const sessionHash = sessionBindingHash(input.sessionToken);
  const issued = await sbRpc<GatewayOtpChallengeRow>("issue_whatsapp_gateway_settings_otp", {
    p_id: challengeId,
    p_account_id: input.accountId,
    p_phone_e164: input.phone,
    p_auth_request_id: input.requestId,
    p_session_binding_hash: sessionHash,
    p_otp_hash: challengeOtpHash(challengeId, code),
    p_ip_hash: requestIpHash(input.ip),
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });
  if (issued[0]?.outcome !== "issued") {
    return { outcome: issued[0]?.outcome ?? "unavailable" };
  }

  await sendWhatsAppOtp(input.phone, code);
  return { outcome: "issued", challengeId };
}

export async function verifyWhatsAppGatewaySettingsOtp(input: {
  accountId: number;
  challengeId: string;
  code: string;
  requestId: string;
  sessionToken: string;
}): Promise<{ outcome: string; grant?: string }> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 ||
      !UUID_PATTERN.test(input.challengeId) ||
      !UUID_PATTERN.test(input.requestId) ||
      !/^\d{6}$/.test(input.code) ||
      !input.sessionToken) {
    return { outcome: "invalid" };
  }
  const bindingHash = sessionBindingHash(input.sessionToken);
  const verified = await sbRpc<GatewayOtpVerifyRow>("verify_whatsapp_gateway_settings_otp", {
    p_id: input.challengeId,
    p_account_id: input.accountId,
    p_auth_request_id: input.requestId,
    p_session_binding_hash: bindingHash,
    p_otp_hash: challengeOtpHash(input.challengeId, input.code),
    p_max_attempts: 5,
  });
  if (verified[0]?.outcome !== "verified") {
    return { outcome: verified[0]?.outcome ?? "invalid" };
  }

  const grant = randomBytes(32).toString("base64url");
  await sbInsertStrict("whatsapp_gateway_settings_grants", {
    grant_hash: grantHash(grant),
    account_id: input.accountId,
    auth_request_id: input.requestId,
    session_binding_hash: bindingHash,
    expires_at: new Date(Date.now() + GRANT_TTL_SECONDS * 1000).toISOString(),
    created_at: new Date().toISOString(),
  });
  return { outcome: "verified", grant };
}

export async function hasWhatsAppGatewaySettingsGrant(input: {
  accountId: number;
  requestId: string;
  grant: string;
  sessionToken: string;
}): Promise<boolean> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 ||
      !UUID_PATTERN.test(input.requestId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.grant) ||
      !input.sessionToken) {
    return false;
  }
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await sbSelectStrict<GatewayGrantRow>(
    "whatsapp_gateway_settings_grants",
    `grant_hash=eq.${grantHash(input.grant)}&account_id=eq.${input.accountId}` +
      `&auth_request_id=eq.${input.requestId}` +
      `&session_binding_hash=eq.${sessionBindingHash(input.sessionToken)}` +
      `&expires_at=gt.${now}&revoked_at=is.null&select=grant_hash&limit=1`,
  );
  return rows.length === 1;
}