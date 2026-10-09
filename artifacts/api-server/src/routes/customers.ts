import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import {
  sbSelect,
  sbSelectStrict,
  sbInsert,
  sbInsertStrict,
  sbUpdate,
  sbUpdateStrict,
  sbDelete,
  sbDeleteStrict,
  sbRpc,
  SupabaseHttpError,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { logger } from "../lib/logger.js";
import { formatVoucherExpiryInEastAfrica } from "../lib/hotspot-voucher-redemption.js";
import {
  isPrepaidCustomerEntitled,
  isPrepaidCustomerExpired,
} from "../lib/prepaid-entitlement.js";
import {
  reconcileVlanCustomerQueue,
  removeVlanCustomerQueue,
  reconcileHotspotUserAccess,
  reconcilePppoeUserAccess,
  disconnectHotspotActiveUser,
  fetchHotspotConnectedDevices,
  fetchHotspotUserRateQueueStatsBulk,
  addHotspotIpBinding,
  ensureHotspotUserRateQueue,
  fetchHotspotUsers,
  fetchHotspotUserUsage,
  fetchHotspotUserList,
  resolveHotspotClientIpByMac,
  connectHotspotUser,
  reconnectHotspotUserByMac,
  ensureHotspotUserProfile,
  requireHotspotUserProfile,
  removeHotspotIpBinding,
  removeHotspotUserExpiry,
  removeHotspotUserRateQueue,
  disconnectPPPActiveByName,
  removePppUserExpiry,
  removeHotspotUser,
  removePPPSecretByName,
  getPaidHotspotBindingSnapshot,
  reconcilePaidHotspotBinding,
  type PaidHotspotBindingSnapshot,
} from "../lib/mikrotik.js";
import {
  assertRadiusTargetEmptyStrict,
  hasRadiusCustomerStrict,
  moveRadiusCustomerStrict,
  removeRadiusCustomerStrict,
  rollbackRadiusCustomerMoveStrict,
  syncRadiusCustomerStrict,
} from "../lib/radius.js";
import {
  hotspotPlanProfileName,
  normalisePrepaidMac,
  prepaidHotspotUsernameForEdit,
  routerRateLimit,
} from "../lib/prepaid-identifiers.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import {
  authenticatedAccount,
  authenticatedAdminId,
  requireAdmin,
  type VlanHotspotPortalContext,
} from "../lib/api-auth.js";
import { planOwnerFilter } from "../lib/plan-ownership.js";
import { dataLimitMegabytesToBytes, validateFupPolicy } from "../lib/fup-policy.js";
import {
  authorizedRoamingRouterIds,
  canPlanRoamToService,
  hotspotRoamingUserServer,
  isDifferentHotspotService,
  sharedHotspotUsageAllowance,
  type HotspotRoamingRule,
  type HotspotRoamingServiceScope,
} from "../lib/hotspot-roaming.js";
import { portServiceResourceNames } from "../lib/port-service-resources.js";
import { normalizePlanServiceType } from "../lib/plan-service-type.js";
import { ipv4InSubnet, isValidIpv4, isValidVlanTag } from "../lib/vlan-customer-queue.js";
import { saveCustomerEditWithRouter } from "../lib/customer-edit-consistency.js";
import { withCustomerEditLock } from "../lib/customer-edit-lock.js";
import {
  calculateCustomerExtensionExpiry,
  customerStatusForExpiryEdit,
} from "../lib/customer-expiry-edit.js";
import {
  findHotspotAdminGrantMatches,
  hotspotAdminGrantExpiry,
  hotspotAdminGrantUsername,
  normalizeHotspotGrantMac,
  type HotspotAdminGrantCustomer,
  type HotspotAdminGrantPlanScope,
} from "../lib/prepaid-hotspot-admin-grant.js";
import {
  formatVoucherDuration,
  normalizeHotspotMac,
  normalizeKenyanVoucherPhone,
  normalizeRedeemableHotspotVoucherCode,
} from "../lib/hotspot-voucher-utils.js";

const router: IRouter = Router();

export const prepaidHotspotReconnectOperations = {
  withCustomerEditLock,
  fetchHotspotUsers,
  fetchHotspotUserUsage,
  resolveHotspotClientIpByMac,
  reconcileHotspotUserAccess,
  connectHotspotUser,
};

export const hotspotTroubleshootOperations = {
  fetchHotspotUsers,
  resolveHotspotClientIpByMac,
  reconnectHotspotUserByMac,
};

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
  depletion_reason: string | null;
  data_used_bytes?: number | null;
  service_online?: boolean | null;
  last_seen?: string | null;
};

type PlanRow = {
  id: number;
  name: string;
  is_active?: boolean;
  type: string | null;
  router_id: number | null;
  port_id: number | null;
  speed_down: number | null;
  speed_up: number | null;
  speed_down_unit: string | null;
  speed_up_unit: string | null;
  data_limit_mb: number | null;
  data_cap_mode: string | null;
  fup_speed_down: number | null;
  fup_speed_up: number | null;
  shared_users: number | null;
  owner_reseller_id?: number | null;
};

type ConnectedDeviceCustomerRow = CustomerRow & {
  data_used_bytes: number | null;
  service_online: boolean | null;
  last_seen: string | null;
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
  handoff_mode: "vlan_services" | "services" | "isp_router" | null;
  reseller_id: number | null;
  assigned_reseller_id: number | null;
  vlan_tag: string | null;
  subnet_range: string | null;
  status: string;
  hotspot_enabled?: boolean;
  link_status?: string | null;
};

type RoamingRuleRow = HotspotRoamingRule & { admin_id: number };

