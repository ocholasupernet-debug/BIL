/**
 * M-Pesa Daraja API routes
 *
 *   GET  /api/mpesa/token     — Generate OAuth access token from Consumer Key + Secret
 *   POST /api/mpesa/stkpush   — Initiate STK Push (shortcode 174379 sandbox default)
 *   POST /api/mpesa/callback  — Receive M-Pesa STK Push result, update wallet + transaction
 *   POST /api/mpesa/stk       — Initiate STK Push (legacy alias)
 *   GET  /api/mpesa/status    — Poll payment status by CheckoutRequestID
 *   POST /api/mpesa/verify    — Verify a manually-pasted M-Pesa confirmation SMS
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { sbDelete, sbInsert, sbInsertStrict, sbRpc, sbSelect, sbSelectStrict, sbUpdate, sbUpdateStrict, supabaseServiceRoleConfigured } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { provisionTenantCertificateForAdmin } from "../lib/tenant-certificate-provisioner.js";
import { getMpesaSettings, isMpesaConfigured, type MpesaSettings } from "../lib/settings-store.js";
import { extractToken, generatePaymentIntent, validatePaymentIntent, validateToken } from "../lib/api-auth.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  addHotspotIpBinding,
  addHotspotUser,
  ensureHotspotUserProfile,
  resolveHotspotClientMac,
  connectHotspotUser,
  scheduleHotspotUserExpiry,
  disconnectHotspotActiveUser,
  removeHotspotUser,
  resetHotspotUserCounters,
  ensureHotspotUserRateQueue,
  updateHotspotUser,
  fetchHotspotConnectedDevices,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import { prepaidHotspotUsername, routerRateLimit } from "../lib/prepaid-identifiers.js";
import { planValiditySeconds } from "../lib/plan-validity.js";
import { paymentCollectionMode, servicePaymentConfigMap, type PaymentService } from "../lib/payment-routing.js";
import { reactivatePppoeAccess } from "../lib/auto-provision.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";
import { normalizePlanServiceType } from "../lib/plan-service-type.js";

const router: IRouter = Router();

const PAYMENT_GATEWAY_LABELS: Record<string, string> = {
  mpesa_paybill: "M-Pesa PayBill",
  mpesa_till_push: "M-Pesa Till Push (Buy Goods & Services)",
  bank_stk_push: "BankStkPush",
  airtel: "AirtelMoney",
  azampay: "AzamPay",
  custom_paybill: "CustomPaybill",
  dpo_payments: "DpoPayments",
  flutterwave: "Flutterwave",
  intasend: "Intasend",
  pesapal: "PesaPal",
  stripe: "Stripe",
  paypal: "PayPal",
  tigopesa: "TigoPesa",
  xendit: "XenditEwallet",
  manual: "Cash / Manual",
};
const PAYMENT_GATEWAY_IDS = new Set(Object.keys(PAYMENT_GATEWAY_LABELS));
type PaymentGateway = string;
const stkRateLimits = new Map<string, { count: number; startedAt: number }>();
const callbackIntakeLimits = new Map<string, { count: number; startedAt: number }>();
const CALLBACK_RECONCILIATION_WINDOW_MS = 10 * 60 * 1000;
const CALLBACK_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
let lastCallbackPurgeAt = 0;

type HotspotRouterRow = {
  id?: number;
  name?: string | null;
  host: string | null;
  bridge_ip: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
};

function isManagementVpnIp(ip: string | null | undefined): boolean {
  return /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[4])$/.test(String(ip ?? "").trim());
}

/**
 * Payment requests run outside the admin router route, so they must apply the
 * same management-VPN preference and OpenVPN status auto-discovery as the
 * normal MikroTik routes. The hotspot gateway (for example 10.254.x.1) is
 * reachable by the customer, but it is never a RouterOS API endpoint.
 */
