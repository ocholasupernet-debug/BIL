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
  normaliseRegistrationFee,
  upsertPaymentDestination,
  type PaymentDestinationType,
  type MpesaSettings,
} from "../lib/settings-store.js";
import { sbRpc, sbSelect, sbUpdate } from "../lib/supabase-client.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import { extractToken, validateToken } from "../lib/api-auth.js";
import {
  gatewayConfigMap as routingGatewayConfigMap,
  paymentCollectionMode,
  paymentGateway as routingPaymentGateway,
  publicServiceStatus,
  servicePaymentConfigMap,
  isGatewayConfigComplete,
  collectionConfig,
  type PaymentService,
  type ServicePaymentConfig,
} from "../lib/payment-routing.js";

const router: IRouter = Router();
const MPESA_CALLBACK_PATH = "/api/mpesa/callback";

function isSuperAdminRequest(req: Request): boolean {
  return isActiveSuperAdminToken(String(req.headers["x-sa-token"] ?? ""));
}

function configuredCallbackUrl(): string {
  return process.env.MPESA_CALLBACK_URL?.trim() ?? "";
}

function automaticCallbackUrl(req: Request): string {
  const configured = configuredCallbackUrl();
  if (isValidLiveCallback(configured)) return configured;

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host")?.trim();
  if (!host) return "";

  try {
    const parsed = new URL(`https://${host}`);
    if (!parsed.hostname) return "";
    return `https://${parsed.host}${MPESA_CALLBACK_PATH}`;
  } catch {
    return "";
  }
}

function isValidLiveCallback(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      !!parsed.hostname &&
      parsed.pathname === MPESA_CALLBACK_PATH;
  } catch {
    return false;
  }
}

function requireAdminPaymentChange(req: Request, res: Response, adminId: number): boolean {
  const auth = validateToken(extractToken(req));
  if (!auth || auth.type !== "a") {
    res.status(401).json({ ok: false, error: "Your ISP Admin session is missing or expired. Sign in again; Super Admin approval is not required." });
    return false;
  }
  if (auth.uid !== "superadmin" && Number(auth.uid) !== adminId) {
    res.status(403).json({ ok: false, error: "You can only change payment routing for your own ISP." });
    return false;
  }
  return true;
}

function requireSuperAdminReplacementPasscode(req: Request, res: Response): boolean {
  const replacementPasscode = process.env.SUPERADMIN_PASSWORD?.trim();
  if (!replacementPasscode) {
    res.status(503).json({
      ok: false,
      error: "Payment settings are locked until SUPERADMIN_PASSWORD is configured securely.",
    });
    return false;
  }
  if (req.body?.replacePassword !== replacementPasscode) {
    res.status(401).json({
      ok: false,
      error: "Changing registration payment settings requires the replacement passcode.",
    });
    return false;
  }
  return true;
}

