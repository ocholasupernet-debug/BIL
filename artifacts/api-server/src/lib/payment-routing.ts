export type PaymentService = "hotspot" | "pppoe" | "vlan";
export type PaymentCollectionMode = "shared" | "separate";

export interface ServicePaymentConfig {
  gatewayId: string;
  config: Record<string, string>;
}

export interface PaymentServiceStatus {
  gatewayId: string;
  configured: boolean;
  config: Record<string, string>;
}

export const PAYMENT_GATEWAY_IDS = new Set([
  "mpesa_paybill",
  "mpesa_till_push",
  "bank_stk_push",
  "airtel",
  "azampay",
  "custom_paybill",
  "dpo_payments",
  "flutterwave",
  "intasend",
  "pesapal",
  "stripe",
  "paypal",
  "tigopesa",
  "xendit",
  "bank_transfer",
  "manual",
]);

export const DARAJA_GATEWAY_IDS = new Set([
  "mpesa_paybill",
  "mpesa_till_push",
  "bank_stk_push",
]);

const DARAJA_AUTH_FIELD_NAMES = new Set([
  "consumerkey",
  "consumersecret",
  "passkey",
  "shortcode",
  "businessshortcode",
  "callbackurl",
  "environment",
  "env",
]);

export const CHECKOUT_READY_GATEWAY_IDS = new Set([
  "mpesa_paybill",
  "mpesa_till_push",
  "bank_stk_push",
]);

export function paymentCollectionMode(value: unknown): PaymentCollectionMode {
  return value === "separate" ? "separate" : "shared";
}

export function paymentGateway(value: unknown): string {
  return typeof value === "string" && PAYMENT_GATEWAY_IDS.has(value)
    ? value
    : "mpesa_paybill";
}

export function gatewayConfigMap(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, config]) => config && typeof config === "object" && !Array.isArray(config))
      .map(([gatewayId, config]) => [
        gatewayId,
        Object.fromEntries(
          Object.entries(config as Record<string, unknown>)
            .filter(([, field]) => typeof field === "string")
            .map(([field, fieldValue]) => [field, (fieldValue as string).trim()]),
        ),
      ]),
  );
}

export function collectionConfig(gatewayId: string, value: unknown): Record<string, string> {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const allowed = gatewayId === "bank_transfer"
    ? ["bankName", "accountName", "accountNumber", "branchCode", "paymentInstructions"]
    : gatewayId === "mpesa_paybill" || gatewayId === "bank_stk_push"
    ? ["paybillNumber", "accountNumber", ...(gatewayId === "bank_stk_push" ? ["bankName"] : [])]
    : gatewayId === "mpesa_till_push"
    ? ["tillNumber"]
    : [];
  const aliases: Record<string, string[]> = {
    paybillNumber: ["paybillNumber", "merchantIdentifier", "merchant_identifier"],
    accountNumber: ["accountNumber", "accountReference", "account_reference"],
    tillNumber: ["tillNumber", "merchantIdentifier", "merchant_identifier"],
    bankName: ["bankName"],
    accountName: ["accountName"],
    branchCode: ["branchCode"],
    paymentInstructions: ["paymentInstructions"],
  };
  return Object.fromEntries(
    allowed
      .map(field => {
        const source = aliases[field]?.find(key => typeof raw[key] === "string");
        return [field, source ? (raw[source] as string).trim() : ""];
      })
      .filter(([, value]) => Boolean(value)),
  );
}

export function hasDarajaAuthFields(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).some(key =>
    DARAJA_AUTH_FIELD_NAMES.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
}

export function servicePaymentConfigMap(value: unknown): Partial<Record<PaymentService, ServicePaymentConfig>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map = value as Record<string, unknown>;
  return Object.fromEntries(
    (["hotspot", "pppoe", "vlan"] as PaymentService[])
      .map(service => {
        const raw = map[service];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const record = raw as Record<string, unknown>;
        const gatewayId = paymentGateway(record.gatewayId);
        const config = collectionConfig(gatewayId, record.config);
        return [service, { gatewayId, config }] as const;
      })
      .filter((entry): entry is readonly [PaymentService, ServicePaymentConfig] => entry !== null),
  );
}

export function isDarajaGateway(value: string): boolean {
  return DARAJA_GATEWAY_IDS.has(value);
}

export function isGatewayConfigComplete(gatewayId: string, config: Record<string, string>): boolean {
  if (gatewayId === "mpesa_paybill") return !!(config.paybillNumber && config.accountNumber);
  if (gatewayId === "mpesa_till_push") return !!config.tillNumber;
  if (gatewayId === "bank_stk_push") return !!(config.bankName && config.paybillNumber && config.accountNumber);
  if (gatewayId === "bank_transfer") return !!(config.bankName && config.accountName && config.accountNumber);
  return false;
}

export function isGatewayCheckoutReady(gatewayId: string, config: Record<string, string>): boolean {
  return CHECKOUT_READY_GATEWAY_IDS.has(gatewayId) && isGatewayConfigComplete(gatewayId, config);
}

export function publicServiceStatus(
  mode: PaymentCollectionMode,
  sharedGatewayId: string,
  sharedConfig: Record<string, string>,
  serviceConfigs: Partial<Record<PaymentService, ServicePaymentConfig>>,
): Record<PaymentService, PaymentServiceStatus> {
  return Object.fromEntries(
    (["hotspot", "pppoe"] as PaymentService[]).map(service => {
      const selected = mode === "separate" ? serviceConfigs[service] : undefined;
      const gatewayId = mode === "separate"
        ? (selected?.gatewayId ?? "unconfigured")
        : sharedGatewayId;
      const config = mode === "separate"
        ? collectionConfig(gatewayId, selected?.config)
        : sharedConfig;
      return [service, {
        gatewayId,
        configured: isGatewayCheckoutReady(gatewayId, config),
        config,
      }];
    }),
  ) as Record<PaymentService, PaymentServiceStatus>;
}