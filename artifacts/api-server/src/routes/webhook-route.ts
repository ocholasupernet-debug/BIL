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
import { autoProvision }  from "../lib/auto-provision";
import { sbSelect, sbInsert, sbRpc } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { sendRegistrationConfirmationEmail } from "../lib/platform-email.js";
import { provisionTenantCertificateForAdmin } from "../lib/tenant-certificate-provisioner.js";
import { secretMatches, verifyStripeSignature } from "../lib/webhook-auth.js";

const router: IRouter = Router();

/* ── Webhook secret (set WEBHOOK_SECRET env var on the VPS) ─────────────── */
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim() ?? "";

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
    /* Known columns are extracted; everything else goes into the payload
       JSONB column so PostgREST never rejects the insert for unknown keys. */
    const { phone, amount, reference, ...rest } = meta;
    await sbInsert("isp_webhook_events", {
      gateway,
      status,
      phone:      phone !== undefined ? String(phone) : null,
      amount:     amount !== undefined ? Number(amount) : null,
      reference:  reference !== undefined ? String(reference) : null,
      payload:    Object.keys(rest).length ? rest : null,
      created_at: new Date().toISOString(),
    });
  } catch { /* logging must never break webhook processing */ }
}

function normalisePaybillAccount(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

/**
 * Match a C2B PayBill confirmation to a pending ISP registration.
 *
 * The registration account number is the generated company subdomain, so the
 * payment cannot be activated by phone number alone or accidentally credited
 * to another tenant with the same payer.
 */
async function settlePendingPaybillRegistration(
  amount: number,
  billReference: string,
  receipt: string,
): Promise<boolean | null> {
  const account = normalisePaybillAccount(billReference);
  if (!account || !Number.isFinite(amount) || amount <= 0) return null;

  const transactions = await sbSelect<{ id: number; admin_id: number; amount: number | string }>(
    "isp_transactions",
    `payment_method=eq.manual_registration&status=eq.pending&amount=eq.${encodeURIComponent(String(amount))}&select=id,admin_id,amount&order=created_at.asc&limit=100`,
  );
  if (!transactions.length) return null;

  const adminIds = [...new Set(transactions.map(transaction => transaction.admin_id).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!adminIds.length) return null;
  const admins = await sbSelect<{
    id: number;
    subdomain: string | null;
    is_active: boolean;
    status: string;
  }>(
    "isp_admins",
    `id=in.(${adminIds.join(",")})&select=id,subdomain,is_active,status&limit=100`,
  );
  const matchingAdmin = admins.find(admin =>
    admin.is_active === false &&
    admin.status === "pending_payment" &&
    normalisePaybillAccount(admin.subdomain) === account,
  );
  const transaction = matchingAdmin
    ? transactions.find(row => row.admin_id === matchingAdmin.id)
    : undefined;
  if (!transaction) return null;

  const settlements = await sbRpc<{ settled: boolean; admin_id: number | null }>(
    "settle_verified_mpesa_transaction",
    {
      p_transaction_id: transaction.id,
      p_status: "completed",
      p_note: `M-Pesa PayBill registration payment confirmed by C2B receipt ${receipt}.`,
    },
  );
  const settlement = settlements[0];
  if (!settlement?.settled || settlement.admin_id !== transaction.admin_id) {
    logger.warn({ transactionId: transaction.id, receipt }, "[webhook/mpesa/c2b] Registration settlement was not applied");
    return false;
  }

  void sendRegistrationConfirmationEmail(transaction.admin_id);
  void provisionTenantCertificateForAdmin(transaction.admin_id).catch(error => {
    logger.error({ err: error, adminId: transaction.admin_id }, "[registration] PayBill certificate provisioning failed; timer will retry");
  });
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. M-Pesa STK Push callback (Daraja API)
 *
 * Safaricom sends this to your callback URL after initiating an STK push.
 * Configure in Daraja portal: CallBackURL = https://VPS_IP:8080/api/webhooks/mpesa
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/webhooks/mpesa", async (req: Request, res: Response): Promise<void> => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  await logRaw("mpesa_stk", "ignored", {
    reason: "Legacy callback is not payment-verified; use the verified /api/mpesa/callback flow.",
  });
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

    const registrationResult = await settlePendingPaybillRegistration(
      amount,
      String(b.BillRefNumber ?? ""),
      reference,
    );
    if (registrationResult !== null) {
      await logRaw(
        "mpesa_c2b",
        registrationResult ? "processed" : "error",
        { reference, amount, phone: rawPhone, registration: true },
      );
      return;
    }

    await logRaw("mpesa_c2b", "ignored", {
      reference,
      amount,
      phone: rawPhone,
      reason: "Legacy C2B service provisioning is disabled; use a verified package checkout.",
    });
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
  if (!STRIPE_SECRET) {
    fail(res, 503, "Stripe webhook signature verification is not configured");
    return;
  }
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!verifyStripeSignature(rawBody, String(req.headers["stripe-signature"] ?? ""), STRIPE_SECRET)) {
    fail(res, 400, "Invalid or expired Stripe signature");
    return;
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

  if (!FLW_HASH) {
    fail(res, 503, "Flutterwave webhook signature verification is not configured");
    return;
  }
  if (!secretMatches(String(req.headers["verif-hash"] ?? ""), FLW_HASH)) {
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

  if (!WEBHOOK_SECRET) {
    fail(res, 503, "Generic webhook authentication is not configured");
    return;
  }
  const auth = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]?.trim() ?? "";
  if (!secretMatches(auth, WEBHOOK_SECRET)) {
    fail(res, 401, "Unauthorized — invalid or missing webhook secret");
    return;
  }
  if (!phone || !reference || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    fail(res, 400, "phone, a positive amount, and reference are required"); return;
  }

  try {
    await logRaw("generic", "received", { phone, amount, reference });

    const result = await autoProvision({
      phone:         String(phone),
      amount:        Number(amount),
      reference:     String(reference),
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
  const auth   = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]?.trim() ?? "";
  if (!WEBHOOK_SECRET) {
    fail(res, 503, "Direct provisioning authentication is not configured");
    return;
  }
  if (!secretMatches(auth, WEBHOOK_SECRET)) {
    fail(res, 401, "Unauthorized — invalid or missing webhook secret"); return;
  }

  const { phone, amount, reference, method = "manual" } = req.body ?? {};
  if (!phone || !reference || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    fail(res, 400, "phone, a positive amount, and reference are required");
    return;
  }

  try {
    const result = await autoProvision({
      phone:         String(phone),
      amount:        Number(amount),
      reference:     String(reference),
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
    secret:  WEBHOOK_SECRET ? "✅ configured" : "⚠ not configured",
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
