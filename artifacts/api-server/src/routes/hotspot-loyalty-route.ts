import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import {
  calculateHotspotLoyaltyAward,
  canRedeemHotspotPlan,
  resolveHotspotRedemptionPoints,
} from "../lib/loyalty-points.js";
import {
  issueHotspotLoyaltyDeviceAuthorization,
  verifyHotspotLoyaltyDeviceAuthorization,
} from "../lib/hotspot-loyalty-device-authorization.js";
import {
  isKenyanMobileNumber,
  normaliseKenyanMobile,
} from "../lib/kenyan-phone.js";
import { logger } from "../lib/logger.js";
import {
  sbRpc,
  sbSelectStrict,
  sbUpsertStrict,
} from "../lib/supabase-client.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";

const router: IRouter = Router();

// Injectable boundaries for route tests; production uses strict database reads.
export const hotspotLoyaltyOperations = { select: sbSelectStrict, redeem: sbRpc };

type LoyaltyPlan = {
  id: number;
  admin_id: number;
  name: string;
  type: string;
  price: number | string;
  router_id: number | null;
  port_id: number | null;
  owner_reseller_id: number | null;
  is_active: boolean;
  client_can_purchase: boolean;
};

type LoyaltyRule = {
  plan_id: number;
  points_awarded: number | string | null;
  redemption_points: number | null;
};

type LoyaltyCustomer = {
  id: number;
  admin_id: number;
  name: string;
  phone: string;
  status: string;
  updated_at: string | null;
};

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nullableInteger(value: unknown, maximum = 2_147_483_647): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) return undefined;
  return number;
}

function nullablePoints(value: unknown, maximum = 2_147_483_647): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const points = Number(value);
  const cents = Math.round(points * 100);
  if (!Number.isFinite(points) || points < 0 || points > maximum
      || Math.abs(points * 100 - cents) > 1e-7) return undefined;
  return cents / 100;
}

