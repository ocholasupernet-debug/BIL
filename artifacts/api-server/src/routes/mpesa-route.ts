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
import { getMpesaSettings, isMpesaConfigured } from "../lib/settings-store.js";

const router: IRouter = Router();

/* ── Daraja helpers — reads credentials fresh per-request so admin saves take effect ── */

function darajaBase(): string {
  return getMpesaSettings().env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(): Promise<string> {
  const { consumerKey, consumerSecret } = getMpesaSettings();
  const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function stkCredentials(): { timestamp: string; password: string } {
  const { shortcode, passkey } = getMpesaSettings();
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
  const { consumerKey, consumerSecret } = getMpesaSettings();
  if (!consumerKey || !consumerSecret) {
    res.status(503).json({
      ok: false,
      error: "MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET are not set. Add them as environment variables or configure in Admin Settings → Billing.",
    });
    return;
  }

  try {
    const token = await getDarajaToken();
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
  const { phone, amount, account_ref } = req.body as {
    phone?: string; amount?: number; account_ref?: string;
  };

  if (!phone || !amount) {
    res.status(400).json({ ok: false, error: "phone and amount are required" });
    return;
  }

  if (!isMpesaConfigured()) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa credentials not configured. Set Consumer Key, Consumer Secret, Shortcode & Passkey in Admin Settings → Billing.",
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
    const cfg = getMpesaSettings();
    const shortcode = cfg.shortcode || "174379";
    const passkey   = cfg.passkey;

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const token = await getDarajaToken();

    const stkBody = {
      BusinessShortCode: shortcode,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            formatted,
      PartyB:            shortcode,
      PhoneNumber:       formatted,
      CallBackURL:       cfg.callbackUrl || `${req.protocol}://${req.get("host")}/api/mpesa/callback`,
      AccountReference:  account_ref ?? "ISPlatty",
      TransactionDesc:   "STK Push Payment",
    };

    const stkRes = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, {
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
      notes:          `STK push to ${formatted}`,
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
router.post("/mpesa/callback", async (req: Request, res: Response): Promise<void> => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      logger.warn({ body: req.body }, "[mpesa/callback] No stkCallback in body — ignoring");
      return;
    }

    const { ResultCode, CheckoutRequestID, MerchantRequestID } = callback;

    logger.info(
      { ResultCode, CheckoutRequestID, MerchantRequestID },
      "[mpesa/callback] Received callback"
    );

    if (ResultCode !== 0) {
      logger.info({ ResultCode, CheckoutRequestID }, "[mpesa/callback] Payment failed or cancelled by user");
      await sbUpdate(
        "isp_transactions",
        `reference=eq.${encodeURIComponent(String(CheckoutRequestID))}`,
        { status: "failed", notes: `ResultCode ${ResultCode}: ${callback.ResultDesc ?? "cancelled"}` },
      ).catch(() => {});
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
        reference: mpesaReceipt || String(CheckoutRequestID),
        notes: `M-Pesa payment confirmed. Receipt: ${mpesaReceipt}. Phone: ${rawPhone}`,
      },
    ).catch(err => logger.warn({ err }, "[mpesa/callback] Failed to update transaction"));

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

  if (!isMpesaConfigured()) {
    logger.warn("[mpesa/stk] M-Pesa credentials not configured — returning 503");
    res.status(503).json({
      ok: false,
      demo: true,
      error: "M-Pesa is not configured. Go to Admin Settings → Billing and enter your Daraja API credentials.",
    });
    return;
  }

  try {
    const cfg = getMpesaSettings();
    const token = await getDarajaToken();
    const { timestamp, password } = stkCredentials();
    const callbackUrl = cfg.callbackUrl || `${req.protocol}://${req.get("host")}/api/webhooks/mpesa`;

    const body = {
      BusinessShortCode: cfg.shortcode,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            normalised,
      PartyB:            cfg.shortcode,
      PhoneNumber:       normalised,
      CallBackURL:       callbackUrl,
      AccountReference:  account_ref ?? "ISPlatty",
      TransactionDesc:   `Plan ${plan_id ?? "purchase"}`,
    };

    const stkRes = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, {
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
      notes:          `STK push to ${normalised}`,
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

  const rows = await sbSelect<{ id: number; status: string; reference: string }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}&select=id,status,reference&limit=1`,
  );

  const tx = rows[0];
  if (!tx) {
    res.json({ ok: true, paid: false, status: "pending" });
    return;
  }

  const paid = tx.status === "completed" || tx.status === "success" || tx.status === "paid";
  res.json({ ok: true, paid, status: tx.status });
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
