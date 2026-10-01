import { Router, type IRouter, type Request, type Response } from "express";
import { activeSuperAdminName } from "./super-admin-auth-route.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { normalizeSmsPhone } from "../services/sms/sms-service.js";
import { isValidEmailAddress } from "../lib/platform-email.js";
import { sbInsertStrict, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { recordPlatformAuthAudit } from "../lib/platform-auth-security.js";

const router: IRouter = Router();
const RESERVED_SUBDOMAINS = new Set(["www", "api", "vpn", "register", "latex", "proxyvpn", "mail", "admin"]);

function normalizeRole(value: unknown): "isp_admin" | "sub_admin" | null {
  if (value === "admin" || value === "isp_admin") return "isp_admin";
  if (value === "sub_admin") return "sub_admin";
  return null;
}

function normalizeSubdomain(name: string, requested: string): string {
  const requestedSlug = requested.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const nameSlug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const base = requestedSlug || nameSlug;
  if (!base || RESERVED_SUBDOMAINS.has(base)) {
    throw new Error("Enter a company name or a non-reserved subdomain.");
  }
  return base.slice(0, 63).replace(/-+$/g, "");
}

async function uniqueSubdomain(base: string, excludeId?: number): Promise<string> {
  for (let ordinal = 1; ordinal <= 1000; ordinal += 1) {
    const suffix = ordinal === 1 ? "" : `-${ordinal}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const rows = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `subdomain=eq.${encodeURIComponent(candidate)}${excludeId ? `&id=neq.${excludeId}` : ""}&select=id&limit=1`,
    );
    if (!rows[0]) return candidate;
  }
  throw new Error("No unique company subdomain is available.");
}

router.post("/super-admin/admins", async (req: Request, res: Response): Promise<void> => {
  const actorName = activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""));
  if (!actorName) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = normalizeRole(req.body?.role);
  if (!name || name.length > 120 || username.length < 3 || username.length > 64 || !role) {
    res.status(400).json({ ok: false, error: "Enter a name, valid username, and supported role." });
    return;
  }
  if (!/^[A-Za-z0-9._@+-]+$/.test(username)) {
    res.status(400).json({ ok: false, error: "The username contains unsupported characters." });
    return;
  }
  if (email && !isValidEmailAddress(email)) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (password && (password.length < 8 || password.toLowerCase() === "admin")) {
    res.status(400).json({ ok: false, error: "Passwords must contain at least 8 characters and cannot be the default password." });
    return;
  }

  const phoneE164 = phone ? normalizeSmsPhone(phone) : null;
  if (phone && !phoneE164) {
    res.status(400).json({ ok: false, error: "Enter the phone number in international format, for example +254700000000." });
    return;
  }
  if (!password && !phoneE164) {
    res.status(400).json({ ok: false, error: "Add an OTP-capable phone number or set an initial password." });
    return;
  }

  let subdomain: string;
  try {
    subdomain = await uniqueSubdomain(normalizeSubdomain(
      name,
      typeof req.body?.subdomain === "string" ? req.body.subdomain : "",
    ));
    const duplicates = await sbSelectStrict<{ id: number; username: string; email: string | null }>(
      "isp_admins",
      `username=eq.${encodeURIComponent(username)}&select=id,username,email&limit=1`,
    );
    if (duplicates[0]) {
      res.status(409).json({ ok: false, error: "That username is already in use." });
      return;
    }
    if (email) {
      const emailRows = await sbSelectStrict<{ id: number }>(
        "isp_admins",
        `email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      );
      if (emailRows[0]) {
        res.status(409).json({ ok: false, error: "That email address is already in use." });
        return;
      }
    }

    const inserted = await sbInsertStrict<Record<string, unknown>>("isp_admins", {
      name,
      username,
      email: email || null,
      phone: phone || null,
      phone_e164: phoneE164,
      role,
      subdomain,
      password: password ? await hashIspAdminPassword(password) : null,
      must_change_password: !password,
      auth_version: 1,
      is_active: true,
    });
    const admin = inserted[0];
    if (!admin) throw new Error("The administrator account was not returned after creation.");
    const { password: _password, ...safeAdmin } = admin;

    try {
      await recordPlatformAuthAudit({
        actorName,
        action: "admin_account_created",
        targetAdminId: Number(admin.id),
        details: { role, passwordSetupRequired: !password },
        sourceIp: req.ip ?? req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
      });
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "[super-admin] administrator creation audit could not be recorded",
      );
    }
    res.status(201).json({ ok: true, admin: safeAdmin });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Enter a company")) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[super-admin] administrator account creation failed",
    );
    res.status(503).json({ ok: false, error: "The administrator account could not be created. Check that the deployment migration is current." });
  }
});

