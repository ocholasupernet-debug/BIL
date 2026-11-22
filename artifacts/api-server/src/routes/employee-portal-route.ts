import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Router, type IRouter, type Request, type Response } from "express";
import { sbInsertStrict, sbRpc, sbSelectStrict, sbUpdateStrict, sbUpsertStrict } from "../lib/supabase-client.js";
import { getMpesaSettings } from "../lib/settings-store.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  isStaffPortalHost,
  isEmployeeAdminHost,
  staffActivationUrl,
} from "../lib/employee-hosts.js";
import { sendPlatformEmail } from "../lib/platform-email.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import {
  employeeAuth,
  isStaffOtpChallengeId,
  isStaffOtpCode,
  normalizeStaffEmail,
  normalizeStaffPhone,
  StaffOtpDeliveryError,
  StaffOtpRateLimitError,
} from "../services/employee-auth.js";
import {
  encryptEmployeePayoutDetails,
  hashEmployeePassword,
  hashEmployeeSecret,
  isMoneyString,
  maskedPayoutLabel,
  newEmployeeToken,
  verifyEmployeePassword,
  employeeSessionCookieName,
  decryptEmployeePayoutDetails,
  normalizePayoutDestination,
} from "../lib/employee-portal-security.js";

const router: IRouter = Router();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const employeeLoginAttempts = new Map<string, { count: number; startedAt: number }>();

type EmployeeProfile = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  auth_version: number;
};

type EmployeeSession = {
  id: string;
  employee_id: string;
  auth_version: number;
};

function employeePortalEnabled(): boolean {
  const configured = process.env.EMPLOYEE_PORTAL_ENABLED;
  if (configured !== undefined) return configured === "true";
  if (process.env.NODE_ENV !== "production") return false;
  try {
    return readFileSync("/var/lib/ocholasupernet/employee-portal.enabled", "utf8") === "enabled\n";
  } catch {
    return false;
  }
}

function enabled(res: Response): boolean {
  if (employeePortalEnabled()) return true;
  res.status(404).json({ ok: false, error: "The Staff portal is not enabled." });
  return false;
}

function requestHost(req: Request): string {
  const raw = req.get("host") || req.hostname || "";
  return raw.toLowerCase().split(":")[0].replace(/\.$/, "");
}

function hasSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === requestHost(req);
  } catch {
    return false;
  }
}

function isSuperAdmin(req: Request): boolean {
  return isActiveSuperAdminToken(String(req.headers["x-sa-token"] ?? ""));
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader("Set-Cookie", [
    `${employeeSessionCookieName}=${token}`,
    "Path=/api/employee",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; "));
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", [
    `${employeeSessionCookieName}=`,
    "Path=/api/employee",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; "));
}

function readCookie(req: Request, name: string): string {
  const header = req.get("cookie") || "";
  for (const entry of header.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function requireEmployee(req: Request, res: Response): Promise<EmployeeProfile | null> {
  const token = readCookie(req, employeeSessionCookieName);
  if (!isStaffPortalHost(requestHost(req)) || !token) {
    res.status(401).json({ ok: false, error: "Staff sign-in is required." });
    return null;
  }
  try {
    const tokenHash = hashEmployeeSecret(token);
    const sessions = await sbSelectStrict<EmployeeSession>(
      "employee_sessions",
      `token_hash=eq.${tokenHash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,employee_id,auth_version&limit=1`,
    );
    const session = sessions[0];
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({ ok: false, error: "Staff session expired. Sign in again." });
      return null;
    }
    const employees = await sbSelectStrict<EmployeeProfile>(
      "employee_profiles",
      `id=eq.${encodeURIComponent(session.employee_id)}&status=eq.active&select=id,username,display_name,email,status,auth_version&limit=1`,
    );
    const employee = employees[0];
    if (!employee || employee.auth_version !== session.auth_version) {
      clearSessionCookie(res);
      res.status(401).json({ ok: false, error: "Staff session is no longer valid." });
      return null;
    }
    return employee;
  } catch {
    res.status(503).json({ ok: false, error: "Staff access could not be verified." });
    return null;
  }
}

function safeRpcObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] && typeof value[0] === "object" ? value[0] : {}) as Record<string, unknown>;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function employeeLoginIsLimited(req: Request, username: string): boolean {
  const now = Date.now();
  for (const [key, value] of employeeLoginAttempts) {
    if (now - value.startedAt >= 15 * 60 * 1000) employeeLoginAttempts.delete(key);
  }
  while (employeeLoginAttempts.size > 10000) {
    const oldest = employeeLoginAttempts.keys().next().value;
    if (typeof oldest !== "string") break;
    employeeLoginAttempts.delete(oldest);
  }
  const fingerprint = createHash("sha256")
    .update(`${req.ip || "unknown"}:${username.toLowerCase()}`)
    .digest("hex");
  const attempt = employeeLoginAttempts.get(fingerprint);
  if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000) {
    employeeLoginAttempts.set(fingerprint, { count: 0, startedAt: now });
    return false;
  }
  return attempt.count >= 5;
}