function isValidCollectionNumber(type: PaymentDestinationType, value: string): boolean {
  if (type === "bank") return /^[A-Za-z0-9][A-Za-z0-9 -]{2,33}$/.test(value);
  return /^\d{5,10}$/.test(value);
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
  paymentCollectionMode: "shared" | "separate";
  serviceConfigs: Partial<Record<PaymentService, ServicePaymentConfig>>;
}> {
  if (!adminId) {
    return {
      paymentGateway: "mpesa_paybill",
      bankStkPush: { bankName: "", paybillNumber: "", accountNumber: "" },
      mpesaTillPush: { tillNumber: "" },
      mpesaPaybill: { paybillNumber: "", accountNumber: "" },
      paymentCollectionMode: "shared",
      serviceConfigs: {},
    };
  }
  const rows = await sbSelect<{
    payment_gateway?: string;
    payment_gateway_config?: unknown;
    payment_collection_mode?: string;
    payment_service_config?: unknown;
  }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway,payment_gateway_config,payment_collection_mode,payment_service_config&limit=1`,
  );
  const mode = paymentCollectionMode(rows[0]?.payment_collection_mode);
  const serviceConfigs = servicePaymentConfigMap(rows[0]?.payment_service_config);
  const sharedGatewayId = getPaymentGateway(rows[0]?.payment_gateway);
  const sharedConfigs = gatewayConfigMap(rows[0]?.payment_gateway_config);
  const selected = mode === "separate" ? undefined : sharedConfigs;
  return {
    paymentGateway: mode === "separate"
      ? (serviceConfigs.hotspot?.gatewayId ?? "unconfigured")
      : sharedGatewayId,
    bankStkPush: selected ? bankStkPushConfig(selected) : serviceConfigs.hotspot?.gatewayId === "bank_stk_push"
      ? { bankName: serviceConfigs.hotspot.config.bankName ?? "", paybillNumber: serviceConfigs.hotspot.config.paybillNumber ?? "", accountNumber: serviceConfigs.hotspot.config.accountNumber ?? "" }
      : { bankName: "", paybillNumber: "", accountNumber: "" },
    mpesaTillPush: selected ? mpesaTillPushConfig(selected) : { tillNumber: serviceConfigs.hotspot?.config.tillNumber ?? "" },
    mpesaPaybill: selected ? mpesaPaybillConfig(selected) : { paybillNumber: serviceConfigs.hotspot?.config.paybillNumber ?? "", accountNumber: serviceConfigs.hotspot?.config.accountNumber ?? "" },
    paymentCollectionMode: mode,
    serviceConfigs,
  };
}

/* ── GET /api/settings/mpesa ── */
router.get("/settings/mpesa", async (req: Request, res: Response): Promise<void> => {
  const s = await getMpesaSettings();
  const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill, paymentCollectionMode: collectionMode } =
    await getAdminPaymentSettings(adminIdFromRequest(req));
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
      paymentCollectionMode: collectionMode,
    },
  });
});

/* ── ISP Admin payment gateway preference ── */
router.post("/admin/payment-gateway", async (req: Request, res: Response): Promise<void> => {
  const adminId = Number(req.body?.adminId);
  const paymentGateway = getPaymentGateway(req.body?.paymentGateway);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!requireAdminPaymentChange(req, res, adminId)) return;

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

/* ── ISP Admin shared/separate service collection routing ── */
router.get("/admin/payment-routing", async (req: Request, res: Response): Promise<void> => {
  const adminId = adminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!requireAdminPaymentChange(req, res, adminId)) return;
  const settings = await getAdminPaymentSettings(adminId);
  const sharedConfig = settings.paymentGateway === "mpesa_till_push"
    ? settings.mpesaTillPush
    : settings.paymentGateway === "bank_stk_push"
    ? settings.bankStkPush
    : settings.mpesaPaybill;
  const status = publicServiceStatus(
    settings.paymentCollectionMode,
    settings.paymentGateway,
    { ...sharedConfig },
    settings.serviceConfigs,
  );
  res.json({
    ok: true,
    mode: settings.paymentCollectionMode,
    services: {
      hotspot: { gatewayId: status.hotspot.gatewayId, configured: status.hotspot.configured, config: status.hotspot.config },
      pppoe: { gatewayId: status.pppoe.gatewayId, configured: status.pppoe.configured, config: status.pppoe.config },
    },
  });
});

router.post("/admin/payment-routing", async (req: Request, res: Response): Promise<void> => {
  const adminId = Number(req.body?.adminId);
  const mode = paymentCollectionMode(req.body?.mode);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!requireAdminPaymentChange(req, res, adminId)) return;
  if (req.body?.mode !== "shared" && req.body?.mode !== "separate") {
    res.status(400).json({ ok: false, error: "Choose shared or separate payment collection." });
    return;
  }

  const rawServices = req.body?.services;
  const serviceConfigs: Partial<Record<PaymentService, ServicePaymentConfig>> = {};
  if (mode === "separate") {
    for (const service of ["hotspot", "pppoe"] as PaymentService[]) {
      const raw = rawServices?.[service];
      const gatewayId = routingPaymentGateway(raw?.gatewayId);
      if (!raw || raw.gatewayId !== gatewayId || !["mpesa_paybill", "mpesa_till_push", "bank_stk_push"].includes(gatewayId)) {
        res.status(400).json({ ok: false, error: `Choose a supported M-Pesa collection account for ${service.toUpperCase()}.` });
        return;
      }
      const config = collectionConfig(gatewayId, raw.config);
      if (!isGatewayConfigComplete(gatewayId, config)) {
        res.status(400).json({ ok: false, error: `Complete the ${gatewayId.replaceAll("_", " ")} destination for ${service.toUpperCase()}.` });
        return;
      }
      serviceConfigs[service] = { gatewayId, config };
    }
  }

  const current = await sbSelect<{ payment_service_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_service_config&limit=1`,
  );
  const preservedConfigs = servicePaymentConfigMap(current[0]?.payment_service_config);
  const updated = await sbUpdate("isp_admins", `id=eq.${adminId}`, {
    payment_collection_mode: mode,
    payment_service_config: mode === "separate" ? serviceConfigs : preservedConfigs,
  });
  if (updated.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found or the payment routing could not be saved." });
    return;
  }
  res.json({
    ok: true,
    mode,
    services: Object.fromEntries(
      (["hotspot", "pppoe"] as PaymentService[]).map(service => {
        const selected = mode === "separate" ? serviceConfigs[service] : null;
        return [service, {
          gatewayId: selected?.gatewayId ?? getPaymentGateway(req.body?.sharedGatewayId),
          configured: selected ? isGatewayConfigComplete(selected.gatewayId, selected.config) : true,
        }];
      }),
    ),
  });
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
  if (!requireAdminPaymentChange(req, res, adminId)) return;
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
  const adminId = Number(req.body?.adminId);
  const gatewayId = req.body?.gatewayId;
  const rawConfig = req.body?.config;
  const allowedGatewayIds = new Set(["bank_stk_push", "mpesa_till_push", "mpesa_paybill"]);

  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!requireAdminPaymentChange(req, res, adminId)) return;
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
      callbackUrl:    automaticCallbackUrl(req) || s.callbackUrl,
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

  const next: MpesaSettings = {
    consumerKey:    (consumerKey    && consumerKey    !== "**hidden**") ? consumerKey    : current.consumerKey,
    consumerSecret: (consumerSecret && consumerSecret !== "**hidden**") ? consumerSecret : current.consumerSecret,
    shortcode:      shortcode      ?? current.shortcode,
    passkey:        (passkey        && passkey        !== "**hidden**") ? passkey        : current.passkey,
    callbackUrl:    automaticCallbackUrl(req) || current.callbackUrl,
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
    const reason = err instanceof Error ? err.message : "The secure settings write could not be completed.";
    console.error("[settings/mpesa] secure settings save failed", { reason });
    res.status(503).json({
      ok: false,
      error: reason,
    });
  }
});

