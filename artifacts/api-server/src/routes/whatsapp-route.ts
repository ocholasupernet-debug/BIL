import { createHmac, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  generateToken,
} from "../lib/api-auth.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { logger } from "../lib/logger.js";
import {
  sbRpc,
  sbSelect,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { getTenantSubdomainFromRequest, RESERVED_SUBDOMAINS } from "../lib/tenant-host.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";
import {
  checkWhatsAppConnection,
  compareSecret,
  consumeWhatsAppActionToken,
  createWhatsAppActionToken,
  generateWhatsAppOtp,
  getWhatsAppDashboardStats,
  getWhatsAppSecretsStatus,
  getWhatsAppSettings,
  hashWhatsAppActionToken,
  hashWhatsAppOtp,
  isWhatsAppFeatureEnabled,
  normalizeWhatsAppPhone,
  noteWhatsAppDeliveryStatus,
  recordWhatsAppWebhookMessage,
  saveWhatsAppSettings,
  sendWhatsAppOtp,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type WhatsAppFeature,
  type WhatsAppSettings,
  WhatsAppProviderError,
} from "../services/whatsapp/whatsapp-service.js";

const router: IRouter = Router();
const OTP_TTL_SECONDS = Math.max(
  60,
  Math.min(900, Number.parseInt(process.env.WHATSAPP_OTP_TTL_SECONDS ?? "600", 10) || 600),
);
const MAX_OTP_ATTEMPTS = 5;

type AccountType = "admin" | "customer";
type OtpPurpose = "login" | "registration" | "recovery";

function superAdminActor(req: Request, res: Response): string | null {
  const token = String(req.headers["x-sa-token"] ?? "");
  const actor = activeSuperAdminName(token);
  if (!actor) {
    res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
    return null;
  }
  return actor;
}

function validAccountType(value: unknown): value is AccountType {
  return value === "admin" || value === "customer";
}

function secretHash(value: string): string {
  const key = process.env.TOKEN_SIGNING_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() || "";
  if (!key) throw new Error("A server token-signing secret is required.");
  return createHmac("sha256", key).update(value).digest("hex");
}

async function findAccountByPhone(
  accountType: AccountType,
  phone: string,
  tenantSubdomain: string,
): Promise<Record<string, unknown> | null> {
  if (!tenantSubdomain) return null;
  const tenantRows = await sbSelect<{ id: number }>(
    "isp_admins",
    `subdomain=eq.${encodeURIComponent(tenantSubdomain)}&is_active=is.true&select=id&limit=1`,
  );
  const tenantId = Number(tenantRows[0]?.id);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return null;

  const table = accountType === "admin" ? "isp_admins" : "isp_customers";
  const scopedAdminIds = new Set([tenantId]);
  if (accountType === "customer") {
    const childAdmins = await sbSelect<{ id: number }>(
      "isp_admins",
      `parent_id=eq.${encodeURIComponent(String(tenantId))}&select=id&limit=500`,
    );
    for (const child of childAdmins) {
      const id = Number(child.id);
      if (Number.isSafeInteger(id) && id > 0) scopedAdminIds.add(id);
    }
  }
  const matches = await sbSelect<Record<string, unknown>>(
    table,
    `phone_e164=eq.${encodeURIComponent(phone)}&select=*&limit=100`,
  );
  const scoped = matches.filter(row => accountType === "admin"
    ? Number(row.id) === tenantId || Number(row.parent_id) === tenantId
    : scopedAdminIds.has(Number(row.admin_id)));
  if (scoped.length !== 1) return null;
  const account = scoped[0];
  if (accountType === "admin" && account.is_active !== true) return null;
  if (accountType === "customer" && account.status === "suspended") return null;
  return account;
}

async function isPhoneAlreadyRegistered(phone: string): Promise<boolean> {
  const [admins, customers] = await Promise.all([
    sbSelect<{ id: number }>("isp_admins", `phone_e164=eq.${encodeURIComponent(phone)}&select=id&limit=1`),
    sbSelect<{ id: number }>("isp_customers", `phone_e164=eq.${encodeURIComponent(phone)}&select=id&limit=1`),
  ]);
  return admins.length > 0 || customers.length > 0;
}

function publicAccount(account: Record<string, unknown>): Record<string, unknown> {
  const {
    password: _password,
    otp: _otp,
    api_key: _apiKey,
    ...safe
  } = account;
  return safe;
}

function respondInvalidOtp(res: Response): void {
  res.status(401).json({ ok: false, error: "The code is invalid or has expired. Request a new code and try again." });
}

router.get("/super-admin/whatsapp/settings", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  try {
    const [settings, connection, stats] = await Promise.all([
      getWhatsAppSettings(),
      checkWhatsAppConnection(),
      getWhatsAppDashboardStats().catch(() => ({})),
    ]);
    res.set("Cache-Control", "no-store").json({
      ok: true,
      settings,
      secrets: getWhatsAppSecretsStatus(),
      connection,
      stats,
    });
  } catch {
    res.status(503).json({ ok: false, error: "WhatsApp settings are unavailable. Confirm the WhatsApp migration has been applied." });
  }
});

