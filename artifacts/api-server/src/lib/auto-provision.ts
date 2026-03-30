/**
 * Auto-provisioning engine.
 *
 * Called by every payment webhook after a successful payment is confirmed.
 * Flow:
 *   1. Find the customer by phone number in isp_customers
 *   2. Load their plan from isp_plans
 *   3. Load the router assigned to that plan from isp_routers
 *   4. Create / enable the account on the MikroTik router (PPPoE or Hotspot)
 *   5. Update customer status + expiry in Supabase
 *   6. Record the transaction in isp_transactions
 *   7. Log the event in isp_webhook_events (best-effort)
 */

import { sbSelect, sbInsert, sbUpdate } from "./supabase-client";
import { addPPPSecret, updatePPPSecret, addHotspotUser, updateHotspotUser } from "./mikrotik";
import { logger } from "./logger";

/* ── Supabase row shapes ────────────────────────────────────────────────── */
interface SbCustomer {
  id: number;
  admin_id: number;
  name: string | null;
  username: string | null;
  password: string | null;
  phone: string | null;
  type: string | null;
  plan_id: number | null;
  status: string;
  pppoe_username: string | null;
  expires_at: string | null;
}

interface SbPlan {
  id: number;
  name: string;
  type: string;
  plan_type: string;
  validity_days: number;
  router_id: number | null;
}

interface SbRouter {
  id: number;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
}

/* ── Result type ─────────────────────────────────────────────────────────── */
export interface ProvisionResult {
  ok: boolean;
  customerId?: number;
  customerName?: string;
  action?: "created" | "renewed" | "enabled";
  planName?: string;
  routerName?: string;
  error?: string;
}

/* ── Normalize phone: strip leading zeros, country codes → raw digits ─────── */
function normalizePhone(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const variants: string[] = [digits];

  /* Kenya: 254XXXXXXXXX → 07XXXXXXXX */
  if (digits.startsWith("254") && digits.length === 12) {
    variants.push("0" + digits.slice(3));
    variants.push(digits.slice(3)); /* 7XXXXXXXX */
  }
  /* 07XXXXXXXX → 254XXXXXXXXX */
  if (digits.startsWith("07") && digits.length === 10) {
    variants.push("254" + digits.slice(1));
    variants.push(digits.slice(1)); /* 7XXXXXXXX */
  }
  /* +2547XXXXXXXX */
  if (digits.startsWith("2547") && digits.length === 12) {
    variants.push("0" + digits.slice(3));
  }
  return [...new Set(variants)];
}

/* ── Calculate expiry date based on plan validity ─────────────────────────── */
function calcExpiry(validityDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(validityDays, 1));
  return d.toISOString();
}

