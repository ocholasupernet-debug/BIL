import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";
import { normalizePlanValidityUnit } from "../lib/plan-validity.js";

const router: IRouter = Router();

type PlanScope = { routerId: number; portId: number | null };

function parseRequiredId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "null") return null;
  return parseRequiredId(value);
}

async function validatePlanScope(adminId: number, routerValue: unknown, portValue: unknown): Promise<PlanScope | null> {
  const requestedRouterId = parseOptionalId(routerValue);
  const requestedPortId = parseOptionalId(portValue);
  if (routerValue !== undefined && routerValue !== null && routerValue !== "" && requestedRouterId === null) return null;
  if (portValue !== undefined && portValue !== null && portValue !== "" && portValue !== "null" && requestedPortId === null) return null;

  let routerId = requestedRouterId;
  if (requestedPortId !== null) {
    const ports = await sbSelect<{ id: number; router_id: number; status: string }>(
      "isp_reseller_ports",
      `id=eq.${requestedPortId}&admin_id=eq.${adminId}&select=id,router_id,status&limit=1`,
    );
    const port = ports[0];
    if (!port || port.status === "disabled") return null;
    if (routerId !== null && port.router_id !== routerId) return null;
    routerId = port.router_id;
  }
  if (routerId === null) return null;
  const routers = await sbSelect<{ id: number }>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id&limit=1`,
  );
  return routers[0] ? { routerId, portId: requestedPortId } : null;
}

function planWritePayload(input: Record<string, unknown>, scope: PlanScope): Record<string, unknown> {
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
    : "";
  const requestedRouterId = parseOptionalId(req.query.routerId);
  const requestedPortId = parseOptionalId(req.query.portId);
  const scopeFilter = requestedRouterId
    ? requestedPortId
      ? `&router_id=eq.${requestedRouterId}&or=(port_id.eq.${requestedPortId},port_id.is.null)`
      : `&router_id=eq.${requestedRouterId}`
    : "&router_id=not.is.null";
  const activeOnly = req.query.activeOnly === "true";
  const purchasableOnly = req.query.purchasableOnly === "true";
  const availabilityFilters = [
    activeOnly ? "is_active=is.true" : "",
    purchasableOnly ? "client_can_purchase=is.true" : "",
  ].filter(Boolean).map(filter => `&${filter}`).join("");
  const rows = adminId
    ? await sbSelect("isp_plans", `admin_id=eq.${adminId}${typeFilter}${scopeFilter}${availabilityFilters}&select=*&order=price.asc,name.asc`)
    : [];
  res.json(rows);
});

router.post("/plans", async (req, res): Promise<void> => {
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
  if (!name || price === undefined) {
    res.status(400).json({ error: "name and price are required" });
    return;
  }
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    res.status(400).json({ error: "price must be a non-negative number" });
    return;
  }
  const effectiveAdminId = parseRequiredId(adminId ?? ispId);
  if (effectiveAdminId === null) {
    res.status(400).json({ error: "A valid ISP account is required." });
    return;
  }
  const scope = await validatePlanScope(effectiveAdminId, routerId, portId);
  if (!scope) {
    res.status(400).json({ error: "Choose a router, or choose a port belonging to that router. Universal plans are not supported." });
    return;
  }
  const [row] = await sbInsert<Record<string, unknown>>("isp_plans", {
    admin_id:     effectiveAdminId,
    ...planWritePayload({
       name, type, speed, speedDown, speedUp, price, durationDays, validity, validityUnit, validity_unit,
      description, sharedUsers, dataLimitMb, isActive, clientCanPurchase,
    }, scope),
  });
  if (!row) { res.status(500).json({ error: "Failed to create plan" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "plan", action: "added", subject: name, details: { price: Number(price), type: type ?? "hotspot" } });
  res.status(201).json(row);
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const effectiveAdminId = parseRequiredId(req.body?.adminId ?? req.body?.ispId);
  if (effectiveAdminId === null) {
    res.status(400).json({ error: "A valid ISP account is required." });
    return;
  }
  const sourceRows = await sbSelect<{ id: number; name: string; router_id: number | null; port_id: number | null }>(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&select=id,name,router_id,port_id&limit=1`,
  );
  const source = sourceRows[0];
  if (!source) { res.status(404).json({ error: "Plan not found" }); return; }

  const hasScopeInput = Object.prototype.hasOwnProperty.call(req.body, "routerId")
    || Object.prototype.hasOwnProperty.call(req.body, "portId");
  const scope = hasScopeInput
    ? await validatePlanScope(effectiveAdminId, req.body.routerId, req.body.portId)
    : source.router_id
      ? { routerId: source.router_id, portId: source.port_id }
      : null;
  if (!scope) {
    res.status(400).json({ error: "Choose a router, or choose a port belonging to that router. Universal plans are not supported." });
    return;
  }

  const updates: Record<string, unknown> = {
    ...planWritePayload(req.body, scope),
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
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}`,
    updates,
  );
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  void logActivity({ adminId: effectiveAdminId, type: "plan", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(row);
});

router.post("/plans/:id/copy", async (req, res): Promise<void> => {
  const sourceId = parseRequiredId(req.params.id);
  const effectiveAdminId = parseRequiredId(req.body?.adminId ?? req.body?.ispId);
  if (sourceId === null || effectiveAdminId === null) {
    res.status(400).json({ error: "A valid source plan and ISP account are required." });
    return;
  }
  const sources = await sbSelect<Record<string, unknown>>(
    "isp_plans",
    `id=eq.${sourceId}&admin_id=eq.${effectiveAdminId}&select=*&limit=1`,
  );
  const source = sources[0];
  if (!source) {
    res.status(404).json({ error: "Source plan not found." });
    return;
  }
  const scope = await validatePlanScope(effectiveAdminId, req.body.targetRouterId, req.body.targetPortId);
  if (!scope) {
    res.status(400).json({ error: "Choose a target router, or a target port belonging to that router." });
    return;
  }
  const samePort = source.port_id === null ? scope.portId === null : Number(source.port_id) === scope.portId;
  if (Number(source.router_id) === scope.routerId && samePort) {
    res.status(400).json({ error: "Choose a different router or port for the copied plan." });
    return;
  }
  const copyPayload = {
    admin_id: effectiveAdminId,
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

router.delete("/plans/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const effectiveAdminId = parseRequiredId(req.query.adminId ?? req.query.ispId);
  if (effectiveAdminId === null) {
    res.status(400).json({ error: "A valid ISP account is required." });
    return;
  }
  const rows = await sbSelect<{ name: string; admin_id: number }>(
    "isp_plans",
    `id=eq.${id}&admin_id=eq.${effectiveAdminId}&select=name,admin_id&limit=1`,
  );
  const row = rows[0];
  await sbDelete("isp_plans", `id=eq.${id}&admin_id=eq.${effectiveAdminId}`);
  if (row) void logActivity({ adminId: row.admin_id, type: "plan", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

export default router;
