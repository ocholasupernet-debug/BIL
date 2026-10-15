import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { sbSelect, sbSelectStrict, sbUpsertStrict } from "../lib/supabase-client.js";
import {
  authenticatedAdminId,
  generatePppoePortalReference,
  requireAdmin,
  validatePppoePortalReference,
  type PppoePortalReferencePayload,
} from "../lib/api-auth.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";

const router: IRouter = Router();
const PORTAL_PATH = "/pppoe-login";
const GENERIC_PORTAL_ERROR = "This PPPoE recovery link is invalid or no longer available.";
const SIGN_IN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const SIGN_IN_MAX_ATTEMPTS = 5;
const signInAttempts = new Map<string, { count: number; expiresAt: number }>();

async function renewalSignInEnabled(adminId: number): Promise<boolean> {
  try {
    const rows = await sbSelectStrict<{ renewal_signin_enabled: boolean }>(
      "isp_pppoe_portal_settings",
      `admin_id=eq.${adminId}&select=renewal_signin_enabled&limit=1`,
    );
    return rows[0]?.renewal_signin_enabled !== false;
  } catch {
    return false;
  }
}

router.get("/pppoe-portal/settings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.query.adminId);
  const rows = await sbSelectStrict<{ renewal_signin_enabled: boolean }>(
    "isp_pppoe_portal_settings",
    `admin_id=eq.${adminId}&select=renewal_signin_enabled&limit=1`,
  );
  res.json({ renewalSignInEnabled: rows[0]?.renewal_signin_enabled !== false });
});

router.put("/pppoe-portal/settings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  if (typeof req.body?.renewalSignInEnabled !== "boolean") {
    res.status(400).json({ error: "Choose whether expired PPPoE renewal sign-in is enabled." });
    return;
  }
  await sbUpsertStrict("isp_pppoe_portal_settings", "admin_id", {
    admin_id: adminId,
    renewal_signin_enabled: req.body.renewalSignInEnabled,
    updated_at: new Date().toISOString(),
  });
  res.json({ ok: true, renewalSignInEnabled: req.body.renewalSignInEnabled });
});

interface RouterRecord {
  id: number;
  admin_id: number;
  router_secret: string | null;
}

interface CustomerRecord {
  id: number;
  admin_id: number;
  type: string | null;
  status: string | null;
  phone: string | null;
  username: string | null;
  pppoe_username: string | null;
  name: string | null;
  plan_id: number | null;
  router_id: number | null;
  port_id: number | null;
  password?: string | null;
}

interface AdminRecord {
  id: number;
  subdomain: string | null;
}

