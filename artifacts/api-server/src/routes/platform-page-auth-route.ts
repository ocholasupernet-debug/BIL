import { randomInt, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  extractToken,
  generateAdminSessionToken,
  generatePageAuthProof,
  hashPageOtpCode,
  hashPageOtpSession,
  validatePasswordReauthProof,
  validateToken,
  type ApiTokenPayload,
} from "../lib/api-auth.js";
import {
  getPageAuthMethod,
  isOtpChannelEnabled,
  isSupportedPasswordReauthFeature,
  recordPlatformAuthAudit,
  type AdminPolicyRole,
  type PageAuthMethod,
} from "../lib/platform-auth-security.js";
import {
  consumePlatformPageOtpChallenge,
  invalidatePlatformPageOtpChallenge,
  issuePlatformPageOtpChallenge,
} from "../lib/platform-auth-store.js";
import { sbSelectStrict } from "../lib/supabase-client.js";
import {
  getSmsSecretsStatus,
  getSmsSettings,
  isSmsEnabled,
  normalizeSmsPhone,
  sendSmsOtp,
} from "../services/sms/sms-service.js";
import {
  getWhatsAppSecretsStatus,
  getWhatsAppSettings,
  isWhatsAppEnabled,
  normalizeWhatsAppPhone,
} from "../services/whatsapp/whatsapp-service.js";
import {
  getWhatsAppOtpProvider,
  isWhatsAppOtpDeliveryReady,
  isWhatsAppOtpFeatureEnabled,
  sendConfiguredWhatsAppOtp,
} from "../services/whatsapp/whatsapp-otp-delivery.js";
import {
  getTenantEmailBranding,
  getPlatformEmailStatus,
  isValidEmailAddress,
  sendPlatformEmail,
} from "../lib/platform-email.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const OTP_METHODS = new Set<PageAuthMethod>(["whatsapp", "sms", "email"]);

class PageOtpReadinessError extends Error {
  constructor(readonly reason: "channel_disabled" | "email_missing" | "email_sender_unconfigured") {
    super(reason);
  }
}

interface PageAuthAdmin {
  id: number;
  name: string | null;
  username: string | null;
  email: string | null;
  phone_e164: string | null;
  role: string | null;
  is_active: boolean;
  auth_version: number | null;
}

interface PageAuthContext {
  token: string;
  payload: ApiTokenPayload;
  admin: PageAuthAdmin;
  role: AdminPolicyRole;
  feature: string;
  method: Exclude<PageAuthMethod, "none" | "password">;
}

async function resolveContext(
  req: Request,
  res: Response,
  requestedMethod: unknown,
): Promise<PageAuthContext | null> {
  const token = extractToken(req);
  const payload = validateToken(token);
  const feature = typeof req.body?.feature === "string" ? req.body.feature : "";
  const method = typeof requestedMethod === "string" ? requestedMethod : "";
  if (
    !payload || payload.type !== "a" || payload.uid === "superadmin" ||
    payload.impersonationSessionId ||
    !Number.isSafeInteger(Number(payload.uid)) ||
    !isSupportedPasswordReauthFeature(feature) ||
    !OTP_METHODS.has(method as PageAuthMethod)
  ) {
    res.status(401).json({ ok: false, error: "A valid administrator session and verification method are required." });
    return null;
  }

  try {
    const rows = await sbSelectStrict<PageAuthAdmin>(
      "isp_admins",
      `id=eq.${encodeURIComponent(payload.uid)}&is_active=is.true&select=id,name,username,email,phone_e164,role,is_active,auth_version&limit=1`,
    );
    const admin = rows[0];
    if (
      !admin ||
      (admin.role !== "isp_admin" && admin.role !== "reseller") ||
      Number(payload.authVersion ?? 1) !== Number(admin.auth_version ?? 1)
    ) {
      res.status(401).json({ ok: false, error: "This administrator session is no longer active." });
      return null;
    }
    const role = admin.role as AdminPolicyRole;
    if (await getPageAuthMethod(role, feature) !== method) {
      res.status(409).json({ ok: false, error: "The page verification policy changed. Reload the page and try again." });
      return null;
    }
    return { token, payload, admin, role, feature, method: method as PageAuthContext["method"] };
  } catch {
    res.status(503).json({ ok: false, error: "The page verification policy could not be checked." });
    return null;
  }
}

