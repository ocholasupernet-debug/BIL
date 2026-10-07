import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import { canRedeemHotspotPlan } from "../lib/loyalty-points.js";
import {
  isKenyanMobileNumber,
  kenyanMobilePhoneVariants,
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
  points_awarded: number | null;
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
  const planRows = await sbSelectStrict<LoyaltyPlan>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${adminId}&select=id,admin_id,name,type,price,router_id,port_id,owner_reseller_id,is_active,client_can_purchase&limit=1`,
  );
  const plan = planRows[0];
  if (!plan || String(plan.type).toLowerCase() !== "hotspot") return null;

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

async function hasHotspotCustomer(
  adminId: number,
  plan: LoyaltyPlan,
  phone: string,
): Promise<boolean> {
  const phoneVariants = kenyanMobilePhoneVariants(phone);
  const customerAdminIds = [...new Set([adminId, plan.owner_reseller_id].filter(
    (value): value is number => Number.isSafeInteger(value) && Number(value) > 0,
  ))];
  if (!phoneVariants.length || !customerAdminIds.length) return false;
  const customers = await sbSelectStrict<{ id: number }>(
    "isp_customers",
    `admin_id=in.(${customerAdminIds.join(",")})&type=eq.hotspot&phone=in.(${phoneVariants.join(",")})&select=id&limit=1`,
  );
  return customers.length > 0;
}

async function loyaltyQuote(
  adminId: number,
  plan: LoyaltyPlan,
  phone: string,
  hasCustomer: boolean,
  hasDeviceMac: boolean,
): Promise<{ balance: number; pointsRequired: number | null; canRedeem: boolean }> {
  const [accounts, rules] = await Promise.all([
    sbSelectStrict<{ points_balance: number | string }>(
      "isp_loyalty_accounts",
      `admin_id=eq.${adminId}&phone=eq.${phone}&select=points_balance&limit=1`,
    ),
    sbSelectStrict<LoyaltyRule>(
      "isp_loyalty_plan_rules",
      `admin_id=eq.${adminId}&plan_id=eq.${plan.id}&select=plan_id,points_awarded,redemption_points&limit=1`,
    ),
  ]);
  const balanceValue = Number(accounts[0]?.points_balance ?? 0);
  const balance = Number.isSafeInteger(balanceValue) && balanceValue >= 0 ? balanceValue : 0;
  const pointsRequiredValue = Number(rules[0]?.redemption_points ?? 0);
  const pointsRequired = Number.isSafeInteger(pointsRequiredValue) && pointsRequiredValue > 0
    ? pointsRequiredValue
    : null;
  return {
    balance,
    pointsRequired,
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
} | null> {
  const adminId = await portalAdminId(req, req.body?.adminId);
  const planId = positiveId(req.body?.plan_id);
  const phone = normaliseKenyanMobile(req.body?.phone);
  if (!adminId || !planId || !isKenyanMobileNumber(phone)) {
    res.status(400).json({ ok: false, error: "A Hotspot plan and valid Kenyan phone number are required." });
    return null;
  }

  const plan = await getHotspotPlan(adminId, planId, req);
  if (!plan) {
    res.status(404).json({ ok: false, error: "This Hotspot plan is not available in the current service." });
    return null;
  }
  const hasCustomer = await hasHotspotCustomer(adminId, plan, phone);
  return { adminId, plan, phone, hasCustomer };
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
      selectAllRows<{ phone: string; points_balance: number | string }>(
        "isp_loyalty_accounts",
        `admin_id=eq.${adminId}&select=phone,points_balance&order=phone.asc`,
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
      const pointsValue = Number(account.points_balance);
      const points = Number.isSafeInteger(pointsValue) && pointsValue >= 0 ? pointsValue : 0;
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
  const pointsAwarded = nullableInteger(req.body?.pointsAwarded);
  const redemptionPoints = nullableInteger(req.body?.redemptionPoints);
  if (pointsAwarded === undefined || redemptionPoints === undefined) {
    res.status(400).json({ ok: false, error: "Point values must be whole numbers between 0 and 2,147,483,647." });
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

router.post("/hotspot/loyalty/quote", async (req, res): Promise<void> => {
  try {
    const context = await publicPlanContext(req, res);
    if (!context) return;
    const mac = normalizeMac(req.body?.mac_address);
    const hasCustomer = context.hasCustomer;
    const quote = await loyaltyQuote(
      context.adminId,
      context.plan,
      context.phone,
      hasCustomer,
      !!mac,
    );
    res.json({ ok: true, ...quote });
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
      res.status(409).json({ ok: false, error: "This phone number does not have a Hotspot account in this service." });
      return;
    }
    const rows = await sbRpc<{
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
    res.json({
      ok: true,
      checkout_id: redemption.checkout_id,
      pointsBalance: Number(redemption.points_balance ?? 0),
      pointsSpent: Number(redemption.points_spent),
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
