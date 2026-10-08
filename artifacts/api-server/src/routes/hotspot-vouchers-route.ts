import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbRpc,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import {
  fetchHotspotUserList,
  removeHotspotUser,
  removeHotspotUsersById,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import {
  findManagedVoucherCopies,
  findUnmatchedManagedVoucherUsers,
  isManagedLegacyVoucherComment,
  MANAGED_LEGACY_VOUCHER_COMMENT_MARKER,
} from "../lib/hotspot-voucher-cleanup.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import {
  normalizeFixedHotspotVoucherCode,
  normalizeKenyanVoucherPhone,
} from "../lib/hotspot-voucher-utils.js";
import {
  formatVoucherExpiryInEastAfrica,
  voucherExpiryFromEastAfricaDate,
} from "../lib/hotspot-voucher-redemption.js";
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
  bridge_ip?: string | null;
  vpn_ip?: string | null;
  router_username?: string | null;
  router_secret?: string | null;
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
  service_expires_at?: string | null;
  created_at: string;
  redeemed_at: string | null;
  redeemed_by_phone: string | null;
  redeemed_mac_address?: string | null;
  prepaid_customer_id?: number | string | null;
  max_redemptions?: number | string | null;
}

interface VoucherRedemptionRow {
  id: number | string;
  admin_id: number | string;
  voucher_id: number | string;
  identity_key: string;
  prepaid_customer_id: number | string | null;
  redeemed_by_phone: string | null;
  redeemed_mac_address: string | null;
  redeemed_at: string;
  service_expires_at: string | null;
}

function isMissingRadacctStartTime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("42703")
    && normalized.includes("acctstarttime")
    && normalized.includes("does not exist");
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

function normalizeMacAddress(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  return normalized.length === 12 ? normalized : null;
}