function recordEmployeeLoginFailure(req: Request, username: string): void {
  const fingerprint = createHash("sha256")
    .update(`${req.ip || "unknown"}:${username.toLowerCase()}`)
    .digest("hex");
  const existing = employeeLoginAttempts.get(fingerprint);
  if (!existing || Date.now() - existing.startedAt >= 15 * 60 * 1000) {
    employeeLoginAttempts.set(fingerprint, { count: 1, startedAt: Date.now() });
    return;
  }
  existing.count += 1;
}

router.get("/employee/status", (req: Request, res: Response): void => {
  res.json({
    ok: true,
    enabled: employeePortalEnabled(),
    portal: isEmployeeAdminHost(requestHost(req)) ? "admin" :
      isStaffPortalHost(requestHost(req)) ? "staff" : "unmatched",
  });
});

function staffRequestAllowed(req: Request, res: Response): boolean {
  if (isStaffPortalHost(requestHost(req))) return true;
  res.status(404).json({ ok: false, error: "Staff access is available from the shared Staff portal." });
  return false;
}

async function validateStaffTurnstile(
  req: Request,
  res: Response,
  action: Parameters<typeof verifyTurnstile>[1],
): Promise<boolean> {
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return false;
  }
  const result = await verifyTurnstile(req, action);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return false;
  }
  return true;
}

router.post("/employee/signup/request-otp", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!staffRequestAllowed(req, res) || !enabled(res)) return;
  if (!await validateStaffTurnstile(req, res, "staff_signup_request")) return;
  const email = normalizeStaffEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  try {
    const result = await employeeAuth.requestSignupOtp(email, req.ip || req.socket.remoteAddress || "");
    res.status(202).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof StaffOtpRateLimitError) {
      res.status(429).json({ ok: false, error: error.message });
      return;
    }
    res.status(503).json({
      ok: false,
      error: error instanceof StaffOtpDeliveryError
        ? error.message
        : "Staff email verification could not be started. Please try again later.",
    });
  }
});

router.post("/employee/signup/verify-otp", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!staffRequestAllowed(req, res) || !enabled(res)) return;
  if (!await validateStaffTurnstile(req, res, "staff_signup_verify")) return;
  const email = normalizeStaffEmail(req.body?.email);
  const challengeId = req.body?.challengeId;
  const code = req.body?.code;
  if (!email || !isStaffOtpChallengeId(challengeId) || !isStaffOtpCode(code)) {
    res.status(400).json({ ok: false, error: "Enter the six-digit code sent to your email." });
    return;
  }
  try {
    const emailVerificationToken = await employeeAuth.verifySignupOtp({ email, challengeId, code });
    if (!emailVerificationToken) {
      res.status(400).json({ ok: false, error: "That verification code is invalid or expired. Request a new code." });
      return;
    }
    res.json({ ok: true, emailVerificationToken, expiresInSeconds: 600 });
  } catch {
    res.status(503).json({ ok: false, error: "Staff email verification is temporarily unavailable." });
  }
});

router.post("/employee/signup", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!staffRequestAllowed(req, res) || !enabled(res)) return;
  if (!await validateStaffTurnstile(req, res, "staff_signup_complete")) return;
  const email = normalizeStaffEmail(req.body?.email);
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const phone = normalizeStaffPhone(req.body?.phone);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmation = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
  const emailVerificationToken = req.body?.emailVerificationToken;
  if (!email || fullName.length < 2 || fullName.length > 120 || /[\u0000-\u001f\u007f]/.test(fullName)) {
    res.status(400).json({ ok: false, error: "Enter your full name and a valid email address." });
    return;
  }
  if (!phone) {
    res.status(400).json({ ok: false, error: "Enter a valid Kenyan mobile number." });
    return;
  }
  if (password.length < 12 || password.length > 256 || password !== confirmation) {
    res.status(400).json({ ok: false, error: "Use a password of at least 12 characters and confirm it exactly." });
    return;
  }
  if (typeof emailVerificationToken !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(emailVerificationToken)) {
    res.status(400).json({ ok: false, error: "Verify your email address before submitting your Staff request." });
    return;
  }
  try {
    await employeeAuth.completeSignup({
      email,
      emailVerificationToken,
      fullName,
      phone,
      passwordHash: await hashEmployeePassword(password),
    });
    res.status(202).json({
      ok: true,
      status: "pending_approval",
      message: "Your request has been received. Staff portal access remains locked until Super Admin approval.",
    });
  } catch {
    res.status(503).json({ ok: false, error: "Your Staff request could not be submitted. Please try again later." });
  }
});