function positiveInteger(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function queryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function signInRateLimited(req: Request, routerId: number, username: string): boolean {
  const now = Date.now();
  for (const [key, entry] of signInAttempts) {
    if (entry.expiresAt <= now) signInAttempts.delete(key);
  }
  const key = `${req.ip ?? req.socket.remoteAddress ?? "unknown"}:${routerId}:${username.toLowerCase()}`;
  const current = signInAttempts.get(key);
  if (!current || current.expiresAt <= now) {
    signInAttempts.set(key, { count: 1, expiresAt: now + SIGN_IN_ATTEMPT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > SIGN_IN_MAX_ATTEMPTS;
}

function passwordMatches(stored: unknown, submitted: string): boolean {
  if (typeof stored !== "string" || !stored || !submitted) return false;
  const storedBytes = Buffer.from(stored);
  const submittedBytes = Buffer.from(submitted);
  return storedBytes.length === submittedBytes.length && timingSafeEqual(storedBytes, submittedBytes);
}

function renewalSignInError(res: Response, status: number): void {
  res.status(status).type("html").send(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Renewal sign-in</title><body style=\"font:16px system-ui;max-width:480px;margin:12vh auto;padding:24px;color:#17302d\"><h1>Could not sign in</h1><p>Check your PPPoE username and password, or contact your ISP for help.</p><a href=\"javascript:history.back()\">Return to sign in</a></body></html>",
  );
}

export function isEligiblePppoePortalStatus(status: unknown): status is "expired" | "paused" {
  return status === "expired" || status === "paused";
}

function requestTenant(req: Request): string | null {
  return getTenantSubdomainFromRequest(req);
}

async function tenantOwnsAdmin(req: Request, adminId: number): Promise<boolean> {
  const subdomain = requestTenant(req);
  /* Local development commonly runs on localhost without a tenant host. In
     production, a tenant host is mandatory so a valid reference cannot be
     replayed on a different ISP’s portal. */
  if (!subdomain) return process.env.NODE_ENV !== "production";

  const admins = await sbSelect<AdminRecord>(
    "isp_admins",
    `id=eq.${adminId}&subdomain=eq.${encodeURIComponent(subdomain)}&is_active=is.true&select=id,subdomain&limit=1`,
  );
  return admins[0]?.id === adminId && admins[0]?.subdomain === subdomain;
}

async function findPppoeCustomer(adminId: number, username: string): Promise<CustomerRecord | null> {
  const encodedUsername = encodeURIComponent(username);
  const fields = "id,admin_id,type,status,username,pppoe_username,name,phone,plan_id,router_id,port_id";
  const byPppoeUsername = await sbSelect<CustomerRecord>(
    "isp_customers",
    `admin_id=eq.${adminId}&type=eq.pppoe&pppoe_username=eq.${encodedUsername}&select=${fields}&limit=1`,
  );
  if (byPppoeUsername[0]) return byPppoeUsername[0];

  const byUsername = await sbSelect<CustomerRecord>(
    "isp_customers",
    `admin_id=eq.${adminId}&type=eq.pppoe&username=eq.${encodedUsername}&select=${fields}&limit=1`,
  );
  return byUsername[0] ?? null;
}

async function findEligibleCustomer(payload: PppoePortalReferencePayload, req: Request): Promise<CustomerRecord | null> {
  if (!await tenantOwnsAdmin(req, payload.adminId)) return null;

  const routers = await sbSelect<Pick<RouterRecord, "id" | "admin_id">>(
    "isp_routers",
    `id=eq.${payload.routerId}&admin_id=eq.${payload.adminId}&select=id,admin_id&limit=1`,
  );
  if (routers[0]?.id !== payload.routerId || routers[0]?.admin_id !== payload.adminId) return null;

  const customers = await sbSelect<CustomerRecord>(
    "isp_customers",
    `id=eq.${payload.customerId}&admin_id=eq.${payload.adminId}&type=eq.pppoe&select=id,admin_id,type,status,username,pppoe_username,name,phone,plan_id,router_id,port_id&limit=1`,
  );
  const customer = customers[0];
  if (
    !customer
    || customer.admin_id !== payload.adminId
    || customer.type !== "pppoe"
    || !isEligiblePppoePortalStatus(customer.status)
  ) return null;

  return customer;
}

function portalOrigin(req: Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string"
    ? forwardedProto.split(",")[0]?.trim() || "https"
    : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function portalRedirect(req: Request, reference?: string): string {
  const url = new URL(PORTAL_PATH, portalOrigin(req));
  if (reference) url.searchParams.set("ref", reference);
  return url.toString();
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/**
 * Router-facing handoff. The router authenticates with its existing secret and
 * supplies the PPPoE username. The customer-facing redirect contains only the
 * short-lived signed reference, never the router secret or PPPoE password.
 */
router.get("/public/pppoe-portal/handoff/:routerId", async (req: Request, res: Response): Promise<void> => {
  noStore(res);

  const routerId = positiveInteger(req.params.routerId);
  const routerSecret = queryString(req.query.token ?? req.headers["x-router-secret"]);
  const username = queryString(req.query.username ?? req.query.user);
  if (!routerId || !routerSecret || !username || username.length > 128) {
    res.redirect(302, portalRedirect(req));
    return;
  }

  const routers = await sbSelect<RouterRecord>(
    "isp_routers",
    `id=eq.${routerId}&router_secret=eq.${encodeURIComponent(routerSecret)}&select=id,admin_id,router_secret&limit=1`,
  );
  const routerRecord = routers[0];
  if (!routerRecord || !routerRecord.router_secret || !await tenantOwnsAdmin(req, routerRecord.admin_id)) {
    res.redirect(302, portalRedirect(req));
    return;
  }
  if (!await renewalSignInEnabled(routerRecord.admin_id)) {
    res.redirect(302, portalRedirect(req));
    return;
  }

  const customer = await findPppoeCustomer(routerRecord.admin_id, username);
  if (!customer || !isEligiblePppoePortalStatus(customer.status)) {
    res.redirect(302, portalRedirect(req));
    return;
  }

  try {
    const reference = generatePppoePortalReference({
      customerId: customer.id,
      adminId: routerRecord.admin_id,
      routerId: routerRecord.id,
    });
    res.redirect(302, portalRedirect(req, reference));
  } catch {
    res.redirect(302, portalRedirect(req));
  }
});

/**
 * Customer-facing sign-in for renewal only. Credentials are checked server-side
 * and the password is never included in the signed portal reference or redirect.
 */
router.post("/public/pppoe-portal/sign-in", async (req: Request, res: Response): Promise<void> => {
  noStore(res);
  if (process.env.NODE_ENV === "production" && !portalOrigin(req).startsWith("https://")) {
    renewalSignInError(res, 400);
    return;
  }
  const routerId = positiveInteger(req.body?.routerId);
  const username = queryString(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!routerId || !username || username.length > 128 || !password || password.length > 128) {
    renewalSignInError(res, 400);
    return;
  }
  if (signInRateLimited(req, routerId, username)) {
    renewalSignInError(res, 429);
    return;
  }

  const routers = await sbSelect<Pick<RouterRecord, "id" | "admin_id">>(
    "isp_routers",
    `id=eq.${routerId}&select=id,admin_id&limit=1`,
  );
  const routerRecord = routers[0];
  if (!routerRecord || routerRecord.id !== routerId || !await tenantOwnsAdmin(req, routerRecord.admin_id)) {
    renewalSignInError(res, 401);
    return;
  }
  if (!await renewalSignInEnabled(routerRecord.admin_id)) {
    renewalSignInError(res, 403);
    return;
  }

  const fields = "id,admin_id,type,status,username,pppoe_username,password,router_id,port_id";
  const customer = (
    await sbSelect<CustomerRecord>(
      "isp_customers",
      `admin_id=eq.${routerRecord.admin_id}&router_id=eq.${routerId}&type=eq.pppoe&pppoe_username=eq.${encodeURIComponent(username)}&select=${fields}&limit=1`,
    )
  )[0] ?? (
    await sbSelect<CustomerRecord>(
      "isp_customers",
      `admin_id=eq.${routerRecord.admin_id}&router_id=eq.${routerId}&type=eq.pppoe&username=eq.${encodeURIComponent(username)}&select=${fields}&limit=1`,
    )
  )[0];

  if (
    !customer
    || customer.admin_id !== routerRecord.admin_id
    || customer.router_id !== routerId
    || customer.type !== "pppoe"
    || !isEligiblePppoePortalStatus(customer.status)
    || !passwordMatches(customer.password, password)
  ) {
    renewalSignInError(res, 401);
    return;
  }

  try {
    const reference = generatePppoePortalReference({
      customerId: customer.id,
      adminId: routerRecord.admin_id,
      routerId,
    });
    res.redirect(303, portalRedirect(req, reference));
  } catch {
    renewalSignInError(res, 503);
  }
});

/**
 * Browser-facing verification. All invalid cases intentionally share the same
 * response so the endpoint cannot be used to probe customer records.
 */
router.get("/public/pppoe-portal/access", async (req: Request, res: Response): Promise<void> => {
  noStore(res);
  const reference = queryString(req.query.ref);
  const payload = validatePppoePortalReference(reference);
  if (!payload) {
    res.status(404).json({ ok: false, error: GENERIC_PORTAL_ERROR });
    return;
  }

  const customer = await findEligibleCustomer(payload, req);
  if (!customer) {
    res.status(404).json({ ok: false, error: GENERIC_PORTAL_ERROR });
    return;
  }

  let portId = customer.port_id;
  if (!portId && customer.plan_id) {
    const plans = await sbSelect<{ port_id: number | null }>(
      "isp_plans",
      `id=eq.${customer.plan_id}&admin_id=eq.${customer.admin_id}&select=port_id&limit=1`,
    );
    portId = plans[0]?.port_id ?? null;
  }

  res.json({
    ok: true,
    customer: {
      name: customer.name,
      username: customer.pppoe_username ?? customer.username,
      status: customer.status,
      customerId: customer.id,
      adminId: customer.admin_id,
      routerId: payload.routerId,
      portId,
      phone: customer.phone,
    },
  });
});

export default router;