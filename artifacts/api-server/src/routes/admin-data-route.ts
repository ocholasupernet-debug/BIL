import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();
const RESERVED_SUBDOMAINS = new Set(["www", "api", "vpn", "register", "latex", "proxyvpn", "mail", "admin"]);

function normalizedSubdomain(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

router.get("/auth/company-info", async (req: Request, res: Response): Promise<void> => {
  const subdomain = normalizedSubdomain(req.query.subdomain);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    res.status(400).json({ ok: false, error: "A valid company subdomain is required." });
    return;
  }
  try {
    const rows = await sbSelectStrict<{ id: number; name: string | null; subdomain: string }>(
      "isp_admins",
      `subdomain=eq.${encodeURIComponent(subdomain)}&is_active=is.true&select=id,name,subdomain&limit=1`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, company: rows[0] ?? null });
  } catch {
    res.status(503).json({ ok: false, error: "Company sign-in information is temporarily unavailable." });
  }
});

router.get("/auth/company-availability", async (req: Request, res: Response): Promise<void> => {
  const subdomain = normalizedSubdomain(req.query.subdomain);
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
    || RESERVED_SUBDOMAINS.has(subdomain)
  ) {
    res.status(400).json({ ok: false, available: false, error: "Enter a valid, non-reserved company subdomain." });
    return;
  }
  try {
    const rows = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `subdomain=eq.${encodeURIComponent(subdomain)}&select=id&limit=1`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, available: rows.length === 0 });
  } catch {
    res.status(503).json({ ok: false, available: false, error: "Company availability could not be checked." });
  }
});

router.get("/admin/profile", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const account = await authenticatedAccount(req);
  if (!account) {
    res.status(401).json({ ok: false, error: "An active administrator session is required." });
    return;
  }
  try {
    const rows = await sbSelectStrict<Record<string, unknown>>(
      "isp_admins",
      `id=eq.${account.id}&select=id,name,fullname,email,phone,area,username,subdomain,currency&limit=1`,
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "The administrator profile was not found." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, profile: rows[0] });
  } catch {
    res.status(503).json({ ok: false, error: "The administrator profile could not be loaded." });
  }
});

router.patch("/admin/profile/currency", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const account = await authenticatedAccount(req);
  const currency = typeof req.body?.currency === "string" ? req.body.currency.trim().toUpperCase() : "";
  if (!account) {
    res.status(401).json({ ok: false, error: "An active administrator session is required." });
    return;
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    res.status(400).json({ ok: false, error: "Currency must be a three-letter ISO code." });
    return;
  }
  try {
    const rows = await sbUpdateStrict<Record<string, unknown>>(
      "isp_admins",
      `id=eq.${account.id}`,
      { currency, updated_at: new Date().toISOString() },
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "The administrator profile was not updated." });
      return;
    }
    res.json({ ok: true, currency });
  } catch {
    res.status(503).json({ ok: false, error: "The billing currency could not be saved." });
  }
});

export default router;