function pointBalance(balanceValue: unknown, fractionalValue: unknown = 0): number {
  const whole = Number(balanceValue ?? 0);
  const fraction = Number(fractionalValue ?? 0);
  if (!Number.isFinite(whole) || whole < 0 || !Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return 0;
  return Math.round((whole + fraction + Number.EPSILON) * 100) / 100;
}

function normalizeMac(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[:-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) return "";
  return compact.match(/.{2}/g)!.join(":");
}

async function tenantAdminId(req: Request): Promise<number | null> {
  const account = await authenticatedAccount(req);
  if (!account || account.role === "reseller" && !account.parent_id) return null;
  const id = Number(account.parent_id ?? account.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function selectAllRows<T>(table: string, query: string): Promise<T[]> {
  const pageSize = 1_000;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await sbSelectStrict<T>(table, `${query}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function portalAdminId(req: Request, requested: unknown): Promise<number | null> {
  const signedScope = req.hotspotPortalContext;
  if (signedScope?.adminId) return signedScope.adminId;

  const explicitId = positiveId(requested);
  if (explicitId) return explicitId;

  const subdomain = getTenantSubdomainFromRequest(req);
  if (!subdomain) return null;
  const admins = await sbSelectStrict<{ id: number }>(
    "isp_admins",
    `subdomain=eq.${encodeURIComponent(subdomain)}&is_active=is.true&select=id&limit=1`,
  );
  return positiveId(admins[0]?.id);
}

async function getHotspotPlan(
  adminId: number,
  planId: number,
  req: Request,
): Promise<LoyaltyPlan | null> {
  const planRows = await hotspotLoyaltyOperations.select<LoyaltyPlan>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${adminId}&select=id,admin_id,name,type,price,router_id,port_id,owner_reseller_id,is_active,client_can_purchase&limit=1`,
  );
  const plan = planRows[0];
  if (!plan || plan.admin_id !== adminId || String(plan.type).toLowerCase() !== "hotspot") return null;

  const signedScope = req.hotspotPortalContext;
  if (signedScope && (
    plan.router_id !== signedScope.routerId
    || plan.port_id !== signedScope.portId
    || plan.owner_reseller_id !== signedScope.resellerId
  )) return null;

  const requestedRouterId = positiveId(req.body?.router_id);
  const requestedPortId = positiveId(req.body?.port_id);
  if (requestedRouterId && plan.router_id !== requestedRouterId) return null;
  if (requestedPortId && plan.port_id !== requestedPortId) return null;
  return plan;
}

async function deviceAccountPhone(
  adminId: number,
  mac: string,
  scope: { routerId: number | null; portId?: number | null; resellerId?: number | null },
): Promise<{ phone: string; customerId: number; customerAdminId: number; status: string } | null> {
  const customerAdminIds = [...new Set([adminId, scope.resellerId].filter(
    (value): value is number => Number.isSafeInteger(value) && Number(value) > 0,
  ))];
  const compact = mac.replace(/:/g, "");
  const variants = [...new Set([mac, mac.toLowerCase(), compact, compact.toLowerCase(), mac.replace(/:/g, "-"), mac.toLowerCase().replace(/:/g, "-")])];
  const customers = await hotspotLoyaltyOperations.select<{
    id: number; admin_id: number; phone: string; mac_address: string;
    router_id: number | null; port_id: number | null; status?: string;
  }>(
    "isp_customers",
    `admin_id=in.(${customerAdminIds.join(",")})&type=eq.hotspot&mac_address=in.(${variants.map(encodeURIComponent).join(",")})`
      + (scope.routerId ? `&router_id=eq.${scope.routerId}` : "")
      + (scope.portId === undefined ? "" : scope.portId === null ? "&port_id=is.null" : `&port_id=eq.${scope.portId}`)
      + "&select=id,admin_id,phone,mac_address,router_id,port_id,status&order=created_at.desc.nullslast,id.desc&limit=1",
  );
  const customer = customers[0];
  if (!customer || !customerAdminIds.includes(customer.admin_id)
      || normalizeMac(customer.mac_address) !== mac
      || scope.routerId && customer.router_id !== scope.routerId
      || scope.portId !== undefined && (customer.port_id ?? null) !== scope.portId) return null;
  const phone = normaliseKenyanMobile(customer.phone);
  return isKenyanMobileNumber(phone) ? {
    phone, customerId: customer.id, customerAdminId: customer.admin_id,
    status: String(customer.status ?? "").toLowerCase(),
  } : null;
}

// Loyalty redemption follows the product's MAC-only authorization policy. Keep
// this verifier for recovering older pending checkouts that were created under
// the previous credential-confirmation flow.
const verificationAttempts = new Map<string, { attempts: number; until: number }>();
type LoyaltyDeviceAuthContext = {
  adminId: number;
  plan: LoyaltyPlan;
  phone: string;
  deviceAccount: { customerId: number; customerAdminId: number } | null;
};

function loyaltyDeviceAuthorizationScope(
  context: LoyaltyDeviceAuthContext,
  macAddress: string,
) {
  if (!context.deviceAccount) return null;
  return {
    tenantAdminId: context.adminId,
    customerAdminId: context.deviceAccount.customerAdminId,
    customerId: context.deviceAccount.customerId,
    phone: context.phone,
    macAddress,
    routerId: context.plan.router_id,
    portId: context.plan.port_id,
    resellerId: context.plan.owner_reseller_id,
  };
}

async function verifyLoyaltyAccount(
  req: Request,
  res: Response,
  context: LoyaltyDeviceAuthContext & { deviceAccount: { customerId: number; customerAdminId: number; status: string } | null },
): Promise<boolean> {
  const supplied = req.body?.account_credentials;
  const username = typeof supplied?.username === "string" ? supplied.username.trim() : "";
  const password = typeof supplied?.password === "string" ? supplied.password : "";
  const deviceAuthorization = typeof req.body?.device_authorization === "string"
    ? req.body.device_authorization.trim() : "";
  const hasCredentials = Boolean(username && username.length <= 128 && password && password.length <= 512);
  const deny = () => {
    res.status(401).json({ ok: false, verificationRequired: true,
      error: deviceAuthorization
        ? "This device authorization is invalid or expired. Confirm the Hotspot account once more to continue."
        : "Confirm this device's Hotspot account username and password to use its loyalty points." });
    return false;
  };
  if ((!hasCredentials && !deviceAuthorization) || !context.deviceAccount) return deny();
  const mac = normalizeMac(req.body?.mac_address);
  const key = `${req.ip}|${context.adminId}|${mac}`;
  const now = Date.now();
  const previous = hasCredentials ? verificationAttempts.get(key) : undefined;
  if (hasCredentials) {
    if (previous && previous.until > now && previous.attempts >= 6) {
      res.setHeader("Retry-After", String(Math.ceil((previous.until - now) / 1000)));
      res.status(429).json({ ok: false, verificationRequired: true, error: "Too many account confirmation attempts. Please retry in one minute." });
      return false;
    }
    if (verificationAttempts.size >= 10000) {
      for (const [entry, value] of verificationAttempts) if (value.until <= now) verificationAttempts.delete(entry);
      if (verificationAttempts.size >= 10000) {
        res.status(503).json({ ok: false, error: "Account confirmation is busy. Please retry shortly." });
        return false;
      }
    }
  }
  if (hasCredentials) {
    const attempt = previous && previous.until > now ? previous : { attempts: 0, until: now + 60000 };
    attempt.attempts++;
    verificationAttempts.set(key, attempt);
  }
  const selectFields = `id,admin_id,username,phone,mac_address,router_id,port_id,status${hasCredentials ? ",password" : ""}`;
  const profiles = await hotspotLoyaltyOperations.select<{
    id: number; admin_id: number; username: string; password?: string; phone: string;
    mac_address: string; router_id: number | null; port_id: number | null; status: string;
  }>("isp_customers",
    `id=eq.${context.deviceAccount.customerId}&admin_id=eq.${context.deviceAccount.customerAdminId}&type=eq.hotspot&select=${selectFields}&limit=1`);
  const profile = profiles[0];
  const accountMatches = profile
    && profile.id === context.deviceAccount.customerId && profile.admin_id === context.deviceAccount.customerAdminId
    && typeof profile.username === "string" && profile.username.length > 0
    && normaliseKenyanMobile(profile.phone) === context.phone
    && normalizeMac(profile.mac_address) === mac && (profile.router_id ?? null) === (context.plan.router_id ?? null)
    && (profile.port_id ?? null) === (context.plan.port_id ?? null)
    && !["suspended", "disabled"].includes(context.deviceAccount.status)
    && !["suspended", "disabled"].includes(String(profile.status).toLowerCase());
  const credentialsMatch = Boolean(accountMatches && hasCredentials
    && profile && profile.username === username
    && typeof profile.password === "string" && profile.password.length > 0
    && timingSafeEqual(createHash("sha256").update(profile.password).digest(), createHash("sha256").update(password).digest()));
  const authorizationScope = accountMatches ? loyaltyDeviceAuthorizationScope(context, mac) : null;
  const deviceAuthorizationMatches = Boolean(authorizationScope && deviceAuthorization
    && verifyHotspotLoyaltyDeviceAuthorization(
      deviceAuthorization,
      authorizationScope,
      process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim(),
    ));
  if (!accountMatches || (!credentialsMatch && !deviceAuthorizationMatches)) return deny();
  verificationAttempts.delete(key);
  return true;
}

function issueDeviceAuthorization(context: {
  adminId: number;
  plan: LoyaltyPlan;
  phone: string;
  deviceAccount: { customerId: number; customerAdminId: number } | null;
}, macAddress: string): { token: string; expiresAt: number } | null {
  const scope = loyaltyDeviceAuthorizationScope(context, macAddress);
  return scope
    ? issueHotspotLoyaltyDeviceAuthorization(
      scope,
      process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim(),
    )
    : null;
}

async function deviceBalance(adminId: number, phone: string | null): Promise<number> {
  if (!phone) return 0;
  const accounts = await hotspotLoyaltyOperations.select<{
    points_balance: number | string; fractional_balance: number | string;
  }>(
    "isp_loyalty_accounts",
    `admin_id=eq.${adminId}&phone=eq.${phone}&select=points_balance,fractional_balance&limit=1`,
  );
  return pointBalance(accounts[0]?.points_balance, accounts[0]?.fractional_balance);
}

async function loyaltyQuote(
  adminId: number,
  plan: LoyaltyPlan,
  phone: string,
  hasCustomer: boolean,
  hasDeviceMac: boolean,
): Promise<{ balance: number; pointsRequired: number | null; pointsAwarded: number; canRedeem: boolean }> {
  const [balance, rules, settings] = await Promise.all([
    deviceBalance(adminId, phone || null),
    hotspotLoyaltyOperations.select<LoyaltyRule>(
      "isp_loyalty_plan_rules",
      `admin_id=eq.${adminId}&plan_id=eq.${plan.id}&select=plan_id,points_awarded,redemption_points&limit=1`,
    ),
    hotspotLoyaltyOperations.select<{ kes_per_point: number | string }>(
      "isp_loyalty_settings",
      `admin_id=eq.${adminId}&select=kes_per_point&limit=1`,
    ),
  ]);
  const pointsRequired = resolveHotspotRedemptionPoints(
    plan.price,
    rules[0]?.redemption_points,
  );
  const pointsAwarded = calculateHotspotLoyaltyAward(
    Number(plan.price),
    Number(settings[0]?.kes_per_point ?? 0),
    rules[0]?.points_awarded == null ? null : Number(rules[0].points_awarded),
  );
  return {
    balance,
    pointsRequired,
    pointsAwarded,
    canRedeem: hasCustomer
      && hasDeviceMac
      && plan.is_active === true
      && plan.client_can_purchase === true
      && canRedeemHotspotPlan(balance, pointsRequired),
  };
}

async function publicPlanContext(req: Request, res: Response): Promise<{
  adminId: number;
  plan: LoyaltyPlan;
  phone: string;
  hasCustomer: boolean;
  deviceAccount: { phone: string; customerId: number; customerAdminId: number; status: string } | null;
} | null> {
  const adminId = await portalAdminId(req, req.body?.adminId);
  const planId = positiveId(req.body?.plan_id);
  const mac = normalizeMac(req.body?.mac_address);
  if (!adminId || !planId || !mac) {
    res.status(400).json({ ok: false, error: "A Hotspot plan and the connected device's MAC address are required." });
    return null;
  }

  const plan = await getHotspotPlan(adminId, planId, req);
  if (!plan) {
    res.status(404).json({ ok: false, error: "This Hotspot plan is not available in the current service." });
    return null;
  }
  const phone = await deviceAccountPhone(adminId, mac, {
    routerId: plan.router_id, portId: plan.port_id, resellerId: plan.owner_reseller_id,
  });
  return { adminId, plan, phone: phone?.phone ?? "", hasCustomer: phone !== null, deviceAccount: phone };
}

router.get("/admin/loyalty/context", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  try {
    const [settings, plans, rules, childAdmins, accounts] = await Promise.all([
      sbSelectStrict<{ kes_per_point: number | string }>(
        "isp_loyalty_settings",
        `admin_id=eq.${adminId}&select=kes_per_point&limit=1`,
      ),
      selectAllRows<LoyaltyPlan>(
        "isp_plans",
        `admin_id=eq.${adminId}&type=eq.hotspot&is_active=is.true&select=id,admin_id,name,type,price,router_id,port_id,owner_reseller_id,is_active,client_can_purchase&order=name.asc`,
      ),
      selectAllRows<LoyaltyRule>(
        "isp_loyalty_plan_rules",
        `admin_id=eq.${adminId}&select=plan_id,points_awarded,redemption_points&order=plan_id.asc`,
      ),
      selectAllRows<{ id: number }>(
        "isp_admins",
        `parent_id=eq.${adminId}&select=id&order=id.asc`,
      ),
      selectAllRows<{ phone: string; points_balance: number | string; fractional_balance: number | string }>(
        "isp_loyalty_accounts",
        `admin_id=eq.${adminId}&select=phone,points_balance,fractional_balance&order=phone.asc`,
      ),
    ]);
    const ownerIds = [...new Set([adminId, ...childAdmins.map(row => Number(row.id))].filter(
      value => Number.isSafeInteger(value) && value > 0,
    ))];
    const customers = await selectAllRows<LoyaltyCustomer>(
      "isp_customers",
      `admin_id=in.(${ownerIds.join(",")})&type=eq.hotspot&select=id,admin_id,name,phone,status,updated_at&order=updated_at.desc,id.desc`,
    );

    const ruleByPlan = new Map(rules.map(rule => [rule.plan_id, rule]));
    const userByPhone = new Map<string, {
      phone: string;
      name: string;
      points: number;
      accountCount: number;
      status: string;
      lastActivityAt: string | null;
    }>();
    for (const customer of customers) {
      const phone = normaliseKenyanMobile(customer.phone);
      if (!phone) continue;
      const current = userByPhone.get(phone);
      if (current) {
        current.accountCount += 1;
        continue;
      }
      userByPhone.set(phone, {
        phone,
        name: customer.name || phone,
        points: 0,
        accountCount: 1,
        status: customer.status || "unknown",
        lastActivityAt: customer.updated_at,
      });
    }
    for (const account of accounts) {
      const phone = normaliseKenyanMobile(account.phone);
      if (!phone) continue;
      const points = pointBalance(account.points_balance, account.fractional_balance);
      const current = userByPhone.get(phone);
      if (current) current.points = points;
      else {
        userByPhone.set(phone, {
          phone,
          name: phone,
          points,
          accountCount: 0,
          status: "no current account",
          lastActivityAt: null,
        });
      }
    }

    res.json({
      ok: true,
      settings: { kesPerPoint: Number(settings[0]?.kes_per_point ?? 0) },
      plans: plans.map(plan => {
        const rule = ruleByPlan.get(plan.id);
        return {
          id: plan.id,
          name: plan.name,
          type: plan.type,
          price: Number(plan.price),
          pointsAwarded: rule?.points_awarded ?? null,
          redemptionPoints: rule?.redemption_points ?? null,
        };
      }),
      users: [...userByPhone.values()].sort((left, right) =>
        right.points - left.points || left.phone.localeCompare(right.phone),
      ),
    });
  } catch (error) {
    logger.error({ err: error, adminId }, "[admin/loyalty] context load failed");
    res.status(503).json({ ok: false, error: "Loyalty settings and balances could not be loaded. Please try again." });
  }
});

router.put("/admin/loyalty/settings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  const raw = req.body?.kesPerPoint;
  const kesPerPoint = raw === null || raw === undefined || raw === ""
    ? 0
    : Number(raw);
  if (!Number.isFinite(kesPerPoint) || kesPerPoint < 0 || kesPerPoint > 1_000_000_000
      || Math.round(kesPerPoint * 100) !== kesPerPoint * 100) {
    res.status(400).json({ ok: false, error: "Enter a non-negative KSh amount with up to two decimal places." });
    return;
  }
  try {
    await sbUpsertStrict(
      "isp_loyalty_settings",
      "admin_id",
      { admin_id: adminId, kes_per_point: kesPerPoint, updated_at: new Date().toISOString() },
    );
    res.json({ ok: true, kesPerPoint });
  } catch (error) {
    logger.error({ err: error, adminId }, "[admin/loyalty] settings save failed");
    res.status(503).json({ ok: false, error: "The loyalty earning rule could not be saved. Please retry." });
  }
});

router.put("/admin/loyalty/plans/:planId", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  const planId = positiveId(req.params.planId);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  if (!planId) {
    res.status(400).json({ ok: false, error: "A valid Hotspot plan is required." });
    return;
  }
  const pointsAwarded = nullablePoints(req.body?.pointsAwarded);
  const redemptionPoints = nullableInteger(req.body?.redemptionPoints);
  if (pointsAwarded === undefined || redemptionPoints === undefined) {
    res.status(400).json({ ok: false, error: "Award points may use up to two decimal places; redemption cost must be a whole number." });
    return;
  }
  try {
    const plans = await sbSelectStrict<{ id: number; type: string }>(
      "isp_plans",
      `id=eq.${planId}&admin_id=eq.${adminId}&select=id,type&limit=1`,
    );
    if (!plans[0] || String(plans[0].type).toLowerCase() !== "hotspot") {
      res.status(404).json({ ok: false, error: "This Hotspot plan was not found in your account." });
      return;
    }
    await sbUpsertStrict(
      "isp_loyalty_plan_rules",
      "admin_id,plan_id",
      {
        admin_id: adminId,
        plan_id: planId,
        points_awarded: pointsAwarded,
        redemption_points: redemptionPoints,
        updated_at: new Date().toISOString(),
      },
    );
    res.json({ ok: true, planId, pointsAwarded, redemptionPoints });
  } catch (error) {
    logger.error({ err: error, adminId, planId }, "[admin/loyalty] plan rule save failed");
    res.status(503).json({ ok: false, error: "The plan's loyalty rule could not be saved. Please retry." });
  }
});

