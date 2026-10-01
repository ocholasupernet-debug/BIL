import { generatePasswordSetupToken } from "./api-auth.js";
import { sbUpdateStrict } from "./supabase-client.js";

export function isOtpPasswordSetupRequired(admin: Record<string, unknown>): boolean {
  if (admin.must_change_password === true) return true;
  if (!Object.prototype.hasOwnProperty.call(admin, "password")) {
    throw new Error("The administrator password status could not be checked.");
  }
  return typeof admin.password !== "string" || admin.password.trim().length === 0;
}

/**
 * Returns a restricted setup token after a successful OTP login when the
 * administrator has no password yet or is already marked for first-time setup.
 */
export async function getOtpPasswordSetupToken(
  admin: Record<string, unknown>,
): Promise<string | null> {
  const id = Number(admin.id);
  const authVersion = Number(admin.auth_version ?? 1);
  if (
    !Number.isSafeInteger(id) || id <= 0 ||
    !Number.isSafeInteger(authVersion) || authVersion < 1
  ) throw new Error("The administrator account is invalid.");

  if (isOtpPasswordSetupRequired(admin) && admin.must_change_password === true) {
    if (admin.auth_version == null) {
      const initialized = await sbUpdateStrict<{ id: number }>(
        "isp_admins",
        `id=eq.${encodeURIComponent(String(id))}&is_active=is.true&auth_version=is.null&must_change_password=is.true`,
        { auth_version: authVersion, updated_at: new Date().toISOString() },
      );
      if (!initialized[0]) {
        throw new Error("The administrator security status changed. Request a new verification code.");
      }
    }
    return generatePasswordSetupToken(String(id), authVersion);
  }
  const password = admin.password;
  if (!isOtpPasswordSetupRequired(admin)) return null;

  const passwordFilter = password === null || password === undefined
    ? "password=is.null"
    : `password=eq.${encodeURIComponent(String(password))}`;
  const authVersionFilter = admin.auth_version == null
    ? "auth_version=is.null"
    : `auth_version=eq.${encodeURIComponent(String(authVersion))}`;
  const updated = await sbUpdateStrict<{ id: number }>(
    "isp_admins",
    `id=eq.${encodeURIComponent(String(id))}&is_active=is.true&${authVersionFilter}&${passwordFilter}`,
    {
      must_change_password: true,
      auth_version: authVersion,
      updated_at: new Date().toISOString(),
    },
  );
  if (!updated[0]) {
    throw new Error("The administrator password status changed. Request a new verification code.");
  }
  return generatePasswordSetupToken(String(id), authVersion);
}