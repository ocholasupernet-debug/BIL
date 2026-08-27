import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect, sbUpdate } from "../lib/supabase-client.js";
import {
  generateToken,
  validateToken,
  extractToken,
  lookupAdmin,
  lookupCustomer,
  apiTokenSigningConfigured,
  type ApiTokenPayload,
} from "../lib/api-auth.js";
import { hashIspAdminPassword, verifyIspAdminPassword } from "../lib/passwords.js";

const router: IRouter = Router();

const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? "";

function getIspSubdomain(req: Request): string {
  const hostname = req.hostname.toLowerCase().replace(/\.$/, "");
  const match = hostname.match(/^([a-z0-9-]+)\.isplatty\.org$/);
  const subdomain = match?.[1] ?? "";
  return subdomain && subdomain !== "www" && subdomain !== "api" ? subdomain : "";
}

function sendInvalidCredentials(res: Response): void {
  setTimeout(() => {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
  }, 400);
}

router.post("/auth/admin/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password, api_key } = req.body as {
    username?: string; password?: string; api_key?: string;
  };

  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required" });
    return;
  }
  if (!apiTokenSigningConfigured) {
    res.status(503).json({ ok: false, error: "Secure admin sessions are not configured." });
    return;
  }

  if (
    username.trim() === SA_USERNAME &&
    password === SA_PASSWORD &&
    (!api_key || api_key.trim() === SA_API_KEY)
  ) {
    const token = generateToken("a", "superadmin");
    res.json({ ok: true, token, role: "superadmin", name: SA_USERNAME });
    return;
  }

  const tenantSubdomain = getIspSubdomain(req);
  if (!tenantSubdomain && username.trim().toLowerCase() === "admin") {
    sendInvalidCredentials(res);
    return;
  }

  const subdomainFilter = tenantSubdomain
    ? `subdomain=eq.${encodeURIComponent(tenantSubdomain)}&`
    : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `${subdomainFilter}username=eq.${encodeURIComponent(username.trim())}&select=id,name,username,password,fullname,role,is_active,subdomain,area,currency,must_change_password&limit=1`,
  );
  const admin = rows[0];
  if (!admin || !await verifyIspAdminPassword(admin.password, password) || admin.is_active !== true) {
    sendInvalidCredentials(res);
    return;
  }

  const { password: _pw, ...safe } = admin;
  if (admin.must_change_password === true) {
    const setupToken = generateToken("p", String(admin.id));
    res.json({ ok: true, requiresPasswordSetup: true, setupToken, admin: safe });
    return;
  }

  const token = generateToken("a", String(admin.id));
  res.json({ ok: true, token, admin: safe });
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
  if (password.length < 10 || password.toLowerCase() === "admin") {
    res.status(400).json({ ok: false, error: "Choose a new password with at least 10 characters." });
    return;
  }

  const tenantSubdomain = getIspSubdomain(req);
  const subdomainFilter = tenantSubdomain
    ? `&subdomain=eq.${encodeURIComponent(tenantSubdomain)}`
    : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&is_active=is.true&must_change_password=is.true${subdomainFilter}&select=id,name,username,fullname,role,subdomain,area,currency&limit=1`,
  );
  const admin = rows[0];
  if (!admin) {
    res.status(401).json({ ok: false, error: "Your password setup session is no longer valid. Sign in again to continue." });
    return;
  }

  const updated = await sbUpdate<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(payload.uid)}&must_change_password=is.true`,
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

  res.json({ ok: true, token: generateToken("a", String(admin.id)), admin });
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

  if (!customer || customer.password !== password) {
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
