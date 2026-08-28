import { Router, type IRouter, type Request, type Response } from "express";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import { sbDelete, sbInsert, sbSelect, sbUpdate } from "../lib/supabase-client.js";
import { getMpesaSettings, isMpesaConfigured } from "../lib/settings-store.js";

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
    if (!["hours", "days", "weeks", "months"].includes(unit)) return { error: "Validity unit must be hours, days, weeks, or months." };
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