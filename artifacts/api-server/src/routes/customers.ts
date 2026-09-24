import { Router, type IRouter } from "express";
import {
  sbSelect,
  sbSelectStrict,
  sbInsert,
  sbInsertStrict,
  sbUpdate,
  sbUpdateStrict,
  sbDelete,
  sbDeleteStrict,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { logger } from "../lib/logger.js";
import {
  reconcileVlanCustomerQueue,
  removeVlanCustomerQueue,
  reconcileHotspotUserAccess,
  reconcilePppoeUserAccess,
  disconnectHotspotActiveUser,
  fetchHotspotUsers,
  connectHotspotUser,
  removeHotspotIpBinding,
  disconnectPPPActiveByName,
  removeHotspotUser,
  removePPPSecretByName,
} from "../lib/mikrotik.js";
import { syncRadiusCustomer } from "../lib/radius.js";
import { hotspotPlanProfileName, isPrepaidHotspotUsername, prepaidHotspotUsername, routerRateLimit } from "../lib/prepaid-identifiers.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { portServiceResourceNames } from "../lib/port-service-resources.js";
import { normalizePlanServiceType } from "../lib/plan-service-type.js";
import { ipv4InSubnet, isValidIpv4, isValidVlanTag } from "../lib/vlan-customer-queue.js";

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
  port_id: number | null;
  ip_address: string | null;
  status: string;
  expires_at: string | null;
  fup_limit_mb: number | null;
};

type PlanRow = {
  id: number;
  name: string;
  is_active?: boolean;
  type: string | null;
  plan_type: string | null;
  router_id: number | null;
  port_id: number | null;
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

type VlanPortRow = {
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
};

async function loadVlanCustomerContext(
  adminId: number,
  plan: PlanRow,
  requestedRouterId?: unknown,
  requestedPortId?: unknown,
): Promise<{ router: RouterRow; port: VlanPortRow; parentQueue: string; parentComment: string }> {
  if (normalizePlanServiceType(plan.plan_type || plan.type) !== "vlan") {
    throw new Error("Choose a VLAN plan for this customer.");
  }
  if (!plan.router_id || !plan.port_id) {
    throw new Error("The VLAN plan must be assigned to a router and VLAN service port.");
  }
  const selectedRouterId = requestedRouterId === undefined || requestedRouterId === null || requestedRouterId === ""
    ? plan.router_id
    : Number(requestedRouterId);
  const selectedPortId = requestedPortId === undefined || requestedPortId === null || requestedPortId === ""
    ? plan.port_id
    : Number(requestedPortId);
  if (selectedRouterId !== plan.router_id || selectedPortId !== plan.port_id) {
    throw new Error("The VLAN customer router and port must match the selected plan.");
  }

  const ports = await sbSelectStrict<VlanPortRow>(
    "isp_reseller_ports",
    `id=eq.${plan.port_id}&admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status&limit=1`,
  );
  const port = ports[0];
  if (
    !port
    || !isValidVlanTag(port.vlan_tag)
    || !Number.isSafeInteger(port.assigned_reseller_id ?? port.reseller_id)
    || Number(port.assigned_reseller_id ?? port.reseller_id) < 1
  ) {
    throw new Error("The VLAN plan's service port must be owned by this ISP, use VLAN services, and have a valid VLAN tag.");
  }
  const routers = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  );
  const router = routers[0];
  if (!router) throw new Error("The VLAN plan's router was not found for this ISP account.");
  const resources = portServiceResourceNames(port);
  return {
    router,
    port,
    parentQueue: resources.parentQueue,
    parentComment: `${resources.commentPrefix}_parent_queue`,
  };
}