router.post("/hotspot/loyalty/balance", async (req, res): Promise<void> => {
  try {
    const adminId = await portalAdminId(req, req.body?.adminId);
    const mac = normalizeMac(req.body?.mac_address);
    const signed = req.hotspotPortalContext;
    const requestedRouter = positiveId(req.body?.router_id);
    const requestedPort = positiveId(req.body?.port_id);
    if (!adminId || !mac
        || (req.body?.router_id != null && !requestedRouter)
        || (req.body?.port_id != null && !requestedPort)) {
      res.status(400).json({ ok: false, error: "A Hotspot service and connected device MAC address are required." });
      return;
    }
    const routerId = signed?.routerId ?? requestedRouter;
    const portId = signed?.portId ?? requestedPort;
    if ((signed && ((requestedRouter && requestedRouter !== signed.routerId)
        || (requestedPort && requestedPort !== signed.portId))) || (portId && !routerId)) {
      res.status(404).json({ ok: false, error: "This Hotspot service is not available." });
      return;
    }
    if (routerId) {
      const routers = await hotspotLoyaltyOperations.select<{ id: number }>(
        "isp_routers", `id=eq.${routerId}&admin_id=eq.${adminId}&select=id&limit=1`,
      );
      if (!routers[0]) {
        res.status(404).json({ ok: false, error: "This Hotspot service is not available." });
        return;
      }
    }
    let resellerId = signed?.resellerId ?? null;
    if (portId) {
      const ports = await hotspotLoyaltyOperations.select<{ assigned_reseller_id: number | null }>(
        "isp_reseller_router_ports",
        `id=eq.${portId}&admin_id=eq.${adminId}&router_id=eq.${routerId}&select=assigned_reseller_id&limit=1`,
      );
      if (!ports[0] || signed && ports[0].assigned_reseller_id !== signed.resellerId) {
        res.status(404).json({ ok: false, error: "This Hotspot service is not available." });
        return;
      }
      resellerId = ports[0].assigned_reseller_id;
    }
    const phone = await deviceAccountPhone(adminId, mac, {
      routerId, portId: routerId ? portId : undefined, resellerId,
    });
    res.json({ ok: true, balance: await deviceBalance(adminId, phone?.phone ?? null), hasAccount: phone !== null });
  } catch (error) {
    logger.warn({ err: error }, "[hotspot/loyalty/balance] device balance unavailable");
    res.status(503).json({ ok: false, error: "This device's loyalty points could not be checked right now." });
  }
});