function voucherRouterCredentials(router: HotspotRouter): RouterCredentials {
  const isManagementVpnIp = (value: unknown): boolean =>
    /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(String(value ?? "").trim());
  const storedManagementIp = [router.vpn_ip, router.bridge_ip].find(isManagementVpnIp)?.trim() ?? "";
  const clients = readVpnClients();
  const discoveredCandidate = vpnIpFor(router.host ?? "", clients)
    ?? vpnIpFor(router.name ?? "", clients)
    ?? "";
  const discoveredManagementIp = isManagementVpnIp(discoveredCandidate)
    ? discoveredCandidate.trim()
    : "";
  const managementIp = discoveredManagementIp || storedManagementIp;
  const host = String(router.host ?? "").trim() || managementIp;
  const username = managementIp
    ? (String(router.router_username ?? "").trim() || ROUTER_MANAGEMENT_API_USERNAME)
    : (String(router.router_username ?? "").trim() || "admin");
  return {
    host,
    port: 8728,
    username,
    password: String(router.router_secret ?? ""),
    useSSL: false,
    alternateUsernames: managementIp && username !== ROUTER_MANAGEMENT_API_USERNAME
      ? [ROUTER_MANAGEMENT_API_USERNAME]
      : undefined,
    bridgeIp: managementIp && managementIp !== host ? managementIp : undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

async function loadSessionsForUsernames(
  usernames: string[],
): Promise<(HotspotVoucherSession & { username: string })[]> {
  const uniqueUsernames = [...new Set(usernames.map(username => username.trim()).filter(Boolean))];
  const rows: (HotspotVoucherSession & { username: string })[] = [];
  for (const batch of chunks(uniqueUsernames, QUERY_BATCH_SIZE)) {
    try {
      rows.push(...await sbSelectStrict<HotspotVoucherSession & { username: string }>(
        "radacct",
        `${inFilter("username", batch)}&select=username,acctstarttime,acctstoptime,callingstationid,framedipaddress,acctinputoctets,acctoutputoctets,acctinputgigawords,acctoutputgigawords&order=acctstarttime.asc&limit=10000`,
      ));
    } catch (error) {
      if (!isMissingRadacctStartTime(error)) throw error;
      rows.push(...await sbSelectStrict<HotspotVoucherSession & { username: string }>(
        "radacct",
        `${inFilter("username", batch)}&select=username,acctstoptime,callingstationid,framedipaddress,acctinputoctets,acctoutputoctets,acctinputgigawords,acctoutputgigawords&limit=10000`,
      ));
    }
  }
  return rows;
}

async function syncVoucherDataLimit(
  code: string,
  dataLimitMb: number | null,
  dataCapMode: "disconnect" | "throttle",
): Promise<void> {
  const username = `username=eq.${encodeURIComponent(code)}`;
  await sbDeleteStrict("radcheck", `${username}&attribute=eq.Max-Data`);
  if (dataLimitMb !== null && dataCapMode === "disconnect") {
    await sbInsertStrict("radcheck", [{
      username: code,
      attribute: "Max-Data",
      op: ":=",
      value: String(Math.floor(dataLimitMb * 1_000_000)),
    }]);
  }
}

async function syncVoucherExpiryAttributes(
  code: string,
  expiry: string | null,
  isServiceExpiry: boolean,
): Promise<void> {
  const username = `username=eq.${encodeURIComponent(code)}`;
  for (const attribute of ["Max-All-Session", "Expiration", "WISPr-Session-Terminate-Time"]) {
    await sbDeleteStrict("radcheck", `${username}&attribute=eq.${encodeURIComponent(attribute)}`);
  }
  if (!expiry) return;

  const expiryDate = new Date(expiry);
  const expiryMs = expiryDate.getTime();
  if (!Number.isFinite(expiryMs)) return;
  if (isServiceExpiry) {
    await sbInsertStrict("radcheck", [{
      username: code,
      attribute: "Max-All-Session",
      op: ":=",
      value: String(Math.max(1, Math.floor((expiryMs - Date.now()) / 1000))),
    }]);
  }
  if (isServiceExpiry) {
    const utcDate = expiryDate.toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const utcTime = expiryDate.toISOString().slice(11, 19);
    await sbInsertStrict("radcheck", [{
      username: code,
      attribute: "Expiration",
      op: ":=",
      value: `${utcDate} ${utcTime}`,
    }]);
    const isoTerminate = expiryDate.toISOString().replace(/\.\d+Z$/, "+00:00");
    await sbInsertStrict("radcheck", [{
      username: code,
      attribute: "WISPr-Session-Terminate-Time",
      op: ":=",
      value: `${isoTerminate.slice(0, 10)}T${isoTerminate.slice(11, 19)}+00:00`,
    }]);
  } else {
    await sbInsertStrict("radcheck", [{
      username: code,
      attribute: "Expiration",
      op: ":=",
      value: expiryDate.toISOString().slice(0, 10),
    }]);
  }
}

async function syncVoucherRadiusEntitlements(
  code: string,
  dataLimitMb: number | null,
  dataCapMode: "disconnect" | "throttle",
): Promise<void> {
  await syncVoucherDataLimit(code, dataLimitMb, dataCapMode);
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
      `admin_id=eq.${adminId}&select=id,admin_id,code,plan_id,plan_name,router_id,router_name,price,validity_mins,data_limit_mb,data_cap_mode,max_redemptions,expires_at,service_expires_at,prepaid_customer_id,created_at,redeemed_at,redeemed_by_phone,redeemed_mac_address&order=created_at.desc&limit=10000`,
    );
    const voucherIds = vouchers.map(voucher => String(voucher.id));
    const redemptions: VoucherRedemptionRow[] = [];
    for (const batch of chunks(voucherIds, QUERY_BATCH_SIZE)) {
      redemptions.push(...await sbSelectStrict<VoucherRedemptionRow>(
        "isp_radius_voucher_redemptions",
        `admin_id=eq.${adminId}&${inFilter("voucher_id", batch)}&select=id,admin_id,voucher_id,identity_key,prepaid_customer_id,redeemed_by_phone,redeemed_mac_address,redeemed_at,service_expires_at&order=redeemed_at.asc&limit=10000`,
      ));
    }
    const redemptionsByVoucher = new Map<number, VoucherRedemptionRow[]>();
    for (const redemption of redemptions) {
      const voucherId = Number(redemption.voucher_id);
      const list = redemptionsByVoucher.get(voucherId) ?? [];
      list.push(redemption);
      redemptionsByVoucher.set(voucherId, list);
    }
    const linkedCustomerIds = [...new Set([
      ...vouchers.map(voucher => Number(voucher.prepaid_customer_id)),
      ...redemptions.map(redemption => Number(redemption.prepaid_customer_id)),
    ].filter(id => Number.isSafeInteger(id) && id > 0))].map(String);
    const linkedCustomers: { id: number; username: string | null }[] = [];
    for (const batch of chunks(linkedCustomerIds, QUERY_BATCH_SIZE)) {
      linkedCustomers.push(...await sbSelectStrict<{ id: number; username: string | null }>(
        "isp_customers",
        `${inFilter("id", batch)}&select=id,username&limit=${batch.length}`,
      ));
    }
    const usernameByCustomerId = new Map(
      linkedCustomers.map(customer => [Number(customer.id), String(customer.username ?? "").trim()]),
    );
    const usernames = [...new Set([
      ...vouchers.map(voucher => voucher.code),
      ...linkedCustomers.map(customer => String(customer.username ?? "")),
    ].map(username => username.trim()).filter(Boolean))];
    const accountRows = await loadSessionsForUsernames(usernames);
    const sessionsByUsername = new Map<string, HotspotVoucherSession[]>();
    for (const row of accountRows) {
      const key = String(row.username ?? "").toLowerCase();
      const sessions = sessionsByUsername.get(key) ?? [];
      sessions.push(row);
      sessionsByUsername.set(key, sessions);
    }
    const now = Date.now();
    res.json(vouchers.map(voucher => {
      const dataLimitMb = voucher.data_limit_mb == null || Number(voucher.data_limit_mb) <= 0
        ? null
        : Number(voucher.data_limit_mb);
      const voucherRedemptions = redemptionsByVoucher.get(Number(voucher.id)) ?? [];
      const accounts = voucherRedemptions.map(redemption => {
        const customerId = Number(redemption.prepaid_customer_id);
        const username = usernameByCustomerId.get(customerId) ?? "";
        const sessions = username
          ? sessionsByUsername.get(username.toLowerCase()) ?? []
          : [];
        const accountStatus = summarizeHotspotVoucherStatus({
          sessions,
          validityMins: Number(voucher.validity_mins) || 0,
          redeemBy: null,
          redeemedAt: redemption.redeemed_at,
          redeemedBy: redemption.redeemed_by_phone,
          serviceExpiresAt: redemption.service_expires_at,
          dataLimitMb,
          dataCapMode: voucher.data_cap_mode,
          now,
        });
        return {
          customer_id: Number.isSafeInteger(customerId) && customerId > 0 ? customerId : null,
          username,
          phone: redemption.redeemed_by_phone,
          redeemed_at: redemption.redeemed_at,
          service_expires_at: redemption.service_expires_at,
          online: accountStatus.online,
          service_status: accountStatus.serviceStatus,
          data_used_bytes: accountStatus.dataUsedBytes,
        };
      });
      const usedCount = Math.max(
        voucherRedemptions.length,
        voucher.redeemed_at && voucherRedemptions.length === 0 ? 1 : 0,
      );
      const maxRedemptions = Math.min(500, Math.max(1, Number(voucher.max_redemptions) || 1));
      const legacyUsername = usernameByCustomerId.get(Number(voucher.prepaid_customer_id)) ?? "";
      const legacySessions = legacyUsername
        ? sessionsByUsername.get(legacyUsername.toLowerCase()) ?? []
        : sessionsByUsername.get(voucher.code.toLowerCase()) ?? [];
      const legacySummary = summarizeHotspotVoucherStatus({
        sessions: legacySessions,
        validityMins: Number(voucher.validity_mins) || 0,
        redeemBy: null,
        redeemedAt: voucher.redeemed_at,
        redeemedBy: voucher.redeemed_by_phone,
        serviceExpiresAt: voucher.service_expires_at,
        dataLimitMb,
        dataCapMode: voucher.data_cap_mode,
        now,
      });
      const accountRowsForStatus = accounts.length > 0
        ? accounts
        : usedCount > 0
          ? [{
            customer_id: Number(voucher.prepaid_customer_id) > 0 ? Number(voucher.prepaid_customer_id) : null,
            username: legacyUsername,
            phone: voucher.redeemed_by_phone,
            redeemed_at: voucher.redeemed_at ?? "",
            service_expires_at: voucher.service_expires_at,
            online: legacySummary.online,
            service_status: legacySummary.serviceStatus,
            data_used_bytes: legacySummary.dataUsedBytes,
          }]
          : [];
      const online = accountRowsForStatus.some(account => account.online);
      const anyAccountStillEntitled = accountRowsForStatus.some(account =>
        account.service_status !== "expired"
        && (!account.service_expires_at || Date.parse(account.service_expires_at) > now),
      );
      const redeemByHasPassed = voucher.expires_at != null && Date.parse(voucher.expires_at) <= now;
      const redemptionStatus: "available" | "partially_redeemed" | "redeemed" | "expired" =
        usedCount >= maxRedemptions
          ? "redeemed"
          : redeemByHasPassed
            ? "expired"
            : usedCount > 0
              ? "partially_redeemed"
              : "available";
      const serviceStatus: "available" | "expired" | "active" | "inactive" | "unknown" = online
        ? "active"
        : anyAccountStillEntitled
          ? "inactive"
          : redemptionStatus === "available" || redemptionStatus === "partially_redeemed"
            ? "available"
            : "expired";
      const dataUsedBytes = accounts.reduce((total, account) => total + account.data_used_bytes, 0)
        || (accounts.length === 0 ? legacySummary.dataUsedBytes : 0);
      const firstRedemption = voucherRedemptions[0];
      const deadlineSummary = summarizeHotspotVoucherStatus({
        sessions: [],
        validityMins: Number(voucher.validity_mins) || 0,
        redeemBy: voucher.expires_at,
        redeemedAt: null,
        redeemedBy: null,
        serviceExpiresAt: null,
        dataLimitMb: null,
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
        expiry: deadlineSummary.expiry,
        expiry_kind: "redeem_by",
        service_expires_at: firstRedemption?.service_expires_at ?? voucher.service_expires_at ?? null,
        used: usedCount > 0,
        redemption_status: redemptionStatus,
        redemptions_used: usedCount,
        max_redemptions: maxRedemptions,
        remaining_redemptions: Math.max(0, maxRedemptions - usedCount),
        redemption_accounts: accountRowsForStatus,
        redeemed_at: firstRedemption?.redeemed_at ?? voucher.redeemed_at,
        redeemed_by: firstRedemption?.redeemed_by_phone ?? voucher.redeemed_by_phone,
        online,
        service_status: serviceStatus,
        data_limit_mb: dataLimitMb,
        data_cap_mode: voucher.data_cap_mode === "throttle" ? "throttle" : "disconnect",
        data_limit_bytes: dataLimitMb === null ? null : Math.floor(dataLimitMb * 1_000_000 * Math.max(usedCount, 1)),
        data_used_bytes: dataUsedBytes,
        created_at: voucher.created_at,
      };
    }));
  } catch (err) {
    logger.error({ err, adminId }, "[hotspot-vouchers] list request failed");
    res.status(500).json({ error: "Vouchers could not be loaded for this account." });
  }
});

