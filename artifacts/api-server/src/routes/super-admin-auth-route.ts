/**
 * Super admin authentication
 *
 *   POST /api/super-admin/login   — validate credentials, issue token
 *   GET  /api/super-admin/verify  — confirm token is still the active session
 *   POST /api/super-admin/logout  — invalidate the active session token
 *
 * Only ONE active session is allowed at a time.
 * A new login always kicks out any existing session.
 * Tokens expire after SESSION_TTL_MS (3 hours).
 */

import { randomBytes, timingSafeEqual } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD?.trim() ?? "";

const SESSION_TTL_MS = 3 * 60 * 60 * 1000; /* 3 hours */

/* ── In-memory single-session store ─────────────────────────────── */
let activeToken: string | null     = null;
let activeIssuedAt: number         = 0;
const failedLoginAttempts = new Map<string, { count: number; startedAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function tokenExpired(): boolean {
  return Date.now() - activeIssuedAt > SESSION_TTL_MS;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function loginRateLimitKey(req: Request, username: string): string {
  return `${req.ip}:${username.trim().toLowerCase()}`;
}

function loginIsRateLimited(key: string): boolean {
  const attempt = failedLoginAttempts.get(key);
  if (!attempt) return false;
  if (Date.now() - attempt.startedAt >= LOGIN_WINDOW_MS) {
    failedLoginAttempts.delete(key);
    return false;
  }
  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key: string): void {
  const now = Date.now();
  const existing = failedLoginAttempts.get(key);
  if (!existing || now - existing.startedAt >= LOGIN_WINDOW_MS) {
    failedLoginAttempts.set(key, { count: 1, startedAt: now });
    return;
  }
  existing.count += 1;
}

/** Used by protected Super Admin-only settings routes. */
export function isActiveSuperAdminToken(token: string): boolean {
  if (!token || !activeToken || !secretsEqual(token, activeToken)) return false;
  if (tokenExpired()) {
    activeToken = null;
    activeIssuedAt = 0;
    return false;
  }
  return true;
}

/* ── POST /api/super-admin/login ─────────────────────────────────── */
router.post("/super-admin/login", (req: Request, res: Response): void => {
  const { username, api_key, password } = req.body as {
    username?: string; api_key?: string; password?: string;
  };

  if (!username || !api_key || !password) {
    res.status(400).json({ ok: false, error: "All fields are required." });
    return;
  }
  const attemptKey = loginRateLimitKey(req, username);
  if (loginIsRateLimited(attemptKey)) {
    res.status(429).json({ ok: false, error: "Too many failed attempts. Try again later." });
    return;
  }

  const match =
    secretsEqual(username.trim(), SA_USERNAME) &&
    secretsEqual(api_key.trim(), SA_API_KEY) &&
    secretsEqual(password, SA_PASSWORD);

  if (!match) {
    recordFailedLogin(attemptKey);
    logger.warn({ username }, "[super-admin/login] failed login attempt");
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials. Access denied." });
    }, 400);
    return;
  }

  /* Invalidate any previous session and issue a new token */
  const token    = randomBytes(32).toString("base64url");
  const issuedAt = Date.now();

  if (activeToken) {
    logger.warn("[super-admin/login] existing session invalidated by new login");
  }

  activeToken    = token;
  activeIssuedAt = issuedAt;
  failedLoginAttempts.delete(attemptKey);

  logger.info({ username }, "[super-admin/login] successful login — single session enforced");

  res.json({
    ok:       true,
    role:     "superadmin",
    name:     SA_USERNAME,
    token,
    issuedAt,
  });
});

/* ── GET /api/super-admin/verify ─────────────────────────────────── */
router.get("/super-admin/verify", (req: Request, res: Response): void => {
  const token = (req.headers["x-sa-token"] as string | undefined) ?? "";

  if (!token || !activeToken) {
    res.status(401).json({ ok: false, reason: "no_session" });
    return;
  }

  if (!secretsEqual(token, activeToken)) {
    res.status(401).json({ ok: false, reason: "superseded" });
    return;
  }

  if (tokenExpired()) {
    activeToken    = null;
    activeIssuedAt = 0;
    res.status(401).json({ ok: false, reason: "expired" });
    return;
  }

  const remainingMs = SESSION_TTL_MS - (Date.now() - activeIssuedAt);
  res.json({ ok: true, remainingMs });
});

/* ── POST /api/super-admin/logout ────────────────────────────────── */
router.post("/super-admin/logout", (req: Request, res: Response): void => {
  const token = (req.headers["x-sa-token"] as string | undefined) ?? "";

  if (token && activeToken && secretsEqual(token, activeToken)) {
    activeToken    = null;
    activeIssuedAt = 0;
    logger.info("[super-admin/logout] session cleared");
  }

  res.json({ ok: true });
});

export default router;
