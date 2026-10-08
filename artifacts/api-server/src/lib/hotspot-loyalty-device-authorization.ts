import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const HOTSPOT_LOYALTY_DEVICE_AUTH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface HotspotLoyaltyDeviceAuthorizationScope {
  tenantAdminId: number;
  customerAdminId: number;
  customerId: number;
  phone: string;
  macAddress: string;
  routerId: number | null;
  portId: number | null;
  resellerId: number | null;
}

interface DeviceAuthorizationClaims {
  version: 1;
  tenantAdminId: number;
  customerAdminId: number;
  customerId: number;
  accountFingerprint: string;
  macAddress: string;
  routerId: number | null;
  portId: number | null;
  resellerId: number | null;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function signingKey(secret: string | undefined): string | null {
  const normalized = secret?.trim();
  return normalized ? `hotspot-loyalty-device-v1:${normalized}` : null;
}

function scopeClaims(
  scope: HotspotLoyaltyDeviceAuthorizationScope,
): Omit<DeviceAuthorizationClaims, "version" | "issuedAt" | "expiresAt" | "nonce"> | null {
  if (![scope.tenantAdminId, scope.customerAdminId, scope.customerId].every(
    value => Number.isSafeInteger(value) && value > 0,
  )) return null;
  const macAddress = scope.macAddress.trim().toUpperCase();
  if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress)) return null;
  const scopedIdIsValid = (value: number | null) => value === null
    || Number.isSafeInteger(value) && value > 0;
  if (![scope.routerId, scope.portId, scope.resellerId].every(scopedIdIsValid)) return null;
  const phone = scope.phone.trim();
  if (!phone) return null;

  return {
    tenantAdminId: scope.tenantAdminId,
    customerAdminId: scope.customerAdminId,
    customerId: scope.customerId,
    accountFingerprint: createHash("sha256")
      .update(`${scope.customerAdminId}|${scope.customerId}|${phone}`)
      .digest("hex"),
    macAddress,
    routerId: scope.routerId,
    portId: scope.portId,
    resellerId: scope.resellerId,
  };
}

export function issueHotspotLoyaltyDeviceAuthorization(
  scope: HotspotLoyaltyDeviceAuthorizationScope,
  secret: string | undefined,
  now = Date.now(),
): { token: string; expiresAt: number } | null {
  const key = signingKey(secret);
  const boundScope = scopeClaims(scope);
  if (!key || !boundScope || !Number.isFinite(now)) return null;

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + HOTSPOT_LOYALTY_DEVICE_AUTH_TTL_SECONDS;
  const claims: DeviceAuthorizationClaims = {
    version: 1,
    ...boundScope,
    issuedAt,
    expiresAt,
    nonce: randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt: expiresAt * 1000 };
}

export function verifyHotspotLoyaltyDeviceAuthorization(
  token: unknown,
  scope: HotspotLoyaltyDeviceAuthorizationScope,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  const key = signingKey(secret);
  const boundScope = scopeClaims(scope);
  if (!key || !boundScope || typeof token !== "string" || token.length > 4096 || !Number.isFinite(now)) {
    return false;
  }
  const [payload, suppliedSignature, ...extra] = token.split(".");
  if (!payload || !suppliedSignature || extra.length
      || !/^[A-Za-z0-9_-]+$/.test(payload)
      || !/^[A-Za-z0-9_-]+$/.test(suppliedSignature)) return false;
  const expectedSignature = createHmac("sha256", key).update(payload).digest();
  const actualSignature = Buffer.from(suppliedSignature, "base64url");
  if (actualSignature.length !== expectedSignature.length
      || !timingSafeEqual(actualSignature, expectedSignature)) return false;

  let claims: DeviceAuthorizationClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DeviceAuthorizationClaims;
  } catch {
    return false;
  }
  const currentTime = Math.floor(now / 1000);
  if (claims.version !== 1
      || !Number.isSafeInteger(claims.issuedAt)
      || !Number.isSafeInteger(claims.expiresAt)
      || claims.issuedAt > currentTime + 60
      || claims.expiresAt <= currentTime
      || claims.expiresAt - claims.issuedAt > HOTSPOT_LOYALTY_DEVICE_AUTH_TTL_SECONDS
      || typeof claims.nonce !== "string"
      || !/^[0-9a-f-]{36}$/i.test(claims.nonce)) return false;

  return claims.tenantAdminId === boundScope.tenantAdminId
    && claims.customerAdminId === boundScope.customerAdminId
    && claims.customerId === boundScope.customerId
    && claims.accountFingerprint === boundScope.accountFingerprint
    && claims.macAddress === boundScope.macAddress
    && claims.routerId === boundScope.routerId
    && claims.portId === boundScope.portId
    && claims.resellerId === boundScope.resellerId;
}
