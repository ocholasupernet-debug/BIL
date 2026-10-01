import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect, sbUpdate, sbUpdateStrict } from "../lib/supabase-client.js";
import {
  generateAdminSessionToken,
  generatePasswordSetupToken,
  generatePasswordReauthProof,
  generateToken,
  validateToken,
  validatePasswordReauthProof,
  extractToken,
  lookupAdmin,
  lookupCustomer,
  apiTokenSigningConfigured,
  requireAdmin,
  type ApiTokenPayload,
} from "../lib/api-auth.js";
import { hashIspAdminPassword, verifyIspAdminPassword } from "../lib/passwords.js";
import { getTenantSubdomainFromRequest, RESERVED_SUBDOMAINS } from "../lib/tenant-host.js";
import { registerAccount } from "../controllers/auth-controller.js";
import { logger } from "../lib/logger.js";
import { recordWhatsAppSignInFailure, type WhatsAppLoginAccountType } from "../services/whatsapp/whatsapp-service.js";
import { isPasswordReauthRequired, isSupportedPasswordReauthFeature, recordPlatformAuthAudit } from "../lib/platform-auth-security.js";

const router: IRouter = Router();

const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? "";

function getIspSubdomain(req: Request): string {
  return getTenantSubdomainFromRequest(req) ?? "";
}

function sendInvalidCredentials(res: Response): void {
  setTimeout(() => {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
  }, 400);
}

async function recordFailedAccountSignIn(
  req: Request,
  accountType: WhatsAppLoginAccountType,
  accountId: unknown,
): Promise<void> {
  const id = Number(accountId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  try {
    await recordWhatsAppSignInFailure(
      accountType,
      id,
      req.ip ?? req.socket.remoteAddress,
      req.get("user-agent"),
    );
  } catch (error) {
    logger.warn({ err: error, accountType }, "[auth] suspicious sign-in tracking failed");
  }
}

router.post("/auth/register", registerAccount);

router.post("/auth/admin/reauth", async (req: Request, res: Response): Promise<void> => {
  const payload = validateToken(extractToken(req));
  const feature = typeof req.body?.feature === "string" ? req.body.feature : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!payload || payload.type !== "a" || payload.uid === "superadmin" || payload.impersonationSessionId) {
    res.status(401).json({ ok: false, error: "Sign in to your administrator account before re-checking your password." });
    return;
  }
  if (!isSupportedPasswordReauthFeature(feature)) {
    res.status(400).json({ ok: false, error: "That page does not support password re-checks." });
    return;
  }
  if (!password) {
    res.status(400).json({ ok: false, error: "Enter your current password." });
    return;
  }

  const admins = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&is_active=is.true&select=id,name,username,role,password,auth_version,must_change_password&limit=1`,
  );
  const admin = admins[0];
  if (
    !admin ||
    (admin.role !== "isp_admin" && admin.role !== "reseller")
  ) {
    res.status(401).json({ ok: false, error: "This administrator account is not active." });
    return;
  }
  if (
    Number(payload.authVersion ?? 1) !== Number(admin.auth_version ?? 1) ||
    admin.must_change_password === true
  ) {
    res.status(401).json({ ok: false, error: "Your session is no longer valid. Sign in again to continue." });
    return;
  }
  if (!await verifyIspAdminPassword(admin.password, password)) {
    res.status(401).json({ ok: false, error: "The current password is incorrect." });
    return;
  }

  try {
    if (!await isPasswordReauthRequired(admin.role, feature)) {
      res.status(400).json({ ok: false, error: "This page is not currently set to require a password re-check." });
      return;
    }
    const grantToken = generatePasswordReauthProof(payload.uid, admin.role, feature);
    const grant = validatePasswordReauthProof(grantToken.proof);
    if (!grant) throw new Error("A password re-check grant could not be created.");
    const grants = [
      ...(payload.reauthGrants ?? []).filter(existing =>
        existing.uid === payload.uid && existing.expiresAt > Date.now(),
      ),
      grant,
    ].filter((item, index, all) =>
      all.findIndex(candidate => candidate.feature === item.feature) === index,
    );
    const token = generateAdminSessionToken(
      payload.uid,
      Number(admin.auth_version ?? 1),
      { reauthGrants: grants },
    );
    await recordPlatformAuthAudit({
      actorName: String(admin.username ?? admin.name ?? payload.uid),
      action: "password_recheck_succeeded",
      targetAdminId: Number(payload.uid),
      details: { feature },
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    res.json({ ok: true, token, expiresAt: grant.expiresAt });
  } catch {
    res.status(503).json({ ok: false, error: "The password re-check could not be completed." });
  }
});

router.post("/auth/admin/change-password", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const payload = req.authUser as ApiTokenPayload | undefined;
  if (!payload || payload.uid === "superadmin" || payload.impersonationSessionId) {
    res.status(403).json({ ok: false, error: "Password changes are available only from your own signed-in account." });
    return;
  }
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
  if (!currentPassword || !password || !confirmPassword) {
    res.status(400).json({ ok: false, error: "Enter your current password and confirm the new password." });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ ok: false, error: "The new password and confirmation do not match." });
    return;
  }
  if (password.length < 10 || password.length > 200 || password.toLowerCase() === "admin") {
    res.status(400).json({ ok: false, error: "Choose a new password with at least 10 characters." });
    return;
  }

  const admins = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&is_active=is.true&select=id,name,username,role,password,auth_version&limit=1`,
  );
  const admin = admins[0];
  if (!admin || !await verifyIspAdminPassword(admin.password, currentPassword)) {
    res.status(401).json({ ok: false, error: "The current password is incorrect." });
    return;
  }

  try {
    await recordPlatformAuthAudit({
      actorName: String(admin.username ?? admin.name ?? payload.uid),
      action: "admin_password_change_requested",
      targetAdminId: Number(payload.uid),
      details: { currentPasswordVerified: true },
      sourceIp: req.ip ?? req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    });
    const updated = await sbUpdateStrict(
      "isp_admins",
      `id=eq.${encodeURIComponent(payload.uid)}&password=eq.${encodeURIComponent(String(admin.password ?? ""))}`,
      {
        password: await hashIspAdminPassword(password),
        must_change_password: false,
        auth_version: Number(admin.auth_version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      },
    );
    if (!updated[0]) {
      res.status(409).json({ ok: false, error: "Your password changed in another session. Sign in again." });
      return;
    }
    res.json({
      ok: true,
      token: generateAdminSessionToken(payload.uid, Number(admin.auth_version ?? 1) + 1),
      message: "Your password has been changed.",
    });
  } catch {
    res.status(503).json({ ok: false, error: "Your password could not be changed. Try again." });
  }
});

