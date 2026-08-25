/**
 * Settings management routes
 *
 *   GET  /api/settings/mpesa   — return public M-Pesa payment availability
 *   POST /api/settings/mpesa   — blocked; credential settings are protected
 *   GET  /api/settings/mpesa/status — returns {configured: boolean}
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  deletePaymentDestination,
  getPaymentDestinations,
  getMpesaSettings,
  saveMpesaSettings,
  savePaymentDestinations,
  isMpesaConfigured,
  upsertPaymentDestination,
  type PaymentDestinationType,
  type MpesaSettings,
} from "../lib/settings-store.js";
import { sbSelect, sbUpdate } from "../lib/supabase-client.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";

const router: IRouter = Router();

function isSuperAdminRequest(req: Request): boolean {
  return isActiveSuperAdminToken(String(req.headers["x-sa-token"] ?? ""));
}

function configuredCallbackUrl(): string {
  return process.env.MPESA_CALLBACK_URL?.trim() ?? "";
}

function isValidLiveCallback(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      !!parsed.hostname &&
      parsed.pathname === "/api/mpesa/callback";
  } catch {
    return false;
  }
}

function requireProtectedDarajaChange(req: Request, res: Response): boolean {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return false;
  }
  const passcode = process.env.SUPERADMIN_PASSWORD?.trim();
  if (!passcode) {
    res.status(503).json({ ok: false, error: "M-Pesa settings are locked until SUPERADMIN_PASSWORD is configured securely." });
    return false;
  }
  if (req.body?.replacePassword !== passcode) {
    res.status(401).json({ ok: false, error: "Changing M-Pesa settings requires the replacement passcode." });
    return false;
  }
  return true;
}

const PAYMENT_GATEWAY_IDS = new Set([
  "mpesa_paybill",
  "mpesa_till_push",
  "bank_stk_push",
  "airtel",
  "azampay",
  "custom_paybill",
  "dpo_payments",
  "flutterwave",
  "intasend",
  "pesapal",
  "stripe",
  "paypal",
  "tigopesa",
  "xendit",
  "manual",
]);

function getPaymentGateway(value: unknown): string {
  return typeof value === "string" && PAYMENT_GATEWAY_IDS.has(value) ? value : "mpesa_paybill";
}

interface BankStkPushConfig {
  bankName: string;
  paybillNumber: string;
  accountNumber: string;
}

interface MpesaTillPushConfig {
  tillNumber: string;
}

interface MpesaPaybillConfig {
  paybillNumber: string;
  accountNumber: string;
}

type GatewayConfigMap = Record<string, Record<string, string>>;

function gatewayConfigMap(value: unknown): GatewayConfigMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, config]) => config && typeof config === "object" && !Array.isArray(config))
      .map(([gatewayId, config]) => [
        gatewayId,
        Object.fromEntries(
          Object.entries(config as Record<string, unknown>)
            .filter(([, field]) => typeof field === "string")
            .map(([field, value]) => [field, (value as string).trim()]),
        ),
      ]),
  );
}

function bankStkPushConfig(value: unknown): BankStkPushConfig {
  const config = gatewayConfigMap(value).bank_stk_push ?? {};
  return {
    bankName: config.bankName ?? "",
    paybillNumber: config.paybillNumber ?? "",
    accountNumber: config.accountNumber ?? "",
  };
}

function mpesaTillPushConfig(value: unknown): MpesaTillPushConfig {
  const config = gatewayConfigMap(value).mpesa_till_push ?? {};
  return { tillNumber: config.tillNumber ?? "" };
}

function mpesaPaybillConfig(value: unknown): MpesaPaybillConfig {
  const config = gatewayConfigMap(value).mpesa_paybill ?? {};
  return {
    paybillNumber: config.paybillNumber ?? "",
    accountNumber: config.accountNumber ?? "",
  };
}

function isBankStkPushConfigured(config: BankStkPushConfig): boolean {
  return !!(config.bankName && config.paybillNumber && config.accountNumber);
}

function adminIdFromRequest(req: Request): number | null {
  const raw = req.query.adminId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getAdminPaymentSettings(adminId: number | null): Promise<{
  paymentGateway: string;
  bankStkPush: BankStkPushConfig;
  mpesaTillPush: MpesaTillPushConfig;
  mpesaPaybill: MpesaPaybillConfig;
}> {
  if (!adminId) {
    return {
      paymentGateway: "mpesa_paybill",
      bankStkPush: { bankName: "", paybillNumber: "", accountNumber: "" },
      mpesaTillPush: { tillNumber: "" },
      mpesaPaybill: { paybillNumber: "", accountNumber: "" },
    };
  }
  const rows = await sbSelect<{ payment_gateway?: string; payment_gateway_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway,payment_gateway_config&limit=1`,
  );
  return {
    paymentGateway: getPaymentGateway(rows[0]?.payment_gateway),
    bankStkPush: bankStkPushConfig(rows[0]?.payment_gateway_config),
    mpesaTillPush: mpesaTillPushConfig(rows[0]?.payment_gateway_config),
    mpesaPaybill: mpesaPaybillConfig(rows[0]?.payment_gateway_config),
  };
}

/* ── GET /api/settings/mpesa ── */
router.get("/settings/mpesa", async (req: Request, res: Response): Promise<void> => {
  const s = await getMpesaSettings();
  const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(adminIdFromRequest(req));
  res.json({
    ok: true,
    configured: isMpesaConfigured(s),
    settings: {
      shortcode:      s.shortcode,
      env:            s.env,
      hasTillNumber:  !!s.tillNumber,
      paymentGateway,
      bankStkPushConfigured: isBankStkPushConfigured(bankStkPush),
      adminTillPushConfigured: !!mpesaTillPush.tillNumber,
      adminPaybillConfigured: !!(mpesaPaybill.paybillNumber && mpesaPaybill.accountNumber),
    },
  });
});

