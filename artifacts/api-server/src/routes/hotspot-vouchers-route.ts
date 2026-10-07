import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
} from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { normalizeFixedHotspotVoucherCode } from "../lib/hotspot-voucher-utils.js";
import {
  summarizeHotspotVoucherStatus,
  type HotspotVoucherSession,
} from "../lib/hotspot-voucher-status.js";

const router: IRouter = Router();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_VOUCHERS_PER_REQUEST = 500;
const QUERY_BATCH_SIZE = 200;

interface HotspotPlan {
  id: number;
  name: string;
  type: string;
  price: number;
  validity: number;
  validity_unit: string | null;
  speed_down: number;
  speed_up: number;
  data_limit_mb: number | string | null;
  data_cap_mode: string | null;
  router_id: number | null;
}

interface HotspotRouter {
  id: number;
  name: string;
  host: string;
  status: string;
}

interface StoredVoucher {
  id: number;
  admin_id: number;
  code: string;
  plan_id: number | null;
  plan_name: string;
  router_id: number | null;
  router_name: string;
  price: number;
  validity_mins: number;
  data_limit_mb: number | string | null;
  data_cap_mode: string | null;
  expires_at: string | null;
  created_at: string;
  redeemed_at: string | null;
  redeemed_by_phone: string | null;
}

class RedeemedVoucherMutationError extends Error {
  constructor() {
    super("Redeemed vouchers are locked because they may still be in use. Only unused vouchers can be deleted.");
    this.name = "RedeemedVoucherMutationError";
  }
}

function planValidityMinutes(plan: HotspotPlan): number {
  const amount = Number(plan.validity);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = String(plan.validity_unit ?? "days").trim().toLowerCase();
  const minutesPerUnit = /^(m|min|mins|minute|minutes)$/.test(unit)
    ? 1
    : /^(h|hr|hrs|hour|hours)$/.test(unit)
      ? 60
      : /^(w|wk|wks|week|weeks)$/.test(unit)
        ? 10_080
        : /^(mo|month|months)$/.test(unit)
          ? 43_200
          : 1_440;
  return Math.max(0, Math.floor(amount * minutesPerUnit));
}

