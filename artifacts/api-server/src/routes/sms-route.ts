import { randomUUID, createHmac } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { sbRpc, sbSelect, sbUpdateStrict } from "../lib/supabase-client.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { generateToken } from "../lib/api-auth.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";
import {
  getTenantSubdomainFromRequest,
  RESERVED_SUBDOMAINS,
} from "../lib/tenant-host.js";
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
async function phoneAlreadyRegistered(phone: string) {
  const [admins, customers] = await Promise.all([
    sbSelect<{ id: number }>(
      "isp_admins",
      `phone_e164=eq.${encodeURIComponent(phone)}&select=id&limit=1`,
    ),
    sbSelect<{ id: number }>(
      "isp_customers",
      `phone_e164=eq.${encodeURIComponent(phone)}&select=id&limit=1`,
    ),
  ]);
  return admins.length > 0 || customers.length > 0;
}
function pub(a: Record<string, unknown>) {
  const { password, otp, api_key, apiKey, _password, _otp, _apiKey, ...safe } =
    a;
  return safe;
}
router.get("/sms/public-config", async (_q, res) => {
  try {
    const s = await getSmsSettings();
    res.set("Cache-Control", "no-store").json({
      ok: true,
      loginEnabled: isSmsFeatureEnabled(s, "login"),
      registrationVerificationEnabled: isSmsFeatureEnabled(
        s,
        "registrationVerification",
      ),
      passwordRecoveryEnabled: isSmsFeatureEnabled(s, "passwordRecovery"),
      defaultCountryCode: s.defaultCountryCode,
    });
  } catch {
    res.set("Cache-Control", "no-store").json({
      ok: false,
      loginEnabled: false,
      registrationVerificationEnabled: false,
      passwordRecoveryEnabled: false,
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
  if (
    !["login", "registration", "recovery"].includes(purpose) ||
    (purpose !== "registration" && !["admin", "customer"].includes(type))
  )
    return void res
      .status(400)
      .json({ ok: false, error: "Choose a supported SMS verification flow." });
  const s = await getSmsSettings();
  const feature =
    purpose === "login"
      ? "login"
      : purpose === "recovery"
        ? "passwordRecovery"
        : "registrationVerification";
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
    sendCode = !(await phoneAlreadyRegistered(phone));
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
  if (c.account_type === "admin" && found.must_change_password === true)
    return void res.set("Cache-Control", "no-store").json({
      ok: true,
      requiresPasswordSetup: true,
      setupToken: generateToken("p", String(c.account_id)),
      admin: pub(verified),
    });
  return void res.set("Cache-Control", "no-store").json({
    ok: true,
    token: generateToken(
      c.account_type === "admin" ? "a" : "c",
      String(c.account_id),
    ),
    accountType: c.account_type,
    [c.account_type === "admin" ? "admin" : "customer"]: pub(verified),
  });
});
router.post("/auth/sms/reset-password", async (req, res) => {
  const token = String(req.body?.resetToken || ""),
    password = String(req.body?.password || "");
  if (!token || password.length < 10 || password.length > 200)
    return void res.status(400).json({
      ok: false,
      error:
        "Use a valid reset session and a password with at least 10 characters.",
    });
  const c = await consumeSmsActionToken(token, "", "recovery");
  if (!c?.accountType || !c.accountId)
    return void res
      .status(401)
      .json({ ok: false, error: "The code is invalid or has expired." });
  const table = c.accountType === "admin" ? "isp_admins" : "isp_customers";
  await sbUpdateStrict(table, `id=eq.${c.accountId}`, {
    password: await hashIspAdminPassword(password),
    ...(c.accountType === "admin"
      ? { updated_at: new Date().toISOString() }
      : {}),
  });
  res.set("Cache-Control", "no-store").json({
    ok: true,
    message: "Password updated. Sign in with your new password.",
  });
});
export default router;
