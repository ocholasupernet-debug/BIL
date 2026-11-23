import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Router, type IRouter, type Request, type Response } from "express";
import { sbInsertStrict, sbRpc, sbSelectStrict, sbUpdateStrict, sbUpsertStrict } from "../lib/supabase-client.js";
import { getMpesaSettings } from "../lib/settings-store.js";
import { activeSuperAdminName, isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import { logger } from "../lib/logger.js";
import {
  classifyEmployeeSignupReviewFailure,
  interpretEmployeeSignupReview,
} from "../lib/employee-signup-review.js";
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
  newEmployeeAwardCode,
  normalizeEmployeeAwardCode,
  normalizePayoutDestination,
} from "../lib/employee-portal-security.js";

const router: IRouter = Router();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const employeeLoginAttempts = new Map<string, { count: number; startedAt: number }>();
const EMPLOYEE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EmployeeProfile = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  auth_version: number;
  account_type: "employee" | "technician";
};

type TechnicianGuideRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  brands: string[];
  models: string[];
  firmware_notes: string;
  symptom_tags: string[];
  likely_causes: string[];
  safe_checks: string[];
  escalate_when: string[];
  warnings: string[];
  steps: Array<{ title: string; instruction: string; check?: string; caution?: string }>;
  diagrams: Array<{ kind: string; caption: string; labels: string[] }>;
  image_url: string | null;
  image_caption: string;
  customer_script: string;
  manual_url: string | null;
  status: "draft" | "published" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type TechnicianModelRow = {
  id: string;
  brand: string;
  model: string;
  device_type: string;
  hardware_revisions: string[];
  firmware_variants: string[];
  notes: string;
  warning: string;
  manual_url: string | null;
  image_url: string | null;
  image_caption: string;
  diagram: { kind: string; caption: string; labels: string[] } | null;
  status: "draft" | "published" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

const TECHNICIAN_CATEGORIES = new Set([
  "setup", "ports", "wireless", "recovery", "connectivity", "fiber", "customer-care",
]);
const TECHNICIAN_DIAGRAM_KINDS = new Set([
  "router-ports", "pon-leds", "connection-path", "decision-tree", "wifi-coverage",
]);
const TECHNICIAN_STATUSES = new Set(["draft", "published", "archived"]);

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

function requireCreditAdmin(req: Request, res: Response): boolean {
  if (!enabled(res)) return false;
  if (!isSuperAdmin(req)) {
    logger.warn({ category: "staff_credit_admin_auth_denied" }, "[staff-credits] admin access denied");
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return false;
  }
  if (!hasSameOrigin(req)) {
    logger.warn({ category: "staff_credit_admin_origin_denied" }, "[staff-credits] admin origin denied");
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return false;
  }
  return true;
}

function superAdminActor(req: Request): string {
  return activeSuperAdminName(String(req.headers["x-sa-token"] ?? "")) ?? "super_admin";
}

function cleanFinancialReason(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    : "";
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
      `id=eq.${encodeURIComponent(session.employee_id)}&status=eq.active&select=id,username,display_name,email,status,auth_version,account_type&limit=1`,
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

async function requireTechnician(req: Request, res: Response): Promise<EmployeeProfile | null> {
  const employee = await requireEmployee(req, res);
  if (!employee) return null;
  if (employee.account_type !== "technician") {
    res.status(403).json({ ok: false, error: "Technician Learning Center access is required." });
    return null;
  }
  return employee;
}

function requirePayrollEmployee(employee: EmployeeProfile, res: Response): boolean {
  if (employee.account_type === "employee") return true;
  res.status(403).json({ ok: false, error: "This Staff account cannot access payroll features." });
  return false;
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
  const accountType = req.body?.accountType;
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
  if (accountType !== "employee" && accountType !== "technician") {
    res.status(400).json({ ok: false, error: "Choose an available Staff account type." });
    return;
  }
  try {
    await employeeAuth.completeSignup({
      email,
      emailVerificationToken,
      fullName,
      phone,
      passwordHash: await hashEmployeePassword(password),
      accountType,
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
      "status=eq.pending_approval&select=id,full_name,phone,email,account_type,status,email_verified_at,created_at&order=created_at.asc",
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
    const reviewResult = interpretEmployeeSignupReview(Array.isArray(rows) ? rows[0] : undefined);
    if (reviewResult.kind === "duplicate") {
      res.status(409).json({
        ok: false,
        error: "This request was closed because its email is already assigned to a Staff account. Refresh the request list and check the Staff directory if this seems incorrect.",
      });
      return;
    }
    if (reviewResult.kind === "stale") {
      res.status(409).json({
        ok: false,
        error: "This request is no longer waiting for review. Refresh the request list to see its current status.",
      });
      return;
    }
    if (reviewResult.kind === "unexpected") {
      logger.error({ category: "unexpected_review_result" }, "[staff-signup-review] unexpected database result");
      res.status(503).json({
        ok: false,
        error: "We couldn't confirm the review result. Refresh the request list before trying again.",
      });
      return;
    }
    const result = reviewResult;
    let notificationSent = false;
    if (result.email) {
      try {
        await sendPlatformEmail({
          fromName: "OcholaSupernet Billing",
          to: result.email,
          subject: result.kind === "approved" ? "Your ISPlatty Staff account is approved" : "Your ISPlatty Staff request update",
          text: result.kind === "approved"
            ? "Your Staff account has been approved. You can now sign in at https://staff.isplatty.com/staff/login using your email, password, and the email verification code."
            : "Your Staff account request was not approved. Contact your ISPlatty administrator if you need more information.",
        });
        notificationSent = true;
      } catch { /* Approval/rejection is recorded even if notification delivery is unavailable. */ }
    }
    res.json({
      ok: true,
      request: { id, status: result.kind, employeeId: result.employeeId },
      notificationSent,
    });
  } catch (error) {
    const failure = classifyEmployeeSignupReviewFailure(error);
    logger.error({ category: failure.category }, "[staff-signup-review] database review failed");
    res.status(failure.status).json({ ok: false, error: failure.message });
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
      "select=id,employee_number,username,display_name,email,phone,status,account_type,fixed_monthly_salary,created_at&order=created_at.desc",
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
      `or=(username.eq.${encodeURIComponent(identity)},email.eq.${encodeURIComponent(identity)})&status=eq.active&select=id,username,display_name,email,status,auth_version,account_type&limit=1`,
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
      `id=eq.${encodeURIComponent(employeeId)}&status=eq.active&select=id,username,display_name,email,status,auth_version,account_type&limit=1`,
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
    res.json({ ok: true, employee: { id: employee.id, username: employee.username, displayName: employee.display_name, accountType: employee.account_type } });
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
  if (employee) res.json({ ok: true, employee: { id: employee.id, username: employee.username, displayName: employee.display_name, accountType: employee.account_type } });
});

router.get("/employee/dashboard", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  if (!requirePayrollEmployee(employee, res)) return;
  try {
    const snapshot = await sbRpc<unknown>("employee_dashboard_snapshot", { p_employee_id: employee.id });
    const dashboard = safeRpcObject(snapshot);
    const recentLedger = Array.isArray(dashboard.recent_ledger)
      ? dashboard.recent_ledger as Array<Record<string, unknown>>
      : [];
    const ledgerIds = [...new Set(recentLedger
      .filter((entry) => entry.entry_type === "admin_credit")
      .map((entry) => String(entry.id ?? ""))
      .filter((id) => /^\d+$/.test(id)))];
    if (ledgerIds.length) {
      const filter = `in.(${ledgerIds.join(",")})`;
      const [directCredits, awardCodes] = await Promise.all([
        sbSelectStrict<{ ledger_entry_id: string | number; reason: string }>(
          "employee_admin_credits",
          `employee_id=eq.${encodeURIComponent(employee.id)}&ledger_entry_id=${filter}&select=ledger_entry_id,reason`,
        ),
        sbSelectStrict<{ redemption_ledger_id: string | number; reason: string }>(
          "employee_award_codes",
          `employee_id=eq.${encodeURIComponent(employee.id)}&redemption_ledger_id=${filter}&select=redemption_ledger_id,reason`,
        ),
      ]);
      const descriptions = new Map<string, string>();
      for (const credit of directCredits) descriptions.set(String(credit.ledger_entry_id), credit.reason);
      for (const award of awardCodes) descriptions.set(String(award.redemption_ledger_id), award.reason);
      dashboard.recent_ledger = recentLedger.map((entry) => ({
        ...entry,
        description: descriptions.get(String(entry.id)) ?? null,
      }));
    }
    res.json({ ok: true, dashboard });
  } catch {
    res.status(503).json({ ok: false, error: "Staff dashboard data is unavailable." });
  }
});

router.get("/employee/admin/credits", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    logger.warn({ category: "staff_credit_admin_auth_denied" }, "[staff-credits] admin list access denied");
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  try {
    const [credits, awardCodes] = await Promise.all([
      sbSelectStrict<Record<string, unknown>>(
        "employee_admin_credits",
        "select=id,employee_id,amount,reason,ledger_entry_id,created_by,created_at&order=created_at.desc&limit=100",
      ),
      sbSelectStrict<Record<string, unknown>>(
        "employee_award_codes",
        "select=id,employee_id,amount,reason,expires_at,redeemed_at,revoked_at,created_by,created_at&order=created_at.desc&limit=100",
      ),
    ]);
    res.json({ ok: true, credits, awardCodes });
  } catch {
    res.status(503).json({ ok: false, error: "Staff credits and award-code history are unavailable." });
  }
});

router.post("/employee/admin/credits", async (req: Request, res: Response): Promise<void> => {
  if (!requireCreditAdmin(req, res)) return;
  const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId : "";
  const amount = req.body?.amount;
  const reason = cleanFinancialReason(req.body?.reason);
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : "";
  if (
    !EMPLOYEE_UUID_PATTERN.test(employeeId) ||
    !isMoneyString(amount) || !/[1-9]/.test(amount) ||
    reason.length < 2 || reason.length > 500 ||
    !/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey)
  ) {
    res.status(400).json({ ok: false, error: "Choose an employee and enter a positive exact KES amount, reason, and unique request key." });
    return;
  }
  try {
    const result = safeRpcObject(await sbRpc<unknown>("employee_admin_post_credit", {
      p_employee_id: employeeId,
      p_amount: amount,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
      p_actor_id: superAdminActor(req),
    }));
    if (result.status === "duplicate") {
      res.status(409).json({ ok: false, error: "This credit request was already recorded. Use a new request only for a separate credit." });
      return;
    }
    if (result.status !== "posted") {
      res.status(409).json({ ok: false, error: "The credit could not be confirmed. Refresh the credit history before retrying." });
      return;
    }
    res.status(201).json({ ok: true, credit: result });
  } catch {
    res.status(409).json({ ok: false, error: "The credit could not be posted. Confirm the Staff account is active and refresh before retrying." });
  }
});

router.post("/employee/admin/award-codes", async (req: Request, res: Response): Promise<void> => {
  if (!requireCreditAdmin(req, res)) return;
  const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId : "";
  const amount = req.body?.amount;
  const reason = cleanFinancialReason(req.body?.reason);
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : "";
  const expiresAt = typeof req.body?.expiresAt === "string" ? req.body.expiresAt : "";
  const expiryMs = Date.parse(expiresAt);
  const now = Date.now();
  if (
    !EMPLOYEE_UUID_PATTERN.test(employeeId) ||
    !isMoneyString(amount) || !/[1-9]/.test(amount) ||
    reason.length < 2 || reason.length > 500 ||
    !/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey) ||
    !Number.isFinite(expiryMs) || expiryMs <= now + 60_000 || expiryMs > now + 90 * 24 * 60 * 60 * 1000
  ) {
    res.status(400).json({ ok: false, error: "Choose an employee and enter a positive exact KES amount, reason, valid expiry, and unique request key." });
    return;
  }

  const code = newEmployeeAwardCode();
  try {
    const result = safeRpcObject(await sbRpc<unknown>("employee_issue_award_code", {
      p_employee_id: employeeId,
      p_amount: amount,
      p_reason: reason,
      p_code_hash: hashEmployeeSecret(code),
      p_idempotency_key: idempotencyKey,
      p_expires_at: new Date(expiryMs).toISOString(),
      p_actor_id: superAdminActor(req),
    }));
    if (result.status === "duplicate") {
      res.status(409).json({ ok: false, error: "This award-code request was already processed. Its code cannot be retrieved; issue a new request if needed." });
      return;
    }
    if (result.status !== "issued") {
      res.status(409).json({ ok: false, error: "The award code could not be confirmed. Refresh history before retrying." });
      return;
    }
    res.status(201).json({
      ok: true,
      awardCode: {
        id: result.award_id,
        amount: String(amount),
        expiresAt: result.expires_at,
        code,
      },
    });
  } catch {
    res.status(409).json({ ok: false, error: "The award code could not be issued. Confirm the Staff account is active and refresh before retrying." });
  }
});

