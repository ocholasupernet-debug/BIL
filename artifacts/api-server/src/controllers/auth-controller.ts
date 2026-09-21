import type { Request, Response } from "express";
import { sbInsertStrict, sbSelectStrict } from "../lib/supabase-client.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { apiTokenSigningConfigured, generateToken } from "../lib/api-auth.js";
import { RESERVED_SUBDOMAINS } from "../lib/tenant-host.js";

export type UnifiedRegistrationRole = "isp_admin" | "reseller";

const SUBDOMAIN_PREFIX_PATTERN = /^[a-z0-9]{2,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function isUniqueViolation(error: unknown): boolean {
  return String(error).includes("HTTP 409");
}

/**
 * The project uses isp_admins as its canonical account table. A unified
 * registration account is still a tenant account, so creating a parallel
 * `users` table would split login, tenant scoping, and reseller ownership.
 */
export async function registerAccount(req: Request, res: Response): Promise<void> {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = req.body?.role as UnifiedRegistrationRole;
  const subdomainPrefix = cleanText(req.body?.subdomain_prefix, 63).toLowerCase();

  if (name.length < 2 || /[\u0000-\u001F\u007F]/.test(name)) {
    res.status(400).json({ ok: false, error: "Enter a valid full name." });
    return;
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (password.length < 10 || password.length > 200) {
    res.status(400).json({ ok: false, error: "Choose a password with at least 10 characters." });
    return;
  }
  if (role !== "isp_admin" && role !== "reseller") {
    res.status(400).json({ ok: false, error: "Choose an account type." });
    return;
  }
  if (!apiTokenSigningConfigured) {
    res.status(503).json({ ok: false, error: "Secure account sessions are not configured." });
    return;
  }
  if (!SUBDOMAIN_PREFIX_PATTERN.test(subdomainPrefix) || RESERVED_SUBDOMAINS.has(subdomainPrefix)) {
    res.status(400).json({ ok: false, error: "Choose a valid alphanumeric subdomain handle." });
    return;
  }

  /*
   * Keep this explicit pre-insert check separate from the database constraint.
   * It gives the browser the stable product error while the constraint remains
   * the final protection against two simultaneous registrations.
   */
  const duplicateRows = await sbSelectStrict<{ id: number }>(
    "isp_admins",
    `subdomain=eq.${encodeURIComponent(subdomainPrefix)}&select=id&limit=1`,
  );
  if (duplicateRows.length > 0) {
    res.status(400).json({ ok: false, error: "This subdomain handle is already reserved." });
    return;
  }

  const passwordHash = await hashIspAdminPassword(password);
  const accountPayload = {
    name: subdomainPrefix,
    company_name: subdomainPrefix,
    fullname: name,
    email,
    username: email,
    password: passwordHash,
    role,
    subdomain: subdomainPrefix,
    parent_id: null,
    earnings_balance: 0,
    is_active: true,
    status: "active",
    must_change_password: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let inserted: Array<{
    id: number;
    name: string;
    username: string;
    fullname: string | null;
    email: string | null;
    role: UnifiedRegistrationRole;
    subdomain: string;
    parent_id: number | null;
    earnings_balance: number;
  }>;
  try {
    inserted = await sbInsertStrict("isp_admins", accountPayload);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ ok: false, error: "This subdomain handle is already reserved." });
      return;
    }
    throw error;
  }

  const account = inserted[0];
  if (!account?.id) {
    throw new Error("The account could not be created.");
  }

  const safeAccount = {
    id: account.id,
    name: account.name,
    username: account.username,
    fullname: account.fullname ?? null,
    email: account.email ?? null,
    role: account.role,
    subdomain: account.subdomain,
    parent_id: account.parent_id ?? null,
    earnings_balance: Number(account.earnings_balance ?? 0),
  };
  const token = generateToken("a", String(account.id));
  res.status(201).json({
    ok: true,
    token,
    admin: safeAccount,
    tenant: {
      id: account.id,
      subdomain: account.subdomain,
      role: account.role,
    },
  });
}