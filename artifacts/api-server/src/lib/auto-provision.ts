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

import { randomBytes } from "node:crypto";
import { kenyanMobilePhoneVariants } from "./kenyan-phone";
import { sbSelect, sbSelectStrict, sbInsert, sbUpdate, sbUpdateStrict } from "./supabase-client";
import {
  addPPPSecret,
  fetchPPPSecrets,
  removePPPSecret,
  updatePPPSecret,
  addHotspotUser,
  updateHotspotUser,
  resetHotspotUserCounters,
  disconnectHotspotActiveUser,
  requireHotspotUserProfile,
  scheduleHotspotUserExpiry,
  scheduleHotspotUserFup,
  removeHotspotUserFup,
  schedulePppUserExpiry,
  reconcileVlanCustomerQueue,
  reconcileHotspotUserAccess,
  classifyRouterConnectionFailure,
} from "./mikrotik";
import { logger } from "./logger";
import { isRouterManagementVpnIp } from "./router-vpn-ip.js";
import { hotspotPlanProfileName, prepaidHotspotUsername, routerRateLimit, isPrepaidHotspotUsername } from "./prepaid-identifiers.js";
import { planValiditySeconds } from "./plan-validity.js";
import { normalizePlanServiceType } from "./plan-service-type.js";
import { dataLimitMegabytesToBytes, validateFupPolicy } from "./fup-policy.js";
import { isValidIpv4, isValidVlanTag, ipv4InSubnet } from "./vlan-customer-queue.js";
import { portServiceResourceNames } from "./port-service-resources.js";

/* ── Supabase row shapes ────────────────────────────────────────────────── */
interface SbCustomer {
  id: number;
  admin_id: number;
  name: string | null;
  username: string | null;
  password: string | null;
  phone: string | null;
  mac_address: string | null;
  ip_address: string | null;
  type: string | null;
  plan_id: number | null;
  status: string;
  pppoe_username: string | null;
  expires_at: string | null;
  router_id?: number | null;
  port_id?: number | null;
}

interface SbPlan {
  id: number;
  admin_id?: number;
  name: string;
  type: string;
  price: number;
  validity: number | null;
  validity_unit: string | null;
  validity_days: number;
  router_id: number | null;
  port_id: number | null;
  speed_down: number | null;
  speed_up: number | null;
  speed_down_unit: string | null;
  owner_reseller_id?: number | null;
  speed_up_unit: string | null;
  data_limit_mb: number | null;
  data_cap_mode: string | null;
  fup_speed_down: number | null;
  fup_speed_up: number | null;
  shared_users?: number | null;
  active_ip_pool: string | null;
  expired_ip_pool: string | null;
}

interface SbRouter {
  id: number;
  name?: string;
  host: string;
  bridge_ip: string | null;
  vpn_ip: string | null;
  router_username: string;
  router_secret: string | null;
}

interface SbVlanPort {
  id: number;
  admin_id: number;
  router_id: number;
  interface_name: string;
  bridge_name: string | null;
  handoff_mode: "vlan_services";
  reseller_id: number | null;
  assigned_reseller_id: number | null;
  vlan_tag: string | null;
  subnet_range: string | null;
  status: string;
  hotspot_enabled?: boolean;
}

async function ensureVlanHotspotCredentials(customer: SbCustomer): Promise<{ username: string; password: string }> {
  const username = String(customer.username ?? "").trim() || `vlan_${randomBytes(10).toString("hex")}`;
  const password = String(customer.password ?? "") || randomBytes(18).toString("base64url");
  if (customer.username !== username || customer.password !== password) {
    const saved = await sbUpdateStrict<SbCustomer>(
      "isp_customers",
      `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`,
      { username, password, updated_at: new Date().toISOString() },
    );
    if (saved[0]?.username !== username || saved[0]?.password !== password) {
      throw new Error("The VLAN Hotspot login could not be saved before router activation.");
    }
    customer.username = username;
    customer.password = password;
  }
  return { username, password };
}

export interface PppoeRenewalAccessResult {
  ok: boolean;
  skipped?: boolean;
  routerName?: string;
  username?: string;
  expiresAt?: string;
  routerId?: number;
  portId?: number;
  error?: string;
  rollback?: () => Promise<void>;
}

/**
 * Re-enable the RouterOS account for a verified PPPoE renewal.
 *
 * This is intentionally separate from autoProvision: the M-Pesa callback has
 * already created the pending transaction and must not record a second
 * transaction while it restores access. The callback invokes this before the
 * atomic Supabase settlement, so a temporarily unreachable router leaves the
 * payment pending for the deferred retry worker instead of creating a
 * database-active/router-disabled mismatch.
 */
