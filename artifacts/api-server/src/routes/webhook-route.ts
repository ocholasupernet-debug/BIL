/**
 * Payment Webhook Handlers
 *
 * Endpoints:
 *   POST /api/webhooks/mpesa          — Safaricom Daraja STK Push result callback
 *   POST /api/webhooks/mpesa/c2b      — Safaricom C2B pay-bill / buy-goods confirmation
 *   POST /api/webhooks/stripe         — Stripe payment_intent.succeeded / checkout.session.completed
 *   POST /api/webhooks/flutterwave    — Flutterwave charge.completed
 *   POST /api/webhooks/generic        — Any custom payment system (JSON body with phone + amount)
 *   POST /api/webhooks/provision      — Direct provisioning (secret-protected)
 *   GET  /api/webhooks/events         — Recent webhook events log
 *   GET  /api/webhooks/status         — Health + configuration summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { autoProvision }  from "../lib/auto-provision";
import { sbSelect, sbInsert } from "../lib/supabase-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* ── Webhook secret (set WEBHOOK_SECRET env var on the VPS) ─────────────── */
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "changeme_secret";

/* ── Optional admin_id header for multi-tenant routing ─────────────────── */
function adminIdFromReq(req: Request): number | undefined {
  const h = req.headers["x-admin-id"] ?? req.query.adminId;
  const n = parseInt(String(h ?? ""), 10);
  return isNaN(n) ? undefined : n;
}

/* ── Standard success/error response ───────────────────────────────────── */
function ok(res: Response, data: Record<string, unknown> = {}) {
  res.json({ ok: true, ...data });
}
function fail(res: Response, status: number, msg: string) {
  logger.warn(`[webhook] ${msg}`);
  res.status(status).json({ ok: false, error: msg });
}