function maskPhone(value: string): string {
  return `••••${value.replace(/\D/g, "").slice(-3)}`;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!domain) return "your saved email";
  return `${local.slice(0, 1)}•••@${domain}`;
}

async function sendPageOtp(
  context: PageAuthContext,
  code: string,
): Promise<string> {
  if (!await isOtpChannelEnabled(context.method)) {
    throw new Error("The selected verification channel is disabled.");
  }

  if (context.method === "email") {
    const email = String(context.admin.email ?? "").trim();
    if (
      !getPlatformEmailStatus().configured ||
      !isValidEmailAddress(email)
    ) throw new Error("Gmail email delivery is not configured on the server.");
    await sendPlatformEmail({
      fromName: "OcholaSupernet Billing Security",
      to: email,
      subject: "Your OcholaSupernet Billing verification code",
      text: `Your six-digit OcholaSupernet Billing verification code is ${code}. It expires in five minutes and can be used once. If you did not request this code, ignore this email.`,
      branding: await getTenantEmailBranding(context.admin.id),
    });
    return maskEmail(email);
  }

  const storedPhone = String(context.admin.phone_e164 ?? "").trim();
  if (context.method === "sms") {
    const phone = normalizeSmsPhone(storedPhone);
    const [settings, secrets] = await Promise.all([getSmsSettings(), getSmsSecretsStatus()]);
    if (!phone || !isSmsEnabled(settings) || !settings.username || !secrets.apiKeyConfigured) {
      throw new Error("SMS delivery is not available.");
    }
    await sendSmsOtp(phone, code);
    return maskPhone(phone);
  }

  const phone = normalizeWhatsAppPhone(storedPhone);
  const provider = await getWhatsAppOtpProvider();
  if (
    !phone ||
    !await isWhatsAppOtpFeatureEnabled("pageVerification") ||
    !await isWhatsAppOtpDeliveryReady("pageVerification", provider)
  ) throw new Error("WhatsApp delivery is not available.");
  if (provider === "whatsapp_cloud") {
    const [settings, secrets] = await Promise.all([getWhatsAppSettings(), getWhatsAppSecretsStatus()]);
    if (
      !isWhatsAppEnabled(settings) ||
      !secrets.accessTokenConfigured ||
      !settings.phoneNumberId ||
      !settings.templates.authentication
    ) throw new Error("WhatsApp delivery is not available.");
  }
  await sendConfiguredWhatsAppOtp(phone, code, "pageVerification", provider);
  return maskPhone(phone);
}

async function assertPageOtpReady(context: PageAuthContext): Promise<void> {
  if (!await isOtpChannelEnabled(context.method)) {
    throw new PageOtpReadinessError("channel_disabled");
  }
  if (context.method !== "email") return;

  const email = String(context.admin.email ?? "").trim();
  if (!isValidEmailAddress(email)) {
    throw new PageOtpReadinessError("email_missing");
  }
  if (!getPlatformEmailStatus().configured) {
    throw new PageOtpReadinessError("email_sender_unconfigured");
  }
}

