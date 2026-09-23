import { decryptVpnSecret, encryptVpnSecret, type EncryptedSecret } from "./vpn-crypto.js";
import { sbSelectStrict } from "./supabase-client.js";

export const RESELLER_GATEWAY_IDS = [
  "mpesa_paybill", "mpesa_till_push", "bank_stk_push", "airtel", "azampay",
  "custom_paybill", "dpo_payments", "flutterwave", "intasend", "pesapal",
  "stripe", "paypal", "tigopesa", "xendit", "manual",
] as const;

export type ResellerGatewayId = typeof RESELLER_GATEWAY_IDS[number];
export type ResellerGatewayScope = "default" | "router" | "port";

const KENYAN_BANK_BUSINESS_NUMBERS: Record<string, string> = {
  "kcb bank": "533533",
};

/**
 * Return a bank-provided business number when the bank has a known standard
 * destination. A saved/manual number always remains authoritative.
 */
export function bankBusinessNumberFor(bankName: unknown): string {
  const normalized = typeof bankName === "string"
    ? bankName.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
  return KENYAN_BANK_BUSINESS_NUMBERS[normalized] ?? "";
}

const SECRET_FIELDS: Record<string, Set<string>> = {
  airtel: new Set(["clientId", "clientSecret"]),
  azampay: new Set(["clientId", "clientSecret"]),
  dpo_payments: new Set(["companyToken"]),
  flutterwave: new Set(["secretKey", "encryptionKey"]),
  intasend: new Set(["secretKey"]),
  pesapal: new Set(["consumerKey", "consumerSecret"]),
  stripe: new Set(["secretKey", "webhookSecret"]),
  paypal: new Set(["clientId", "clientSecret"]),
  tigopesa: new Set(["apiKey", "apiSecret"]),
  xendit: new Set(["apiKey"]),
};

export const isResellerGatewayId = (value: unknown): value is ResellerGatewayId =>
  typeof value === "string" && (RESELLER_GATEWAY_IDS as readonly string[]).includes(value);

export function resellerGatewayScope(routerId: unknown, portId: unknown): ResellerGatewayScope {
  if (Number.isSafeInteger(Number(portId)) && Number(portId) > 0) return "port";
  if (Number.isSafeInteger(Number(routerId)) && Number(routerId) > 0) return "router";
  return "default";
}

export function cleanGatewayConfig(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => typeof field === "string")
      .map(([key, field]) => [key, String(field).trim().slice(0, 500)])
      .filter(([, field]) => field.length > 0),
  );
}

export function gatewayConfigPreview(gatewayType: string, config: Record<string, string>): Record<string, string> {
  const secrets = SECRET_FIELDS[gatewayType] ?? new Set<string>();
  return Object.fromEntries(Object.entries(config).filter(([key]) => !secrets.has(key)));
}

export function encryptGatewayConfig(config: Record<string, string>): string {
  return JSON.stringify(encryptVpnSecret(JSON.stringify(config)));
}

export function decryptGatewayConfig(value: unknown): Record<string, string> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const decrypted = decryptVpnSecret(parsed as EncryptedSecret);
    return cleanGatewayConfig(JSON.parse(decrypted));
  } catch {
    throw new Error("The saved reseller payment gateway credentials could not be decrypted.");
  }
}

export function resellerDestinationConfigured(
  gatewayType: string,
  config: Record<string, string>,
): boolean {
  if (gatewayType === "mpesa_till_push") {
    return !!(config.tillNumber || config.merchantIdentifier || config.merchant_identifier);
  }
  if (gatewayType === "mpesa_paybill") {
    return !!(
      (config.paybillNumber || config.merchantIdentifier || config.merchant_identifier) &&
      (config.accountNumber || config.accountReference || config.account_reference)
    );
  }
  return false;
}

export type ResellerGatewayRouteRow = {
  id: number;
  admin_id: number;
  reseller_id: number;
  router_id: number | null;
  port_id: number | null;
  gateway_type: string;
  config_ciphertext: string;
  config_preview: Record<string, string> | null;
  is_active: boolean;
};

export async function resolveResellerGatewayRoute(
  adminId: number,
  resellerId: number,
  routerId: number,
  portId: number,
): Promise<(ResellerGatewayRouteRow & { config: Record<string, string> }) | null> {
  const rows = await sbSelectStrict<ResellerGatewayRouteRow>(
    "reseller_payment_gateway_routes",
    `admin_id=eq.${adminId}&reseller_id=eq.${resellerId}&is_active=is.true&or=(port_id.eq.${portId},and(router_id.eq.${routerId},port_id.is.null),and(router_id.is.null,port_id.is.null))&select=id,admin_id,reseller_id,router_id,port_id,gateway_type,config_ciphertext,config_preview,is_active&limit=20`,
  );
  const selected = rows.sort((a, b) => {
    const rank = (row: ResellerGatewayRouteRow) => row.port_id !== null ? 0 : row.router_id !== null ? 1 : 2;
    return rank(a) - rank(b);
  })[0];
  return selected ? { ...selected, config: decryptGatewayConfig(selected.config_ciphertext) } : null;
}