router.post("/employee/award-codes/redeem", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!hasSameOrigin(req)) {
    res.status(403).json({ ok: false, error: "Request origin could not be verified." });
    return;
  }
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  if (!requirePayrollEmployee(employee, res)) return;
  const code = normalizeEmployeeAwardCode(req.body?.code);
  if (!code) {
    logger.warn({ category: "staff_award_code_invalid_format" }, "[staff-credits] award redemption rejected");
    res.status(400).json({ ok: false, error: "Enter a valid Staff award code." });
    return;
  }
  try {
    const result = safeRpcObject(await sbRpc<unknown>("employee_redeem_award_code", {
      p_employee_id: employee.id,
      p_code_hash: hashEmployeeSecret(code),
    }));
    if (result.status !== "redeemed") {
      logger.warn({ category: "staff_award_code_redemption_rejected" }, "[staff-credits] award redemption rejected");
      res.status(409).json({ ok: false, error: "This code is invalid, expired, already used, or assigned to another Staff account." });
      return;
    }
    res.json({ ok: true, redemption: result });
  } catch {
    res.status(503).json({ ok: false, error: "Award-code redemption could not be confirmed. Refresh your balance before trying again." });
  }
});

router.get("/employee/destinations", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  const employee = await requireEmployee(req, res);
  if (!employee) return;
  if (!requirePayrollEmployee(employee, res)) return;
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
  if (!requirePayrollEmployee(employee, res)) return;
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
  if (!requirePayrollEmployee(employee, res)) return;
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
  if (!requirePayrollEmployee(employee, res)) return;
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

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values: string[] = [];
  for (const item of value) {
    const normalized = cleanText(item, maxLength);
    if (!normalized) return null;
    if (!values.includes(normalized)) values.push(normalized);
  }
  return values;
}

function cleanManualUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanDiagrams(value: unknown): Array<{ kind: string; caption: string; labels: string[] }> | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const diagrams: Array<{ kind: string; caption: string; labels: string[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const kind = cleanText(record.kind, 40);
    const caption = cleanText(record.caption, 500);
    const labels = cleanStringArray(record.labels, 20, 160);
    if (!kind || !TECHNICIAN_DIAGRAM_KINDS.has(kind) || !caption || !labels) return null;
    diagrams.push({ kind, caption, labels });
  }
  return diagrams;
}

function cleanSteps(value: unknown): TechnicianGuideRow["steps"] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const steps: TechnicianGuideRow["steps"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const title = cleanText(record.title, 160);
    const instruction = cleanText(record.instruction, 3000);
    const check = record.check === undefined ? undefined : cleanText(record.check, 1200);
    const caution = record.caution === undefined ? undefined : cleanText(record.caution, 1200);
    if (!title || !instruction || (record.check !== undefined && !check) || (record.caution !== undefined && !caution)) return null;
    steps.push({ title, instruction, ...(check ? { check } : {}), ...(caution ? { caution } : {}) });
  }
  return steps;
}

function normalizeGuideInput(value: unknown, base?: TechnicianGuideRow): Omit<TechnicianGuideRow, "id" | "created_by" | "updated_by" | "created_at" | "updated_at"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = { ...(base ? guideRowInput(base) : {}), ...(value as Record<string, unknown>) } as Record<string, unknown>;
  const slug = cleanText(input.slug, 120);
  const title = cleanText(input.title, 180);
  const summary = cleanText(input.summary, 1000);
  const category = cleanText(input.category, 40);
  const brands = cleanStringArray(input.brands, 30, 100);
  const models = cleanStringArray(input.models, 60, 160);
  const firmwareNotes = cleanText(input.firmwareNotes ?? input.firmware_notes, 2000);
  const symptomTags = cleanStringArray(input.symptomTags ?? input.symptom_tags, 40, 100);
  const likelyCauses = cleanStringArray(input.likelyCauses ?? input.likely_causes, 30, 500);
  const safeChecks = cleanStringArray(input.safeChecks ?? input.safe_checks, 40, 1200);
  const escalateWhen = cleanStringArray(input.escalateWhen ?? input.escalate_when, 30, 1200);
  const warnings = cleanStringArray(input.warnings, 30, 1200);
  const steps = cleanSteps(input.steps);
  const diagrams = cleanDiagrams(input.diagrams);
  const customerScript = cleanText(input.customerScript ?? input.customer_script, 4000);
  const manualUrl = cleanManualUrl(input.manualUrl ?? input.manual_url);
  const imageUrl = cleanManualUrl(input.imageUrl ?? input.image_url);
  const imageCaption = typeof (input.imageCaption ?? input.image_caption) === "string"
    ? String(input.imageCaption ?? input.image_caption).trim().slice(0, 500)
    : "";
  const status = cleanText(input.status, 20);
  if (
    !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !title || !summary || !category || !TECHNICIAN_CATEGORIES.has(category) ||
    !brands || !models || !firmwareNotes || !symptomTags || !likelyCauses ||
    !safeChecks || !escalateWhen || !warnings || !steps || !diagrams ||
    !customerScript || manualUrl === undefined || imageUrl === undefined ||
    typeof (input.imageCaption ?? input.image_caption) !== "string" ||
    String(input.imageCaption ?? input.image_caption).length > 500 ||
    !status || !TECHNICIAN_STATUSES.has(status)
  ) return null;
  return {
    slug, title, summary, category, brands, models,
    firmware_notes: firmwareNotes,
    symptom_tags: symptomTags,
    likely_causes: likelyCauses,
    safe_checks: safeChecks,
    escalate_when: escalateWhen,
    warnings, steps, diagrams,
    customer_script: customerScript,
    manual_url: manualUrl,
    image_url: imageUrl,
    image_caption: imageCaption,
    status: status as TechnicianGuideRow["status"],
  };
}

