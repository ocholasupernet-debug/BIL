import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { sbSelect, sbSelectStrict } from "./supabase-client.js";
import { getTenantSubdomainFromRequest } from "./tenant-host.js";
import {
  getAdminApiReauthFeature,
  getPageAuthMethod,
  recordPlatformAuthAudit,
  type AdminPolicyRole,
  type PageAuthMethod,
} from "./platform-auth-security.js";
import { getActiveSuperAdminAccessActor } from "./platform-auth-store.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: ApiTokenPayload;
      tenantSubdomain?: string | null;
      hotspotPortalContext?: VlanHotspotPortalContext;
    }
  }
}

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET ?? process.env.SESSION_SECRET ?? "";
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PASSWORD_SETUP_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_S = 300;
const PAYMENT_INTENT_TTL_MS = 5 * 60 * 1000;
export const PPPOE_PORTAL_REFERENCE_TTL_MS = 10 * 60 * 1000;
const PPPOE_PORTAL_REFERENCE_PURPOSE = "pppoe-expired-portal";
const VLAN_HOTSPOT_PORTAL_PURPOSE = "vlan-hotspot-portal";

export type ApiTokenType = "a" | "c" | "p";

export interface ApiTokenPayload {
  type: ApiTokenType;
  uid: string;
  time: number;
  impersonationSessionId?: string;
  authVersion?: number;
  reauthGrants?: PasswordReauthProof[];
}

export interface PasswordReauthProof {
  uid: string;
  role: AdminPolicyRole;
  feature: string;
  method: Exclude<PageAuthMethod, "none">;
  expiresAt: number;
  nonce: string;
}

interface AuthenticatedAdmin {
  id: number;
  parent_id: number | null;
  subdomain: string | null;
  role: string | null;
  is_active: boolean;
  auth_version: number | null;
}

export interface PaymentIntentPayload {
  adminId: number;
  planId: number;
  amount: number;
  phone: string;
  serviceType?: "hotspot" | "pppoe" | "vlan";
  routerId?: number;
  portId?: number;
  customerId?: number;
  macAddress?: string;
  deviceName?: string;
  issuedAt: number;
  nonce: string;
}

export interface PppoePortalReferencePayload {
  purpose: typeof PPPOE_PORTAL_REFERENCE_PURPOSE;
  customerId: number;
  adminId: number;
  routerId: number;
  issuedAt: number;
  nonce: string;
}

export interface VlanHotspotPortalContext {
  purpose: typeof VLAN_HOTSPOT_PORTAL_PURPOSE;
  adminId: number;
  resellerId: number;
  routerId: number;
  portId: number;
  issuedAt: number;
  nonce: string;
}

export const apiTokenSigningConfigured = !!TOKEN_SIGNING_SECRET;

export function generateToken(type: ApiTokenType, uid: string): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const time = Math.floor(Date.now() / 1000);
  const hash = createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update(`${type}.${uid}.${time}`)
    .digest("hex");
  return `${type}.${uid}.${time}.${hash}`;
}

export function generatePasswordSetupToken(uid: string, authVersion: number): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const time = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    authVersion: Number.isSafeInteger(authVersion) && authVersion > 0 ? authVersion : 1,
  }), "utf8").toString("base64url");
  const body = `p.${uid}.${time}.s${encoded}`;
  const hash = createHmac("sha256", TOKEN_SIGNING_SECRET).update(body).digest("hex");
  return `${body}.${hash}`;
}

export function generateImpersonationToken(uid: string, sessionId: string): string {
  return generateAdminSessionToken(uid, 1, { impersonationSessionId: sessionId });
}

export function generateAdminSessionToken(
  uid: string,
  authVersion: number,
  extras: { impersonationSessionId?: string; reauthGrants?: PasswordReauthProof[] } = {},
): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const time = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    authVersion: Number.isSafeInteger(authVersion) && authVersion > 0 ? authVersion : 1,
    ...(extras.impersonationSessionId ? { impersonationSessionId: extras.impersonationSessionId } : {}),
    ...(extras.reauthGrants?.length ? { reauthGrants: extras.reauthGrants } : {}),
  }), "utf8").toString("base64url");
  const body = `a.${uid}.${time}.s${encoded}`;
  const hash = createHmac("sha256", TOKEN_SIGNING_SECRET).update(body).digest("hex");
  return `${body}.${hash}`;
}

