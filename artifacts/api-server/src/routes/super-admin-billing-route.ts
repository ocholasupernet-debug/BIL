import { Router, type IRouter, type Request, type Response } from "express";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import { sbDelete, sbInsert, sbSelect, sbSelectStrict, sbUpdate, sbUpsertStrict, sbDeleteStrict, sbInsertStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { getMpesaSettings, getPaymentDestinations, isMpesaConfigured } from "../lib/settings-store.js";
import { encryptGatewayConfig, gatewayConfigPreview, isResellerGatewayId, type ResellerGatewayRouteRow } from "../lib/reseller-payment-gateway.js";

const router: IRouter = Router();
const PLAN_TYPES = new Set(["hotspot", "pppoe", "static"]);

interface PlanInput {
  name?: unknown;
  type?: unknown;
  speed_down?: unknown;
  speed_up?: unknown;
  price?: unknown;
  validity?: unknown;
  validity_unit?: unknown;
  validity_days?: unknown;
  shared_users?: unknown;
  description?: unknown;
  is_active?: unknown;
}

function isSuperAdmin(req: Request, res: Response): boolean {
  const token = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  if (isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
  return false;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function routeScopeQuery(routerId: number | null, portId: number | null): string {
  if (portId) return `port_id=eq.${portId}`;
  if (routerId) return `router_id=eq.${routerId}&port_id=is.null`;
  return "router_id=is.null&port_id=is.null";
}

/*
 * Super Admin owns the Daraja credentials and the collection destinations.
 * These routes only copy a selected destination's non-secret metadata into
 * the encrypted reseller route record; no reseller can edit this boundary.
 */
router.get("/super-admin/reseller-payment-routes", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const [resellers, ports, routers, routes] = await Promise.all([
      sbSelectStrict<{ id: number; parent_id: number | null; name: string; company_name: string | null; username: string | null }>(
        "isp_admins",
        "role=eq.reseller&is_active=is.true&select=id,parent_id,name,company_name,username&order=name.asc,id.asc",
      ),
      sbSelectStrict<{ id: number; admin_id: number; assigned_reseller_id: number | null; router_id: number; interface_name: string; vlan_tag: string | null; status: string; handoff_mode: string }>(
        "isp_reseller_ports",
        "handoff_mode=eq.vlan_services&status=neq.disabled&select=id,admin_id,assigned_reseller_id,router_id,interface_name,vlan_tag,status,handoff_mode&order=interface_name.asc,id.asc",
      ),
      sbSelectStrict<{ id: number; admin_id: number; name: string }>("isp_routers", "select=id,admin_id,name&order=name.asc,id.asc"),
      sbSelectStrict<ResellerGatewayRouteRow>(
        "reseller_payment_gateway_routes",
        "select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_preview,is_active,created_at,updated_at&order=updated_at.desc",
      ),
    ]);
    const resellerIds = new Set(resellers.map(row => row.id));
    const routerNames = new Map(routers.map(row => [row.id, row.name]));
    const destinations = getPaymentDestinations().destinations
      .filter(destination => destination.active && (destination.type === "till" || destination.type === "paybill"))
      .map(destination => ({
        id: destination.id,
        type: destination.type,
        name: destination.name,
        number: destination.number,
        accountReference: destination.accountReference,
      }));
    res.json({
      ok: true,
      destinations,
      resellers: resellers.map(reseller => ({
        id: reseller.id,
        parentId: reseller.parent_id,
        name: reseller.company_name || reseller.name || reseller.username || `Reseller #${reseller.id}`,
        username: reseller.username,
      })),
      ports: ports
        .filter(port => port.assigned_reseller_id && resellerIds.has(port.assigned_reseller_id))
        .map(port => ({
          id: port.id,
          resellerId: port.assigned_reseller_id,
          routerId: port.router_id,
          label: `${routerNames.get(port.router_id) ?? "Router"} · ${port.interface_name}${port.vlan_tag ? ` · VLAN ${port.vlan_tag}` : ""}`,
          status: port.status,
        })),
      routes: routes
        .filter(route => resellerIds.has(route.reseller_id))
        .map(route => ({
          id: route.id,
          resellerId: route.reseller_id,
          routerId: route.router_id,
          portId: route.port_id,
          gatewayType: route.gateway_type,
          config: route.config_preview ?? {},
          isActive: route.is_active,
        })),
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not load reseller payment routes." });
  }
});

router.put("/super-admin/reseller-payment-routes", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const resellerId = positiveId(req.body?.resellerId);
    const portId = positiveId(req.body?.portId);
    const requestedRouterId = positiveId(req.body?.routerId);
    const destinationId = typeof req.body?.destinationId === "string" ? req.body.destinationId.trim() : "";
    const isActive = req.body?.isActive !== false;
    if (!resellerId || !destinationId) {
      res.status(400).json({ ok: false, error: "Choose a reseller and an active M-Pesa destination." });
      return;
    }
    const resellers = await sbSelectStrict<{ id: number; parent_id: number | null }>(
      "isp_admins",
      `id=eq.${resellerId}&role=eq.reseller&is_active=is.true&select=id,parent_id&limit=1`,
    );
    const reseller = resellers[0];
    if (!reseller?.parent_id) {
      res.status(404).json({ ok: false, error: "The selected reseller was not found." });
      return;
    }
    const destination = getPaymentDestinations().destinations.find(row => row.id === destinationId && row.active);
    if (!destination || (destination.type !== "till" && destination.type !== "paybill")) {
      res.status(400).json({ ok: false, error: "Choose an active Till or PayBill destination managed by Super Admin." });
      return;
    }
    let routerId: number | null = requestedRouterId;
    if (portId) {
      const ports = await sbSelectStrict<{ id: number; router_id: number; admin_id: number; assigned_reseller_id: number | null; handoff_mode: string; status: string }>(
        "isp_reseller_ports",
        `id=eq.${portId}&admin_id=eq.${reseller.parent_id}&assigned_reseller_id=eq.${resellerId}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,router_id,admin_id,assigned_reseller_id,handoff_mode,status&limit=1`,
      );
      if (!ports[0]) {
        res.status(403).json({ ok: false, error: "That VLAN port is not assigned to the selected reseller." });
        return;
      }
      routerId = ports[0].router_id;
    } else if (routerId) {
      const routers = await sbSelectStrict<{ id: number }>(
        "isp_routers",
        `id=eq.${routerId}&admin_id=eq.${reseller.parent_id}&select=id&limit=1`,
      );
      if (!routers[0]) {
        res.status(403).json({ ok: false, error: "That router does not belong to the reseller's ISP account." });
        return;
      }
    }
    if (portId && !routerId) {
      res.status(400).json({ ok: false, error: "The selected VLAN port has no linked router." });
      return;
    }
    const gatewayType = destination.type === "till" ? "mpesa_till_push" : "mpesa_paybill";
    if (!isResellerGatewayId(gatewayType)) throw new Error("Unsupported M-Pesa route type.");
    const config: Record<string, string> = destination.type === "till"
      ? { destinationId, tillNumber: destination.number }
      : { destinationId, paybillNumber: destination.number, accountNumber: destination.accountReference };
    if (destination.type === "paybill" && !destination.accountReference) {
      res.status(400).json({ ok: false, error: "The selected PayBill destination has no account reference." });
      return;
    }
    const existing = await sbSelectStrict<ResellerGatewayRouteRow>(
      "reseller_payment_gateway_routes",
      `admin_id=eq.${reseller.parent_id}&reseller_id=eq.${resellerId}&${routeScopeQuery(routerId, portId)}&select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_ciphertext,config_preview,is_active&limit=1`,
    );
    const payload = {
      admin_id: reseller.parent_id,
      reseller_id: resellerId,
      router_id: routerId,
      port_id: portId,
      gateway_type: gatewayType,
      config_ciphertext: encryptGatewayConfig(config),
      config_preview: gatewayConfigPreview(gatewayType, config),
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };
    const saved = existing[0]
      ? await sbUpdateStrict<{ id: number }>("reseller_payment_gateway_routes", `id=eq.${existing[0].id}`, payload)
      : await sbInsertStrict<{ id: number }>("reseller_payment_gateway_routes", { ...payload, created_at: new Date().toISOString() });
    res.json({ ok: true, routeId: saved[0]?.id ?? existing[0]?.id });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Could not save the reseller payment route." });
  }
});

router.delete("/super-admin/reseller-payment-routes/:id", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const routeId = positiveId(req.params.id);
  if (!routeId) {
    res.status(400).json({ ok: false, error: "Invalid payment route." });
    return;
  }
  try {
    await sbDeleteStrict("reseller_payment_gateway_routes", `id=eq.${routeId}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Could not remove the reseller payment route." });
  }
});

function cleanPlanInput(body: PlanInput, partial = false): Record<string, unknown> | { error: string } {
  const updates: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) return { error: "Package name must be between 2 and 120 characters." };
    updates.name = name;
  }
  if (!partial || body.type !== undefined) {
    const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
    if (!PLAN_TYPES.has(type)) return { error: "Package type must be hotspot, PPPoE, or static." };
    updates.type = type;
  }
  if (!partial || body.speed_down !== undefined) {
    const speedDown = parseNumber(body.speed_down, NaN);
    if (!Number.isFinite(speedDown) || speedDown < 0 || speedDown > 100000) return { error: "Download speed must be between 0 and 100,000 Mbps." };
    updates.speed_down = speedDown;
  }
  if (!partial || body.speed_up !== undefined) {
    const speedUp = parseNumber(body.speed_up, NaN);
    if (!Number.isFinite(speedUp) || speedUp < 0 || speedUp > 100000) return { error: "Upload speed must be between 0 and 100,000 Mbps." };
    updates.speed_up = speedUp;
  }
  if (!partial || body.price !== undefined) {
    const price = parseNumber(body.price, NaN);
    if (!Number.isFinite(price) || price < 0 || price > 100000000) return { error: "Price must be between 0 and 100,000,000." };
    updates.price = price;
  }
  if (!partial || body.validity !== undefined) {
    const validity = parseNumber(body.validity, NaN);
    if (!Number.isSafeInteger(validity) || validity < 1 || validity > 3650) return { error: "Validity must be a whole number between 1 and 3,650." };
    updates.validity = validity;
  }
  if (!partial || body.validity_unit !== undefined) {
    const unit = typeof body.validity_unit === "string" ? body.validity_unit.trim().toLowerCase() : "";
     if (!["mins", "hours", "days", "weeks", "months"].includes(unit)) return { error: "Validity unit must be mins, hours, days, weeks, or months." };
    updates.validity_unit = unit;
  }
  if (!partial || body.validity_days !== undefined) {
    const validityDays = parseNumber(body.validity_days ?? body.validity, NaN);
    if (!Number.isSafeInteger(validityDays) || validityDays < 1 || validityDays > 3650) return { error: "Validity days must be a whole number between 1 and 3,650." };
    updates.validity_days = validityDays;
  }
  if (!partial || body.shared_users !== undefined) {
    const sharedUsers = parseNumber(body.shared_users, NaN);
    if (!Number.isSafeInteger(sharedUsers) || sharedUsers < 1 || sharedUsers > 10000) return { error: "Shared users must be a whole number between 1 and 10,000." };
    updates.shared_users = sharedUsers;
  }
  if (!partial || body.description !== undefined) {
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
      return { error: "Description must be text." };
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 500) return { error: "Description cannot exceed 500 characters." };
    updates.description = description || null;
  }
  if (!partial || body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") return { error: "Package active status must be true or false." };
    updates.is_active = body.is_active;
  }

  return updates;
}

async function activeAdminExists(adminId: number): Promise<boolean> {
  const rows = await sbSelect<{ id: number }>(
    "isp_admins",
    `id=eq.${adminId}&is_active=is.true&select=id&limit=1`,
  );
  return !!rows[0];
}

router.get("/super-admin/billing/admins", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const admins = await sbSelect(
      "isp_admins",
      "is_active=is.true&select=id,name,subdomain,currency,payment_gateway,status&order=name.asc",
    );
    res.json({ ok: true, admins });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load active ISP accounts." });
  }
});

router.get("/super-admin/billing/platform-config", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const [config] = await sbSelectStrict<Record<string, unknown>>(
      "platform_billing_config",
      "id=eq.1&select=cutoff_day,due_day,sales_threshold,low_sales_fee,high_sales_fee,updated_at&limit=1",
    );
    res.json({ ok: true, config });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load platform billing rules." });
  }
});

router.put("/super-admin/billing/platform-config", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const numberField = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const cutoffDay = numberField(req.body?.cutoff_day, 25);
  const dueDay = numberField(req.body?.due_day, 5);
  const threshold = numberField(req.body?.sales_threshold, 8000);
  const lowFee = numberField(req.body?.low_sales_fee, 500);
  const highFee = numberField(req.body?.high_sales_fee, 1400);
  if (![cutoffDay, dueDay].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 28)
      || ![threshold, lowFee, highFee].every(value => value >= 0 && value <= 100000000)) {
    res.status(400).json({ ok: false, error: "Enter valid billing days, threshold, and non-negative fees." });
    return;
  }
  try {
    const [config] = await sbUpsertStrict<Record<string, unknown>>(
      "platform_billing_config",
      "id",
      {
        id: 1,
        cutoff_day: cutoffDay,
        due_day: dueDay,
        sales_threshold: threshold,
        low_sales_fee: lowFee,
        high_sales_fee: highFee,
        updated_at: new Date().toISOString(),
      },
    );
    res.json({ ok: true, config });
  } catch {
    res.status(503).json({ ok: false, error: "Could not save platform billing rules." });
  }
});

router.get("/super-admin/billing/plans", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const adminId = parsePositiveId(req.query.adminId);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid ISP admin ID is required." });
    return;
  }
  try {
    if (!await activeAdminExists(adminId)) {
      res.status(404).json({ ok: false, error: "The selected ISP account is not active." });
      return;
    }
    const plans = await sbSelect(
      "isp_plans",
      `admin_id=eq.${adminId}&select=*&order=price.asc,name.asc`,
    );
    res.json({ ok: true, plans });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load packages for this ISP." });
  }
});

router.get("/super-admin/billing/payment-settings", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const adminId = parsePositiveId(req.query.adminId);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid ISP admin ID is required." });
    return;
  }
  try {
    const admins = await sbSelect<{
      id: number;
      payment_gateway: string | null;
      payment_gateway_config: unknown;
    }>(
      "isp_admins",
      `id=eq.${adminId}&is_active=is.true&select=id,payment_gateway,payment_gateway_config&limit=1`,
    );
    const admin = admins[0];
    if (!admin) {
      res.status(404).json({ ok: false, error: "The selected ISP account is not active." });
      return;
    }

    const map = admin.payment_gateway_config && typeof admin.payment_gateway_config === "object" &&
      !Array.isArray(admin.payment_gateway_config)
      ? admin.payment_gateway_config as Record<string, unknown>
      : {};
    const gatewayConfig = admin.payment_gateway && map[admin.payment_gateway] &&
      typeof map[admin.payment_gateway] === "object" && !Array.isArray(map[admin.payment_gateway])
      ? map[admin.payment_gateway] as Record<string, unknown>
      : {};
    const destination =
      typeof gatewayConfig.tillNumber === "string" ? { label: "Till number", number: gatewayConfig.tillNumber.trim() } :
      typeof gatewayConfig.paybillNumber === "string" ? { label: "PayBill number", number: gatewayConfig.paybillNumber.trim() } :
      null;
    const daraja = await getMpesaSettings();

    res.json({
      ok: true,
      paymentGateway: admin.payment_gateway || "mpesa_paybill",
      darajaConfigured: isMpesaConfigured(daraja),
      destination: destination?.number ? destination : null,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Could not load payment settings for this ISP." });
  }
});

router.post("/super-admin/billing/plans", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const adminId = parsePositiveId(req.body?.adminId);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid ISP admin ID is required." });
    return;
  }
  const input = cleanPlanInput(req.body as PlanInput);
  if ("error" in input) {
    res.status(400).json({ ok: false, error: input.error });
    return;
  }
  try {
    if (!await activeAdminExists(adminId)) {
      res.status(404).json({ ok: false, error: "The selected ISP account is not active." });
      return;
    }
    const [plan] = await sbInsert<Record<string, unknown>>("isp_plans", {
      admin_id: adminId,
      ...input,
      updated_at: new Date().toISOString(),
    });
    if (!plan) {
      res.status(503).json({ ok: false, error: "Could not create the package." });
      return;
    }
    res.status(201).json({ ok: true, plan });
  } catch {
    res.status(503).json({ ok: false, error: "Could not create the package." });
  }
});

router.patch("/super-admin/billing/plans/:id", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const planId = parsePositiveId(req.params.id);
  const adminId = parsePositiveId(req.body?.adminId);
  if (!planId || !adminId) {
    res.status(400).json({ ok: false, error: "A valid package ID and ISP admin ID are required." });
    return;
  }
  const input = cleanPlanInput(req.body as PlanInput, true);
  if ("error" in input) {
    res.status(400).json({ ok: false, error: input.error });
    return;
  }
  if (Object.keys(input).length === 0) {
    res.status(400).json({ ok: false, error: "At least one package field is required." });
    return;
  }
  try {
    const [plan] = await sbUpdate<Record<string, unknown>>(
      "isp_plans",
      `id=eq.${planId}&admin_id=eq.${adminId}`,
      { ...input, updated_at: new Date().toISOString() },
    );
    if (!plan) {
      res.status(404).json({ ok: false, error: "Package not found for the selected ISP." });
      return;
    }
    res.json({ ok: true, plan });
  } catch {
    res.status(503).json({ ok: false, error: "Could not update the package." });
  }
});

router.delete("/super-admin/billing/plans/:id", async (req, res): Promise<void> => {
  if (!isSuperAdmin(req, res)) return;
  const planId = parsePositiveId(req.params.id);
  const adminId = parsePositiveId(req.query.adminId);
  if (!planId || !adminId) {
    res.status(400).json({ ok: false, error: "A valid package ID and ISP admin ID are required." });
    return;
  }
  try {
    const deleted = await sbDelete(
      "isp_plans",
      `id=eq.${planId}&admin_id=eq.${adminId}`,
    );
    if (deleted.length === 0) {
      res.status(404).json({ ok: false, error: "Package not found for the selected ISP." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Could not delete the package." });
  }
});

export default router;