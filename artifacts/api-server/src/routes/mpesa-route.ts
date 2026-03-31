/**
 * M-Pesa Daraja API routes
 *
 *   POST /api/mpesa/stk       — Initiate STK Push (Lipa na M-Pesa Online)
 *   GET  /api/mpesa/status    — Poll payment status by CheckoutRequestID
 *   POST /api/mpesa/verify    — Verify a manually-pasted M-Pesa confirmation SMS
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { sbInsert, sbSelect, sbUpdate } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── Daraja credentials from env ────────────────────────────────────────── */
const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY    ?? "";
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET ?? "";
const SHORTCODE       = process.env.MPESA_SHORTCODE       ?? "";
const PASSKEY         = process.env.MPESA_PASSKEY         ?? "";
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL    ?? "";
const ENV             = process.env.MPESA_ENV             ?? "sandbox"; /* "sandbox" | "production" */

const DARAJA_BASE = ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

function isConfigured(): boolean {
  return !!(CONSUMER_KEY && CONSUMER_SECRET && SHORTCODE && PASSKEY);
}

/* ── Get Daraja OAuth token ─────────────────────────────────────────────── */
async function getDarajaToken(): Promise<string> {
  const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

/* ── Generate STK push timestamp and password ───────────────────────────── */
function stkCredentials(): { timestamp: string; password: string } {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
  const raw = `${SHORTCODE}${PASSKEY}${timestamp}`;
  const password = Buffer.from(raw).toString("base64");
  return { timestamp, password };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/stk
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

  if (!isConfigured()) {
    logger.warn("[mpesa/stk] M-Pesa credentials not configured — returning demo response");
    res.status(503).json({
      ok: false,
      demo: true,
      error: "M-Pesa is not configured on this server. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, and MPESA_CALLBACK_URL environment variables.",
    });
    return;
  }

  try {
    const token = await getDarajaToken();
    const { timestamp, password } = stkCredentials();
    const callbackUrl = CALLBACK_URL || `${req.protocol}://${req.get("host")}/api/webhooks/mpesa`;

    const body = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            normalised,
      PartyB:            SHORTCODE,
      PhoneNumber:       normalised,
      CallBackURL:       callbackUrl,
      AccountReference:  account_ref ?? "ISPlatty",
      TransactionDesc:   `Plan ${plan_id ?? "purchase"}`,
    };

    const stkRes = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await stkRes.json() as Record<string, unknown>;
    logger.info({ phone: normalised, amount, data }, "[mpesa/stk] STK push response");

    if (!stkRes.ok || data["ResponseCode"] !== "0") {
      res.status(400).json({ ok: false, error: data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed" });
      return;
    }

    /* Persist pending transaction */
    await sbInsert("isp_transactions", {
      admin_id:           adminId ?? null,
      plan_id:            plan_id ?? null,
      amount:             Math.ceil(Number(amount)),
      payment_method:     "mpesa",
      reference:          String(data["CheckoutRequestID"] ?? ""),
      status:             "pending",
      notes:              `STK push to ${normalised}`,
      created_at:         new Date().toISOString(),
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

  /* Check our own transactions table for a completed payment */
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
 * Parses and marks the matching transaction as paid.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/verify", async (req: Request, res: Response): Promise<void> => {
  const { message } = req.body as { message?: string };
  if (!message) { res.status(400).json({ ok: false, error: "message required" }); return; }

  /* Parse M-Pesa SMS: "MXX... Confirmed. KshX received from NAME PHONE on DATE."
     Also handles "You have received KshX from NAME PHONE" format. */
  const refMatch   = message.match(/^([A-Z0-9]{10,})\s+Confirmed/i);
  const amtMatch   = message.match(/Ksh\s?([\d,.]+)/i) ?? message.match(/received\s+Ksh\s?([\d,.]+)/i);
  const phoneMatch = message.match(/from\s+[A-Z\s]+\s+(\d{9,12})/i);

  const reference = refMatch?.[1] ?? null;
  const amount    = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : null;
  const phone     = phoneMatch?.[1] ?? null;

  logger.info({ reference, amount, phone }, "[mpesa/verify] parsed SMS");

  if (reference) {
    /* Try to mark a matching pending transaction as completed */
    await sbUpdate("isp_transactions", `reference=eq.${encodeURIComponent(reference)}`, {
      status: "completed",
      notes:  `Verified via SMS: ${message.slice(0, 120)}`,
    }).catch(() => { /* non-fatal */ });
  }

  res.json({ ok: true, parsed: { reference, amount, phone } });
});

export default router;
