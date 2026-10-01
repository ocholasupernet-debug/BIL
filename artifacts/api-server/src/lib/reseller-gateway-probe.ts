import {
  resellerGatewayConfigComplete,
  type ResellerGatewayId,
} from "./reseller-payment-gateway.js";

export type ResellerGatewayProbeStatus = "verified" | "setup_only" | "rejected" | "unavailable";

export type ResellerGatewayProbeResult = {
  status: ResellerGatewayProbeStatus;
  message: string;
};

export type CentralDarajaProbeSettings = {
  consumerKey: string;
  consumerSecret: string;
  env: "sandbox" | "production";
};

const probeWindows = new Map<number, { startedAt: number; count: number }>();

export function allowResellerGatewayProbe(resellerId: number): boolean {
  const now = Date.now();
  const window = probeWindows.get(resellerId);
  if (!window || now - window.startedAt >= 60_000) {
    probeWindows.set(resellerId, { startedAt: now, count: 1 });
    return true;
  }
  if (window.count >= 10) return false;
  window.count += 1;
  return true;
}

async function providerRequest(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function environment(config: Record<string, string>): "sandbox" | "production" {
  return config.environment === "production" ? "production" : "sandbox";
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function responseHasToken(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const data = body?.data && typeof body.data === "object" && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : {};
  return [
    body?.access_token,
    body?.token,
    body?.data,
    data.access_token,
    data.token,
  ].some(value => typeof value === "string" && value.trim().length > 0);
}

export async function probeResellerGatewayConnection(
  gatewayType: ResellerGatewayId,
  config: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  centralDarajaSettings?: CentralDarajaProbeSettings,
): Promise<ResellerGatewayProbeResult> {
  if (!resellerGatewayConfigComplete(gatewayType, config)) {
    return {
      status: "rejected",
      message: "Complete and save this reseller gateway’s required fields before testing.",
    };
  }

  const env = environment(config);
  try {
    switch (gatewayType) {
      case "mpesa_paybill":
      case "mpesa_till_push":
      case "bank_stk_push": {
        if (!centralDarajaSettings?.consumerKey || !centralDarajaSettings.consumerSecret) {
          return {
            status: "rejected",
            message: "Daraja API credentials are managed by Super Admin and are not configured yet.",
          };
        }
        const host = centralDarajaSettings.env === "production"
          ? "https://api.safaricom.co.ke"
          : "https://sandbox.safaricom.co.ke";
        const response = await providerRequest(
          `${host}/oauth/v1/generate?grant_type=client_credentials`,
          { headers: { Authorization: basicAuth(centralDarajaSettings.consumerKey, centralDarajaSettings.consumerSecret) } },
          fetchImpl,
        );
        if (!(await responseHasToken(response))) {
          return { status: "rejected", message: "Daraja did not accept the platform credentials managed by Super Admin." };
        }
        return { status: "verified", message: "Daraja accepted the platform credentials managed by Super Admin. No payment was sent." };
      }
      case "airtel": {
        const host = env === "production" ? "https://openapi.airtel.africa" : "https://openapiuat.airtel.africa";
        const response = await providerRequest(`${host}/auth/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "client_credentials",
          }),
        }, fetchImpl);
        if (!(await responseHasToken(response))) {
          return { status: "rejected", message: "Airtel Money did not accept this reseller’s credentials." };
        }
        return { status: "verified", message: "Airtel Money accepted this reseller’s credentials. No payment was sent." };
      }
      case "azampay": {
        const response = await providerRequest("https://authenticator.azampay.co.tz/AppRegistration/GenerateToken", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appName: config.appName,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
          }),
        }, fetchImpl);
        if (!(await responseHasToken(response))) {
          return { status: "rejected", message: "AzamPay did not accept this reseller’s credentials." };
        }
        return { status: "verified", message: "AzamPay accepted this reseller’s credentials. No payment was sent." };
      }
      case "flutterwave": {
        const response = await providerRequest("https://api.flutterwave.com/v3/balances?currency=KES", {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        }, fetchImpl);
        if (!response.ok) return { status: "rejected", message: "Flutterwave did not accept this reseller’s credentials or permissions." };
        return { status: "verified", message: "Flutterwave accepted this reseller’s credentials. No payment was sent." };
      }
      case "pesapal": {
        const host = env === "production" ? "https://pay.pesapal.com/v3/api" : "https://cybqa.pesapal.com/pesapalv3/api";
        const response = await providerRequest(`${host}/Auth/RequestToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ consumer_key: config.consumerKey, consumer_secret: config.consumerSecret }),
        }, fetchImpl);
        if (!(await responseHasToken(response))) {
          return { status: "rejected", message: "PesaPal did not accept this reseller’s credentials." };
        }
        return { status: "verified", message: "PesaPal accepted this reseller’s credentials. No payment was sent." };
      }
      case "stripe": {
        const response = await providerRequest("https://api.stripe.com/v1/account", {
          headers: { Authorization: `Bearer ${config.secretKey}` },
        }, fetchImpl);
        if (!response.ok) return { status: "rejected", message: "Stripe did not accept this reseller’s secret key." };
        return { status: "verified", message: "Stripe accepted this reseller’s credentials. No payment was sent." };
      }
      case "paypal": {
        const host = env === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const response = await providerRequest(`${host}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: basicAuth(config.clientId, config.clientSecret),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        }, fetchImpl);
        if (!(await responseHasToken(response))) {
          return { status: "rejected", message: "PayPal did not accept this reseller’s credentials." };
        }
        return { status: "verified", message: "PayPal accepted this reseller’s credentials. No payment was sent." };
      }
      case "xendit": {
        const response = await providerRequest("https://api.xendit.co/balance", {
          headers: { Authorization: basicAuth(config.apiKey, "") },
        }, fetchImpl);
        if (!response.ok) return { status: "rejected", message: "Xendit did not accept this reseller’s key or its balance-read permission." };
        return { status: "verified", message: "Xendit accepted this reseller’s credentials. No payment was sent." };
      }
      case "custom_paybill":
      case "dpo_payments":
      case "intasend":
      case "tigopesa":
      case "bank_transfer":
      case "manual":
        return {
          status: "setup_only",
          message: "The saved reseller configuration is complete. This provider does not have a safe read-only credential check here.",
        };
    }
  } catch {
    return {
      status: "unavailable",
      message: "The provider could not be reached for a connection check. No payment was sent.",
    };
  }
}