function requestedAdminId(req: Request, res: Response): number | null {
  const requested = req.query.adminId ?? req.query.ispId ?? req.body?.adminId;
  const adminId = authenticatedAdminId(req, requested);
  if (adminId <= 0) {
    res.status(403).json({ error: "This account cannot access another account's vouchers." });
    return null;
  }
  return adminId;
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map(value => encodeURIComponent(value)).join(",")})`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function voucherCode(prefix: string): string {
  const bytes = randomBytes(8);
  const suffix = Array.from(bytes, byte => CODE_ALPHABET[byte & 31]).join("");
  const formatted = `${suffix.slice(0, 4)}-${suffix.slice(4)}`;
  return prefix ? `${prefix}-${formatted}` : formatted;
}

async function generateUniqueCodes(prefix: string, quantity: number): Promise<string[]> {
  const selected = new Set<string>();
  for (let attempt = 0; attempt < 8 && selected.size < quantity; attempt += 1) {
    const candidates = new Set<string>();
    const targetCandidateCount = Math.min(
      QUERY_BATCH_SIZE,
      (quantity - selected.size) * 2,
    );
    while (candidates.size < targetCandidateCount) {
      candidates.add(voucherCode(prefix));
    }

    const candidateList = [...candidates];
    const [owned, radius] = await Promise.all([
      sbSelectStrict<{ code: string }>(
        "isp_radius_vouchers",
        `${inFilter("code", candidateList)}&select=code&limit=${candidateList.length}`,
      ),
      sbSelectStrict<{ username: string }>(
        "radcheck",
        `${inFilter("username", candidateList)}&select=username&limit=${candidateList.length}`,
      ),
    ]);
    const occupied = new Set([
      ...owned.map(row => row.code),
      ...radius.map(row => row.username),
    ]);
    for (const code of candidateList) {
      if (!occupied.has(code)) selected.add(code);
      if (selected.size === quantity) break;
    }
  }

  if (selected.size !== quantity) {
    throw new Error("Could not generate a unique voucher code batch. Please retry.");
  }
  return [...selected];
}

async function cleanupVoucherRows(adminId: number, codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const usernames = inFilter("username", codes);
  const owners = `admin_id=eq.${adminId}&${inFilter("code", codes)}`;
  const outcomes = await Promise.allSettled([
    sbDeleteStrict("radcheck", usernames),
    sbDeleteStrict("radusergroup", usernames),
    sbDeleteStrict("isp_radius_vouchers", owners),
  ]);
  if (outcomes.some(result => result.status === "rejected")) {
    throw new Error("Voucher cleanup was incomplete; check the voucher records before retrying.");
  }
}

router.get("/vouchers/hotspot/config", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  try {
    const [plans, routers, admins] = await Promise.all([
      sbSelectStrict<HotspotPlan>(
        "isp_plans",
        `admin_id=eq.${adminId}&type=eq.hotspot&port_id=is.null&select=id,name,type,price,validity,validity_unit,speed_down,speed_up,data_limit_mb,data_cap_mode,router_id&order=price.asc`,
      ),
      sbSelectStrict<HotspotRouter>(
        "isp_routers",
        `admin_id=eq.${adminId}&status=not.in.(setup,awaiting_ports,awaiting_sync,awaiting_connection)&select=id,name,host,status&order=name.asc`,
      ),
      sbSelectStrict<{ name: string }>(
        "isp_admins",
        `id=eq.${adminId}&select=name&limit=1`,
      ),
    ]);
    res.json({
      plans: plans.map(plan => ({
        ...plan,
        id: Number(plan.id),
        price: Number(plan.price),
        validity: Number(plan.validity),
        speed_down: Number(plan.speed_down),
        speed_up: Number(plan.speed_up),
        data_limit_mb: plan.data_limit_mb == null || Number(plan.data_limit_mb) <= 0
          ? null
          : Number(plan.data_limit_mb),
        data_cap_mode: plan.data_cap_mode === "throttle" ? "throttle" : "disconnect",
        router_id: plan.router_id == null ? null : Number(plan.router_id),
      })),
      routers: routers.map(item => ({ ...item, id: Number(item.id) })),
      companyName: admins[0]?.name ?? "ISP",
    });
  } catch {
    res.status(500).json({ error: "Voucher settings could not be loaded." });
  }
});

router.get("/vouchers/hotspot", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  try {
    const vouchers = await sbSelectStrict<StoredVoucher>(
      "isp_radius_vouchers",
      `admin_id=eq.${adminId}&select=id,admin_id,code,plan_id,plan_name,router_id,router_name,price,validity_mins,data_limit_mb,data_cap_mode,expires_at,created_at,redeemed_at,redeemed_by_phone&order=created_at.desc&limit=10000`
    );
    const usernames = vouchers.map(voucher => voucher.code);
    const accountRows: (HotspotVoucherSession & { username: string })[] = [];
    for (const batch of chunks(usernames, QUERY_BATCH_SIZE)) {
      accountRows.push(...await sbSelectStrict<HotspotVoucherSession & { username: string }>(
        "radacct",
        `${inFilter("username", batch)}&select=username,acctstarttime,acctstoptime,callingstationid,framedipaddress,acctinputoctets,acctoutputoctets,acctinputgigawords,acctoutputgigawords&order=acctstarttime.asc&limit=10000`,
      ));
    }
    const sessionsByCode = new Map<string, HotspotVoucherSession[]>();
    for (const row of accountRows) {
      const key = String(row.username ?? "").toLowerCase();
      const sessions = sessionsByCode.get(key) ?? [];
      sessions.push(row);
      sessionsByCode.set(key, sessions);
    }
    const now = Date.now();
    res.json(vouchers.map(voucher => {
      const dataLimitMb = voucher.data_limit_mb == null || Number(voucher.data_limit_mb) <= 0
        ? null
        : Number(voucher.data_limit_mb);
      const summary = summarizeHotspotVoucherStatus({
        sessions: sessionsByCode.get(voucher.code.toLowerCase()) ?? [],
        validityMins: Number(voucher.validity_mins) || 0,
        redeemBy: voucher.expires_at,
        redeemedAt: voucher.redeemed_at,
        redeemedBy: voucher.redeemed_by_phone,
        dataLimitMb,
        dataCapMode: voucher.data_cap_mode,
        now,
      });
      return {
        code: voucher.code,
        plan_name: voucher.plan_name,
        router_id: voucher.router_id == null ? null : Number(voucher.router_id),
        router_name: voucher.router_name,
        price: Number(voucher.price),
        validity_mins: Number(voucher.validity_mins),
        expiry: summary.expiry,
        expiry_kind: summary.expiryKind,
        used: summary.used,
        redeemed_at: summary.redeemedAt,
        redeemed_by: summary.redeemedBy,
        online: summary.online,
        service_status: summary.serviceStatus,
        data_limit_mb: dataLimitMb,
        data_cap_mode: voucher.data_cap_mode === "throttle" ? "throttle" : "disconnect",
        data_limit_bytes: summary.dataLimitBytes,
        data_used_bytes: summary.dataUsedBytes,
        created_at: voucher.created_at,
      };
    }));
  } catch (err) {
    logger.error({ err, adminId }, "[hotspot-vouchers] list request failed");
    res.status(500).json({ error: "Vouchers could not be loaded for this account." });
  }
});

router.post("/vouchers/hotspot/generate", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  const quantity = Number(req.body?.quantity);
  const planId = Number(req.body?.planId);
  const routerValue = req.body?.routerId;
  const routerId = routerValue === null || routerValue === undefined || routerValue === "all"
    ? null
    : Number(routerValue);
  const rawPrefix = typeof req.body?.prefix === "string" ? req.body.prefix.trim().toUpperCase() : "";
  const prefix = rawPrefix.replace(/-+$/g, "");
  const fixedCodeInput = typeof req.body?.fixedCode === "string" ? req.body.fixedCode.trim() : "";
  const rawFixedCode = fixedCodeInput ? normalizeFixedHotspotVoucherCode(fixedCodeInput) : null;
  const rawExpiry = req.body?.expiryDate;
  const expiryDate = rawExpiry == null || rawExpiry === "" ? null : String(rawExpiry);

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_VOUCHERS_PER_REQUEST) {
    res.status(400).json({ error: `quantity must be between 1 and ${MAX_VOUCHERS_PER_REQUEST}` });
    return;
  }
  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "A valid hotspot plan is required." });
    return;
  }
  if (routerId !== null && (!Number.isSafeInteger(routerId) || routerId <= 0)) {
    res.status(400).json({ error: "Choose a valid router." });
    return;
  }
  if (prefix.length > 12 || !/^[A-Z0-9-]*$/.test(prefix) || prefix.startsWith("-")) {
    res.status(400).json({ error: "Voucher prefix may contain up to 12 letters, numbers, or hyphens." });
    return;
  }
  if (fixedCodeInput && !rawFixedCode) {
    res.status(400).json({ error: "A fixed voucher code must contain 3–32 letters or numbers with no spaces." });
    return;
  }
  if (rawFixedCode && quantity !== 1) {
    res.status(400).json({ error: "A fixed voucher code can only be created once. Set quantity to 1." });
    return;
  }
  if (expiryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    res.status(400).json({ error: "expiryDate must be a calendar date in YYYY-MM-DD format." });
    return;
  }
  if (expiryDate !== null && Number.isNaN(Date.parse(`${expiryDate}T00:00:00.000Z`))) {
    res.status(400).json({ error: "expiryDate is not a valid calendar date." });
    return;
  }

  try {
    const [plans, selectedRouters] = await Promise.all([
      sbSelectStrict<HotspotPlan>(
        "isp_plans",
        `id=eq.${planId}&admin_id=eq.${adminId}&type=eq.hotspot&port_id=is.null&select=id,name,type,price,validity,validity_unit,speed_down,speed_up,data_limit_mb,data_cap_mode,router_id&limit=1`,
      ),
      routerId === null
        ? Promise.resolve([] as HotspotRouter[])
        : sbSelectStrict<HotspotRouter>(
            "isp_routers",
            `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,host,status&limit=1`,
          ),
    ]);
    const plan = plans[0];
    const selectedRouter = selectedRouters[0] ?? null;
    if (!plan || (routerId !== null && !selectedRouter)) {
      res.status(404).json({ error: "The selected plan or router is not available to this account." });
      return;
    }

    let codes: string[];
    if (rawFixedCode) {
      const [existingVoucher, existingRadiusUser] = await Promise.all([
        sbSelectStrict<{ id: number }>(
          "isp_radius_vouchers",
          `code=ilike.${encodeURIComponent(rawFixedCode)}&select=id&limit=1`,
        ),
        sbSelectStrict<{ username: string }>(
          "radcheck",
          `username=eq.${encodeURIComponent(rawFixedCode)}&select=username&limit=1`,
        ),
      ]);
      if (existingVoucher.length || existingRadiusUser.length) {
        res.status(409).json({ error: "That voucher code already exists. Choose a different code." });
        return;
      }
      codes = [rawFixedCode];
    } else {
      codes = await generateUniqueCodes(prefix, quantity);
    }
    const now = new Date().toISOString();
    const validityMins = planValidityMinutes(plan);
    const parsedDataLimitMb = Number(plan.data_limit_mb);
    const dataLimitMb = Number.isFinite(parsedDataLimitMb) && parsedDataLimitMb > 0
      ? parsedDataLimitMb
      : null;
    const dataCapMode = dataLimitMb !== null && plan.data_cap_mode === "throttle"
      ? "throttle"
      : "disconnect";
    const expiresAt = expiryDate ? `${expiryDate}T00:00:00.000Z` : null;
    const rows: Record<string, unknown>[] = codes.map(code => ({
      admin_id: adminId,
      code,
      plan_id: plan.id,
      plan_name: plan.name,
      router_id: selectedRouter?.id ?? null,
      router_name: selectedRouter?.name ?? "Any",
      price: Number(plan.price) || 0,
      validity_mins: validityMins,
      data_limit_mb: dataLimitMb,
      data_cap_mode: dataCapMode,
      expires_at: expiresAt,
      created_at: now,
    }));
    const checks: Record<string, unknown>[] = [];
    const groups = codes.map(code => ({ username: code, groupname: plan.name, priority: 1 }));
    for (const code of codes) {
      checks.push(
        { username: code, attribute: "Cleartext-Password", op: ":=", value: code },
        { username: code, attribute: "Isp-Price", op: ":=", value: String(Number(plan.price) || 0) },
        { username: code, attribute: "Isp-Router-Id", op: ":=", value: selectedRouter ? String(selectedRouter.id) : "0" },
        { username: code, attribute: "Isp-Router-Name", op: ":=", value: selectedRouter?.name ?? "Any" },
        { username: code, attribute: "Isp-Plan-Name", op: ":=", value: plan.name },
        { username: code, attribute: "Isp-Validity-Mins", op: ":=", value: String(validityMins) },
        { username: code, attribute: "Isp-Created-At", op: ":=", value: now },
      );
      if (dataLimitMb !== null && dataCapMode === "disconnect") {
        checks.push({
          username: code,
          attribute: "Max-Data",
          op: ":=",
          value: String(Math.floor(dataLimitMb * 1_000_000)),
        });
      }
      if (expiryDate) checks.push({ username: code, attribute: "Expiration", op: ":=", value: expiryDate });
    }

    try {
      await sbInsertStrict("radcheck", checks);
      await sbInsertStrict("radusergroup", groups);
      await sbInsertStrict("isp_radius_vouchers", rows);
    } catch (error) {
      try {
        await cleanupVoucherRows(adminId, codes);
      } catch {
        res.status(500).json({ error: "Voucher generation failed and cleanup was incomplete. Review the affected codes before retrying." });
        return;
      }
      throw error;
    }

    res.status(201).json({ created: codes.length, codes });
  } catch {
    res.status(500).json({ error: "Vouchers could not be generated for this account." });
  }
});

async function deleteOwnedVouchers(adminId: number, requestedCodes: unknown): Promise<number> {
  if (!Array.isArray(requestedCodes) || requestedCodes.length < 1 || requestedCodes.length > MAX_VOUCHERS_PER_REQUEST) {
    throw new Error(`codes must contain between 1 and ${MAX_VOUCHERS_PER_REQUEST} voucher codes.`);
  }
  const codes = [...new Set(requestedCodes.map(code => String(code).trim().toUpperCase()))];
  if (codes.some(code => !/^[A-Z0-9-]{1,32}$/.test(code))) {
    throw new Error("One or more voucher codes are invalid.");
  }

  const owned = await sbSelectStrict<{ code: string }>(
    "isp_radius_vouchers",
    `admin_id=eq.${adminId}&${inFilter("code", codes)}&select=code`,
  );
  const ownedCodes = owned.map(row => row.code);
  if (ownedCodes.length === 0) return 0;

  for (const batch of chunks(ownedCodes, QUERY_BATCH_SIZE)) {
    const sessions = await sbSelectStrict<{ username: string }>(
      "radacct",
      `${inFilter("username", batch)}&select=username&limit=1`,
    );
    if (sessions.length > 0) throw new RedeemedVoucherMutationError();
  }

  await sbDeleteStrict("radcheck", inFilter("username", ownedCodes));
  await sbDeleteStrict("radusergroup", inFilter("username", ownedCodes));
  await sbDeleteStrict(
    "isp_radius_vouchers",
    `admin_id=eq.${adminId}&${inFilter("code", ownedCodes)}`,
  );
  return ownedCodes.length;
}

router.post("/vouchers/hotspot/delete", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  try {
    const deleted = await deleteOwnedVouchers(adminId, req.body?.codes);
    res.json({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vouchers could not be deleted.";
    const status = error instanceof RedeemedVoucherMutationError
      ? 409
      : message.startsWith("codes ") || message.startsWith("One or more")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

router.delete("/vouchers/hotspot/:code", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  try {
    const deleted = await deleteOwnedVouchers(adminId, [req.params.code]);
    if (deleted === 0) {
      res.status(404).json({ error: "Voucher not found for this account." });
      return;
    }
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof RedeemedVoucherMutationError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Voucher could not be deleted." });
  }
});

export default router;