/* ── Super Admin collection destinations ── */
router.get("/super-admin/payment-destinations", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  const settings = getPaymentDestinations();
  res.json({ ok: true, ...settings, registrationFee: { amount: settings.registrationFee, currency: "KES" } });
});

router.post("/super-admin/payment-destinations", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;

  if (req.body?.action === "select") {
    const current = getPaymentDestinations();
    const registrationDestinationId = typeof req.body?.registrationDestinationId === "string"
      ? req.body.registrationDestinationId.trim()
      : "";
    const renewalDestinationId = typeof req.body?.renewalDestinationId === "string"
      ? req.body.renewalDestinationId.trim()
      : "";
    const registrationFee = normaliseRegistrationFee(req.body?.registrationFee);
    if (req.body?.registrationFee !== undefined &&
        registrationFee !== req.body.registrationFee) {
      res.status(400).json({ ok: false, error: "Registration fee must be a whole KSh amount between 1 and 1,000,000." });
      return;
    }
    const activeIds = new Set(current.destinations.filter(row => row.active).map(row => row.id));
    if ((registrationDestinationId && !activeIds.has(registrationDestinationId)) ||
        (renewalDestinationId && !activeIds.has(renewalDestinationId))) {
      res.status(400).json({ ok: false, error: "Choose an active destination for each payment purpose." });
      return;
    }
    if (registrationDestinationId) {
      const destination = current.destinations.find(row => row.id === registrationDestinationId);
      if (destination && destination.type !== "bank") {
        const mpesa = await getMpesaSettings();
        if (!isMpesaConfigured(mpesa)) {
          res.status(400).json({ ok: false, error: "Save matching M-Pesa Daraja settings before selecting an automatic registration destination." });
          return;
        }
      }
    }
    const next = { ...current, registrationFee, registrationDestinationId, renewalDestinationId };
    savePaymentDestinations(next);
    res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
    return;
  }

  if (req.body?.action !== "upsert") {
    res.status(400).json({ ok: false, error: "Unsupported destination action." });
    return;
  }

  const source = req.body?.destination ?? {};
  const type = source.type;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const number = typeof source.number === "string" ? source.number.trim().replace(/\s+/g, "") : "";
  const accountReference = typeof source.accountReference === "string" ? source.accountReference.trim() : "";
  const instructions = typeof source.instructions === "string" ? source.instructions.trim() : "";
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if ((type !== "bank" && type !== "till" && type !== "paybill") || !name || !number) {
    res.status(400).json({ ok: false, error: "Choose a type and enter a destination name plus receiving number." });
    return;
  }
  if (!isValidCollectionNumber(type, number)) {
    res.status(400).json({
      ok: false,
      error: type === "bank"
        ? "Enter a valid bank account number."
        : "Enter a numeric PayBill or Till number between 5 and 10 digits.",
    });
    return;
  }
  if (type === "paybill" && !accountReference) {
    res.status(400).json({ ok: false, error: "PayBill destinations require an Account / Business Number." });
    return;
  }
  if (type === "bank" && (!accountReference || !instructions)) {
    res.status(400).json({
      ok: false,
      error: "Bank destinations require an account reference and payment instructions for manual registration.",
    });
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
  res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
});

