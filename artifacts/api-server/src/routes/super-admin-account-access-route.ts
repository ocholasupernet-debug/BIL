import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { generateAdminSessionToken } from "../lib/api-auth.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import {
  endSuperAdminAccessSession,
  getOpenSuperAdminAccessSession,
  insertSuperAdminAccessSession,
  selectPlatformAuthAudit,
} from "../lib/platform-auth-store.js";
import { recordPlatformAuthAudit } from "../lib/platform-auth-security.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";

const router: IRouter = Router();
const SESSION_TTL_MS = 30 * 60 * 1000;

function requireSuperAdmin(req: Request, res: Response): string | null {
  const actorName = activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""));
  if (!actorName) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return null;
  }
  return actorName;
}

router.get("/super-admin/admin-access/admins", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const admins = await sbSelectStrict<Record<string, unknown>>(
      "isp_admins",
      "select=id,name,username,email,phone,is_active,role,subdomain,created_at&order=id.asc&limit=2000",
    );
    res.json({ ok: true, admins });
  } catch {
    res.status(503).json({ ok: false, error: "Administrator accounts could not be loaded." });
  }
});

router.post("/super-admin/admin-access/:id/reset-password", async (req, res): Promise<void> => {
  const actorName = requireSuperAdmin(req, res);
  if (!actorName) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "Choose a valid administrator account." });
    return;
  }
  try {
    const rows = await sbSelectStrict<{
      id: number;
      name: string | null;
      username: string | null;
      auth_version: number | null;
    }>(
      "isp_admins",
      `id=eq.${id}&select=id,name,username,auth_version&limit=1`,
    );
    const admin = rows[0];
    if (!admin) {
      res.status(404).json({ ok: false, error: "That administrator account was not found." });
      return;
    }
    const temporaryPassword = randomBytes(18).toString("base64url");
    const authVersion = Number(admin.auth_version ?? 1) + 1;
    await recordPlatformAuthAudit({
      actorName,
      action: "admin_password_reset_requested",
      targetAdminId: id,
      details: { forcedPasswordChange: true },
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    const updated = await sbUpdateStrict(
      "isp_admins",
      `id=eq.${id}&auth_version=eq.${encodeURIComponent(String(admin.auth_version ?? 1))}`,
      {
      password: await hashIspAdminPassword(temporaryPassword),
      must_change_password: true,
      auth_version: authVersion,
      updated_at: new Date().toISOString(),
      },
    );
    if (!updated[0]) {
      res.status(409).json({ ok: false, error: "The administrator password was not updated." });
      return;
    }
    res.set("Cache-Control", "no-store").json({
      ok: true,
      temporaryPassword,
      mustChangePassword: true,
      admin: { id, name: admin.name, username: admin.username },
    });
  } catch {
    res.status(503).json({ ok: false, error: "The password reset could not be completed." });
  }
});

router.post("/super-admin/admin-access/:id/reset-payment-settings-credentials", async (req, res): Promise<void> => {
  const actorName = requireSuperAdmin(req, res);
  if (!actorName) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "Choose a valid administrator account." });
    return;
  }
  try {
    const admins = await sbSelectStrict<{ id: number; name: string | null; username: string | null }>(
      "isp_admins",
      `id=eq.${id}&select=id,name,username&limit=1`,
    );
    const admin = admins[0];
    if (!admin) {
      res.status(404).json({ ok: false, error: "That administrator account was not found." });
      return;
    }
    const auditTime = new Date().toISOString();
    await sbUpdateStrict(
      "whatsapp_gateway_settings_otps",
      `account_id=eq.${id}&invalidated_at=is.null`,
      { invalidated_at: auditTime },
    );
    await sbUpdateStrict(
      "whatsapp_gateway_settings_grants",
      `account_id=eq.${id}&revoked_at=is.null`,
      { revoked_at: auditTime },
    );
    const updated = await sbUpdateStrict(
      "isp_admins",
      `id=eq.${id}`,
      {
        gateway_settings_otp_phone_e164: null,
        gateway_settings_otp_verified_at: null,
        gateway_settings_password_hash: null,
      },
    );
    if (!updated[0]) {
      res.status(404).json({ ok: false, error: "That administrator account could not be reset." });
      return;
    }
    await recordPlatformAuthAudit({
      actorName,
      action: "payment_settings_credentials_reset",
      targetAdminId: id,
      details: { otpNumberCleared: true, paymentPasswordCleared: true },
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    res.json({
      ok: true,
      admin: { id, name: admin.name, username: admin.username },
      message: "Payment settings verification was reset. The account must set it up again.",
    });
  } catch {
    res.status(503).json({ ok: false, error: "Payment settings verification could not be reset." });
  }
});

