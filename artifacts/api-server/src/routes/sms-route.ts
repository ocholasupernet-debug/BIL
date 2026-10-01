import { randomUUID, createHmac } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { sbRpc, sbSelect, sbUpdateStrict } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { checkRegistrationContactCapacity } from "../lib/registration-contact-capacity.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { generateAdminSessionToken, generateToken } from "../lib/api-auth.js";
import { getOtpPasswordSetupToken } from "../lib/admin-password-setup.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";
import {
  getTenantSubdomainFromRequest,
  RESERVED_SUBDOMAINS,
} from "../lib/tenant-host.js";
import { isOtpChannelEnabled } from "../lib/platform-auth-security.js";
import {
  createSmsActionToken,
  consumeSmsActionToken,
  generateSmsOtp,
  getSmsDashboardStats,
  getSmsSecretsStatus,
  getSmsSettings,
  hashSmsOtp,
  isSmsFeatureEnabled,
  normalizeSmsPhone,
  saveSmsSettings,
  sendSms,
  sendSmsOtp,
  checkSmsConnection,
  SmsProviderError,
} from "../services/sms/sms-service.js";
const router = Router();
type AccountType = "admin" | "customer";
type Purpose = "login" | "registration" | "recovery";
const actor = (req: Request, res: Response) => {
  const a = activeSuperAdminName(String(req.headers["x-sa-token"] || ""));
  if (!a)
    res
      .status(401)
      .json({ ok: false, error: "An active Super Admin session is required." });
  return a;
};
const secretHash = (v: string) =>
  (() => {
    const secret =
      process.env.TOKEN_SIGNING_SECRET?.trim() ||
      process.env.SESSION_SECRET?.trim() ||
      "";
    if (!secret) throw new Error("A server token-signing secret is required.");
    return createHmac("sha256", secret).update(v).digest("hex");
  })();