function hotspotRouterCredentials(row: HotspotRouterRow): RouterCredentials {
  const storedManagementIp = [row.vpn_ip, row.bridge_ip].find(isManagementVpnIp) ?? "";
  let discoveredManagementIp = "";
  if (!storedManagementIp) {
    const vpnClients = readVpnClients();
    discoveredManagementIp =
      vpnIpFor(row.host ?? "", vpnClients) ??
      vpnIpFor(row.name ?? "", vpnClients) ??
      "";
  }
  const managementIp = storedManagementIp || discoveredManagementIp;
  return {
    host: managementIp || row.host?.trim() || "",
    bridgeIp: managementIp && row.host?.trim() !== managementIp ? managementIp : undefined,
    port: 8728,
    username: row.router_username || "admin",
    password: row.router_secret || "",
    alternateUsernames: managementIp && row.router_username !== ROUTER_MANAGEMENT_API_USERNAME
      ? [ROUTER_MANAGEMENT_API_USERNAME]
      : undefined,
    useSSL: false,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

interface BankStkPushConfig {
  bankName: string;
  paybillNumber: string;
  accountNumber: string;
}

interface MpesaTillPushConfig {
  tillNumber: string;
}

interface MpesaPaybillConfig {
  paybillNumber: string;
  accountNumber: string;
}

function getPaymentGateway(value: unknown): PaymentGateway {
  return typeof value === "string" && PAYMENT_GATEWAY_IDS.has(value) ? value : "mpesa_paybill";
}

function bankStkPushConfig(value: unknown): BankStkPushConfig {
  const map = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const config = map.bank_stk_push && typeof map.bank_stk_push === "object" && !Array.isArray(map.bank_stk_push)
    ? map.bank_stk_push as Record<string, unknown>
    : {};
  return {
    bankName: typeof config.bankName === "string" ? config.bankName.trim() : "",
    paybillNumber: typeof config.paybillNumber === "string" ? config.paybillNumber.trim() : "",
    accountNumber: typeof config.accountNumber === "string" ? config.accountNumber.trim() : "",
  };
}

function gatewayConfig(value: unknown, gatewayId: string): Record<string, string> {
  const map = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const config = map[gatewayId] && typeof map[gatewayId] === "object" && !Array.isArray(map[gatewayId])
    ? map[gatewayId] as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(config)
      .filter(([, field]) => typeof field === "string")
      .map(([field, value]) => [field, (value as string).trim()]),
  );
}

function mpesaTillPushConfig(value: unknown): MpesaTillPushConfig {
  return { tillNumber: gatewayConfig(value, "mpesa_till_push").tillNumber ?? "" };
}

function mpesaPaybillConfig(value: unknown): MpesaPaybillConfig {
  const config = gatewayConfig(value, "mpesa_paybill");
  return {
    paybillNumber: config.paybillNumber ?? "",
    accountNumber: config.accountNumber ?? "",
  };
}

function isBankStkPushConfigured(config: BankStkPushConfig): boolean {
  return !!(config.bankName && config.paybillNumber && config.accountNumber);
}

function resolveDarajaPayment(
  paymentGateway: PaymentGateway,
  settings: MpesaSettings,
  bankStkPush: BankStkPushConfig,
  mpesaTillPush: MpesaTillPushConfig,
  mpesaPaybill: MpesaPaybillConfig,
): { businessShortcode: string; destination: string; accountReference?: string } {
  if (paymentGateway === "bank_stk_push") {
    return {
      businessShortcode: settings.shortcode,
      destination: bankStkPush.paybillNumber,
      accountReference: bankStkPush.accountNumber,
    };
  }
  if (paymentGateway === "mpesa_till_push") {
    return { businessShortcode: settings.shortcode, destination: mpesaTillPush.tillNumber };
  }
  if (paymentGateway === "mpesa_paybill") {
    return {
      businessShortcode: settings.shortcode,
      destination: mpesaPaybill.paybillNumber,
      accountReference: mpesaPaybill.accountNumber || undefined,
    };
  }
  return { businessShortcode: settings.shortcode, destination: "" };
}

function paymentGatewayLabel(paymentGateway: PaymentGateway): string {
  return PAYMENT_GATEWAY_LABELS[paymentGateway] ?? paymentGateway;
}

function isDarajaGateway(paymentGateway: PaymentGateway): boolean {
  return paymentGateway === "mpesa_paybill" || paymentGateway === "mpesa_till_push" || paymentGateway === "bank_stk_push";
}

async function getAdminPaymentSettings(adminId: number | undefined, serviceType: PaymentService = "hotspot"): Promise<{
  paymentGateway: PaymentGateway;
  bankStkPush: BankStkPushConfig;
  mpesaTillPush: MpesaTillPushConfig;
  mpesaPaybill: MpesaPaybillConfig;
  paymentCollectionMode: "shared" | "separate";
}> {
  if (!adminId) {
    return {
      paymentGateway: "mpesa_paybill",
      bankStkPush: { bankName: "", paybillNumber: "", accountNumber: "" },
      mpesaTillPush: { tillNumber: "" },
      mpesaPaybill: { paybillNumber: "", accountNumber: "" },
      paymentCollectionMode: "shared",
    };
  }
  const rows = await sbSelect<{
    payment_gateway?: string;
    payment_gateway_config?: unknown;
    payment_collection_mode?: string;
    payment_service_config?: unknown;
  }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway,payment_gateway_config,payment_collection_mode,payment_service_config&limit=1`,
  );
  const mode = paymentCollectionMode(rows[0]?.payment_collection_mode);
  const service = servicePaymentConfigMap(rows[0]?.payment_service_config)[serviceType];
  const config = mode === "separate" && service
    ? { [service.gatewayId]: service.config }
    : rows[0]?.payment_gateway_config;
  const paymentGateway = mode === "separate"
    ? (service?.gatewayId ?? "unconfigured")
    : getPaymentGateway(rows[0]?.payment_gateway);
  return {
    paymentGateway,
    bankStkPush: bankStkPushConfig(config),
    mpesaTillPush: mpesaTillPushConfig(config),
    mpesaPaybill: mpesaPaybillConfig(config),
    paymentCollectionMode: mode,
  };
}

async function isActiveIspAdmin(adminId: number): Promise<boolean> {
  const rows = await sbSelect<{ id: number }>(
    "isp_admins",
    `id=eq.${adminId}&is_active=is.true&select=id&limit=1`,
  );
  return !!rows[0];
}

async function resolvePortalAdminId(req: Request, requestedAdminId: unknown): Promise<number | null> {
  const explicitId = Number(requestedAdminId);
  if (Number.isSafeInteger(explicitId) && explicitId > 0) return explicitId;

  const subdomain = getTenantSubdomainFromRequest(req);
  if (!subdomain) return null;
  const admins = await sbSelect<{ id: number }>(
    "isp_admins",
    `subdomain=eq.${encodeURIComponent(subdomain)}&is_active=is.true&select=id&limit=1`,
  );
  return admins[0]?.id && Number.isSafeInteger(admins[0].id) ? admins[0].id : null;
}

function normaliseKenyanPhone(value: string): string {
  const raw = value.replace(/\D/g, "");
  if (raw.startsWith("0")) return `254${raw.slice(1)}`;
  return raw.startsWith("254") ? raw : `254${raw}`;
}

function normaliseMacAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) && !/^[0-9a-f]{12}$/i.test(trimmed)) return "";
  const compact = trimmed.replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(compact)) return "";
  return compact.toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

function readMacAddress(value: unknown): { value: string; invalid: boolean } {
  if (typeof value !== "string" || !value.trim()) return { value: "", invalid: false };
  const normalized = normaliseMacAddress(value);
  return { value: normalized, invalid: !normalized };
}

function readClientIp(value: unknown): string {
  if (typeof value !== "string") return "";
  const ip = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return "";
  const octets = ip.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? ip : "";
}

function readDeviceName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 64)
    : "";
}

function hotspotRateLimit(
  speedDown: unknown,
  speedUp: unknown,
  speedDownUnit: unknown = "Mbps",
  speedUpUnit: unknown = speedDownUnit,
): string | undefined {
  return routerRateLimit(speedDown, speedUp, speedDownUnit, speedUpUnit);
}

function extractMpesaReceipt(message: unknown): string {
  if (typeof message !== "string") return "";
  const text = message.trim();
  const match = text.match(/\b([A-Z][A-Z0-9]{8,11})\s+Confirmed\b/i)
    ?? text.match(/\b(?:transaction|receipt|code)\s*(?:number|id|no\.?)?\s*[:#-]?\s*([A-Z][A-Z0-9]{8,11})\b/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function allowStkRequest(req: Request, adminId: number, phone: string): boolean {
  const key = `${req.ip}:${adminId}:${phone}`;
  const now = Date.now();
  const existing = stkRateLimits.get(key);
  if (!existing || now - existing.startedAt > 15 * 60 * 1000) {
    stkRateLimits.set(key, { count: 1, startedAt: now });
    return true;
  }
  if (existing.count >= 5) return false;
  existing.count += 1;
  return true;
}

function allowCallbackIntake(req: Request): boolean {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const existing = callbackIntakeLimits.get(key);
  if (!existing || now - existing.startedAt > 60 * 1000) {
    callbackIntakeLimits.set(key, { count: 1, startedAt: now });
    return true;
  }
  if (existing.count >= 60) return false;
  existing.count += 1;
  return true;
}

/* ── Daraja helpers ───────────────────────────────────────────────────────── */

function darajaBase(settings: MpesaSettings): string {
  return settings.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(settings: MpesaSettings): Promise<string> {
  const { consumerKey, consumerSecret } = settings;
  const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${darajaBase(settings)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function callbackUrl(settings: MpesaSettings): string {
  return settings.callbackUrl;
}

function hasValidCallbackUrl(value: string): boolean {
  try {
    const callback = new URL(value);
    return callback.protocol === "https:" &&
      !!callback.hostname &&
      callback.pathname === "/api/mpesa/callback";
  } catch {
    return false;
  }
}

interface PendingMpesaTransaction {
  id: number;
  admin_id: number | null;
  customer_id: number | null;
  plan_id: number | null;
  amount: number;
  payment_method: string;
  payment_phone: string | null;
  mac_address: string | null;
}

interface SettlementResult {
  settled: boolean;
  payment_method: string | null;
  admin_id: number | null;
  amount: number | null;
  credited_customer_id: number | null;
}

export interface DarajaStkQuery {
  verified: boolean;
  resultCode: number | null;
  resultDesc: string;
}

async function queryDarajaStkResult(settings: MpesaSettings, checkoutId: string): Promise<DarajaStkQuery> {
  const { timestamp, password } = stkCredentials(settings.shortcode, settings.passkey);
  const token = await getDarajaToken(settings);
  const response = await fetch(`${darajaBase(settings)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: settings.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutId,
    }),
  });
  if (!response.ok) {
    return { verified: false, resultCode: null, resultDesc: `Daraja query failed: ${response.status}` };
  }
  const data = await response.json() as Record<string, unknown>;
  const returnedCheckoutId = String(data.CheckoutRequestID ?? "");
  const resultCode = Number(data.ResultCode);
  if (!returnedCheckoutId || returnedCheckoutId !== checkoutId || !Number.isFinite(resultCode)) {
    return { verified: false, resultCode: null, resultDesc: "Daraja query did not confirm this checkout request." };
  }
  return { verified: true, resultCode, resultDesc: String(data.ResultDesc ?? "") };
}

async function reconcileInitiatedStkRequest(
  transactionId: number,
  checkoutId: string,
  merchantRequestId: string,
  notes: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updated = await sbUpdate(
      "isp_transactions",
      `id=eq.${transactionId}&status=eq.initiating`,
      {
        reference: checkoutId,
        merchant_request_id: merchantRequestId,
        status: "pending",
        notes,
      },
    );
    if (updated[0]) return true;
    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return false;
}

export interface MpesaCallbackDependencies {
  selectPending: (filter: string) => Promise<PendingMpesaTransaction[]>;
  getSettings: () => Promise<MpesaSettings>;
  verifyStk: (settings: MpesaSettings, checkoutId: string) => Promise<DarajaStkQuery>;
  reactivatePppoeAccess: (opts: {
    adminId: number;
    customerId: number;
    planId: number;
    reference: string;
  }) => Promise<{ ok: boolean; skipped?: boolean; rollback?: () => Promise<void>; error?: string }>;
  settle: (args: {
    p_transaction_id: number;
    p_status: "completed" | "failed";
    p_note: string;
  }) => Promise<SettlementResult[]>;
}