router.post("/super-admin/admin-access/:id/start", async (req, res): Promise<void> => {
  const actorName = requireSuperAdmin(req, res);
  if (!actorName) return;
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || reason.length < 8 || reason.length > 500) {
    res.status(400).json({ ok: false, error: "Choose an account and enter a reason of 8 to 500 characters." });
    return;
  }
  try {
    const rows = await sbSelectStrict<{
      id: number;
      name: string | null;
      username: string | null;
      fullname: string | null;
      role: string | null;
      subdomain: string | null;
      is_active: boolean;
      auth_version: number | null;
    }>(
      "isp_admins",
      `id=eq.${id}&select=id,name,username,fullname,role,subdomain,is_active,auth_version&limit=1`,
    );
    const admin = rows[0];
    if (!admin || admin.is_active !== true) {
      res.status(404).json({ ok: false, error: "That active administrator account was not found." });
      return;
    }
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const session = await insertSuperAdminAccessSession({
      targetAdminId: id,
      targetUsername: admin.username ?? "",
      actorName,
      reason,
      expiresAt,
      sourceIp: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    if (!session?.id) throw new Error("The access session was not created.");
    try {
      await recordPlatformAuthAudit({
        actorName,
        action: "superadmin_access_session_started",
        targetAdminId: id,
        impersonationSessionId: session.id,
        details: { reason, expiresAt },
        sourceIp: req.ip ?? req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
      });
    } catch (error) {
      await endSuperAdminAccessSession(session.id, actorName).catch(() => null);
      throw error;
    }
    res.set("Cache-Control", "no-store").json({
      ok: true,
      token: generateAdminSessionToken(String(id), Number(admin.auth_version ?? 1), {
        impersonationSessionId: session.id,
      }),
      sessionId: session.id,
      expiresAt,
      admin: {
        id,
        name: admin.name,
        fullname: admin.fullname,
        username: admin.username,
        role: admin.role,
        subdomain: admin.subdomain,
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "The audited access session could not be started." });
  }
});

router.post("/super-admin/admin-access/:sessionId/end", async (req, res): Promise<void> => {
  const actorName = requireSuperAdmin(req, res);
  if (!actorName) return;
  const sessionId = String(req.params.sessionId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    res.status(400).json({ ok: false, error: "Choose a valid access session." });
    return;
  }
  try {
    const existing = await getOpenSuperAdminAccessSession(sessionId);
    if (!existing) {
      res.status(404).json({ ok: false, error: "That access session has already ended or expired." });
      return;
    }
    await recordPlatformAuthAudit({
      actorName,
      action: "superadmin_access_session_ending",
      targetAdminId: Number(existing.target_admin_id),
      impersonationSessionId: sessionId,
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    const ended = await endSuperAdminAccessSession(sessionId, actorName);
    if (!ended) {
      res.status(404).json({ ok: false, error: "That access session has already ended or expired." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "The access session could not be ended." });
  }
});

router.get("/super-admin/admin-access/audit", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const audit = await selectPlatformAuthAudit();
    res.json({ ok: true, audit });
  } catch {
    res.status(503).json({ ok: false, error: "Authentication audit records could not be loaded." });
  }
});

export default router;