router.post("/auth/admin/page-otp/request", async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const context = await resolveContext(req, res, req.body?.method);
  if (!context) return;

  const challengeId = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const sessionHash = hashPageOtpSession(context.token);
  const codeHash = hashPageOtpCode({
    challengeId,
    code,
    token: context.token,
    uid: context.payload.uid,
    role: context.role,
    feature: context.feature,
    method: context.method,
  });
  const rawIp = req.ip ?? req.socket.remoteAddress ?? null;
  const requestIp = rawIp && !rawIp.includes("%") ? rawIp : null;
  let phase: "readiness" | "challenge" | "delivery" = "readiness";
  let challengeCreated = false;

  try {
    await assertPageOtpReady(context);
    phase = "challenge";
    const issued = await issuePlatformPageOtpChallenge({
      id: challengeId,
      adminId: Number(context.payload.uid),
      role: context.role,
      feature: context.feature,
      method: context.method,
      sessionHash,
      codeHash,
      requestIp,
    });
    if (issued === "cooldown") {
      res.status(429).json({ ok: false, error: "Wait before requesting another verification code." });
      return;
    }
    if (issued !== "issued") {
      res.status(429).json({ ok: false, error: "Too many verification code requests. Try again later." });
      return;
    }
    challengeCreated = true;
    phase = "delivery";
    const destination = await sendPageOtp(context, code);
    res.status(202).json({
      ok: true,
      challengeId,
      destination,
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
  } catch (error) {
    if (challengeCreated) {
      try {
        await invalidatePlatformPageOtpChallenge({
          id: challengeId,
          adminId: Number(context.payload.uid),
          sessionHash,
        });
      } catch {}
    }
    const readinessReason = error instanceof PageOtpReadinessError ? error.reason : null;
    const errorMessage = readinessReason === "channel_disabled"
      ? "Email verification is disabled in the security settings."
      : readinessReason === "email_missing"
        ? "No valid email is saved on this administrator account. Update the account email and try again."
        : readinessReason === "email_sender_unconfigured"
          ? "The website email sender is not configured. Contact the Super Admin."
          : phase === "challenge"
            ? "The verification request could not be created. Try again later."
            : "The verification email could not be delivered. Confirm the saved account email and retry.";
    logger.warn(
      {
        method: context.method,
        phase,
        reason: readinessReason ?? undefined,
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "[page-auth] verification code delivery or challenge creation failed",
    );
    res.status(readinessReason ? 409 : 503).json({ ok: false, error: errorMessage });
  }
});

router.post("/auth/admin/page-otp/verify", async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const context = await resolveContext(req, res, req.body?.method);
  if (!context) return;

  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    res.status(401).json({ ok: false, error: "The code is invalid or expired. Request a new code and try again." });
    return;
  }

  try {
    if (!await isOtpChannelEnabled(context.method)) {
      res.status(503).json({ ok: false, error: "The selected verification channel is disabled." });
      return;
    }
    const sessionHash = hashPageOtpSession(context.token);
    const codeHash = hashPageOtpCode({
      challengeId,
      code,
      token: context.token,
      uid: context.payload.uid,
      role: context.role,
      feature: context.feature,
      method: context.method,
    });
    const result = await consumePlatformPageOtpChallenge({
      id: challengeId,
      adminId: Number(context.payload.uid),
      role: context.role,
      feature: context.feature,
      method: context.method,
      sessionHash,
      codeHash,
    });
    if (result !== "verified") {
      res.status(401).json({ ok: false, error: "The code is invalid or expired. Request a new code and try again." });
      return;
    }

    const proof = generatePageAuthProof(
      context.payload.uid,
      context.role,
      context.feature,
      context.method,
    );
    const grant = validatePasswordReauthProof(proof.proof);
    if (!grant) throw new Error("The page verification grant could not be validated.");
    const grants = [
      ...(context.payload.reauthGrants ?? []).filter(existing =>
        existing.uid === context.payload.uid &&
        existing.expiresAt > Date.now() &&
        existing.feature !== context.feature &&
        (existing.method !== "password" || existing.credentialVersion === 1),
      ),
      grant,
    ];
    const token = generateAdminSessionToken(
      context.payload.uid,
      Number(context.admin.auth_version ?? 1),
      { reauthGrants: grants },
    );
    try {
      await recordPlatformAuthAudit({
        actorName: String(context.admin.username ?? context.admin.name ?? context.payload.uid),
        action: "page_otp_verification_succeeded",
        targetAdminId: Number(context.payload.uid),
        details: { feature: context.feature, method: context.method },
        sourceIp: req.ip ?? req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
      });
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "[page-auth] verification audit could not be recorded",
      );
    }
    res.json({ ok: true, token, expiresAt: proof.expiresAt });
  } catch {
    res.status(503).json({ ok: false, error: "Page verification could not be completed." });
  }
});

export default router;