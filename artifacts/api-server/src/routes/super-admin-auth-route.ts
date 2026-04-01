/**
 * Super admin authentication
 *
 *   POST /api/super-admin/login  — validate username + api_key + password
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* Credentials — override via env vars in production */
const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? "herina";

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
    /* Deliberate slight delay to slow brute-force */
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials. Access denied." });
    }, 400);
    return;
  }

  logger.info({ username }, "[super-admin/login] successful login");
  res.json({
    ok:   true,
    role: "superadmin",
    name: SA_USERNAME,
    /* Issue a simple session token for this dev environment */
    token: Buffer.from(`${SA_USERNAME}:${Date.now()}`).toString("base64"),
  });
});

export default router;