export function validateToken(token: string): ApiTokenPayload | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [rawType, uid, timeStr] = parts;
  const rawClaims = parts.length === 5 ? parts[3] : undefined;
  const hash = parts.at(-1)!;
  if (
    (rawType !== "a" && rawType !== "c" && rawType !== "p") ||
    (parts.length === 5 && ((rawType !== "a" && rawType !== "p") || !rawClaims?.startsWith("s")))
  ) return null;
  let claims: { authVersion?: number; impersonationSessionId?: string; reauthGrants?: PasswordReauthProof[] } = {};
  if (rawClaims) {
    try {
      claims = JSON.parse(Buffer.from(rawClaims.slice(1), "base64url").toString("utf8"));
      if (
        !Number.isSafeInteger(claims.authVersion) ||
        (claims.authVersion ?? 0) < 1 ||
        (claims.impersonationSessionId !== undefined && !/^[0-9a-f-]{36}$/i.test(claims.impersonationSessionId)) ||
        (claims.reauthGrants !== undefined && !Array.isArray(claims.reauthGrants))
      ) return null;
    } catch {
      return null;
    }
  }

  const time = parseInt(timeStr, 10);
  if (isNaN(time)) return null;

  const nowS = Math.floor(Date.now() / 1000);
  if (time > nowS + MAX_CLOCK_SKEW_S) return null;

  if (time !== 0) {
    const ageMs = (nowS - time) * 1000;
    if (ageMs > (rawType === "p" ? PASSWORD_SETUP_TOKEN_TTL_MS : TOKEN_TTL_MS)) return null;
  }

  const body = parts.slice(0, -1).join(".");
  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(hash, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  return {
    type: rawType as ApiTokenType,
    uid,
    time,
    ...(claims.authVersion ? { authVersion: claims.authVersion } : {}),
    ...(claims.impersonationSessionId ? { impersonationSessionId: claims.impersonationSessionId } : {}),
    ...(claims.reauthGrants ? { reauthGrants: claims.reauthGrants } : {}),
  };
}

export function generatePasswordReauthProof(
  uid: string,
  role: AdminPolicyRole,
  feature: string,
): { proof: string; expiresAt: number } {
  return generatePageAuthProof(uid, role, feature, "password");
}

export function generatePageAuthProof(
  uid: string,
  role: AdminPolicyRole,
  feature: string,
  method: Exclude<PageAuthMethod, "none">,
): { proof: string; expiresAt: number } {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const payload: PasswordReauthProof = {
    uid,
    role,
    feature,
    method,
    expiresAt: Date.now() + 5 * 60 * 1000,
    nonce: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("base64url");
  return { proof: `${encoded}.${signature}`, expiresAt: payload.expiresAt };
}

export function hashPageOtpSession(token: string): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  return createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update(`page-auth-session\u0000${token}`)
    .digest("hex");
}

export function hashPageOtpCode(input: {
  challengeId: string;
  code: string;
  token: string;
  uid: string;
  role: AdminPolicyRole;
  feature: string;
  method: Exclude<PageAuthMethod, "none" | "password">;
}): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  return createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update([
      "page-auth-code",
      input.challengeId,
      input.uid,
      input.role,
      input.feature,
      input.method,
      hashPageOtpSession(input.token),
      input.code,
    ].join("\u0000"))
    .digest("hex");
}