router.get("/whatsapp/public-config", async (_req, res): Promise<void> => {
  try {
    const settings = await getWhatsAppSettings();
    res.set("Cache-Control", "no-store").json({
      ok: true,
      loginEnabled: isWhatsAppFeatureEnabled(settings, "login"),
      registrationVerificationEnabled: isWhatsAppFeatureEnabled(settings, "registrationVerification"),
      passwordRecoveryEnabled: isWhatsAppFeatureEnabled(settings, "passwordRecovery"),
      defaultCountryCode: settings.defaultCountryCode,
    });
  } catch (error) {
    logger.warn({ err: error }, "[whatsapp] optional public configuration unavailable; WhatsApp auth is disabled");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      loginEnabled: false,
      registrationVerificationEnabled: false,
      passwordRecoveryEnabled: false,
      defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "254",
    });
  }
});

router.put("/super-admin/whatsapp/settings", async (req, res): Promise<void> => {
  const actor = superAdminActor(req, res);
  if (!actor) return;
  const settings = req.body?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    res.status(400).json({ ok: false, error: "Provide valid WhatsApp settings." });
    return;
  }
  try {
    const saved = await saveWhatsAppSettings(settings);
    logger.info({ actor }, "[whatsapp] platform settings updated");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      settings: saved,
      secrets: getWhatsAppSecretsStatus(),
    });
  } catch (error) {
    logger.error({ err: error, actor }, "[whatsapp] platform settings save failed");
    res.status(503).json({ ok: false, error: "WhatsApp settings could not be saved. Confirm the secure settings migration and service-role access." });
  }
});

router.post("/super-admin/whatsapp/test", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  const settings = await getWhatsAppSettings();
  const phone = typeof req.body?.phone === "string"
    ? normalizeWhatsAppPhone(req.body.phone, settings.defaultCountryCode)
    : null;
  if (!phone) {
    res.status(400).json({ ok: false, error: "Enter a valid international phone number." });
    return;
  }
  if (!settings.templates.test) {
    res.status(400).json({ ok: false, error: "Set an approved test message template before sending a test." });
    return;
  }
  try {
    const sent = await sendWhatsAppTemplate(phone, settings.templates.test, [], settings.language);
    res.json({ ok: true, message: "Test message accepted by WhatsApp.", messageId: sent.messageId });
  } catch (error) {
    const message = error instanceof WhatsAppProviderError
      ? error.message
      : "The WhatsApp test message could not be sent.";
    res.status(502).json({ ok: false, error: message });
  }
});

