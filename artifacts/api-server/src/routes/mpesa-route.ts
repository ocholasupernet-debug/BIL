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
import { billingSelect } from "../lib/platform-billing-store.js";
import { logger } from "../lib/logger.js";
import { sendRegistrationConfirmationEmail } from "../lib/platform-email.js";
import { provisionTenantCertificateForAdmin } from "../lib/tenant-certificate-provisioner.js";
import { getMpesaSettings, isMpesaConfigured, type MpesaSettings } from "../lib/settings-store.js";
import { extractToken, generatePaymentIntent, validatePaymentIntent, validateToken } from "../lib/api-auth.js";
import { planBelongsToOwner } from "../lib/plan-ownership.js";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  addHotspotIpBinding,
  addHotspotUser,
  requireHotspotUserProfile,
  ensureHotspotServerAddressPool,
  resolveHotspotClientMac,
  fetchHotspotUserUsage,
  connectHotspotUser,
  scheduleHotspotUserExpiry,
  scheduleHotspotUserFup,
  removeHotspotUserFup,
  disconnectHotspotActiveUser,
  removeHotspotUser,
  resetHotspotUserCounters,
  ensureHotspotUserRateQueue,
  updateHotspotUser,
  upsertHotspotUser,
  fetchHotspotConnectedDevices,
  resolveHotspotClientIpByMac,
  classifyRouterConnectionFailure,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import { hotspotPlanProfileName, prepaidHotspotUsername, routerRateLimit } from "../lib/prepaid-identifiers.js";
import { planValiditySeconds } from "../lib/plan-validity.js";
import {
  collectionConfig,
  gatewayConfigMap,
  isGatewayConfigComplete,
  isDarajaGateway,
  paymentCollectionMode,
  servicePaymentConfigMap,
  type PaymentService,
} from "../lib/payment-routing.js";
import { reactivatePppoeAccess, reactivateVlanAccess } from "../lib/auto-provision.js";
import { syncRadiusCustomer } from "../lib/radius.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import { getTenantSubdomainFromRequest } from "../lib/tenant-host.js";
import { normalizePlanServiceType } from "../lib/plan-service-type.js";
import { dataLimitMegabytesToBytes, validateFupPolicy } from "../lib/fup-policy.js";
import { portServiceResourceNames, type PortServiceResourceInput } from "../lib/port-service-resources.js";
import { ipv4InSubnet, isValidIpv4, isValidVlanTag } from "../lib/vlan-customer-queue.js";
import {
  bankBusinessNumberFor,
  decryptGatewayConfig,
  encryptGatewayConfig,
  isResellerGatewayTestMetadata,
  resellerDestinationConfigured,
  resolveResellerGatewayRoute,
  type ResellerGatewayRouteRow,
} from "../lib/reseller-payment-gateway.js";

const router: IRouter = Router();

/**
 * Keep paid Hotspot activation/reconnect operations behind one seam so route
 * tests can verify the exact RouterOS targets without opening router or RADIUS
 * connections. Production uses the real integrations by default.
 */