export async function processMpesaCallback(
  body: unknown,
  overrides: Partial<MpesaCallbackDependencies> = {},
): Promise<boolean> {
  const dependencies: MpesaCallbackDependencies = {
    selectPending: filter => sbSelect<PendingMpesaTransaction>("isp_transactions", filter),
    getSettings: getMpesaSettings,
    verifyStk: queryDarajaStkResult,
    reactivatePppoeAccess,
    settle: args => sbRpc<SettlementResult>("settle_verified_mpesa_transaction", args),
    ...overrides,
  };
  const callback = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!callback) {
    logger.warn("[mpesa/callback] No stkCallback in body — ignoring");
    return false;
  }

  const { ResultCode, ResultDesc, CheckoutRequestID, MerchantRequestID } = callback;
  const checkoutId = String(CheckoutRequestID ?? "").trim();
  if (!checkoutId) {
    logger.warn("[mpesa/callback] Missing CheckoutRequestID — ignoring");
    return false;
  }
  const callbackMetadata = callback.CallbackMetadata as
    | { Item?: Array<{ Name?: string; Value?: unknown }> }
    | undefined;
  const callbackItems = callbackMetadata?.Item ?? [];
  const mpesaReceipt = String(
    callbackItems.find(item => item.Name === "MpesaReceiptNumber")?.Value ?? "",
  ).trim().toUpperCase();

  const pendingRows = await dependencies.selectPending(
    `reference=eq.${encodeURIComponent(checkoutId)}&status=eq.pending&select=id,admin_id,customer_id,plan_id,amount,payment_method,payment_phone,mac_address&limit=1`,
  );
  const transaction = pendingRows[0];
  if (!transaction) {
    logger.warn({ checkoutId, MerchantRequestID }, "[mpesa/callback] Callback awaits local checkout reconciliation");
    return false;
  }

  const settings = await dependencies.getSettings();
  const verification = await dependencies.verifyStk(settings, checkoutId);
  const callbackResultCode = Number(ResultCode);
  if (!verification.verified || verification.resultCode !== callbackResultCode) {
    logger.warn({ checkoutId, callbackResultCode, verification }, "[mpesa/callback] Callback could not be verified with Daraja");
    return false;
  }

  const isSuccessful = verification.resultCode === 0;
  if (isSuccessful && mpesaReceipt) {
    try {
      await sbUpdate(
        "isp_transactions",
        `id=eq.${transaction.id}&status=eq.pending`,
        { mpesa_receipt: mpesaReceipt },
      );
    } catch (error) {
      logger.warn({ err: error, checkoutId }, "[mpesa/callback] Could not save the verified M-Pesa receipt");
    }
  }
  let rollbackPppoeAccess: (() => Promise<void>) | undefined;
  if (isSuccessful && transaction.admin_id && transaction.customer_id && transaction.plan_id) {
    const access = await dependencies.reactivatePppoeAccess({
      adminId: transaction.admin_id,
      customerId: transaction.customer_id,
      planId: transaction.plan_id,
      reference: checkoutId,
    });
    if (!access.ok && !access.skipped) {
      logger.warn({ checkoutId, error: access.error }, "[mpesa/callback] PPPoE access restore is pending");
      return false;
    }
    rollbackPppoeAccess = access.rollback;
  }
  let settlements: SettlementResult[];
  try {
    settlements = await dependencies.settle({
      p_transaction_id: transaction.id,
      p_status: isSuccessful ? "completed" : "failed",
      p_note: isSuccessful
        ? "M-Pesa payment verified by Daraja."
        : `Daraja ResultCode ${verification.resultCode}: ${verification.resultDesc || String(ResultDesc ?? "Payment failed")}`,
    });
  } catch (error) {
    if (rollbackPppoeAccess) {
      await rollbackPppoeAccess().catch(rollbackError => {
        logger.error({ err: rollbackError, checkoutId }, "[mpesa/callback] PPPoE access rollback failed");
      });
    }
    throw error;
  }
  const settlement = settlements[0];
  if (!settlement?.settled) {
    logger.info({ checkoutId }, "[mpesa/callback] Callback replay ignored after state transition");
    return false;
  }

  if (isSuccessful && settlement.payment_method === "mpesa_registration") {
    logger.info({ adminId: settlement.admin_id, checkoutId }, "[mpesa/callback] ISP registration activated");
    if (settlement.admin_id) {
      void provisionTenantCertificateForAdmin(settlement.admin_id).catch(error => {
        logger.error({ err: error, adminId: settlement.admin_id }, "[registration] immediate tenant certificate provisioning failed; timer will retry");
      });
    }
  } else if (isSuccessful) {
    logger.info({ customerId: settlement.credited_customer_id, checkoutId, amount: settlement.amount }, "[mpesa/callback] Payment settled atomically");
  }
  return true;
}

export async function processDeferredMpesaCallbacks(checkoutId?: string): Promise<void> {
  const now = Date.now();
  const activeCutoff = new Date(now - CALLBACK_RECONCILIATION_WINDOW_MS).toISOString();
  const referenceFilter = checkoutId ? `&reference=eq.${encodeURIComponent(checkoutId)}` : `&created_at=gte.${encodeURIComponent(activeCutoff)}`;
  const events = await sbSelect<{ id: number; payload: unknown; created_at: string }>(
    "isp_webhook_events",
    `gateway=eq.mpesa&status=eq.received${referenceFilter}&select=id,payload,created_at&order=created_at.asc&limit=100`,
  );
  for (const event of events) {
    if (await processMpesaCallback(event.payload)) {
      await sbUpdate("isp_webhook_events", `id=eq.${event.id}`, { status: "processed" });
    } else if (now - Date.parse(event.created_at) >= CALLBACK_RECONCILIATION_WINDOW_MS) {
      await sbUpdate("isp_webhook_events", `id=eq.${event.id}&status=eq.received`, { status: "ignored" });
    }
  }
  if (!checkoutId && now - lastCallbackPurgeAt >= 60 * 60 * 1000) {
    lastCallbackPurgeAt = now;
    const retentionCutoff = new Date(now - CALLBACK_EVENT_RETENTION_MS).toISOString();
    await sbDelete(
      "isp_webhook_events",
      `gateway=eq.mpesa&status=in.(processed,ignored)&created_at=lt.${encodeURIComponent(retentionCutoff)}`,
    );
  }
}

setInterval(() => {
  void processDeferredMpesaCallbacks().catch(err => logger.error({ err }, "[mpesa/callback] Deferred callback retry failed"));
}, 60_000).unref();

/**
 * Return named devices currently visible on this ISP's hotspot routers.
 * Router credentials stay server-side; the portal receives only the client
 * identity data needed to choose a TV or streaming device.
 */
router.get("/mpesa/hotspot-devices", async (req: Request, res: Response): Promise<void> => {
  const adminId = await resolvePortalAdminId(req, req.query.adminId);
  const requestedRouterId = Number(req.query.routerId);
  const hasRouterFilter = Number.isSafeInteger(requestedRouterId) && requestedRouterId > 0;
  if (adminId === null || !Number.isSafeInteger(adminId) || adminId < 1) {
    res.status(400).json({ ok: false, error: "Open this portal from the ISP's assigned hostname or provide its ISP account." });
    return;
  }
  if (req.query.routerId !== undefined && !hasRouterFilter) {
    res.status(400).json({ ok: false, error: "The hotspot router context is invalid." });
    return;
  }
  if (!await isActiveIspAdmin(adminId)) {
    res.status(404).json({ ok: false, error: "This ISP account is not available." });
    return;
  }

  const routers = await sbSelect<HotspotRouterRow & { id: number; name: string }>(
    "isp_routers",
    `${hasRouterFilter ? `id=eq.${requestedRouterId}&` : ""}admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&order=name.asc`,
  );
  const devices: Array<{
    name: string;
    macAddress: string;
    address: string;
    routerId: number;
    routerName: string;
  }> = [];
  for (const row of routers) {
    if (!row.id || (!row.host && !row.bridge_ip && !row.vpn_ip)) continue;
    try {
      const connected = await fetchHotspotConnectedDevices(hotspotRouterCredentials(row));
      for (const device of connected) {
        devices.push({
          name: device.name,
          macAddress: device.macAddress,
          address: device.address,
          routerId: row.id,
          routerName: row.name || `Router ${row.id}`,
        });
      }
    } catch (error) {
      logger.warn({ err: error, adminId, routerId: row.id }, "[mpesa/hotspot-devices] router lookup failed");
    }
  }
  res.json({ ok: true, devices });
});

function stkCredentials(shortcode: string, passkey: string): { timestamp: string; password: string } {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
  const raw = `${shortcode}${passkey}${timestamp}`;
  const password = Buffer.from(raw).toString("base64");
  return { timestamp, password };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/mpesa/token
 * Public OAuth token access is intentionally disabled. Tokens are only used
 * inside the server-side STK flows.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/token", (_req: Request, res: Response): void => {
  res.status(404).json({ ok: false, error: "This endpoint is not available." });
});

