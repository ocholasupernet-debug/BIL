import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import nodemailer from "nodemailer";
import { logger } from "./logger.js";
import {
  sbSelectStrict,
  sbUpsertStrict,
  supabaseConfigured,
  supabaseServiceRoleConfigured,
} from "./supabase-client.js";

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface PlatformEmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  authEnabled: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  securityEmail: string;
}

export interface PublicPlatformEmailSettings extends Omit<PlatformEmailSettings, "password"> {
  hasPassword: boolean;
  configured: boolean;
}

interface EncryptedEmailSettings {
  id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

const EMAIL_SETTINGS_ID = "global_email";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY_SETTINGS: PlatformEmailSettings = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  authEnabled: true,
  username: "",
  password: "",
  fromEmail: "",
  fromName: "OcholaSupernet",
  securityEmail: "",
};

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required to encrypt SMTP credentials.");
  }
  return createHash("sha256")
    .update(`ochola-supernet:platform-email-settings:v1:${sessionSecret}`)
    .digest();
}

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function normalisePlatformEmailSettings(
  input: unknown,
  existingPassword = "",
): PlatformEmailSettings {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const rawPort = typeof body.port === "number" || typeof body.port === "string"
    ? Number(body.port)
    : EMPTY_SETTINGS.port;
  const security: SmtpSecurity = body.security === "tls" || body.security === "none"
    ? body.security
    : "starttls";
  const authEnabled = body.authEnabled !== false;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" && body.password.length > 0
    ? body.password
    : existingPassword;
  const fromEmail = typeof body.fromEmail === "string" ? body.fromEmail.trim().toLowerCase() : "";
  const fromName = typeof body.fromName === "string" ? body.fromName.trim() : "";
  const securityEmail = typeof body.securityEmail === "string"
    ? body.securityEmail.trim().toLowerCase()
    : "";
  const enabled = body.enabled === true;

  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    throw new Error("SMTP port must be a whole number between 1 and 65535.");
  }
  if (host.length > 253 || /[\s/@]/.test(host)) {
    throw new Error("Enter a valid SMTP host name.");
  }
  if (username.length > 254 || password.length > 512) {
    throw new Error("SMTP credentials are too long.");
  }
  if (fromName.length > 120 || /[\r\n]/.test(fromName)) {
    throw new Error("Sender name must be 120 characters or fewer.");
  }
  if (fromEmail && !isValidEmailAddress(fromEmail)) {
    throw new Error("Enter a valid sender email address.");
  }
  if (securityEmail && !isValidEmailAddress(securityEmail)) {
    throw new Error("Enter a valid security alert email address.");
  }
  if (enabled) {
    if (!host || !fromEmail || !securityEmail) {
      throw new Error("Enter the SMTP host, sender email, and security alert email before enabling email.");
    }
    if (authEnabled && (!username || !password)) {
      throw new Error("Enter the SMTP username and password, or turn off SMTP authentication.");
    }
  }

  return {
    enabled,
    host,
    port: rawPort,
    security,
    authEnabled,
    username,
    password,
    fromEmail,
    fromName: fromName || EMPTY_SETTINGS.fromName,
    securityEmail,
  };
}

function encryptSettings(settings: PlatformEmailSettings): Omit<EncryptedEmailSettings, "id"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSettings(record: EncryptedEmailSettings): PlatformEmailSettings {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return normalisePlatformEmailSettings(JSON.parse(plaintext) as unknown);
}

function assertSecureStorageReady(): void {
  if (!supabaseConfigured || !supabaseServiceRoleConfigured) {
    throw new Error("Secure SMTP storage requires Supabase service-role configuration.");
  }
  encryptionKey();
}

export async function getPlatformEmailSettings(): Promise<PlatformEmailSettings> {
  assertSecureStorageReady();
  let rows: EncryptedEmailSettings[];
  try {
    rows = await sbSelectStrict<EncryptedEmailSettings>(
      "platform_secure_settings",
      `id=eq.${EMAIL_SETTINGS_ID}&select=id,ciphertext,iv,auth_tag&limit=1`,
    );
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-email] secure settings read failed",
    );
    throw new Error("Secure email settings are unavailable. Apply the platform email migration.");
  }
  const record = rows[0];
  if (!record) return { ...EMPTY_SETTINGS };
  try {
    return decryptSettings(record);
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-email] secure settings could not be decrypted",
    );
    throw new Error("Saved SMTP settings could not be decrypted. Check the server encryption configuration.");
  }
}

export async function savePlatformEmailSettings(input: unknown): Promise<PlatformEmailSettings> {
  assertSecureStorageReady();
  const current = await getPlatformEmailSettings();
  const settings = normalisePlatformEmailSettings(input, current.password);
  let saved: EncryptedEmailSettings[];
  try {
    saved = await sbUpsertStrict<EncryptedEmailSettings>(
      "platform_secure_settings",
      "id",
      {
        id: EMAIL_SETTINGS_ID,
        ...encryptSettings(settings),
        updated_at: new Date().toISOString(),
      },
    );
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-email] secure settings write failed",
    );
    throw new Error("SMTP settings could not be saved. Confirm the platform email migration is applied.");
  }
  if (!saved[0]) {
    throw new Error("SMTP settings could not be saved. Confirm the platform email migration is applied.");
  }
  return settings;
}