async function account(type: AccountType, phone: string, sub: string) {
  if (!sub) return null;
  const t = await sbSelect<{ id: number }>(
    "isp_admins",
    `subdomain=eq.${encodeURIComponent(sub)}&is_active=is.true&select=id&limit=1`,
  );
  const id = Number(t[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const table = type === "admin" ? "isp_admins" : "isp_customers";
  const scopedAdminIds = new Set([id]);
  if (type === "customer") {
    const children = await sbSelect<{ id: number }>(
      "isp_admins",
      `parent_id=eq.${encodeURIComponent(String(id))}&select=id&limit=500`,
    );
    for (const child of children) {
      const childId = Number(child.id);
      if (Number.isSafeInteger(childId) && childId > 0)
        scopedAdminIds.add(childId);
    }
  }
  const rows = await sbSelect<Record<string, unknown>>(
    table,
    `phone_e164=eq.${encodeURIComponent(phone)}&select=*&limit=100`,
  );
  const a = rows.filter((x) =>
    type === "admin"
      ? Number(x.id) === id || Number(x.parent_id) === id
      : scopedAdminIds.has(Number(x.admin_id)),
  );
  return a.length === 1 &&
    a[0].status !== "suspended" &&
    a[0].is_active !== false
    ? a[0]
    : null;
}
function pub(a: Record<string, unknown>) {
  const { password, otp, api_key, apiKey, _password, _otp, _apiKey, ...safe } =
    a;
  return safe;
}
router.get("/sms/public-config", async (_q, res) => {
  try {
    const [s, globallyEnabled] = await Promise.all([
      getSmsSettings(),
      isOtpChannelEnabled("sms"),
    ]);
    res.set("Cache-Control", "no-store").json({
      ok: true,
      loginEnabled: globallyEnabled && isSmsFeatureEnabled(s, "login"),
      registrationVerificationEnabled: globallyEnabled && isSmsFeatureEnabled(
        s,
        "registrationVerification",
      ),
      passwordRecoveryEnabled: false,
      otpChannelEnabled: globallyEnabled,
      defaultCountryCode: s.defaultCountryCode,
    });
  } catch {
    res.set("Cache-Control", "no-store").json({
      ok: false,
      loginEnabled: false,
      registrationVerificationEnabled: false,
      passwordRecoveryEnabled: false,
      otpChannelEnabled: false,
      defaultCountryCode: "254",
    });
  }
});
router.get("/super-admin/sms/settings", async (req, res) => {
  if (!actor(req, res)) return;
  try {
    const [settings, connection, stats, secrets] = await Promise.all([
      getSmsSettings(),
      checkSmsConnection(),
      getSmsDashboardStats(),
      getSmsSecretsStatus(),
    ]);
    res.set("Cache-Control", "no-store").json({
      ok: true,
      settings,
      secrets,
      connection,
      stats,
    });
  } catch {
    res.status(503).json({ ok: false, error: "SMS settings are unavailable." });
  }
});
router.put("/super-admin/sms/settings", async (req, res) => {
  const a = actor(req, res);
  if (!a) return;
  if (
    !req.body?.settings ||
    typeof req.body.settings !== "object" ||
    Array.isArray(req.body.settings)
  )
    return void res
      .status(400)
      .json({ ok: false, error: "Provide valid SMS settings." });
  try {
    const settings = await saveSmsSettings(
      req.body.settings,
      req.body.apiKey,
      req.body.clearApiKey === true,
    );
    res.json({ ok: true, settings, secrets: await getSmsSecretsStatus() });
  } catch {
    res
      .status(503)
      .json({ ok: false, error: "SMS settings could not be saved." });
  }
});
router.post("/super-admin/sms/test", async (req, res) => {
  if (!actor(req, res)) return;
  const s = await getSmsSettings();
  const p =
    typeof req.body?.phone === "string"
      ? normalizeSmsPhone(req.body.phone, s.defaultCountryCode)
      : null;
  if (!p)
    return void res
      .status(400)
      .json({ ok: false, error: "Enter a valid international phone number." });
  try {
    const sent = await sendSms(p, "This is a test SMS from OCHOLASUPERNET.");
    res.json({
      ok: true,
      message: "Test SMS accepted by Africa's Talking.",
      messageId: sent.messageId,
    });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error:
        e instanceof SmsProviderError
          ? e.message
          : "The SMS could not be sent.",
    });
  }
});
router.post("/auth/sms/request-otp", async (req, res) => {
  const purpose = req.body?.purpose as Purpose,
    type = req.body?.accountType as AccountType;
  if (!await isOtpChannelEnabled("sms"))
    return void res.status(503).json({ ok: false, error: "SMS OTP is disabled by the Super Admin." });
  if (
    !["login", "registration", "recovery"].includes(purpose) ||
    (purpose !== "registration" && !["admin", "customer"].includes(type))
  )
    return void res
      .status(400)
      .json({ ok: false, error: "Choose a supported SMS verification flow." });
  if (purpose === "recovery")
    return void res.status(403).json({ ok: false, error: "Only a Super Admin can reset an account password." });
  const s = await getSmsSettings();
  const feature = purpose === "login" ? "login" : "registrationVerification";
  if (!isSmsFeatureEnabled(s, feature))
    return void res
      .status(503)
      .json({ ok: false, error: "SMS verification is not enabled." });
  const phone =
    typeof req.body?.phone === "string"
      ? normalizeSmsPhone(req.body.phone, s.defaultCountryCode)
      : null;
  if (!phone)
    return void res
      .status(400)
      .json({ ok: false, error: "Enter a valid phone number." });
  const id = randomUUID();
  let a: Record<string, unknown> | null = null;
  let sendCode = false;
  if (purpose === "registration") {
    try {
      sendCode = await checkRegistrationContactCapacity(null, phone);
    } catch (error) {
      logger.warn({ err: error }, "[sms] registration contact capacity check failed");
    }
  } else {
    const requestedSubdomain =
      typeof req.body?.subdomain === "string"
        ? req.body.subdomain.trim().toLowerCase()
        : "";
    const sub =
      getTenantSubdomainFromRequest(req) ||
      (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(requestedSubdomain) &&
      !RESERVED_SUBDOMAINS.has(requestedSubdomain)
        ? requestedSubdomain
        : "");
    a = await account(type, phone, sub);
    sendCode = !!a;
  }
  const code = generateSmsOtp();
  const issued = await sbRpc<{ outcome: string }>("issue_sms_otp", {
    p_id: id,
    p_phone_e164: phone,
    p_purpose: purpose,
    p_account_type: a ? type : null,
    p_account_id: a ? Number(a.id) : null,
    p_otp_hash: hashSmsOtp(id, code),
    p_ip_hash: secretHash(
      `sms:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`,
    ),
    p_expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (issued[0]?.outcome === "issued" && sendCode)
    try {
      await sendSmsOtp(phone, code);
    } catch {}
  res.set("Cache-Control", "no-store").status(202).json({
    ok: true,
    challengeId: id,
    expiresInSeconds: 600,
    resendAfterSeconds: 60,
    message:
      "If this number is eligible, a verification code will be sent by SMS.",
  });
});
router.post("/auth/sms/verify-otp", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!await isOtpChannelEnabled("sms"))
    return void res.status(503).json({ ok: false, error: "SMS OTP is disabled by the Super Admin." });
  const id = String(req.body?.challengeId || ""),
    code = String(req.body?.code || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code))
    return void res.status(401).json({
      ok: false,
      error:
        "The code is invalid or has expired. Request a new code and try again.",
    });
  const r = await sbRpc<any>("verify_sms_otp", {
    p_id: id,
    p_otp_hash: hashSmsOtp(id, code),
    p_max_attempts: 5,
  });
  const c = r[0];
  if (!c || c.outcome !== "verified")
    return void res.status(401).json({
      ok: false,
      error:
        "The code is invalid or has expired. Request a new code and try again.",
    });
  if (c.purpose === "registration")
    return void res.set("Cache-Control", "no-store").json({
      ok: true,
      phoneVerificationToken: await createSmsActionToken(
        c.phone_e164,
        "registration",
        null,
        null,
      ),
    });
  if (c.purpose === "recovery")
    return void res.set("Cache-Control", "no-store").json({
      ok: true,
      resetToken: await createSmsActionToken(
        c.phone_e164,
        "recovery",
        c.account_type,
        c.account_id,
      ),
    });
  const table = c.account_type === "admin" ? "isp_admins" : "isp_customers";
  const rows = await sbSelect<Record<string, unknown>>(
    table,
    `id=eq.${c.account_id}&phone_e164=eq.${encodeURIComponent(c.phone_e164)}&select=*&limit=1`,
  );
  const found = rows[0];
  if (
    !found ||
    (c.account_type === "admin" && found.is_active !== true) ||
    (c.account_type === "customer" && found.status === "suspended")
  )
    return void res
      .status(401)
      .json({ ok: false, error: "The code is invalid or has expired." });
  await sbUpdateStrict(table, `id=eq.${c.account_id}`, {
    phone_verified: true,
    phone_verified_at: new Date().toISOString(),
  });
  const verified = { ...found, phone_verified: true };
  const setupToken = c.account_type === "admin"
    ? await getOtpPasswordSetupToken(found)
    : null;
  if (setupToken)
    return void res.set("Cache-Control", "no-store").json({
      ok: true,
      requiresPasswordSetup: true,
      setupToken,
      admin: pub(verified),
    });
  return void res.set("Cache-Control", "no-store").json({
    ok: true,
    token: c.account_type === "admin"
      ? generateAdminSessionToken(String(c.account_id), Number(found.auth_version ?? 1))
      : generateToken("c", String(c.account_id)),
    accountType: c.account_type,
    [c.account_type === "admin" ? "admin" : "customer"]: pub(verified),
  });
});
router.post("/auth/sms/reset-password", (_req, res) => {
  res.status(403).json({ ok: false, error: "Only a Super Admin can reset an account password." });
});
export default router;
