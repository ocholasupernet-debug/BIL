import { Router, type IRouter, type Request, type Response } from "express";
import { hashChatPassword, normalizeChatUsername, verifyChatPassword, createTawkIdentity } from "../lib/hotspot-chat-account.js";
import { isIspHotspotTawkEnabled } from "../lib/isp-hotspot-asset.js";
import { logger } from "../lib/logger.js";
import { sbInsertStrict, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

function rateLimit(req: Request): boolean {
  const key = String(req.ip || req.socket.remoteAddress || "unknown").slice(0, 100);
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_ATTEMPTS) return false;
  current.count += 1;
  return true;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.post("/public/hotspot-chat/auth", async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  if (!rateLimit(req)) {
    res.status(429).json({ ok: false, error: "Too many attempts. Wait a few minutes and try again." });
    return;
  }

  const adminId = positiveId(req.body?.adminId);
  const username = normalizeChatUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const action = req.body?.action;
  if (!adminId || !username || password.length < 8 || password.length > 128
      || !["register", "login"].includes(action)) {
    res.status(400).json({ ok: false, error: "Enter a 3–32 character username and a password of at least 8 characters." });
    return;
  }
  const apiKey = process.env.TAWK_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ ok: false, error: "Chat sign-in is not configured yet. Contact the service administrator." });
    return;
  }

  try {
    if (!await isIspHotspotTawkEnabled(adminId)) {
      res.status(404).json({ ok: false, error: "Chat is not enabled for this service." });
      return;
    }
    type Account = {
      id: number;
      admin_id: number;
      username_key: string;
      username: string;
      password_salt: string;
      password_hash: string;
      tawk_user_id: string;
    };
    const existing = await sbSelectStrict<Account>(
      "isp_hotspot_chat_accounts",
      `admin_id=eq.${adminId}&username_key=eq.${encodeURIComponent(username)}&select=id,admin_id,username_key,username,password_salt,password_hash,tawk_user_id&limit=1`,
    );
    let account: Account | undefined = existing[0];

    if (action === "register") {
      if (account) {
        res.status(409).json({ ok: false, error: "That chat username is already taken. Choose another." });
        return;
      }
      const passwordRecord = hashChatPassword(password);
      const inserted = await sbInsertStrict<Account>("isp_hotspot_chat_accounts", {
        admin_id: adminId,
        username_key: username,
        username: String(req.body.username).trim(),
        password_salt: passwordRecord.salt,
        password_hash: passwordRecord.hash,
      });
      account = inserted[0];
    } else if (!account || !verifyChatPassword(password, account.password_salt, account.password_hash)) {
      res.status(401).json({ ok: false, error: "Username or password is incorrect." });
      return;
    }

    if (!account?.tawk_user_id) {
      res.status(503).json({ ok: false, error: "Chat account could not be linked. Please contact support." });
      return;
    }
    await sbUpdateStrict(
      "isp_hotspot_chat_accounts",
      `id=eq.${account.id}&admin_id=eq.${adminId}`,
      { last_login_at: new Date().toISOString() },
    );
    res.json({
      ok: true,
      username: account.username,
      identity: createTawkIdentity(apiKey, account.tawk_user_id),
    });
  } catch (error) {
    logger.warn({ err: error, adminId }, "[hotspot-chat] account authentication failed");
    res.status(503).json({ ok: false, error: "Chat sign-in is temporarily unavailable. Please try again." });
  }
});

export default router;
