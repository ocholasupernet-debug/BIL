/**
 * Settings management routes
 *
 *   GET  /api/settings/mpesa   — return current M-Pesa config (secrets masked)
 *   POST /api/settings/mpesa   — save M-Pesa config to disk
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
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";

const router: IRouter = Router();

function isSuperAdminRequest(req: Request): boolean {
  return isActiveSuperAdminToken(String(req.headers["x-sa-token"] ?? ""));
}

/* ── GET /api/settings/mpesa ── */
router.get("/settings/mpesa", (_req: Request, res: Response): void => {
  const s = getMpesaSettings();
  res.json({
    ok: true,
    configured: isMpesaConfigured(),
    settings: {
      consumerKey:    s.consumerKey    ? `${s.consumerKey.slice(0, 4)}${"*".repeat(Math.max(0, s.consumerKey.length - 4))}` : "",
      consumerSecret: s.consumerSecret ? "**hidden**" : "",
      shortcode:      s.shortcode,
      passkey:        s.passkey        ? "**hidden**" : "",
      callbackUrl:    s.callbackUrl,
      env:            s.env,
      /* Indicate whether each field is set (so UI can show ✓ / blank) */
      hasConsumerKey:    !!s.consumerKey,
      hasConsumerSecret: !!s.consumerSecret,
      hasPasskey:        !!s.passkey,
    },
  });
});

/* ── GET /api/settings/mpesa/status ── */
router.get("/settings/mpesa/status", (_req: Request, res: Response): void => {
  res.json({ ok: true, configured: isMpesaConfigured() });
});

/* ── POST /api/settings/mpesa ── */
router.post("/settings/mpesa", (req: Request, res: Response): void => {
  const { consumerKey, consumerSecret, shortcode, passkey, callbackUrl, env } =
    req.body as Partial<MpesaSettings>;

  /* Merge with existing — don't overwrite a secret if the UI sends "**hidden**" placeholder */
  const current = getMpesaSettings();

  const next: MpesaSettings = {
    consumerKey:    (consumerKey    && consumerKey    !== "**hidden**") ? consumerKey    : current.consumerKey,
    consumerSecret: (consumerSecret && consumerSecret !== "**hidden**") ? consumerSecret : current.consumerSecret,
    shortcode:      shortcode      ?? current.shortcode,
    passkey:        (passkey        && passkey        !== "**hidden**") ? passkey        : current.passkey,
    callbackUrl:    callbackUrl    ?? current.callbackUrl,
    env:            (env === "production" || env === "sandbox") ? env : current.env,
  };

  saveMpesaSettings(next);
  res.json({ ok: true, configured: !!(next.consumerKey && next.consumerSecret && next.shortcode && next.passkey) });
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