function validateVlanCustomerAddress(ipAddress: unknown, port: VlanPortRow): string {
  const address = String(ipAddress ?? "").trim();
  if (!isValidIpv4(address)) {
    throw new Error("A valid assigned static IPv4 address is required for a VLAN customer.");
  }
  if (!port.subnet_range || !ipv4InSubnet(address, port.subnet_range)) {
    throw new Error("The assigned static IP must belong to the VLAN service subnet.");
  }
  return address;
}

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
        `id=eq.${nextPlanId}&admin_id=eq.${adminId}&is_active=is.true&select=id,name,type,plan_type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,shared_users&limit=1`,
      ))[0]
    : undefined;
  const planType = normalizePlanServiceType(plan?.plan_type || plan?.type || nextType);
  if (planType === "vlan" && !plan) {
    throw new Error("An active VLAN plan is required for this customer.");
  }
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
  if (plan && (nextName || planType === "vlan")) {
    const routerId = nextRouterId ?? plan.router_id;
    if (!routerId) throw new Error("Assign this prepaid user to a router before saving changes");
    if (planType === "vlan" && routerId !== plan.router_id) {
      throw new Error("The VLAN customer router must match the selected VLAN plan.");
    }
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

    if (planType !== "vlan" && currentName && currentName !== nextName) {
      if (planType === "pppoe") {
        await disconnectPPPActiveByName(creds, currentName).catch(() => {});
        await removePPPSecretByName(creds, currentName).catch(() => {});
      } else {
        await disconnectHotspotActiveUser(creds, currentName).catch(() => {});
        await removeHotspotUser(creds, currentName).catch(() => {});
      }
    }

    if (planType === "vlan") {
      const vlanContext = await loadVlanCustomerContext(
        adminId,
        plan,
        routerId,
        updates.port_id ?? current.port_id ?? plan.port_id,
      );
      const address = validateVlanCustomerAddress(updates.ip_address ?? current.ip_address, vlanContext.port);
      const assignedAddresses = await sbSelectStrict<{ id: number }>(
        "isp_customers",
        `admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&port_id=eq.${plan.port_id}&ip_address=eq.${encodeURIComponent(address)}&id=neq.${current.id}&select=id&limit=1`,
      );
      if (assignedAddresses[0]) throw new Error("This static IP address is already assigned to another customer.");
      await reconcileVlanCustomerQueue(creds, {
        adminId,
        customerId: current.id,
        ipAddress: address,
        parentQueue: vlanContext.parentQueue,
        parentComment: vlanContext.parentComment,
        maxLimit: rateLimit ?? "0/0",
        enabled,
        expiresAt: nextExpiry,
      });
      const previousAddress = String(current.ip_address ?? "").trim();
      if (previousAddress && previousAddress !== address && isValidIpv4(previousAddress)) {
        try {
          await removeVlanCustomerQueue(creds, {
            adminId,
            customerId: current.id,
            ipAddress: previousAddress,
            preserveExpiry: true,
          });
        } catch (error) {
          await removeVlanCustomerQueue(creds, { adminId, customerId: current.id, ipAddress: address }).catch(() => {});
          throw error;
        }
      }
      updates.type = "vlan";
      updates.router_id = plan.router_id;
      updates.port_id = plan.port_id;
    } else if (planType === "pppoe") {
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
        profile: hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id),
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

  if (nextName && plan && planType !== "vlan") {
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

router.get("/customers", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.query.adminId ?? req.query.ispId);
  if (!adminId) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return;
  }
  const rows = await sbSelect("isp_customers", `admin_id=eq.${adminId}&select=*`);
  res.json(rows);
});

