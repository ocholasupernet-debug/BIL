import {
  getWhatsAppSettings,
  isWhatsAppEnabled,
  isWhatsAppFeatureEnabled,
  sendWhatsAppOtp,
} from "./whatsapp-service.js";
import {
  getWahaGatewaySecretStatus,
  getWahaGatewaySettings,
  validateWahaBaseUrl,
  type WahaOtpFeature,
  type WahaOtpProvider,
  wahaGatewayService,
} from "./waha-gateway-service.js";

export async function getWhatsAppOtpProvider(): Promise<WahaOtpProvider> {
  return (await getWahaGatewaySettings()).otpProvider;
}

export async function isWhatsAppOtpFeatureEnabled(feature: WahaOtpFeature): Promise<boolean> {
  const [gateway, whatsapp] = await Promise.all([
    getWahaGatewaySettings(),
    getWhatsAppSettings(),
  ]);
  if (gateway.otpProvider === "waha") {
    return gateway.enabled && gateway.features[feature];
  }
  if (feature === "login" || feature === "registrationVerification") {
    return isWhatsAppFeatureEnabled(whatsapp, feature);
  }
  return isWhatsAppEnabled(whatsapp);
}

export async function isWhatsAppOtpDeliveryReady(
  feature: WahaOtpFeature,
  provider?: WahaOtpProvider,
): Promise<boolean> {
  const gateway = await getWahaGatewaySettings();
  const selected = provider ?? gateway.otpProvider;
  if (selected !== gateway.otpProvider) return false;
  if (selected !== "waha") return true;
  const secrets = await getWahaGatewaySecretStatus();
  try {
    validateWahaBaseUrl(gateway.baseUrl);
  } catch {
    return false;
  }
  return gateway.enabled && gateway.features[feature] && secrets.apiKeyConfigured;
}

export async function sendConfiguredWhatsAppOtp(
  phoneNumber: string,
  code: string,
  feature: WahaOtpFeature,
  provider?: WahaOtpProvider,
): Promise<void> {
  const selected = await getWhatsAppOtpProvider();
  if (provider && provider !== selected) {
    throw new Error("The selected OTP provider changed. Request a new verification code.");
  }
  if (!await isWhatsAppOtpFeatureEnabled(feature)) {
    throw new Error("The selected WhatsApp OTP feature is disabled.");
  }
  if (!await isWhatsAppOtpDeliveryReady(feature, selected)) {
    throw new Error("WAHA is disabled or missing its encrypted API key.");
  }
  if (selected === "waha") {
    await wahaGatewayService.sendOTP(phoneNumber, code);
    return;
  }
  await sendWhatsAppOtp(phoneNumber, code);
}