/* Public hotspot checkout gets a short-lived, plan-bound token before STK. */
router.post("/mpesa/intent", async (req: Request, res: Response): Promise<void> => {
  const adminId = await resolvePortalAdminId(req, req.body?.adminId);
  const planId = Number(req.body?.plan_id);
  const phone = typeof req.body?.phone === "string" ? normaliseKenyanPhone(req.body.phone) : "";
  const deviceName = readDeviceName(req.body?.device_name);
  const deviceRouterId = Number(req.body?.device_router_id);
  const requestedService = req.body?.service_type === "pppoe" ? "pppoe" : "hotspot";
  const requestedCustomerId = Number(req.body?.customer_id);
  const mac = readMacAddress(req.body?.mac_address);
  const clientIp = readClientIp(req.body?.client_ip);
  if (adminId === null || !Number.isSafeInteger(adminId) || adminId < 1 || !Number.isSafeInteger(planId) || planId < 1 || !/^2547\d{8}$/.test(phone)) {
    res.status(400).json({ ok: false, error: "Choose an active plan and enter a valid Kenyan mobile number." });
    return;
  }
  if (mac.invalid) {
    res.status(400).json({ ok: false, error: "Enter a valid TV MAC address, for example AA:BB:CC:DD:EE:FF." });
    return;
  }
  if (!await isActiveIspAdmin(adminId)) {
    res.status(404).json({ ok: false, error: "This ISP account is not available for payments." });
    return;
  }
  const plans = await sbSelect<{ id: number; price: number | string; type?: string; router_id: number | null }>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${adminId}&is_active=is.true&select=id,price,type,router_id&limit=1`,
  );
  const plan = plans[0];
  const serviceType = normalizePlanServiceType(plan?.type);
  if (plan && serviceType !== requestedService) {
    res.status(409).json({ ok: false, error: "The selected package is for a different service. Refresh and try again." });
    return;
  }
  if (serviceType === "other") {
    res.status(409).json({ ok: false, error: "The selected package is not configured for a supported internet service." });
    return;
  }
  if (plan && Number.isSafeInteger(deviceRouterId) && deviceRouterId > 0 && plan.router_id !== deviceRouterId) {
    res.status(409).json({ ok: false, error: "Choose a package assigned to the selected device's router." });
    return;
  }
  if (serviceType === "pppoe" && (!Number.isSafeInteger(requestedCustomerId) || requestedCustomerId < 1)) {
    res.status(400).json({ ok: false, error: "A verified PPPoE customer account is required for this package." });
    return;
  }
  if (serviceType === "pppoe") {
    const customers = await sbSelect<{ id: number; admin_id: number; type: string }>(
      "isp_customers",
      `id=eq.${requestedCustomerId}&admin_id=eq.${adminId}&type=eq.pppoe&select=id,admin_id,type&limit=1`,
    );
    if (!customers[0]) {
      res.status(404).json({ ok: false, error: "The verified PPPoE customer account was not found." });
      return;
    }
  }
  const amount = Math.ceil(Number(plan?.price));
  if (!plan || !Number.isFinite(amount) || amount <= 0) {
    res.status(404).json({ ok: false, error: "The selected plan is not available for payment." });
    return;
  }
  let resolvedMac = mac.value;
  if (serviceType === "hotspot" && !resolvedMac) {
    if (!clientIp) {
      res.status(400).json({
        ok: false,
        error: "The hotspot router did not provide a client address. Reopen the Wi-Fi sign-in page from this network.",
      });
      return;
    }
    if (!plan.router_id) {
      res.status(503).json({ ok: false, error: "The hotspot plan is not assigned to a MikroTik router yet." });
      return;
    }
    const routers = await sbSelect<{
      host: string | null;
      bridge_ip: string | null;
      vpn_ip: string | null;
      router_username: string | null;
      router_secret: string | null;
    }>(
      "isp_routers",
      `id=eq.${plan.router_id}&admin_id=eq.${adminId}&select=host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    const routerRow = routers[0];
    if (!routerRow || (!routerRow.host && !routerRow.bridge_ip && !routerRow.vpn_ip)) {
      res.status(503).json({ ok: false, error: "The hotspot router is not reachable from the ISP server." });
      return;
    }
    try {
      resolvedMac = await resolveHotspotClientMac(
        hotspotRouterCredentials({
          host: routerRow.host,
          bridge_ip: routerRow.bridge_ip,
          vpn_ip: routerRow.vpn_ip,
          router_username: routerRow.router_username,
          router_secret: routerRow.router_secret,
        }),
        clientIp,
      ) ?? "";
    } catch (error) {
      logger.warn({ err: error, adminId, planId, clientIp }, "[mpesa/intent] router client lookup failed");
    }
    if (!resolvedMac) {
      res.status(409).json({
        ok: false,
        error: "The router could not match this Wi-Fi address to a device yet. Keep the Wi-Fi sign-in page open and try again.",
      });
      return;
    }
  }
  try {
    res.json({
      ok: true,
      paymentIntent: generatePaymentIntent({
        adminId, planId, amount, phone, serviceType,
        ...(deviceName ? { deviceName } : {}),
        ...(serviceType === "pppoe" ? { customerId: requestedCustomerId } : {}),
        ...(resolvedMac ? { macAddress: resolvedMac } : {}),
      }),
      amount,
      ...(resolvedMac ? { deviceMacAddress: resolvedMac } : {}),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Secure payment checkout is temporarily unavailable." });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/stkpush
 * Body: { phone, amount, account_ref? }
 * Uses shortcode 174379 (sandbox default), passkey, timestamp-derived password.
 * Formats phone to 2547XXXXXXXX and sends STK Push via Daraja API.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/stkpush", async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, account_ref, adminId, mac_address } = req.body as {
    phone?: string; amount?: number; account_ref?: string; adminId?: number; mac_address?: string;
  };
  const mac = readMacAddress(mac_address);

  if (!phone || !amount) {
    res.status(400).json({ ok: false, error: "phone and amount are required" });
    return;
  }
  if (mac.invalid) {
    res.status(400).json({ ok: false, error: "Enter a valid TV MAC address, for example AA:BB:CC:DD:EE:FF." });
    return;
  }
  const scopedAdminId = Number(adminId);
  if (!Number.isSafeInteger(scopedAdminId) || scopedAdminId < 1) {
    res.status(400).json({ ok: false, error: "A valid ISP admin context is required for M-Pesa payments." });
    return;
  }
  if (!await isActiveIspAdmin(scopedAdminId)) {
    res.status(404).json({ ok: false, error: "The selected ISP account is not active." });
    return;
  }
  const adminAuth = validateToken(extractToken(req));
  if (!adminAuth || adminAuth.type !== "a" || (adminAuth.uid !== "superadmin" && Number(adminAuth.uid) !== scopedAdminId)) {
    res.status(401).json({ ok: false, error: "An ISP Admin session is required to send this payment prompt." });
    return;
  }

  const cfg = await getMpesaSettings();
  if (!isMpesaConfigured(cfg)) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa credentials are not configured. Configure them in Super Admin → Payment Gateways.",
    });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  const raw = String(phone).replace(/\D/g, "");
  const formatted = raw.startsWith("0")
    ? `254${raw.slice(1)}`
    : raw.startsWith("+254")
    ? raw.slice(1)
    : raw.startsWith("254")
    ? raw
    : `254${raw}`;

  try {
    const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(scopedAdminId);
      if (!isDarajaGateway(paymentGateway)) {
       res.status(409).json({ ok: false, error: `${paymentGatewayLabel(paymentGateway)} is selected, but automated payment prompts are not connected for this gateway yet.` });
       return;
      }
       if (paymentGateway === "bank_stk_push" && !isBankStkPushConfigured(bankStkPush)) {
        res.status(400).json({ ok: false, error: "BankStkPush is missing the selected bank, PayBill Number, or Account / Business Number." });
        return;
      }
      if (paymentGateway === "mpesa_paybill" && (!mpesaPaybill.paybillNumber || !mpesaPaybill.accountNumber)) {
        res.status(400).json({ ok: false, error: "M-Pesa PayBill is missing its receiving PayBill Number or Account / Business Number." });
        return;
      }
      if (paymentGateway === "mpesa_till_push" && !mpesaTillPush.tillNumber) {
        res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
       return;
     }
      const payment = resolveDarajaPayment(paymentGateway, cfg, bankStkPush, mpesaTillPush, mpesaPaybill);
      const { businessShortcode, destination } = payment;
      if (!destination) {
        res.status(400).json({
          ok: false,
          error: paymentGateway === "mpesa_till_push"
            ? "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways."
            : "M-Pesa PayBill is not configured for this ISP. Add the receiving PayBill number and account number in Admin Settings → Payment Gateways.",
        });
        return;
      }

    const resolvedCallbackUrl = callbackUrl(cfg);
    if (!hasValidCallbackUrl(resolvedCallbackUrl)) {
      res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
      return;
    }
    const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
      admin_id: scopedAdminId,
      plan_id: null,
      amount: Math.ceil(Number(amount)),
      payment_method: "mpesa",
      payment_phone: formatted,
      mac_address: mac.value || null,
      reference: `initiating:${randomUUID()}`,
      status: "initiating",
      notes: `${paymentGatewayLabel(paymentGateway)} STK request is being created for ${formatted}`,
      created_at: new Date().toISOString(),
    });
    const initiatedTransaction = initiatedTransactions[0];
    if (!initiatedTransaction) {
      res.status(503).json({ ok: false, error: "Could not safely create the payment request. Please try again." });
      return;
    }
    const { timestamp, password } = stkCredentials(businessShortcode, cfg.passkey);
    const token = await getDarajaToken(cfg);

    const stkBody = {
      BusinessShortCode: businessShortcode,
      Password:          password,
      Timestamp:         timestamp,
       TransactionType:   paymentGateway === "mpesa_till_push" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            formatted,
      PartyB:            destination,
      PhoneNumber:       formatted,
      CallBackURL:       resolvedCallbackUrl,
      AccountReference:  payment.accountReference ?? account_ref ?? "ISPlatty",
      TransactionDesc:   "STK Push Payment",
    };

    const stkRes = await fetch(`${darajaBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(stkBody),
    });

    const data = await stkRes.json() as Record<string, unknown>;
    logger.info({ phone: formatted, amount, data }, "[mpesa/stkpush] response");

    if (!stkRes.ok || data["ResponseCode"] !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `STK prompt request failed: ${String(data["errorMessage"] ?? data["ResponseDescription"] ?? "Unknown error")}`,
      });
      res.status(400).json({
        ok: false,
        error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string,
      });
      return;
    }

    const checkoutId = String(data["CheckoutRequestID"] ?? "");
    const reconciled = checkoutId && await reconcileInitiatedStkRequest(
      initiatedTransaction.id,
      checkoutId,
      String(data["MerchantRequestID"] ?? ""),
      `${paymentGatewayLabel(paymentGateway)} STK push to ${formatted}`,
    );
    if (!reconciled) {
      logger.error({ checkoutId }, "[mpesa/stkpush] Could not reconcile initiated transaction");
      res.status(502).json({ ok: false, error: "The payment prompt was sent but could not be recorded safely. Do not retry; contact support." });
      return;
    }
    await processDeferredMpesaCallbacks(checkoutId);

    res.json({
      ok: true,
      CheckoutRequestID:  data["CheckoutRequestID"],
      MerchantRequestID:  data["MerchantRequestID"],
      ResponseDescription: data["ResponseDescription"],
    });
  } catch (e) {
    logger.error({ err: e }, "[mpesa/stkpush] error");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/callback
 * Receives the M-Pesa STK Push result from Safaricom.
 * Safaricom callbacks are correlated to an existing pending transaction, then
 * verified with Daraja's STK Query endpoint before any local state changes.
 * A conditional pending-to-final state change makes callback replay harmless.
 * Always responds 200 to Safaricom immediately.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/callback", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    service: "M-Pesa Daraja callback",
    method: "POST",
    message: "Callback endpoint is online and ready to receive STK Push results.",
  });
});

router.post("/mpesa/callback", async (req: Request, res: Response): Promise<void> => {
  try {
    const checkoutId = String(req.body?.Body?.stkCallback?.CheckoutRequestID ?? "").trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId)) {
      res.status(400).json({ ResultCode: 1, ResultDesc: "CheckoutRequestID is required" });
      return;
    }
    if (!allowCallbackIntake(req)) {
      res.status(429).json({ ResultCode: 1, ResultDesc: "Callback rate limit exceeded" });
      return;
    }
    const events = await sbInsert<{ id: number }>("isp_webhook_events", {
      gateway: "mpesa",
      status: "received",
      payload: req.body,
      reference: checkoutId,
      created_at: new Date().toISOString(),
    });
    const event = events[0];
    if (!event) {
      res.status(503).json({ ResultCode: 1, ResultDesc: "Callback intake is temporarily unavailable" });
      return;
    }
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    if (await processMpesaCallback(req.body)) {
      await sbUpdate("isp_webhook_events", `id=eq.${event.id}`, { status: "processed" });
    }
  } catch (err) {
    logger.error({ err }, "[mpesa/callback] Unexpected error processing callback");
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/stk  (legacy alias — same behavior as /stkpush)
 * Body: { phone, amount, plan_id?, account_ref? }
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/stk", async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, plan_id, account_ref, adminId, paymentIntent, mac_address, service_type, customer_id, device_name } = req.body as {
    phone?: string; amount?: number; plan_id?: number; account_ref?: string; adminId?: number; paymentIntent?: string; mac_address?: string; service_type?: string; customer_id?: number; device_name?: string;
  };
  const requestedMac = readMacAddress(mac_address);
  const requestedDeviceName = readDeviceName(device_name);

  if (!phone || !amount) {
    res.status(400).json({ ok: false, error: "phone and amount are required" });
    return;
  }
  if (requestedMac.invalid) {
    res.status(400).json({ ok: false, error: "Enter a valid TV MAC address, for example AA:BB:CC:DD:EE:FF." });
    return;
  }
  const scopedAdminId = await resolvePortalAdminId(req, adminId);
  if (scopedAdminId === null || !Number.isSafeInteger(scopedAdminId) || scopedAdminId < 1) {
    res.status(400).json({ ok: false, error: "A valid ISP admin context is required for M-Pesa payments." });
    return;
  }
  if (!await isActiveIspAdmin(scopedAdminId)) {
    res.status(404).json({ ok: false, error: "The selected ISP account is not active." });
    return;
  }

  const normalised = normaliseKenyanPhone(String(phone));
  const requestedAmount = Math.ceil(Number(amount));
  const requestedPlanId = Number(plan_id);
  const requestedCustomerId = Number(customer_id);
  const intent = typeof paymentIntent === "string" ? validatePaymentIntent(paymentIntent) : null;
  const mac = requestedMac.value ? requestedMac : readMacAddress(intent?.macAddress);
  const adminAuth = validateToken(extractToken(req));
  const hasAdminSession = !!adminAuth && adminAuth.type === "a" &&
    (adminAuth.uid === "superadmin" || Number(adminAuth.uid) === scopedAdminId);
  const superAdminToken = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  const hasSuperAdminSession = isActiveSuperAdminToken(superAdminToken);
  const hasMatchingIntent = !!intent &&
    intent.adminId === scopedAdminId &&
    intent.planId === requestedPlanId &&
    intent.amount === requestedAmount &&
    intent.phone === normalised &&
    (intent.serviceType ?? "hotspot") === (service_type === "pppoe" ? "pppoe" : "hotspot") &&
    (intent.customerId ?? null) === (Number.isSafeInteger(requestedCustomerId) ? requestedCustomerId : null);
  if (intent && (intent.macAddress ?? "") !== mac.value) {
    res.status(400).json({ ok: false, error: "The TV MAC address changed. Start the payment again." });
    return;
  }
  if (intent && (intent.deviceName ?? "") !== requestedDeviceName) {
    res.status(400).json({ ok: false, error: "The TV name changed. Start the payment again." });
    return;
  }
  if (!hasSuperAdminSession && !hasAdminSession && !hasMatchingIntent) {
    res.status(401).json({ ok: false, error: "Create a payment checkout from an active plan or sign in as this ISP Admin." });
    return;
  }
  if (Number.isSafeInteger(requestedPlanId) && requestedPlanId > 0) {
    const plans = await sbSelect<{ id: number; price: number | string; name: string; type?: string }>(
      "isp_plans",
      `id=eq.${requestedPlanId}&admin_id=eq.${scopedAdminId}&is_active=is.true&select=id,price,name,type&limit=1`,
    );
    const plan = plans[0];
    if (!plan) {
      res.status(404).json({ ok: false, error: "The selected package is not available for payment." });
      return;
    }
    const serviceType = normalizePlanServiceType(plan.type);
    if (service_type && service_type !== serviceType) {
      res.status(400).json({ ok: false, error: "The package service type does not match the selected package." });
      return;
    }
    if (serviceType === "other") {
      res.status(409).json({ ok: false, error: "The selected package is not configured for a supported internet service." });
      return;
    }
    if (intent && (intent.serviceType ?? "hotspot") !== serviceType) {
      res.status(400).json({ ok: false, error: "The payment checkout service changed. Start the payment again." });
      return;
    }
    if (serviceType === "pppoe") {
      if (!intent?.customerId || intent.customerId !== requestedCustomerId) {
        res.status(401).json({ ok: false, error: "Create a new verified PPPoE checkout before requesting payment." });
        return;
      }
      const customers = await sbSelect<{ id: number }>(
        "isp_customers",
        `id=eq.${intent.customerId}&admin_id=eq.${scopedAdminId}&type=eq.pppoe&select=id&limit=1`,
      );
      if (!customers[0]) {
        res.status(404).json({ ok: false, error: "The verified PPPoE customer account was not found." });
        return;
      }
    }
    if (requestedAmount !== Math.ceil(Number(plan.price))) {
      res.status(400).json({ ok: false, error: "The package amount changed. Refresh the package list and try again." });
      return;
    }
  }
  if (!allowStkRequest(req, scopedAdminId, normalised)) {
    res.status(429).json({ ok: false, error: "Too many payment prompts. Please wait before trying again." });
    return;
  }

  const cfg = await getMpesaSettings();
  if (!isMpesaConfigured(cfg)) {
    logger.warn("[mpesa/stk] M-Pesa credentials not configured — returning 503");
    res.status(503).json({
      ok: false,
      demo: true,
      error: "M-Pesa is not configured. Ask the Super Admin to complete Payment Gateways.",
    });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  try {
      const serviceType = intent?.serviceType ?? (service_type === "pppoe" ? "pppoe" : "hotspot");
      const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(scopedAdminId, serviceType);
      if (!isDarajaGateway(paymentGateway)) {
       res.status(409).json({ ok: false, error: `${paymentGatewayLabel(paymentGateway)} is selected, but automated payment prompts are not connected for this gateway yet.` });
       return;
      }
      if (paymentGateway === "bank_stk_push" && !isBankStkPushConfigured(bankStkPush)) {
       res.status(400).json({ ok: false, error: "BankStkPush is missing the selected bank, PayBill Number, or Account / Business Number." });
       return;
     }
      if (paymentGateway === "mpesa_paybill" && (!mpesaPaybill.paybillNumber || !mpesaPaybill.accountNumber)) {
        res.status(400).json({ ok: false, error: "M-Pesa PayBill is missing its receiving PayBill Number or Account / Business Number." });
        return;
      }
      if (paymentGateway === "mpesa_till_push" && !mpesaTillPush.tillNumber) {
        res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
        return;
      }
      const payment = resolveDarajaPayment(paymentGateway, cfg, bankStkPush, mpesaTillPush, mpesaPaybill);
      const { businessShortcode, destination } = payment;
     if (paymentGateway === "mpesa_till_push" && !destination) {
       res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
      return;
    }
     const resolvedCallbackUrl = callbackUrl(cfg);
     if (!hasValidCallbackUrl(resolvedCallbackUrl)) {
       res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
       return;
     }
     const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
       admin_id: scopedAdminId,
       plan_id: plan_id ?? null,
        customer_id: intent?.customerId ?? null,
       amount: Math.ceil(Number(amount)),
       payment_method: "mpesa",
       payment_phone: normalised,
        mac_address: mac.value || null,
       reference: `initiating:${randomUUID()}`,
       status: "initiating",
       notes: `${paymentGatewayLabel(paymentGateway)} STK request is being created for ${normalised}`,
       created_at: new Date().toISOString(),
     });
     const initiatedTransaction = initiatedTransactions[0];
     if (!initiatedTransaction) {
       res.status(503).json({ ok: false, error: "Could not safely create the payment request. Please try again." });
       return;
     }
     const token = await getDarajaToken(cfg);
     const { timestamp, password } = stkCredentials(businessShortcode, cfg.passkey);

    const body = {
       BusinessShortCode: businessShortcode,
      Password:          password,
      Timestamp:         timestamp,
       TransactionType:   paymentGateway === "mpesa_till_push" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount:            Math.ceil(Number(amount)),
      PartyA:            normalised,
      PartyB:            destination,
      PhoneNumber:       normalised,
       CallBackURL:       resolvedCallbackUrl,
       AccountReference:  payment.accountReference ?? account_ref ?? "ISPlatty",
      TransactionDesc:   `Plan ${plan_id ?? "purchase"}`,
    };

    const stkRes = await fetch(`${darajaBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await stkRes.json() as Record<string, unknown>;
    logger.info({ phone: normalised, amount, data }, "[mpesa/stk] STK push response");

    if (!stkRes.ok || data["ResponseCode"] !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `STK prompt request failed: ${String(data["errorMessage"] ?? data["ResponseDescription"] ?? "Unknown error")}`,
      });
      res.status(400).json({ ok: false, error: (data["errorMessage"] ?? data["ResponseDescription"] ?? "STK push failed") as string });
      return;
    }

    const checkoutId = String(data["CheckoutRequestID"] ?? "");
    const reconciled = checkoutId && await reconcileInitiatedStkRequest(
      initiatedTransaction.id,
      checkoutId,
      String(data["MerchantRequestID"] ?? ""),
      `${paymentGatewayLabel(paymentGateway)} STK push to ${normalised}`,
    );
    if (!reconciled) {
      logger.error({ checkoutId }, "[mpesa/stk] Could not reconcile initiated transaction");
      res.status(502).json({ ok: false, error: "The payment prompt was sent but could not be recorded safely. Do not retry; contact support." });
      return;
    }
    await processDeferredMpesaCallbacks(checkoutId);

    res.json({ ok: true, CheckoutRequestID: data["CheckoutRequestID"], MerchantRequestID: data["MerchantRequestID"] });
  } catch (e) {
    logger.error({ err: e }, "[mpesa/stk] error");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/mpesa/status?checkout_id=XXX
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get("/mpesa/status", async (req: Request, res: Response): Promise<void> => {
  const checkoutId = String(req.query.checkout_id ?? "").trim();

  if (!checkoutId) {
    res.status(400).json({ ok: false, paid: false, error: "checkout_id required" });
    return;
  }

  const rows = await sbSelect<{ id: number; status: string; reference: string; notes: string | null; admin_id: number | null; payment_method: string }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}&select=id,status,reference,notes,admin_id,payment_method&limit=1`,
  );

  const tx = rows[0];
  if (!tx) {
    res.json({ ok: true, paid: false, status: "pending" });
    return;
  }

  const paid = tx.status === "completed" || tx.status === "success" || tx.status === "paid";
  if (paid && tx.payment_method === "mpesa_registration" && tx.admin_id) {
    const admins = await sbSelect<{ username: string; name: string; subdomain: string; is_active: boolean }>(
      "isp_admins",
      `id=eq.${tx.admin_id}&select=username,name,subdomain,is_active&limit=1`,
    );
    const admin = admins[0];
    res.json({
      ok: true,
      paid: !!admin?.is_active,
      status: admin?.is_active ? "completed" : "processing",
      registration: admin ? { username: admin.username, name: admin.name, subdomain: admin.subdomain } : undefined,
    });
    return;
  }
  res.json({
    ok: true,
    paid,
    status: tx.status,
    failureReason: tx.status === "failed" ? tx.notes ?? undefined : undefined,
  });
});

/**
 * Bind a verified paid device to the HotSpot router. The checkout ID is the
 * capability: the browser cannot choose a different plan, ISP, or MAC after
 * the signed intent has been recorded.
 */
router.post("/mpesa/hotspot-mac-access", async (req: Request, res: Response): Promise<void> => {
  const checkoutId = String(req.body?.checkout_id ?? "").trim();
  const adminId = await resolvePortalAdminId(req, req.body?.adminId);
  const requestedMac = readMacAddress(req.body?.mac_address);
  const requestedDeviceName = readDeviceName(req.body?.device_name);
  const clientIp = readClientIp(req.body?.client_ip);

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId) || adminId === null || !Number.isSafeInteger(adminId) || adminId < 1 || requestedMac.invalid) {
    res.status(400).json({ ok: false, error: "A paid checkout and ISP context are required." });
    return;
  }

  const transactions = await sbSelect<{
    id: number;
    admin_id: number;
    plan_id: number | null;
    payment_phone: string | null;
    mac_address: string | null;
    status: string;
  }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}&admin_id=eq.${adminId}&status=in.(completed,paid,success)&payment_method=eq.mpesa&select=id,admin_id,plan_id,payment_phone,mac_address,status&limit=1`,
  );
  const transaction = transactions[0];

  if (!transaction) {
    res.status(409).json({ ok: false, error: "Payment is not confirmed yet. Keep this page open while we verify it." });
    return;
  }
  const transactionMac = normaliseMacAddress(transaction.mac_address);
  const mac = requestedMac.value || transactionMac;
  if (!mac || (requestedMac.value && transactionMac !== requestedMac.value)) {
    res.status(400).json({ ok: false, error: "This device MAC address does not match the paid checkout." });
    return;
  }
  if (!await isActiveIspAdmin(adminId)) {
    res.status(404).json({ ok: false, error: "This ISP account is not active." });
    return;
  }
  if (!transaction.plan_id) {
    res.status(409).json({ ok: false, error: "The paid checkout has no hotspot plan attached." });
    return;
  }

  let plans: Array<{
    id: number;
    name: string;
    type: string;
    router_id: number | null;
    speed_down: number | null;
    speed_up: number | null;
    speed_down_unit: string | null;
    speed_up_unit: string | null;
    data_limit_mb: number | null;
  }>;
  try {
    plans = await sbSelectStrict(
      "isp_plans",
      `id=eq.${transaction.plan_id}&admin_id=eq.${adminId}&is_active=is.true&select=id,name,type,router_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb&limit=1`,
    );
  } catch (error) {
    logger.error({ err: error, checkoutId, planId: transaction.plan_id }, "[mpesa/hotspot-mac-access] plan schema lookup failed");
    res.status(503).json({ ok: false, error: "The hotspot plan details are temporarily unavailable while the database is being updated. Try connecting again shortly." });
    return;
  }
  const plan = plans[0];
  if (!plan || normalizePlanServiceType(plan.type) !== "hotspot") {
    res.status(409).json({ ok: false, error: "The paid plan is not configured as a hotspot plan." });
    return;
  }
  if (!plan.router_id) {
    res.status(503).json({ ok: false, error: "The hotspot plan is not assigned to a MikroTik router yet." });
    return;
  }

  const planRow = await sbSelect<{
    validity: number | null;
    validity_unit: string | null;
    validity_days: number | null;
  }>(
    "isp_plans",
    `id=eq.${plan.id}&admin_id=eq.${adminId}&select=validity,validity_unit,validity_days&limit=1`,
  );
  const planValidity = planRow[0];
  const configuredValidity = Number(planValidity?.validity ?? planValidity?.validity_days ?? 0);
  const expiresInSeconds = planValiditySeconds(configuredValidity, planValidity?.validity_unit);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    res.status(409).json({ ok: false, error: "The hotspot plan has no valid access duration configured." });
    return;
  }
  const dataLimitMb = Number(plan.data_limit_mb);
  const limitBytesTotal = Number.isFinite(dataLimitMb) && dataLimitMb > 0
    ? String(Math.floor(dataLimitMb * 1_000_000))
    : "0";

  const routers = await sbSelect<{
    id: number;
    name: string;
    host: string;
    bridge_ip: string | null;
    vpn_ip: string | null;
    router_username: string | null;
    router_secret: string | null;
  }>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  );
  const routerRow = routers[0];
  if (!routerRow || (!routerRow.host && !routerRow.bridge_ip && !routerRow.vpn_ip)) {
    res.status(503).json({ ok: false, error: "The hotspot router is not reachable from the ISP server." });
    return;
  }

  const credentials = hotspotRouterCredentials(routerRow);
  const paymentPhone = normaliseKenyanPhone(String(transaction.payment_phone ?? ""));
  if (!/^254\d{9}$/.test(paymentPhone)) {
    res.status(409).json({ ok: false, error: "The paid checkout has no valid Kenyan purchase phone number." });
    return;
  }

  /*
   * A paid hotspot account is one database customer plus one RouterOS user.
   * Keep the RouterOS identifier stable and readable: phone + last two MAC
   * octets, for example 254798088650-11:5F.
   */
  const existingCustomers = await sbSelect<{
    id: number;
    username: string | null;
    password: string | null;
    mac_address: string | null;
    ip_address: string | null;
    status: string;
    expires_at: string | null;
  }>(
    "isp_customers",
    `admin_id=eq.${adminId}&type=eq.hotspot&phone=eq.${encodeURIComponent(paymentPhone)}&select=id,username,password,mac_address,ip_address,status,expires_at&order=id.desc&limit=20`,
  );
  const now = Date.now();
  const isReusable = (customer: typeof existingCustomers[number]) => {
    const expiresAt = customer.expires_at ? Date.parse(customer.expires_at) : 0;
    return customer.status === "active" &&
      Number.isFinite(expiresAt) &&
      expiresAt > now &&
      typeof customer.username === "string";
  };
  const reusableCustomer = existingCustomers.find((customer) =>
    isReusable(customer) && normaliseMacAddress(customer.mac_address) === mac
  ) ?? (existingCustomers.length === 1 && !existingCustomers[0].mac_address && isReusable(existingCustomers[0])
    ? existingCustomers[0]
    : undefined);

  const hotspotUsername = prepaidHotspotUsername(paymentPhone, mac);
  if (!hotspotUsername) {
    res.status(409).json({ ok: false, error: "The payment does not include enough phone and device information for a hotspot username." });
    return;
  }
  const collision = await sbSelect<{ id: number }>(
    "isp_customers",
    `admin_id=eq.${adminId}&type=eq.hotspot&username=eq.${encodeURIComponent(hotspotUsername)}&select=id&limit=1`,
  );
  if (collision[0] && collision[0].id !== reusableCustomer?.id) {
    res.status(409).json({ ok: false, error: "This device identifier is already assigned to another hotspot account." });
    return;
  }
  const hotspotPassword = "12345";
  const routerAddress = clientIp || reusableCustomer?.ip_address || "";
  const existingExpiry = reusableCustomer?.expires_at ? Date.parse(reusableCustomer.expires_at) : 0;
  const expiryBase = reusableCustomer && Number.isFinite(existingExpiry) ? Math.max(now, existingExpiry) : now;
  const expiresAt = new Date(expiryBase + Math.ceil(expiresInSeconds) * 1000);

  const customerFields = {
    admin_id: adminId,
    name: requestedDeviceName || `Hotspot ${paymentPhone}`,
    phone: paymentPhone,
    username: hotspotUsername,
    password: hotspotPassword,
    plan_id: plan.id,
    type: "hotspot",
    mac_address: mac,
    ip_address: routerAddress || null,
    status: "active",
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  };
  let customer: { id: number } | undefined;
  try {
    /*
     * Persist the paid account before touching RouterOS. The router/API can be
     * temporarily unavailable after payment; keeping the customer and linking
     * the transaction makes the same checkout or receipt retryable.
     */
    const customerRows = reusableCustomer
      ? await sbUpdateStrict("isp_customers", `id=eq.${reusableCustomer.id}&admin_id=eq.${adminId}`, customerFields)
      : await sbInsertStrict("isp_customers", { ...customerFields, created_at: new Date().toISOString() });
    customer = customerRows[0] as { id: number } | undefined;
    if (!customer?.id) throw new Error("The paid hotspot customer account could not be saved.");

    await sbUpdateStrict("isp_transactions", `id=eq.${transaction.id}&admin_id=eq.${adminId}`, {
      customer_id: customer.id,
      plan_id: plan.id,
      notes: `M-Pesa payment verified; prepaid hotspot account saved and awaiting router access on ${routerRow.name}.`,
    });
  } catch (error) {
    logger.error({ err: error, checkoutId, routerId: routerRow.id, mac }, "[mpesa/hotspot-mac-access] prepaid account persistence failed");
    res.status(503).json({
      ok: false,
      error: "Payment is confirmed, but the prepaid account could not be saved. Please retry connection.",
    });
    return;
  }

  try {
    const hotspotProfile = `ochola-plan-${plan.id}`;
    await ensureHotspotUserProfile(credentials, {
      name: hotspotProfile,
      sharedUsers: 1,
      rateLimit: hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit),
    });
    const paidBindingApplied = await addHotspotIpBinding(credentials, {
      macAddress: mac,
      ipAddress: routerAddress || undefined,
      comment: hotspotUsername,
      expiresInSeconds,
      bindingType: "regular",
    });
    if (paidBindingApplied) {
      await ensureHotspotUserRateQueue(credentials, {
        username: hotspotUsername,
        address: routerAddress || undefined,
        maxLimit: hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit),
      });
    }
    if (reusableCustomer?.username && reusableCustomer.username !== hotspotUsername) {
      await disconnectHotspotActiveUser(credentials, reusableCustomer.username).catch(() => {});
      await removeHotspotUser(credentials, reusableCustomer.username).catch(() => {});
    }
    try {
      await updateHotspotUser(credentials, hotspotUsername, {
        password: hotspotPassword,
        profile: hotspotProfile,
        disabled: false,
        comment: hotspotUsername,
        address: routerAddress || undefined,
        limitBytesTotal,
      });
    } catch {
      await addHotspotUser(credentials, {
        name: hotspotUsername,
        password: hotspotPassword,
        profile: hotspotProfile,
        comment: hotspotUsername,
        address: routerAddress || undefined,
        limitBytesTotal,
      });
    }
    await resetHotspotUserCounters(credentials, hotspotUsername).catch(() => {});
    await disconnectHotspotActiveUser(credentials, hotspotUsername).catch(() => {});
    await scheduleHotspotUserExpiry(credentials, {
      name: hotspotUsername,
      expiresInSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
    });
    if (paidBindingApplied && routerAddress) {
      await connectHotspotUser(credentials, {
        user: hotspotUsername,
        password: hotspotPassword,
        ip: routerAddress,
        macAddress: mac,
      }).catch((error) => {
        logger.warn({ err: error, username: hotspotUsername }, "[mpesa/hotspot-mac-access] active login deferred");
      });
    }

     await sbUpdateStrict("isp_transactions", `id=eq.${transaction.id}&admin_id=eq.${adminId}`, {
      customer_id: customer.id,
      plan_id: plan.id,
      notes: `M-Pesa payment verified; hotspot credentials assigned and MAC access granted on ${routerRow.name}.`,
    });
    res.json({
      ok: true,
      access: "hotspot-authenticated",
      router: routerRow.name,
      mac_address: mac,
      credentials: { username: hotspotUsername, password: hotspotPassword },
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error({ err: error, checkoutId, routerId: routerRow.id, mac }, "[mpesa/hotspot-mac-access] binding failed");
    res.status(503).json({
      ok: false,
      error: "Payment is confirmed and the prepaid account was saved, but the hotspot router could not be updated. Keep this page open and retry connection.",
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mpesa/verify
 * Reconnect an already verified hotspot payment from the customer's M-Pesa
 * confirmation SMS. The SMS is only a lookup key: access is granted only when
 * its receipt matches a completed server-side transaction.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.post("/mpesa/verify", async (req: Request, res: Response): Promise<void> => {
  const adminId = Number(req.body?.adminId);
  const receipt = extractMpesaReceipt(req.body?.message);
  const requestedMac = readMacAddress(req.body?.mac_address);
  const clientIp = readClientIp(req.body?.client_ip);

  if (!Number.isSafeInteger(adminId) || adminId < 1 || !receipt || requestedMac.invalid) {
    res.status(400).json({ ok: false, error: "Paste a valid M-Pesa confirmation message and open this page from the ISP network." });
    return;
  }
  if (!await isActiveIspAdmin(adminId)) {
    res.status(404).json({ ok: false, error: "This ISP account is not active." });
    return;
  }

  type VerifiedTransaction = {
    id: number;
    admin_id: number;
    customer_id: number | null;
    plan_id: number | null;
    payment_phone: string | null;
    mac_address: string | null;
    mpesa_receipt: string | null;
    status: string;
  };
  let transactions = await sbSelect<VerifiedTransaction>(
    "isp_transactions",
    `admin_id=eq.${adminId}&payment_method=eq.mpesa&status=in.(completed,paid,success)&mpesa_receipt=eq.${encodeURIComponent(receipt)}&select=id,admin_id,customer_id,plan_id,payment_phone,mac_address,mpesa_receipt,status&limit=1`,
  );
  if (!transactions[0]) {
    /* Legacy webhook provisioning stored the receipt in reference. */
    transactions = await sbSelect<VerifiedTransaction>(
      "isp_transactions",
      `admin_id=eq.${adminId}&payment_method=eq.mpesa&status=in.(completed,paid,success)&reference=eq.${encodeURIComponent(receipt)}&select=id,admin_id,customer_id,plan_id,payment_phone,mac_address,mpesa_receipt,status&limit=1`,
    );
  }
  const transaction = transactions[0];
  if (!transaction?.customer_id || !transaction.plan_id) {
    res.status(404).json({ ok: false, error: "That M-Pesa payment has not been assigned to a hotspot account yet." });
    return;
  }

  const customers = await sbSelect<{
    id: number;
    username: string | null;
    password: string | null;
    name: string | null;
    mac_address: string | null;
    ip_address: string | null;
    status: string;
    expires_at: string | null;
  }>(
    "isp_customers",
    `id=eq.${transaction.customer_id}&admin_id=eq.${adminId}&type=eq.hotspot&select=id,username,password,name,mac_address,ip_address,status,expires_at&limit=1`,
  );
  const customer = customers[0];
  if (!customer?.username || !customer.password) {
    res.status(409).json({ ok: false, error: "The verified payment does not have hotspot credentials yet." });
    return;
  }
  const expiresAtMs = customer.expires_at ? Date.parse(customer.expires_at) : 0;
  if (customer.status !== "active" || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    res.status(409).json({ ok: false, error: "This hotspot package has expired. Purchase a new package to reconnect." });
    return;
  }

  let plans: Array<{
    id: number;
    name: string;
    type: string;
    router_id: number | null;
    speed_down: number | null;
    speed_up: number | null;
    speed_down_unit: string | null;
    speed_up_unit: string | null;
    data_limit_mb: number | null;
  }>;
  try {
    plans = await sbSelectStrict(
      "isp_plans",
      `id=eq.${transaction.plan_id}&admin_id=eq.${adminId}&is_active=is.true&select=id,name,type,router_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb&limit=1`,
    );
  } catch (error) {
    logger.error({ err: error, receipt, planId: transaction.plan_id }, "[mpesa/verify] plan schema lookup failed");
    res.status(503).json({ ok: false, error: "The hotspot plan details are temporarily unavailable while the database is being updated. Try again shortly." });
    return;
  }
  const plan = plans[0];
  if (!plan || normalizePlanServiceType(plan.type) !== "hotspot" || !plan.router_id) {
    res.status(409).json({ ok: false, error: "The verified payment is not attached to an active hotspot package." });
    return;
  }

  const routers = await sbSelect<{
    id: number;
    name: string;
    host: string;
    bridge_ip: string | null;
    vpn_ip: string | null;
    router_username: string | null;
    router_secret: string | null;
  }>(
    "isp_routers",
    `id=eq.${plan.router_id}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
  );
  const routerRow = routers[0];
  if (!routerRow || (!routerRow.host && !routerRow.bridge_ip && !routerRow.vpn_ip)) {
    res.status(503).json({ ok: false, error: "The hotspot router is not reachable from the ISP server." });
    return;
  }

  const transactionMac = normaliseMacAddress(transaction.mac_address || customer.mac_address);
  let mac = requestedMac.value || transactionMac;
  if (requestedMac.value && transactionMac && requestedMac.value !== transactionMac) {
    res.status(400).json({ ok: false, error: "This M-Pesa payment belongs to a different device." });
    return;
  }
  const credentials = hotspotRouterCredentials(routerRow);
  if (!mac && clientIp) {
    mac = await resolveHotspotClientMac(credentials, clientIp).catch(() => null) ?? "";
  }
  if (!mac) {
    res.status(400).json({ ok: false, error: "The router could not identify the device to reconnect." });
    return;
  }

  const expiresInSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  const hotspotProfile = `ochola-plan-${plan.id}`;
  const dataLimitMb = Number(plan.data_limit_mb);
  const limitBytesTotal = Number.isFinite(dataLimitMb) && dataLimitMb > 0
    ? String(Math.floor(dataLimitMb * 1_000_000))
    : "0";
  try {
    await ensureHotspotUserProfile(credentials, {
      name: hotspotProfile,
      sharedUsers: 1,
      rateLimit: hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit),
    });
    const paidBindingApplied = await addHotspotIpBinding(credentials, {
      macAddress: mac,
      ipAddress: clientIp || undefined,
      comment: customer.username,
      expiresInSeconds,
      bindingType: "regular",
    });
    if (paidBindingApplied) {
      await ensureHotspotUserRateQueue(credentials, {
        username: customer.username,
        address: clientIp || customer.ip_address || undefined,
        maxLimit: hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit),
      });
    }
    try {
      await updateHotspotUser(credentials, customer.username, {
        password: customer.password,
        profile: hotspotProfile,
        disabled: false,
        comment: customer.username,
        address: clientIp || customer.ip_address || undefined,
        limitBytesTotal,
      });
    } catch {
      await addHotspotUser(credentials, {
        name: customer.username,
        password: customer.password,
        profile: hotspotProfile,
        comment: customer.username,
        address: clientIp || customer.ip_address || undefined,
        limitBytesTotal,
      });
    }
    await resetHotspotUserCounters(credentials, customer.username).catch(() => {});
    await disconnectHotspotActiveUser(credentials, customer.username).catch(() => {});
    await scheduleHotspotUserExpiry(credentials, {
      name: customer.username,
      expiresInSeconds,
    });
    if (paidBindingApplied && (clientIp || customer.ip_address)) {
      await connectHotspotUser(credentials, {
        user: customer.username,
        password: customer.password,
        ip: clientIp || customer.ip_address!,
        macAddress: mac,
      }).catch((error) => {
        logger.warn({ err: error, username: customer.username }, "[mpesa/verify] active login deferred");
      });
    }
    res.json({
      ok: true,
      transaction_id: transaction.id,
      router: routerRow.name,
      credentials: { username: customer.username, password: customer.password },
      expires_at: customer.expires_at,
    });
  } catch (error) {
    logger.error({ err: error, receipt, routerId: routerRow.id }, "[mpesa/verify] hotspot reconnect failed");
    res.status(503).json({ ok: false, error: "The payment was verified, but the hotspot router could not reconnect this device. Please try again." });
  }
});

export default router;