router.post("/customers", requireAdmin(), async (req, res): Promise<void> => {
  const {
    adminId = 1, ispId, name, phone, email, planId, type, ipAddress, macAddress,
    status, expiryDate, pppoeUsername, routerId, portId,
  } = req.body;
  if (!name || !phone) {
    res.status(400).json({ error: "name and phone are required" });
    return;
  }
  const effectiveAdminId = authenticatedAdminId(req, adminId || ispId);
  if (!effectiveAdminId) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return;
  }

  const requestedPlanId = Number(planId);
  const mayInferVlanFromPlan = type === undefined || type === null || type === "";
  const needsVlanPlanCheck = String(type ?? "").trim().toLowerCase() === "vlan" || mayInferVlanFromPlan;
  let plan: PlanRow | undefined;
  if (Number.isSafeInteger(requestedPlanId) && requestedPlanId > 0) {
    const planFilter =
      `id=eq.${requestedPlanId}&admin_id=eq.${effectiveAdminId}&select=id,name,type,plan_type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,shared_users,is_active&limit=1`;
    const planRows = needsVlanPlanCheck
      ? await sbSelectStrict<PlanRow>("isp_plans", planFilter)
      : await sbSelect<PlanRow>("isp_plans", planFilter);
    plan = planRows[0];
  }
  const planServiceType = normalizePlanServiceType(plan?.plan_type || plan?.type);
  const requestedType = String(type ?? (planServiceType === "vlan" ? "vlan" : "hotspot")).trim().toLowerCase();
  if (planServiceType === "vlan" && requestedType !== "vlan") {
    res.status(400).json({ error: "The selected plan is VLAN service; create the customer as type vlan." });
    return;
  }
  if (requestedType === "vlan") {
    if (!plan || !plan.is_active || planServiceType !== "vlan") {
      res.status(400).json({ error: "Select an active VLAN plan owned by this ISP account." });
      return;
    }
    let vlanContext: Awaited<ReturnType<typeof loadVlanCustomerContext>>;
    let address: string;
    let expiresAt: string | null;
    try {
      vlanContext = await loadVlanCustomerContext(effectiveAdminId, plan, routerId, portId);
      address = validateVlanCustomerAddress(ipAddress, vlanContext.port);
      expiresAt = asOptionalIso(expiryDate) ?? null;
      const assignedAddresses = await sbSelectStrict<{ id: number }>(
        "isp_customers",
        `admin_id=eq.${effectiveAdminId}&router_id=eq.${plan.router_id}&port_id=eq.${plan.port_id}&ip_address=eq.${encodeURIComponent(address)}&select=id&limit=1`,
      );
      if (assignedAddresses[0]) throw new Error("This static IP address is already assigned to another customer.");
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid VLAN customer assignment." });
      return;
    }
    const requestedStatus = String(status ?? "active").trim().toLowerCase();
    const enabled = requestedStatus === "active" &&
      (!expiresAt || Date.parse(expiresAt) > Date.now());
    const creds = routerCredentials(vlanContext.router);
    const [pending] = await sbInsertStrict<CustomerRow>("isp_customers", {
      admin_id: effectiveAdminId,
      name,
      phone,
      email: email ?? null,
      plan_id: plan.id,
      type: "vlan",
      router_id: plan.router_id,
      port_id: plan.port_id,
      ip_address: address,
      mac_address: macAddress ?? null,
      status: "provisioning",
      expires_at: expiresAt,
      pppoe_username: null,
      username: null,
    });
    if (!pending?.id) {
      res.status(500).json({ error: "The VLAN customer account could not be reserved." });
      return;
    }
    try {
      await reconcileVlanCustomerQueue(creds, {
        adminId: effectiveAdminId,
        customerId: pending.id,
        ipAddress: address,
        parentQueue: vlanContext.parentQueue,
        parentComment: `${portServiceResourceNames(vlanContext.port).commentPrefix}_parent_queue`,
        maxLimit: routerRateLimit(
          plan.speed_down,
          plan.speed_up,
          plan.speed_down_unit ?? "Mbps",
          plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
        ) ?? "0/0",
        enabled,
        expiresAt,
      });
      const [row] = await sbUpdateStrict<CustomerRow>(
        "isp_customers",
        `id=eq.${pending.id}&admin_id=eq.${effectiveAdminId}`,
        { status: requestedStatus, updated_at: new Date().toISOString() },
      );
      if (!row) throw new Error("The VLAN customer status could not be saved after RouterOS provisioning.");
      void logActivity({
        adminId: Number(effectiveAdminId),
        type: "customer",
        action: "added",
        subject: name,
        details: { phone, type: "vlan", ipAddress: address, planId: plan.id },
      });
      res.status(201).json(row);
      return;
    } catch (error) {
      const cleanupErrors: string[] = [];
      await removeVlanCustomerQueue(creds, {
        adminId: effectiveAdminId,
        customerId: pending.id,
        ipAddress: address,
      }).catch(cleanupError => cleanupErrors.push(
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      ));
      await sbDeleteStrict("isp_customers", `id=eq.${pending.id}&admin_id=eq.${effectiveAdminId}`)
        .catch(cleanupError => cleanupErrors.push(
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        ));
      logger.warn({
        customerId: pending.id,
        adminId: effectiveAdminId,
        err: error instanceof Error ? error.message : String(error),
        cleanupErrors,
      }, "[customers] VLAN creation rolled back after RouterOS provisioning failure");
      res.status(503).json({
        error: `The VLAN customer was not created because RouterOS provisioning failed: ${
          error instanceof Error ? error.message : String(error)
        }${cleanupErrors.length ? ` Cleanup requires administrator attention: ${cleanupErrors.join("; ")}` : ""}`,
      });
      return;
    }
  }

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

router.patch("/customers/:id", requireAdmin(), async (req, res): Promise<void> => {
  const id = req.params.id;
  const {
    adminId = 1, ispId, name, phone, email, planId, plan_id, routerId, router_id, portId, port_id,
    type, ipAddress, ip_address, username, pppoe_username, mac_address, status, expiryDate, expires_at,
    password, fup_limit_mb,
  } = req.body;
  const effectiveAdminId = authenticatedAdminId(req, adminId || ispId);
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
  if (portId !== undefined || port_id !== undefined) updates.port_id = portId ?? port_id;
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
  const adminId = Number(req.body?.adminId);
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const requestedIp = normalisePortalIp(req.body?.client_ip);
  const requestedMac = normalisePortalMac(req.body?.mac_address);
  if (!Number.isSafeInteger(adminId) || adminId < 1 || !username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `admin_id=eq.${adminId}&type=eq.hotspot&username=eq.${encodeURIComponent(username)}&select=*&limit=1`,
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

  const customerRow = customer as Partial<CustomerRow>;
  const plan = customerRow.plan_id
    ? (await sbSelect<PlanRow>(
        "isp_plans",
        `id=eq.${customerRow.plan_id}&admin_id=eq.${adminId}&select=id,router_id&limit=1`,
      ))[0]
    : undefined;
  const routerId = customerRow.router_id ?? plan?.router_id ?? null;
  if (!routerId) {
    res.status(409).json({ error: "Your active plan is not linked to a hotspot router yet." });
    return;
  }

  const routerRow = (await sbSelect<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  ))[0];
  if (!routerRow) {
    res.status(409).json({ error: "Your active plan's hotspot router could not be found." });
    return;
  }

  let creds: ReturnType<typeof routerCredentials>;
  try {
    creds = routerCredentials(routerRow);
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "The hotspot router is not ready.",
    });
    return;
  }

  const customerMac = normalisePortalMac(customerRow.mac_address);
  const targetMac = requestedMac || customerMac;
  let activeUsers: Awaited<ReturnType<typeof fetchHotspotUsers>> = [];
  try {
    activeUsers = await fetchHotspotUsers(creds);
  } catch (error) {
    logger.warn({ err: error, adminId, routerId }, "[customers/hotspot-login] could not read hotspot sessions");
    res.status(503).json({
      error: "Your plan is active, but the hotspot router has not accepted the connection yet.",
    });
    return;
  }

  const matchingDevice = activeUsers.find(user =>
    (targetMac && normalisePortalMac(user.macAddress) === targetMac)
    || (requestedIp && user.address === requestedIp)
    || (!targetMac && !requestedIp && user.user === username),
  );
  const connected = activeUsers.some(user =>
    user.user === username && (
      (targetMac && normalisePortalMac(user.macAddress) === targetMac)
      || (requestedIp && user.address === requestedIp)
    ),
  );
  if (!connected) {
    const ip = requestedIp || matchingDevice?.address || normalisePortalIp(customerRow.ip_address);
    if (!ip || !targetMac) {
      res.status(409).json({
        error: "Credentials are valid, but this sign-in page did not provide the hotspot device context. Reopen it from the connected Wi-Fi network and try again.",
      });
      return;
    }
    try {
      await connectHotspotUser(creds, {
        user: username,
        password,
        ip,
        macAddress: targetMac,
      });
    } catch (error) {
      logger.warn({ err: error, adminId, routerId, username }, "[customers/hotspot-login] router login attempt failed");
      res.status(503).json({
        error: "Your plan is active, but the hotspot router has not accepted the connection yet.",
      });
      return;
    }
  }

  // Return customer without exposing password.
  const { password: _pw, ...safe } = customer;
  res.json({
    ok: true,
    customer: safe,
    connected: true,
    session: {
      status: "active",
      connected: true,
      expiresAt: typeof customer.expires_at === "string" ? customer.expires_at : null,
    },
  });
});