router.post("/vouchers/hotspot/cleanup-local-users", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  try {
    const [voucherRows, tenantRouters] = await Promise.all([
      sbSelectStrict<{ code: string }>(
        "isp_radius_vouchers",
        `admin_id=eq.${adminId}&select=code&limit=10000`,
      ),
      sbSelectStrict<HotspotRouter>(
        "isp_routers",
        `admin_id=eq.${adminId}&select=id,name,host,status,bridge_ip,vpn_ip,router_username,router_secret&order=name.asc`,
      ),
    ]);
    const voucherCodes = new Set(voucherRows.map(voucher => String(voucher.code)));

    const routerResults = await Promise.all(tenantRouters.map(async candidateRouter => {
      const resultBase = {
        routerId: Number(candidateRouter.id),
        routerName: String(candidateRouter.name ?? "Router"),
        inspectedUsers: 0,
        matchedVouchers: [] as string[],
        removedUsers: 0,
        unmatchedVoucherCodes: [] as string[],
        failedVoucherCodes: [] as string[],
      };
      let credentials: RouterCredentials;
      let localUsers: Awaited<ReturnType<typeof fetchHotspotUserList>>;
      try {
        credentials = voucherRouterCredentials(candidateRouter);
        if (!credentials.host) {
          return {
            ...resultBase,
            status: "offline" as const,
            error: "No management host is configured; no users were changed.",
          };
        }
        localUsers = await fetchHotspotUserList(credentials);
      } catch (error) {
        logger.warn(
          { routerId: resultBase.routerId, err: error },
          "[hotspot-vouchers] local voucher inventory could not reach router",
        );
        return {
          ...resultBase,
          status: "offline" as const,
          error: "Router could not be reached; no users were changed.",
        };
      }

      const managedUsers = localUsers.filter(user => isManagedLegacyVoucherComment(user.comment));
      const matchedUsers = findManagedVoucherCopies(localUsers, voucherCodes);
      const unmatchedUsers = findUnmatchedManagedVoucherUsers(localUsers, voucherCodes);
      const usersMissingIds = matchedUsers.filter(user => !user.id);
      const removableUsers = matchedUsers.filter(user => Boolean(user.id));
      const failedVoucherCodes = usersMissingIds.map(user => user.name);
      let removedUsers = 0;
      if (removableUsers.length > 0) {
        try {
          await removeHotspotUsersById(credentials, removableUsers.map(user => ({
            id: user.id,
            name: user.name,
            commentMarker: MANAGED_LEGACY_VOUCHER_COMMENT_MARKER,
          })));
          removedUsers = removableUsers.length;
        } catch (error) {
          logger.warn(
            { routerId: resultBase.routerId, err: error, count: removableUsers.length },
            "[hotspot-vouchers] local voucher cleanup failed",
          );
          try {
            const remainingUsers = await fetchHotspotUserList(credentials);
            const remainingIds = new Set(remainingUsers.map(user => user.id).filter(Boolean));
            const confirmedRemovedUsers = removableUsers.filter(user => !remainingIds.has(user.id));
            removedUsers = confirmedRemovedUsers.length;
            failedVoucherCodes.push(...removableUsers
              .filter(user => remainingIds.has(user.id))
              .map(user => user.name));
          } catch {
            failedVoucherCodes.push(...removableUsers.map(user => user.name));
          }
        }
      }
      const failedCodes = [...new Set(failedVoucherCodes)];
      const unmatchedCodes = [...new Set(unmatchedUsers.map(user => user.name))];
      return {
        ...resultBase,
        inspectedUsers: localUsers.length,
        matchedVouchers: [...new Set(matchedUsers.map(user => user.name))],
        removedUsers,
        unmatchedVoucherCodes: unmatchedCodes,
        failedVoucherCodes: failedCodes,
        status: failedCodes.length > 0
          ? "failed" as const
          : removedUsers > 0
            ? "cleaned" as const
            : "no_matches" as const,
        ...(failedCodes.length > 0
          ? { error: "MikroTik did not confirm removal of every matched voucher user." }
          : {}),
        ...(unmatchedCodes.length > 0
          ? { warning: "Tagged router users without a matching voucher record were left untouched." }
          : {}),
        managedUserCount: managedUsers.length,
      };
    }));

    const removedUsers = routerResults.reduce((total, result) => total + result.removedUsers, 0);
    const needsAttention = routerResults.some(result =>
      result.status === "offline"
      || result.status === "failed"
      || result.unmatchedVoucherCodes.length > 0,
    );
    res.json({
      ok: !needsAttention,
      removedUsers,
      routers: routerResults,
    });
  } catch (err) {
    logger.error({ err, adminId }, "[hotspot-vouchers] local voucher cleanup request failed");
    res.status(500).json({ error: "Local voucher copies could not be checked for this account." });
  }
});

