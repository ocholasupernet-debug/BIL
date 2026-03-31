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
