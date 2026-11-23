import { createDarajaTokenProvider, type DarajaOAuthCredentials } from "../lib/daraja-oauth-token.js";

export type DarajaB2cEnvironment = "sandbox" | "production";

export type DarajaB2cCredentials = DarajaOAuthCredentials & {
  initiatorName: string;
  securityCredential: string;
  shortcode: string;
};

export type DarajaB2cResult = {
  resultCode: number;
  originatorConversationId: string;
  conversationId: string | null;
  receipt: string | null;
  amount: string | null;
  receiverPhone: string | null;
  failureCategory: "provider_failed" | "callback_incomplete" | null;
};

const tokenForB2c = createDarajaTokenProvider();

export function darajaB2cBaseUrl(environment: DarajaB2cEnvironment): string {
  return environment === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

export function isWholeKesAmount(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,8}$/.test(value);
}

export function normalizeWholeKesAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.0{1,2})?$/.test(value)) return null;
  const integer = value.split(".")[0];
  return isWholeKesAmount(integer) ? integer : null;
}

export function validateDarajaB2cPayout(input: {
  credentials: DarajaB2cCredentials;
  amountKes: string;
  phone: string;
  originatorConversationId: string;
}): void {
  if (!isWholeKesAmount(input.amountKes) || !/^254[17]\d{8}$/.test(input.phone)) {
    throw new Error("The approved payout amount or registered M-Pesa number is invalid.");
  }
  const { credentials } = input;
  if (
    !credentials.consumerKey || !credentials.consumerSecret ||
    !credentials.initiatorName || !credentials.securityCredential ||
    !/^\d{5,10}$/.test(credentials.shortcode)
  ) {
    throw new Error("Separate Daraja B2C credentials are incomplete.");
  }
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(input.originatorConversationId)) {
    throw new Error("The payout reference is invalid.");
  }
}

export function buildB2cCallbackUrl(
  origin: string,
  kind: "result" | "timeout",
  withdrawalId: string,
  token: string,
): string {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("A valid HTTPS callback origin is required.");
  }
  const callback = new URL(`/api/employee/payouts/daraja/b2c/${kind}`, parsed.origin);
  callback.searchParams.set("withdrawal", withdrawalId);
  callback.searchParams.set("token", token);
  return callback.toString();
}

export type B2cInitiationInput = {
  credentials: DarajaB2cCredentials;
  environment: DarajaB2cEnvironment;
  amountKes: string;
  phone: string;
  originatorConversationId: string;
  resultUrl: string;
  queueTimeoutUrl: string;
};

export type B2cInitiationResult =
  | { outcome: "submitted"; conversationId: string; originatorConversationId: string }
  | { outcome: "rejected"; category: "provider_rejected"; responseCode: string }
  | { outcome: "uncertain"; category: "transport_or_invalid_response" };

export async function initiateDarajaB2cPayout(
  input: B2cInitiationInput,
  deps: {
    getToken?: (credentials: DarajaOAuthCredentials, baseUrl: string) => Promise<string>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<B2cInitiationResult> {
  validateDarajaB2cPayout(input);
  const { credentials } = input;
  const baseUrl = darajaB2cBaseUrl(input.environment);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  try {
    const token = await (deps.getToken ?? tokenForB2c)(credentials, baseUrl);
    const response = await fetchImpl(`${baseUrl}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        InitiatorName: credentials.initiatorName,
        SecurityCredential: credentials.securityCredential,
        CommandID: "BusinessPayment",
        Amount: input.amountKes,
        PartyA: credentials.shortcode,
        PartyB: input.phone,
        Remarks: "Staff withdrawal",
        QueueTimeOutURL: input.queueTimeoutUrl,
        ResultURL: input.resultUrl,
        Occasion: "Staff withdrawal",
      }),
    });
    if (!response.ok) return { outcome: "uncertain", category: "transport_or_invalid_response" };
    const data = await response.json() as Record<string, unknown>;
    const responseCode = typeof data.ResponseCode === "string" ? data.ResponseCode : "";
    const originatorConversationId = typeof data.OriginatorConversationID === "string"
      ? data.OriginatorConversationID
      : "";
    if (responseCode && responseCode !== "0" && originatorConversationId === input.originatorConversationId) {
      return { outcome: "rejected", category: "provider_rejected", responseCode };
    }
    const conversationId = typeof data.ConversationID === "string" ? data.ConversationID : "";
    if (
      responseCode === "0" &&
      originatorConversationId === input.originatorConversationId &&
      conversationId
    ) {
      return { outcome: "submitted", conversationId, originatorConversationId };
    }
    return { outcome: "uncertain", category: "transport_or_invalid_response" };
  } catch {
    // A transport error can happen after Safaricom accepted the request. Never retry here.
    return { outcome: "uncertain", category: "transport_or_invalid_response" };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parameterMap(value: unknown): Record<string, unknown> {
  const container = record(value);
  const items = container ? record(container.ResultParameters) : null;
  const raw = items?.ResultParameter;
  const list = Array.isArray(raw) ? raw : [];
  const result: Record<string, unknown> = {};
  for (const item of list) {
    const entry = record(item);
    if (typeof entry?.Key === "string") result[entry.Key] = entry.Value;
  }
  return result;
}

export function parseDarajaB2cResult(body: unknown): DarajaB2cResult | null {
  const root = record(body);
  const result = record(root?.Result) ?? record(record(root?.Body)?.Result);
  if (!result) return null;
  const resultCode = Number(result.ResultCode);
  const originatorConversationId = typeof result.OriginatorConversationID === "string"
    ? result.OriginatorConversationID
    : "";
  if (!Number.isInteger(resultCode) || !originatorConversationId) return null;
  const params = parameterMap(result);
  const amountValue = params.TransactionAmount;
  const amount = typeof amountValue === "number" || typeof amountValue === "string"
    ? String(amountValue)
    : null;
  const receiptValue = params.TransactionReceipt;
  const receipt = typeof receiptValue === "string" && /^[A-Za-z0-9]{6,20}$/.test(receiptValue)
    ? receiptValue
    : null;
  const receiverValue = params.ReceiverPartyPublicName;
  const receiverDigits = typeof receiverValue === "string"
    ? receiverValue.match(/(?:254|0)[17]\d{8}/)?.[0] ?? null
    : null;
  const receiverPhone = receiverDigits
    ? receiverDigits.startsWith("0") ? `254${receiverDigits.slice(1)}` : receiverDigits
    : null;
  const conversationId = typeof result.ConversationID === "string" ? result.ConversationID : null;
  return {
    resultCode,
    originatorConversationId,
    conversationId,
    receipt,
    amount,
    receiverPhone,
    failureCategory: resultCode === 0
      ? receipt && amount ? null : "callback_incomplete"
      : "provider_failed",
  };
}
