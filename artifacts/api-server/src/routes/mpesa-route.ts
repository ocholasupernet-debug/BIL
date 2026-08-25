/**
 * M-Pesa Daraja API routes
 *
 *   GET  /api/mpesa/token     — Generate OAuth access token from Consumer Key + Secret
 *   POST /api/mpesa/stkpush   — Initiate STK Push (shortcode 174379 sandbox default)
 *   POST /api/mpesa/callback  — Receive M-Pesa STK Push result, update wallet + transaction
 *   POST /api/mpesa/stk       — Initiate STK Push (legacy alias)
 *   GET  /api/mpesa/status    — Poll payment status by CheckoutRequestID
 *   POST /api/mpesa/verify    — Verify a manually-pasted M-Pesa confirmation SMS
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { sbInsert, sbRpc, sbSelect, sbUpdate, supabaseServiceRoleConfigured } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { getMpesaSettings, isMpesaConfigured, type MpesaSettings } from "../lib/settings-store.js";

const router: IRouter = Router();

const PAYMENT_GATEWAY_LABELS: Record<string, string> = {
  mpesa_paybill: "M-Pesa PayBill",
  mpesa_till_push: "M-Pesa Till Push (Buy Goods & Services)",
  bank_stk_push: "BankStkPush",
  airtel: "AirtelMoney",
  azampay: "AzamPay",
  custom_paybill: "CustomPaybill",
  dpo_payments: "DpoPayments",
  flutterwave: "Flutterwave",
  intasend: "Intasend",
  pesapal: "PesaPal",
  stripe: "Stripe",
  paypal: "PayPal",
  tigopesa: "TigoPesa",
  xendit: "XenditEwallet",
  manual: "Cash / Manual",
};
const PAYMENT_GATEWAY_IDS = new Set(Object.keys(PAYMENT_GATEWAY_LABELS));
type PaymentGateway = string;

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

function getPaymentGateway(value: unknown): PaymentGateway {
  return typeof value === "string" && PAYMENT_GATEWAY_IDS.has(value) ? value : "mpesa_paybill";
}

function bankStkPushConfig(value: unknown): BankStkPushConfig {
  const map = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const config = map.bank_stk_push && typeof map.bank_stk_push === "object" && !Array.isArray(map.bank_stk_push)
    ? map.bank_stk_push as Record<string, unknown>
    : {};
  return {
    bankName: typeof config.bankName === "string" ? config.bankName.trim() : "",
    paybillNumber: typeof config.paybillNumber === "string" ? config.paybillNumber.trim() : "",
    accountNumber: typeof config.accountNumber === "string" ? config.accountNumber.trim() : "",
  };
}

function gatewayConfig(value: unknown, gatewayId: string): Record<string, string> {
  const map = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const config = map[gatewayId] && typeof map[gatewayId] === "object" && !Array.isArray(map[gatewayId])
    ? map[gatewayId] as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(config)
      .filter(([, field]) => typeof field === "string")
      .map(([field, value]) => [field, (value as string).trim()]),
  );
}

function mpesaTillPushConfig(value: unknown): MpesaTillPushConfig {
  return { tillNumber: gatewayConfig(value, "mpesa_till_push").tillNumber ?? "" };
}

function mpesaPaybillConfig(value: unknown): MpesaPaybillConfig {
  const config = gatewayConfig(value, "mpesa_paybill");
  return {
    paybillNumber: config.paybillNumber ?? "",
    accountNumber: config.accountNumber ?? "",
  };
}

function isBankStkPushConfigured(config: BankStkPushConfig): boolean {
  return !!(config.bankName && config.paybillNumber && config.accountNumber);
}

function resolveDarajaPayment(
  paymentGateway: PaymentGateway,
  settings: MpesaSettings,
  bankStkPush: BankStkPushConfig,
  mpesaTillPush: MpesaTillPushConfig,
  mpesaPaybill: MpesaPaybillConfig,
): { businessShortcode: string; destination: string; accountReference?: string } {
  if (paymentGateway === "bank_stk_push") {
    return {
      businessShortcode: settings.shortcode,
      destination: bankStkPush.paybillNumber,
      accountReference: bankStkPush.accountNumber,
    };
  }
  if (paymentGateway === "mpesa_till_push") {
    return { businessShortcode: settings.shortcode, destination: mpesaTillPush.tillNumber };
  }
  if (paymentGateway === "mpesa_paybill") {
    return {
      businessShortcode: settings.shortcode,
      destination: mpesaPaybill.paybillNumber || settings.shortcode,
      accountReference: mpesaPaybill.accountNumber || undefined,
    };
  }
  return { businessShortcode: settings.shortcode, destination: settings.shortcode };
}

function paymentGatewayLabel(paymentGateway: PaymentGateway): string {
  return PAYMENT_GATEWAY_LABELS[paymentGateway] ?? paymentGateway;
}

function isDarajaGateway(paymentGateway: PaymentGateway): boolean {
  return paymentGateway === "mpesa_paybill" || paymentGateway === "mpesa_till_push" || paymentGateway === "bank_stk_push";
}

async function getAdminPaymentSettings(adminId: number | undefined): Promise<{
  paymentGateway: PaymentGateway;
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

/* ── Daraja helpers ───────────────────────────────────────────────────────── */