async function loadScopedCustomerPlan(
  account: NonNullable<Awaited<ReturnType<typeof authenticatedAccount>>>,
  planId: number,
  requestedType: string,
  routerId?: unknown,
  portId?: unknown,
  allowInactive = false,
): Promise<PlanRow | undefined> {
  const tenantId = account.parent_id ?? account.id;
  const ownerId = account.role === "reseller" ? account.id : null;
  const type = normalizePlanServiceType(requestedType);
  const typeFilter = type === "hotspot" ? "type=in.(hotspot,trials,trial)" : `type=eq.${encodeURIComponent(type)}`;
  const routerFilter = Number.isSafeInteger(Number(routerId)) && Number(routerId) > 0 ? `&router_id=eq.${Number(routerId)}` : "";
  const portFilter = Number.isSafeInteger(Number(portId)) && Number(portId) > 0 ? `&port_id=eq.${Number(portId)}` : "";
  const rows = await sbSelectStrict<PlanRow>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${tenantId}&${planOwnerFilter(ownerId)}&${allowInactive ? "" : "is_active=is.true&"}${typeFilter}${routerFilter}${portFilter}&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,is_active,owner_reseller_id&limit=1`,
  );
  const plan = rows[0];
  if (!plan) return undefined;
  if (account.role === "reseller") {
    if (type !== "hotspot" && type !== "pppoe") return undefined;
    if (!plan.port_id || !plan.router_id) return undefined;
    const ports = await sbSelectStrict<VlanPortRow>(
      "isp_reseller_ports",
      `id=eq.${plan.port_id}&admin_id=eq.${tenantId}&assigned_reseller_id=eq.${account.id}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=eq.active&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status&limit=1`,
    );
    if (!ports[0]) return undefined;
  }
  return plan;
}

async function loadVlanCustomerContext(
  adminId: number,
  plan: PlanRow,
  requestedRouterId?: unknown,
  requestedPortId?: unknown,
): Promise<{ router: RouterRow; port: VlanPortRow; parentQueue: string; parentComment: string }> {
  if (normalizePlanServiceType(plan.type) !== "vlan") {
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
    `id=eq.${plan.port_id}&admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled,link_status&limit=1`,
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

function customerFieldsMatch(row: CustomerRow, fields: Record<string, unknown>): boolean {
  const saved = row as unknown as Record<string, unknown>;
  return Object.entries(fields).every(([key, value]) => {
    if (key === "updated_at") return true;
    const actual = saved[key];
    if (key === "expires_at" && actual && value) {
      return Date.parse(String(actual)) === Date.parse(String(value));
    }
    return (actual ?? null) === (value ?? null);
  });
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

function hotspotReconnectRouterCredentials(row: RouterRow) {
  const storedManagementIp = [row.vpn_ip, row.bridge_ip].find(isManagementVpnIp)?.trim() || "";
  const vpnClients = readVpnClients();
  const discoveredCandidate = vpnIpFor(row.host ?? "", vpnClients)
    ?? vpnIpFor(row.name ?? "", vpnClients)
    ?? "";
  const discoveredManagementIp = isManagementVpnIp(discoveredCandidate)
    ? discoveredCandidate.trim()
    : "";
  const host = discoveredManagementIp || storedManagementIp;
  if (!host) throw new Error(`Router '${row.name}' has no verified management VPN address`);
  const username = ROUTER_MANAGEMENT_API_USERNAME;
  return {
    host,
    port: 8728,
    username,
    password: row.router_secret || "",
    alternateUsernames: row.router_username && row.router_username !== username
      ? [row.router_username]
      : undefined,
    bridgeIp: undefined,
    useSSL: false,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

async function reconcileCustomerAccess(
  current: CustomerRow,
  updates: Record<string, unknown>,
  adminId: number,
  options: {
    allowInactivePlan?: boolean;
    restoreIdentity?: boolean;
    preserveHotspotUsername?: boolean;
    skipRadius?: boolean;
    onRouterMutation?: () => Promise<void>;
    onRadiusIdentity?: (exists: boolean) => void;
    onRadiusMutation?: () => void;
    assertLock?: () => Promise<void>;
    replacePaidHotspotBindings?: boolean;
    paidHotspotBindingSnapshot?: PaidHotspotBindingSnapshot | null;
    onPaidHotspotBindingSnapshot?: (snapshot: PaidHotspotBindingSnapshot) => void;
  } = {},
): Promise<{ routerSynced: boolean; routerId: number | null; routerName: string | null }> {
  const replacePaidHotspotBindings = Object.prototype.hasOwnProperty.call(updates, "mac_address")
    && normalisePrepaidMac(updates.mac_address) !== normalisePrepaidMac(current.mac_address);
  const currentName = current.type === "pppoe"
    ? current.pppoe_username || current.username || ""
    : current.username || current.pppoe_username || "";
  let nextName = String(
    updates[current.type === "pppoe" ? "pppoe_username" : "username"] === undefined
      ? currentName
      : updates[current.type === "pppoe" ? "pppoe_username" : "username"] ?? "",
  ).trim();
  let nextPassword = String(updates.password === undefined ? current.password ?? "" : updates.password ?? "");
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
  const sameExpiry = nextExpiry === current.expires_at
    || Boolean(nextExpiry && current.expires_at && Date.parse(nextExpiry) === Date.parse(current.expires_at));
  const plan = nextPlanId
    ? (await sbSelectStrict<PlanRow>(
        "isp_plans",
        `id=eq.${nextPlanId}&admin_id=eq.${adminId}&${options.allowInactivePlan ? "" : "is_active=is.true&"}select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users&limit=1`,
      ))[0]
    : undefined;
  const planType = normalizePlanServiceType(plan?.type || nextType);
  if (!plan) {
    throw new Error("An existing plan linked to MikroTik is required before editing this prepaid user.");
  }
  if (planType !== "vlan" && planType !== "pppoe" && planType !== "hotspot") {
    throw new Error("This prepaid service type cannot be synchronized to MikroTik by the customer editor.");
  }
  if (planType !== normalizePlanServiceType(nextType)) {
    throw new Error("The customer's service type does not match the selected MikroTik plan.");
  }
  if (planType === "hotspot") {
    if (options.restoreIdentity) {
      nextName = String(updates.username ?? current.username ?? "").trim();
    } else if (options.preserveHotspotUsername) {
      nextName = String(updates.username ?? currentName).trim();
    } else {
      nextName = prepaidHotspotUsernameForEdit(currentName, current.phone, updates.phone ?? current.phone);
    }
    if (!nextName) throw new Error("A valid phone and hotspot login are required for this customer.");
    updates.username = nextName;
  } else if (planType === "pppoe") {
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(nextName)) {
      throw new Error("The PPPoE username must use only letters, digits, dots, underscores, @ or hyphens.");
    }
    updates.pppoe_username = nextName;
  } else if (planType === "vlan") {
    if (nextName && !/^[A-Za-z0-9_.:@-]{3,64}$/.test(nextName)) {
      throw new Error("The VLAN Hotspot username must use 3–64 safe characters.");
    }
    updates.username = nextName || null;
    updates.password = nextPassword || null;
  }
  if (planType === "hotspot" && !/^[A-Za-z0-9_.:@-]{1,64}$/.test(nextName)) {
    throw new Error("The hotspot username contains characters that are unsafe for MikroTik scripts.");
  }
  if (planType !== "vlan") {
    if (!currentName) throw new Error("The existing MikroTik login is missing. Repair it before editing this prepaid user.");
    if (planType === "hotspot" && !current.username) {
      throw new Error("The existing Hotspot login is missing. Repair it before editing this prepaid user.");
    }
    const column = planType === "pppoe" ? "pppoe_username" : "username";
    const duplicates = await sbSelectStrict<{ id: number }>(
      "isp_customers",
      `admin_id=eq.${adminId}&${column}=eq.${encodeURIComponent(nextName)}&id=neq.${current.id}&select=id&limit=1`,
    );
    if (duplicates[0]) throw new Error("Another customer already has this MikroTik username.");
    if (!options.restoreIdentity && !options.skipRadius) {
      options.onRadiusIdentity?.(await hasRadiusCustomerStrict(currentName));
      if (nextName !== currentName) await assertRadiusTargetEmptyStrict(nextName);
    }
  }
  const enabled = nextStatus === "active" &&
    (!nextExpiry || (Number.isFinite(Date.parse(nextExpiry)) && Date.parse(nextExpiry) > Date.now()));

  let routerSynced = false;
  let syncedRouterId: number | null = null;
  let syncedRouterName: string | null = null;
  let dataPolicy: ReturnType<typeof validateFupPolicy> | null = null;
  let paidHotspotBindingSnapshot = options.paidHotspotBindingSnapshot ?? null;
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
    if (planType === "hotspot" && currentName !== nextName && enabled) {
      await options.assertLock?.();
      const activeUsers = await fetchHotspotUsers(creds);
      if (activeUsers.some(user => user.user === currentName)) {
        throw new Error(
          "This Hotspot username cannot be changed while its session is active. Suspend the account or retry after the session ends.",
        );
      }
    }
    const rawDataLimitMb = Number(updates.fup_limit_mb ?? current.fup_limit_mb ?? plan.data_limit_mb);
    const dataLimitMb = Number.isFinite(rawDataLimitMb) && rawDataLimitMb > 0 ? rawDataLimitMb : null;
    const planDataPolicy = validateFupPolicy(
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
    dataPolicy = planDataPolicy;
    const limitBytesTotal = planDataPolicy.dataCapMode === "throttle" || dataLimitMb === null
      ? "0"
      : String(dataLimitMegabytesToBytes(dataLimitMb));
    const address = String(
      updates.ip_address === undefined ? current.ip_address ?? "" : updates.ip_address ?? "",
    ).trim();
    const updateHotspotUserAddress = updates.ip_address !== undefined
      && address !== String(current.ip_address ?? "").trim();
    const rateLimit = routerRateLimit(
      plan.speed_down,
      plan.speed_up,
      plan.speed_down_unit ?? "Mbps",
      plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
    );
    if (planType === "hotspot") {
      const oldAddress = String(current.ip_address ?? "").trim();
      const oldMac = String(current.mac_address ?? "").trim().toLowerCase();
      const newMac = String(updates.mac_address === undefined ? current.mac_address ?? "" : updates.mac_address ?? "").trim().toLowerCase();
      const accessChanged = nextName !== currentName
        || plan.id !== current.plan_id
        || nextStatus !== String(current.status ?? "").toLowerCase()
        || !sameExpiry
        || address !== oldAddress
        || newMac !== oldMac;
      if (paidHotspotBindingSnapshot || accessChanged) {
        paidHotspotBindingSnapshot ??= await getPaidHotspotBindingSnapshot(creds, {
          name: currentName,
          macAddress: current.mac_address,
          ipAddress: current.ip_address,
        });
        if (paidHotspotBindingSnapshot) {
          if (
            !options.restoreIdentity
            && updates.mac_address === undefined
            && (paidHotspotBindingSnapshot.bindings?.length ?? 1) === 1
          ) {
            updates.mac_address = paidHotspotBindingSnapshot.macAddress;
          }
          options.onPaidHotspotBindingSnapshot?.(paidHotspotBindingSnapshot);
        }
      }
    }

    if (planType === "vlan") {
      const vlanContext = await loadVlanCustomerContext(
        adminId,
        plan,
        routerId,
        updates.port_id ?? current.port_id ?? plan.port_id,
      );
      const address = validateVlanCustomerAddress(
        updates.ip_address === undefined ? current.ip_address : updates.ip_address,
        vlanContext.port,
      );
      if (vlanContext.port.hotspot_enabled) {
        if (!nextName) nextName = `vlan_${randomBytes(10).toString("hex")}`;
        if (!nextPassword) nextPassword = randomBytes(18).toString("base64url");
        if (!/^[A-Za-z0-9_.:@-]{3,64}$/.test(nextName)) {
          throw new Error("The VLAN Hotspot username must use 3–64 safe characters.");
        }
        const duplicateVlanLogin = await sbSelectStrict<{ id: number }>(
          "isp_customers",
          `router_id=eq.${plan.router_id}&username=eq.${encodeURIComponent(nextName)}&id=neq.${current.id}&select=id&limit=1`,
        );
        if (duplicateVlanLogin[0]) throw new Error("Another customer already has this VLAN Hotspot username.");
        updates.username = nextName;
        updates.password = nextPassword;
      }
      const assignedAddresses = await sbSelectStrict<{ id: number }>(
        "isp_customers",
        `admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&port_id=eq.${plan.port_id}&ip_address=eq.${encodeURIComponent(address)}&id=neq.${current.id}&select=id&limit=1`,
      );
      if (assignedAddresses[0]) throw new Error("This static IP address is already assigned to another customer.");
      await options.onRouterMutation?.();
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
      if (vlanContext.port.hotspot_enabled) {
        const resources = portServiceResourceNames(vlanContext.port);
        await options.onRouterMutation?.();
        await reconcileHotspotUserAccess(creds, {
          name: nextName,
          password: nextPassword,
          profile: resources.hotspotProfile,
          server: resources.hotspotServer,
          comment: `OcholaSupernet VLAN customer ${adminId}:${current.id}`,
          expiresAt: nextExpiry,
          enabled,
          address,
          macAddress: String(updates.mac_address ?? current.mac_address ?? "").trim() || null,
          resetCounters: false,
        });
        if (currentName && currentName !== nextName) {
          await options.assertLock?.();
          await removeHotspotUser(creds, currentName);
          await removeHotspotUserExpiry(creds, currentName);
          await removeHotspotUserRateQueue(creds, currentName);
        }
      }
      const previousAddress = String(current.ip_address ?? "").trim();
      if (previousAddress && previousAddress !== address && isValidIpv4(previousAddress)) {
        await options.assertLock?.();
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
      await options.onRouterMutation?.();
      await reconcilePppoeUserAccess(creds, {
        name: nextName,
        password: nextPassword,
        profile: plan.name,
        comment: nextName,
        expiresAt: nextExpiry,
        enabled,
        remoteAddress: address || null,
      });
    } else if (planType === "hotspot") {
      await options.onRouterMutation?.();
      await reconcileHotspotUserAccess(creds, {
        name: nextName,
        password: nextPassword,
        profile: hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id),
        comment: nextName,
        expiresAt: nextExpiry,
        enabled,
        limitBytesTotal,
        address: address || null,
        updateUserAddress: updateHotspotUserAddress,
        macAddress: String(updates.mac_address ?? current.mac_address ?? "").trim() || null,
        rateLimit,
        dataCapMode: planDataPolicy.dataCapMode,
        fupLimitBytes: planDataPolicy.dataCapMode === "throttle" && dataLimitMb !== null
          ? dataLimitMegabytesToBytes(dataLimitMb)
          : undefined,
        fupSpeedDownMbps: planDataPolicy.fupSpeedDown ?? undefined,
        fupSpeedUpMbps: planDataPolicy.fupSpeedUp ?? undefined,
        sharedUsers: plan.shared_users ?? 1,
        resetCounters: false,
      });
    }
    if (planType !== "vlan" && currentName && currentName !== nextName) {
      await options.assertLock?.();
      if (planType === "pppoe") {
        await disconnectPPPActiveByName(creds, currentName);
        await removePPPSecretByName(creds, currentName);
        await removePppUserExpiry(creds, currentName);
      } else {
        await disconnectHotspotActiveUser(creds, currentName);
        await removeHotspotUser(creds, currentName);
        await removeHotspotUserExpiry(creds, currentName);
        await removeHotspotUserRateQueue(creds, currentName);
      }
    }
    if (planType === "hotspot" && paidHotspotBindingSnapshot) {
      await options.onRouterMutation?.();
      await reconcilePaidHotspotBinding(creds, {
        snapshot: paidHotspotBindingSnapshot,
        currentName,
        currentMacAddress: options.restoreIdentity
          ? current.mac_address
          : paidHotspotBindingSnapshot.macAddress,
        nextName,
        nextMacAddress: String(
          updates.mac_address === undefined
            ? current.mac_address ?? paidHotspotBindingSnapshot.macAddress
            : updates.mac_address ?? "",
        ).trim() || null,
        expiresAt: nextExpiry,
        enabled,
        replaceBindings: options.replacePaidHotspotBindings ?? replacePaidHotspotBindings,
      });
    }
    routerSynced = true;
    syncedRouterId = router.id;
    syncedRouterName = router.name;
  }

  if (nextName && plan && planType !== "vlan" && !options.skipRadius) {
    await options.assertLock?.();
    if (currentName !== nextName) {
      if (options.restoreIdentity) {
        await rollbackRadiusCustomerMoveStrict(currentName, nextName);
      } else {
        await moveRadiusCustomerStrict(currentName, nextName, options.onRadiusMutation);
      }
    } else {
      options.onRadiusMutation?.();
    }
    await syncRadiusCustomerStrict({
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
      dataCapMode: dataPolicy?.dataCapMode ?? "disconnect",
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

router.post("/customers/:id/hotspot-reconnect", requireAdmin(), async (req, res): Promise<void> => {
  const sessionAdminId = authenticatedAdminId(req);
  const customerId = positivePortalId(req.params.id);
  if (!sessionAdminId || !customerId) {
    res.status(400).json({ error: "A valid signed-in account and customer ID are required." });
    return;
  }
  const account = await authenticatedAccount(req);
  if (!account) {
    res.status(401).json({ error: "A valid signed-in account is required." });
    return;
  }

  const customerFilter =
    `id=eq.${customerId}&admin_id=eq.${sessionAdminId}&select=id,admin_id,name,mac_address,username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason&limit=1`;
  const initialRows = await sbSelectStrict<CustomerRow>("isp_customers", customerFilter);
  const initial = initialRows[0];
  if (!initial) {
    res.status(404).json({ error: "Prepaid Hotspot account not found." });
    return;
  }

  try {
    const result = await prepaidHotspotReconnectOperations.withCustomerEditLock(
      initial.admin_id,
      customerId,
      async assertLock => {
      await assertLock();
      const customer = (await sbSelectStrict<CustomerRow>("isp_customers", customerFilter))[0];
      if (!customer) {
        return { status: "not_eligible" as const, message: "This prepaid Hotspot account no longer exists." };
      }
      if (normalizePlanServiceType(customer.type) !== "hotspot") {
        return { status: "not_eligible" as const, message: "Reconnect is available for Hotspot accounts only." };
      }
      if (!isPrepaidCustomerEntitled(
        customer.status,
        customer.expires_at,
        customer.depletion_reason,
        Date.now(),
      )) {
        return {
          status: "not_eligible" as const,
          message: "This account is suspended, expired, or has exhausted its package data.",
        };
      }
      const username = String(customer.username ?? "").trim();
      const password = String(customer.password ?? "");
      const macAddress = normalisePortalMac(customer.mac_address);
      const planId = positivePortalId(customer.plan_id);
      if (!username || !password || !macAddress || !planId) {
        return {
          status: "not_eligible" as const,
          message: "This account is missing its Hotspot login, device MAC, or package assignment.",
        };
      }

      const plan = await loadScopedCustomerPlan(
        account,
        planId,
        "hotspot",
        customer.router_id ?? undefined,
        customer.port_id ?? undefined,
        true,
      );
      if (
        !plan
        || normalizePlanServiceType(plan.type) !== "hotspot"
        || (customer.router_id !== null && customer.router_id !== plan.router_id)
        || (customer.port_id !== null && customer.port_id !== plan.port_id)
        || !plan.router_id
      ) {
        return {
          status: "not_eligible" as const,
          message: "The account's Hotspot package or router assignment could not be verified.",
        };
      }

      const tenantId = account.parent_id ?? account.id;
      const routerRow = (await sbSelectStrict<RouterRow>(
        "isp_routers",
        `id=eq.${plan.router_id}&admin_id=eq.${tenantId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
      ))[0];
      if (!routerRow) {
        return { status: "router_unavailable" as const, message: "The account's Hotspot router could not be found." };
      }
      const creds = hotspotReconnectRouterCredentials(routerRow);

      let hotspotServer: string | undefined;
      if (plan.port_id) {
        const portOwnerFilter = account.role === "reseller"
          ? `&assigned_reseller_id=eq.${account.id}&handoff_mode=eq.vlan_services`
          : "&assigned_reseller_id=is.null";
        const port = (await sbSelectStrict<VlanPortRow>(
          "isp_reseller_ports",
          `id=eq.${plan.port_id}&admin_id=eq.${tenantId}&router_id=eq.${plan.router_id}${portOwnerFilter}&status=eq.active&hotspot_enabled=is.true&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled,link_status&limit=1`,
        ))[0];
        if (!port) {
          return {
            status: "not_eligible" as const,
            message: "The account's assigned Hotspot service port is not active.",
          };
        }
        hotspotServer = portServiceResourceNames(port).hotspotServer;
      }

      const activeUsers = await prepaidHotspotReconnectOperations.fetchHotspotUsers(creds);
      const userSessions = activeUsers.filter(user => user.user === username);
      if (userSessions.some(user => normalisePortalMac(user.macAddress) === macAddress)) {
        return { status: "already_connected" as const, message: "This device already has an active Hotspot session." };
      }
      const maxSessions = Math.max(1, Math.floor(Number(plan.shared_users) || 1));
      if (userSessions.length >= maxSessions) {
        return {
          status: "session_limit" as const,
          message: `This account is already using its ${maxSessions}-device limit on another device.`,
        };
      }

      const clientIp = await prepaidHotspotReconnectOperations.resolveHotspotClientIpByMac(creds, macAddress);
      if (!clientIp || !isValidIpv4(clientIp)) {
        return {
          status: "device_not_found" as const,
          message: "The router cannot see this device yet. Connect it to the Hotspot Wi-Fi, then retry.",
        };
      }

      const rawLimitMb = Number(customer.fup_limit_mb ?? plan.data_limit_mb);
      const dataLimitMb = Number.isFinite(rawLimitMb) && rawLimitMb > 0 ? rawLimitMb : null;
      const dataPolicy = dataLimitMb === null
        ? null
        : validateFupPolicy(
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
      const capBytes = dataLimitMb === null ? null : dataLimitMegabytesToBytes(dataLimitMb);
      let limitBytesTotal = "0";
      let fupLimitBytes: number | undefined;
      if (capBytes !== null) {
        const usage = await loadSharedRoamingUsage(
          tenantId,
          plan,
          username,
          plan.router_id,
          {
            credentialsForRouter: hotspotReconnectRouterCredentials,
            fetchUsage: prepaidHotspotReconnectOperations.fetchHotspotUserUsage,
          },
        );
        const allowance = sharedHotspotUsageAllowance(
          capBytes,
          usage.totalBytes,
          usage.targetRouterBytes,
        );
        if (dataPolicy?.dataCapMode === "throttle") {
          fupLimitBytes = Math.max(1, allowance.targetFupThresholdBytes);
        } else {
          limitBytesTotal = String(allowance.targetRouterLimitBytes);
          if (usage.totalBytes >= capBytes) {
            await assertLock();
            await prepaidHotspotReconnectOperations.reconcileHotspotUserAccess(creds, {
              name: username,
              password,
              profile: hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id),
              ...(hotspotServer ? { server: hotspotServer } : {}),
              expiresAt: customer.expires_at,
              enabled: false,
              limitBytesTotal,
              macAddress,
              resetCounters: false,
            });
            await assertLock();
            await sbUpdateStrict(
              "isp_customers",
              `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}&select=id`,
              { status: "expired", depletion_reason: "data_limit" },
            );
            return {
              status: "depleted" as const,
              message: "This package has used its full data allowance and has been disabled.",
            };
          }
        }
      }

      await assertLock();
      await prepaidHotspotReconnectOperations.reconcileHotspotUserAccess(creds, {
        name: username,
        password,
        profile: hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id),
        ...(hotspotServer ? { server: hotspotServer } : {}),
        preserveActiveSession: true,
        comment: username,
        expiresAt: customer.expires_at,
        enabled: true,
        limitBytesTotal,
        address: clientIp,
        macAddress,
        rateLimit: routerRateLimit(
          plan.speed_down,
          plan.speed_up,
          plan.speed_down_unit ?? "Mbps",
          plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
        ),
        ...(dataPolicy
          ? {
              dataCapMode: dataPolicy.dataCapMode,
              ...(dataPolicy.dataCapMode === "throttle" && fupLimitBytes !== undefined
                ? {
                    fupLimitBytes,
                    fupSpeedDownMbps: dataPolicy.fupSpeedDown ?? undefined,
                    fupSpeedUpMbps: dataPolicy.fupSpeedUp ?? undefined,
                  }
                : {}),
            }
          : {}),
        sharedUsers: plan.shared_users ?? 1,
        resetCounters: false,
      });
      await assertLock();
      const connected = await prepaidHotspotReconnectOperations.connectHotspotUser(creds, {
        user: username,
        password,
        ip: clientIp,
        macAddress,
        ...(hotspotServer ? { server: hotspotServer } : {}),
      });
      return connected
        ? { status: "connected" as const, message: "The device reconnected to the Hotspot." }
        : {
            status: "router_rejected" as const,
            message: "The router restored the account but did not confirm a connection. Retry after checking the device.",
          };
      },
    );
    res.json(result);
  } catch (error) {
    logger.warn({ err: error, adminId: sessionAdminId, customerId }, "[customers/hotspot-reconnect] failed");
    res.status(503).json({
      error: "Could not safely reconnect this device. Check the account and router connection, then retry.",
      status: "router_unavailable",
    });
  }
});