router.delete("/super-admin/payment-destinations/:id", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ ok: false, error: "A destination is required." });
    return;
  }
  const next = deletePaymentDestination(id);
  res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
});

/* ── Super Admin manual bank-registration settlement ── */
interface ManualRegistrationTransaction {
  id: number;
  admin_id: number;
  amount: number | string;
  payment_phone: string | null;
  notes: string | null;
  created_at: string;
}

interface RegistrationSettlement {
  settled: boolean;
  payment_method: string | null;
  admin_id: number | null;
}

router.get("/super-admin/manual-registration-payments", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  const payments = await sbSelect<ManualRegistrationTransaction>(
    "isp_transactions",
    "payment_method=eq.manual_registration&status=eq.pending&select=id,admin_id,amount,payment_phone,notes,created_at&order=created_at.asc&limit=100",
  );
  res.json({ ok: true, payments });
});

router.post("/super-admin/manual-registration-payments/:id/verify", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "A valid manual registration payment is required." });
    return;
  }
  const payments = await sbSelect<{ id: number }>(
    "isp_transactions",
    `id=eq.${id}&payment_method=eq.manual_registration&status=eq.pending&select=id&limit=1`,
  );
  if (!payments[0]) {
    res.status(404).json({ ok: false, error: "This manual registration payment is no longer awaiting verification." });
    return;
  }
  try {
    const settlements = await sbRpc<RegistrationSettlement>("settle_verified_mpesa_transaction", {
      p_transaction_id: id,
      p_status: "completed",
      p_note: "Manual bank registration payment verified by Super Admin.",
    });
    if (!settlements[0]?.settled || settlements[0].payment_method !== "manual_registration") {
      res.status(409).json({ ok: false, error: "This payment was already settled or could not be verified." });
      return;
    }
    if (!settlements[0].admin_id) {
      res.status(500).json({ ok: false, error: "The verified payment is not linked to an ISP registration." });
      return;
    }
    const admins = await sbSelect<{ is_active: boolean; status: string }>(
      "isp_admins",
      `id=eq.${settlements[0].admin_id}&select=is_active,status&limit=1`,
    );
    if (admins[0]?.is_active !== true || admins[0].status !== "active") {
      res.status(503).json({
        ok: false,
        error: "Payment was recorded but the ISP was not activated. Confirm the registration payments migration is applied before retrying.",
      });
      return;
    }
    res.json({ ok: true, adminId: settlements[0].admin_id });
  } catch {
    res.status(503).json({ ok: false, error: "Manual payment verification is unavailable. Apply the registration payments migration, then try again." });
  }
});

export default router;