router.post("/auth/admin/login", async (req: Request, res: Response): Promise<void> => {
  const { username, email, password, api_key, subdomain } = req.body as {
    username?: string; email?: string; password?: string; api_key?: string; subdomain?: string;
  };
  const identity = (typeof username === "string" ? username : email ?? "").trim();

  if (!identity || !password) {
    res.status(400).json({ ok: false, error: "email or username and password are required" });
    return;
  }
  if (!apiTokenSigningConfigured) {
    res.status(503).json({ ok: false, error: "Secure admin sessions are not configured." });
    return;
  }

  if (
    identity === SA_USERNAME &&
    password === SA_PASSWORD &&
    (!api_key || api_key.trim() === SA_API_KEY)
  ) {
    const token = generateToken("a", "superadmin");
    res.json({ ok: true, token, role: "superadmin", name: SA_USERNAME });
    return;
  }

  const hostTenantSubdomain = getIspSubdomain(req);
  const requestedSubdomain = typeof subdomain === "string" ? subdomain.trim().toLowerCase() : "";
  const requestedSubdomainIsValid =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(requestedSubdomain)
    && !RESERVED_SUBDOMAINS.has(requestedSubdomain);
  const tenantSubdomain = hostTenantSubdomain || (requestedSubdomainIsValid ? requestedSubdomain : "");
  if (!hostTenantSubdomain && !tenantSubdomain) {
    res.status(400).json({ ok: false, error: "Enter your company subdomain to sign in from isplatty.org." });
    return;
  }

  const tenantRows = tenantSubdomain
    ? await sbSelect<{ id: number }>(
        "isp_admins",
        `subdomain=eq.${encodeURIComponent(tenantSubdomain)}&is_active=is.true&select=id&limit=1`,
      )
    : [];
  const tenantId = tenantRows[0]?.id;
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `or=(username.eq.${encodeURIComponent(identity)},email.eq.${encodeURIComponent(identity)})&select=id,name,username,password,fullname,email,role,is_active,subdomain,parent_id,company_name,earnings_balance,area,currency,must_change_password,auth_version&limit=100`,
  );
  const admin = tenantId
    ? rows.find((row) => Number(row.id) === tenantId || Number(row.parent_id) === tenantId)
    : rows.find((row) => String(row.subdomain ?? "").toLowerCase() === tenantSubdomain);
  if (!admin || !await verifyIspAdminPassword(admin.password, password) || admin.is_active !== true) {
    if (admin) await recordFailedAccountSignIn(req, "admin", admin.id);
    sendInvalidCredentials(res);
    return;
  }

  const { password: _pw, ...safe } = admin;
  if (admin.must_change_password === true) {
    const setupToken = generatePasswordSetupToken(String(admin.id), Number(admin.auth_version ?? 1));
    res.json({ ok: true, requiresPasswordSetup: true, setupToken, admin: safe });
    return;
  }

    const token = generateAdminSessionToken(String(admin.id), Number(admin.auth_version ?? 1));
  res.json({
    ok: true,
    token,
    admin: safe,
    tenant: {
      id: admin.id,
      subdomain: admin.subdomain ?? tenantSubdomain,
      role: admin.role,
      parentId: admin.parent_id ?? null,
    },
  });
});