/* ── Log raw webhook event ──────────────────────────────────────────────── */
async function logRaw(
  gateway: string,
  status: "received" | "processed" | "ignored" | "error",
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await sbInsert("isp_webhook_events", {
      gateway,
      status,
      ...meta,
      created_at: new Date().toISOString(),
    });
  } catch { /* table may not exist yet */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. M-Pesa STK Push callback (Daraja API)
 *
 * Safaricom sends this to your callback URL after initiating an STK push.
 * Configure in Daraja portal: CallBackURL = https://VPS_IP:8080/api/webhooks/mpesa
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/mpesa", async (req: Request, res: Response): Promise<void> => {
  /* Safaricom expects a 200 immediately — always respond first */
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) { await logRaw("mpesa_stk", "ignored", { reason: "no stkCallback", body: req.body }); return; }

    const { ResultCode, MerchantRequestID, CheckoutRequestID } = callback;

    if (ResultCode !== 0) {
      logger.info({ ResultCode, CheckoutRequestID }, "[webhook/mpesa] STK push failed/cancelled by user");
      await logRaw("mpesa_stk", "ignored", { ResultCode, CheckoutRequestID, reason: "user cancelled or failed" });
      return;
    }

    /* Extract metadata from CallbackMetadata.Item array */
    const items: { Name: string; Value: unknown }[] = callback.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find(i => i.Name === name)?.Value;

    const amount    = Number(get("Amount")             ?? 0);
    const reference = String(get("MpesaReceiptNumber") ?? MerchantRequestID ?? CheckoutRequestID ?? "");
    const rawPhone  = String(get("PhoneNumber")        ?? "");

    if (!rawPhone || amount <= 0) {
      await logRaw("mpesa_stk", "error", { reason: "missing phone or amount", items });
      return;
    }

    await logRaw("mpesa_stk", "received", { reference, amount, phone: rawPhone });

    const result = await autoProvision({
      phone:         rawPhone,
      amount,
      reference,
      paymentMethod: "mpesa",
      gateway:       "mpesa_stk",
      adminId:       adminIdFromReq(req),
    });

    logger.info({ result }, "[webhook/mpesa] STK provision result");
    await logRaw("mpesa_stk", result.ok ? "processed" : "error", { reference, result });
  } catch (err) {
    logger.error({ err }, "[webhook/mpesa] Unexpected error");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. M-Pesa C2B Pay-bill / Buy-goods
 *
 * Validation URL: https://VPS_IP:8080/api/webhooks/mpesa/c2b/validation
 * Confirmation URL: https://VPS_IP:8080/api/webhooks/mpesa/c2b/confirmation
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/mpesa/c2b/validation", (_req: Request, res: Response) => {
  /* Accept all transactions at validation stage */
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

router.post("/webhooks/mpesa/c2b/confirmation", async (req: Request, res: Response): Promise<void> => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const b = req.body ?? {};
    const amount    = Number(b.TransAmount ?? 0);
    const reference = String(b.TransID ?? b.BillRefNumber ?? "");
    const rawPhone  = String(b.MSISDN ?? "");

    if (!rawPhone || amount <= 0) {
      await logRaw("mpesa_c2b", "ignored", { reason: "missing data", body: b });
      return;
    }

    await logRaw("mpesa_c2b", "received", { reference, amount, phone: rawPhone });

    const result = await autoProvision({
      phone:         rawPhone,
      amount,
      reference,
      paymentMethod: "mpesa",
      gateway:       "mpesa_c2b",
      adminId:       adminIdFromReq(req),
    });

    await logRaw("mpesa_c2b", result.ok ? "processed" : "error", { reference, result });
  } catch (err) {
    logger.error({ err }, "[webhook/mpesa/c2b] Error");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Stripe
 *
 * Webhook URL: https://VPS_IP:8080/api/webhooks/stripe
 * Supported events: payment_intent.succeeded, checkout.session.completed
 *
 * Set STRIPE_WEBHOOK_SECRET in env for signature verification.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/stripe", async (req: Request, res: Response): Promise<void> => {
  const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  /* Verify Stripe signature if secret is configured */
  if (STRIPE_SECRET) {
    const sig  = req.headers["stripe-signature"] as string;
    const body = JSON.stringify(req.body);
    const ts   = sig?.match(/t=(\d+)/)?.[1] ?? "";
    const expected = crypto
      .createHmac("sha256", STRIPE_SECRET)
      .update(`${ts}.${body}`)
      .digest("hex");
    const received = sig?.match(/v1=([a-f0-9]+)/)?.[1] ?? "";
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received.padEnd(expected.length, "0")))) {
      fail(res, 400, "Invalid Stripe signature"); return;
    }
  }

  const event = req.body;
  const type  = event?.type ?? "";
  ok(res, { received: true });

  try {
    let amount = 0, phone = "", reference = "";

    if (type === "payment_intent.succeeded") {
      const pi  = event.data?.object ?? {};
      amount    = Math.round((pi.amount_received ?? pi.amount ?? 0) / 100);
      reference = pi.id ?? "";
      phone     = pi.metadata?.phone ?? pi.metadata?.customer_phone ?? "";
    } else if (type === "checkout.session.completed") {
      const cs  = event.data?.object ?? {};
      amount    = Math.round((cs.amount_total ?? 0) / 100);
      reference = cs.id ?? "";
      phone     = cs.metadata?.phone ?? cs.customer_details?.phone ?? "";
    } else {
      await logRaw("stripe", "ignored", { type });
      return;
    }

    if (!phone || amount <= 0) {
      await logRaw("stripe", "ignored", { type, reason: "no phone in metadata or amount=0", reference });
      return;
    }

    await logRaw("stripe", "received", { type, reference, amount, phone });

    const result = await autoProvision({
      phone,
      amount,
      reference,
      paymentMethod: "stripe",
      gateway:       "stripe",
      adminId:       adminIdFromReq(req),
    });

    await logRaw("stripe", result.ok ? "processed" : "error", { reference, result });
  } catch (err) {
    logger.error({ err }, "[webhook/stripe] Error");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Flutterwave
 *
 * Webhook URL: https://VPS_IP:8080/api/webhooks/flutterwave
 * Set FLW_SECRET_HASH in env for signature verification.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/flutterwave", async (req: Request, res: Response): Promise<void> => {
  const FLW_HASH = process.env.FLW_SECRET_HASH ?? "";

  if (FLW_HASH && req.headers["verif-hash"] !== FLW_HASH) {
    fail(res, 401, "Invalid Flutterwave hash"); return;
  }

  ok(res, { status: "success" });

  try {
    const data   = req.body?.data ?? req.body ?? {};
    const status = String(data.status ?? "").toLowerCase();

    if (status !== "successful" && status !== "success") {
      await logRaw("flutterwave", "ignored", { status, tx_ref: data.tx_ref });
      return;
    }

    const amount    = Number(data.amount ?? 0);
    const reference = String(data.tx_ref ?? data.flw_ref ?? data.id ?? "");
    const phone     = String(data.customer?.phone_number ?? data.customer?.phone ?? data.meta?.phone ?? "");

    if (!phone || amount <= 0) {
      await logRaw("flutterwave", "ignored", { reason: "no phone or amount", reference });
      return;
    }

    await logRaw("flutterwave", "received", { reference, amount, phone });

    const result = await autoProvision({
      phone,
      amount,
      reference,
      paymentMethod: "flutterwave",
      gateway:       "flutterwave",
      adminId:       adminIdFromReq(req),
    });

    await logRaw("flutterwave", result.ok ? "processed" : "error", { reference, result });
  } catch (err) {
    logger.error({ err }, "[webhook/flutterwave] Error");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Generic payment webhook
 *
 * For any custom payment system. POST a JSON body with:
 *   { phone, amount, reference, method? }
 *
 * URL: https://VPS_IP:8080/api/webhooks/generic
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/generic", async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, reference, method } = req.body ?? {};

  if (!phone || !amount) {
    fail(res, 400, "phone and amount are required"); return;
  }

  ok(res, { received: true });

  try {
    await logRaw("generic", "received", { phone, amount, reference });

    const result = await autoProvision({
      phone:         String(phone),
      amount:        Number(amount),
      reference:     String(reference ?? `GEN-${Date.now()}`),
      paymentMethod: String(method ?? "manual"),
      gateway:       "generic",
      adminId:       adminIdFromReq(req),
    });

    await logRaw("generic", result.ok ? "processed" : "error", { reference, result });
    res.json({ ok: result.ok, result });
  } catch (err) {
    logger.error({ err }, "[webhook/generic] Error");
    res.json({ ok: false, error: (err as Error).message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Direct Provision webhook (secret-protected)
 *
 * Directly provisions a customer by their phone/username + plan.
 * Requires header: Authorization: Bearer <WEBHOOK_SECRET>
 *
 * URL: https://VPS_IP:8080/api/webhooks/provision
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/provision", async (req: Request, res: Response): Promise<void> => {
  const auth   = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
  const qsKey  = String(req.query.secret ?? "");
  const secret = auth || qsKey;

  if (!secret || secret !== WEBHOOK_SECRET) {
    fail(res, 401, "Unauthorized — invalid or missing webhook secret"); return;
  }

  const { phone, amount = 0, reference, method = "manual" } = req.body ?? {};
  if (!phone) { fail(res, 400, "phone is required"); return; }

  try {
    const result = await autoProvision({
      phone:         String(phone),
      amount:        Number(amount),
      reference:     String(reference ?? `PROV-${Date.now()}`),
      paymentMethod: String(method),
      gateway:       "direct_provision",
      adminId:       adminIdFromReq(req),
    });

    res.json(result);
  } catch (err) {
    fail(res, 500, (err as Error).message);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Recent webhook events log
 *
 * GET /api/webhooks/events?adminId=X&limit=50
 * ══════════════════════════════════════════════════════════════════════════ */
router.get("/webhooks/events", async (req: Request, res: Response): Promise<void> => {
  const limit   = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
  const gateway = req.query.gateway ? `gateway=eq.${req.query.gateway}&` : "";
  try {
    const events = await sbSelect("isp_webhook_events", `${gateway}select=*&order=created_at.desc&limit=${limit}`);
    res.json({ events, total: events.length });
  } catch (err) {
    res.json({ events: [], total: 0, error: (err as Error).message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. Status / health
 *
 * GET /api/webhooks/status
 * ══════════════════════════════════════════════════════════════════════════ */
router.get("/webhooks/status", (_req: Request, res: Response) => {
  res.json({
    ok:      true,
    secret:  WEBHOOK_SECRET === "changeme_secret" ? "⚠ default — set WEBHOOK_SECRET env var" : "✅ custom secret configured",
    stripe:  process.env.STRIPE_WEBHOOK_SECRET ? "✅ configured" : "⚠ not configured",
    flutterwave: process.env.FLW_SECRET_HASH   ? "✅ configured" : "⚠ not configured",
    endpoints: {
      mpesa_stk:       "POST /api/webhooks/mpesa",
      mpesa_c2b_validation:  "POST /api/webhooks/mpesa/c2b/validation",
      mpesa_c2b_confirmation:"POST /api/webhooks/mpesa/c2b/confirmation",
      stripe:          "POST /api/webhooks/stripe",
      flutterwave:     "POST /api/webhooks/flutterwave",
      generic:         "POST /api/webhooks/generic",
      provision:       "POST /api/webhooks/provision",
    },
  });
});

export default router;