function guideRowInput(row: TechnicianGuideRow): Record<string, unknown> {
  return {
    slug: row.slug, title: row.title, summary: row.summary, category: row.category,
    brands: row.brands, models: row.models, firmwareNotes: row.firmware_notes,
    symptomTags: row.symptom_tags, likelyCauses: row.likely_causes, safeChecks: row.safe_checks,
    escalateWhen: row.escalate_when, warnings: row.warnings, steps: row.steps, diagrams: row.diagrams,
    customerScript: row.customer_script, manualUrl: row.manual_url,
    imageUrl: row.image_url, imageCaption: row.image_caption, status: row.status,
  };
}

function guideForClient(row: TechnicianGuideRow) {
  return {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary, category: row.category,
    brands: row.brands, models: row.models, firmwareNotes: row.firmware_notes,
    symptomTags: row.symptom_tags, likelyCauses: row.likely_causes, safeChecks: row.safe_checks,
    escalateWhen: row.escalate_when, warnings: row.warnings, steps: row.steps, diagrams: row.diagrams,
    customerScript: row.customer_script, manualUrl: row.manual_url,
    imageUrl: row.image_url, imageCaption: row.image_caption, status: row.status, updatedAt: row.updated_at,
  };
}

function normalizeModelInput(value: unknown, base?: TechnicianModelRow): Omit<TechnicianModelRow, "id" | "created_by" | "updated_by" | "created_at" | "updated_at"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = { ...(base ? modelRowInput(base) : {}), ...(value as Record<string, unknown>) } as Record<string, unknown>;
  const brand = cleanText(input.brand, 100);
  const model = cleanText(input.model, 160);
  const deviceType = cleanText(input.deviceType ?? input.device_type, 120);
  const hardwareRevisions = cleanStringArray(input.hardwareRevisions ?? input.hardware_revisions, 30, 120);
  const firmwareVariants = cleanStringArray(input.firmwareVariants ?? input.firmware_variants, 30, 120);
  const notes = cleanText(input.notes, 2000);
  const warning = cleanText(input.warning, 2000);
  const manualUrl = cleanManualUrl(input.manualUrl ?? input.manual_url);
  const imageUrl = cleanManualUrl(input.imageUrl ?? input.image_url);
  const imageCaption = typeof (input.imageCaption ?? input.image_caption) === "string"
    ? String(input.imageCaption ?? input.image_caption).trim().slice(0, 500)
    : "";
  const diagram = input.diagram === null || input.diagram === undefined
    ? null
    : cleanDiagrams([input.diagram])?.[0] ?? undefined;
  const status = cleanText(input.status, 20);
  if (
    !brand || !model || !deviceType || !hardwareRevisions || !firmwareVariants ||
    !notes || !warning || manualUrl === undefined || imageUrl === undefined || diagram === undefined ||
    typeof (input.imageCaption ?? input.image_caption) !== "string" ||
    String(input.imageCaption ?? input.image_caption).length > 500 ||
    !status || !TECHNICIAN_STATUSES.has(status)
  ) return null;
  return {
    brand, model, device_type: deviceType, hardware_revisions: hardwareRevisions,
    firmware_variants: firmwareVariants, notes, warning, manual_url: manualUrl,
    image_url: imageUrl, image_caption: imageCaption, diagram, status: status as TechnicianModelRow["status"],
  };
}