router.post("/auth/admin/set-password", async (req: Request, res: Response): Promise<void> => {
  const { password, confirmPassword } = req.body as { password?: string; confirmPassword?: string };
  const token = extractToken(req);
  const payload = validateToken(token);

  if (!payload || payload.type !== "p" || !Number.isSafeInteger(Number(payload.uid))) {
    res.status(401).json({ ok: false, error: "Your password setup session is invalid or has expired. Sign in again to continue." });
    return;
  }
  if (typeof password !== "string" || typeof confirmPassword !== "string" || password !== confirmPassword) {
    res.status(400).json({ ok: false, error: "Enter matching passwords." });
    return;
  }
  if (password.length < 8 || password.toLowerCase() === "admin") {
    res.status(400).json({ ok: false, error: "Choose a new password with at least 8 characters." });
    return;
  }

  const tenantSubdomain = getIspSubdomain(req);
  const subdomainFilter = tenantSubdomain
    ? `&subdomain=eq.${encodeURIComponent(tenantSubdomain)}`
    : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&is_active=is.true&must_change_password=is.true${subdomainFilter}&select=id,name,username,fullname,role,subdomain,area,currency,auth_version&limit=1`,
  );
  const admin = rows[0];
  if (!admin || Number(payload.authVersion ?? 1) !== Number(admin.auth_version ?? 1)) {
    res.status(401).json({ ok: false, error: "Your password setup session is no longer valid. Sign in again to continue." });
    return;
  }

  const updated = await sbUpdate<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&must_change_password=is.true&auth_version=eq.${encodeURIComponent(String(admin.auth_version ?? 1))}`,
    {
      password: await hashIspAdminPassword(password),
      must_change_password: false,
      updated_at: new Date().toISOString(),
    },
  );
  if (!updated[0]) {
    res.status(409).json({ ok: false, error: "This password setup session has already been used. Sign in with your new password." });
    return;
  }

  res.json({ ok: true, token: generateAdminSessionToken(String(admin.id), Number(admin.auth_version ?? 1)), admin });
});

router.post("/auth/customer/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password, adminId } = req.body as {
    username?: string; password?: string; adminId?: string;
  };

  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required" });
    return;
  }
  if (!apiTokenSigningConfigured) {
    res.status(503).json({ ok: false, error: "Secure customer sessions are not configured." });
    return;
  }

  const idFilter = adminId ? `admin_id=eq.${adminId}&` : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `${idFilter}username=eq.${encodeURIComponent(username.trim())}&select=*&limit=1`,
  );
  const customer = rows[0];

  if (!customer || !await verifyIspAdminPassword(
    typeof customer.password === "string" ? customer.password : "",
    password,
  )) {
    if (customer) await recordFailedAccountSignIn(req, "customer", customer.id);
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials" });
    }, 400);
    return;
  }

  if (customer.status === "suspended") {
    res.status(403).json({ ok: false, error: "Account is suspended" });
    return;
  }

  const token = generateToken("c", String(customer.id));
  const { password: _pw, ...safe } = customer;
  res.json({ ok: true, token, customer: safe });
});

router.get("/auth/isValid", (req: Request, res: Response): void => {
  const token = extractToken(req);
  const payload = validateToken(token);

  if (!payload) {
    res.status(401).json({ ok: false, error: "Token is invalid or expired" });
    return;
  }

  const ageSeconds = payload.time === 0 ? 0 : Math.floor(Date.now() / 1000) - payload.time;
  res.json({ ok: true, type: payload.type, uid: payload.uid, ageSeconds });
});

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const token = extractToken(req);
  const payload = validateToken(token);

  if (!payload) {
    res.status(401).json({ ok: false, error: "Token is invalid or expired" });
    return;
  }

  if (payload.type === "a") {
    const admin = await lookupAdmin(payload.uid);
    if (!admin) {
      res.status(401).json({ ok: false, error: "Admin not found" });
      return;
    }
    res.json({ ok: true, type: "admin", user: admin });
    return;
  }

  if (payload.type === "c") {
    const customer = await lookupCustomer(payload.uid);
    if (!customer) {
      res.status(401).json({ ok: false, error: "Customer not found" });
      return;
    }
    res.json({ ok: true, type: "customer", user: customer });
    return;
  }

  res.status(400).json({ ok: false, error: "Unknown token type" });
});

export default router;