router.patch("/vouchers/hotspot/:code", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  const code = String(req.params.code ?? "").trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: "A voucher code is required." });
    return;
  }

  const expiryWasProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "expiryAt");
  const dataLimitWasProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "dataLimitMb");
  const capModeWasProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "dataCapMode");
  if (!expiryWasProvided && !dataLimitWasProvided && !capModeWasProvided) {
    res.status(400).json({ error: "Change an expiry or data allowance before saving." });
    return;
  }

  let expiryValue: string | null | undefined;
  if (expiryWasProvided) {
    const rawExpiry = req.body?.expiryAt;
    if (rawExpiry === null || rawExpiry === "") {
      expiryValue = null;
    } else if (typeof rawExpiry === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)) {
        const eatDate = voucherExpiryFromEastAfricaDate(rawExpiry);
        if (!eatDate) {
          res.status(400).json({ error: "Enter a valid calendar date for the voucher expiry." });
          return;
        }
        expiryValue = eatDate;
      } else if (Number.isFinite(Date.parse(rawExpiry))) {
        expiryValue = new Date(rawExpiry).toISOString();
      } else {
        res.status(400).json({ error: "Enter a valid voucher expiry date and time." });
        return;
      }
    } else {
      res.status(400).json({ error: "Enter a valid voucher expiry date and time." });
      return;
    }
  }

  let requestedDataLimitMb: number | null | undefined;
  if (dataLimitWasProvided) {
    const rawLimit = req.body?.dataLimitMb;
    if (rawLimit === null || rawLimit === "") {
      requestedDataLimitMb = null;
    } else {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000) {
        res.status(400).json({ error: "Enter a data cap greater than 0 MB, or choose unlimited." });
        return;
      }
      requestedDataLimitMb = Math.round(parsed * 100) / 100;
    }
  }
  const requestedCapMode = req.body?.dataCapMode;
  if (capModeWasProvided && requestedCapMode !== "disconnect" && requestedCapMode !== "throttle") {
    res.status(400).json({ error: "Choose disconnect or throttle when the voucher reaches its data cap." });
    return;
  }

  try {
    const voucherRows = await sbSelectStrict<StoredVoucher>(
      "isp_radius_vouchers",
      `admin_id=eq.${adminId}&code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
    );
    const voucher = voucherRows[0];
    if (!voucher) {
      res.status(404).json({ error: "Voucher not found for this account." });
      return;
    }
    const redemptions = await sbSelectStrict<{ id: number | string }>(
      "isp_radius_voucher_redemptions",
      `admin_id=eq.${adminId}&voucher_id=eq.${voucher.id}&select=id&limit=1`,
    );
    const used = voucher.redeemed_at != null || redemptions.length > 0;
    const dataLimitMb = dataLimitWasProvided
      ? requestedDataLimitMb!
      : voucher.data_limit_mb == null || Number(voucher.data_limit_mb) <= 0
        ? null
        : Number(voucher.data_limit_mb);
    const dataCapMode = capModeWasProvided
      ? requestedCapMode as "disconnect" | "throttle"
      : voucher.data_cap_mode === "throttle" ? "throttle" : "disconnect";
    const updates: Record<string, unknown> = {
      data_limit_mb: dataLimitMb,
      data_cap_mode: dataLimitMb === null ? "disconnect" : dataCapMode,
    };
    if (expiryWasProvided) updates.expires_at = expiryValue;

    const [updated] = await sbUpdateStrict<StoredVoucher>(
      "isp_radius_vouchers",
      `admin_id=eq.${adminId}&code=eq.${encodeURIComponent(code)}`,
      updates,
    );
    if (!updated) {
      res.status(404).json({ error: "Voucher not found for this account." });
      return;
    }
    res.json({
      ok: true,
      used,
      voucher: {
        code: updated.code,
        expiry: updated.expires_at,
        expiry_kind: "redeem_by",
        data_limit_mb: dataLimitMb,
        data_cap_mode: dataLimitMb === null ? "disconnect" : dataCapMode,
        note: "Changes apply to future redemptions. Each existing prepaid account keeps its own service expiry and data allowance.",
      },
    });
  } catch (error) {
    logger.error({ err: error, adminId }, "[hotspot-vouchers] update request failed");
    res.status(500).json({ error: "Voucher changes could not be saved." });
  }
});

router.post("/vouchers/hotspot/redeem", async (req, res): Promise<void> => {
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  const normalizedMac = normalizeMacAddress(req.body?.mac_address);
  const contact = normalizeKenyanVoucherPhone(String(req.body?.contact ?? ""));
  const requestedAdminId = Number(req.body?.adminId);
  const portalScope = req.hotspotPortalContext;
  if (!code || !normalizedMac || !contact) {
    res.status(400).json({ error: "Enter a valid Kenyan phone number and voucher code on this device's hotspot sign-in page." });
    return;
  }
  const allowedAdminIds = portalScope
    ? [...new Set([portalScope.adminId, portalScope.resellerId])]
    : Number.isSafeInteger(requestedAdminId) && requestedAdminId > 0 ? [requestedAdminId] : [];
  if (!allowedAdminIds.length) {
    res.status(400).json({ error: "The Hotspot account could not be identified. Reload the ISP portal and try again." });
    return;
  }

  try {
    const voucherRows = await sbSelectStrict<StoredVoucher>(
      "isp_radius_vouchers",
      `${inFilter("admin_id", allowedAdminIds.map(String))}&code=eq.${encodeURIComponent(code)}&select=*&limit=2`,
    );
    const voucher = voucherRows[0];
    if (!voucher || voucherRows.length > 1) {
      res.status(404).json({ error: "Voucher not found. Check the code and try again." });
      return;
    }

    const planRows = voucher.plan_id == null ? [] : await sbSelectStrict<{
      id: number;
      admin_id: number;
      type: string;
      router_id: number | null;
      port_id: number | null;
      owner_reseller_id: number | null;
      name: string;
    }>(
      "isp_plans",
      `id=eq.${voucher.plan_id}&admin_id=eq.${voucher.admin_id}&select=id,admin_id,type,router_id,port_id,owner_reseller_id,name&limit=1`,
    );
    const plan = planRows[0];
    if (!plan || plan.type.toLowerCase() !== "hotspot") {
      res.status(409).json({ error: "This voucher is not linked to an active Hotspot package." });
      return;
    }

    const requestedRouterId = portalScope?.routerId
      ?? (Number.isSafeInteger(Number(req.body?.router_id)) && Number(req.body?.router_id) > 0
        ? Number(req.body.router_id)
        : null);
    const routerId = voucher.router_id ?? plan.router_id ?? requestedRouterId;
    if (
      !routerId
      || (requestedRouterId !== null && routerId !== requestedRouterId)
      || (plan.router_id !== null && plan.router_id !== routerId)
    ) {
      res.status(409).json({ error: "This voucher is not assigned to the Hotspot router for this device." });
      return;
    }
    const routerRows = await sbSelectStrict<HotspotRouter & { admin_id: number }>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${plan.admin_id}&select=id,name,host,status,admin_id,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    if (!routerRows[0]) {
      res.status(409).json({ error: "The voucher's Hotspot router is not available." });
      return;
    }

    let portId = plan.port_id;
    if (portalScope) {
      if (
        portalScope.adminId !== plan.admin_id
        || (plan.owner_reseller_id != null && plan.owner_reseller_id !== portalScope.resellerId)
        || (voucher.router_id != null && voucher.router_id !== portalScope.routerId)
        || (plan.router_id != null && plan.router_id !== portalScope.routerId)
      ) {
        res.status(404).json({ error: "Voucher not found for this Hotspot service." });
        return;
      }
      const servicePorts = await sbSelectStrict<Record<string, unknown>>(
        "isp_reseller_ports",
        `id=eq.${portalScope.portId}&admin_id=eq.${portalScope.adminId}&router_id=eq.${portalScope.routerId}&assigned_reseller_id=eq.${portalScope.resellerId}&handoff_mode=eq.vlan_services&status=eq.active&hotspot_enabled=is.true&select=id&limit=1`,
      );
      if (!servicePorts[0]) {
        res.status(409).json({ error: "The assigned Hotspot service is not active." });
        return;
      }
      if (plan.port_id !== null && plan.port_id !== portalScope.portId) {
        res.status(409).json({ error: "This voucher package is not assigned to this Hotspot service." });
        return;
      }
      portId = portalScope.portId;
    }

    // Remove legacy local voucher users before checking a new claim. Otherwise a
    // RouterOS-local password could bypass this database's expiry/use limits.
    const possibleRouters = voucher.router_id || plan.router_id
      ? routerRows
      : await sbSelectStrict<HotspotRouter>(
          "isp_routers",
          `admin_id=eq.${plan.admin_id}&select=id,name,host,status,bridge_ip,vpn_ip,router_username,router_secret`,
        );
    const localVoucherCleanup = await Promise.allSettled(possibleRouters.map(async candidateRouter => {
      const credentials = voucherRouterCredentials(candidateRouter);
      if (!credentials.host) throw new Error("Router has no management host.");
      const localUsers = await fetchHotspotUserList(credentials);
      const syncedVoucher = localUsers.find(user =>
        user.name === code && isManagedLegacyVoucherComment(user.comment),
      );
      if (syncedVoucher) await removeHotspotUser(credentials, code);
    }));
    if (localVoucherCleanup.some(result => result.status === "rejected")) {
      logger.warn({ code, voucherId: voucher.id }, "[hotspot-vouchers] legacy local voucher cleanup incomplete");
    }

    const dataLimitMb = voucher.data_limit_mb == null || Number(voucher.data_limit_mb) <= 0
      ? null
      : Number(voucher.data_limit_mb);
    const activatedRows = await sbRpc<Record<string, unknown>>("activate_hotspot_voucher", {
      p_admin_id: voucher.admin_id,
      p_code: code,
      p_mac_address: normalizedMac,
      p_contact: contact || null,
      p_router_id: routerId,
      p_port_id: portId,
      p_redeemed_at: null,
    });
    const activated = activatedRows[0];
    if (!activated) {
      throw new Error("The voucher activation did not return an account.");
    }
    const accountAdminId = Number(activated.out_account_admin_id);
    const customerId = Number(activated.out_customer_id);
    if (!Number.isSafeInteger(accountAdminId) || accountAdminId < 1 || !Number.isSafeInteger(customerId) || customerId < 1) {
      throw new Error("The voucher activation returned an invalid prepaid account.");
    }
    const serviceExpiresAt = activated.out_service_expires_at == null
      ? null
      : String(activated.out_service_expires_at);
    const accountRows = await sbSelectStrict<{
      id: number;
      admin_id: number;
      username: string | null;
      password: string | null;
    }>(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${accountAdminId}&select=id,admin_id,username,password&limit=2`,
    );
    const account = accountRows[0];
    const accountUsername = String(account?.username ?? "").trim();
    const accountPassword = String(account?.password ?? "");
    if (accountRows.length !== 1 || !accountUsername || !accountPassword) {
      throw new Error("The voucher prepaid account was saved without usable login credentials.");
    }
    await Promise.all([
      sbDeleteStrict("radcheck", `username=eq.${encodeURIComponent(accountUsername)}&attribute=eq.Cleartext-Password`),
      sbDeleteStrict("radusergroup", `username=eq.${encodeURIComponent(accountUsername)}`),
    ]);
    await Promise.all([
      sbInsertStrict("radcheck", [{
        username: accountUsername,
        attribute: "Cleartext-Password",
        op: ":=",
        value: accountPassword,
      }]),
      sbInsertStrict("radusergroup", [{
        username: accountUsername,
        groupname: String(activated.out_plan_name ?? voucher.plan_name),
        priority: 1,
      }]),
    ]);
    if (accountUsername.toLowerCase() !== code.toLowerCase()) {
      await Promise.all([
        sbDeleteStrict("radcheck", `username=eq.${encodeURIComponent(code)}`),
        sbDeleteStrict("radusergroup", `username=eq.${encodeURIComponent(code)}`),
      ]);
    }
    await syncVoucherRadiusEntitlements(
      accountUsername,
      dataLimitMb,
      dataLimitMb === null ? "disconnect" : voucher.data_cap_mode === "throttle" ? "throttle" : "disconnect",
    );
    await syncVoucherExpiryAttributes(accountUsername, serviceExpiresAt, true);
    const redemptionRows = await sbSelectStrict<{ id: number | string }>(
      "isp_radius_voucher_redemptions",
      `admin_id=eq.${voucher.admin_id}&voucher_id=eq.${voucher.id}&select=id&limit=500`,
    );

    res.json({
      ok: true,
      account_admin_id: accountAdminId,
      customer_id: customerId,
      credentials: { username: accountUsername, password: accountPassword },
      voucher: {
        code,
        plan_name: String(activated.out_plan_name ?? voucher.plan_name),
        validity_mins: Number(activated.out_validity_mins) || 0,
        data_limit_mb: activated.out_data_limit_mb == null ? null : Number(activated.out_data_limit_mb),
        service_expires_at: serviceExpiresAt,
        redemptions_used: redemptionRows.length,
        max_redemptions: Math.max(1, Number(voucher.max_redemptions) || 1),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, adminId: portalScope?.adminId ?? requestedAdminId }, "[hotspot-vouchers] activation failed");
    const normalizedMessage = message.toLowerCase();
    const expiryMarker = message.match(/HOTSPOT_VOUCHER_EXPIRED_AT:([^\s]+)/i)?.[1];
    const serviceExpiryMarker = message.match(/HOTSPOT_VOUCHER_SERVICE_EXPIRED_AT:([^\s]+)/i)?.[1];
    const limitMarker = message.match(/HOTSPOT_VOUCHER_REDEMPTION_LIMIT:(\d+):(\d+)/i);
    if (expiryMarker) {
      res.status(410).json({ error: `This voucher expired at ${formatVoucherExpiryInEastAfrica(expiryMarker)}.` });
    } else if (serviceExpiryMarker) {
      res.status(410).json({ error: `This voucher account expired at ${formatVoucherExpiryInEastAfrica(serviceExpiryMarker)}.` });
    } else if (limitMarker) {
      res.status(409).json({ error: `This voucher has reached its redemption limit (${limitMarker[1]} of ${limitMarker[2]} uses).` });
    } else if (
      normalizedMessage.includes("another device")
      || normalizedMessage.includes("different hotspot account or service")
      || normalizedMessage.includes("already_linked_to_device")
      || normalizedMessage.includes("original voucher start time is unavailable")
    ) {
      res.status(409).json({ error: "This voucher is already linked to another device." });
    } else if (normalizedMessage.includes("expired")) {
      res.status(410).json({ error: "This voucher has expired." });
    } else if (normalizedMessage.includes("voucher not found")) {
      res.status(404).json({ error: "Voucher not found. Check the code and try again." });
    } else {
      res.status(500).json({ error: "Voucher activation could not be completed. Please retry; the same voucher will not create a second account." });
    }
  }
});