export function validatePasswordReauthProof(token: string): PasswordReauthProof | null {
  if (!TOKEN_SIGNING_SECRET || typeof token !== "string" || token.length > 4096) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PasswordReauthProof;
    if (
      typeof parsed.uid !== "string" ||
      (parsed.role !== "isp_admin" && parsed.role !== "reseller") ||
      typeof parsed.feature !== "string" ||
      !["password", "whatsapp", "sms", "email"].includes(parsed.method) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      parsed.expiresAt > Date.now() + 5 * 60 * 1000 + 30_000 ||
      typeof parsed.nonce !== "string"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function generatePaymentIntent(payload: Omit<PaymentIntentPayload, "issuedAt" | "nonce">): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const body: PaymentIntentPayload = {
    ...payload,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function validatePaymentIntent(token: string): PaymentIntentPayload | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PaymentIntentPayload;
    if (!Number.isSafeInteger(payload.adminId) || !Number.isSafeInteger(payload.planId) ||
        !Number.isFinite(payload.amount) || payload.amount <= 0 ||
        !/^2547\d{8}$/.test(payload.phone) || !payload.nonce ||
         (payload.serviceType !== undefined && payload.serviceType !== "hotspot" && payload.serviceType !== "pppoe" && payload.serviceType !== "vlan") ||
         (payload.routerId !== undefined && (!Number.isSafeInteger(payload.routerId) || payload.routerId <= 0)) ||
         (payload.portId !== undefined && (!Number.isSafeInteger(payload.portId) || payload.portId <= 0)) ||
        (payload.customerId !== undefined && (!Number.isSafeInteger(payload.customerId) || payload.customerId <= 0)) ||
        (payload.macAddress !== undefined && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(payload.macAddress)) ||
         (payload.deviceName !== undefined && (typeof payload.deviceName !== "string" || payload.deviceName.length > 64)) ||
        Date.now() - payload.issuedAt > PAYMENT_INTENT_TTL_MS ||
        payload.issuedAt > Date.now() + MAX_CLOCK_SKEW_S * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * A portal reference is deliberately separate from a customer session token.
 * It is short-lived, purpose-bound, and contains only identifiers; it never
 * carries a password or a client-supplied subscription status.
 */
export function generatePppoePortalReference(
  payload: Omit<PppoePortalReferencePayload, "purpose" | "issuedAt" | "nonce">,
): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const body: PppoePortalReferencePayload = {
    purpose: PPPOE_PORTAL_REFERENCE_PURPOSE,
    ...payload,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function validatePppoePortalReference(token: string): PppoePortalReferencePayload | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) return null;

  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<PppoePortalReferencePayload>;
    const customerId = payload.customerId;
    const adminId = payload.adminId;
    const routerId = payload.routerId;
    const issuedAt = payload.issuedAt;
    if (payload.purpose !== PPPOE_PORTAL_REFERENCE_PURPOSE || !payload.nonce) return null;
    if (
      !Number.isSafeInteger(customerId)
      || !Number.isSafeInteger(adminId)
      || !Number.isSafeInteger(routerId)
      || !Number.isFinite(issuedAt)
    ) return null;
    const safeCustomerId = customerId as number;
    const safeAdminId = adminId as number;
    const safeRouterId = routerId as number;
    const safeIssuedAt = issuedAt as number;
    if (
      safeCustomerId <= 0
      || safeAdminId <= 0
      || safeRouterId <= 0
      || Date.now() - safeIssuedAt > PPPOE_PORTAL_REFERENCE_TTL_MS
      || safeIssuedAt > Date.now() + MAX_CLOCK_SKEW_S * 1000
    ) return null;

    return payload as PppoePortalReferencePayload;
  } catch {
    return null;
  }
}

/**
 * A VLAN portal context is public scope metadata, not an authentication
 * credential. Its signature prevents the browser from changing the assigned
 * ISP, reseller, router, or port. The API re-checks the live assignment on
 * every request, so disabled or reassigned ports invalidate old portal files.
 */
export function generateVlanHotspotPortalContextToken(
  scope: Omit<VlanHotspotPortalContext, "purpose" | "issuedAt" | "nonce">,
): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  if (
    !Number.isSafeInteger(scope.adminId) || scope.adminId < 1
    || !Number.isSafeInteger(scope.resellerId) || scope.resellerId < 1
    || !Number.isSafeInteger(scope.routerId) || scope.routerId < 1
    || !Number.isSafeInteger(scope.portId) || scope.portId < 1
  ) throw new Error("A complete reseller VLAN portal scope is required.");
  const body: VlanHotspotPortalContext = {
    purpose: VLAN_HOTSPOT_PORTAL_PURPOSE,
    ...scope,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function validateVlanHotspotPortalContextToken(token: string): VlanHotspotPortalContext | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) return null;

  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<VlanHotspotPortalContext>;
    if (
      payload.purpose !== VLAN_HOTSPOT_PORTAL_PURPOSE
      || !payload.nonce
      || !Number.isFinite(payload.issuedAt)
      || !Number.isSafeInteger(payload.adminId)
      || Number(payload.adminId) < 1
      || !Number.isSafeInteger(payload.resellerId)
      || Number(payload.resellerId) < 1
      || !Number.isSafeInteger(payload.routerId)
      || Number(payload.routerId) < 1
      || !Number.isSafeInteger(payload.portId)
      || Number(payload.portId) < 1
    ) return null;
    return payload as VlanHotspotPortalContext;
  } catch {
    return null;
  }
}