function modelRowInput(row: TechnicianModelRow): Record<string, unknown> {
  return {
    brand: row.brand, model: row.model, deviceType: row.device_type,
    hardwareRevisions: row.hardware_revisions, firmwareVariants: row.firmware_variants,
    notes: row.notes, warning: row.warning, manualUrl: row.manual_url,
    imageUrl: row.image_url, imageCaption: row.image_caption, diagram: row.diagram, status: row.status,
  };
}

function modelForClient(row: TechnicianModelRow) {
  return {
    id: row.id, brand: row.brand, model: row.model, deviceType: row.device_type,
    hardwareRevisions: row.hardware_revisions, firmwareVariants: row.firmware_variants,
    notes: row.notes, warning: row.warning, manualUrl: row.manual_url,
    imageUrl: row.image_url, imageCaption: row.image_caption, diagram: row.diagram,
    status: row.status, updatedAt: row.updated_at,
  };
}

function filterLearningGuides(rows: TechnicianGuideRow[], req: Request): TechnicianGuideRow[] {
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
  const brand = typeof req.query.brand === "string" ? req.query.brand.trim().toLowerCase().slice(0, 100) : "";
  const model = typeof req.query.model === "string" ? req.query.model.trim().toLowerCase().slice(0, 160) : "";
  const category = typeof req.query.category === "string" ? req.query.category : "";
  return rows.filter((row) => {
    const searchText = [
      row.slug, row.title, row.summary, row.category, row.firmware_notes, row.customer_script,
      ...row.brands, ...row.models, ...row.symptom_tags, ...row.likely_causes,
      ...row.safe_checks, ...row.warnings,
    ].join(" ").toLowerCase();
    return (!query || searchText.includes(query)) &&
      (!brand || row.brands.some((item) => item.toLowerCase() === brand || item.toLowerCase() === "all")) &&
      (!model || row.models.some((item) =>
        item.toLowerCase() === "all models" ||
        item.toLowerCase() === model ||
        model.includes(item.toLowerCase()),
      )) &&
      (!category || row.category === category);
  });
}

