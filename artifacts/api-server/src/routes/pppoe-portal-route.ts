import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect } from "../lib/supabase-client.js";
import {
  generatePppoePortalReference,
  validatePppoePortalReference,
  type PppoePortalReferencePayload,
} from "../lib/api-auth.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";

const router: IRouter = Router();
const PORTAL_PATH = "/pppoe-login";
const GENERIC_PORTAL_ERROR = "This PPPoE recovery link is invalid or no longer available.";

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
  const fields = "id,admin_id,type,status,username,pppoe_username,name,phone";
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
    `id=eq.${payload.customerId}&admin_id=eq.${payload.adminId}&type=eq.pppoe&select=id,admin_id,type,status,username,pppoe_username,name,phone&limit=1`,
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

  res.json({
    ok: true,
    customer: {
      name: customer.name,
      username: customer.pppoe_username ?? customer.username,
      status: customer.status,
      customerId: customer.id,
      adminId: customer.admin_id,
      phone: customer.phone,
    },
  });
});

export default router;