/* ── Log webhook event (best-effort — table may not exist yet) ───────────── */
async function logEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    await sbInsert("isp_webhook_events", {
      ...payload,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* Table not yet created — silently ignore */
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Main entry point
 * ═══════════════════════════════════════════════════════════════════════════ */
export async function autoProvision(opts: {
  phone:         string;
  amount:        number;
  reference:     string;
  paymentMethod: string;
  gateway:       string;
  adminId?:      number;
}): Promise<ProvisionResult> {
  const { phone, amount, reference, paymentMethod, gateway, adminId } = opts;
  const phoneVariants = normalizePhone(phone);

  logger.info({ phone, phoneVariants, amount, reference, gateway }, "[provision] Starting auto-provision");

  /* ── 1. Find customer by phone ── */
  let customer: SbCustomer | null = null;
  for (const p of phoneVariants) {
    const filter = adminId
      ? `phone=eq.${p}&admin_id=eq.${adminId}&select=*&limit=1`
      : `phone=eq.${p}&select=*&limit=1`;
    const rows = await sbSelect<SbCustomer>("isp_customers", filter);
    if (rows.length) { customer = rows[0]; break; }
  }

  if (!customer) {
    const msg = `No customer found for phone variants: ${phoneVariants.join(", ")}`;
    logger.warn({ phone }, `[provision] ${msg}`);
    await logEvent({ event: "provision_failed", gateway, reference, phone, amount, error: msg });
    return { ok: false, error: msg };
  }

  /* ── 2. Load plan ── */
  if (!customer.plan_id) {
    const msg = `Customer ${customer.id} has no plan assigned`;
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
    return { ok: false, error: msg };
  }

  const plans = await sbSelect<SbPlan>(
    "isp_plans",
    `id=eq.${customer.plan_id}&select=id,name,type,plan_type,validity_days,router_id&limit=1`
  );
  const plan = plans[0];
  if (!plan) {
    const msg = `Plan ${customer.plan_id} not found`;
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
    return { ok: false, error: msg };
  }

  /* ── 3. Load router ── */
  if (!plan.router_id) {
    /* No router assigned — still record the transaction but skip router provisioning */
    logger.warn({ planId: plan.id }, "[provision] Plan has no router_id — skipping router provisioning");
    await recordTransaction(customer, amount, paymentMethod, reference, plan);
    await activateCustomer(customer, plan);
    return { ok: true, customerId: customer.id, customerName: customer.name ?? "", planName: plan.name, action: "renewed" };
  }

  const routers = await sbSelect<SbRouter & { name: string }>(
    "isp_routers",
    `id=eq.${plan.router_id}&select=id,name,host,bridge_ip,router_username,router_secret&limit=1`
  );
  const router = routers[0];
  if (!router || (!router.host && !router.bridge_ip)) {
    const msg = `Router ${plan.router_id} not found or has no IP`;
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
    return { ok: false, error: msg };
  }

  const creds = {
    host:     router.host?.trim() || "",
    port:     8728,
    username: router.router_username || "admin",
    password: router.router_secret  || "",
    useSSL:   false,
    bridgeIp: router.bridge_ip?.trim() || undefined,
  };

  /* ── 4. Provision on router ── */
  const planType = (plan.plan_type || plan.type || "hotspot").toLowerCase();
  const username = customer.pppoe_username || customer.username || `user_${customer.id}`;
  const password = customer.password || "changeme";
  const comment  = `ISP Auto-provision — ${reference}`;
  let action: "created" | "renewed" | "enabled" = "created";

  try {
    if (planType === "pppoe") {
      /* Try to update first; if that fails, create */
      try {
        await updatePPPSecret(creds, username, { disabled: false, comment });
        action = "enabled";
      } catch {
        try {
          await addPPPSecret(creds, { name: username, password, profile: plan.name, service: "pppoe", comment });
          action = "created";
        } catch (e2) {
          /* Might already exist — try enable again */
          logger.warn({ err: (e2 as Error).message }, "[provision] PPP add failed, trying set again");
          await updatePPPSecret(creds, username, { disabled: false });
          action = "renewed";
        }
      }
    } else {
      /* Hotspot */
      try {
        await updateHotspotUser(creds, username, { disabled: false, comment });
        action = "enabled";
      } catch {
        try {
          await addHotspotUser(creds, { name: username, password, profile: plan.name, comment });
          action = "created";
        } catch (e2) {
          logger.warn({ err: (e2 as Error).message }, "[provision] Hotspot add failed, trying update again");
          await updateHotspotUser(creds, username, { disabled: false });
          action = "renewed";
        }
      }
    }

    logger.info({ username, planType, action, router: router.name }, "[provision] Router account provisioned");
  } catch (routerErr) {
    /* Router unreachable — still record the payment but flag the error */
    const msg = `Router provisioning failed: ${(routerErr as Error).message}`;
    logger.error({ err: routerErr }, "[provision] Router provisioning error");
    await recordTransaction(customer, amount, paymentMethod, reference, plan);
    await activateCustomer(customer, plan);
    await logEvent({
      event: "provision_router_error", gateway, reference,
      customer_id: customer.id, plan_id: plan.id, router_id: router.id,
      error: msg, amount,
    });
    return { ok: false, customerId: customer.id, error: msg };
  }

  /* ── 5. Update customer in Supabase ── */
  await activateCustomer(customer, plan);

  /* ── 6. Record transaction ── */
  await recordTransaction(customer, amount, paymentMethod, reference, plan);

  /* ── 7. Log success ── */
  await logEvent({
    event: "provision_success", gateway, reference,
    customer_id: customer.id, plan_id: plan.id, router_id: router.id,
    action, amount, username,
  });

  return {
    ok: true,
    customerId:   customer.id,
    customerName: customer.name ?? username,
    action,
    planName:     plan.name,
    routerName:   router.name,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
async function activateCustomer(customer: SbCustomer, plan: SbPlan): Promise<void> {
  await sbUpdate("isp_customers", `id=eq.${customer.id}`, {
    status:     "active",
    expires_at: calcExpiry(plan.validity_days),
    updated_at: new Date().toISOString(),
  });
}

async function recordTransaction(
  customer: SbCustomer,
  amount: number,
  paymentMethod: string,
  reference: string,
  plan: SbPlan,
): Promise<void> {
  await sbInsert("isp_transactions", {
    admin_id:       customer.admin_id,
    customer_id:    customer.id,
    plan_id:        plan.id,
    amount,
    payment_method: paymentMethod,
    reference,
    status:         "completed",
    notes:          `Auto-provisioned via webhook — Plan: ${plan.name}`,
    created_at:     new Date().toISOString(),
  });
}