router.get("/employee/admin/signups", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const signups = await sbSelectStrict<Record<string, unknown>>(
      "employee_signup_requests",
      "status=eq.pending_approval&select=id,full_name,phone,email,status,email_verified_at,created_at&order=created_at.asc",
    );
    res.json({ ok: true, signups });
  } catch {
    res.status(503).json({ ok: false, error: "Staff sign-up requests are unavailable. Apply the Staff portal migration first." });
  }
});

router.post("/employee/admin/signups/:id/review", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = String(req.params.id ?? "");
  const decision = req.body?.decision;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(decision)) {
    res.status(400).json({ ok: false, error: "Choose a valid Staff request and approval decision." });
    return;
  }
  try {
    const rows = await sbRpc<{ outcome: string; email: string | null; employee_id: string | null }>(
      "employee_review_signup_request",
      { p_request_id: id, p_decision: decision, p_review_note: note, p_actor_id: "super_admin" },
    );
    const result = Array.isArray(rows) ? rows[0] : undefined;
    if (!result || !["approved", "rejected"].includes(result.outcome)) {
      res.status(409).json({ ok: false, error: "This Staff request is no longer awaiting review." });
      return;
    }
    let notificationSent = false;
    if (result.email) {
      try {
        await sendPlatformEmail({
          fromName: "OcholaSupernet Billing",
          to: result.email,
          subject: result.outcome === "approved" ? "Your ISPlatty Staff account is approved" : "Your ISPlatty Staff request update",
          text: result.outcome === "approved"
            ? "Your Staff account has been approved. You can now sign in at https://staff.isplatty.com/staff/login using your email, password, and the email verification code."
            : "Your Staff account request was not approved. Contact your ISPlatty administrator if you need more information.",
        });
        notificationSent = true;
      } catch { /* Approval/rejection is recorded even if notification delivery is unavailable. */ }
    }
    res.json({
      ok: true,
      request: { id, status: result.outcome, employeeId: result.employee_id },
      notificationSent,
    });
  } catch {
    res.status(503).json({ ok: false, error: "The Staff request could not be reviewed. Please try again." });
  }
});

