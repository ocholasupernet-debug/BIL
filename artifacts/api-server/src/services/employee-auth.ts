import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sbRpc } from "../lib/supabase-client.js";
import { sendPlatformEmail } from "../lib/platform-email.js";
import { STAFF_PORTAL_HOST } from "../lib/employee-hosts.js";

const OTP_TTL_SECONDS = 5 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcRow = { outcome?: string; employee_id?: string | null };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcRow[]>;
type Mail = (message: Parameters<typeof sendPlatformEmail>[0]) => Promise<void>;

export class StaffOtpRateLimitError extends Error {
  constructor() {
    super("Too many verification code requests. Try again later.");
    this.name = "StaffOtpRateLimitError";
  }
}

export class StaffOtpDeliveryError extends Error {
  constructor() {
    super("Email verification is currently unavailable. Please try again later.");
    this.name = "StaffOtpDeliveryError";
  }
}

export function normalizeStaffEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeStaffPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s()-]/g, "");
  const normalized = compact.startsWith("0") && /^0[17]\d{8}$/.test(compact)
    ? `254${compact.slice(1)}`
    : compact.startsWith("+") ? compact.slice(1) : compact;
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null;
}

export function isStaffOtpChallengeId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isStaffOtpCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("Staff verification signing is not configured.");
  return secret;
}

export function hashStaffOtp(
  purpose: "signup" | "login",
  challengeId: string,
  email: string,
  code: string,
): string {
  return createHmac("sha256", signingSecret())
    .update(`staff-email-otp:v1:${purpose}:${challengeId}:${email}:${code}`)
    .digest("hex");
}

function hashStaffToken(token: string): string {
  return createHmac("sha256", signingSecret())
    .update(`staff-signup-action:v1:${token}`)
    .digest("hex");
}

function hashStaffIp(ipAddress: string): string {
  const ip = ipAddress.trim();
  return ip
    ? createHmac("sha256", signingSecret()).update(`staff-otp-ip:v1:${ip}`).digest("hex")
    : "";
}

function firstOutcome(rows: RpcRow[]): string {
  return rows[0]?.outcome ?? "";
}