router.post("/customers/hotspot-admin-grant", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  const account = await authenticatedAccount(req);
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const routerId = positivePortalId(req.body?.routerId);
  const planId = positivePortalId(req.body?.planId);
  const macAddress = normalizeHotspotGrantMac(req.body?.macAddress);
  if (!adminId || !account) {
    res.status(401).json({ error: "A valid signed-in administrator is required." });
    return;
  }
  if (account.role === "reseller") {
    res.status(403).json({ error: "This admin grant is available to the ISP account owner only." });
    return;
  }
  if (!name || name.length > 100 || phone.length > 40 || !routerId || !planId || !macAddress) {
    res.status(400).json({ error: "Enter a customer name, a valid device MAC, a router, and an active Hotspot plan." });
    return;
  }

  const tenantId = account.parent_id ?? account.id;
  const plan = await loadScopedCustomerPlan(account, planId, "hotspot", routerId, null);
  if (
    !plan
    || normalizePlanServiceType(plan.type) !== "hotspot"
    || plan.router_id !== routerId
    || plan.port_id !== null
  ) {
    res.status(400).json({ error: "Choose an active direct Hotspot plan assigned to the selected router." });
    return;
  }
  const routerRow = (await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${tenantId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  ))[0];
  if (!routerRow) {
    res.status(404).json({ error: "The selected router is not available to this ISP account." });
    return;
  }

  const username = hotspotAdminGrantUsername(routerId, macAddress);
  const credentials = routerCredentials(routerRow);
  const customerSelect = "id,name,phone,mac_address,username,password,type,plan_id,router_id,port_id,status,expires_at";
  const readAllGrantRows = async <T extends { id: number }>(
    table: string,
    scope: string,
    select: string,
  ): Promise<T[]> => {
    const rows: T[] = [];
    let afterId = 0;
    for (let page = 0; page < 50; page += 1) {
      const batch = await sbSelectStrict<T>(
        table,
        `${scope}&id=gt.${afterId}&select=${select}&order=id.asc&limit=1000`,
      );
      rows.push(...batch);
      if (batch.length < 1000) return rows;
      const nextId = batch[batch.length - 1]?.id;
      if (!Number.isSafeInteger(nextId) || nextId <= afterId) {
        throw new Error("The safe duplicate scan did not advance through records. No account was created.");
      }
      afterId = nextId;
    }
    throw new Error("This account has too many records for a complete safe duplicate check. No account was created.");
  };
  const readMatches = async () => {
    const [customers, plans] = await Promise.all([
      readAllGrantRows<HotspotAdminGrantCustomer>("isp_customers", `admin_id=eq.${adminId}`, customerSelect),
      readAllGrantRows<HotspotAdminGrantPlanScope>("isp_plans", `admin_id=eq.${tenantId}`, "id,type,router_id,port_id"),
    ]);
    return findHotspotAdminGrantMatches(customers, plans, { routerId, macAddress, name });
  };
  const sendMatches = (matches: Awaited<ReturnType<typeof readMatches>>) => {
    res.status(409).json({
      code: "HOTSPOT_ADMIN_GRANT_MATCHES",
      error: "Matching Hotspot records already exist. Select one eligible account to update instead of creating a duplicate.",
      matches: matches.map(({ password: _password, ...match }) => match),
    });
  };

  let pending: CustomerRow | undefined;
  let routerMutationAttempted = false;
  let hadRadiusBefore = false;
  let radiusMutationAttempted = false;
  let paidHotspotBindingSnapshot: PaidHotspotBindingSnapshot | null = null;
  const profile = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
  const expiresAt = hotspotAdminGrantExpiry();
  const password = randomBytes(24).toString("base64url");

  try {
    const matches = await readMatches();
    if (matches.length) {
      sendMatches(matches);
      return;
    }

    const conflictingDbUsername = await sbSelectStrict<{ id: number; admin_id: number }>(
      "isp_customers",
      `username=eq.${encodeURIComponent(username)}&select=id,admin_id&limit=1`,
    );
    if (conflictingDbUsername.length) {
      res.status(409).json({
        code: "HOTSPOT_ADMIN_GRANT_USERNAME_CONFLICT",
        error: "The generated device login is already assigned to another account. Resolve that record before granting access.",
      });
      return;
    }
    await assertRadiusTargetEmptyStrict(username);

    const routerUsers = await fetchHotspotUserList(credentials);
    const routerConflicts = routerUsers.filter(user =>
      user.name.trim().toLowerCase() === username.toLowerCase()
      || normalizeHotspotGrantMac(user.macAddress) === macAddress,
    );
    if (routerConflicts.length) {
      res.status(409).json({
        code: "HOTSPOT_ADMIN_GRANT_ROUTER_CONFLICT",
        error: "MikroTik already has a Hotspot login for this device or generated username, but no matching prepaid record was found. Review the router account before granting access.",
        routerUsernames: Array.from(new Set(routerConflicts.map(user => user.name).filter(Boolean))),
      });
      return;
    }
    if (await getPaidHotspotBindingSnapshot(credentials, { name: username, macAddress })) {
      res.status(409).json({
        code: "HOTSPOT_ADMIN_GRANT_BINDING_CONFLICT",
        error: "MikroTik has a managed device binding for this login already. Select or repair its prepaid account before granting access.",
      });
      return;
    }
    await requireHotspotUserProfile(credentials, profile);

    try {
      [pending] = await sbInsertStrict<CustomerRow>("isp_customers", {
        admin_id: adminId,
        name,
        phone: phone || null,
        mac_address: macAddress,
        username,
        password,
        type: "hotspot",
        plan_id: plan.id,
        router_id: routerId,
        port_id: null,
        ip_address: null,
        status: "provisioning",
        expires_at: expiresAt,
        fup_limit_mb: null,
      });
    } catch (error) {
      if (error instanceof SupabaseHttpError && error.status === 409) {
        const concurrentMatches = await readMatches();
        if (concurrentMatches.length) {
          sendMatches(concurrentMatches);
          return;
        }
        res.status(409).json({
          code: "HOTSPOT_ADMIN_GRANT_USERNAME_CONFLICT",
          error: "Another request claimed this device login first. Refresh Prepaid Users and select the existing account.",
        });
        return;
      }
      throw error;
    }
    if (!pending?.id) throw new Error("The pending prepaid account could not be confirmed.");

    const customerFilter = `id=eq.${pending.id}&admin_id=eq.${adminId}&select=*&limit=1`;
    const updates: Record<string, unknown> = { status: "active" };
    const previousFields: Record<string, unknown> = { status: "provisioning" };
    const saved = await withCustomerEditLock(adminId, pending.id, async assertLock =>
      saveCustomerEditWithRouter({
        applyRouter: async markMutation => {
          const result = await reconcileCustomerAccess(pending!, updates, adminId, {
            preserveHotspotUsername: true,
            onRouterMutation: async () => {
              markMutation();
              routerMutationAttempted = true;
              await assertLock();
            },
            onRadiusIdentity: exists => { hadRadiusBefore = exists; },
            onRadiusMutation: () => { radiusMutationAttempted = true; },
            onPaidHotspotBindingSnapshot: snapshot => { paidHotspotBindingSnapshot = snapshot; },
            assertLock,
          });
          await assertLock();
          if (!result.routerSynced) throw new Error("MikroTik did not confirm the Hotspot account update.");
          const confirmedUsers = (await fetchHotspotUserList(credentials)).filter(user => user.name === username);
          if (
            confirmedUsers.length !== 1
            || confirmedUsers[0].disabled
            || confirmedUsers[0].profile !== profile
          ) {
            throw new Error("MikroTik did not confirm exactly one enabled Hotspot login with the selected plan profile.");
          }
          return result;
        },
        restoreRouter: async () => {
          await assertLock();
          const attempted = { ...pending!, ...updates } as CustomerRow;
          const restored = await reconcileCustomerAccess(attempted, previousFields, adminId, {
            allowInactivePlan: true,
            restoreIdentity: true,
            skipRadius: true,
            paidHotspotBindingSnapshot,
            onRouterMutation: assertLock,
            assertLock,
          });
          if (!restored.routerSynced) throw new Error("The pending MikroTik account could not be disabled.");
          if (radiusMutationAttempted && !hadRadiusBefore) {
            await assertLock();
            await removeRadiusCustomerStrict(username);
          }
        },
        saveRecord: async () => {
          await assertLock();
          const [row] = await sbUpdateStrict<CustomerRow>("isp_customers", customerFilter, updates);
          if (!row || !customerFieldsMatch(row, updates)) {
            throw new Error("The prepaid record did not confirm the admin grant.");
          }
          return row;
        },
        readRecord: async () => (await sbSelectStrict<CustomerRow>("isp_customers", customerFilter))[0],
        matchesRequested: row => customerFieldsMatch(row, updates),
        matchesBefore: row => customerFieldsMatch(row, previousFields),
        confirmedRejected: error => error instanceof SupabaseHttpError
          && [400, 401, 403, 404, 409, 422].includes(error.status),
      }),
    );

    void logActivity({
      adminId,
      type: "customer",
      action: "admin_hotspot_grant",
      subject: name,
      details: {
        customerId: pending.id,
        username,
        routerId,
        planId: plan.id,
        grantDays: 30,
        expiresAt,
        macAddress,
        paymentCreated: false,
      },
    });
    res.status(201).json({
      ok: true,
      customerId: saved.row.id,
      name: saved.row.name,
      username,
      password,
      routerName: saved.router.routerName,
      expiresAt,
      mikrotikSynced: saved.router.routerSynced,
      connectionStatus: "not_checked",
      message: "The 30-day Hotspot admin grant was saved and confirmed on MikroTik. No payment transaction was created.",
    });
  } catch (error) {
    logger.error(
      { err: error, adminId, routerId, planId, customerId: pending?.id, routerMutationAttempted },
      "[customers/hotspot-admin-grant] provisioning failed",
    );
    if (pending?.id && routerMutationAttempted) {
      try {
        await withCustomerEditLock(adminId, pending.id, async assertLock => {
          await assertLock();
          await reconcileHotspotUserAccess(credentials, {
            name: username,
            password,
            profile,
            comment: username,
            expiresAt,
            enabled: false,
            macAddress,
            resetCounters: false,
          });
          await assertLock();
        });
        if (radiusMutationAttempted && !hadRadiusBefore) {
          await removeRadiusCustomerStrict(username);
        }
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, adminId, routerId, customerId: pending.id, username },
          "[customers/hotspot-admin-grant] safe disable failed",
        );
      }
    }
    res.status(503).json({
      error: error instanceof Error ? error.message : "The Hotspot admin grant could not be confirmed.",
      ...(pending?.id ? { customerId: pending.id, username, retryable: true } : {}),
    });
  }
});