router.put("/super-admin/admins/:id", async (req: Request, res: Response): Promise<void> => {
  const actorName = activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""));
  if (!actorName) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  const id = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = normalizeRole(req.body?.role);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || name.length > 120 ||
      username.length < 3 || username.length > 64 || !role) {
    res.status(400).json({ ok: false, error: "Enter a name, valid username, and supported role." });
    return;
  }
  if (!/^[A-Za-z0-9._@+-]+$/.test(username)) {
    res.status(400).json({ ok: false, error: "The username contains unsupported characters." });
    return;
  }
  if (email && !isValidEmailAddress(email)) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (password && (password.length < 8 || password.toLowerCase() === "admin")) {
    res.status(400).json({ ok: false, error: "Passwords must contain at least 8 characters and cannot be the default password." });
    return;
  }
  const phoneE164 = phone ? normalizeSmsPhone(phone) : null;
  if (phone && !phoneE164) {
    res.status(400).json({ ok: false, error: "Enter the phone number in international format, for example +254700000000." });
    return;
  }

  try {
    const existingRows = await sbSelectStrict<{
      id: number;
      password: string | null;
      must_change_password: boolean | null;
      auth_version: number | null;
    }>(
      "isp_admins",
      `id=eq.${id}&select=id,password,must_change_password,auth_version&limit=1`,
    );
    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ ok: false, error: "The administrator account no longer exists." });
      return;
    }
    if (!password && (!existing.password || existing.must_change_password === true) && !phoneE164) {
      res.status(400).json({ ok: false, error: "This account still needs a password. Add an OTP-capable phone number or set an initial password." });
      return;
    }

    const currentVersion = Number(existing.auth_version ?? 1);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 1 || currentVersion >= 2_147_483_647) {
      throw new Error("The administrator security version is invalid.");
    }
    const usernameRows = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `username=eq.${encodeURIComponent(username)}&id=neq.${id}&select=id&limit=1`,
    );
    if (usernameRows[0]) {
      res.status(409).json({ ok: false, error: "That username is already in use." });
      return;
    }
    if (email) {
      const emailRows = await sbSelectStrict<{ id: number }>(
        "isp_admins",
        `email=eq.${encodeURIComponent(email)}&id=neq.${id}&select=id&limit=1`,
      );
      if (emailRows[0]) {
        res.status(409).json({ ok: false, error: "That email address is already in use." });
        return;
      }
    }

    const subdomain = await uniqueSubdomain(
      normalizeSubdomain(name, typeof req.body?.subdomain === "string" ? req.body.subdomain : ""),
      id,
    );
    const authVersionFilter = existing.auth_version == null
      ? "auth_version=is.null"
      : `auth_version=eq.${currentVersion}`;
    const patch: Record<string, unknown> = {
      name,
      username,
      email: email || null,
      phone: phone || null,
      phone_e164: phoneE164,
      role,
      subdomain,
      auth_version: currentVersion + 1,
      updated_at: new Date().toISOString(),
    };
    if (password) {
      patch.password = await hashIspAdminPassword(password);
      patch.must_change_password = false;
    }
    const updated = await sbUpdateStrict<Record<string, unknown>>(
      "isp_admins",
      `id=eq.${id}&${authVersionFilter}`,
      patch,
    );
    if (!updated[0]) {
      res.status(409).json({ ok: false, error: "The account changed while it was being edited. Reload and try again." });
      return;
    }
    const { password: _password, ...safeAdmin } = updated[0];
    try {
      await recordPlatformAuthAudit({
        actorName,
        action: "admin_account_updated",
        targetAdminId: id,
        details: { role, passwordUpdated: Boolean(password) },
        sourceIp: req.ip ?? req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
      });
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "[super-admin] administrator update audit could not be recorded",
      );
    }
    res.json({ ok: true, admin: safeAdmin });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Enter a company")) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[super-admin] administrator account update failed",
    );
    res.status(503).json({ ok: false, error: "The administrator account could not be updated." });
  }
});

export default router;