function applyPortalScopeIds(
  target: Record<string, unknown>,
  aliases: string[],
  value: number,
): boolean {
  for (const alias of aliases) {
    const supplied = target[alias];
    if (supplied !== undefined && supplied !== null && supplied !== "" && Number(supplied) !== value) {
      return false;
    }
  }
  for (const alias of aliases) {
    target[alias] = value;
  }
  return true;
}

/**
 * Verify the signed VLAN portal context against the current reseller-port
 * assignment. When present, the signed scope becomes authoritative for the
 * common public request ID fields, and conflicting browser values are denied.
 */
export async function resolveVlanHotspotPortalRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = String(req.get("x-hotspot-portal-context") ?? "").trim();
  if (!token) {
    next();
    return;
  }

  const payload = validateVlanHotspotPortalContextToken(token);
  if (!payload) {
    res.status(403).json({ ok: false, error: "This Hotspot portal scope is invalid." });
    return;
  }

  try {
    const [ports, resellers, parentAdmins] = await Promise.all([
      sbSelectStrict<{ id: number }>(
        "isp_reseller_ports",
        `id=eq.${payload.portId}&admin_id=eq.${payload.adminId}&router_id=eq.${payload.routerId}&assigned_reseller_id=eq.${payload.resellerId}&handoff_mode=eq.vlan_services&status=eq.active&link_status=eq.active&hotspot_enabled=is.true&select=id&limit=1`,
      ),
      sbSelectStrict<{ id: number }>(
        "isp_admins",
        `id=eq.${payload.resellerId}&parent_id=eq.${payload.adminId}&role=eq.reseller&is_active=is.true&select=id&limit=1`,
      ),
      sbSelectStrict<{ id: number }>(
        "isp_admins",
        `id=eq.${payload.adminId}&parent_id=is.null&is_active=is.true&select=id&limit=1`,
      ),
    ]);
    if (!ports[0] || !resellers[0] || !parentAdmins[0]) {
      res.status(403).json({ ok: false, error: "This reseller Hotspot portal assignment is no longer active." });
      return;
    }

    const query = req.query as Record<string, unknown>;
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : null;
    const scopes: Array<[string[], number]> = [
      [["adminId", "ispId"], payload.adminId],
      [["routerId", "router_id"], payload.routerId],
      [["portId", "port_id"], payload.portId],
      [["resellerId", "reseller_id"], payload.resellerId],
    ];
    for (const [aliases, value] of scopes) {
      if (!applyPortalScopeIds(query, aliases, value) || (body && !applyPortalScopeIds(body, aliases, value))) {
        res.status(403).json({ ok: false, error: "The requested service does not match this Hotspot portal." });
        return;
      }
    }

    req.hotspotPortalContext = payload;
    next();
  } catch {
    res.status(503).json({ ok: false, error: "The Hotspot portal assignment could not be verified." });
  }
}