router.post("/customers", requireAdmin(), async (req, res): Promise<void> => {
  const {
    adminId, ispId, name, phone, email, planId, type, ipAddress, macAddress,
    status, expiryDate, pppoeUsername, routerId, portId, username: requestedUsername, password: requestedPassword,
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
  const account = await authenticatedAccount(req);
  if (!account) {
    res.status(401).json({ error: "A valid signed-in account is required." });
    return;
  }
  if (account.role === "reseller") {
    res.status(403).json({ error: "Reseller customer creation must use the assigned Hotspot or PPPoE service path." });
    return;
  }

  const requestedPlanId = Number(planId);
  const mayInferVlanFromPlan = type === undefined || type === null || type === "";
  const needsVlanPlanCheck = String(type ?? "").trim().toLowerCase() === "vlan" || mayInferVlanFromPlan;
  let plan: PlanRow | undefined;
  if (Number.isSafeInteger(requestedPlanId) && requestedPlanId > 0) {
    const planFilter =
      `id=eq.${requestedPlanId}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(null)}&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,is_active,owner_reseller_id&limit=1`;
    const planRows = needsVlanPlanCheck
      ? await sbSelectStrict<PlanRow>("isp_plans", planFilter)
      : await sbSelect<PlanRow>("isp_plans", planFilter);
    plan = planRows[0];
    if (!plan) {
      res.status(400).json({ error: "The selected package is not owned by this ISP account." });
      return;
    }
  }
  const planServiceType = normalizePlanServiceType(plan?.type);
  const requestedType = String(type ?? (planServiceType === "vlan" ? "vlan" : "hotspot")).trim().toLowerCase();
  if (planServiceType === "vlan" && requestedType !== "vlan") {
    res.status(400).json({ error: "The selected plan is VLAN service; create the customer as type vlan." });
    return;
  }
  if (plan && planServiceType !== requestedType) {
    res.status(400).json({ error: "The selected package does not match the requested customer service." });
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
    const needsHotspotLogin = Boolean(vlanContext.port.hotspot_enabled);
    const vlanUsername = needsHotspotLogin
      ? (String(requestedUsername ?? "").trim() || `vlan_${randomBytes(10).toString("hex")}`)
      : null;
    const vlanPassword = needsHotspotLogin
      ? (String(requestedPassword ?? "") || randomBytes(18).toString("base64url"))
      : null;
    if (vlanUsername && !/^[A-Za-z0-9_.:@-]{3,64}$/.test(vlanUsername)) {
      res.status(400).json({ error: "The VLAN Hotspot username must use 3–64 safe characters." });
      return;
    }
    if (vlanPassword && vlanPassword.length < 8) {
      res.status(400).json({ error: "The VLAN Hotspot password must be at least 8 characters." });
      return;
    }
    if (vlanUsername) {
      const duplicateUsernames = await sbSelectStrict<{ id: number }>(
        "isp_customers",
        `router_id=eq.${plan.router_id}&username=eq.${encodeURIComponent(vlanUsername)}&select=id&limit=1`,
      );
      if (duplicateUsernames[0]) {
        res.status(409).json({ error: "That Hotspot username is already assigned. Choose a different username." });
        return;
      }
    }
    const creds = routerCredentials(vlanContext.router);
    const [pending] = await sbInsertStrict<CustomerRow>("isp_customers", {
      admin_id: effectiveAdminId,
      name,
      phone,
      email: email ?? null,
      plan_id: plan.id,
      type: "vlan",
      username: vlanUsername,
      password: vlanPassword,
      router_id: plan.router_id,
      port_id: plan.port_id,
      ip_address: address,
      mac_address: macAddress ?? null,
      status: "provisioning",
      expires_at: expiresAt,
      pppoe_username: null,
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
      if (needsHotspotLogin && vlanUsername && vlanPassword) {
        const resources = portServiceResourceNames(vlanContext.port);
        await reconcileHotspotUserAccess(creds, {
          name: vlanUsername,
          password: vlanPassword,
          profile: resources.hotspotProfile,
          server: resources.hotspotServer,
          comment: `OcholaSupernet VLAN customer ${effectiveAdminId}:${pending.id}`,
          expiresAt,
          enabled,
          address,
          macAddress: String(macAddress ?? "").trim() || null,
          resetCounters: false,
        });
      }
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
      if (vlanUsername && needsHotspotLogin) {
        await removeHotspotUser(creds, vlanUsername).catch(cleanupError => cleanupErrors.push(
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        ));
      }
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
    adminId, ispId, name, phone, email, planId, plan_id, routerId, router_id, portId, port_id,
    type, ipAddress, ip_address, username, pppoe_username, mac_address, status, expiryDate, expires_at,
    password, fup_limit_mb, extend_days,
  } = req.body;
  if (
    password !== undefined
    && password !== null
    && password !== ""
    && (typeof password !== "string" || password.length < 6)
  ) {
    res.status(400).json({ error: "A customer password must have at least 6 characters." });
    return;
  }
  const effectiveAdminId = authenticatedAdminId(req, adminId || ispId);
  if (!Number.isSafeInteger(effectiveAdminId) || effectiveAdminId < 1) {
    res.status(400).json({ error: "A valid ISP account is required" });
    return;
  }
  const customerId = Number(id);
  if (!Number.isSafeInteger(customerId) || customerId < 1) {
    res.status(400).json({ error: "A valid customer ID is required." });
    return;
  }
  try {
    const response = await withCustomerEditLock(effectiveAdminId, customerId, async assertLock => {
  const customerFilter = `id=eq.${id}&admin_id=eq.${effectiveAdminId}`;
  const current = (await sbSelectStrict<CustomerRow>(
    "isp_customers",
    `${customerFilter}&select=*&limit=1`,
  ))[0];
  if (!current) return { status: 404, body: { error: "Customer not found" } };

  let normalizedExpiry: string | null | undefined;
  try {
    if (extend_days !== undefined) {
      if (expiryDate !== undefined || expires_at !== undefined || status !== undefined) {
        return { status: 400, body: { error: "An extension must be submitted by itself; do not combine it with a manual expiry or status change." } };
      }
      normalizedExpiry = calculateCustomerExtensionExpiry(current.expires_at, extend_days);
    } else {
      normalizedExpiry = asOptionalIso(expiryDate !== undefined ? expiryDate : expires_at);
    }
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : "Invalid expiry date" } };
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
    updates.status = customerStatusForExpiryEdit(current.status, normalizedExpiry);
  }
  if (updates.status === null || updates.status === "") {
    return { status: 400, body: { error: "Choose a valid prepaid user status before saving." } };
  }
  const account = await authenticatedAccount(req);
  if (!account) {
    return { status: 401, body: { error: "A valid signed-in account is required." } };
  }
  const resultingPlanId = Number(updates.plan_id ?? current.plan_id);
  const resultingType = String(updates.type ?? current.type ?? "hotspot").trim().toLowerCase();
  const unchangedPlan = resultingPlanId === Number(current.plan_id);
  const currentService = normalizePlanServiceType(current.type);
  const resultingService = normalizePlanServiceType(resultingType);
  if (currentService === "other") {
    return { status: 400, body: { error: "Static IP prepaid edits need a separate MikroTik queue and binding reconciliation. No changes were saved." } };
  }
  if (resultingService === "other" || currentService !== resultingService) {
    return { status: 400, body: { error: "Changing the MikroTik service type requires a dedicated migration. No changes were saved." } };
  }
  if (!current.plan_id) {
    return { status: 400, body: { error: "This customer has no existing MikroTik-linked plan. Set up their router access before editing them as a prepaid user." } };
  }
  const previousPlan = await loadScopedCustomerPlan(
    account, Number(current.plan_id), String(current.type ?? "hotspot"),
    current.router_id, current.port_id, true,
  );
  if (!previousPlan) {
    return { status: 400, body: { error: "The current MikroTik plan is no longer available to this account. No changes were saved." } };
  }
  if (updates.plan_id === null) {
    return { status: 400, body: { error: "A prepaid user must remain on an existing MikroTik-linked plan." } };
  }
  if (Number.isSafeInteger(resultingPlanId) && resultingPlanId > 0) {
    const resultingPlan = await loadScopedCustomerPlan(
      account,
      resultingPlanId,
      resultingType,
      updates.router_id ?? current.router_id,
      updates.port_id ?? current.port_id,
      unchangedPlan,
    );
    if (!resultingPlan) {
      return { status: 400, body: { error: account.role === "reseller"
        ? "The selected package must belong to your reseller account and assigned active VLAN service."
        : "The selected package is not owned by this ISP account." } };
    }
    updates.plan_id = resultingPlan.id;
    updates.router_id = resultingPlan.router_id;
    updates.port_id = resultingPlan.port_id;
    updates.type = resultingType;
    if (
      ((current.router_id ?? previousPlan.router_id) && (current.router_id ?? previousPlan.router_id) !== resultingPlan.router_id)
      || ((current.port_id ?? previousPlan.port_id) && (current.port_id ?? previousPlan.port_id) !== resultingPlan.port_id)
    ) {
      return { status: 400, body: { error: "Moving a prepaid user to another router or service port requires a dedicated migration. No changes were saved." } };
    }
  } else {
    return { status: 400, body: { error: "Select an active plan linked to the current MikroTik service before saving." } };
  }

  const previousFields = Object.fromEntries(
    Object.keys(updates).map(key => [key, (current as unknown as Record<string, unknown>)[key]]),
  );
  const previousLogin = current.type === "pppoe"
    ? current.pppoe_username || current.username || ""
    : current.username || current.pppoe_username || "";
  previousFields.username = current.username;
  previousFields.pppoe_username = current.type === "pppoe" ? previousLogin : current.pppoe_username;
  let paidHotspotBindingSnapshot: PaidHotspotBindingSnapshot | null = null;
  let hadRadiusBefore = false;
  let radiusMutationAttempted = false;
  let saved: {
    row: CustomerRow;
    router: { routerSynced: boolean; routerId: number | null; routerName: string | null };
  };
  try {
    saved = await saveCustomerEditWithRouter({
      applyRouter: async markMutation => {
        const result = await reconcileCustomerAccess(current, updates, effectiveAdminId, {
          onRouterMutation: async () => {
            markMutation();
            await assertLock();
          },
          onRadiusIdentity: exists => { hadRadiusBefore = exists; },
          onRadiusMutation: () => { radiusMutationAttempted = true; },
          onPaidHotspotBindingSnapshot: snapshot => { paidHotspotBindingSnapshot = snapshot; },
          assertLock,
          allowInactivePlan: unchangedPlan,
        });
        await assertLock();
        if (!result.routerSynced) throw new Error("No MikroTik service was updated for this prepaid user.");
        return result;
      },
      restoreRouter: async () => {
        await assertLock();
        const attempted = { ...current, ...updates } as CustomerRow;
        const restored = await reconcileCustomerAccess(attempted, { ...previousFields }, effectiveAdminId, {
          allowInactivePlan: true,
          restoreIdentity: true,
          skipRadius: !radiusMutationAttempted || !hadRadiusBefore,
          paidHotspotBindingSnapshot,
          onRouterMutation: assertLock,
          assertLock,
        });
        if (!restored.routerSynced) throw new Error("The previous MikroTik service could not be restored.");
        if (radiusMutationAttempted && !hadRadiusBefore) {
          const attemptedLogin = current.type === "pppoe"
            ? String(updates.pppoe_username ?? previousLogin)
            : String(updates.username ?? previousLogin);
          await assertLock();
          await removeRadiusCustomerStrict(attemptedLogin);
        }
      },
      saveRecord: async () => {
        await assertLock();
        const [row] = await sbUpdateStrict<CustomerRow>("isp_customers", customerFilter, updates);
        if (!row || !customerFieldsMatch(row, updates)) {
          throw new Error("The customer record did not confirm the requested edit.");
        }
        return row;
      },
      readRecord: async () => (await sbSelectStrict<CustomerRow>(
        "isp_customers", `${customerFilter}&select=*&limit=1`,
      ))[0],
      matchesRequested: row => customerFieldsMatch(row, updates),
      matchesBefore: row => customerFieldsMatch(row, previousFields),
      confirmedRejected: error => error instanceof SupabaseHttpError
        && [400, 401, 403, 404, 409, 422].includes(error.status),
    });
  } catch (error) {
    logger.warn({
      customerId: Number(id),
      adminId: effectiveAdminId,
      planId: updates.plan_id ?? current.plan_id,
      expiry: updates.expires_at ?? current.expires_at,
      err: error instanceof Error ? error.message : String(error),
    }, "[customers] customer edit could not be confirmed on both MikroTik and the website");
    return { status: 503, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  await assertLock();
  void logActivity({ adminId: Number(effectiveAdminId), type: "customer", action: "updated", subject: String(updates.name ?? id), details: updates });
  return { status: 200, body: { ...saved.row, mikrotikSynced: true, syncedRouter: saved.router.routerName } };
    });
    res.status(response.status).json(response.body);
  } catch (error) {
    logger.warn({ customerId, adminId: effectiveAdminId, err: error instanceof Error ? error.message : String(error) },
      "[customers] customer edit lock could not be confirmed");
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/*
 * POST /api/customers/hotspot-login
 * Validates a hotspot customer's username + password.
 * Returns the customer row (without password) on success.
 */
router.get("/customers/hotspot-connected-devices", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const adminId = authenticatedAdminId(req, req.query.adminId);
    if (!adminId) {
      res.status(400).json({ error: "ISP account is required." });
      return;
    }
    const requestedRouterId = Number(req.query.routerId ?? 0);
    const routerFilter = Number.isSafeInteger(requestedRouterId) && requestedRouterId > 0
      ? `&id=eq.${requestedRouterId}`
      : "";
    const routers = await sbSelectStrict<RouterRow>(
      "isp_routers",
      `admin_id=eq.${adminId}${routerFilter}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&order=name.asc`,
    );
    const customers = await sbSelectStrict<ConnectedDeviceCustomerRow>(
      "isp_customers",
      `admin_id=eq.${adminId}&type=eq.hotspot&select=id,admin_id,name,phone,mac_address,username,pppoe_username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason,data_used_bytes,service_online,last_seen&limit=10000`,
    );
    const planIds = [...new Set(customers.map(row => Number(row.plan_id)).filter(id => Number.isSafeInteger(id) && id > 0))];
    const plans = planIds.length
      ? await sbSelectStrict<PlanRow>(
          "isp_plans",
          `admin_id=eq.${adminId}&id=in.(${planIds.join(",")})&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,is_active`,
        )
      : [];
    const plansById = new Map(plans.map(plan => [Number(plan.id), plan]));
    const output: Array<Record<string, unknown>> = [];
    const seenCustomers = new Set<number>();
    const routerErrors: Array<{ routerId: number; routerName: string; error: string }> = [];
    const queueStatsByRouter = new Map<number, Record<string, {
      bytesIn: number; bytesOut: number; totalBytes: number; rate: string; maxLimit: string;
    }>>();

    for (const routerRow of routers) {
      let liveDevices;
      const creds = routerCredentials(routerRow);
      try {
        liveDevices = await fetchHotspotConnectedDevices(creds);
      } catch (error) {
        logger.warn({ err: error, adminId, routerId: routerRow.id }, "[customers/hotspot-connected-devices] router query failed");
        routerErrors.push({
          routerId: Number(routerRow.id),
          routerName: routerRow.name,
          error: error instanceof Error ? error.message : "Router is unreachable.",
        });
        continue;
      }
      const routerCustomers = customers.filter((row) =>
        Number(row.router_id ?? plansById.get(Number(row.plan_id))?.router_id) === Number(routerRow.id)
        && Boolean(row.username?.trim()),
      );
      try {
        queueStatsByRouter.set(
          Number(routerRow.id),
          await fetchHotspotUserRateQueueStatsBulk(creds, routerCustomers.map(row => row.username!.trim())),
        );
      } catch (error) {
        logger.warn({ err: error, adminId, routerId: routerRow.id }, "[customers/hotspot-connected-devices] queue counters unavailable");
        queueStatsByRouter.set(Number(routerRow.id), {});
      }

      for (const device of liveDevices) {
        if (device.source !== "hotspot" && device.source !== "host") continue;
        const macAddress = normalizeHotspotMac(device.macAddress);
        if (!macAddress) continue;
        const customer = customers.find((row) =>
          normalizeHotspotMac(row.mac_address) === macAddress
          && Number(row.router_id ?? plansById.get(Number(row.plan_id))?.router_id) === Number(routerRow.id),
        );
        const plan = customer?.plan_id ? plansById.get(Number(customer.plan_id)) : undefined;
        const username = customer?.username?.trim() ?? "";
        const queueStats = username ? queueStatsByRouter.get(Number(routerRow.id))?.[username] : undefined;
        if (customer) {
          seenCustomers.add(Number(customer.id));
          await sbUpdate(
            "isp_customers",
            `id=eq.${customer.id}&admin_id=eq.${adminId}`,
            { service_online: true, last_seen: new Date().toISOString(), ip_address: device.address || customer.ip_address },
          );
        }
        output.push({
          routerId: Number(routerRow.id),
          routerName: routerRow.name,
          name: device.name || customer?.name || "",
          macAddress,
          ipAddress: device.address || customer?.ip_address || "",
          connected: true,
          source: device.source,
          uptime: device.uptime ?? "",
          lastSeen: customer ? new Date().toISOString() : null,
          customerId: customer ? Number(customer.id) : null,
          username: customer?.username ?? null,
          phone: customer?.phone ?? null,
          accountStatus: customer?.status ?? null,
          expiresAt: customer?.expires_at ?? null,
          planId: customer?.plan_id ?? null,
          planName: plan?.name ?? null,
          speedDown: plan?.speed_down ?? null,
          speedUp: plan?.speed_up ?? null,
          speedDownUnit: plan?.speed_down_unit ?? "Mbps",
          speedUpUnit: plan?.speed_up_unit ?? plan?.speed_down_unit ?? "Mbps",
          dataUsedBytes: queueStats?.totalBytes
            ?? (customer?.data_used_bytes != null
              ? Number(customer.data_used_bytes)
              : (device.bytesIn ?? 0) + (device.bytesOut ?? 0)),
          queueRate: queueStats?.rate ?? "",
          queueMaxLimit: queueStats?.maxLimit ?? "",
        });
      }
    }

    for (const customer of customers) {
      const plan = customer.plan_id ? plansById.get(Number(customer.plan_id)) : undefined;
      const routerId = Number(customer.router_id ?? plan?.router_id ?? 0);
      if (!customer.mac_address || seenCustomers.has(Number(customer.id)) || !routers.some(row => Number(row.id) === routerId)) continue;
      const queueStats = customer.username ? queueStatsByRouter.get(routerId)?.[customer.username] : undefined;
      await sbUpdate(
        "isp_customers",
        `id=eq.${customer.id}&admin_id=eq.${adminId}`,
        { service_online: false },
      );
      output.push({
        routerId,
        routerName: routers.find(row => Number(row.id) === routerId)?.name ?? "Router",
        name: customer.name ?? "",
        macAddress: normalizeHotspotMac(customer.mac_address) ?? customer.mac_address,
        ipAddress: customer.ip_address ?? "",
        connected: false,
        source: "account",
        uptime: "",
        lastSeen: customer.last_seen ?? null,
        customerId: Number(customer.id),
        username: customer.username,
        phone: customer.phone,
        accountStatus: customer.status,
        expiresAt: customer.expires_at,
        planId: customer.plan_id,
        planName: plan?.name ?? null,
        speedDown: plan?.speed_down ?? null,
        speedUp: plan?.speed_up ?? null,
        speedDownUnit: plan?.speed_down_unit ?? "Mbps",
        speedUpUnit: plan?.speed_up_unit ?? plan?.speed_down_unit ?? "Mbps",
        dataUsedBytes: queueStats?.totalBytes ?? Number(customer.data_used_bytes ?? 0),
        queueRate: queueStats?.rate ?? "",
        queueMaxLimit: queueStats?.maxLimit ?? "",
      });
    }

    res.json({
      devices: output.sort((a, b) => String(a.routerName).localeCompare(String(b.routerName)) || String(a.name || a.macAddress).localeCompare(String(b.name || b.macAddress))),
      routers: routers.map(row => ({ id: Number(row.id), name: row.name })),
      routerErrors,
    });
  } catch (error) {
    logger.error({ err: error }, "[customers/hotspot-connected-devices] failed");
    res.status(500).json({ error: "Could not load Hotspot devices." });
  }
});

router.post("/customers/hotspot-bind-device", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  if (!adminId) {
    res.status(400).json({ error: "ISP account is required." });
    return;
  }
  const customerId = Number(req.body?.customerId);
  const routerId = Number(req.body?.routerId);
  const macAddress = normalizeHotspotMac(req.body?.macAddress);
  const requestedIp = String(req.body?.ipAddress ?? "").trim();
  if (!Number.isSafeInteger(customerId) || customerId < 1 || !Number.isSafeInteger(routerId) || routerId < 1 || !macAddress) {
    res.status(400).json({ error: "Choose a prepaid Hotspot account and a valid connected device." });
    return;
  }

  let bindingApplied = false;
  let queuePrepared = false;
  let accountAlreadyHadMac = false;
  let bindingComment = "";
  let creds: ReturnType<typeof routerCredentials> | null = null;
  try {
    const customers = await sbSelectStrict<ConnectedDeviceCustomerRow>(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${adminId}&select=id,admin_id,name,phone,mac_address,username,pppoe_username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason,data_used_bytes,service_online,last_seen&limit=1`,
    );
    const customer = customers[0];
    if (!customer || customer.type !== "hotspot" || !customer.plan_id || !customer.username?.trim()) {
      res.status(404).json({ error: "Active prepaid Hotspot account not found." });
      return;
    }
    if (customer.status !== "active" || (customer.expires_at && Date.parse(customer.expires_at) <= Date.now())) {
      res.status(409).json({ error: "This account is expired or suspended and cannot be bound." });
      return;
    }
    if (!customer.expires_at || !Number.isFinite(Date.parse(customer.expires_at))) {
      res.status(409).json({ error: "This account has no valid expiry time, so the router cannot safely schedule its device access." });
      return;
    }
    if (customer.mac_address && normalizeHotspotMac(customer.mac_address) !== macAddress) {
      res.status(409).json({ error: "This account is already bound to another device. Unbind it before moving the account." });
      return;
    }
    accountAlreadyHadMac = normalizeHotspotMac(customer.mac_address) === macAddress;

    const plans = await sbSelectStrict<PlanRow>(
      "isp_plans",
      `id=eq.${customer.plan_id}&admin_id=eq.${adminId}&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,is_active&limit=1`,
    );
    const plan = plans[0];
    if (!plan || normalizePlanServiceType(plan.type ?? "") !== "hotspot" || plan.is_active === false) {
      res.status(409).json({ error: "The account's Hotspot plan is no longer available." });
      return;
    }
    if (customer.port_id || plan.port_id) {
      res.status(409).json({ error: "Direct device binding is available for router-level Hotspot accounts, not port-assigned services." });
      return;
    }
    if ((customer.router_id && Number(customer.router_id) !== routerId) || (plan.router_id && Number(plan.router_id) !== routerId)) {
      res.status(409).json({ error: "The account and plan must belong to the selected router." });
      return;
    }
    const sameMacRows = await sbSelectStrict<ConnectedDeviceCustomerRow>(
      "isp_customers",
      `admin_id=eq.${adminId}&type=eq.hotspot&select=id,admin_id,name,phone,mac_address,username,pppoe_username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason,data_used_bytes,service_online,last_seen&limit=10000`,
    );
    const conflictingAccount = sameMacRows.find((row) =>
      Number(row.id) !== customerId
      && normalizeHotspotMac(row.mac_address) === macAddress
      && Number(row.router_id ?? plan.router_id ?? 0) === routerId
      && row.status === "active",
    );
    if (conflictingAccount) {
      res.status(409).json({ error: "This device is already linked to another active Hotspot account." });
      return;
    }

    const routers = await sbSelectStrict<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    const routerRow = routers[0];
    if (!routerRow) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    creds = routerCredentials(routerRow);
    const connectedDevices = await fetchHotspotConnectedDevices(creds, macAddress);
    const liveDevice = connectedDevices.find((device) =>
      normalizeHotspotMac(device.macAddress) === macAddress
      && (device.source === "hotspot" || device.source === "host"),
    );
    if (!liveDevice) {
      res.status(409).json({ error: "The device is no longer visible on this router. Refresh the connected-device list and try again." });
      return;
    }
    const ipAddress = liveDevice.address || await resolveHotspotClientIpByMac(creds, macAddress);
    if (!isValidIpv4(ipAddress)) {
      res.status(409).json({ error: "The router has not reported a usable IP address for this device yet." });
      return;
    }
    if (requestedIp && isValidIpv4(requestedIp) && requestedIp !== ipAddress) {
      res.status(409).json({ error: "The device IP changed. Refresh the list and try again." });
      return;
    }
    bindingComment = customer.username.trim();
    const rateLimit = routerRateLimit(
      plan.speed_down,
      plan.speed_up,
      plan.speed_down_unit ?? "Mbps",
      plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
    );
    const expiresInSeconds = Math.max(1, Math.ceil((Date.parse(customer.expires_at) - Date.now()) / 1000));

    bindingApplied = await addHotspotIpBinding(creds, {
      macAddress,
      ipAddress,
      comment: bindingComment,
      expiresInSeconds,
      bindingType: "bypassed",
    });
    if (!bindingApplied) {
      res.status(409).json({ error: "The router already has an administrator-managed binding for this device; it was left unchanged." });
      return;
    }
    try {
      await ensureHotspotUserRateQueue(creds, {
        username: bindingComment,
        address: ipAddress,
        maxLimit: rateLimit,
      });
      queuePrepared = true;
      await sbUpdateStrict(
        "isp_customers",
        `id=eq.${customerId}&admin_id=eq.${adminId}`,
        {
          mac_address: macAddress,
          ip_address: ipAddress,
          service_online: true,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      );
    } catch (error) {
      if (!accountAlreadyHadMac) {
        await removeHotspotIpBinding(creds, { macAddress, comment: bindingComment }).catch(() => {});
        if (queuePrepared) await removeHotspotUserRateQueue(creds, bindingComment).catch(() => {});
      }
      throw error;
    }
    res.json({
      ok: true,
      connected: true,
      customerId,
      username: bindingComment,
      routerId,
      macAddress,
      ipAddress,
      speed: rateLimit ?? "Plan default",
      expiresAt: customer.expires_at,
    });
  } catch (error) {
    logger.error({ err: error, adminId, customerId, routerId }, "[customers/hotspot-bind-device] failed");
    if (bindingApplied && creds && !accountAlreadyHadMac && bindingComment) {
      await removeHotspotIpBinding(creds, { macAddress, comment: bindingComment }).catch(() => {});
      if (queuePrepared) await removeHotspotUserRateQueue(creds, bindingComment).catch(() => {});
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not bind this device." });
  }
});

router.post("/customers/hotspot-voucher-activate", async (req, res): Promise<void> => {
  const portal = req.hotspotPortalContext;
  const adminId = Number(portal?.adminId ?? req.body?.adminId);
  const routerId = Number(portal?.routerId ?? req.body?.routerId);
  if (!Number.isSafeInteger(adminId) || adminId < 1 || !Number.isSafeInteger(routerId) || routerId < 1) {
    res.status(400).json({ error: "The ISP and router are required to activate this voucher." });
    return;
  }
  if (portal?.portId) {
    res.status(403).json({ error: "Voucher activation is not enabled for port-assigned services." });
    return;
  }
  const requestedRouterId = Number(req.body?.routerId ?? 0);
  if (requestedRouterId && requestedRouterId !== routerId) {
    res.status(403).json({ error: "The voucher portal router does not match this device." });
    return;
  }

  const code = normalizeRedeemableHotspotVoucherCode(req.body?.code);
  const phone = normalizeKenyanVoucherPhone(req.body?.phone);
  const macAddress = normalizeHotspotMac(req.body?.macAddress);
  const ipAddress = String(req.body?.ipAddress ?? "").trim();
  if (!code) {
    res.status(400).json({ error: "Enter a valid voucher code with no spaces." });
    return;
  }
  if (!phone) {
    res.status(400).json({ error: "Enter a valid Kenyan mobile number." });
    return;
  }
  if (!macAddress || !isValidIpv4(ipAddress)) {
    res.status(400).json({ error: "The router did not provide this device's MAC address and IP. Reopen the Hotspot page and try again." });
    return;
  }

  let accountCreated = false;
  let claimedCustomer: CustomerRow | null = null;
  let planName = "";
  let duration = "";
  let username = phone;
  let accountOwnerId = adminId;
  try {
    const vouchers = await sbSelectStrict<{
      id: number;
      admin_id: number;
      code: string;
      plan_id: number | null;
      plan_name: string;
      router_id: number | null;
      validity_mins: number;
      expires_at: string | null;
      redeemed_at: string | null;
      redeemed_by_phone: string | null;
      prepaid_customer_id: number | null;
    }>(
      "isp_radius_vouchers",
      `admin_id=eq.${adminId}&code=ilike.${encodeURIComponent(code)}&select=id,admin_id,code,plan_id,plan_name,router_id,validity_mins,expires_at,redeemed_at,redeemed_by_phone,prepaid_customer_id&limit=1`,
    );
    const voucher = vouchers[0];
    if (!voucher) {
      res.status(404).json({ error: "Voucher code not found for this ISP." });
      return;
    }
    if (voucher.router_id && Number(voucher.router_id) !== routerId) {
      res.status(409).json({ error: "This voucher is assigned to a different router." });
      return;
    }
    if (!voucher.plan_id || Number(voucher.validity_mins) <= 0) {
      res.status(409).json({ error: "This voucher is missing its plan or validity. Contact the ISP." });
      return;
    }

    const plans = await sbSelectStrict<PlanRow>(
      "isp_plans",
      `id=eq.${voucher.plan_id}&admin_id=eq.${adminId}&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,is_active&limit=1`,
    );
    const plan = plans[0];
    if (
      !plan
      || normalizePlanServiceType(plan.type ?? "") !== "hotspot"
      || plan.port_id
      || (plan.router_id && Number(plan.router_id) !== routerId)
      || (!voucher.redeemed_at && plan.is_active === false)
    ) {
      res.status(409).json({ error: "This voucher's Hotspot plan is unavailable on this router." });
      return;
    }
    planName = plan.name;
    duration = formatVoucherDuration(Number(voucher.validity_mins));

    const routerRows = await sbSelectStrict<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    const routerRow = routerRows[0];
    if (!routerRow) {
      res.status(404).json({ error: "The Hotspot router was not found." });
      return;
    }
    const creds = routerCredentials(routerRow);
    const liveDevices = await fetchHotspotConnectedDevices(creds, macAddress);
    const liveDevice = liveDevices.find((device) =>
      normalizeHotspotMac(device.macAddress) === macAddress
      && (device.source === "hotspot" || device.source === "host")
      && device.address === ipAddress,
    );
    if (!liveDevice) {
      res.status(409).json({ error: "This device is not currently visible on the router. Reopen the Hotspot page and try again." });
      return;
    }

    const generatedPassword = randomBytes(24).toString("base64url");
    const claimResult = await sbRpc<Record<string, unknown> | Array<Record<string, unknown>>>(
      "claim_hotspot_voucher_account",
      {
        p_admin_id: adminId,
        p_code: code,
        p_phone: phone,
        p_password: generatedPassword,
        p_router_id: routerId,
        p_mac_address: macAddress,
        p_ip_address: ipAddress,
      },
    );
    const claim = (Array.isArray(claimResult) ? claimResult[0] : claimResult) as Record<string, unknown> | undefined;
    const customerId = Number(claim?.customer_id);
    if (!Number.isSafeInteger(customerId) || customerId < 1) {
      throw new Error("Voucher account creation did not return a customer record.");
    }
    const returnedAccountOwnerId = Number(claim?.account_admin_id);
    if (Number.isSafeInteger(returnedAccountOwnerId) && returnedAccountOwnerId > 0) {
      accountOwnerId = returnedAccountOwnerId;
    }
    accountCreated = true;
    const claimedRows = await sbSelectStrict<CustomerRow>(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${accountOwnerId}&select=id,admin_id,name,phone,mac_address,username,pppoe_username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason&limit=1`,
    );
    claimedCustomer = claimedRows[0] ?? null;
    if (!claimedCustomer?.username || !claimedCustomer.password) {
      throw new Error("The voucher account was created but its login record is incomplete.");
    }
    if (!claimedCustomer.expires_at || !Number.isFinite(Date.parse(claimedCustomer.expires_at))) {
      throw new Error("The voucher account does not have a valid expiry time.");
    }
    username = claimedCustomer.username;

    // Remove the voucher credential after the atomic claim. A retry with the
    // same phone returns the existing account and safely repeats this cleanup.
    await Promise.all([
      sbDeleteStrict("radcheck", `username=eq.${encodeURIComponent(code)}`),
      sbDeleteStrict("radusergroup", `username=eq.${encodeURIComponent(code)}`),
    ]);

    const possibleRouters = voucher.router_id || plan.router_id
      ? await sbSelectStrict<RouterRow>(
          "isp_routers",
          `id=eq.${Number(voucher.router_id ?? plan.router_id)}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
        )
      : await sbSelectStrict<RouterRow>(
          "isp_routers",
          `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret`,
        );
    const warnings: string[] = [];
    const localVoucherCleanup = await Promise.allSettled(possibleRouters.map(async (candidateRouter) => {
      const candidateCreds = routerCredentials(candidateRouter);
      const localUsers = await fetchHotspotUserList(candidateCreds);
      const syncedVoucher = localUsers.find((user) =>
        user.name === code && String(user.comment ?? "").includes(" voucher · "),
      );
      if (syncedVoucher) await removeHotspotUser(candidateCreds, code);
    }));
    if (localVoucherCleanup.some(result => result.status === "rejected")) {
      warnings.push("Some offline routers may still have an old copy of this voucher; the voucher is already blocked in the account system.");
    }

    const profile = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
    const normalRateLimit = routerRateLimit(
      plan.speed_down,
      plan.speed_up,
      plan.speed_down_unit ?? "Mbps",
      plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
    );
    const dataLimitMb = Number(plan.data_limit_mb ?? 0);
    const capBytes = dataLimitMb > 0 ? dataLimitMegabytesToBytes(dataLimitMb) : null;
    const dataCapMode = plan.data_cap_mode === "throttle" ? "throttle" : "disconnect";
    const fupRateLimit = dataCapMode === "throttle" && capBytes !== null
      ? routerRateLimit(plan.fup_speed_down, plan.fup_speed_up, "Mbps", "Mbps")
      : undefined;
    if (dataCapMode === "throttle" && capBytes !== null && !fupRateLimit) {
      throw new Error("The plan's reduced-speed settings are incomplete.");
    }
    await ensureHotspotUserProfile(creds, {
      name: profile,
      sharedUsers: plan.shared_users ?? 1,
      rateLimit: fupRateLimit ?? normalRateLimit,
    });
    await reconcileHotspotUserAccess(creds, {
      name: claimedCustomer.username,
      password: claimedCustomer.password,
      profile,
      comment: `OSN-VOUCHER:${voucher.id}`,
      expiresAt: claimedCustomer.expires_at,
      enabled: claimedCustomer.status === "active",
      limitBytesTotal: dataCapMode === "throttle" ? "0" : capBytes === null ? "0" : String(capBytes),
      address: ipAddress,
      macAddress,
      rateLimit: fupRateLimit ?? normalRateLimit,
      dataCapMode,
      ...(dataCapMode === "throttle" && capBytes !== null && fupRateLimit ? {
        fupLimitBytes: capBytes,
        fupSpeedDownMbps: Number(plan.fup_speed_down),
        fupSpeedUpMbps: Number(plan.fup_speed_up),
      } : {}),
      sharedUsers: plan.shared_users ?? 1,
      resetCounters: false,
    });
    const expiresInSeconds = Math.max(1, Math.ceil((Date.parse(claimedCustomer.expires_at) - Date.now()) / 1000));
    const bindingCreated = await addHotspotIpBinding(creds, {
      macAddress,
      ipAddress,
      comment: claimedCustomer.username,
      expiresInSeconds,
      bindingType: "bypassed",
    });
    if (!bindingCreated) {
      throw new Error("The router has an administrator-managed binding for this device; it was not changed.");
    }
    await ensureHotspotUserRateQueue(creds, {
      username: claimedCustomer.username,
      address: ipAddress,
      maxLimit: fupRateLimit ?? normalRateLimit,
    });
    await sbUpdateStrict(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${accountOwnerId}`,
      {
        mac_address: macAddress,
        ip_address: ipAddress,
        service_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
    res.json({
      ok: true,
      accountCreated: true,
      connected: true,
      username,
      voucher: {
        plan_name: planName,
        duration,
        username,
        connected: true,
      },
      warning: warnings.join(" ") || undefined,
    });
  } catch (error) {
    logger.error({ err: error, adminId, routerId, accountCreated }, "[customers/hotspot-voucher-activate] failed");
    if (accountCreated) {
      res.status(503).json({
        error: "Your account has been created, but the router has not confirmed the connection. Keep this voucher and phone number, then retry.",
        accountCreated: true,
        connected: false,
        username,
        voucher: {
          plan_name: planName,
          duration,
          username,
          connected: false,
        },
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Voucher activation failed.";
    const expiryMarker = message.match(/HOTSPOT_VOUCHER_EXPIRED_AT:([^\s]+)/i)?.[1];
    const limitMarker = message.match(/HOTSPOT_VOUCHER_REDEMPTION_LIMIT:(\d+):(\d+)/i);
    if (expiryMarker) {
      res.status(410).json({ error: `This voucher expired at ${formatVoucherExpiryInEastAfrica(expiryMarker)}.` });
    } else if (limitMarker) {
      res.status(409).json({ error: `This voucher has reached its redemption limit (${limitMarker[1]} of ${limitMarker[2]} uses).` });
    } else if (message.toLowerCase().includes("already_linked_to_device")) {
      res.status(409).json({ error: "This voucher was already redeemed by this device." });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.post("/customers/hotspot-login", async (req, res): Promise<void> => {
  const adminId = Number(req.body?.adminId);
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const requestedMac = normalisePortalMac(req.body?.mac_address);
  if (!Number.isSafeInteger(adminId) || adminId < 1 || !username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const portalScope = req.hotspotPortalContext;
  let customer: Record<string, unknown> | undefined;
  if (portalScope) {
    const usernameFilter = `username=eq.${encodeURIComponent(username)}&select=*&limit=2`;
    const [vlanRows, resellerRows, ispVoucherRows] = await Promise.all([
      sbSelectStrict<Record<string, unknown>>(
        "isp_customers",
        `admin_id=eq.${portalScope.adminId}&type=eq.vlan&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&${usernameFilter}`,
      ),
      sbSelectStrict<Record<string, unknown>>(
        "isp_customers",
        `admin_id=eq.${portalScope.resellerId}&type=in.(hotspot,voucher)&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&${usernameFilter}`,
      ),
      sbSelectStrict<Record<string, unknown>>(
        "isp_customers",
        `admin_id=eq.${portalScope.adminId}&type=eq.voucher&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&${usernameFilter}`,
      ),
    ]);
    const scopedCustomers = [...vlanRows, ...resellerRows, ...ispVoucherRows];
    if (scopedCustomers.length > 1) {
      res.status(409).json({ error: "This username is ambiguous on the assigned Hotspot service. Contact support." });
      return;
    }
    customer = scopedCustomers[0];
  } else {
    const rows = await sbSelect<Record<string, unknown>>(
      "isp_customers",
      `admin_id=eq.${adminId}&type=in.(hotspot,voucher)&username=eq.${encodeURIComponent(username)}&select=*&limit=2`,
    );
    customer = rows[0];
  }
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
  if (customer.depletion_reason === "data_limit") {
    res.status(403).json({ error: "The package data allowance has been used. Purchase a new package to reconnect." });
    return;
  }
  const customerEntitlementNow = Date.now();
  if (isPrepaidCustomerExpired(
    customer.status,
    customer.expires_at,
    customer.depletion_reason,
    customerEntitlementNow,
  )) {
    res.status(403).json({ error: "Account has expired. Please renew your plan." });
    return;
  }
  if (!isPrepaidCustomerEntitled(
    customer.status,
    customer.expires_at,
    customer.depletion_reason,
    customerEntitlementNow,
  )) {
    res.status(403).json({ error: "Account is not active. Contact support." });
    return;
  }

  const customerRow = customer as Partial<CustomerRow>;
  const planAdminId = portalScope?.adminId ?? adminId;
  const plan = customerRow.plan_id
    ? (await sbSelectStrict<PlanRow>(
        "isp_plans",
        `id=eq.${customerRow.plan_id}&admin_id=eq.${planAdminId}&select=id,router_id,port_id,owner_reseller_id,type,plan_type&limit=1`,
      ))[0]
    : undefined;
  if (
    portalScope
    && (
      customerRow.router_id !== portalScope.routerId
      || customerRow.port_id !== portalScope.portId
      || (customerRow.admin_id !== portalScope.adminId && customerRow.admin_id !== portalScope.resellerId)
      || !plan
      || plan.router_id !== portalScope.routerId
      || (
        plan.port_id !== portalScope.portId
        && !(customerRow.type === "voucher" && plan.port_id == null && customerRow.port_id === portalScope.portId)
      )
      || (plan.owner_reseller_id != null && plan.owner_reseller_id !== portalScope.resellerId)
      || (customerRow.admin_id === portalScope.resellerId && plan.owner_reseller_id !== portalScope.resellerId)
    )
  ) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const routerId = portalScope?.routerId ?? customerRow.router_id ?? plan?.router_id ?? null;
  if (!routerId) {
    res.status(409).json({ error: "Your active plan is not linked to a hotspot router yet." });
    return;
  }

  const routerRow = (await sbSelect<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${planAdminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
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

  let hotspotServer: string | undefined;
  if (portalScope) {
    const servicePorts = await sbSelectStrict<VlanPortRow>(
      "isp_reseller_ports",
      `id=eq.${portalScope.portId}&admin_id=eq.${portalScope.adminId}&router_id=eq.${portalScope.routerId}&assigned_reseller_id=eq.${portalScope.resellerId}&handoff_mode=eq.vlan_services&status=eq.active&hotspot_enabled=is.true&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled,link_status&limit=1`,
    );
    const servicePort = servicePorts[0];
    if (!servicePort) {
      res.status(409).json({ error: "The assigned Hotspot service is not active." });
      return;
    }
    hotspotServer = portServiceResourceNames(servicePort).hotspotServer;
    if (
      customerRow.type === "vlan"
      && (!isValidIpv4(customerRow.ip_address) || !ipv4InSubnet(customerRow.ip_address, servicePort.subnet_range))
    ) {
      res.status(409).json({ error: "This VLAN account does not have a valid IP on the assigned service." });
      return;
    }
  }

  const customerMac = normalisePortalMac(customerRow.mac_address);
  if (customerMac && requestedMac && customerMac !== requestedMac) {
    res.status(409).json({ error: "These hotspot credentials are linked to a different device." });
    return;
  }
  const targetMac = customerMac || requestedMac;
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

  const connected = activeUsers.some(user =>
    user.user === username && !!targetMac && normalisePortalMac(user.macAddress) === targetMac,
  );
  if (!connected) {
    const discoveredIp = targetMac ? await resolveHotspotClientIpByMac(creds, targetMac).catch(() => null) : null;
    if (!discoveredIp || !targetMac) {
      res.status(409).json({
        error: "Credentials are valid, but the router cannot find this device on the hotspot Wi-Fi yet. Connect the device to Wi-Fi and try again.",
      });
      return;
    }
    if (portalScope && customerRow.type === "vlan" && discoveredIp !== customerRow.ip_address) {
      res.status(409).json({ error: "This device is not using the static IP assigned to its VLAN account." });
      return;
    }
    try {
      const loginAccepted = await connectHotspotUser(creds, {
        user: username,
        password,
        ip: customerRow.type === "vlan" ? String(customerRow.ip_address) : discoveredIp,
        macAddress: targetMac,
        ...(hotspotServer ? { server: hotspotServer } : {}),
      });
      if (!loginAccepted) {
        res.status(503).json({
          error: "The router has not confirmed this device's login yet. Please try again.",
        });
        return;
      }
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

function positivePortalId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPortalId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "" || value === "null") return null;
  return positivePortalId(value) ?? undefined;
}

async function resolveHotspotTargetScope(
  adminId: number,
  portalScope: VlanHotspotPortalContext | undefined,
  requestedRouterId: unknown,
  requestedPortId: unknown,
): Promise<{ scope?: HotspotRoamingServiceScope; error?: string }> {
  const hasRequestedScope = requestedRouterId !== undefined || requestedPortId !== undefined;
  if (!portalScope && !hasRequestedScope) return {};
  const routerId = portalScope?.routerId ?? positivePortalId(requestedRouterId);
  const portId = portalScope?.portId ?? optionalPortalId(requestedPortId);
  if (!routerId || portId === undefined) return { error: "The hotspot service location is invalid." };
  const routers = await sbSelectStrict<{ id: number }>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id&limit=1`,
  );
  if (!routers[0]) return { error: "This Hotspot service is not part of the ISP account." };
  if (portId !== null) {
    const portFilter = portalScope
      ? `&assigned_reseller_id=eq.${portalScope.resellerId}&handoff_mode=eq.vlan_services`
      : "&assigned_reseller_id=is.null";
    const ports = await sbSelectStrict<{ id: number }>(
      "isp_reseller_ports",
      `id=eq.${portId}&admin_id=eq.${adminId}&router_id=eq.${routerId}&status=eq.active&hotspot_enabled=is.true${portFilter}&select=id&limit=1`,
    );
    if (!ports[0]) return { error: "This Hotspot port is not active." };
  }
  return { scope: { routerId, portId } };
}

async function loadRoamingRulesForTarget(
  adminId: number,
  target: HotspotRoamingServiceScope,
): Promise<RoamingRuleRow[]> {
  return sbSelectStrict<RoamingRuleRow>(
    "isp_hotspot_roaming_rules",
    `admin_id=eq.${adminId}&target_router_id=eq.${target.routerId}&enabled=is.true&select=admin_id,source_router_id,source_port_id,target_router_id,target_port_id,enabled&limit=1000`,
  );
}

async function loadSharedRoamingUsage(
  adminId: number,
  plan: PlanRow,
  username: string,
  targetRouterId: number,
  options: {
    credentialsForRouter?: (row: RouterRow) => ReturnType<typeof routerCredentials>;
    fetchUsage?: typeof fetchHotspotUserUsage;
    readTrafficUsage?: boolean;
  } = {},
): Promise<{ totalBytes: number; targetRouterBytes: number; routerIds: number[]; routers: RouterRow[] }> {
  if (!plan.router_id) throw new Error("The purchased package has no source MikroTik.");
  const historicalRules = await sbSelectStrict<RoamingRuleRow>(
    "isp_hotspot_roaming_rules",
    `admin_id=eq.${adminId}&source_router_id=eq.${plan.router_id}&select=admin_id,source_router_id,source_port_id,target_router_id,target_port_id,enabled&limit=1000`,
  );
  const applicableRules = historicalRules.filter(rule =>
    rule.source_port_id === null
    || Number(rule.source_port_id) === Number(plan.port_id),
  );
  // Disabled permissions remain in history so earlier usage is still charged
  // to the same purchase after an administrator revokes future roaming.
  const routerIds = authorizedRoamingRouterIds(
    { ...plan, type: normalizePlanServiceType(plan.type) },
    applicableRules.map(rule => ({ ...rule, enabled: true })),
  );
  const routers = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `admin_id=eq.${adminId}&id=in.(${routerIds.join(",")})&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=100`,
  );
  if (routers.length !== routerIds.length) {
    throw new Error("A MikroTik needed to verify shared package usage could not be found.");
  }
  if (options.readTrafficUsage === false) {
    return { totalBytes: 0, targetRouterBytes: 0, routerIds, routers };
  }
  const usageRows = await Promise.all(routers.map(async row => ({
    routerId: row.id,
    usage: await (options.fetchUsage ?? fetchHotspotUserUsage)(
      (options.credentialsForRouter ?? routerCredentials)(row),
      username,
    ),
  })));
  const sourceUsage = usageRows.find(row => row.routerId === plan.router_id);
  if (!sourceUsage?.usage) {
    throw new Error("The source MikroTik no longer has this package account to verify its usage.");
  }
  const totalBytes = usageRows.reduce(
    (total, row) => total + (row.usage?.bytesIn ?? 0) + (row.usage?.bytesOut ?? 0),
    0,
  );
  const targetRouterBytes = usageRows.find(row => row.routerId === targetRouterId);
  return {
    totalBytes,
    targetRouterBytes: (targetRouterBytes?.usage?.bytesIn ?? 0) + (targetRouterBytes?.usage?.bytesOut ?? 0),
    routerIds,
    routers,
  };
}

type HotspotPurchaseTransaction = {
  id: number;
  customer_id: number | null;
  plan_id: number | null;
  mac_address: string | null;
  status: string;
  created_at: string | null;
};

type HotspotTroubleshootCustomer = Pick<
  CustomerRow,
  "id" | "admin_id" | "name" | "mac_address" | "username" | "password" | "type"
    | "plan_id" | "router_id" | "port_id" | "ip_address" | "status" | "expires_at"
    | "fup_limit_mb" | "depletion_reason"
>;

type HotspotTroubleshootStatus = "active" | "depleted" | "expired" | "not_found" | "unavailable";

type HotspotPurchaseLookup = {
  found: boolean;
  status: HotspotTroubleshootStatus;
  expiresAt: string | null;
  planName: string | null;
  username: string | null;
  error?: string;
  customer?: HotspotTroubleshootCustomer;
  plan?: PlanRow;
};

async function lookupLatestHotspotPurchase(
  adminId: number,
  requestedMac: string,
  portalScope?: VlanHotspotPortalContext,
  targetScope?: HotspotRoamingServiceScope,
): Promise<HotspotPurchaseLookup> {
  const macCandidates = Array.from(new Set([requestedMac, requestedMac.replace(/:/g, "")]));
  const [directTransactions, macBoundCustomers] = await Promise.all([
    Promise.all(macCandidates.map(mac => sbSelectStrict<HotspotPurchaseTransaction>(
      "isp_transactions",
      `admin_id=eq.${adminId}&mac_address=eq.${encodeURIComponent(mac)}&status=in.(completed,paid,success)&select=id,customer_id,plan_id,mac_address,status,created_at&order=created_at.desc.nullslast,id.desc&limit=25`,
    ))).then(rows => rows.flat()),
    targetScope
      ? Promise.all(macCandidates.flatMap(mac => [
          sbSelectStrict<{ id: number }>(
            "isp_customers",
            `admin_id=eq.${adminId}&type=eq.hotspot&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
          ),
          ...(portalScope ? [
            sbSelectStrict<{ id: number }>(
              "isp_customers",
              `admin_id=eq.${portalScope.adminId}&type=eq.vlan&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
            ),
            sbSelectStrict<{ id: number }>(
              "isp_customers",
              `admin_id=eq.${portalScope.resellerId}&type=eq.hotspot&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
            ),
          ] : []),
        ])).then(rows => rows.flat())
      : portalScope
      ? Promise.all(macCandidates.flatMap(mac => [
          sbSelectStrict<{ id: number }>(
            "isp_customers",
            `admin_id=eq.${portalScope.adminId}&type=eq.vlan&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
          ),
          sbSelectStrict<{ id: number }>(
            "isp_customers",
            `admin_id=eq.${portalScope.resellerId}&type=eq.hotspot&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
          ),
        ])).then(rows => rows.flat())
      : Promise.all(macCandidates.map(mac => sbSelectStrict<{ id: number }>(
          "isp_customers",
          `admin_id=eq.${adminId}&type=eq.hotspot&mac_address=eq.${encodeURIComponent(mac)}&select=id&limit=100`,
        ))).then(rows => rows.flat()),
  ]);

  const customerIds = Array.from(new Set(macBoundCustomers.map(customer => customer.id).filter(id => Number.isSafeInteger(id) && id > 0)));
  const linkedTransactions = customerIds.length
    ? await sbSelectStrict<HotspotPurchaseTransaction>(
        "isp_transactions",
        `admin_id=eq.${adminId}&customer_id=in.(${customerIds.join(",")})&status=in.(completed,paid,success)&select=id,customer_id,plan_id,mac_address,status,created_at&order=created_at.desc.nullslast,id.desc&limit=100`,
      )
    : [];

  let scopedPlanIds: Set<number> | undefined;
  let targetRules: RoamingRuleRow[] = [];
  if (targetScope) {
    const candidatePlanIds = Array.from(new Set(
      [...directTransactions, ...linkedTransactions]
        .map(transaction => Number(transaction.plan_id))
        .filter(id => Number.isSafeInteger(id) && id > 0),
    ));
    const [candidatePlans, rules] = await Promise.all([
      candidatePlanIds.length
        ? sbSelectStrict<PlanRow>(
            "isp_plans",
            `id=in.(${candidatePlanIds.join(",")})&admin_id=eq.${adminId}&select=id,type,router_id,port_id,owner_reseller_id&limit=100`,
          )
        : Promise.resolve([] as PlanRow[]),
      loadRoamingRulesForTarget(adminId, targetScope),
    ]);
    targetRules = rules;
    scopedPlanIds = new Set(candidatePlans
      .filter(plan =>
        (
          canPlanRoamToService(
            { ...plan, type: normalizePlanServiceType(plan.type) },
            targetScope,
            targetRules,
          )
          || (
            portalScope
            && normalizePlanServiceType(plan.type) === "vlan"
            && plan.router_id === targetScope.routerId
            && plan.port_id === targetScope.portId
          )
        )
        && (!portalScope || plan.owner_reseller_id == null || plan.owner_reseller_id === portalScope.resellerId),
      )
      .map(plan => plan.id));
  } else if (portalScope) {
    const candidatePlanIds = Array.from(new Set(
      [...directTransactions, ...linkedTransactions]
        .map(transaction => Number(transaction.plan_id))
        .filter(id => Number.isSafeInteger(id) && id > 0),
    ));
    const scopedPlans = candidatePlanIds.length
      ? await sbSelectStrict<PlanRow>(
          "isp_plans",
          `id=in.(${candidatePlanIds.join(",")})&admin_id=eq.${portalScope.adminId}&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&select=id,owner_reseller_id,type,plan_type&limit=100`,
        )
      : [];
    scopedPlanIds = new Set(scopedPlans
      .filter(plan => plan.owner_reseller_id == null || plan.owner_reseller_id === portalScope.resellerId)
      .map(plan => plan.id));
  }

  const seenTransactions = new Map<number, HotspotPurchaseTransaction>();
  for (const transaction of [...directTransactions, ...linkedTransactions]) {
    const rawMac = String(transaction.mac_address ?? "").trim();
    const transactionMac = normalisePortalMac(rawMac);
    if ((rawMac && transactionMac !== requestedMac) || (!rawMac && !customerIds.includes(Number(transaction.customer_id)))) continue;
    if (
      (targetScope || portalScope)
      && (!transaction.plan_id || !scopedPlanIds?.has(transaction.plan_id))
    ) continue;
    seenTransactions.set(transaction.id, transaction);
  }
  const latestTransaction = Array.from(seenTransactions.values()).sort((left, right) => {
    const leftTime = Date.parse(String(left.created_at ?? ""));
    const rightTime = Date.parse(String(right.created_at ?? ""));
    const timeDifference = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    return timeDifference || right.id - left.id;
  })[0];

  if (!latestTransaction) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }

  const plan = latestTransaction.plan_id
    ? (await sbSelectStrict<PlanRow>(
        "isp_plans",
        `id=eq.${latestTransaction.plan_id}&admin_id=eq.${adminId}&select=id,name,type,router_id,port_id,owner_reseller_id,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,speed_down,speed_up,speed_down_unit,speed_up_unit,shared_users&limit=1`,
      ))[0]
    : undefined;
  const planServiceType = plan ? normalizePlanServiceType(plan.type) : "";
  if (
    plan
    && planServiceType !== "hotspot"
    && !(portalScope && planServiceType === "vlan")
  ) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }
  if (!plan) {
    return {
      found: true,
      status: "unavailable",
      expiresAt: null,
      planName: null,
      username: null,
      error: "The confirmed purchase was found, but its package details are unavailable. Contact support.",
    };
  }
  if (
    targetScope
    && !canPlanRoamToService(plan, targetScope, targetRules)
    && !(planServiceType === "vlan"
      && portalScope
      && plan.router_id === targetScope.routerId
      && plan.port_id === targetScope.portId)
  ) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }
  if (
    portalScope
    && (
      (plan.owner_reseller_id != null && plan.owner_reseller_id !== portalScope.resellerId)
      || (planServiceType === "hotspot" && plan.owner_reseller_id !== portalScope.resellerId)
    )
  ) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }
  if (!latestTransaction.customer_id) {
    return {
      found: true,
      status: "unavailable",
      expiresAt: null,
      planName: plan.name,
      username: null,
      error: "The confirmed purchase has not been assigned a hotspot login yet. Contact support.",
      plan,
    };
  }

  const customerType = planServiceType === "vlan" ? "vlan" : "hotspot";
  const customerAdminId = customerType === "vlan"
    ? adminId
    : (portalScope?.resellerId ?? plan.owner_reseller_id ?? adminId);
  const customer = (await sbSelectStrict<HotspotTroubleshootCustomer>(
    "isp_customers",
    `id=eq.${latestTransaction.customer_id}&admin_id=eq.${customerAdminId}&type=eq.${customerType}&select=id,admin_id,name,mac_address,username,password,type,plan_id,router_id,port_id,ip_address,status,expires_at,fup_limit_mb,depletion_reason&limit=1`,
  ))[0];
  if (!customer) {
    return {
      found: true,
      status: "unavailable",
      expiresAt: null,
      planName: plan.name,
      username: null,
      error: "The confirmed purchase has no saved hotspot account. Contact support.",
      plan,
    };
  }
  if (
    customer.plan_id !== plan.id
    || customer.router_id !== plan.router_id
    || customer.port_id !== plan.port_id
    || (portalScope && customerType === "vlan" && customer.admin_id !== portalScope.adminId)
    || (portalScope && customerType === "hotspot" && customer.admin_id !== portalScope.resellerId)
  ) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }

  const customerMacRaw = String(customer.mac_address ?? "").trim();
  const customerMac = normalisePortalMac(customerMacRaw);
  const transactionMacRaw = String(latestTransaction.mac_address ?? "").trim();
  const transactionMac = normalisePortalMac(transactionMacRaw);
  if (
    (customerMacRaw && customerMac !== requestedMac)
    || (!transactionMacRaw && customerMac !== requestedMac)
    || (transactionMacRaw && transactionMac !== requestedMac)
  ) {
    return {
      found: false,
      status: "not_found",
      expiresAt: null,
      planName: null,
      username: null,
      error: "No successfully purchased hotspot package was found for this device.",
    };
  }
  if (customer.plan_id !== latestTransaction.plan_id) {
    return {
      found: true,
      status: "unavailable",
      expiresAt: customer.expires_at,
      planName: plan.name,
      username: customer.username,
      error: "The saved hotspot account does not match the latest confirmed purchase. Contact support.",
      customer,
      plan,
    };
  }

  const expiresAt = customer.expires_at;
  const entitlementNow = Date.now();
  if (customer.depletion_reason === "data_limit") {
    return {
      found: true,
      status: "depleted",
      expiresAt,
      planName: plan.name,
      username: customer.username,
      error: "Your package data allowance has been used. Purchase a new package to reconnect.",
      customer,
      plan,
    };
  }
  if (isPrepaidCustomerExpired(customer.status, expiresAt, customer.depletion_reason, entitlementNow)) {
    return {
      found: true,
      status: "expired",
      expiresAt,
      planName: plan.name,
      username: customer.username,
      error: "This hotspot package has expired. Purchase a new package to reconnect.",
      customer,
      plan,
    };
  }
  if (!isPrepaidCustomerEntitled(
    customer.status,
    expiresAt,
    customer.depletion_reason,
    entitlementNow,
  )) {
    return {
      found: true,
      status: "unavailable",
      expiresAt,
      planName: plan.name,
      username: customer.username,
      error: "This hotspot account is not active. Contact support.",
      customer,
      plan,
    };
  }
  if (!String(customer.username ?? "").trim() || !String(customer.password ?? "")) {
    return {
      found: true,
      status: "unavailable",
      expiresAt,
      planName: plan.name,
      username: customer.username,
      error: "This confirmed purchase does not have hotspot login credentials yet. Contact support.",
      customer,
      plan,
    };
  }

  return {
    found: true,
    status: "active",
    expiresAt,
    planName: plan.name,
    username: customer.username,
    customer,
    plan,
  };
}

/*
 * POST /api/customers/hotspot-tv-status
 * Diagnose one paid TV checkout without creating an account or changing RouterOS.
 * The checkout reference and stored target MAC keep the check tied to the TV
 * purchase rather than the phone/browser that opened the portal.
 */
router.post("/customers/hotspot-tv-status", async (req, res): Promise<void> => {
  const portalScope = req.hotspotPortalContext;
  const adminId = portalScope?.adminId ?? Number(req.body?.adminId);
  const checkoutId = String(req.body?.checkout_id ?? "").trim();
  const requestedMac = normalisePortalMac(req.body?.mac_address);

  if (
    !Number.isSafeInteger(adminId)
    || adminId < 1
    || !/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId)
    || !requestedMac
  ) {
    res.status(400).json({ ok: false, error: "A valid TV purchase and device MAC are required." });
    return;
  }

  try {
    const transaction = (await sbSelectStrict<{
      id: number;
      status: string;
      payment_method: string;
      customer_id: number | null;
      plan_id: number | null;
      mac_address: string | null;
    }>(
      "isp_transactions",
      `reference=eq.${encodeURIComponent(checkoutId)}&admin_id=eq.${adminId}&payment_method=eq.mpesa&select=id,status,payment_method,customer_id,plan_id,mac_address&limit=1`,
    ))[0];

    if (!transaction) {
      res.status(404).json({ ok: false, error: "We could not find that TV purchase on this hotspot." });
      return;
    }

    const transactionMac = normalisePortalMac(transaction.mac_address);
    if (transactionMac && transactionMac !== requestedMac) {
      res.status(409).json({ ok: false, error: "The device MAC does not match the TV linked to this payment." });
      return;
    }

    const paid = ["completed", "paid", "success"].includes(String(transaction.status).toLowerCase());
    if (!paid) {
      const failed = ["failed", "cancelled", "canceled"].includes(String(transaction.status).toLowerCase());
      res.json({
        ok: true,
        status: failed ? "payment_failed" : "payment_pending",
        paymentStatus: failed ? "failed" : "pending",
        packageStatus: "unavailable",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        retryAvailable: false,
        message: failed
          ? "This payment was not completed. Check your M-Pesa message before trying again."
          : "The payment is not confirmed yet. Keep this page open and check again shortly.",
      });
      return;
    }

    if (!transactionMac) {
      res.status(409).json({ ok: false, error: "The device MAC does not match the TV linked to this payment." });
      return;
    }

    if (!transaction.plan_id) {
      res.json({
        ok: true,
        status: "package_unavailable",
        paymentStatus: "paid",
        packageStatus: "unavailable",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        retryAvailable: false,
        message: "Payment is confirmed, but package details are not available yet. Please contact your ISP.",
      });
      return;
    }

    const plan = (await sbSelectStrict<PlanRow>(
      "isp_plans",
      `id=eq.${transaction.plan_id}&admin_id=eq.${adminId}${portalScope
        ? `&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&owner_reseller_id=eq.${portalScope.resellerId}`
        : ""}&select=id,name,type,router_id,port_id,owner_reseller_id&limit=1`,
    ))[0];

    if (!plan || normalizePlanServiceType(plan.type) !== "hotspot") {
      res.status(404).json({ ok: false, error: "This TV purchase is not available on the current hotspot service." });
      return;
    }

    if (!transaction.customer_id) {
      res.json({
        ok: true,
        status: "account_pending",
        paymentStatus: "paid",
        packageStatus: "pending",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        retryAvailable: true,
        message: "Payment is confirmed. The TV package account is still being prepared; retry activation to finish setup.",
      });
      return;
    }

    const customer = (await sbSelectStrict<Pick<
      CustomerRow,
      "id" | "admin_id" | "mac_address" | "username" | "type" | "router_id" | "port_id"
        | "status" | "expires_at" | "depletion_reason"
    >>(
      "isp_customers",
      `id=eq.${transaction.customer_id}&select=id,admin_id,mac_address,username,type,router_id,port_id,status,expires_at,depletion_reason&limit=1`,
    ))[0];

    const customerBelongsToScope = customer && (
      portalScope
        ? customer.admin_id === portalScope.resellerId
          && customer.type === "hotspot"
          && customer.router_id === portalScope.routerId
          && customer.port_id === portalScope.portId
        : customer.admin_id === adminId && customer.type === "hotspot"
    );
    if (!customer) {
      res.json({
        ok: true,
        status: "account_pending",
        paymentStatus: "paid",
        packageStatus: "pending",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        retryAvailable: true,
        message: "Payment is confirmed, but the TV account is not ready yet. Retry activation to finish setup.",
      });
      return;
    }
    if (!customerBelongsToScope || normalisePortalMac(customer.mac_address) !== requestedMac) {
      res.status(404).json({ ok: false, error: "This TV purchase is not available on the current hotspot service." });
      return;
    }
    if (!String(customer.username ?? "").trim()) {
      res.json({
        ok: true,
        status: "account_pending",
        paymentStatus: "paid",
        packageStatus: "pending",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        retryAvailable: true,
        message: "Payment is confirmed, but the TV account is not ready yet. Retry activation to finish setup.",
      });
      return;
    }

    const expiresAt = customer.expires_at;
    const entitlementNow = Date.now();
    if (customer.depletion_reason === "data_limit") {
      res.json({
        ok: true,
        status: "package_depleted",
        paymentStatus: "paid",
        packageStatus: "depleted",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "The package data allowance has been used. Purchase a new package to reconnect this TV.",
      });
      return;
    }
    if (isPrepaidCustomerExpired(customer.status, expiresAt, customer.depletion_reason, entitlementNow)) {
      res.json({
        ok: true,
        status: "package_expired",
        paymentStatus: "paid",
        packageStatus: "expired",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "This TV package has expired. Purchase a new package to reconnect.",
      });
      return;
    }
    if (!isPrepaidCustomerEntitled(customer.status, expiresAt, customer.depletion_reason, entitlementNow)) {
      res.json({
        ok: true,
        status: "package_inactive",
        paymentStatus: "paid",
        packageStatus: "inactive",
        connected: false,
        deviceVisible: null,
        routerReachable: null,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "The TV account is not active. Contact your ISP for help.",
      });
      return;
    }

    const routerId = customer.router_id ?? plan.router_id;
    if (!routerId || (portalScope && routerId !== portalScope.routerId)) {
      res.json({
        ok: true,
        status: "router_unavailable",
        paymentStatus: "paid",
        packageStatus: "active",
        connected: false,
        deviceVisible: null,
        routerReachable: false,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "The package is active, but its hotspot router is not available for a connection check.",
      });
      return;
    }

    const routerRow = (await sbSelectStrict<RouterRow>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    ))[0];
    if (!routerRow) {
      res.json({
        ok: true,
        status: "router_unavailable",
        paymentStatus: "paid",
        packageStatus: "active",
        connected: false,
        deviceVisible: null,
        routerReachable: false,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "The package is active, but the hotspot router is offline or unavailable. Check again shortly.",
      });
      return;
    }

    try {
      const creds = routerCredentials(routerRow);
      const activeUsers = await fetchHotspotUsers(creds);
      const username = String(customer.username).trim();
      const connected = activeUsers.some(user =>
        user.user === username && normalisePortalMac(user.macAddress) === requestedMac,
      );
      let deviceVisible: boolean | null = connected;
      if (!connected) {
        try {
          deviceVisible = Boolean(await resolveHotspotClientIpByMac(creds, requestedMac));
        } catch {
          deviceVisible = null;
        }
      }

      const status = connected
        ? "connected"
        : deviceVisible === true
          ? "login_needed"
          : deviceVisible === false
            ? "device_not_seen"
            : "router_check_partial";
      const message = connected
        ? "RouterOS confirms this TV is connected. If streaming still fails, reconnect the TV to Wi-Fi and reopen the streaming app."
        : deviceVisible === true
          ? "The package is active and the router sees this TV, but its hotspot session is not active. Retry TV sign-in."
          : deviceVisible === false
            ? "The router cannot see this TV MAC. Connect the TV to the hotspot Wi-Fi and check its MAC; a router or extender between the TV and hotspot may hide the TV’s MAC."
            : "The router responded, but could not confirm whether this TV is on the hotspot. Check again shortly.";

      res.json({
        ok: true,
        status,
        paymentStatus: "paid",
        packageStatus: "active",
        connected,
        deviceVisible,
        routerReachable: true,
        planName: plan.name,
        expiresAt,
        retryAvailable: !connected && deviceVisible === true,
        message,
      });
    } catch (error) {
      logger.warn({ err: error, adminId, routerId }, "[customers/hotspot-tv-status] RouterOS read failed");
      res.json({
        ok: true,
        status: "router_unavailable",
        paymentStatus: "paid",
        packageStatus: "active",
        connected: false,
        deviceVisible: null,
        routerReachable: false,
        planName: plan.name,
        expiresAt,
        retryAvailable: false,
        message: "The package is active, but the router could not be reached for a connection check. Try again shortly.",
      });
    }
  } catch (error) {
    logger.warn({ err: error, adminId }, "[customers/hotspot-tv-status] status lookup failed");
    res.status(503).json({ ok: false, error: "TV package status is temporarily unavailable. Please try again." });
  }
});

/*
 * POST /api/customers/hotspot-troubleshoot
 * The check action reads only the latest confirmed purchase tied to this
 * device MAC. Login re-runs that same entitlement check before using the
 * saved RouterOS credentials; the password is never sent to the portal.
 */
router.post("/customers/hotspot-troubleshoot", async (req, res): Promise<void> => {
  const portalScope = req.hotspotPortalContext;
  const adminId = portalScope?.adminId ?? Number(req.body?.adminId);
  const requestedMac = normalisePortalMac(req.body?.mac_address);
  const action = req.body?.action === "login" ? "login" : "check";
  // Landing-page expiry checks only need database status; login requests must still verify hard-cap usage.
  const expiryOnlyCheck = action === "check" && req.body?.expiry_only === true;
  const reconnectTimingStartedAt = process.hrtime.bigint();
  const reconnectStageDurationsMs: Record<string, number> = {};
  let reconnectTimingOutcome = "early_exit";
  let sessionDisconnectCalls = 0;
  let successfulSessionDisconnectCalls = 0;
  const measureReconnectStage = async <T>(
    stage: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = process.hrtime.bigint();
    try {
      return await operation();
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      reconnectStageDurationsMs[stage] = Math.round(durationMs * 10) / 10;
    }
  };
  res.once("finish", () => {
    if (action !== "login" || Object.keys(reconnectStageDurationsMs).length === 0) return;
    const totalMs = Number(process.hrtime.bigint() - reconnectTimingStartedAt) / 1_000_000;
    logger.info({
      event: "hotspot.reconnect.timing",
      outcome: reconnectTimingOutcome,
      statusCode: res.statusCode,
      totalMs: Math.round(totalMs * 10) / 10,
      stageDurationsMs: reconnectStageDurationsMs,
      sessionDisconnectCalls,
      successfulSessionDisconnectCalls,
    }, "[customers/hotspot-troubleshoot] reconnect timing");
  });

  if (!Number.isSafeInteger(adminId) || adminId < 1 || !requestedMac) {
    res.status(400).json({ ok: false, error: "ISP context and the hotspot device MAC address are required." });
    return;
  }

  let targetScope: HotspotRoamingServiceScope | undefined = portalScope
    ? { routerId: portalScope.routerId, portId: portalScope.portId }
    : undefined;
  if (!portalScope && !expiryOnlyCheck) {
    try {
      const resolvedTarget = await measureReconnectStage(
        "target_scope_resolution",
        () => resolveHotspotTargetScope(
          adminId,
          undefined,
          req.body?.router_id,
          req.body?.port_id,
        ),
      );
      if (resolvedTarget.error) {
        reconnectTimingOutcome = "target_scope_invalid";
        res.status(400).json({ ok: false, error: resolvedTarget.error });
        return;
      }
      targetScope = resolvedTarget.scope;
    } catch (error) {
      reconnectTimingOutcome = "target_scope_error";
      logger.warn({ err: error, adminId }, "[customers/hotspot-troubleshoot] target service validation failed");
      res.status(503).json({ ok: false, error: "Could not verify the selected Hotspot service. Please try again." });
      return;
    }
  }

  let lookup: HotspotPurchaseLookup;
  try {
    lookup = await measureReconnectStage(
      "purchase_lookup",
      () => lookupLatestHotspotPurchase(adminId, requestedMac, portalScope, targetScope),
    );
  } catch (error) {
    reconnectTimingOutcome = "purchase_lookup_error";
    logger.error({ err: error, adminId, macAddress: requestedMac }, "[customers/hotspot-troubleshoot] purchase lookup failed");
    res.status(503).json({ ok: false, error: "Could not verify the latest hotspot purchase. Please try again." });
    return;
  }

  const customer = lookup.customer;
  const plan = lookup.plan;
  const planServiceType = normalizePlanServiceType(plan?.type);
  let sharedUsageSnapshot: Awaited<ReturnType<typeof loadSharedRoamingUsage>> | null = null;
  const rawLimitMb = Number(customer?.fup_limit_mb ?? plan?.data_limit_mb);
  const capBytes = Number.isFinite(rawLimitMb) && rawLimitMb > 0
    ? dataLimitMegabytesToBytes(rawLimitMb)
    : null;
  let retryable = lookup.status === "unavailable";
  const needsSharedUsageRead = Boolean(
    targetScope
    && customer
    && plan
    && lookup.status === "active"
    && action === "check"
    && !expiryOnlyCheck
    && planServiceType !== "vlan"
    && plan.data_cap_mode !== "throttle"
    && capBytes !== null,
  );
  if (lookup.status === "active" && customer && plan && !expiryOnlyCheck) {
    try {
      let totalBytesUsed: number | null = null;
      if (needsSharedUsageRead && targetScope) {
        sharedUsageSnapshot = await measureReconnectStage(
          "quota_shared_usage_read",
          () => loadSharedRoamingUsage(
            adminId,
            plan,
            String(customer.username ?? ""),
            targetScope.routerId,
          ),
        );
        totalBytesUsed = sharedUsageSnapshot.totalBytes;
      } else if ((!targetScope || planServiceType === "vlan") && capBytes !== null && plan.data_cap_mode !== "throttle") {
        const sourceRouterId = customer.router_id ?? plan.router_id ?? null;
        if (!sourceRouterId) throw new Error("The package has no assigned hotspot router.");
        const routerRow = (await sbSelectStrict<RouterRow>(
          "isp_routers",
          `id=eq.${sourceRouterId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
        ))[0];
        if (!routerRow) throw new Error("The assigned hotspot router could not be found.");
        const usage = await measureReconnectStage(
          "quota_router_usage_read",
          () => fetchHotspotUserUsage(routerCredentials(routerRow), String(customer.username ?? "")),
        );
        totalBytesUsed = (usage?.bytesIn ?? 0) + (usage?.bytesOut ?? 0);
      }
      if (
        capBytes !== null
        && plan.data_cap_mode !== "throttle"
        && totalBytesUsed !== null
        && totalBytesUsed >= capBytes
      ) {
        lookup.status = "depleted";
        lookup.error = "Your package data allowance has been used. Purchase a new package to reconnect.";
        customer.status = "expired";
        customer.depletion_reason = "data_limit";
        await sbUpdateStrict(
          "isp_customers",
          `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`,
          { status: "expired", depletion_reason: "data_limit", updated_at: new Date().toISOString() },
        ).catch((error) => {
          logger.error({ err: error, customerId: customer.id }, "[customers/hotspot-troubleshoot] could not save data-depleted status");
        });
      }
    } catch (error) {
      logger.warn({ err: error, customerId: customer.id, targetRouterId: targetScope?.routerId }, "[customers/hotspot-troubleshoot] package quota check failed");
      lookup.status = "unavailable";
      lookup.error = "The router could not verify this package's remaining data. Please try again shortly.";
      retryable = true;
    }
  }
  reconnectTimingOutcome = lookup.status;
  const response = {
    ok: true,
    found: lookup.found,
    status: lookup.status,
    connected: false,
    retryable,
    expiresAt: lookup.expiresAt,
    planName: lookup.planName,
    username: lookup.username,
    customer: customer ? { name: customer.name, username: customer.username } : undefined,
    error: lookup.error,
  };
  if (lookup.status !== "active" || !customer || !plan || action === "check") {
    res.json(response);
    return;
  }

  const username = String(customer.username ?? "").trim();
  const password = String(customer.password ?? "");
  const routerId = targetScope?.routerId ?? portalScope?.routerId ?? customer.router_id ?? plan.router_id ?? null;
  if (!routerId) {
    res.status(409).json({ ...response, ok: false, error: "Your active plan is not linked to a hotspot router yet." });
    return;
  }
  const routerRow = (await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  ))[0];
  if (!routerRow) {
    res.status(409).json({ ...response, ok: false, error: "Your active plan's hotspot router could not be found." });
    return;
  }

  let creds: ReturnType<typeof routerCredentials>;
  try {
    creds = routerCredentials(routerRow);
  } catch (error) {
    res.status(503).json({
      ...response,
      ok: false,
      error: error instanceof Error ? error.message : "The hotspot router is not ready.",
    });
    return;
  }

  let hotspotServer: string | undefined;
  if (targetScope?.portId) {
    const portalOwnerFilter = portalScope
      ? `&assigned_reseller_id=eq.${portalScope.resellerId}&handoff_mode=eq.vlan_services`
      : "&assigned_reseller_id=is.null";
    const servicePorts = await measureReconnectStage(
      "target_port_lookup",
      () => sbSelectStrict<VlanPortRow>(
        "isp_reseller_ports",
        `id=eq.${targetScope.portId}&admin_id=eq.${adminId}&router_id=eq.${targetScope.routerId}${portalOwnerFilter}&status=eq.active&hotspot_enabled=is.true&select=id,admin_id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range,status,hotspot_enabled,link_status&limit=1`,
      ),
    );
    const servicePort = servicePorts[0];
    if (!servicePort) {
      reconnectTimingOutcome = "service_inactive";
      res.status(409).json({ ...response, ok: false, error: "The selected Hotspot service is not active." });
      return;
    }
    hotspotServer = portServiceResourceNames(servicePort).hotspotServer;
    if (
      customer.type === "vlan"
      && (!isValidIpv4(customer.ip_address) || !ipv4InSubnet(customer.ip_address, servicePort.subnet_range))
    ) {
      reconnectTimingOutcome = "vlan_ip_mismatch";
      res.status(409).json({ ...response, ok: false, error: "This VLAN account does not have a valid IP on the assigned service." });
      return;
    }
  }

  try {
    const desiredHotspotServer = targetScope?.portId === null ? "all" : hotspotServer;
    const requiresSharedUsageVerification = Boolean(
      targetScope
      && planServiceType !== "vlan"
      && capBytes !== null
      && plan.data_cap_mode !== "throttle",
    );
    const preflightAttempt = await measureReconnectStage(
      "router_single_connection_preflight",
      () => hotspotTroubleshootOperations.reconnectHotspotUserByMac(creds, {
        user: username,
        password,
        macAddress: requestedMac,
        verifyOnly: true,
        ...(desiredHotspotServer ? { expectedServer: desiredHotspotServer } : {}),
        ...(portalScope && customer.type === "vlan"
          ? { expectedIp: String(customer.ip_address) }
          : {}),
        ...(customer.type === "vlan" ? { loginIp: String(customer.ip_address) } : {}),
      }),
    );
    for (const [stage, duration] of Object.entries(preflightAttempt.stageDurationsMs)) {
      reconnectStageDurationsMs["preflight_" + stage] = duration;
    }
    if (preflightAttempt.kind === "device-not-found") {
      reconnectTimingOutcome = "device_not_found";
      res.status(409).json({
        ...response,
        ok: false,
        retryable: true,
        error: "The router has not found this device on the hotspot Wi-Fi yet. Keep it connected while automatic sign-in retries.",
      });
      return;
    }
    if (preflightAttempt.kind === "ip-mismatch") {
      reconnectTimingOutcome = "vlan_ip_mismatch";
      res.status(409).json({
        ...response,
        ok: false,
        error: "This device is not using the static IP assigned to its VLAN account.",
      });
      return;
    }
    if (preflightAttempt.kind === "connected" && !requiresSharedUsageVerification) {
      reconnectTimingOutcome = "connected";
      res.json({ ...response, connected: true });
      return;
    }

    const loginResult = await measureReconnectStage(
      "customer_lock_and_reconnect",
      () => withCustomerEditLock(customer.admin_id, customer.id, async assertLock => {
      await assertLock();
      let usageSnapshot = sharedUsageSnapshot;
      if (targetScope && planServiceType !== "vlan") {
        // Re-read usage after a disconnect to capture RouterOS's final counters.
        const preLoginUsageSnapshot = await measureReconnectStage(
          "pre_login_shared_usage_read",
          () => loadSharedRoamingUsage(adminId, plan, username, routerId, {
            // Uncapped plans still need the authorized router scope for session
            // cleanup, but do not need traffic counters to determine entitlement.
            readTrafficUsage: capBytes !== null,
          }),
        );
        usageSnapshot = preLoginUsageSnapshot;
        let sessionDisconnected = false;
        const scopedRouterRows = preLoginUsageSnapshot.routers;
        if (scopedRouterRows.length !== preLoginUsageSnapshot.routerIds.length) {
          throw new Error("A MikroTik needed to verify the shared package could not be found.");
        }
        await measureReconnectStage("router_session_cleanup", async () => {
          for (const otherRouter of scopedRouterRows) {
            if (otherRouter.id === routerId) continue;
            await assertLock();
            sessionDisconnectCalls += 1;
            if (await disconnectHotspotActiveUser(routerCredentials(otherRouter), username)) {
              sessionDisconnected = true;
              successfulSessionDisconnectCalls += 1;
            }
          }
          const desiredHotspotServer = targetScope.portId === null ? "all" : hotspotServer;
          if (desiredHotspotServer && desiredHotspotServer !== "all") {
            const localSessions = await measureReconnectStage(
              "local_active_session_read",
              () => fetchHotspotUsers(creds),
            );
            const sessionOnAnotherService = localSessions.some(user =>
              user.user === username
              && user.server !== desiredHotspotServer,
            );
            if (sessionOnAnotherService) {
              await assertLock();
              sessionDisconnectCalls += 1;
              if (await disconnectHotspotActiveUser(creds, username)) {
                sessionDisconnected = true;
                successfulSessionDisconnectCalls += 1;
              }
            }
          }
        });
        if (sessionDisconnected && capBytes !== null) {
          await assertLock();
          usageSnapshot = await measureReconnectStage(
            "usage_refresh_after_disconnect",
            () => loadSharedRoamingUsage(adminId, plan, username, routerId),
          );
        }
      }

      if (
        targetScope
        && capBytes !== null
        && plan.data_cap_mode !== "throttle"
        && usageSnapshot
        && usageSnapshot.totalBytes >= capBytes
      ) {
        lookup.status = "depleted";
        lookup.error = "Your package data allowance has been used. Purchase a new package to reconnect.";
        customer.status = "expired";
        customer.depletion_reason = "data_limit";
        await sbUpdateStrict(
          "isp_customers",
          `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`,
          { status: "expired", depletion_reason: "data_limit", updated_at: new Date().toISOString() },
        );
        return { kind: "depleted" as const };
      }

      const isCrossRouter = plan.router_id !== routerId;
      const needsDestinationProvisioning = Boolean(
        targetScope
        && planServiceType !== "vlan"
        && isDifferentHotspotService(plan, targetScope),
      );
      if (needsDestinationProvisioning && targetScope && usageSnapshot) {
        const profileName = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
        const roamingTag = `OSN-ROAM:${adminId}:${customer.id}:${plan.id}`;
        if (isCrossRouter) {
          const existingUsers = await fetchHotspotUserList(creds);
          const existingUser = existingUsers.find(user => user.name === username);
          if (existingUser && existingUser.comment !== roamingTag) {
            throw new Error("The destination MikroTik already has a different account with this login.");
          }
          await ensureHotspotUserProfile(creds, {
            name: profileName,
            sharedUsers: plan.shared_users ?? 1,
            rateLimit: routerRateLimit(
              plan.speed_down,
              plan.speed_up,
              plan.speed_down_unit ?? "Mbps",
              plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
            ),
          });
        }

        let localLimitBytes: string | undefined;
        let fupThresholdBytes: number | undefined;
        let fupSpeedLimit: string | undefined;
        if (capBytes !== null && plan.data_cap_mode === "throttle") {
          fupThresholdBytes = Math.max(
            1,
            sharedHotspotUsageAllowance(
              capBytes,
              usageSnapshot.totalBytes,
              usageSnapshot.targetRouterBytes,
            ).targetFupThresholdBytes,
          );
          fupSpeedLimit = routerRateLimit(
            plan.fup_speed_down,
            plan.fup_speed_up,
            "Mbps",
            "Mbps",
          );
          if (!fupSpeedLimit) throw new Error("The package's reduced-speed policy is incomplete.");
        } else if (capBytes !== null) {
          localLimitBytes = String(sharedHotspotUsageAllowance(
            capBytes,
            usageSnapshot.totalBytes,
            usageSnapshot.targetRouterBytes,
          ).targetRouterLimitBytes);
        } else {
          localLimitBytes = "0";
        }

        await assertLock();
        await measureReconnectStage("router_user_reconciliation", () =>
          reconcileHotspotUserAccess(creds, {
            name: username,
            password,
            profile: profileName,
            server: hotspotRoamingUserServer(plan.router_id, routerId, hotspotServer),
            ...(isCrossRouter ? { comment: roamingTag } : {}),
            expiresAt: customer.expires_at,
            enabled: customer.status === "active",
            limitBytesTotal: plan.data_cap_mode === "throttle" ? "0" : localLimitBytes,
            macAddress: requestedMac,
            rateLimit: fupSpeedLimit ?? routerRateLimit(
              plan.speed_down,
              plan.speed_up,
              plan.speed_down_unit ?? "Mbps",
              plan.speed_up_unit ?? plan.speed_down_unit ?? "Mbps",
            ),
            dataCapMode: plan.data_cap_mode === "throttle" ? "throttle" : "disconnect",
            ...(fupThresholdBytes !== undefined && fupSpeedLimit ? {
              fupLimitBytes: fupThresholdBytes,
              fupSpeedDownMbps: plan.fup_speed_down ?? undefined,
              fupSpeedUpMbps: plan.fup_speed_up ?? undefined,
            } : {}),
            sharedUsers: plan.shared_users ?? 1,
            preserveActiveSession: true,
            resetCounters: false,
          }),
        );
      }

      await assertLock();
      const reconnectAttempt = await measureReconnectStage(
        "router_single_connection_reconnect",
        () => hotspotTroubleshootOperations.reconnectHotspotUserByMac(creds, {
          user: username,
          password,
          macAddress: requestedMac,
          ...(portalScope && customer.type === "vlan"
            ? { expectedIp: String(customer.ip_address) }
            : {}),
          ...(targetScope?.portId === null ? { expectedServer: "all" } : hotspotServer ? { expectedServer: hotspotServer } : {}),
          ...(customer.type === "vlan" ? { loginIp: String(customer.ip_address) } : {}),
        }),
      );
      for (const [stage, duration] of Object.entries(reconnectAttempt.stageDurationsMs)) {
        reconnectStageDurationsMs[stage] = duration;
      }
      if (reconnectAttempt.kind === "device-not-found") return { kind: "device-not-found" as const };
      if (reconnectAttempt.kind === "ip-mismatch") return { kind: "vlan-ip-mismatch" as const };
      return reconnectAttempt.kind === "connected"
        ? { kind: "connected" as const }
        : { kind: "login-pending" as const };
    }),
    );
    reconnectTimingOutcome = loginResult.kind;
    if (loginResult.kind === "depleted") {
      res.json({ ...response, status: "depleted", error: lookup.error });
      return;
    }
    if (loginResult.kind === "device-not-found") {
      res.status(409).json({
        ...response,
        ok: false,
        retryable: true,
        error: "The router has not found this device on the hotspot Wi-Fi yet. Keep it connected while automatic sign-in retries.",
      });
      return;
    }
    if (loginResult.kind === "vlan-ip-mismatch") {
      reconnectTimingOutcome = "vlan_ip_mismatch";
      res.status(409).json({
        ...response,
        ok: false,
        error: "This device is not using the static IP assigned to its VLAN account.",
      });
      return;
    }
    if (loginResult.kind === "login-pending") {
      reconnectTimingOutcome = "login_pending";
      res.status(503).json({
        ...response,
        ok: false,
        retryable: true,
        error: "The router has not confirmed this device's login yet. Automatic sign-in will retry.",
      });
      return;
    }
    res.json({ ...response, connected: true });
  } catch (error) {
    reconnectTimingOutcome = "router_error";
    logger.warn({ err: error, adminId, routerId, macAddress: requestedMac }, "[customers/hotspot-troubleshoot] router connection attempt failed");
    res.status(503).json({
      ...response,
      ok: false,
      retryable: true,
      error: "Your plan is active, but the hotspot router has not accepted the connection yet. Automatic sign-in will retry.",
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