export const hotspotPaymentOperations = {
  addHotspotIpBinding,
  addHotspotUser,
  connectHotspotUser,
  disconnectHotspotActiveUser,
  ensureHotspotServerAddressPool,
  ensureHotspotUserRateQueue,
  fetchHotspotUserUsage,
  requireHotspotUserProfile,
  removeHotspotUserFup,
  resetHotspotUserCounters,
  resolveHotspotClientIpByMac,
  scheduleHotspotUserFup,
  scheduleHotspotUserExpiry,
  syncRadiusCustomer,
  updateHotspotUser,
  upsertHotspotUser,
};

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
  bank_transfer: "Bank transfer (manual confirmation)",
  manual: "Cash / Manual",
};
const PAYMENT_GATEWAY_IDS = new Set(Object.keys(PAYMENT_GATEWAY_LABELS));
type PaymentGateway = string;
const stkRateLimits = new Map<string, { count: number; startedAt: number }>();
const callbackIntakeLimits = new Map<string, { count: number; startedAt: number }>();
const CALLBACK_RECONCILIATION_WINDOW_MS = 10 * 60 * 1000;
const CALLBACK_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CALLBACK_SCAN_BATCH_SIZE = 50;
let lastCallbackPurgeAt = 0;
let deferredCallbackOlderIdCursor = 0;
let deferredCallbackExpiredIdCursor = 0;

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
function hotspotRouterCredentials(
  row: HotspotRouterRow,
  options: { forceManagementVpn?: boolean } = {},
): RouterCredentials {
  const storedManagementIp = [row.vpn_ip, row.bridge_ip].find(isManagementVpnIp) ?? "";
  const vpnClients = options.forceManagementVpn || !storedManagementIp ? readVpnClients() : [];
  const discoveredManagementIp = vpnIpFor(row.host ?? "", vpnClients)
    ?? vpnIpFor(row.name ?? "", vpnClients)
    ?? "";
  if (options.forceManagementVpn && storedManagementIp && !discoveredManagementIp) {
    throw new Error(
      `OpenVPN management tunnel is offline for ${row.name ?? "the router"}; ` +
      "no active router-management VPN client was found.",
    );
  }
  const managementIp = discoveredManagementIp || storedManagementIp;
  return {
    host: managementIp || row.host?.trim() || "",
    bridgeIp: discoveredManagementIp || (managementIp && row.host?.trim() !== managementIp ? managementIp : undefined),
    port: 8728,
    username: managementIp ? ROUTER_MANAGEMENT_API_USERNAME : row.router_username || "admin",
    password: row.router_secret || "",
    alternateUsernames: managementIp && row.router_username && row.router_username !== ROUTER_MANAGEMENT_API_USERNAME
      ? [row.router_username]
      : undefined,
    useSSL: false,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

function logRouterConnectionFailure(
  error: unknown,
  context: Record<string, unknown>,
  message: string,
): { profile: ReturnType<typeof classifyRouterConnectionFailure>["profile"]; userMessage: string } {
  const diagnosis = classifyRouterConnectionFailure(error);
  logger.error(
    {
      ...context,
      failureProfile: diagnosis.profile,
      failureSummary: diagnosis.summary,
      failureMessage: diagnosis.message,
    },
    message,
  );
  return {
    profile: diagnosis.profile,
    userMessage: diagnosis.summary,
  };
}

async function markPaymentClearedRouterPending(opts: {
  transactionId: number;
  adminId: number;
  customerAdminId?: number;
  customerId: number;
  routerName?: string | null;
  failureMessage: string;
}): Promise<void> {
  const note = `Payment cleared; RouterOS account activation is pending on ${opts.routerName || "the router"}. ${opts.failureMessage}`.slice(0, 500);
  await Promise.all([
    sbUpdateStrict(
      "isp_customers",
      `id=eq.${opts.customerId}&admin_id=eq.${opts.customerAdminId ?? opts.adminId}`,
      {
        status: "payment_cleared_router_pending",
        updated_at: new Date().toISOString(),
      },
    ),
    sbUpdateStrict(
      "isp_transactions",
      `id=eq.${opts.transactionId}&admin_id=eq.${opts.adminId}`,
      { notes: note },
    ),
  ]);
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
  const bankName = typeof config.bankName === "string" ? config.bankName.trim() : "";
  const paybillNumber = typeof config.paybillNumber === "string" ? config.paybillNumber.trim() : "";
  return {
    bankName,
    paybillNumber: paybillNumber
      || (typeof config.merchantIdentifier === "string" ? config.merchantIdentifier.trim() : "")
      || bankBusinessNumberFor(bankName),
    accountNumber: typeof config.accountNumber === "string"
      ? config.accountNumber.trim()
      : typeof config.accountReference === "string"
        ? config.accountReference.trim()
        : "",
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
  const config = gatewayConfig(value, "mpesa_till_push");
  return {
    tillNumber: config.tillNumber
      || config.merchantIdentifier
      || config.merchant_identifier
      || "",
  };
}

function mpesaPaybillConfig(value: unknown): MpesaPaybillConfig {
  const config = gatewayConfig(value, "mpesa_paybill");
  return {
    paybillNumber: config.paybillNumber
      || config.merchantIdentifier
      || config.merchant_identifier
      || "",
    accountNumber: config.accountNumber
      || config.accountReference
      || config.account_reference
      || "",
  };
}

function resellerRouteMpesaPaybillConfig(config: Record<string, string>): MpesaPaybillConfig {
  return {
    /* The scoped route UI uses paybillNumber/accountNumber. These aliases
       preserve compatibility with the older reseller payment-settings rows
       and previously saved route payloads. */
    paybillNumber: config.paybillNumber
      || config.merchantIdentifier
      || config.merchant_identifier
      || "",
    accountNumber: config.accountNumber
      || config.accountReference
      || config.account_reference
      || "",
  };
}

function resellerRouteMpesaTillConfig(config: Record<string, string>): MpesaTillPushConfig {
  return {
    tillNumber: config.tillNumber
      || config.merchantIdentifier
      || config.merchant_identifier
      || "",
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

async function getAdminPaymentSettings(
  adminId: number | undefined,
  serviceType: PaymentService = "hotspot",
  options: { useSharedGateway?: boolean } = {},
): Promise<{
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
  const useSharedGateway = options.useSharedGateway === true;
  const config = !useSharedGateway && mode === "separate" && service
    ? { [service.gatewayId]: service.config }
    : rows[0]?.payment_gateway_config;
  const paymentGateway = !useSharedGateway && mode === "separate"
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

type ResellerPaymentRoute = {
  resellerId: number;
  portId: number;
  gatewayRouteId: number | null;
  gatewayConfigCiphertext: string;
  paymentGateway: PaymentGateway;
  settings: MpesaSettings;
  bankStkPush: BankStkPushConfig;
  mpesaTillPush: MpesaTillPushConfig;
  mpesaPaybill: MpesaPaybillConfig;
  merchantIdentifier: string;
  accountReference: string;
};

function resellerDarajaSettings(
  config: Record<string, string>,
  callbackUrl: string,
): MpesaSettings {
  return {
    consumerKey: config.consumerKey ?? "",
    consumerSecret: config.consumerSecret ?? "",
    shortcode: config.businessShortcode ?? config.shortcode ?? "",
    passkey: config.passkey ?? "",
    callbackUrl: config.callbackUrl || callbackUrl,
    env: config.environment === "production" ? "production" : "sandbox",
    tillNumber: config.tillNumber ?? "",
  };
}

async function getResellerPaymentRoute(
  adminId: number,
  planId: number,
): Promise<ResellerPaymentRoute | null> {
  const plans = await sbSelectStrict<{
    port_id: number | null;
    router_id: number | null;
    owner_reseller_id: number | null;
  }>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${adminId}&select=port_id,router_id,owner_reseller_id&limit=1`,
  );
  const portId = Number(plans[0]?.port_id);
  const routerId = Number(plans[0]?.router_id);
  if (!Number.isSafeInteger(portId) || portId <= 0 || !Number.isSafeInteger(routerId) || routerId <= 0) return null;

  const ports = await sbSelectStrict<{
    id: number;
    assigned_reseller_id: number | null;
    status: string;
    link_status: string | null;
  }>(
    "isp_reseller_ports",
    `id=eq.${portId}&admin_id=eq.${adminId}&select=id,assigned_reseller_id,status,link_status&limit=1`,
  );
  const port = ports[0];
  const planOwnerId = plans[0]?.owner_reseller_id ?? null;
  if (planOwnerId !== null && (!port || !planBelongsToOwner({ owner_reseller_id: planOwnerId }, port.assigned_reseller_id ?? null))) {
    throw new Error("The selected package does not belong to the reseller assigned to this service.");
  }
  if (!port?.assigned_reseller_id) return null;
  if (!planBelongsToOwner({ owner_reseller_id: planOwnerId }, port.assigned_reseller_id)) {
    throw new Error("The selected package does not belong to the reseller assigned to this service.");
  }
  if (port.status !== "active" || port.link_status !== "active") {
    throw new Error("This reseller link is not active for checkout.");
  }

  const [route, sharedCallbackSettings, legacyRows, legacyAccountRows] = await Promise.all([
    resolveResellerGatewayRoute(adminId, port.assigned_reseller_id, routerId, portId),
    getMpesaSettings(),
    sbSelectStrict<{
      gateway_type: string;
      merchant_identifier: string | null;
      account_reference: string | null;
      config_json: unknown;
      is_active: boolean;
    }>(
      "payment_gateways",
      `user_id=eq.${port.assigned_reseller_id}&gateway_type=in.(mpesa,bank)&select=gateway_type,merchant_identifier,account_reference,config_json,is_active`,
    ),
    sbSelectStrict<{ payment_gateway: string | null; payment_gateway_config?: unknown }>(
      "isp_admins",
      `id=eq.${port.assigned_reseller_id}&role=eq.reseller&select=payment_gateway,payment_gateway_config&limit=1`,
    ),
  ]);
  const legacyMpesa = legacyRows.find(row => row.gateway_type === "mpesa");
  const legacyBank = legacyRows.find(row => row.gateway_type === "bank");
  const legacyConfig = (row: typeof legacyRows[number] | undefined): Record<string, unknown> =>
    row?.config_json && typeof row.config_json === "object" && !Array.isArray(row.config_json)
      ? row.config_json as Record<string, unknown>
      : {};
  const legacyMpesaConfig = legacyConfig(legacyMpesa);
  const legacyBankConfig = legacyConfig(legacyBank);
  const legacyPaymentGateway = getPaymentGateway(legacyAccountRows[0]?.payment_gateway);
  const resellerGatewayConfigs = gatewayConfigMap(legacyAccountRows[0]?.payment_gateway_config);
  const resellerSharedConfig = collectionConfig(
    legacyPaymentGateway,
    resellerGatewayConfigs[legacyPaymentGateway],
  );
  const hasSharedDestination = isGatewayConfigComplete(legacyPaymentGateway, resellerSharedConfig);
  const hasLegacyDestination = legacyPaymentGateway === "mpesa_till_push"
    ? legacyMpesa?.is_active === true && !!legacyMpesa.merchant_identifier
    : legacyPaymentGateway === "bank_stk_push"
      ? legacyBank?.is_active === true
        && !!(legacyBank.merchant_identifier || bankBusinessNumberFor(legacyBankConfig.bankName))
        && !!legacyBank.account_reference
      : legacyPaymentGateway === "mpesa_paybill"
        ? legacyMpesa?.is_active === true && !!legacyMpesa.merchant_identifier && !!legacyMpesa.account_reference
        : false;
  const paymentGateway = (route?.gateway_type
    ?? (hasLegacyDestination || hasSharedDestination ? legacyPaymentGateway : "unconfigured")) as PaymentGateway;
  const routeConfig = route?.config ?? {};
  const legacyMpesaPaybill: MpesaPaybillConfig = legacyMpesa?.is_active === true
    ? {
        paybillNumber: legacyMpesa.merchant_identifier ?? "",
        accountNumber: legacyMpesa.account_reference ?? "",
      }
    : { paybillNumber: "", accountNumber: "" };
  const routeMpesaPaybill = resellerRouteMpesaPaybillConfig(routeConfig);
  const bankStkPush = route
    ? bankStkPushConfig({ bank_stk_push: routeConfig })
    : hasLegacyDestination && legacyPaymentGateway === "bank_stk_push"
      ? bankStkPushConfig({
          bank_stk_push: {
            bankName: legacyBankConfig.bankName,
            paybillNumber: legacyBank?.merchant_identifier ?? "",
            accountNumber: legacyBank?.account_reference ?? "",
          },
        })
      : legacyPaymentGateway === "bank_stk_push" && hasSharedDestination
        ? bankStkPushConfig({ bank_stk_push: resellerSharedConfig })
        : bankStkPushConfig({});
  const mpesaTillPush = route
    ? resellerRouteMpesaTillConfig(routeConfig)
    : hasLegacyDestination && legacyPaymentGateway === "mpesa_till_push"
      ? { tillNumber: legacyMpesa?.merchant_identifier ?? "" }
      : legacyPaymentGateway === "mpesa_till_push" && hasSharedDestination
        ? { tillNumber: resellerSharedConfig.tillNumber ?? "" }
        : { tillNumber: "" };
  const mpesaPaybill = route
    ? {
        /* A scoped route remains authoritative for gateway selection and
           scope. If its destination was saved through the legacy reseller
           settings screen, complete the missing fields from that same
           reseller's active destination rather than the ISP's settings. */
        paybillNumber: routeMpesaPaybill.paybillNumber || legacyMpesaPaybill.paybillNumber,
        accountNumber: routeMpesaPaybill.accountNumber || legacyMpesaPaybill.accountNumber,
      }
    : hasLegacyDestination && legacyPaymentGateway === "mpesa_paybill"
      ? {
          paybillNumber: legacyMpesa?.merchant_identifier ?? "",
          accountNumber: legacyMpesa?.account_reference ?? "",
        }
      : legacyPaymentGateway === "mpesa_paybill" && hasSharedDestination
        ? {
            paybillNumber: resellerSharedConfig.paybillNumber ?? "",
            accountNumber: resellerSharedConfig.accountNumber ?? "",
          }
        : { paybillNumber: "", accountNumber: "" };
  const destination = paymentGateway === "mpesa_till_push"
    ? {
        merchantIdentifier: mpesaTillPush.tillNumber,
        accountReference: "",
        destinationType: "till" as const,
      }
    : paymentGateway === "bank_stk_push"
      ? {
          merchantIdentifier: bankStkPush.paybillNumber,
          accountReference: bankStkPush.accountNumber,
          destinationType: "paybill" as const,
        }
      : {
          merchantIdentifier: mpesaPaybill.paybillNumber,
          accountReference: mpesaPaybill.accountNumber,
          destinationType: "paybill" as const,
        };
  if (!destination.merchantIdentifier
    || (destination.destinationType === "paybill" && !destination.accountReference)) {
    throw new Error("Complete your reseller payment gateway destination before accepting reseller payments.");
  }

  return {
    resellerId: port.assigned_reseller_id,
    portId,
    gatewayRouteId: route?.id ?? null,
    gatewayConfigCiphertext: route?.config_ciphertext ?? encryptGatewayConfig(resellerSharedConfig),
    paymentGateway,
    settings: resellerDarajaSettings(
      routeConfig && Object.keys(routeConfig).length > 0 ? routeConfig : resellerSharedConfig,
      sharedCallbackSettings.callbackUrl,
    ),
    bankStkPush,
    mpesaTillPush,
    mpesaPaybill,
    merchantIdentifier: destination.merchantIdentifier,
    accountReference: destination.accountReference,
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

function hotspotPoolRanges(subnetRange: string | null | undefined, portId: number): string {
  const match = String(subnetRange ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)\.0\/24$/);
  const octets = match
    ? match.slice(1).map(Number)
    : [192, 168, 180 + ((Math.max(1, portId) - 1) % 4)];
  return `${octets[0]}.${octets[1]}.${octets[2]}.10-${octets[0]}.${octets[1]}.${octets[2]}.254`;
}

type HotspotPortContext = Pick<
  PortServiceResourceInput,
  "id" | "router_id" | "interface_name" | "bridge_name" | "handoff_mode"
    | "reseller_id" | "assigned_reseller_id" | "vlan_tag"
> & {
  hotspot_enabled: boolean;
  subnet_range: string | null;
  status: string;
  link_status: string | null;
};

export async function loadHotspotPortContext(
  adminId: number,
  routerId: number,
  portId: number | null,
  expectedResellerId?: number,
): Promise<HotspotPortContext | null> {
  if (!portId) return null;
  const assignedResellerFilter = expectedResellerId === undefined
    ? ""
    : `&assigned_reseller_id=eq.${expectedResellerId}&handoff_mode=eq.vlan_services&status=eq.active&link_status=eq.active&hotspot_enabled=is.true`;
  const rows = await sbSelectStrict<HotspotPortContext>(
    "isp_reseller_ports",
    `id=eq.${portId}&admin_id=eq.${adminId}&router_id=eq.${routerId}${assignedResellerFilter}&select=id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,hotspot_enabled,subnet_range,status,link_status&limit=1`,
  );
  const port = rows[0];
  if (!port && expectedResellerId !== undefined) {
    throw new Error("The reseller Hotspot port assignment changed before activation.");
  }
  if (!port || port.status === "disabled" || !port.hotspot_enabled) {
    throw new Error("The selected Hotspot port is not deployed or enabled.");
  }
  if (expectedResellerId !== undefined && (
    port.assigned_reseller_id !== expectedResellerId
    || port.handoff_mode !== "vlan_services"
    || port.status !== "active"
    || port.link_status !== "active"
  )) {
    throw new Error("The reseller Hotspot port assignment changed before activation.");
  }
  return port;
}

function positivePortalId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function planMatchesHotspotPortalScope(
  adminId: number,
  plan: { router_id: number | null; port_id: number | null; owner_reseller_id?: number | null },
  requestedRouterId: unknown,
  requestedPortId: unknown,
): Promise<boolean> {
  const routerId = positivePortalId(requestedRouterId);
  const portId = positivePortalId(requestedPortId);
  const hasRouterValue = requestedRouterId !== undefined && requestedRouterId !== null && requestedRouterId !== "";
  const hasPortValue = requestedPortId !== undefined && requestedPortId !== null && requestedPortId !== "";
  if (hasRouterValue && routerId === null) return false;
  if (hasPortValue && portId === null) return false;
  if (!plan.router_id || (routerId !== null && routerId !== plan.router_id)) return false;
  if (plan.port_id === null) return portId === null && planBelongsToOwner(plan, null);
  if (portId === null || plan.port_id !== portId || routerId === null) return false;
  const ports = await sbSelect<{ id: number; assigned_reseller_id: number | null }>(
    "isp_reseller_ports",
    `id=eq.${portId}&admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&status=neq.disabled&hotspot_enabled=is.true&select=id,assigned_reseller_id&limit=1`,
  );
  return !!ports[0] && planBelongsToOwner(plan, ports[0].assigned_reseller_id ?? null);
}

async function loadTenantCompanyName(adminId: number): Promise<string | null> {
  const rows = await sbSelect<{ name: string | null }>(
    "isp_admins",
    `id=eq.${adminId}&select=name&limit=1`,
  );
  return rows[0]?.name ?? null;
}

export function hotspotPortResources(
  port: HotspotPortContext,
  options: { companyName?: string | null; routerName?: string | null } = {},
): {
  serverName: string;
  poolName: string;
  poolRanges: string;
} {
  const resources = portServiceResourceNames(port, options);
  return {
    serverName: resources.hotspotServer,
    poolName: resources.hotspotPool,
    poolRanges: hotspotPoolRanges(port.subnet_range, port.id),
  };
}

type VlanPaymentPlan = {
  router_id: number | null;
  port_id: number | null;
  owner_reseller_id: number | null;
};

async function validateVlanPaymentCustomer(
  adminId: number,
  plan: VlanPaymentPlan,
  customerId: number,
): Promise<{ customer: { id: number; type: string; ip_address: string; router_id: number | null; port_id: number | null } | null; error?: string }> {
  if (!plan.router_id || !plan.port_id) {
    return { customer: null, error: "The VLAN plan is not assigned to a router and service port." };
  }
  const customers = await sbSelectStrict<{
    id: number;
    type: string;
    ip_address: string | null;
    router_id: number | null;
    port_id: number | null;
  }>(
    "isp_customers",
    `id=eq.${customerId}&admin_id=eq.${plan.owner_reseller_id ?? adminId}&type=eq.vlan&select=id,type,ip_address,router_id,port_id&limit=1`,
  );
  const customer = customers[0];
  if (!customer || !isValidIpv4(customer.ip_address)) {
    return { customer: null, error: "The verified VLAN customer account or its assigned static IP was not found." };
  }
  if (
    (customer.router_id && customer.router_id !== plan.router_id)
    || (customer.port_id && customer.port_id !== plan.port_id)
  ) {
    return { customer: null, error: "The VLAN customer router and port do not match the selected plan." };
  }
  const ports = await sbSelectStrict<{
    id: number;
    router_id: number;
    interface_name: string;
    bridge_name: string | null;
    handoff_mode: string | null;
    reseller_id: number | null;
    assigned_reseller_id: number | null;
    vlan_tag: string | null;
    subnet_range: string | null;
  }>(
    "isp_reseller_ports",
    `id=eq.${plan.port_id}&admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,router_id,interface_name,bridge_name,handoff_mode,reseller_id,assigned_reseller_id,vlan_tag,subnet_range&limit=1`,
  );
  const port = ports[0];
  if (
    !port
    || !isValidVlanTag(port.vlan_tag)
    || !planBelongsToOwner(plan, port.assigned_reseller_id ?? null)
    || !ipv4InSubnet(customer.ip_address, port.subnet_range)
  ) {
    return { customer: null, error: "The VLAN service port, tag, or assigned customer IP is no longer valid." };
  }
  return { customer: { ...customer, ip_address: customer.ip_address } };
}

/**
 * PPPoE purchases must be tied to the same VLAN service as the package.  A
 * customer/router match alone is not sufficient: two reseller services can
 * share a MikroTik router, so an omitted port would allow cross-reseller
 * package assignment.
 */
async function validatePppoePaymentCustomer(
  adminId: number,
  plan: VlanPaymentPlan,
  customerId: number,
): Promise<{ customer: { id: number; admin_id: number; router_id: number | null; port_id: number | null } | null; error?: string }> {
  if (!plan.router_id || !plan.port_id) {
    return { customer: null, error: "The PPPoE plan is not assigned to a router and service port." };
  }
  const customers = await sbSelectStrict<{
    id: number;
    admin_id: number;
    router_id: number | null;
    port_id: number | null;
  }>(
    "isp_customers",
    `id=eq.${customerId}&admin_id=eq.${plan.owner_reseller_id ?? adminId}&type=eq.pppoe&select=id,admin_id,router_id,port_id&limit=1`,
  );
  const customer = customers[0];
  if (!customer) {
    return { customer: null, error: "The verified PPPoE customer account was not found." };
  }
  if (customer.router_id !== plan.router_id || customer.port_id !== plan.port_id) {
    return { customer: null, error: "The PPPoE customer service port does not match the selected package." };
  }
  const ports = await sbSelectStrict<{
    id: number;
    assigned_reseller_id: number | null;
    status: string;
    link_status: string | null;
  }>(
    "isp_reseller_ports",
    `id=eq.${plan.port_id}&admin_id=eq.${adminId}&router_id=eq.${plan.router_id}&handoff_mode=eq.vlan_services&status=neq.disabled&select=id,assigned_reseller_id,status,link_status&limit=1`,
  );
  const port = ports[0];
  if (!port || port.status !== "active" || port.link_status !== "active"
    || !planBelongsToOwner(plan, port.assigned_reseller_id ?? null)) {
    return { customer: null, error: "The PPPoE service port is no longer assigned to the selected package owner." };
  }
  return { customer };
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
  reseller_id: number | null;
  reseller_port_id: number | null;
  amount: number;
  payment_method: string;
  payment_metadata?: unknown;
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
  getSettings: (transaction?: PendingMpesaTransaction) => Promise<MpesaSettings>;
  verifyStk: (settings: MpesaSettings, checkoutId: string) => Promise<DarajaStkQuery>;
  reactivatePppoeAccess: (opts: {
    adminId: number;
    customerId: number;
    planId: number;
    reference: string;
  }) => Promise<{ ok: boolean; skipped?: boolean; rollback?: () => Promise<void>; error?: string }>;
  reactivateVlanAccess: (opts: {
    adminId: number;
    customerId: number;
    planId: number;
    reference: string;
  }) => Promise<{
    ok: boolean;
    skipped?: boolean;
    expiresAt?: string;
    routerId?: number;
    portId?: number;
    rollback?: () => Promise<void>;
    error?: string;
  }>;
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
    getSettings: async transaction => {
      const metadata = transaction?.payment_metadata;
      const fields = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {};
      const source = String(fields.source ?? "");
      if (source === "reseller_gateway_test" || source === "reseller_daraja_bridge") {
        const configCiphertext = typeof fields.resellerGatewayConfigCiphertext === "string"
          ? fields.resellerGatewayConfigCiphertext
          : "";
        if (!configCiphertext) {
          throw new Error("This reseller payment has no saved reseller-owned gateway credential snapshot.");
        }
        const [config, platformSettings] = await Promise.all([
          Promise.resolve(decryptGatewayConfig(configCiphertext)),
          getMpesaSettings(),
        ]);
        return resellerDarajaSettings(config, platformSettings.callbackUrl);
      }
      return getMpesaSettings();
    },
    verifyStk: queryDarajaStkResult,
    reactivatePppoeAccess,
    reactivateVlanAccess,
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
    `reference=eq.${encodeURIComponent(checkoutId)}&status=eq.pending&select=id,admin_id,customer_id,plan_id,reseller_id,reseller_port_id,amount,payment_method,payment_phone,mac_address&limit=1`,
  );
  const transaction = pendingRows[0];
  if (!transaction) {
    logger.warn({ checkoutId, MerchantRequestID }, "[mpesa/callback] Callback awaits local checkout reconciliation");
    return false;
  }

  const settings = await dependencies.getSettings(transaction);
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
  let rollbackVlanAccess: (() => Promise<void>) | undefined;
  let vlanRenewalExpiry: string | undefined;
  let vlanRenewalRouterId: number | undefined;
  let vlanRenewalPortId: number | undefined;
  let routerPendingFailure: string | undefined;
  if (isSuccessful && transaction.admin_id && transaction.customer_id && transaction.plan_id) {
    const pppoeAccess = await dependencies.reactivatePppoeAccess({
      adminId: transaction.admin_id,
      customerId: transaction.customer_id,
      planId: transaction.plan_id,
      reference: checkoutId,
    });
    if (!pppoeAccess.ok && !pppoeAccess.skipped) {
      const diagnosis = logRouterConnectionFailure(
        pppoeAccess.error ?? "RouterOS PPPoE activation failed.",
        {
          checkoutId,
          adminId: transaction.admin_id,
          customerId: transaction.customer_id,
          planId: transaction.plan_id,
        },
        "[mpesa/callback] RouterOS activation deferred after payment",
      );
      routerPendingFailure = `${diagnosis.userMessage} Retry the account setup after the router-management VPN is online.`;
    }
    rollbackPppoeAccess = pppoeAccess.rollback;
    const vlanAccess = await dependencies.reactivateVlanAccess({
      adminId: transaction.admin_id,
      customerId: transaction.customer_id,
      planId: transaction.plan_id,
      reference: checkoutId,
    });
    if (!vlanAccess.ok && !vlanAccess.skipped) {
      const diagnosis = logRouterConnectionFailure(
        vlanAccess.error ?? "RouterOS VLAN activation failed.",
        {
          checkoutId,
          adminId: transaction.admin_id,
          customerId: transaction.customer_id,
          planId: transaction.plan_id,
        },
        "[mpesa/callback] RouterOS VLAN activation deferred after payment",
      );
      routerPendingFailure = `${diagnosis.userMessage} Retry the account setup after the router-management VPN is online.`;
    }
    rollbackVlanAccess = vlanAccess.rollback;
    if (vlanAccess.ok && !vlanAccess.skipped) {
      vlanRenewalExpiry = vlanAccess.expiresAt;
      vlanRenewalRouterId = vlanAccess.routerId;
      vlanRenewalPortId = vlanAccess.portId;
    }
  }
  if (isSuccessful && routerPendingFailure) {
    logger.warn(
      { checkoutId, transactionId: transaction.id, customerId: transaction.customer_id, error: routerPendingFailure },
      "[mpesa/callback] Payment remains pending until RouterOS access can be restored",
    );
    return false;
  }
  let settlements: SettlementResult[];
  try {
    settlements = await dependencies.settle({
      p_transaction_id: transaction.id,
      p_status: isSuccessful ? "completed" : "failed",
      p_note: isSuccessful
        ? routerPendingFailure
          ? `M-Pesa payment verified by Daraja; RouterOS activation pending. ${routerPendingFailure}`
          : "M-Pesa payment verified by Daraja."
        : `Daraja ResultCode ${verification.resultCode}: ${verification.resultDesc || String(ResultDesc ?? "Payment failed")}`,
    });
  } catch (error) {
    if (rollbackPppoeAccess) {
      await rollbackPppoeAccess().catch(rollbackError => {
        logger.error({ err: rollbackError, checkoutId }, "[mpesa/callback] PPPoE access rollback failed");
      });
    }
    if (rollbackVlanAccess) {
      await rollbackVlanAccess().catch(rollbackError => {
        logger.error({ err: rollbackError, checkoutId }, "[mpesa/callback] VLAN access rollback failed");
      });
    }
    throw error;
  }
  const settlement = settlements[0];
  if (!settlement?.settled) {
    if (rollbackPppoeAccess) await rollbackPppoeAccess().catch(error => logger.error({ err: error, checkoutId }, "[mpesa/callback] PPPoE access rollback failed"));
    if (rollbackVlanAccess) await rollbackVlanAccess().catch(error => logger.error({ err: error, checkoutId }, "[mpesa/callback] VLAN access rollback failed"));
    logger.info({ checkoutId }, "[mpesa/callback] Callback replay ignored after state transition");
    return false;
  }

  if (isSuccessful && vlanRenewalExpiry && transaction.admin_id && transaction.customer_id) {
    try {
      const updated = await sbUpdateStrict(
        "isp_customers",
         `id=eq.${transaction.customer_id}&admin_id=eq.${transaction.reseller_id ?? transaction.admin_id}&type=eq.vlan`,
        {
          status: "active",
          expires_at: vlanRenewalExpiry,
          router_id: vlanRenewalRouterId,
          port_id: vlanRenewalPortId,
          updated_at: new Date().toISOString(),
        },
      );
      if (!updated.length) throw new Error("The VLAN customer record was not updated after payment settlement.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, checkoutId, customerId: transaction.customer_id }, "[mpesa/callback] VLAN renewal status persistence failed");
      try {
        await markPaymentClearedRouterPending({
          transactionId: transaction.id,
          adminId: transaction.admin_id,
          customerAdminId: transaction.reseller_id ?? transaction.admin_id,
          customerId: transaction.customer_id,
          failureMessage: `VLAN access was renewed but its expiry could not be saved: ${message}`,
        });
      } catch (stateError) {
        logger.error({ err: stateError, checkoutId, customerId: transaction.customer_id }, "[mpesa/callback] Could not persist VLAN renewal pending status");
      }
    }
  }

  if (isSuccessful && routerPendingFailure && transaction.admin_id && transaction.customer_id) {
    try {
      await markPaymentClearedRouterPending({
        transactionId: transaction.id,
        adminId: transaction.admin_id,
        customerId: transaction.customer_id,
        failureMessage: routerPendingFailure,
      });
    } catch (error) {
      logger.error(
        { err: error, checkoutId, transactionId: transaction.id, customerId: transaction.customer_id },
        "[mpesa/callback] Could not persist payment_cleared_router_pending status",
      );
    }
  }

  if (isSuccessful && settlement.payment_method === "mpesa_registration") {
    logger.info({ adminId: settlement.admin_id, checkoutId }, "[mpesa/callback] ISP registration activated");
    if (settlement.admin_id) {
      void sendRegistrationConfirmationEmail(settlement.admin_id);
      void provisionTenantCertificateForAdmin(settlement.admin_id).catch(error => {
        logger.error({ err: error, adminId: settlement.admin_id }, "[registration] immediate tenant certificate provisioning failed; timer will retry");
      });
    }
  } else if (isSuccessful) {
    logger.info({ customerId: settlement.credited_customer_id, checkoutId, amount: settlement.amount }, "[mpesa/callback] Payment settled atomically");
  }
  return true;
}

export interface DeferredMpesaCallbackEvent {
  id: number;
  payload: unknown;
  created_at: string;
}

export interface DeferredMpesaCallbackDependencies {
  select: (filter: string) => Promise<DeferredMpesaCallbackEvent[]>;
  update: (filter: string, values: { status: "processed" | "ignored" }) => Promise<unknown>;
  purgeTerminal: (filter: string) => Promise<unknown>;
  processCallback: (payload: unknown) => Promise<boolean>;
  now: () => number;
}

export async function processDeferredMpesaCallbacks(
  checkoutId?: string,
  overrides: Partial<DeferredMpesaCallbackDependencies> = {},
): Promise<void> {
  const dependencies: DeferredMpesaCallbackDependencies = {
    select: filter => sbSelect<DeferredMpesaCallbackEvent>("isp_webhook_events", filter),
    update: (filter, values) => sbUpdate("isp_webhook_events", filter, values),
    purgeTerminal: filter => sbDelete("isp_webhook_events", filter),
    processCallback: payload => processMpesaCallback(payload),
    now: Date.now,
    ...overrides,
  };
  const now = dependencies.now();
  const horizon = new Date(now - CALLBACK_MAX_AGE_MS).toISOString();

  if (checkoutId) {
    const events = await dependencies.select(
      `gateway=eq.mpesa&status=eq.received&reference=eq.${encodeURIComponent(checkoutId)}&select=id,payload,created_at&order=created_at.asc&limit=1`,
    );
    for (const event of events) {
      if (!Number.isFinite(Date.parse(event.created_at)) || now - Date.parse(event.created_at) > CALLBACK_MAX_AGE_MS) {
        await dependencies.update(`id=eq.${event.id}&status=eq.received`, { status: "ignored" });
      } else if (await dependencies.processCallback(event.payload)) {
        await dependencies.update(`id=eq.${event.id}&status=eq.received`, { status: "processed" });
      }
    }
    return;
  }

  const activeCutoff = new Date(now - CALLBACK_RECONCILIATION_WINDOW_MS).toISOString();
  const freshEvents = await dependencies.select(
    `gateway=eq.mpesa&status=eq.received&created_at=gte.${encodeURIComponent(activeCutoff)}&select=id,payload,created_at&order=created_at.asc&limit=${CALLBACK_SCAN_BATCH_SIZE}`,
  );
  for (const event of freshEvents) {
    if (await dependencies.processCallback(event.payload)) {
      await dependencies.update(`id=eq.${event.id}&status=eq.received`, { status: "processed" });
    }
  }

  // Scan older callbacks independently from fresh traffic. The advancing ID
  // cursor lets repeated failures elsewhere in the old-event set make progress
  // without consuming the fresh-event batch on every timer tick.
  const olderEvents = await dependencies.select(
    `gateway=eq.mpesa&status=eq.received&created_at=gte.${encodeURIComponent(horizon)}&created_at=lt.${encodeURIComponent(activeCutoff)}&id=gt.${deferredCallbackOlderIdCursor}&select=id,payload,created_at&order=id.asc&limit=${CALLBACK_SCAN_BATCH_SIZE}`,
  );
  if (olderEvents.length) {
    deferredCallbackOlderIdCursor = olderEvents[olderEvents.length - 1].id;
    for (const event of olderEvents) {
      if (await dependencies.processCallback(event.payload)) {
        await dependencies.update(`id=eq.${event.id}&status=eq.received`, { status: "processed" });
      }
    }
  } else {
    deferredCallbackOlderIdCursor = 0;
  }

  // Retire expired received callbacks in a bounded batch instead of letting
  // them accumulate indefinitely. The status predicate also protects terminal
  // records if their state changes between selection and update.
  const expiredEvents = await dependencies.select(
    `gateway=eq.mpesa&status=eq.received&created_at=lt.${encodeURIComponent(horizon)}&id=gt.${deferredCallbackExpiredIdCursor}&select=id,created_at&order=id.asc&limit=${CALLBACK_SCAN_BATCH_SIZE}`,
  );
  if (expiredEvents.length) {
    deferredCallbackExpiredIdCursor = expiredEvents[expiredEvents.length - 1].id;
    for (const event of expiredEvents) {
      await dependencies.update(`id=eq.${event.id}&status=eq.received`, { status: "ignored" });
    }
  } else {
    deferredCallbackExpiredIdCursor = 0;
  }

  if (now - lastCallbackPurgeAt >= 60 * 60 * 1000) {
    lastCallbackPurgeAt = now;
    const retentionCutoff = new Date(now - CALLBACK_EVENT_RETENTION_MS).toISOString();
    await dependencies.purgeTerminal(
      `gateway=eq.mpesa&status=in.(processed,ignored)&created_at=lt.${encodeURIComponent(retentionCutoff)}`,
    );
  }
}

setInterval(() => {
  void processDeferredMpesaCallbacks().catch(err => logger.error({ err }, "[mpesa/callback] Deferred callback retry failed"));
}, 60_000).unref();

type ResellerMpesaTestAccount = {
  id: number;
  parent_id: number;
  role: string;
  is_active: boolean;
};

async function resellerMpesaTestAccountFromRequest(req: Request): Promise<ResellerMpesaTestAccount | null> {
  const token = validateToken(extractToken(req));
  if (!token || token.type !== "a" || !/^[1-9]\d*$/.test(token.uid)) return null;
  const id = Number(token.uid);
  if (!Number.isSafeInteger(id)) return null;
  const accounts = await sbSelect<ResellerMpesaTestAccount>(
    "isp_admins",
    `id=eq.${id}&role=eq.reseller&is_active=eq.true&select=id,parent_id,role,is_active&limit=1`,
  );
  const account = accounts[0];
  return account && Number.isSafeInteger(account.parent_id) && account.parent_id > 0
    ? account
    : null;
}

router.post("/mpesa/reseller-test", async (req: Request, res: Response): Promise<void> => {
  const account = await resellerMpesaTestAccountFromRequest(req);
  if (!account) {
    res.status(401).json({ ok: false, error: "Sign in to a connected reseller account to test its payment gateway." });
    return;
  }

  const routeId = Number(req.body?.routeId);
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(routeId) || routeId <= 0) {
    res.status(400).json({ ok: false, error: "Choose a saved reseller payment route." });
    return;
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000) {
    res.status(400).json({ ok: false, error: "Enter a test amount from 1 to 1,000." });
    return;
  }
  const normalised = normaliseKenyanPhone(String(req.body?.phone ?? ""));
  if (!/^254\d{9}$/.test(normalised)) {
    res.status(400).json({ ok: false, error: "Enter a valid Kenyan M-Pesa phone number." });
    return;
  }
  if (!allowStkRequest(req, account.id, normalised)) {
    res.status(429).json({ ok: false, error: "Too many payment prompts. Please wait before trying again." });
    return;
  }

  let transactionId: number | null = null;
  try {
    const routes = await sbSelectStrict<ResellerGatewayRouteRow>(
      "reseller_payment_gateway_routes",
      `id=eq.${routeId}&admin_id=eq.${account.parent_id}&reseller_id=eq.${account.id}&select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_ciphertext,config_preview,is_active&limit=1`,
    );
    const route = routes[0];
    if (!route) {
      res.status(404).json({ ok: false, error: "That M-Pesa route was not added to this reseller account." });
      return;
    }
    if (route.gateway_type !== "mpesa_paybill" && route.gateway_type !== "mpesa_till_push") {
      res.status(409).json({ ok: false, error: "Reseller payment tests currently support M-Pesa PayBill and Till only." });
      return;
    }

    const config = decryptGatewayConfig(route.config_ciphertext);
    if (!resellerDestinationConfigured(route.gateway_type, config)) {
      res.status(400).json({ ok: false, error: "Complete and save this reseller’s M-Pesa collection details before testing." });
      return;
    }
    const platformSettings = await getMpesaSettings();
    const settings = resellerDarajaSettings(config, platformSettings.callbackUrl);
    if (!isMpesaConfigured(settings)) {
      res.status(400).json({ ok: false, error: "Save this reseller’s own Daraja Business Shortcode, Consumer Key, Consumer Secret, and Passkey before testing." });
      return;
    }
    if (!supabaseServiceRoleConfigured) {
      res.status(503).json({ ok: false, error: "Live M-Pesa payment testing is unavailable in this preview." });
      return;
    }
    const resolvedCallbackUrl = callbackUrl(settings);
    if (!hasValidCallbackUrl(resolvedCallbackUrl)) {
      res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL before testing." });
      return;
    }

    const till = resellerRouteMpesaTillConfig(config);
    const paybill = resellerRouteMpesaPaybillConfig(config);
    const payment = resolveDarajaPayment(
      route.gateway_type,
      settings,
      { bankName: "", paybillNumber: "", accountNumber: "" },
      till,
      paybill,
    );
    if (!payment.destination) {
      res.status(400).json({ ok: false, error: "The reseller M-Pesa destination is incomplete." });
      return;
    }

    const created = await sbInsertStrict<{ id: number }>("isp_transactions", {
      admin_id: account.parent_id,
      reseller_id: account.id,
      reseller_port_id: route.port_id,
      amount,
      payment_method: "mpesa",
      payment_phone: normalised,
      payment_metadata: {
        source: "reseller_gateway_test",
        gatewayType: route.gateway_type,
        routeId: route.id,
        routeScope: route.port_id !== null ? "port" : route.router_id !== null ? "router" : "default",
        destinationType: route.gateway_type === "mpesa_till_push" ? "till" : "paybill",
        merchantIdentifier: payment.destination,
        accountReference: payment.accountReference ?? "",
        resellerGatewayConfigCiphertext: route.config_ciphertext,
      },
      reference: `initiating:${randomUUID()}`,
      status: "initiating",
      notes: `Reseller M-Pesa gateway test prompt is being created for ${normalised}`,
      created_at: new Date().toISOString(),
    });
    const transaction = created[0];
    if (!transaction) {
      res.status(503).json({ ok: false, error: "Could not safely create the test payment request. Please try again." });
      return;
    }
    transactionId = transaction.id;

    const token = await getDarajaToken(settings);
    const { timestamp, password } = stkCredentials(payment.businessShortcode, settings.passkey);
    const response = await fetch(`${darajaBase(settings)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: payment.businessShortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: route.gateway_type === "mpesa_till_push" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
        Amount: amount,
        PartyA: normalised,
        PartyB: payment.destination,
        PhoneNumber: normalised,
        CallBackURL: resolvedCallbackUrl,
        AccountReference: payment.accountReference ?? "ResellerTest",
        TransactionDesc: "Reseller M-Pesa gateway test",
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.ResponseCode !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${transaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `Reseller STK test prompt failed: ${String(data.errorMessage ?? data.ResponseDescription ?? "Unknown error")}`,
      });
      res.status(400).json({ ok: false, error: String(data.errorMessage ?? data.ResponseDescription ?? "M-Pesa could not send the test prompt.") });
      return;
    }

    const checkoutId = String(data.CheckoutRequestID ?? "");
    const reconciled = checkoutId && await reconcileInitiatedStkRequest(
      transaction.id,
      checkoutId,
      String(data.MerchantRequestID ?? ""),
      `Reseller M-Pesa test prompt to ${normalised}`,
    );
    if (!reconciled) {
      logger.error({ checkoutId, transactionId: transaction.id }, "[mpesa/reseller-test] Could not reconcile initiated test transaction");
      res.status(502).json({
        ok: false,
        error: "The prompt was sent but confirmation tracking could not be saved. Do not retry until you check M-Pesa.",
        CheckoutRequestID: checkoutId,
        environment: settings.env,
        shortcode: settings.shortcode,
      });
      return;
    }
    await processDeferredMpesaCallbacks(checkoutId).catch(error => {
      logger.warn({ err: error, checkoutId }, "[mpesa/reseller-test] Immediate callback reconciliation deferred");
    });
    res.json({
      ok: true,
      CheckoutRequestID: checkoutId,
      MerchantRequestID: String(data.MerchantRequestID ?? ""),
      environment: settings.env,
      shortcode: settings.shortcode,
      destinationType: route.gateway_type === "mpesa_till_push" ? "till" : "paybill",
    });
  } catch (error) {
    if (transactionId !== null) {
      await sbUpdate("isp_transactions", `id=eq.${transactionId}&status=eq.initiating`, {
        status: "failed",
        notes: "Reseller M-Pesa test prompt could not be created.",
      }).catch(() => undefined);
    }
    logger.error({ err: error, resellerId: account.id, routeId }, "[mpesa/reseller-test] Test prompt failed");
    res.status(500).json({ ok: false, error: "Could not create the reseller M-Pesa test prompt." });
  }
});

/**
 * Return named devices currently visible on this ISP's hotspot routers.
 * Router credentials stay server-side; the portal receives only the client
 * identity data needed to choose a TV or streaming device.
 */
router.get("/mpesa/hotspot-devices", async (req: Request, res: Response): Promise<void> => {
  const portalScope = req.hotspotPortalContext;
  const adminId = portalScope?.adminId ?? await resolvePortalAdminId(req, req.query.adminId);
  const requestedRouterId = portalScope?.routerId ?? Number(req.query.routerId);
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

  let serviceSubnet: string | null = null;
  if (portalScope) {
    const ports = await sbSelectStrict<{
      id: number;
      subnet_range: string | null;
    }>(
      "isp_reseller_ports",
      `id=eq.${portalScope.portId}&admin_id=eq.${portalScope.adminId}&router_id=eq.${portalScope.routerId}&assigned_reseller_id=eq.${portalScope.resellerId}&handoff_mode=eq.vlan_services&status=eq.active&link_status=eq.active&hotspot_enabled=is.true&select=id,subnet_range&limit=1`,
    );
    serviceSubnet = ports[0]?.subnet_range ?? null;
    if (!serviceSubnet) {
      res.status(409).json({ ok: false, error: "The assigned Hotspot service subnet is unavailable." });
      return;
    }
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
        if (serviceSubnet && (!isValidIpv4(device.address) || !ipv4InSubnet(device.address, serviceSubnet))) continue;
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
  const portalRouterId = positivePortalId(req.body?.router_id);
  const portalPortId = positivePortalId(req.body?.port_id);
  const requestedService = req.body?.service_type === "pppoe"
    ? "pppoe"
    : req.body?.service_type === "vlan"
      ? "vlan"
      : "hotspot";
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
  const plans = await sbSelect<{
    id: number;
    price: number | string;
    type?: string;
    router_id: number | null;
    port_id: number | null;
    owner_reseller_id: number | null;
  }>(
    "isp_plans",
    `id=eq.${planId}&admin_id=eq.${adminId}&is_active=is.true&select=id,price,type,router_id,port_id,owner_reseller_id&limit=1`,
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
  if (plan && serviceType === "hotspot" && !await planMatchesHotspotPortalScope(adminId, plan, portalRouterId, portalPortId)) {
    res.status(409).json({ ok: false, error: "The selected package does not belong to this hotspot service." });
    return;
  }
  if (plan && Number.isSafeInteger(deviceRouterId) && deviceRouterId > 0 && plan.router_id !== deviceRouterId) {
    res.status(409).json({ ok: false, error: "Choose a package assigned to the selected device's router." });
    return;
  }
  if ((serviceType === "pppoe" || serviceType === "vlan") && (!Number.isSafeInteger(requestedCustomerId) || requestedCustomerId < 1)) {
    res.status(400).json({
      ok: false,
      error: serviceType === "vlan"
        ? "A verified VLAN customer account is required for this package."
        : "A verified PPPoE customer account is required for this package.",
    });
    return;
  }
  if (serviceType === "pppoe") {
    const validation = await validatePppoePaymentCustomer(adminId, plan!, requestedCustomerId);
    if (!validation.customer) {
      res.status(validation.error?.includes("not found") ? 404 : 409).json({
        ok: false,
        error: validation.error ?? "The PPPoE customer account is not valid for this package.",
      });
      return;
    }
  }
  if (serviceType === "vlan") {
    const validation = await validateVlanPaymentCustomer(adminId, plan!, requestedCustomerId);
    if (!validation.customer) {
      res.status(validation.error?.includes("not found") ? 404 : 409).json({
        ok: false,
        error: validation.error ?? "The VLAN customer account is not valid for this package.",
      });
      return;
    }
  }
  const amount = Math.ceil(Number(plan?.price));
  if (!plan || !Number.isFinite(amount) || amount <= 0) {
    res.status(404).json({ ok: false, error: "The selected plan is not available for payment." });
    return;
  }
  try {
    await getResellerPaymentRoute(adminId, planId);
  } catch (error) {
    res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "The reseller payment link is not active." });
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
        ...(portalRouterId ? { routerId: portalRouterId } : {}),
        ...(portalPortId ? { portId: portalPortId } : {}),
        ...(deviceName ? { deviceName } : {}),
        ...(serviceType === "pppoe" || serviceType === "vlan" ? { customerId: requestedCustomerId } : {}),
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
  const { phone, amount, account_ref, adminId, mac_address, plan_id, customer_id, reseller_id, port_id } = req.body as {
    phone?: string; amount?: number; account_ref?: string; adminId?: number; mac_address?: string;
    plan_id?: number; customer_id?: number; reseller_id?: number; port_id?: number;
  };
  const mac = readMacAddress(mac_address);

  // This legacy endpoint has no plan/customer/port binding and deliberately
  // uses the ISP's shared Daraja credentials. Never let it masquerade as a
  // reseller sale; reseller purchases must use /mpesa/intent or /mpesa/stk,
  // which perform package and service-owner validation.
  if ([plan_id, customer_id, reseller_id, port_id].some(value => value !== undefined && value !== null)) {
    res.status(409).json({
      ok: false,
      error: "The legacy STK endpoint cannot process reseller-scoped sales. Use the reseller package checkout flow.",
    });
    return;
  }

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
    const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = await getAdminPaymentSettings(
      scopedAdminId,
      "hotspot",
      { useSharedGateway: true },
    );
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
  const { phone, amount, plan_id, account_ref, adminId, paymentIntent, mac_address, service_type, customer_id, device_name, billing_invoice_id, router_id, port_id } = req.body as {
    phone?: string; amount?: number; plan_id?: number; account_ref?: string; adminId?: number; paymentIntent?: string; mac_address?: string; service_type?: string; customer_id?: number; device_name?: string; billing_invoice_id?: number; router_id?: number; port_id?: number;
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
  const portalRouterId = positivePortalId(router_id);
  const portalPortId = positivePortalId(port_id);
  const intent = typeof paymentIntent === "string" ? validatePaymentIntent(paymentIntent) : null;
  const mac = requestedMac.value ? requestedMac : readMacAddress(intent?.macAddress);
  const adminAuth = validateToken(extractToken(req));
  const hasAdminSession = !!adminAuth && adminAuth.type === "a" &&
    (adminAuth.uid === "superadmin" || Number(adminAuth.uid) === scopedAdminId);
  const superAdminToken = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  const hasSuperAdminSession = isActiveSuperAdminToken(superAdminToken);
  const requestedServiceType = service_type === "pppoe"
    ? "pppoe"
    : service_type === "vlan"
      ? "vlan"
      : "hotspot";
  const hasMatchingIntent = !!intent &&
    intent.adminId === scopedAdminId &&
    intent.planId === requestedPlanId &&
    intent.amount === requestedAmount &&
    intent.phone === normalised &&
    (intent.serviceType ?? "hotspot") === requestedServiceType &&
    (intent.customerId ?? null) === (Number.isSafeInteger(requestedCustomerId) ? requestedCustomerId : null) &&
    (intent.routerId ?? null) === portalRouterId &&
    (intent.portId ?? null) === portalPortId;
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
  const billingInvoiceId = Number(billing_invoice_id);
  let platformBillingInvoice: { id: number; account_id: number; amount_due: number | string; status: string } | null = null;
  if (billing_invoice_id !== undefined) {
    if (!Number.isSafeInteger(billingInvoiceId) || billingInvoiceId <= 0 || !hasAdminSession && !hasSuperAdminSession) {
      res.status(400).json({ ok: false, error: "A valid authenticated billing invoice is required." });
      return;
    }
    const invoiceRows = await billingSelect<{
      id: number;
      account_id: number;
      amount_due: number | string;
      status: string;
    }>(
      "platform_billing_invoices",
      `id=eq.${billingInvoiceId}&account_id=eq.${scopedAdminId}&select=id,account_id,amount_due,status&limit=1`,
    );
    platformBillingInvoice = invoiceRows[0] ?? null;
    if (!platformBillingInvoice || platformBillingInvoice.status === "paid") {
      res.status(409).json({ ok: false, error: "This platform billing invoice is already paid or unavailable." });
      return;
    }
    if (Math.ceil(Number(amount)) !== Math.ceil(Number(platformBillingInvoice.amount_due))) {
      res.status(400).json({ ok: false, error: "The payment amount does not match the billing invoice." });
      return;
    }
    if (!supabaseServiceRoleConfigured) {
      res.status(503).json({ ok: false, error: "Renewal payments are unavailable in this preview." });
      return;
    }
  }
  if (Number.isSafeInteger(requestedPlanId) && requestedPlanId > 0) {
    const plans = await sbSelect<{
      id: number;
      price: number | string;
      name: string;
      type?: string;
      router_id: number | null;
      port_id: number | null;
      owner_reseller_id: number | null;
    }>(
      "isp_plans",
      `id=eq.${requestedPlanId}&admin_id=eq.${scopedAdminId}&is_active=is.true&select=id,price,name,type,router_id,port_id,owner_reseller_id&limit=1`,
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
    if (serviceType === "hotspot" && !hasAdminSession && !await planMatchesHotspotPortalScope(scopedAdminId, plan, portalRouterId, portalPortId)) {
      res.status(409).json({ ok: false, error: "The selected package does not belong to this hotspot service." });
      return;
    }
    if (intent && (intent.serviceType ?? "hotspot") !== serviceType) {
      res.status(400).json({ ok: false, error: "The payment checkout service changed. Start the payment again." });
      return;
    }
    if (serviceType === "pppoe" || serviceType === "vlan") {
      if (!intent?.customerId || intent.customerId !== requestedCustomerId) {
        res.status(401).json({
          ok: false,
          error: serviceType === "vlan"
            ? "Create a new verified VLAN checkout before requesting payment."
            : "Create a new verified PPPoE checkout before requesting payment.",
        });
        return;
      }
      if (serviceType === "pppoe") {
        const validation = await validatePppoePaymentCustomer(scopedAdminId, plan, intent.customerId);
        if (!validation.customer) {
          res.status(validation.error?.includes("not found") ? 404 : 409).json({
            ok: false,
            error: validation.error ?? "The PPPoE customer account is not valid for this package.",
          });
          return;
        }
      } else {
        const validation = await validateVlanPaymentCustomer(scopedAdminId, plan, intent.customerId);
        if (!validation.customer) {
          res.status(validation.error?.includes("not found") ? 404 : 409).json({
            ok: false,
            error: validation.error ?? "The VLAN customer account is not valid for this package.",
          });
          return;
        }
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

  let resellerRoute: ResellerPaymentRoute | null = null;
  if (Number.isSafeInteger(requestedPlanId) && requestedPlanId > 0) {
    try {
      resellerRoute = await getResellerPaymentRoute(scopedAdminId, requestedPlanId);
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "The reseller payment link is not active." });
      return;
    }
  }
  const cfg = resellerRoute?.settings ?? await getMpesaSettings();
  if (!isMpesaConfigured(cfg)) {
    logger.warn("[mpesa/stk] M-Pesa credentials not configured — returning 503");
    res.status(503).json({
      ok: false,
      demo: true,
      error: resellerRoute
        ? "This reseller’s own Daraja credentials are incomplete. Ask the reseller to complete its Payment Gateways setup."
        : "M-Pesa is not configured. Ask the Super Admin to complete Payment Gateways.",
    });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  try {
      const serviceType = intent?.serviceType ?? requestedServiceType;
       const { paymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill } = resellerRoute
         ? resellerRoute
        : await getAdminPaymentSettings(
          scopedAdminId,
          serviceType,
          { useSharedGateway: hasAdminSession && !Number.isSafeInteger(requestedPlanId) },
        );
      if (!isDarajaGateway(paymentGateway)) {
       res.status(409).json({ ok: false, error: `${paymentGatewayLabel(paymentGateway)} is selected, but automated payment prompts are not connected for this gateway yet.` });
       return;
      }
      if (paymentGateway === "bank_stk_push" && !isBankStkPushConfigured(bankStkPush)) {
       res.status(400).json({ ok: false, error: "BankStkPush is missing the selected bank, PayBill Number, or Account / Business Number." });
       return;
     }
       const resolvedPaybill = paymentGateway === "mpesa_paybill"
         ? {
             paybillNumber: mpesaPaybill.paybillNumber || resellerRoute?.merchantIdentifier || "",
             accountNumber: mpesaPaybill.accountNumber || resellerRoute?.accountReference || "",
           }
         : mpesaPaybill;
        if (paymentGateway === "mpesa_paybill" && (!resolvedPaybill.paybillNumber || !resolvedPaybill.accountNumber)) {
        res.status(400).json({ ok: false, error: "M-Pesa PayBill is missing its receiving PayBill Number or Account / Business Number." });
        return;
      }
      if (paymentGateway === "mpesa_till_push" && !mpesaTillPush.tillNumber) {
        res.status(400).json({ ok: false, error: "Buy Goods Till is not configured for this ISP. Add it in Admin Settings → Payment Gateways." });
        return;
      }
      const payment = resolveDarajaPayment(paymentGateway, cfg, bankStkPush, mpesaTillPush, resolvedPaybill);
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
        reseller_id: resellerRoute?.resellerId ?? null,
        reseller_port_id: resellerRoute?.portId ?? null,
       amount: Math.ceil(Number(amount)),
       payment_method: platformBillingInvoice ? "mpesa_platform_billing" : "mpesa",
       payment_phone: normalised,
        mac_address: mac.value || null,
        payment_metadata: platformBillingInvoice
          ? { source: "platform_billing", billing_invoice_id: platformBillingInvoice.id }
          : resellerRoute
          ? {
              source: "reseller_daraja_bridge",
              gatewayRouteId: resellerRoute.gatewayRouteId,
              resellerGatewayConfigCiphertext: resellerRoute.gatewayConfigCiphertext,
              gatewayType: resellerRoute.paymentGateway,
              destinationType: resellerRoute.paymentGateway === "mpesa_till_push" ? "till" : "paybill",
              merchantIdentifier: resellerRoute.merchantIdentifier,
              accountReference: resellerRoute.accountReference,
            }
          : {},
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
      TransactionDesc:   platformBillingInvoice ? `Platform billing ${platformBillingInvoice.id}` : `Plan ${plan_id ?? "purchase"}`,
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

  const portalScope = req.hotspotPortalContext;
  const rows = await sbSelect<{
    id: number;
    status: string;
    reference: string;
    notes: string | null;
    admin_id: number | null;
    plan_id: number | null;
    payment_method: string;
  }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}${portalScope ? `&admin_id=eq.${portalScope.adminId}` : ""}&select=id,status,reference,notes,admin_id,plan_id,payment_method&limit=1`,
  );

  const tx = rows[0];
  if (!tx) {
    res.json({ ok: true, paid: false, status: "pending" });
    return;
  }

  if (portalScope) {
    const scopedPlans = tx.plan_id
      ? await sbSelectStrict<{ id: number }>(
          "isp_plans",
          `id=eq.${tx.plan_id}&admin_id=eq.${portalScope.adminId}&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&owner_reseller_id=eq.${portalScope.resellerId}&select=id&limit=1`,
        )
      : [];
    if (!scopedPlans[0]) {
      res.status(404).json({ ok: false, paid: false, error: "This payment is not part of the assigned reseller service." });
      return;
    }
  }

  const paid = tx.status === "completed" || tx.status === "success" || tx.status === "paid";
  if (paid && tx.payment_method === "mpesa_registration" && tx.admin_id) {
    const admins = await sbSelect<{ username: string; name: string; subdomain: string; is_active: boolean; role: string | null }>(
      "isp_admins",
      `id=eq.${tx.admin_id}&select=username,name,subdomain,is_active,role&limit=1`,
    );
    const admin = admins[0];
    res.json({
      ok: true,
      paid: !!admin?.is_active,
      status: admin?.is_active ? "completed" : "processing",
      registration: admin ? {
        username: admin.username,
        name: admin.name,
        subdomain: admin.subdomain,
        role: admin.role === "reseller" ? "reseller" : "isp_admin",
      } : undefined,
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
  const forceRouterRetry = req.body?.retry === true;
  const portalScope = req.hotspotPortalContext;
  const adminId = portalScope?.adminId ?? await resolvePortalAdminId(req, req.body?.adminId);
  const requestedMac = readMacAddress(req.body?.mac_address);
  const requestedDeviceName = readDeviceName(req.body?.device_name);

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId) || adminId === null || !Number.isSafeInteger(adminId) || adminId < 1 || requestedMac.invalid) {
    res.status(400).json({ ok: false, error: "A paid checkout and ISP context are required." });
    return;
  }

  const transactions = await sbSelect<{
    id: number;
    admin_id: number;
    customer_id: number | null;
    plan_id: number | null;
    payment_phone: string | null;
    mac_address: string | null;
    status: string;
  }>(
    "isp_transactions",
    `reference=eq.${encodeURIComponent(checkoutId)}&admin_id=eq.${adminId}&status=in.(completed,paid,success)&payment_method=eq.mpesa&select=id,admin_id,customer_id,plan_id,payment_phone,mac_address,status&limit=1`,
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
    port_id: number | null;
    speed_down: number | null;
    speed_up: number | null;
    validity: number | null;
    validity_unit: string | null;
    validity_days: number | null;
    speed_down_unit: string | null;
    speed_up_unit: string | null;
    data_limit_mb: number | null;
    data_cap_mode: string | null;
    fup_speed_down: number | null;
    fup_speed_up: number | null;
    shared_users: number | null;
    owner_reseller_id: number | null;
  }>;
  try {
    plans = await sbSelectStrict(
      "isp_plans",
      `id=eq.${transaction.plan_id}&admin_id=eq.${adminId}&is_active=is.true${portalScope ? `&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&owner_reseller_id=eq.${portalScope.resellerId}` : ""}&select=id,name,type,router_id,port_id,speed_down,speed_up,validity,validity_unit,validity_days,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,owner_reseller_id&limit=1`,
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
  if (
    portalScope
    && (
      plan.router_id !== portalScope.routerId
      || plan.port_id !== portalScope.portId
      || plan.owner_reseller_id !== portalScope.resellerId
    )
  ) {
    res.status(409).json({ ok: false, error: "This payment is not part of the assigned reseller service." });
    return;
  }
  const customerAdminId = plan.owner_reseller_id ?? adminId;
  if (!plan.router_id) {
    res.status(503).json({ ok: false, error: "The hotspot plan is not assigned to a MikroTik router yet." });
    return;
  }

  const configuredValidity = Number(plan.validity ?? plan.validity_days ?? 0);
  const expiresInSeconds = planValiditySeconds(configuredValidity, plan.validity_unit);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    res.status(409).json({ ok: false, error: "The hotspot plan has no valid access duration configured." });
    return;
  }
  const dataLimitMb = Number(plan.data_limit_mb);
  const capForPolicy = Number.isFinite(dataLimitMb) && dataLimitMb > 0 ? dataLimitMb : null;
  let dataCapMode: "disconnect" | "throttle";
  let fupSpeedDown: number | null;
  let fupSpeedUp: number | null;
  try {
    const policy = validateFupPolicy(
      plan.type,
      capForPolicy,
      plan.data_cap_mode ?? "disconnect",
      plan.fup_speed_down,
      plan.fup_speed_up,
      plan.speed_down,
      plan.speed_up,
      plan.speed_down_unit,
      plan.speed_up_unit,
    );
    dataCapMode = policy.dataCapMode;
    fupSpeedDown = policy.fupSpeedDown;
    fupSpeedUp = policy.fupSpeedUp;
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error instanceof Error ? `The selected package has an invalid data policy: ${error.message}` : "The selected package has an invalid data policy.",
    });
    return;
  }
  const limitBytesTotal = dataCapMode === "throttle" || capForPolicy === null
    ? "0"
    : String(dataLimitMegabytesToBytes(capForPolicy));

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

  let credentialRouterRow = routerRow;
  if (forceRouterRetry) {
    const refreshedRouters = await sbSelect<typeof routerRow>(
      "isp_routers",
      `id=eq.${plan.router_id}&admin_id=eq.${adminId}&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=1`,
    );
    credentialRouterRow = refreshedRouters[0] ?? routerRow;
  }
  let credentials: RouterCredentials;
  try {
    credentials = hotspotRouterCredentials(credentialRouterRow, {
      forceManagementVpn: forceRouterRetry,
    });
  } catch (error) {
    const diagnosis = logRouterConnectionFailure(
      error,
      {
        checkoutId,
        routerId: credentialRouterRow.id,
        router: credentialRouterRow.name,
        retry: forceRouterRetry,
      },
      "[mpesa/hotspot-mac-access] RouterOS retry preflight failed",
    );
    res.status(503).json({
      ok: false,
      error: `${diagnosis.userMessage} Keep this page open and retry account setup when the router is online.`,
    });
    return;
  }
  const routerAddressPromise = hotspotPaymentOperations.resolveHotspotClientIpByMac(credentials, mac).catch((error) => {
    logger.warn({ err: error, checkoutId, routerId: routerRow.id, mac }, "[mpesa/hotspot-mac-access] target device address lookup failed");
    return null;
  });
  let hotspotServer: string | undefined;
  if (plan.port_id) {
    let port: HotspotPortContext | null;
    try {
      port = await loadHotspotPortContext(adminId, plan.router_id, plan.port_id, portalScope?.resellerId);
    } catch (error) {
      logger.warn({ err: error, checkoutId, planId: plan.id, portId: plan.port_id }, "[mpesa/hotspot-mac-access] hotspot port unavailable");
      res.status(409).json({ ok: false, error: "The selected package's Hotspot port is not deployed or enabled yet." });
      return;
    }
    if (!port) {
      res.status(409).json({ ok: false, error: "The selected package's Hotspot port could not be found." });
      return;
    }
    const companyName = await loadTenantCompanyName(adminId);
    const livePort = portalScope
      ? await loadHotspotPortContext(adminId, plan.router_id, plan.port_id, portalScope.resellerId)
      : port;
    if (!livePort) {
      res.status(409).json({ ok: false, error: "The reseller Hotspot port assignment changed before activation." });
      return;
    }
    const resources = hotspotPortResources(livePort, {
      companyName,
      routerName: routerRow.name,
    });
    try {
      await hotspotPaymentOperations.ensureHotspotServerAddressPool(credentials, {
        serverName: resources.serverName,
        poolName: resources.poolName,
        poolRanges: resources.poolRanges,
        comment: `${resources.poolName}_hotspot_pool`,
      });
      hotspotServer = resources.serverName;
    } catch (error) {
      logger.warn({ err: error, checkoutId, router: routerRow.name, portId: plan.port_id, server: resources.serverName, pool: resources.poolName }, "[mpesa/hotspot-mac-access] hotspot server or pool unavailable");
      res.status(503).json({
        ok: false,
        error: `The Hotspot service for this port is not ready on ${routerRow.name}. Deploy the port service, then retry connection.`,
      });
      return;
    }
  }
  const paymentPhone = normaliseKenyanPhone(String(transaction.payment_phone ?? ""));
  if (!/^254\d{9}$/.test(paymentPhone)) {
    res.status(409).json({ ok: false, error: "The paid checkout has no valid Kenyan purchase phone number." });
    return;
  }

  /*
   * A paid hotspot account is one database customer plus one RouterOS user.
   * Keep the RouterOS identifier readable. Every new payment receives a new
   * random username, even when the phone and device are reused. Only a retry
   * of this same checkout may reuse the customer already linked to its
   * transaction.
   */
  const linkedCustomers = transaction.customer_id
     ? await sbSelect<{
    id: number;
    username: string | null;
    password: string | null;
    mac_address: string | null;
    ip_address: string | null;
    status: string;
     depletion_reason: string | null;
    expires_at: string | null;
  }>(
    "isp_customers",
      `id=eq.${transaction.customer_id}&admin_id=eq.${customerAdminId}&type=eq.hotspot${portalScope ? `&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}` : ""}&select=id,username,password,mac_address,ip_address,status,depletion_reason,expires_at&limit=1`,
   )
     : [];
  const now = Date.now();
  const linkedCustomer = linkedCustomers[0];
  const linkedExpiry = linkedCustomer?.expires_at ? Date.parse(linkedCustomer.expires_at) : 0;
  if (linkedCustomer && linkedCustomer.depletion_reason === "data_limit") {
    res.status(409).json({
      ok: false,
      error: "The data allowance on this paid package has been used. Purchase a new package to reconnect.",
    });
    return;
  }
  if (linkedCustomer && linkedCustomer.status === "expired") {
    res.status(409).json({
      ok: false,
      error: "The package from this paid checkout has expired. Purchase a new package to reconnect.",
    });
    return;
  }
  if (linkedCustomer && (!Number.isFinite(linkedExpiry) || linkedExpiry <= now)) {
    res.status(409).json({
      ok: false,
      error: "The package from this paid checkout has expired. Purchase a new package to reconnect.",
    });
    return;
  }
  const isReusable = (customer: typeof linkedCustomers[number]) => {
    const expiresAt = customer.expires_at ? Date.parse(customer.expires_at) : 0;
    return (customer.status === "active" || customer.status === "payment_cleared_router_pending") &&
      Number.isFinite(expiresAt) &&
      expiresAt > now &&
      typeof customer.username === "string";
  };
  const reusableCustomer = linkedCustomers[0] && isReusable(linkedCustomers[0])
     ? linkedCustomers[0]
     : undefined;

   let hotspotUsername = reusableCustomer?.username?.trim() || "";
   if (!hotspotUsername) {
     for (let attempt = 0; attempt < 12; attempt += 1) {
       const candidate = prepaidHotspotUsername(paymentPhone, mac);
       const collision = await sbSelect<{ id: number }>(
         "isp_customers",
          `admin_id=eq.${customerAdminId}&type=eq.hotspot&username=eq.${encodeURIComponent(candidate)}&select=id&limit=1`,
       );
       if (!collision[0]) {
         hotspotUsername = candidate;
         break;
       }
     }
   }
  if (!hotspotUsername) {
     res.status(503).json({ ok: false, error: "A unique hotspot username could not be generated. Please retry the connection." });
    return;
  }
  const collision = await sbSelect<{ id: number }>(
    "isp_customers",
    `admin_id=eq.${customerAdminId}&type=eq.hotspot&username=eq.${encodeURIComponent(hotspotUsername)}&select=id&limit=1`,
  );
  if (collision[0] && collision[0].id !== reusableCustomer?.id) {
    res.status(409).json({ ok: false, error: "This device identifier is already assigned to another hotspot account." });
    return;
  }
  const hotspotPassword = "12345";
  const isSameCheckoutRetry = !!reusableCustomer && transaction.customer_id === reusableCustomer.id;
  const routerAddress = (await routerAddressPromise) ?? "";
  const existingExpiry = reusableCustomer?.expires_at ? Date.parse(reusableCustomer.expires_at) : 0;
  const expiresAt = isSameCheckoutRetry
    ? new Date(existingExpiry)
    : new Date(now + Math.ceil(expiresInSeconds) * 1000);
  const remainingExpirySeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));

  const customerFields = {
    admin_id: customerAdminId,
    name: requestedDeviceName || `Hotspot ${paymentPhone}`,
    phone: paymentPhone,
    username: hotspotUsername,
    password: hotspotPassword,
    plan_id: plan.id,
    type: "hotspot",
    mac_address: mac,
    ip_address: routerAddress || null,
    status: "active",
     depletion_reason: null,
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
      ? await sbUpdateStrict("isp_customers", `id=eq.${reusableCustomer.id}&admin_id=eq.${customerAdminId}`, customerFields)
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
    const hotspotProfile = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
    const rateLimit = hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit);
    const sharedUsers = Math.max(1, Math.floor(Number(plan.shared_users ?? 1)));
    await Promise.all([
      hotspotPaymentOperations.syncRadiusCustomer({
        username: hotspotUsername,
        password: hotspotPassword,
        planId: plan.id,
        planType: "hotspot",
        enabled: true,
        sharedUsers,
        fullname: requestedDeviceName || `Hotspot ${paymentPhone}`,
        rateDown: plan.speed_down,
        rateDownUnit: plan.speed_down_unit,
        rateUp: plan.speed_up,
        rateUpUnit: plan.speed_up_unit,
        dataLimitMb,
        dataCapMode,
        expiresAt: expiresAt.toISOString(),
      }),
      hotspotPaymentOperations.requireHotspotUserProfile(credentials, hotspotProfile),
    ]);
    if (reusableCustomer?.username && reusableCustomer.username !== hotspotUsername) {
      await disconnectHotspotActiveUser(credentials, reusableCustomer.username).catch(() => {});
      await removeHotspotUser(credentials, reusableCustomer.username).catch(() => {});
    }
    await hotspotPaymentOperations.upsertHotspotUser(credentials, {
      name: hotspotUsername,
      password: hotspotPassword,
      profile: hotspotProfile,
      disabled: false,
      comment: hotspotUsername,
      server: hotspotServer,
      limitBytesTotal,
    });
    if (!isSameCheckoutRetry) {
      await hotspotPaymentOperations.disconnectHotspotActiveUser(credentials, hotspotUsername);
      await hotspotPaymentOperations.resetHotspotUserCounters(credentials, hotspotUsername);
      const usageRows = await sbUpdateStrict(
        "isp_customers",
        `id=eq.${customer.id}&admin_id=eq.${customerAdminId}`,
        { data_used_bytes: 0, data_used_mb: 0 },
      );
      if (!usageRows.length) {
        throw new Error("The new package usage baseline could not be saved.");
      }
    }
    const fupSchedule = dataCapMode === "throttle" && fupSpeedDown !== null && fupSpeedUp !== null && capForPolicy !== null
      ? hotspotPaymentOperations.scheduleHotspotUserFup(credentials, {
          username: hotspotUsername,
          thresholdBytes: dataLimitMegabytesToBytes(capForPolicy),
          speedDownMbps: fupSpeedDown,
          speedUpMbps: fupSpeedUp,
        })
      : hotspotPaymentOperations.removeHotspotUserFup(credentials, hotspotUsername);
    await Promise.all([
      hotspotPaymentOperations.scheduleHotspotUserExpiry(credentials, {
        name: hotspotUsername,
        expiresInSeconds: remainingExpirySeconds,
      }),
      fupSchedule,
    ]);

    let paidBindingApplied = false;
    try {
      paidBindingApplied = await hotspotPaymentOperations.addHotspotIpBinding(credentials, {
        macAddress: mac,
        ipAddress: routerAddress || undefined,
        comment: hotspotUsername,
        expiresInSeconds: remainingExpirySeconds,
        bindingType: "regular",
      });
    } catch (error) {
      logger.warn({ err: error, router: routerRow.name, username: hotspotUsername, mac }, "[mpesa/hotspot-mac-access] device binding deferred; credentials remain available");
    }
    if (paidBindingApplied) {
      await hotspotPaymentOperations.ensureHotspotUserRateQueue(credentials, {
        username: hotspotUsername,
        address: routerAddress || undefined,
        maxLimit: rateLimit,
      });
    }
    let routerConnected = false;
    if (routerAddress) {
      routerConnected = await hotspotPaymentOperations.connectHotspotUser(credentials, {
        user: hotspotUsername,
        password: hotspotPassword,
        ip: routerAddress,
        macAddress: mac,
        server: hotspotServer,
      }).catch((error) => {
        logger.warn({ err: error, username: hotspotUsername }, "[mpesa/hotspot-mac-access] active login deferred");
        return false;
      });
    }

     await sbUpdateStrict("isp_transactions", `id=eq.${transaction.id}&admin_id=eq.${adminId}`, {
      customer_id: customer.id,
      plan_id: plan.id,
      notes: `M-Pesa payment verified; hotspot credentials assigned on ${routerRow.name}${routerConnected ? " and the device session is active." : paidBindingApplied ? "; MAC access is set up and session activation is pending." : "; device binding is pending."}`,
    });
    res.json({
      ok: true,
      access: routerConnected ? "hotspot-authenticated" : "hotspot-credentials",
      connected: routerConnected,
      ...(!routerConnected
        ? {
            message: routerAddress
              ? paidBindingApplied
                ? "Payment is confirmed and the package is bound to this device, but the router has not confirmed its login yet. Retry connection."
                : "Payment is confirmed, but the router has not confirmed this device's hotspot login yet. Retry connection."
              : paidBindingApplied
                ? "Payment is confirmed and access is prepared for this device. Connect it to the hotspot Wi-Fi to finish signing in."
                : "Payment is confirmed, but the router has not seen the paid device on the hotspot Wi-Fi yet.",
          }
        : {}),
      router: routerRow.name,
      mac_address: mac,
      credentials: { username: hotspotUsername, password: hotspotPassword },
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    const diagnosis = logRouterConnectionFailure(
      error,
      {
        checkoutId,
        routerId: credentialRouterRow.id,
        router: credentialRouterRow.name,
        username: hotspotUsername,
        mac,
        retry: forceRouterRetry,
      },
      "[mpesa/hotspot-mac-access] hotspot user activation deferred",
    );
    try {
      await markPaymentClearedRouterPending({
        transactionId: transaction.id,
        adminId,
        customerId: customer.id,
        routerName: credentialRouterRow.name,
        failureMessage: diagnosis.userMessage,
      });
    } catch (stateError) {
      logger.error(
        { err: stateError, checkoutId, transactionId: transaction.id, customerId: customer.id },
        "[mpesa/hotspot-mac-access] Could not persist payment_cleared_router_pending status",
      );
    }
    res.status(503).json({
      ok: false,
      error: `Payment is confirmed and the prepaid account is saved, but RouterOS activation is pending. ${diagnosis.userMessage} Retry Account Setup to try again.`,
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
  const adminId = await resolvePortalAdminId(req, req.body?.adminId);
  const receipt = extractMpesaReceipt(req.body?.message);
  const requestedMac = readMacAddress(req.body?.mac_address);
  const clientIp = readClientIp(req.body?.client_ip);

  if (adminId === null || !Number.isSafeInteger(adminId) || adminId < 1 || !receipt || requestedMac.invalid) {
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
    `admin_id=eq.${adminId}&payment_method=like.mpesa*&status=in.(completed,paid,success)&mpesa_receipt=eq.${encodeURIComponent(receipt)}&select=id,admin_id,customer_id,plan_id,payment_phone,mac_address,mpesa_receipt,status&limit=1`,
  );
  if (!transactions[0]) {
    /* Legacy webhook provisioning stored the receipt in reference. */
    transactions = await sbSelect<VerifiedTransaction>(
      "isp_transactions",
      `admin_id=eq.${adminId}&payment_method=like.mpesa*&status=in.(completed,paid,success)&reference=eq.${encodeURIComponent(receipt)}&select=id,admin_id,customer_id,plan_id,payment_phone,mac_address,mpesa_receipt,status&limit=1`,
    );
  }
  const transaction = transactions[0];
  if (!transaction?.customer_id || !transaction.plan_id) {
    res.status(404).json({ ok: false, error: "That M-Pesa payment has not been assigned to a hotspot account yet." });
    return;
  }

  const portalScope = req.hotspotPortalContext;
  const customerOwnerFilter = portalScope
    ? `admin_id=in.(${adminId},${portalScope.resellerId})`
    : `admin_id=eq.${adminId}`;
  const customers = await sbSelect<{
    id: number;
    admin_id: number;
    plan_id: number | null;
    router_id: number | null;
    port_id: number | null;
    username: string | null;
    password: string | null;
    name: string | null;
    phone: string | null;
    mac_address: string | null;
    ip_address: string | null;
    status: string;
    depletion_reason: string | null;
    fup_limit_mb: number | null;
    expires_at: string | null;
  }>(
    "isp_customers",
    `id=eq.${transaction.customer_id}&${customerOwnerFilter}&type=eq.hotspot${portalScope ? `&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}` : ""}&select=id,admin_id,plan_id,router_id,port_id,username,password,name,phone,mac_address,ip_address,status,depletion_reason,fup_limit_mb,expires_at&limit=1`,
  );
  const customer = customers[0];
  if (!customer?.username || !customer.password) {
    res.status(409).json({ ok: false, error: "The verified payment does not have hotspot credentials yet." });
    return;
  }
  const transactionPhone = normaliseKenyanPhone(String(transaction.payment_phone ?? ""));
  const customerPhone = normaliseKenyanPhone(String(customer.phone ?? ""));
  if (
    !/^254\d{9}$/.test(transactionPhone) ||
    !/^254\d{9}$/.test(customerPhone) ||
    transactionPhone !== customerPhone
  ) {
    res.status(409).json({ ok: false, error: "This M-Pesa payment is not attached to the saved prepaid account." });
    return;
  }
  const expiresAtMs = customer.expires_at ? Date.parse(customer.expires_at) : 0;
  if (customer.depletion_reason === "data_limit") {
    res.status(409).json({
      ok: false,
      status: "depleted",
      error: "The data allowance on this package has been used. Purchase a new package to reconnect.",
    });
    return;
  }
  if (
    (customer.status !== "active" && customer.status !== "payment_cleared_router_pending")
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= Date.now()
  ) {
    res.status(409).json({ ok: false, error: "This hotspot package has expired. Purchase a new package to reconnect." });
    return;
  }

  let plans: Array<{
    id: number;
    name: string;
    type: string;
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
    owner_reseller_id: number | null;
  }>;
  try {
    plans = await sbSelectStrict(
      "isp_plans",
      `id=eq.${transaction.plan_id}&admin_id=eq.${adminId}&is_active=is.true${portalScope ? `&router_id=eq.${portalScope.routerId}&port_id=eq.${portalScope.portId}&owner_reseller_id=eq.${portalScope.resellerId}` : ""}&select=id,name,type,router_id,port_id,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up,shared_users,owner_reseller_id&limit=1`,
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
  if (
    portalScope
    && (
      customer.plan_id !== plan.id
      || plan.router_id !== portalScope.routerId
      || plan.port_id !== portalScope.portId
      || plan.owner_reseller_id !== portalScope.resellerId
      || customer.router_id !== portalScope.routerId
      || customer.port_id !== portalScope.portId
      || (customer.admin_id !== adminId && customer.admin_id !== portalScope.resellerId)
    )
  ) {
    res.status(404).json({ ok: false, error: "That payment is not part of the assigned reseller service." });
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

  const transactionMac = normaliseMacAddress(transaction.mac_address);
  const customerMac = normaliseMacAddress(customer.mac_address);
  if (transactionMac && customerMac && transactionMac !== customerMac) {
    res.status(409).json({ ok: false, error: "This M-Pesa payment is not attached to the saved hotspot device." });
    return;
  }
  const savedMac = transactionMac || customerMac;
  const transactionMacForResponse = savedMac;
  let mac = requestedMac.value || transactionMacForResponse;
  if (requestedMac.value && transactionMacForResponse && requestedMac.value !== transactionMacForResponse) {
    res.status(400).json({ ok: false, error: "This M-Pesa payment belongs to a different device." });
    return;
  }
  let credentials: RouterCredentials;
  try {
    credentials = hotspotRouterCredentials(routerRow, { forceManagementVpn: true });
  } catch (error) {
    const diagnosis = logRouterConnectionFailure(
      error,
      { receipt, routerId: routerRow.id, router: routerRow.name, retry: true },
      "[mpesa/verify] RouterOS reconnect preflight failed",
    );
    try {
      await markPaymentClearedRouterPending({
        transactionId: transaction.id,
        adminId,
        customerId: customer.id,
        routerName: routerRow.name,
        failureMessage: diagnosis.userMessage,
      });
    } catch (stateError) {
      logger.error({ err: stateError, receipt, transactionId: transaction.id, customerId: customer.id }, "[mpesa/verify] Could not persist payment_cleared_router_pending status");
    }
    res.status(503).json({ ok: false, error: `Payment is confirmed, but RouterOS reconnect is pending. ${diagnosis.userMessage} Try again when the router is online.` });
    return;
  }
  let hotspotServer: string | undefined;
  if (plan.port_id) {
    try {
      const port = await loadHotspotPortContext(adminId, plan.router_id, plan.port_id, portalScope?.resellerId);
      if (!port) throw new Error("Hotspot port could not be found.");
      const companyName = await loadTenantCompanyName(adminId);
      const livePort = portalScope
        ? await loadHotspotPortContext(adminId, plan.router_id, plan.port_id, portalScope.resellerId)
        : port;
      if (!livePort) throw new Error("The reseller Hotspot port assignment changed before activation.");
      const resources = hotspotPortResources(livePort, {
        companyName,
        routerName: routerRow.name,
      });
      await hotspotPaymentOperations.ensureHotspotServerAddressPool(credentials, {
        serverName: resources.serverName,
        poolName: resources.poolName,
        poolRanges: resources.poolRanges,
        comment: `${resources.poolName}_hotspot_pool`,
      });
      hotspotServer = resources.serverName;
    } catch (error) {
      if (error instanceof Error && error.message.includes("reseller Hotspot port assignment changed")) {
        await markPaymentClearedRouterPending({
          transactionId: transaction.id,
          adminId,
          customerId: customer.id,
          routerName: routerRow.name,
          failureMessage: error.message,
        }).catch(stateError => {
          logger.error({ err: stateError, receipt, transactionId: transaction.id, customerId: customer.id }, "[mpesa/verify] Could not persist changed-assignment payment status");
        });
        res.status(409).json({
          ok: false,
          error: "The reseller service assignment changed after payment. No access was activated; ask the ISP to review the assignment.",
        });
        return;
      }
      const diagnosis = logRouterConnectionFailure(
        error,
        { receipt, routerId: routerRow.id, router: routerRow.name, portId: plan.port_id, retry: true },
        "[mpesa/verify] Hotspot port setup deferred",
      );
      await markPaymentClearedRouterPending({
        transactionId: transaction.id,
        adminId,
        customerId: customer.id,
        routerName: routerRow.name,
        failureMessage: diagnosis.userMessage,
      }).catch(stateError => {
        logger.error({ err: stateError, receipt, transactionId: transaction.id, customerId: customer.id }, "[mpesa/verify] Could not persist payment_cleared_router_pending status");
      });
      res.status(503).json({
        ok: false,
        error: `Payment is confirmed, but RouterOS reconnect is pending. ${diagnosis.userMessage} Try again when the router is online.`,
      });
      return;
    }
  }
  if (!mac && clientIp) {
    mac = await resolveHotspotClientMac(credentials, clientIp).catch(() => null) ?? "";
  }
  if (!mac) {
    res.status(400).json({ ok: false, error: "The router could not identify the device to reconnect." });
    return;
  }

  const expiresInSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  const routerAddress = await hotspotPaymentOperations.resolveHotspotClientIpByMac(credentials, mac).catch((error) => {
    logger.warn({ err: error, receipt, routerId: routerRow.id, mac }, "[mpesa/verify] target device address lookup failed");
    return null;
  }) ?? "";
  const hotspotProfile = hotspotPlanProfileName(plan.name, plan.router_id, plan.port_id);
  const rawDataLimitMb = Number(customer.fup_limit_mb ?? plan.data_limit_mb);
  const dataLimitMb = Number.isFinite(rawDataLimitMb) && rawDataLimitMb > 0 ? rawDataLimitMb : null;
  let dataCapMode: "disconnect" | "throttle";
  let fupSpeedDown: number | null;
  let fupSpeedUp: number | null;
  try {
    const policy = validateFupPolicy(
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
    dataCapMode = policy.dataCapMode;
    fupSpeedDown = policy.fupSpeedDown;
    fupSpeedUp = policy.fupSpeedUp;
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error instanceof Error ? `The selected package has an invalid data policy: ${error.message}` : "The selected package has an invalid data policy.",
    });
    return;
  }
  const limitBytesTotal = dataCapMode === "throttle" || dataLimitMb === null
    ? "0"
    : String(dataLimitMegabytesToBytes(dataLimitMb));
  if (dataCapMode === "disconnect" && dataLimitMb !== null) {
    let usage: Awaited<ReturnType<typeof fetchHotspotUserUsage>>;
    try {
      usage = await hotspotPaymentOperations.fetchHotspotUserUsage(credentials, customer.username);
    } catch (error) {
      logger.warn({ err: error, receipt, routerId: routerRow.id, username: customer.username }, "[mpesa/verify] data quota verification failed");
      res.status(503).json({ ok: false, error: "The router could not verify this package's remaining data. Try reconnecting again shortly." });
      return;
    }
    if (usage && usage.bytesIn + usage.bytesOut >= dataLimitMegabytesToBytes(dataLimitMb)) {
      await sbUpdateStrict("isp_customers", `id=eq.${customer.id}&admin_id=eq.${adminId}`, {
        status: "expired",
        depletion_reason: "data_limit",
        updated_at: new Date().toISOString(),
      });
      res.status(409).json({
        ok: false,
        status: "depleted",
        error: "The data allowance on this package has been used. Purchase a new package to reconnect.",
      });
      return;
    }
  }
  try {
    const sharedUsers = Math.max(1, Math.floor(Number(plan.shared_users ?? 1)));
    await hotspotPaymentOperations.syncRadiusCustomer({
      username: customer.username,
      password: customer.password,
      planId: plan.id,
      planType: "hotspot",
      enabled: true,
      sharedUsers,
      fullname: customer.name,
      rateDown: plan.speed_down,
      rateDownUnit: plan.speed_down_unit,
      rateUp: plan.speed_up,
      rateUpUnit: plan.speed_up_unit,
      dataLimitMb,
      dataCapMode,
      expiresAt: customer.expires_at,
    });
    await hotspotPaymentOperations.requireHotspotUserProfile(credentials, hotspotProfile);
    const paidBindingApplied = await hotspotPaymentOperations.addHotspotIpBinding(credentials, {
      macAddress: mac,
      ipAddress: routerAddress || undefined,
      comment: customer.username,
      expiresInSeconds,
      bindingType: "regular",
    });
    if (paidBindingApplied) {
      await hotspotPaymentOperations.ensureHotspotUserRateQueue(credentials, {
        username: customer.username,
        address: routerAddress || undefined,
        maxLimit: hotspotRateLimit(plan.speed_down, plan.speed_up, plan.speed_down_unit, plan.speed_up_unit),
      });
    }
    try {
      await hotspotPaymentOperations.updateHotspotUser(credentials, customer.username, {
        password: customer.password,
        profile: hotspotProfile,
        disabled: false,
        comment: customer.username,
        server: hotspotServer,
        address: routerAddress || undefined,
        limitBytesTotal,
      });
    } catch {
      await hotspotPaymentOperations.addHotspotUser(credentials, {
        name: customer.username,
        password: customer.password,
        profile: hotspotProfile,
        comment: customer.username,
        server: hotspotServer,
        address: routerAddress || undefined,
        limitBytesTotal,
      });
    }
    await hotspotPaymentOperations.scheduleHotspotUserExpiry(credentials, {
      name: customer.username,
      expiresInSeconds,
    });
    if (dataCapMode === "throttle" && fupSpeedDown !== null && fupSpeedUp !== null && dataLimitMb !== null) {
      await hotspotPaymentOperations.scheduleHotspotUserFup(credentials, {
        username: customer.username,
        thresholdBytes: dataLimitMegabytesToBytes(dataLimitMb),
        speedDownMbps: fupSpeedDown,
        speedUpMbps: fupSpeedUp,
      });
    } else {
      await hotspotPaymentOperations.removeHotspotUserFup(credentials, customer.username);
    }
    let routerConnected = false;
    if (routerAddress) {
      routerConnected = await hotspotPaymentOperations.connectHotspotUser(credentials, {
        user: customer.username,
        password: customer.password,
        ip: routerAddress,
        macAddress: mac,
        server: hotspotServer,
      }).catch((error) => {
        logger.warn({ err: error, username: customer.username }, "[mpesa/verify] active login deferred");
        return false;
      });
    }
    await sbUpdateStrict(
      "isp_customers",
      `id=eq.${customer.id}&admin_id=eq.${customer.admin_id}`,
      { status: "active", depletion_reason: null, ip_address: routerAddress || null, updated_at: new Date().toISOString() },
    );
    res.json({
      ok: true,
      connected: routerConnected,
      transaction_id: transaction.id,
      router: routerRow.name,
      credentials: { username: customer.username, password: customer.password },
      expires_at: customer.expires_at,
    });
  } catch (error) {
    const diagnosis = logRouterConnectionFailure(
      error,
      {
        receipt,
        routerId: routerRow.id,
        router: routerRow.name,
        username: customer.username,
        mac,
        retry: true,
      },
      "[mpesa/verify] hotspot reconnect deferred",
    );
    await markPaymentClearedRouterPending({
      transactionId: transaction.id,
      adminId,
      customerId: customer.id,
      routerName: routerRow.name,
      failureMessage: diagnosis.userMessage,
    }).catch(stateError => {
      logger.error({ err: stateError, receipt, transactionId: transaction.id, customerId: customer.id }, "[mpesa/verify] Could not persist payment_cleared_router_pending status");
    });
    res.status(503).json({ ok: false, error: `Payment is confirmed, but RouterOS reconnect is pending. ${diagnosis.userMessage} Try again when the router is online.` });
  }
});

export default router;