export function publicPlatformEmailSettings(
  settings: PlatformEmailSettings,
): PublicPlatformEmailSettings {
  const { password, ...publicSettings } = settings;
  return {
    ...publicSettings,
    hasPassword: password.length > 0,
    configured: !!(
      settings.host &&
      settings.fromEmail &&
      settings.securityEmail &&
      (!settings.authEnabled || (settings.username && password))
    ),
  };
}

function smtpTransportOptions(settings: PlatformEmailSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    ...(settings.authEnabled
      ? { auth: { user: settings.username, pass: settings.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

async function sendWithSettings(
  settings: PlatformEmailSettings,
  message: { to: string; subject: string; text: string },
): Promise<void> {
  const publicSettings = publicPlatformEmailSettings(settings);
  if (!settings.enabled || !publicSettings.configured) {
    throw new Error("Enable email and complete the SMTP settings before sending.");
  }
  if (!isValidEmailAddress(message.to)) {
    throw new Error("Enter a valid email address for the recipient.");
  }
  const transporter = nodemailer.createTransport(smtpTransportOptions(settings));
  try {
    await transporter.sendMail({
      from: { name: settings.fromName, address: settings.fromEmail },
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-email] SMTP delivery failed",
    );
    throw new Error("SMTP delivery failed. Check the saved server, security, and credential settings.");
  } finally {
    transporter.close();
  }
}

export async function sendPlatformEmail(message: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const settings = await getPlatformEmailSettings();
  await sendWithSettings(settings, message);
}

export async function sendPlatformSecurityNotice(
  event: string,
  details: string,
): Promise<void> {
  try {
    const settings = await getPlatformEmailSettings();
    if (!settings.enabled || !settings.securityEmail) return;
    await sendWithSettings(settings, {
      to: settings.securityEmail,
      subject: `OcholaSupernet security notice: ${event}`,
      text: `${event}\n\n${details}\n\nThis message was generated automatically by OcholaSupernet.`,
    });
  } catch {
    logger.warn(
      { event },
      "[platform-email] security notice could not be sent",
    );
  }
}

export async function sendRegistrationConfirmationEmail(adminId: number): Promise<void> {
  try {
    const admins = await sbSelectStrict<{
      id: number;
      name: string | null;
      fullname: string | null;
      email: string | null;
      username: string | null;
      subdomain: string | null;
      role: string | null;
      must_change_password: boolean | null;
      is_active: boolean;
      status: string | null;
    }>(
      "isp_admins",
      `id=eq.${adminId}&select=id,name,fullname,email,username,subdomain,role,must_change_password,is_active,status&limit=1`,
    );
    const admin = admins[0];
    if (
      !admin ||
      admin.is_active !== true ||
      admin.status !== "active" ||
      !admin.email ||
      !admin.subdomain ||
      !isValidEmailAddress(admin.email)
    ) {
      return;
    }
    const company = admin.fullname?.trim() || admin.name?.trim() || "your company";
    const subdomain = admin.subdomain.trim().toLowerCase();
    const loginUrl = admin.must_change_password
      ? `https://${subdomain}.isplatty.org/admin/login?first_login=1&subdomain=${encodeURIComponent(subdomain)}`
      : `https://${subdomain}.isplatty.org/admin/login`;
    const isReseller = admin.role === "reseller";
    const signInDirection = admin.must_change_password
      ? "Use the temporary sign-in details shown after registration. You will be prompted to set your own password."
      : "Sign in with the password you created during registration.";
    const roleSteps = isReseller
      ? [
          "Confirm your assigned service port and router with your ISP administrator.",
          "Review your collection settings, then create or update the packages you offer.",
        ]
      : [
          "Review your company profile and payment collection settings.",
          "Connect your first router, configure service ports, and add your plans.",
        ];
    await sendPlatformEmail({
      to: admin.email,
      subject: "Welcome to OcholaSupernet — your workspace is ready",
      text: [
        `Congratulations, ${company}!`,
        "",
        `Your ${isReseller ? "reseller" : "ISP"} account is active.`,
        "",
        "Sign in to your dashboard:",
        loginUrl,
        admin.username ? `Username: ${admin.username}` : "",
        "",
        "Next steps:",
        `1. ${signInDirection}`,
        `2. ${roleSteps[0]}`,
        `3. ${roleSteps[1]}`,
        "4. Continue setup from your dashboard and add the customers or services you manage.",
        "",
        "For your security, this email does not contain a password.",
      ].filter(Boolean).join("\n"),
    });
  } catch {
    logger.warn(
      { adminId },
      "[platform-email] registration confirmation could not be sent",
    );
  }
}