router.post("/employee/admin/employees", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const {
    employeeNumber, username, displayName, email, phone, monthlySalary,
    destinationType, destinationDetails,
  } = req.body ?? {};
  const normalizedEmail = normalizeStaffEmail(email);
  const internalSubdomain = `staff-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const normalizedDestination = normalizePayoutDestination(destinationType, destinationDetails);
  if (
    typeof employeeNumber !== "string" || !/^[A-Z0-9-]{3,32}$/i.test(employeeNumber.trim()) ||
    typeof username !== "string" || !/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username.trim()) ||
    typeof displayName !== "string" || displayName.trim().length < 2 || displayName.length > 120 ||
    !normalizedEmail || !/^[a-z0-9-]{3,63}$/.test(internalSubdomain) || !isMoneyString(monthlySalary) ||
    !normalizedDestination
  ) {
    res.status(400).json({ ok: false, error: "Complete the Staff member, email, salary, and payout destination fields." });
    return;
  }
  const clearToken = newEmployeeToken();
  try {
    const encrypted = encryptEmployeePayoutDetails(normalizedDestination.details);
    const result = await sbRpc<unknown>("employee_create_invited", {
      p_employee_number: employeeNumber.trim().toUpperCase(),
      p_username: username.trim().toLowerCase(),
      p_display_name: displayName.trim(),
      p_email: normalizedEmail,
      p_phone: typeof phone === "string" ? phone.trim().slice(0, 40) : "",
      p_subdomain: internalSubdomain,
      p_salary: monthlySalary,
      p_destination_type: normalizedDestination.type,
      p_destination_ciphertext: encrypted.ciphertext,
      p_destination_masked_label: maskedPayoutLabel(normalizedDestination.type, normalizedDestination.details),
      p_invitation_hash: createHash("sha256").update(clearToken).digest("hex"),
      p_invitation_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      p_actor_id: "super_admin",
    });
    const created = safeRpcObject(result);
    if (!created.id) throw new Error("Staff record could not be created.");
    res.status(201).json({
      ok: true,
      employee: {
        id: created.id,
        employee_number: created.employee_number,
        username: created.username,
      },
      invitationUrl: staffActivationUrl(clearToken),
      invitationExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/duplicate|unique/i.test(message)) {
      res.status(409).json({ ok: false, error: "Staff ID, username, or email is already in use." });
      return;
    }
    res.status(503).json({ ok: false, error: "The Staff account could not be saved." });
  }
});

router.get("/employee/admin/employees", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const employees = await sbSelectStrict<Record<string, unknown>>(
      "employee_profiles",
      "select=id,employee_number,username,display_name,email,phone,status,fixed_monthly_salary,created_at&order=created_at.desc",
    );
    res.json({ ok: true, employees });
  } catch {
    res.status(503).json({ ok: false, error: "Staff records are unavailable. Apply the Staff portal migration first." });
  }
});

router.patch("/employee/admin/employees/:id/contact", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const employeeId = String(req.params.id ?? "");
  const email = normalizeStaffEmail(req.body?.email);
  const phoneInput = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const phone = phoneInput ? normalizeStaffPhone(phoneInput) : null;
  if (!/^[0-9a-f-]{36}$/i.test(employeeId) || !email || (phoneInput && !phone)) {
    res.status(400).json({ ok: false, error: "Enter a valid Staff email address and phone number." });
    return;
  }
  try {
    const rows = await sbRpc<{ outcome: string; employee_id: string | null; email: string | null; phone: string | null }>(
      "employee_update_staff_contact",
      { p_employee_id: employeeId, p_email: email, p_phone: phone, p_actor_id: "super_admin" },
    );
    const result = rows[0];
    if (result?.outcome === "duplicate") {
      res.status(409).json({ ok: false, error: "That email address is already assigned to another Staff account." });
      return;
    }
    if (!result || result.outcome !== "updated" || !result.employee_id) {
      res.status(404).json({ ok: false, error: "The Staff account could not be updated." });
      return;
    }
    res.json({
      ok: true,
      staff: { id: result.employee_id, email: result.email, phone: result.phone },
      message: "Contact details updated. The Staff member must verify the new email address at next sign-in.",
    });
  } catch {
    res.status(503).json({ ok: false, error: "Staff contact details are unavailable. Apply the Staff portal migration first." });
  }
});

router.post("/employee/activate", async (req: Request, res: Response): Promise<void> => {
  if (!staffRequestAllowed(req, res) || !hasSameOrigin(req)) {
    if (!res.headersSent) res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  if (!enabled(res)) return;
  if (!await validateStaffTurnstile(req, res, "staff_activate")) return;
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (token.length < 32 || password.length < 12 || password.length > 256) {
    res.status(400).json({ ok: false, error: "Use the Staff invitation link and set a password of at least 12 characters." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_activate_invitation", {
      p_invitation_hash: createHash("sha256").update(token).digest("hex"),
      p_password_hash: await hashEmployeePassword(password),
    });
    if (!safeRpcObject(result).ok) throw new Error("Invitation activation was not confirmed.");
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: "This Staff invitation is invalid, expired, or already used." });
  }
});

router.post("/employee/login", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!staffRequestAllowed(req, res)) return;
  if (!await validateStaffTurnstile(req, res, "staff_login")) return;
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const email = normalizeStaffEmail(req.body?.email);
  const identity = email || username;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!identity || !password || identity.length > 254 || !hasSameOrigin(req)) {
    res.status(401).json({ ok: false, error: "The Staff sign-in details could not be verified." });
    return;
  }
  if (employeeLoginIsLimited(req, identity)) {
    res.status(429).json({ ok: false, error: "Too many failed sign-in attempts. Try again later." });
    return;
  }
  try {
    const employees = await sbSelectStrict<EmployeeProfile>(
      "employee_profiles",
      `or=(username.eq.${encodeURIComponent(identity)},email.eq.${encodeURIComponent(identity)})&status=eq.active&select=id,username,display_name,email,status,auth_version&limit=1`,
    );
    const employee = employees[0];
    if (!employee) {
      recordEmployeeLoginFailure(req, identity);
      res.status(401).json({ ok: false, error: "The Staff sign-in details could not be verified." });
      return;
    }
    const credentials = await sbSelectStrict<{ password_hash: string }>(
      "employee_credentials",
      `employee_id=eq.${encodeURIComponent(employee.id)}&select=password_hash&limit=1`,
    );
    if (!credentials[0] || !await verifyEmployeePassword(credentials[0].password_hash, password)) {
      recordEmployeeLoginFailure(req, identity);
      res.status(401).json({ ok: false, error: "The Staff sign-in details could not be verified." });
      return;
    }
    if (!employee.email) {
      recordEmployeeLoginFailure(req, identity);
      res.status(401).json({ ok: false, error: "The Staff sign-in details could not be verified." });
      return;
    }
    const challenge = await employeeAuth.requestLoginOtp({
      employeeId: employee.id,
      email: employee.email,
      ipAddress: req.ip || req.socket.remoteAddress || "",
    });
    res.json({ ok: true, step: "email_otp", challengeId: challenge.challengeId, email: employee.email });
  } catch (error) {
    if (error instanceof StaffOtpRateLimitError) {
      res.status(429).json({ ok: false, error: error.message });
      return;
    }
    res.status(503).json({
      ok: false,
      error: error instanceof StaffOtpDeliveryError
        ? error.message
        : "Staff sign-in is temporarily unavailable.",
    });
  }
});

router.post("/employee/login/verify-otp", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!enabled(res)) return;
  if (!staffRequestAllowed(req, res) || !hasSameOrigin(req)) {
    if (!res.headersSent) res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  if (!await validateStaffTurnstile(req, res, "staff_login_otp")) return;
  const email = normalizeStaffEmail(req.body?.email);
  const challengeId = req.body?.challengeId;
  const code = req.body?.code;
  if (!email || !isStaffOtpChallengeId(challengeId) || !isStaffOtpCode(code)) {
    res.status(400).json({ ok: false, error: "Enter the six-digit sign-in code sent to your email." });
    return;
  }
  try {
    const employeeId = await employeeAuth.verifyLoginOtp({ challengeId, email, code });
    if (!employeeId) {
      res.status(401).json({ ok: false, error: "The Staff sign-in code is invalid or expired." });
      return;
    }
    const employees = await sbSelectStrict<EmployeeProfile>(
      "employee_profiles",
      `id=eq.${encodeURIComponent(employeeId)}&status=eq.active&select=id,username,display_name,email,status,auth_version&limit=1`,
    );
    const employee = employees[0];
    if (!employee) {
      res.status(401).json({ ok: false, error: "The Staff account is no longer active." });
      return;
    }
    const token = newEmployeeToken();
    await sbInsertStrict("employee_sessions", {
      employee_id: employee.id,
      token_hash: hashEmployeeSecret(token),
      auth_version: employee.auth_version,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    employeeLoginAttempts.delete(createHash("sha256").update(`${req.ip || "unknown"}:${email}`).digest("hex"));
    setSessionCookie(res, token);
    res.json({ ok: true, employee: { id: employee.id, username: employee.username, displayName: employee.display_name } });
  } catch {
    res.status(503).json({ ok: false, error: "Staff sign-in is temporarily unavailable." });
  }
});

router.post("/employee/logout", async (req: Request, res: Response): Promise<void> => {
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  const token = readCookie(req, employeeSessionCookieName);
  if (token) {
    try {
      const tokenHash = hashEmployeeSecret(token);
      const sessions = await sbSelectStrict<{ id: string }>(
        "employee_sessions",
        `token_hash=eq.${tokenHash}&revoked_at=is.null&select=id&limit=1`,
      );
      if (sessions[0]) {
        const { sbUpdateStrict } = await import("../lib/supabase-client.js");
        await sbUpdateStrict("employee_sessions", `id=eq.${encodeURIComponent(sessions[0].id)}`, { revoked_at: new Date().toISOString() });
      }
    } catch { /* Cookie is cleared even if revocation storage is unavailable. */ }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/employee/me", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  const employee = await requireEmployee(req, res);
  if (employee) res.json({ ok: true, employee: { id: employee.id, username: employee.username, displayName: employee.display_name } });
});

router.get("/employee/dashboard", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  try {
    const snapshot = await sbRpc<unknown>("employee_dashboard_snapshot", { p_employee_id: employee.id });
    res.json({ ok: true, dashboard: safeRpcObject(snapshot) });
  } catch {
    res.status(503).json({ ok: false, error: "Staff dashboard data is unavailable." });
  }
});

router.get("/employee/destinations", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  try {
    const destinations = await sbSelectStrict<{
      id: string;
      destination_type: string;
      masked_label: string;
      status: string;
      created_at: string;
    }>(
      "employee_payout_destinations",
      `employee_id=eq.${encodeURIComponent(employee.id)}&status=in.(active,pending)&select=id,destination_type,masked_label,status,created_at&order=created_at.desc`,
    );
    res.json({ ok: true, destinations });
  } catch {
    res.status(503).json({ ok: false, error: "Registered payout methods are unavailable." });
  }
});

router.post("/employee/destinations/change-request", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  const normalized = normalizePayoutDestination(req.body?.destinationType, req.body?.destinationDetails);
  if (!normalized) {
    res.status(400).json({ ok: false, error: "Enter valid payout destination details." });
    return;
  }
  try {
    const encrypted = encryptEmployeePayoutDetails(normalized.details);
    const created = await sbInsertStrict<{ id: string; status: string }>("employee_payout_destinations", {
      employee_id: employee.id,
      destination_type: normalized.type,
      encrypted_details: encrypted.ciphertext,
      masked_label: maskedPayoutLabel(normalized.type, normalized.details),
      status: "pending",
      requested_by: employee.id,
    });
    if (!created[0]) throw new Error("Destination change was not recorded.");
    res.status(201).json({ ok: true, destination: { id: created[0].id, status: created[0].status, masked_label: maskedPayoutLabel(normalized.type, normalized.details) } });
  } catch {
    res.status(503).json({ ok: false, error: "Payout destination change could not be submitted." });
  }
});

router.post("/employee/withdrawals", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  const amount = req.body?.amount;
  const destinationId = typeof req.body?.destinationId === "string" ? req.body.destinationId : "";
  const idempotencyKey = String(req.get("idempotency-key") || req.body?.idempotencyKey || "");
  if (!isMoneyString(amount) || !destinationId || !/^[0-9a-f-]{36}$/i.test(destinationId) || !/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey)) {
    res.status(400).json({ ok: false, error: "Enter an exact KES amount, a registered payout method, and a unique request key." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_request_withdrawal", {
      p_employee_id: employee.id,
      p_destination_id: destinationId,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
    });
    res.status(201).json({ ok: true, withdrawal: safeRpcObject(result) });
  } catch {
    res.status(400).json({ ok: false, error: "The withdrawal could not be reserved. Check your eligible balance and enabled payout method." });
  }
});

router.post("/employee/withdrawals/:id/cancel", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ ok: false, error: "Invalid withdrawal request." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_cancel_withdrawal", {
      p_employee_id: employee.id,
      p_withdrawal_id: id,
    });
    res.json({ ok: true, withdrawal: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Only a pending withdrawal request can be cancelled." });
  }
});

router.get("/employee/admin/withdrawals", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const withdrawals = await sbSelectStrict<Record<string, unknown>>(
      "employee_withdrawal_requests",
      "select=id,employee_id,destination_id,amount,status,review_note,reviewed_by,reviewed_at,paid_reference,paid_at,created_at,destination:employee_payout_destinations(destination_type,masked_label)&order=created_at.desc",
    );
    res.json({ ok: true, withdrawals });
  } catch {
    res.status(503).json({ ok: false, error: "Withdrawal requests are unavailable." });
  }
});

router.get("/employee/admin/destinations/pending", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const destinations = await sbSelectStrict<Record<string, unknown>>(
      "employee_payout_destinations",
      "status=eq.pending&select=id,employee_id,destination_type,masked_label,status,requested_by,created_at&order=created_at.asc",
    );
    res.json({ ok: true, destinations });
  } catch {
    res.status(503).json({ ok: false, error: "Payout destination requests are unavailable." });
  }
});

router.post("/employee/admin/destinations/:id/review", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
  const decision = req.body?.decision;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(decision)) {
    res.status(400).json({ ok: false, error: "Invalid payout destination review." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_review_payout_destination", {
      p_destination_id: id,
      p_actor_id: "super_admin",
      p_decision: decision,
    });
    res.json({ ok: true, destination: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "The destination request is no longer awaiting review." });
  }
});

router.get("/employee/admin/summary", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_admin_summary", {});
    const controls = await sbSelectStrict<Record<string, unknown>>(
      "employee_payout_controls",
      "id=eq.global&select=enabled,enabled_destination_types,max_withdrawal,daily_limit&limit=1",
    );
    res.json({ ok: true, summary: safeRpcObject(result), payoutControls: controls[0] ?? null });
  } catch {
    res.status(503).json({ ok: false, error: "Staff administration data is unavailable." });
  }
});

router.get("/employee/admin/compensation", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const items = await sbSelectStrict<Record<string, unknown>>(
      "employee_compensation_items",
      "select=id,employee_id,component_type,amount,period_start,period_end,description,status,approved_by,approved_at,created_by,created_at&order=created_at.desc",
    );
    res.json({ ok: true, items });
  } catch {
    res.status(503).json({ ok: false, error: "Compensation records are unavailable." });
  }
});

router.get("/employee/admin/commission-rules", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const rules = await sbSelectStrict<Record<string, unknown>>(
      "employee_commission_rules",
      "select=id,employee_id,rule_name,rate,amount_per_unit,active,created_by,created_at&order=created_at.desc",
    );
    res.json({ ok: true, rules });
  } catch {
    res.status(503).json({ ok: false, error: "Commission rules are unavailable." });
  }
});

router.post("/employee/admin/commission-rules", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const employeeId = req.body?.employeeId ?? null;
  const name = typeof req.body?.ruleName === "string" ? req.body.ruleName.trim() : "";
  const rate = req.body?.rate;
  const amountPerUnit = req.body?.amountPerUnit ?? null;
  const rateString = typeof rate === "string" ? rate : "";
  const amountString = typeof amountPerUnit === "string" ? amountPerUnit : null;
  if (
    (employeeId !== null && (typeof employeeId !== "string" || !/^[0-9a-f-]{36}$/i.test(employeeId))) ||
    name.length < 2 || name.length > 120 || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(rateString) ||
    (amountString !== null && !isMoneyString(amountString))
  ) {
    res.status(400).json({ ok: false, error: "Commission rule details are invalid." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_create_commission_rule", {
      p_employee_id: employeeId,
      p_rule_name: name,
      p_rate: rateString,
      p_amount_per_unit: amountString,
      p_actor_id: "super_admin",
    });
    res.status(201).json({ ok: true, rule: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Commission rule could not be saved." });
  }
});

router.post("/employee/admin/compensation", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const { employeeId, componentType, amount, periodStart, periodEnd, description, idempotencyKey } = req.body ?? {};
  if (
    typeof employeeId !== "string" || !/^[0-9a-f-]{36}$/i.test(employeeId) ||
    !["commission", "bonus", "allowance", "deduction"].includes(componentType) ||
    !isMoneyString(amount) ||
    typeof periodStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    typeof periodEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
    typeof description !== "string" || description.trim().length < 2 ||
    typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey)
  ) {
    res.status(400).json({ ok: false, error: "Compensation details are invalid." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_create_compensation_item", {
      p_employee_id: employeeId,
      p_component_type: componentType,
      p_amount: amount,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_description: description.slice(0, 500),
      p_idempotency_key: idempotencyKey,
      p_actor_id: "super_admin",
    });
    res.status(201).json({ ok: true, item: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Compensation could not be recorded; the reference may already exist." });
  }
});

router.post("/employee/admin/compensation/:id/review", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
  const decision = req.body?.decision;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(decision)) {
    res.status(400).json({ ok: false, error: "Invalid compensation review." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_review_compensation_item", {
      p_item_id: id, p_actor_id: "super_admin", p_decision: decision,
    });
    res.json({ ok: true, item: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "This compensation item is no longer awaiting review." });
  }
});

router.get("/employee/admin/salary-history", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) {
    res.status(400).json({ ok: false, error: "Select a valid Staff member." });
    return;
  }
  try {
    const history = await sbSelectStrict<Record<string, unknown>>(
      "employee_salary_history",
      `employee_id=eq.${encodeURIComponent(employeeId)}&select=id,monthly_salary,effective_from,effective_to,changed_by,created_at&order=effective_from.desc`,
    );
    res.json({ ok: true, history });
  } catch {
    res.status(503).json({ ok: false, error: "Salary history is unavailable." });
  }
});

router.post("/employee/admin/salary", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const employeeId = req.body?.employeeId;
  const salary = req.body?.monthlySalary;
  const effectiveFrom = req.body?.effectiveFrom;
  if (
    typeof employeeId !== "string" || !/^[0-9a-f-]{36}$/i.test(employeeId) ||
    !isMoneyString(salary) || typeof effectiveFrom !== "string" || !/^\d{4}-\d{2}-01$/.test(effectiveFrom)
  ) {
    res.status(400).json({ ok: false, error: "Enter an exact monthly salary and a first-of-month effective date." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_set_salary", {
      p_employee_id: employeeId, p_monthly_salary: salary, p_effective_from: effectiveFrom, p_actor_id: "super_admin",
    });
    res.json({ ok: true, salary: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Salary history could not be updated." });
  }
});

router.post("/employee/admin/payroll/post", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const periodStart = req.body?.periodStart;
  const periodEnd = req.body?.periodEnd;
  const confirmation = req.body?.confirmation;
  if (
    typeof periodStart !== "string" || !/^\d{4}-\d{2}-01$/.test(periodStart) ||
    typeof periodEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
    confirmation !== `POST ${periodStart.slice(0, 7)}`
  ) {
    res.status(400).json({ ok: false, error: `Type POST ${typeof periodStart === "string" ? periodStart.slice(0, 7) : "YYYY-MM"} to confirm payroll posting.` });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_post_payroll", {
      p_period_start: periodStart, p_period_end: periodEnd, p_actor_id: "super_admin",
    });
    res.json({ ok: true, payroll: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Payroll was not posted. Verify the monthly period and approved compensation items." });
  }
});

router.post("/employee/admin/payroll/preview", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const periodStart = req.body?.periodStart;
  const periodEnd = req.body?.periodEnd;
  if (
    typeof periodStart !== "string" || !/^\d{4}-\d{2}-01$/.test(periodStart) ||
    typeof periodEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
  ) {
    res.status(400).json({ ok: false, error: "Select a complete calendar month to preview." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_payroll_preview", {
      p_period_start: periodStart, p_period_end: periodEnd,
    });
    res.json({ ok: true, preview: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Payroll preview is unavailable for that monthly period." });
  }
});

router.get("/employee/admin/payout-settings", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const [controlRows, secureRows, sharedDaraja] = await Promise.all([
      sbSelectStrict<Record<string, unknown>>(
        "employee_payout_controls",
        "id=eq.global&select=enabled,enabled_destination_types,max_withdrawal,daily_limit,updated_at&limit=1",
      ),
      sbSelectStrict<{ ciphertext: string; iv: string; auth_tag: string }>(
        "employee_payout_settings",
        "id=eq.global&select=ciphertext,iv,auth_tag&limit=1",
      ),
      getMpesaSettings(),
    ]);
    const secret = secureRows[0] ? decryptEmployeePayoutDetails(secureRows[0]) : {};
    res.json({
      ok: true,
      controls: controlRows[0] ?? null,
      credentials: {
        hasSharedDarajaOAuthCredentials: !!(sharedDaraja.consumerKey && sharedDaraja.consumerSecret),
        hasB2cInitiator: typeof secret.b2cInitiator === "string" && !!secret.b2cInitiator,
        hasB2cShortcode: typeof secret.b2cShortcode === "string" && !!secret.b2cShortcode,
        hasB2cSecurityCredential: typeof secret.b2cSecurityCredential === "string" && !!secret.b2cSecurityCredential,
        hasB2pochiConfiguration: typeof secret.b2pochiConfiguration === "string" && !!secret.b2pochiConfiguration,
        hasB2bShortcode: typeof secret.b2bShortcode === "string" && !!secret.b2bShortcode,
        hasB2bInitiator: typeof secret.b2bInitiator === "string" && !!secret.b2bInitiator,
        hasB2bSecurityCredential: typeof secret.b2bSecurityCredential === "string" && !!secret.b2bSecurityCredential,
        liveDisbursementsEnabled: false,
      },
    });
  } catch {
    res.status(503).json({ ok: false, error: "Payout settings are unavailable." });
  }
});

router.put("/employee/admin/payout-settings", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const passcode = process.env.SUPERADMIN_PASSWORD?.trim() || "";
  if (!passcode || typeof req.body?.replacePassword !== "string" || req.body.replacePassword !== passcode) {
    res.status(401).json({ ok: false, error: "Confirm the Super Admin password to change payout settings." });
    return;
  }
  const allowed = ["bank", "mpesa_b2c", "pochi", "paybill", "till"];
  const requestedTypes = Array.isArray(req.body?.enabledDestinationTypes)
    ? [...new Set(req.body.enabledDestinationTypes.filter((value: unknown) => typeof value === "string" && allowed.includes(value)))]
    : [];
  if (
    requestedTypes.length !== (Array.isArray(req.body?.enabledDestinationTypes) ? new Set(req.body.enabledDestinationTypes).size : 0) ||
    !isMoneyString(String(req.body?.maxWithdrawal ?? "")) || !/[1-9]/.test(String(req.body?.maxWithdrawal ?? "")) ||
    !isMoneyString(String(req.body?.dailyLimit ?? "")) || !/[1-9]/.test(String(req.body?.dailyLimit ?? ""))
  ) {
    res.status(400).json({ ok: false, error: "Payout methods or exact KES limits are invalid." });
    return;
  }
  try {
    const existing = await sbSelectStrict<{ ciphertext: string; iv: string; auth_tag: string }>(
      "employee_payout_settings",
      "id=eq.global&select=ciphertext,iv,auth_tag&limit=1",
    );
    const current = existing[0] ? decryptEmployeePayoutDetails(existing[0]) : {};
    const incoming = req.body?.credentials && typeof req.body.credentials === "object" &&
      !Array.isArray(req.body.credentials) ? req.body.credentials as Record<string, unknown> : {};
    const next = { ...current };
    for (const key of [
      "b2cInitiator", "b2cSecurityCredential",
      "b2cShortcode", "b2pochiConfiguration", "b2bShortcode", "b2bInitiator", "b2bSecurityCredential",
    ]) {
      const value = incoming[key];
      if (typeof value === "string" && value.trim() && value !== "**hidden**") {
        if (value.length > 4096) {
          res.status(400).json({ ok: false, error: "Payout credential input is too long." });
          return;
        }
        next[key] = value.trim();
      }
    }
    const encrypted = encryptEmployeePayoutDetails(next);
    await sbUpsertStrict("employee_payout_settings", "id", {
      id: "global",
      ...encrypted,
      updated_by: "super_admin",
      updated_at: new Date().toISOString(),
    });
    const enabledForRequests = req.body?.enabled === true;
    await sbUpdateStrict(
      "employee_payout_controls",
      "id=eq.global",
      {
        enabled: enabledForRequests,
        enabled_destination_types: requestedTypes,
        max_withdrawal: req.body.maxWithdrawal,
        daily_limit: req.body.dailyLimit,
        updated_by: "super_admin",
        updated_at: new Date().toISOString(),
      },
    );
    res.json({
      ok: true,
      enabled: enabledForRequests,
      enabledDestinationTypes: requestedTypes,
      liveDisbursementsEnabled: false,
      storedCredentialCount: Object.values(next).filter(value => typeof value === "string" && value.length > 0).length,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Payout settings could not be securely saved." });
  }
});

router.post("/employee/admin/withdrawals/:id/review", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
  const decision = req.body?.decision;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(decision)) {
    res.status(400).json({ ok: false, error: "Invalid withdrawal review." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_review_withdrawal", {
      p_withdrawal_id: id,
      p_actor_id: "super_admin",
      p_decision: decision,
      p_note: typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null,
    });
    res.json({ ok: true, withdrawal: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "The withdrawal is no longer awaiting review." });
  }
});

router.post("/employee/admin/withdrawals/:id/record-payment", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || reference.length < 3 || reference.length > 128) {
    res.status(400).json({ ok: false, error: "A valid payment reference is required." });
    return;
  }
  try {
    const result = await sbRpc<unknown>("employee_record_confirmed_payout", {
      p_withdrawal_id: id,
      p_actor_id: "super_admin",
      p_payment_reference: reference,
    });
    res.json({ ok: true, withdrawal: safeRpcObject(result) });
  } catch {
    res.status(409).json({ ok: false, error: "Only an approved payout can be recorded as paid." });
  }
});

export default router;
