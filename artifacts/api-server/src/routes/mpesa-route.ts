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
import { sbInsert, sbSelect, sbUpdate } from "../lib/supabase-client.js";
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

function callbackUrl(req: Request, settings: MpesaSettings): string {
  if (settings.callbackUrl) return settings.callbackUrl;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string"
    ? forwardedProto.split(",")[0].trim()
    : req.protocol;
  return `${protocol}://${req.get("host")}/api/mpesa/callback`;
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
 * Generates an M-Pesa access token using Consumer Key + Consumer Secret
 * via Safaricom's OAuth endpoint.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/token", async (_req: Request, res: Response): Promise<void> => {
  const settings = await getMpesaSettings();
  const { consumerKey, consumerSecret } = settings;
  if (!consumerKey || !consumerSecret) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa credentials are not configured. Configure them in Super Admin → Payment Gateways.",
    });
    return;
  }

  try {
    const token = await getDarajaToken(settings);
    res.json({ ok: true, access_token: token });
  } catch (e) {
    logger.error({ err: e }, "[mpesa/token] failed to generate access token");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
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

    const resolvedCallbackUrl = callbackUrl(req, cfg);
    if (cfg.env === "production" && !resolvedCallbackUrl.startsWith("https://")) {
      res.status(503).json({ ok: false, error: "Live M-Pesa requires a public HTTPS callback URL." });
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
      res.status(400).json({
        ok: false,
        error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string,
      });
      return;
    }

    await sbInsert("isp_transactions", {
      admin_id:       null,
      plan_id:        null,
      amount:         Math.ceil(Number(amount)),
      payment_method: "mpesa",
      reference:      String(data["CheckoutRequestID"] ?? ""),
      status:         "pending",
       notes:          `${paymentGatewayLabel(paymentGateway)} STK push to ${formatted}`,
      created_at:     new Date().toISOString(),
    }).catch(() => {});

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
 * If ResultCode = 0 → payment successful:
 *   - Updates the pending transaction in isp_transactions to "completed"
 *   - Credits the customer's wallet_balance in isp_customers
 *   - Logs the event
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

    if (ResultCode !== 0) {
      const failureReason = String(ResultDesc ?? "M-Pesa rejected the request");
      logger.info({ ResultCode, ResultDesc: failureReason, CheckoutRequestID }, "[mpesa/callback] Payment failed or cancelled by user");
      const registrationRows = await sbSelect<{ admin_id: number | null; payment_method: string }>(
        "isp_transactions",
        `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}&select=admin_id,payment_method&limit=1`,
      );
      await sbUpdate(
        "isp_transactions",
        `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}`,
        { status: "failed", notes: `ResultCode ${ResultCode}: ${failureReason}` },
      ).catch(() => {});
      const registration = registrationRows[0];
      if (registration?.payment_method === "mpesa_registration" && registration.admin_id) {
        await sbUpdate("isp_admins", `id=eq.${registration.admin_id}`, {
          status: "payment_failed",
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      }
      return;
    }

    const items: { Name: string; Value: unknown }[] = callback.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find(i => i.Name === name)?.Value;

    const amount       = Number(get("Amount") ?? 0);
    const mpesaReceipt = String(get("MpesaReceiptNumber") ?? "");
    const rawPhone     = String(get("PhoneNumber") ?? "");

    logger.info(
      { amount, mpesaReceipt, phone: rawPhone, CheckoutRequestID },
      "[mpesa/callback] Payment successful"
    );

    if (amount <= 0) {
      logger.warn("[mpesa/callback] Amount is 0 or missing — skipping");
      return;
    }

    await sbUpdate(
      "isp_transactions",
      `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}`,
      {
        status: "completed",
        notes: `M-Pesa payment confirmed. Receipt: ${mpesaReceipt}. Phone: ${rawPhone}`,
      },
    ).catch(err => logger.warn({ err }, "[mpesa/callback] Failed to update transaction"));

    const registrationRows = await sbSelect<{ admin_id: number | null; payment_method: string; amount: number }>(
      "isp_transactions",
      `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}&select=admin_id,payment_method,amount&limit=1`,
    );
    const registration = registrationRows[0];
    if (registration?.payment_method === "mpesa_registration" && registration.admin_id) {
      if (Number(registration.amount) !== amount) {
        await sbUpdate("isp_transactions", `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}`, {
          status: "failed",
          notes: "Registration payment amount did not match the required fee.",
        }).catch(() => {});
        await sbUpdate("isp_admins", `id=eq.${registration.admin_id}`, {
          status: "payment_failed",
          updated_at: new Date().toISOString(),
        }).catch(() => {});
        logger.warn({ checkoutId: CheckoutRequestID, amount }, "[mpesa/callback] Registration payment amount mismatch");
        return;
      }
      await sbUpdate("isp_admins", `id=eq.${registration.admin_id}`, {
        is_active: true,
        status: "active",
        updated_at: new Date().toISOString(),
      });
      logger.info({ adminId: registration.admin_id, checkoutId: CheckoutRequestID }, "[mpesa/callback] ISP registration activated");
      return;
    }

    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, "");
      const phoneVariants: string[] = [digits];
      if (digits.startsWith("254") && digits.length === 12) {
        phoneVariants.push("0" + digits.slice(3));
      }
      if (digits.startsWith("0") && digits.length === 10) {
        phoneVariants.push("254" + digits.slice(1));
      }

      let credited = false;
      for (const phone of phoneVariants) {
        const customers = await sbSelect<{ id: number; wallet_balance: number | null }>(
          "isp_customers",
          `phone=eq.${phone}&select=id,wallet_balance&limit=1`,
        ).catch(() => [] as { id: number; wallet_balance: number | null }[]);

        if (customers.length > 0) {
          const customer = customers[0];
          const currentBalance = Number(customer.wallet_balance ?? 0);
          const newBalance = currentBalance + amount;

          await sbUpdate("isp_customers", `id=eq.${customer.id}`, {
            wallet_balance: newBalance,
            updated_at: new Date().toISOString(),
          });

          logger.info(
            { customerId: customer.id, phone, previousBalance: currentBalance, credited: amount, newBalance },
            "[mpesa/callback] Wallet balance updated"
          );
          credited = true;
          break;
        }
      }

      if (!credited) {
        logger.warn({ phone: rawPhone }, "[mpesa/callback] No customer found for phone — wallet not updated, transaction still recorded");
      }
    }
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
     const resolvedCallbackUrl = callbackUrl(req, cfg);
     if (cfg.env === "production" && !resolvedCallbackUrl.startsWith("https://")) {
       res.status(503).json({ ok: false, error: "Live M-Pesa requires a public HTTPS callback URL." });
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
      res.status(400).json({ ok: false, error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string });
      return;
    }

    /* Persist pending transaction */
    await sbInsert("isp_transactions", {
      admin_id:       adminId ?? null,
      plan_id:        plan_id ?? null,
      amount:         Math.ceil(Number(amount)),
      payment_method: "mpesa",
      reference:      String(data["CheckoutRequestID"] ?? ""),
      status:         "pending",
       notes:          `${paymentGatewayLabel(paymentGateway)} STK push to ${normalised}`,
      created_at:     new Date().toISOString(),
    }).catch(() => { /* non-fatal */ });

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
 * Body: { message } — raw M-Pesa confirmation SMS text
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/verify", async (req: Request, res: Response): Promise<void> => {
  const { message } = req.body as { message?: string };
  if (!message) { res.status(400).json({ ok: false, error: "message required" }); return; }

  const refMatch   = message.match(/^([A-Z0-9]{10,})\s+Confirmed/i);
  const amtMatch   = message.match(/Ksh\s?([\d,.]+)/i) ?? message.match(/received\s+Ksh\s?([\d,.]+)/i);
  const phoneMatch = message.match(/from\s+[A-Z\s]+\s+(\d{9,12})/i);

  const reference = refMatch?.[1] ?? null;
  const amount    = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : null;
  const phone     = phoneMatch?.[1] ?? null;

  logger.info({ reference, amount, phone }, "[mpesa/verify] parsed SMS");

  if (reference) {
    await sbUpdate("isp_transactions", `reference=eq.${encodeURIComponent(reference)}`, {
      status: "completed",
      notes:  `Verified via SMS: ${message.slice(0, 120)}`,
    }).catch(() => { /* non-fatal */ });
  }

  res.json({ ok: true, parsed: { reference, amount, phone } });
});

export default router;