/* ── ISP Admin payment gateway preference ── */
router.post("/admin/payment-gateway", async (req: Request, res: Response): Promise<void> => {
  if (!requireProtectedDarajaChange(req, res)) return;
  const adminId = Number(req.body?.adminId);
  const paymentGateway = getPaymentGateway(req.body?.paymentGateway);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }

  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    { payment_gateway: paymentGateway },
  );
  if (updated.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found or the setting could not be saved." });
    return;
  }
  res.json({ ok: true, paymentGateway });
});

/* ── ISP Admin BankStkPush configuration ── */
router.get("/admin/bank-stk-push", async (req: Request, res: Response): Promise<void> => {
  const adminId = adminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  const { bankStkPush } = await getAdminPaymentSettings(adminId);
  res.json({ ok: true, config: bankStkPush, configured: isBankStkPushConfigured(bankStkPush) });
});

router.post("/admin/bank-stk-push", async (req: Request, res: Response): Promise<void> => {
  if (!requireProtectedDarajaChange(req, res)) return;
  const adminId = Number(req.body?.adminId);
  const config: BankStkPushConfig = {
    bankName: typeof req.body?.config?.bankName === "string" ? req.body.config.bankName.trim() : "",
    paybillNumber: typeof req.body?.config?.paybillNumber === "string" ? req.body.config.paybillNumber.trim() : "",
    accountNumber: typeof req.body?.config?.accountNumber === "string" ? req.body.config.accountNumber.trim() : "",
  };

  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!isBankStkPushConfigured(config)) {
    res.status(400).json({ ok: false, error: "Select a bank and enter its PayBill Number plus Account / Business Number." });
    return;
  }

  const admins = await sbSelect<{ payment_gateway_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway_config&limit=1`,
  );
  if (admins.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found." });
    return;
  }

  const existing = gatewayConfigMap(admins[0]?.payment_gateway_config);
  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    {
      payment_gateway_config: { ...existing, bank_stk_push: config },
      updated_at: new Date().toISOString(),
    },
  );
  if (updated.length === 0) {
    res.status(500).json({ ok: false, error: "Could not save BankStkPush settings." });
    return;
  }
  res.json({ ok: true, config, configured: true });
});

/* ── ISP Admin M-Pesa gateway destinations ── */
router.get("/admin/mpesa-gateway-config", async (req: Request, res: Response): Promise<void> => {
  const adminId = adminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  const { bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(adminId);
  res.json({
    ok: true,
    configs: {
      bank_stk_push: bankStkPush,
      mpesa_till_push: mpesaTillPush,
      mpesa_paybill: mpesaPaybill,
    },
  });
});

router.post("/admin/mpesa-gateway-config", async (req: Request, res: Response): Promise<void> => {
  if (!requireProtectedDarajaChange(req, res)) return;
  const adminId = Number(req.body?.adminId);
  const gatewayId = req.body?.gatewayId;
  const rawConfig = req.body?.config;
  const allowedGatewayIds = new Set(["bank_stk_push", "mpesa_till_push", "mpesa_paybill"]);

  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (typeof gatewayId !== "string" || !allowedGatewayIds.has(gatewayId)) {
    res.status(400).json({ ok: false, error: "Unsupported M-Pesa gateway configuration." });
    return;
  }

  const input = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
    ? rawConfig as Record<string, unknown>
    : {};
  const config: Record<string, string> = Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, (value as string).trim()]),
  );

  const isValid = gatewayId === "bank_stk_push"
    ? !!(config.bankName && config.paybillNumber && config.accountNumber)
    : gatewayId === "mpesa_till_push"
    ? !!config.tillNumber
    : !!(config.paybillNumber && config.accountNumber);
  if (!isValid) {
    res.status(400).json({
      ok: false,
      error: gatewayId === "mpesa_till_push"
        ? "Enter the ISP’s Till Number before saving."
        : "Enter the PayBill Number and Account / Business Number before saving.",
    });
    return;
  }

  const admins = await sbSelect<{ payment_gateway_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway_config&limit=1`,
  );
  if (admins.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found." });
    return;
  }

  const existing = gatewayConfigMap(admins[0]?.payment_gateway_config);
  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    {
      payment_gateway_config: { ...existing, [gatewayId]: config },
      updated_at: new Date().toISOString(),
    },
  );
  if (updated.length === 0) {
    res.status(500).json({ ok: false, error: "Could not save the M-Pesa gateway settings." });
    return;
  }
  res.json({ ok: true, gatewayId, config });
});