export function extractToken(req: Request): string {
  const authHeader = req.headers.authorization ?? "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const tokenParam = req.query.token ?? req.headers["x-api-token"] ?? req.headers["x-sa-token"];
  return typeof tokenParam === "string" ? tokenParam.trim() : "";
}

export function requireAuth(requiredType?: "a" | "c") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    const payload = validateToken(token);

    if (!payload) {
      res.status(401).json({ ok: false, error: "Invalid or expired token" });
      return;
    }

    const isSignedInUser = payload.type === "a" || payload.type === "c";
    if ((requiredType && payload.type !== requiredType) || (!requiredType && !isSignedInUser)) {
      res.status(403).json({ ok: false, error: "Insufficient permissions" });
      return;
    }

    req.authUser = payload;
    req.tenantSubdomain = getTenantSubdomainFromRequest(req);
    next();
  };
}

export function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    const payload = validateToken(token);

    if (!payload) {
      res.status(401).json({ ok: false, error: "Invalid or expired token" });
      return;
    }
    if (payload.type !== "a") {
      res.status(403).json({ ok: false, error: "Insufficient permissions" });
      return;
    }

    let authenticatedAdmin: AuthenticatedAdmin | null = null;
    if (payload.uid !== "superadmin") {
      try {
        const adminRows = await sbSelectStrict<AuthenticatedAdmin>(
          "isp_admins",
          `id=eq.${encodeURIComponent(payload.uid)}&select=id,parent_id,subdomain,role,is_active,auth_version&limit=1`,
        );
        authenticatedAdmin = adminRows[0] ?? null;
      } catch {
        res.status(503).json({ ok: false, error: "Administrator session status could not be checked." });
        return;
      }
      if (!authenticatedAdmin || authenticatedAdmin.is_active !== true) {
        res.status(401).json({ ok: false, error: "This administrator account is inactive or no longer exists." });
        return;
      }
      if ((payload.authVersion ?? 1) !== Number(authenticatedAdmin.auth_version ?? 1)) {
        res.status(401).json({ ok: false, error: "Your security credentials changed. Sign in again." });
        return;
      }
    }

    let impersonationActor: string | null = null;
    if (payload.impersonationSessionId) {
      try {
        impersonationActor = await getActiveSuperAdminAccessActor(
          payload.impersonationSessionId,
          payload.uid,
        );
      } catch {
        res.status(503).json({ ok: false, error: "The Super Admin access session could not be checked." });
        return;
      }
      if (!impersonationActor) {
        res.status(401).json({ ok: false, error: "The Super Admin access session has expired or ended." });
        return;
      }
    }
    req.authUser = payload;

    const feature = getAdminApiReauthFeature(String(req.originalUrl || req.path || ""));
    if (feature && !impersonationActor && authenticatedAdmin) {
      try {
        const role = authenticatedAdmin.role;
        if (role !== "isp_admin" && role !== "reseller") {
          res.status(403).json({ ok: false, error: "This account cannot use administrator pages." });
          return;
        }
        const requiredMethod = await getPageAuthMethod(role as AdminPolicyRole, feature);
        if (requiredMethod !== "none") {
          const validProof = (payload.reauthGrants ?? []).some(proof =>
            proof.uid === payload.uid &&
            proof.role === role &&
            proof.feature === feature &&
            proof.method === requiredMethod &&
            Number.isFinite(proof.expiresAt) &&
            proof.expiresAt > Date.now(),
          );
          if (!validProof) {
            res.status(428).json({
              ok: false,
              code: "PAGE_AUTH_REQUIRED",
              feature,
              method: requiredMethod,
              error: requiredMethod === "password"
                ? "Re-enter your current password to continue."
                : "Complete the configured verification to continue.",
            });
            return;
          }
        }
      } catch {
        res.status(503).json({ ok: false, error: "The password re-check policy could not be verified." });
        return;
      }
    }

    const tenantSubdomain = getTenantSubdomainFromRequest(req);
    req.tenantSubdomain = tenantSubdomain;
    if (tenantSubdomain && req.authUser.uid !== "superadmin") {
      const tenantId = authenticatedAdmin?.parent_id ?? authenticatedAdmin?.id;
      const tenantRows = tenantId
        ? await sbSelect<{ id: number; parent_id: number | null }>(
            "isp_admins",
          `subdomain=eq.${encodeURIComponent(tenantSubdomain)}&is_active=is.true&select=id,parent_id&limit=10`,
          )
        : [];
      const sameLinkedTenant = tenantRows.some((row) =>
        Number(row.id) === Number(tenantId) || Number(row.parent_id) === Number(tenantId),
      );
      if (!sameLinkedTenant) {
        res.status(403).json({ ok: false, error: "This session does not belong to the requested ISP subdomain." });
        return;
      }
    }

    if (impersonationActor && !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      try {
        await recordPlatformAuthAudit({
          actorName: impersonationActor,
          action: "impersonated_admin_api_write",
          targetAdminId: Number(payload.uid),
          impersonationSessionId: payload.impersonationSessionId,
          details: { method: req.method, path: (req.originalUrl || req.path).split("?")[0] },
          sourceIp: req.ip ?? req.socket.remoteAddress,
          userAgent: req.get("user-agent"),
        });
      } catch {
        res.status(503).json({ ok: false, error: "This change was blocked because the access audit could not be recorded." });
        return;
      }
    }
    next();
  };
}