function darajaBase(settings: MpesaSettings): string {
  return settings.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(settings: MpesaSettings): Promise<string> {
  const { consumerKey, consumerSecret } = settings;
  const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${darajaBase(settings)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function callbackUrl(settings: MpesaSettings): string {
  return settings.callbackUrl;
}

function hasValidCallbackUrl(value: string): boolean {
  try {
    const callback = new URL(value);
    return callback.protocol === "https:" &&
      !!callback.hostname &&
      callback.pathname === "/api/mpesa/callback";
  } catch {
    return false;
  }
}

interface PendingMpesaTransaction {
  id: number;
  admin_id: number | null;
  customer_id: number | null;
  amount: number;
  payment_method: string;
  payment_phone: string | null;
}

interface SettlementResult {
  settled: boolean;
  payment_method: string | null;
  admin_id: number | null;
  amount: number | null;
  credited_customer_id: number | null;
}

interface DarajaStkQuery {
  verified: boolean;
  resultCode: number | null;
  resultDesc: string;
}

async function queryDarajaStkResult(settings: MpesaSettings, checkoutId: string): Promise<DarajaStkQuery> {
  const { timestamp, password } = stkCredentials(settings.shortcode, settings.passkey);
  const token = await getDarajaToken(settings);
  const response = await fetch(`${darajaBase(settings)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: settings.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutId,
    }),
  });
  if (!response.ok) {
    return { verified: false, resultCode: null, resultDesc: `Daraja query failed: ${response.status}` };
  }
  const data = await response.json() as Record<string, unknown>;
  const returnedCheckoutId = String(data.CheckoutRequestID ?? "");
  const resultCode = Number(data.ResultCode);
  if (!returnedCheckoutId || returnedCheckoutId !== checkoutId || !Number.isFinite(resultCode)) {
    return { verified: false, resultCode: null, resultDesc: "Daraja query did not confirm this checkout request." };
  }
  return { verified: true, resultCode, resultDesc: String(data.ResultDesc ?? "") };
}

async function reconcileInitiatedStkRequest(
  transactionId: number,
  checkoutId: string,
  merchantRequestId: string,
  notes: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updated = await sbUpdate(
      "isp_transactions",
      `id=eq.${transactionId}&status=eq.initiating`,
      {
        reference: checkoutId,
        merchant_request_id: merchantRequestId,
        status: "pending",
        notes,
      },
    );
    if (updated[0]) return true;
    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return false;
}

function stkCredentials(shortcode: string, passkey: string): { timestamp: string; password: string } {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
  const raw = `${shortcode}${passkey}${timestamp}`;
  const password = Buffer.from(raw).toString("base64");
  return { timestamp, password };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/mpesa/token
 * Public OAuth token access is intentionally disabled. Tokens are only used
 * inside the server-side STK flows.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/token", (_req: Request, res: Response): void => {
  res.status(404).json({ ok: false, error: "This endpoint is not available." });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/stkpush
 * Body: { phone, amount, account_ref? }
 * Uses shortcode 174379 (sandbox default), passkey, timestamp-derived password.
 * Formats phone to 2547XXXXXXXX and sends STK Push via Daraja API.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/stkpush", async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, account_ref, adminId } = req.body as {
    phone?: string; amount?: number; account_ref?: string; adminId?: number;
  };

  if (!phone || !amount) {
    res.status(400).json({ ok: false, error: "phone and amount are required" });
    return;
  }

  const cfg = await getMpesaSettings();
  if (!isMpesaConfigured(cfg)) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa credentials are not configured. Configure them in Super Admin → Payment Gateways.",
    });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  const raw = String(phone).replace(/\D/g, "");
  const formatted = raw.startsWith("0")
    ? `254${raw.slice(1)}`
    : raw.startsWith("+254")
    ? raw.slice(1)
    : raw.startsWith("254")
    ? raw
    : `254${raw}`;

  try {
    const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(adminId);
      if (!isDarajaGateway(paymentGateway)) {
       res.status(409).json({ ok: false, error: `${paymentGatewayLabel(paymentGateway)} is selected, but automated payment prompts are not connected for this gateway yet.` });
       return;
      }
      if (paymentGateway === "bank_stk_push" && !isBankStkPushConfigured(bankStkPush)) {
       res.status(400).json({ ok: false, error: "BankStkPush is missing the selected bank, PayBill Number, or Account / Business Number." });
       return;
     }
      const payment = resolveDarajaPayment(paymentGateway, cfg, bankStkPush, mpesaTillPush, mpesaPaybill);
      const { businessShortcode, destination } = payment;
     if (paymentGateway === "mpesa_till_push" && !destination) {
       res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
      return;
    }

    const resolvedCallbackUrl = callbackUrl(cfg);
    if (!hasValidCallbackUrl(resolvedCallbackUrl)) {
      res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
      return;
    }
    const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
      admin_id: null,
      plan_id: null,
      amount: Math.ceil(Number(amount)),
      payment_method: "mpesa",
      payment_phone: formatted,
      reference: `initiating:${randomUUID()}`,
      status: "initiating",
      notes: `${paymentGatewayLabel(paymentGateway)} STK request is being created for ${formatted}`,
      created_at: new Date().toISOString(),
    });
    const initiatedTransaction = initiatedTransactions[0];
    if (!initiatedTransaction) {
      res.status(503).json({ ok: false, error: "Could not safely create the payment request. Please try again." });
      return;
    }
    const { timestamp, password } = stkCredentials(businessShortcode, cfg.passkey);
    const token = await getDarajaToken(cfg);

    const stkBody = {
      BusinessShortCode: businessShortcode,
      Password:          password,
      Timestamp:         timestamp,
       TransactionType:   paymentGateway === "mpesa_till_push" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            formatted,
      PartyB:            destination,
      PhoneNumber:       formatted,
      CallBackURL:       resolvedCallbackUrl,
      AccountReference:  payment.accountReference ?? account_ref ?? "ISPlatty",
      TransactionDesc:   "STK Push Payment",
    };

    const stkRes = await fetch(`${darajaBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(stkBody),
    });

    const data = await stkRes.json() as Record<string, unknown>;
    logger.info({ phone: formatted, amount, data }, "[mpesa/stkpush] response");

    if (!stkRes.ok || data["ResponseCode"] !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `STK prompt request failed: ${String(data["errorMessage"] ?? data["ResponseDescription"] ?? "Unknown error")}`,
      });
      res.status(400).json({
        ok: false,
        error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string,
      });
      return;
    }

    const checkoutId = String(data["CheckoutRequestID"] ?? "");
    const reconciled = checkoutId && await reconcileInitiatedStkRequest(
      initiatedTransaction.id,
      checkoutId,
      String(data["MerchantRequestID"] ?? ""),
      `${paymentGatewayLabel(paymentGateway)} STK push to ${formatted}`,
    );
    if (!reconciled) {
      logger.error({ checkoutId }, "[mpesa/stkpush] Could not reconcile initiated transaction");
      res.status(502).json({ ok: false, error: "The payment prompt was sent but could not be recorded safely. Do not retry; contact support." });
      return;
    }

    res.json({
      ok: true,
      CheckoutRequestID:  data["CheckoutRequestID"],
      MerchantRequestID:  data["MerchantRequestID"],
      ResponseDescription: data["ResponseDescription"],
    });
  } catch (e) {
    logger.error({ err: e }, "[mpesa/stkpush] error");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/callback
 * Receives the M-Pesa STK Push result from Safaricom.
 * Safaricom callbacks are correlated to an existing pending transaction, then
 * verified with Daraja's STK Query endpoint before any local state changes.
 * A conditional pending-to-final state change makes callback replay harmless.
 * Always responds 200 to Safaricom immediately.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/callback", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    service: "M-Pesa Daraja callback",
    method: "POST",
    message: "Callback endpoint is online and ready to receive STK Push results.",
  });
});

