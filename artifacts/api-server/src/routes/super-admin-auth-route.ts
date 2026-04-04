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

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? "herina";

const SESSION_TTL_MS = 3 * 60 * 60 * 1000; /* 3 hours */

/* ── In-memory single-session store ─────────────────────────────── */
let activeToken: string | null     = null;
let activeIssuedAt: number         = 0;

function tokenExpired(): boolean {
  return Date.now() - activeIssuedAt > SESSION_TTL_MS;
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

  const match =
    username.trim() === SA_USERNAME &&
    api_key.trim()  === SA_API_KEY  &&
    password        === SA_PASSWORD;

  if (!match) {
    logger.warn({ username }, "[super-admin/login] failed login attempt");
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials. Access denied." });
    }, 400);
    return;
  }

  /* Invalidate any previous session and issue a new token */
  const token    = Buffer.from(`${SA_USERNAME}:${Date.now()}`).toString("base64");
  const issuedAt = Date.now();

  if (activeToken) {
    logger.warn("[super-admin/login] existing session invalidated by new login");
  }

  activeToken    = token;
  activeIssuedAt = issuedAt;

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

  if (token !== activeToken) {
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

  if (token && token === activeToken) {
    activeToken    = null;
    activeIssuedAt = 0;
    logger.info("[super-admin/logout] session cleared");
  }

  res.json({ ok: true });
});

export default router;