function normalisePortalMac(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/[:-]/g, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(raw) ? raw.match(/.{2}/g)!.join(":") : "";
}

function normalisePortalIp(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw)) return "";
  const octets = raw.split(".").map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255) ? raw : "";
}

/*
 * POST /api/customers/hotspot-troubleshoot
 *
 * The browser may request this endpoint repeatedly, but each request performs
 * only one bounded RouterOS check/login attempt. The captive page supplies the
 * device MAC from RouterOS; the server resolves the matching tenant customer
 * and keeps the hotspot username/password entirely server-side.
 */
router.post("/customers/hotspot-troubleshoot", async (req, res): Promise<void> => {
  const adminId = Number(req.body?.adminId);
  const requestedIp = normalisePortalIp(req.body?.client_ip);
  const requestedMac = normalisePortalMac(req.body?.mac_address);

  if (!Number.isSafeInteger(adminId) || adminId < 1 || !requestedMac) {
    res.status(400).json({ ok: false, error: "ISP context and the hotspot device MAC address are required." });
    return;
  }

  const macCandidates = Array.from(new Set([requestedMac, requestedMac.replace(/:/g, "")]));
  let customer: CustomerRow | undefined;
  for (const mac of macCandidates) {
    const rows = await sbSelect<CustomerRow>(
      "isp_customers",
      `admin_id=eq.${adminId}&type=eq.hotspot&mac_address=eq.${encodeURIComponent(mac)}&select=*&limit=1`,
    );
    if (rows[0]) {
      customer = rows[0];
      break;
    }
  }
  if (!customer) {
    res.json({
      ok: true,
      status: "expired",
      connected: false,
      retryable: false,
      expiresAt: null,
      error: "No active hotspot package was found for this device.",
    });
    return;
  }

  const username = String(customer.username ?? "").trim();
  const password = String(customer.password ?? "");
  if (!username || !password) {
    res.json({
      ok: true,
      status: "active",
      connected: false,
      retryable: false,
      expiresAt: customer.expires_at,
      error: "This active package does not have a hotspot login assigned yet. Contact support.",
      customer: { name: customer.name },
    });
    return;
  }
  const expiresAt = customer.expires_at;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const activeStatus = customer.status === "active" || customer.status === "payment_cleared_router_pending";
  const hasActivePlan = activeStatus && Boolean(customer.plan_id) &&
    (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now());
  if (!hasActivePlan) {
    res.json({
      ok: true,
      status: "expired",
      connected: false,
      retryable: false,
      expiresAt,
      customer: { name: customer.name, username: customer.username },
    });
    return;
  }

  const plan = customer.plan_id
    ? (await sbSelect<PlanRow>(
        "isp_plans",
        `id=eq.${customer.plan_id}&admin_id=eq.${adminId}&select=id,router_id&limit=1`,
      ))[0]
    : undefined;
  const routerId = customer.router_id ?? plan?.router_id ?? null;
  if (!routerId) {
    res.json({
      ok: true,
      status: "active",
      connected: false,
      retryable: false,
      expiresAt,
      error: "Your plan is active, but it has not been linked to a hotspot router yet.",
      customer: { name: customer.name, username: customer.username },
    });
    return;
  }

  const routerRow = (await sbSelect<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  ))[0];
  if (!routerRow) {
    res.json({
      ok: true,
      status: "active",
      connected: false,
      retryable: false,
      expiresAt,
      error: "Your plan is active, but its hotspot router could not be found.",
      customer: { name: customer.name, username: customer.username },
    });
    return;
  }

  let creds: ReturnType<typeof routerCredentials>;
  try {
    creds = routerCredentials(routerRow);
  } catch (error) {
    res.json({
      ok: true,
      status: "active",
      connected: false,
      retryable: false,
      expiresAt,
      error: error instanceof Error ? error.message : "The hotspot router is not ready.",
      customer: { name: customer.name, username: customer.username },
    });
    return;
  }

  try {
    const activeUsers = await fetchHotspotUsers(creds);
    const matchingDevice = activeUsers.find(user =>
      normalisePortalMac(user.macAddress) === requestedMac
      || (requestedIp && user.address === requestedIp),
    );
    const connected = activeUsers.some(user =>
      user.user === username && (
        normalisePortalMac(user.macAddress) === requestedMac
        || (requestedIp && user.address === requestedIp)
      ),
    );
    if (connected) {
      res.json({
        ok: true,
        status: "active",
        connected: true,
        retryable: false,
        expiresAt,
        customer: { name: customer.name, username: customer.username },
      });
      return;
    }

    const ip = requestedIp || matchingDevice?.address || normalisePortalIp(customer.ip_address);
    if (!ip) {
      res.json({
        ok: true,
        status: "active",
        connected: false,
        retryable: false,
        expiresAt,
        error: "The hotspot could not find an IP address for this device. Reopen the Wi-Fi sign-in page and try again.",
        customer: { name: customer.name, username: customer.username },
      });
      return;
    }

    await connectHotspotUser(creds, {
      user: username,
      password,
      ip,
      macAddress: requestedMac,
    });
    res.json({
      ok: true,
      status: "active",
      connected: true,
      retryable: false,
      expiresAt,
      customer: { name: customer.name, username: customer.username },
    });
  } catch (error) {
    logger.warn({ err: error, adminId, routerId, macAddress: requestedMac }, "[customers/hotspot-troubleshoot] router connection attempt failed");
    res.status(503).json({
      ok: false,
      status: "active",
      connected: false,
      retryable: true,
      expiresAt,
      error: "Your plan is active, but the hotspot router has not accepted the connection yet.",
      customer: { name: customer.name, username: customer.username },
    });
  }
});