router.post("/hotspot/loyalty/quote", async (req, res): Promise<void> => {
  try {
    const context = await publicPlanContext(req, res);
    if (!context) return;
    const mac = normalizeMac(req.body?.mac_address);
    const hasCustomer = context.hasCustomer
      && !["suspended", "disabled"].includes(context.deviceAccount?.status ?? "");
    const quote = await loyaltyQuote(
      context.adminId,
      context.plan,
      context.phone,
      hasCustomer,
      !!mac,
    );
    // Recover a confirmed debit after a lost HTTP response without spending again.
    const key = String(req.body?.idempotency_key ?? "").trim().toLowerCase();
    let pendingCheckoutId: string | null = null;
    const hasAccountProof = Boolean(req.body?.account_credentials || req.body?.device_authorization);
    let deviceAuthorization: { token: string; expiresAt?: number } | null = null;
    if (context.hasCustomer && hasAccountProof
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
      // Recovering an access capability requires the same proof as spending.
      if (!await verifyLoyaltyAccount(req, res, context)) return;
      const reference = `LOYALTY-${key}`;
      const transactions = await hotspotLoyaltyOperations.select<{
        admin_id: number; plan_id: number; payment_phone: string; mac_address: string; reference: string; status: string;
      }>(
        "isp_transactions",
        `admin_id=eq.${context.adminId}&reference=eq.${reference}&payment_method=eq.loyalty_points&status=eq.completed&select=admin_id,plan_id,payment_phone,mac_address,reference,status&limit=1`,
      );
      const paid = transactions[0];
      if (paid && paid.admin_id === context.adminId && paid.plan_id === context.plan.id
          && paid.reference === reference && paid.status === "completed"
          && normaliseKenyanMobile(paid.payment_phone) === context.phone
          && normalizeMac(paid.mac_address) === mac) {
        pendingCheckoutId = reference;
        const suppliedAuthorization = typeof req.body?.device_authorization === "string"
          ? req.body.device_authorization.trim() : "";
        const scope = loyaltyDeviceAuthorizationScope(context, mac);
        const signingSecret = process.env.TOKEN_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
        deviceAuthorization = scope && suppliedAuthorization
          && verifyHotspotLoyaltyDeviceAuthorization(suppliedAuthorization, scope, signingSecret)
          ? { token: suppliedAuthorization }
          : issueDeviceAuthorization(context, mac);
      }
    }
    res.json({
      ok: true,
      ...quote,
      pendingCheckoutId,
      ...(deviceAuthorization ? {
        device_authorization: deviceAuthorization.token,
        ...(deviceAuthorization.expiresAt ? { device_authorization_expires_at: deviceAuthorization.expiresAt } : {}),
      } : {}),
    });
  } catch (error) {
    logger.warn({ err: error }, "[hotspot/loyalty/quote] quote unavailable");
    res.status(503).json({ ok: false, error: "Loyalty points could not be checked right now." });
  }
});