/* ── GET /api/settings/mpesa/status ── */
router.get("/settings/mpesa/status", async (_req: Request, res: Response): Promise<void> => {
  const settings = await getMpesaSettings();
  res.json({ ok: true, configured: isMpesaConfigured(settings), env: settings.env });
});

/* ── POST /api/settings/mpesa ── */
router.post("/settings/mpesa", (req: Request, res: Response): void => {
  res.status(403).json({
    ok: false,
    error: "M-Pesa credentials can only be changed from Super Admin → Payment Gateways.",
  });
});

/* ── Super Admin-only M-Pesa management ── */
router.get("/super-admin/mpesa", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  const s = await getMpesaSettings();
  res.json({
    ok: true,
    configured: isMpesaConfigured(s),
    settings: {
      consumerKey:    s.consumerKey    ? "**hidden**" : "",
      consumerSecret: s.consumerSecret ? "**hidden**" : "",
      shortcode:      s.shortcode,
      passkey:        s.passkey        ? "**hidden**" : "",
      callbackUrl:    s.callbackUrl || configuredCallbackUrl(),
      env:            s.env,
      tillNumber:     s.tillNumber,
      hasTillNumber:  !!s.tillNumber,
      hasConsumerKey:    !!s.consumerKey,
      hasConsumerSecret: !!s.consumerSecret,
      hasPasskey:        !!s.passkey,
    },
  });
});

