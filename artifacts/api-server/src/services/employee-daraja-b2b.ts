import { createDarajaTokenProvider, type DarajaOAuthCredentials } from "../lib/daraja-oauth-token.js";

export type DarajaB2bEnvironment = "sandbox" | "production";
export type DarajaB2bCommand = "BusinessPayBill" | "BusinessBuyGoods";

export type DarajaB2bCredentials = DarajaOAuthCredentials & {
  initiatorName: string;
  securityCredential: string;
  shortcode: string;
};

export type B2bPayoutInput = {
  credentials: DarajaB2bCredentials;
  environment: DarajaB2bEnvironment;
  destinationType: "paybill" | "till";
  amountKes: string;
  destinationNumber: string;
  accountReference: string;
  originatorConversationId: string;
  resultUrl: string;
  queueTimeoutUrl: string;
};

export type B2bInitiationResult =
  | { outcome: "submitted"; conversationId: string; originatorConversationId: string }
  | { outcome: "rejected"; category: "provider_rejected"; responseCode: string }
  | { outcome: "uncertain"; category: "transport_or_invalid_response" };

export type DarajaB2bResult = {
  resultCode: number;
  originatorConversationId: string;
  conversationId: string | null;
  receipt: string | null;
  amount: string | null;
};

const tokenForB2b = createDarajaTokenProvider();

function baseUrl(environment: DarajaB2bEnvironment): string {
  return environment === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}

export function buildB2bCallbackUrl(
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
  const callback = new URL(`/api/employee/payouts/daraja/b2b/${kind}`, parsed.origin);
  callback.searchParams.set("withdrawal", withdrawalId);
  callback.searchParams.set("token", token);
  return callback.toString();
}

export function b2bCommandForDestination(type: "paybill" | "till"): DarajaB2bCommand {
  return type === "paybill" ? "BusinessPayBill" : "BusinessBuyGoods";
}

export function validateB2bPayout(input: B2bPayoutInput): void {
  if (!/^[1-9]\d{0,8}$/.test(input.amountKes)) {
    throw new Error("Daraja B2B supports positive whole-KES amounts only.");
  }
  if (
    !/^\d{5,16}$/.test(input.destinationNumber) ||
    !/^[A-Za-z0-9#_-]{1,13}$/.test(input.accountReference) ||
    !/^[A-Za-z0-9_-]{12,64}$/.test(input.originatorConversationId)
  ) {
    throw new Error("The approved amount, merchant destination, or payout reference is invalid.");
  }
  const { credentials } = input;
  if (
    !credentials.consumerKey || !credentials.consumerSecret ||
    !credentials.initiatorName || !credentials.securityCredential ||
    !/^\d{5,10}$/.test(credentials.shortcode)
  ) {
    throw new Error("Separate Daraja B2B credentials are incomplete.");
  }
  for (const callbackUrl of [input.resultUrl, input.queueTimeoutUrl]) {
    const url = new URL(callbackUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("A public HTTPS callback URL is required.");
    }
  }
}

export async function initiateDarajaB2bPayout(
  input: B2bPayoutInput,
  deps: {
    getToken?: (credentials: DarajaOAuthCredentials, baseUrl: string) => Promise<string>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<B2bInitiationResult> {
  validateB2bPayout(input);
  const url = baseUrl(input.environment);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  try {
    const token = await (deps.getToken ?? tokenForB2b)(input.credentials, url);
    const response = await fetchImpl(`${url}/mpesa/b2b/v1/paymentrequest`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Initiator: input.credentials.initiatorName,
        SecurityCredential: input.credentials.securityCredential,
        CommandID: b2bCommandForDestination(input.destinationType),
        SenderIdentifierType: "4",
        RecieverIdentifierType: "4",
        Amount: input.amountKes,
        PartyA: input.credentials.shortcode,
        PartyB: input.destinationNumber,
        AccountReference: input.accountReference,
        Remarks: "Staff withdrawal",
        QueueTimeOutURL: input.queueTimeoutUrl,
        ResultURL: input.resultUrl,
      }),
    });
    if (!response.ok) return { outcome: "uncertain", category: "transport_or_invalid_response" };
    const data = await response.json() as Record<string, unknown>;
    const responseCode = typeof data.ResponseCode === "string" ? data.ResponseCode : "";
    const originatorConversationId = typeof data.OriginatorConversationID === "string"
      ? data.OriginatorConversationID : "";
    if (responseCode && responseCode !== "0" && originatorConversationId === input.originatorConversationId) {
      return { outcome: "rejected", category: "provider_rejected", responseCode };
    }
    const conversationId = typeof data.ConversationID === "string" ? data.ConversationID : "";
    if (responseCode === "0" && originatorConversationId === input.originatorConversationId && conversationId) {
      return { outcome: "submitted", conversationId, originatorConversationId };
    }
    return { outcome: "uncertain", category: "transport_or_invalid_response" };
  } catch {
    // A transport error can occur after Safaricom accepted the payment request.
    return { outcome: "uncertain", category: "transport_or_invalid_response" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseDarajaB2bResult(body: unknown): DarajaB2bResult | null {
  const root = asRecord(body);
  const result = asRecord(root?.Result) ?? asRecord(asRecord(root?.Body)?.Result);
  if (!result) return null;
  const resultCode = Number(result.ResultCode);
  const originatorConversationId = typeof result.OriginatorConversationID === "string"
    ? result.OriginatorConversationID : "";
  if (!Number.isInteger(resultCode) || !originatorConversationId) return null;
  const parameters = asRecord(result.ResultParameters);
  const raw = parameters?.ResultParameter;
  const list = Array.isArray(raw) ? raw : [];
  const values = new Map<string, unknown>();
  for (const item of list) {
    const entry = asRecord(item);
    if (typeof entry?.Key === "string") values.set(entry.Key, entry.Value);
  }
  const amountValue = values.get("Amount");
  const receiptValue = values.get("TransactionReceipt");
  const amount = typeof amountValue === "string" || typeof amountValue === "number" ? String(amountValue) : null;
  const receipt = typeof receiptValue === "string" && /^[A-Za-z0-9]{6,20}$/.test(receiptValue) ? receiptValue : null;
  return {
    resultCode,
    originatorConversationId,
    conversationId: typeof result.ConversationID === "string" ? result.ConversationID : null,
    receipt,
    amount,
  };
}
