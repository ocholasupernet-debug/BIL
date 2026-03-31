/**
 * Settings management routes
 *
 *   GET  /api/settings/mpesa   — return current M-Pesa config (secrets masked)
 *   POST /api/settings/mpesa   — save M-Pesa config to disk
 *   GET  /api/settings/mpesa/status — returns {configured: boolean}
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getMpesaSettings,
  saveMpesaSettings,
  isMpesaConfigured,
  type MpesaSettings,
} from "../lib/settings-store.js";

const router: IRouter = Router();

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

export default router;