router.post("/super-admin/mpesa", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  const { consumerKey, consumerSecret, shortcode, passkey, callbackUrl, env, tillNumber, replacePassword } =
    req.body as Partial<MpesaSettings> & { replacePassword?: string };

  /* Merge with existing — don't overwrite a secret if the UI sends "**hidden**" placeholder */
  const current = await getMpesaSettings();
  const requestedCallback = typeof callbackUrl === "string" ? callbackUrl.trim() : "";
  const hasNewCredential = [consumerKey, consumerSecret, passkey].some(value =>
    typeof value === "string" && value.trim().length > 0 && value !== "**hidden**"
  );
  const changingDarajaSettings =
    hasNewCredential ||
    shortcode !== undefined ||
    callbackUrl !== undefined ||
    env !== undefined ||
    tillNumber !== undefined;
  const replacementPasscode = process.env.SUPERADMIN_PASSWORD?.trim();

  if (!replacementPasscode) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa settings are locked until SUPERADMIN_PASSWORD is configured securely.",
    });
    return;
  }
  /* All Daraja edits are protected server-side. The passcode is never returned
     to the browser or included in logs. */
  if (changingDarajaSettings && replacePassword !== replacementPasscode) {
    res.status(401).json({
      ok: false,
      error: "Changing M-Pesa settings requires the replacement passcode.",
    });
    return;
  }

  if (requestedCallback && !isValidLiveCallback(requestedCallback)) {
    res.status(400).json({
      ok: false,
      error: "Live callback URL must use HTTPS and end with /api/mpesa/callback.",
    });
    return;
  }

  const next: MpesaSettings = {
    consumerKey:    (consumerKey    && consumerKey    !== "**hidden**") ? consumerKey    : current.consumerKey,
    consumerSecret: (consumerSecret && consumerSecret !== "**hidden**") ? consumerSecret : current.consumerSecret,
    shortcode:      shortcode      ?? current.shortcode,
    passkey:        (passkey        && passkey        !== "**hidden**") ? passkey        : current.passkey,
    callbackUrl:    requestedCallback || current.callbackUrl || configuredCallbackUrl(),
    env:            (env === "production" || env === "sandbox") ? env : current.env,
    tillNumber:     typeof tillNumber === "string" ? tillNumber.trim() : current.tillNumber,
  };
  if (next.env === "production" && !isValidLiveCallback(next.callbackUrl)) {
    res.status(400).json({
      ok: false,
      error: "Live M-Pesa requires a saved HTTPS callback URL ending in /api/mpesa/callback.",
    });
    return;
  }

  try {
    await saveMpesaSettings(next);
    res.json({ ok: true, configured: isMpesaConfigured(next) });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: "Secure M-Pesa storage is unavailable. Apply the Supabase secure settings migration, then try again.",
    });
  }
});

/* ── Super Admin collection destinations ── */
router.get("/super-admin/payment-destinations", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  res.json({ ok: true, ...getPaymentDestinations(), registrationFee: { amount: 500, currency: "KES" } });
});

router.post("/super-admin/payment-destinations", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  if (req.body?.action === "select") {
    const current = getPaymentDestinations();
    const registrationDestinationId = typeof req.body?.registrationDestinationId === "string"
      ? req.body.registrationDestinationId.trim()
      : "";
    const renewalDestinationId = typeof req.body?.renewalDestinationId === "string"
      ? req.body.renewalDestinationId.trim()
      : "";
    const activeIds = new Set(current.destinations.filter(row => row.active).map(row => row.id));
    if ((registrationDestinationId && !activeIds.has(registrationDestinationId)) ||
        (renewalDestinationId && !activeIds.has(renewalDestinationId))) {
      res.status(400).json({ ok: false, error: "Choose an active destination for each payment purpose." });
      return;
    }
    const next = { ...current, registrationDestinationId, renewalDestinationId };
    savePaymentDestinations(next);
    res.json({ ok: true, ...next, registrationFee: { amount: 500, currency: "KES" } });
    return;
  }

  if (req.body?.action !== "upsert") {
    res.status(400).json({ ok: false, error: "Unsupported destination action." });
    return;
  }

  const source = req.body?.destination ?? {};
  const type = source.type;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const number = typeof source.number === "string" ? source.number.trim() : "";
  const accountReference = typeof source.accountReference === "string" ? source.accountReference.trim() : "";
  const instructions = typeof source.instructions === "string" ? source.instructions.trim() : "";
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if ((type !== "bank" && type !== "till" && type !== "paybill") || !name || !number) {
    res.status(400).json({ ok: false, error: "Choose a type and enter a destination name plus receiving number." });
    return;
  }
  if (type === "paybill" && !accountReference) {
    res.status(400).json({ ok: false, error: "PayBill destinations require an Account / Business Number." });
    return;
  }

  const next = upsertPaymentDestination({
    id: id || undefined,
    type: type as PaymentDestinationType,
    name,
    number,
    accountReference,
    instructions,
    active: source.active !== false,
  });
  res.json({ ok: true, ...next, registrationFee: { amount: 500, currency: "KES" } });
});

router.delete("/super-admin/payment-destinations/:id", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ ok: false, error: "A destination is required." });
    return;
  }
  res.json({ ok: true, ...deletePaymentDestination(id), registrationFee: { amount: 500, currency: "KES" } });
});

export default router;
