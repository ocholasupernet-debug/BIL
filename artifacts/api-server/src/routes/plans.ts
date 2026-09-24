import { Router, type IRouter } from "express";
import {
  sbDelete,
  sbDeleteStrict,
  sbInsert,
  sbInsertStrict,
  sbSelect,
  sbSelectStrict,
  sbUpdate,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";
import { normalizePlanValidityUnit } from "../lib/plan-validity.js";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import { isSupportedPlanType, normalizePlanServiceType } from "../lib/plan-service-type.js";
import { isValidVlanTag } from "../lib/vlan-customer-queue.js";
import { planBelongsToOwner, planOwnerFilter } from "../lib/plan-ownership.js";
import {
  planServicePoolName,
  portServiceResourceNames,
  vlanServicePoolRanges,
} from "../lib/port-service-resources.js";

const router: IRouter = Router();

type PlanScope = { routerId: number; portId: number | null };
type PlanContext = {
  account: NonNullable<Awaited<ReturnType<typeof authenticatedAccount>>>;
  tenantId: number;
  allowedRouterIds: Set<number> | null;
  allowedPortIds: Set<number> | null;
};

function parseRequiredId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "null") return null;
  return parseRequiredId(value);
}

async function validatePlanScope(
  adminId: number,
  routerValue: unknown,
  portValue: unknown,
  restrictions?: Pick<PlanContext, "allowedRouterIds" | "allowedPortIds">,
  planType?: unknown,
): Promise<PlanScope | null> {
  const vlanPlan = normalizePlanServiceType(planType) === "vlan";
  const requestedRouterId = parseOptionalId(routerValue);
  const requestedPortId = parseOptionalId(portValue);
  if (routerValue !== undefined && routerValue !== null && routerValue !== "" && requestedRouterId === null) return null;
  if (portValue !== undefined && portValue !== null && portValue !== "" && portValue !== "null" && requestedPortId === null) return null;
  if (vlanPlan && requestedPortId === null) return null;
  if (restrictions?.allowedPortIds) {
    if (requestedPortId === null || !restrictions.allowedPortIds.has(requestedPortId)) return null;
  }

  let routerId = requestedRouterId;
  if (requestedPortId !== null) {
    const ports = await sbSelect<{
      id: number;
      router_id: number;
      status: string;
      handoff_mode: string | null;
      vlan_tag: string | null;
      reseller_id: number | null;
      assigned_reseller_id: number | null;
    }>(
      "isp_reseller_ports",
      `id=eq.${requestedPortId}&admin_id=eq.${adminId}&select=id,router_id,status,handoff_mode,vlan_tag,reseller_id,assigned_reseller_id&limit=1`,
    );
    const port = ports[0];
    if (!port || port.status === "disabled") return null;
    if (
      vlanPlan
      && (
        port.handoff_mode !== "vlan_services"
        || !isValidVlanTag(port.vlan_tag)
        || !Number.isSafeInteger(port.assigned_reseller_id ?? port.reseller_id)
        || Number(port.assigned_reseller_id ?? port.reseller_id) < 1
      )
    ) return null;
    if (routerId !== null && port.router_id !== routerId) return null;
    routerId = port.router_id;
  }
  if (routerId === null) return null;
  if (restrictions?.allowedRouterIds && !restrictions.allowedRouterIds.has(routerId)) return null;
  const routers = await sbSelect<{ id: number }>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id&limit=1`,
  );
  return routers[0] ? { routerId, portId: requestedPortId } : null;
}

async function getPlanContext(req: Parameters<typeof authenticatedAccount>[0]): Promise<PlanContext> {
  const account = await authenticatedAccount(req);
  if (!account) throw new Error("A valid signed-in account is required.");
  const tenantId = account.parent_id ?? account.id;
  if (account.role !== "reseller") {
    return { account, tenantId, allowedRouterIds: null, allowedPortIds: null };
  }

  const assignedPorts = await sbSelect<{ id: number; router_id: number; status: string }>(
    "isp_reseller_ports",
    `admin_id=eq.${tenantId}&assigned_reseller_id=eq.${account.id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,router_id,status&limit=1000`,
  );
  return {
    account,
    tenantId,
    allowedRouterIds: new Set(assignedPorts.map(port => port.router_id)),
    allowedPortIds: new Set(assignedPorts.map(port => port.id)),
  };
}

async function planContextRows(context: PlanContext): Promise<{
  plans: Record<string, unknown>[];
  bandwidths: Record<string, unknown>[];
  routers: Record<string, unknown>[];
  ports: Record<string, unknown>[];
  pools: Record<string, unknown>[];
}> {
  const ownerResellerId = context.account.role === "reseller" ? context.account.id : null;
  const [allPlans, bandwidths, routers, ports, pools] = await Promise.all([
    sbSelect<Record<string, unknown>>(
      "isp_plans",
      `admin_id=eq.${context.tenantId}&${planOwnerFilter(ownerResellerId)}&select=*&order=created_at.asc`,
    ),
    sbSelect<Record<string, unknown>>("isp_bandwidth", `admin_id=eq.${context.tenantId}&select=*&order=created_at.asc`),
    sbSelect<Record<string, unknown>>(
      "isp_routers",
      `admin_id=eq.${context.tenantId}&status=not.in.(setup,awaiting_ports,awaiting_sync,awaiting_connection)&select=id,admin_id,name,host,model,bridge_ip,vpn_ip,status,router_username,router_secret&order=name.asc`,
    ),
    sbSelect<Record<string, unknown>>(
      "isp_reseller_ports",
      context.allowedPortIds
        ? `admin_id=eq.${context.tenantId}&assigned_reseller_id=eq.${context.account.id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,router_id,interface_name,vlan_tag,assigned_reseller_id,status&order=interface_name.asc`
        : `admin_id=eq.${context.tenantId}&status=neq.disabled&select=id,router_id,interface_name,vlan_tag,assigned_reseller_id,status&order=interface_name.asc`,
    ),
    sbSelect<Record<string, unknown>>("isp_ip_pools", `admin_id=eq.${context.tenantId}&select=id,name,range_start,range_end,router_id,port_id,created_at&order=name.asc`),
  ]);
  const plans = context.account.role === "reseller"
    ? allPlans.filter(plan =>
        planBelongsToOwner(plan, ownerResellerId)
        &&
        context.allowedRouterIds!.has(Number(plan.router_id))
        && context.allowedPortIds!.has(Number(plan.port_id)),
      )
    : allPlans.filter(plan =>
        planBelongsToOwner(plan, null)
        && (plan.port_id == null || String(plan.type ?? "").toLowerCase() === "vlan"),
      );
  const filteredRouters = context.allowedRouterIds
    ? routers.filter(router => context.allowedRouterIds!.has(Number(router.id)))
    : routers;
  const filteredPools = context.allowedPortIds
    ? pools.filter(pool => context.allowedPortIds!.has(Number(pool.port_id)))
    : pools;
  return { plans, bandwidths, routers: filteredRouters, ports, pools: filteredPools };
}

type PlanPoolAssignment = {
  activeIpPool: string | null;
  expiredIpPool: string | null;
};

async function planPoolAssignment(
  adminId: number,
  scope: PlanScope,
  planType: unknown,
  existingExpiredIpPool?: unknown,
): Promise<PlanPoolAssignment> {
  let resources: ReturnType<typeof portServiceResourceNames> | undefined;
  if (scope.portId !== null) {
    const ports = await sbSelectStrict<{
      id: number;
      router_id: number;
      interface_name: string;
      bridge_name: string | null;
      handoff_mode: string | null;
      reseller_id: number | null;
      assigned_reseller_id: number | null;
      vlan_tag: string | null;
    }>(
      "isp_reseller_ports",
      `id=eq.${scope.portId}&admin_id=eq.${adminId}&router_id=eq.${scope.routerId}&select=id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag&limit=1`,
    );
    const port = ports[0];
    if (!port) throw new Error("The selected service port could not be loaded.");
    resources = portServiceResourceNames({
      ...port,
      handoff_mode: port.handoff_mode as "services" | "isp_router" | "vlan_services" | null,
    });
  }

  return {
    activeIpPool: planServicePoolName(String(planType ?? "hotspot"), resources),
    expiredIpPool: existingExpiredIpPool === undefined
      ? null
      : String(existingExpiredIpPool ?? "").trim() || null,
  };
}

function planWritePayload(
  input: Record<string, unknown>,
  scope: PlanScope,
  pools: PlanPoolAssignment,
): Record<string, unknown> {
  const validity = Number(input.durationDays ?? input.validity ?? 30);
  const sharedUsers = Number(input.sharedUsers ?? 1);
  const speedDown = Number(input.speedDown ?? input.speed ?? 10);
  const speedUp = Number(input.speedUp ?? input.speed ?? 10);
  const validityUnit = normalizePlanValidityUnit(input.validityUnit ?? input.validity_unit);
  return {
    name: String(input.name ?? "").trim(),
    type: input.type ?? "hotspot",
    speed_down: Number.isFinite(speedDown) ? speedDown : 10,
    speed_up: Number.isFinite(speedUp) ? speedUp : 10,
    price: Number(input.price),
    validity: Number.isFinite(validity) ? validity : 30,
    validity_unit: validityUnit,
    validity_days: Number.isFinite(validity) ? validity : 30,
    shared_users: Number.isFinite(sharedUsers) && sharedUsers > 0 ? sharedUsers : 1,
    router_id: scope.routerId,
    port_id: scope.portId,
    active_ip_pool: pools.activeIpPool,
    expired_ip_pool: pools.expiredIpPool,
    data_limit_mb: input.dataLimitMb ?? null,
    is_active: input.isActive ?? true,
    client_can_purchase: input.clientCanPurchase ?? true,
    description: input.description ?? null,
  };
}

/*
 * /api/plans — Supabase isp_plans proxy.
 * Query param: adminId or ispId → filters by admin_id.
 * Customer-facing callers can pass activeOnly=true and purchasableOnly=true
 * to receive only packages that are currently available for purchase.
 */

router.get("/plans", async (req, res): Promise<void> => {
  const requestedAdminId = req.query.adminId ?? req.query.ispId;
  let adminId = typeof requestedAdminId === "string" ? requestedAdminId : undefined;
  if (!adminId) {
    const subdomain = getTenantSubdomainFromRequest(req);
    if (subdomain) {
      const admins = await sbSelect<{ id: number }>(
        "isp_admins",
        `subdomain=eq.${subdomain}&is_active=is.true&select=id&limit=1`,
      );
      if (admins[0]?.id) adminId = String(admins[0].id);
    }
  }

  const requestedType = typeof req.query.type === "string" ? req.query.type : "";
  const typeFilter = requestedType === "hotspot"
    ? "&type=in.(hotspot,trials,trial)"
    : requestedType === "pppoe"
      ? "&type=eq.pppoe"
      : requestedType.toLowerCase() === "vlan"
        ? "&type=eq.vlan"
    : "";
  const requestedRouterId = parseOptionalId(req.query.routerId);
  const requestedPortId = parseOptionalId(req.query.portId);
  let scopedRouterId = requestedRouterId;
  /*
   * Customer portals are always tied to one RouterOS service. Do not return
   * router-wide or sibling-port packages when a physical port was supplied,
   * and do not return every router's packages when the scope is absent.
   */
  const activeOnly = req.query.activeOnly === "true";
  const purchasableOnly = req.query.purchasableOnly === "true";
  const availabilityFilters = [
    activeOnly ? "is_active=is.true" : "",
    purchasableOnly ? "client_can_purchase=is.true" : "",
  ].filter(Boolean).map(filter => `&${filter}`).join("");
  if (adminId && requestedPortId) {
    const ports = await sbSelect<{ id: number; router_id: number; assigned_reseller_id: number | null }>(
      "isp_reseller_ports",
      `id=eq.${requestedPortId}&admin_id=eq.${adminId}&status=neq.disabled&select=id,router_id,assigned_reseller_id&limit=1`,
    );
    if (!ports[0] || (requestedRouterId !== null && ports[0].router_id !== requestedRouterId)) {
      res.json([]);
      return;
    }
    // The assigned port is authoritative. This also supports callers that
    // know the port from the RouterOS service but do not have to duplicate
    // its router id in the browser request.
    scopedRouterId = ports[0].router_id;
    const assignedResellerId = parseOptionalId(ports[0].assigned_reseller_id);
    const ownerFilter = planOwnerFilter(assignedResellerId);
    const scopeFilter = `&router_id=eq.${scopedRouterId}&port_id=eq.${requestedPortId}`;
    const rows = await sbSelect(
      "isp_plans",
      `admin_id=eq.${adminId}${typeFilter}${scopeFilter}&${ownerFilter}${availabilityFilters}&select=*&order=price.asc,name.asc`,
    );
    res.json(rows);
    return;
  }
  const scopeFilter = scopedRouterId
    ? requestedPortId
      ? `&router_id=eq.${scopedRouterId}&port_id=eq.${requestedPortId}`
      : `&router_id=eq.${scopedRouterId}&port_id=is.null`
    : "";
  const rows = adminId && scopedRouterId
    ? await sbSelect("isp_plans", `admin_id=eq.${adminId}${typeFilter}${scopeFilter}&${planOwnerFilter(null)}${availabilityFilters}&select=*&order=price.asc,name.asc`)
    : [];
  res.json(rows);
});

/* Authenticated admin plan context. Resellers receive only the parent ISP
   resources that belong to their approved VLAN service assignments. */
router.get("/plans/admin-context", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const context = await getPlanContext(req);
    const rows = await planContextRows(context);
    res.json({ ...rows, tenantId: context.tenantId, reseller: context.account.role === "reseller" });
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Plan context could not be loaded." });
  }
});

function validIpv4(value: unknown): boolean {
  return typeof value === "string"
    && /^(\d{1,3}\.){3}\d{1,3}$/.test(value.trim())
    && value.trim().split(".").every(part => Number(part) >= 0 && Number(part) <= 255);
}

function poolPayload(
  body: Record<string, unknown>,
  routerId: number,
  portId: number | null,
): Record<string, unknown> {
  const name = String(body.name ?? "").trim();
  const rangeStart = String(body.rangeStart ?? body.range_start ?? "").trim();
  const rangeEnd = String(body.rangeEnd ?? body.range_end ?? "").trim();
  if (!name || name.length > 80 || !validIpv4(rangeStart) || !validIpv4(rangeEnd)) {
    throw new Error("Enter a pool name and valid IPv4 start and end addresses.");
  }
  const toNumber = (value: string) => value.split(".").map(Number).reduce((sum, octet) => sum * 256 + octet, 0);
  if (toNumber(rangeStart) > toNumber(rangeEnd)) {
    throw new Error("The pool start address must not be after its end address.");
  }
  return {
    name,
    range_start: rangeStart,
    range_end: rangeEnd,
    router_id: routerId,
    port_id: portId,
    updated_at: new Date().toISOString(),
  };
}

async function scopedPoolContext(
  req: Parameters<typeof authenticatedAccount>[0],
  poolId?: number,
): Promise<{
  context: PlanContext;
  routerId: number;
  portId: number | null;
  existing?: Record<string, unknown>;
}> {
  const context = await getPlanContext(req);
  if (poolId) {
    const rows = await sbSelectStrict<Record<string, unknown>>(
      "isp_ip_pools",
      `id=eq.${poolId}&admin_id=eq.${context.tenantId}&select=*&limit=1`,
    );
    const existing = rows[0];
    if (!existing) throw new Error("IP pool not found.");
    const routerId = Number(existing.router_id);
    const portId = existing.port_id == null ? null : Number(existing.port_id);
    if (context.allowedPortIds && (!portId || !context.allowedPortIds.has(portId))) {
      throw new Error("This IP pool is outside your assigned VLAN service.");
    }
    return { context, routerId, portId, existing };
  }

  const body = req.body as Record<string, unknown>;
  const routerId = Number(body.routerId);
  const portId = body.portId === undefined || body.portId === null || body.portId === ""
    ? null
    : Number(body.portId);
  if (!Number.isSafeInteger(routerId) || routerId <= 0 || (portId !== null && (!Number.isSafeInteger(portId) || portId <= 0))) {
    throw new Error("Choose a valid router and VLAN service.");
  }
  if (context.allowedRouterIds && !context.allowedRouterIds.has(routerId)) {
    throw new Error("This router is outside your assigned VLAN service.");
  }
  if (context.allowedPortIds && (portId === null || !context.allowedPortIds.has(portId))) {
    throw new Error("Reseller IP pools must belong to one of your assigned VLAN services.");
  }
  if (portId !== null) {
    const ports = await sbSelectStrict<{ id: number }>(
      "isp_reseller_ports",
      `id=eq.${portId}&admin_id=eq.${context.tenantId}&router_id=eq.${routerId}&status=neq.disabled&select=id&limit=1`,
    );
    if (!ports[0]) throw new Error("The selected VLAN service was not found.");
  }
  return { context, routerId, portId };
}

router.post("/admin/ip-pools", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const { context, routerId, portId } = await scopedPoolContext(req);
    const inserted = await sbInsertStrict<Record<string, unknown>>(
      "isp_ip_pools",
      { admin_id: context.tenantId, ...poolPayload(req.body as Record<string, unknown>, routerId, portId) },
    );
    res.status(201).json({ ok: true, pool: inserted[0] ?? null });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unable to create IP pool." });
  }
});

router.patch("/admin/ip-pools/:id", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const poolId = parseRequiredId(req.params.id);
    if (!poolId) throw new Error("A valid IP pool is required.");
    const { context, routerId, portId, existing } = await scopedPoolContext(req, poolId);
    const updated = await sbUpdateStrict<Record<string, unknown>>(
      "isp_ip_pools",
      `id=eq.${poolId}&admin_id=eq.${context.tenantId}`,
      poolPayload(req.body as Record<string, unknown>, routerId, portId),
    );
    res.json({ ok: true, pool: updated[0] ?? existing ?? null });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unable to update IP pool." });
  }
});

router.delete("/admin/ip-pools/:id", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const poolId = parseRequiredId(req.params.id);
    if (!poolId) throw new Error("A valid IP pool is required.");
    const { context } = await scopedPoolContext(req, poolId);
    await sbDeleteStrict("isp_ip_pools", `id=eq.${poolId}&admin_id=eq.${context.tenantId}`);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unable to delete IP pool." });
  }
});

router.put("/admin/ip-pools/vlan-service/:portId", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const portId = parseRequiredId(req.params.portId);
    if (!portId) throw new Error("A valid VLAN service is required.");
    const context = await getPlanContext(req);
    const ports = await sbSelectStrict<Record<string, unknown>>(
      "isp_reseller_ports",
      `id=eq.${portId}&admin_id=eq.${context.tenantId}&status=neq.disabled&select=id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range&limit=1`,
    );
    const port = ports[0];
    if (!port || port.handoff_mode !== "vlan_services") throw new Error("The selected VLAN service was not found.");
    if (context.allowedPortIds && !context.allowedPortIds.has(portId)) {
      throw new Error("This VLAN service is outside your account.");
    }
    const routerId = Number(port.router_id);
    const resources = portServiceResourceNames({
      id: portId,
      router_id: routerId,
      interface_name: String(port.interface_name ?? ""),
      bridge_name: port.bridge_name as string | null,
      handoff_mode: "vlan_services",
      reseller_id: Number(port.reseller_id) || null,
      assigned_reseller_id: Number(port.assigned_reseller_id) || null,
      vlan_tag: String(port.vlan_tag ?? ""),
    });
    const defaults = vlanServicePoolRanges(String(port.subnet_range ?? ""));
    const values = [
      {
        name: resources.hotspotPool,
        rangeStart: req.body?.hotspotRangeStart ?? defaults.hotspot.split("-")[0],
        rangeEnd: req.body?.hotspotRangeEnd ?? defaults.hotspot.split("-")[1],
      },
      {
        name: resources.pppoePool,
        rangeStart: req.body?.pppoeRangeStart ?? defaults.pppoe.split("-")[0],
        rangeEnd: req.body?.pppoeRangeEnd ?? defaults.pppoe.split("-")[1],
      },
    ];
    const saved: Record<string, unknown>[] = [];
    for (const value of values) {
      const payload = { admin_id: context.tenantId, ...poolPayload(value, routerId, portId) };
      const existing = await sbSelectStrict<Record<string, unknown>>(
        "isp_ip_pools",
        `admin_id=eq.${context.tenantId}&router_id=eq.${routerId}&port_id=eq.${portId}&name=eq.${encodeURIComponent(value.name)}&select=id&limit=1`,
      );
      const rows = existing[0]
        ? await sbUpdateStrict<Record<string, unknown>>("isp_ip_pools", `id=eq.${existing[0].id}&admin_id=eq.${context.tenantId}`, payload)
        : await sbInsertStrict<Record<string, unknown>>("isp_ip_pools", payload);
      if (rows[0]) saved.push(rows[0]);
    }
    res.json({ ok: true, pools: saved });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save VLAN IP pools." });
  }
});

router.post("/plans/bandwidth", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const context = await getPlanContext(req);
    const name = String(req.body?.name ?? "").trim();
    const speedDown = Number(req.body?.speed_down);
    const speedUp = Number(req.body?.speed_up);
    if (!name || !Number.isFinite(speedDown) || speedDown <= 0 || !Number.isFinite(speedUp) || speedUp <= 0) {
      res.status(400).json({ error: "Enter a name and positive download and upload rates." });
      return;
    }
    const [row] = await sbInsert<Record<string, unknown>>("isp_bandwidth", {
      admin_id: context.tenantId,
      name,
      speed_down: speedDown,
      speed_up: speedUp,
      speed_down_unit: String(req.body?.speed_down_unit ?? "Mbps"),
      speed_up_unit: String(req.body?.speed_up_unit ?? "Mbps"),
      burst_enabled: req.body?.burst_enabled === true,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.status(201).json(row);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Bandwidth profile could not be created." });
  }
});

router.patch("/plans/bandwidth/:id", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const context = await getPlanContext(req);
    const id = parseRequiredId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "A valid bandwidth profile is required." });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    const speedDown = Number(req.body?.speed_down);
    const speedUp = Number(req.body?.speed_up);
    if (!name || !Number.isFinite(speedDown) || speedDown <= 0 || !Number.isFinite(speedUp) || speedUp <= 0) {
      res.status(400).json({ error: "Enter a name and positive download and upload rates." });
      return;
    }
    const [row] = await sbUpdate<Record<string, unknown>>(
      "isp_bandwidth",
      `id=eq.${id}&admin_id=eq.${context.tenantId}`,
      {
        name,
        speed_down: speedDown,
        speed_up: speedUp,
        speed_down_unit: String(req.body?.speed_down_unit ?? "Mbps"),
        speed_up_unit: String(req.body?.speed_up_unit ?? "Mbps"),
        burst_enabled: req.body?.burst_enabled === true,
        updated_at: new Date().toISOString(),
      },
    );
    if (!row) {
      res.status(404).json({ error: "Bandwidth profile not found." });
      return;
    }
    res.json(row);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Bandwidth profile could not be updated." });
  }
});

router.delete("/plans/bandwidth/:id", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const context = await getPlanContext(req);
    const id = parseRequiredId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "A valid bandwidth profile is required." });
      return;
    }
    await sbDelete("isp_bandwidth", `id=eq.${id}&admin_id=eq.${context.tenantId}`);
    res.sendStatus(204);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Bandwidth profile could not be deleted." });
  }
});

router.post("/plans", requireAdmin(), async (req, res): Promise<void> => {
  const {
    adminId,
    ispId,
    name,
    type,
    speed,
    speedDown,
    speedUp,
    price,
    durationDays,
    validity,
    description,
    sharedUsers,
    routerId,
    dataLimitMb,
    isActive,
    clientCanPurchase,
    portId,
    validityUnit,
    validity_unit,
  } = req.body;
  const normalizedType = String(type ?? "hotspot").trim().toLowerCase();
  if (!isSupportedPlanType(normalizedType)) {
    res.status(400).json({ error: "type must be hotspot, pppoe, static, trial, or vlan." });
    return;
  }
  if (!name || price === undefined) {
    res.status(400).json({ error: "name and price are required" });
    return;
  }
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    res.status(400).json({ error: "price must be a non-negative number" });
    return;
  }
  let context: PlanContext;
  try {
    context = await getPlanContext(req);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "A valid signed-in account is required." });
    return;
  }
  const requestedAccountId = parseRequiredId(adminId ?? ispId);
  if (context.account.role !== "reseller" && requestedAccountId !== null && requestedAccountId !== context.tenantId) {
    res.status(403).json({ error: "The selected ISP account does not match the signed-in account." });
    return;
  }
  const effectiveAdminId = context.tenantId;
  const scope = await validatePlanScope(effectiveAdminId, routerId, portId, context, normalizedType);
  if (!scope) {
    res.status(400).json({ error: context.account.role === "reseller"
      ? "Choose one of your assigned VLAN service ports for this plan."
      : "Choose a router, or choose a port belonging to that router. Universal plans are not supported." });
    return;
  }
  if (normalizedType === "vlan") {
    const down = Number(speedDown ?? speed ?? 10);
    const up = Number(speedUp ?? speed ?? 10);
    if (!Number.isFinite(down) || down <= 0 || !Number.isFinite(up) || up <= 0) {
      res.status(400).json({ error: "VLAN plans need positive download and upload speeds." });
      return;
    }
  }
  const pools = await planPoolAssignment(effectiveAdminId, scope, normalizedType);
  const [row] = await sbInsert<Record<string, unknown>>("isp_plans", {
    admin_id:     effectiveAdminId,
    owner_reseller_id: context.account.role === "reseller" ? context.account.id : null,
    ...planWritePayload({
       name, type: normalizedType, speed, speedDown, speedUp, price, durationDays, validity, validityUnit, validity_unit,
      description, sharedUsers, dataLimitMb, isActive, clientCanPurchase,
     }, scope, pools),
  });
  if (!row) { res.status(500).json({ error: "Failed to create plan" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "plan", action: "added", subject: name, details: { price: Number(price), type: type ?? "hotspot" } });
  res.status(201).json(row);
});

router.patch("/plans/:id", requireAdmin(), async (req, res): Promise<void> => {
  const id = req.params.id;
  let context: PlanContext;
  try {
    context = await getPlanContext(req);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "A valid signed-in account is required." });
    return;
  }
  const effectiveAdminId = context.tenantId;
  const sourceRows = await sbSelect<{
    id: number;
    name: string;
    type: string | null;
    router_id: number | null;
    port_id: number | null;
    expired_ip_pool: string | null;
  }>(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(context.account.role === "reseller" ? context.account.id : null)}&select=id,name,type,router_id,port_id,expired_ip_pool&limit=1`,
  );
  const source = sourceRows[0];
  if (!source) { res.status(404).json({ error: "Plan not found" }); return; }
  const normalizedType = String(req.body.type ?? source.type ?? "hotspot").trim().toLowerCase();
  if (!isSupportedPlanType(normalizedType)) {
    res.status(400).json({ error: "type must be hotspot, pppoe, static, trial, or vlan." });
    return;
  }

  const hasScopeInput = Object.prototype.hasOwnProperty.call(req.body, "routerId")
    || Object.prototype.hasOwnProperty.call(req.body, "portId");
  const scope = await validatePlanScope(
    effectiveAdminId,
    hasScopeInput ? req.body.routerId : source.router_id,
    hasScopeInput ? req.body.portId : source.port_id,
    context,
    normalizedType,
  );
  if (context.allowedPortIds && (!context.allowedPortIds.has(Number(source.port_id)) || !context.allowedRouterIds?.has(Number(source.router_id)))) {
    res.status(403).json({ error: "This plan is outside your assigned VLAN service scope." });
    return;
  }
  if (!scope) {
    res.status(400).json({ error: "Choose a router, or choose a port belonging to that router. Universal plans are not supported." });
    return;
  }
  const pools = await planPoolAssignment(
    effectiveAdminId,
    scope,
    normalizedType,
    req.body.expiredIpPool ?? source.expired_ip_pool,
  );

  const updates: Record<string, unknown> = {
    ...planWritePayload(req.body, scope, pools),
    updated_at: new Date().toISOString(),
  };
  if (req.body.name === undefined) delete updates.name;
  if (req.body.type === undefined) delete updates.type;
  if (req.body.speedDown === undefined && req.body.speedUp === undefined && req.body.speed === undefined) {
    delete updates.speed_down;
    delete updates.speed_up;
  }
  if (req.body.price === undefined) delete updates.price;
  if (req.body.durationDays === undefined && req.body.validity === undefined) {
    delete updates.validity;
    delete updates.validity_days;
  }
  if (req.body.validityUnit === undefined && req.body.validity_unit === undefined) delete updates.validity_unit;
  if (req.body.sharedUsers === undefined) delete updates.shared_users;
  if (req.body.dataLimitMb === undefined) delete updates.data_limit_mb;
  if (req.body.isActive === undefined) delete updates.is_active;
  if (req.body.clientCanPurchase === undefined) delete updates.client_can_purchase;
  if (req.body.description === undefined) delete updates.description;
  if (!hasScopeInput) {
    delete updates.router_id;
    delete updates.port_id;
  }
  const [row] = await sbUpdate<Record<string, unknown>>(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(context.account.role === "reseller" ? context.account.id : null)}`,
    updates,
  );
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  void logActivity({ adminId: effectiveAdminId, type: "plan", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(row);
});

router.post("/plans/:id/copy", requireAdmin(), async (req, res): Promise<void> => {
  const sourceId = parseRequiredId(req.params.id);
  if (sourceId === null) {
    res.status(400).json({ error: "A valid source plan is required." });
    return;
  }
  let context: PlanContext;
  try {
    context = await getPlanContext(req);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "A valid signed-in account is required." });
    return;
  }
  const effectiveAdminId = context.tenantId;
  const sources = await sbSelect<Record<string, unknown>>(
    "isp_plans",
    `id=eq.${sourceId}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(context.account.role === "reseller" ? context.account.id : null)}&select=*&limit=1`,
  );
  const source = sources[0];
  if (!source) {
    res.status(404).json({ error: "Source plan not found." });
    return;
  }
  const scope = await validatePlanScope(
    effectiveAdminId,
    req.body.targetRouterId,
    req.body.targetPortId,
    context,
    source.type ?? "hotspot",
  );
  if (!scope) {
    res.status(400).json({ error: "Choose a target router, or a target port belonging to that router." });
    return;
  }
  const samePort = source.port_id === null ? scope.portId === null : Number(source.port_id) === scope.portId;
  if (Number(source.router_id) === scope.routerId && samePort) {
    res.status(400).json({ error: "Choose a different router or port for the copied plan." });
    return;
  }
  const pools = await planPoolAssignment(effectiveAdminId, scope, source.type ?? "hotspot");
  const copyPayload = {
    admin_id: effectiveAdminId,
    owner_reseller_id: context.account.role === "reseller" ? context.account.id : null,
    name: String(req.body.name ?? `${String(source.name ?? "Plan")} (Copy)`).trim(),
    type: source.type ?? "hotspot",
    speed_down: source.speed_down ?? 10,
    speed_up: source.speed_up ?? 10,
    price: source.price ?? 0,
    validity: source.validity ?? 30,
    validity_unit: source.validity_unit ?? "days",
    validity_days: source.validity_days ?? source.validity ?? 30,
    shared_users: source.shared_users ?? 1,
    router_id: scope.routerId,
    port_id: scope.portId,
    active_ip_pool: pools.activeIpPool,
    expired_ip_pool: null,
    data_limit_mb: source.data_limit_mb ?? null,
    is_active: source.is_active ?? true,
    client_can_purchase: source.client_can_purchase ?? true,
    description: source.description ?? null,
  };
  const [row] = await sbInsert<Record<string, unknown>>("isp_plans", copyPayload);
  if (!row) {
    res.status(500).json({ error: "Failed to copy plan." });
    return;
  }
  void logActivity({ adminId: effectiveAdminId, type: "plan", action: "copied", subject: copyPayload.name, details: { sourceId, routerId: scope.routerId, portId: scope.portId } });
  res.status(201).json(row);
});

router.delete("/plans/:id", requireAdmin(), async (req, res): Promise<void> => {
  const id = req.params.id;
  let context: PlanContext;
  try {
    context = await getPlanContext(req);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "A valid signed-in account is required." });
    return;
  }
  const effectiveAdminId = context.tenantId;
  const rows = await sbSelect<{ name: string; admin_id: number; router_id: number | null; port_id: number | null }>(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(context.account.role === "reseller" ? context.account.id : null)}&select=name,admin_id,router_id,port_id&limit=1`,
  );
  const row = rows[0];
  if (row && context.allowedPortIds) {
    const scope = await validatePlanScope(effectiveAdminId, undefined, row.port_id, context);
    if (!scope) {
      res.status(403).json({ error: "This plan is outside your assigned VLAN service scope." });
      return;
    }
  }
  await sbDelete(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&${planOwnerFilter(context.account.role === "reseller" ? context.account.id : null)}`,
  );
  if (row) void logActivity({ adminId: row.admin_id, type: "plan", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

export default router;