router.post("/mpesa/callback", async (req: Request, res: Response): Promise<void> => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      logger.warn({ body: req.body }, "[mpesa/callback] No stkCallback in body — ignoring");
      return;
    }

    const { ResultCode, ResultDesc, CheckoutRequestID, MerchantRequestID } = callback;

    logger.info(
      { ResultCode, ResultDesc, CheckoutRequestID, MerchantRequestID },
      "[mpesa/callback] Received callback"
    );

    const checkoutId = String(CheckoutRequestID ?? "").trim();
    if (!checkoutId) {
      logger.warn("[mpesa/callback] Missing CheckoutRequestID — ignoring");
      return;
    }
    const pendingRows = await sbSelect<PendingMpesaTransaction>(
      "isp_transactions",
      `reference=eq.${encodeURIComponent(checkoutId)}&status=eq.pending&select=id,admin_id,customer_id,amount,payment_method,payment_phone&limit=1`,
    );
    const transaction = pendingRows[0];
    if (!transaction) {
      await sbInsert("isp_webhook_events", {
        gateway: "mpesa",
        status: "received",
        payload: req.body,
        reference: checkoutId,
        created_at: new Date().toISOString(),
      });
      logger.warn({ checkoutId }, "[mpesa/callback] Callback arrived before local checkout reconciliation; queued for review");
      return;
    }

    const settings = await getMpesaSettings();
    const verification = await queryDarajaStkResult(settings, checkoutId);
    const callbackResultCode = Number(ResultCode);
    if (!verification.verified || verification.resultCode !== callbackResultCode) {
      logger.warn({ checkoutId, callbackResultCode, verification }, "[mpesa/callback] Callback could not be verified with Daraja");
      return;
    }

    const isSuccessful = verification.resultCode === 0;
    const status = isSuccessful ? "completed" : "failed";
    const settlements = await sbRpc<SettlementResult>("settle_verified_mpesa_transaction", {
      p_transaction_id: transaction.id,
      p_status: status,
      p_note: isSuccessful
        ? "M-Pesa payment verified by Daraja."
        : `Daraja ResultCode ${verification.resultCode}: ${verification.resultDesc || String(ResultDesc ?? "Payment failed")}`,
    });
    const settlement = settlements[0];
    if (!settlement?.settled) {
      logger.info({ checkoutId }, "[mpesa/callback] Callback replay ignored after state transition");
      return;
    }

    if (!isSuccessful) {
      return;
    }

    if (settlement.payment_method === "mpesa_registration") {
      logger.info({ adminId: settlement.admin_id, checkoutId }, "[mpesa/callback] ISP registration activated");
      return;
    }

    logger.info({ customerId: settlement.credited_customer_id, checkoutId, amount: settlement.amount }, "[mpesa/callback] Payment settled atomically");
  } catch (err) {
    logger.error({ err }, "[mpesa/callback] Unexpected error processing callback");
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/stk  (legacy alias — same behavior as /stkpush)
 * Body: { phone, amount, plan_id?, account_ref? }
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/stk", async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, plan_id, account_ref, adminId } = req.body as {
    phone?: string; amount?: number; plan_id?: number; account_ref?: string; adminId?: number;
  };

  if (!phone || !amount) {
    res.status(400).json({ ok: false, error: "phone and amount are required" });
    return;
  }

  /* Normalise phone to 254XXXXXXXXX format */
  const raw = String(phone).replace(/\D/g, "");
  const normalised = raw.startsWith("0")
    ? `254${raw.slice(1)}`
    : raw.startsWith("254")
    ? raw
    : `254${raw}`;

  const cfg = await getMpesaSettings();
  if (!isMpesaConfigured(cfg)) {
    logger.warn("[mpesa/stk] M-Pesa credentials not configured — returning 503");
    res.status(503).json({
      ok: false,
      demo: true,
      error: "M-Pesa is not configured. Ask the Super Admin to complete Payment Gateways.",
    });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  try {
      const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(adminId);
      if (!isDarajaGateway(paymentGateway)) {
       res.status(409).json({ ok: false, error: `${paymentGatewayLabel(paymentGateway)} is selected, but automated payment prompts are not connected for this gateway yet.` });
       return;
      }
      if (paymentGateway === "bank_stk_push" && !isBankStkPushConfigured(bankStkPush)) {
       res.status(400).json({ ok: false, error: "BankStkPush is missing the selected bank, PayBill Number, or Account / Business Number." });
       return;
     }
      const payment = resolveDarajaPayment(paymentGateway, cfg, bankStkPush, mpesaTillPush, mpesaPaybill);
      const { businessShortcode, destination } = payment;
     if (paymentGateway === "mpesa_till_push" && !destination) {
       res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
      return;
    }
     const resolvedCallbackUrl = callbackUrl(cfg);
     if (!hasValidCallbackUrl(resolvedCallbackUrl)) {
       res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
       return;
     }
     const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
       admin_id: adminId ?? null,
       plan_id: plan_id ?? null,
       amount: Math.ceil(Number(amount)),
       payment_method: "mpesa",
       payment_phone: normalised,
       reference: `initiating:${randomUUID()}`,
       status: "initiating",
       notes: `${paymentGatewayLabel(paymentGateway)} STK request is being created for ${normalised}`,
       created_at: new Date().toISOString(),
     });
     const initiatedTransaction = initiatedTransactions[0];
     if (!initiatedTransaction) {
       res.status(503).json({ ok: false, error: "Could not safely create the payment request. Please try again." });
       return;
     }
     const token = await getDarajaToken(cfg);
     const { timestamp, password } = stkCredentials(businessShortcode, cfg.passkey);

    const body = {
       BusinessShortCode: businessShortcode,
      Password:          password,
      Timestamp:         timestamp,
       TransactionType:   paymentGateway === "mpesa_till_push" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            normalised,
      PartyB:            destination,
      PhoneNumber:       normalised,
       CallBackURL:       resolvedCallbackUrl,
       AccountReference:  payment.accountReference ?? account_ref ?? "ISPlatty",
      TransactionDesc:   `Plan ${plan_id ?? "purchase"}`,
    };

    const stkRes = await fetch(`${darajaBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await stkRes.json() as Record<string, unknown>;
    logger.info({ phone: normalised, amount, data }, "[mpesa/stk] STK push response");

    if (!stkRes.ok || data["ResponseCode"] !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `STK prompt request failed: ${String(data["errorMessage"] ?? data["ResponseDescription"] ?? "Unknown error")}`,
      });
      res.status(400).json({ ok: false, error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string });
      return;
    }

    const checkoutId = String(data["CheckoutRequestID"] ?? "");
    const reconciled = checkoutId && await reconcileInitiatedStkRequest(
      initiatedTransaction.id,
      checkoutId,
      String(data["MerchantRequestID"] ?? ""),
      `${paymentGatewayLabel(paymentGateway)} STK push to ${normalised}`,
    );
    if (!reconciled) {
      logger.error({ checkoutId }, "[mpesa/stk] Could not reconcile initiated transaction");
      res.status(502).json({ ok: false, error: "The payment prompt was sent but could not be recorded safely. Do not retry; contact support." });
      return;
    }

    res.json({ ok: true, CheckoutRequestID: data["CheckoutRequestID"], MerchantRequestID: data["MerchantRequestID"] });
  } catch (e) {
    logger.error({ err: e }, "[mpesa/stk] error");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/mpesa/status?checkout_id=XXX
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/status", async (req: Request, res: Response): Promise<void> => {
  const checkoutId = String(req.query.checkout_id ?? "").trim();

  if (!checkoutId) {
    res.status(400).json({ ok: false, paid: false, error: "checkout_id required" });
    return;
  }

  const rows = await sbSelect<{ id: number; status: string; reference: string; notes: string | null; admin_id: number | null; payment_method: string }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}&select=id,status,reference,notes,admin_id,payment_method&limit=1`,
  );

  const tx = rows[0];
  if (!tx) {
    res.json({ ok: true, paid: false, status: "pending" });
    return;
  }

  const paid = tx.status === "completed" || tx.status === "success" || tx.status === "paid";
  if (paid && tx.payment_method === "mpesa_registration" && tx.admin_id) {
    const admins = await sbSelect<{ username: string; name: string; subdomain: string; is_active: boolean }>(
      "isp_admins",
      `id=eq.${tx.admin_id}&select=username,name,subdomain,is_active&limit=1`,
    );
    const admin = admins[0];
    res.json({
      ok: true,
      paid: !!admin?.is_active,
      status: admin?.is_active ? "completed" : "processing",
      registration: admin ? { username: admin.username, name: admin.name, subdomain: admin.subdomain } : undefined,
    });
    return;
  }
  res.json({
    ok: true,
    paid,
    status: tx.status,
    failureReason: tx.status === "failed" ? tx.notes ?? undefined : undefined,
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/verify
 * Public SMS-based confirmation is disabled. Live payments must be confirmed
 * by Safaricom's STK Query path in the callback handler.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/verify", (_req: Request, res: Response): void => {
  res.status(404).json({ ok: false, error: "This endpoint is not available." });
});

export default router;