router.get("/employee/learning/guides", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!await requireTechnician(req, res)) return;
  try {
    const rows = await sbSelectStrict<TechnicianGuideRow>(
      "technician_learning_guides",
      "status=eq.published&select=*&order=updated_at.desc&limit=500",
    );
    res.json({ ok: true, guides: filterLearningGuides(rows, req).map(guideForClient) });
  } catch {
    res.status(503).json({ ok: false, error: "Published Technician Learning Center guides are unavailable." });
  }
});

router.get("/employee/learning/guides/:slug", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!await requireTechnician(req, res)) return;
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    res.status(400).json({ ok: false, error: "Choose a valid guide." });
    return;
  }
  try {
    const rows = await sbSelectStrict<TechnicianGuideRow>(
      "technician_learning_guides",
      `slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`,
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "This guide is not published or no longer exists." });
      return;
    }
    res.json({ ok: true, guide: guideForClient(rows[0]) });
  } catch {
    res.status(503).json({ ok: false, error: "This Technician guide is unavailable." });
  }
});

router.get("/employee/learning/models", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!await requireTechnician(req, res)) return;
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
  try {
    const rows = await sbSelectStrict<TechnicianModelRow>(
      "technician_device_models",
      "status=eq.published&select=*&order=brand.asc,model.asc&limit=500",
    );
    const models = rows
      .filter((row) => !query || `${row.brand} ${row.model} ${row.device_type} ${row.hardware_revisions.join(" ")} ${row.firmware_variants.join(" ")}`.toLowerCase().includes(query))
      .map(modelForClient);
    res.json({ ok: true, models });
  } catch {
    res.status(503).json({ ok: false, error: "Published device models are unavailable." });
  }
});