router.post("/auth/whatsapp/request-otp", async (req, res): Promise<void> => {
  const purpose = req.body?.purpose as OtpPurpose;
  const accountType = req.body?.accountType;
  if (!["login", "registration", "recovery"].includes(purpose)) {
    res.status(400).json({ ok: false, error: "Choose a supported WhatsApp verification flow." });
    return;
  }
  if (purpose !== "registration" && !validAccountType(accountType)) {
    res.status(400).json({ ok: false, error: "Choose an account type." });
    return;
  }

  const settings = await getWhatsAppSettings();
  const feature: WhatsAppFeature = purpose === "login"
    ? "login"
    : purpose === "recovery"
      ? "passwordRecovery"
      : "registrationVerification";
  if (!isWhatsAppFeatureEnabled(settings, feature)) {
    res.status(503).json({ ok: false, error: "WhatsApp verification is not enabled." });
    return;
  }

  const phone = typeof req.body?.phone === "string"
    ? normalizeWhatsAppPhone(req.body.phone, settings.defaultCountryCode)
    : null;
  if (!phone) {
    res.status(400).json({ ok: false, error: "Enter a valid phone number." });
    return;
  }

  const challengeId = randomUUID();
  let account: Record<string, unknown> | null = null;
  let sendCode = false;
  if (purpose === "registration") {
    sendCode = !await isPhoneAlreadyRegistered(phone);
  } else {
    const requestedSubdomain = typeof req.body?.subdomain === "string"
      ? req.body.subdomain.trim().toLowerCase()
      : "";
    const tenantSubdomain = getTenantSubdomainFromRequest(req) ||
      (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(requestedSubdomain) &&
        !RESERVED_SUBDOMAINS.has(requestedSubdomain)
        ? requestedSubdomain
        : "");
    account = await findAccountByPhone(accountType as AccountType, phone, tenantSubdomain);
    sendCode = !!account;
  }

  const code = generateWhatsAppOtp();
  const ipHash = secretHash(`whatsapp-otp-ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  const issued = await sbRpc<{ outcome: string }>("issue_whatsapp_otp", {
    p_id: challengeId,
    p_phone_e164: phone,
    p_purpose: purpose,
    p_account_type: purpose === "registration" || !account ? null : accountType,
    p_account_id: purpose === "registration" || !account ? null : Number(account.id),
    p_otp_hash: hashWhatsAppOtp(challengeId, code),
    p_ip_hash: ipHash,
    p_expires_at: expiresAt,
  });
  if (sendCode && issued[0]?.outcome === "issued") {
    try {
      await sendWhatsAppOtp(phone, code);
    } catch (error) {
      logger.warn(
        {
          purpose,
          errorCode: error instanceof WhatsAppProviderError ? error.code : null,
        },
        "[whatsapp] OTP delivery failed",
      );
      /* Do not reveal whether the phone is linked to an account. */
    }
  }

  res.set("Cache-Control", "no-store").status(202).json({
    ok: true,
    challengeId,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfterSeconds: 60,
    message: "If this number is eligible, a verification code will be sent to WhatsApp.",
  });
});

router.post("/auth/whatsapp/verify-otp", async (req, res): Promise<void> => {
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    respondInvalidOtp(res);
    return;
  }

  let verified: Array<{
    outcome: string;
    purpose: OtpPurpose | null;
    account_type: AccountType | null;
    account_id: number | null;
    phone_e164: string | null;
  }>;
  try {
    verified = await sbRpc("verify_whatsapp_otp", {
      p_id: challengeId,
      p_otp_hash: hashWhatsAppOtp(challengeId, code),
      p_max_attempts: MAX_OTP_ATTEMPTS,
    });
  } catch (error) {
    logger.warn({ err: error }, "[whatsapp] OTP verification persistence failed");
    res.status(503).json({ ok: false, error: "Verification is temporarily unavailable." });
    return;
  }
  const challenge = verified[0];
  if (!challenge || challenge.outcome !== "verified" || !challenge.phone_e164 || !challenge.purpose) {
    respondInvalidOtp(res);
    return;
  }

  if (challenge.purpose === "registration") {
    const phoneVerificationToken = await createWhatsAppActionToken(
      challenge.phone_e164,
      "registration",
      null,
      null,
    );
    res.set("Cache-Control", "no-store").json({ ok: true, phoneVerificationToken });
    return;
  }
  if (challenge.account_type !== "admin" && challenge.account_type !== "customer") {
    respondInvalidOtp(res);
    return;
  }
  const accountType = challenge.account_type;
  const accountId = Number(challenge.account_id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    respondInvalidOtp(res);
    return;
  }

  if (challenge.purpose === "recovery") {
    const resetToken = await createWhatsAppActionToken(
      challenge.phone_e164,
      "recovery",
      accountType,
      accountId,
    );
    res.set("Cache-Control", "no-store").json({ ok: true, resetToken });
    return;
  }

  const table = accountType === "admin" ? "isp_admins" : "isp_customers";
  const records = await sbSelect<Record<string, unknown>>(
    table,
    `id=eq.${encodeURIComponent(String(accountId))}&phone_e164=eq.${encodeURIComponent(challenge.phone_e164)}&select=*&limit=1`,
  );
  const account = records[0];
  if (!account || (accountType === "admin" && account.is_active !== true) ||
      (accountType === "customer" && account.status === "suspended")) {
    respondInvalidOtp(res);
    return;
  }

  await sbUpdateStrict(table, `id=eq.${encodeURIComponent(String(accountId))}`, {
    phone_verified: true,
    phone_verified_at: new Date().toISOString(),
  });
  const token = generateToken(accountType === "admin" ? "a" : "c", String(accountId));
  if (accountType === "admin" && account.must_change_password === true) {
    res.set("Cache-Control", "no-store").json({
      ok: true,
      requiresPasswordSetup: true,
      setupToken: generateToken("p", String(accountId)),
      admin: publicAccount({ ...account, phone_verified: true }),
    });
    return;
  }
  res.set("Cache-Control", "no-store").json({
    ok: true,
    token,
    ...(accountType === "admin"
      ? { admin: publicAccount({ ...account, phone_verified: true }) }
      : { customer: publicAccount({ ...account, phone_verified: true }) }),
    accountType,
  });
});

router.post("/auth/whatsapp/reset-password", async (req, res): Promise<void> => {
  const resetToken = typeof req.body?.resetToken === "string" ? req.body.resetToken.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!resetToken || resetToken.length > 100 || password.length < 10 || password.length > 200) {
    res.status(400).json({ ok: false, error: "Use a valid reset session and a password with at least 10 characters." });
    return;
  }

  let consumed: { accountType: AccountType | null; accountId: number | null } | null;
  try {
    const rows = await sbRpc<{
      consumed: boolean;
      account_type: AccountType | null;
      account_id: number | null;
    }>("consume_whatsapp_action_token", {
      p_token_hash: hashWhatsAppActionToken(resetToken),
      p_phone_e164: "",
      p_purpose: "recovery",
    });
    const row = rows[0];
    consumed = row?.consumed
      ? { accountType: row.account_type, accountId: row.account_id }
      : null;
  } catch {
    res.status(503).json({ ok: false, error: "Password recovery is temporarily unavailable." });
    return;
  }
  if (!consumed?.accountType || !consumed.accountId) {
    respondInvalidOtp(res);
    return;
  }

  const table = consumed.accountType === "admin" ? "isp_admins" : "isp_customers";
  try {
    const updated = await sbUpdateStrict(
      table,
      `id=eq.${encodeURIComponent(String(consumed.accountId))}`,
      {
        password: await hashIspAdminPassword(password),
        ...(consumed.accountType === "admin" ? { updated_at: new Date().toISOString() } : {}),
      },
    );
    if (!updated[0]) {
      res.status(409).json({ ok: false, error: "The account could not be updated. Request a new recovery code." });
      return;
    }
    res.set("Cache-Control", "no-store").json({
      ok: true,
      message: "Password updated. Sign in with your new password.",
    });
  } catch {
    res.status(503).json({ ok: false, error: "The password could not be updated. Request a new recovery code." });
  }
});

router.get("/whatsapp/webhook", (req, res): void => {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";
  const mode = req.query["hub.mode"];
  const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : "";
  const challenge = typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : "";
  if (
    verifyToken &&
    mode === "subscribe" &&
    challenge &&
    compareSecret(token, verifyToken)
  ) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.sendStatus(403);
});

async function handleInboundMessage(sender: string, text: string): Promise<void> {
  const settings = await getWhatsAppSettings();
  if (!isWhatsAppFeatureEnabled(settings, "selfService")) return;
  const phone = normalizeWhatsAppPhone(sender, settings.defaultCountryCode);
  if (!phone) return;
  const customers = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `phone_e164=eq.${encodeURIComponent(phone)}&status=neq.suspended&select=*&limit=2`,
  );
  if (customers.length !== 1) {
    await sendWhatsAppText(phone, "Welcome to OCHOLASUPERNET. We could not securely match this number to one active customer account. Please contact your ISP for help.");
    return;
  }

  const customer = customers[0];
  if (customer.phone_verified !== true) {
    await sbUpdateStrict(
      "isp_customers",
      `id=eq.${encodeURIComponent(String(customer.id))}`,
      { phone_verified: true, phone_verified_at: new Date().toISOString() },
    );
    customer.phone_verified = true;
  }
  const choice = text.trim().toLowerCase();
  if (/^(hi|hello|hey|menu|start|help)$/i.test(choice)) {
    await sendWhatsAppText(
      phone,
      "Welcome to OCHOLASUPERNET.\n\nReply with a number:\n1. Check account\n2. Check package\n3. Check balance\n4. Renew package\n5. Make payment\n6. Check expiry\n7. Get support",
    );
    return;
  }
  if (choice === "1") {
    await sendWhatsAppText(phone, `Your account status is ${String(customer.status ?? "available")}.`);
    return;
  }
  if (choice === "2") {
    const plans = customer.plan_id
      ? await sbSelect<Record<string, unknown>>(
          "isp_plans",
          `id=eq.${encodeURIComponent(String(customer.plan_id))}&select=*&limit=1`,
        )
      : [];
    const plan = plans[0];
    const planName = plan ? String(plan.name ?? plan.plan_name ?? plan.title ?? "your current package") : "no active package";
    await sendWhatsAppText(phone, `Your current package is ${planName}.`);
    return;
  }
  if (choice === "3") {
    const balance = customer.balance ?? customer.account_balance ?? customer.wallet_balance;
    await sendWhatsAppText(
      phone,
      typeof balance === "number" || typeof balance === "string"
        ? `Your current balance is KSh ${String(balance)}.`
        : "Balance details are not available through this channel. Reply 7 for support.",
    );
    return;
  }
  if (choice === "6") {
    const expiry = typeof customer.expires_at === "string"
      ? new Date(customer.expires_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
      : "not currently recorded";
    await sendWhatsAppText(phone, `Your package expiry is ${expiry}.`);
    return;
  }
  if (choice === "4" || choice === "5") {
    await sendWhatsAppText(phone, "To renew or pay, use your ISP's existing customer portal or contact your ISP. We do not collect payment details in WhatsApp.");
    return;
  }
  if (choice === "7") {
    await sendWhatsAppText(phone, "Please contact your ISP's support team for assistance.");
    return;
  }
  await sendWhatsAppText(phone, "I did not recognize that option. Reply Hi to see the OCHOLASUPERNET menu.");
}

router.post("/whatsapp/webhook", async (req, res): Promise<void> => {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() ?? "";
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = typeof req.headers["x-hub-signature-256"] === "string"
    ? req.headers["x-hub-signature-256"]
    : "";
  if (!appSecret || !signature || !body.length) {
    res.sendStatus(403);
    return;
  }
  const expected = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
  if (!compareSecret(signature, expected)) {
    res.sendStatus(403);
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    res.sendStatus(400);
    return;
  }

  try {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const changes = Array.isArray((entry as Record<string, unknown>).changes)
        ? (entry as Record<string, unknown>).changes as unknown[]
        : [];
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const value = (change as Record<string, unknown>).value;
        if (!value || typeof value !== "object") continue;
        const valueRecord = value as Record<string, unknown>;
        const statuses = Array.isArray(valueRecord.statuses) ? valueRecord.statuses : [];
        for (const status of statuses) {
          if (!status || typeof status !== "object") continue;
          const row = status as Record<string, unknown>;
          if (typeof row.id === "string" && typeof row.status === "string") {
            await recordWhatsAppWebhookMessage(
              `status:${row.id}:${row.status}`,
              "",
              `delivery_${row.status}`,
            );
            await noteWhatsAppDeliveryStatus(row.id, row.status);
          }
        }

        const messages = Array.isArray(valueRecord.messages) ? valueRecord.messages : [];
        for (const message of messages) {
          if (!message || typeof message !== "object") continue;
          const row = message as Record<string, unknown>;
          if (typeof row.id !== "string" || typeof row.from !== "string") continue;
          const sender = `+${row.from.replace(/\D/g, "")}`;
          const inserted = await recordWhatsAppWebhookMessage(row.id, sender, "incoming_message");
          if (!inserted) continue;
          const textObject = row.text && typeof row.text === "object"
            ? row.text as Record<string, unknown>
            : {};
          if (typeof textObject.body === "string") {
            await handleInboundMessage(sender, textObject.body);
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    logger.warn({ err: error }, "[whatsapp] signed webhook processing failed");
    res.sendStatus(500);
  }
});

export default router;