export function createEmployeeAuthService(dependencies: {
  rpc?: Rpc;
  sendEmail?: Mail;
  now?: () => number;
  newChallengeId?: () => string;
  newOtpCode?: () => string;
  newActionToken?: () => string;
} = {}) {
  const rpc = dependencies.rpc ?? (async (name, args) =>
    await sbRpc<RpcRow>(name, args));
  const sendEmail = dependencies.sendEmail ?? sendPlatformEmail;
  const now = dependencies.now ?? Date.now;
  const newChallengeId = dependencies.newChallengeId ?? randomUUID;
  const newOtpCode = dependencies.newOtpCode ?? (() => String(randomInt(100_000, 1_000_000)));
  const newActionToken = dependencies.newActionToken ?? (() => randomBytes(32).toString("base64url"));

  async function sendCode(input: {
    purpose: "signup" | "login";
    challengeId: string;
    email: string;
    code: string;
  }): Promise<void> {
    const isSignup = input.purpose === "signup";
    await sendEmail({
      fromName: "OcholaSupernet Billing Security",
      to: input.email,
      subject: isSignup ? "Verify your ISPlatty Staff email" : "Your ISPlatty Staff sign-in code",
      text: [
        isSignup
          ? "Use this six-digit code to verify the email address for your Staff account request:"
          : "Use this six-digit code to finish signing in to your Staff portal:",
        "",
        input.code,
        "",
        "This code expires in five minutes and can only be used once.",
        "Do not share this code. If you did not request it, you can ignore this email.",
      ].join("\n"),
    });
  }

  async function requestSignupOtp(emailInput: unknown, ipAddress: string) {
    const email = normalizeStaffEmail(emailInput);
    if (!email) throw new Error("Enter a valid email address.");
    const challengeId = newChallengeId();
    const code = newOtpCode();
    const [issued] = await rpc("employee_issue_signup_otp", {
      p_id: challengeId,
      p_email: email,
      p_otp_hash: hashStaffOtp("signup", challengeId, email, code),
      p_ip_hash: hashStaffIp(ipAddress),
      p_expires_at: new Date(now() + OTP_TTL_SECONDS * 1000).toISOString(),
    });
    if (issued?.outcome === "limited") throw new StaffOtpRateLimitError();
    if (issued?.outcome !== "issued") throw new Error("Email verification could not be started.");
    try {
      await sendCode({ purpose: "signup", challengeId, email, code });
    } catch {
      try {
        await rpc("employee_invalidate_signup_otp", { p_id: challengeId, p_email: email });
      } catch { /* The challenge expires shortly if invalidation is unavailable. */ }
      throw new StaffOtpDeliveryError();
    }
    return { challengeId, expiresInSeconds: OTP_TTL_SECONDS };
  }

  async function verifySignupOtp(input: { email: unknown; challengeId: unknown; code: unknown }): Promise<string | null> {
    const email = normalizeStaffEmail(input.email);
    if (!email || !isStaffOtpChallengeId(input.challengeId) || !isStaffOtpCode(input.code)) return null;
    const token = newActionToken();
    const [verified] = await rpc("employee_verify_signup_otp", {
      p_id: input.challengeId,
      p_email: email,
      p_otp_hash: hashStaffOtp("signup", input.challengeId, email, input.code),
      p_action_token_hash: hashStaffToken(token),
    });
    return verified?.outcome === "verified" ? token : null;
  }

  async function completeSignup(input: {
    email: unknown;
    emailVerificationToken: unknown;
    fullName: string;
    phone: string;
    passwordHash: string;
  }): Promise<"accepted" | "not_eligible"> {
    const email = normalizeStaffEmail(input.email);
    if (
      !email ||
      typeof input.emailVerificationToken !== "string" ||
      !/^[A-Za-z0-9_-]{40,64}$/.test(input.emailVerificationToken)
    ) return "not_eligible";
    const [result] = await rpc("employee_complete_signup", {
      p_email: email,
      p_action_token_hash: hashStaffToken(input.emailVerificationToken),
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_password_hash: input.passwordHash,
    });
    return result?.outcome === "accepted" ? "accepted" : "not_eligible";
  }

  async function requestLoginOtp(input: { employeeId: string; email: string; ipAddress: string }) {
    const email = normalizeStaffEmail(input.email);
    if (!email || !UUID_PATTERN.test(input.employeeId)) throw new Error("Staff sign-in is unavailable.");
    const challengeId = newChallengeId();
    const code = newOtpCode();
    const [issued] = await rpc("employee_issue_login_otp", {
      p_id: challengeId,
      p_employee_id: input.employeeId,
      p_email: email,
      p_otp_hash: hashStaffOtp("login", challengeId, email, code),
      p_ip_hash: hashStaffIp(input.ipAddress),
      p_expires_at: new Date(now() + OTP_TTL_SECONDS * 1000).toISOString(),
    });
    if (issued?.outcome === "limited") throw new StaffOtpRateLimitError();
    if (issued?.outcome !== "issued") throw new Error("Staff sign-in is unavailable.");
    try {
      await sendCode({ purpose: "login", challengeId, email, code });
    } catch {
      try {
        await rpc("employee_invalidate_login_otp", { p_id: challengeId, p_employee_id: input.employeeId });
      } catch { /* The challenge expires shortly if invalidation is unavailable. */ }
      throw new StaffOtpDeliveryError();
    }
    return { challengeId, expiresInSeconds: OTP_TTL_SECONDS };
  }

  async function verifyLoginOtp(input: { challengeId: unknown; email: unknown; code: unknown }): Promise<string | null> {
    const email = normalizeStaffEmail(input.email);
    if (!email || !isStaffOtpChallengeId(input.challengeId) || !isStaffOtpCode(input.code)) return null;
    const [verified] = await rpc("employee_verify_login_otp", {
      p_id: input.challengeId,
      p_email: email,
      p_otp_hash: hashStaffOtp("login", input.challengeId, email, input.code),
    });
    return verified?.outcome === "verified" && typeof verified.employee_id === "string"
      ? verified.employee_id
      : null;
  }

  return { requestSignupOtp, verifySignupOtp, completeSignup, requestLoginOtp, verifyLoginOtp };
}

export const employeeAuth = createEmployeeAuthService();