router.post("/hotspot/loyalty/redeem", async (req, res): Promise<void> => {
  try {
    const context = await publicPlanContext(req, res);
    if (!context) return;
    const macAddress = normalizeMac(req.body?.mac_address);
    const idempotencyKey = String(req.body?.idempotency_key ?? "").trim().toLowerCase();
    if (!macAddress || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(idempotencyKey)) {
      res.status(400).json({ ok: false, error: "A valid device and redemption request are required." });
      return;
    }
    if (!context.hasCustomer) {
      res.status(409).json({ ok: false, error: "This device is not linked to a Hotspot account in this service." });
      return;
    }
    if (!context.deviceAccount || ["suspended", "disabled"].includes(context.deviceAccount.status)) {
      res.status(409).json({ ok: false, error: "This Hotspot account cannot redeem loyalty points." });
      return;
    }
    // MAC-only redemption is an explicit product choice. Require a scoped
    // customer association above, and keep the stored phone server-derived.
    const deviceAuthorization = issueDeviceAuthorization(context, macAddress);
    const rows = await hotspotLoyaltyOperations.redeem<{
      checkout_id: string;
      points_balance: number | string;
      points_spent: number;
    }>("redeem_hotspot_loyalty_points", {
      p_admin_id: context.adminId,
      p_plan_id: context.plan.id,
      p_phone: context.phone,
      p_mac_address: macAddress,
      p_idempotency_key: idempotencyKey,
    });
    const redemption = rows[0];
    if (!redemption?.checkout_id) {
      res.status(503).json({ ok: false, error: "The loyalty redemption could not be confirmed. Your balance was not changed." });
      return;
    }
    const accounts = await hotspotLoyaltyOperations.select<{
      points_balance: number | string;
      fractional_balance: number | string;
    }>(
      "isp_loyalty_accounts",
      `admin_id=eq.${context.adminId}&phone=eq.${context.phone}&select=points_balance,fractional_balance&limit=1`,
    );
    res.json({
      ok: true,
      checkout_id: redemption.checkout_id,
      pointsBalance: pointBalance(accounts[0]?.points_balance ?? redemption.points_balance, accounts[0]?.fractional_balance),
      pointsSpent: Number(redemption.points_spent),
      ...(deviceAuthorization ? {
        device_authorization: deviceAuthorization.token,
        device_authorization_expires_at: deviceAuthorization.expiresAt,
      } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not enough loyalty points|not enabled for loyalty redemption|does not have a hotspot customer|cannot currently be purchased|different purchase/i.test(message)) {
      res.status(409).json({ ok: false, error: message });
      return;
    }
    logger.error({ err: error }, "[hotspot/loyalty/redeem] redemption failed");
    res.status(503).json({ ok: false, error: "The loyalty redemption could not be confirmed. Please retry." });
  }
});

export default router;