router.get("/employee/admin/learning/guides", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  if (status !== "all" && !TECHNICIAN_STATUSES.has(status)) {
    res.status(400).json({ ok: false, error: "Choose a valid guide status." });
    return;
  }
  try {
    const query = status === "all" ? "select=*&order=updated_at.desc&limit=500"
      : `status=eq.${status}&select=*&order=updated_at.desc&limit=500`;
    const rows = await sbSelectStrict<TechnicianGuideRow>("technician_learning_guides", query);
    res.json({ ok: true, guides: rows.map(guideForClient) });
  } catch {
    res.status(503).json({ ok: false, error: "Technician guide management is unavailable." });
  }
});

router.post("/employee/admin/learning/guides", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const guide = normalizeGuideInput(req.body);
  if (!guide) {
    res.status(400).json({ ok: false, error: "Complete the guide fields using valid text, model tags, steps, and diagram labels." });
    return;
  }
  try {
    const rows = await sbInsertStrict<TechnicianGuideRow>("technician_learning_guides", {
      ...guide, created_by: "super_admin", updated_by: "super_admin",
    });
    if (!rows[0]) throw new Error("Guide was not saved.");
    res.status(201).json({ ok: true, guide: guideForClient(rows[0]) });
  } catch {
    res.status(409).json({ ok: false, error: "The guide could not be saved. Check for a duplicate slug and retry." });
  }
});

