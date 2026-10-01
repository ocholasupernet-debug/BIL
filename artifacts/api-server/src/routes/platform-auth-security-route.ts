import { Router, type IRouter, type Request, type Response } from "express";
import { extractToken, validateToken } from "../lib/api-auth.js";
import {
  getPlatformAuthPolicy,
  recordPlatformAuthAudit,
  savePlatformAuthPolicy,
  validatePlatformAuthPolicy,
} from "../lib/platform-auth-security.js";
import { ADMIN_PAGE_VISIBILITY_CATALOG } from "../lib/admin-page-visibility.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";

const router: IRouter = Router();

function requireSuperAdmin(req: Request, res: Response): string | null {
  const actor = activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""));
  if (!actor) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return null;
  }
  return actor;
}

router.get("/auth/public-security-policy", async (_req: Request, res: Response): Promise<void> => {
  try {
    const policy = await getPlatformAuthPolicy();
    res.json({
      ok: true,
      otp: {
        allEnabled: policy.otp.allEnabled,
        channels: {
          whatsapp: policy.otp.allEnabled && policy.otp.channels.whatsapp,
          sms: policy.otp.allEnabled && policy.otp.channels.sms,
          // Email has no OTP login flow yet. Do not advertise an inactive control as available.
          email: false,
        },
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "Authentication security settings are unavailable." });
  }
});

router.get("/super-admin/auth-security-policy", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
        res.json({ ok: true, policy: await getPlatformAuthPolicy(), catalog: ADMIN_PAGE_VISIBILITY_CATALOG });
  } catch {
    res.status(503).json({ ok: false, error: "Authentication security settings could not be loaded." });
  }
});

router.put("/super-admin/auth-security-policy", async (req: Request, res: Response): Promise<void> => {
  const actorName = requireSuperAdmin(req, res);
  if (!actorName) return;
  const policy = validatePlatformAuthPolicy(req.body?.policy);
  if (!policy) {
    res.status(400).json({ ok: false, error: "The security policy contains invalid channels, roles, or pages." });
    return;
  }

  try {
    await savePlatformAuthPolicy(policy, actorName);
    await recordPlatformAuthAudit({
      actorName,
      action: "security_policy_updated",
      details: {
        otp: policy.otp,
        enabledReauthRoles: Object.fromEntries(
          Object.entries(policy.passwordReauth).map(([role, pages]) => [
            role,
            Object.entries(pages).filter(([, enabled]) => enabled).map(([key]) => key),
          ]),
        ),
      },
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    res.json({ ok: true, policy });
  } catch {
    res.status(503).json({ ok: false, error: "Security settings could not be saved. Confirm the deployment migration has been applied." });
  }
});

router.get("/auth/admin/password-recheck-policy", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const payload = validateToken(extractToken(req));
  if (!payload || payload.type !== "a" || payload.uid === "superadmin") {
    res.status(401).json({ ok: false, error: "Administrator authentication required." });
    return;
  }
  const feature = typeof req.query.feature === "string" ? req.query.feature : "";
  try {
    const [policy, admins] = await Promise.all([
      getPlatformAuthPolicy(),
      import("../lib/supabase-client.js").then(({ sbSelectStrict }) =>
        sbSelectStrict<{ id: number; role: string | null; is_active: boolean; auth_version: number | null }>(
          "isp_admins",
          `id=eq.${encodeURIComponent(payload.uid)}&select=id,role,is_active,auth_version&is_active=is.true&limit=1`,
        ),
      ),
    ]);
    const admin = admins[0];
    if (
      !admin ||
      (admin.role !== "isp_admin" && admin.role !== "reseller") ||
      Number(payload.authVersion ?? 1) !== Number(admin.auth_version ?? 1)
    ) {
      res.status(401).json({ ok: false, error: "This administrator account is not active." });
      return;
    }
    const required = policy.passwordReauth[admin.role][feature] === true;
    const policies = Object.fromEntries(
      ADMIN_PAGE_VISIBILITY_CATALOG
        .flatMap(section => section.pages)
        .map(page => [
          page.key,
          page.key !== "overview.dashboard" && policy.passwordReauth[admin.role as "isp_admin" | "reseller"][page.key] === true,
        ]),
    );
    res.json({
      ok: true,
      feature,
      required,
      role: admin.role,
      policies,
      otpChannels: {
        whatsapp: policy.otp.allEnabled && policy.otp.channels.whatsapp,
        sms: policy.otp.allEnabled && policy.otp.channels.sms,
        email: false,
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "Authentication security settings could not be checked." });
  }
});

export default router;