router.delete("/customers/:id", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.query.adminId ?? req.body?.adminId);
  if (!Number.isSafeInteger(adminId) || adminId < 1) {
    res.status(400).json({ error: "The requested account does not match the signed-in admin session." });
    return;
  }
  const rows = await sbSelectStrict<{
    id: number;
    name: string;
    admin_id: number;
    username: string | null;
    pppoe_username: string | null;
    type: string | null;
    ip_address: string | null;
    router_id: number | null;
    port_id: number | null;
  }>(
    "isp_customers",
    `id=eq.${req.params.id}&admin_id=eq.${adminId}&select=id,name,admin_id,username,pppoe_username,type,ip_address,router_id,port_id&limit=1`,
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  if (row.type === "vlan") {
    if (!row.router_id || !row.ip_address) {
      res.status(409).json({ error: "The VLAN customer has no saved router or assigned IP to remove from RouterOS." });
      return;
    }
    const routers = await sbSelectStrict<RouterRow>(
      "isp_routers",
      `id=eq.${row.router_id}&admin_id=eq.${row.admin_id}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    if (!routers[0]) {
      res.status(409).json({ error: "The VLAN customer's router is no longer available for queue cleanup." });
      return;
    }
    try {
      await removeVlanCustomerQueue(routerCredentials(routers[0]), {
        adminId: row.admin_id,
        customerId: row.id,
        ipAddress: row.ip_address,
      });
    } catch (error) {
      res.status(503).json({
        error: `The VLAN customer queue could not be removed, so the account was not deleted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }
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