/**
 * Resolve the tenant selected by the authenticated admin session.
 * A client-supplied adminId may be provided as a consistency check, but it
 * must never be allowed to select a different tenant than the token.
 */
export function authenticatedAdminId(req: Request, requested?: unknown): number {
  const sessionId = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return 0;

  if (requested !== undefined && requested !== null && String(requested).trim() !== "") {
    const requestedId = Number(requested);
    if (!Number.isSafeInteger(requestedId) || requestedId <= 0 || requestedId !== sessionId) return 0;
  }

  return sessionId;
}

/** Resolve the owning ISP tenant for either an ISP admin or a reseller account. */
export async function authenticatedTenantAdminId(req: Request): Promise<number> {
  const sessionId = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return 0;
  const rows = await sbSelect<{ id: number; parent_id: number | null }>(
    "isp_admins",
    `id=eq.${encodeURIComponent(sessionId)}&is_active=is.true&select=id,parent_id&limit=1`,
  );
  return rows[0]?.parent_id ?? rows[0]?.id ?? 0;
}

export async function authenticatedAccount(req: Request): Promise<{
  id: number;
  parent_id: number | null;
  role: string;
  account_tier: "system_admin" | "isp_admin" | "reseller" | null;
} | null> {
  const sessionId = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;
  const rows = await sbSelect<{
    id: number;
    parent_id: number | null;
    role: string;
    account_tier: "system_admin" | "isp_admin" | "reseller" | null;
  }>(
    "isp_admins",
    `id=eq.${encodeURIComponent(sessionId)}&is_active=is.true&select=id,parent_id,role,account_tier&limit=1`,
  );
  return rows[0] ?? null;
}

export function requireCustomer() {
  return requireAuth("c");
}

export function optionalAuth() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    const payload = validateToken(token);
    if (payload) {
      req.authUser = payload;
    }
    next();
  };
}

export async function lookupAdmin(uid: string): Promise<Record<string, unknown> | null> {
  if (uid === "superadmin") {
    return {
      id: 0,
      username: process.env.SUPERADMIN_USERNAME ?? "Latty",
      role: "superadmin",
    };
  }
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(uid)}&select=id,username,fullname,email,role&limit=1`,
  );
  return rows[0] ?? null;
}

export async function lookupCustomer(uid: string): Promise<Record<string, unknown> | null> {
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `id=eq.${encodeURIComponent(uid)}&select=id,username,fullname,email,phone,status,plan_name,wallet_balance&limit=1`,
  );
  return rows[0] ?? null;
}