export async function reactivatePppoeAccess(opts: {
  adminId: number;
  customerId: number;
  planId: number;
  reference: string;
}): Promise<PppoeRenewalAccessResult> {
  const plans = await sbSelect<{
    id: number;
    admin_id: number;
    name: string;
    type: string | null;
    router_id: number | null;
    port_id: number | null;
    owner_reseller_id: number | null;
  }>(
    "isp_plans",
    `id=eq.${opts.planId}&admin_id=eq.${opts.adminId}&select=id,admin_id,name,type,router_id,port_id,owner_reseller_id&limit=1`,
  );
  const plan = plans[0];
  const planType = String(plan?.type ?? "").toLowerCase();
  if (!plan || planType !== "pppoe") return { ok: true, skipped: true };
  if (!plan.router_id) {
    return { ok: false, error: "The PPPoE plan is not assigned to a router." };
  }

  const customers = await sbSelect<Pick<SbCustomer, "id" | "admin_id" | "type" | "username" | "pppoe_username" | "password" | "router_id" | "port_id">>(
    "isp_customers",
    `id=eq.${opts.customerId}&admin_id=eq.${plan.owner_reseller_id ?? opts.adminId}&type=eq.pppoe&select=id,admin_id,type,username,pppoe_username,password,router_id,port_id&limit=1`,
  );
  const customer = customers[0];
  if (!customer) {
    return { ok: false, error: "The verified PPPoE customer account was not found." };
  }
  if (customer.router_id !== plan.router_id || customer.port_id !== plan.port_id) {
    return { ok: false, error: "The PPPoE customer service port does not match the selected plan." };
  }

  const routers = await sbSelect<SbRouter>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${opts.adminId}&select=id,name,host,vpn_ip,bridge_ip,router_username,router_secret&limit=1`,
  );
  const router = routers[0];
  const vpnIp = isRouterManagementVpnIp(router?.vpn_ip) ? router.vpn_ip!.trim() : "";
  const host = router?.host?.trim() || vpnIp;
  if (!router || !host) {
    return { ok: false, error: "The PPPoE router has no public host or management VPN address." };
  }

  const username = customer.pppoe_username?.trim() || customer.username?.trim() || "";
  if (!username) return { ok: false, error: "The PPPoE customer has no username to reactivate." };

  const credentials = {
    host,
    port: 8728,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    useSSL: false,
    bridgeIp: vpnIp || undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
  const comment = `M-Pesa verified PPPoE renewal — ${opts.reference}`;

  try {
    const secrets = await fetchPPPSecrets(credentials);
    const existing = secrets.find(secret => secret.name === username);
    const rollback = async (): Promise<void> => {
      if (existing?.id) {
        await updatePPPSecret(credentials, existing.id, {
          disabled: existing.disabled,
          profile: existing.profile,
          comment: existing.comment,
        });
        return;
      }
      const current = await fetchPPPSecrets(credentials);
      const created = current.find(secret => secret.name === username);
      if (created?.id) await removePPPSecret(credentials, created.id);
    };
    if (existing?.id) {
      await updatePPPSecret(credentials, existing.id, {
        disabled: false,
        profile: plan.name,
        comment,
      });
    } else {
      await addPPPSecret(credentials, {
        name: username,
        password: customer.password || "changeme",
        profile: plan.name,
        service: "pppoe",
        comment,
      });
    }

    const verified = await fetchPPPSecrets(credentials);
    const restored = verified.find(secret => secret.name === username && !secret.disabled);
    if (!restored) throw new Error("RouterOS did not report the PPPoE account as enabled.");

    return { ok: true, routerName: router.name, username, rollback };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnosis = classifyRouterConnectionFailure(error);
    logger.warn(
      {
        err: message,
        failureProfile: diagnosis.profile,
        failureSummary: diagnosis.summary,
        customerId: opts.customerId,
        planId: opts.planId,
      },
      "[provision] PPPoE renewal access restore failed",
    );
    return { ok: false, error: `Router PPPoE access could not be restored: ${message}` };
  }
}

export async function reactivateVlanAccess(opts: {
  adminId: number;
  customerId: number;
  planId: number;
  reference: string;
}): Promise<PppoeRenewalAccessResult> {
  const plans = await sbSelect<SbPlan>(
    "isp_plans",
    `id=eq.${opts.planId}&admin_id=eq.${opts.adminId}&select=id,admin_id,name,type,validity,validity_unit,validity_days,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,owner_reseller_id&limit=1`,
  );
  const plan = plans[0];
  if (!plan || normalizePlanServiceType(plan.type) !== "vlan") {
    return { ok: true, skipped: true };
  }
  if (!plan.router_id || !plan.port_id) {
    return { ok: false, error: "The VLAN plan is not assigned to a router and service port." };
  }

  const customers = await sbSelect<SbCustomer>(
    "isp_customers",
    `id=eq.${opts.customerId}&admin_id=eq.${plan.owner_reseller_id ?? opts.adminId}&type=eq.vlan&select=id,admin_id,name,username,password,mac_address,type,ip_address,router_id,port_id,status,expires_at&limit=1`,
  );
  const customer = customers[0];
  if (!customer || !isValidIpv4(customer.ip_address)) {
    return { ok: false, error: "The verified VLAN customer account or its assigned static IP was not found." };
  }
  if (
    customer.router_id !== plan.router_id
    || customer.port_id !== plan.port_id
  ) {
    return { ok: false, error: "The VLAN customer router and port do not match the selected plan." };
  }

  const ports = await sbSelect<SbVlanPort>(
    "isp_reseller_ports",
    `id=eq.${plan.port_id}&admin_id=eq.${opts.adminId}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled&limit=1`,
  );
  const port = ports[0];
  const ownerId = port?.assigned_reseller_id ?? port?.reseller_id;
  if (
    !port
    || !isValidVlanTag(port.vlan_tag)
    || !Number.isSafeInteger(ownerId)
    || Number(ownerId) < 1
    || !ipv4InSubnet(customer.ip_address, port.subnet_range)
  ) {
    return { ok: false, error: "The VLAN service port, tag, or assigned customer IP is no longer valid." };
  }
  const resources = portServiceResourceNames(port);
  const routers = await sbSelect<SbRouter>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${opts.adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  );
  const router = routers[0];
  const vpnIp = isRouterManagementVpnIp(router?.vpn_ip) ? router.vpn_ip!.trim() : "";
  const host = router?.host?.trim() || vpnIp;
  if (!router || !host) {
    return { ok: false, error: "The VLAN router has no public host or management VPN address." };
  }
  const credentials = {
    host,
    port: 8728,
    username: router.router_username || "admin",
    password: router.router_secret || "",
    useSSL: false,
    bridgeIp: vpnIp || router.bridge_ip?.trim() || undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
  let hotspotLogin: { username: string; password: string } | undefined;
  if (port.hotspot_enabled) {
    try {
      hotspotLogin = await ensureVlanHotspotCredentials(customer);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The VLAN Hotspot login could not be prepared.",
      };
    }
  }
  const expiresAt = calcExpiry(plan.validity, plan.validity_unit, plan.validity_days);
  const wasEnabled = customer.status === "active" &&
    (!customer.expires_at || Date.parse(customer.expires_at) > Date.now());
  const oldExpiry = customer.expires_at;
  const maxLimit = hotspotRateLimit(plan) ?? "0/0";
  const limitBytesTotal = Number(plan.data_limit_mb) > 0
    ? String(Math.floor(Number(plan.data_limit_mb) * 1_000_000))
    : undefined;
  const restoreAccess = async (): Promise<void> => {
    const restoreEnabled = wasEnabled && (!oldExpiry || Date.parse(oldExpiry) > Date.now());
    const errors: string[] = [];
    await reconcileVlanCustomerQueue(credentials, {
      adminId: opts.adminId,
      customerId: customer.id,
      ipAddress: customer.ip_address!,
      parentQueue: resources.parentQueue,
      parentComment: `${resources.commentPrefix}_parent_queue`,
      maxLimit,
      enabled: restoreEnabled,
      expiresAt: oldExpiry,
    }).catch(error => errors.push(error instanceof Error ? error.message : String(error)));
    if (hotspotLogin) await reconcileHotspotUserAccess(credentials, {
      name: hotspotLogin.username,
      password: hotspotLogin.password,
      profile: resources.hotspotProfile,
      server: resources.hotspotServer,
      comment: `OcholaSupernet VLAN customer ${opts.adminId}:${customer.id}`,
      expiresAt: oldExpiry,
      enabled: restoreEnabled,
      address: customer.ip_address,
      macAddress: customer.mac_address,
      limitBytesTotal,
      resetCounters: false,
      preserveActiveSession: true,
    }).catch(error => errors.push(error instanceof Error ? error.message : String(error)));
    if (errors.length) throw new Error(errors.join("; "));
  };

  try {
    await reconcileVlanCustomerQueue(credentials, {
      adminId: opts.adminId,
      customerId: customer.id,
      ipAddress: customer.ip_address,
      parentQueue: resources.parentQueue,
      parentComment: `${resources.commentPrefix}_parent_queue`,
      maxLimit,
      enabled: true,
      expiresAt,
    });
    if (hotspotLogin) await reconcileHotspotUserAccess(credentials, {
      name: hotspotLogin.username,
      password: hotspotLogin.password,
      profile: resources.hotspotProfile,
      server: resources.hotspotServer,
      comment: `OcholaSupernet VLAN customer ${opts.adminId}:${customer.id}`,
      expiresAt,
      enabled: true,
      address: customer.ip_address,
      macAddress: customer.mac_address,
      limitBytesTotal,
      sharedUsers: Number(plan.shared_users) || 1,
      resetCounters: false,
      preserveActiveSession: true,
    });
    const rollback = async (): Promise<void> => {
      await restoreAccess();
    };
    return { ok: true, routerName: router.name, routerId: router.id, portId: plan.port_id, expiresAt, rollback };
  } catch (error) {
    const recoveryErrors: string[] = [];
    await restoreAccess().catch(restoreError => recoveryErrors.push(
      restoreError instanceof Error ? restoreError.message : String(restoreError),
    ));
    const message = error instanceof Error ? error.message : String(error);
    const diagnosis = classifyRouterConnectionFailure(error);
    logger.warn(
      { err: message, failureProfile: diagnosis.profile, customerId: opts.customerId, planId: opts.planId, recoveryErrors },
      "[provision] VLAN renewal access restore failed",
    );
    return {
      ok: false,
      error: `Router VLAN Hotspot access could not be restored: ${message}${
        recoveryErrors.length ? ` Recovery requires administrator attention: ${recoveryErrors.join("; ")}` : ""
      }`,
    };
  }
}

/* ── Result type ─────────────────────────────────────────────────────────── */
export interface ProvisionResult {
  ok: boolean;
  customerId?: number;
  customerName?: string;
  action?: "created" | "renewed" | "enabled" | "already_processed";
  planName?: string;
  routerName?: string;
  error?: string;
}

/* ── Normalize phone: strip leading zeros, country codes → raw digits ─────── */
function normalizePhone(raw: string): string[] {
  const kenyanVariants = kenyanMobilePhoneVariants(raw);
  if (kenyanVariants.length > 0) return kenyanVariants;

  const digits = raw.replace(/\D/g, "");
  const variants: string[] = [digits];

  /* Kenya: 254XXXXXXXXX → local and subscriber-number variants */
  if (digits.startsWith("254") && digits.length === 12) {
    variants.push("0" + digits.slice(3));
    variants.push(digits.slice(3)); /* 7XXXXXXXX */
  }
  /* 07XXXXXXXX / 01XXXXXXXX → 254XXXXXXXXX */
  if (/^0[17]\d{8}$/.test(digits)) {
    variants.push("254" + digits.slice(1));
    variants.push(digits.slice(1));
  }
  /* +254[17]XXXXXXXX */
  if (/^254[17]\d{8}$/.test(digits)) {
    variants.push("0" + digits.slice(3));
  }
  return [...new Set(variants)];
}

/* ── Calculate expiry date based on plan validity ─────────────────────────── */
function calcExpiry(validity: number | null, validityUnit?: string | null, legacyValidityDays?: number | null): string {
  const d = new Date();
  const configuredValidity = Number(validity ?? legacyValidityDays ?? 0);
  const seconds = planValiditySeconds(configuredValidity, validityUnit);
  d.setTime(d.getTime() + Math.max(seconds, 1) * 1000);
  return d.toISOString();
}

function hotspotRateLimit(plan: SbPlan): string | undefined {
  return routerRateLimit(
    plan.speed_down,
    plan.speed_up,
    plan.speed_down_unit ?? "Mbps",
    plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
  );
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
  customerId?:   number;
}): Promise<ProvisionResult> {
  const { phone, amount, reference: rawReference, paymentMethod, gateway, adminId, customerId } = opts;
  const reference = String(rawReference ?? "").trim();
  const phoneVariants = normalizePhone(phone);

  logger.info({ phone, phoneVariants, amount, reference, gateway }, "[provision] Starting auto-provision");
  if (!reference) {
    const msg = "A verified payment reference is required.";
    await logEvent({ event: "provision_failed", gateway, phone, amount, error: msg });
    return { ok: false, error: msg };
  }

  /* ── 1. Find customer by phone ── */
  let customer: SbCustomer | null = null;
  const matchingCustomers = new Map<number, SbCustomer>();
  for (const p of phoneVariants) {
    const filter = customerId
      ? `id=eq.${customerId}${adminId ? `&admin_id=eq.${adminId}` : ""}&select=*&limit=1`
      : adminId
        ? `phone=eq.${p}&admin_id=eq.${adminId}&select=*&limit=100`
        : `phone=eq.${p}&select=*&limit=100`;
    const rows = await sbSelect<SbCustomer>("isp_customers", filter);
    for (const row of rows) matchingCustomers.set(row.id, row);
    if (customerId && rows.length) break;
  }
  const candidates = [...matchingCustomers.values()];
  const vlanCandidates = candidates.filter(row => String(row.type ?? "").toLowerCase() === "vlan");
  customer = candidates[0] ?? null;
  if (!customerId && vlanCandidates.length > 0 && candidates.length > 1) {
    const msg = "Multiple customer accounts share this payment phone. Select the intended VLAN customer account before renewing service.";
    await logEvent({ event: "provision_failed", gateway, reference, phone, amount, error: msg });
    return { ok: false, error: msg };
  }
  if (!customer) {
    const msg = `No customer found for phone variants: ${phoneVariants.join(", ")}`;
    logger.warn({ phone }, `[provision] ${msg}`);
    await logEvent({ event: "provision_failed", gateway, reference, phone, amount, error: msg });
    return { ok: false, error: msg };
  }
  if (
    customerId
    && !phoneVariants.some(variant => normalizePhone(customer.phone ?? "").includes(variant))
  ) {
    const msg = "The selected customer account does not match the payment phone number.";
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
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
    `id=eq.${customer.plan_id}&admin_id=eq.${customer.admin_id}&select=id,admin_id,name,type,price,validity,validity_unit,validity_days,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,active_ip_pool,expired_ip_pool&limit=1`
  );
  const plan = plans[0];
  if (!plan) {
    const msg = `Plan ${customer.plan_id} not found`;
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
    return { ok: false, error: msg };
  }

  const receivedAmount = Number(amount);
  const expectedAmount = Number(plan.price);
  if (
    !Number.isFinite(receivedAmount)
    || receivedAmount <= 0
    || !Number.isFinite(expectedAmount)
    || expectedAmount <= 0
    || Math.round(receivedAmount * 100) !== Math.round(expectedAmount * 100)
  ) {
    const msg = "The verified payment amount does not match the assigned plan price.";
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, plan_id: plan.id, amount, error: msg });
    return { ok: false, error: msg };
  }

  const priorTransactions = await sbSelect<{
    id: number;
    customer_id: number | null;
    plan_id: number | null;
    status: string;
    notes: string | null;
  }>(
    "isp_transactions",
    `admin_id=eq.${customer.admin_id}&payment_method=eq.${encodeURIComponent(paymentMethod)}&reference=eq.${encodeURIComponent(reference)}&select=id,customer_id,plan_id,status,notes&limit=1`,
  );
  const priorTransaction = priorTransactions[0];
  if (priorTransaction) {
    if (priorTransaction.customer_id !== customer.id || priorTransaction.plan_id !== plan.id) {
      const msg = "This payment reference has already been used for a different account or plan.";
      await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, plan_id: plan.id, error: msg });
      return { ok: false, error: msg };
    }
    if (priorTransaction.status === "completed" && priorTransaction.notes?.startsWith("Router provisioning pending:")) {
      const msg = "Payment is already recorded, but router access is pending administrator action.";
      await logEvent({ event: "provision_router_pending_duplicate", gateway, reference, customer_id: customer.id, plan_id: plan.id });
      return { ok: false, customerId: customer.id, error: msg };
    }
    if (priorTransaction.status === "completed") {
      return {
        ok: true,
        customerId: customer.id,
        customerName: customer.name ?? "",
        planName: plan.name,
        action: "already_processed",
      };
    }
    const msg = "This payment reference is already being processed.";
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, plan_id: plan.id, error: msg });
    return { ok: false, error: msg };
  }

  const expiresAt = calcExpiry(plan.validity, plan.validity_unit, plan.validity_days);
  const planType = normalizePlanServiceType(plan.type || "hotspot");
  const adminSuspended = customer.status === "suspended";
  const priorExpiryMs = customer.expires_at ? Date.parse(customer.expires_at) : NaN;
  const hadUnexpiredHotspotAccess = planType === "hotspot"
    && !adminSuspended
    && (customer.status === "active" || customer.status === "payment_cleared_router_pending")
    && (!customer.expires_at || (Number.isFinite(priorExpiryMs) && priorExpiryMs > Date.now()));
  if (planType === "vlan") {
    if (String(customer.type ?? "").toLowerCase() !== "vlan") {
      const msg = "A VLAN plan can only renew an existing VLAN customer account.";
      await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
      return { ok: false, error: msg };
    }
    if (!plan.router_id || !plan.port_id) {
      const msg = "The VLAN plan must be assigned to a router and VLAN service port before renewal.";
      await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
      return { ok: false, error: msg };
    }
    if (
      (customer.router_id && customer.router_id !== plan.router_id)
      || (customer.port_id && customer.port_id !== plan.port_id)
    ) {
      const msg = "The VLAN customer's saved router and port do not match the selected plan.";
      await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
      return { ok: false, error: msg };
    }
    if (!isValidIpv4(customer.ip_address)) {
      const msg = "The VLAN customer has no valid assigned static IPv4 address.";
      await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
      return { ok: false, error: msg };
    }
  }

  /* ── 3. Load router ── */
  if (!plan.router_id) {
    const msg = "The selected plan is not assigned to a router; access was not activated.";
    await recordTransaction(customer, amount, paymentMethod, reference, plan, `Router provisioning pending: ${msg}`);
    await sbUpdate("isp_customers", `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`, {
      status: "payment_cleared_router_pending",
      plan_id: plan.id,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    await logEvent({ event: "provision_router_error", gateway, reference, customer_id: customer.id, plan_id: plan.id, error: msg, amount });
    return { ok: false, customerId: customer.id, error: msg };
  }

  const routers = await sbSelect<SbRouter & { name: string }>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${customer.admin_id}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`
  );
  const router = routers[0];
   if (!router || (!router.host && !router.bridge_ip && !router.vpn_ip)) {
    const msg = `Router ${plan.router_id} not found or has no IP`;
    await logEvent({ event: "provision_failed", gateway, reference, customer_id: customer.id, error: msg });
    return { ok: false, error: msg };
  }

  const creds = {
    host:     router.host?.trim() || router.vpn_ip?.trim() || "",
    port:     8728,
    username: router.router_username || "admin",
    password: router.router_secret  || "",
    useSSL:   false,
    bridgeIp: router.vpn_ip?.trim() || router.bridge_ip?.trim() || undefined,
  };

  /* ── 4. Provision on router ── */
  const generatedHotspotUsername = prepaidHotspotUsername(customer.phone || phone, customer.mac_address);
  const username = planType === "vlan"
    ? ""
    : planType === "pppoe"
    ? (customer.pppoe_username || customer.username || `user_${customer.id}`)
    : (customer.username || generatedHotspotUsername || (isPrepaidHotspotUsername(customer.username) ? customer.username! : `${customer.id}-00:00`));
  const password = customer.password || "changeme";
  const comment  = username;
  const profileName = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
  let action: "created" | "renewed" | "enabled" = "created";
  let vlanRollback: (() => Promise<void>) | undefined;
  let vlanMutationAttempted = false;

  try {
    if (planType === "vlan") {
      const ports = await sbSelect<SbVlanPort>(
        "isp_reseller_ports",
        `id=eq.${plan.port_id}&admin_id=eq.${customer.admin_id}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled&limit=1`,
      );
      const port = ports[0];
      const ownerId = port?.assigned_reseller_id ?? port?.reseller_id;
      if (
        !port
        || !isValidVlanTag(port.vlan_tag)
        || !Number.isSafeInteger(ownerId)
        || Number(ownerId) < 1
        || !ipv4InSubnet(customer.ip_address, port.subnet_range)
      ) {
        throw new Error("The VLAN service port, VLAN tag, or assigned customer IP is no longer valid.");
      }
      const resources = portServiceResourceNames(port);
      const hotspotLogin = port.hotspot_enabled
        ? await ensureVlanHotspotCredentials(customer)
        : undefined;
      const wasEnabled = customer.status === "active" &&
        (!customer.expires_at || Date.parse(customer.expires_at) > Date.now());
      const oldExpiry = customer.expires_at;
      const maxLimit = hotspotRateLimit(plan) ?? "0/0";
      const limitBytesTotal = Number(plan.data_limit_mb) > 0
        ? String(Math.floor(Number(plan.data_limit_mb) * 1_000_000))
        : undefined;
      vlanRollback = async () => {
        const restoreEnabled = wasEnabled && (!oldExpiry || Date.parse(oldExpiry) > Date.now());
        const errors: string[] = [];
        await reconcileVlanCustomerQueue(creds, {
          adminId: customer.admin_id,
          customerId: customer.id,
          ipAddress: customer.ip_address!,
          parentQueue: resources.parentQueue,
          parentComment: `${resources.commentPrefix}_parent_queue`,
          maxLimit,
          enabled: restoreEnabled,
          expiresAt: oldExpiry,
        }).catch(error => errors.push(error instanceof Error ? error.message : String(error)));
        if (hotspotLogin) await reconcileHotspotUserAccess(creds, {
          name: hotspotLogin.username,
          password: hotspotLogin.password,
          profile: resources.hotspotProfile,
          server: resources.hotspotServer,
          comment: `OcholaSupernet VLAN customer ${customer.admin_id}:${customer.id}`,
          expiresAt: oldExpiry,
          enabled: restoreEnabled,
          address: customer.ip_address,
          macAddress: customer.mac_address,
          limitBytesTotal,
          resetCounters: false,
          preserveActiveSession: true,
        }).catch(error => errors.push(error instanceof Error ? error.message : String(error)));
        if (errors.length) throw new Error(errors.join("; "));
      };
      vlanMutationAttempted = true;
      await reconcileVlanCustomerQueue(creds, {
        adminId: customer.admin_id,
        customerId: customer.id,
        ipAddress: customer.ip_address!,
        parentQueue: resources.parentQueue,
        parentComment: `${resources.commentPrefix}_parent_queue`,
        maxLimit,
        enabled: true,
        expiresAt,
      });
      if (hotspotLogin) await reconcileHotspotUserAccess(creds, {
        name: hotspotLogin.username,
        password: hotspotLogin.password,
        profile: resources.hotspotProfile,
        server: resources.hotspotServer,
        comment: `OcholaSupernet VLAN customer ${customer.admin_id}:${customer.id}`,
        expiresAt,
        enabled: true,
        address: customer.ip_address,
        macAddress: customer.mac_address,
        limitBytesTotal,
        sharedUsers: Number(plan.shared_users) || 1,
        resetCounters: false,
        preserveActiveSession: true,
      });
      action = "renewed";
    } else if (planType === "pppoe") {
      /* Try to update first; if that fails, create */
      try {
        await updatePPPSecret(creds, username, { disabled: false, profile: profileName, comment });
        action = "enabled";
      } catch {
        try {
          await addPPPSecret(creds, { name: username, password, profile: profileName, service: "pppoe", comment });
          action = "created";
        } catch (e2) {
          /* Might already exist — try enable again */
          logger.warn({ err: (e2 as Error).message }, "[provision] PPP add failed, trying set again");
          await updatePPPSecret(creds, username, { disabled: false, profile: profileName });
          action = "renewed";
        }
      }
      await schedulePppUserExpiry(creds, {
        name: username,
        expiresInSeconds: Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
      });
    } else {
      /* Hotspot */
      const profile = profileName;
      const rawDataLimitMb = Number(plan.data_limit_mb);
      const dataLimitMb = Number.isFinite(rawDataLimitMb) && rawDataLimitMb > 0 ? rawDataLimitMb : null;
      const dataPolicy = validateFupPolicy(
        plan.type,
        dataLimitMb,
        plan.data_cap_mode ?? "disconnect",
        plan.fup_speed_down,
        plan.fup_speed_up,
        plan.speed_down,
        plan.speed_up,
        plan.speed_down_unit,
        plan.speed_up_unit,
      );
      const limitBytesTotal = dataPolicy.dataCapMode === "throttle" || dataLimitMb === null
        ? "0"
        : String(dataLimitMegabytesToBytes(dataLimitMb));
      await requireHotspotUserProfile(creds, profile);
      await scheduleHotspotUserExpiry(creds, {
        name: username,
        expiresInSeconds: Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
      });
      try {
        await updateHotspotUser(creds, username, {
          disabled: adminSuspended, profile, comment, limitBytesTotal,
          address: customer.ip_address || undefined,
        });
        action = "enabled";
      } catch {
        try {
          await addHotspotUser(creds, {
            name: username,
            password,
            profile,
            comment,
            disabled: adminSuspended,
            address: customer.ip_address || undefined,
            limitBytesTotal,
          });
          action = "created";
        } catch (e2) {
          logger.warn({ err: (e2 as Error).message }, "[provision] Hotspot add failed, trying update again");
          await updateHotspotUser(creds, username, {
            disabled: adminSuspended,
            profile,
            comment,
            address: customer.ip_address || undefined,
            limitBytesTotal,
          });
          action = "renewed";
        }
      }
      if (!hadUnexpiredHotspotAccess) await disconnectHotspotActiveUser(creds, username);
      await resetHotspotUserCounters(creds, username);
      if (
        dataPolicy.dataCapMode === "throttle"
        && dataLimitMb !== null
        && dataPolicy.fupSpeedDown !== null
        && dataPolicy.fupSpeedUp !== null
      ) {
        await scheduleHotspotUserFup(creds, {
          username,
          thresholdBytes: dataLimitMegabytesToBytes(dataLimitMb),
          speedDownMbps: dataPolicy.fupSpeedDown,
          speedUpMbps: dataPolicy.fupSpeedUp,
        });
      } else {
        await removeHotspotUserFup(creds, username);
      }
    }

    logger.info({ username, planType, action, router: router.name }, "[provision] Router account provisioned");
  } catch (routerErr) {
    /* Router unreachable — still record the payment but flag the error */
    const rollbackErrors: string[] = [];
    if (vlanMutationAttempted && vlanRollback) {
      await vlanRollback().catch(error => rollbackErrors.push(error instanceof Error ? error.message : String(error)));
    }
    const msg = `Router provisioning failed: ${(routerErr as Error).message}${
      rollbackErrors.length ? ` VLAN recovery requires administrator attention: ${rollbackErrors.join("; ")}` : ""
    }`;
    logger.error({ err: routerErr }, "[provision] Router provisioning error");
    await recordTransaction(
      customer,
      amount,
      paymentMethod,
      reference,
      plan,
      `Router provisioning pending: ${msg}`,
    );
    if (planType === "hotspot" && !hadUnexpiredHotspotAccess) {
      await updateHotspotUser(creds, username, { disabled: true }).catch(() => {});
      await disconnectHotspotActiveUser(creds, username).catch(() => {});
    }
    await sbUpdate("isp_customers", `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`, {
      status: adminSuspended ? "suspended" : "payment_cleared_router_pending",
      plan_id: plan.id,
      router_id: plan.router_id,
      port_id: plan.port_id,
      expires_at: expiresAt,
      ...((planType !== "pppoe" && planType !== "vlan") ? { username } : {}),
      updated_at: new Date().toISOString(),
    });
    await logEvent({
      event: "provision_router_error", gateway, reference,
      customer_id: customer.id, plan_id: plan.id, router_id: router.id,
      error: msg, amount,
    });
    return { ok: false, customerId: customer.id, error: msg };
  }

  /* ── 5. Update customer in Supabase ── */
  await activateCustomer(
    customer,
    plan,
    planType !== "pppoe" && planType !== "vlan" ? username : undefined,
    expiresAt,
    planType === "hotspot",
  );

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
async function activateCustomer(
  customer: SbCustomer,
  plan: SbPlan,
  username?: string,
  expiresAt?: string,
  resetHotspotUsage = false,
): Promise<void> {
  const planType = normalizePlanServiceType(plan.type);
  await sbUpdate("isp_customers", `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`, {
    status:     customer.status === "suspended" ? "suspended" : "active",
    depletion_reason: null,
    expires_at: expiresAt ?? calcExpiry(plan.validity, plan.validity_unit, plan.validity_days),
    router_id: plan.router_id,
    port_id: plan.port_id,
    ...(username && planType !== "pppoe" && planType !== "vlan" ? { username } : {}),
    ...(resetHotspotUsage ? { data_used_bytes: 0, data_used_mb: 0 } : {}),
    updated_at: new Date().toISOString(),
  });
}

async function recordTransaction(
  customer: SbCustomer,
  amount: number,
  paymentMethod: string,
  reference: string,
  plan: SbPlan,
  notes = `Auto-provisioned via webhook — Plan: ${plan.name}`,
): Promise<void> {
  await sbInsert("isp_transactions", {
    admin_id:       customer.admin_id,
    customer_id:    customer.id,
    plan_id:        plan.id,
    amount,
    payment_method: paymentMethod,
    ...(paymentMethod.toLowerCase().includes("mpesa") ? { mpesa_receipt: reference } : {}),
    reference,
    status:         "completed",
    notes,
    created_at:     new Date().toISOString(),
  });
}