router.patch("/employee/admin/learning/guides/:id", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ ok: false, error: "Choose a valid guide." });
    return;
  }
  try {
    const existing = await sbSelectStrict<TechnicianGuideRow>(
      "technician_learning_guides",
      `id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    );
    if (!existing[0]) {
      res.status(404).json({ ok: false, error: "This guide no longer exists." });
      return;
    }
    const guide = normalizeGuideInput(req.body, existing[0]);
    if (!guide) {
      res.status(400).json({ ok: false, error: "The guide update contains invalid or oversized fields." });
      return;
    }
    const rows = await sbUpdateStrict<TechnicianGuideRow>(
      "technician_learning_guides",
      `id=eq.${encodeURIComponent(id)}`,
      { ...guide, updated_by: "super_admin", updated_at: new Date().toISOString() },
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "This guide no longer exists." });
      return;
    }
    res.json({ ok: true, guide: guideForClient(rows[0]) });
  } catch {
    res.status(409).json({ ok: false, error: "The guide could not be updated." });
  }
});

router.get("/employee/admin/learning/models", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  if (status !== "all" && !TECHNICIAN_STATUSES.has(status)) {
    res.status(400).json({ ok: false, error: "Choose a valid device status." });
    return;
  }
  try {
    const query = status === "all" ? "select=*&order=brand.asc,model.asc&limit=500"
      : `status=eq.${status}&select=*&order=brand.asc,model.asc&limit=500`;
    const rows = await sbSelectStrict<TechnicianModelRow>("technician_device_models", query);
    res.json({ ok: true, models: rows.map(modelForClient) });
  } catch {
    res.status(503).json({ ok: false, error: "Device model management is unavailable." });
  }
});

router.post("/employee/admin/learning/models", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const model = normalizeModelInput(req.body);
  if (!model) {
    res.status(400).json({ ok: false, error: "Complete the model fields using valid names, revision details, warning, and diagram." });
    return;
  }
  try {
    const rows = await sbInsertStrict<TechnicianModelRow>("technician_device_models", {
      ...model, created_by: "super_admin", updated_by: "super_admin",
    });
    if (!rows[0]) throw new Error("Device model was not saved.");
    res.status(201).json({ ok: true, model: modelForClient(rows[0]) });
  } catch {
    res.status(409).json({ ok: false, error: "The device model could not be saved. Check for an existing brand/model pair." });
  }
});

router.patch("/employee/admin/learning/models/:id", async (req: Request, res: Response): Promise<void> => {
  if (!enabled(res)) return;
  if (!isSuperAdmin(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ ok: false, error: "Choose a valid device model." });
    return;
  }
  try {
    const existing = await sbSelectStrict<TechnicianModelRow>(
      "technician_device_models",
      `id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    );
    if (!existing[0]) {
      res.status(404).json({ ok: false, error: "This device model no longer exists." });
      return;
    }
    const model = normalizeModelInput(req.body, existing[0]);
    if (!model) {
      res.status(400).json({ ok: false, error: "The device model update contains invalid or oversized fields." });
      return;
    }
    const rows = await sbUpdateStrict<TechnicianModelRow>(
      "technician_device_models",
      `id=eq.${encodeURIComponent(id)}`,
      { ...model, updated_by: "super_admin", updated_at: new Date().toISOString() },
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "This device model no longer exists." });
      return;
    }
    res.json({ ok: true, model: modelForClient(rows[0]) });
  } catch {
    res.status(409).json({ ok: false, error: "The device model could not be updated." });
  }
});

export default router;
