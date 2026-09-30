import { Router, type IRouter, type Request, type Response } from "express";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  getPlatformEmailSettings,
  isValidEmailAddress,
  publicPlatformEmailSettings,
  savePlatformEmailSettings,
  sendPlatformEmail,
} from "../lib/platform-email.js";

const router: IRouter = Router();
const lastTestAtByAddress = new Map<string, number>();
const TEST_EMAIL_COOLDOWN_MS = 30_000;

function isInputError(message: string): boolean {
  return /^(Enter |SMTP port|SMTP credentials|Sender name|Enable email)/.test(message);
}

function requireSuperAdmin(req: Request, res: Response): boolean {
  const token = typeof req.headers["x-sa-token"] === "string"
    ? req.headers["x-sa-token"]
    : "";
  if (isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
  return false;
}

router.get("/super-admin/email-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const settings = await getPlatformEmailSettings();
    res.json({ ok: true, settings: publicPlatformEmailSettings(settings) });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Email settings could not be loaded.",
    });
  }
});

router.put("/super-admin/email-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const settings = await savePlatformEmailSettings(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, settings: publicPlatformEmailSettings(settings) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP settings could not be saved.";
    res.status(isInputError(message) ? 400 : 503).json({ ok: false, error: message });
  }
});

router.post("/super-admin/email-settings/test", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const settings = await getPlatformEmailSettings();
    const recipient = typeof req.body?.to === "string" && req.body.to.trim()
      ? req.body.to.trim()
      : settings.securityEmail;
    if (!isValidEmailAddress(recipient)) {
      res.status(400).json({ ok: false, error: "Enter a valid test recipient email address." });
      return;
    }
    const rateLimitKey = req.ip || "unknown";
    const now = Date.now();
    const lastSentAt = lastTestAtByAddress.get(rateLimitKey) ?? 0;
    if (now - lastSentAt < TEST_EMAIL_COOLDOWN_MS) {
      res.status(429).json({ ok: false, error: "Wait a short time before sending another test email." });
      return;
    }
    lastTestAtByAddress.set(rateLimitKey, now);
    await sendPlatformEmail({
      to: recipient,
      subject: "OcholaSupernet SMTP test",
      text: "This test message confirms that the platform SMTP settings can send email.",
    });
    res.json({ ok: true, message: `Test email sent to ${recipient}.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test email could not be sent.";
    res.status(isInputError(message) ? 400 : 503).json({
      ok: false,
      error: message,
    });
  }
});

export default router;