router.post("/vouchers/hotspot/generate", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  const quantity = Number(req.body?.quantity);
  const maxRedemptions = Number(req.body?.maxRedemptions ?? 1);
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
  if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 500) {
    res.status(400).json({ error: "Each voucher must allow between 1 and 500 redemptions." });
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
  if (expiryDate !== null && !voucherExpiryFromEastAfricaDate(expiryDate)) {
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
    const expiresAt = expiryDate ? voucherExpiryFromEastAfricaDate(expiryDate) : null;
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
      max_redemptions: maxRedemptions,
      expires_at: expiresAt,
      created_at: now,
    }));

    try {
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

export async function deleteOwnedVouchers(
  adminId: number,
  requestedCodes: unknown,
  dependencies = { select: sbSelectStrict, delete: sbDeleteStrict },
): Promise<number> {
  if (!Array.isArray(requestedCodes) || requestedCodes.length < 1 || requestedCodes.length > MAX_VOUCHERS_PER_REQUEST) {
    throw new Error(`codes must contain between 1 and ${MAX_VOUCHERS_PER_REQUEST} voucher codes.`);
  }
  const codes = [...new Set(requestedCodes.map(code => String(code).trim().toUpperCase()))];
  if (codes.some(code => !/^[A-Z0-9-]{1,32}$/.test(code))) {
    throw new Error("One or more voucher codes are invalid.");
  }

  const owned = await dependencies.select<{ code: string; redeemed_at: string | null }>(
    "isp_radius_vouchers",
    `admin_id=eq.${adminId}&${inFilter("code", codes)}&select=code,redeemed_at`,
  );
  // A claim is already a redemption even before RouterOS/RADIUS reports its
  // first session. Check all owned rows before deleting any access records.
  if (owned.some(row => row.redeemed_at != null)) throw new RedeemedVoucherMutationError();
  const ownedCodes = owned.map(row => row.code);
  if (ownedCodes.length === 0) return 0;

  for (const batch of chunks(ownedCodes, QUERY_BATCH_SIZE)) {
    const sessions = await dependencies.select<{ username: string }>(
      "radacct",
      `${inFilter("username", batch)}&select=username&limit=1`,
    );
    if (sessions.length > 0) throw new RedeemedVoucherMutationError();
  }

  await dependencies.delete("radcheck", inFilter("username", ownedCodes));
  await dependencies.delete("radusergroup", inFilter("username", ownedCodes));
  await dependencies.delete(
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