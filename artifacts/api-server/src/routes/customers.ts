import { Router, type IRouter } from "express";
import {
  sbSelect,
  sbSelectStrict,
  sbInsert,
  sbUpdate,
  sbUpdateStrict,
  sbDelete,
  sbDeleteStrict,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { logger } from "../lib/logger.js";
import {
  reconcileHotspotUserAccess,
  reconcilePppoeUserAccess,
  disconnectHotspotActiveUser,
  removeHotspotIpBinding,
  disconnectPPPActiveByName,
  removeHotspotUser,
  removePPPSecretByName,
} from "../lib/mikrotik.js";
import { syncRadiusCustomer } from "../lib/radius.js";
import { hotspotPlanProfileName, isPrepaidHotspotUsername, prepaidHotspotUsername, routerRateLimit } from "../lib/prepaid-identifiers.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";

const router: IRouter = Router();

type CustomerRow = {
  id: number;
  admin_id: number;
  name: string | null;
  phone: string | null;
  mac_address: string | null;
  username: string | null;
  pppoe_username: string | null;
  password: string | null;
  type: string | null;
  plan_id: number | null;
  router_id: number | null;
  ip_address: string | null;
  status: string;
  expires_at: string | null;
  fup_limit_mb: number | null;
};

type PlanRow = {
  id: number;
  name: string;
  type: string | null;
  plan_type: string | null;
  router_id: number | null;
  speed_down: number | null;
  speed_up: number | null;
  speed_down_unit: string | null;
  speed_up_unit: string | null;
  data_limit_mb: number | null;
  shared_users: number | null;
};

type RouterRow = {
  id: number;
  name: string;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
};

function asOptionalIso(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("expiryDate must be a valid date and time");
  return parsed.toISOString();
}

function isManagementVpnIp(ip: string | null | undefined): boolean {
  return /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(String(ip ?? "").trim());
}

function routerCredentials(row: RouterRow) {
  const storedManagementIp = [row.vpn_ip, row.bridge_ip].find(isManagementVpnIp)?.trim() || "";
  const vpnClients = readVpnClients();
  const discoveredManagementIp = vpnIpFor(row.host ?? "", vpnClients)
    ?? vpnIpFor(row.name ?? "", vpnClients)
    ?? "";
  const managementIp = discoveredManagementIp || storedManagementIp;
  const host = row.host?.trim() || managementIp || "";
  if (!host) throw new Error(`Router '${row.name}' has no reachable management address`);
  const username = managementIp
    ? (row.router_username?.trim() || ROUTER_MANAGEMENT_API_USERNAME)
    : (row.router_username?.trim() || "admin");
  return {
    host,
    port: 8728,
    username,
    password: row.router_secret || "",
    useSSL: false,
    alternateUsernames: managementIp && username !== ROUTER_MANAGEMENT_API_USERNAME
      ? [ROUTER_MANAGEMENT_API_USERNAME]
      : undefined,
    bridgeIp: managementIp && managementIp !== host ? managementIp : undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

async function reconcileCustomerAccess(
  current: CustomerRow,
  updates: Record<string, unknown>,
  adminId: number,
): Promise<{ routerSynced: boolean; routerId: number | null; routerName: string | null }> {
  const currentName = current.pppoe_username || current.username || "";
  let nextName = String(
    updates[current.type === "pppoe" ? "pppoe_username" : "username"] ?? currentName,
  ).trim();
  const nextPassword = String(updates.password ?? current.password ?? "");
  const nextType = String(updates.type ?? current.type ?? "hotspot").toLowerCase();
  const nextPlanId = updates.plan_id !== undefined
    ? (updates.plan_id === null || updates.plan_id === "" ? null : Number(updates.plan_id))
    : current.plan_id;
  const nextRouterId = updates.router_id !== undefined
    ? (updates.router_id === null || updates.router_id === "" ? null : Number(updates.router_id))
    : current.router_id;
  const nextStatus = String(updates.status ?? current.status ?? "active").toLowerCase();
  const nextExpiry = updates.expires_at !== undefined
    ? (updates.expires_at as string | null)
    : current.expires_at;
  const plan = nextPlanId
    ? (await sbSelect<PlanRow>(
        "isp_plans",
        `id=eq.${nextPlanId}&admin_id=eq.${adminId}&is_active=is.true&select=id,name,type,plan_type,router_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,shared_users&limit=1`,
      ))[0]
    : undefined;
  const planType = String(plan?.plan_type || plan?.type || nextType).toLowerCase();
  if (planType === "hotspot") {
    const generated = prepaidHotspotUsername(
      updates.phone ?? current.phone,
      updates.mac_address ?? current.mac_address,
    );
    if (generated) {
      const identityChanged = updates.phone !== undefined || updates.mac_address !== undefined;
      nextName = !identityChanged && isPrepaidHotspotUsername(currentName) ? currentName : generated;
    } else if (!isPrepaidHotspotUsername(nextName)) {
      throw new Error("A hotspot user needs a valid phone number and device MAC address");
    }
    updates.username = nextName;
  } else if (planType === "pppoe") {
    updates.pppoe_username = nextName;
  }
  const enabled = nextStatus === "active" &&
    (!nextExpiry || (Number.isFinite(Date.parse(nextExpiry)) && Date.parse(nextExpiry) > Date.now()));

  let routerSynced = false;
  let syncedRouterId: number | null = null;
  let syncedRouterName: string | null = null;
  if (nextName && plan) {
    const routerId = nextRouterId ?? plan.router_id;
    if (!routerId) throw new Error("Assign this prepaid user to a router before saving changes");
    const router = (await sbSelect<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    ))[0];
    if (!router) throw new Error("The selected router was not found for this ISP account");
    const creds = routerCredentials(router);
    const dataLimitMb = Number(updates.fup_limit_mb ?? current.fup_limit_mb ?? plan.data_limit_mb);
    const limitBytesTotal = Number.isFinite(dataLimitMb) && dataLimitMb > 0
      ? String(Math.floor(dataLimitMb * 1_000_000))
      : "0";
    const address = String(updates.ip_address ?? current.ip_address ?? "").trim();
    const rateLimit = routerRateLimit(
      plan.speed_down,
      plan.speed_up,
      plan.speed_down_unit ?? "Mbps",
      plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
    );

    if (currentName && currentName !== nextName) {
      if (planType === "pppoe") {
        await disconnectPPPActiveByName(creds, currentName).catch(() => {});
        await removePPPSecretByName(creds, currentName).catch(() => {});
      } else {
        await disconnectHotspotActiveUser(creds, currentName).catch(() => {});
        await removeHotspotUser(creds, currentName).catch(() => {});
      }
    }

    if (planType === "pppoe") {
      await reconcilePppoeUserAccess(creds, {
        name: nextName,
        password: nextPassword,
        profile: plan.name,
        comment: nextName,
        expiresAt: nextExpiry,
        enabled,
        remoteAddress: String(updates.ip_address ?? current.ip_address ?? "").trim() || null,
      });
    } else if (planType === "hotspot") {
      await reconcileHotspotUserAccess(creds, {
        name: nextName,
        password: nextPassword,
        profile: hotspotPlanProfileName(plan.name),
        comment: nextName,
        expiresAt: nextExpiry,
        enabled,
        limitBytesTotal,
        address: address || null,
        macAddress: String(updates.mac_address ?? current.mac_address ?? "").trim() || null,
        rateLimit,
        sharedUsers: plan.shared_users ?? 1,
      });
    }
    routerSynced = true;
    syncedRouterId = router.id;
    syncedRouterName = router.name;
  }

  if (nextName && plan) {
    await syncRadiusCustomer({
      username: nextName,
      password: nextPassword,
      planId: plan.id,
      planType: planType === "pppoe" ? "pppoe" : "hotspot",
      enabled,
      sharedUsers: plan.shared_users ?? 1,
      fullname: String(updates.name ?? current.name ?? ""),
      rateUp: plan.speed_up,
      rateUpUnit: plan.speed_up_unit,
      rateDown: plan.speed_down,
      rateDownUnit: plan.speed_down_unit,
      dataLimitMb: Number(updates.fup_limit_mb ?? current.fup_limit_mb ?? plan.data_limit_mb),
      expiresAt: nextExpiry,
    });
  }
  return { routerSynced, routerId: syncedRouterId, routerName: syncedRouterName };
}

/*
 * /api/customers — Supabase isp_customers proxy.
 * Query param: adminId or ispId → filters by admin_id
 */

router.get("/customers", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const rows = await sbSelect("isp_customers", `admin_id=eq.${adminId}&select=*`);
  res.json(rows);
});

router.post("/customers", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, name, phone, email, planId, type, ipAddress, macAddress, status, expiryDate, pppoeUsername } = req.body;
  if (!name || !phone) {
    res.status(400).json({ error: "name and phone are required" });
    return;
  }
  const effectiveAdminId = adminId || ispId || 1;
  const [row] = await sbInsert<Record<string, unknown>>("isp_customers", {
    admin_id:       effectiveAdminId,
    name,
    phone,
    email:          email    ?? null,
    plan_id:        planId   ?? null,
    type:           type     ?? "hotspot",
    ip_address:     ipAddress ?? null,
    mac_address:    macAddress ?? null,
    status:         status   ?? "active",
    expires_at:     expiryDate ? new Date(expiryDate).toISOString() : null,
    pppoe_username: pppoeUsername ?? null,
  });
  if (!row) { res.status(500).json({ error: "Failed to create customer" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "customer", action: "added", subject: name, details: { phone, type: type ?? "hotspot" } });
  res.status(201).json(row);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const {
    adminId = 1, ispId, name, phone, email, planId, plan_id, routerId, router_id,
    type, ipAddress, ip_address, username, pppoe_username, mac_address, status, expiryDate, expires_at,
    password, fup_limit_mb,
  } = req.body;
  const effectiveAdminId = Number(adminId || ispId || 1);
  if (!Number.isSafeInteger(effectiveAdminId) || effectiveAdminId < 1) {
    res.status(400).json({ error: "A valid ISP account is required" });
    return;
  }
  const current = (await sbSelect<CustomerRow>(
    "isp_customers",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&select=*&limit=1`,
  ))[0];
  if (!current) { res.status(404).json({ error: "Customer not found" }); return; }

  let normalizedExpiry: string | null | undefined;
  try {
    normalizedExpiry = asOptionalIso(expiryDate !== undefined ? expiryDate : expires_at);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid expiry date" });
    return;
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name       !== undefined) updates.name       = name;
  if (phone      !== undefined) updates.phone      = phone;
  if (email      !== undefined) updates.email      = email;
  if (planId !== undefined || plan_id !== undefined) updates.plan_id = planId ?? plan_id;
  if (routerId !== undefined || router_id !== undefined) updates.router_id = routerId ?? router_id;
  if (type       !== undefined) updates.type       = type;
  if (ipAddress !== undefined || ip_address !== undefined) updates.ip_address = ipAddress ?? ip_address;
  if (mac_address !== undefined) updates.mac_address = mac_address;
  if (username   !== undefined) updates.username   = username;
  if (pppoe_username !== undefined) updates.pppoe_username = pppoe_username;
  if (password   !== undefined) updates.password   = password;
  if (fup_limit_mb !== undefined) updates.fup_limit_mb = fup_limit_mb;
  if (status     !== undefined) updates.status     = status;
  if (normalizedExpiry !== undefined) updates.expires_at = normalizedExpiry;
  if (normalizedExpiry !== undefined && status === undefined) {
    const expiryMs = normalizedExpiry ? Date.parse(normalizedExpiry) : NaN;
    updates.status = Number.isFinite(expiryMs) && expiryMs <= Date.now() ? "expired" : "active";
  }

  let reconciliation: { routerSynced: boolean; routerId: number | null; routerName: string | null };
  try {
    reconciliation = await reconcileCustomerAccess(current, updates, effectiveAdminId);
  } catch (error) {
    logger.warn({
      customerId: Number(id),
      adminId: effectiveAdminId,
      planId: updates.plan_id ?? current.plan_id,
      expiry: updates.expires_at ?? current.expires_at,
      err: error instanceof Error ? error.message : String(error),
    }, "[customers] router access reconciliation failed");
    res.status(503).json({
      error: `Router access was not updated, so the customer record was not changed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return;
  }

  const [row] = await sbUpdate<Record<string, unknown>>(
    "isp_customers",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}`,
    updates,
  );
  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "customer", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json({ ...row, mikrotikSynced: reconciliation.routerSynced, syncedRouter: reconciliation.routerName });
});

/*
 * POST /api/customers/hotspot-login
 * Validates a hotspot customer's username + password.
 * Returns the customer row (without password) on success.
 */
router.post("/customers/hotspot-login", async (req, res): Promise<void> => {
  const { adminId, username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const idFilter = adminId ? `admin_id=eq.${adminId}&` : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `${idFilter}username=eq.${encodeURIComponent(String(username))}&select=*&limit=1`,
  );
  const customer = rows[0];
  if (!customer) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (customer.password !== String(password)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (customer.status === "suspended") {
    res.status(403).json({ error: "Account is suspended. Contact support." });
    return;
  }
  if (customer.status === "expired") {
    res.status(403).json({ error: "Account has expired. Please renew your plan." });
    return;
  }
  if (customer.expires_at && Date.parse(String(customer.expires_at)) <= Date.now()) {
    res.status(403).json({ error: "Account has expired. Please renew your plan." });
    return;
  }
  // Return customer without exposing password
  const { password: _pw, ...safe } = customer;
  res.json({ ok: true, customer: safe });
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const requestedAdminId = Number(req.query.adminId ?? req.body?.adminId);
  const customerFilter = Number.isSafeInteger(requestedAdminId) && requestedAdminId > 0
    ? `id=eq.${req.params.id}&admin_id=eq.${requestedAdminId}&select=id,name,admin_id,username,pppoe_username&limit=1`
    : `id=eq.${req.params.id}&select=id,name,admin_id,username,pppoe_username&limit=1`;
  const rows = await sbSelectStrict<{
    id: number;
    name: string;
    admin_id: number;
    username: string | null;
    pppoe_username: string | null;
  }>("isp_customers", customerFilter);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const transactions = await sbSelectStrict<{
    id: number;
    amount: number | null;
    status: string;
  }>(
    "isp_transactions",
    `customer_id=eq.${row.id}&admin_id=eq.${row.admin_id}&select=id,amount,status`,
  );
  const incomeStatuses = new Set(["completed", "paid", "success", "pending"]);
  const voidable = transactions.filter(transaction => incomeStatuses.has(String(transaction.status).toLowerCase()));
  if (voidable.length > 0) {
    await sbUpdateStrict(
      "isp_transactions",
      `customer_id=eq.${row.id}&admin_id=eq.${row.admin_id}&status=in.(completed,paid,success,pending)`,
      { status: "voided" },
    );
  }

  const deleted = await sbDeleteStrict(
    "isp_customers",
    `id=eq.${row.id}&admin_id=eq.${row.admin_id}`,
  );
  if (!deleted.length) {
    res.status(409).json({ error: "The customer could not be deleted." });
    return;
  }

  const radiusUsername = row.pppoe_username || row.username;
  if (radiusUsername) {
    await sbDelete("radcheck", `username=eq.${encodeURIComponent(radiusUsername)}`);
    await sbDelete("radusergroup", `username=eq.${encodeURIComponent(radiusUsername)}`);
  }
  void logActivity({
    adminId: row.admin_id,
    type: "customer",
    action: "deleted",
    subject: row.name,
    details: {
      voidedTransactionCount: voidable.length,
      voidedIncome: voidable.reduce((sum, transaction) => sum + Number(transaction.amount ?? 0), 0),
    },
  });
  res.sendStatus(204);
});

export default router;
